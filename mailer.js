const nodemailer = require('nodemailer');

/* ============================================================
   ENVOI D'EMAILS — via la boîte mail OVH contact@florian-b.fr
   Configuration SMTP standard OVH. Le mot de passe est celui
   de la boîte mail (pas celui du manager OVH), à renseigner
   dans la variable d'environnement SMTP_PASSWORD.
   ============================================================ */
let transporter = null;

function getTransporter() {
    if (transporter) return transporter;
    if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) return null;
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'ssl0.ovh.net',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false, // TLS via STARTTLS sur le port 587
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
        },
    });
    return transporter;
}

async function sendMail({ to, subject, html, replyTo }) {
    const t = getTransporter();
    if (!t) {
        console.warn('⚠️  SMTP non configuré (SMTP_USER / SMTP_PASSWORD manquants) — email non envoyé:', subject);
        return { sent: false, reason: 'smtp_not_configured' };
    }
    try {
        await t.sendMail({
            from: `"Florian B." <${process.env.SMTP_USER}>`,
            to,
            subject,
            html,
            replyTo: replyTo || undefined,
        });
        return { sent: true };
    } catch (err) {
        console.error('❌ Échec envoi email:', err.message);
        return { sent: false, reason: err.message };
    }
}

/* ---- Templates ---- */

function leadConfirmationEmail(lead) {
    return {
        to: lead.email,
        subject: 'Votre message a bien été reçu — Florian B.',
        html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
                <h2 style="color: #da2c48;">Merci ${lead.name || ''} !</h2>
                <p>Votre message a bien été reçu. Florian vous répondra sous 24 à 48h.</p>
                <p style="background:#f5f5f5; padding:1rem; border-radius:8px; font-style:italic;">"${lead.message}"</p>
                <p>À très vite,<br><strong>Florian B.</strong><br>Graphiste & Directeur Artistique</p>
            </div>
        `,
    };
}

function leadNotificationEmail(lead) {
    return {
        to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
        subject: `🔔 Nouveau lead : ${lead.name || lead.email}`,
        html: `
            <div style="font-family: sans-serif;">
                <h3>Nouveau message reçu</h3>
                <p><strong>Nom :</strong> ${lead.name || '(non renseigné)'}</p>
                <p><strong>Email :</strong> ${lead.email}</p>
                <p><strong>Message :</strong><br>${lead.message}</p>
                <p><strong>Source :</strong> ${lead.source}</p>
            </div>
        `,
        replyTo: lead.email,
    };
}

function appointmentConfirmationEmail(appt) {
    return {
        to: appt.email,
        subject: 'Votre demande de rendez-vous — Florian B.',
        html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
                <h2 style="color: #da2c48;">Demande de RDV reçue</h2>
                <p>Florian confirmera votre créneau sous peu :</p>
                <p style="background:#f5f5f5; padding:1rem; border-radius:8px;">
                    📅 ${appt.date_text || 'À définir'}<br>
                    🕐 ${appt.time_text || 'À définir'}<br>
                    📝 ${appt.subject}
                </p>
                <p>À très vite,<br><strong>Florian B.</strong></p>
            </div>
        `,
    };
}

function appointmentNotificationEmail(appt) {
    return {
        to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
        subject: `📅 Nouvelle demande de RDV : ${appt.email}`,
        html: `
            <div style="font-family: sans-serif;">
                <h3>Nouvelle demande de rendez-vous</h3>
                <p><strong>Email :</strong> ${appt.email}</p>
                <p><strong>Date souhaitée :</strong> ${appt.date_text || '—'}</p>
                <p><strong>Heure :</strong> ${appt.time_text || '—'}</p>
                <p><strong>Sujet :</strong> ${appt.subject}</p>
            </div>
        `,
        replyTo: appt.email,
    };
}

module.exports = {
    sendMail,
    leadConfirmationEmail,
    leadNotificationEmail,
    appointmentConfirmationEmail,
    appointmentNotificationEmail,
};
