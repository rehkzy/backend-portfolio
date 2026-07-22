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
const pdfGen = require('./pdf');
const analytics = require('./analytics');
const push = require('./push');
const cron = require('node-cron');
const ftpPub = require('./ftp');
const publisher = require('./publisher');
push.init();

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// Même logique que pour la base de données : les images uploadées doivent
// vivre sur le Volume persistant, sinon elles disparaissent à chaque déploiement.
const UPLOADS_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'uploads')
    : path.join(__dirname, 'uploads');
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
    const result = await mailer.sendMail({ ...mailer.teamInviteEmail(user, inviteToken), meta: { type: 'team_invite', relatedId: user.id } });
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
    const result = await mailer.sendMail({ ...mailer.teamInviteEmail(user, inviteToken), meta: { type: 'team_invite_resend', relatedId: user.id } });
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
/* ============================================================
   NOTIFICATIONS PUSH — abonnement des appareils du dashboard
   ============================================================ */
app.get('/api/push/public-key', auth, (req, res) => {
    res.json({ publicKey: push.getPublicKey(), subscriptions: push.countSubscriptions() });
});

app.post('/api/push/subscribe', auth, (req, res) => {
    const ok = push.addSubscription(req.body || {}, req.user);
    if (!ok) return res.status(400).json({ error: 'Abonnement invalide' });
    logTeamAction(req, 'push_subscribed', 'Notifications push activées sur un appareil');
    res.json({ ok: true, subscriptions: push.countSubscriptions() });
});

app.post('/api/push/unsubscribe', auth, (req, res) => {
    push.removeSubscription((req.body || {}).endpoint);
    res.json({ ok: true, subscriptions: push.countSubscriptions() });
});

app.post('/api/push/test', auth, async (req, res) => {
    const result = await push.notifyAll({
        title: '🔔 Test réussi !',
        body: 'Les notifications push du dashboard fonctionnent sur cet appareil.',
        tag: 'test',
    });
    res.json(result);
});

/* ============================================================
   JOURS FÉRIÉS FRANÇAIS — calculés automatiquement chaque année
   (fêtes fixes + fêtes mobiles basées sur Pâques, algorithme de Meeus)
   ============================================================ */
function easterDate(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
}

function frenchHolidays(year) {
    const iso = (d) => d.toISOString().slice(0, 10);
    const plus = (d, days) => new Date(d.getTime() + days * 86400000);
    const easter = easterDate(year);
    return [
        { date: `${year}-01-01`, name: "Jour de l'an" },
        { date: iso(plus(easter, 1)),  name: 'Lundi de Pâques' },
        { date: `${year}-05-01`, name: 'Fête du Travail' },
        { date: `${year}-05-08`, name: 'Victoire 1945' },
        { date: iso(plus(easter, 39)), name: 'Ascension' },
        { date: iso(plus(easter, 50)), name: 'Lundi de Pentecôte' },
        { date: `${year}-07-14`, name: 'Fête nationale' },
        { date: `${year}-08-15`, name: 'Assomption' },
        { date: `${year}-11-01`, name: 'Toussaint' },
        { date: `${year}-11-11`, name: 'Armistice 1918' },
        { date: `${year}-12-25`, name: 'Noël' },
    ].sort((a, b) => a.date.localeCompare(b.date));
}

app.get('/api/holidays', auth, (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    // Année demandée + la suivante, pour couvrir la fin d'année sans requête supplémentaire
    res.json([...frenchHolidays(year), ...frenchHolidays(year + 1)]);
});

/* ============================================================
   CONTEXTE LOCAL D'UN VISITEUR — météo + heure locale
   Météo via open-meteo.com (gratuit, sans clé API)
   ============================================================ */
const WEATHER_CODES = {
    0: '☀️ Ciel dégagé', 1: '🌤️ Plutôt dégagé', 2: '⛅ Partiellement nuageux', 3: '☁️ Couvert',
    45: '🌫️ Brouillard', 48: '🌫️ Brouillard givrant',
    51: '🌦️ Bruine légère', 53: '🌦️ Bruine', 55: '🌧️ Bruine dense',
    61: '🌧️ Pluie légère', 63: '🌧️ Pluie', 65: '🌧️ Pluie forte',
    66: '🌧️ Pluie verglaçante', 67: '🌧️ Pluie verglaçante forte',
    71: '🌨️ Neige légère', 73: '🌨️ Neige', 75: '❄️ Neige forte', 77: '❄️ Grésil',
    80: '🌦️ Averses légères', 81: '🌧️ Averses', 82: '⛈️ Averses violentes',
    85: '🌨️ Averses de neige', 86: '🌨️ Fortes averses de neige',
    95: '⛈️ Orage', 96: '⛈️ Orage avec grêle', 99: '⛈️ Orage violent avec grêle',
};

app.get('/api/local-context', auth, async (req, res) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    const tz = req.query.tz || null;
    const out = { weather: null, localTime: null, timezone: tz };

    // Heure locale du visiteur, calculée depuis son fuseau
    if (tz) {
        try {
            out.localTime = new Intl.DateTimeFormat('fr-FR', {
                timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit',
            }).format(new Date());
        } catch { /* fuseau invalide — on ignore */ }
    }

    // Météo actuelle à sa position
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        try {
            const ctrl = new AbortController();
            const tid = setTimeout(() => ctrl.abort(), 5000);
            const r = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`,
                { signal: ctrl.signal }
            ).finally(() => clearTimeout(tid));
            if (r.ok) {
                const d = await r.json();
                const cw = d.current_weather;
                if (cw) {
                    out.weather = {
                        temperature: Math.round(cw.temperature),
                        label: WEATHER_CODES[cw.weathercode] || '🌡️ Météo',
                        windspeed: Math.round(cw.windspeed),
                    };
                }
            }
        } catch { /* météo indisponible — pas bloquant */ }
    }
    res.json(out);
});

/* ============================================================
   VISITEURS EN DIRECT — carte précise, IP, appareil, durée...
   Une session est considérée "en ligne" si un heartbeat est arrivé
   il y a moins de 45s (le tracker en envoie un toutes les 15s).
   ============================================================ */
const LIVE_ONLINE_WINDOW_MS = 45 * 1000;
const LIVE_SESSION_KEEP_MS = 30 * 60 * 1000; // on garde 30 min l'historique "récemment parti"

app.get('/api/live-visitors', auth, (req, res) => {
    const nowMs = Date.now();
    const all = db.get('liveSessions').value();

    // Purge des sessions trop vieilles pour ne pas faire grossir le fichier
    const kept = all.filter(s => nowMs - new Date(s.lastSeenAt).getTime() < LIVE_SESSION_KEEP_MS);
    if (kept.length !== all.length) db.set('liveSessions', kept).write();

    const enriched = kept.map(s => {
        const lastSeenMs = new Date(s.lastSeenAt).getTime();
        const online = (nowMs - lastSeenMs) < LIVE_ONLINE_WINDOW_MS;
        // Petit décalage déterministe (basé sur l'IP) pour éviter que plusieurs
        // visiteurs de la même ville se superposent exactement sur la carte
        let jitterLat = 0, jitterLon = 0;
        if (s.geo && s.geo.lat != null) {
            const h = crypto.createHash('md5').update(s.sessionId).digest();
            jitterLat = ((h[0] / 255) - 0.5) * 0.06;
            jitterLon = ((h[1] / 255) - 0.5) * 0.06;
        }
        return {
            ...s,
            online,
            secondsSinceSeen: Math.round((nowMs - lastSeenMs) / 1000),
            mapLat: s.geo && s.geo.lat != null ? s.geo.lat + jitterLat : null,
            mapLon: s.geo && s.geo.lon != null ? s.geo.lon + jitterLon : null,
        };
    }).sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));

    res.json({
        online: enriched.filter(s => s.online).length,
        sessions: enriched,
    });
});

app.post('/api/leads', async (req, res) => {
    const { name, email, message, source, budget } = req.body || {};
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
        abVariant:  ['A', 'B'].includes(req.body.abVariant) ? req.body.abVariant : null,
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
        source: source || 'chat', status: 'new', notes: '', budget: budget || null,
        isReturningClient: isReturningClient(email),
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
        mailer.sendMail({ ...mailer.leadConfirmationEmail(lead), meta: { type: 'lead_confirmation', relatedId: lead.id } }).catch(() => {});
        mailer.sendMail({ ...mailer.leadNotificationEmail(lead), meta: { type: 'lead_notification', relatedId: lead.id } }).catch(() => {});
        push.notifyAll({
            title: '🎯 Nouveau lead !',
            body: `${lead.name || lead.email}${lead.tracking.geo?.city ? ' · ' + lead.tracking.geo.city : ''} — ${(lead.message || '').slice(0, 90)}`,
            tag: 'lead-' + lead.id,
            // Bouton directement dans la notification : envoie l'accusé de réception
            // sans même ouvrir le dashboard (jeton signé à usage unique dans l'URL)
            actions: [{ action: 'ack', title: "✉️ Accusé de réception", url: (process.env.DASHBOARD_URL || '') + '/api/push-action?type=lead-ack&id=' + lead.id + '&token=' + pushActionToken('lead-ack', lead.id) }],
        }).catch(() => {});
    })();
});

// Statut public de prise de RDV — consulté par le chat du site avant de proposer le calendrier
app.get('/api/appointments-status', (req, res) => {
    const b = db.get('businessSettings').value() || {};
    res.set('Cache-Control', 'no-store');
    res.json({
        paused: Boolean(b.appointmentsPaused),
        reason: b.appointmentsPauseReason || '',
        message: b.appointmentsPauseMessage || '',
    });
});

// Pilotage rapide de la pause RDV depuis le dashboard
app.put('/api/admin/appointments-pause', auth, canWrite, (req, res) => {
    const { paused, reason, message } = req.body || {};
    db.get('businessSettings').assign({
        appointmentsPaused: Boolean(paused),
        appointmentsPauseReason: reason || '',
        appointmentsPauseMessage: message || '',
    }).write();
    logTeamAction(req, 'appointments_pause_toggled', paused ? `RDV mis en pause (${reason || 'raison non précisée'})` : 'RDV réactivés');
    res.json({ ok: true });
});

app.post('/api/appointments', async (req, res) => {
    const { date_text, time_text, subject, email } = req.body || {};
    if (!email || !subject) return res.status(400).json({ error: 'email et subject requis' });

    const business = db.get('businessSettings').value() || {};
    if (business.appointmentsPaused) {
        return res.status(423).json({
            error: 'appointments_paused',
            message: business.appointmentsPauseMessage || "La prise de rendez-vous est temporairement suspendue.",
        });
    }

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
        mailer.sendMail({ ...mailer.appointmentConfirmationEmail(appt), meta: { type: 'appointment_confirmation', relatedId: appt.id } }).catch(() => {});
        mailer.sendMail({ ...mailer.appointmentNotificationEmail(appt), meta: { type: 'appointment_notification', relatedId: appt.id } }).catch(() => {});
        push.notifyAll({
            title: '📅 Nouvelle demande de RDV !',
            body: `${appt.email} — ${appt.subject}${appt.date_text ? ' (' + appt.date_text + ')' : ''}`,
            tag: 'appt-' + appt.id,
        }).catch(() => {});
    })();
});

// Suivi d'activité — appelé par le site pour toute action utilisateur (formulaires,
// consultation de projet, ouverture du chat, FAQ, téléchargements, etc.)
// Format envoyé par le site : { event, sessionId, path, referrer, timestamp, ...données propres à l'événement }
// Reste compatible avec l'ancien format { type, meta } utilisé par le code existant.
app.post('/api/events', async (req, res) => {
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

    // Mise à jour de la session en direct (carte "Visiteurs en direct") — seulement
    // pour les événements de suivi de navigation (page_view / heartbeat) porteurs de sessionId
    if ((type === 'page_view' || type === 'heartbeat') && body.sessionId) {
        const ip = getRealIp(req);
        const ua = req.headers['user-agent'] || null;
        const sessions = db.get('liveSessions');
        const existing = sessions.find({ sessionId: body.sessionId }).value();
        const uaParsed = parseUA(ua);
        const patch = {
            sessionId: body.sessionId,
            ip,
            ...uaParsed,
            lang: body.lang || (existing && existing.lang) || null,
            timezone: body.timezone || (existing && existing.timezone) || null,
            screen: body.screen || (existing && existing.screen) || null,
            connection: body.connection || (existing && existing.connection) || null,
            referrer: body.referrer || (existing && existing.referrer) || null,
            utmSource: body.utmSource || (existing && existing.utmSource) || null,
            utmMedium: body.utmMedium || (existing && existing.utmMedium) || null,
            utmCampaign: body.utmCampaign || (existing && existing.utmCampaign) || null,
            currentPath: body.path || null,
            pagesVisited: body.pagesVisited || (existing && existing.pagesVisited) || null,
            visitDuration: body.visitDuration != null ? body.visitDuration : (existing && existing.visitDuration) || 0,
            lastSeenAt: now(),
            firstSeenAt: (existing && existing.firstSeenAt) || now(),
            geo: (existing && existing.geo) || null,
        };
        if (existing) sessions.find({ sessionId: body.sessionId }).assign(patch).write();
        else sessions.push(patch).write();

        // Géolocalisation IP une seule fois par session (pas à chaque heartbeat, pour
        // rester sous la limite gratuite de 45 requêtes/min du service de géoloc)
        if (!patch.geo) {
            geolocateIp(ip).then((geo) => {
                if (geo) db.get('liveSessions').find({ sessionId: body.sessionId }).assign({ geo }).write();
            }).catch(() => {});
        }
    }
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
   FUNNEL DE CONVERSION — où les visiteurs abandonnent, sur 30 jours
   ============================================================ */
app.get('/api/analytics/funnel', auth, (req, res) => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const events = db.get('events').value().filter(e => e.created_at >= since);
    const leads = db.get('leads').value().filter(l => l.created_at >= since);
    const appointments = db.get('appointments').value().filter(a => a.created_at >= since);
    const chatOpened = new Set(events.filter(e => e.type === 'chat_opened').map(e => e.sessionId)).size;
    const rdvFlowStarted = new Set(events.filter(e => e.type === 'rdv_flow_started' || e.type === 'contact_flow_started').map(e => e.sessionId)).size;
    res.json({
        steps: [
            { label: 'Chat ouvert', count: chatOpened },
            { label: 'Formulaire démarré', count: rdvFlowStarted || (leads.length + appointments.length) },
            { label: 'Message envoyé', count: leads.length },
            { label: 'RDV demandé', count: appointments.length },
        ],
    });
});

/* ============================================================
   QUALITÉ DES LEADS PAR SOURCE — pour savoir où investir ton temps
   ============================================================ */
app.get('/api/analytics/leads-quality', auth, (req, res) => {
    const leads = db.get('leads').value();
    const bySource = {};
    leads.forEach(l => {
        const src = l.source || 'inconnu';
        if (!bySource[src]) bySource[src] = { source: src, count: 0, won: 0, budgetScores: [] };
        bySource[src].count++;
        if (l.status === 'won') bySource[src].won++;
        if (l.budget && BUDGET_SCORES[l.budget] !== undefined) bySource[src].budgetScores.push(BUDGET_SCORES[l.budget]);
    });
    const result = Object.values(bySource).map(s => ({
        source: s.source, count: s.count,
        conversionRate: s.count ? Math.round((s.won / s.count) * 100) : 0,
        avgBudgetScore: s.budgetScores.length ? Math.round(s.budgetScores.reduce((a, b) => a + b, 0) / s.budgetScores.length) : null,
    })).sort((a, b) => b.count - a.count);
    res.json(result);
});

/* ============================================================
   DONNÉES PROTÉGÉES — dashboard admin
   ============================================================ */
/* ============================================================
   COCKPIT — vue "Aujourd'hui" : tout ce qui demande une action,
   + timeline unifiée des 14 prochains jours (devis/RDV/projets/contenu)
   ============================================================ */
app.get('/api/cockpit', auth, (req, res) => {
    const todayStr = now().slice(0, 10);
    const in14days = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    const leads = db.get('leads').value();
    const appointments = db.get('appointments').value();
    const projects = db.get('projects').value();
    const contentCalendar = db.get('contentCalendar').value();
    const { quotesToRemind, invoicesOverdue } = getSuggestedReminders();

    const newLeadsToProcess = leads.filter(l => l.status === 'new');
    const apptsToday = appointments.filter(a => a.confirmedDate && a.confirmedDate.slice(0, 10) === todayStr);
    const activeProjects = projects.filter(p => p.stage !== 'livre');

    // Timeline unifiée : RDV confirmés + posts programmés + devis à relancer, sur 14 jours
    const timeline = [
        ...appointments.filter(a => a.confirmedDate && a.confirmedDate.slice(0, 10) >= todayStr && a.confirmedDate.slice(0, 10) <= in14days)
            .map(a => ({ date: a.confirmedDate.slice(0, 10), type: 'appointment', label: `RDV — ${a.subject}`, ref: a.id })),
        ...contentCalendar.filter(c => c.date && c.date >= todayStr && c.date <= in14days && c.status !== 'posted')
            .map(c => ({ date: c.date, type: 'content', label: `Post ${c.platform || ''} — ${c.title}`, ref: c.id })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    res.json({
        newLeadsToProcess: newLeadsToProcess.length,
        apptsToday: apptsToday.map(a => ({ id: a.id, subject: a.subject, email: a.email, confirmedDate: a.confirmedDate })),
        quotesToRemindCount: quotesToRemind.length,
        invoicesOverdueCount: invoicesOverdue.length,
        activeProjectsCount: activeProjects.length,
        timeline,
    });
});


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
    const { status, q, includeArchived } = req.query;
    let leads = db.get('leads').value();
    if (!includeArchived) leads = leads.filter(l => !l.archived);
    if (status) leads = leads.filter(l => l.status === status);
    if (q) { const lq = q.toLowerCase(); leads = leads.filter(l => [l.name, l.email, l.message].some(f => f && f.toLowerCase().includes(lq))); }
    leads = leads.map(l => {
        const priorityScore = computeLeadPriorityScore(l);
        return { ...l, priorityScore, temperature: leadTemperature(priorityScore) };
    });
    res.json(leads.reverse());
});

app.patch('/api/leads/:id', auth, canWrite, (req, res) => {
    const id = Number(req.params.id);
    const { status, notes } = req.body || {};
    const lead = db.get('leads').find({ id });
    if (!lead.value()) return res.status(404).json({ error: 'Lead introuvable' });
    const prev = lead.value();
    if (status) {
        const patch = { status };
        if (status === 'contacted' && !prev.contactedAt) patch.contactedAt = now();
        lead.assign(patch).write();
    }
    if (notes !== undefined) lead.assign({ notes }).write();
    if (status && status !== prev.status)
        logTeamAction(req, 'lead_status_changed', `Lead #${id} (${prev.email}) : ${prev.status} → ${status}`, id);
    if (notes !== undefined)
        logTeamAction(req, 'lead_note_edited', `Lead #${id} (${prev.email})`, id);

    // Lead passé en "Gagné" : on prépare un devis brouillon pour gagner du temps — jamais envoyé
    // au client automatiquement, juste prêt à être complété et vérifié dans "Devis".
    if (status === 'won' && prev.status !== 'won') {
        const existingQuote = db.get('quotes').find({ leadId: id }).value();
        if (!existingQuote) {
            const validityDays = Number(db.get('businessSettings').value()?.quoteValidityDays) || 30;
            const budgetGuess = { '> 6000€': 6000, '3000-6000€': 4500, '1000-3000€': 2000, '< 1000€': 800 }[prev.budget] || 0;
            const quote = {
                id: nextId('quotes'), created_at: now(), leadId: id,
                quoteNumber: nextQuoteNumber(),
                validUntil: new Date(Date.now() + validityDays * 86400000).toISOString(),
                clientName: prev.name || '', clientEmail: prev.email,
                items: budgetGuess ? [{ desc: 'Prestation à détailler', qty: 1, price: budgetGuess }] : [],
                notes: `Devis brouillon généré automatiquement depuis le lead #${id} — à compléter avant envoi.`,
                status: 'draft', sent_at: null, paid_at: null, accepted_at: null,
            };
            quote.total = computeQuoteTotal(quote.items);
            db.get('quotes').push(quote).write();
            touchClient(prev.email, prev.name);
            logTeamAction(req, 'quote_created', `Devis brouillon ${quote.quoteNumber} pré-rempli automatiquement depuis le lead #${id} (${prev.email})`, quote.id);
            mailer.sendMail({ ...mailer.quoteDraftReadyEmail(quote, prev), meta: { type: 'quote_draft_ready', relatedId: quote.id } }).catch(() => {});
        }
    }
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
        isReturningClient: isReturningClient(email),
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
    const result = await mailer.sendMail({ ...mailer.leadReplyEmail(lead, message), meta: { type: 'lead_reply', relatedId: lead.id } });
    if (!result.sent) return res.status(500).json({ error: "Échec de l'envoi : " + result.reason });
    db.get('leads').find({ id }).assign({ status: 'contacted', contactedAt: lead.contactedAt || now() }).write();
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
    const { status, notes, confirmedDate } = req.body || {};
    const appt = db.get('appointments').find({ id });
    if (!appt.value()) return res.status(404).json({ error: 'RDV introuvable' });
    if (status) appt.assign({ status }).write();
    if (notes !== undefined) appt.assign({ notes }).write();
    if (confirmedDate !== undefined) appt.assign({ confirmedDate }).write();
    res.json({ ok: true });
});

app.delete('/api/appointments/:id', auth, canWrite, (req, res) => {
    db.get('appointments').remove({ id: Number(req.params.id) }).write();
    res.json({ ok: true });
});

/* ============================================================
   SYNCHRONISATION CALENDRIER — flux .ics abonnable (Google Agenda,
   Apple Calendar...) avec tous les RDV confirmés à venir.
   Protégé par un token dérivé de JWT_SECRET (pas de login requis,
   pour permettre à l'appli calendrier de le récupérer périodiquement).
   ============================================================ */
function calendarFeedToken() {
    return crypto.createHmac('sha256', JWT_SECRET).update('calendar-feed').digest('hex').slice(0, 32);
}

function icsEscape(str) { return String(str || '').replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n'); }
function icsDate(iso) { return new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'; }

app.get('/api/appointments/calendar.ics', (req, res) => {
    if (req.query.token !== calendarFeedToken()) return res.status(403).send('Token invalide');
    const appts = db.get('appointments').value().filter(a => a.status === 'confirmed' && a.confirmedDate);
    const events = appts.map(a => {
        const start = new Date(a.confirmedDate);
        const end = new Date(start.getTime() + 3600000);
        return [
            'BEGIN:VEVENT',
            `UID:appt-${a.id}@florian-b.fr`,
            `DTSTAMP:${icsDate(now())}`,
            `DTSTART:${icsDate(start.toISOString())}`,
            `DTEND:${icsDate(end.toISOString())}`,
            `SUMMARY:${icsEscape('RDV — ' + (a.subject || ''))}`,
            `DESCRIPTION:${icsEscape('Contact : ' + a.email)}`,
            'END:VEVENT',
        ].join('\r\n');
    });
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Florian B.//Dashboard//FR', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="rdv-florian-b.ics"');
    res.send(ics);
});

app.get('/api/appointments/calendar-feed-url', auth, (req, res) => {
    const base = process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${base}/api/appointments/calendar.ics?token=${calendarFeedToken()}` });
});

/* ---- Fiche client unifiée : normalisation + création à la volée ---- */
function clientKey(email) { return (email || '').trim().toLowerCase(); }

// Un client a-t-il déjà une trace avant cette date (autre lead, devis, facture) ?
// Sert à repérer les clients récurrents dès la réception d'un nouveau lead.
function isReturningClient(email, beforeDate = now()) {
    const key = clientKey(email);
    if (!key) return false;
    const inLeads = db.get('leads').value().some(l => clientKey(l.email) === key && l.created_at < beforeDate);
    const inQuotes = db.get('quotes').value().some(q => clientKey(q.clientEmail) === key && q.created_at < beforeDate);
    const inInvoices = db.get('invoices').value().some(i => clientKey(i.clientEmail) === key && i.created_at < beforeDate);
    return inLeads || inQuotes || inInvoices;
}

// Score de priorité d'un lead (0-100) — aide à savoir lequel traiter en premier.
// Facteurs : budget indiqué, fraîcheur, client déjà connu.
const BUDGET_SCORES = { '> 6000€': 40, '3000-6000€': 32, '1000-3000€': 22, '< 1000€': 10, 'non précisé': 15 };
function computeLeadPriorityScore(lead) {
    let score = 30; // base
    score += BUDGET_SCORES[lead.budget] ?? 15;
    const hoursOld = (Date.now() - new Date(lead.created_at)) / 3600000;
    if (hoursOld < 24) score += 20;
    else if (hoursOld < 72) score += 10;
    if (lead.isReturningClient) score += 15;
    if (lead.status === 'new') score += 5;
    // Signaux d'engagement déjà captés à la création du lead (voir `tracking` dans POST /api/leads)
    const t = lead.tracking || {};
    const pagesVisited = Number(t.pagesVisited) || 0;
    const visitDuration = Number(t.visitDuration) || 0; // secondes
    if (pagesVisited >= 3) score += 10;
    else if (pagesVisited >= 2) score += 5;
    if (visitDuration >= 120) score += 5;
    // Un lead "Nouveau" qui traîne sans être contacté refroidit avec le temps
    const followUpDays = Number(db.get('businessSettings').value()?.leadFollowUpDays) || 3;
    if (lead.status === 'new' && hoursOld > followUpDays * 24) score -= 15;
    return Math.max(0, Math.min(100, Math.round(score)));
}

// Traduction du score en repère simple pour Florian (dashboard) — chaud/tiède/froid
function leadTemperature(score) {
    if (score >= 65) return { key: 'hot', label: 'Chaud', emoji: '🔥', color: '#22c55e' };
    if (score >= 40) return { key: 'warm', label: 'Tiède', emoji: '🌤️', color: '#f59e0b' };
    return { key: 'cold', label: 'Froid', emoji: '❄️', color: '#888' };
}

function touchClient(email, name) {
    const key = clientKey(email);
    if (!key) return null;
    let client = db.get('clients').find({ email: key }).value();
    if (!client) {
        client = { email: key, name: name || '', tags: [], notes: '', created_at: now() };
        db.get('clients').push(client).write();
    } else if (name && !client.name) {
        db.get('clients').find({ email: key }).assign({ name }).write();
    }
    return client;
}

/* ============================================================
   FICHE CLIENT UNIFIÉE
   Regroupe leads / RDV / devis / factures / projets par email,
   avec tags et notes internes persistants.
   ============================================================ */
app.get('/api/clients', auth, (req, res) => {
    const leads = db.get('leads').value();
    const appointments = db.get('appointments').value();
    const quotes = db.get('quotes').value();
    const invoices = db.get('invoices').value();
    const projects = db.get('projects').value();
    const clientRecords = db.get('clients').value();

    const emails = new Set([
        ...leads.map(l => clientKey(l.email)),
        ...appointments.map(a => clientKey(a.email)),
        ...quotes.map(q => clientKey(q.clientEmail)),
        ...invoices.map(i => clientKey(i.clientEmail)),
        ...projects.map(p => clientKey(p.clientEmail)),
        ...clientRecords.map(c => clientKey(c.email)),
    ].filter(Boolean));

    const list = [...emails].map(email => {
        const record = clientRecords.find(c => c.email === email) || {};
        const myLeads = leads.filter(l => clientKey(l.email) === email);
        const myAppts = appointments.filter(a => clientKey(a.email) === email);
        const myQuotes = quotes.filter(q => clientKey(q.clientEmail) === email);
        const myInvoices = invoices.filter(i => clientKey(i.clientEmail) === email);
        const myProjects = projects.filter(p => clientKey(p.clientEmail) === email);
        const name = record.name || myLeads[0]?.name || myQuotes[0]?.clientName || myInvoices[0]?.clientName || '';
        const allDates = [
            ...myLeads.map(x => x.created_at), ...myAppts.map(x => x.created_at),
            ...myQuotes.map(x => x.created_at), ...myInvoices.map(x => x.created_at),
        ].filter(Boolean).sort();
        return {
            email, name,
            tags: record.tags || [], notes: record.notes || '',
            leadsCount: myLeads.length, appointmentsCount: myAppts.length,
            quotesCount: myQuotes.length, invoicesCount: myInvoices.length,
            projectsCount: myProjects.length,
            invoicedTotal: myInvoices.reduce((s, i) => s + (i.total || 0), 0),
            paidTotal: myInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0),
            lastActivity: allDates.length ? allDates[allDates.length - 1] : (record.created_at || null),
        };
    });
    list.sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || ''));
    res.json(list);
});

app.get('/api/clients/:email', auth, (req, res) => {
    const email = clientKey(req.params.email);
    const record = db.get('clients').find({ email }).value() || { email, tags: [], notes: '' };
    const leads = db.get('leads').value().filter(l => clientKey(l.email) === email);
    const appointments = db.get('appointments').value().filter(a => clientKey(a.email) === email);
    const quotes = db.get('quotes').value().filter(q => clientKey(q.clientEmail) === email);
    const invoices = db.get('invoices').value().filter(i => clientKey(i.clientEmail) === email);
    const projects = db.get('projects').value().filter(p => clientKey(p.clientEmail) === email);

    // Timeline chronologique unifiée (la plus récente en premier)
    const timeline = [
        ...leads.map(l => ({ type: 'lead', date: l.created_at, label: `Lead reçu (${l.source})`, ref: l })),
        ...appointments.map(a => ({ type: 'appointment', date: a.created_at, label: `RDV — ${a.subject}`, ref: a })),
        ...quotes.map(q => ({ type: 'quote', date: q.created_at, label: `Devis créé — ${(q.total||0).toFixed(2)} €`, ref: q })),
        ...invoices.map(i => ({ type: 'invoice', date: i.created_at, label: `Facture ${i.invoiceNumber} — ${(i.total||0).toFixed(2)} €`, ref: i })),
        ...projects.map(p => ({ type: 'project', date: p.created_at, label: `Projet — ${p.name} (${p.stage})`, ref: p })),
    ].filter(e => e.date).sort((a, b) => b.date.localeCompare(a.date));

    res.json({
        email: record.email, tags: record.tags || [], notes: record.notes || '',
        leads, appointments, quotes, invoices, projects, timeline,
    });
});

app.patch('/api/clients/:email', auth, canWrite, (req, res) => {
    const email = clientKey(req.params.email);
    if (!email) return res.status(400).json({ error: 'email requis' });
    const { tags, notes, name } = req.body || {};
    let client = db.get('clients').find({ email }).value();
    if (!client) { client = { email, name: name || '', tags: [], notes: '', created_at: now() }; db.get('clients').push(client).write(); }
    const patch = {};
    if (tags !== undefined) patch.tags = Array.isArray(tags) ? tags : [];
    if (notes !== undefined) patch.notes = notes;
    if (name !== undefined) patch.name = name;
    db.get('clients').find({ email }).assign(patch).write();
    logTeamAction(req, 'client_updated', `Fiche client mise à jour : ${email}`);
    res.json({ ok: true });
});

app.get('/api/clients/:email/portal-link', auth, (req, res) => {
    const email = clientKey(req.params.email);
    if (!email) return res.status(400).json({ error: 'email requis' });
    const base = process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${base}/portal?email=${encodeURIComponent(email)}&token=${clientPortalToken(email)}` });
});


/* ============================================================
   CONTENU DU SITE — theme builder
   GET /api/content : public, appelé par index.html au chargement
   PUT /api/admin/content : protégé, appelé par le dashboard
   ============================================================ */
app.get('/api/content', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const content = db.get('site_content').value();
    const clarityId = db.get('businessSettings').value()?.clarityId || null;
    res.json({ ...content, clarityId });
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

/* ============================================================
   BIBLIOTHÈQUE DE VISUELS — centralise les images uploadées
   ============================================================ */
function findUsedFilenames() {
    // Cherche toutes les occurrences de noms de fichiers dans le contenu du site
    // (hero, cartes projets, galeries) pour repérer les images encore utilisées.
    const content = JSON.stringify(db.get('site_content').value());
    return content;
}

app.get('/api/admin/uploads', auth, (req, res) => {
    const usedContent = findUsedFilenames();
    const files = fs.readdirSync(UPLOADS_DIR)
        .filter(f => f !== '.gitkeep' && !f.startsWith('.'))
        .map(f => {
            const stat = fs.statSync(path.join(UPLOADS_DIR, f));
            return {
                filename: f, url: `/uploads/${f}`,
                size: stat.size, uploadedAt: stat.birthtime || stat.mtime,
                inUse: usedContent.includes(f),
            };
        })
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    res.json(files);
});

app.delete('/api/admin/uploads/:filename', auth, canWrite, (req, res) => {
    const filename = path.basename(req.params.filename); // évite toute tentative de traversée de dossier
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });
    fs.unlinkSync(filePath);
    logTeamAction(req, 'upload_deleted', `Image supprimée : ${filename}`);
    res.json({ ok: true });
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

const seo = require('./seo');
app.get('/api/analytics/seo', auth, async (req, res) => {
    if (!seo.isConfigured()) return res.json({ configured: false });
    try {
        const days = Number(req.query.days) || 28;
        res.json(await seo.getSeoOverview(days));
    } catch (err) {
        console.error('Erreur Search Console:', err.message);
        res.status(500).json({ error: 'Erreur Search Console : ' + err.message });
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
                await mailer.sendMail({ ...mailer.analyticsAlertEmail(alert, value), meta: { type: 'analytics_alert', relatedId: alert.id } });
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

// Numérotation séquentielle des devis — même logique que les factures (traçabilité).
function nextQuoteNumber() {
    const year = new Date().getFullYear();
    const quotes = db.get('quotes').value();
    const countThisYear = quotes.filter(q => (q.quoteNumber || '').startsWith(`DE-${year}-`)).length;
    return `DE-${year}-${String(countThisYear + 1).padStart(3, '0')}`;
}

// Vérifie que les mentions obligatoires sont renseignées avant d'émettre un document officiel.
// Ceci reflète les obligations courantes pour un(e) indépendant(e) en France ; à faire valider
// par un comptable/juriste selon ta situation exacte.
function checkLegalReadiness(business) {
    const missing = [];
    if (!business.legalName) missing.push('Nom / raison sociale');
    if (!business.siret) missing.push('N° SIRET');
    if (!business.address) missing.push('Adresse');
    if (!business.vatMention) missing.push('Mention TVA');
    return missing;
}

// Token signé (non devinable) pour le lien "J'accepte ce devis" envoyé par email —
// pas besoin de compte client, le lien seul fait foi.
function quoteAcceptToken(id) {
    return crypto.createHmac('sha256', JWT_SECRET).update('quote-accept-' + id).digest('hex').slice(0, 32);
}

// Token signé pour le portail client — pas de compte à créer, le lien (email + token) fait foi.
function clientPortalToken(email) {
    return crypto.createHmac('sha256', JWT_SECRET).update('client-portal-' + clientKey(email)).digest('hex').slice(0, 32);
}

/* ============================================================
   PORTAIL CLIENT — page publique en lecture seule (devis, factures,
   avancement de projet) accessible via un lien signé, sans compte.
   ============================================================ */
app.get('/api/portal', (req, res) => {
    const email = clientKey(req.query.email);
    if (!email || req.query.token !== clientPortalToken(email)) return res.status(403).json({ error: 'Lien invalide' });
    const quotes = db.get('quotes').value().filter(q => clientKey(q.clientEmail) === email);
    const invoices = db.get('invoices').value().filter(i => clientKey(i.clientEmail) === email);
    const projects = db.get('projects').value().filter(p => clientKey(p.clientEmail) === email);
    res.json({
        email,
        quotes: quotes.map(q => ({ id: q.id, quoteNumber: q.quoteNumber, total: q.total, status: q.status, created_at: q.created_at })),
        invoices: invoices.map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, total: i.total, status: i.status, issue_date: i.issue_date, dueDate: i.dueDate })),
        projects: projects.map(p => ({ id: p.id, name: p.name, stage: p.stage, checklist: p.checklist || [] })),
    });
});

app.get('/portal', (req, res) => {
    res.set('Content-Type', 'text/html');
    res.send(mailer.clientPortalPage());
});

// Modèles de devis — pré-remplissage rapide par type de prestation
app.get('/api/quote-templates', auth, (req, res) => {
    res.json(db.get('quoteTemplates').value());
});

app.get('/api/quotes', auth, (req, res) => {
    res.json([...db.get('quotes').value()].reverse());
});

app.post('/api/quotes', auth, adminOnly, (req, res) => {
    const { clientName, clientEmail, items, notes, leadId } = req.body || {};
    if (!clientEmail) return res.status(400).json({ error: 'clientEmail requis' });
    const validityDays = Number(db.get('businessSettings').value()?.quoteValidityDays) || 30;
    const quote = {
        id: nextId('quotes'), created_at: now(), leadId: leadId || null,
        quoteNumber: nextQuoteNumber(),
        validUntil: new Date(Date.now() + validityDays * 86400000).toISOString(),
        clientName: clientName || '', clientEmail,
        items: Array.isArray(items) ? items : [],
        notes: notes || '', status: 'draft', sent_at: null, paid_at: null, accepted_at: null,
    };
    quote.total = computeQuoteTotal(quote.items);
    db.get('quotes').push(quote).write();
    touchClient(clientEmail, clientName);
    logTeamAction(req, 'quote_created', `Devis ${quote.quoteNumber} créé pour ${clientEmail} (${quote.total.toFixed(2)} €)`, quote.id);
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
    res.send(mailer.quoteHtmlPage(quote, db.get('businessSettings').value()));
});

// Envoi du devis par email au client
app.post('/api/quotes/:id/send', auth, adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    const quote = db.get('quotes').find({ id }).value();
    if (!quote) return res.status(404).json({ error: 'Devis introuvable' });
    const business = db.get('businessSettings').value() || {};
    const mail = mailer.quoteEmail(quote, quoteAcceptToken(id));
    // Pixel invisible : on saura quand (et combien de fois) le client ouvre le devis
    const pixelBase = process.env.DASHBOARD_URL || '';
    if (pixelBase) mail.html = mail.html.replace('</body>', `<img src="${pixelBase}/api/quotes/${id}/open.gif?token=${quoteAcceptToken(id)}" width="1" height="1" alt="" style="display:none;"></body>`);
    mail.meta = { type: 'quote_sent', relatedId: id };
    try {
        const pdfBuffer = await pdfGen.generateQuotePdf(quote, business);
        mail.attachments = [{ content: pdfBuffer.toString('base64'), name: `Devis-${quote.quoteNumber || quote.id}.pdf` }];
    } catch (err) { console.error('Erreur génération PDF devis:', err.message); }
    const result = await mailer.sendMail(mail);
    if (!result.sent) return res.status(500).json({ error: "Échec de l'envoi : " + result.reason });
    db.get('quotes').find({ id }).assign({ status: 'sent', sent_at: now() }).write();
    logTeamAction(req, 'quote_sent', `Devis #${id} envoyé par email à ${quote.clientEmail}`, id);
    res.json({ ok: true });
});

// Lien "J'accepte ce devis" cliqué depuis l'email client — pas d'authentification (le token
// signé en tient lieu), convertit automatiquement le devis en facture officielle.
app.get('/api/quotes/:id/accept', async (req, res) => {
    const id = Number(req.params.id);
    const token = req.query.token || '';
    const quote = db.get('quotes').find({ id }).value();
    const simplePage = (title, message, ok) => `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${title}</title>
        <style>body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:2rem;text-align:center;}
        .box{max-width:440px;}h1{color:${ok ? '#22c55e' : '#ff2f76'};font-size:1.3rem;}p{color:#aaa;line-height:1.6;}</style></head>
        <body><div class="box"><h1>${title}</h1><p>${message}</p></div></body></html>`;

    if (!quote) return res.status(404).send(simplePage('Devis introuvable', "Ce lien n'est plus valide.", false));
    if (token !== quoteAcceptToken(id)) return res.status(403).send(simplePage('Lien invalide', "Ce lien d'acceptation n'est pas valide.", false));
    if (quote.status === 'accepted' || quote.status === 'paid') {
        return res.send(simplePage('Déjà accepté', 'Ce devis a déjà été accepté — Florian a bien reçu la confirmation, aucune action supplémentaire nécessaire.', true));
    }

    const delayDays = Number(db.get('businessSettings').value()?.paymentDelayDays) || 30;
    const invoice = {
        id: nextId('invoices'), created_at: now(), invoiceNumber: nextInvoiceNumber(),
        quoteId: quote.id,
        clientName: quote.clientName, clientEmail: quote.clientEmail, clientAddress: '',
        items: quote.items, total: quote.total,
        notes: quote.notes || '', status: 'draft', issue_date: now(),
        dueDate: new Date(Date.now() + delayDays * 86400000).toISOString(),
        sent_at: null, paid_at: null, lastReminderAt: null,
    };
    db.get('invoices').push(invoice).write();
    db.get('quotes').find({ id }).assign({ status: 'accepted', accepted_at: now() }).write();
    touchClient(quote.clientEmail, quote.clientName);

    // Notifie Florian — la facture reste en brouillon, à lui de vérifier puis de l'envoyer
    mailer.sendMail({ ...mailer.quoteAcceptedEmail(quote, invoice), meta: { type: 'quote_accepted', relatedId: quote.id } }).catch(() => {});
    // Onboarding automatique : projet créé + questionnaire de brief envoyé au client
    try { onboardAfterQuoteAccepted(quote); } catch (err) { console.error('Onboarding auto:', err.message); }

    res.send(simplePage('Devis accepté ✅', `Merci ! Votre acceptation a bien été transmise à Florian. Il finalise votre facture (n°${invoice.invoiceNumber}) et revient vers vous rapidement.`, true));
});

/* ============================================================
   PARAMÈTRES ENTREPRISE — utilisés sur les factures officielles
   ============================================================ */
app.get('/api/business-settings', auth, (req, res) => {
    res.json(db.get('businessSettings').value());
});

app.put('/api/business-settings', auth, adminOnly, (req, res) => {
    // Fusion (pas remplacement complet) : la page "Mon entreprise" n'envoie qu'un
    // sous-ensemble de champs — un remplacement total effacerait silencieusement
    // les champs gérés ailleurs (pause RDV, Clarity...) à chaque enregistrement.
    db.get('businessSettings').assign(req.body || {}).write();
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
    let invoices = db.get('invoices').value();
    if (!req.query.includeArchived) invoices = invoices.filter(i => !i.archived);
    res.json([...invoices].reverse());
});

app.post('/api/invoices', auth, adminOnly, (req, res) => {
    const { clientName, clientEmail, clientAddress, items, notes, quoteId } = req.body || {};
    if (!clientEmail) return res.status(400).json({ error: 'clientEmail requis' });
    const delayDays = Number(db.get('businessSettings').value()?.paymentDelayDays) || 30;
    const invoice = {
        id: nextId('invoices'), created_at: now(), invoiceNumber: nextInvoiceNumber(),
        quoteId: quoteId || null,
        clientName: clientName || '', clientEmail, clientAddress: clientAddress || '',
        items: Array.isArray(items) ? items : [],
        notes: notes || '', status: 'draft', issue_date: now(),
        dueDate: new Date(Date.now() + delayDays * 86400000).toISOString(),
        sent_at: null, paid_at: null, lastReminderAt: null,
    };
    invoice.total = computeQuoteTotal(invoice.items);
    db.get('invoices').push(invoice).write();
    touchClient(clientEmail, clientName);
    res.status(201).json(invoice);
});

// Convertir un devis existant en facture officielle
app.post('/api/quotes/:id/convert-to-invoice', auth, adminOnly, (req, res) => {
    const quote = db.get('quotes').find({ id: Number(req.params.id) }).value();
    if (!quote) return res.status(404).json({ error: 'Devis introuvable' });
    const delayDays = Number(db.get('businessSettings').value()?.paymentDelayDays) || 30;
    const invoice = {
        id: nextId('invoices'), created_at: now(), invoiceNumber: nextInvoiceNumber(),
        quoteId: quote.id,
        clientName: quote.clientName, clientEmail: quote.clientEmail, clientAddress: '',
        items: quote.items, total: quote.total,
        notes: quote.notes || '', status: 'draft', issue_date: now(),
        dueDate: new Date(Date.now() + delayDays * 86400000).toISOString(),
        sent_at: null, paid_at: null, lastReminderAt: null,
    };
    db.get('invoices').push(invoice).write();
    touchClient(quote.clientEmail, quote.clientName);
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
    const business = db.get('businessSettings').value() || {};
    const missing = checkLegalReadiness(business);
    if (missing.length) {
        return res.status(400).json({ error: `Complète d'abord "Mon entreprise" avant d'envoyer une facture officielle — il manque : ${missing.join(', ')}.` });
    }
    const mail = mailer.invoiceEmail(invoice, business);
    mail.meta = { type: 'invoice_sent', relatedId: id };
    try {
        const pdfBuffer = await pdfGen.generateInvoicePdf(invoice, business);
        mail.attachments = [{ content: pdfBuffer.toString('base64'), name: `Facture-${invoice.invoiceNumber}.pdf` }];
    } catch (err) { console.error('Erreur génération PDF facture:', err.message); }
    const result = await mailer.sendMail(mail);
    if (!result.sent) return res.status(500).json({ error: "Échec de l'envoi : " + result.reason });
    db.get('invoices').find({ id }).assign({ status: 'sent', sent_at: now() }).write();
    logTeamAction(req, 'invoice_sent', `Facture ${invoice.invoiceNumber} envoyée à ${invoice.clientEmail}`, id);
    res.json({ ok: true });
});

/* ============================================================
   TRÉSORERIE — vue d'ensemble financière + relances
   ============================================================ */
const REMINDER_DELAY_DAYS = 5; // devis envoyé sans réponse depuis N jours → suggestion de relance

function getSuggestedReminders() {
    const cutoff = new Date(Date.now() - REMINDER_DELAY_DAYS * 86400000).toISOString();
    const quotes = db.get('quotes').value();
    const invoices = db.get('invoices').value();
    const quotesToRemind = quotes.filter(q => q.status === 'sent' && q.sent_at && q.sent_at <= cutoff);
    const nowIso = now();
    const invoicesOverdue = invoices.filter(i => i.status !== 'paid' && i.dueDate && i.dueDate <= nowIso && i.sent_at);
    return { quotesToRemind, invoicesOverdue };
}

app.get('/api/reminders', auth, (req, res) => {
    res.json(getSuggestedReminders());
});

app.post('/api/quotes/:id/remind', auth, adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    const quote = db.get('quotes').find({ id }).value();
    if (!quote) return res.status(404).json({ error: 'Devis introuvable' });
    const business = db.get('businessSettings').value() || {};
    const mail = mailer.quoteReminderEmail(quote);
    mail.meta = { type: 'quote_reminder', relatedId: id };
    try {
        const pdfBuffer = await pdfGen.generateQuotePdf(quote, business);
        mail.attachments = [{ content: pdfBuffer.toString('base64'), name: `Devis-${quote.quoteNumber || quote.id}.pdf` }];
    } catch (err) { console.error('Erreur génération PDF devis:', err.message); }
    const result = await mailer.sendMail(mail);
    if (!result.sent) return res.status(500).json({ error: "Échec de l'envoi : " + result.reason });
    db.get('quotes').find({ id }).assign({ lastReminderAt: now() }).write();
    logTeamAction(req, 'quote_reminder_sent', `Relance envoyée pour le devis #${id} (${quote.clientEmail})`, id);
    res.json({ ok: true });
});

app.post('/api/invoices/:id/remind', auth, adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    const invoice = db.get('invoices').find({ id }).value();
    if (!invoice) return res.status(404).json({ error: 'Facture introuvable' });
    const business = db.get('businessSettings').value() || {};
    const mail = mailer.invoiceReminderEmail(invoice, business);
    mail.meta = { type: 'invoice_reminder', relatedId: id };
    try {
        const pdfBuffer = await pdfGen.generateInvoicePdf(invoice, business);
        mail.attachments = [{ content: pdfBuffer.toString('base64'), name: `Facture-${invoice.invoiceNumber}.pdf` }];
    } catch (err) { console.error('Erreur génération PDF facture:', err.message); }
    const result = await mailer.sendMail(mail);
    if (!result.sent) return res.status(500).json({ error: "Échec de l'envoi : " + result.reason });
    db.get('invoices').find({ id }).assign({ lastReminderAt: now() }).write();
    logTeamAction(req, 'invoice_reminder_sent', `Relance envoyée pour la facture ${invoice.invoiceNumber} (${invoice.clientEmail})`, id);
    res.json({ ok: true });
});

// Relances automatiques (opt-in, "Mon entreprise" → réglage "Relances automatiques") — réutilise
// les mêmes emails que les boutons manuels "Relancer". Un devis/facture n'est jamais relancé plus
// d'une fois par semaine automatiquement, pour ne pas harceler le client.
async function runAutoReminders() {
    const business = db.get('businessSettings').value() || {};
    if (!business.autoRemindersEnabled) return;
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { quotesToRemind, invoicesOverdue } = getSuggestedReminders();

    for (const quote of quotesToRemind.filter(q => !q.lastReminderAt || q.lastReminderAt <= sevenDaysAgo)) {
        try {
            const mail = mailer.quoteReminderEmail(quote);
            mail.meta = { type: 'quote_reminder_auto', relatedId: quote.id };
            try {
                const pdfBuffer = await pdfGen.generateQuotePdf(quote, business);
                mail.attachments = [{ content: pdfBuffer.toString('base64'), name: `Devis-${quote.quoteNumber || quote.id}.pdf` }];
            } catch (err) { console.error('Erreur PDF devis (relance auto):', err.message); }
            const result = await mailer.sendMail(mail);
            if (result.sent) {
                db.get('quotes').find({ id: quote.id }).assign({ lastReminderAt: now() }).write();
                console.log(`📧 Relance auto devis ${quote.quoteNumber} envoyée à ${quote.clientEmail}`);
            }
        } catch (err) { console.error('Erreur relance auto devis:', err.message); }
    }

    for (const invoice of invoicesOverdue.filter(i => !i.lastReminderAt || i.lastReminderAt <= sevenDaysAgo)) {
        try {
            const mail = mailer.invoiceReminderEmail(invoice, business);
            mail.meta = { type: 'invoice_reminder_auto', relatedId: invoice.id };
            try {
                const pdfBuffer = await pdfGen.generateInvoicePdf(invoice, business);
                mail.attachments = [{ content: pdfBuffer.toString('base64'), name: `Facture-${invoice.invoiceNumber}.pdf` }];
            } catch (err) { console.error('Erreur PDF facture (relance auto):', err.message); }
            const result = await mailer.sendMail(mail);
            if (result.sent) {
                db.get('invoices').find({ id: invoice.id }).assign({ lastReminderAt: now() }).write();
                console.log(`📧 Relance auto facture ${invoice.invoiceNumber} envoyée à ${invoice.clientEmail}`);
            }
        } catch (err) { console.error('Erreur relance auto facture:', err.message); }
    }
}

// Relance automatique des leads "Nouveau" sans réponse (opt-in, "Mon entreprise" →
// "Relancer automatiquement les leads sans réponse"). Un seul email par lead, jamais plus
// — pas de harcèlement du prospect. Le délai est le même que celui utilisé pour le score
// de priorité (leadFollowUpDays, 3 jours par défaut).
async function runAutoLeadFollowUp() {
    const business = db.get('businessSettings').value() || {};
    if (!business.autoLeadFollowUpEnabled) return;
    const followUpDays = Number(business.leadFollowUpDays) || 3;
    const cutoff = new Date(Date.now() - followUpDays * 86400000).toISOString();
    const staleLeads = db.get('leads').value().filter(l =>
        !l.archived && l.status === 'new' && l.created_at <= cutoff && !l.autoFollowUpSentAt
    );
    for (const lead of staleLeads) {
        try {
            const result = await mailer.sendMail({ ...mailer.leadFollowUpEmail(lead), meta: { type: 'lead_follow_up_auto', relatedId: lead.id } });
            if (result.sent) {
                db.get('leads').find({ id: lead.id }).assign({ autoFollowUpSentAt: now() }).write();
                console.log(`📧 Relance auto lead #${lead.id} envoyée à ${lead.email}`);
            }
        } catch (err) { console.error('Erreur relance auto lead:', err.message); }
    }
}

app.get('/api/treasury', auth, (req, res) => {
    const invoices = db.get('invoices').value();
    const expenses = db.get('expenses').value();
    const invoicedTotal = invoices.reduce((s, i) => s + (i.total || 0), 0);
    const paidTotal = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0);
    const pendingTotal = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.total || 0), 0);

    // Courbe des encaissements sur les 12 derniers mois
    const monthly = {};
    const twelveMonthsAgo = new Date(); twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11); twelveMonthsAgo.setDate(1);
    for (let i = 0; i < 12; i++) {
        const d = new Date(twelveMonthsAgo); d.setMonth(d.getMonth() + i);
        monthly[d.toISOString().slice(0, 7)] = 0;
    }
    invoices.filter(i => i.status === 'paid' && i.paid_at).forEach(i => {
        const key = i.paid_at.slice(0, 7);
        if (key in monthly) monthly[key] += (i.total || 0);
    });

    const { quotesToRemind, invoicesOverdue } = getSuggestedReminders();

    // Objectifs de CA — progression du mois et de l'année en cours
    const business = db.get('businessSettings').value() || {};
    const thisMonthKey = new Date().toISOString().slice(0, 7);
    const thisYear = new Date().getFullYear();
    const revenueThisMonth = invoices.filter(i => i.status === 'paid' && i.paid_at?.startsWith(thisMonthKey)).reduce((s, i) => s + (i.total || 0), 0);
    const revenueThisYear = invoices.filter(i => i.status === 'paid' && i.paid_at && new Date(i.paid_at).getFullYear() === thisYear).reduce((s, i) => s + (i.total || 0), 0);

    // Dépenses — total du mois et de l'année en cours, pour calculer un résultat net
    const expensesThisMonth = expenses.filter(e => (e.date || '').startsWith(thisMonthKey)).reduce((s, e) => s + (e.amount || 0), 0);
    const expensesThisYear = expenses.filter(e => e.date && new Date(e.date).getFullYear() === thisYear).reduce((s, e) => s + (e.amount || 0), 0);
    const expensesTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);

    // Prévision de trésorerie à 30 jours — factures en attente (certaines) + devis
    // envoyés non répondus, pondérés par une probabilité d'acceptation indicative.
    const quotes = db.get('quotes').value();
    const quotesSentValue = quotes.filter(q => q.status === 'sent').reduce((s, q) => s + (q.total || 0), 0);
    const quotesDraftValue = quotes.filter(q => q.status === 'draft').reduce((s, q) => s + (q.total || 0), 0);
    const forecastNext30 = pendingTotal + quotesSentValue * 0.5 + quotesDraftValue * 0.1;

    // Comparaisons mois/mois et année/année
    const lastMonthDate = new Date(); lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    const lastMonthKey = lastMonthDate.toISOString().slice(0, 7);
    const revenueLastMonth = invoices.filter(i => i.status === 'paid' && i.paid_at?.startsWith(lastMonthKey)).reduce((s, i) => s + (i.total || 0), 0);
    const revenueLastYear = invoices.filter(i => i.status === 'paid' && i.paid_at && new Date(i.paid_at).getFullYear() === thisYear - 1).reduce((s, i) => s + (i.total || 0), 0);
    const leads = db.get('leads').value();
    const leadsThisMonth = leads.filter(l => l.created_at.startsWith(thisMonthKey)).length;
    const leadsLastMonth = leads.filter(l => l.created_at.startsWith(lastMonthKey)).length;

    res.json({
        invoicedTotal, paidTotal, pendingTotal, forecastNext30,
        monthly: Object.entries(monthly).map(([month, total]) => ({ month, total })),
        reminders: { quotesToRemind, invoicesOverdue, count: quotesToRemind.length + invoicesOverdue.length },
        goals: {
            monthly: Number(business.revenueGoalMonthly) || 0, annual: Number(business.revenueGoalAnnual) || 0,
            revenueThisMonth, revenueThisYear,
        },
        comparison: {
            revenueThisMonth, revenueLastMonth, revenueThisYear, revenueLastYear,
            leadsThisMonth, leadsLastMonth,
        },
        expenses: { total: expensesTotal, thisMonth: expensesThisMonth, thisYear: expensesThisYear },
        netResultThisMonth: revenueThisMonth - expensesThisMonth,
        netResultThisYear: revenueThisYear - expensesThisYear,
    });
});

/* ============================================================
   DÉPENSES — pour calculer un résultat net, pas juste le CA
   ============================================================ */
app.get('/api/expenses', auth, (req, res) => {
    res.json([...db.get('expenses').value()].reverse());
});

app.post('/api/expenses', auth, adminOnly, (req, res) => {
    const { label, amount, category, date } = req.body || {};
    if (!label || amount === undefined) return res.status(400).json({ error: 'label et amount requis' });
    const expense = {
        id: nextId('expenses'), created_at: now(),
        label, amount: Number(amount) || 0,
        category: category || 'autre', date: date || now().slice(0, 10),
    };
    db.get('expenses').push(expense).write();
    logTeamAction(req, 'expense_created', `Dépense ajoutée : ${label} (${expense.amount.toFixed(2)} €)`, expense.id);
    res.status(201).json(expense);
});

app.patch('/api/expenses/:id', auth, adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const exp = db.get('expenses').find({ id });
    if (!exp.value()) return res.status(404).json({ error: 'Dépense introuvable' });
    const { label, amount, category, date } = req.body || {};
    const patch = {};
    if (label !== undefined) patch.label = label;
    if (amount !== undefined) patch.amount = Number(amount) || 0;
    if (category !== undefined) patch.category = category;
    if (date !== undefined) patch.date = date;
    exp.assign(patch).write();
    res.json({ ok: true });
});

app.delete('/api/expenses/:id', auth, adminOnly, (req, res) => {
    db.get('expenses').remove({ id: Number(req.params.id) }).write();
    res.json({ ok: true });
});

/* ============================================================
   EXPORT COMPTABLE — CSV des factures d'une année, prêt pour le comptable
   ============================================================ */
function csvEscape(val) {
    const s = String(val ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.get('/api/invoices/export', auth, adminOnly, (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const invoices = db.get('invoices').value()
        .filter(i => new Date(i.issue_date).getFullYear() === year)
        .sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber));
    const header = ['Numéro', 'Date émission', 'Client', 'Email', 'Montant', 'Statut', 'Date paiement', 'Échéance'];
    const rows = invoices.map(i => [
        i.invoiceNumber, (i.issue_date || '').slice(0, 10), i.clientName || '', i.clientEmail,
        (i.total || 0).toFixed(2), i.status, i.paid_at ? i.paid_at.slice(0, 10) : '', i.dueDate ? i.dueDate.slice(0, 10) : '',
    ]);
    const csv = [header, ...rows].map(r => r.map(csvEscape).join(';')).join('\n');
    res.set('Content-Disposition', `attachment; filename="factures-${year}.csv"`);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.send('\uFEFF' + csv); // BOM pour un affichage correct des accents dans Excel
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
    const template = db.get('projectChecklistTemplate').value() || [];
    const project = {
        id: nextId('projects'), created_at: now(), leadId: leadId || null,
        name, clientEmail, stage: PROJECT_STAGES.includes(stage) ? stage : 'brief', notes: '',
        checklist: template.map(label => ({ label, done: false })),
        deliveredAt: null, satisfactionRequestedAt: null, reviewRequestedAt: null, anniversarySentAt: null,
    };
    db.get('projects').push(project).write();
    res.status(201).json(project);
});

app.patch('/api/projects/:id', auth, adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    const p = db.get('projects').find({ id });
    if (!p.value()) return res.status(404).json({ error: 'Projet introuvable' });
    const prev = p.value();
    const { name, clientEmail, stage, notes, checklist } = req.body || {};
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (clientEmail !== undefined) patch.clientEmail = clientEmail;
    if (notes !== undefined) patch.notes = notes;
    if (checklist !== undefined) patch.checklist = checklist;
    if (stage !== undefined && PROJECT_STAGES.includes(stage)) {
        patch.stage = stage;
        if (stage === 'livre' && prev.stage !== 'livre') patch.deliveredAt = now();
    }
    p.assign(patch).write();

    // Passage à "Livré" → déclenche l'enquête de satisfaction (immédiate)
    if (stage === 'livre' && prev.stage !== 'livre') {
        const updated = p.value();
        mailer.sendMail({
            ...mailer.satisfactionSurveyEmail(updated, satisfactionToken(id)),
            meta: { type: 'satisfaction_survey', relatedId: id },
        }).then(r => { if (r.sent) db.get('projects').find({ id }).assign({ satisfactionRequestedAt: now() }).write(); }).catch(() => {});
    }
    res.json({ ok: true });
});

app.delete('/api/projects/:id', auth, adminOnly, (req, res) => {
    db.get('projects').remove({ id: Number(req.params.id) }).write();
    res.json({ ok: true });
});

// Token signé pour le lien de notation de satisfaction (clic direct, sans compte)
function satisfactionToken(projectId) {
    return crypto.createHmac('sha256', JWT_SECRET).update('satisfaction-' + projectId).digest('hex').slice(0, 32);
}

app.get('/api/projects/:id/rate', (req, res) => {
    const id = Number(req.params.id);
    const score = Number(req.query.score);
    const project = db.get('projects').find({ id }).value();
    const page = (msg) => `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Merci</title>
        <style>body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:2rem;text-align:center;}p{color:#aaa;}</style></head>
        <body><div><h1>Merci ! 🙏</h1><p>${msg}</p></div></body></html>`;
    if (!project || req.query.token !== satisfactionToken(id) || !(score >= 1 && score <= 5)) {
        return res.status(400).send(page("Ce lien n'est plus valide."));
    }
    db.get('projects').find({ id }).assign({ satisfactionScore: score, satisfactionRatedAt: now() }).write();
    res.send(page('Votre note a bien été enregistrée. Florian vous en remercie sincèrement.'));
});

/* ============================================================
   SUIVI DU TEMPS — par projet, pour affiner le chiffrage des devis
   ============================================================ */
app.get('/api/time-logs', auth, (req, res) => {
    const { projectId } = req.query;
    let logs = db.get('timeLogs').value();
    if (projectId) logs = logs.filter(t => t.projectId === Number(projectId));
    res.json([...logs].reverse());
});

app.post('/api/time-logs', auth, canWrite, (req, res) => {
    const { projectId, description, minutes, date } = req.body || {};
    if (!projectId || !minutes) return res.status(400).json({ error: 'projectId et minutes requis' });
    const entry = {
        id: nextId('timeLogs'), created_at: now(),
        projectId: Number(projectId), description: description || '',
        minutes: Number(minutes) || 0, date: date || now().slice(0, 10),
    };
    db.get('timeLogs').push(entry).write();
    res.status(201).json(entry);
});

app.delete('/api/time-logs/:id', auth, canWrite, (req, res) => {
    db.get('timeLogs').remove({ id: Number(req.params.id) }).write();
    res.json({ ok: true });
});


/* ============================================================
   CALENDRIER DE CONTENU (Instagram etc.)
   ============================================================ */
// Suggestions d'idées de contenu — génération par modèles à partir de tes projets réels
// (PAS une vraie IA connectée : rotation de formats éprouvés appliqués à ton portfolio).
const CONTENT_IDEA_TEMPLATES = [
    p => `Avant/après sur le projet "${p.title}" — montre l'évolution du brief au résultat final`,
    p => `Behind the scenes : 3 étapes clés du processus créatif sur "${p.title}"`,
    p => `Zoom sur un détail du projet "${p.title}" qui fait toute la différence`,
    p => `Carrousel "3 choses que j'ai apprises" en travaillant sur "${p.title}"`,
    p => `Story "Cette semaine dans mon studio" avec un aperçu de "${p.title}"`,
];
const GENERIC_CONTENT_IDEAS = [
    'Partage un avant/après de ton propre site ou identité visuelle',
    'FAQ en story : réponds à une question fréquente de tes clients',
    'Carrousel "Les erreurs de branding les plus fréquentes"',
    'Présente ton setup / tes outils de travail (Figma, Procreate...)',
    'Témoignage client mis en scène en citation visuelle',
];

app.get('/api/content-ideas', auth, (req, res) => {
    const projects = db.get('site_content').value()?.projects || [];
    const sample = [...projects].sort(() => Math.random() - 0.5).slice(0, 3);
    const ideas = [];
    sample.forEach(p => {
        const tpl = CONTENT_IDEA_TEMPLATES[Math.floor(Math.random() * CONTENT_IDEA_TEMPLATES.length)];
        ideas.push({ title: tpl(p), suggestedPlatform: 'instagram' });
    });
    const genericPicks = [...GENERIC_CONTENT_IDEAS].sort(() => Math.random() - 0.5).slice(0, 2);
    genericPicks.forEach(g => ideas.push({ title: g, suggestedPlatform: 'linkedin' }));
    res.json(ideas);
});

app.get('/api/content-calendar', auth, (req, res) => {
    res.json([...db.get('contentCalendar').value()].sort((a, b) => (a.date || '').localeCompare(b.date || '')));
});

app.post('/api/content-calendar', auth, canWrite, (req, res) => {
    const { title, date, caption, status, platform } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title requis' });
    const item = {
        id: nextId('contentCalendar'), created_at: now(),
        title, date: date || null, caption: caption || '', status: status || 'idea',
        platform: platform || 'instagram',
    };
    db.get('contentCalendar').push(item).write();
    res.status(201).json(item);
});

app.patch('/api/content-calendar/:id', auth, canWrite, (req, res) => {
    const id = Number(req.params.id);
    const item = db.get('contentCalendar').find({ id });
    if (!item.value()) return res.status(404).json({ error: 'Introuvable' });
    const { title, date, caption, status, platform } = req.body || {};
    const patch = {};
    if (title !== undefined) patch.title = title;
    if (date !== undefined) patch.date = date;
    if (caption !== undefined) patch.caption = caption;
    if (status !== undefined) patch.status = status;
    if (platform !== undefined) patch.platform = platform;
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
/* ============================================================
   EMAILS — journal local + statuts en direct via l'API Brevo
   (envoyé, livré, ouvert, cliqué, échec) pour ne plus avoir
   besoin d'aller consulter le tableau de bord Brevo.
   ============================================================ */
const EMAIL_TYPE_LABELS = {
    lead_confirmation: 'Confirmation lead (client)', lead_notification: 'Notification lead (interne)',
    lead_reply: 'Réponse à un lead', appointment_confirmation: 'Confirmation RDV (client)',
    appointment_notification: 'Notification RDV (interne)', appointment_reminder: 'Rappel RDV (client)',
    quote_sent: 'Devis envoyé', quote_reminder: 'Relance devis', quote_accepted: 'Devis accepté (interne)',
    invoice_sent: 'Facture envoyée', invoice_reminder: 'Relance facture', monthly_report: 'Rapport mensuel',
    daily_brief: 'Brief quotidien', analytics_alert: 'Alerte analytics', team_invite: 'Invitation équipe',
    team_invite_resend: 'Invitation renvoyée', satisfaction_survey: 'Enquête de satisfaction',
    google_review_request: 'Demande d\'avis Google', anniversary: 'Anniversaire collaboration', other: 'Autre',
};

app.get('/api/admin/emails', auth, adminOnly, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const logs = [...db.get('emailLog').value()].reverse().slice(0, limit)
        .map(e => ({ ...e, typeLabel: EMAIL_TYPE_LABELS[e.type] || e.type }));
    res.json(logs);
});

// Statuts en direct (livré/ouvert/cliqué/échec) depuis l'API Brevo, sur une fenêtre de jours.
// On récupère tous les évènements de la période en un seul appel, le dashboard fait la
// correspondance avec les emails envoyés via leur messageId.
app.get('/api/admin/email-events', auth, adminOnly, async (req, res) => {
    if (!process.env.BREVO_API_KEY) return res.status(400).json({ error: 'Brevo non configuré (BREVO_API_KEY manquant)' });
    const days = Math.min(Number(req.query.days) || 30, 90);
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const r = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?limit=2500&days=${days}`, {
            headers: { 'api-key': process.env.BREVO_API_KEY, 'Accept': 'application/json' },
            signal: controller.signal,
        }).finally(() => clearTimeout(timeoutId));
        if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            throw new Error(body.message || `Erreur Brevo (${r.status})`);
        }
        const data = await r.json();
        res.json(data.events || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


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

// Restauration à partir d'un fichier de sauvegarde JSON (téléchargé via le bouton
// ci-dessus). Utile une seule fois après avoir configuré le Volume persistant,
// pour récupérer les données perdues lors des redéploiements précédents.
// ⚠️ Remplace TOUTES les données actuelles — confirmation obligatoire côté dashboard.
app.post('/api/admin/restore', auth, adminOnly, (req, res) => {
    const incoming = req.body;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return res.status(400).json({ error: 'Fichier de sauvegarde invalide (JSON attendu).' });
    }
    // Garde-fou minimal : un vrai fichier de sauvegarde a au moins ces clés.
    const expectedKeys = ['leads', 'businessSettings'];
    if (!expectedKeys.every(k => k in incoming)) {
        return res.status(400).json({ error: "Ce fichier ne ressemble pas à une sauvegarde de ce dashboard (clés attendues manquantes)." });
    }
    db.setState(incoming).write();
    logTeamAction(req, 'other', 'Données restaurées depuis un fichier de sauvegarde');
    res.json({ ok: true });
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
    const visitors = gaSummary?.configured ? gaSummary.totals.activeUsers : null;

    const mail = mailer.monthlyReportEmail({ newLeads, wonLeads, revenue, visitors });
    mail.meta = { type: 'monthly_report' };
    try {
        const monthLabel = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
        const pdfBuffer = await pdfGen.generateMonthlyReportPdf({ monthLabel, newLeads, wonLeads, revenue, visitors });
        mail.attachments = [{ content: pdfBuffer.toString('base64'), name: `Rapport-${new Date().toISOString().slice(0,7)}.pdf` }];
    } catch (err) { console.error('Erreur génération PDF rapport:', err.message); }
    const result = await mailer.sendMail(mail);
    return result;
}

app.post('/api/admin/send-report', auth, adminOnly, async (req, res) => {
    const result = await buildAndSendMonthlyReport();
    if (!result.sent) return res.status(500).json({ error: "Échec de l'envoi : " + result.reason });
    res.json({ ok: true });
});

// Téléchargement direct du rapport en PDF (indépendamment de l'envoi par email)
app.get('/api/admin/monthly-report/pdf', auth, adminOnly, async (req, res) => {
    const leads = db.get('leads').value();
    const quotes = db.get('quotes').value();
    const now30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const newLeads = leads.filter(l => l.created_at >= now30).length;
    const wonLeads = leads.filter(l => l.status === 'won' && l.created_at >= now30).length;
    const revenue = quotes.filter(q => q.status === 'paid' && q.paid_at >= now30).reduce((s, q) => s + (q.total || 0), 0);
    let gaSummary = null;
    try { gaSummary = analytics.isConfigured() ? await analytics.getOverview(30) : null; } catch { gaSummary = null; }
    const monthLabel = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const pdfBuffer = await pdfGen.generateMonthlyReportPdf({
        monthLabel, newLeads, wonLeads, revenue,
        visitors: gaSummary?.configured ? gaSummary.totals.activeUsers : null,
    });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="Rapport-${new Date().toISOString().slice(0,7)}.pdf"`);
    res.send(pdfBuffer);
});

app.get('/health', (req, res) => res.json({ ok: true }));

/* ============================================================
   RÉSUMÉ HEBDOMADAIRE — le lundi matin, en plus du rapport mensuel
   ============================================================ */
async function buildAndSendWeeklySummary() {
    const leads = db.get('leads').value();
    const invoices = db.get('invoices').value();
    const now7 = new Date(Date.now() - 7 * 86400000).toISOString();
    const prev7 = new Date(Date.now() - 14 * 86400000).toISOString();

    const leadsThisWeek = leads.filter(l => l.created_at >= now7);
    const leadsPrevWeek = leads.filter(l => l.created_at >= prev7 && l.created_at < now7);
    const wonThisWeek = leads.filter(l => l.status === 'won' && l.created_at >= now7).length;
    const revenueThisWeek = invoices.filter(i => i.status === 'paid' && i.paid_at && i.paid_at >= now7).reduce((s, i) => s + (i.total || 0), 0);

    const mail = mailer.weeklySummaryEmail({
        newLeads: leadsThisWeek.length,
        newLeadsPrevWeek: leadsPrevWeek.length,
        wonThisWeek,
        revenueThisWeek,
    });
    mail.meta = { type: 'weekly_summary' };
    return mailer.sendMail(mail);
}

// Archivage automatique — 1er de chaque mois à 3h : leads perdus et factures payées
// depuis plus de 6 mois basculent en archive (ils restent dans les données/exports,
// juste masqués des listes actives par défaut).
function runAutoArchiving() {
    const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString();
    const leads = db.get('leads').value();
    let archivedLeads = 0;
    leads.forEach(l => {
        if (!l.archived && l.status === 'lost' && l.created_at < sixMonthsAgo) {
            db.get('leads').find({ id: l.id }).assign({ archived: true }).write();
            archivedLeads++;
        }
    });
    const invoices = db.get('invoices').value();
    let archivedInvoices = 0;
    invoices.forEach(i => {
        if (!i.archived && i.status === 'paid' && i.paid_at && i.paid_at < sixMonthsAgo) {
            db.get('invoices').find({ id: i.id }).assign({ archived: true }).write();
            archivedInvoices++;
        }
    });
    if (archivedLeads || archivedInvoices) console.log(`🗄️  Archivage auto : ${archivedLeads} lead(s), ${archivedInvoices} facture(s)`);
}

// Alertes proactives — signaux faibles à repérer avant qu'ils ne deviennent un problème.
function computeProactiveAlerts() {
    const alerts = [];
    const leads = db.get('leads').value();
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
    if (!leads.some(l => l.created_at >= tenDaysAgo)) {
        alerts.push("Aucun nouveau lead depuis 10 jours — pense à relancer ta visibilité (Instagram, réseau).");
    }
    const followUpDays = Number(db.get('businessSettings').value()?.leadFollowUpDays) || 3;
    const followUpCutoff = new Date(Date.now() - followUpDays * 86400000).toISOString();
    const staleLeads = leads.filter(l => !l.archived && l.status === 'new' && l.created_at <= followUpCutoff);
    if (staleLeads.length) {
        alerts.push(`${staleLeads.length} lead${staleLeads.length > 1 ? 's' : ''} "Nouveau" sans réponse depuis plus de ${followUpDays} jours — à relancer.`);
    }
    const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const d60 = new Date(Date.now() - 60 * 86400000).toISOString();
    const last30 = leads.filter(l => l.created_at >= d30);
    const prev30 = leads.filter(l => l.created_at >= d60 && l.created_at < d30);
    const rate = (arr) => arr.length ? arr.filter(l => l.status === 'won').length / arr.length : null;
    const r1 = rate(last30), r0 = rate(prev30);
    if (r0 !== null && r1 !== null && r1 < r0 - 0.15) {
        alerts.push(`Le taux de conversion a baissé (${Math.round(r1*100)}% vs ${Math.round(r0*100)}% le mois précédent).`);
    }
    return alerts;
}

async function buildAndSendDailyBrief() {
    const cockpitLeads = db.get('leads').value().filter(l => l.status === 'new').length;
    const todayStr = now().slice(0, 10);
    const apptsToday = db.get('appointments').value().filter(a => a.confirmedDate && a.confirmedDate.slice(0, 10) === todayStr);
    const { quotesToRemind, invoicesOverdue } = getSuggestedReminders();
    const alerts = computeProactiveAlerts();
    // Rien à signaler et aucune alerte : pas la peine d'encombrer la boîte mail.
    if (!cockpitLeads && !apptsToday.length && !quotesToRemind.length && !invoicesOverdue.length && !alerts.length) return;
    await mailer.sendMail({
        ...mailer.dailyBriefEmail({ newLeadsToProcess: cockpitLeads, apptsToday, quotesToRemind, invoicesOverdue, alerts }),
        meta: { type: 'daily_brief' },
    });
}

/* ============================================================
   ACTIONS DEPUIS LES NOTIFICATIONS PUSH — le bouton dans la notif
   appelle cette route avec un jeton signé (pas besoin d'être connecté)
   ============================================================ */
function pushActionToken(type, id) {
    return crypto.createHmac('sha256', JWT_SECRET).update('push-action-' + type + '-' + id).digest('hex').slice(0, 32);
}
app.post('/api/push-action', async (req, res) => {
    const { type, id, token } = req.query || {};
    const numId = Number(id);
    if (!type || !numId || token !== pushActionToken(type, numId)) return res.status(403).json({ error: 'Jeton invalide' });
    if (type === 'lead-ack') {
        const lead = db.get('leads').find({ id: numId }).value();
        if (!lead) return res.status(404).json({ error: 'Lead introuvable' });
        if (lead.ackSentAt) return res.json({ ok: true, already: true }); // idempotent : un seul envoi
        const message = `Bonjour ${lead.name || ''},\n\nMerci pour votre message ! Je l'ai bien reçu et je reviens vers vous rapidement avec une réponse détaillée.\n\nÀ très vite,`;
        const result = await mailer.sendMail({ ...mailer.leadReplyEmail(lead, message), meta: { type: 'lead_reply', relatedId: lead.id } });
        if (!result.sent) return res.status(500).json({ error: result.reason });
        db.get('leads').find({ id: numId }).assign({ status: lead.status === 'new' ? 'contacted' : lead.status, ackSentAt: now() }).write();
        push.notifyAll({ title: '✅ Accusé envoyé', body: `${lead.name || lead.email} a reçu ton accusé de réception — lead passé en "Contacté"`, tag: 'ack-' + numId }).catch(() => {});
        return res.json({ ok: true });
    }
    res.status(400).json({ error: 'Action inconnue' });
});

/* ============================================================
   QUOTA SERPAPI — combien de recherches restent ce mois-ci
   (interroge le compte, ne consomme AUCUNE recherche)
   ============================================================ */
async function getSerpQuota() {
    if (!process.env.SERPAPI_KEY) return null;
    try {
        const r = await fetch('https://serpapi.com/account.json?api_key=' + process.env.SERPAPI_KEY, { signal: AbortSignal.timeout(10000) });
        const d = await r.json();
        if (d.error) return null;
        return {
            planLimit: d.total_searches_left != null ? (d.this_month_usage || 0) + d.total_searches_left : null,
            used: d.this_month_usage ?? null,
            remaining: d.total_searches_left ?? null,
        };
    } catch { return null; }
}
app.get('/api/serp-quota', auth, async (req, res) => {
    res.json({ enabled: Boolean(process.env.SERPAPI_KEY), quota: await getSerpQuota() });
});

/* ============================================================
   SUIVI DE POSITION GOOGLE (SERP) — optionnel, via SerpApi
   Variable Railway SERPAPI_KEY (offre gratuite : 100 recherches/mois,
   largement assez pour 5 mots-clés vérifiés 1 fois par semaine).
   Mots-clés configurés dans "Mon entreprise".
   ============================================================ */
async function runSerpCheck() {
    if (!process.env.SERPAPI_KEY) return;
    const b = db.get('businessSettings').value() || {};
    const keywords = String(b.seoKeywords || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean).slice(0, 5);
    if (!keywords.length) return;
    const quota = await getSerpQuota();
    if (quota && quota.remaining != null && quota.remaining < keywords.length) {
        console.log('SERP: quota SerpApi trop bas, relevé hebdomadaire sauté ce coup-ci.');
        return;
    }
    const domain = (process.env.SITE_URL || 'https://florian-b.fr').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    for (const keyword of keywords) {
        try {
            const params = new URLSearchParams({ engine: 'google', q: keyword, gl: 'fr', hl: 'fr', num: '50', api_key: process.env.SERPAPI_KEY });
            const r = await fetch('https://serpapi.com/search.json?' + params, { signal: AbortSignal.timeout(20000) });
            const d = await r.json();
            const organic = d.organic_results || [];
            const hit = organic.find(x => (x.link || '').includes(domain));
            const position = hit ? hit.position : null; // null = pas dans le top 50
            // Tout ce que la même réponse contient d'utile (aucune recherche supplémentaire) :
            const topResults = organic.slice(0, 5).map(x => ({
                position: x.position,
                title: (x.title || '').slice(0, 90),
                domain: (() => { try { return new URL(x.link).hostname.replace(/^www\./, ''); } catch { return x.link || ''; } })(),
            }));
            const relatedQuestions = (d.related_questions || []).map(q => (q.question || '').slice(0, 140)).filter(Boolean).slice(0, 6);
            const relatedSearches = (d.related_searches || []).map(r => (r.query || '').slice(0, 80)).filter(Boolean).slice(0, 8);
            const localResults = (d.local_results && (d.local_results.places || d.local_results)) || [];
            const inLocalPack = Array.isArray(localResults) && localResults.some(p => /florian/i.test(p.title || ''));
            const hasLocalPack = Array.isArray(localResults) && localResults.length > 0;
            db.get('serpRankings').push({
                id: nextId('serpRankings'), date: now().slice(0, 10), keyword, position,
                topResults, relatedQuestions, relatedSearches,
                localPack: hasLocalPack ? { present: inLocalPack } : null,
            }).write();
        } catch (err) { console.error('SERP:', keyword, err.message); }
    }
    // Notifie les belles progressions
    try {
        const all = db.get('serpRankings').value();
        for (const keyword of keywords) {
            const hist = all.filter(x => x.keyword === keyword).slice(-2);
            if (hist.length === 2 && hist[1].position && (!hist[0].position || hist[1].position < hist[0].position)) {
                push.notifyAll({ title: '📈 SEO en progression', body: `« ${keyword} » : position ${hist[1].position} sur Google${hist[0].position ? ' (avant : ' + hist[0].position + ')' : ' (nouvelle entrée !)'}`, tag: 'serp-' + keyword }).catch(() => {});
            }
        }
    } catch {}
}
cron.schedule('30 7 * * 1', () => {
    runSerpCheck().catch(err => console.error('Erreur SERP:', err.message));
}, { timezone: 'Europe/Paris' });
app.get('/api/serp-rankings', auth, (req, res) => {
    res.json({ enabled: Boolean(process.env.SERPAPI_KEY), rankings: db.get('serpRankings').value() || [] });
});
// Idées de mots-clés via Google Autocomplete (consomme 1 recherche SerpApi par appel)
app.post('/api/serp-suggest', auth, adminOnly, async (req, res) => {
    if (!process.env.SERPAPI_KEY) return res.status(400).json({ error: 'Ajoute la variable SERPAPI_KEY sur Railway' });
    const seed = String(req.body?.seed || '').trim().slice(0, 80);
    if (!seed) return res.status(400).json({ error: 'Indique un mot-clé de départ' });
    try {
        const params = new URLSearchParams({ engine: 'google_autocomplete', q: seed, gl: 'fr', hl: 'fr', api_key: process.env.SERPAPI_KEY });
        const r = await fetch('https://serpapi.com/search.json?' + params, { signal: AbortSignal.timeout(15000) });
        const d = await r.json();
        if (d.error) return res.status(502).json({ error: d.error });
        res.json({ suggestions: (d.suggestions || []).map(x => x.value).filter(Boolean).slice(0, 12) });
    } catch (err) {
        res.status(502).json({ error: 'SerpApi injoignable : ' + err.message });
    }
});

app.post('/api/serp-run', auth, adminOnly, async (req, res) => {
    if (!process.env.SERPAPI_KEY) return res.status(400).json({ error: 'Ajoute la variable SERPAPI_KEY sur Railway (clé gratuite sur serpapi.com)' });
    await runSerpCheck();
    res.json({ ok: true, rankings: db.get('serpRankings').value() || [] });
});

/* ============================================================
   ANNUAIRE DES ENTREPRISES (API gouv.fr, gratuite, sans clé)
   Vérifie l'existence d'une entreprise et récupère ses infos
   légales (SIRET, adresse, forme juridique, statut).
   ============================================================ */
app.get('/api/company-lookup', auth, async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Indique un nom d\'entreprise ou un SIRET/SIREN' });
    try {
        const params = new URLSearchParams({ q, per_page: '5' });
        const r = await fetch('https://recherche-entreprises.api.gouv.fr/search?' + params, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error('Service indisponible (HTTP ' + r.status + ')');
        const d = await r.json();
        const results = (d.results || []).map(x => {
            const siege = x.siege || {};
            const adresse = [siege.adresse, siege.code_postal, siege.libelle_commune].filter(Boolean).join(', ');
            return {
                siren: x.siren, siret: siege.siret || null,
                name: x.nom_complet || x.nom_raison_sociale || x.nom_complet,
                legalForm: x.nature_juridique || null,
                address: adresse || null,
                active: x.etat_administratif === 'A',
                employeeRange: x.tranche_effectif_salarie || null,
                activity: siege.activite_principale || x.activite_principale || null,
            };
        });
        res.json({ results });
    } catch (err) {
        res.status(502).json({ error: 'Annuaire des Entreprises injoignable : ' + err.message });
    }
});

/* ============================================================
   AUTOCOMPLÉTION D'ADRESSE (API Géoplateforme / IGN, gratuite,
   sans clé) — remplace l'ancienne api-adresse.data.gouv.fr
   (décommissionnée fin janvier 2026).
   ============================================================ */
app.get('/api/address-search', auth, async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) return res.json({ results: [] });
    try {
        const params = new URLSearchParams({ text: q, maximumResponses: '6' });
        const r = await fetch('https://data.geopf.fr/geocodage/completion?' + params, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('Service indisponible (HTTP ' + r.status + ')');
        const d = await r.json();
        const results = (d.results || []).map(x => ({
            label: x.fulltext || [x.street, x.zipcode, x.city].filter(Boolean).join(', '),
            city: x.city || null, zipcode: x.zipcode || null,
        }));
        res.json({ results });
    } catch (err) {
        res.status(502).json({ error: 'Service d\'adresse injoignable : ' + err.message });
    }
});

/* ============================================================
   GOOGLE MAPS — ton classement local + les concurrents à proximité
   Relevé chaque lundi 8h (juste après le SERP classique).
   Mots-clés locaux configurés dans "Mon entreprise" (bsMapsKeywords).
   ============================================================ */
async function runMapsCheck() {
    if (!process.env.SERPAPI_KEY) return;
    const b = db.get('businessSettings').value() || {};
    const keywords = String(b.mapsKeywords || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean).slice(0, 3);
    if (!keywords.length) return;
    const quota = await getSerpQuota();
    if (quota && quota.remaining != null && quota.remaining < keywords.length) return;
    for (const keyword of keywords) {
        try {
            const params = new URLSearchParams({ engine: 'google_maps', q: keyword, type: 'search', gl: 'fr', hl: 'fr', api_key: process.env.SERPAPI_KEY });
            const r = await fetch('https://serpapi.com/search.json?' + params, { signal: AbortSignal.timeout(20000) });
            const d = await r.json();
            const results = d.local_results || [];
            const mine = results.find(p => /florian/i.test(p.title || ''));
            const competitors = results.slice(0, 8).map(p => ({
                title: p.title, rating: p.rating ?? null, reviews: p.reviews ?? null, position: p.position ?? null,
            }));
            db.get('mapsRankings').push({
                id: nextId('mapsRankings'), date: now().slice(0, 10), keyword,
                position: mine ? mine.position : null, rating: mine ? mine.rating ?? null : null, reviews: mine ? mine.reviews ?? null : null,
                competitors,
            }).write();
        } catch (err) { console.error('Maps SERP:', keyword, err.message); }
    }
}
cron.schedule('0 8 * * 1', () => {
    runMapsCheck().catch(err => console.error('Erreur Maps SERP:', err.message));
}, { timezone: 'Europe/Paris' });
app.get('/api/maps-rankings', auth, (req, res) => {
    res.json({ enabled: Boolean(process.env.SERPAPI_KEY), rankings: db.get('mapsRankings').value() || [] });
});
app.post('/api/maps-run', auth, adminOnly, async (req, res) => {
    if (!process.env.SERPAPI_KEY) return res.status(400).json({ error: 'Ajoute la variable SERPAPI_KEY sur Railway' });
    await runMapsCheck();
    res.json({ ok: true, rankings: db.get('mapsRankings').value() || [] });
});

/* ============================================================
   RECHERCHE D'IMAGE INVERSÉE — détecte qui republie tes visuels
   Vérifie chaque mois les images configurées dans "Mon entreprise"
   (une URL absolue par ligne — copie le lien d'une image de ton site).
   ============================================================ */
async function runReverseImageCheck() {
    if (!process.env.SERPAPI_KEY) return;
    const b = db.get('businessSettings').value() || {};
    const images = String(b.watchImages || '').split(/[\n,;]+/).map(x => x.trim()).filter(x => /^https?:\/\//.test(x)).slice(0, 8);
    if (!images.length) return;
    const quota = await getSerpQuota();
    if (quota && quota.remaining != null && quota.remaining < images.length) return;
    for (const imageUrl of images) {
        try {
            const params = new URLSearchParams({ engine: 'google_reverse_image', image_url: imageUrl, api_key: process.env.SERPAPI_KEY });
            const r = await fetch('https://serpapi.com/search.json?' + params, { signal: AbortSignal.timeout(25000) });
            const d = await r.json();
            const matches = (d.image_results || []).map(x => ({
                title: (x.title || '').slice(0, 100),
                domain: (() => { try { return new URL(x.link).hostname.replace(/^www\./, ''); } catch { return x.link || ''; } })(),
                link: x.link,
            })).slice(0, 15);
            const prev = db.get('reverseImageChecks').value().filter(x => x.imageUrl === imageUrl).slice(-1)[0];
            const prevDomains = new Set((prev?.matches || []).map(m => m.domain));
            const newDomains = matches.filter(m => !prevDomains.has(m.domain));
            db.get('reverseImageChecks').push({ id: nextId('reverseImageChecks'), date: now().slice(0, 10), imageUrl, matches }).write();
            if (prev && newDomains.length) {
                push.notifyAll({ title: '🖼️ Ton visuel a été repéré', body: `${newDomains.length} nouveau${newDomains.length > 1 ? 'x' : ''} site${newDomains.length > 1 ? 's' : ''} utilise${newDomains.length > 1 ? 'nt' : ''} une image que tu surveilles (${newDomains[0].domain})`, tag: 'reverse-img' }).catch(() => {});
            }
        } catch (err) { console.error('Reverse image:', imageUrl, err.message); }
    }
}
cron.schedule('0 9 1 * *', () => {
    runReverseImageCheck().catch(err => console.error('Erreur reverse image:', err.message));
}, { timezone: 'Europe/Paris' });
app.get('/api/reverse-image-checks', auth, (req, res) => {
    res.json({ enabled: Boolean(process.env.SERPAPI_KEY), checks: db.get('reverseImageChecks').value() || [] });
});
app.post('/api/reverse-image-run', auth, adminOnly, async (req, res) => {
    if (!process.env.SERPAPI_KEY) return res.status(400).json({ error: 'Ajoute la variable SERPAPI_KEY sur Railway' });
    await runReverseImageCheck();
    res.json({ ok: true, checks: db.get('reverseImageChecks').value() || [] });
});

/* ============================================================
   GOOGLE TRENDS — saisonnalité de tes mots-clés, pour caler le
   calendrier de contenu. Relevé le 1er de chaque mois.
   ============================================================ */
async function runTrendsCheck() {
    if (!process.env.SERPAPI_KEY) return;
    const b = db.get('businessSettings').value() || {};
    const keywords = String(b.seoKeywords || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean).slice(0, 5);
    if (!keywords.length) return;
    const quota = await getSerpQuota();
    if (quota && quota.remaining != null && quota.remaining < keywords.length) return;
    for (const keyword of keywords) {
        try {
            const params = new URLSearchParams({ engine: 'google_trends', q: keyword, geo: 'FR', date: 'today 12-m', data_type: 'TIMESERIES', api_key: process.env.SERPAPI_KEY });
            const r = await fetch('https://serpapi.com/search.json?' + params, { signal: AbortSignal.timeout(20000) });
            const d = await r.json();
            const timeline = d.interest_over_time?.timeline_data || [];
            const points = timeline.map(t => ({ date: t.date, value: t.values?.[0]?.extracted_value ?? null })).filter(p => p.value != null);
            if (!points.length) continue;
            // Mois le plus fort de l'historique — pour savoir quand publier/relancer
            const best = points.reduce((a, b2) => (b2.value > a.value ? b2 : a), points[0]);
            db.get('trendsData').push({ id: nextId('trendsData'), date: now().slice(0, 10), keyword, points, bestPeriod: best.date }).write();
        } catch (err) { console.error('Trends:', keyword, err.message); }
    }
}
cron.schedule('0 9 1 * *', () => {
    runTrendsCheck().catch(err => console.error('Erreur Trends:', err.message));
}, { timezone: 'Europe/Paris' });
app.get('/api/trends-data', auth, (req, res) => {
    res.json({ enabled: Boolean(process.env.SERPAPI_KEY), data: db.get('trendsData').value() || [] });
});
app.post('/api/trends-run', auth, adminOnly, async (req, res) => {
    if (!process.env.SERPAPI_KEY) return res.status(400).json({ error: 'Ajoute la variable SERPAPI_KEY sur Railway' });
    await runTrendsCheck();
    res.json({ ok: true, data: db.get('trendsData').value() || [] });
});

/* ============================================================
   GOOGLE NEWS — mentions de ta marque et actu de tes clients
   Relevé chaque mardi 8h. Termes configurés dans "Mon entreprise".
   ============================================================ */
async function runNewsCheck() {
    if (!process.env.SERPAPI_KEY) return;
    const b = db.get('businessSettings').value() || {};
    const terms = String(b.newsWatchTerms || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean).slice(0, 5);
    if (!terms.length) return;
    const quota = await getSerpQuota();
    if (quota && quota.remaining != null && quota.remaining < terms.length) return;
    for (const term of terms) {
        try {
            const params = new URLSearchParams({ engine: 'google_news', q: term, gl: 'fr', hl: 'fr', api_key: process.env.SERPAPI_KEY });
            const r = await fetch('https://serpapi.com/search.json?' + params, { signal: AbortSignal.timeout(20000) });
            const d = await r.json();
            const articles = (d.news_results || []).slice(0, 8).map(a => ({
                title: (a.title || '').slice(0, 140), source: a.source?.name || a.source || '', link: a.link, date: a.date || null,
            }));
            const prev = db.get('newsChecks').value().filter(x => x.term === term).slice(-1)[0];
            const prevLinks = new Set((prev?.articles || []).map(a => a.link));
            const fresh = articles.filter(a => !prevLinks.has(a.link));
            db.get('newsChecks').push({ id: nextId('newsChecks'), date: now().slice(0, 10), term, articles }).write();
            if (prev && fresh.length) {
                push.notifyAll({ title: '📰 Actu détectée', body: `« ${term} » : ${fresh.length} nouvel article${fresh.length > 1 ? 's' : ''} — ${fresh[0].title.slice(0, 70)}`, tag: 'news-' + term }).catch(() => {});
            }
        } catch (err) { console.error('News:', term, err.message); }
    }
}
cron.schedule('0 8 * * 2', () => {
    runNewsCheck().catch(err => console.error('Erreur News:', err.message));
}, { timezone: 'Europe/Paris' });
app.get('/api/news-checks', auth, (req, res) => {
    res.json({ enabled: Boolean(process.env.SERPAPI_KEY), checks: db.get('newsChecks').value() || [] });
});
app.post('/api/news-run', auth, adminOnly, async (req, res) => {
    if (!process.env.SERPAPI_KEY) return res.status(400).json({ error: 'Ajoute la variable SERPAPI_KEY sur Railway' });
    await runNewsCheck();
    res.json({ ok: true, checks: db.get('newsChecks').value() || [] });
});

/* ============================================================
   A/B TEST DU HERO — le site affiche la variante A ou B (50/50),
   le dashboard mesure laquelle convertit le mieux.
   ============================================================ */
app.get('/api/ab-stats', auth, (req, res) => {
    const leads = db.get('leads').value();
    const stats = { A: { leads: 0, won: 0 }, B: { leads: 0, won: 0 } };
    leads.forEach(l => {
        const v = l.tracking?.abVariant;
        if (v !== 'A' && v !== 'B') return;
        stats[v].leads++;
        if (l.status === 'won') stats[v].won++;
    });
    const taglineB = (db.get('site_content').value()?.hero?.taglineB) || '';
    res.json({ active: Boolean(taglineB), stats });
});

/* ============================================================
   BLOG & PUBLICATION FTP — écrit directement sur florian-b.fr (OVH)
   ============================================================ */
app.get('/api/publish/status', auth, (req, res) => {
    res.json({ ftpConfigured: ftpPub.isConfigured(), siteUrl: publisher.SITE_URL });
});
app.post('/api/publish/test', auth, adminOnly, async (req, res) => {
    res.json(await ftpPub.testConnection());
});

app.get('/api/blog', auth, (req, res) => res.json(db.get('blogPosts').value() || []));
app.post('/api/blog', auth, canWrite, (req, res) => {
    const { title, excerpt, content, coverUrl } = req.body || {};
    if (!title) return res.status(400).json({ error: 'Titre requis' });
    let slug = publisher.slugify(title);
    // Slug unique
    const existing = db.get('blogPosts').value() || [];
    if (existing.some(p => p.slug === slug)) slug = slug + '-' + (existing.length + 1);
    const post = {
        id: nextId('blogPosts'), created_at: now(),
        title, slug, excerpt: excerpt || '', content: content || '', coverUrl: coverUrl || '',
        status: 'draft', publishedAt: null,
    };
    db.get('blogPosts').push(post).write();
    res.status(201).json(post);
});
app.patch('/api/blog/:id', auth, canWrite, (req, res) => {
    const id = Number(req.params.id);
    const post = db.get('blogPosts').find({ id }).value();
    if (!post) return res.status(404).json({ error: 'Article introuvable' });
    const { title, excerpt, content, coverUrl } = req.body || {};
    const patch = {};
    if (title !== undefined) patch.title = title;
    if (excerpt !== undefined) patch.excerpt = excerpt;
    if (content !== undefined) patch.content = content;
    if (coverUrl !== undefined) patch.coverUrl = coverUrl;
    db.get('blogPosts').find({ id }).assign(patch).write();
    res.json(db.get('blogPosts').find({ id }).value());
});
app.delete('/api/blog/:id', auth, canWrite, async (req, res) => {
    const id = Number(req.params.id);
    const post = db.get('blogPosts').find({ id }).value();
    if (!post) return res.status(404).json({ error: 'Article introuvable' });
    // Si publié, on retire aussi la page du site (puis on republie l'index)
    if (post.status === 'published' && ftpPub.isConfigured()) {
        try { await ftpPub.deletePath('blog/' + post.slug); } catch {}
    }
    db.get('blogPosts').remove({ id }).write();
    if (post.status === 'published' && ftpPub.isConfigured()) {
        try {
            const posts = db.get('blogPosts').value() || [];
            await ftpPub.uploadFiles([{ remotePath: 'blog/index.html', content: publisher.blogIndexHtml(posts) }]);
        } catch {}
    }
    logTeamAction(req, 'other', `Article de blog supprimé : ${post.title}`, id);
    res.json({ ok: true });
});

// Publication : article + index du blog + sitemap fusionné, en un clic
app.post('/api/blog/:id/publish', auth, adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    const post = db.get('blogPosts').find({ id }).value();
    if (!post) return res.status(404).json({ error: 'Article introuvable' });
    if (!post.content || !post.excerpt) return res.status(400).json({ error: 'Ajoute le contenu et la meta-description (résumé) avant de publier — c\'est essentiel pour le SEO' });
    try {
        db.get('blogPosts').find({ id }).assign({ status: 'published', publishedAt: post.publishedAt || now() }).write();
        const fresh = db.get('blogPosts').find({ id }).value();
        const posts = db.get('blogPosts').value() || [];
        const blogUrls = posts.filter(p => p.status === 'published').map(p => `${publisher.SITE_URL}/blog/${p.slug}/`);
        const sitemap = await publisher.mergedSitemap([`${publisher.SITE_URL}/blog/`, ...blogUrls]);
        // Image de partage générée automatiquement (si le module sharp est dispo)
        const ogPng = await publisher.ogImagePng(fresh.title, fresh.excerpt).catch(() => null);
        const files = [
            { remotePath: `blog/${fresh.slug}/index.html`, content: publisher.blogArticleHtml(fresh, Boolean(ogPng)) },
            { remotePath: 'blog/index.html', content: publisher.blogIndexHtml(posts) },
            { remotePath: 'sitemap.xml', content: sitemap },
        ];
        if (ogPng) files.push({ remotePath: `blog/${fresh.slug}/og.png`, content: ogPng });
        await ftpPub.uploadFiles(files);
        logTeamAction(req, 'other', `Article publié sur le site : ${fresh.title}`, id);
        res.json({ ok: true, url: `${publisher.SITE_URL}/blog/${fresh.slug}/` });
    } catch (err) {
        // La publication a échoué : on remet en brouillon pour rester cohérent
        db.get('blogPosts').find({ id }).assign({ status: 'draft' }).write();
        res.status(500).json({ error: 'Publication échouée : ' + err.message });
    }
});

// Pages projets SEO générées depuis les cartes du theme builder
app.post('/api/publish/project-pages', auth, adminOnly, async (req, res) => {
    const content = db.get('site_content').value() || {};
    const cards = (content.projects || []).filter(c => c.title);
    if (!cards.length) return res.status(400).json({ error: 'Aucune carte projet dans "Contenu du site"' });
    const descriptions = req.body?.descriptions || {}; // { "project-1": "texte..." }
    try {
        const files = [];
        const urls = [];
        for (const card of cards) {
            const slug = publisher.slugify(card.title);
            files.push({ remotePath: `projets/${slug}/index.html`, content: publisher.projectPageHtml(card, descriptions[card.id] || card.seoDescription || '') });
            urls.push(`${publisher.SITE_URL}/projets/${slug}/`);
        }
        files.push({ remotePath: 'sitemap.xml', content: await publisher.mergedSitemap(urls) });
        await ftpPub.uploadFiles(files);
        logTeamAction(req, 'other', `${cards.length} pages projets publiées sur le site`);
        res.json({ ok: true, count: cards.length, urls });
    } catch (err) {
        res.status(500).json({ error: 'Publication échouée : ' + err.message });
    }
});

/* ============================================================
   DISPONIBILITÉS RDV — pilote le calendrier de créneaux du site
   Configurable dans "Mon entreprise" ; les jours fériés français
   et les créneaux déjà confirmés sont exclus automatiquement.
   ============================================================ */
app.get('/api/rdv-availability', (req, res) => {
    const b = db.get('businessSettings').value() || {};
    const year = new Date().getFullYear();
    const holidayDates = [...frenchHolidays(year), ...frenchHolidays(year + 1)].map(h => h.date);
    const blockedDates = String(b.rdvBlockedDates || '')
        .split(/[\n,;]+/).map(x => x.trim()).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
    // Créneaux déjà pris : RDV confirmés à venir
    const bookedSlots = db.get('appointments').value()
        .filter(a => a.status === 'confirmed' && a.confirmedDate && new Date(a.confirmedDate) > new Date())
        .map(a => {
            const d = new Date(a.confirmedDate);
            return { date: d.toISOString().slice(0, 10), hour: d.getHours() };
        });
    res.set('Cache-Control', 'no-store');
    res.json({
        openHour: Number(b.rdvOpenHour) || 9,
        closeHour: Number(b.rdvCloseHour) || 19,
        closedWeekdays: Array.isArray(b.rdvClosedWeekdays) ? b.rdvClosedWeekdays : [0], // dimanche par défaut
        blockedDates: [...new Set([...holidayDates, ...blockedDates])],
        bookedSlots,
    });
});

/* ============================================================
   RENTABILITÉ PAR PROJET — heures loguées × factures payées du client
   ============================================================ */
app.get('/api/projects-profitability', auth, (req, res) => {
    const projects = db.get('projects').value();
    const logs = db.get('timeLogs').value();
    const invoices = db.get('invoices').value();
    const result = projects.map(p => {
        const minutes = logs.filter(t => t.projectId === p.id).reduce((s, t) => s + (t.minutes || 0), 0);
        const paid = invoices.filter(i => i.clientEmail === p.clientEmail && i.status === 'paid').reduce((s, i) => s + (i.total || 0), 0);
        const hours = minutes / 60;
        return {
            id: p.id, name: p.name, clientEmail: p.clientEmail, stage: p.stage,
            hours: Math.round(hours * 10) / 10, revenue: paid,
            hourlyRate: hours > 0 ? Math.round(paid / hours) : null,
        };
    }).filter(x => x.hours > 0 || x.revenue > 0);
    res.json(result);
});

/* ============================================================
   ONBOARDING CLIENT AUTOMATIQUE — après acceptation d'un devis :
   projet créé automatiquement + questionnaire de brief envoyé au client
   ============================================================ */
function briefToken(id) {
    return crypto.createHmac('sha256', JWT_SECRET).update('brief-' + id).digest('hex').slice(0, 32);
}
const BRIEF_QUESTIONS = [
    { key: 'objectif', label: 'Quel est l\'objectif principal de ce projet ?' },
    { key: 'cible', label: 'À qui s\'adresse-t-il ? (votre public, vos clients)' },
    { key: 'references', label: 'Des références ou inspirations que vous aimez ? (liens bienvenus)' },
    { key: 'contraintes', label: 'Contraintes à connaître ? (délais, couleurs imposées, formats...)' },
    { key: 'autres', label: 'Autre chose à me dire ?' },
];
function onboardAfterQuoteAccepted(quote) {
    const base = process.env.DASHBOARD_URL || '';
    // Crée le projet s'il n'y en a pas déjà un actif pour ce client
    let project = db.get('projects').value().find(p => p.clientEmail === quote.clientEmail && p.stage !== 'livre');
    if (!project) {
        const template = db.get('projectChecklistTemplate').value() || [];
        project = {
            id: nextId('projects'), created_at: now(), leadId: null,
            name: quote.clientName ? `Projet ${quote.clientName}` : `Projet devis ${quote.quoteNumber || '#' + quote.id}`,
            clientEmail: quote.clientEmail, stage: 'brief', notes: `Créé automatiquement à l'acceptation du devis ${quote.quoteNumber || '#' + quote.id}.`,
            checklist: template.map(label => ({ label, done: false })),
            deliveredAt: null, satisfactionRequestedAt: null, reviewRequestedAt: null, anniversarySentAt: null,
        };
        db.get('projects').push(project).write();
    }
    // Questionnaire de brief par email (si l'URL publique est configurée)
    if (base) {
        const briefUrl = `${base}/brief/${project.id}?token=${briefToken(project.id)}`;
        mailer.sendMail({
            to: quote.clientEmail,
            subject: 'On démarre ! Quelques questions pour bien cadrer votre projet — Florian B.',
            html: `<!DOCTYPE html><html><body style="margin:0;padding:32px 16px;background:#0a0a0a;font-family:-apple-system,'Segoe UI',Arial,sans-serif;">
                <div style="max-width:520px;margin:0 auto;background:#141414;border:1px solid #262626;border-radius:16px;padding:32px;">
                <p style="font-family:Arial,sans-serif;font-weight:800;color:#ff2f76;letter-spacing:1px;font-size:12px;text-transform:uppercase;margin:0 0 16px;">Florian B. — Studio</p>
                <h1 style="color:#f5f5f5;font-size:20px;margin:0 0 12px;">Merci pour votre confiance ! 🙌</h1>
                <p style="color:#9a9a9a;font-size:14px;line-height:1.6;margin:0 0 20px;">Votre devis est accepté, on peut démarrer. Pour cadrer le projet au mieux, j'ai préparé <strong style="color:#f5f5f5;">5 questions rapides</strong> (2 minutes) :</p>
                <p style="margin:0 0 24px;"><a href="${briefUrl}" style="display:inline-block;background:linear-gradient(135deg,#da2c48,#ff2f76);color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;">Répondre au questionnaire de brief →</a></p>
                <p style="color:#666;font-size:12px;line-height:1.5;margin:0;">Vous préférez en parler de vive voix ? Répondez simplement à cet email.</p>
                </div></body></html>`,
            meta: { type: 'other', relatedId: project.id },
        }).catch(() => {});
    }
    push.notifyAll({ title: '🎉 Devis accepté', body: `${quote.clientName || quote.clientEmail} — projet créé + brief envoyé automatiquement`, url: '/dashboard', tag: 'quote-accepted-' + quote.id }).catch(() => {});
}
app.get('/brief/:id', (req, res) => {
    const id = Number(req.params.id);
    const p = db.get('projects').find({ id }).value();
    if (!p || (req.query.token || '') !== briefToken(id)) return res.status(404).send('Lien invalide.');
    res.set('Content-Type', 'text/html');
    res.set('X-Robots-Tag', 'noindex');
    res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex">
<title>Brief de projet — Florian B.</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0;}body{background:#0a0a0a;color:#f5f5f5;font-family:'Inter',sans-serif;padding:2rem 1.2rem 4rem;}
.wrap{max-width:560px;margin:0 auto;}h1{font-family:'Syne',sans-serif;font-size:1.5rem;margin:0.4rem 0 0.3rem;}
.brand{font-family:'Syne',sans-serif;font-weight:800;color:#ff2f76;letter-spacing:0.5px;font-size:0.8rem;text-transform:uppercase;}
.sub{color:#9a9a9a;font-size:0.9rem;margin-bottom:1.8rem;}label{display:block;font-size:0.85rem;font-weight:600;margin:1.2rem 0 0.4rem;}
textarea{width:100%;min-height:80px;background:#141414;border:1px solid #2a2a2a;border-radius:10px;color:#f5f5f5;padding:0.8rem;font-family:inherit;font-size:0.9rem;resize:vertical;}
button{margin-top:1.6rem;width:100%;padding:0.9rem;border:none;border-radius:10px;background:linear-gradient(135deg,#da2c48,#ff2f76);color:#fff;font-weight:600;font-size:0.95rem;cursor:pointer;}
.done{display:none;color:#22c55e;margin-top:1.5rem;font-size:0.95rem;}</style></head><body><div class="wrap">
<div class="brand">Florian B. — Studio</div>
<h1>Brief de votre projet</h1>
<p class="sub">5 questions rapides pour bien démarrer « ${(p.name || '').replace(/</g, '&lt;')} ». Répondez librement, tout est utile !</p>
<form id="f">
${BRIEF_QUESTIONS.map(q => `<label>${q.label}</label><textarea name="${q.key}"></textarea>`).join('')}
<button type="submit">Envoyer mon brief ✔️</button>
</form>
<p class="done" id="done">✅ Merci ! Florian a bien reçu votre brief et revient vers vous rapidement.</p>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
        await fetch('/api/brief/${id}?token=${briefToken(id)}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        document.getElementById('f').style.display = 'none';
        document.getElementById('done').style.display = 'block';
    } catch { alert("Une erreur est survenue, réessayez ou répondez par email."); }
});
</script></div></body></html>`);
});
app.post('/api/brief/:id', (req, res) => {
    const id = Number(req.params.id);
    const p = db.get('projects').find({ id }).value();
    if (!p || (req.query.token || '') !== briefToken(id)) return res.status(404).json({ error: 'Lien invalide' });
    const answers = req.body || {};
    const text = BRIEF_QUESTIONS
        .map(q => answers[q.key] ? `• ${q.label}\n${String(answers[q.key]).slice(0, 2000)}` : null)
        .filter(Boolean).join('\n\n');
    if (text) {
        const notes = (p.notes ? p.notes + '\n\n' : '') + `— BRIEF CLIENT (${new Date().toLocaleDateString('fr-FR')}) —\n` + text;
        db.get('projects').find({ id }).assign({ notes, briefAnsweredAt: now() }).write();
    }
    push.notifyAll({ title: '📋 Brief reçu', body: `Le client de « ${p.name} » a répondu au questionnaire — tout est dans les notes du projet`, url: '/dashboard', tag: 'brief-' + id }).catch(() => {});
    res.json({ ok: true });
});

/* ============================================================
   VEILLE CONCURRENTIELLE — surveille des sites (1x/jour) et notifie
   quand leur contenu change. URLs configurées dans "Mon entreprise".
   ============================================================ */
async function runCompetitorWatch() {
    const b = db.get('businessSettings').value() || {};
    const urls = String(b.watchUrls || '').split(/[\n,;]+/).map(x => x.trim()).filter(x => /^https?:\/\//.test(x)).slice(0, 10);
    if (!urls.length) return;
    const sites = db.get('watchSites').value() || [];
    for (const url of urls) {
        try {
            const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FBWatch/1.0)' } });
            const html = await r.text();
            // On ne garde que le texte visible (les scripts/styles changent tout le temps)
            const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            const hash = crypto.createHash('sha256').update(text).digest('hex');
            const existing = sites.find(x => x.url === url);
            if (!existing) {
                db.get('watchSites').push({ url, hash, lastChecked: now(), lastChanged: null }).write();
            } else if (existing.hash !== hash) {
                db.get('watchSites').find({ url }).assign({ hash, lastChecked: now(), lastChanged: now() }).write();
                push.notifyAll({ title: '🕵️ Veille — du nouveau', body: `Le contenu de ${new URL(url).hostname} a changé — va jeter un œil !`, url: '/dashboard', tag: 'watch-' + new URL(url).hostname }).catch(() => {});
            } else {
                db.get('watchSites').find({ url }).assign({ lastChecked: now() }).write();
            }
        } catch { /* site injoignable : on réessaiera demain */ }
    }
    // Nettoie les URLs retirées de la config
    db.get('watchSites').remove(x => !urls.includes(x.url)).write();
}
cron.schedule('0 7 * * *', () => {
    runCompetitorWatch().catch(err => console.error('Erreur veille:', err.message));
}, { timezone: 'Europe/Paris' });
app.get('/api/watch-status', auth, (req, res) => res.json(db.get('watchSites').value() || []));
app.post('/api/watch-run', auth, adminOnly, async (req, res) => {
    await runCompetitorWatch();
    res.json({ ok: true, sites: db.get('watchSites').value() || [] });
});

/* ============================================================
   CHAT IA — le widget du site devient un vrai assistant (API Claude)
   Optionnel : nécessite la variable Railway ANTHROPIC_API_KEY.
   ============================================================ */
const chatRate = new Map(); // anti-abus simple : 30 messages / heure / IP
app.get('/api/chat-status', (req, res) => {
    res.json({ enabled: Boolean(process.env.ANTHROPIC_API_KEY) });
});
app.post('/api/chat', async (req, res) => {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'chat_disabled' });
    const ip = getRealIp(req);
    const nowMs = Date.now();
    const entry = chatRate.get(ip) || { count: 0, resetAt: nowMs + 3600000 };
    if (nowMs > entry.resetAt) { entry.count = 0; entry.resetAt = nowMs + 3600000; }
    if (++entry.count > 30) return res.status(429).json({ error: 'rate_limited' });
    chatRate.set(ip, entry);

    const messages = (Array.isArray(req.body?.messages) ? req.body.messages : [])
        .filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
        .slice(-12)
        .map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));
    if (!messages.length) return res.status(400).json({ error: 'messages requis' });

    const content = db.get('site_content').value() || {};
    const faq = (content.faq || []).map(f => `Q: ${f.q || f.question || ''}\nR: ${f.a || f.answer || ''}`).join('\n');
    const projects = (content.projects || []).map(p => p.title).filter(Boolean).join(', ');
    const system = `Tu es l'assistant du site de Florian Bonnet (florian-b.fr), graphiste et directeur artistique freelance de 23 ans à Paris.
Ton rôle : renseigner les visiteurs et les encourager à laisser un message ou prendre RDV. Réponds en français, chaleureux mais professionnel, en 1 à 3 phrases courtes. Tutoie jamais le visiteur (vouvoiement).
Compétences : branding, UI/UX, print, communication digitale, community management, photo/vidéo, motion. Outils : Figma, suite Adobe complète, WordPress.
Projets notables : ${projects || 'Courtepaille, BNP Paribas, BasicFit, Augmantor, Trustify'}.
Tarifs : pas de prix fixes, chaque projet est sur devis personnalisé — orienter vers le formulaire de contact.
${faq ? 'FAQ du site :\n' + faq.slice(0, 3000) : ''}
Si la question sort du cadre (politique, questions personnelles intrusives, demandes sans rapport), recadre poliment vers les sujets du site. Ne promets jamais de délai ou de prix précis. N'invente rien sur Florian.`;

    try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 300, system, messages }),
            signal: AbortSignal.timeout(20000),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error?.message || 'Erreur API');
        const reply = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
        res.json({ reply: reply || "Je n'ai pas de réponse à ça, mais Florian pourra vous renseigner directement !" });
    } catch (err) {
        console.error('Chat IA:', err.message);
        res.status(502).json({ error: 'chat_error' });
    }
});

/* ============================================================
   PIXEL D'OUVERTURE DES DEVIS — image 1x1 chargée quand le client ouvre l'email
   ============================================================ */
const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
app.get('/api/quotes/:id/open.gif', (req, res) => {
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(PIXEL_GIF); // on répond d'abord, tout le reste est silencieux
    try {
        const id = Number(req.params.id);
        if ((req.query.token || '') !== quoteAcceptToken(id)) return;
        const quote = db.get('quotes').find({ id }).value();
        if (!quote) return;
        const opens = quote.opens || [];
        // Ignore les ouvertures dans l'heure suivant l'envoi si c'est toi qui vérifies ? Non :
        // on garde tout, mais on ne notifie qu'une fois par heure max pour ne pas spammer.
        const lastOpen = opens.length ? new Date(opens[opens.length - 1]) : null;
        opens.push(now());
        db.get('quotes').find({ id }).assign({ opens, firstOpenedAt: quote.firstOpenedAt || now() }).write();
        if (!lastOpen || (Date.now() - lastOpen) > 3600000) {
            push.notifyAll({
                title: '👀 Devis ouvert',
                body: `${quote.clientName || quote.clientEmail} vient d'ouvrir le devis ${quote.quoteNumber || '#' + id}${opens.length > 1 ? ` (${opens.length}ᵉ fois)` : ''} — bon moment pour appeler !`,
                url: '/dashboard', tag: 'quote-open-' + id,
            }).catch(() => {});
        }
    } catch {}
});

/* ============================================================
   SALLE D'ATTENTE CLIENT — page de suivi privée par projet
   Lien signé (non devinable), à envoyer au client : /suivi/:id?token=...
   ============================================================ */
function projectTrackToken(id) {
    return crypto.createHmac('sha256', JWT_SECRET).update('project-track-' + id).digest('hex').slice(0, 32);
}
app.get('/api/projects/:id/track-link', auth, (req, res) => {
    const id = Number(req.params.id);
    if (!db.get('projects').find({ id }).value()) return res.status(404).json({ error: 'Projet introuvable' });
    const base = process.env.DASHBOARD_URL || '';
    res.json({ url: `${base}/suivi/${id}?token=${projectTrackToken(id)}` });
});
const PROJECT_STAGES_PUBLIC = [
    { key: 'brief', label: 'Brief & cadrage' },
    { key: 'maquettes', label: 'Création des maquettes' },
    { key: 'revisions', label: 'Révisions & ajustements' },
    { key: 'livre', label: 'Livraison finale' },
];
app.get('/suivi/:id', (req, res) => {
    const id = Number(req.params.id);
    const p = db.get('projects').find({ id }).value();
    if (!p || (req.query.token || '') !== projectTrackToken(id)) {
        return res.status(404).send('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Lien invalide</title></head><body style="background:#0a0a0a;color:#aaa;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">Ce lien de suivi n\'est pas valide.</body></html>');
    }
    const stageIdx = Math.max(0, PROJECT_STAGES_PUBLIC.findIndex(s => s.key === p.stage));
    const checklist = (p.checklist || []);
    const doneCount = checklist.filter(c => c.done).length;
    const invoices = db.get('invoices').value().filter(i => i.clientEmail === p.clientEmail && ['sent', 'paid', 'overdue'].includes(i.status));
    res.set('Content-Type', 'text/html');
    res.set('X-Robots-Tag', 'noindex');
    res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex">
<title>Suivi de votre projet — Florian B.</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#0a0a0a;--card:#141414;--border:#262626;--text:#f5f5f5;--muted:#9a9a9a;--accent:#da2c48;--accent2:#ff2f76;--ok:#22c55e;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh;padding:2rem 1.2rem 4rem;}
.wrap{max-width:640px;margin:0 auto;}
h1{font-family:'Syne',sans-serif;font-size:1.6rem;margin:0.4rem 0 0.2rem;}
.sub{color:var(--muted);font-size:0.9rem;margin-bottom:2rem;}
.brand{font-family:'Syne',sans-serif;font-weight:800;color:var(--accent2);letter-spacing:0.5px;font-size:0.85rem;text-transform:uppercase;}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:1.4rem;margin-bottom:1.2rem;}
.steps{list-style:none;}
.step{display:flex;gap:0.9rem;padding:0.7rem 0;align-items:flex-start;}
.dot{width:26px;height:26px;border-radius:50%;border:2px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:0.75rem;color:var(--muted);}
.step.done .dot{background:var(--ok);border-color:var(--ok);color:#0a0a0a;font-weight:700;}
.step.current .dot{border-color:var(--accent2);color:var(--accent2);box-shadow:0 0 0 4px rgba(255,47,118,0.15);}
.step .lbl{padding-top:0.2rem;font-size:0.95rem;}
.step.done .lbl{color:var(--muted);}
.step.current .lbl{font-weight:600;}
.badge{display:inline-block;padding:0.25rem 0.7rem;border-radius:20px;font-size:0.72rem;font-weight:600;}
.badge.ok{background:rgba(34,197,94,0.12);color:var(--ok);}
.badge.wait{background:rgba(255,47,118,0.1);color:var(--accent2);}
.row{display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid var(--border);font-size:0.88rem;}
.row:last-child{border-bottom:none;}
.h2{font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:0.8rem;font-weight:600;}
.bar{height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-top:0.6rem;}
.bar>div{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:3px;}
.foot{color:var(--muted);font-size:0.8rem;text-align:center;margin-top:2rem;}
.foot a{color:var(--accent2);text-decoration:none;}
</style></head><body><div class="wrap">
<div class="brand">Florian B. — Studio</div>
<h1>${(p.name || 'Votre projet').replace(/</g, '&lt;')}</h1>
<p class="sub">Suivi en temps réel de l'avancement de votre projet.</p>
<div class="card">
  <div class="h2">Avancement</div>
  <ul class="steps">
    ${PROJECT_STAGES_PUBLIC.map((s, i) => `<li class="step ${i < stageIdx ? 'done' : ''} ${i === stageIdx ? 'current' : ''}"><span class="dot">${i < stageIdx ? '✓' : i + 1}</span><span class="lbl">${s.label}${i === stageIdx && p.stage !== 'livre' ? ' — en cours' : ''}${s.key === 'livre' && p.stage === 'livre' ? ' 🎉' : ''}</span></li>`).join('')}
  </ul>
</div>
${checklist.length ? `<div class="card">
  <div class="h2">Étapes clés — ${doneCount}/${checklist.length}</div>
  ${checklist.map(c => `<div class="row"><span style="${c.done ? 'color:var(--muted);' : ''}">${c.done ? '✅' : '◻️'} ${(c.label || '').replace(/</g, '&lt;')}</span></div>`).join('')}
  <div class="bar"><div style="width:${checklist.length ? Math.round(doneCount / checklist.length * 100) : 0}%;"></div></div>
</div>` : ''}
${invoices.length ? `<div class="card">
  <div class="h2">Facturation</div>
  ${invoices.map(i => `<div class="row"><span>Facture ${i.invoiceNumber}</span><span class="badge ${i.status === 'paid' ? 'ok' : 'wait'}">${i.status === 'paid' ? 'Réglée' : 'En attente'}</span></div>`).join('')}
</div>` : ''}
<p class="foot">Une question ? Écrivez-moi : <a href="mailto:${process.env.SMTP_USER || 'contact@florian-b.fr'}">${process.env.SMTP_USER || 'contact@florian-b.fr'}</a><br>florian-b.fr</p>
</div></body></html>`);
});

/* ============================================================
   DIGEST PUSH DU MATIN — 8h30 : ta journée en une notification
   ============================================================ */
async function sendMorningPushDigest() {
    const leads = db.get('leads').value().filter(l => !l.archived);
    const newLeads = leads.filter(l => l.status === 'new');
    const staleLeads = newLeads.filter(l => (Date.now() - new Date(l.created_at)) > 48 * 3600000);
    const today = new Date().toISOString().slice(0, 10);
    const apptsToday = db.get('appointments').value().filter(a => a.status === 'confirmed' && a.confirmedDate && String(a.confirmedDate).slice(0, 10) === today);
    const overdue = db.get('invoices').value().filter(i => i.status !== 'paid' && i.sent_at && i.dueDate && new Date(i.dueDate) < new Date());
    const parts = [];
    if (newLeads.length) parts.push(`${newLeads.length} lead${newLeads.length > 1 ? 's' : ''} à traiter${staleLeads.length ? ` (dont ${staleLeads.length} depuis +48h ⏰)` : ''}`);
    if (apptsToday.length) parts.push(`${apptsToday.length} RDV aujourd'hui`);
    if (overdue.length) parts.push(`${overdue.length} facture${overdue.length > 1 ? 's' : ''} en retard`);
    if (!parts.length) return; // rien à signaler = pas de notification inutile
    await push.notifyAll({ title: '☀️ Ta journée', body: parts.join(' · '), url: '/dashboard', tag: 'morning-digest' });
}
cron.schedule('30 8 * * *', () => {
    sendMorningPushDigest().catch(err => console.error('Erreur digest push:', err.message));
}, { timezone: 'Europe/Paris' });

// Rapport mensuel automatique — le 1er de chaque mois à 8h (heure de Paris)
cron.schedule('0 8 1 * *', () => {
    console.log('📊 Envoi du rapport mensuel automatique...');
    buildAndSendMonthlyReport().catch(err => console.error('Erreur rapport mensuel:', err.message));
}, { timezone: 'Europe/Paris' });

// Résumé hebdomadaire — chaque lundi à 8h (heure de Paris)
cron.schedule('0 8 * * 1', () => {
    console.log('📅 Envoi du résumé hebdomadaire...');
    buildAndSendWeeklySummary().catch(err => console.error('Erreur résumé hebdomadaire:', err.message));
}, { timezone: 'Europe/Paris' });

// Relances automatiques (devis sans réponse / factures en retard) — tous les jours à 9h,
// seulement si activé dans "Mon entreprise" (désactivé par défaut)
cron.schedule('0 9 * * *', () => {
    runAutoReminders().catch(err => console.error('Erreur relances automatiques:', err.message));
    runAutoLeadFollowUp().catch(err => console.error('Erreur relance auto leads:', err.message));
}, { timezone: 'Europe/Paris' });

// Vérification des alertes analytics — toutes les heures
cron.schedule('0 * * * *', () => {
    checkAnalyticsAlerts().catch(err => console.error('Erreur vérification alertes:', err.message));
}, { timezone: 'Europe/Paris' });

// Brief quotidien — 8h : leads à traiter, RDV du jour, relances suggérées, alertes proactives
cron.schedule('0 8 * * *', () => {
    buildAndSendDailyBrief().catch(err => console.error('Erreur brief quotidien:', err.message));
}, { timezone: 'Europe/Paris' });

// Archivage automatique — 1er de chaque mois à 3h
cron.schedule('0 3 1 * *', () => {
    try { runAutoArchiving(); } catch (err) { console.error('Erreur archivage auto:', err.message); }
}, { timezone: 'Europe/Paris' });

// Rappel de RDV 24h avant — vérifié toutes les heures pour couvrir tous les horaires de RDV
cron.schedule('0 * * * *', async () => {
    try {
        const appts = db.get('appointments').value();
        const in23to25h = appts.filter(a => {
            if (a.status !== 'confirmed' || !a.confirmedDate || a.reminderSentAt) return false;
            const hoursUntil = (new Date(a.confirmedDate) - Date.now()) / 3600000;
            return hoursUntil > 23 && hoursUntil <= 25; // fenêtre d'1h autour de "24h avant", vu le cron horaire
        });
        for (const appt of in23to25h) {
            const result = await mailer.sendMail({ ...mailer.appointmentReminderEmail(appt), meta: { type: 'appointment_reminder', relatedId: appt.id } });
            if (result.sent) db.get('appointments').find({ id: appt.id }).assign({ reminderSentAt: now() }).write();
        }
    } catch (err) { console.error('Erreur rappels RDV:', err.message); }
}, { timezone: 'Europe/Paris' });

// Suivi post-livraison — une fois par jour à 10h : demande d'avis Google (3 jours après
// la livraison) et email d'anniversaire de collaboration (1 an après, une seule fois).
cron.schedule('0 10 * * *', async () => {
    try {
        const business = db.get('businessSettings').value() || {};
        const projects = db.get('projects').value().filter(p => p.stage === 'livre' && p.deliveredAt);
        const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
        const oneYearAgo = new Date(Date.now() - 365 * 86400000);

        for (const p of projects) {
            const delivered = new Date(p.deliveredAt);
            if (business.googleReviewUrl && !p.reviewRequestedAt && delivered <= threeDaysAgo) {
                const r = await mailer.sendMail({ ...mailer.googleReviewRequestEmail(p, business.googleReviewUrl), meta: { type: 'google_review_request', relatedId: p.id } });
                if (r.sent) db.get('projects').find({ id: p.id }).assign({ reviewRequestedAt: now() }).write();
            }
            if (!p.anniversarySentAt && delivered <= oneYearAgo) {
                const r = await mailer.sendMail({ ...mailer.anniversaryEmail(p), meta: { type: 'anniversary', relatedId: p.id } });
                if (r.sent) db.get('projects').find({ id: p.id }).assign({ anniversarySentAt: now() }).write();
            }
        }
    } catch (err) { console.error('Erreur suivi post-livraison:', err.message); }
}, { timezone: 'Europe/Paris' });

app.listen(PORT, () => console.log(`✅ Backend Florian B. sur http://localhost:${PORT}`));
