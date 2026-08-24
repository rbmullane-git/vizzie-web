// render-portal.mjs
// Renders SEO landing pages for open-data portals, matching the Vizzie
// marketing site's brand (dark-only, system fonts, no web fonts, no analytics).
//
// Exports:
//   renderPortalPage(portal, stats, ctx) -> full HTML string
//   renderPortalsIndex(portalsByCountry, ctx) -> full HTML string
//   styleBlock / headerBlock / footerBlock / appScript — shared chrome, also
//   used by build-brand.mjs so every generated page matches the homepage
//
// Run directly (`node render-portal.mjs`) to write two sample files.

import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Social card
// ---------------------------------------------------------------------------

// One shared card for every generated page. LinkedIn, Slack and X all render a
// 1.91:1 image; a real map earns the click in a way a logo never does, so this
// is the Vancouver street-trees example — 150,000 points extruded in 3D.
const socialImage = 'https://www.vizzie.org/og-vancouver-street-trees.png';
const socialImageAlt =
  'Vizzie mapping 150,000 Vancouver street trees in 3D, extruded by height ' +
  'and coloured by species, with charts alongside';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape text for safe interpolation into HTML (element text + attributes). */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format an integer with en-locale thousands separators, or "—" if nullish. */
function num(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en');
}

/** Clean display name from a label, dropping a trailing " — Country" suffix. */
function cleanName(portal) {
  const label = portal && portal.label ? String(portal.label) : '';
  if (!label) return portal && portal.slug ? String(portal.slug) : 'Open data portal';
  // Strip an em-dash / en-dash / hyphen separated trailing segment.
  const parts = label.split(/\s+[—–-]\s+/);
  return (parts[0] || label).trim();
}

/** One-line human description of a data platform. */
function platformBlurb(platform) {
  const p = (platform || '').toLowerCase();
  if (p.includes('ckan')) {
    return 'CKAN, an open catalogue standard used by many national governments';
  }
  if (p.includes('socrata')) {
    return "Socrata, Tyler Technologies' open-data platform";
  }
  if (p.includes('opendatasoft')) {
    return 'OpenDataSoft, a hosted open-data publishing platform';
  }
  if (p.includes('arcgis')) {
    return "ArcGIS Hub, Esri's open-data platform for geographic data";
  }
  if (!platform) return 'an open-data platform';
  return `${platform}, an open-data platform`;
}

/** Truncate a string to ~max chars on a word boundary. */
function trim(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,.;:]+$/, '') + '…';
}

// ---------------------------------------------------------------------------
// Shared markup fragments
// ---------------------------------------------------------------------------

/** The inline design-token stylesheet, a subset of the homepage's, plus a few
 *  portal-page extras. Root-relative page => same tokens, same classes. */
export function styleBlock() {
  return `<style>
      :root {
        color-scheme: dark;
        --bg: #0e1116;
        --panel: #161a21;
        --card: #1e242d;
        --line: #272e39;
        --text: #e6e9ef;
        --muted: #8a93a2;
        --faint: #5b6472;
        --green: #22c55e;
        --green-soft: rgba(34, 197, 94, 0.15);
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      html { scroll-behavior: smooth; }
      body {
        background: var(--bg);
        color: var(--text);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto,
          Helvetica, Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
        line-height: 1.5;
      }
      a { color: inherit; }
      .wrap { max-width: 1100px; margin: 0 auto; padding: 0 24px; }

      /* Header */
      header.site {
        position: sticky; top: 0; z-index: 20;
        background: rgba(14, 17, 22, 0.82); backdrop-filter: blur(10px);
        border-bottom: 1px solid var(--line);
      }
      header.site .wrap {
        display: flex; align-items: center; justify-content: space-between;
        height: 64px;
      }
      .brand { display: flex; align-items: center; gap: 10px; }
      .brand .word {
        font-size: 22px; font-weight: 800; letter-spacing: 0.02em; color: var(--green);
      }
      .brand .beta { font-size: 13px; font-style: italic; color: var(--muted); }
      .btn {
        display: inline-block; background: var(--green); color: var(--bg);
        font-weight: 700; font-size: 14px; padding: 10px 18px; border-radius: 10px;
        text-decoration: none; box-shadow: 0 4px 18px rgba(34, 197, 94, 0.3);
        transition: opacity 0.15s ease;
      }
      .btn:hover { opacity: 0.9; }
      .btn.ghost {
        background: transparent; color: var(--text);
        border: 1px solid var(--line); box-shadow: none;
      }
      .btn.ghost:hover { background: var(--panel); }

      /* Sections */
      section { padding: 96px 0; border-bottom: 1px solid var(--line); }
      .kicker {
        text-transform: uppercase; letter-spacing: 0.14em; font-size: 12px;
        font-weight: 800; color: var(--green); margin-bottom: 14px;
      }
      h1 { font-size: 52px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.08; }
      h2 { font-size: 32px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.18; }
      .lead { font-size: 20px; color: var(--muted); max-width: 720px; margin-top: 18px; }
      .sub { font-size: 17px; color: var(--muted); max-width: 720px; }
      .prose { font-size: 17px; color: var(--muted); max-width: 720px; margin-top: 16px; }
      .prose b { color: var(--text); }
      .prose a { color: var(--green); text-decoration: none; }

      /* Hero */
      .hero {
        display: flex; flex-direction: column; justify-content: center;
        padding: 72px 0;
        background: radial-gradient(1100px 520px at 82% -10%, rgba(34, 197, 94, 0.1), transparent 60%);
      }
      .hero .cta-row { margin-top: 30px; display: flex; gap: 12px; flex-wrap: wrap; }

      /* Grids */
      .grid { display: grid; gap: 20px; margin-top: 34px; }
      .g3 { grid-template-columns: repeat(3, 1fr); }
      .g4 { grid-template-columns: repeat(2, 1fr); }
      .card {
        background: var(--panel); border: 1px solid var(--line);
        border-radius: 14px; padding: 24px;
      }
      a.card.example { transition: border-color .15s ease, transform .15s ease; }
      a.card.example:hover { border-color: var(--green); transform: translateY(-2px); }
      .card h3 { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
      .card p { font-size: 15px; color: var(--muted); }
      .card .tag {
        display: inline-block; font-size: 11px; font-weight: 800; letter-spacing: 0.05em;
        text-transform: uppercase; color: var(--green); background: var(--green-soft);
        border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 999px;
        padding: 3px 10px; margin-bottom: 12px;
      }

      /* Stat band */
      .band { background: var(--panel); }
      .stats { display: flex; flex-wrap: wrap; gap: 40px; align-items: baseline; }
      .stat .n { font-size: 44px; font-weight: 800; color: var(--green); letter-spacing: -0.02em; }
      .stat .l { font-size: 14px; color: var(--muted); margin-top: 4px; max-width: 220px; }

      /* Licence / publisher rows (portals-list styling) */
      .portals { columns: 230px 4; column-gap: 28px; margin-top: 28px; }
      .pgrp { break-inside: avoid; margin-bottom: 18px; }
      .phdr {
        font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em;
        color: var(--green); border-bottom: 1px solid rgba(34, 197, 94, 0.28);
        padding-bottom: 4px; margin-bottom: 7px;
      }
      .prow { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; padding: 3px 0; }
      .prow .pn { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .prow .pc { color: var(--text); font-weight: 700; font-variant-numeric: tabular-nums; flex: 0 0 auto; }
      .prow a.pn { text-decoration: none; }
      .prow a.pn:hover { color: var(--text); }

      /* Licence headline callout */
      .callout {
        background: var(--panel); border: 1px solid var(--line);
        border-left: 3px solid var(--green); border-radius: 12px;
        padding: 22px 24px; margin-top: 6px;
      }
      .callout .big { font-size: 26px; font-weight: 800; letter-spacing: -0.01em; }
      .callout .big b { color: var(--green); }

      /* CTA / final */
      .final { text-align: center; }
      .final h2 { font-size: 34px; }
      .final .sub { margin: 14px auto 0; }
      .final .cta-row { margin-top: 26px; display: flex; justify-content: center; gap: 12px; }

      /* Footer */
      footer.site { padding: 40px 0; border: none; }
      footer.site .wrap {
        display: flex; flex-wrap: wrap; gap: 16px; align-items: center;
        justify-content: space-between;
      }
      footer.site a { color: var(--muted); text-decoration: none; font-size: 14px; }
      footer.site a:hover { color: var(--text); }
      footer.site .links { display: flex; gap: 20px; flex-wrap: wrap; }
      footer.site .copy { font-size: 13px; color: var(--faint); }
      footer.site .asof { font-size: 12px; color: var(--faint); width: 100%; }

      @media (max-width: 820px) {
        h1 { font-size: 38px; }
        h2 { font-size: 26px; }
        section { padding: 64px 0; }
        .g3, .g4 { grid-template-columns: 1fr; }
        header.site .brand .beta { display: none; }
      }
    </style>`;
}

/** Header brand bar (root-relative links). */
export function headerBlock() {
  return `<header class="site">
      <div class="wrap">
        <a class="brand" href="/" style="text-decoration: none">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <polygon points="12,2 22,7 12,12 2,7" fill="#22C55E" />
            <polyline points="2,12 12,17 22,12" stroke="#22C55E" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".65" />
            <polyline points="2,17 12,22 22,17" stroke="#22C55E" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".4" />
          </svg>
          <span class="word">Vizzie</span><span class="beta">beta</span>
        </a>
        <div style="display: flex; gap: 10px; align-items: center">
          <a class="btn ghost" data-app="/">Log in</a>
          <a class="btn" data-app="/#signup">Sign up</a>
        </div>
      </div>
    </header>`;
}

/** Footer (root-relative links) with an optional "data as of" line. */
export function footerBlock(ctx) {
  const asOf = ctx && ctx.generatedDate
    ? `<div class="asof">Data as of ${esc(ctx.generatedDate)}. Counts fetched live from the portal's API.</div>`
    : '';
  return `<footer class="site">
      <div class="wrap">
        <div class="brand">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <polygon points="12,2 22,7 12,12 2,7" fill="#22C55E" />
            <polyline points="2,12 12,17 22,12" stroke="#8A93A2" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
            <polyline points="2,17 12,22 22,17" stroke="#5B6472" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="copy">© 2026 Vizzie</span>
        </div>
        <div class="links">
          <a href="mailto:hello@vizzie.org">hello@vizzie.org</a>
          <a href="/privacy.html">Privacy</a>
          <a href="/data-deletion.html">Data deletion</a>
        </div>
        ${asOf}
      </div>
    </footer>`;
}

/** The data-app resolver script (mirrors the homepage). */
export function appScript(ctx) {
  const appUrl = (ctx && ctx.appUrl) || 'https://app.vizzie.org';
  return `<script>
      var APP_URL = ${JSON.stringify(appUrl)};
      document.querySelectorAll("[data-app]").forEach(function (a) {
        a.setAttribute("href", APP_URL + (a.getAttribute("data-app") || ""));
      });
    </script>`;
}

// ---------------------------------------------------------------------------
// renderPortalPage
// ---------------------------------------------------------------------------

export function renderPortalPage(portal, stats, ctx) {
  portal = portal || {};
  stats = stats || {};
  ctx = ctx || {};
  const siteUrl = ctx.siteUrl || 'https://www.vizzie.org';
  const slug = portal.slug || '';
  const name = cleanName(portal);
  const country = portal.country || portal.countryCode || '';
  const platform = portal.platform || '';
  const baseUrl = portal.baseUrl || '';
  const dataAppValue = portal.dataAppValue || '/';
  const canonical = `${siteUrl}/portals/${slug}/`;

  const count = (stats.count === null || stats.count === undefined) ? null : Number(stats.count);
  const undeclared = (stats.undeclaredPct === null || stats.undeclaredPct === undefined)
    ? null : Number(stats.undeclaredPct);
  const undeclaredWhole = undeclared === null ? null : Math.round(undeclared * 100);
  const licences = Array.isArray(stats.licences) ? stats.licences : [];
  const publishers = Array.isArray(stats.publishers) ? stats.publishers : [];
  const examples = Array.isArray(portal.examples) ? portal.examples : [];

  // ---- SEO ----
  const title = `${name} — open datasets, licences & maps · Vizzie`;
  const countStr = count === null ? 'thousands of' : num(count);
  const undeclaredClause = undeclaredWhole === null
    ? ''
    : ` licence profile (${undeclaredWhole}% undeclared),`;
  const rawDesc =
    `${name} publishes ${countStr} open datasets${country ? ` (${country})` : ''}. ` +
    `See its live dataset count,${undeclaredClause} top publishers, and turn any of it ` +
    `into a map with Vizzie — no download.`;
  const description = trim(rawDesc, 158);

  // Kicker: country (+ region/city)
  const place = [country, portal.region, portal.city].filter(Boolean);
  const kicker = place.length ? place.join(' · ') : 'Open data portal';

  // Lead one-liner
  const lead = count === null
    ? `The open-data portal for ${esc(country || 'this region')}, connected live in Vizzie — ` +
      `browse its datasets and turn any of them into a map or chart.`
    : `${esc(name)} publishes <b style="color:var(--text)">${esc(num(count))}</b> open datasets` +
      `${country ? ` for ${esc(country)}` : ''}. Browse them live in Vizzie and turn any one into a map or chart.`;

  // ---- Stats band ----
  const statCells = [];
  statCells.push(
    `<div class="stat"><div class="n">${esc(num(count))}</div><div class="l">open datasets</div></div>`
  );
  if (publishers.length) {
    statCells.push(
      `<div class="stat"><div class="n">${esc(num(publishers.length))}+</div><div class="l">publishers</div></div>`
    );
  }
  if (undeclaredWhole !== null) {
    statCells.push(
      `<div class="stat"><div class="n">${undeclaredWhole}%</div><div class="l">of datasets with no declared licence</div></div>`
    );
  }
  if (platform) {
    statCells.push(
      `<div class="stat"><div class="n" style="font-size:34px">${esc(platform)}</div><div class="l">platform</div></div>`
    );
  }

  // ---- What it is ----
  const baseLink = baseUrl
    ? `<a href="${esc(baseUrl)}" target="_blank" rel="noopener">${esc(baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>`
    : '';
  const tosClause = portal.tosUrl
    ? ` Reuse terms are set out in the portal's <a href="${esc(portal.tosUrl)}" target="_blank" rel="noopener">terms of service${portal.tosNote ? ` (${esc(portal.tosNote)})` : ''}</a>.`
    : '';
  const whatItIs =
    `<p class="prose"><b>${esc(name)}</b> is the open-data portal for ${esc(country || 'this region')}` +
    `${portal.region ? `, covering ${esc(portal.region)}` : ''}. It runs on ${platformBlurb(platform)}.` +
    `${baseLink ? ` You can browse it directly at ${baseLink}.` : ''}${tosClause}</p>`;

  // ---- Licence profile ----
  let licenceSection;
  if (undeclaredWhole !== null) {
    let framing;
    if (undeclaredWhole > 50) {
      framing = `a <b>majority</b> of datasets here declare no licence at all`;
    } else if (undeclaredWhole >= 20) {
      framing = `a <b>significant share</b> of datasets here declare no licence`;
    } else {
      framing = `<b>most datasets here are clearly licensed</b> — only a small share are undeclared`;
    }
    const declared = licences
      .filter((l) => l && String(l.cls).toUpperCase() !== 'UNDECLARED')
      .sort((a, b) => (b.count || 0) - (a.count || 0));
    const licenceRows = declared.length
      ? `<div class="portals" style="columns:230px 2">
          <div class="pgrp"><div class="phdr">Top declared licences</div>
            ${declared.slice(0, 10).map((l) =>
              `<div class="prow"><span class="pn">${esc(l.cls)}</span><span class="pc">${esc(num(l.count))}</span></div>`
            ).join('\n            ')}
          </div>
        </div>`
      : '';
    const noteClause = portal.notes
      ? `<p class="prose">${esc(trim(portal.notes, 220))}</p>`
      : '';
    licenceSection = `
        <div class="callout">
          <div class="big"><b>${undeclaredWhole}%</b> of datasets here declare no licence</div>
        </div>
        <p class="prose">On ${esc(name)}, ${framing}. It's important to know that
          <b>"no licence declared" is not the same as public-domain or free-to-use</b>. Undeclared
          data carries no explicit permission to copy, adapt, or redistribute it — so reusers should
          treat it cautiously and check with the publisher before relying on it. Vizzie flags each
          dataset's licence (or its absence) so you can see this before you build.</p>
        ${licenceRows}
        ${noteClause}`;
  } else {
    const src = portal.licenceSource || 'each dataset';
    licenceSection = `
        <p class="prose">Licences here are declared per dataset via ${esc(src)}. A machine-readable
          summary of the licence mix isn't available yet, but Vizzie surfaces each dataset's declared
          licence (or notes when none is given) as you browse — remember that an <b>undeclared</b>
          licence is not the same as public-domain or free-to-use, so check before you reuse.</p>
        ${portal.notes ? `<p class="prose">${esc(trim(portal.notes, 220))}</p>` : ''}`;
  }

  // ---- Top publishers ----
  let publisherSection;
  if (publishers.length) {
    const rows = publishers.slice(0, 8).map((p) =>
      `<div class="prow"><span class="pn">${esc(p.name)}</span><span class="pc">${esc(num(p.count))}</span></div>`
    ).join('\n            ');
    publisherSection = `
        <div class="portals" style="columns:260px 2">
          <div class="pgrp"><div class="phdr">Most active publishers</div>
            ${rows}
          </div>
        </div>`;
  } else {
    publisherSection = `<p class="prose">Publisher breakdown coming soon.</p>`;
  }

  // ---- Example maps ----
  let exampleSection;
  if (examples.length) {
    exampleSection = `<div class="grid g3">
          ${examples.map((ex) =>
            `<a class="card example" data-app="/#example=${esc(ex.slug)}" style="text-decoration:none;color:inherit;display:flex;flex-direction:column">
            <h3>${esc(ex.name)}</h3>
            <p>${esc(ex.blurb || '')}</p>
            <span class="openlink" style="margin-top:auto;padding-top:12px;color:var(--green);font-weight:600">Open live →</span>
          </a>`
          ).join('\n          ')}
        </div>`;
  } else {
    exampleSection = `<div class="grid g3">
          <a class="card example" data-app="${esc(dataAppValue)}" style="text-decoration:none;color:inherit;display:flex;flex-direction:column">
            <h3>No maps from this portal yet</h3>
            <p>Be the first — browse ${esc(name)} in Vizzie and build one in a few clicks.</p>
            <span class="openlink" style="margin-top:auto;padding-top:12px;color:var(--green);font-weight:600">Browse this portal →</span>
          </a>
        </div>`;
  }

  // ---- JSON-LD ----
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': canonical,
        url: canonical,
        name: title,
        description: description,
        isPartOf: { '@type': 'WebSite', name: 'Vizzie', url: siteUrl },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: 'Open data portals', item: `${siteUrl}/portals/` },
          { '@type': 'ListItem', position: 3, name: name, item: canonical },
        ],
      },
      {
        '@type': 'DataCatalog',
        name: name,
        url: baseUrl || canonical,
        description:
          `${name} is the open-data portal for ${country || 'its region'}` +
          `${platform ? `, running on ${platform}` : ''}` +
          `${count !== null ? `, with ${num(count)} datasets` : ''}.`,
      },
    ],
  };
  // JSON-LD is safe as-is except for "</" which could break out of the script tag.
  const jsonLdStr = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${esc(canonical)}" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />

    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${esc(canonical)}" />
    <meta property="og:site_name" content="Vizzie" />
    <meta property="og:image" content="${esc(socialImage)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(socialImageAlt)}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${esc(socialImage)}" />
    <meta name="twitter:image:alt" content="${esc(socialImageAlt)}" />

    <script type="application/ld+json">${jsonLdStr}</script>
    ${styleBlock()}
  </head>
  <body>
    ${headerBlock()}

    <!-- Hero -->
    <section class="hero">
      <div class="wrap">
        <div class="kicker">${esc(kicker)}</div>
        <h1>${esc(name)}</h1>
        <p class="lead">${lead}</p>
        <div class="cta-row">
          <a class="btn" data-app="${esc(dataAppValue)}">Browse this portal in Vizzie</a>
          ${baseUrl ? `<a class="btn ghost" href="${esc(baseUrl)}" target="_blank" rel="noopener">Visit ${esc(name)} ↗</a>` : ''}
        </div>
      </div>
    </section>

    <!-- Stats band -->
    <section class="band">
      <div class="wrap">
        <div class="stats">
          ${statCells.join('\n          ')}
        </div>
      </div>
    </section>

    <!-- What it is -->
    <section>
      <div class="wrap">
        <div class="kicker">What it is</div>
        <h2>About ${esc(name)}</h2>
        ${whatItIs}
      </div>
    </section>

    <!-- Licence profile -->
    <section>
      <div class="wrap">
        <div class="kicker">Licence profile</div>
        <h2 style="margin-bottom:20px">Can you reuse the data?</h2>
        ${licenceSection}
      </div>
    </section>

    <!-- Top publishers -->
    <section>
      <div class="wrap">
        <div class="kicker">Top publishers</div>
        <h2>Who publishes here</h2>
        ${publisherSection}
      </div>
    </section>

    <!-- Example maps -->
    <section>
      <div class="wrap">
        <div class="kicker">See what you can do</div>
        <h2>Example maps built from it</h2>
        ${exampleSection}
      </div>
    </section>

    <!-- Final CTA -->
    <section class="final">
      <div class="wrap">
        <h2>Browse ${esc(name)} in Vizzie</h2>
        <p class="sub">No download, no GIS specialist. Opens in Vizzie.</p>
        <div class="cta-row">
          <a class="btn" data-app="${esc(dataAppValue)}">Browse this portal in Vizzie</a>
        </div>
      </div>
    </section>

    ${footerBlock(ctx)}
    ${appScript(ctx)}
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------
// renderPortalsIndex
// ---------------------------------------------------------------------------

export function renderPortalsIndex(portalsByCountry, ctx) {
  portalsByCountry = Array.isArray(portalsByCountry) ? portalsByCountry : [];
  ctx = ctx || {};
  const siteUrl = ctx.siteUrl || 'https://www.vizzie.org';
  const canonical = `${siteUrl}/portals/`;

  const title = 'Open data portals — the full list · Vizzie';
  const description = trim(
    'Browse every open-data portal Vizzie connects to — 170 national and city ' +
      'catalogues across 28 countries. See each portal\'s live dataset count and ' +
      'licence profile, and turn any of it into a map. No download.',
    158
  );

  const groups = portalsByCountry.map((g) => {
    const rows = (Array.isArray(g.portals) ? g.portals : []).map((p) =>
      `<div class="prow"><a class="pn" href="/portals/${esc(p.slug)}/">${esc(p.name)}</a><span class="pc">${esc(num(p.count))}</span></div>`
    ).join('\n            ');
    return `<div class="pgrp"><div class="phdr">${esc(g.country)}</div>
            ${rows}
          </div>`;
  }).join('\n          ');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': canonical,
        url: canonical,
        name: title,
        description: description,
        isPartOf: { '@type': 'WebSite', name: 'Vizzie', url: siteUrl },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: 'Open data portals', item: canonical },
        ],
      },
    ],
  };
  const jsonLdStr = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${esc(canonical)}" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />

    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${esc(canonical)}" />
    <meta property="og:site_name" content="Vizzie" />
    <meta property="og:image" content="${esc(socialImage)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(socialImageAlt)}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${esc(socialImage)}" />
    <meta name="twitter:image:alt" content="${esc(socialImageAlt)}" />

    <script type="application/ld+json">${jsonLdStr}</script>
    ${styleBlock()}
  </head>
  <body>
    ${headerBlock()}

    <!-- Hero -->
    <section class="hero">
      <div class="wrap">
        <div class="kicker">Open data portals</div>
        <h1>Open data portals</h1>
        <p class="lead">
          Vizzie connects to <b style="color:var(--text)">170 open-data portals</b> across
          28 countries — national catalogues, state and city portals, and global sources.
          Pick one to see its live dataset count, licence profile, and top publishers, then
          turn any dataset into a map. Nothing to download.
        </p>
        <div class="cta-row">
          <a class="btn" data-app="/#signup">Sign up free</a>
          <a class="btn ghost" href="/#examples">See example maps</a>
        </div>
      </div>
    </section>

    <!-- Portals index -->
    <section class="band">
      <div class="wrap">
        <div class="kicker">The full list</div>
        <h2 style="margin-bottom:8px">Every portal, by country.</h2>
        <div class="portals">
          ${groups}
        </div>
      </div>
    </section>

    ${footerBlock(ctx)}
    ${appScript(ctx)}
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------
// CLI self-test
// ---------------------------------------------------------------------------

function isMain() {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}

if (isMain()) {
  const here = dirname(fileURLToPath(import.meta.url));
  const ctx = {
    siteUrl: 'https://www.vizzie.org',
    appUrl: 'https://app.vizzie.org',
    generatedDate: '2026-08-22',
  };

  const portal = {
    slug: 'data-gov-au',
    connectorType: 'ckan',
    baseUrl: 'https://data.gov.au/data',
    label: 'data.gov.au — Australia',
    countryCode: 'AU',
    country: 'Australia',
    region: '',
    city: '',
    platform: 'CKAN',
    tosUrl: 'https://data.gov.au/about',
    tosNote: 'CC BY 4.0 default',
    licenceSource: 'the CKAN "license_id" field',
    auth: 'none',
    notes: 'Most agencies default to CC BY 4.0, but a large tail of datasets leave the licence field blank.',
    dataAppValue: '/#portal=ckan:data.gov.au/data',
    examples: [
      { slug: 'au-fuel-prices', name: 'Fuel prices', blurb: 'Live retail fuel prices across the country, mapped by station.' },
      { slug: 'au-schools', name: 'School locations', blurb: 'Every registered school, sized by enrolment and coloured by sector.' },
    ],
  };

  const stats = {
    count: 141031,
    undeclaredPct: 0.706,
    licences: [
      { cls: 'CC-BY-4.0', count: 23972 },
      { cls: 'UNDECLARED', count: 111196 },
      { cls: 'CC0-1.0', count: 3211 },
    ],
    publishers: [
      { name: 'NSW Government', count: 8520 },
      { name: 'Geoscience Australia', count: 4102 },
      { name: 'Bureau of Meteorology', count: 2988 },
    ],
    ok: true,
    fetchedAt: '2026-08-22T00:00:00Z',
  };

  const pagePath = join(here, '_sample-portal.html');
  const indexPath = join(here, '_sample-index.html');

  writeFileSync(pagePath, renderPortalPage(portal, stats, ctx), 'utf8');

  const portalsByCountry = [
    {
      country: 'Australia',
      code: 'AU',
      portals: [
        { slug: 'data-gov-au', name: 'data.gov.au', count: 141031 },
        { slug: 'nsw', name: 'New South Wales', count: 17000 },
        { slug: 'melbourne', name: 'City of Melbourne', count: 239 },
      ],
    },
    {
      country: 'United States',
      code: 'US',
      portals: [
        { slug: 'data-gov', name: 'Data.gov', count: 548644 },
        { slug: 'nyc', name: 'NYC Open Data', count: 2396 },
      ],
    },
  ];

  writeFileSync(indexPath, renderPortalsIndex(portalsByCountry, ctx), 'utf8');

  console.log('Wrote', pagePath);
  console.log('Wrote', indexPath);
}
