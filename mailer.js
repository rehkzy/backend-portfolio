
/* ============================================================
   ENVOI D'EMAILS — via l'API Brevo (HTTPS)
   Railway bloque les ports SMTP classiques (465/587) sur les
   plans gratuits/Hobby. Brevo envoie par API HTTPS, qui n'est
   jamais bloquée. Gratuit jusqu'à 300 emails/jour.
   Voir le README pour la procédure de configuration.
   ============================================================ */
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

function isMailerConfigured() {
    return Boolean(process.env.BREVO_API_KEY && process.env.SENDER_EMAIL);
}

async function sendMail({ to, subject, html, replyTo }) {
    if (!isMailerConfigured()) {
        console.warn('⚠️  Brevo non configuré (BREVO_API_KEY / SENDER_EMAIL manquants) — email non envoyé:', subject);
        return { sent: false, reason: 'smtp_not_configured' };
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s max
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
        return { sent: true };
    } catch (err) {
        console.error('❌ Échec envoi email:', err.message);
        let reason = err.message;
        if (err.name === 'AbortError') reason = 'Délai dépassé (20s) — Brevo ne répond pas';
        return { sent: false, reason };
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
        to: process.env.NOTIFY_EMAIL || process.env.SENDER_EMAIL,
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
        to: process.env.NOTIFY_EMAIL || process.env.SENDER_EMAIL,
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
        replyTo: process.env.SENDER_EMAIL,
    };
}

// ---- Devis / Factures ----
function quoteItemsHtml(items, forEmail = false) {
    const rows = (items || []).map(i => `
        <tr>
            <td style="padding:10px 0; border-bottom:1px solid ${forEmail ? '#262626' : '#eee'};">${i.desc || ''}</td>
            <td style="padding:10px 0; border-bottom:1px solid ${forEmail ? '#262626' : '#eee'}; text-align:center;">${i.qty || 0}</td>
            <td style="padding:10px 0; border-bottom:1px solid ${forEmail ? '#262626' : '#eee'}; text-align:right;">${(Number(i.price) || 0).toFixed(2)} €</td>
            <td style="padding:10px 0; border-bottom:1px solid ${forEmail ? '#262626' : '#eee'}; text-align:right; font-weight:700;">${((Number(i.qty) || 0) * (Number(i.price) || 0)).toFixed(2)} €</td>
        </tr>
    `).join('');
    return `
        <table style="width:100%; border-collapse:collapse; margin:16px 0;">
            <thead>
                <tr style="text-align:left; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; color:${forEmail ? '#888' : '#999'};">
                    <th style="padding-bottom:8px;">Prestation</th>
                    <th style="padding-bottom:8px; text-align:center;">Qté</th>
                    <th style="padding-bottom:8px; text-align:right;">Prix unit.</th>
                    <th style="padding-bottom:8px; text-align:right;">Total</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function quoteEmail(quote) {
    return {
        to: quote.clientEmail,
        subject: `Devis — ${quote.clientName || 'Votre projet'} — Florian B.`,
        html: brandEmailWrapper(`
            <p style="margin:0 0 16px; font-size:20px; font-weight:700; color:#ffffff;">Votre devis</p>
            <p style="margin:0 0 16px;">Bonjour ${quote.clientName || ''},</p>
            <p style="margin:0 0 16px;">Voici le détail de la proposition pour votre projet :</p>
            ${quoteItemsHtml(quote.items, true)}
            <p style="text-align:right; font-size:18px; font-weight:700; color:#fff; margin:16px 0;">Total : ${(quote.total || 0).toFixed(2)} €</p>
            ${quote.notes ? `<p style="margin:16px 0; color:#bbb; font-style:italic;">${quote.notes}</p>` : ''}
            <p style="margin:24px 0 0;">N'hésitez pas si vous avez des questions.<br><strong style="color:#fff;">Florian B.</strong></p>
        `, { preheader: `Votre devis - Total ${(quote.total || 0).toFixed(2)} €` }),
    };
}

function quoteHtmlPage(quote) {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Devis — ${quote.clientName || ''}</title>
<style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #da2c48; padding-bottom:20px; margin-bottom:30px; }
    .logo { font-family: Georgia, serif; font-weight:700; font-size:24px; }
    .logo span { color:#da2c48; }
    .meta { text-align:right; font-size:13px; color:#666; }
    .client { margin-bottom: 24px; }
    .total-row { text-align:right; font-size:22px; font-weight:700; margin-top:16px; }
    .status { display:inline-block; padding:4px 12px; border-radius:100px; font-size:12px; font-weight:700; text-transform:uppercase; }
    @media print { body { margin: 0; } }
</style>
</head>
<body>
    <div class="header">
        <div class="logo">FLORIAN B<span>.</span></div>
        <div class="meta">
            Devis n°${quote.id}<br>
            ${new Date(quote.created_at).toLocaleDateString('fr-FR')}<br>
            <span class="status" style="background:#f0f0f0;">${quote.status === 'paid' ? 'Payé' : quote.status === 'sent' ? 'Envoyé' : 'Brouillon'}</span>
        </div>
    </div>
    <div class="client">
        <strong>${quote.clientName || ''}</strong><br>
        ${quote.clientEmail}
    </div>
    ${quoteItemsHtml(quote.items, false)}
    <div class="total-row">Total : ${(quote.total || 0).toFixed(2)} €</div>
    ${quote.notes ? `<p style="margin-top:24px; color:#666; font-style:italic;">${quote.notes}</p>` : ''}
    <p style="margin-top:60px; font-size:12px; color:#999;">Florian Bonnet — Graphiste & Directeur Artistique, Paris — florian-b.fr</p>
    <script>window.onload = () => { if (location.search.includes('print')) window.print(); };</script>
</body>
</html>`;
}

// ---- Facture officielle (avec mentions légales) ----
function invoiceHtmlPage(invoice, business = {}) {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Facture ${invoice.invoiceNumber} — ${invoice.clientName || ''}</title>
<style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #da2c48; padding-bottom:20px; margin-bottom:30px; }
    .logo { font-family: Georgia, serif; font-weight:700; font-size:24px; }
    .logo span { color:#da2c48; }
    .meta { text-align:right; font-size:13px; color:#666; }
    .parties { display:flex; justify-content:space-between; gap:40px; margin-bottom:30px; }
    .parties > div { flex:1; font-size:13px; }
    .parties h4 { font-size:11px; text-transform:uppercase; letter-spacing:0.5px; color:#999; margin-bottom:6px; }
    .total-row { text-align:right; font-size:22px; font-weight:700; margin-top:16px; }
    .status { display:inline-block; padding:4px 12px; border-radius:100px; font-size:12px; font-weight:700; text-transform:uppercase; }
    .legal { margin-top:50px; padding-top:20px; border-top:1px solid #eee; font-size:11px; color:#999; line-height:1.6; }
    @media print { body { margin: 0; } }
</style>
</head>
<body>
    <div class="header">
        <div class="logo">FLORIAN B<span>.</span></div>
        <div class="meta">
            Facture n°${invoice.invoiceNumber}<br>
            Émise le ${new Date(invoice.issue_date).toLocaleDateString('fr-FR')}<br>
            <span class="status" style="background:#f0f0f0;">${invoice.status === 'paid' ? 'Payée' : invoice.status === 'sent' ? 'Envoyée' : 'Brouillon'}</span>
        </div>
    </div>
    <div class="parties">
        <div>
            <h4>Émetteur</h4>
            <strong>${business.legalName || 'Florian Bonnet'}</strong><br>
            ${business.address ? business.address.replace(/\n/g, '<br>') + '<br>' : ''}
            ${business.siret ? `SIRET : ${business.siret}<br>` : ''}
            ${business.vatMention || ''}
        </div>
        <div>
            <h4>Client</h4>
            <strong>${invoice.clientName || ''}</strong><br>
            ${invoice.clientEmail}<br>
            ${invoice.clientAddress ? invoice.clientAddress.replace(/\n/g, '<br>') : ''}
        </div>
    </div>
    ${quoteItemsHtml(invoice.items, false)}
    <div class="total-row">Total ${business.vatMention ? '' : 'TTC'} : ${(invoice.total || 0).toFixed(2)} €</div>
    ${invoice.notes ? `<p style="margin-top:24px; color:#666; font-style:italic;">${invoice.notes}</p>` : ''}
    <div class="legal">
        ${business.iban ? `IBAN pour règlement : ${business.iban}<br><br>` : ''}
        ${business.paymentTerms || ''}
    </div>
    <p style="margin-top:20px; font-size:12px; color:#999;">${business.legalName || 'Florian Bonnet'} — Graphiste & Directeur Artistique, Paris — florian-b.fr</p>
    <script>window.onload = () => { if (location.search.includes('print')) window.print(); };</script>
</body>
</html>`;
}

function invoiceEmail(invoice, business = {}) {
    return {
        to: invoice.clientEmail,
        subject: `Facture ${invoice.invoiceNumber} — Florian B.`,
        html: brandEmailWrapper(`
            <p style="margin:0 0 16px; font-size:20px; font-weight:700; color:#ffffff;">Facture n°${invoice.invoiceNumber}</p>
            <p style="margin:0 0 16px;">Bonjour ${invoice.clientName || ''},</p>
            <p style="margin:0 0 16px;">Veuillez trouver ci-joint le détail de la facture pour votre projet :</p>
            ${quoteItemsHtml(invoice.items, true)}
            <p style="text-align:right; font-size:18px; font-weight:700; color:#fff; margin:16px 0;">Total : ${(invoice.total || 0).toFixed(2)} €</p>
            ${business.iban ? `<p style="margin:16px 0; color:#bbb; font-size:13px;">IBAN pour règlement : ${business.iban}</p>` : ''}
            <p style="margin:24px 0 0;">Merci de votre confiance.<br><strong style="color:#fff;">${business.legalName || 'Florian B.'}</strong></p>
        `, { preheader: `Facture ${invoice.invoiceNumber} - Total ${(invoice.total || 0).toFixed(2)} €` }),
    };
}

// ---- Rapport mensuel ----
function monthlyReportEmail({ newLeads, wonLeads, revenue, visitors }) {
    const monthName = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return {
        to: process.env.NOTIFY_EMAIL || process.env.SENDER_EMAIL,
        subject: `📊 Rapport mensuel — ${monthName}`,
        html: brandEmailWrapper(`
            <p style="margin:0 0 20px; font-size:20px; font-weight:700; color:#ffffff;">Votre mois en résumé</p>
            <table style="width:100%; border-collapse:collapse;">
                <tr><td style="padding:10px 0; border-bottom:1px solid #262626; color:#888;">Nouveaux leads</td><td style="padding:10px 0; border-bottom:1px solid #262626; text-align:right; font-weight:700; color:#fff;">${newLeads}</td></tr>
                <tr><td style="padding:10px 0; border-bottom:1px solid #262626; color:#888;">Projets gagnés</td><td style="padding:10px 0; border-bottom:1px solid #262626; text-align:right; font-weight:700; color:#fff;">${wonLeads}</td></tr>
                <tr><td style="padding:10px 0; border-bottom:1px solid #262626; color:#888;">Chiffre d'affaires encaissé</td><td style="padding:10px 0; border-bottom:1px solid #262626; text-align:right; font-weight:700; color:#fff;">${revenue.toFixed(2)} €</td></tr>
                ${visitors !== null ? `<tr><td style="padding:10px 0; color:#888;">Visiteurs actifs (30j)</td><td style="padding:10px 0; text-align:right; font-weight:700; color:#fff;">${visitors}</td></tr>` : ''}
            </table>
            <p style="margin:24px 0 0; color:#888; font-size:13px;">Généré automatiquement le 1er de chaque mois.</p>
        `),
    };
}

// ---- Alerte Analytics ----
const GOAL_METRIC_LABELS = { activeUsers: 'visiteurs', sessions: 'sessions', pageViews: 'pages vues' };
function analyticsAlertEmail(alert, value) {
    const metricLabel = GOAL_METRIC_LABELS[alert.metric] || alert.metric;
    const conditionLabel = alert.condition === 'above' ? 'dépassé' : 'passé en dessous de';
    return {
        to: alert.notifyEmail || process.env.NOTIFY_EMAIL || process.env.SENDER_EMAIL,
        subject: `🔔 Alerte Analytics — ${metricLabel} ${conditionLabel} ${alert.threshold}`,
        html: brandEmailWrapper(`
            <p style="margin:0 0 16px; font-size:20px; font-weight:700; color:#ffffff;">Alerte déclenchée</p>
            <p style="margin:0 0 16px;">Le nombre de <strong style="color:#fff;">${metricLabel}</strong> aujourd'hui a ${conditionLabel} ton seuil de <strong style="color:#fff;">${alert.threshold}</strong>.</p>
            <div style="margin:20px 0; padding:16px; background:#1c1c1c; border-radius:8px; text-align:center;">
                <span style="font-size:32px; font-weight:800; color:#da2c48;">${value}</span><br>
                <span style="color:#888; font-size:13px;">${metricLabel} aujourd'hui</span>
            </div>
            ${brandButton('Voir le dashboard', 'https://florian-b.fr')}
        `, { preheader: `${metricLabel} : ${value}` }),
    };
}

module.exports = {
    sendMail,
    leadConfirmationEmail,
    leadNotificationEmail,
    appointmentConfirmationEmail,
    appointmentNotificationEmail,
    leadReplyEmail,
    quoteEmail,
    quoteHtmlPage,
    invoiceHtmlPage,
    invoiceEmail,
    analyticsAlertEmail,
    monthlyReportEmail,
};
