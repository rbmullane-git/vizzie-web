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
  const [sample] = psql(`
    SELECT json_build_object(
      'type','FeatureCollection',
      'features', coalesce(json_agg(json_build_object(
        'type','Feature',
        'properties', json_build_object('code', code, 'name', name),
        'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.00015))::json
      )), '[]'::json))::text
    FROM reference_geographies
    WHERE ${where} AND name LIKE ${q(cfg.sample.match)};`);
  const sampleGeo = JSON.parse(sample[0]);
  if (!sampleGeo.features.length) throw new Error(`${cfg.slug}: sample match ${cfg.sample.match} returned no areas`);

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
