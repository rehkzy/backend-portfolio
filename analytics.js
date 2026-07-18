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
        const raw = GA_SERVICE_ACCOUNT_JSON.trim();
        // Accepte soit le JSON collé directement, soit une version encodée en base64
        let credentialsJson;
        if (raw.startsWith('{')) {
            credentialsJson = raw;
        } else {
            credentialsJson = Buffer.from(raw, 'base64').toString('utf-8');
        }
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

// Vue d'ensemble sur une période (par défaut 28 derniers jours), avec comparaison
// à la période équivalente précédente pour calculer les tendances (▲/▼).
async function getOverview(days = 28) {
    const c = getClient();
    if (!c) return { configured: false };

    const currentRange = { startDate: `${days}daysAgo`, endDate: 'today' };
    const previousRange = { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` };

    const [summary] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentRange, previousRange],
        metrics: [
            { name: 'activeUsers' },
            { name: 'sessions' },
            { name: 'screenPageViews' },
            { name: 'averageSessionDuration' },
            { name: 'bounceRate' },
            { name: 'engagementRate' },
            { name: 'screenPageViewsPerSession' },
            { name: 'newUsers' },
        ],
    });

    const [byDay] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentRange],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
    });

    const [topPages] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentRange],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'averageSessionDuration' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 12,
    });

    const [landingPages] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentRange],
        dimensions: [{ name: 'landingPage' }],
        metrics: [{ name: 'sessions' }, { name: 'bounceRate' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
    });

    const [sources] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentRange],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
    });

    const [referrers] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentRange],
        dimensions: [{ name: 'sessionSource' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
    });

    const [devices] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentRange],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    });

    const [browsers] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentRange],
        dimensions: [{ name: 'browser' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
        limit: 6,
    });

    const [geo] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentRange],
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
        limit: 10,
    });

    const [cities] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentRange],
        dimensions: [{ name: 'city' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
        limit: 8,
    });

    const [newVsReturning] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentRange],
        dimensions: [{ name: 'newVsReturning' }],
        metrics: [{ name: 'activeUsers' }],
    });

    const [hourly] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [currentRange],
        dimensions: [{ name: 'hour' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'hour' } }],
    });

    const currentRow = summary.rows?.[0]?.metricValues || [];
    const previousRow = summary.rows?.[1]?.metricValues || [];

    function pct(curr, prev) {
        if (!prev) return curr > 0 ? 100 : 0;
        return Math.round(((curr - prev) / prev) * 1000) / 10;
    }

    const totals = {
        activeUsers: Number(currentRow[0]?.value || 0),
        sessions: Number(currentRow[1]?.value || 0),
        pageViews: Number(currentRow[2]?.value || 0),
        avgSessionDuration: Math.round(Number(currentRow[3]?.value || 0)),
        bounceRate: Number(currentRow[4]?.value || 0),
        engagementRate: Number(currentRow[5]?.value || 0),
        pagesPerSession: Number(currentRow[6]?.value || 0),
        newUsers: Number(currentRow[7]?.value || 0),
    };
    const previousTotals = {
        activeUsers: Number(previousRow[0]?.value || 0),
        sessions: Number(previousRow[1]?.value || 0),
        pageViews: Number(previousRow[2]?.value || 0),
        avgSessionDuration: Math.round(Number(previousRow[3]?.value || 0)),
        bounceRate: Number(previousRow[4]?.value || 0),
    };
    const trends = {
        activeUsers: pct(totals.activeUsers, previousTotals.activeUsers),
        sessions: pct(totals.sessions, previousTotals.sessions),
        pageViews: pct(totals.pageViews, previousTotals.pageViews),
        avgSessionDuration: pct(totals.avgSessionDuration, previousTotals.avgSessionDuration),
        bounceRate: pct(totals.bounceRate, previousTotals.bounceRate),
    };

    return {
        configured: true,
        totals,
        previousTotals,
        trends,
        byDay: (byDay.rows || []).map(r => ({
            date: r.dimensionValues[0].value,
            users: Number(r.metricValues[0].value),
            sessions: Number(r.metricValues[1].value),
            pageViews: Number(r.metricValues[2].value),
        })),
        topPages: (topPages.rows || []).map(r => ({
            path: r.dimensionValues[0].value,
            views: Number(r.metricValues[0].value),
            avgDuration: Math.round(Number(r.metricValues[1].value)),
        })),
        landingPages: (landingPages.rows || []).map(r => ({
            path: r.dimensionValues[0].value,
            sessions: Number(r.metricValues[0].value),
            bounceRate: Number(r.metricValues[1].value),
        })),
        sources: (sources.rows || []).map(r => ({ channel: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value) })),
        referrers: (referrers.rows || []).map(r => ({ source: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value) })),
        devices: (devices.rows || []).map(r => ({ device: r.dimensionValues[0].value, users: Number(r.metricValues[0].value) })),
        browsers: (browsers.rows || []).map(r => ({ browser: r.dimensionValues[0].value, users: Number(r.metricValues[0].value) })),
        geo: (geo.rows || []).map(r => ({ country: r.dimensionValues[0].value, users: Number(r.metricValues[0].value) })),
        cities: (cities.rows || []).map(r => ({ city: r.dimensionValues[0].value, users: Number(r.metricValues[0].value) })),
        newVsReturning: (newVsReturning.rows || []).map(r => ({ type: r.dimensionValues[0].value, users: Number(r.metricValues[0].value) })),
        hourly: (hourly.rows || []).map(r => ({ hour: Number(r.dimensionValues[0].value), sessions: Number(r.metricValues[0].value) })),
    };
}

// Valeur d'une métrique pour "aujourd'hui" — utilisé par les alertes
async function getTodayMetric(metric) {
    const c = getClient();
    if (!c) return null;
    const [response] = await c.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: 'today', endDate: 'today' }],
        metrics: [{ name: metric }],
    });
    return Number(response.rows?.[0]?.metricValues?.[0]?.value || 0);
}

module.exports = { isConfigured, getRealtimeUsers, getOverview, getTodayMetric };
