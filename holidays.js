// holidays.js — Jours fériés français (métropole), calculés automatiquement.
// Aucune API externe : Pâques est calculé avec l'algorithme de Meeus.

function easterDate(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
}

function iso(d) { return d.toISOString().slice(0, 10); }
function plusDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }

function frenchHolidays(year) {
    const easter = easterDate(year);
    return [
        { date: `${year}-01-01`, name: "Jour de l'an" },
        { date: iso(plusDays(easter, 1)),  name: 'Lundi de Pâques' },
        { date: `${year}-05-01`, name: 'Fête du Travail' },
        { date: `${year}-05-08`, name: 'Victoire 1945' },
        { date: iso(plusDays(easter, 39)), name: 'Ascension' },
        { date: iso(plusDays(easter, 50)), name: 'Lundi de Pentecôte' },
        { date: `${year}-07-14`, name: 'Fête nationale' },
        { date: `${year}-08-15`, name: 'Assomption' },
        { date: `${year}-11-01`, name: 'Toussaint' },
        { date: `${year}-11-11`, name: 'Armistice 1918' },
        { date: `${year}-12-25`, name: 'Noël' },
    ].sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { frenchHolidays };
