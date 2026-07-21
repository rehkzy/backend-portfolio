// ftp.js — Publication de fichiers sur l'hébergement OVH via FTP.
// Variables Railway requises : FTP_HOST, FTP_USER, FTP_PASSWORD
// Optionnelles : FTP_DIR (dossier racine du site, "www" par défaut), FTP_SECURE ("false" pour désactiver FTPS)

const ftp = require('basic-ftp');
const { Readable } = require('stream');
const path = require('path');

function isConfigured() {
    return Boolean(process.env.FTP_HOST && process.env.FTP_USER && process.env.FTP_PASSWORD);
}

async function connect() {
    const client = new ftp.Client(20000);
    const opts = {
        host: process.env.FTP_HOST,
        user: process.env.FTP_USER,
        password: process.env.FTP_PASSWORD,
    };
    const wantSecure = process.env.FTP_SECURE !== 'false';
    try {
        await client.access({ ...opts, secure: wantSecure, secureOptions: { rejectUnauthorized: false } });
    } catch (err) {
        // Certains hébergements OVH mutualisés n'acceptent que le FTP simple
        if (wantSecure) {
            client.close();
            const plain = new ftp.Client(20000);
            await plain.access({ ...opts, secure: false });
            return plain;
        }
        throw err;
    }
    return client;
}

function remoteRoot() {
    const dir = (process.env.FTP_DIR || 'www').replace(/^\/+|\/+$/g, '');
    return dir ? '/' + dir : '';
}

// Upload d'un lot de fichiers { remotePath: 'blog/mon-article/index.html', content: 'string|Buffer' }
async function uploadFiles(files) {
    if (!isConfigured()) throw new Error('FTP non configuré — ajoute FTP_HOST, FTP_USER et FTP_PASSWORD dans les variables Railway');
    const client = await connect();
    try {
        for (const f of files) {
            const full = remoteRoot() + '/' + f.remotePath.replace(/^\/+/, '');
            const dir = path.posix.dirname(full);
            if (dir && dir !== '/') await client.ensureDir(dir);
            await client.cd('/');
            const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content), 'utf8');
            await client.uploadFrom(Readable.from(buf), full);
        }
    } finally {
        client.close();
    }
}

async function deletePath(remotePath) {
    if (!isConfigured()) throw new Error('FTP non configuré');
    const client = await connect();
    try {
        const full = remoteRoot() + '/' + remotePath.replace(/^\/+/, '');
        try { await client.removeDir(full); } // dossier (page d'article)
        catch { try { await client.remove(full); } catch { /* déjà absent */ } }
    } finally {
        client.close();
    }
}

async function testConnection() {
    if (!isConfigured()) return { ok: false, reason: 'Variables FTP_HOST / FTP_USER / FTP_PASSWORD manquantes sur Railway' };
    try {
        const client = await connect();
        await client.cd(remoteRoot() || '/');
        const list = await client.list();
        client.close();
        return { ok: true, filesAtRoot: list.length };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

module.exports = { isConfigured, uploadFiles, deletePath, testConnection };
