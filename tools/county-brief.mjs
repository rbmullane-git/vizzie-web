// county-brief.mjs
// Prints the computed, distinguishing facts for a county so its editorial can
// be written from evidence rather than from impressions.
//
// This exists because the editorial in build-counties.mjs must be *particular*
// — 150 words true of this county and no other — and the fastest way to write
// something particular is to be handed the measure on which this county is
// unlike its peers. Every figure below is derived here from county-facts.json;
// none is typed by hand, and the prose that quotes one should quote it exactly.
//
// The RULE it serves: describe the pattern, never explain its cause. These are
// measures, not reasons.
//
// No network. Usage:  node tools/county-brief.mjs [slug ...]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const FACTS = join(__dir, 'data', 'county-facts.json');

const usd = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en'));
const pc = (n, dp = 1) => (n == null ? '—' : `${(n * 100).toFixed(dp)}%`);
const signedUsd = (n) => (n == null ? '—' : (n < 0 ? '−' : '+') + usd(Math.abs(n)));
 const sgn = (n, dp = 1) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(dp)}%`);

/** Area-weighted centroid of a feature, good enough for a gradient. */
function centroid(feature) {
  let sx = 0, sy = 0, n = 0;
  const g = feature.geometry;
  if (!g) return null;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) { sx += x; sy += y; n++; }
  return n ? [sx / n, sy / n] : null;
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

/** Everything derivable about one county, independent of the peer set. */
export function analyse(f) {
  const ind = f.indicators;
  const values = f.tracts.values;
  const rows = f.tracts.geojson.features
    .map((ft) => ({ v: values[ft.properties.code], c: centroid(ft) }))
    .filter((r) => Number.isFinite(r.v) && r.c);

  // Quintiles by income, so "top fifth vs bottom fifth" is a real split and not
  // a rhetorical one.
  const sorted = [...rows].sort((a, b) => a.v - b.v);
  const q = Math.floor(sorted.length / 5);
  const mean = (a) => (a.length ? a.reduce((s, r) => s + r.v, 0) / a.length : null);
  const bottom = mean(sorted.slice(0, q));
  const top = mean(sorted.slice(-q));

  const rLon = pearson(rows.map((r) => r.c[0]), rows.map((r) => r.v));
  const rLat = pearson(rows.map((r) => r.c[1]), rows.map((r) => r.v));
  // Report whichever axis is stronger — some counties split east-west, some
  // north-south, and some not spatially at all.
  const axis = Math.abs(rLon ?? 0) >= Math.abs(rLat ?? 0)
    // Longitude increases eastward, so a POSITIVE correlation means income
    // rises to the east. Getting this backwards puts the wrong half of a city
    // in the wrong half of a sentence.
    ? { name: 'longitude', r: rLon, rises: rLon > 0 ? 'east' : 'west' }
    : { name: 'latitude', r: rLat, rises: rLat > 0 ? 'north' : 'south' };

  return {
    slug: f.slug,
    place: `${f.name}, ${f.state}`,
    population: ind.population,
    growth: ind.populationPrev ? ind.population / ind.populationPrev - 1 : null,
    income: ind.medianIncome,
    vsState: ind.medianIncome && f.comparison.medianIncome.state ? ind.medianIncome - f.comparison.medianIncome.state : null,
    vsNational: ind.medianIncome && f.comparison.medianIncome.national ? ind.medianIncome - f.comparison.medianIncome.national : null,
    medianAge: ind.medianAge,
    ageVsNational: ind.medianAge && f.comparison.medianAge.national ? ind.medianAge - f.comparison.medianAge.national : null,
    ownership: ind.tenureTotal ? ind.ownerOccupied / ind.tenureTotal : null,
    ownershipVsNational: f.comparison.ownership.national,
    transit: ind.commuteTotal ? ind.transitCommuters / ind.commuteTotal : null,
    tracts: f.tracts.count,
    uninhabited: f.tracts.uninhabited,
    suppressed: f.tracts.suppressed,
    joinRate: f.tracts.joinRate,
    quintileTop: top,
    quintileBottom: bottom,
    quintileRatio: top && bottom ? top / bottom : null,
    axis,
  };
}

const facts = JSON.parse(readFileSync(FACTS, 'utf8'));
const all = Object.values(facts.counties).map(analyse);

/** Where this county sits among the 40 — the fastest route to what is particular. */
function ranks(a) {
  const of = (key, dir = -1) => {
    const ordered = all.filter((x) => x[key] != null).sort((x, y) => (x[key] - y[key]) * dir);
    const i = ordered.findIndex((x) => x.slug === a.slug);
    return i < 0 ? null : `${i + 1} of ${ordered.length}`;
  };
  return {
    income: of('income'), growth: of('growth'), quintileRatio: of('quintileRatio'),
    transit: of('transit'), ownership: of('ownership'), medianAge: of('medianAge'),
    spatialGradient: (() => {
      const ordered = all.filter((x) => x.axis.r != null).sort((x, y) => Math.abs(y.axis.r) - Math.abs(x.axis.r));
      const i = ordered.findIndex((x) => x.slug === a.slug);
      return i < 0 ? null : `${i + 1} of ${ordered.length}`;
    })(),
  };
}

const wanted = process.argv.slice(2);
const chosen = wanted.length ? all.filter((a) => wanted.includes(a.slug)) : all;

for (const a of chosen) {
  const r = ranks(a);
  console.log(`\n${'='.repeat(74)}\n${a.place}   (${a.slug})\n${'='.repeat(74)}`);
  console.log(`  population      ${a.population?.toLocaleString('en')}  ${sgn(a.growth)} in a decade        [growth rank ${r.growth}]`);
  console.log(`  median income   ${usd(a.income)}   ${signedUsd(a.vsState)} vs state, ${signedUsd(a.vsNational)} vs US   [rank ${r.income}]`);
  console.log(`  median age      ${a.medianAge}  (${a.ageVsNational >= 0 ? '+' : ''}${a.ageVsNational?.toFixed(1)} vs US)            [rank ${r.medianAge}]`);
  console.log(`  own their home  ${pc(a.ownership, 0)}  vs ${pc(a.ownershipVsNational, 0)} nationally          [rank ${r.ownership}]`);
  console.log(`  transit commute ${pc(a.transit)}                                  [rank ${r.transit}]`);
  console.log(`  ── within the county ──`);
  console.log(`  tracts          ${a.tracts}  (${a.uninhabited} uninhabited, ${a.suppressed} suppressed, join ${pc(a.joinRate)})`);
  console.log(`  top fifth       ${usd(a.quintileTop)}   bottom fifth ${usd(a.quintileBottom)}`);
  console.log(`  ratio           ${a.quintileRatio?.toFixed(2)} to 1                             [rank ${r.quintileRatio}]`);
  console.log(`  gradient        r = ${a.axis.r?.toFixed(2)} on ${a.axis.name} — income rises to the ${a.axis.rises}   [strength rank ${r.spatialGradient}]`);
}

if (!wanted.length) {
  console.log(`\n${'='.repeat(74)}\nPEER SET — what each county is most unlike its peers on\n${'='.repeat(74)}`);
  const lead = (key, label, fmt, dir = -1) => {
    const ordered = all.filter((x) => x[key] != null).sort((x, y) => (x[key] - y[key]) * dir);
    console.log(`\n  ${label}`);
    for (const a of ordered.slice(0, 3)) console.log(`    high  ${a.place.padEnd(30)}${fmt(a[key])}`);
    for (const a of ordered.slice(-2)) console.log(`    low   ${a.place.padEnd(30)}${fmt(a[key])}`);
  };
  lead('quintileRatio', 'Internal inequality (top fifth ÷ bottom fifth)', (v) => v.toFixed(2) + ' to 1');
  lead('growth', 'Population change over the decade', (v) => sgn(v));
  lead('income', 'Median household income', usd);
  lead('transit', 'Transit commute share', (v) => pc(v));
  lead('ownership', 'Home ownership', (v) => pc(v, 0));
}
