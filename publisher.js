// publisher.js — Génère les pages HTML (blog + pages projets) au design du site,
// avec tout le SEO : balises meta, Open Graph, schema.org, canonical.

const SITE_URL = (process.env.SITE_URL || 'https://florian-b.fr').replace(/\/+$/, '');

function slugify(str) {
    return String(str || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'page';
}

function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mise en forme minimaliste : ligne vide = nouveau paragraphe,
// "## " en début de ligne = sous-titre, "- " = liste à puces.
function renderContent(text) {
    const blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/);
    return blocks.map(block => {
        const lines = block.split('\n').filter(l => l.trim());
        if (!lines.length) return '';
        if (lines[0].startsWith('## ')) {
            return `<h2>${esc(lines[0].slice(3))}</h2>` + (lines.length > 1 ? `<p>${lines.slice(1).map(esc).join('<br>')}</p>` : '');
        }
        if (lines.every(l => l.startsWith('- '))) {
            return `<ul>${lines.map(l => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>`;
        }
        return `<p>${lines.map(esc).join('<br>')}</p>`;
    }).join('\n');
}

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0;}
:root{--bg:#0a0a0a;--card:#141414;--border:#262626;--text:#f5f5f5;--muted:#9a9a9a;--accent:#da2c48;--accent2:#ff2f76;}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;line-height:1.7;}
a{color:var(--accent2);}
.nav{display:flex;justify-content:space-between;align-items:center;padding:1.2rem clamp(1.2rem,4vw,3rem);border-bottom:1px solid var(--border);}
.nav .logo{font-family:'Syne',sans-serif;font-weight:800;font-size:1.1rem;color:var(--text);text-decoration:none;}
.nav .logo span{color:var(--accent2);}
.nav a.back{color:var(--muted);text-decoration:none;font-size:0.85rem;}
.nav a.back:hover{color:var(--text);}
.wrap{max-width:720px;margin:0 auto;padding:3rem 1.2rem 5rem;}
h1{font-family:'Syne',sans-serif;font-size:clamp(1.7rem,4vw,2.4rem);line-height:1.2;margin-bottom:0.8rem;}
h2{font-family:'Syne',sans-serif;font-size:1.25rem;margin:2.2rem 0 0.7rem;}
.meta{color:var(--muted);font-size:0.85rem;margin-bottom:2rem;}
.meta b{color:var(--accent2);font-weight:600;}
.cover{width:100%;border-radius:14px;margin:0 0 2rem;border:1px solid var(--border);}
p{margin:0 0 1.1rem;color:#d6d6d6;}
ul{margin:0 0 1.1rem 1.2rem;color:#d6d6d6;}
li{margin-bottom:0.4rem;}
.cta{display:block;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:1.6rem;margin-top:3rem;text-align:center;}
.cta p{color:var(--muted);margin-bottom:1rem;}
.cta a{display:inline-block;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;text-decoration:none;padding:0.8rem 1.6rem;border-radius:10px;font-weight:600;font-size:0.9rem;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1.2rem;margin-top:2rem;}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;text-decoration:none;color:var(--text);display:block;transition:transform 0.2s;}
.card:hover{transform:translateY(-3px);}
.card img{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;}
.card .pad{padding:1rem 1.1rem 1.2rem;}
.card h3{font-family:'Syne',sans-serif;font-size:1rem;margin-bottom:0.3rem;}
.card p{color:var(--muted);font-size:0.82rem;margin:0;}
footer{color:var(--muted);text-align:center;font-size:0.8rem;padding:2rem;border-top:1px solid var(--border);}
`;

function pageShell({ title, description, canonicalPath, ogImage, bodyHtml, jsonLd }) {
    const canonical = SITE_URL + canonicalPath;
    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
<style>${BASE_CSS}</style>
</head>
<body>
<nav class="nav"><a class="logo" href="${SITE_URL}/">Florian<span>B.</span></a><a class="back" href="${SITE_URL}/">← Retour au portfolio</a></nav>
${bodyHtml}
<footer>© ${new Date().getFullYear()} Florian Bonnet — Graphiste & Directeur Artistique, Paris · <a href="${SITE_URL}/">florian-b.fr</a></footer>
</body>
</html>`;
}

function absImage(src) {
    if (!src) return null;
    if (/^https?:\/\//.test(src)) return src;
    return SITE_URL + '/' + String(src).replace(/^\/+/, '');
}

function blogArticleHtml(post, hasOgImage) {
    const dateStr = new Date(post.publishedAt || post.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const cover = absImage(post.coverUrl);
    return pageShell({
        title: `${post.title} — Florian B.`,
        description: post.excerpt || post.title,
        canonicalPath: `/blog/${post.slug}/`,
        ogImage: hasOgImage ? `${SITE_URL}/blog/${post.slug}/og.png` : (cover || absImage('hero-photo-flo.webp')),
        jsonLd: {
            '@context': 'https://schema.org', '@type': 'Article',
            headline: post.title, description: post.excerpt || post.title,
            datePublished: post.publishedAt || post.created_at,
            author: { '@type': 'Person', name: 'Florian Bonnet', url: SITE_URL },
            image: cover || undefined,
            mainEntityOfPage: `${SITE_URL}/blog/${post.slug}/`,
        },
        bodyHtml: `<main class="wrap">
<article>
<h1>${esc(post.title)}</h1>
<p class="meta">Par <b>Florian Bonnet</b> · ${dateStr}</p>
${cover ? `<img class="cover" src="${esc(cover)}" alt="${esc(post.title)}">` : ''}
${renderContent(post.content)}
</article>
<div class="cta"><p>Un projet de branding, d'identité visuelle ou de design en tête ?</p><a href="${SITE_URL}/#contact">Parlons-en — réponse sous 24h</a></div>
</main>`,
    });
}

function blogIndexHtml(posts) {
    const published = posts.filter(p => p.status === 'published').sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
    return pageShell({
        title: 'Blog — Florian B. · Graphiste & Directeur Artistique à Paris',
        description: 'Conseils et coulisses sur le branding, l\'identité visuelle et le design graphique, par Florian Bonnet, graphiste freelance à Paris.',
        canonicalPath: '/blog/',
        ogImage: absImage('hero-photo-flo.webp'),
        jsonLd: {
            '@context': 'https://schema.org', '@type': 'Blog',
            name: 'Blog de Florian B.', url: `${SITE_URL}/blog/`,
            author: { '@type': 'Person', name: 'Florian Bonnet' },
        },
        bodyHtml: `<main class="wrap" style="max-width:960px;">
<h1>Le blog</h1>
<p class="meta">Branding, identité visuelle, design — conseils et coulisses.</p>
<div class="grid">
${published.map(p => `<a class="card" href="${SITE_URL}/blog/${p.slug}/">
${p.coverUrl ? `<img src="${esc(absImage(p.coverUrl))}" alt="${esc(p.title)}" loading="lazy">` : ''}
<div class="pad"><h3>${esc(p.title)}</h3><p>${esc((p.excerpt || '').slice(0, 110))}</p></div>
</a>`).join('\n')}
</div>
${published.length ? '' : '<p style="color:var(--muted);">Premiers articles à venir très bientôt !</p>'}
</main>`,
    });
}

function projectPageHtml(card, description) {
    const cover = absImage(card.cover);
    const slug = slugify(card.title);
    const desc = description || `${card.title} — projet de ${card.type || 'design'} réalisé par Florian Bonnet, graphiste et directeur artistique freelance à Paris.`;
    return pageShell({
        title: `${card.title} · ${card.type || 'Projet'} — Florian B.`,
        description: desc,
        canonicalPath: `/projets/${slug}/`,
        ogImage: cover,
        jsonLd: {
            '@context': 'https://schema.org', '@type': 'CreativeWork',
            name: card.title, description: desc,
            creator: { '@type': 'Person', name: 'Florian Bonnet', url: SITE_URL },
            image: cover || undefined,
            url: `${SITE_URL}/projets/${slug}/`,
        },
        bodyHtml: `<main class="wrap">
<h1>${esc(card.title)}</h1>
<p class="meta"><b>${esc(card.type || 'Projet')}</b> · Direction artistique : Florian Bonnet</p>
${cover ? `<img class="cover" src="${esc(cover)}" alt="${esc(card.title)} — ${esc(card.type || '')}">` : ''}
${renderContent(description || '')}
<p>Envie d'en voir plus ? L'ensemble du projet est présenté sur <a href="${SITE_URL}/">le portfolio</a>.</p>
<div class="cta"><p>Un projet similaire pour votre marque ?</p><a href="${SITE_URL}/#contact">Discutons-en — réponse sous 24h</a></div>
</main>`,
    });
}

// Fusionne le sitemap existant du site avec les nouvelles URLs (sans rien perdre)
async function mergedSitemap(newUrls) {
    let existing = [];
    try {
        const r = await fetch(SITE_URL + '/sitemap.xml', { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
            const xml = await r.text();
            existing = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m => m[1].trim());
        }
    } catch { /* pas de sitemap existant : on repart de la page d'accueil */ }
    if (!existing.length) existing = [SITE_URL + '/'];
    const all = [...new Set([...existing, ...newUrls])];
    const today = new Date().toISOString().slice(0, 10);
    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all.map(u => `  <url><loc>${esc(u)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>`;
}

// Image Open Graph 1200x630 générée aux couleurs du site (nécessite le module
// "sharp" — si indisponible, on renvoie null et la couverture sert d'og:image).
async function ogImagePng(title, subtitle) {
    let sharp;
    try { sharp = require('sharp'); } catch { return null; }
    const escT = esc(String(title || '').slice(0, 90));
    // Découpe le titre en lignes de ~28 caractères max
    const words = escT.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
        if ((cur + ' ' + w).trim().length > 28) { lines.push(cur.trim()); cur = w; }
        else cur += ' ' + w;
    }
    if (cur.trim()) lines.push(cur.trim());
    const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
<rect width="1200" height="630" fill="#0a0a0a"/>
<rect x="0" y="610" width="1200" height="20" fill="#da2c48"/>
<circle cx="1080" cy="120" r="220" fill="#da2c48" opacity="0.12"/>
<text x="80" y="120" font-family="Arial, sans-serif" font-size="30" font-weight="bold" fill="#ff2f76" letter-spacing="4">FLORIAN B. — STUDIO</text>
${lines.slice(0, 4).map((l, i) => `<text x="80" y="${230 + i * 78}" font-family="Arial, sans-serif" font-size="62" font-weight="bold" fill="#f5f5f5">${l}</text>`).join('')}
<text x="80" y="560" font-family="Arial, sans-serif" font-size="26" fill="#9a9a9a">${esc(String(subtitle || 'Graphiste &amp; Directeur Artistique — Paris').slice(0, 70))}</text>
</svg>`;
    try {
        return await sharp(Buffer.from(svg)).png().toBuffer();
    } catch { return null; }
}

module.exports = { slugify, blogArticleHtml, blogIndexHtml, projectPageHtml, mergedSitemap, ogImagePng, SITE_URL };
