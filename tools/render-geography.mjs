// render-geography.mjs
// Renders /geography/<slug>/ — one page per boundary set Vizzie holds, for the
// analyst who has a spreadsheet of area codes and no way to map it.
//
// Chrome (styles, header, footer, app links) is imported from render-portal.mjs
// so these pages and the portal pages cannot drift apart visually.
//
// Exports: renderGeographyPage(facts, editorial, ctx) -> full HTML string

import { esc, styleBlock, headerBlock, footerBlock, appScript, analyticsBlock } from './render-portal.mjs';

const num = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('en'));

/** km², shown with the precision the magnitude deserves rather than a fixed dp. */
function area(km2) {
  if (km2 >= 100) return `${num(Math.round(km2))} km²`;
  if (km2 >= 1) return `${km2.toFixed(2)} km²`;
  if (km2 >= 0.01) return `${(km2 * 100).toFixed(0)} hectares`;
  return `${(km2 * 100).toFixed(1)} hectares`;
}

/**
 * A GeoJSON FeatureCollection as one inline SVG — no tiles, no JavaScript, no
 * third-party map service. Longitude is scaled by cos(latitude) so the shapes
 * are not stretched at UK latitudes, which a raw lon/lat plot visibly does.
 */
export function boundariesSvg(geojson, { width = 760, height = 520, pad = 8 } = {}) {
  const rings = [];
  for (const f of geojson.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) for (const ring of poly) rings.push(ring);
  }
  if (!rings.length) return '';

  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const ring of rings) for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const kx = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const spanX = Math.max((maxLon - minLon) * kx, 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const px = (lon) => ((lon - minLon) * kx * scale + offX).toFixed(1);
  const py = (lat) => ((maxLat - lat) * scale + offY).toFixed(1); // SVG y grows downward

  const paths = rings
    .map((ring) => 'M' + ring.map(([lon, lat]) => `${px(lon)},${py(lat)}`).join('L') + 'Z')
    .join('');
  return `<svg class="geomap" viewBox="0 0 ${width} ${height}" role="img" xmlns="http://www.w3.org/2000/svg" aria-label="${esc(
    `${geojson.features.length} boundaries drawn from the data Vizzie holds`
  )}"><path d="${paths}" fill="rgba(34,197,94,0.10)" stroke="#22c55e" stroke-width="0.7" stroke-linejoin="round" /></svg>`;
}

export function renderGeographyPage(facts, editorial, ctx = {}) {
  const siteUrl = ctx.siteUrl || 'https://www.vizzie.org';
  const url = `${siteUrl}/geography/${facts.slug}/`;
  // What the level is keyed BY. Every level up to India was keyed by a code, so
  // the pages could say "codes" throughout; India's states and districts are
  // keyed by name, and "paste a column of district codes" would be advice to
  // paste the one column that cannot join. Defaults to 'codes' so no existing
  // page moves.
  const keyNoun = editorial.keyNoun || 'codes';
  // Codes are built; names are matched. Two words rather than one so the
  // sentence stays English either way.
  const keyVerb = editorial.keyVerb || 'built';
  const title = `${editorial.name} (${editorial.abbr}) — boundaries, ${keyNoun} and how to map them | Vizzie`;
  const description =
    `${num(facts.areas)} ${editorial.plural} in the ${facts.vintage} boundary set: what they are, ` +
    `how the ${keyNoun} are ${keyVerb}, what they roll up into, and how to map a spreadsheet of them.`;

  // Dataset schema — Google Dataset Search indexes it, which is free
  // distribution on exactly the data-intent queries these pages target.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `${editorial.name} boundaries (${facts.vintage})`,
    description,
    url,
    license: editorial.licenceUrl,
    creator: { '@type': 'Organization', name: editorial.publisher },
    spatialCoverage: editorial.coverage,
    temporalCoverage: String(facts.vintage),
    isAccessibleForFree: true,
    keywords: editorial.keywords,
  };

  // A name-keyed level (India's states and districts) has no code to put beside
  // the name — the name IS the key — so `examples` comes back empty and the
  // table is omitted rather than rendered blank. The editorial codeFormat block
  // carries the explanation on those pages.
  const examples = facts.examples.length
    ? `<table class="codes">${facts.examples
        .map((e) => `<tr><td><code>${esc(e.code)}</code></td><td>${esc(e.name)}</td></tr>`)
        .join('')}</table>`
    : '';

  const rollup = editorial.rollup
    .map((step, i) => `<li${i === editorial.rollupIndex ? ' class="is-this"' : ''}>${esc(step)}</li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(url)}" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(url)}" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
${styleBlock()}
<style>
  .geowrap { margin: 28px 0 10px; border: 1px solid var(--line); border-radius: 12px; padding: 10px; background: var(--panel); }
  .geomap { display: block; width: 100%; height: auto; }
  .geocap { color: var(--muted); font-size: 14px; margin: 10px 2px 0; max-width: 720px; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin: 26px 0; }
  .fact { border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; background: var(--card); }
  .fact .n { font-size: 26px; font-weight: 800; letter-spacing: -0.01em; }
  .fact .k { color: var(--muted); font-size: 13px; margin-top: 4px; }
  table.codes { border-collapse: collapse; margin: 14px 0 6px; width: 100%; max-width: 460px; }
  table.codes td { border-bottom: 1px solid var(--line); padding: 9px 12px 9px 0; }
  ol.rollup { list-style: none; padding: 0; margin: 12px 0; }
  ol.rollup li { padding: 8px 0 8px 24px; position: relative; color: var(--muted); }
  ol.rollup li::before { content: "↑"; position: absolute; left: 4px; color: var(--faint); }
  ol.rollup li.is-this { color: var(--text); font-weight: 700; }
  ol.rollup li.is-this::before { content: "→"; color: var(--green); }
  main p { max-width: 720px; margin-bottom: 14px; }
  main p + p { margin-top: 0; }
  main h2 + p, main h2 + table { margin-top: 14px; }
  code { background: rgba(255,255,255,0.06); padding: 0 3px; border-radius: 4px; font-size: 0.92em; }
  .prov { color: var(--muted); font-size: 14px; border-top: 1px solid var(--line); padding-top: 16px; margin-top: 40px; }
</style>
</head>
<body>
${headerBlock()}
<main class="wrap" style="padding-top:44px;padding-bottom:64px">
  <p class="kicker">Geography reference</p>
  <h1>${esc(editorial.name)}</h1>
  <p class="lead">${editorial.intro}</p>

  <div class="facts">
    <div class="fact"><div class="n">${num(facts.areas)}</div><div class="k">${esc(editorial.plural)} in ${facts.vintage}</div></div>
    <div class="fact"><div class="n">${area(facts.avgKm2)}</div><div class="k">average size</div></div>
    <div class="fact"><div class="n">${area(facts.minKm2)}</div><div class="k">smallest</div></div>
    <div class="fact"><div class="n">${area(facts.maxKm2)}</div><div class="k">largest</div></div>
  </div>

  <div class="geowrap">
    ${boundariesSvg(facts.sample.geojson)}
  </div>
  <p class="geocap">The ${num(facts.sample.areas)} ${esc(editorial.plural)} of ${esc(facts.sample.label)}, drawn from
     the exact boundaries Vizzie joins your data to — not a picture of them.</p>

  <h2 style="margin-top:44px">How the ${keyNoun} are ${keyVerb}</h2>
  ${editorial.codeFormat}
  ${examples}

  <h2 style="margin-top:44px">What it rolls up into</h2>
  <ol class="rollup">${rollup}</ol>

  <h2 style="margin-top:44px">Which years exist</h2>
  ${editorial.vintages}

  <h2 style="margin-top:44px">Map a spreadsheet of these</h2>
  <p>Paste a column of ${esc(editorial.abbr)} ${keyNoun} into Vizzie with whatever you measured beside it.
     Vizzie recognises the ${keyNoun === 'names' ? 'names' : 'code format'}, joins ${keyNoun === 'names' ? 'them' : 'it'} to the boundaries above and draws the map — no
     shapefile, no download, no GIS install.</p>
  <p><a class="btn" href="https://app.vizzie.org/">Open Vizzie</a></p>

  <p class="prov">
    ${esc(facts.attribution)}<br />
    Licence: ${esc(facts.licence)}. Source: <a href="${esc(facts.sourceUrl)}" rel="nofollow noopener">${esc(editorial.publisher)}</a>.
    Boundary counts and sizes measured from the data Vizzie holds, ${esc(ctx.generatedDate || '')}.
  </p>
</main>
${footerBlock({ ...ctx, generatedDate: null })}
${appScript(ctx)}
${analyticsBlock()}
</body>
</html>`;
}
