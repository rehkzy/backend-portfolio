/* ============================================================
   FLORIAN B. — Tracker visiteur
   À inclure dans index.html (OVH) avec :
   <script src="https://VOTRE-URL-RAILWAY.up.railway.app/tracker.js"></script>
   
   Ce script collecte silencieusement les données de session
   et les expose via window.FBTracker.getPayload() pour les
   attacher automatiquement aux envois de leads et RDV.
   ============================================================ */
(function () {
    'use strict';

    /* ---- Génère ou récupère un identifiant de session stable ---- */
    function getSessionId() {
        try {
            let sid = sessionStorage.getItem('_fb_sid');
            if (!sid) { sid = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('_fb_sid', sid); }
            return sid;
        } catch { return Math.random().toString(36).slice(2); }
    }

    /* ---- Parse les UTM depuis l'URL ---- */
    function getUtm() {
        try {
            const p = new URLSearchParams(location.search);
            return {
                utmSource:   p.get('utm_source')   || null,
                utmMedium:   p.get('utm_medium')   || null,
                utmCampaign: p.get('utm_campaign') || null,
            };
        } catch { return {}; }
    }

    /* ---- Historyque de navigation dans la session ---- */
    const pagesVisited = [];
    const sessionStart = Date.now();

    function recordPage() {
        const entry = { path: location.pathname + location.search, ts: Date.now() };
        // Évite les doublons consécutifs
        if (!pagesVisited.length || pagesVisited[pagesVisited.length - 1].path !== entry.path) {
            pagesVisited.push(entry);
        }
    }

    // Page initiale
    recordPage();

    // Pages suivantes (SPA-friendly)
    const _origPushState = history.pushState.bind(history);
    history.pushState = function (...args) { _origPushState(...args); recordPage(); };
    window.addEventListener('popstate', recordPage);

    /* ---- Détection type connexion (si disponible) ---- */
    function getConnection() {
        try {
            const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            return c ? (c.effectiveType || c.type || null) : null;
        } catch { return null; }
    }

    /* ---- Construction du payload complet ---- */
    function getPayload() {
        const utm = getUtm();
        return {
            sessionId:     getSessionId(),
            referrer:      document.referrer || null,
            page:          location.pathname + location.search,
            lang:          navigator.language || null,
            timezone:      Intl?.DateTimeFormat?.().resolvedOptions?.()?.timeZone || null,
            screen:        `${screen.width}x${screen.height}`,
            connection:    getConnection(),
            visitDuration: Math.round((Date.now() - sessionStart) / 1000), // secondes
            pagesVisited:  pagesVisited.map(p => p.path).join(' → '),
            ...utm,
        };
    }

    /* ---- Expose l'API globale ---- */
    window.FBTracker = {
        getPayload,
        getSessionId,
    };

    /* ---- Ping d'activité pour le suivi de session (optionnel) ---- */
    // Envoie un event 'page_view' discret à chaque nouvelle page visitée
    const BACKEND_URL = (window.BACKEND_URL || '').replace(/\/$/, '');
    function ping(path) {
        if (!BACKEND_URL) return;
        try {
            fetch(BACKEND_URL + '/api/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event: 'page_view',
                    sessionId: getSessionId(),
                    path: path || location.pathname,
                    referrer: document.referrer || null,
                }),
                keepalive: true,
            }).catch(() => {});
        } catch {}
    }
    ping(location.pathname);
    history.pushState = function (...args) { _origPushState(...args); recordPage(); ping(location.pathname); };

})();
