// fetch-portal-stats.mjs
//
// Fetches live catalog statistics from open-data portals for a static-site
// generator. This module MUST NEVER throw: fetchPortalStats always resolves
// with (partial) data, using ok:false + notes[] to signal failures.
//
// export async function fetchPortalStats(portal, opts = {})

const DEFAULT_TIMEOUT_MS = 15000;
const ARCGIS_TIMEOUT_MS = 25000;
const USER_AGENT = 'Vizzie-portal-pages/1.0 (+https://www.vizzie.org)';

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function emptyResult(fetchedAt) {
  return {
    count: null,
    countSource: '',
    undeclaredPct: null,
    licences: [],
    publishers: [],
    fetchedAt,
    ok: false,
    notes: [],
  };
}

function nowIso(opts) {
  if (opts && typeof opts.now === 'string' && opts.now) return opts.now;
  try {
    return new Date().toISOString();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Network: fetch with timeout + 1 retry on network error / 5xx
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, ...headers },
      redirect: 'follow',
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// Returns { res, error }. Retries once on thrown network error or 5xx status.
async function fetchResilient(url, opts = {}) {
  const attempt = async () => {
    try {
      const res = await fetchWithTimeout(url, opts);
      return { res, error: null };
    } catch (err) {
      return { res: null, error: err };
    }
  };

  let { res, error } = await attempt();
  const shouldRetry = error !== null || (res && res.status >= 500 && res.status <= 599);
  if (shouldRetry) {
    await sleep(1000);
    ({ res, error } = await attempt());
  }
  return { res, error };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetch JSON resiliently. Returns { json, note } where note is a string on failure.
async function fetchJson(url, opts = {}) {
  const { res, error } = await fetchResilient(url, opts);
  if (error) {
    return { json: null, note: `fetch error for ${url}: ${describeError(error)}` };
  }
  if (!res.ok) {
    return { json: null, note: `HTTP ${res.status} for ${url}` };
  }
  try {
    const json = await res.json();
    return { json, note: null };
  } catch (err) {
    return { json: null, note: `JSON parse error for ${url}: ${describeError(err)}` };
  }
}

function describeError(err) {
  if (!err) return 'unknown error';
  if (err.name === 'AbortError') return 'timeout/abort';
  return err.message || String(err);
}

// ---------------------------------------------------------------------------
// Utility: bucket counting, top-N
// ---------------------------------------------------------------------------

function topN(items, n) {
  return [...items].sort((a, b) => b.count - a.count).slice(0, n);
}

function bucketsToArray(map) {
  return Object.entries(map).map(([cls, count]) => ({ cls, count }));
}

// ---------------------------------------------------------------------------
// CKAN
// ---------------------------------------------------------------------------

function isUndeclaredCkanLicence(name) {
  if (name === null || name === undefined) return true;
  const s = String(name).trim().toLowerCase();
  return s === '' || s === 'notspecified';
}

async function fetchCkan(portal, opts, result) {
  const base = portal.baseUrl.replace(/\/+$/, '');
  const url =
    `${base}/api/3/action/package_search` +
    `?rows=0&facet.field=%5B%22license_id%22%2C%22organization%22%5D&facet.limit=60`;

  const { json, note } = await fetchJson(url, { timeoutMs: DEFAULT_TIMEOUT_MS });
  if (note) result.notes.push(note);
  if (!json || json.success === false || !json.result) {
    if (!note) result.notes.push('ckan: no result payload');
    return result;
  }

  const r = json.result;
  const count = typeof r.count === 'number' ? r.count : null;
  result.count = count;
  result.countSource = 'ckan package_search';
  result.ok = count !== null;

  const facets = r.search_facets || {};

  // Licences
  const licItems = (facets.license_id && facets.license_id.items) || [];
  if (licItems.length) {
    let undeclared = 0;
    const declared = {};
    for (const item of licItems) {
      const c = typeof item.count === 'number' ? item.count : 0;
      if (isUndeclaredCkanLicence(item.name)) {
        undeclared += c;
      } else {
        const key = item.name;
        declared[key] = (declared[key] || 0) + c;
      }
    }
    const licences = topN(bucketsToArray(declared), 10);
    if (undeclared > 0) licences.push({ cls: 'UNDECLARED', count: undeclared });
    result.licences = topN(licences, 12);
    if (count && count > 0) {
      result.undeclaredPct = undeclared / count;
    }
  }

  // Publishers / organizations
  const orgItems = (facets.organization && facets.organization.items) || [];
  if (orgItems.length) {
    const pubs = orgItems.map((item) => ({
      name: item.display_name || item.name,
      count: typeof item.count === 'number' ? item.count : 0,
    }));
    result.publishers = topN(pubs, 8);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Socrata (discovery API)
// ---------------------------------------------------------------------------

async function fetchSocrata(portal, opts, result) {
  let host;
  try {
    host = new URL(portal.baseUrl).host;
  } catch {
    result.notes.push(`socrata: invalid baseUrl ${portal.baseUrl}`);
    return result;
  }

  const disc = host.endsWith('.eu') ? 'https://api.eu.socrata.com' : 'https://api.us.socrata.com';
  const url =
    `${disc}/api/catalog/v1?domains=${encodeURIComponent(host)}` +
    `&search_context=${encodeURIComponent(host)}&only=datasets&limit=0`;

  const headers = {};
  if (opts && opts.socrataToken) headers['X-App-Token'] = opts.socrataToken;

  const { json, note } = await fetchJson(url, { timeoutMs: DEFAULT_TIMEOUT_MS, headers });
  if (note) result.notes.push(note);
  if (!json) return result;

  const count = typeof json.resultSetSize === 'number' ? json.resultSetSize : null;
  result.count = count;
  result.countSource = 'socrata discovery';
  result.ok = count !== null;
  // Discovery API gives no licence/publisher facet.
  result.undeclaredPct = null;
  result.notes.push('socrata discovery: no licence/publisher facets available');
  return result;
}

// ---------------------------------------------------------------------------
// OpenDataSoft
// ---------------------------------------------------------------------------

function isUndeclaredOdsLicence(name) {
  if (name === null || name === undefined) return false;
  const s = String(name).trim().toLowerCase();
  if (s === '') return true;
  return s.includes('no licence') || s.includes('no license') || s === 'none';
}

async function fetchOpendatasoft(portal, opts, result) {
  const base = portal.baseUrl.replace(/\/+$/, '');

  // Count
  const countUrl = `${base}/api/v2/catalog/datasets?limit=0`;
  const { json: countJson, note: countNote } = await fetchJson(countUrl, {
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (countNote) result.notes.push(countNote);
  if (countJson && typeof countJson.total_count === 'number') {
    result.count = countJson.total_count;
    result.countSource = 'opendatasoft catalog';
    result.ok = true;
  }

  // Facets
  const facetUrl = `${base}/api/v2/catalog/facets?facet=license&facet=publisher`;
  const { json: facetJson, note: facetNote } = await fetchJson(facetUrl, {
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (facetNote) result.notes.push(facetNote);

  if (facetJson && Array.isArray(facetJson.facets)) {
    const findFacet = (name) => facetJson.facets.find((f) => f && f.name === name);

    // Licences
    const licFacet = findFacet('license');
    if (licFacet && Array.isArray(licFacet.facets)) {
      let undeclared = 0;
      const declared = {};
      for (const item of licFacet.facets) {
        const c = typeof item.count === 'number' ? item.count : 0;
        if (isUndeclaredOdsLicence(item.name)) {
          undeclared += c;
        } else {
          declared[item.name] = (declared[item.name] || 0) + c;
        }
      }
      const licences = topN(bucketsToArray(declared), 10);
      if (undeclared > 0) {
        licences.push({ cls: 'UNDECLARED', count: undeclared });
        if (result.count && result.count > 0) {
          result.undeclaredPct = undeclared / result.count;
        }
      }
      result.licences = topN(licences, 12);
    }

    // Publishers
    const pubFacet = findFacet('publisher');
    if (pubFacet && Array.isArray(pubFacet.facets)) {
      const pubs = pubFacet.facets.map((item) => ({
        name: item.name,
        count: typeof item.count === 'number' ? item.count : 0,
      }));
      result.publishers = topN(pubs, 8);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// ArcGIS Hub (DCAT data.json)
// ---------------------------------------------------------------------------

function classifyArcgisLicence(raw) {
  if (raw === null || raw === undefined) return 'UNDECLARED';
  const s = String(raw).trim();
  if (s === '') return 'UNDECLARED';
  const l = s.toLowerCase();
  if (l.includes('publicdomain') || l.includes('cc0')) return 'CC0';
  if (l.includes('creativecommons.org/licenses/by')) return 'CC-BY';
  // HTML blobs with no clear CC signal → treat as undeclared.
  if (l.includes('<') && !l.includes('creativecommons') && !l.includes('license')) {
    return 'UNDECLARED';
  }
  // Keep short readable licence strings; bucket long HTML noise as UNDECLARED.
  if (s.length > 120) return 'UNDECLARED';
  return s;
}

async function fetchArcgisHub(portal, opts, result) {
  const base = portal.baseUrl.replace(/\/+$/, '');
  const url = `${base}/data.json`;

  const { json, note } = await fetchJson(url, { timeoutMs: ARCGIS_TIMEOUT_MS });
  if (note) result.notes.push(note);
  if (!json || !Array.isArray(json.dataset)) {
    if (!note) result.notes.push('arcgis-hub: no dataset array in data.json');
    return result;
  }

  const datasets = json.dataset;
  const count = datasets.length;
  result.count = count;
  result.countSource = 'arcgis-hub data.json';
  result.ok = true;

  if (count === 1000 || count === 5000 || count === 10000) {
    result.notes.push(`arcgis-hub: count is exactly ${count}, data.json may be capped`);
  }

  // Licences
  let undeclared = 0;
  const licBuckets = {};
  for (const d of datasets) {
    const cls = classifyArcgisLicence(d && d.license);
    if (cls === 'UNDECLARED') undeclared += 1;
    else licBuckets[cls] = (licBuckets[cls] || 0) + 1;
  }
  const licences = topN(bucketsToArray(licBuckets), 8);
  if (undeclared > 0) {
    licences.push({ cls: 'UNDECLARED', count: undeclared });
    if (count > 0) result.undeclaredPct = undeclared / count;
  } else if (count > 0) {
    result.undeclaredPct = 0;
  }
  result.licences = topN(licences, 10);

  // Publishers
  const pubBuckets = {};
  for (const d of datasets) {
    let name = null;
    if (d && d.publisher) {
      if (typeof d.publisher === 'string') name = d.publisher;
      else if (typeof d.publisher === 'object' && d.publisher.name) name = d.publisher.name;
    }
    if (!name) name = '(unknown)';
    pubBuckets[name] = (pubBuckets[name] || 0) + 1;
  }
  result.publishers = topN(
    Object.entries(pubBuckets).map(([name, c]) => ({ name, count: c })),
    8
  );

  return result;
}

// ---------------------------------------------------------------------------
// data.gov (catalog.data.gov /api/stats)
// ---------------------------------------------------------------------------

async function fetchDatagov(portal, opts, result) {
  const base = portal.baseUrl.replace(/\/+$/, '');
  const url = `${base}/api/stats`;

  const { json, note } = await fetchJson(url, { timeoutMs: DEFAULT_TIMEOUT_MS });
  if (note) result.notes.push(note);
  if (!json) return result;

  const datasets =
    json && json.results && typeof json.results.datasets === 'number'
      ? json.results.datasets
      : null;
  if (datasets !== null) {
    result.count = datasets;
    result.countSource = 'datagov api/stats';
    result.ok = true;
  } else {
    result.notes.push('datagov: results.datasets not found');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Bespoke catalog APIs (count-only; licences/publishers fall back to the
// compliance matrix in the generator). London Datastore is CKAN-compatible and
// routes through fetchCkan instead.
// ---------------------------------------------------------------------------

async function fetchByPath(url, path, source, result, opts = {}) {
  const { json, note } = await fetchJson(url, { timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS });
  if (note) result.notes.push(note);
  if (!json) return result;
  const val = path.split('.').reduce((o, k) => (o == null ? o : o[k]), json);
  if (typeof val === 'number' && Number.isFinite(val)) {
    result.count = val;
    result.countSource = source;
    result.ok = true;
  } else {
    result.notes.push(`${source}: count not found at ${path}`);
  }
  return result;
}

// uData (data.gouv.fr, dados.gov.pt, data.public.lu)
async function fetchUdata(portal, opts, result) {
  const base = portal.baseUrl.replace(/\/+$/, '');
  return fetchByPath(`${base}/api/1/datasets/?page_size=1`, 'total', 'udata', result);
}

// data.europa.eu hub search (also the harvested aggregate)
async function fetchDataEuropa(portal, opts, result) {
  const base = portal.baseUrl.replace(/\/+$/, '');
  return fetchByPath(
    `${base}/api/hub/search/search?limit=1&filter=dataset`,
    'result.count',
    'data.europa.eu hub',
    result,
    { timeoutMs: ARCGIS_TIMEOUT_MS },
  );
}

// data.gov.sg (fixed production API host)
async function fetchDataGovSg(portal, opts, result) {
  return fetchByPath(
    'https://api-production.data.gov.sg/v2/public/api/datasets?page=1',
    'data.totalRowCount',
    'data.gov.sg',
    result,
  );
}

// Dataverse (Harvard etc.) — type=dataset, never file
async function fetchDataverse(portal, opts, result) {
  const base = portal.baseUrl.replace(/\/+$/, '');
  return fetchByPath(
    `${base}/api/search?q=*&type=dataset&per_page=1`,
    'data.total_count',
    'dataverse search',
    result,
    { timeoutMs: ARCGIS_TIMEOUT_MS },
  );
}

// data.gov.in (national) — published sample API key raises quota if replaced
async function fetchDataGovIn(portal, opts, result) {
  const key = process.env.DATA_GOV_IN_API_KEY ||
    '579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b';
  const url =
    'https://api.data.gov.in/lists?filters%5Bactive%5D=1&filters%5Bsource%5D=data.gov.in' +
    `&limit=0&api-key=${key}`;
  return fetchByPath(url, 'total', 'data.gov.in', result);
}

// data.gov.in state DMS portals (karnataka/tn/smartcities)
async function fetchDataGovInDms(portal, opts, result) {
  let host;
  try { host = new URL(portal.baseUrl).host; } catch { host = portal.baseUrl; }
  const url = `https://${host}/backend/dmspublic/v1/resources?filters%5Bdomain%5D=${encodeURIComponent(host)}&limit=1`;
  return fetchByPath(url, 'total', 'data.gov.in DMS', result);
}

// OS Data Hub (downloadable products)
async function fetchOsDataHub(portal, opts, result) {
  const base = portal.baseUrl.replace(/\/+$/, '');
  const { json, note } = await fetchJson(`${base}/downloads/v1/products`, { timeoutMs: DEFAULT_TIMEOUT_MS });
  if (note) result.notes.push(note);
  if (Array.isArray(json)) {
    result.count = json.length;
    result.countSource = 'OS Data Hub products';
    result.ok = true;
  } else {
    result.notes.push('os-data-hub: products response not an array');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const HANDLERS = {
  ckan: fetchCkan,
  socrata: fetchSocrata,
  opendatasoft: fetchOpendatasoft,
  'arcgis-hub': fetchArcgisHub,
  datagov: fetchDatagov,
  'london-datastore': fetchCkan, // CKAN-compatible: gets count + licence + publisher facets
  udata: fetchUdata,
  'data-europa-eu': fetchDataEuropa,
  'data-gov-sg': fetchDataGovSg,
  dataverse: fetchDataverse,
  'data-gov-in': fetchDataGovIn,
  'data-gov-in-dms': fetchDataGovInDms,
  'os-data-hub': fetchOsDataHub,
};

export async function fetchPortalStats(portal, opts = {}) {
  const fetchedAt = nowIso(opts);
  const result = emptyResult(fetchedAt);

  try {
    if (!portal || typeof portal !== 'object') {
      result.notes.push('invalid portal argument');
      return result;
    }
    const type = portal.connectorType;
    const handler = HANDLERS[type];

    if (!handler) {
      // ~20 bespoke sources not deeply implemented — graceful null.
      result.notes.push(`count not fetched for type ${type}`);
      return result;
    }

    await handler(portal, opts || {}, result);
    return result;
  } catch (err) {
    // Absolute safety net: never throw.
    result.count = null;
    result.ok = false;
    result.notes.push(`unexpected error: ${describeError(err)}`);
    return result;
  }
}

// ---------------------------------------------------------------------------
// CLI self-test
// ---------------------------------------------------------------------------

async function main() {
  const portals = [
    { connectorType: 'ckan', baseUrl: 'https://data.gov.au/data', label: 'data.gov.au' },
    { connectorType: 'socrata', baseUrl: 'https://data.ny.gov', label: 'NY' },
    {
      connectorType: 'opendatasoft',
      baseUrl: 'https://data.melbourne.vic.gov.au',
      label: 'Melbourne',
    },
    {
      connectorType: 'arcgis-hub',
      baseUrl: 'https://data-cityofsydney.opendata.arcgis.com',
      label: 'Sydney',
    },
    { connectorType: 'datagov', baseUrl: 'https://catalog.data.gov', label: 'US' },
  ];

  for (const portal of portals) {
    /* eslint-disable no-await-in-loop */
    const stats = await fetchPortalStats(portal, { socrataToken: process.env.SOCRATA_TOKEN });
    console.log('='.repeat(70));
    console.log(`${portal.label}  [${portal.connectorType}]  ${portal.baseUrl}`);
    console.log('-'.repeat(70));
    console.log(JSON.stringify(stats, null, 2));
    /* eslint-enable no-await-in-loop */
  }
  console.log('='.repeat(70));
}

// Run only when executed directly.
try {
  const invokedPath = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : '';
  if (import.meta.url === invokedPath || import.meta.url === `file://${process.argv[1]}`) {
    main();
  }
} catch {
  // ignore — importing as a module
}
