/**
 * sync-connector-data.mjs — pull the portal facts from the connector repo.
 *
 * The portal pages are only as truthful as the two files they are generated
 * from, and both are maintained in `vizzie-connector`, not here:
 *
 *   - shared/src/compliance/portal-compliance-matrix.json — the licence
 *     intelligence: default licence, terms URL, observed licence mix, the
 *     alias table that maps what a portal *says* onto a real licence class.
 *   - frontend/src/wizard/sources.ts — the registry the app's wizard actually
 *     offers, carrying region/city (which the matrix does not) and the
 *     country labels.
 *
 * They were vendored by hand once and drifted, which is the reason this
 * exists. On 15 Sep 2026 the site was still shipping the 12 Aug matrix: eight
 * connected portals had no page at all (Eurostat, the ONS Geoportal, Japan's
 * e-Gov, Colombia, Chile, the Pacific Data Hub, Open Data NC, US Census), and
 * every portal page rendered its licence mix through the *site's* own string
 * rules rather than the matrix's alias table — so a portal that is 81% CC BY
 * displayed "CC BY" and "CC-BY-4.0" as two unrelated licences.
 *
 * Read `shared/src`, never `shared/dist`: dist is a build artefact and has
 * shipped stale copies of the matrix before.
 *
 * Usage:
 *   node sync-connector-data.mjs          # copy, report what changed
 *   node sync-connector-data.mjs --check  # exit 1 if out of sync (for CI)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, 'data');
const CONNECTOR = process.env.VIZZIE_CONNECTOR || '/Users/rich/vizzie-connector';
const MATRIX_SRC = join(CONNECTOR, 'shared/src/compliance/portal-compliance-matrix.json');

const check = process.argv.includes('--check');

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

if (!existsSync(MATRIX_SRC)) {
  fail(`connector repo not found at ${CONNECTOR} — set VIZZIE_CONNECTOR`);
}

/**
 * The registry is TypeScript, so it has to be evaluated rather than read. tsx
 * runs from inside the connector workspace (its tsconfig and module resolution
 * are what make the import work); the script it runs is written into that repo
 * and removed again, because a permanent file there would be a second place to
 * maintain.
 */
function exportRegistry() {
  const tmp = join(CONNECTOR, 'scripts', 'tmp-export-registry.ts');
  writeFileSync(
    tmp,
    'import { WIZARD_SOURCE_REGISTRY, COUNTRY_LABELS } from "../frontend/src/wizard/sources.js";\n' +
      'process.stdout.write(JSON.stringify({ registry: WIZARD_SOURCE_REGISTRY, countryLabels: COUNTRY_LABELS }, null, 1));\n'
  );
  try {
    const out = execFileSync('npx', ['tsx', tmp], { cwd: CONNECTOR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(out);
  } finally {
    try { execFileSync('rm', ['-f', tmp]); } catch { /* best effort */ }
  }
}

function writeOrCheck(name, next) {
  const dest = join(DATA, name);
  const prev = existsSync(dest) ? readFileSync(dest, 'utf8') : '';
  if (prev === next) {
    process.stderr.write(`  ${name}: unchanged\n`);
    return false;
  }
  if (check) {
    process.stderr.write(`  ${name}: OUT OF SYNC\n`);
    return true;
  }
  writeFileSync(dest, next);
  process.stderr.write(`  ${name}: updated\n`);
  return true;
}

const matrix = JSON.parse(readFileSync(MATRIX_SRC, 'utf8'));
const { registry, countryLabels } = exportRegistry();

// The registry and the matrix must describe the same portals — the connector
// has a test for exactly this, and a page generated for a portal the wizard
// does not offer is a page whose "Browse this portal in Vizzie" button 404s.
const matrixIds = new Set(matrix.portals.map((p) => p.base_url.replace(/\/+$/, '')));
const regIds = new Set(registry.map((r) => r.baseUrl.replace(/\/+$/, '')));
const orphanPages = [...matrixIds].filter((u) => !regIds.has(u));
const orphanRegistry = [...regIds].filter((u) => !matrixIds.has(u));
if (orphanPages.length) process.stderr.write(`  warn: in matrix, not in registry: ${orphanPages.join(', ')}\n`);
if (orphanRegistry.length) process.stderr.write(`  warn: in registry, no matrix row: ${orphanRegistry.join(', ')}\n`);

process.stderr.write(`syncing ${matrix.portals.length} matrix rows / ${registry.length} registry rows\n`);
let drift = false;
drift = writeOrCheck('portal-compliance-matrix.json', `${JSON.stringify(matrix, null, 1)}\n`) || drift;
drift = writeOrCheck('registry.json', `${JSON.stringify(registry, null, 1)}\n`) || drift;
drift = writeOrCheck('country-labels.json', `${JSON.stringify(countryLabels, null, 1)}\n`) || drift;

if (check && drift) {
  process.stderr.write('out of sync — run `node tools/sync-connector-data.mjs`\n');
  process.exit(1);
}
process.stderr.write(check ? 'in sync\n' : 'done\n');
