const { BetaAnalyticsDataClient } = require('@google-analytics/data');

/* ============================================================
   GOOGLE ANALYTICS — statistiques en direct dans le dashboard
   Nécessite deux variables d'environnement :
   - GA_PROPERTY_ID : l'identifiant numérique de ta propriété GA4
   - GA_SERVICE_ACCOUNT_JSON : le contenu du fichier JSON de la
     clé de compte de service Google, encodé en base64
   Voir le README pour la procédure de création pas à pas.
   ============================================================ */
let client = null;
let propertyId = null;

function getClient() {
    if (client) return client;
    const { GA_PROPERTY_ID, GA_SERVICE_ACCOUNT_JSON } = process.env;
    if (!GA_PROPERTY_ID || !GA_SERVICE_ACCOUNT_JSON) return null;
    try {
        const credentialsJson = Buffer.from(GA_SERVICE_ACCOUNT_JSON, 'base64').toString('utf-8');
        const credentials = JSON.parse(credentialsJson);
        client = new BetaAnalyticsDataClient({ credentials });
        propertyId = GA_PROPERTY_ID;
        return client;
    } catch (err) {
        console.error('❌ Config Google Analytics invalide:', err.message);
        return null;
    }
}

function isConfigured() {
    return Boolean(process.env.GA_PROPERTY_ID && process.env.GA_SERVICE_ACCOUNT_JSON);
}

// Visiteurs actifs sur le site en ce moment même
async function getRealtimeUsers() {
    const c = getClient();
    if (!c) return { configured: false };
    const [response] = await c.runRealtimeReport({
        property: `properties/${propertyId}`,
        metrics: [{ name: 'activeUsers' }],
        dimensions: [{ name: 'unifiedScreenName' }],
    });
    const activeUsers = Number(response.rows?.[0]?.metricValues?.[0]?.value || 0)
        || response.totals?.[0]?.metricValues?.[0]?.value
        || (response.rows || []).reduce((sum, r) => sum + Number(r.metricValues[0].value), 0);
    return { configured: true, activeUsers: Number(activeUsers) || 0 };
}

// Vue d'ensemble sur une période (par défaut 28 derniers jours)
async function getOverview(days = 28) {
    const c = getClient();
    if (!c) return { configured: false };

    const [summary] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        metrics: [
            { name: 'activeUsers' },
            { name: 'sessions' },
            { name: 'screenPageViews' },
            { name: 'averageSessionDuration' },
            { name: 'bounceRate' },
        ],
    });

    const [byDay] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
    });

    const [topPages] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 8,
    });

    const [sources] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 6,
    });

    const [devices] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    });

    const row = summary.rows?.[0]?.metricValues || [];

    return {
        configured: true,
        totals: {
            activeUsers: Number(row[0]?.value || 0),
            sessions: Number(row[1]?.value || 0),
            pageViews: Number(row[2]?.value || 0),
            avgSessionDuration: Math.round(Number(row[3]?.value || 0)),
            bounceRate: Number(row[4]?.value || 0),
        },
        byDay: (byDay.rows || []).map(r => ({
            date: r.dimensionValues[0].value, // format YYYYMMDD
            users: Number(r.metricValues[0].value),
            sessions: Number(r.metricValues[1].value),
        })),
        topPages: (topPages.rows || []).map(r => ({
            path: r.dimensionValues[0].value,
            views: Number(r.metricValues[0].value),
        })),
        sources: (sources.rows || []).map(r => ({
            channel: r.dimensionValues[0].value,
            sessions: Number(r.metricValues[0].value),
        })),
        devices: (devices.rows || []).map(r => ({
            device: r.dimensionValues[0].value,
            users: Number(r.metricValues[0].value),
        })),
    };
}

module.exports = { isConfigured, getRealtimeUsers, getOverview };
