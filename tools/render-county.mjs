// render-county.mjs
// Renders /geography/us-county/<slug>/ — one page per county, for the searcher
// who typed "[county] census data" and wants the picture, not the table.
//
// Chrome comes from render-portal.mjs and the projection from
// render-geography.mjs, so an area page cannot drift from the level page above
// it, visually or geometrically.
//
// Exports: renderCountyPage(facts, editorial, ctx) -> full HTML string
//          choroplethSvg(geojson, opts) -> inline SVG
//          quantileBreaks(values, n) -> number[]

import { esc, styleBlock, headerBlock, footerBlock, appScript, analyticsBlock } from './render-portal.mjs';
import { projection, pathFor } from './render-geography.mjs';

// A five-step sequential ramp in the brand hue, stepped for the DARK surface
// these pages sit on (--panel #161a21) rather than flipped from a light ramp.
// Lightness is monotonic and near-evenly spaced in OKLab (ΔL 0.084–0.106), so
// the ramp still reads in greyscale and in print; #d9349b, the middle step, is
// the brand magenta itself. Contrast against the panel runs 1.82:1 at the
// bottom to 8.71:1 at the top — the low end is deliberately quiet, which is
// what a sequential ramp on a dark surface is for, and the legend carries the
// numbers so magnitude is never colour-alone.
export const RAMP = ['#88005a', '#b3007b', '#d9349b', '#f963bb', '#ff94d8'];

// Neutral grey, not a ramp step: no-data has to be unmistakably *outside* the
// scale rather than "the lowest class". Hue does most of that work (grey vs
// magenta) and the 45° hatch does the rest, for greyscale and forced-colors.
export const NO_DATA = '#6b7482';

const num = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('en'));
const usd = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : '$' + Math.round(Number(n)).toLocaleString('en'));
const pct = (n, dp = 1) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : `${(Number(n) * 100).toFixed(dp)}%`);
const signedPct = (n, dp = 1) =>
  n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : `${n >= 0 ? '+' : ''}${(Number(n) * 100).toFixed(dp)}%`;

/**
 * Quantile breaks — n classes, so each colour carries roughly the same number
 * of tracts. Equal-interval would hand four of five classes to one colour in
 * any county with a skewed income distribution, which is most of them.
 * Returns the n-1 interior cut points.
 */
export function quantileBreaks(values, n = 5) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < n) return [];
  const cuts = [];
  for (let i = 1; i < n; i++) cuts.push(v[Math.floor((i * v.length) / n)]);
  // A county where a whole quantile shares one value (small tract counts, or a
  // topcoded income) would otherwise produce a break that classifies nothing.
  return [...new Set(cuts)];
}

const classOf = (value, breaks) => {
  if (!Number.isFinite(value)) return -1;
  let i = 0;
  while (i < breaks.length && value >= breaks[i]) i++;
  return i;
};

/**
 * A choropleth as one inline SVG. No tiles, no JavaScript, no third-party map
 * service, and no call to /api/wizard/geography-shapes — a crawler working
 * through the estate would otherwise hammer a rate-limited route (seo-plan §8.5).
 *
 * Per-feature <title> gives a native hover tooltip in every browser and a name
 * to a screen reader, without shipping a byte of script to a marketing page.
 */
export function choroplethSvg(geojson, { values, breaks, format = num, label = '', width = 760, height = 520, pad = 8 } = {}) {
  const proj = projection(geojson, { width, height, pad });
  if (!proj) return '';

  const paths = geojson.features
    .map((f) => {
      const code = f.properties?.code;
      const value = values.get(code);
      const cls = classOf(value, breaks);
      const fill = cls < 0 ? `url(#nodata)` : RAMP[Math.min(cls, RAMP.length - 1)];
      const name = f.properties?.name || code || '';
      const shown = cls < 0 ? 'no data' : format(value);
      return (
        `<path d="${pathFor(f, proj)}" fill="${fill}" ` +
        // 0.5px rather than the 2px gap a bar chart gets: at this scale 2px
        // closes over an urban tract entirely. The stroke is the panel colour,
        // so it reads as a gap rather than an outline.
        `stroke="#161a21" stroke-width="0.5" stroke-linejoin="round">` +
        `<title>${esc(`${name} — ${shown}`)}</title></path>`
      );
    })
    .join('');

  return (
    `<svg class="geomap" viewBox="0 0 ${width} ${height}" role="img" xmlns="http://www.w3.org/2000/svg" ` +
    `aria-label="${esc(label)}">` +
    `<defs><pattern id="nodata" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="6" height="6" fill="${NO_DATA}" opacity="0.35"/>` +
    `<line x1="0" y1="0" x2="0" y2="6" stroke="${NO_DATA}" stroke-width="2"/></pattern></defs>` +
    paths +
    `</svg>`
  );
}

/**
 * The hatched areas are two different things and the caption says which. A tract
 * with no occupied households cannot have a median household income at all; a
 * tract that has households and still no published figure was suppressed by the
 * survey. Rolling them together overstates a coverage problem that is mostly
 * geography — on the first 40-county run it read as a 7-9% failure in Detroit,
 * the Bronx, Queens and Philadelphia, whose maps were in fact correct.
 */
function captionGap(t) {
  const uninhabited = t.uninhabited ?? 0;
  const suppressed = t.suppressed ?? t.count - t.withValue;
  const eligible = t.eligible ?? t.count;
  if (!uninhabited && !suppressed) return 'Every tract carries a value.';

  const clauses = [];
  if (uninhabited) {
    clauses.push(
      `${num(uninhabited)} ${uninhabited === 1 ? 'has' : 'have'} no households at all ` +
        `(parks, water, airports and institutional land)`,
    );
  }
  if (suppressed) {
    clauses.push(
      `${num(suppressed)} ${suppressed === 1 ? 'is' : 'are'} too small for the survey ` +
        `to publish a median safely`,
    );
  }
  const hatched = clauses.length > 1 ? 'Both groups are hatched.' : 'Those are hatched.';
  return (
    `${num(t.withValue)} of ${num(eligible)} inhabited tracts carry a value. ` +
    `Of the rest, ${clauses.join(' and ')}. ${hatched}`
  );
}

/** The legend: five steps with their cut points, plus the no-data key. */
function legend(breaks, format, anyMissing) {
  const lo = (i) => (i === 0 ? '' : format(breaks[i - 1]));
  const hi = (i) => (i >= breaks.length ? '' : format(breaks[i]));
  const cells = RAMP.slice(0, breaks.length + 1)
    .map((c, i) => {
      const range = i === 0 ? `under ${hi(0)}` : i > breaks.length - 1 ? `${lo(i)} and over` : `${lo(i)}–${hi(i)}`;
      return `<li><span class="sw" style="background:${c}"></span>${esc(range)}</li>`;
    })
    .join('');
  const missing = anyMissing ? `<li><span class="sw sw-nodata"></span>no data</li>` : '';
  return `<ul class="legend">${cells}${missing}</ul>`;
}

// The call to action opens THIS county when `ctx.viewToken` is set — a hosted
// published map at `#view=<token>`, which the app serves to anyone, signed in or
// not. Without a token it falls back to the plain studio and says so, because an
// earlier draft linked `?geo=us-county&fips=…` which the app silently ignores:
// the visitor landed on an empty editor having just been promised this map.
// Never promise the county unless the token is actually there.
// `utm_content` carries the slug either way, so the funnel reports which county
// sent the visit.
export function renderCountyPage(facts, editorial, ctx = {}) {
  const siteUrl = ctx.siteUrl || 'https://www.vizzie.org';
  const url = `${siteUrl}/geography/us-county/${facts.slug}/`;
  const appUrl = ctx.appUrl || 'https://app.vizzie.org';
  const ind = facts.indicators;
  const place = `${facts.name}, ${facts.state}`;

  const title = `${place} — census data, demographics and maps | Vizzie`;
  const description =
    `${num(ind.population)} people across ${num(facts.tracts.count)} census tracts. ` +
    `Median household income, age, tenure and commute for ${place}, from the ${facts.acsYear} ` +
    `American Community Survey — mapped, not tabulated.`;

  const growth = ind.populationPrev ? ind.population / ind.populationPrev - 1 : null;
  const ownership = ind.tenureTotal ? ind.ownerOccupied / ind.tenureTotal : null;
  const transit = ind.commuteTotal ? ind.transitCommuters / ind.commuteTotal : null;

  const breaks = facts.tracts.breaks;
  const values = new Map(Object.entries(facts.tracts.values).map(([k, v]) => [k, Number(v)]));
  const anyMissing = facts.tracts.withValue < facts.tracts.count;

  // Dataset for Google Dataset Search, Place so the page is understood as being
  // *about* a county rather than merely mentioning one (seo-plan §8.5).
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      name: `${place} — American Community Survey ${facts.acsYear}, by census tract`,
      description,
      url,
      license: 'https://www.census.gov/about/policies/open-gov/open-data.html',
      creator: { '@type': 'Organization', name: 'US Census Bureau' },
      spatialCoverage: {
        '@type': 'Place',
        name: place,
        identifier: { '@type': 'PropertyValue', propertyID: 'FIPS', value: facts.fips },
      },
      temporalCoverage: String(facts.acsYear),
      isAccessibleForFree: true,
      keywords: [`${facts.name} census data`, `${facts.name} demographics`, `${facts.name} median income`, `${facts.name} population`, 'census tract map'],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Place',
      name: place,
      identifier: { '@type': 'PropertyValue', propertyID: 'FIPS', value: facts.fips },
      containedInPlace: { '@type': 'AdministrativeArea', name: facts.state },
    },
  ];

  const cmp = facts.comparison;
  const cmpRow = (k, format) =>
    `<tr><th>${esc(k.label)}</th><td>${format(k.county)}</td><td>${format(k.state)}</td><td>${format(k.national)}</td></tr>`;

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
<meta property="og:image" content="${esc(siteUrl)}/og-vancouver-street-trees.png" />
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
  ul.legend { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 18px; padding: 0; margin: 14px 2px 2px; font-size: 13px; color: var(--muted); }
  ul.legend li { display: flex; align-items: center; gap: 7px; }
  .sw { width: 15px; height: 15px; border-radius: 3px; display: inline-block; flex: none; }
  .sw-nodata { background: repeating-linear-gradient(45deg, ${NO_DATA} 0 2px, transparent 2px 6px), rgba(107,116,130,0.35); }
  table.cmp { border-collapse: collapse; margin: 16px 0 6px; width: 100%; max-width: 620px; font-variant-numeric: tabular-nums; }
  table.cmp th, table.cmp td { border-bottom: 1px solid var(--line); padding: 10px 14px 10px 0; text-align: right; }
  table.cmp th { text-align: left; font-weight: 600; color: var(--muted); }
  table.cmp thead th { color: var(--text); }
  main p { max-width: 720px; margin-bottom: 14px; }
  main h2 + p, main h2 + table { margin-top: 14px; }
  .prov { color: var(--muted); font-size: 14px; border-top: 1px solid var(--line); padding-top: 16px; margin-top: 40px; }
</style>
</head>
<body>
${headerBlock()}
<main class="wrap" style="padding-top:44px;padding-bottom:64px">
  <p class="kicker"><a href="/geography/us-county/">US counties</a> · community profile</p>
  <h1>${esc(place)}</h1>
  <p class="lead">${editorial.intro}</p>

  <div class="facts">
    <div class="fact"><div class="n">${num(ind.population)}</div><div class="k">people (${facts.acsYear})</div></div>
    <div class="fact"><div class="n">${signedPct(growth)}</div><div class="k">since ${facts.acsPrevYear}</div></div>
    <div class="fact"><div class="n">${usd(ind.medianIncome)}</div><div class="k">median household income</div></div>
    <div class="fact"><div class="n">${ind.medianAge ?? '—'}</div><div class="k">median age</div></div>
    <div class="fact"><div class="n">${pct(ownership, 0)}</div><div class="k">own their home</div></div>
    <div class="fact"><div class="n">${pct(transit, 1)}</div><div class="k">commute by transit</div></div>
  </div>

  <h2 style="margin-top:44px">Median household income, by census tract</h2>
  <div class="geowrap">
    ${choroplethSvg(facts.tracts.geojson, {
      values,
      breaks,
      format: usd,
      label: `Median household income across the ${facts.tracts.count} census tracts of ${place}`,
    })}
    ${legend(breaks, usd, anyMissing)}
  </div>
  <p class="geocap">The ${num(facts.tracts.count)} census tracts of ${esc(place)}, shaded by median household
     income. ${captionGap(facts.tracts)}
     Drawn from the exact boundaries Vizzie joins your data to, not a picture of them.</p>

  <h2 style="margin-top:44px">How it compares</h2>
  <table class="cmp">
    <thead><tr><th></th><th>${esc(facts.name)}</th><th>${esc(facts.state)}</th><th>United States</th></tr></thead>
    <tbody>
      ${cmpRow(cmp.population, num)}
      ${cmpRow(cmp.medianIncome, usd)}
      ${cmpRow(cmp.medianAge, (v) => (v ?? '—'))}
      ${cmpRow(cmp.ownership, (v) => pct(v, 0))}
    </tbody>
  </table>

  <h2 style="margin-top:44px">${esc(editorial.heading)}</h2>
  ${editorial.body}

  <h2 style="margin-top:44px">Map this yourself</h2>
  ${ctx.viewToken
    ? `<p>This map is live. Open it and every tract is yours to interrogate — hover a tract for its
         figure, recolour the classification, or bring a CSV with a column of tract or county
         ${esc('FIPS')} codes and Vizzie joins it to these same boundaries. No shapefile, no
         download, no GIS install. Reading needs no account; saving a copy does.</p>
       <p><a class="btn" href="${esc(appUrl)}/#view=${esc(ctx.viewToken)}">Open this map in the studio</a></p>`
    : `<p>Everything above is public data. Bring a CSV with a column of tract or county
         ${esc('FIPS')} codes and Vizzie joins it to these same boundaries — no shapefile, no
         download, no GIS install. Reading this page needs no account; saving a map, adding your
         own data or publishing does.</p>
       <p><a class="btn" href="${esc(appUrl)}/?utm_source=vizzie-web&amp;utm_medium=geography&amp;utm_campaign=county-profile&amp;utm_content=${esc(facts.slug)}">Open the studio</a></p>`}

  <p class="prov">
    Demography: US Census Bureau, American Community Survey ${facts.acsYear} 5-year estimates
    (and ${facts.acsPrevYear} for the change), public domain.<br />
    ${esc(facts.provenance.attribution)} Licence: ${esc(facts.provenance.licence)}.
    Source: <a href="${esc(facts.provenance.sourceUrl)}" rel="nofollow noopener">US Census Bureau</a>.<br />
    Tract counts and join rates measured from the data Vizzie holds, ${esc(ctx.generatedDate || '')}.
  </p>
</main>
${footerBlock({ ...ctx, generatedDate: null })}
${appScript(ctx)}
${analyticsBlock()}
</body>
</html>`;
}
