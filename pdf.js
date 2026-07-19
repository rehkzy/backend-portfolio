/* ============================================================
   GÉNÉRATION PDF — devis & factures officiels
   ------------------------------------------------------------
   Utilise pdfkit (polices standard PDF, pas de dépendance
   réseau). Design aligné sur l'identité de florian-b.fr :
   fond blanc, accent rouge-rose #da2c48, titres en gras.
   ============================================================ */
const PDFDocument = require('pdfkit');

const ACCENT = '#da2c48';
const DARK = '#111111';
const MUTED = '#777777';
const LINE = '#e5e5e5';

function bufferFromDoc(doc) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
    });
}

function money(n) { return (Number(n) || 0).toFixed(2).replace('.', ',') + ' €'; }
function dateFr(iso) { return iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'; }

/* ---- En-tête commun (logo texte + titre document) ---- */
function drawHeader(doc, docTitle, docNumber, business) {
    doc.rect(0, 0, doc.page.width, 8).fill(ACCENT);
    doc.moveDown(2);

    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(20)
        .text('FLORIAN B', 50, 40, { continued: true })
        .fillColor(ACCENT).text('.', { continued: false });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text('Graphiste & Directeur Artistique — Paris', 50, 64);

    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(16)
        .text(docTitle.toUpperCase(), 300, 40, { width: 245, align: 'right' });
    doc.fillColor(MUTED).font('Helvetica').fontSize(10)
        .text(`N° ${docNumber}`, 300, 64, { width: 245, align: 'right' });

    doc.moveTo(50, 95).lineTo(545, 95).strokeColor(LINE).lineWidth(1).stroke();
}

/* ---- Bloc infos émetteur / client ---- */
function drawParties(doc, y, business, client) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text('DE', 50, y);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    let ly = y + 16;
    const emitterLines = [
        business.legalName || 'Florian Bonnet',
        business.address || '',
        business.siret ? `SIRET : ${business.siret}` : '',
        business.legalStatusMention || '',
    ].filter(Boolean);
    emitterLines.forEach(line => { doc.text(line, 50, ly, { width: 230 }); ly += 14; });

    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text('POUR', 320, y);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    let cy = y + 16;
    const clientLines = [client.name || '', client.email || '', client.address || ''].filter(Boolean);
    clientLines.forEach(line => { doc.text(line, 320, cy, { width: 225 }); cy += 14; });

    return Math.max(ly, cy) + 10;
}

/* ---- Tableau des lignes ---- */
function drawItemsTable(doc, y, items) {
    const colX = { desc: 50, qty: 340, price: 400, total: 470 };
    doc.rect(50, y, 495, 22).fill('#f5f5f5');
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9);
    doc.text('PRESTATION', colX.desc + 8, y + 7);
    doc.text('QTÉ', colX.qty, y + 7, { width: 50, align: 'center' });
    doc.text('PRIX U.', colX.price, y + 7, { width: 60, align: 'right' });
    doc.text('TOTAL', colX.total, y + 7, { width: 65, align: 'right' });
    y += 22;

    doc.font('Helvetica').fontSize(9.5);
    (items || []).forEach((item, i) => {
        const qty = Number(item.qty) || 0;
        const price = Number(item.price) || 0;
        const rowH = 24;
        if (i % 2 === 1) doc.rect(50, y, 495, rowH).fill('#fbfbfb');
        doc.fillColor(DARK);
        doc.text(item.desc || '', colX.desc + 8, y + 7, { width: 280 });
        doc.text(String(qty), colX.qty, y + 7, { width: 50, align: 'center' });
        doc.text(money(price), colX.price, y + 7, { width: 60, align: 'right' });
        doc.text(money(qty * price), colX.total, y + 7, { width: 65, align: 'right' });
        y += rowH;
    });
    doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).stroke();
    return y + 14;
}

function drawTotal(doc, y, total, vatMention) {
    doc.font('Helvetica-Bold').fontSize(13).fillColor(DARK)
        .text(`TOTAL ${vatMention ? '' : 'TTC'}`, 340, y, { width: 130, align: 'right' })
        .fillColor(ACCENT)
        .text(money(total), 470, y, { width: 65, align: 'right' });
    return y + 30;
}

function drawFooter(doc, lines) {
    const y = doc.page.height - 90;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(lines.filter(Boolean).join('  •  '), 50, y + 10, { width: 495, align: 'center' });
}

/* ============================================================
   DEVIS
   ============================================================ */
async function generateQuotePdf(quote, business = {}) {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    drawHeader(doc, 'Devis', quote.quoteNumber || quote.id, business);

    let y = 115;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
        .text(`Date d'émission : ${dateFr(quote.created_at)}`, 50, y)
        .text(`Valable jusqu'au : ${dateFr(quote.validUntil)}`, 320, y, { width: 225, align: 'right' });
    y += 26;

    y = drawParties(doc, y, business, { name: quote.clientName, email: quote.clientEmail });
    y = drawItemsTable(doc, y, quote.items);
    y = drawTotal(doc, y, quote.total, business.vatMention);

    if (quote.notes) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED)
            .text(quote.notes, 50, y, { width: 495 });
        y += 30;
    }

    // Bloc "Bon pour accord" — signature manuscrite du client
    y += 20;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text('Bon pour accord', 50, y);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text('(date, signature et mention « bon pour accord » manuscrites)', 50, y + 13);
    doc.rect(320, y - 4, 225, 60).strokeColor(LINE).stroke();

    drawFooter(doc, [
        business.vatMention || 'TVA non applicable, art. 293 B du CGI',
        business.legalStatusMention,
        'Devis gratuit, sans engagement jusqu\'à acceptation',
        business.siret ? `SIRET ${business.siret}` : null,
    ]);

    return bufferFromDoc(doc);
}

/* ============================================================
   FACTURE
   ============================================================ */
async function generateInvoicePdf(invoice, business = {}) {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    drawHeader(doc, 'Facture', invoice.invoiceNumber, business);

    let y = 115;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
        .text(`Date d'émission : ${dateFr(invoice.issue_date)}`, 50, y)
        .text(`Échéance : ${dateFr(invoice.dueDate)}`, 320, y, { width: 225, align: 'right' });
    y += 26;

    y = drawParties(doc, y, business, { name: invoice.clientName, email: invoice.clientEmail, address: invoice.clientAddress });
    y = drawItemsTable(doc, y, invoice.items);
    y = drawTotal(doc, y, invoice.total, business.vatMention);

    if (business.iban) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text('Règlement par virement', 50, y);
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(business.iban, 50, y + 14);
        y += 36;
    }

    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text(business.paymentTerms || 'Paiement à réception de facture.', 50, y, { width: 495 });

    drawFooter(doc, [
        business.vatMention || 'TVA non applicable, art. 293 B du CGI',
        business.legalStatusMention,
        business.siret ? `SIRET ${business.siret}` : null,
        business.address || null,
    ]);

    return bufferFromDoc(doc);
}

module.exports = { generateQuotePdf, generateInvoicePdf };
