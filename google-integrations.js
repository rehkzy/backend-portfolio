/* ============================================================
   GOOGLE CALENDAR + GOOGLE SHEETS
   ============================================================
   Réutilise EXACTEMENT le même compte de service que Google Analytics
   (variable GA_SERVICE_ACCOUNT_JSON déjà existante) — inutile de créer
   un deuxième compte Google. Il suffit d'activer deux API de plus sur
   le même projet Google Cloud, et de partager ton agenda + ta feuille
   de calcul avec l'adresse email de ce compte de service (voir README
   section 11 pour la procédure pas à pas).

   Tout est optionnel et sans effet si les variables ne sont pas
   configurées — le reste du site continue de fonctionner normalement.
   ============================================================ */
const { google } = require('googleapis');

function getAuth() {
    const raw = process.env.GA_SERVICE_ACCOUNT_JSON;
    if (!raw) return null;
    try {
        const trimmed = raw.trim();
        const credentialsJson = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf-8');
        const credentials = JSON.parse(credentialsJson);
        return new google.auth.GoogleAuth({
            credentials,
            scopes: [
                'https://www.googleapis.com/auth/calendar.events',
                'https://www.googleapis.com/auth/spreadsheets',
            ],
        });
    } catch (e) {
        console.warn('⚠️  Config Google (Calendar/Sheets) invalide :', e.message);
        return null;
    }
}

const calendarConfigured = () => Boolean(process.env.GA_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_CALENDAR_ID);
const sheetsConfigured   = () => Boolean(process.env.GA_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_SHEET_ID);

/* Crée un événement "à confirmer" le jour de la demande — le site ne
   connaît la date/heure souhaitée que sous forme de texte libre (le
   client la tape dans le chat), donc on ne prétend pas la placer au
   bon endroit dans le calendrier : on pose un pense-bête visible tout
   de suite, à toi de le glisser au bon jour une fois le RDV confirmé. */
async function createCalendarReminder({ title, description }) {
    if (!calendarConfigured()) return null;
    const auth = getAuth();
    if (!auth) return null;
    try {
        const calendar = google.calendar({ version: 'v3', auth });
        const today = new Date().toISOString().slice(0, 10);
        const res = await calendar.events.insert({
            calendarId: process.env.GOOGLE_CALENDAR_ID,
            requestBody: {
                summary: title,
                description,
                start: { date: today },
                end: { date: today },
            },
        });
        return res.data;
    } catch (e) {
        console.warn('⚠️  Création événement Google Calendar échouée :', e.message);
        return null;
    }
}

/* Ajoute une ligne en bas d'un onglet de la feuille de calcul.
   sheetRange ex: "Leads!A:F" ou "RDV!A:F" (adapte le nom de l'onglet
   à ce que tu as créé dans ta feuille). */
async function appendSheetRow(sheetRange, values) {
    if (!sheetsConfigured()) return null;
    const auth = getAuth();
    if (!auth) return null;
    try {
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: sheetRange,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [values] },
        });
        return true;
    } catch (e) {
        console.warn('⚠️  Ajout de ligne Google Sheets échoué :', e.message);
        return null;
    }
}

module.exports = { createCalendarReminder, appendSheetRow, calendarConfigured, sheetsConfigured };
