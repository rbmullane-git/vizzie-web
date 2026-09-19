// fetch-geography-facts.mjs
// Pulls the facts behind /geography/** out of the production connector database
// and writes tools/data/geography-facts.json.
//
// The counts, vintages, licences, attributions and code examples on these pages
// are the same rows the product joins against, so they are read from the
// database rather than retyped — the same rule the portal pages follow. Nothing
// about a geography should be typed into a page by hand.
//
// Needs the Render CLI and RENDER_API_KEY (see tools/README.md). Network, slow.
//
// Usage:  node tools/fetch-geography-facts.mjs [slug ...]

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, 'data', 'geography-facts.json');
const DB = 'vizzie-connector-db';

// Which levels get a page, and the one thing the database cannot supply: the
// sample area whose boundaries the page draws. Alternate keys (LSOA vs
// LSOA_NAME) are the same boundaries and share one page.
export const GEOGRAPHY_LEVELS = [
  {
    slug: 'uk-lsoa',
    country: 'UK',
    level: 'LSOA',
    // The LSOA name carries its district, so a LIKE on the prefix gives a whole
    // town's worth of boundaries — enough to show the grain without shipping a
    // national outline into an HTML page.
    sample: { match: 'Oxford %', label: 'Oxford' },
  },
  // Most geographies do not carry their place in the name the way an LSOA does.
  // A US census tract is called "Census Tract 5.04" and there are dozens of
  // those; a Canadian one is called "0725.04". What locates them is the code —
  // the first five digits of a tract code are its county FIPS — so these levels
  // sample on `codeMatch` instead. One or the other, never both.
  {
    slug: 'us-tract',
    country: 'US',
    level: 'TRACT',
    sample: { codeMatch: '06075%', label: 'San Francisco County' },
  },
  {
    slug: 'us-county',
    country: 'US',
    level: 'COUNTY',
    simplify: 0.004,
    sample: { codeMatch: '06%', label: 'California' },
  },
  {
    slug: 'uk-lad',
    country: 'UK',
    level: 'LAD',
    simplify: 0.002,
    // W06 is every Welsh principal area: a complete, self-contained country's
    // worth at 22 areas, where an English region would be an arbitrary slice.
    sample: { codeMatch: 'W06%', label: 'Wales' },
  },
  {
    slug: 'au-sa2',
    country: 'AU',
    level: 'SA2',
    simplify: 0.0005,
    // 801 is the ACT: the one Australian state or territory small enough to
    // draw whole at SA2 grain.
    sample: { codeMatch: '801%', label: 'Australian Capital Territory' },
  },
  {
    slug: 'eu-nuts3',
    country: 'EU',
    level: 'NUTS3',
    sample: { codeMatch: 'PT%', label: 'Portugal' },
  },
  // India is keyed by NAME, not by a code, because no open boundary source
  // carries the LGD codes Indian data is published with. That makes the whole
  // country the only honest sample at state level — there is no code prefix to
  // slice on — and it is small enough to draw: 36 areas.
  {
    slug: 'in-state-name',
    country: 'IN',
    level: 'STATE_NAME',
    simplify: 0.02,
    precision: 4,
    sample: { match: '%', label: 'India' },
  },
  {
    slug: 'in-district-name',
    country: 'IN',
    level: 'DISTRICT_NAME',
    simplify: 0.001,
    precision: 4,
    // And at district grain the name key bites: with no state in the code there
    // is no prefix that means "one state's districts", the way W06 means Wales.
    // So this sample is selected SPATIALLY, against the state boundaries in the
    // same table. Kerala is the Welsh-LAD of India here — 14 districts, a
    // complete self-contained state, recognisable at thumbnail size.
    sample: { within: { level: 'STATE_NAME', name: 'Kerala' }, label: 'Kerala' },
  },
];

function psql(sql) {
  const raw = execFileSync(
    'render',
    ['psql', DB, '--command', sql, '--output', 'json', '--confirm'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  const text = JSON.parse(raw).output ?? '';
  const lines = text.split('\n');
  // psql aligned output: header, rule, rows…, "(n rows)", blank. Long values are
  // not wrapped (verified against a 5,000-character value), so a data row is one
  // line — which is what makes it safe to pull GeoJSON back through this.
  const ruleAt = lines.findIndex((l) => /^-+(\+-+)*$/.test(l.trim()));
  if (ruleAt < 0) throw new Error(`unexpected psql output:\n${text.slice(0, 400)}`);
  const end = lines.findIndex((l) => /^\(\d+ rows?\)$/.test(l.trim()));
  return lines
    .slice(ruleAt + 1, end < 0 ? undefined : end)
    .filter((l) => l.trim() !== '')
    .map((l) => l.split('|').map((c) => c.trim()));
}

function q(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function factsFor(cfg) {
  const where = `country=${q(cfg.country)} AND level=${q(cfg.level)}`;
  process.stderr.write(`  ${cfg.slug}: counts…\n`);
  const [stats] = psql(`
    SELECT count(*), max(vintage),
           round((avg(ST_Area(geom::geography))/1e6)::numeric, 3),
           round((min(ST_Area(geom::geography))/1e6)::numeric, 4),
           round((max(ST_Area(geom::geography))/1e6)::numeric, 1)
    FROM reference_geographies WHERE ${where};`);
  if (!stats || Number(stats[0]) === 0) throw new Error(`${cfg.slug}: no rows in reference_geographies`);

  process.stderr.write(`  ${cfg.slug}: provenance…\n`);
  const [src] = psql(`
    SELECT source_url, coalesce(licence,''), licence_confirmed, attribution
    FROM reference_geography_sources WHERE ${where} ORDER BY vintage DESC LIMIT 1;`);
  if (!src) throw new Error(`${cfg.slug}: no reference_geography_sources row — refusing to publish geometry with no credit line`);
  if (src[2] !== 't') throw new Error(`${cfg.slug}: licence is unconfirmed — not publishable`);

  process.stderr.write(`  ${cfg.slug}: worked examples…\n`);
  const examples = psql(`
    SELECT code, name FROM reference_geographies
    WHERE ${where} AND name IS NOT NULL AND name <> code
    ORDER BY md5(code) LIMIT 4;`).map(([code, name]) => ({ code, name }));

  process.stderr.write(`  ${cfg.slug}: sample boundaries (${cfg.sample.label})…\n`);
  // One tolerance does not fit every scale. 0.00015 degrees keeps an LSOA's
  // shape honest, but applied to a county it ships a coastline: California's 58
  // counties came back as 895 KB of GeoJSON, which is most of a page's weight
  // spent on detail nobody can see at the size these maps draw. Coarser
  // geographies get a coarser tolerance, and the cost was measured in PostGIS
  // rather than guessed: the shipped tolerances move a boundary by at most
  // 445 m (US county), 222 m (UK LAD) and 56 m (AU SA2), against thumbnails
  // that draw California at roughly 3 km per pixel. These are locator maps for
  // the page, not the geometry the product joins against — that comes from the
  // database at full resolution.
  const simplify = cfg.simplify ?? 0.00015;
  // Coordinate precision, in decimal places. PostGIS defaults to 9 (~0.1 mm),
  // which is pure waste once a geometry has been simplified to kilometres:
  // India's 36 states came back as 983 KB, five times any other page, because
  // of its island chains. Trimming to 4 places (~11 m) against a 0.02 degree
  // (~2.2 km) tolerance took that to 190 KB with no state dropped and no seams
  // between neighbours — which is what SimplifyPreserveTopology buys and plain
  // ST_Simplify, which does drop whole islands, does not. Left at the PostGIS
  // default where a level does not ask, so existing pages do not move.
  const precision = cfg.precision ?? 9;
  const sampleWhere = cfg.sample.codeMatch
    ? `code LIKE ${q(cfg.sample.codeMatch)}`
    : cfg.sample.within
      // A name-keyed level has no parent in its code, so "one state's
      // districts" can only be asked geometrically. PointOnSurface rather than
      // Centroid: a centroid can fall outside a coastal or crescent-shaped
      // district and drop it from its own state.
      ? `EXISTS (SELECT 1 FROM reference_geographies p
                  WHERE p.country=${q(cfg.country)} AND p.level=${q(cfg.sample.within.level)}
                    AND p.name=${q(cfg.sample.within.name)}
                    AND ST_Contains(p.geom, ST_PointOnSurface(reference_geographies.geom)))`
      : `name LIKE ${q(cfg.sample.match)}`;
  const [sample] = psql(`
    SELECT json_build_object(
      'type','FeatureCollection',
      'features', coalesce(json_agg(json_build_object(
        'type','Feature',
        'properties', json_build_object('code', code, 'name', name),
        'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, ${simplify}), ${precision})::json
      )), '[]'::json))::text
    FROM reference_geographies
    WHERE ${where} AND ${sampleWhere};`);
  const sampleGeo = JSON.parse(sample[0]);
  if (!sampleGeo.features.length) {
    throw new Error(`${cfg.slug}: sample match ${cfg.sample.codeMatch ?? cfg.sample.match} returned no areas`);
  }

  return {
    slug: cfg.slug,
    country: cfg.country,
    level: cfg.level,
    areas: Number(stats[0]),
    vintage: Number(stats[1]),
    avgKm2: Number(stats[2]),
    minKm2: Number(stats[3]),
    maxKm2: Number(stats[4]),
    sourceUrl: src[0],
    licence: src[1],
    attribution: src[3],
    examples,
    sample: { label: cfg.sample.label, areas: sampleGeo.features.length, geojson: sampleGeo },
  };
}

const wanted = process.argv.slice(2);
const levels = wanted.length ? GEOGRAPHY_LEVELS.filter((c) => wanted.includes(c.slug)) : GEOGRAPHY_LEVELS;
if (!levels.length) {
  console.error(`no such level; known: ${GEOGRAPHY_LEVELS.map((c) => c.slug).join(', ')}`);
  process.exit(1);
}

const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { levels: {} };
const out = { generatedAt: new Date().toISOString().slice(0, 10), levels: { ...existing.levels } };
for (const cfg of levels) out.levels[cfg.slug] = factsFor(cfg);
writeFileSync(OUT, JSON.stringify(out, null, 1));
process.stderr.write(`wrote ${OUT} (${Object.keys(out.levels).length} level(s))\n`);
