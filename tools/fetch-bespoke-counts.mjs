/**
 * fetch-bespoke-counts.mjs — dataset counts for the portals this site cannot
 * count for itself.
 *
 * fetch-portal-stats.mjs speaks the catalogue protocols (CKAN, Socrata, ODS,
 * ArcGIS Hub and friends). It does not speak the dozen bespoke statistical
 * APIs — SDMX for OECD/UNICEF/Eurostat, the WHO GHO OData feed, the DHS API,
 * the Census discovery endpoint — so those portal pages rendered a dataset
 * count of "—" while the homepage quoted hand-copied figures for the same
 * sources. Two numbers, one of them unmaintained.
 *
 * Rather than reimplement those protocols a second time, this asks the
 * connector: `catalogTotal()` is the method the product itself calls, so the
 * count on the page is by construction the number of datasets Vizzie will
 * actually list. It runs through the connector repo's tsx, the same way
 * sync-connector-data.mjs exports the registry.
 *
 * Usage:
 *   node fetch-bespoke-counts.mjs            # refresh every bespoke portal
 *   node fetch-bespoke-counts.mjs oecd dhs   # only these connector types
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, 'data');
const OUT = join(DATA, 'bespoke-counts.json');
const CONNECTOR = process.env.VIZZIE_CONNECTOR || '/Users/rich/vizzie-connector';

// The connector types fetch-portal-stats.mjs has no handler for.
const BESPOKE = [
  'census', 'eurostat', 'world-bank', 'adb', 'oecd', 'unicef',
  'who-gho', 'dhs', 'un-sdg', 'owid', 'abs', 'esri-server',
];

/**
 * Counts that the live probe cannot produce, with the measurement they come
 * from. Eurostat is the whole reason this block exists: its SDMX dataflow
 * listing is ~8,150 entries and did not answer inside four minutes when probed
 * on 15 Sep 2026, so `catalogTotal()` times out at 45s every time. The figure
 * below is the connector's own filtered catalogue — the dataflows small enough
 * (<= 50k observations) to download synchronously, which is exactly the set a
 * user can map — recorded when the connector shipped.
 *
 * A fallback must never outlive its evidence: `measured` is rendered on the
 * page as the as-at date, so a stale one is visible rather than silent.
 */
const FALLBACKS = {
  'https://ec.europa.eu/eurostat/api/dissemination': {
    count: 4753,
    measured: '2026-09-15',
    source: 'connector catalogue filter (dataflows under the 50k-observation sync limit)',
    note: 'The full SDMX catalogue is ~8,150 dataflows; the rest queue as async extractions.',
  },
};

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const types = only.length ? only : BESPOKE;

function runConnector(args) {
  const tmp = join(CONNECTOR, 'scripts', 'tmp-catalog-counts.ts');
  writeFileSync(
    tmp,
    `import { WIZARD_SOURCE_REGISTRY } from "../frontend/src/wizard/sources.js";
import { createConnector } from "../backend/src/connectors/index.js";

async function main() {
  const only = new Set(process.argv.slice(2));
  const out = {};
  const targets = WIZARD_SOURCE_REGISTRY.filter((s) => !only.size || only.has(s.connectorType));
  const queue = [...targets];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const s = queue.shift();
      let count = null;
      try {
        const c = createConnector(s.connectorType, { baseUrl: s.baseUrl });
        count = c.catalogTotal ? await c.catalogTotal("") : null;
      } catch { count = null; }
      out[s.baseUrl] = { count, label: s.label, connectorType: s.connectorType };
    }
  }));
  process.stdout.write(JSON.stringify(out));
}
main();
`
  );
  try {
    return JSON.parse(execFileSync('npx', ['tsx', tmp, ...args], {
      cwd: CONNECTOR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
    }));
  } finally {
    try { execFileSync('rm', ['-f', tmp]); } catch { /* best effort */ }
  }
}

process.stderr.write(`asking the connector for ${types.length} bespoke catalogue totals…\n`);
const probed = runConnector(types);
const today = new Date().toISOString().slice(0, 10);
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const out = { ...prev };

for (const [baseUrl, row] of Object.entries(probed)) {
  if (typeof row.count === 'number' && row.count > 0) {
    out[baseUrl] = {
      count: row.count,
      measured: today,
      source: "the connector's own catalogTotal()",
      label: row.label,
      connectorType: row.connectorType,
    };
    process.stderr.write(`  ${String(row.count).padStart(8)}  ${row.label}\n`);
    continue;
  }
  const fb = FALLBACKS[baseUrl.replace(/\/+$/, '')];
  if (fb) {
    out[baseUrl] = { ...fb, label: row.label, connectorType: row.connectorType };
    process.stderr.write(`  ${String(fb.count).padStart(8)}  ${row.label}  (documented fallback, ${fb.measured})\n`);
    continue;
  }
  // No count and no evidence for one: say nothing rather than carry forward a
  // number whose provenance has expired.
  delete out[baseUrl];
  process.stderr.write(`        —  ${row.label}  (no count available)\n`);
}

writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
process.stderr.write(`wrote ${Object.keys(out).length} counts to tools/data/bespoke-counts.json\n`);
