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
        port: Number(process.env.SMTP_PORT) || 465,
        secure: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) === 465 : true, // SSL/TLS sur le port 465 (standard OVH Zimbra)
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

/* ============================================================
   TEMPLATE DE MARQUE — reprend les couleurs et le style du site
   (fond sombre, rouge accent #da2c48, wordmark "FLORIAN B.")
   Compatible clients mail (styles inline, pas de CSS externe).
   ============================================================ */
function brandEmailWrapper(innerHtml, { preheader = '' } = {}) {
    return `
<!DOCTYPE html>
<html lang="fr">
<body style="margin:0; padding:0; background:#0a0a0a; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <span style="display:none; max-height:0; overflow:hidden; opacity:0;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a; padding:32px 16px;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background:#141414; border:1px solid #262626; border-radius:16px; overflow:hidden;">
                    <tr>
                        <td style="padding:32px 32px 24px; border-bottom:1px solid #262626;">
                            <span style="font-family:Georgia,'Times New Roman',serif; font-weight:700; font-size:22px; letter-spacing:0.5px; color:#ffffff;">FLORIAN B<span style="color:#da2c48;">.</span></span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:32px; color:#e5e5e5; font-size:15px; line-height:1.65;">
                            ${innerHtml}
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:20px 32px; background:#0f0f0f; border-top:1px solid #262626;">
                            <p style="margin:0; color:#777; font-size:12px;">Florian Bonnet — Graphiste & Directeur Artistique, Paris</p>
                            <p style="margin:4px 0 0; color:#555; font-size:12px;"><a href="https://florian-b.fr" style="color:#da2c48; text-decoration:none;">florian-b.fr</a></p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

function brandButton(label, url) {
    return `<a href="${url}" style="display:inline-block; margin-top:20px; padding:12px 24px; background:#da2c48; color:#ffffff; text-decoration:none; border-radius:100px; font-weight:700; font-size:13px; text-transform:uppercase; letter-spacing:0.5px;">${label}</a>`;
}

/* ---- Templates ---- */

function leadConfirmationEmail(lead) {
    return {
        to: lead.email,
        subject: 'Votre message a bien été reçu — Florian B.',
        html: brandEmailWrapper(`
            <p style="margin:0 0 16px; font-size:20px; font-weight:700; color:#ffffff;">Merci ${lead.name || ''} !</p>
            <p style="margin:0 0 16px;">Votre message a bien été reçu. Je reviens vers vous sous 24 à 48h.</p>
            <div style="margin:20px 0; padding:16px; background:#1c1c1c; border-left:3px solid #da2c48; border-radius:8px; font-style:italic; color:#bbb;">
                "${lead.message}"
            </div>
            <p style="margin:20px 0 0;">À très vite,<br><strong style="color:#fff;">Florian B.</strong><br><span style="color:#888; font-size:13px;">Graphiste & Directeur Artistique</span></p>
        `, { preheader: 'Merci pour votre message, je reviens vers vous rapidement.' }),
    };
}

function leadNotificationEmail(lead) {
    return {
        to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
        subject: `🔔 Nouveau lead : ${lead.name || lead.email}`,
        html: brandEmailWrapper(`
            <p style="margin:0 0 16px; font-size:18px; font-weight:700; color:#fff;">Nouveau message reçu</p>
            <p style="margin:0 0 8px;"><span style="color:#888;">Nom :</span> ${lead.name || '(non renseigné)'}</p>
            <p style="margin:0 0 8px;"><span style="color:#888;">Email :</span> ${lead.email}</p>
            <p style="margin:0 0 8px;"><span style="color:#888;">Source :</span> ${lead.source}</p>
            <div style="margin:16px 0; padding:16px; background:#1c1c1c; border-radius:8px;">${lead.message}</div>
        `),
        replyTo: lead.email,
    };
}

function appointmentConfirmationEmail(appt) {
    return {
        to: appt.email,
        subject: 'Votre demande de rendez-vous — Florian B.',
        html: brandEmailWrapper(`
            <p style="margin:0 0 16px; font-size:20px; font-weight:700; color:#ffffff;">Demande de RDV reçue</p>
            <p style="margin:0 0 16px;">Je confirme votre créneau sous peu :</p>
            <div style="margin:20px 0; padding:16px; background:#1c1c1c; border-radius:8px;">
                <p style="margin:0 0 6px;">📅 ${appt.date_text || 'À définir'}</p>
                <p style="margin:0 0 6px;">🕐 ${appt.time_text || 'À définir'}</p>
                <p style="margin:0;">📝 ${appt.subject}</p>
            </div>
            <p style="margin:20px 0 0;">À très vite,<br><strong style="color:#fff;">Florian B.</strong></p>
        `, { preheader: 'Votre demande de rendez-vous a bien été reçue.' }),
    };
}

function appointmentNotificationEmail(appt) {
    return {
        to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
        subject: `📅 Nouvelle demande de RDV : ${appt.email}`,
        html: brandEmailWrapper(`
            <p style="margin:0 0 16px; font-size:18px; font-weight:700; color:#fff;">Nouvelle demande de rendez-vous</p>
            <p style="margin:0 0 8px;"><span style="color:#888;">Email :</span> ${appt.email}</p>
            <p style="margin:0 0 8px;"><span style="color:#888;">Date souhaitée :</span> ${appt.date_text || '—'}</p>
            <p style="margin:0 0 8px;"><span style="color:#888;">Heure :</span> ${appt.time_text || '—'}</p>
            <p style="margin:0 0 8px;"><span style="color:#888;">Sujet :</span> ${appt.subject}</p>
        `),
        replyTo: appt.email,
    };
}

// Réponse manuelle depuis le dashboard — le message est saisi par Florian,
// habillé automatiquement avec le design de marque.
function leadReplyEmail(lead, message) {
    return {
        to: lead.email,
        subject: 'Re : votre message — Florian B.',
        html: brandEmailWrapper(`
            <div style="white-space:pre-wrap;">${message}</div>
            <p style="margin:24px 0 0;">Florian B.<br><span style="color:#888; font-size:13px;">Graphiste & Directeur Artistique</span></p>
        `),
        replyTo: process.env.SMTP_USER,
    };
}

module.exports = {
    sendMail,
    leadConfirmationEmail,
    leadNotificationEmail,
    appointmentConfirmationEmail,
    appointmentNotificationEmail,
    leadReplyEmail,
};
