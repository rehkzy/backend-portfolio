const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        name TEXT,
        email TEXT,
        message TEXT,
        source TEXT DEFAULT 'chat',
        status TEXT DEFAULT 'new',
        notes TEXT
    );

    CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        date_text TEXT,
        time_text TEXT,
        subject TEXT,
        email TEXT,
        status TEXT DEFAULT 'pending',
        notes TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        type TEXT NOT NULL,
        meta TEXT
    );


    CREATE TABLE IF NOT EXISTS site_content (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
    CREATE INDEX IF NOT EXISTS idx_appt_created ON appointments(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
`);


// ============================================================
// Contenu du site — pré-rempli avec les données réelles
// extraites de index.html au moment de la mise en place
// (hero, FAQ, galerie photo, cartes projets).
// ============================================================
const DEFAULT_CONTENT = {
    "hero": {
        "title": "Florian B",
        "tagline": "Les pixels sont nos atomes créatifs"
    },
    "faq": [
        {
            "q": "Qui est Florian B. ?",
            "a": "Florian Bonnet est un graphiste et directeur artistique freelance basé à Paris, spécialisé en branding, UI/UX Design, communication digitale et print. Il a travaillé pour des marques comme BNP Paribas, Courtepaille, BasicFit et des startups comme Augmantor et Trustify."
        },
        {
            "q": "Quels services propose Florian B. ?",
            "a": "Florian B. propose du branding et identité visuelle, du UI/UX Design pour applications et sites web, de la communication digitale et print, du motion design et de la photographie."
        },
        {
            "q": "Comment contacter Florian B. pour un projet de graphisme ?",
            "a": "Florian B. est joignable via le formulaire de contact et l'assistant conversationnel de son site, par email, ou via LinkedIn et Instagram (@florian.b93tsz). Un système de prise de rendez-vous automatisé est disponible directement sur le site."
        },
        {
            "q": "Où trouver un graphiste freelance à Paris ?",
            "a": "Florian Bonnet est un graphiste et directeur artistique freelance basé à Paris, disponible pour des missions de branding, UI/UX Design et communication visuelle auprès d'entreprises et de startups."
        }
    ],
    "gallery": [
        "Photo1.webp",
        "Photo2.webp",
        "Photo3.webp",
        "Photo4.webp",
        "Photo6.webp",
        "Photo7.webp",
        "Photo8.webp",
        "Photo9.webp",
        "Photo10.webp",
        "Photo11.webp",
        "Photo12.webp",
        "Photo13.webp",
        "Photo14.webp",
        "Photo15.webp",
        "Photo16.webp",
        "Photo17.webp",
        "Photo18.webp",
        "Photo19.webp",
        "Photo20.webp",
        "Photo21.webp",
        "Photo22.webp",
        "Photo23.webp",
        "Photo24.webp",
        "IMG_1376.jpg",
        "IMG_1382.jpg",
        "IMG_1384.jpg",
        "IMG_1386.jpg",
        "IMG_0331.jpg",
        "IMG_0332.jpg",
        "IMG_0366.jpg",
        "IMG_0370.jpg",
        "IMG_0374.jpg",
        "IMG_0383.jpg",
        "IMG_0399.jpg",
        "IMG_4203.jpg",
        "IMG_4204.jpg",
        "IMG_4205 3.jpg",
        "P1022645.jpg",
        "Photo25.jpg",
        "Photo26.jpg",
        "Photo27.jpg",
        "Photo28.jpg",
        "Photo29.jpg",
        "Photo30.jpg",
        "Photo31.jpg",
        "Photo32.jpg",
        "Photo33.jpg",
        "Photo34.jpg",
        "Photo35.jpg",
        "Photo36.jpg",
        "Photo37.jpg",
        "Photo38.jpg",
        "Photo39.jpg",
        "Photo40.jpg",
        "IMG_0622.jpg",
        "IMG_0945.jpg",
        "IMG_1265.jpg",
        "IMG_1375.jpg",
        "IMG_8999.jpg",
        "IMG_9261.jpg",
        "IMG_9516.jpg",
        "IMG_9519.jpg",
        "IMG_9541.jpg",
        "IMG_9709.jpg",
        "IMG_9757.jpg"
    ],
    "projects": [
        {
            "id": "project-1",
            "title": "Courtepaille",
            "type": "Branding & Design",
            "cover": "Courtepaille7.webp",
            "action": "openModal('courtepaille-modal')"
        },
        {
            "id": "project-2",
            "title": "BNP Paribas",
            "type": "Branding",
            "cover": "Branding BNP Paribas5.webp",
            "action": "openModal('bnp-modal')"
        },
        {
            "id": "project-3",
            "title": "oofti.fr",
            "type": "Branding",
            "cover": "oofti.fr1.webp",
            "action": "openModal('oofti-modal')"
        },
        {
            "id": "project-4",
            "title": "BasicFit",
            "type": "Branding",
            "cover": "BasicFit3.webp",
            "action": "openModal('basicfit-modal')"
        },
        {
            "id": "project-5",
            "title": "Finish",
            "type": "Packaging Design",
            "cover": "Finish pack.webp",
            "action": "openModal('finish-modal')"
        },
        {
            "id": "project-6",
            "title": "MllePitch",
            "type": "Campagne",
            "cover": "MllePitch1.webp",
            "action": "openModal('mllepitch-modal')"
        },
        {
            "id": "project-7",
            "title": "Cover Art",
            "type": "Art Direction",
            "cover": "Cover1.webp",
            "action": "openModal('cover-modal')"
        },
        {
            "id": "project-8",
            "title": "Evidentall Patient",
            "type": "UI/UX Design — App Web",
            "cover": "evidentall-cover.svg",
            "action": "window.open('https://evidentall.vercel.app', '_blank', 'noopener,noreferrer')"
        },
        {
            "id": "project-9",
            "title": "Augmantor",
            "type": "Branding & UI/UX — Mentorat Chirurgiens-Dentistes",
            "cover": "Logo-Augmantor-BlancFichier-1.png",
            "action": "window.open('https://augmantor.com', '_blank', 'noopener,noreferrer')"
        },
        {
            "id": "project-10",
            "title": "Portfolio",
            "type": "Photographie",
            "cover": "Photo1.webp",
            "action": "openModal('photo-modal')"
        },
        {
            "id": "project-11",
            "title": "Trustify",
            "type": "Branding & UI/UX — Plateforme d'Avis Vérifiés",
            "cover": "trustify-logo-dark.svg",
            "action": "window.open('https://trustify.best', '_blank', 'noopener,noreferrer')"
        }
    ]
};

const existingContent = db.prepare('SELECT id FROM site_content WHERE id = 1').get();
if (!existingContent) {
    db.prepare('INSERT INTO site_content (id, data) VALUES (1, ?)').run(JSON.stringify(DEFAULT_CONTENT));
}

module.exports = db;
