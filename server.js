require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');
const mailer = require('./mailer');
const analytics = require('./analytics');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(express.json());
app.use(cors({
    origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN.split(',').map(s => s.trim()),
}));
app.use('/dashboard', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

/* ============================================================
   HELPERS
   ============================================================ */
function nextId(collection) {
    const items = db.get(collection).value();
    if (!items.length) return 1;
    return Math.max(...items.map(i => i.id)) + 1;
}

function now() { return new Date().toISOString(); }

/* ============================================================
   AUTH
   ============================================================ */
function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Non authentifié' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch { return res.status(401).json({ error: 'Session invalide ou expirée' }); }
}

app.post('/api/auth/login', (req, res) => {
    const { password } = req.body || {};
    const hash = process.env.ADMIN_PASSWORD_HASH;
    if (!hash) return res.status(500).json({ error: "ADMIN_PASSWORD_HASH non configuré" });
    if (!password || !bcrypt.compareSync(password, hash))
        return res.status(401).json({ error: 'Mot de passe incorrect' });
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ ok: true, role: req.user.role }));

/* ============================================================
   INGESTION PUBLIQUE — appelée par le chat widget du site
   ============================================================ */
app.post('/api/leads', async (req, res) => {
    const { name, email, message, source } = req.body || {};
    if (!email || !message) return res.status(400).json({ error: 'email et message requis' });
    const lead = { id: nextId('leads'), created_at: now(), name: name || null, email, message, source: source || 'chat', status: 'new', notes: '' };
    db.get('leads').push(lead).write();
    res.status(201).json({ id: lead.id }); // on répond tout de suite, les emails partent en arrière-plan

    mailer.sendMail(mailer.leadConfirmationEmail(lead)).catch(() => {});
    mailer.sendMail(mailer.leadNotificationEmail(lead)).catch(() => {});
});

app.post('/api/appointments', async (req, res) => {
    const { date_text, time_text, subject, email } = req.body || {};
    if (!email || !subject) return res.status(400).json({ error: 'email et subject requis' });
    const appt = { id: nextId('appointments'), created_at: now(), date_text: date_text || null, time_text: time_text || null, subject, email, status: 'pending', notes: '' };
    db.get('appointments').push(appt).write();
    res.status(201).json({ id: appt.id });

    mailer.sendMail(mailer.appointmentConfirmationEmail(appt)).catch(() => {});
    mailer.sendMail(mailer.appointmentNotificationEmail(appt)).catch(() => {});
});

app.post('/api/events', (req, res) => {
    const { type, meta } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type requis' });
    db.get('events').push({ id: nextId('events'), created_at: now(), type, meta: meta || {} }).write();
    res.status(201).json({ ok: true });
});

/* ============================================================
   DONNÉES PROTÉGÉES — dashboard admin
   ============================================================ */
app.get('/api/stats', auth, (req, res) => {
    const leads = db.get('leads').value();
    const appointments = db.get('appointments').value();
    const events = db.get('events').value();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const byDay = {};
    leads.filter(l => l.created_at >= thirtyDaysAgo).forEach(l => {
        const d = l.created_at.slice(0, 10);
        byDay[d] = (byDay[d] || 0) + 1;
    });

    const byStatus = {};
    leads.forEach(l => { byStatus[l.status] = (byStatus[l.status] || 0) + 1; });

    const bySource = {};
    leads.forEach(l => { bySource[l.source] = (bySource[l.source] || 0) + 1; });

    res.json({
        totalLeads: leads.length,
        totalAppointments: appointments.length,
        newLeads7d: leads.filter(l => l.created_at >= sevenDaysAgo).length,
        wonLeads: leads.filter(l => l.status === 'won').length,
        pendingAppointments: appointments.filter(a => a.status === 'pending').length,
        chatOpens: events.filter(e => e.type === 'chat_opened').length,
        byDay: Object.entries(byDay).sort().map(([d, c]) => ({ d, c })),
        byStatus: Object.entries(byStatus).map(([status, c]) => ({ status, c })),
        bySource: Object.entries(bySource).map(([source, c]) => ({ source, c })),
    });
});

app.get('/api/leads', auth, (req, res) => {
    const { status, q } = req.query;
    let leads = db.get('leads').value();
    if (status) leads = leads.filter(l => l.status === status);
    if (q) { const lq = q.toLowerCase(); leads = leads.filter(l => [l.name, l.email, l.message].some(f => f && f.toLowerCase().includes(lq))); }
    res.json(leads.reverse());
});

app.patch('/api/leads/:id', auth, (req, res) => {
    const id = Number(req.params.id);
    const { status, notes } = req.body || {};
    const lead = db.get('leads').find({ id });
    if (!lead.value()) return res.status(404).json({ error: 'Lead introuvable' });
    if (status) lead.assign({ status }).write();
    if (notes !== undefined) lead.assign({ notes }).write();
    res.json({ ok: true });
});

app.delete('/api/leads/:id', auth, (req, res) => {
    db.get('leads').remove({ id: Number(req.params.id) }).write();
    res.json({ ok: true });
});

// Ajout manuel d'un lead depuis le dashboard (contact reçu par téléphone, Instagram, en personne...)
app.post('/api/admin/leads', auth, (req, res) => {
    const { name, email, message, source, status } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email requis' });
    const lead = {
        id: nextId('leads'), created_at: now(),
        name: name || null, email, message: message || '',
        source: source || 'manuel', status: status || 'new', notes: '',
    };
    db.get('leads').push(lead).write();
    res.status(201).json({ id: lead.id });
});

// Répondre à un lead directement depuis le dashboard
app.post('/api/leads/:id/reply', auth, async (req, res) => {
    const id = Number(req.params.id);
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message requis' });
    const lead = db.get('leads').find({ id }).value();
    if (!lead) return res.status(404).json({ error: 'Lead introuvable' });

    const result = await mailer.sendMail(mailer.leadReplyEmail(lead, message));
    if (!result.sent) return res.status(500).json({ error: "Échec de l'envoi : " + result.reason });

    db.get('leads').find({ id }).assign({ status: 'contacted' }).write();
    res.json({ ok: true });
});

app.get('/api/appointments', auth, (req, res) => {
    const { status } = req.query;
    let appts = db.get('appointments').value();
    if (status) appts = appts.filter(a => a.status === status);
    res.json(appts.reverse());
});

app.patch('/api/appointments/:id', auth, (req, res) => {
    const id = Number(req.params.id);
    const { status, notes } = req.body || {};
    const appt = db.get('appointments').find({ id });
    if (!appt.value()) return res.status(404).json({ error: 'RDV introuvable' });
    if (status) appt.assign({ status }).write();
    if (notes !== undefined) appt.assign({ notes }).write();
    res.json({ ok: true });
});

app.delete('/api/appointments/:id', auth, (req, res) => {
    db.get('appointments').remove({ id: Number(req.params.id) }).write();
    res.json({ ok: true });
});

/* ============================================================
   CONTENU DU SITE — theme builder
   GET /api/content : public, appelé par index.html au chargement
   PUT /api/admin/content : protégé, appelé par le dashboard
   ============================================================ */
app.get('/api/content', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(db.get('site_content').value());
});

app.put('/api/admin/content', auth, (req, res) => {
    const content = req.body;
    if (!content || typeof content !== 'object') return res.status(400).json({ error: 'Corps invalide' });
    db.set('site_content', content).write();
    res.json({ ok: true });
});

/* ============================================================
   UPLOAD D'IMAGES
   ============================================================ */
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const safe = file.originalname.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9.\-_]/g, '-');
        cb(null, `${Date.now()}-${safe}`);
    },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    const ok = /\.(jpe?g|png|webp|svg|gif)$/i.test(file.originalname);
    cb(ok ? null : new Error('Format non autorisé'), ok);
}});

app.post('/api/admin/upload', auth, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Aucune image reçue' });
    res.status(201).json({ filename: req.file.filename, url: `/uploads/${req.file.filename}` });
});

app.get('/', (req, res) => res.redirect('/dashboard'));
/* ============================================================
   GOOGLE ANALYTICS — statistiques en direct dans le dashboard
   ============================================================ */
app.get('/api/analytics/realtime', auth, async (req, res) => {
    if (!analytics.isConfigured()) return res.json({ configured: false });
    try {
        res.json(await analytics.getRealtimeUsers());
    } catch (err) {
        console.error('Erreur GA realtime:', err.message);
        res.status(500).json({ error: 'Erreur Google Analytics : ' + err.message });
    }
});

app.get('/api/analytics/overview', auth, async (req, res) => {
    if (!analytics.isConfigured()) return res.json({ configured: false });
    try {
        const days = Number(req.query.days) || 28;
        res.json(await analytics.getOverview(days));
    } catch (err) {
        console.error('Erreur GA overview:', err.message);
        res.status(500).json({ error: 'Erreur Google Analytics : ' + err.message });
    }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`✅ Backend Florian B. sur http://localhost:${PORT}`));
