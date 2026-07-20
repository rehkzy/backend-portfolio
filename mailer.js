/* ============================================================
   ENVOI D'EMAILS — via l'API Brevo (HTTPS)
   ============================================================ */
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

function isMailerConfigured() {
    return Boolean(process.env.BREVO_API_KEY && process.env.SENDER_EMAIL);
}

const db = require('./db');

function logEmail({ to, subject, sent, messageId, error, meta = {} }) {
    try {
        const entry = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            to, subject, sent, messageId: messageId || null, error: error || null,
            type: meta.type || 'other', relatedId: meta.relatedId ?? null,
            sentAt: new Date().toISOString(),
        };
        db.get('emailLog').push(entry).write();
        const logs = db.get('emailLog').value();
        if (logs.length > 3000) db.set('emailLog', logs.slice(logs.length - 3000)).write();
    } catch (e) { console.error('Erreur log email:', e.message); }
}

async function sendMail({ to, subject, html, replyTo, attachments, meta }) {
    if (!isMailerConfigured()) {
        console.warn('⚠️  Brevo non configuré (BREVO_API_KEY / SENDER_EMAIL manquants) — email non envoyé:', subject);
        logEmail({ to, subject, sent: false, error: 'smtp_not_configured', meta });
        return { sent: false, reason: 'smtp_not_configured' };
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        let res;
        try {
            res = await fetch(BREVO_API_URL, {
                method: 'POST',
                headers: {
                    'api-key': process.env.BREVO_API_KEY,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    sender: { name: process.env.SENDER_NAME || 'Florian B.', email: process.env.SENDER_EMAIL },
                    to: [{ email: to }],
                    subject,
                    htmlContent: html,
                    ...(replyTo ? { replyTo: { email: replyTo } } : {}),
                    ...(attachments && attachments.length ? { attachment: attachments } : {}),
                    // Tracking activé — nécessaire pour remonter les statuts ouverture/clic dans le dashboard.
                    trackClicks: true,
                    trackOpens: true,
                }),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
        }
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.message || `Erreur Brevo (${res.status})`);
        }
        const data = await res.json().catch(() => ({}));
        logEmail({ to, subject, sent: true, messageId: data.messageId, meta });
        return { sent: true, messageId: data.messageId };
    } catch (err) {
        console.error('❌ Échec envoi email:', err.message);
        let reason = err.message;
        if (err.name === 'AbortError') reason = 'Délai dépassé (20s) — Brevo ne répond pas';
        logEmail({ to, subject, sent: false, error: reason, meta });
        return { sent: false, reason };
    }
}

/* ============================================================
   SYSTÈME DE DESIGN — Florian B. Email Identity 2026
   ─────────────────────────────────────────────────────────
   Principes :
   · Fond sombre #0a0a0a natif (pas de forçage dark-mode)
   · Typo display : Georgia/serif pour le wordmark (imite Syne)
   · Typo corps : system-ui stack pour la lisibilité universelle
   · Accent : #da2c48 (rouge-rose signature)
   · Hiérarchie forte : grande typo titre, espaces généreux
   · 1 seule animation CSS légère par email (GIF-like keyframes)
   · Blocs modulaires réutilisables
   · Compatible Gmail, Apple Mail, Outlook, Yahoo
   ============================================================ */

/* ---------- COULEURS ---------- */
const C = {
    bg:        '#0a0a0a',
    card:      '#111111',
    cardBorder:'#1e1e1e',
    surface:   '#181818',
    accent:    '#da2c48',
    accentDim: '#3d0f17',
    text:      '#f0f0f0',
    textMuted: '#888888',
    textDim:   '#555555',
    separator: '#242424',
    white:     '#ffffff',
};

/* ---------- WRAPPER PRINCIPAL ---------- */
function emailWrapper(innerHtml, { preheader = '', accentLine = true } = {}) {
    return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>Florian B.</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @keyframes fadeUp {
    from { opacity:0; transform:translateY(12px); }
    to   { opacity:1; transform:translateY(0);    }
  }
  @keyframes fadeIn {
    from { opacity:0; }
    to   { opacity:1; }
  }
  .anim-fadeup { animation: fadeUp 0.6s ease 0.15s forwards; opacity:0; }
  .anim-fadein { animation: fadeIn 0.8s ease 0.05s forwards; opacity:0; }
  .btn-main:hover { opacity:0.88 !important; }
  @media only screen and (max-width:600px) {
    .email-card  { border-radius:0 !important; }
    .email-pad   { padding:28px 20px !important; }
    .email-title { font-size:26px !important; }
    .hero-fb     { font-size:34px !important; }
    .stat-val    { font-size:28px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%;mso-line-height-rule:exactly;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;font-size:1px;color:${C.bg};">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};min-height:100vh;">
  <tr><td align="center" style="padding:40px 16px 60px;">

    <!-- CARD -->
    <table role="presentation" class="email-card" cellpadding="0" cellspacing="0" border="0"
      style="max-width:560px;width:100%;background:${C.card};border:1px solid ${C.cardBorder};border-radius:20px;overflow:hidden;mso-border-alt:none;">

      <!-- LIGNE ACCENT TOP -->
      ${accentLine ? `<tr><td style="height:3px;background:linear-gradient(90deg,${C.accent},#ff5478);font-size:0;line-height:0;">&nbsp;</td></tr>` : ''}

      <!-- HERO / SIGNATURE DE MARQUE -->
      <tr>
        <td align="center" style="padding:44px 32px 30px;background:${C.card};background-color:${C.card};border-bottom:1px solid ${C.separator};">
          <img src="https://florian-b.fr/assets/florian-b-fb-animation.gif" width="230" height="56" alt="Florian B." style="display:block;margin:0 auto;border:0;outline:none;max-width:230px;height:auto;">
          <p style="margin:14px 0 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:2.2px;text-transform:uppercase;color:${C.textMuted};">
            Les pixels sont nos atomes créatifs
          </p>
        </td>
      </tr>

      <!-- CONTENU -->
      <tr>
        <td class="email-pad anim-fadeup" style="padding:40px 44px;color:${C.text};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.7;">
          ${innerHtml}
        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td style="padding:24px 44px 32px;border-top:1px solid ${C.separator};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:12px;color:${C.textDim};line-height:1.6;">
                <strong style="color:${C.textMuted};">Florian Bonnet</strong><br>
                Graphiste &amp; Directeur Artistique · Paris<br>
                <a href="mailto:contact@florian-b.fr" style="color:${C.textDim};text-decoration:none;">contact@florian-b.fr</a>
              </td>
              <td align="right" valign="middle">
                <a href="https://florian-b.fr" style="font-family:'Syne',Georgia,'Times New Roman',serif;font-size:14px;font-weight:700;letter-spacing:0.3px;color:${C.accent};text-decoration:none;">florian-b.fr →</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

    </table>
    <!-- /CARD -->

  </td></tr>
</table>
</body>
</html>`;
}

/* ---------- COMPOSANTS RÉUTILISABLES ---------- */

// Titre principal de l'email
function emailTitle(text) {
    return `<p class="email-title" style="margin:0 0 24px;font-family:'Syne',Georgia,'Times New Roman',serif;font-size:32px;font-weight:700;color:${C.white};line-height:1.25;letter-spacing:-0.5px;">${text}</p>`;
}

// Bouton CTA principal
function emailCTA(label, url) {
    return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
  <tr>
    <td style="border-radius:100px;background:${C.accent};">
      <a class="btn-main" href="${url}"
        style="display:inline-block;padding:14px 32px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:700;color:${C.white};text-decoration:none;border-radius:100px;text-transform:uppercase;letter-spacing:0.8px;mso-padding-alt:0;transition:opacity 0.2s;">
        ${label}
      </a>
    </td>
  </tr>
</table>`;
}

// Bloc citation / message du client
function emailQuote(text) {
    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr>
    <td style="padding:20px 24px;background:${C.surface};border-left:3px solid ${C.accent};border-radius:0 12px 12px 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;font-style:italic;color:#c0c0c0;line-height:1.7;">
      « ${text} »
    </td>
  </tr>
</table>`;
}

// Bloc de données structurées (label / valeur)
function emailDataBlock(rows) {
    const rowsHtml = rows.map(([label, value], i) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid ${C.separator};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:13px;color:${C.textMuted};white-space:nowrap;padding-right:24px;">${label}</td>
      <td style="padding:12px 0;border-bottom:1px solid ${C.separator};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:13px;color:${C.white};font-weight:600;text-align:right;">${value}</td>
    </tr>`).join('');
    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  ${rowsHtml}
</table>`;
}

// Carte KPI / stat (grosse valeur mise en avant)
function emailStatCard(value, label, note = '') {
    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;">
  <tr>
    <td style="padding:24px;background:${C.accentDim};border:1px solid ${C.accent}33;border-radius:14px;text-align:center;">
      <div class="stat-val" style="font-family:'Syne',Georgia,'Times New Roman',serif;font-size:36px;font-weight:700;color:${C.accent};line-height:1;">${value}</div>
      <div style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:12px;color:${C.textMuted};margin-top:6px;text-transform:uppercase;letter-spacing:1px;">${label}</div>
      ${note ? `<div style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:11px;color:${C.textDim};margin-top:4px;">${note}</div>` : ''}
    </td>
  </tr>
</table>`;
}

// Grille 2 colonnes de stats (mobile: stack)
function emailStatGrid(stats) {
    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr>
    ${stats.map((s, i) => `
    <td width="${Math.floor(100 / stats.length)}%" style="padding:${i > 0 ? '0 0 0 8px' : '0'};vertical-align:top;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding:20px 16px;background:${C.surface};border:1px solid ${C.separator};border-radius:12px;text-align:center;">
            <div style="font-family:'Syne',Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;color:${C.white};line-height:1;">${s.value}</div>
            <div style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:11px;color:${C.textMuted};margin-top:5px;text-transform:uppercase;letter-spacing:0.8px;">${s.label}</div>
          </td>
        </tr>
      </table>
    </td>`).join('')}
  </tr>
</table>`;
}

// Badge de rôle
function emailRoleBadge(role) {
    const labels = { admin: 'Administrateur', redacteur: 'Rédacteur', lecteur: 'Lecteur' };
    return `<span style="display:inline-block;padding:4px 12px;background:${C.accentDim};border:1px solid ${C.accent}55;border-radius:100px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:11px;font-weight:700;color:${C.accent};text-transform:uppercase;letter-spacing:0.8px;">${labels[role] || role}</span>`;
}

// Ligne de séparation stylée
function emailDivider() {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;"><tr><td style="height:1px;background:${C.separator};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
}

// Texte signature
function emailSignature(name = 'Florian B.') {
    return `
<p style="margin:28px 0 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;color:${C.textMuted};line-height:1.6;">
  À bientôt,<br>
  <strong style="color:${C.white};font-size:15px;">${name}</strong><br>
  <span style="font-size:12px;color:${C.textDim};">Graphiste &amp; Directeur Artistique · Paris</span>
</p>`;
}

/* ============================================================
   TABLE DEVIS / FACTURE
   ============================================================ */
function quoteItemsHtml(items, forEmail = true) {
    const bg    = forEmail ? C.surface    : '#f9f9f9';
    const sep   = forEmail ? C.separator  : '#ebebeb';
    const mutd  = forEmail ? C.textMuted  : '#888';
    const main  = forEmail ? C.white      : '#111';
    const rows = (items || []).map(i => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid ${sep};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;color:${main};">${i.desc || ''}</td>
      <td style="padding:12px 0;border-bottom:1px solid ${sep};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;color:${mutd};text-align:center;">${i.qty || 0}</td>
      <td style="padding:12px 0;border-bottom:1px solid ${sep};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;color:${mutd};text-align:right;">${(Number(i.price) || 0).toFixed(2)} €</td>
      <td style="padding:12px 0;border-bottom:1px solid ${sep};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;color:${main};font-weight:700;text-align:right;">${((Number(i.qty)||0)*(Number(i.price)||0)).toFixed(2)} €</td>
    </tr>`).join('');
    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;border-collapse:collapse;">
  <thead>
    <tr>
      <th style="padding:0 0 10px;text-align:left;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:${mutd};border-bottom:1px solid ${sep};">Prestation</th>
      <th style="padding:0 0 10px;text-align:center;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:${mutd};border-bottom:1px solid ${sep};">Qté</th>
      <th style="padding:0 0 10px;text-align:right;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:${mutd};border-bottom:1px solid ${sep};">P.U.</th>
      <th style="padding:0 0 10px;text-align:right;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:${mutd};border-bottom:1px solid ${sep};">Total</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

function quoteTotalRow(total, forEmail = true) {
    return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">
  <tr>
    <td style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:13px;color:${forEmail ? C.textMuted : '#888'};text-transform:uppercase;letter-spacing:0.8px;">Total</td>
    <td style="text-align:right;">
      <span style="font-family:'Syne',Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;color:${forEmail ? C.white : '#0a0a0a'};">${(total || 0).toFixed(2)} <span style="font-size:16px;">€</span></span>
    </td>
  </tr>
</table>`;
}

/* ============================================================
   TEMPLATES
   ============================================================ */

/* — 1. Confirmation lead (client) — */
function leadConfirmationEmail(lead) {
    return {
        to: lead.email,
        subject: `Votre message est bien reçu — Florian B.`,
        html: emailWrapper(`
            ${emailTitle(`Merci${lead.name ? `, ${lead.name.split(' ')[0]}` : ''} !`)}
            <p style="margin:0 0 20px;color:${C.textMuted};font-size:15px;">Votre message a bien atterri dans ma boîte. Je reviens vers vous <strong style="color:${C.white};">sous 24 à 48h</strong>.</p>
            ${emailQuote(lead.message)}
            ${emailDivider()}
            <p style="margin:0;font-size:13px;color:${C.textDim};">En attendant, jetez un œil à mon portfolio :</p>
            ${emailCTA('Voir florian-b.fr', 'https://florian-b.fr')}
            ${emailSignature()}
        `, { preheader: `Merci${lead.name ? ` ${lead.name}` : ''} — je reviens vers vous sous 24-48h.` }),
    };
}

/* — 2. Notification nouveau lead (interne) — */
function leadNotificationEmail(lead) {
    return {
        to: process.env.NOTIFY_EMAIL || process.env.SENDER_EMAIL,
        subject: `🔔 Nouveau lead — ${lead.name || lead.email}`,
        html: emailWrapper(`
            ${emailTitle('Nouveau message reçu')}
            ${emailDataBlock([
                ['Nom', lead.name || '—'],
                ['Email', lead.email],
                ['Source', lead.source || '—'],
                ['Budget indiqué', lead.budget || '—'],
                ['Client', lead.isReturningClient ? '🔁 Client déjà connu' : 'Nouveau contact'],
                ['Reçu le', new Date().toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })],
            ])}
            ${emailQuote(lead.message)}
            ${emailCTA('Répondre dans le dashboard', (process.env.DASHBOARD_URL || 'https://florian-b.fr') + '/dashboard')}
        `, { preheader: `Nouveau lead de ${lead.name || lead.email}` }),
        replyTo: lead.email,
    };
}

/* — 3. Confirmation RDV (client) — */
function appointmentConfirmationEmail(appt) {
    return {
        to: appt.email,
        subject: `Demande de rendez-vous reçue — Florian B.`,
        html: emailWrapper(`
            ${emailTitle('Votre demande est enregistrée')}
            <p style="margin:0 0 24px;color:${C.textMuted};">Je confirme votre créneau dans les plus brefs délais. Voici ce que j'ai reçu :</p>
            ${emailDataBlock([
                ['📅 Date souhaitée', appt.date_text || 'À définir'],
                ['🕐 Heure', appt.time_text || 'À définir'],
                ['📋 Sujet', appt.subject],
            ])}
            ${emailDivider()}
            <p style="margin:0;font-size:13px;color:${C.textDim};">Un email de confirmation suivra dès que le créneau est validé de mon côté.</p>
            ${emailSignature()}
        `, { preheader: 'Votre demande de rendez-vous a bien été reçue.' }),
    };
}

/* — 3bis. Rappel RDV 24h avant (client) — */
function appointmentReminderEmail(appt) {
    const dateLabel = appt.confirmedDate
        ? new Date(appt.confirmedDate).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
        : `${appt.date_text || ''} à ${appt.time_text || ''}`;
    return {
        to: appt.email,
        subject: `Rappel — RDV demain avec Florian B.`,
        html: emailWrapper(`
            ${emailTitle('À demain !')}
            <p style="margin:0 0 24px;color:${C.textMuted};">Petit rappel : votre rendez-vous avec Florian est prévu <strong style="color:${C.white};">${dateLabel}</strong>, au sujet de « ${appt.subject || ''} ».</p>
            <p style="margin:0;font-size:14px;color:${C.textMuted};">Un empêchement ? Répondez directement à cet email pour le décaler.</p>
            ${emailSignature()}
        `, { preheader: `Rappel RDV — ${dateLabel}` }),
    };
}

/* — 4. Notification RDV (interne) — */
function appointmentNotificationEmail(appt) {
    return {
        to: process.env.NOTIFY_EMAIL || process.env.SENDER_EMAIL,
        subject: `📅 Nouveau RDV — ${appt.email}`,
        html: emailWrapper(`
            ${emailTitle('Nouvelle demande de RDV')}
            ${emailDataBlock([
                ['Email', appt.email],
                ['Date souhaitée', appt.date_text || '—'],
                ['Heure', appt.time_text || '—'],
                ['Sujet', appt.subject],
            ])}
            ${emailCTA('Voir dans le dashboard', (process.env.DASHBOARD_URL || 'https://florian-b.fr') + '/dashboard')}
        `, { preheader: `Nouvelle demande de RDV de ${appt.email}` }),
        replyTo: appt.email,
    };
}

/* — 5. Réponse manuelle à un lead (depuis le dashboard) — */
function leadReplyEmail(lead, message) {
    return {
        to: lead.email,
        subject: `Re : votre message — Florian B.`,
        html: emailWrapper(`
            ${emailTitle(`Bonjour${lead.name ? ` ${lead.name.split(' ')[0]}` : ''} 👋`)}
            <div style="white-space:pre-wrap;font-size:15px;color:${C.text};line-height:1.75;">${message}</div>
            ${emailSignature()}
        `, { preheader: 'Florian B. vous répond.' }),
        replyTo: process.env.SENDER_EMAIL,
    };
}

/* — 5bis. Relance automatique d'un lead sans réponse (opt-in, "Mon entreprise") — */
function leadFollowUpEmail(lead) {
    return {
        to: lead.email,
        subject: `Toujours partant·e pour votre projet ?`,
        html: emailWrapper(`
            ${emailTitle(`Bonjour${lead.name ? ` ${lead.name.split(' ')[0]}` : ''} 👋`)}
            <p style="font-size:15px;color:${C.text};line-height:1.75;">
                Je me permets de revenir vers vous suite à votre message — je n'ai pas eu de retour de votre côté,
                et je voulais simplement m'assurer qu'il ne s'était pas perdu dans les mails.
            </p>
            <p style="font-size:15px;color:${C.text};line-height:1.75;">
                Si votre projet est toujours d'actualité, je suis disponible pour en discuter quand vous voulez.
                Sinon, pas de souci, n'hésitez pas à me le dire — je ne vous relancerai pas davantage.
            </p>
            ${emailSignature()}
        `, { preheader: 'Un petit mot pour prendre des nouvelles de votre projet.' }),
        replyTo: process.env.SENDER_EMAIL,
    };
}

/* — 6. Invitation équipe — */
const ROLE_LABELS = { admin: 'Administrateur', redacteur: 'Rédacteur', lecteur: 'Lecteur' };

function teamInviteEmail(user, inviteToken) {
    if (!process.env.DASHBOARD_URL) {
        console.warn("⚠️  DASHBOARD_URL non configuré — le lien d'invitation sera invalide.");
    }
    const dashboardOrigin = (process.env.DASHBOARD_URL || '').replace(/\/$/, '');
    const link = `${dashboardOrigin}/dashboard/#invite=${inviteToken}`;
    return {
        to: user.email,
        subject: `Invitation au dashboard — Florian B.`,
        html: emailWrapper(`
            ${emailTitle('Vous êtes invité·e')}
            <p style="margin:0 0 20px;color:${C.textMuted};">Florian vous donne accès à son dashboard avec le rôle :</p>
            <p style="margin:0 0 28px;">${emailRoleBadge(user.role)}</p>
            <p style="margin:0 0 4px;color:${C.textMuted};font-size:14px;">Cliquez ci-dessous pour définir votre mot de passe et accéder au dashboard :</p>
            ${emailCTA('Activer mon compte', link)}
            ${emailDivider()}
            <p style="margin:0;font-size:12px;color:${C.textDim};">Ce lien expire dans <strong style="color:${C.textMuted};">7 jours</strong>. Si le bouton ne fonctionne pas, copiez cette URL :<br>
            <span style="word-break:break-all;color:${C.textDim};">${link}</span></p>
        `, { preheader: `Florian B. vous invite à rejoindre son dashboard — rôle : ${ROLE_LABELS[user.role] || user.role}` }),
    };
}

/* — 7. Devis client — */
function quoteEmail(quote, acceptToken = null) {
    const acceptUrl = acceptToken
        ? `${process.env.DASHBOARD_URL || ''}/api/quotes/${quote.id}/accept?token=${acceptToken}`
        : null;
    return {
        to: quote.clientEmail,
        subject: `Devis ${quote.quoteNumber || ''} — ${quote.clientName || 'Votre projet'} — Florian B.`,
        html: emailWrapper(`
            ${emailTitle('Votre devis')}
            <p style="margin:0 0 24px;color:${C.textMuted};">Bonjour ${quote.clientName || ''},<br>Voici la proposition détaillée pour votre projet — vous la trouverez également en pièce jointe (PDF), prête à archiver.</p>
            ${emailDataBlock([
                ['N° de devis', quote.quoteNumber || `#${quote.id}`],
                ['Valable jusqu\'au', quote.validUntil ? new Date(quote.validUntil).toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' }) : '—'],
            ])}
            ${quoteItemsHtml(quote.items, true)}
            ${quoteTotalRow(quote.total, true)}
            ${quote.notes ? `${emailDivider()}<p style="margin:0;font-size:14px;color:${C.textMuted};font-style:italic;">${quote.notes}</p>` : ''}
            ${emailDivider()}
            ${acceptUrl ? `${emailCTA("✅ J'accepte ce devis", acceptUrl)}<p style="margin:16px 0 0;font-size:12px;color:${C.textDim};">En cliquant, votre facture est générée automatiquement — Florian revient vers vous pour la suite.</p>` : ''}
            ${emailDivider()}
            <p style="margin:0;font-size:14px;color:${C.textMuted};">Des questions ? Répondez directement à cet email, je suis là.</p>
            ${emailSignature()}
        `, { preheader: `Devis ${quote.quoteNumber || ''} — Total ${(quote.total||0).toFixed(2)} €` }),
    };
}

/* — 7bis. Devis accepté par le client (interne) — */
function quoteAcceptedEmail(quote, invoice) {
    const dashUrl = (process.env.DASHBOARD_URL || 'https://florian-b.fr') + '/dashboard';
    return {
        to: process.env.NOTIFY_EMAIL || process.env.SENDER_EMAIL,
        subject: `🎉 Devis accepté — ${quote.clientName || quote.clientEmail}`,
        html: emailWrapper(`
            ${emailTitle('Un client a accepté son devis !')}
            <p style="margin:0 0 24px;color:${C.textMuted};"><strong style="color:${C.white};">${quote.clientName || quote.clientEmail}</strong> a accepté le devis de ${(quote.total||0).toFixed(2)} €. Une facture (${invoice.invoiceNumber}) a été créée automatiquement en brouillon — vérifie-la puis envoie-la depuis le dashboard.</p>
            ${emailCTA('Voir la facture', dashUrl)}
        `, { preheader: `${quote.clientName || quote.clientEmail} a accepté son devis` }),
    };
}

/* — 8bis-b. Devis brouillon auto-généré (interne) — un lead vient de passer en "Gagné" */
function quoteDraftReadyEmail(quote, lead) {
    const dashUrl = (process.env.DASHBOARD_URL || 'https://florian-b.fr') + '/dashboard';
    return {
        to: process.env.NOTIFY_EMAIL || process.env.SENDER_EMAIL,
        subject: `📝 Devis brouillon prêt — ${lead.name || lead.email}`,
        html: emailWrapper(`
            ${emailTitle('Un devis brouillon t\'attend')}
            <p style="margin:0 0 24px;color:${C.textMuted};">Le lead <strong style="color:${C.white};">${lead.name || lead.email}</strong> vient de passer en "Gagné". Un devis brouillon (${quote.quoteNumber}) a été pré-rempli pour te faire gagner du temps — complète-le et vérifie les lignes avant de l'envoyer, rien n'est parti au client pour l'instant.</p>
            ${emailCTA('Compléter le devis', dashUrl)}
        `, { preheader: `Devis brouillon ${quote.quoteNumber} à compléter` }),
    };
}

/* — 8. Facture client — */
function invoiceEmail(invoice, business = {}) {
    return {
        to: invoice.clientEmail,
        subject: `Facture ${invoice.invoiceNumber} — Florian B.`,
        html: emailWrapper(`
            ${emailTitle(`Facture n°${invoice.invoiceNumber}`)}
            <p style="margin:0 0 24px;color:${C.textMuted};">Bonjour ${invoice.clientName || ''},<br>Veuillez trouver ci-joint votre facture officielle au format PDF, à conserver pour votre comptabilité. Le détail ci-dessous en résume le contenu.</p>
            ${quoteItemsHtml(invoice.items, true)}
            ${quoteTotalRow(invoice.total, true)}
            ${business.iban ? `${emailDivider()}<p style="margin:0;font-size:13px;color:${C.textMuted};">Règlement par virement :<br><strong style="color:${C.white};font-family:monospace;">${business.iban}</strong></p>` : ''}
            ${emailDivider()}
            <p style="margin:0;font-size:14px;color:${C.textMuted};">Merci pour votre confiance.</p>
            ${emailSignature(business.legalName || 'Florian B.')}
        `, { preheader: `Facture ${invoice.invoiceNumber} — Total ${(invoice.total||0).toFixed(2)} €` }),
    };
}

/* — 8bis. Relance devis (client) — */
function quoteReminderEmail(quote) {
    return {
        to: quote.clientEmail,
        subject: `Petit rappel — votre devis — Florian B.`,
        html: emailWrapper(`
            ${emailTitle('Toujours partant(e) ?')}
            <p style="margin:0 0 24px;color:${C.textMuted};">Bonjour ${quote.clientName || ''},<br>Je me permets de revenir vers vous au sujet du devis envoyé récemment (à nouveau joint en PDF) — il reste disponible si vous souhaitez donner suite.</p>
            ${quoteItemsHtml(quote.items, true)}
            ${quoteTotalRow(quote.total, true)}
            ${emailDivider()}
            <p style="margin:0;font-size:14px;color:${C.textMuted};">Une question, un ajustement à faire ? Répondez directement à cet email.</p>
            ${emailSignature()}
        `, { preheader: `Relance devis — Total ${(quote.total||0).toFixed(2)} €` }),
    };
}

/* — 8ter. Relance facture impayée (client) — */
function invoiceReminderEmail(invoice, business = {}) {
    return {
        to: invoice.clientEmail,
        subject: `Rappel — Facture ${invoice.invoiceNumber} en attente de règlement`,
        html: emailWrapper(`
            ${emailTitle('Facture en attente')}
            <p style="margin:0 0 24px;color:${C.textMuted};">Bonjour ${invoice.clientName || ''},<br>Sauf erreur de ma part, la facture n°${invoice.invoiceNumber} n'a pas encore été réglée (à nouveau jointe en PDF). Voici son détail :</p>
            ${quoteItemsHtml(invoice.items, true)}
            ${quoteTotalRow(invoice.total, true)}
            ${business.iban ? `${emailDivider()}<p style="margin:0;font-size:13px;color:${C.textMuted};">Règlement par virement :<br><strong style="color:${C.white};font-family:monospace;">${business.iban}</strong></p>` : ''}
            ${emailDivider()}
            <p style="margin:0;font-size:14px;color:${C.textMuted};">Si le règlement a déjà été effectué, merci de ne pas tenir compte de ce message.</p>
            ${emailSignature(business.legalName || 'Florian B.')}
        `, { preheader: `Rappel facture ${invoice.invoiceNumber} — ${(invoice.total||0).toFixed(2)} €` }),
    };
}

/* — 8quater. Digest quotidien des relances suggérées (interne) — */
function remindersDigestEmail({ quotesToRemind, invoicesOverdue }) {
    const dashUrl = (process.env.DASHBOARD_URL || 'https://florian-b.fr') + '/dashboard';
    const rows = [];
    quotesToRemind.forEach(q => rows.push([`Devis — ${q.clientName || q.clientEmail}`, `${(q.total||0).toFixed(2)} € · envoyé le ${new Date(q.sent_at).toLocaleDateString('fr-FR')}`]));
    invoicesOverdue.forEach(i => rows.push([`Facture ${i.invoiceNumber} — ${i.clientName || i.clientEmail}`, `${(i.total||0).toFixed(2)} € · échue le ${new Date(i.dueDate).toLocaleDateString('fr-FR')}`]));
    return {
        to: process.env.NOTIFY_EMAIL || process.env.SENDER_EMAIL,
        subject: `À relancer aujourd'hui — ${rows.length} élément${rows.length > 1 ? 's' : ''}`,
        html: emailWrapper(`
            ${emailTitle('Tes relances du jour')}
            <p style="margin:0 0 24px;color:${C.textMuted};">${quotesToRemind.length} devis sans réponse depuis plus de 5 jours et ${invoicesOverdue.length} facture(s) en retard de paiement.</p>
            ${emailDataBlock(rows)}
            ${emailCTA('Ouvrir le dashboard', dashUrl)}
        `, { preheader: `${rows.length} relance(s) suggérée(s)` }),
    };
}

/* — 8quinquies. Brief quotidien (interne) — "Aujourd'hui" par email, 8h */
function dailyBriefEmail({ newLeadsToProcess, apptsToday, quotesToRemind, invoicesOverdue, alerts }) {
    const dashUrl = (process.env.DASHBOARD_URL || 'https://florian-b.fr') + '/dashboard';
    const dateLabel = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const statsRow = [
        { value: String(newLeadsToProcess), label: 'Leads à traiter' },
        { value: String(apptsToday.length), label: "RDV aujourd'hui" },
        { value: String(quotesToRemind.length + invoicesOverdue.length), label: 'À relancer' },
    ];
    const apptsRows = apptsToday.map(a => [a.subject || 'RDV', new Date(a.confirmedDate).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })]);
    return {
        to: process.env.NOTIFY_EMAIL || process.env.SENDER_EMAIL,
        subject: `☀️ Ton brief du ${dateLabel}`,
        html: emailWrapper(`
            ${emailTitle('Bonjour Florian')}
            <p style="margin:0 0 24px;color:${C.textMuted};text-transform:capitalize;">${dateLabel}</p>
            ${emailStatGrid(statsRow)}
            ${apptsRows.length ? `${emailDivider()}<p style="margin:0 0 12px;font-size:13px;font-weight:700;color:${C.white};text-transform:uppercase;letter-spacing:0.8px;">RDV du jour</p>${emailDataBlock(apptsRows)}` : ''}
            ${alerts && alerts.length ? `${emailDivider()}<p style="margin:0 0 12px;font-size:13px;font-weight:700;color:${C.accent};text-transform:uppercase;letter-spacing:0.8px;">⚠️ À surveiller</p>${alerts.map(a => `<p style="margin:0 0 8px;font-size:13px;color:${C.textMuted};">${a}</p>`).join('')}` : ''}
            ${emailDivider()}
            ${emailCTA('Ouvrir le dashboard', dashUrl)}
        `, { preheader: `${newLeadsToProcess} leads · ${apptsToday.length} RDV · ${quotesToRemind.length + invoicesOverdue.length} relance(s)` }),
    };
}

/* — 8sexies. Enquête de satisfaction (client) — envoyée à la livraison d'un projet — */
function satisfactionSurveyEmail(project, token) {
    const base = (process.env.DASHBOARD_URL || '') + `/api/projects/${project.id}/rate?token=${token}&score=`;
    const stars = [1, 2, 3, 4, 5].map(n => `<a href="${base}${n}" style="text-decoration:none;font-size:26px;margin:0 4px;">${'⭐'.repeat(n)}</a>`).join('');
    return {
        to: project.clientEmail,
        subject: `Votre avis compte — projet livré !`,
        html: emailWrapper(`
            ${emailTitle('Projet livré 🎉')}
            <p style="margin:0 0 24px;color:${C.textMuted};">Bonjour, votre projet « ${project.name} » vient d'être marqué comme livré. J'espère que le résultat vous plaît !</p>
            <p style="margin:0 0 16px;color:${C.textMuted};">Une note en un clic m'aiderait beaucoup :</p>
            <div style="text-align:center;margin:20px 0;">${stars}</div>
            <p style="margin:20px 0 0;font-size:13px;color:${C.textDim};">Un souci, une retouche à prévoir ? Répondez simplement à cet email.</p>
            ${emailSignature()}
        `, { preheader: 'Une note en un clic sur votre projet livré' }),
    };
}

/* — 8septies. Demande d'avis Google (client) — envoyée quelques jours après livraison — */
function googleReviewRequestEmail(project, googleReviewUrl) {
    return {
        to: project.clientEmail,
        subject: `Un avis Google, ça vous dit ?`,
        html: emailWrapper(`
            ${emailTitle('Un petit coup de pouce ?')}
            <p style="margin:0 0 24px;color:${C.textMuted};">Bonjour, j'espère que vous êtes toujours satisfait(e) du résultat sur « ${project.name} ». Si vous avez deux minutes, un avis Google m'aiderait énormément à me faire connaître.</p>
            ${emailCTA('Laisser un avis Google', googleReviewUrl)}
            <p style="margin:20px 0 0;font-size:13px;color:${C.textDim};">Merci infiniment pour votre soutien 🙏</p>
            ${emailSignature()}
        `, { preheader: 'Un avis Google m\'aiderait beaucoup' }),
    };
}

/* — 8octies. Anniversaire de collaboration (client) — 1 an après livraison — */
function anniversaryEmail(project) {
    return {
        to: project.clientEmail,
        subject: `Ça fait déjà 1 an !`,
        html: emailWrapper(`
            ${emailTitle('Un an déjà 🎂')}
            <p style="margin:0 0 24px;color:${C.textMuted};">Bonjour, ça fait tout juste un an que nous avons travaillé ensemble sur « ${project.name} ». J'espère que tout se passe bien de votre côté !</p>
            <p style="margin:0 0 24px;color:${C.textMuted};">Si un coup de neuf ou un nouveau projet vous trotte dans la tête, n'hésitez pas à revenir vers moi — ce serait un plaisir de retravailler ensemble.</p>
            ${emailSignature()}
        `, { preheader: 'Un an après notre collaboration' }),
    };
}

/* — 8noniens. Résumé hebdomadaire (interne) — le lundi matin */
function weeklySummaryEmail({ newLeads, newLeadsPrevWeek, wonThisWeek, revenueThisWeek }) {
    const weekLabel = `Semaine du ${new Date(Date.now() - 6 * 86400000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
    const delta = newLeadsPrevWeek > 0 ? Math.round(((newLeads - newLeadsPrevWeek) / newLeadsPrevWeek) * 100) : null;
    const deltaLabel = delta === null ? '' : delta >= 0 ? ` (+${delta}% vs semaine dernière)` : ` (${delta}% vs semaine dernière)`;
    const statsRow = [
        { value: String(newLeads), label: 'Nouveaux leads' + deltaLabel },
        { value: String(wonThisWeek), label: 'Projets gagnés' },
    ];
    return {
        to: process.env.NOTIFY_EMAIL || process.env.SENDER_EMAIL,
        subject: `Ta semaine en résumé — ${newLeads} lead${newLeads > 1 ? 's' : ''}`,
        html: emailWrapper(`
            ${emailTitle('Ta semaine en résumé')}
            <p style="margin:0 0 28px;color:${C.textMuted};font-size:13px;text-transform:uppercase;letter-spacing:1px;">${weekLabel}</p>
            ${emailStatGrid(statsRow)}
            ${emailStatCard(revenueThisWeek.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €', 'Encaissé cette semaine')}
            ${emailDivider()}
            <p style="margin:0;font-size:12px;color:${C.textDim};">Résumé généré automatiquement chaque lundi matin. Le rapport détaillé arrive le 1er du mois.</p>
        `, { preheader: `${newLeads} nouveaux leads cette semaine` }),
    };
}

/* — 9. Rapport mensuel (interne) — */
function monthlyReportEmail({ newLeads, wonLeads, revenue, visitors }) {
    const monthName = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const convRate  = newLeads > 0 ? Math.round((wonLeads / newLeads) * 100) : 0;
    const statsRow  = [
        { value: String(newLeads), label: 'Nouveaux leads' },
        { value: String(wonLeads), label: 'Projets gagnés' },
        { value: `${convRate}%`, label: 'Taux de conversion' },
    ];
    return {
        to: process.env.NOTIFY_EMAIL || process.env.SENDER_EMAIL,
        subject: `Rapport mensuel — ${monthName}`,
        html: emailWrapper(`
            ${emailTitle(`Ton mois en résumé`)}
            <p style="margin:0 0 28px;color:${C.textMuted};font-size:13px;text-transform:uppercase;letter-spacing:1px;">${monthName}</p>
            ${emailStatGrid(statsRow)}
            ${emailStatCard(revenue.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €', 'Chiffre d\'affaires encaissé')}
            ${visitors !== null ? emailStatCard(String(visitors), 'Visiteurs actifs', '30 derniers jours') : ''}
            ${emailDivider()}
            <p style="margin:0;font-size:12px;color:${C.textDim};">Rapport généré automatiquement le 1er de chaque mois.</p>
        `, { preheader: `Ton résumé de ${monthName} — ${newLeads} leads · ${revenue.toFixed(0)} €` }),
    };
}

/* — 10. Alerte analytics (interne) — */
const GOAL_METRIC_LABELS = { activeUsers: 'visiteurs', sessions: 'sessions', pageViews: 'pages vues' };

function analyticsAlertEmail(alert, value) {
    const metricLabel    = GOAL_METRIC_LABELS[alert.metric] || alert.metric;
    const conditionLabel = alert.condition === 'above' ? 'dépassé' : 'passé en dessous de';
    const dashUrl        = (process.env.DASHBOARD_URL || 'https://florian-b.fr') + '/dashboard';
    return {
        to: alert.notifyEmail || process.env.NOTIFY_EMAIL || process.env.SENDER_EMAIL,
        subject: `Alerte — ${metricLabel} ${conditionLabel} ${alert.threshold}`,
        html: emailWrapper(`
            ${emailTitle('Alerte déclenchée')}
            <p style="margin:0 0 24px;color:${C.textMuted};">Le nombre de <strong style="color:${C.white};">${metricLabel}</strong> aujourd'hui a <strong style="color:${C.white};">${conditionLabel}</strong> ton seuil de <strong style="color:${C.white};">${alert.threshold}</strong>.</p>
            ${emailStatCard(String(value), metricLabel + ' aujourd\'hui')}
            ${emailCTA('Voir le dashboard', dashUrl)}
        `, { preheader: `${metricLabel} : ${value} — seuil ${alert.threshold} ${conditionLabel}` }),
    };
}

/* ============================================================
   PAGES HTML IMPRIMABLES (devis / factures)
   Fond blanc pour l'impression — design cohérent
   ============================================================ */
function quoteHtmlPage(quote, business = {}) {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Devis — ${quote.clientName || ''}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, sans-serif; background: #fff; color: #111; max-width: 740px; margin: 48px auto; padding: 0 24px 80px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 24px; margin-bottom: 32px; border-bottom: 2px solid #111; }
  .logo { font-family: 'Syne', Georgia, serif; font-size: 22px; font-weight: 800; letter-spacing: 0.5px; }
  .logo span { color: #da2c48; }
  .meta { text-align: right; font-size: 13px; color: #666; line-height: 1.7; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 100px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background: #f0f0f0; color: #666; }
  .section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #999; margin-bottom: 6px; }
  .client-block { margin-bottom: 36px; }
  .client-block strong { font-size: 16px; }
  table.items { width: 100%; border-collapse: collapse; margin: 0 0 8px; }
  table.items th { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #999; padding: 0 0 10px; border-bottom: 1px solid #e5e5e5; }
  table.items th:not(:first-child) { text-align: right; }
  table.items td { padding: 13px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; line-height: 1.5; vertical-align: top; }
  table.items td:not(:first-child) { text-align: right; color: #555; }
  table.items td:last-child { font-weight: 700; color: #111; }
  .total-row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 20px; padding-top: 16px; border-top: 2px solid #111; }
  .total-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #999; }
  .total-amount { font-family: 'Syne', Georgia, serif; font-size: 30px; font-weight: 800; color: #da2c48; }
  .notes { margin-top: 28px; padding: 16px 20px; background: #fafafa; border-left: 3px solid #da2c48; border-radius: 0 8px 8px 0; font-size: 13px; color: #666; font-style: italic; line-height: 1.7; }
  .signature-block { margin-top: 40px; padding: 18px 20px; border: 1px dashed #ccc; border-radius: 8px; font-size: 12px; color: #888; }
  .footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #eee; font-size: 11px; color: #aaa; line-height: 1.8; }
  @media print {
    body { margin: 0; padding: 24px; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="logo">FLORIAN B<span>.</span></div>
    <div class="meta">
      Devis n°${quote.quoteNumber || `#${quote.id}`}<br>
      ${new Date(quote.created_at).toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' })}<br>
      ${quote.validUntil ? `Valable jusqu'au ${new Date(quote.validUntil).toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' })}<br>` : ''}
      <span class="badge">${quote.status === 'accepted' ? 'Accepté' : quote.status === 'paid' ? 'Accepté & payé' : quote.status === 'sent' ? 'Envoyé' : 'Brouillon'}</span>
    </div>
  </div>
  <div class="client-block">
    <p class="section-label">Client</p>
    <strong>${quote.clientName || ''}</strong><br>
    <span style="color:#666;font-size:13px;">${quote.clientEmail}</span>
  </div>
  <table class="items">
    <thead><tr><th style="text-align:left;">Prestation</th><th>Qté</th><th>Prix unit.</th><th>Total</th></tr></thead>
    <tbody>
      ${(quote.items||[]).map(i => `
      <tr>
        <td>${i.desc||''}</td>
        <td>${i.qty||0}</td>
        <td>${(Number(i.price)||0).toFixed(2)} €</td>
        <td>${((Number(i.qty)||0)*(Number(i.price)||0)).toFixed(2)} €</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <div class="total-row">
    <span class="total-label">Total ${business.vatMention ? '' : 'TTC'}</span>
    <span class="total-amount">${(quote.total||0).toFixed(2)} €</span>
  </div>
  ${quote.notes ? `<div class="notes">${quote.notes}</div>` : ''}
  <div class="signature-block">
    <strong style="color:#555;">Bon pour accord</strong><br>
    Date, signature et mention manuscrite « bon pour accord » précédant la signature.
  </div>
  <div class="footer">
    ${business.legalName || 'Florian Bonnet'} — Graphiste &amp; Directeur Artistique, Paris${business.siret ? ` — SIRET ${business.siret}` : ''}<br>
    ${business.vatMention || 'TVA non applicable, art. 293 B du CGI'}${business.legalStatusMention ? ` — ${business.legalStatusMention}` : ''}<br>
    Devis gratuit, sans engagement jusqu'à acceptation —
    <a href="https://florian-b.fr" style="color:#da2c48;text-decoration:none;">florian-b.fr</a> · contact@florian-b.fr
  </div>
  <script>window.onload = () => { if (location.search.includes('print')) window.print(); };</script>
</body>
</html>`;
}

function invoiceHtmlPage(invoice, business = {}) {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Facture ${invoice.invoiceNumber} — ${invoice.clientName || ''}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, sans-serif; background: #fff; color: #111; max-width: 740px; margin: 48px auto; padding: 0 24px 80px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 24px; margin-bottom: 32px; border-bottom: 2px solid #111; }
  .logo { font-family: 'Syne', Georgia, serif; font-size: 22px; font-weight: 800; letter-spacing: 0.5px; }
  .logo span { color: #da2c48; }
  .meta { text-align: right; font-size: 13px; color: #666; line-height: 1.7; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 100px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; background: #f0f0f0; color: #666; }
  .badge.paid { background: #e7f3ec; color: #276749; }
  .parties { display: flex; gap: 48px; margin-bottom: 36px; }
  .parties > div { flex: 1; }
  .section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #999; margin-bottom: 6px; }
  table.items { width: 100%; border-collapse: collapse; margin: 0 0 8px; }
  table.items th { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #999; padding: 0 0 10px; border-bottom: 1px solid #e5e5e5; }
  table.items th:not(:first-child) { text-align: right; }
  table.items td { padding: 13px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; vertical-align: top; }
  table.items td:not(:first-child) { text-align: right; color: #555; }
  table.items td:last-child { font-weight: 700; color: #111; }
  .total-row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 20px; padding-top: 16px; border-top: 2px solid #111; }
  .total-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #999; }
  .total-amount { font-family: 'Syne', Georgia, serif; font-size: 30px; font-weight: 800; color: #da2c48; }
  .iban-block { margin-top: 28px; padding: 16px 20px; background: #fafafa; border-radius: 10px; font-size: 13px; color: #666; }
  .iban-block strong { font-family: monospace; font-size: 14px; color: #111; display: block; margin-top: 4px; letter-spacing: 1px; }
  .legal { margin-top: 36px; padding-top: 20px; border-top: 1px solid #eee; font-size: 11px; color: #aaa; line-height: 1.8; }
  @media print {
    body { margin: 0; padding: 24px; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="logo">FLORIAN B<span>.</span></div>
    <div class="meta">
      Facture n°<strong>${invoice.invoiceNumber}</strong><br>
      Émise le ${new Date(invoice.issue_date).toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' })}<br>
      <span class="badge ${invoice.status === 'paid' ? 'paid' : ''}">${invoice.status === 'paid' ? 'Payée' : invoice.status === 'sent' ? 'Envoyée' : 'Brouillon'}</span>
    </div>
  </div>
  <div class="parties">
    <div>
      <p class="section-label">Émetteur</p>
      <strong>${business.legalName || 'Florian Bonnet'}</strong><br>
      ${business.address ? `<span style="color:#666;font-size:13px;">${business.address.replace(/\n/g,'<br>')}</span><br>` : ''}
      ${business.siret ? `<span style="color:#888;font-size:12px;">SIRET : ${business.siret}</span><br>` : ''}
      ${business.vatMention ? `<span style="color:#888;font-size:12px;">${business.vatMention}</span>` : ''}
    </div>
    <div>
      <p class="section-label">Client</p>
      <strong>${invoice.clientName || ''}</strong><br>
      <span style="color:#666;font-size:13px;">${invoice.clientEmail}<br>
      ${invoice.clientAddress ? invoice.clientAddress.replace(/\n/g,'<br>') : ''}</span>
    </div>
  </div>
  <table class="items">
    <thead><tr><th style="text-align:left;">Prestation</th><th>Qté</th><th>Prix unit.</th><th>Total</th></tr></thead>
    <tbody>
      ${(invoice.items||[]).map(i => `
      <tr>
        <td>${i.desc||''}</td>
        <td>${i.qty||0}</td>
        <td>${(Number(i.price)||0).toFixed(2)} €</td>
        <td>${((Number(i.qty)||0)*(Number(i.price)||0)).toFixed(2)} €</td>
      </tr>`).join('')}
    </tbody>
  </table>
  <div class="total-row">
    <span class="total-label">Total ${business.vatMention ? '' : 'TTC'}</span>
    <span class="total-amount">${(invoice.total||0).toFixed(2)} €</span>
  </div>
  ${business.iban ? `<div class="iban-block">Règlement par virement bancaire<strong>${business.iban}</strong></div>` : ''}
  <div class="legal">
    ${business.paymentTerms || ''}<br>
    ${business.vatMention || 'TVA non applicable, art. 293 B du CGI'}${business.legalStatusMention ? ` — ${business.legalStatusMention}` : ''}<br>
    ${business.legalName || 'Florian Bonnet'} — Graphiste &amp; Directeur Artistique, Paris${business.siret ? ` — SIRET ${business.siret}` : ''} — <a href="https://florian-b.fr" style="color:#da2c48;text-decoration:none;">florian-b.fr</a>
  </div>
  <script>window.onload = () => { if (location.search.includes('print')) window.print(); };</script>
</body>
</html>`;
}

/* ============================================================
   EXPORTS
   ============================================================ */
/* ============================================================
   PORTAIL CLIENT — page publique en lecture seule
   ============================================================ */
function clientPortalPage() {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mon espace — Florian B.</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, sans-serif; background: #0a0a0a; color: #f0f0f0; min-height: 100vh; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 48px 24px 80px; }
  .logo { font-family: 'Syne', Georgia, serif; font-size: 24px; font-weight: 800; margin-bottom: 40px; }
  .logo span { color: #da2c48; }
  h1 { font-family: 'Syne', Georgia, serif; font-size: 22px; font-weight: 700; margin: 32px 0 16px; }
  .card { background: #111; border: 1px solid #1e1e1e; border-radius: 14px; padding: 18px 20px; margin-bottom: 12px; }
  .card-title { font-weight: 700; font-size: 14px; }
  .card-sub { color: #888; font-size: 12px; margin-top: 4px; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 100px; font-size: 10px; font-weight: 700; text-transform: uppercase; background: #181818; color: #888; }
  .badge.paid, .badge.livre, .badge.accepted { background: #10321f; color: #4ade80; }
  .empty { color: #666; font-size: 13px; padding: 20px 0; }
  .checklist-item { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 0; color: #ccc; }
  .checklist-item.done { color: #4ade80; text-decoration: line-through; }
  #loading, #error { color: #888; font-size: 14px; }
  #error { color: #ff2f76; display: none; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="logo">FLORIAN B<span>.</span></div>
    <div id="loading">Chargement de votre espace...</div>
    <div id="error"></div>
    <div id="content" style="display:none;">
      <h1>Vos projets</h1>
      <div id="projectsWrap"></div>
      <h1>Vos devis</h1>
      <div id="quotesWrap"></div>
      <h1>Vos factures</h1>
      <div id="invoicesWrap"></div>
    </div>
  </div>
  <script>
    const params = new URLSearchParams(location.search);
    const email = params.get('email'), token = params.get('token');
    const statusLabels = { draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté', paid: 'Payé', brief: 'Brief', maquettes: 'Maquettes', revisions: 'Révisions', livre: 'Livré' };
    function money(n) { return (Number(n)||0).toFixed(2) + ' €'; }
    function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' }) : ''; }
    async function load() {
      if (!email || !token) { document.getElementById('loading').style.display='none'; document.getElementById('error').textContent='Lien invalide.'; document.getElementById('error').style.display='block'; return; }
      try {
        const res = await fetch('/api/portal?email=' + encodeURIComponent(email) + '&token=' + encodeURIComponent(token));
        if (!res.ok) throw new Error('Lien invalide ou expiré.');
        const data = await res.json();
        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = 'block';
        document.getElementById('projectsWrap').innerHTML = data.projects.length ? data.projects.map(p => \`
          <div class="card">
            <div class="card-title">\${p.name}</div>
            <span class="badge \${p.stage}">\${statusLabels[p.stage] || p.stage}</span>
            <div style="margin-top:10px;">\${(p.checklist||[]).map(c => \`<div class="checklist-item \${c.done?'done':''}">\${c.done?'✅':'⬜'} \${c.label}</div>\`).join('')}</div>
          </div>\`).join('') : '<div class="empty">Aucun projet pour le moment.</div>';
        document.getElementById('quotesWrap').innerHTML = data.quotes.length ? data.quotes.map(q => \`
          <div class="card"><div class="card-title">\${q.quoteNumber || ('#'+q.id)} — \${money(q.total)}</div><div class="card-sub">\${fmtDate(q.created_at)}</div><span class="badge \${q.status}">\${statusLabels[q.status]||q.status}</span></div>\`).join('') : '<div class="empty">Aucun devis pour le moment.</div>';
        document.getElementById('invoicesWrap').innerHTML = data.invoices.length ? data.invoices.map(i => \`
          <div class="card"><div class="card-title">\${i.invoiceNumber} — \${money(i.total)}</div><div class="card-sub">Émise le \${fmtDate(i.issue_date)}</div><span class="badge \${i.status}">\${statusLabels[i.status]||i.status}</span></div>\`).join('') : '<div class="empty">Aucune facture pour le moment.</div>';
      } catch (e) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('error').textContent = e.message;
        document.getElementById('error').style.display = 'block';
      }
    }
    load();
  </script>
</body>
</html>`;
}

module.exports = {
    sendMail,
    isMailerConfigured,
    leadConfirmationEmail,
    leadNotificationEmail,
    appointmentConfirmationEmail,
    appointmentReminderEmail,
    appointmentNotificationEmail,
    leadReplyEmail,
    leadFollowUpEmail,
    teamInviteEmail,
    quoteEmail,
    quoteAcceptedEmail,
    quoteDraftReadyEmail,
    quoteReminderEmail,
    invoiceReminderEmail,
    remindersDigestEmail,
    dailyBriefEmail,
    satisfactionSurveyEmail,
    googleReviewRequestEmail,
    anniversaryEmail,
    quoteHtmlPage,
    invoiceHtmlPage,
    clientPortalPage,
    invoiceEmail,
    analyticsAlertEmail,
    monthlyReportEmail,
    weeklySummaryEmail,
};
