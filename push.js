// push.js — Notifications push (iPhone / Android / desktop) pour le dashboard
// Les clés VAPID sont générées automatiquement au premier démarrage et
// stockées dans db.json → aucune variable Railway à ajouter.

const webpush = require('web-push');
const db = require('./db');

function ensureVapidKeys() {
    let keys = db.get('pushVapidKeys').value();
    if (!keys || !keys.publicKey || !keys.privateKey) {
        keys = webpush.generateVAPIDKeys();
        db.set('pushVapidKeys', keys).write();
        console.log('🔑 Clés VAPID générées et enregistrées dans la base');
    }
    webpush.setVapidDetails(
        'mailto:' + (process.env.NOTIFY_EMAIL || process.env.SMTP_USER || 'contact@florian-b.fr'),
        keys.publicKey,
        keys.privateKey
    );
    return keys;
}

function getPublicKey() {
    return ensureVapidKeys().publicKey;
}

function addSubscription(sub, label) {
    if (!sub || !sub.endpoint) return false;
    const existing = db.get('pushSubscriptions').find({ endpoint: sub.endpoint }).value();
    if (existing) {
        db.get('pushSubscriptions').find({ endpoint: sub.endpoint })
            .assign({ subscription: sub, label: label || existing.label, updated_at: new Date().toISOString() }).write();
    } else {
        db.get('pushSubscriptions').push({
            endpoint: sub.endpoint,
            subscription: sub,
            label: label || 'Appareil',
            created_at: new Date().toISOString(),
        }).write();
    }
    return true;
}

function removeSubscription(endpoint) {
    db.get('pushSubscriptions').remove({ endpoint }).write();
}

// Envoie une notif à tous les appareils enregistrés.
// Les abonnements expirés (410/404) sont supprimés automatiquement.
async function notifyAll({ title, body, url, tag }) {
    ensureVapidKeys();
    const subs = db.get('pushSubscriptions').value() || [];
    if (!subs.length) return { sent: 0 };
    const payload = JSON.stringify({ title, body, url: url || '/dashboard', tag: tag || 'florianb' });
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
        try {
            await webpush.sendNotification(s.subscription, payload);
            sent++;
        } catch (err) {
            if (err.statusCode === 404 || err.statusCode === 410) {
                removeSubscription(s.endpoint);
            } else {
                console.error('Push error:', err.statusCode || err.message);
            }
        }
    }));
    return { sent };
}

function listSubscriptions() {
    return (db.get('pushSubscriptions').value() || []).map(s => ({
        endpoint: s.endpoint.slice(0, 60) + '…',
        label: s.label,
        created_at: s.created_at,
    }));
}

module.exports = { getPublicKey, addSubscription, removeSubscription, notifyAll, listSubscriptions };
