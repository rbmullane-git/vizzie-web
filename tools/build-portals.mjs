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
const EXAMPLES_DIR = '/Users/rich/vizzie/src/examples/data';

const SITE = 'https://www.vizzie.org';
const APP = 'https://app.vizzie.org';
const TODAY = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);

const COUNTRY_LABELS = {
  AU: 'Australia', US: 'United States', GB: 'United Kingdom', FR: 'France', DE: 'Germany',
  NL: 'Netherlands', AT: 'Austria', ES: 'Spain', FI: 'Finland', SG: 'Singapore', BE: 'Belgium',
  IT: 'Italy', IE: 'Ireland', PT: 'Portugal', CH: 'Switzerland', GR: 'Greece', SI: 'Slovenia',
  RO: 'Romania', LV: 'Latvia', LU: 'Luxembourg', CA: 'Canada', NZ: 'New Zealand', JP: 'Japan',
  AR: 'Argentina', IN: 'India', UN: 'Global', APAC: 'Asia-Pacific (regional)', EU: 'European Union',
};
const PLATFORM_LABEL = {
  ckan: 'CKAN', socrata: 'Socrata', 'arcgis-hub': 'ArcGIS Hub', opendatasoft: 'OpenDataSoft',
  datagov: 'CKAN (data.gov)', 'data-europa-eu': 'data.europa.eu', udata: 'uData', dataverse: 'Dataverse',
  'data-gov-sg': 'data.gov.sg', 'data-gov-in': 'data.gov.in', 'data-gov-in-dms': 'data.gov.in',
  'os-data-hub': 'OS Data Hub', 'london-datastore': 'London Datastore', 'world-bank': 'World Bank',
  oecd: 'OECD', 'who-gho': 'WHO GHO', unicef: 'UNICEF', 'un-sdg': 'UN SDG', adb: 'ADB', dhs: 'DHS', owid: 'Our World in Data',
};

const norm = (u) => (u || '').replace(/\/+$/, '');
const host = (u) => { try { return new URL(u).host; } catch { return (u || '').replace(/^https?:\/\//, '').split('/')[0]; } };
const slugify = (u) => host(u).replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

// Merge CKAN/ArcGIS raw licence keys into canonical classes.
function canonLicence(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s || s === 'notspecified' || s === 'undeclared' || s === 'null') return 'UNDECLARED';
  if (s.includes('cc-by-sa') || s.includes('cc-sa')) return 'CC-BY-SA';
  if (s.includes('cc-by-nc')) return 'CC-BY-NC';
  if (s.includes('cc-by-nd')) return 'CC-BY-ND';
  if (s.includes('cc-zero') || s.includes('cc0') || s.includes('cc-0') || s.includes('publicdomain') || s.includes('pddl')) return 'CC0 / Public Domain';
  if (s.includes('cc-by') || s.includes('creativecommons.org/licenses/by')) return 'CC-BY';
  if (s.includes('ogl')) return 'Open Government Licence';
  if (s.includes('odbl')) return 'ODbL';
  if (s.includes('odc')) return 'Open Data Commons';
  if (s.includes('us-pd') || s === 'other-pd' || s.includes('public domain')) return 'Public Domain';
  if (s.includes('other')) return 'Other / bespoke';
  return raw.length > 24 ? 'Other / bespoke' : raw; // keep short codes as-is
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
  return { declared, undeclared, total };
}

function loadJSON(p) { return JSON.parse(readFileSync(p, 'utf8')); }

function examplesByHost() {
  const map = {};
  for (const f of readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.json'))) {
    const slug = f.replace(/\.json$/, '');
    let d; try { d = loadJSON(join(EXAMPLES_DIR, f)); } catch { continue; }
    const name = d.name || slug;
    const blurb = (d.description || '').slice(0, 140);
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
    for (const h of found) (map[h] ||= []).push({ slug, name, blurb });
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
  const cache = existsSync(CACHE) && !forceFetch ? loadJSON(CACHE) : {};
  const todo = portals.filter((p) => forceFetch || !cache[p.slug]);
  if (todo.length) {
    process.stderr.write(`fetching ${todo.length} portals (concurrency 8)…\n`);
    let done = 0;
    await pool(todo, 8, async (p) => {
      const s = await fetchPortalStats(
        { connectorType: p.connectorType, baseUrl: p.baseUrl, label: p.label, countryCode: p.countryCode },
        { socrataToken: process.env.SOCRATA_APP_TOKEN },
      );
      cache[p.slug] = s;
      done++;
      if (done % 10 === 0 || done === todo.length) process.stderr.write(`  ${done}/${todo.length}\n`);
    });
    writeFileSync(CACHE, JSON.stringify(cache, null, 1));
  }
  return cache;
}

// Combine live stats + matrix fallback into the shape the renderer wants.
function finalizeStats(portal, live) {
  let s = live;
  // If live licence data missing but matrix has it, splice matrix licence stats in.
  if ((s.undeclaredPct == null || !s.licences?.length) && portal.matrixObserved) {
    const mx = fromMatrix(portal);
    s = {
      ...s,
      undeclaredPct: s.undeclaredPct == null ? mx.undeclaredPct : s.undeclaredPct,
      licences: s.licences?.length ? s.licences : mx.licences,
      count: s.count ?? mx.count,
    };
  }
  const merged = mergeLicences(s.licences || []);
  return {
    count: s.count ?? null,
    undeclaredPct: s.undeclaredPct ?? (merged.total ? merged.undeclared / merged.total : null),
    licences: merged.declared,       // top declared, canonicalised
    undeclaredCount: merged.undeclared || null,
    publishers: (s.publishers || []).slice(0, 8),
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
  const ctx = { siteUrl: SITE, appUrl: APP, generatedDate: TODAY };
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

  // sitemap
  const urls = [
    { loc: `${SITE}/`, pr: '1.0' },
    { loc: `${SITE}/portals/`, pr: '0.8' },
    ...portals.map((p) => ({ loc: `${SITE}/portals/${p.slug}/`, pr: '0.6' })),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${u.pr}</priority>\n  </url>`)
    .join('\n')}\n</urlset>\n`;
  writeFileSync(join(WEB, 'sitemap.xml'), sitemap);

  process.stderr.write(`wrote ${portals.length} portal pages + index + sitemap (${urls.length} urls)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
