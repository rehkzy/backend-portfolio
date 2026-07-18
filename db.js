const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const adapter = new FileSync(path.join(DATA_DIR, 'db.json'));
const db = low(adapter);

// Données par défaut — contenu réel de florian-b.fr pré-rempli
const DEFAULTS = {
    "leads": [],
    "appointments": [],
    "events": [],
    "site_content": {
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
    }
};

db.defaults(DEFAULTS).write();

module.exports = db;
