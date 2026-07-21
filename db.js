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
    "pushSubscriptions": [],
    "watchSites": [],
    "blogPosts": [],
    "pushVapidKeys": null,
    "appointments": [],
    "events": [],
    "quotes": [],
    "invoices": [],
    "clients": [],
    "expenses": [],
    "emailLog": [],
    "timeLogs": [],
    "projectChecklistTemplate": [
        "Brief signé / validé par le client",
        "Accès Drive / fichiers partagés",
        "Moodboard envoyé",
        "Premières maquettes présentées",
        "Retours client intégrés",
        "Livraison finale envoyée",
        "Facture soldée"
    ],
    "quoteTemplates": [
        {
            "id": 1, "name": "Branding / Identité visuelle",
            "items": [
                { "desc": "Recherche & moodboard", "qty": 1, "price": 250 },
                { "desc": "Logo & déclinaisons", "qty": 1, "price": 600 },
                { "desc": "Charte graphique (PDF)", "qty": 1, "price": 350 }
            ]
        },
        {
            "id": 2, "name": "UI/UX Design",
            "items": [
                { "desc": "Wireframes", "qty": 1, "price": 300 },
                { "desc": "Maquettes UI (Figma)", "qty": 1, "price": 900 },
                { "desc": "Prototype interactif", "qty": 1, "price": 250 }
            ]
        },
        {
            "id": 3, "name": "Vidéo / Motion design",
            "items": [
                { "desc": "Script & storyboard", "qty": 1, "price": 200 },
                { "desc": "Animation motion design", "qty": 1, "price": 700 },
                { "desc": "Montage & habillage sonore", "qty": 1, "price": 250 }
            ]
        }
    ],
    "users": [],
    "teamLogs": [],
    "about": {
    "eyebrow": "Derrière l'écran",
    "title": "Florian, avant d'être un portfolio",
    "lead": "Graphiste et directeur artistique basé à Paris. Je crois qu'une identité visuelle doit durer, pas juste faire de l'effet le temps d'un scroll. Alors avant de dessiner quoi que ce soit, je prends le temps de vous écouter vraiment. Pas de brief coché à la va-vite, une vraie conversation, entre nous.",
    "signoff": "Florian B."
},
    "resume": {
    "experiences": [
        {
            "period": "OCTOBRE 2024 — AUJOURD'HUI",
            "role": "Graphiste",
            "company": "oofti.fr | Montreuil"
        },
        {
            "period": "AVRIL 2020 — AUJOURD'HUI",
            "role": "Fondateur / CM",
            "company": "DailyRapFrance | Neuilly-Plaisance"
        },
        {
            "period": "SEPTEMBRE 2023 — FÉVRIER 2024",
            "role": "Chef de Projet",
            "company": "Instincts Productions | Paris"
        },
        {
            "period": "SEPTEMBRE 2022 — AOÛT 2023",
            "role": "Graphiste",
            "company": "SIM Consulting | Bry-sur-Marne"
        },
        {
            "period": "NOVEMBRE 2020 — JANVIER 2021",
            "role": "Assistant Créateur e-learning",
            "company": "Total Energies | La Défense"
        },
        {
            "period": "JANVIER 2020",
            "role": "Assistant DA",
            "company": "Publicis Groupe | Paris"
        },
        {
            "period": "JUIN 2019 — JUILLET 2019",
            "role": "Assistant sublimation 3D",
            "company": "Pacific Colour | Bonneuil-sur-Marne"
        }
    ],
    "formations": [
        {
            "period": "2021 — 2024",
            "title": "Bachelor Design graphique",
            "school": "MJM Graphic Design | Mention Très Bien"
        },
        {
            "period": "2018 — 2021",
            "title": "Bac Pro Visuelle",
            "school": "Claude Nicolas Ledoux | Mention Bien"
        }
    ],
    "skills": "Branding, Communication Digitale, Communication Print, Community Management, Design Thinking, Direction Artistique, Esprit critique, Intelligence Artificielle, Montage Vidéo, Motion Design, Mise en page, Photographie, Tournage vidéo, UI/UX Design"
},
    "contact": {
    "email": "contact@florian-b.fr",
    "instagramUrl": "https://www.instagram.com/florian.b93tsz",
    "instagramHandle": "@florian.b93tsz",
    "linkedinUrl": "https://www.linkedin.com/in/florian-bonnet-b82018198/",
    "linkedinName": "Florian Bonnet"
},
    "seo": {
    "title": "Florian B. | Graphiste & Directeur Artistique freelance à Paris",
    "description": "Branding, UI/UX Design, communication digitale et print. Découvrez les projets de Florian Bonnet, graphiste et DA basé à Paris."
},
    "analyticsGoals": [],
    "analyticsAlerts": [],
    "businessSettings": {
        "legalName": "Florian Bonnet",
        "address": "",
        "siret": "",
        "vatMention": "TVA non applicable, art. 293 B du CGI",
        "iban": "",
        "paymentTerms": "Paiement à réception de facture. Pénalités de retard : 3 fois le taux d'intérêt légal. Indemnité forfaitaire pour frais de recouvrement : 40 €.",
        "paymentDelayDays": 30,
        "revenueGoalMonthly": 0,
        "revenueGoalAnnual": 0,
        "legalStatusMention": "Auto-entrepreneur — Dispensé d'immatriculation au RCS et au RM",
        "quoteValidityDays": 30,
        "appointmentsPaused": false,
        "appointmentsPauseReason": "",
        "appointmentsPauseMessage": "",
        "googleReviewUrl": "",
        "clarityId": "",
        "autoRemindersEnabled": false,
        "leadFollowUpDays": 3
    },
    "projects": [],
    "contentCalendar": [],
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
        ],
    "projectGalleries": {
        "photo-modal": {
    "title": "Portfolio - Photos",
    "images": [
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
    ]
},
    "courtepaille-modal": {
        "title": "Courtepaille — Restaurant Branding",
        "images": [
            "Courtepaille1.webp",
            "Courtepaille2.webp",
            "Courtepaille3.webp",
            "Courtepaille4.webp",
            "Courtepaille5.webp",
            "Courtepaille6.webp",
            "Courtepaille7.webp",
            "Courtepaille8.webp",
            "Courtepaille9.webp",
            "Courtepaille10.webp",
            "Courtepaille11.webp",
            "Courtepaille12.webp",
            "Courtepaille13.webp",
            "Courtepaille14.webp",
            "Courtepaille15.webp"
        ]
    },
    "bnp-modal": {
        "title": "BNP Paribas — Brand Evolution",
        "images": [
            "Branding BNP Paribas3.webp",
            "Branding BNP Paribas1.webp",
            "Branding BNP Paribas4.webp",
            "Branding BNP Paribas2.webp",
            "Branding BNP Paribas5.webp"
        ]
    },
    "oofti-modal": {
        "title": "oofti.fr — E-commerce Brand",
        "images": [
            "oofti.fr3.webp",
            "oofti.fr1.webp",
            "oofti.fr4.webp",
            "oofti.fr2.webp",
            "oofti.fr5.webp",
            "oofti.fr6.webp"
        ]
    },
    "basicfit-modal": {
        "title": "BasicFit — Fitness Branding",
        "images": [
            "BasicFit3.webp",
            "BasicFit1.webp",
            "BasicFit2.webp",
            "BasicFit4.webp",
            "BasicFit5.webp"
        ]
    },
    "finish-modal": {
        "title": "Finish — Packaging Design",
        "images": [
            "Finish pack2.webp",
            "Finish pack3.webp",
            "Finish pack4.webp",
            "Finish pack5.webp",
            "Finish pack6.webp",
            "Finish pack7.webp",
            "Finish pack.webp",
            "Finish pack8.webp",
            "Finish pack9.webp",
            "Finish pack1.webp"
        ]
    },
    "mllepitch-modal": {
        "title": "MllePitch — Campagne Urbaine",
        "images": [
            "MllePitch3.webp",
            "MllePitch4.webp",
            "MllePitch2.webp",
            "MllePitch5.webp",
            "MllePitch1.webp",
            "MllePitch6.webp",
            "MllePitch7.webp"
        ]
    },
    "cover-modal": {
        "title": "Cover Art — Direction Artistique",
        "images": [
            "Cover1.webp",
            "Cover2.webp",
            "Cover3.webp",
            "Cover4.webp",
            "Cover5.webp",
            "BENEF - IA.jpg",
            "Cover6.webp",
            "Cover7.webp",
            "Cover8.webp",
            "Cover9.webp",
            "Cover10.webp",
            "Cover11.webp",
            "Cover12.webp",
            "Cover13.webp",
            "Cover14.webp",
            "Cover15.webp",
            "Cover16.webp",
            "modele-benef-vf.jpg",
            "Cover17.webp",
            "Cover18.webp"
        ]
    }
}
    }
};

db.defaults(DEFAULTS).write();

// Migration douce : si aucun utilisateur n'existe encore, on crée le compte
// admin historique à partir de ADMIN_PASSWORD_HASH (variable Railway existante),
// pour que l'accès ne soit jamais coupé lors du passage au multi-utilisateurs.
if (db.get('users').value().length === 0 && process.env.ADMIN_PASSWORD_HASH) {
    const adminEmail = (process.env.SENDER_EMAIL || 'admin@florian-b.fr').toLowerCase();
    db.get('users').push({
        id: 1,
        email: adminEmail,
        name: 'Florian',
        passwordHash: process.env.ADMIN_PASSWORD_HASH,
        role: 'admin',
        status: 'active',
        inviteToken: null,
        inviteTokenExpires: null,
        created_at: new Date().toISOString(),
    }).write();
    console.log(`👤 Compte admin initial créé — connecte-toi avec l'email "${adminEmail}" et ton mot de passe habituel.`);
}

module.exports = db;
