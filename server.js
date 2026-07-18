require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');

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
   AUTHENTIFICATION — un seul compte admin, mot de passe hashé
   ============================================================ */
function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Non authentifié' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Session invalide ou expirée' });
    }
}

app.post('/api/auth/login', (req, res) => {
    const { password } = req.body || {};
    const hash = process.env.ADMIN_PASSWORD_HASH;
    if (!hash) return res.status(500).json({ error: "ADMIN_PASSWORD_HASH n'est pas configuré côté serveur (voir .env)" });
    if (!password || !bcrypt.compareSync(password, hash)) {
        return res.status(401).json({ error: 'Mot de passe incorrect' });
    }
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ ok: true, role: req.user.role }));

/* ============================================================
   INGESTION PUBLIQUE — appelée directement par le chat widget
   du site (aucune authentification, ce sont des formulaires publics)
   ============================================================ */
app.post('/api/leads', (req, res) => {
    const { name, email, message, source } = req.body || {};
    if (!email || !message) return res.status(400).json({ error: 'email et message requis' });
    const info = db.prepare(
        `INSERT INTO leads (name, email, message, source) VALUES (?, ?, ?, ?)`
    ).run(name || null, email, message, source || 'chat');
    res.status(201).json({ id: info.lastInsertRowid });
});

app.post('/api/appointments', (req, res) => {
    const { date_text, time_text, subject, email } = req.body || {};
    if (!email || !subject) return res.status(400).json({ error: 'email et subject requis' });
    const info = db.prepare(
        `INSERT INTO appointments (date_text, time_text, subject, email) VALUES (?, ?, ?, ?)`
    ).run(date_text || null, time_text || null, subject, email);
    res.status(201).json({ id: info.lastInsertRowid });
});

app.post('/api/events', (req, res) => {
    const { type, meta } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type requis' });
    db.prepare(`INSERT INTO events (type, meta) VALUES (?, ?)`).run(type, JSON.stringify(meta || {}));
    res.status(201).json({ ok: true });
});

/* ============================================================
   DONNÉES PROTÉGÉES — utilisées par le dashboard
   ============================================================ */
app.get('/api/stats', auth, (req, res) => {
    const totalLeads = db.prepare(`SELECT COUNT(*) c FROM leads`).get().c;
    const totalAppointments = db.prepare(`SELECT COUNT(*) c FROM appointments`).get().c;
    const newLeads7d = db.prepare(`SELECT COUNT(*) c FROM leads WHERE created_at >= datetime('now','-7 day')`).get().c;
    const wonLeads = db.prepare(`SELECT COUNT(*) c FROM leads WHERE status='won'`).get().c;
    const pendingAppointments = db.prepare(`SELECT COUNT(*) c FROM appointments WHERE status='pending'`).get().c;
    const chatOpens = db.prepare(`SELECT COUNT(*) c FROM events WHERE type='chat_opened'`).get().c;
    const byDay = db.prepare(`
        SELECT date(created_at) d, COUNT(*) c FROM leads
        WHERE created_at >= datetime('now','-30 day')
        GROUP BY d ORDER BY d ASC
    `).all();
    const byStatus = db.prepare(`SELECT status, COUNT(*) c FROM leads GROUP BY status`).all();
    const bySource = db.prepare(`SELECT source, COUNT(*) c FROM leads GROUP BY source`).all();
    res.json({ totalLeads, totalAppointments, newLeads7d, wonLeads, pendingAppointments, chatOpens, byDay, byStatus, bySource });
});

app.get('/api/leads', auth, (req, res) => {
    const { status, q } = req.query;
    let sql = `SELECT * FROM leads WHERE 1=1`;
    const params = [];
    if (status) { sql += ` AND status = ?`; params.push(status); }
    if (q) { sql += ` AND (name LIKE ? OR email LIKE ? OR message LIKE ?)`; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    sql += ` ORDER BY created_at DESC`;
    res.json(db.prepare(sql).all(...params));
});

app.patch('/api/leads/:id', auth, (req, res) => {
    const { status, notes } = req.body || {};
    const fields = []; const params = [];
    if (status) { fields.push('status = ?'); params.push(status); }
    if (notes !== undefined) { fields.push('notes = ?'); params.push(notes); }
    if (!fields.length) return res.status(400).json({ error: 'Rien à mettre à jour' });
    params.push(req.params.id);
    db.prepare(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
});

app.delete('/api/leads/:id', auth, (req, res) => {
    db.prepare(`DELETE FROM leads WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
});

app.get('/api/appointments', auth, (req, res) => {
    const { status } = req.query;
    let sql = `SELECT * FROM appointments WHERE 1=1`;
    const params = [];
    if (status) { sql += ` AND status = ?`; params.push(status); }
    sql += ` ORDER BY created_at DESC`;
    res.json(db.prepare(sql).all(...params));
});

app.patch('/api/appointments/:id', auth, (req, res) => {
    const { status, notes } = req.body || {};
    const fields = []; const params = [];
    if (status) { fields.push('status = ?'); params.push(status); }
    if (notes !== undefined) { fields.push('notes = ?'); params.push(notes); }
    if (!fields.length) return res.status(400).json({ error: 'Rien à mettre à jour' });
    params.push(req.params.id);
    db.prepare(`UPDATE appointments SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
});

app.delete('/api/appointments/:id', auth, (req, res) => {
    db.prepare(`DELETE FROM appointments WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
});

app.get('/', (req, res) => res.redirect('/dashboard'));
app.get('/health', (req, res) => res.json({ ok: true }));

/* ============================================================
   CONTENU DU SITE — le "theme builder"
   - GET /api/content est PUBLIC : c'est ce que index.html va
     chercher à chaque chargement de page pour afficher le
     contenu à jour (hero, projets, FAQ, galerie).
   - PUT /api/admin/content est PROTÉGÉ : utilisé par le
     dashboard pour enregistrer les modifications.
   ============================================================ */
app.get('/api/content', (req, res) => {
    const row = db.prepare(`SELECT data FROM site_content WHERE id = 1`).get();
    if (!row) return res.status(404).json({ error: 'Contenu non initialisé' });
    res.set('Cache-Control', 'no-store'); // toujours la version la plus fraîche
    res.json(JSON.parse(row.data));
});

app.put('/api/admin/content', auth, (req, res) => {
    const content = req.body;
    if (!content || typeof content !== 'object') {
        return res.status(400).json({ error: 'Corps de requête invalide' });
    }
    db.prepare(`UPDATE site_content SET data = ?, updated_at = datetime('now') WHERE id = 1`)
        .run(JSON.stringify(content));
    res.json({ ok: true });
});

/* ============================================================
   UPLOAD D'IMAGES — depuis le dashboard, remplace FileZilla
   pour les images gérées par le theme builder.
   ============================================================ */
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const safeName = file.originalname
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève les accents
            .replace(/[^a-zA-Z0-9.\-_]/g, '-');
        cb(null, `${Date.now()}-${safeName}`);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo max par image
    fileFilter: (req, file, cb) => {
        const ok = /\.(jpe?g|png|webp|svg|gif)$/i.test(file.originalname);
        cb(ok ? null : new Error('Format de fichier non autorisé'), ok);
    },
});

app.post('/api/admin/upload', auth, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Aucune image reçue' });
    res.status(201).json({
        filename: req.file.filename,
        url: `/uploads/${req.file.filename}`,
    });
});

app.listen(PORT, () => console.log(`✅ Backend Florian B. lancé sur http://localhost:${PORT}  (dashboard : /dashboard)`));
