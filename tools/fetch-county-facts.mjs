// fetch-county-facts.mjs
// Pulls the facts behind /geography/us-county/<slug>/ into
// tools/data/county-facts.json.
//
// Two sources, and the split matters:
//   • boundaries, tract counts and the licence  -> the production connector DB
//     (the same rows the product joins against)
//   • demography                                -> api.census.gov, ACS 5-year
//
// The join rate on every page is measured BOUNDARY-SIDE: of the tract polygons
// Vizzie holds for the county, how many did the survey return a value for. The
// other direction flatters — the India gallery example matched 99.5% of names
// and still left 13.6% of the map blank.
//
// Needs the Render CLI, RENDER_API_KEY, and CENSUS_API_KEY (the Census API 302s
// every keyless request to a "Missing Key" page — free signup at
// https://api.census.gov/data/key_signup.html). Network, slow.
//
// Usage:  node tools/fetch-county-facts.mjs            # the top N by population
//         node tools/fetch-county-facts.mjs 48453 …    # named county FIPS

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { psql, q } from './connector-db.mjs';
import { quantileBreaks } from './render-county.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, 'data', 'county-facts.json');

const ACS_YEAR = 2023;
const ACS_PREV_YEAR = 2013; // a full decade, so the change is worth printing
const PILOT_SIZE = 40;
const MAP_WIDTH_PX = 760; // must match choroplethSvg's default width in render-county.mjs
const KEY = process.env.CENSUS_API_KEY;

// Which ACS variables the page needs. Seven indicators, so a county can lose
// one to suppression and still clear the six the substance gate asks for.
const VARS = {
  population: 'B01003_001E',
  medianIncome: 'B19013_001E',
  medianAge: 'B01002_001E',
  tenureTotal: 'B25003_001E',
  ownerOccupied: 'B25003_002E',
  commuteTotal: 'B08301_001E',
  transitCommuters: 'B08301_010E',
};

const STATE_ABBR = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL',
  '13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME',
  '24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH',
  '34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI',
  '45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI',
  '56':'WY','72':'PR',
};

/**
 * ACS reports suppression as large negative sentinels (-666666666 and friends)
 * rather than null. Treating those as numbers puts a -$666m tract on the map,
 * which is the single easiest way to ship an embarrassing choropleth.
 */
function acsNum(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= -666666666) return null;
  return n;
}

async function acs(path, params) {
  if (!KEY) throw new Error('CENSUS_API_KEY missing — the Census API 302s keyless requests to a "Missing Key" page.');
  const url = `https://api.census.gov/data/${path}?${new URLSearchParams({ ...params, key: KEY })}`;
  const res = await fetch(url, { redirect: 'follow' });
  const text = await res.text();
  if (!res.ok || text.trimStart().startsWith('<')) {
    throw new Error(`ACS ${path} ${new URLSearchParams(params)} -> HTTP ${res.status}: ${text.slice(0, 160)}`);
  }
  const [header, ...rows] = JSON.parse(text);
  return rows.map((r) => Object.fromEntries(r.map((v, i) => [header[i], v])));
}

const slugify = (name, abbr) =>
  `${name}-${abbr}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function pickCounties(n) {
  process.stderr.write(`selecting the ${n} most populous counties…\n`);
  const rows = await acs(`${ACS_YEAR}/acs/acs5`, { get: `NAME,${VARS.population}`, for: 'county:*', in: 'state:*' });
  return rows
    .map((r) => ({
      fips: `${r.state}${r.county}`,
      stateFips: r.state,
      // "Travis County, Texas" -> name "Travis County", state "Texas"
      name: r.NAME.split(',')[0].trim(),
      state: r.NAME.split(',').slice(1).join(',').trim(),
      population: acsNum(r[VARS.population]) ?? 0,
    }))
    .filter((c) => STATE_ABBR[c.stateFips])
    .sort((a, b) => b.population - a.population)
    .slice(0, n);
}

async function factsFor(county) {
  const { fips, stateFips } = county;
  const cty = fips.slice(2);
  const abbr = STATE_ABBR[stateFips];
  process.stderr.write(`  ${fips} ${county.name}, ${abbr}\n`);

  process.stderr.write(`    indicators…\n`);
  const get = Object.values(VARS).join(',');
  const [now] = await acs(`${ACS_YEAR}/acs/acs5`, { get, for: `county:${cty}`, in: `state:${stateFips}` });
  const [prev] = await acs(`${ACS_PREV_YEAR}/acs/acs5`, {
    get: `${VARS.population},${VARS.medianIncome}`, for: `county:${cty}`, in: `state:${stateFips}`,
  });
  const indicators = Object.fromEntries(Object.entries(VARS).map(([k, v]) => [k, acsNum(now?.[v])]));
  indicators.populationPrev = acsNum(prev?.[VARS.population]);
  indicators.medianIncomePrev = acsNum(prev?.[VARS.medianIncome]);

  process.stderr.write(`    comparison…\n`);
  const cmpGet = `${VARS.population},${VARS.medianIncome},${VARS.medianAge},${VARS.tenureTotal},${VARS.ownerOccupied}`;
  const [st] = await acs(`${ACS_YEAR}/acs/acs5`, { get: cmpGet, for: `state:${stateFips}` });
  const [us] = await acs(`${ACS_YEAR}/acs/acs5`, { get: cmpGet, for: 'us:1' });
  const share = (row) => {
    const t = acsNum(row?.[VARS.tenureTotal]);
    const o = acsNum(row?.[VARS.ownerOccupied]);
    return t ? o / t : null;
  };
  const comparison = {
    population: { label: 'Population', county: indicators.population, state: acsNum(st?.[VARS.population]), national: acsNum(us?.[VARS.population]) },
    medianIncome: { label: 'Median household income', county: indicators.medianIncome, state: acsNum(st?.[VARS.medianIncome]), national: acsNum(us?.[VARS.medianIncome]) },
    medianAge: { label: 'Median age', county: indicators.medianAge, state: acsNum(st?.[VARS.medianAge]), national: acsNum(us?.[VARS.medianAge]) },
    ownership: {
      label: 'Own their home',
      county: indicators.tenureTotal ? indicators.ownerOccupied / indicators.tenureTotal : null,
      state: share(st), national: share(us),
    },
  };

  process.stderr.write(`    tract values…\n`);
  // Occupied households comes back beside the income because it decides which
  // tracts are even ELIGIBLE for a median. A tract with no households cannot
  // have a median household income — a cemetery, an airport, a park, Rikers
  // Island. Counting those as coverage failures measures the wrong thing, and
  // it wrongly failed Wayne, Bronx, Queens and Philadelphia on the first run.
  const tractRows = await acs(`${ACS_YEAR}/acs/acs5`, {
    get: `NAME,${VARS.medianIncome},${VARS.tenureTotal}`, for: 'tract:*', in: `state:${stateFips} county:${cty}`,
  });
  const byCode = new Map();
  const households = new Map();
  for (const r of tractRows) {
    const code = `${r.state}${r.county}${r.tract}`;
    const v = acsNum(r[VARS.medianIncome]);
    if (v !== null) byCode.set(code, v);
    households.set(code, acsNum(r[VARS.tenureTotal]) ?? 0);
  }

  process.stderr.write(`    tract boundaries…\n`);
  // The simplification tolerance is DERIVED from the scale the map is actually
  // drawn at, not guessed. The county is fitted to MAP_WIDTH_PX, so one pixel is
  // (bbox span / 760) degrees and half a pixel is the finest detail that can
  // possibly survive rasterisation. A fixed constant is wrong at both ends: at
  // 0.0002 degrees Los Angeles was carrying a tenth of a pixel of detail across
  // 2,495 tracts, and Travis a fifth of one.
  //
  // Coordinates go to 4 decimal places (~11 m), still an order of magnitude finer
  // than the tolerance. Note the coupling: MAP_WIDTH_PX must track the default
  // width in render-county.mjs's choroplethSvg.
  const [sample] = psql(`
    WITH b AS (
      SELECT ST_Extent(geom) AS e FROM reference_geographies
      WHERE country='US' AND level='TRACT' AND code LIKE ${q(fips + '%')}
    )
    SELECT json_build_object(
      'type','FeatureCollection',
      'features', coalesce(json_agg(json_build_object(
        'type','Feature',
        'properties', json_build_object('code', g.code, 'name', g.name),
        'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(g.geom,
           GREATEST(ST_XMax(b.e) - ST_XMin(b.e), ST_YMax(b.e) - ST_YMin(b.e)) / (${MAP_WIDTH_PX} * 2)), 4)::json
      )), '[]'::json))::text
    FROM reference_geographies g, b
    WHERE g.country='US' AND g.level='TRACT' AND g.code LIKE ${q(fips + '%')};`);
  const geojson = JSON.parse(sample[0]);

  // Boundary-side: iterate the polygons we hold, not the rows ACS returned.
  const values = {};
  let withValue = 0;
  let uninhabited = 0;
  for (const f of geojson.features) {
    const code = f.properties.code;
    if (households.get(code) === 0) uninhabited++;
    const v = byCode.get(code);
    if (v !== null && v !== undefined) { values[code] = v; withValue++; }
  }
  const count = geojson.features.length;
  // The denominator is inhabited tracts, not every polygon. `suppressed` is the
  // genuine gap — tracts that have households and still got no published median,
  // usually because the sample was too small to publish safely.
  const eligible = count - uninhabited;

  const [src] = psql(`
    SELECT source_url, coalesce(licence,''), licence_confirmed, attribution
    FROM reference_geography_sources WHERE country='US' AND level='TRACT' ORDER BY vintage DESC LIMIT 1;`);
  if (!src) throw new Error(`${fips}: no reference_geography_sources row for US/TRACT — refusing to publish geometry with no credit line`);
  if (src[2] !== 't') throw new Error(`${fips}: US/TRACT licence is unconfirmed — not publishable`);

  return {
    fips,
    stateFips,
    slug: slugify(county.name, abbr),
    name: county.name,
    state: county.state,
    stateAbbr: abbr,
    acsYear: ACS_YEAR,
    acsPrevYear: ACS_PREV_YEAR,
    indicators,
    comparison,
    tracts: {
      count,
      withValue,
      uninhabited,
      eligible,
      suppressed: eligible - withValue,
      joinRate: eligible ? withValue / eligible : 0,
      variable: 'Median household income',
      breaks: quantileBreaks(Object.values(values), 5),
      values,
      geojson,
    },
    provenance: { sourceUrl: src[0], licence: src[1], attribution: src[3] },
  };
}

const wantedFips = process.argv.slice(2);
const counties = wantedFips.length
  ? (await pickCounties(3234)).filter((c) => wantedFips.includes(c.fips))
  : await pickCounties(PILOT_SIZE);
if (!counties.length) {
  console.error('no counties selected');
  process.exit(1);
}

const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { counties: {} };
const out = { generatedAt: new Date().toISOString().slice(0, 10), acsYear: ACS_YEAR, counties: { ...existing.counties } };
const failed = [];
for (const c of counties) {
  try {
    const f = await factsFor(c);
    out.counties[f.slug] = f;
  } catch (err) {
    // One county's suppression or missing boundaries must not lose the other 39.
    failed.push(`${c.fips} ${c.name}: ${err.message}`);
    process.stderr.write(`    SKIPPED — ${err.message}\n`);
  }
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
process.stderr.write(`\nwrote ${OUT} (${Object.keys(out.counties).length} county/counties)\n`);
if (failed.length) process.stderr.write(`${failed.length} failed:\n  ${failed.join('\n  ')}\n`);
