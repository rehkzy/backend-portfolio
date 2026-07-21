const { google } = require('googleapis');

/* ============================================================
   SEO — Google Search Console dans le dashboard
   Réutilise le MÊME compte de service que Google Analytics
   (GA_SERVICE_ACCOUNT_JSON). Une seule chose à faire en plus :
   ajouter l'email du compte de service comme utilisateur
   "Propriétaire délégué" ou "Complet" dans Search Console.
   Variable optionnelle : GSC_SITE_URL (par défaut le domaine du site).
   ============================================================ */
let searchconsole = null;

const SITE_URL = process.env.GSC_SITE_URL || 'sc-domain:florian-b.fr';

function getClient() {
    if (searchconsole) return searchconsole;
    const raw = (process.env.GA_SERVICE_ACCOUNT_JSON || '').trim();
    if (!raw) return null;
    try {
        const credentialsJson = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf-8');
        const credentials = JSON.parse(credentialsJson);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
        });
        searchconsole = google.searchconsole({ version: 'v1', auth });
        return searchconsole;
    } catch (err) {
        console.error('❌ Config Search Console invalide:', err.message);
        return null;
    }
}

function isConfigured() {
    return Boolean(process.env.GA_SERVICE_ACCOUNT_JSON);
}

// Cache court — mêmes raisons que le cache analytics
const seoCache = new Map();
const SEO_CACHE_TTL_MS = 5 * 60 * 1000;

function fmtDate(d) {
    return d.toISOString().slice(0, 10);
}

async function getSeoOverview(days = 28) {
    const sc = getClient();
    if (!sc) return { configured: false };

    const cached = seoCache.get(days);
    if (cached && Date.now() - cached.at < SEO_CACHE_TTL_MS) return cached.data;

    // Search Console a ~2-3 jours de latence sur ses données : on décale la fenêtre
    const end = new Date(Date.now() - 3 * 86400000);
    const start = new Date(end.getTime() - days * 86400000);
    const prevEnd = new Date(start.getTime() - 86400000);
    const prevStart = new Date(prevEnd.getTime() - days * 86400000);

    const q = (body) => sc.searchanalytics.query({ siteUrl: SITE_URL, requestBody: body }).then(r => r.data);

    try {
        const [summary, prevSummary, byDate, topQueries, topPages, byDevice, byCountry] = await Promise.all([
            q({ startDate: fmtDate(start), endDate: fmtDate(end) }),
            q({ startDate: fmtDate(prevStart), endDate: fmtDate(prevEnd) }),
            q({ startDate: fmtDate(start), endDate: fmtDate(end), dimensions: ['date'] }),
            q({ startDate: fmtDate(start), endDate: fmtDate(end), dimensions: ['query'], rowLimit: 20 }),
            q({ startDate: fmtDate(start), endDate: fmtDate(end), dimensions: ['page'], rowLimit: 15 }),
            q({ startDate: fmtDate(start), endDate: fmtDate(end), dimensions: ['device'] }),
            q({ startDate: fmtDate(start), endDate: fmtDate(end), dimensions: ['country'], rowLimit: 10 }),
        ]);

        const totalRow = summary.rows?.[0] || {};
        const prevRow = prevSummary.rows?.[0] || {};
        function pct(curr, prev) {
            if (!prev) return curr > 0 ? 100 : 0;
            return Math.round(((curr - prev) / prev) * 1000) / 10;
        }

        const result = {
            configured: true,
            totals: {
                clicks: totalRow.clicks || 0,
                impressions: totalRow.impressions || 0,
                ctr: totalRow.ctr || 0,
                position: totalRow.position || 0,
            },
            trends: {
                clicks: pct(totalRow.clicks || 0, prevRow.clicks || 0),
                impressions: pct(totalRow.impressions || 0, prevRow.impressions || 0),
                ctr: pct(totalRow.ctr || 0, prevRow.ctr || 0),
                position: pct(totalRow.position || 0, prevRow.position || 0),
            },
            byDate: (byDate.rows || []).map(r => ({
                date: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
            })),
            topQueries: (topQueries.rows || []).map(r => ({
                query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
            })),
            topPages: (topPages.rows || []).map(r => ({
                page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
            })),
            byDevice: (byDevice.rows || []).map(r => ({ device: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
            byCountry: (byCountry.rows || []).map(r => ({ country: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
        };

        seoCache.set(days, { data: result, at: Date.now() });
        return result;
    } catch (err) {
        // Cas 1 : l'API Search Console n'est pas activée dans le projet Google Cloud
        if (err.message && err.message.includes('has not been used in project')) {
            const m = err.message.match(/project (\d+)/);
            return { configured: true, apiDisabled: true, projectId: m ? m[1] : null };
        }
        // Cas 2 : le compte de service n'a pas encore été ajouté dans Search Console
        if (err.message && (err.message.includes('403') || err.message.includes('permission') || err.message.includes('Forbidden'))) {
            return { configured: true, accessDenied: true, error: err.message };
        }
        throw err;
    }
}

module.exports = { isConfigured, getSeoOverview };
