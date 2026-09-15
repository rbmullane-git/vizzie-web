/**
 * portal-facts.mjs — the connected-data numbers, in one place.
 *
 * "170 portals across 28 countries" appeared, hardcoded, on the homepage, on
 * both paid-test landing pages and twice inside the portals index. By 15 Sep
 * 2026 all five were wrong (178 portals, 32 countries) and the homepage's
 * dataset counts still carried an "as at 6 Aug 2026" note. Numbers that are
 * typed into prose cannot be kept true, so every surface now reads them from
 * here, and here reads them from what the build actually fetched.
 *
 * Sources, all under tools/data/ and all refreshed by other scripts:
 *   portal-compliance-matrix.json  which portals exist   (sync-connector-data)
 *   country-labels.json            what to call a place  (sync-connector-data)
 *   stats-cache.json               live dataset counts   (build-portals fetch)
 *   bespoke-counts.json            counts for the statistical APIs
 *                                                        (fetch-bespoke-counts)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data');
const load = (f) => (existsSync(join(DATA, f)) ? JSON.parse(readFileSync(join(DATA, f), 'utf8')) : null);

const norm = (u) => (u || '').replace(/\/+$/, '');
const host = (u) => {
  try { return new URL(u).host; } catch { return (u || '').replace(/^https?:\/\//, '').split('/')[0]; }
};
// Must match build-portals.mjs, or a portal's stats look up as missing here.
const slugify = (u) => host(u).replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

/** Round down to a headline figure: 4,183,902 -> "4.1M". Never rounds up — a
 *  claim on a marketing page should be one the data already supports. */
export function headline(n) {
  if (!n) return '0';
  if (n >= 1e6) return `${Math.floor(n / 1e5) / 10}M`;
  if (n >= 1e3) return `${Math.floor(n / 1e2) / 10}k`;
  return String(n);
}

export function portalFacts() {
  const matrix = load('portal-compliance-matrix.json');
  const labels = load('country-labels.json') || {};
  const stats = load('stats-cache.json') || {};
  const bespoke = load('bespoke-counts.json') || {};
  if (!matrix) throw new Error('portal-compliance-matrix.json missing — run tools/sync-connector-data.mjs');

  const bespokeByUrl = new Map(Object.entries(bespoke).map(([u, v]) => [norm(u), v]));
  const fetched = [];
  const portals = matrix.portals.map((p) => {
    const slug = slugify(p.base_url);
    const live = stats[slug] || {};
    const fallback = bespokeByUrl.get(norm(p.base_url));
    const count = live.count ?? fallback?.count ?? null;
    if (live.fetchedAt) fetched.push(live.fetchedAt.slice(0, 10));
    else if (count != null && fallback?.measured) fetched.push(fallback.measured);
    return {
      slug,
      id: p.id,
      baseUrl: p.base_url,
      // Display name: the label's " — Country (scope)" suffix is for operators.
      name: (p.label || host(p.base_url)).split(' — ')[0].trim(),
      countryCode: p.country,
      country: labels[p.country] || p.country,
      connector: p.connector,
      count,
    };
  });

  const counted = portals.filter((p) => p.count != null);
  return {
    portals,
    portalCount: portals.length,
    countryCount: new Set(portals.map((p) => p.countryCode)).size,
    // Sum of what we could count. Portals with no count contribute nothing, so
    // the total understates rather than invents — which is why the copy says
    // "+" after it.
    datasetTotal: counted.reduce((n, p) => n + p.count, 0),
    countedPortals: counted.length,
    /** Newest fetch date across the counts, i.e. what "counts as at" may claim. */
    asAt: fetched.sort().at(-1) || null,
    bySlug: new Map(portals.map((p) => [p.slug, p])),
  };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const f = portalFacts();
  process.stdout.write(
    `${f.portalCount} portals · ${f.countryCount} countries · ` +
      `${f.datasetTotal.toLocaleString()} datasets (${headline(f.datasetTotal)}+) ` +
      `from ${f.countedPortals} counted portals · as at ${f.asAt}\n`
  );
}
