/**
 * build-ejscreen-extracts.mjs — cut per-state tract extracts from EPA's EJScreen.
 *
 * EPA removed EJScreen from its website on 5 February 2025 and shut the tool
 * down that March. The data is a US federal government work and never left the
 * public domain — only the tool that read it disappeared. The archival copy
 * lives on Harvard Dataverse under a declared CC0 1.0 licence, which is why
 * that deposit is the source here and not one of the ArcGIS mirrors: the
 * Public Environmental Data Partners services declare no licence at all, and
 * two of them are mislabelled (`EJScreenUSPercentilesCensusTracts` is actually
 * block groups — 243,022 rows with 12-digit ids).
 *
 * WHY PER-STATE, AND NOT ONE NATIONAL FILE. The national tract file is 85,396
 * rows against the connector's 50,000-row ingest cap, so a US-wide extract
 * would truncate to 58% of the country without saying so. A state is the
 * largest honest unit.
 *
 * THE JOIN CHECK IS THE POINT OF THIS SCRIPT, not the filtering. It measures
 * coverage in BOTH directions against the exact Census cartographic boundary
 * file the connector's `us-tract` loader seeds from, and exits non-zero if the
 * boundary side regresses. Row-side match rate is the number that lies: the
 * India gallery example matched 99.5% of its rows and still drew 13.6% of the
 * map blank, because the misses were all on the boundary side.
 *
 * Usage:
 *   node tools/build-ejscreen-extracts.mjs              # CA, TX, NY
 *   node tools/build-ejscreen-extracts.mjs CA           # one state
 */
import { createReadStream, existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dir, '..');
const CACHE = join(__dir, '.cache', 'ejscreen');
const OUT_DIR = join(WEB, 'data', 'ejscreen');

// Harvard Dataverse, doi:10.7910/DVN/RLR5AX — "EJScreen_2024_Tract_with_AS_CNMI_GU_VI.csv".
// Tract level, US-relative percentiles. 152,658,269 bytes.
const SOURCE_URL = 'https://dataverse.harvard.edu/api/access/datafile/10775979';
// The identical file the connector's us-tract loader reads (loaderConfigs.ts).
const BOUNDARY_URL =
  'https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_tract_500k.zip';

const DEFAULT_STATES = ['CA', 'TX', 'NY'];
/** State FIPS prefix, so a state's boundaries can be picked out of the national file. */
const STATE_FIPS = { CA: '06', TX: '48', NY: '36' };
/** Below this, stop and look — a real regression, not a rounding wobble. */
const MIN_BOUNDARY_SIDE = 0.995;

// Only the columns that surface in the UI are renamed. Every indicator keeps
// its EPA field name, because that is what the EJScreen technical
// documentation uses and what a practitioner searches for.
const RENAME = {
  ID: 'GEOID',
  STATE_NAME: 'State',
  CNTY_NAME: 'County',
  ACSTOTPOP: 'Population',
  EXCEED_COUNT_80: 'EJ indexes above 80th percentile',
};
const KEEP = [
  'ID', 'STATE_NAME', 'CNTY_NAME', 'ACSTOTPOP', 'EXCEED_COUNT_80',
  'DEMOGIDX_2', 'PEOPCOLORPCT', 'LOWINCPCT', 'UNEMPPCT', 'DISABILITYPCT',
  'LINGISOPCT', 'LESSHSPCT', 'UNDER5PCT', 'OVER64PCT', 'LIFEEXPPCT',
  'PM25', 'OZONE', 'DSLPM', 'RSEI_AIR', 'PTRAF', 'PRE1960PCT', 'PNPL', 'PRMP',
  'PTSDF', 'UST', 'PWDIS', 'NO2', 'DWATER',
  'P_DEMOGIDX_2', 'P_PM25', 'P_OZONE', 'P_DSLPM', 'P_PTRAF', 'P_NO2', 'P_LIFEEXPPCT',
];
const INT = new Set([
  'ACSTOTPOP', 'EXCEED_COUNT_80', 'P_DEMOGIDX_2', 'P_PM25', 'P_OZONE',
  'P_DSLPM', 'P_PTRAF', 'P_NO2', 'P_LIFEEXPPCT',
]);
// EPA ships 15 decimals on ACS-derived shares. The extra digits are not
// information, and they tripled the file the studio re-fetches on open.
const DEC4 = new Set([
  'DEMOGIDX_2', 'PEOPCOLORPCT', 'LOWINCPCT', 'UNEMPPCT', 'DISABILITYPCT',
  'LINGISOPCT', 'LESSHSPCT', 'UNDER5PCT', 'OVER64PCT', 'LIFEEXPPCT', 'PRE1960PCT',
]);
const BLANK = new Set(['', 'None', 'NA', 'NaN', 'nan']);

/** Water-only tracts: code 9900-9999, population 0, absent from the 500k boundary file. */
const isWaterTract = (geoid) => geoid.slice(5).startsWith('99');

function trim(field, value) {
  const v = (value ?? '').trim();
  if (BLANK.has(v)) return '';
  if (INT.has(field)) {
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.round(n)) : '';
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return String(Number(n.toFixed(DEC4.has(field) ? 4 : 3)));
}

/** The source carries no quoted fields (verified across all 86,082 rows), but a
 *  county name with a comma would corrupt the output silently, so quote on write. */
const csvCell = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

async function cached(url, name) {
  const path = join(CACHE, name);
  if (existsSync(path)) return path;
  mkdirSync(CACHE, { recursive: true });
  process.stdout.write(`  fetching ${name} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const tmp = `${path}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  await rename(tmp, path);
  console.log('done');
  return path;
}

/**
 * GEOIDs out of the shapefile's .dbf, without a shapefile library. The dBASE
 * header gives a fixed-width record layout: 32-byte file header, then one
 * 32-byte descriptor per field until a 0x0D terminator.
 */
function boundaryGeoids(zipPath) {
  const buf = execFileSync('unzip', ['-p', zipPath, '*.dbf'], {
    maxBuffer: 512 * 1024 * 1024,
    encoding: 'buffer',
  });
  const recordCount = buf.readUInt32LE(4);
  const headerLength = buf.readUInt16LE(8);
  const recordLength = buf.readUInt16LE(10);

  let offset = 32;
  let column = 1; // byte 0 of each record is the deletion flag
  let geoid = null;
  while (buf[offset] !== 0x0d) {
    const name = buf.subarray(offset, offset + 11).toString('latin1').replace(/\0.*$/, '');
    const length = buf[offset + 16];
    if (name === 'GEOID') geoid = { at: column, length };
    column += length;
    offset += 32;
  }
  if (!geoid) throw new Error('no GEOID field in the boundary .dbf');

  const out = new Set();
  for (let i = 0; i < recordCount; i += 1) {
    const at = headerLength + i * recordLength + geoid.at;
    out.add(buf.subarray(at, at + geoid.length).toString('latin1').trim());
  }
  return out;
}

async function main() {
  const states = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_STATES;
  for (const s of states) {
    if (!STATE_FIPS[s]) throw new Error(`no FIPS prefix registered for "${s}" — add it to STATE_FIPS`);
  }

  const sourcePath = await cached(SOURCE_URL, 'tract_us.csv');
  const boundaryPath = await cached(BOUNDARY_URL, 'cb_2020_us_tract_500k.zip');
  const allBoundaries = boundaryGeoids(boundaryPath);
  console.log(`  boundary file: ${allBoundaries.size.toLocaleString()} tracts\n`);

  mkdirSync(OUT_DIR, { recursive: true });
  const rows = new Map(states.map((s) => [s, []]));
  const dropped = new Map(states.map((s) => [s, 0]));

  const rl = createInterface({
    input: createReadStream(sourcePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let header = null;
  let index = null;
  for await (const line of rl) {
    if (!line) continue;
    const cells = line.split(',');
    if (!header) {
      header = cells.map((h, i) => (i === 0 ? h.replace(/^﻿/, '') : h));
      index = Object.fromEntries(header.map((h, i) => [h, i]));
      const missing = [...KEEP, 'ST_ABBREV'].filter((k) => !(k in index));
      if (missing.length) throw new Error(`source is missing columns: ${missing.join(', ')}`);
      continue;
    }
    const state = cells[index.ST_ABBREV];
    if (!rows.has(state)) continue;
    const geoid = (cells[index.ID] ?? '').trim();
    // Territories (AS/CNMI/GU/VI) carry 7- and 10-character ids and have no
    // Census tract boundary; water tracts have one but no population.
    if (geoid.length !== 11 || !/^\d+$/.test(geoid) || isWaterTract(geoid)) {
      dropped.set(state, dropped.get(state) + 1);
      continue;
    }
    rows.get(state).push(
      KEEP.map((k) => {
        if (k === 'ID') return geoid;
        if (k === 'STATE_NAME') {
          return (cells[index[k]] ?? '').trim().replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase());
        }
        if (k === 'CNTY_NAME') return (cells[index[k]] ?? '').trim();
        return trim(k, cells[index[k]]);
      }),
    );
  }

  let failed = false;
  for (const state of states) {
    const records = rows.get(state);
    if (!records.length) throw new Error(`no rows matched ST_ABBREV=${state}`);
    const prefix = STATE_FIPS[state];
    const boundaries = new Set([...allBoundaries].filter((g) => g.startsWith(prefix)));
    const present = new Set(records.map((r) => r[0]));
    const matched = [...present].filter((g) => boundaries.has(g)).length;
    const rowSide = matched / present.size;
    const boundarySide = matched / boundaries.size;

    const out = join(OUT_DIR, `ejscreen-2.32-tracts-${state.toLowerCase()}.csv`);
    const body = [
      KEEP.map((k) => csvCell(RENAME[k] ?? k)).join(','),
      ...records.map((r) => r.map(csvCell).join(',')),
    ].join('\n');
    await writeFile(out, `${body}\n`, 'utf8');

    const ok = boundarySide >= MIN_BOUNDARY_SIDE;
    failed ||= !ok;
    console.log(
      `${ok ? '✓' : '✗'} ${state}  ${records.length.toLocaleString()} rows  ` +
        `${(Buffer.byteLength(body) / 1e6).toFixed(2)}MB  ` +
        `row-side ${(rowSide * 100).toFixed(2)}%  boundary-side ${(boundarySide * 100).toFixed(2)}%  ` +
        `(dropped ${dropped.get(state)} territory/water rows)`,
    );
    if (!ok) {
      const blank = [...boundaries].filter((g) => !present.has(g)).slice(0, 10);
      console.log(`    boundaries with no row: ${blank.join(', ')}`);
    }
  }
  if (failed) {
    console.error(`\nboundary-side coverage below ${MIN_BOUNDARY_SIDE * 100}% — the map would draw holes.`);
    process.exit(1);
  }
}

await main();
