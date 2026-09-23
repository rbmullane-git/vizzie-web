// build-county-projects.mjs
// Builds one self-contained Vizzie project per county from county-facts.json,
// so the "Open the studio" button on a county page can open THAT county's map
// instead of an empty editor.
//
// Shape follows scripts/build-examples.mjs in ~/vizzie: a single-part datasetId
// (no `|`) keeps the dataset off the connector path, and the tract features ride
// along as `metadata.ingestResult.previewRows`, so the map draws client-side
// with no connector, no Postgres and no account.
//
// Output: tools/data/county-projects/<slug>.json  (a PublishedPayload)
// Also prints a self-contained #view= URL per county, which renders the payload
// WITHOUT writing anything to the database — that is how a payload gets checked
// before it is hosted.
//
// No network. Usage:  node tools/build-county-projects.mjs [slug ...]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const FACTS = join(__dir, 'data', 'county-facts.json');
const OUT = join(__dir, 'data', 'county-projects');
mkdirSync(OUT, { recursive: true });

const MEASURE = 'Median household income';
// magma, not the examples' viridis: the visitor has just come from a static
// page showing this county in the brand magenta, and magma's purple-to-pink
// range keeps that continuity while staying a perceptually uniform ramp.
const RAMP = 'magma';
const NOW = new Date().toISOString();

/** The licence block the app renders as the attribution line. */
function licenceFor(f) {
  return {
    licenceClass: 'US-PD',
    name: 'US Government Work (public domain)',
    url: 'https://www.census.gov/about/policies/open-gov/open-data.html',
    ingest: 'full',
    shareAlike: false,
    unverified: false,
    resolvedVia: 'publisher',
    sourceUrl: 'https://data.census.gov',
    attributionText:
      `${f.name}, ${f.state} — American Community Survey ${f.acsYear} 5-year estimates, ` +
      `U.S. Census Bureau (public domain). Boundaries: ${f.provenance.attribution} ` +
      `Assembled by Vizzie.`,
  };
}

function buildPayload(f) {
  const slug = `county-${f.slug}`;
  // Only tracts that carry a value. A hatched no-data tract is right on a
  // static page, but here it would be a row with a null the charts must skip.
  const previewRows = f.tracts.geojson.features
    .filter((ft) => Number.isFinite(f.tracts.values[ft.properties.code]))
    .map((ft) => ({
      properties: {
        GEOID: ft.properties.code,
        Tract: ft.properties.name,
        [MEASURE]: f.tracts.values[ft.properties.code],
      },
      geometry: ft.geometry,
    }));

  const columns = [
    { name: 'GEOID', kind: 'categorical' },
    { name: 'Tract', kind: 'text' },
    { name: MEASURE, kind: 'numeric' },
  ];
  const datasetRef = { sourceId: 'open-data', datasetId: slug };
  const title = `${f.name}, ${f.state} — median household income by census tract`;

  const ingestFull = {
    datasetId: slug,
    datasetTitle: title,
    publisher: 'U.S. Census Bureau',
    rowCount: previewRows.length,
    sizeBytes: Buffer.byteLength(JSON.stringify(previewRows)),
    licence: licenceFor(f),
    columns,
    previewRows,
  };
  // The charts and table read the map tile's copy (DatasetBridge prefers the
  // tile carrying previewRows), so embedding twice would double the payload.
  const ingestLite = { ...ingestFull, sizeBytes: 0, previewRows: undefined };
  delete ingestLite.previewRows;

  const dashboard = {
    id: '',
    name: `${f.name}, ${f.state}`,
    description:
      `Median household income across the ${previewRows.length} census tracts of ${f.name} ` +
      `that the American Community Survey reports one for, ${f.acsYear}. Open the layer to ` +
      `change the variable, reclassify the breaks, or bring your own data.`,
    createdAt: NOW,
    updatedAt: NOW,
    gridCols: 12,
    basemap: { style: 'vizzie-dark', opacity: 1, visible: true, labels: true, labelsAbove: true, saturation: 0, pois: false },
    filterState: { predicates: [] },
    tiles: [
      {
        id: `map-${slug}`,
        type: 'map',
        datasetRef,
        spec: { version: '1.0', basemapStyle: 'dark', layers: [] },
        layout: { column: 1, row: 1, width: 12, height: 8 },
        metadata: {
          ingestResult: ingestFull,
          visualizationType: 'choropleth',
          style: {
            visible: true,
            opacity: 0.75,
            fill: { mode: 'by-data', color: '#22c55e', column: MEASURE, rampId: RAMP },
            stroke: { mode: 'solid', color: '#0e1116', width: 1 },
            point: { mode: 'solid', radius: 5, minRadius: 2 },
          },
        },
      },
      {
        id: `chart1-${slug}`,
        type: 'chart',
        datasetRef,
        // Shape per scripts/build-examples.mjs: `type` + `histogramConfig`.
        // An invented `chartType`/`binCount` pair renders as "this chart could
        // not be drawn from the data" — the tile appears, blank.
        spec: {
          version: '1.0',
          datasetRef,
          type: 'histogram',
          title: 'How the tracts are distributed',
          xField: MEASURE,
          histogramConfig: { binCount: 20 },
        },
        layout: { column: 1, row: 9, width: 12, height: 6 },
        metadata: { ingestResult: ingestLite },
      },
      {
        id: `table-${slug}`,
        type: 'table',
        datasetRef,
        spec: { version: '1.0', datasetRef, enableSort: true, enableSearch: true, enableFilter: true },
        layout: { column: 1, row: 15, width: 12, height: 6 },
        metadata: { ingestResult: ingestLite },
      },
    ],
  };

  return { v: 2, dashboard, legend: true };
}

/** A self-contained #view= parameter: 'g' + base64url(gzip(json)). */
function selfContainedParam(payload) {
  const b64 = gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 })
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `g${b64}`;
}

const facts = JSON.parse(readFileSync(FACTS, 'utf8'));
const wanted = process.argv.slice(2);
const slugs = wanted.length ? wanted : Object.keys(facts.counties);

for (const slug of slugs) {
  const f = facts.counties[slug];
  if (!f) { console.error(`no facts for ${slug}`); continue; }
  const payload = buildPayload(f);
  writeFileSync(join(OUT, `${slug}.json`), JSON.stringify(payload));
  const param = selfContainedParam(payload);
  const rows = payload.dashboard.tiles[0].metadata.ingestResult.rowCount;
  process.stderr.write(
    `${slug}: ${rows} tracts, payload ${(JSON.stringify(payload).length / 1024).toFixed(0)} KB, ` +
      `url param ${(param.length / 1024).toFixed(0)} KB\n`,
  );
  if (wanted.length === 1) console.log(`https://app.vizzie.org/#view=${param}`);
}
