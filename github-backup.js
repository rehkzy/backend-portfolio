/* ============================================================
   SAUVEGARDE AUTOMATIQUE VERS GITHUB
   ============================================================
   Sur l'offre gratuite de Render, le disque du serveur est effacé à
   chaque redémarrage (ce qui arrive après 15 minutes sans visite, ou
   à chaque redéploiement). Pour ne jamais perdre de données, on
   sauvegarde automatiquement le fichier data/db.json dans un dépôt
   GitHub PRIVÉ, et on le restaure au démarrage avant que le serveur
   ne commence à répondre.

   Totalement optionnel : si les variables GITHUB_BACKUP_TOKEN et
   GITHUB_BACKUP_REPO ne sont pas configurées, ce module ne fait
   rigoureusement rien — le serveur démarre normalement, comme avant
   (utile si un jour tu repasses sur un hébergeur avec disque
   persistant, ex: Railway avec un Volume).
   ============================================================ */

const fs = require('fs');
const path = require('path');

function config() {
    const token    = process.env.GITHUB_BACKUP_TOKEN;
    const repo     = process.env.GITHUB_BACKUP_REPO;    // format "utilisateur/nom-du-repo"
    const branch   = process.env.GITHUB_BACKUP_BRANCH || 'main';
    const filePath = process.env.GITHUB_BACKUP_PATH || 'db-backup/db.json';
    if (!token || !repo) return null;
    return { token, repo, branch, filePath };
}

function dbPath() {
    const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
        ? process.env.RAILWAY_VOLUME_MOUNT_PATH
        : path.join(__dirname, 'data');
    return path.join(DATA_DIR, 'db.json');
}

/* ---- Restauration au démarrage ----
   Ne restaure QUE si le fichier local est absent ou visiblement vide
   (moins de 4 clés dans l'objet racine) — pour ne jamais écraser des
   données locales bien réelles avec une sauvegarde plus ancienne,
   par exemple si tu repasses un jour sur un hébergeur à disque
   persistant. ---- */
async function restoreFromGitHub() {
    const cfg = config();
    if (!cfg) {
        console.log('ℹ️  Sauvegarde GitHub non configurée (GITHUB_BACKUP_TOKEN/REPO absents) — démarrage normal.');
        return;
    }

    try {
        if (fs.existsSync(dbPath())) {
            const local = JSON.parse(fs.readFileSync(dbPath(), 'utf8'));
            if (local && typeof local === 'object' && Object.keys(local).length > 3) {
                console.log('ℹ️  Données locales déjà présentes — pas de restauration depuis GitHub.');
                return;
            }
        }
    } catch (e) {
        // fichier local corrompu ou illisible : on tente la restauration ci-dessous
    }

    try {
        const url = `https://api.github.com/repos/${cfg.repo}/contents/${encodeURI(cfg.filePath)}?ref=${cfg.branch}`;
        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${cfg.token}`,
                'Accept': 'application/vnd.github+json',
            },
        });

        if (res.status === 404) {
            console.log('ℹ️  Aucune sauvegarde GitHub trouvée (normal au tout premier démarrage) — démarrage avec une base neuve.');
            return;
        }
        if (!res.ok) {
            console.warn(`⚠️  Restauration GitHub impossible (HTTP ${res.status}) — démarrage avec les données locales actuelles.`);
            return;
        }

        const data = await res.json();
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        JSON.parse(content); // valide que c'est un JSON correct avant d'écraser quoi que ce soit

        fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
        fs.writeFileSync(dbPath(), content, 'utf8');
        console.log('✅ Données restaurées depuis la sauvegarde GitHub.');
    } catch (e) {
        console.warn('⚠️  Restauration GitHub impossible :', e.message, '— démarrage avec les données locales actuelles.');
    }
}

/* ---- Sauvegarde ----
   Regroupée (debounce) pour ne pas spammer l'API GitHub si plusieurs
   écritures arrivent en rafale (ex: import en masse) — un seul envoi
   quelques secondes après la dernière écriture. ---- */
let pendingTimer = null;
let backupChain = Promise.resolve();

function scheduleBackup(delayMs = 4000) {
    if (!config()) return; // pas configuré : aucun effet, jamais bloquant
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
        backupChain = backupChain.then(backupNow).catch((e) => {
            console.warn('⚠️  Sauvegarde GitHub échouée :', e.message);
        });
    }, delayMs);
}

async function backupNow() {
    const cfg = config();
    if (!cfg) return;
    if (!fs.existsSync(dbPath())) return;

    const content = fs.readFileSync(dbPath(), 'utf8');
    JSON.parse(content); // ne jamais envoyer un fichier corrompu vers la sauvegarde

    const apiUrl = `https://api.github.com/repos/${cfg.repo}/contents/${encodeURI(cfg.filePath)}`;

    // Le sha du fichier existant est requis par GitHub pour autoriser la mise à jour
    let sha;
    try {
        const getRes = await fetch(`${apiUrl}?ref=${cfg.branch}`, {
            headers: { 'Authorization': `Bearer ${cfg.token}`, 'Accept': 'application/vnd.github+json' },
        });
        if (getRes.ok) sha = (await getRes.json()).sha;
    } catch (e) { /* première sauvegarde : le fichier n'existe pas encore, sha reste undefined */ }

    const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${cfg.token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: 'Sauvegarde automatique — ' + new Date().toISOString(),
            content: Buffer.from(content, 'utf8').toString('base64'),
            branch: cfg.branch,
            ...(sha ? { sha } : {}),
        }),
    });

    if (!putRes.ok) {
        const errBody = await putRes.text().catch(() => '');
        console.warn(`⚠️  Sauvegarde GitHub échouée (HTTP ${putRes.status}) :`, errBody.slice(0, 300));
    } else {
        console.log('💾 Sauvegarde envoyée sur GitHub.');
    }
}

module.exports = { restoreFromGitHub, scheduleBackup, backupNow, dbPath };
