/**
 * build-portals.mjs — generate one SEO landing page per connected open-data portal.
 *
 * Sources (vendored under tools/data/):
 *   - portal-compliance-matrix.json  (id/slug, platform, licence stats, tos, notes, auth)
 *   - registry.json                  (connectorType, baseUrl, label, countryCode, region, city)
 * Live per-portal stats (dataset count, licence facet, publishers) come from the portal APIs
 * via ./fetch-portal-stats.mjs, cached to tools/data/stats-cache.json.
 *
 * Usage:
 *   node build-portals.mjs fetch     # (re)fetch live stats into the cache only
 *   node build-portals.mjs           # fetch-if-missing + render pages + index + sitemap
 *   node build-portals.mjs --force-fetch   # refetch everything, then render
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchPortalStats } from './fetch-portal-stats.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dir, '..');
const DATA = join(__dir, 'data');
const CACHE = join(DATA, 'stats-cache.json');
const BESPOKE_COUNTS = join(DATA, 'bespoke-counts.json');
const EXAMPLES_DIR = '/Users/rich/vizzie/src/examples/data';

const SITE = 'https://www.vizzie.org';
const APP = 'https://app.vizzie.org';
const TODAY = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);

// Country labels come from the connector's own registry (synced by
// sync-connector-data.mjs), so a newly connected country names itself here
// without a second list to remember — "PACIFIC" and "NC" arrived that way.
const COUNTRY_LABELS = loadJSON(join(DATA, 'country-labels.json'));
const PLATFORM_LABEL = {
  ckan: 'CKAN', socrata: 'Socrata', 'arcgis-hub': 'ArcGIS Hub', opendatasoft: 'OpenDataSoft',
  datagov: 'CKAN (data.gov)', 'data-europa-eu': 'data.europa.eu', udata: 'uData', dataverse: 'Dataverse',
  'data-gov-sg': 'data.gov.sg', 'data-gov-in': 'data.gov.in', 'data-gov-in-dms': 'data.gov.in',
  'os-data-hub': 'OS Data Hub', 'london-datastore': 'London Datastore', 'world-bank': 'World Bank',
  oecd: 'OECD', 'who-gho': 'WHO GHO', unicef: 'UNICEF', 'un-sdg': 'UN SDG', adb: 'ADB', dhs: 'DHS', owid: 'Our World in Data',
  eurostat: 'Eurostat dissemination API', census: 'US Census Bureau API',
};

const norm = (u) => (u || '').replace(/\/+$/, '');
const host = (u) => { try { return new URL(u).host; } catch { return (u || '').replace(/^https?:\/\//, '').split('/')[0]; } };
const slugify = (u) => host(u).replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

// Resolve what a portal *says* a licence is into a real licence class.
//
// The authority is the compliance matrix's `licence_aliases` table, which the
// connector uses for the same job when it decides whether a dataset may be
// ingested at all. Using it here rather than a second set of string rules is
// the whole point: these pages and the product must not disagree about what a
// licence is.
//
// Three vocabularies arrive. CKAN and ArcGIS send terse machine ids
// ("cc-by-sa", "notspecified"); OpenDataSoft and Socrata send the display name
// written out ("CC BY", "Open Database License (ODbL)"). The matrix carries all
// three — as of 15 Sep 2026 it resolves 93.6% of the datasets in the stats
// cache. Before that, the site's own rules matched only the slug forms, so
// Paris showed "Open Database License (ODbL)" and "ODbL" as two unrelated
// licences and Melbourne's 226 CC BY datasets sat in a bucket of their own.
//
// The heuristics below run only on what the matrix has no alias for — mostly
// real licences in versions it hasn't classified (CC-BY-NZ-3.0, the Canadian
// provincial OGLs, CC-BY-2.5). They group for *display* only; they never
// decide that anything is permissive, which is the matrix's job alone.
const normLicence = (raw) => String(raw ?? '').trim().toLowerCase().replace(/\/+$/, '');

const MATRIX = loadJSON(join(DATA, 'portal-compliance-matrix.json'));

const ALIAS_INDEX = (() => {
  const idx = new Map();
  for (const [alias, cls] of Object.entries(MATRIX.licence_aliases || {})) idx.set(normLicence(alias), cls);
  // A class id is its own alias — portals that already speak SPDX hit this.
  for (const cls of Object.keys(MATRIX.licences || {})) if (!idx.has(normLicence(cls))) idx.set(normLicence(cls), cls);
  return idx;
})();

// Short forms for a two-column list; the matrix's own `name` field is written
// for a compliance report ("Open Data Commons Public Domain Dedication and
// Licence 1.0") and wraps to three lines in a 230px column.
const CLASS_LABEL = {
  'CC-BY-4.0': 'CC BY 4.0', 'CC-BY-3.0-AU': 'CC BY 3.0 (AU)', 'CC0-1.0': 'CC0 1.0',
  'PDDL-1.0': 'ODC PDDL 1.0', 'US-PD': 'US public domain', 'OGL-UK-3.0': 'OGL v3.0 (UK)',
  'OGL-Canada-2.0': 'OGL 2.0 (Canada)', 'DL-DE-BY-2.0': 'DL-DE BY 2.0', 'ODC-BY-1.0': 'ODC BY 1.0',
  'ODbL-1.0': 'ODbL 1.0', 'CC-BY-SA-4.0': 'CC BY-SA 4.0', 'CC-BY-NC': 'CC BY-NC',
  'CC-BY-ND': 'CC BY-ND', 'LO-2.0': 'Licence Ouverte 2.0', 'LO-1.0': 'Licence Ouverte 1.0',
  'PDL-1.0-JP': 'PDL 1.0 (Japan)', 'CC-BY-IGO': 'CC BY 3.0 IGO', 'PUBLIC-DOMAIN': 'Public domain',
  'SEMCOG-CLA': 'SEMCOG Copyright License Agreement',
  'CLOSED': 'Closed / restricted', UNDECLARED: 'UNDECLARED',
};

// Licence strings the matrix could not map, collected across the whole build so
// the alias table can be improved through use — the same reason the connector's
// resolver emits a warning rather than swallowing an unknown string.
const unmapped = new Map();

/** The matrix licence class a raw string resolves to, or null if unmapped. */
function licenceClassOf(raw) {
  const s = normLicence(raw);
  if (!s || s === 'notspecified' || s === 'null' || s === 'none') return 'UNDECLARED';
  return ALIAS_INDEX.get(s) || null;
}

function canonLicence(raw) {
  const s = normLicence(raw);
  if (!s || s === 'notspecified' || s === 'null' || s === 'none') return 'UNDECLARED';

  const cls = ALIAS_INDEX.get(s);
  if (cls) return CLASS_LABEL[cls] || cls;

  unmapped.set(raw, (unmapped.get(raw) || 0) + 1);

  // A bare number is a portal's internal licence id leaking through its facet
  // (Hamburg and BODIK both do this). It grants nothing that can be read, so it
  // belongs with UNDECLARED rather than being printed as a licence called "22".
  if (/^\d+$/.test(s)) return 'UNDECLARED';

  const cc = s.includes('cc-by') || s.includes('cc by') ||
    s.includes('creative commons attribution') || s.includes('creativecommons.org/licenses/by');
  if (s.includes('cc-by-sa') || s.includes('cc by-sa') || s.includes('cc-sa') ||
      (cc && (s.includes('share alike') || s.includes('sharealike')))) return 'CC BY-SA (other version)';
  if (s.includes('cc-by-nc') || s.includes('cc by-nc') ||
      (cc && (s.includes('noncommercial') || s.includes('non-commercial')))) return 'CC BY-NC';
  if (s.includes('cc-by-nd') || s.includes('cc by-nd') ||
      (cc && (s.includes('noderiv') || s.includes('no deriv')))) return 'CC BY-ND';
  if (s.includes('cc-zero') || s.includes('cc0') || s.includes('cc-0') ||
      s.includes('publicdomain') || s.includes('pddl')) return 'CC0 / public domain';
  if (cc) return 'CC BY (other version)';

  if (s.includes('ogl') || s.includes('open government licence') ||
      s.includes('open government license')) return 'Open Government Licence';
  if (s.includes('odbl') || s.includes('open database license')) return 'ODbL 1.0';
  if (s.includes('odc') || s.includes('open data commons')) return 'Open Data Commons';
  if (s.includes('us-pd') || s === 'other-pd' || s.includes('public domain')) return 'Public domain';

  // A portal-wide pointer to its own terms ("See Terms of Use") is a real grant,
  // just not a standard one — so it belongs with bespoke licences rather than
  // with UNDECLARED, which the pages define as carrying no explicit permission
  // at all.
  if (s.includes('terms of use') || s.includes('terms of service')) return 'Other / bespoke';
  if (s.includes('other') || s.includes('custom')) return 'Other / bespoke';
  return String(raw).length > 24 ? 'Other / bespoke' : raw; // keep short codes as-is
}

/**
 * What the declared licences on a portal actually permit.
 *
 * This is the question a planner or analyst has when they land on one of these
 * pages — "can I use this in work I get paid for?" — and until the licence
 * vocabulary was mapped (15 Sep 2026) it could not be answered: most ODS and
 * Socrata datasets resolved to UNDECLARED, so the honest answer was "unknown"
 * for catalogues that are in fact almost entirely open.
 *
 * Only datasets whose licence resolved to a real matrix class are counted, and
 * `classified` says how many that was. A licence the matrix has no class for is
 * not evidence of anything, so it is left out of the denominator rather than
 * being assumed permissive.
 */
function rightsProfile(licences) {
  let classified = 0, commercial = 0, shareAlike = 0, nonCommercial = 0, noDerivatives = 0;
  for (const l of licences || []) {
    const cls = licenceClassOf(l.cls);
    if (!cls || cls === 'UNDECLARED') continue;
    const entry = MATRIX.licences?.[cls];
    if (!entry) continue;
    const n = l.count || 0;
    classified += n;
    if (entry.commercial_ok === true) commercial += n;
    if (entry.commercial_ok === false) nonCommercial += n;
    if (entry.share_alike) shareAlike += n;
    if (entry.no_derivatives) noDerivatives += n;
  }
  if (!classified) return null;
  return { classified, commercial, shareAlike, nonCommercial, noDerivatives };
}

/**
 * The licence the largest share of this portal's classified datasets carries,
 * as a matrix entry. Used for the DataCatalog structured data, where
 * schema.org's `license` wants one canonical URL rather than a distribution.
 */
function dominantLicence(licences) {
  const by = new Map();
  for (const l of licences || []) {
    const cls = licenceClassOf(l.cls);
    if (!cls || cls === 'UNDECLARED' || !MATRIX.licences?.[cls]) continue;
    by.set(cls, (by.get(cls) || 0) + (l.count || 0));
  }
  if (!by.size) return null;
  const [cls, count] = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
  const entry = MATRIX.licences[cls];
  const share = [...by.values()].reduce((a, b) => a + b, 0);
  return { cls, name: entry.name, url: entry.url || null, commercialOk: entry.commercial_ok, share: count / share };
}

function mergeLicences(licences) {
  const by = new Map();
  for (const l of licences || []) {
    const c = canonLicence(l.cls);
    by.set(c, (by.get(c) || 0) + (l.count || 0));
  }
  const undeclared = by.get('UNDECLARED') || 0;
  by.delete('UNDECLARED');
  const declared = [...by.entries()].map(([cls, count]) => ({ cls, count })).sort((a, b) => b.count - a.count);
  const total = declared.reduce((s, x) => s + x.count, 0) + undeclared;
  return { declared, undeclared, total, rights: rightsProfile(licences), dominant: dominantLicence(licences) };
}

function loadJSON(p) { return JSON.parse(readFileSync(p, 'utf8')); }

/**
 * A card-sized blurb for an example: its opening sentence when that fits, else
 * the text cut on a word boundary. The old fixed slice ended every card
 * mid-word ("…raised off the map by how many plugs it carries — so the").
 */
function blurb(description) {
  const text = String(description ?? '').trim();
  if (text.length <= 160) return text;
  const sentence = text.match(/^.*?[.!?](?=\s|$)/)?.[0];
  if (sentence && sentence.length <= 160) return sentence;
  const cut = text.slice(0, 160);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:—–-]$/, '').trim()}…`;
}

function examplesByHost() {
  const map = {};
  for (const f of readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.json'))) {
    const slug = f.replace(/\.json$/, '');
    let d; try { d = loadJSON(join(EXAMPLES_DIR, f)); } catch { continue; }
    const name = d.name || slug;
    const cardBlurb = blurb(d.description);
    // find any datasetRef.datasetId encoding "<type>|<encoded baseUrl>|<id>"
    const found = new Set();
    const walk = (o) => {
      if (o && typeof o === 'object') {
        if (typeof o.datasetId === 'string' && o.datasetId.includes('|')) {
          const parts = o.datasetId.split('|');
          if (parts.length >= 2) { try { found.add(host(decodeURIComponent(parts[1]))); } catch { /* */ } }
        }
        for (const v of Object.values(o)) walk(v);
      }
    };
    walk(d);
    for (const h of found) (map[h] ||= []).push({ slug, name, blurb: cardBlurb });
  }
  return map;
}

function buildPortals() {
  const matrix = loadJSON(join(DATA, 'portal-compliance-matrix.json'));
  const registry = loadJSON(join(DATA, 'registry.json'));
  const regByUrl = new Map(registry.map((r) => [norm(r.baseUrl), r]));
  const exMap = examplesByHost();
  const seenSlug = new Map();

  return matrix.portals.map((p) => {
    const reg = regByUrl.get(norm(p.base_url)) || {};
    let slug = slugify(p.base_url);
    if (seenSlug.has(slug)) { slug = `${slug}-${slugify(host(p.base_url) + (new URL(p.base_url).pathname || ''))}`.replace(/-+/g, '-'); }
    seenSlug.set(slug, true);
    const cc = p.country || reg.countryCode || 'UN';
    // clean display name: drop " — Country…" suffix from label
    const name = (p.label || reg.label || host(p.base_url)).split(' — ')[0].trim();
    return {
      slug,
      connectorType: p.connector || reg.connectorType,
      baseUrl: p.base_url,
      label: p.label || reg.label || name,
      name,
      countryCode: cc,
      country: COUNTRY_LABELS[cc] || cc,
      region: reg.region || '',
      city: reg.city || '',
      platform: p.platform || PLATFORM_LABEL[p.connector] || p.connector,
      tosUrl: p.tos_url || '',
      tosNote: p.tos_note || '',
      licenceSource: p.licence_source || '',
      auth: p.auth || '',
      notes: p.notes || '',
      matrixObserved: p.observed_licences || null,
      defaultLicence: p.default_licence || null,
      dataAppValue: `/#portal=${p.connector}:${p.base_url.replace(/^https?:\/\//, '')}`,
      examples: exMap[host(p.base_url)] || [],
    };
  });
}

// ---- stats (fetch + cache) ----
async function pool(items, n, worker) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await worker(items[idx], idx); }
  }));
  return out;
}

function fromMatrix(portal) {
  // fallback licence stats from matrix observed_licences
  if (!portal.matrixObserved) return null;
  const licences = Object.entries(portal.matrixObserved).map(([cls, count]) => ({ cls, count }));
  const m = mergeLicences(licences);
  return {
    count: m.total || null,
    undeclaredPct: m.total ? m.undeclared / m.total : null,
    licences,
    publishers: [],
    ok: false,
    fetchedAt: null,
    countSource: 'compliance matrix (observed sample)',
    fromMatrix: true,
  };
}

async function getStats(portals, { forceFetch }) {
  // Always load the cache, even on a forced refetch — it is the fallback when
  // a probe fails, not just a way to skip work.
  const cache = existsSync(CACHE) ? loadJSON(CACHE) : {};
  const stale = [];
  const todo = portals.filter((p) => forceFetch || !cache[p.slug]);
  if (todo.length) {
    process.stderr.write(`fetching ${todo.length} portals (concurrency 8)…\n`);
    let done = 0;
    await pool(todo, 8, async (p) => {
      const s = await fetchPortalStats(
        { connectorType: p.connectorType, baseUrl: p.baseUrl, label: p.label, countryCode: p.countryCode },
        { socrataToken: process.env.SOCRATA_APP_TOKEN },
      );
      // Don't let a portal that happens to be down today delete what it told
      // us last time. A refetch only overwrites when it actually learned
      // something: a failed probe against a portal we already have a count for
      // keeps the count (and its original fetchedAt, so the page still dates
      // the number honestly).
      const had = cache[p.slug];
      const learnedNothing = !s.ok && s.count == null && !s.licences?.length;
      if (!(learnedNothing && had && (had.count != null || had.licences?.length))) {
        cache[p.slug] = s;
      } else {
        stale.push(p.slug);
      }
      done++;
      if (done % 10 === 0 || done === todo.length) process.stderr.write(`  ${done}/${todo.length}\n`);
    });
    writeFileSync(CACHE, JSON.stringify(cache, null, 1));
    if (stale.length) {
      process.stderr.write(`  ${stale.length} portals failed this probe; kept their previous figures: ${stale.join(', ')}\n`);
    }
  }
  return cache;
}

// Counts for the bespoke statistical APIs the site's fetcher cannot speak,
// taken from the connector's own catalogTotal(). See fetch-bespoke-counts.mjs.
const bespokeCounts = existsSync(BESPOKE_COUNTS) ? loadJSON(BESPOKE_COUNTS) : {};
const bespokeByUrl = new Map(Object.entries(bespokeCounts).map(([u, v]) => [norm(u), v]));

// Combine live stats + matrix fallback into the shape the renderer wants.
function finalizeStats(portal, live) {
  let s = live;
  // A count from the connector outranks no count at all, but never a live one:
  // the portal's own catalogue API is closer to the truth than our reading of it.
  const bespoke = bespokeByUrl.get(norm(portal.baseUrl));
  if (bespoke && s.count == null) {
    s = {
      ...s,
      count: bespoke.count,
      countSource: bespoke.source,
      fetchedAt: s.fetchedAt || `${bespoke.measured}T00:00:00.000Z`,
    };
  }
  // If live licence data missing but matrix has it, splice matrix licence stats in.
  // Not when the probe found the licences live on the distributions: the
  // matrix's observed sample was read from the same package-level field that
  // is empty on those portals, so splicing it back in would re-assert the
  // "99% undeclared" claim the probe exists to prevent (ckan.govdata.de).
  if (s.licenceAtDistribution) {
    // leave undeclaredPct null — the page says the mix can't be summarised
  } else if ((s.undeclaredPct == null || !s.licences?.length) && portal.matrixObserved) {
    const mx = fromMatrix(portal);
    s = {
      ...s,
      undeclaredPct: s.undeclaredPct == null ? mx.undeclaredPct : s.undeclaredPct,
      licences: s.licences?.length ? s.licences : mx.licences,
      count: s.count ?? mx.count,
    };
  }
  let merged = mergeLicences(s.licences || []);
  let undeclaredPct = s.undeclaredPct ?? (merged.total ? merged.undeclared / merged.total : null);

  // Step 2 of the matrix's own resolution order: where a dataset declares
  // nothing and the PORTAL publishes a blanket licence, that licence governs.
  // The connector has always done this; these pages did not, so a portal with
  // site-wide terms was published as if its data carried no permission at all
  // — SEMCOG read "100% of datasets here declare no licence" on 19 Sep 2026
  // when every dataset is in fact under a permissive agreement, and Ontario,
  // NASA and the ONS Geoportal were all overstating their undeclared shares
  // the same way. Ten portals carry a default_licence today.
  //
  // The re-attributed datasets are marked as covered by a blanket licence
  // rather than silently folded into "declared", because the distinction is
  // real: nobody wrote a licence on the dataset, the portal wrote one over all
  // of them.
  const blanket = portal.defaultLicence && merged.undeclared > 0
    ? { cls: CLASS_LABEL[portal.defaultLicence] || portal.defaultLicence, count: merged.undeclared }
    : null;
  if (blanket) {
    merged = mergeLicences([
      ...(s.licences || []).filter((l) => canonLicence(l.cls) !== 'UNDECLARED'),
      { cls: portal.defaultLicence, count: merged.undeclared },
    ]);
    undeclaredPct = 0;
  }

  return {
    count: s.count ?? null,
    undeclaredPct,
    licences: merged.declared,       // top declared, canonicalised
    undeclaredCount: merged.undeclared || null,
    blanketLicence: blanket,
    publishers: (s.publishers || []).slice(0, 8),
    // How much of the catalogue the publisher list actually speaks for; the
    // renderer says so when it is only part of the portal.
    publisherCoverage: s.publisherCoverage ?? null,
    rights: merged.rights,
    dominantLicence: merged.dominant,
    ok: !!s.ok,
    fetchedAt: s.fetchedAt || null,
    countSource: s.countSource || '',
  };
}

async function main() {
  const args = process.argv.slice(2);
  const fetchOnly = args.includes('fetch');
  const forceFetch = args.includes('--force-fetch');
  const portals = buildPortals();
  process.stderr.write(`built ${portals.length} portal records\n`);
  const cache = await getStats(portals, { forceFetch });
  if (fetchOnly) {
    const ok = portals.filter((p) => cache[p.slug]?.ok).length;
    const withCount = portals.filter((p) => cache[p.slug]?.count != null).length;
    process.stderr.write(`cached. ok=${ok}/${portals.length}, withCount=${withCount}\n`);
    return;
  }

  const { renderPortalPage, renderPortalsIndex } = await import('./render-portal.mjs');
  // "Data as of" must reflect when the counts were actually fetched, not when
  // the pages were last rendered — a meta-only rebuild must not make stale
  // numbers look fresh.
  const fetched = Object.values(cache)
    .map((s) => s && s.fetchedAt)
    .filter(Boolean)
    .sort();
  const dataDate = fetched.length ? fetched[fetched.length - 1].slice(0, 10) : TODAY;
  const ctx = { siteUrl: SITE, appUrl: APP, generatedDate: dataDate };
  const outRoot = join(WEB, 'portals');
  mkdirSync(outRoot, { recursive: true });

  const indexRows = [];
  for (const p of portals) {
    const stats = finalizeStats(p, cache[p.slug] || {});
    const html = renderPortalPage(p, stats, ctx);
    const dir = join(outRoot, p.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), html);
    indexRows.push({ ...p, count: stats.count });
  }

  // group by country for the index
  const byCountry = {};
  for (const p of indexRows) (byCountry[p.country] ||= { country: p.country, code: p.countryCode, portals: [] }).portals.push({ slug: p.slug, name: p.name, count: p.count });
  const groups = Object.values(byCountry).sort((a, b) => b.portals.length - a.portals.length || a.country.localeCompare(b.country));
  for (const g of groups) g.portals.sort((a, b) => (b.count || 0) - (a.count || 0));
  writeFileSync(join(outRoot, 'index.html'), renderPortalsIndex(groups, ctx));

  // sitemap. The geography pages are written by build-geography.mjs, but the
  // sitemap has a single writer — this one — so they are discovered from disk
  // rather than listed here. Either build order then produces a complete map,
  // and a page that has been deleted cannot linger in it.
  const geographyDir = join(WEB, 'geography');
  const geographySlugs = existsSync(geographyDir)
    ? readdirSync(geographyDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(geographyDir, d.name, 'index.html')))
        .map((d) => d.name)
        .sort()
    : [];
  const urls = [
    { loc: `${SITE}/`, pr: '1.0' },
    { loc: `${SITE}/portals/`, pr: '0.8' },
    { loc: `${SITE}/brand/`, pr: '0.3' },
    ...geographySlugs.map((slug) => ({ loc: `${SITE}/geography/${slug}/`, pr: '0.7' })),
    ...portals.map((p) => ({ loc: `${SITE}/portals/${p.slug}/`, pr: '0.6' })),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${u.pr}</priority>\n  </url>`)
    .join('\n')}\n</urlset>\n`;
  writeFileSync(join(WEB, 'sitemap.xml'), sitemap);

  process.stderr.write(`wrote ${portals.length} portal pages + index + sitemap (${urls.length} urls, incl. ${geographySlugs.length} geography)\n`);

  // Surface what the alias table missed. These are licences a portal really
  // declares that the compliance matrix has no class for, so they render as a
  // display-grouped approximation here and resolve to UNDECLARED in the
  // connector — which is the conservative answer, but a worse one than adding
  // the alias.
  if (unmapped.size) {
    const top = [...unmapped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    process.stderr.write(`\n${unmapped.size} licence strings had no alias in the matrix (top 15):\n`);
    for (const [raw, n] of top) process.stderr.write(`  ${String(n).padStart(4)}x  ${JSON.stringify(raw)}\n`);
    process.stderr.write('  -> add these to licence_aliases in vizzie-connector, then re-sync.\n');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
