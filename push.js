/* ============================================================
   NOTIFICATIONS PUSH (iPhone / Android / ordinateur)
   ------------------------------------------------------------
   Utilise le standard "Web Push" : le dashboard installé sur
   l'écran d'accueil de l'iPhone (iOS 16.4+) reçoit une vraie
   notification à chaque nouveau lead ou RDV, même app fermée.

   Les clés VAPID (l'identité du serveur auprès d'Apple/Google)
   sont générées automatiquement au premier démarrage et
   stockées dans db.json — rien à configurer sur Railway.
   ============================================================ */
const webpush = require('web-push');
const db = require('./db');

let ready = false;

function init() {
    let config = db.get('pushConfig').value();
    if (!config || !config.publicKey || !config.privateKey) {
        const keys = webpush.generateVAPIDKeys();
        config = { publicKey: keys.publicKey, privateKey: keys.privateKey, createdAt: new Date().toISOString() };
        db.set('pushConfig', config).write();
        console.log('🔑 Clés VAPID générées et enregistrées (notifications push)');
    }
    const contact = 'mailto:' + (process.env.NOTIFY_EMAIL || process.env.SMTP_USER || 'contact@florian-b.fr');
    webpush.setVapidDetails(contact, config.publicKey, config.privateKey);
    ready = true;
}

function getPublicKey() {
    const config = db.get('pushConfig').value() || {};
    return config.publicKey || null;
}

/* Enregistre (ou met à jour) l'abonnement d'un appareil.
   Un abonnement = un appareil (l'iPhone, le Mac...), identifié par son "endpoint". */
function addSubscription(subscription, user) {
    if (!subscription || !subscription.endpoint) return false;
    const subs = db.get('pushSubscriptions');
    const existing = subs.find({ endpoint: subscription.endpoint }).value();
    const record = {
        endpoint: subscription.endpoint,
        keys: subscription.keys || {},
        userId: user ? user.userId : null,
        userEmail: user ? user.email : null,
        label: subscription.label || null,
        createdAt: existing ? existing.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    if (existing) subs.find({ endpoint: subscription.endpoint }).assign(record).write();
    else subs.push(record).write();
    return true;
}

function removeSubscription(endpoint) {
    if (!endpoint) return;
    db.get('pushSubscriptions').remove({ endpoint }).write();
}

function countSubscriptions() {
    return db.get('pushSubscriptions').value().length;
}

/* Envoie une notification à TOUS les appareils abonnés.
   Les abonnements morts (app désinstallée, permission retirée)
   renvoient 404/410 → on les supprime automatiquement. */
async function notifyAll({ title, body, url = '/dashboard/', tag = null }) {
    if (!ready) return { sent: 0 };
    const subs = db.get('pushSubscriptions').value();
    if (!subs.length) return { sent: 0 };

    const payload = JSON.stringify({ title, body, url, tag });
    let sent = 0;
    await Promise.all(subs.map(async (sub) => {
        try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: 3600 });
            sent++;
        } catch (err) {
            if (err.statusCode === 404 || err.statusCode === 410) removeSubscription(sub.endpoint);
            else console.error('Push KO:', err.statusCode || err.message);
        }
    }));
    return { sent };
}

module.exports = { init, getPublicKey, addSubscription, removeSubscription, countSubscriptions, notifyAll };
