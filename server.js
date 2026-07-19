require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');
const mailer = require('./mailer');
const analytics = require('./analytics');
const cron = require('node-cron');

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
// tracker.js servi directement à la racine avec CORS large (doit être chargé depuis florian-b.fr)
app.get('/tracker.js', (req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(__dirname, 'public', 'tracker.js'));
});

/* ============================================================
   HELPERS
   ============================================================ */
function nextId(collection) {
    const items = db.get(collection).value();
    if (!items.length) return 1;
    return Math.max(...items.map(i => i.id)) + 1;
}

function now() { return new Date().toISOString(); }

/* ---- IP réelle (Railway est derrière un proxy) ---- */
function getRealIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.socket?.remoteAddress || req.ip || null;
}

/* ---- Parsing User-Agent simple (sans lib externe) ---- */
function parseUA(ua) {
    if (!ua) return { browser: 'Inconnu', os: 'Inconnu', device: 'desktop' };
    let browser = 'Autre';
    let os      = 'Autre';
    let device  = 'desktop';

    // Device
    if (/mobile|android|iphone|ipod/i.test(ua))  device = 'mobile';
    else if (/ipad|tablet/i.test(ua))             device = 'tablet';

    // Browser (ordre important — Edge avant Chrome, etc.)
    if      (/Edg\//i.test(ua))         browser = 'Edge '      + (ua.match(/Edg\/([\d.]+)/)?.[1]||'').split('.')[0];
    else if (/OPR\//i.test(ua))         browser = 'Opera '     + (ua.match(/OPR\/([\d.]+)/)?.[1]||'').split('.')[0];
    else if (/Firefox\//i.test(ua))     browser = 'Firefox '   + (ua.match(/Firefox\/([\d.]+)/)?.[1]||'').split('.')[0];
    else if (/Chrome\//i.test(ua))      browser = 'Chrome '    + (ua.match(/Chrome\/([\d.]+)/)?.[1]||'').split('.')[0];
    else if (/Safari\//i.test(ua))      browser = 'Safari '    + (ua.match(/Version\/([\d.]+)/)?.[1]||'').split('.')[0];
    else if (/MSIE|Trident/i.test(ua))  browser = 'IE';

    // OS
    if      (/Windows NT 10/i.test(ua))     os = 'Windows 10/11';
    else if (/Windows NT/i.test(ua))        os = 'Windows';
    else if (/iPhone.*OS ([\d_]+)/i.test(ua)) os = 'iOS ' + ua.match(/iPhone.*OS ([\d_]+)/i)?.[1]?.replace(/_/g,'.');
    else if (/iPad.*OS ([\d_]+)/i.test(ua))   os = 'iPadOS ' + ua.match(/iPad.*OS ([\d_]+)/i)?.[1]?.replace(/_/g,'.');
    else if (/Android ([\d.]+)/i.test(ua))  os = 'Android ' + ua.match(/Android ([\d.]+)/i)?.[1];
    else if (/Mac OS X ([\d_]+)/i.test(ua)) os = 'macOS ' + ua.match(/Mac OS X ([\d_]+)/i)?.[1]?.replace(/_/g,'.');
    else if (/Linux/i.test(ua))             os = 'Linux';

    return { browser, os, device };
}

/* ---- Géolocalisation IP via api.ip-api.com (gratuit, 45 req/min) ---- */
async function geolocateIp(ip) {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168') || ip.startsWith('10.')) {
        return { country: 'Local', city: 'Local', region: null, lat: null, lon: null, isp: null, timezone: null };
    }
    try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 4000);
        const res  = await fetch(
            `http://ip-api.com/json/${ip}?fields=status,country,countryCode,region,regionName,city,lat,lon,timezone,isp,org`,
            { signal: ctrl.signal }
        ).finally(() => clearTimeout(tid));
        if (!res.ok) return null;
        const d = await res.json();
        if (d.status !== 'success') return null;
        return {
            country: d.country, countryCode: d.countryCode,
            region: d.regionName, city: d.city,
            lat: d.lat, lon: d.lon,
            timezone: d.timezone, isp: d.isp || d.org || null,
        };
    } catch { return null; }
}

/* ---- Logging des actions équipe ---- */
function logTeamAction(req, action, detail = null, targetId = null) {
    if (!req.user) return;
    const entry = {
        id: nextId('teamLogs'),
        ts: now(),
        userId: req.user.userId,
        userName: req.user.name || req.user.email,
        userEmail: req.user.email,
        action,
        detail,
        targetId,
        ip: getRealIp(req),
        ua: req.headers['user-agent'] || null,
    };
    db.get('teamLogs').push(entry).write();
    // Garder max 2000 logs
    const logs = db.get('teamLogs').value();
    if (logs.length > 2000) db.set('teamLogs', logs.slice(logs.length - 2000)).write();
}

/* ---- Heartbeat : mémoriser la dernière activité de chaque utilisateur connecté ---- */
function touchUserActivity(req) {
    if (!req.user) return;
    db.get('users').find({ id: req.user.userId }).assign({
        lastSeenAt: now(),
        lastIp: getRealIp(req),
        lastUa: req.headers['user-agent'] || null,
    }).write();
}

/* ============================================================
   AUTH & RÔLES
   ------------------------------------------------------------
   3 rôles : admin (tout), redacteur (contenu + leads/RDV),
   lecteur (lecture seule partout).
   Le token JWT contient désormais { userId, email, role }.
   ============================================================ */
const ROLES = ['admin', 'redacteur', 'lecteur'];

function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = (header.startsWith('Bearer ') ? header.slice(7) : null) || req.query.token || null;
    if (!token) return res.status(401).json({ error: 'Non authentifié' });
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        // On revérifie que l'utilisateur existe toujours et est actif à chaque requête :
        // si un admin désactive/supprime quelqu'un, l'effet est immédiat, pas seulement
        // à l'expiration du token (7 jours plus tard).
        const user = db.get('users').find({ id: payload.userId }).value();
        if (!user || user.status !== 'active') return res.status(401).json({ error: 'Compte désactivé ou introuvable' });
        req.user = { userId: user.id, email: user.email, role: user.role, name: user.name };
        touchUserActivity(req);
        next();
    } catch { return res.status(401).json({ error: 'Session invalide ou expirée' }); }
}

// Restreint une route à une liste de rôles. À poser APRÈS auth.
function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: "Vous n'avez pas les droits nécessaires pour cette action" });
        }
        next();
    };
}
// Raccourcis de lisibilité
const canWrite = requireRole('admin', 'redacteur');   // rédacteur + admin
const adminOnly = requireRole('admin');                // admin seul

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email et mot de passe requis' });
    const user = db.get('users').find({ email: String(email).toLowerCase().trim() }).value();
    if (!user || user.status !== 'active' || !bcrypt.compareSync(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.get('/api/auth/me', auth, (req, res) => {
    res.json({ ok: true, id: req.user.userId, email: req.user.email, name: req.user.name, role: req.user.role });
});

// Changer son propre mot de passe (tous rôles)
app.post('/api/auth/change-password', auth, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Mot de passe actuel et nouveau requis' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 8 caractères' });
    const user = db.get('users').find({ id: req.user.userId }).value();
    if (!bcrypt.compareSync(currentPassword, user.passwordHash)) {
        return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    }
    db.get('users').find({ id: req.user.userId }).assign({ passwordHash: bcrypt.hashSync(newPassword, 10) }).write();
    res.json({ ok: true });
});

// Modifier mon propre nom affiché (tous rôles)
app.patch('/api/auth/me', auth, (req, res) => {
    const { name } = req.body || {};
    if (name !== undefined) db.get('users').find({ id: req.user.userId }).assign({ name: String(name).trim() || null }).write();
    res.json({ ok: true });
});

/* ---- Invitation : définir son mot de passe via le lien reçu par email ---- */
// Public volontairement : la sécurité vient de la longueur/aléa du token, pas d'un JWT
app.get('/api/auth/invite/:token', (req, res) => {
    const user = db.get('users').find({ inviteToken: req.params.token }).value();
    if (!user) return res.status(404).json({ error: 'Lien invalide' });
    if (user.inviteTokenExpires && user.inviteTokenExpires < now()) return res.status(410).json({ error: 'Ce lien a expiré, demandez une nouvelle invitation' });
    res.json({ email: user.email, name: user.name, role: user.role });
});

app.post('/api/auth/invite/:token/accept', (req, res) => {
    const { password, name } = req.body || {};
    if (!password || password.length < 8) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères' });
    const user = db.get('users').find({ inviteToken: req.params.token }).value();
    if (!user) return res.status(404).json({ error: 'Lien invalide' });
    if (user.inviteTokenExpires && user.inviteTokenExpires < now()) return res.status(410).json({ error: 'Ce lien a expiré, demandez une nouvelle invitation' });
    db.get('users').find({ id: user.id }).assign({
        passwordHash: bcrypt.hashSync(password, 10),
        name: name !== undefined && name !== '' ? String(name).trim() : user.name,
        status: 'active',
        inviteToken: null,
        inviteTokenExpires: null,
    }).write();
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

/* ============================================================
   GESTION DES UTILISATEURS — réservée aux admins
   ============================================================ */
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
    const users = db.get('users').value().map(u => ({
        id: u.id, email: u.email, name: u.name, role: u.role,
        status: u.status, created_at: u.created_at,
        lastSeenAt: u.lastSeenAt || null,
        lastIp: u.lastIp || null,
    }));
    res.json(users);
});

app.post('/api/admin/users', auth, adminOnly, async (req, res) => {
    const { email, name, role } = req.body || {};
    if (!email || !ROLES.includes(role)) return res.status(400).json({ error: 'email et role (admin, redacteur ou lecteur) requis' });
    const cleanEmail = String(email).toLowerCase().trim();
    if (db.get('users').find({ email: cleanEmail }).value()) return res.status(409).json({ error: 'Un compte existe déjà avec cet email' });

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const user = {
        id: nextId('users'), created_at: now(),
        email: cleanEmail, name: name || null, role,
        passwordHash: bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10), // mot de passe temporaire inutilisable, écrasé à l'acceptation
        status: 'invited',
        inviteToken,
        inviteTokenExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 jours
    };
    db.get('users').push(user).write();
    const result = await mailer.sendMail(mailer.teamInviteEmail(user, inviteToken));
    logTeamAction(req, 'user_invited', `${cleanEmail} invité avec le rôle ${role}`, user.id);
    res.status(201).json({ id: user.id, emailSent: result.sent, emailError: result.sent ? null : result.reason });
});

// Renvoyer une invitation (nouveau token, nouvelle expiration) — pour un compte encore "invited"
app.post('/api/admin/users/:id/resend-invite', auth, adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    const user = db.get('users').find({ id }).value();
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    if (user.status !== 'invited') return res.status(400).json({ error: 'Ce compte est déjà actif' });

    const inviteToken = crypto.randomBytes(32).toString('hex');
    db.get('users').find({ id }).assign({
        inviteToken,
        inviteTokenExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }).write();
    const result = await mailer.sendMail(mailer.teamInviteEmail(user, inviteToken));
    res.json({ ok: true, emailSent: result.sent, emailError: result.sent ? null : result.reason });
});

app.patch('/api/admin/users/:id', auth, adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const target = db.get('users').find({ id });
    if (!target.value()) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const { role, status, name } = req.body || {};

    // Un admin ne peut pas se retirer lui-même ses propres droits admin ou se désactiver :
    // ça évite de se retrouver bloqué dehors par erreur.
    if (id === req.user.userId && ((role && role !== 'admin') || (status && status !== 'active'))) {
        return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre rôle ou statut' });
    }
    // Toujours garder au moins un admin actif
    if ((role && role !== 'admin') || (status && status !== 'active')) {
        const otherActiveAdmins = db.get('users').value().filter(u => u.id !== id && u.role === 'admin' && u.status === 'active').length;
        const targetIsActiveAdmin = target.value().role === 'admin' && target.value().status === 'active';
        if (targetIsActiveAdmin && otherActiveAdmins === 0) {
            return res.status(400).json({ error: 'Impossible : il doit toujours rester au moins un administrateur actif' });
        }
    }

    const patch = {};
    if (role !== undefined && ROLES.includes(role)) patch.role = role;
    if (status !== undefined && ['active', 'disabled'].includes(status)) patch.status = status;
    if (name !== undefined) patch.name = name;
    target.assign(patch).write();
    const t = db.get('users').find({ id }).value();
    if (patch.role || patch.status)
        logTeamAction(req, 'user_updated', `${t.email} : ${patch.role ? `rôle → ${patch.role}` : ''}${patch.status ? ` statut → ${patch.status}` : ''}`.trim(), id);
    res.json({ ok: true });
});

app.delete('/api/admin/users/:id', auth, adminOnly, (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.userId) return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
    const target = db.get('users').find({ id }).value();
    if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
    if (target.role === 'admin' && target.status === 'active') {
        const otherActiveAdmins = db.get('users').value().filter(u => u.id !== id && u.role === 'admin' && u.status === 'active').length;
        if (otherActiveAdmins === 0) return res.status(400).json({ error: 'Impossible : il doit toujours rester au moins un administrateur actif' });
    }
    const targetU = db.get('users').find({ id }).value();
    logTeamAction(req, 'user_deleted', `${targetU?.email || '#' + id} supprimé de l'équipe`, id);
    db.get('users').remove({ id }).write();
    res.json({ ok: true });
});
/* ============================================================
   INGESTION PUBLIQUE — appelée par le chat widget du site
   ============================================================ */
app.post('/api/leads', async (req, res) => {
    const { name, email, message, source } = req.body || {};
    if (!email || !message) return res.status(400).json({ error: 'email et message requis' });

    // Tracking visiteur — tout ce qu'on peut récupérer
    const ip  = getRealIp(req);
    const ua  = req.headers['user-agent'] || null;
    const uaParsed = parseUA(ua);
    const tracking = {
        ip,
        ...uaParsed,                                           // browser, os, device
        referrer:   req.body.referrer   || req.headers['referer'] || null,
        page:       req.body.page       || null,
        sessionId:  req.body.sessionId  || null,
        lang:       req.body.lang       || null,
        timezone:   req.body.timezone   || null,
        screen:     req.body.screen     || null,
        connection: req.body.connection || null,
        utmSource:  req.body.utmSource  || null,
        utmMedium:  req.body.utmMedium  || null,
        utmCampaign:req.body.utmCampaign|| null,
        visitDuration: req.body.visitDuration || null,
        pagesVisited:  req.body.pagesVisited  || null,
        ua,
        geo: null, // rempli en arrière-plan
    };

    const lead = {
        id: nextId('leads'), created_at: now(),
        name: name || null, email, message,
        source: source || 'chat', status: 'new', notes: '',
        tracking,
    };
    db.get('leads').push(lead).write();
    res.status(201).json({ id: lead.id });

    // Géolocalisation + emails en arrière-plan (ne bloquent pas la réponse)
    (async () => {
        const geo = await geolocateIp(ip);
        if (geo) {
            db.get('leads').find({ id: lead.id }).assign({ tracking: { ...tracking, geo } }).write();
            lead.tracking.geo = geo; // pour l'email de notif
        }
        mailer.sendMail(mailer.leadConfirmationEmail(lead)).catch(() => {});
        mailer.sendMail(mailer.leadNotificationEmail(lead)).catch(() => {});
    })();
});

app.post('/api/appointments', async (req, res) => {
    const { date_text, time_text, subject, email } = req.body || {};
    if (!email || !subject) return res.status(400).json({ error: 'email et subject requis' });

    const ip = getRealIp(req);
    const ua = req.headers['user-agent'] || null;
    const uaParsed = parseUA(ua);
    const tracking = {
        ip,
        ...uaParsed,
        referrer:    req.body.referrer    || req.headers['referer'] || null,
        page:        req.body.page        || null,
        sessionId:   req.body.sessionId   || null,
        lang:        req.body.lang        || null,
        timezone:    req.body.timezone    || null,
        screen:      req.body.screen      || null,
        utmSource:   req.body.utmSource   || null,
        utmMedium:   req.body.utmMedium   || null,
        utmCampaign: req.body.utmCampaign || null,
        visitDuration: req.body.visitDuration || null,
        pagesVisited:  req.body.pagesVisited  || null,
        ua,
        geo: null,
    };

    const appt = {
        id: nextId('appointments'), created_at: now(),
        date_text: date_text || null, time_text: time_text || null,
        subject, email, status: 'pending', notes: '',
        tracking,
    };
    db.get('appointments').push(appt).write();
    res.status(201).json({ id: appt.id });

    (async () => {
        const geo = await geolocateIp(ip);
        if (geo) {
            db.get('appointments').find({ id: appt.id }).assign({ tracking: { ...tracking, geo } }).write();
            appt.tracking.geo = geo;
        }
        mailer.sendMail(mailer.appointmentConfirmationEmail(appt)).catch(() => {});
        mailer.sendMail(mailer.appointmentNotificationEmail(appt)).catch(() => {});
    })();
});

// Suivi d'activité — appelé par le site pour toute action utilisateur (formulaires,
// consultation de projet, ouverture du chat, FAQ, téléchargements, etc.)
// Format envoyé par le site : { event, sessionId, path, referrer, timestamp, ...données propres à l'événement }
// Reste compatible avec l'ancien format { type, meta } utilisé par le code existant.
app.post('/api/events', (req, res) => {
    const body = req.body || {};
    const type = body.event || body.type;
    if (!type) return res.status(400).json({ error: 'event (ou type) requis' });
    const knownFields = ['event', 'type', 'sessionId', 'path', 'referrer', 'timestamp', 'meta'];
    const extraMeta = body.meta || Object.fromEntries(Object.entries(body).filter(([k]) => !knownFields.includes(k)));
    const record = {
        id: nextId('events'),
        created_at: now(),
        type,
        sessionId: body.sessionId || null,
        path: body.path || null,
        referrer: body.referrer || null,
        meta: extraMeta,
    };
    db.get('events').push(record).write();
    // Garde-fou : ne garder que les 5000 événements les plus récents pour ne pas faire grossir indéfiniment le fichier de données
    const events = db.get('events').value();
    if (events.length > 5000) db.set('events', events.slice(events.length - 5000)).write();
    res.status(201).json({ ok: true });
});

app.get('/api/events', auth, (req, res) => {
    const { type, q } = req.query;
    let events = db.get('events').value();
    if (type) events = events.filter(e => e.type === type);
    if (q) {
        const lq = q.toLowerCase();
        events = events.filter(e => [e.path, e.referrer, e.sessionId, JSON.stringify(e.meta || {})].some(f => f && String(f).toLowerCase().includes(lq)));
    }
    const limit = Math.min(Number(req.query.limit) || 300, 1000);
    res.json(events.slice(-limit).reverse());
});

app.get('/api/events/summary', auth, (req, res) => {
    const events = db.get('events').value();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recent = events.filter(e => e.created_at >= sevenDaysAgo);
    const byType = {};
    recent.forEach(e => { byType[e.type] = (byType[e.type] || 0) + 1; });
    const sessions = new Set(recent.map(e => e.sessionId).filter(Boolean));
    res.json({
        total7d: recent.length,
        totalAll: events.length,
        uniqueSessions7d: sessions.size,
        byType: Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count })),
    });
});

app.delete('/api/events/:id', auth, canWrite, (req, res) => {
    db.get('events').remove({ id: Number(req.params.id) }).write();
    res.json({ ok: true });
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

app.patch('/api/leads/:id', auth, canWrite, (req, res) => {
    const id = Number(req.params.id);
    const { status, notes } = req.body || {};
    const lead = db.get('leads').find({ id });
    if (!lead.value()) return res.status(404).json({ error: 'Lead introuvable' });
    const prev = lead.value();
    if (status) lead.assign({ status }).write();
    if (notes !== undefined) lead.assign({ notes }).write();
    if (status && status !== prev.status)
        logTeamAction(req, 'lead_status_changed', `Lead #${id} (${prev.email}) : ${prev.status} → ${status}`, id);
    if (notes !== undefined)
        logTeamAction(req, 'lead_note_edited', `Lead #${id} (${prev.email})`, id);
    res.json({ ok: true });
});

app.delete('/api/leads/:id', auth, canWrite, (req, res) => {
    const id = Number(req.params.id);
    const lead = db.get('leads').find({ id }).value();
    logTeamAction(req, 'lead_deleted', `Lead #${id}${lead ? ` (${lead.email})` : ''}`, id);
    db.get('leads').remove({ id }).write();
    res.json({ ok: true });
});

// Ajout manuel d'un lead depuis le dashboard
app.post('/api/admin/leads', auth, canWrite, (req, res) => {
    const { name, email, message, source, status } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email requis' });
    const lead = {
        id: nextId('leads'), created_at: now(),
        name: name || null, email, message: message || '',
        source: source || 'manuel', status: status || 'new', notes: '',
        tracking: { ip: getRealIp(req), ...parseUA(req.headers['user-agent']), addedBy: req.user.email },
    };
    db.get('leads').push(lead).write();
    logTeamAction(req, 'lead_created_manual', `Lead ajouté manuellement : ${email}`, lead.id);
    res.status(201).json({ id: lead.id });
});

// Répondre à un lead directement depuis le dashboard
app.post('/api/leads/:id/reply', auth, canWrite, async (req, res) => {
    const id = Number(req.params.id);
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message requis' });
    const lead = db.get('leads').find({ id }).value();
    if (!lead) return res.status(404).json({ error: 'Lead introuvable' });
    const result = await mailer.sendMail(mailer.leadReplyEmail(lead, message));
    if (!result.sent) return res.status(500).json({ error: "Échec de l'envoi : " + result.reason });
    db.get('leads').find({ id }).assign({ status: 'contacted' }).write();
    logTeamAction(req, 'lead_replied', `Réponse envoyée à ${lead.email}`, id);
    res.json({ ok: true });
});

app.get('/api/appointments', auth, (req, res) => {
    const { status } = req.query;
    let appts = db.get('appointments').value();
    if (status) appts = appts.filter(a => a.status === status);
    res.json(appts.reverse());
});

app.patch('/api/appointments/:id', auth, canWrite, (req, res) => {
    const id = Number(req.params.id);
    const { status, notes } = req.body || {};
    const appt = db.get('appointments').find({ id });
    if (!appt.value()) return res.status(404).json({ error: 'RDV introuvable' });
    if (status) appt.assign({ status }).write();
    if (notes !== undefined) appt.assign({ notes }).write();
    res.json({ ok: true });
});

app.delete('/api/appointments/:id', auth, canWrite, (req, res) => {
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

app.put('/api/admin/content', auth, canWrite, (req, res) => {
    const content = req.body;
    if (!content || typeof content !== 'object') return res.status(400).json({ error: 'Corps invalide' });
    db.set('site_content', content).write();
    logTeamAction(req, 'site_content_updated', 'Contenu du site modifié (Hero, Projets, FAQ, Galeries...)');
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

app.post('/api/admin/upload', auth, canWrite, upload.single('image'), (req, res) => {
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

/* ============================================================
   OBJECTIFS DE VUES/VISITEURS
   ============================================================ */
const GOAL_METRICS = {
    activeUsers: 'Visiteurs', sessions: 'Sessions', pageViews: 'Pages vues',
};
const GOAL_PERIODS = { daily: "Aujourd'hui", weekly: 'Cette semaine', monthly: 'Ce mois-ci' };

app.get('/api/analytics/goals', auth, (req, res) => {
    res.json(db.get('analyticsGoals').value());
});

app.post('/api/analytics/goals', auth, adminOnly, (req, res) => {
    const { metric, target, period } = req.body || {};
    if (!metric || !target || !period) return res.status(400).json({ error: 'metric, target et period requis' });
    const goal = { id: nextId('analyticsGoals'), created_at: now(), metric, target: Number(target), period };
    db.get('analyticsGoals').push(goal).write();
    res.status(201).json(goal);
});

app.delete('/api/analytics/goals/:id', auth, adminOnly, (req, res) => {
    db.get('analyticsGoals').remove({ id: Number(req.params.id) }).write();
    res.json({ ok: true });
});

// Progression de chaque objectif par rapport aux vraies données GA du moment
app.get('/api/analytics/goals-progress', auth, async (req, res) => {
    if (!analytics.isConfigured()) return res.json({ configured: false, goals: [] });
    try {
        const goals = db.get('analyticsGoals').value();
        const daysByPeriod = { daily: 1, weekly: 7, monthly: 30 };
        const results = [];
        for (const goal of goals) {
            const overview = await analytics.getOverview(daysByPeriod[goal.period] || 7);
            const current = overview.configured ? (overview.totals[goal.metric] || 0) : 0;
            results.push({ ...goal, current, progress: goal.target > 0 ? Math.min(100, Math.round((current / goal.target) * 100)) : 0 });
        }
        res.json({ configured: true, goals: results });
    } catch (err) {
        res.status(500).json({ error: 'Erreur calcul objectifs : ' + err.message });
    }
});

/* ============================================================
   ALERTES ANALYTICS — vérifiées automatiquement chaque heure
   ============================================================ */
app.get('/api/analytics/alerts', auth, (req, res) => {
    res.json(db.get('analyticsAlerts').value());
});

app.post('/api/analytics/alerts', auth, adminOnly, (req, res) => {
    const { metric, condition, threshold, notifyEmail } = req.body || {};
    if (!metric || !condition || threshold === undefined) return res.status(400).json({ error: 'metric, condition et threshold requis' });
    const alert = {
        id: nextId('analyticsAlerts'), created_at: now(), metric, condition,
        threshold: Number(threshold), notifyEmail: notifyEmail || null,
        active: true, last_triggered_at: null,
    };
    db.get('analyticsAlerts').push(alert).write();
    res.status(201).json(alert);
});

app.patch('/api/analytics/alerts/:id', auth, adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const alert = db.get('analyticsAlerts').find({ id });
    if (!alert.value()) return res.status(404).json({ error: 'Alerte introuvable' });
    const { active } = req.body || {};
    if (active !== undefined) alert.assign({ active }).write();
    res.json({ ok: true });
});

app.delete('/api/analytics/alerts/:id', auth, adminOnly, (req, res) => {
    db.get('analyticsAlerts').remove({ id: Number(req.params.id) }).write();
    res.json({ ok: true });
});

async function checkAnalyticsAlerts() {
    if (!analytics.isConfigured()) return;
    const alerts = db.get('analyticsAlerts').value().filter(a => a.active);
    const today = new Date().toISOString().slice(0, 10);
    for (const alert of alerts) {
        if (alert.last_triggered_at && alert.last_triggered_at.slice(0, 10) === today) continue; // déjà notifié aujourd'hui
        try {
            const value = await analytics.getTodayMetric(alert.metric === 'pageViews' ? 'screenPageViews' : alert.metric);
            if (value === null) continue;
            const triggered = alert.condition === 'above' ? value > alert.threshold : value < alert.threshold;
            if (triggered) {
                await mailer.sendMail(mailer.analyticsAlertEmail(alert, value));
                db.get('analyticsAlerts').find({ id: alert.id }).assign({ last_triggered_at: now() }).write();
            }
        } catch (err) {
            console.error('Erreur vérification alerte analytics:', err.message);
        }
    }
}

/* ============================================================
   DEVIS & FACTURES
   ============================================================ */
function computeQuoteTotal(items) {
    return (items || []).reduce((sum, i) => sum + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
}

app.get('/api/quotes', auth, (req, res) => {
    res.json([...db.get('quotes').value()].reverse());
});

app.post('/api/quotes', auth, adminOnly, (req, res) => {
    const { clientName, clientEmail, items, notes, leadId } = req.body || {};
    if (!clientEmail) return res.status(400).json({ error: 'clientEmail requis' });
    const quote = {
        id: nextId('quotes'), created_at: now(), leadId: leadId || null,
        clientName: clientName || '', clientEmail,
        items: Array.isArray(items) ? items : [],
        notes: notes || '', status: 'draft', sent_at: null, paid_at: null,
    };
    quote.total = computeQuoteTotal(quote.items);
    db.get('quotes').push(quote).write();
    logTeamAction(req, 'quote_created', `Devis créé pour ${clientEmail} (${quote.total.toFixed(2)} €)`, quote.id);
    res.status(201).json(quote);
});

app.patch('/api/quotes/:id', auth, adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const q = db.get('quotes').find({ id });
    if (!q.value()) return res.status(404).json({ error: 'Devis introuvable' });
    const { clientName, clientEmail, items, notes, status } = req.body || {};
    const prev = q.value();
    const patch = {};
    if (clientName !== undefined) patch.clientName = clientName;
    if (clientEmail !== undefined) patch.clientEmail = clientEmail;
    if (notes !== undefined) patch.notes = notes;
    if (status !== undefined) {
        patch.status = status;
        if (status === 'paid') patch.paid_at = now();
    }
    if (items !== undefined) { patch.items = items; patch.total = computeQuoteTotal(items); }
    q.assign(patch).write();
    if (status && status !== prev.status)
        logTeamAction(req, 'quote_status_changed', `Devis #${id} (${prev.clientEmail}) : ${prev.status} → ${status}`, id);
    res.json({ ok: true });
});

app.delete('/api/quotes/:id', auth, adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const q = db.get('quotes').find({ id }).value();
    logTeamAction(req, 'quote_deleted', `Devis #${id}${q ? ` (${q.clientEmail})` : ''} supprimé`, id);
    db.get('quotes').remove({ id }).write();
    res.json({ ok: true });
});

// Page HTML imprimable
app.get('/api/quotes/:id/view', auth, (req, res) => {
    const quote = db.get('quotes').find({ id: Number(req.params.id) }).value();
    if (!quote) return res.status(404).send('Devis introuvable');
    res.set('Content-Type', 'text/html');
    res.send(mailer.quoteHtmlPage(quote));
});

// Envoi du devis par email au client
app.post('/api/quotes/:id/send', auth, adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    const quote = db.get('quotes').find({ id }).value();
    if (!quote) return res.status(404).json({ error: 'Devis introuvable' });
    const result = await mailer.sendMail(mailer.quoteEmail(quote));
    if (!result.sent) return res.status(500).json({ error: "Échec de l'envoi : " + result.reason });
    db.get('quotes').find({ id }).assign({ status: 'sent', sent_at: now() }).write();
    logTeamAction(req, 'quote_sent', `Devis #${id} envoyé par email à ${quote.clientEmail}`, id);
    res.json({ ok: true });
});

/* ============================================================
   PARAMÈTRES ENTREPRISE — utilisés sur les factures officielles
   ============================================================ */
app.get('/api/business-settings', auth, (req, res) => {
    res.json(db.get('businessSettings').value());
});

app.put('/api/business-settings', auth, adminOnly, (req, res) => {
    db.set('businessSettings', req.body || {}).write();
    logTeamAction(req, 'business_settings_updated', 'Paramètres entreprise modifiés');
    res.json({ ok: true });
});

/* ============================================================
   FACTURES OFFICIELLES — numérotation séquentielle légale
   ============================================================ */
function nextInvoiceNumber() {
    const year = new Date().getFullYear();
    const invoices = db.get('invoices').value();
    const countThisYear = invoices.filter(i => (i.invoiceNumber || '').startsWith(`FA-${year}-`)).length;
    return `FA-${year}-${String(countThisYear + 1).padStart(3, '0')}`;
}

app.get('/api/invoices', auth, (req, res) => {
    res.json([...db.get('invoices').value()].reverse());
});

app.post('/api/invoices', auth, adminOnly, (req, res) => {
    const { clientName, clientEmail, clientAddress, items, notes, quoteId } = req.body || {};
    if (!clientEmail) return res.status(400).json({ error: 'clientEmail requis' });
    const invoice = {
        id: nextId('invoices'), created_at: now(), invoiceNumber: nextInvoiceNumber(),
        quoteId: quoteId || null,
        clientName: clientName || '', clientEmail, clientAddress: clientAddress || '',
        items: Array.isArray(items) ? items : [],
        notes: notes || '', status: 'draft', issue_date: now(), sent_at: null, paid_at: null,
    };
    invoice.total = computeQuoteTotal(invoice.items);
    db.get('invoices').push(invoice).write();
    res.status(201).json(invoice);
});

// Convertir un devis existant en facture officielle
app.post('/api/quotes/:id/convert-to-invoice', auth, adminOnly, (req, res) => {
    const quote = db.get('quotes').find({ id: Number(req.params.id) }).value();
    if (!quote) return res.status(404).json({ error: 'Devis introuvable' });
    const invoice = {
        id: nextId('invoices'), created_at: now(), invoiceNumber: nextInvoiceNumber(),
        quoteId: quote.id,
        clientName: quote.clientName, clientEmail: quote.clientEmail, clientAddress: '',
        items: quote.items, total: quote.total,
        notes: quote.notes || '', status: 'draft', issue_date: now(), sent_at: null, paid_at: null,
    };
    db.get('invoices').push(invoice).write();
    logTeamAction(req, 'invoice_created', `Facture ${invoice.invoiceNumber} créée depuis devis #${quote.id} (${quote.clientEmail})`, invoice.id);
    res.status(201).json(invoice);
});

app.patch('/api/invoices/:id', auth, adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const inv = db.get('invoices').find({ id });
    if (!inv.value()) return res.status(404).json({ error: 'Facture introuvable' });
    const prev = inv.value();
    const { clientName, clientEmail, clientAddress, items, notes, status } = req.body || {};
    const patch = {};
    if (clientName !== undefined) patch.clientName = clientName;
    if (clientEmail !== undefined) patch.clientEmail = clientEmail;
    if (clientAddress !== undefined) patch.clientAddress = clientAddress;
    if (notes !== undefined) patch.notes = notes;
    if (status !== undefined) {
        patch.status = status;
        if (status === 'paid') patch.paid_at = now();
    }
    if (items !== undefined) { patch.items = items; patch.total = computeQuoteTotal(items); }
    inv.assign(patch).write();
    if (status && status !== prev.status)
        logTeamAction(req, 'invoice_status_changed', `Facture ${prev.invoiceNumber} : ${prev.status} → ${status}`, id);
    res.json({ ok: true });
});

app.delete('/api/invoices/:id', auth, adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const inv = db.get('invoices').find({ id }).value();
    logTeamAction(req, 'invoice_deleted', `Facture ${inv?.invoiceNumber || '#' + id} supprimée`, id);
    db.get('invoices').remove({ id }).write();
    res.json({ ok: true });
});

app.get('/api/invoices/:id/view', auth, (req, res) => {
    const invoice = db.get('invoices').find({ id: Number(req.params.id) }).value();
    if (!invoice) return res.status(404).send('Facture introuvable');
    const business = db.get('businessSettings').value();
    res.set('Content-Type', 'text/html');
    res.send(mailer.invoiceHtmlPage(invoice, business));
});

app.post('/api/invoices/:id/send', auth, adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    const invoice = db.get('invoices').find({ id }).value();
    if (!invoice) return res.status(404).json({ error: 'Facture introuvable' });
    const business = db.get('businessSettings').value();
    const result = await mailer.sendMail(mailer.invoiceEmail(invoice, business));
    if (!result.sent) return res.status(500).json({ error: "Échec de l'envoi : " + result.reason });
    db.get('invoices').find({ id }).assign({ status: 'sent', sent_at: now() }).write();
    logTeamAction(req, 'invoice_sent', `Facture ${invoice.invoiceNumber} envoyée à ${invoice.clientEmail}`, id);
    res.json({ ok: true });
});

/* ============================================================
   SUIVI DE PROJET CLIENT (post-vente)
   ============================================================ */
const PROJECT_STAGES = ['brief', 'maquettes', 'revisions', 'livre'];

app.get('/api/projects', auth, (req, res) => {
    res.json([...db.get('projects').value()].reverse());
});

app.post('/api/projects', auth, adminOnly, (req, res) => {
    const { name, clientEmail, leadId, stage } = req.body || {};
    if (!name || !clientEmail) return res.status(400).json({ error: 'name et clientEmail requis' });
    const project = {
        id: nextId('projects'), created_at: now(), leadId: leadId || null,
        name, clientEmail, stage: PROJECT_STAGES.includes(stage) ? stage : 'brief', notes: '',
    };
    db.get('projects').push(project).write();
    res.status(201).json(project);
});

app.patch('/api/projects/:id', auth, adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const p = db.get('projects').find({ id });
    if (!p.value()) return res.status(404).json({ error: 'Projet introuvable' });
    const { name, clientEmail, stage, notes } = req.body || {};
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (clientEmail !== undefined) patch.clientEmail = clientEmail;
    if (notes !== undefined) patch.notes = notes;
    if (stage !== undefined && PROJECT_STAGES.includes(stage)) patch.stage = stage;
    p.assign(patch).write();
    res.json({ ok: true });
});

app.delete('/api/projects/:id', auth, adminOnly, (req, res) => {
    db.get('projects').remove({ id: Number(req.params.id) }).write();
    res.json({ ok: true });
});

/* ============================================================
   CALENDRIER DE CONTENU (Instagram etc.)
   ============================================================ */
app.get('/api/content-calendar', auth, (req, res) => {
    res.json([...db.get('contentCalendar').value()].sort((a, b) => (a.date || '').localeCompare(b.date || '')));
});

app.post('/api/content-calendar', auth, canWrite, (req, res) => {
    const { title, date, caption, status } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title requis' });
    const item = {
        id: nextId('contentCalendar'), created_at: now(),
        title, date: date || null, caption: caption || '', status: status || 'idea',
    };
    db.get('contentCalendar').push(item).write();
    res.status(201).json(item);
});

app.patch('/api/content-calendar/:id', auth, canWrite, (req, res) => {
    const id = Number(req.params.id);
    const item = db.get('contentCalendar').find({ id });
    if (!item.value()) return res.status(404).json({ error: 'Introuvable' });
    const { title, date, caption, status } = req.body || {};
    const patch = {};
    if (title !== undefined) patch.title = title;
    if (date !== undefined) patch.date = date;
    if (caption !== undefined) patch.caption = caption;
    if (status !== undefined) patch.status = status;
    item.assign(patch).write();
    res.json({ ok: true });
});

app.delete('/api/content-calendar/:id', auth, canWrite, (req, res) => {
    db.get('contentCalendar').remove({ id: Number(req.params.id) }).write();
    res.json({ ok: true });
});

/* ============================================================
   LOGS ÉQUIPE — journal d'activité (admin uniquement)
   ============================================================ */
// Journal global toutes actions confondues
app.get('/api/admin/team-logs', auth, adminOnly, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const userId = req.query.userId ? Number(req.query.userId) : null;
    let logs = db.get('teamLogs').value();
    if (userId) logs = logs.filter(l => l.userId === userId);
    res.json(logs.slice(-limit).reverse());
});

// Sessions actives : membres vus dans les 10 dernières minutes
app.get('/api/admin/active-sessions', auth, adminOnly, (req, res) => {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const active = db.get('users').value()
        .filter(u => u.status === 'active' && u.lastSeenAt && u.lastSeenAt >= cutoff)
        .map(u => ({
            id: u.id, email: u.email, name: u.name, role: u.role,
            lastSeenAt: u.lastSeenAt, lastIp: u.lastIp || null,
            ua: u.lastUa ? parseUA(u.lastUa) : null,
        }));
    res.json(active);
});

/* ============================================================
   SAUVEGARDE — export complet des données en un clic
   ============================================================ */
app.get('/api/admin/backup', auth, adminOnly, (req, res) => {
    const data = db.getState();
    const filename = `florianb-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.set('Content-Type', 'application/json');
    res.send(JSON.stringify(data, null, 2));
});

/* ============================================================
   RAPPORT MENSUEL — génération à la demande + envoi programmé
   ============================================================ */
async function buildAndSendMonthlyReport() {
    const leads = db.get('leads').value();
    const quotes = db.get('quotes').value();
    const now30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const newLeads = leads.filter(l => l.created_at >= now30).length;
    const wonLeads = leads.filter(l => l.status === 'won' && l.created_at >= now30).length;
    const revenue = quotes.filter(q => q.status === 'paid' && q.paid_at >= now30).reduce((s, q) => s + (q.total || 0), 0);

    let gaSummary = null;
    try { gaSummary = analytics.isConfigured() ? await analytics.getOverview(30) : null; } catch { gaSummary = null; }

    const result = await mailer.sendMail(mailer.monthlyReportEmail({
        newLeads, wonLeads, revenue,
        visitors: gaSummary?.configured ? gaSummary.totals.activeUsers : null,
    }));
    return result;
}

app.post('/api/admin/send-report', auth, adminOnly, async (req, res) => {
    const result = await buildAndSendMonthlyReport();
    if (!result.sent) return res.status(500).json({ error: "Échec de l'envoi : " + result.reason });
    res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// Rapport mensuel automatique — le 1er de chaque mois à 8h (heure de Paris)
cron.schedule('0 8 1 * *', () => {
    console.log('📊 Envoi du rapport mensuel automatique...');
    buildAndSendMonthlyReport().catch(err => console.error('Erreur rapport mensuel:', err.message));
}, { timezone: 'Europe/Paris' });

// Vérification des alertes analytics — toutes les heures
cron.schedule('0 * * * *', () => {
    checkAnalyticsAlerts().catch(err => console.error('Erreur vérification alertes:', err.message));
}, { timezone: 'Europe/Paris' });

app.listen(PORT, () => console.log(`✅ Backend Florian B. sur http://localhost:${PORT}`));
