import { SITE, buildDefaultImageUrl, ensureAbsoluteUrl } from './constants.js';
import { buildKeywords, escapeHtml, serializeJsonLd } from './utils.js';

const BASE_STYLE = `body{margin:0;font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;background:#f8fafc;color:#0f172a;}main{max-width:960px;margin:0 auto;padding:48px 24px;}article{background:#ffffff;border-radius:16px;box-shadow:0 24px 48px rgba(15,23,42,0.08);padding:40px 32px;}header.hero{margin-bottom:32px;}header.hero p.eyebrow{font-size:0.9rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#0ea5e9;margin:0 0 12px;}header.hero h1{font-size:2.4rem;line-height:1.1;margin:0 0 16px;color:#0b1120;}header.hero p.subheading{font-size:1.15rem;line-height:1.6;margin:0;}section{margin-top:32px;}section h2{font-size:1.5rem;margin-bottom:12px;color:#0f172a;}section p{font-size:1.05rem;line-height:1.7;margin:0 0 12px;color:#1f2937;}ul.feature-list{margin:16px 0 0 20px;padding:0;color:#1f2937;}ul.feature-list li{margin-bottom:8px;}div.hero-grid{display:flex;flex-wrap:wrap;gap:18px;margin-top:18px;}div.hero-grid div.stat{flex:1 1 160px;background:#f1f5f9;border-radius:12px;padding:16px;}div.hero-grid div.stat span.label{display:block;font-size:0.8rem;text-transform:uppercase;letter-spacing:0.06em;color:#334155;margin-bottom:6px;}div.hero-grid div.stat span.value{font-size:1.1rem;font-weight:600;color:#0f172a;}footer.page-footer{margin-top:40px;font-size:0.9rem;color:#475569;text-align:center;}@media(max-width:720px){article{padding:28px 20px;}header.hero h1{font-size:2rem;}header.hero p.subheading{font-size:1rem;}section h2{font-size:1.3rem;}}`;

function renderJsonLdScripts(jsonLdItems = []) {
  return jsonLdItems
    .filter(Boolean)
    .map((item) => `<script type="application/ld+json">${serializeJsonLd(item)}</script>`)
    .join('');
}

export function renderSeoDocument({
  title,
  description,
  canonical,
  keywords = [],
  ogImage,
  ogType = 'website',
  ogImageAlt,
  jsonLd = [],
  bodyHtml = '',
  noindex = false,
}) {
  const finalTitle = escapeHtml(title || `${SITE.name} — Mousepads Personalizados`);
  const finalDescription = escapeHtml(description || 'Mousepads gamers personalizados y Glasspads premium en Argentina.');
  const canonicalUrl = ensureAbsoluteUrl(canonical || '/');
  const imageUrl = ensureAbsoluteUrl(ogImage || buildDefaultImageUrl());
  const ogImageAltText = escapeHtml(ogImageAlt || 'Mousepad gamer personalizado MGMGAMERS');
  const keywordsContent = escapeHtml(buildKeywords(keywords).join(', '));
  const robots = noindex ? 'noindex,nofollow' : 'index,follow';

  return `<!DOCTYPE html>
<html lang="${escapeHtml(SITE.locale)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${finalTitle}</title>
<meta name="description" content="${finalDescription}" />
<meta name="keywords" content="${keywordsContent}" />
<meta name="robots" content="${robots}" />
<meta name="language" content="${escapeHtml(SITE.locale)}" />
<meta name="geo.region" content="AR" />
<meta name="geo.placename" content="Argentina" />
<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
<link rel="alternate" href="${escapeHtml(canonicalUrl)}" hreflang="${escapeHtml(SITE.locale)}" />
<link rel="alternate" href="${escapeHtml(canonicalUrl)}" hreflang="x-default" />
<meta property="og:type" content="${escapeHtml(ogType)}" />
<meta property="og:site_name" content="${escapeHtml(SITE.name)}" />
<meta property="og:locale" content="${escapeHtml(SITE.ogLocale)}" />
<meta property="og:title" content="${finalTitle}" />
<meta property="og:description" content="${finalDescription}" />
<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
<meta property="og:image" content="${escapeHtml(imageUrl)}" />
<meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
<meta property="og:image:alt" content="${ogImageAltText}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${finalTitle}" />
<meta name="twitter:description" content="${finalDescription}" />
<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
<meta name="twitter:creator" content="@mgmgamers" />
<style>${BASE_STYLE}</style>
${renderJsonLdScripts(jsonLd)}
</head>
<body>
${bodyHtml}
<footer class="page-footer">${escapeHtml('© ' + new Date().getFullYear() + ' MGMGAMERS — Mousepads personalizados en Argentina.')}</footer>
</body>
</html>`;
}

export function renderPageLayout({ hero, sections = [] }) {
  const parts = [];
  parts.push('<main id="contenido"><article>');
  if (hero) {
    parts.push('<header class="hero">');
    if (hero.eyebrow) {
      parts.push(`<p class="eyebrow">${escapeHtml(hero.eyebrow)}</p>`);
    }
    if (hero.heading) {
      parts.push(`<h1>${escapeHtml(hero.heading)}</h1>`);
    }
    if (hero.subheading) {
      parts.push(`<p class="subheading">${escapeHtml(hero.subheading)}</p>`);
    }
    if (Array.isArray(hero.stats) && hero.stats.length) {
      parts.push('<div class="hero-grid">');
      hero.stats.forEach((stat) => {
        if (!stat || (!stat.label && !stat.value)) return;
        parts.push('<div class="stat">');
        if (stat.label) {
          parts.push(`<span class="label">${escapeHtml(stat.label)}</span>`);
        }
        if (stat.value) {
          parts.push(`<span class="value">${escapeHtml(stat.value)}</span>`);
        }
        parts.push('</div>');
      });
      parts.push('</div>');
    }
    parts.push('</header>');
  }

  sections.forEach((section) => {
    if (!section) return;
    parts.push('<section>');
    if (section.heading) {
      parts.push(`<h2>${escapeHtml(section.heading)}</h2>`);
    }
    if (Array.isArray(section.paragraphs)) {
      section.paragraphs.forEach((paragraph) => {
        const content = sanitizeParagraph(paragraph);
        if (content) {
          parts.push(`<p>${content}</p>`);
        }
      });
    }
    if (section.list && Array.isArray(section.list.items) && section.list.items.length) {
      parts.push('<ul class="feature-list">');
      section.list.items.forEach((item) => {
        const content = sanitizeParagraph(item);
        if (content) {
          parts.push(`<li>${content}</li>`);
        }
      });
      parts.push('</ul>');
    }
    parts.push('</section>');
  });

  parts.push('</article></main>');
  return parts.join('');
}

function sanitizeParagraph(text) {
  if (!text) return '';
  return escapeHtml(String(text));
}
