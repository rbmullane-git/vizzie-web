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
    // Share of datasets that actually named a publisher, when we counted them
    // one by one rather than reading a facet. Null when unknown. A portal where
    // only 4 of 70 datasets name anyone must not present those 4 as if they
    // were the portal's most active publishers.
    publisherCoverage: null,
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
  // Discovery API gives no licence facet, and no publisher facet either — but
  // every dataset carries `resource.attribution`, which IS the publisher. So the
  // list is derived by walking the catalogue rather than asking for a facet.
  result.undeclaredPct = null;
  result.notes.push('socrata discovery: no licence facet available');

  const { publishers, coverage } = await socrataPublishers(disc, host, count, headers, result);
  if (publishers.length) result.publishers = topN(publishers, 8);
  result.publisherCoverage = coverage;
  return result;
}

/**
 * Publishers for a Socrata portal, tallied from every dataset's `attribution`.
 *
 * There is no facet to ask for, so this pages the whole catalogue. That is
 * affordable precisely because Socrata portals are small: all 38 of them hold
 * ~18,000 datasets between them, about 200 requests, and the largest single
 * portal (NYC) is 24 pages. Walking the whole list rather than sampling matters
 * because the counts are rendered next to the publisher names — a sampled tally
 * would put confident, wrong numbers on the page.
 *
 * PAGE_CAP is a safety net against a portal that reports a small size and then
 * pages forever, not a sampling strategy: hitting it makes the counts partial,
 * so it is recorded in notes rather than passing silently.
 */
/**
 * Tidy a Socrata `attribution`, which is free text a publisher typed once and
 * never revisited. Only two things are safe to do here:
 *   - collapse whitespace;
 *   - drop a leading copyright mark, so "© Australian Capital Territory" is
 *     filed under the body that published it rather than as its own publisher.
 *
 * Deliberately NOT merged: the same agency under different spellings
 * ("Transport Canberra" / "Transport Canberra and City Services" / "ACT
 * Government - Transport Canberra and City Services"). Those are three real
 * strings in the portal, and guessing which are the same body would put a name
 * on the page that no dataset actually carries.
 */
function cleanAttribution(raw) {
  if (typeof raw !== 'string') return '';
  const name = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:©|\(c\)|copyright)\s*/i, '')
    .trim();
  return name;
}

const SOCRATA_PAGE = 100;
const SOCRATA_PAGE_CAP = 60;

async function socrataPublishers(disc, host, count, headers, result) {
  const tally = {};
  let seen = 0;
  let named = 0;
  let pages = 0;

  while (pages < SOCRATA_PAGE_CAP) {
    const url =
      `${disc}/api/catalog/v1?domains=${encodeURIComponent(host)}` +
      `&search_context=${encodeURIComponent(host)}&only=datasets` +
      `&limit=${SOCRATA_PAGE}&offset=${pages * SOCRATA_PAGE}`;
    const { json, note } = await fetchJson(url, { timeoutMs: DEFAULT_TIMEOUT_MS, headers });
    if (note) {
      // A page that fails leaves what we have: a partial list beats none, as
      // long as we say so.
      result.notes.push(`socrata publishers: ${note}`);
      break;
    }
    const results = json && Array.isArray(json.results) ? json.results : [];
    if (results.length === 0) break;

    for (const item of results) {
      seen += 1;
      const attribution = item && item.resource ? item.resource.attribution : null;
      const name = cleanAttribution(attribution);
      if (!name) continue;
      named += 1;
      tally[name] = (tally[name] || 0) + 1;
    }

    pages += 1;
    if (results.length < SOCRATA_PAGE) break;
    if (typeof count === 'number' && seen >= count) break;
    await sleep(150); // be a good citizen; the whole run is ~200 requests
  }

  if (pages >= SOCRATA_PAGE_CAP) {
    result.notes.push(
      `socrata publishers: stopped at ${SOCRATA_PAGE_CAP} pages, counts are partial`,
    );
  }
  const publishers = Object.entries(tally).map(([name, c]) => ({ name, count: c }));
  if (!publishers.length && seen > 0) {
    result.notes.push('socrata publishers: no dataset carried an attribution');
  }
  const coverage = seen > 0 ? named / seen : null;
  if (coverage !== null && coverage < 1) {
    result.notes.push(
      `socrata publishers: ${named} of ${seen} datasets named a publisher`,
    );
  }
  return { publishers, coverage };
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

/**
 * The publisher facet for an OpenDataSoft portal. Uses the one already returned
 * alongside licences when the instance sent it, and otherwise asks separately —
 * see the note on the facet URL above.
 */
async function odsPublisherFacet(base, alreadyHave, result) {
  if (alreadyHave) return alreadyHave;
  const { json, note } = await fetchJson(`${base}/api/v2/catalog/facets?facet=publisher`, {
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (note) {
    result.notes.push(`ods publishers: ${note}`);
    return null;
  }
  const facets = json && Array.isArray(json.facets) ? json.facets : [];
  return facets.find((f) => f && f.name === 'publisher') || null;
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
  // One facet per request. Asking for `facet=license&facet=publisher` together
  // makes some OpenDataSoft instances silently return only the FIRST — Brisbane
  // answers that call with licences alone, then serves a perfectly good
  // publisher facet when asked for it on its own. Two cheap calls beat one that
  // quietly drops half of what was asked for.
  const facetUrl = `${base}/api/v2/catalog/facets?facet=license`;
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
    const pubFacet = await odsPublisherFacet(base, findFacet('publisher'), result);
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
  await fetchByPath(`${base}/api/1/datasets/?page_size=1`, 'total', 'udata', result);

  // Publishers are first-class objects here, so ask the organizations endpoint
  // for the busiest few rather than tallying datasets.
  //
  // The sort key is `-datasets`, NOT the `-metrics.datasets` the field is
  // actually called in the response. udata rejects the dotted form with a 400,
  // which is why this looked like "no publisher data available" rather than a
  // one-word bug.
  const orgUrl = `${base}/api/1/organizations/?page_size=8&sort=-datasets`;
  const { json, note } = await fetchJson(orgUrl, { timeoutMs: DEFAULT_TIMEOUT_MS });
  if (note) {
    result.notes.push(`udata publishers: ${note}`);
    return result;
  }
  const orgs = json && Array.isArray(json.data) ? json.data : [];
  const pubs = orgs
    .map((o) => ({
      name: typeof (o && o.name) === 'string' ? o.name.trim() : '',
      count: Number(o && o.metrics && o.metrics.datasets) || 0,
    }))
    .filter((p) => p.name && p.count > 0);
  if (pubs.length) result.publishers = topN(pubs, 8);
  else result.notes.push('udata publishers: organizations returned no dataset counts');
  return result;
}

// data.europa.eu hub search (also the harvested aggregate)
async function fetchDataEuropa(portal, opts, result) {
  const base = portal.baseUrl.replace(/\/+$/, '');
  // Ask for the publisher facet in the same call as the count. The hub returns
  // every facet it has whatever you request, but naming one keeps the intent
  // clear and the response shape stable.
  const url =
    `${base}/api/hub/search/search?limit=1&filter=dataset` +
    `&facets=${encodeURIComponent('{"publisher":[]}')}`;

  const { json, note } = await fetchJson(url, { timeoutMs: ARCGIS_TIMEOUT_MS });
  if (note) result.notes.push(note);
  if (!json || !json.result) {
    if (!note) result.notes.push('data.europa.eu: no result payload');
    return result;
  }

  const r = json.result;
  if (typeof r.count === 'number') {
    result.count = r.count;
    result.countSource = 'data.europa.eu hub';
    result.ok = true;
  } else {
    result.notes.push('data.europa.eu: result.count not found');
  }

  const facet = (Array.isArray(r.facets) ? r.facets : []).find((f) => f && f.id === 'publisher');
  const items = facet && Array.isArray(facet.items) ? facet.items : [];
  const pubs = items
    .map((it) => ({ name: localisedTitle(it && it.title), count: Number(it && it.count) || 0 }))
    .filter((p) => p.name && p.count > 0);
  if (pubs.length) result.publishers = topN(pubs, 8);
  else result.notes.push('data.europa.eu: no publisher facet items');

  return result;
}

/**
 * A data.europa.eu facet title, which arrives either as a plain string or as an
 * object of 24 EU language translations. Prefer English; fall back to whatever
 * the first key holds rather than rendering "[object Object]" on the page.
 */
function localisedTitle(title) {
  if (typeof title === 'string') return title.trim();
  if (title && typeof title === 'object') {
    const en = typeof title.en === 'string' ? title.en : '';
    if (en) return en.trim();
    for (const v of Object.values(title)) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return '';
}

// data.gov.sg (fixed production API host)
const SG_API = 'https://api-production.data.gov.sg/v2/public/api/datasets';
const SG_PAGE_CAP = 500;

async function fetchDataGovSg(portal, opts, result) {
  await fetchByPath(`${SG_API}?page=1`, 'data.totalRowCount', 'data.gov.sg', result);

  // Every dataset names its `managedByAgencyName`, and there is no facet — so
  // the list is tallied by walking the catalogue, as with Socrata.
  //
  // This one is expensive: the page size is fixed at 10 and cannot be raised
  // (limit / pageSize / per_page / size are all ignored), so 4,616 datasets is
  // ~460 requests — more than the whole Socrata sweep, for one portal. It is
  // paid once and cached; the alternative was sampling, which would print
  // confident wrong counts next to the agency names.
  const tally = {};
  let named = 0;
  let seen = 0;

  for (let page = 1; page <= SG_PAGE_CAP; page += 1) {
    const { json, note } = await fetchJson(`${SG_API}?page=${page}`, {
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    if (note) {
      result.notes.push(`data.gov.sg publishers: ${note}`);
      break;
    }
    const datasets = json && json.data && Array.isArray(json.data.datasets)
      ? json.data.datasets
      : [];
    if (datasets.length === 0) break;

    for (const d of datasets) {
      seen += 1;
      const name = typeof (d && d.managedByAgencyName) === 'string'
        ? d.managedByAgencyName.trim()
        : '';
      if (!name) continue;
      named += 1;
      tally[name] = (tally[name] || 0) + 1;
    }

    const pages = json.data && Number(json.data.pages);
    if (Number.isFinite(pages) && page >= pages) break;
    await sleep(120);
  }

  const pubs = Object.entries(tally).map(([name, count]) => ({ name, count }));
  if (pubs.length) result.publishers = topN(pubs, 8);
  result.publisherCoverage = seen > 0 ? named / seen : null;
  if (seen > 0 && named < seen) {
    result.notes.push(`data.gov.sg publishers: ${named} of ${seen} datasets named an agency`);
  }
  return result;
}

// Dataverse (Harvard etc.) — type=dataset, never file
async function fetchDataverse(portal, opts, result) {
  const base = portal.baseUrl.replace(/\/+$/, '');
  const url = `${base}/api/search?q=*&type=dataset&per_page=1&show_facets=true`;
  const { json, note } = await fetchJson(url, { timeoutMs: ARCGIS_TIMEOUT_MS });
  if (note) result.notes.push(note);
  const data = json && json.data ? json.data : null;
  if (!data) {
    if (!note) result.notes.push('dataverse: no data payload');
    return result;
  }
  if (typeof data.total_count === 'number') {
    result.count = data.total_count;
    result.countSource = 'dataverse search';
    result.ok = true;
  }

  // A research repository has depositors, not publishers. The closest true
  // equivalent it exposes is the depositing institution — `authorAffiliation_ss`
  // — so that is what this reports. It is an approximation, and a deliberate
  // one: "Harvard University, 32,956 datasets" tells a reader who is behind the
  // catalogue, which is the question the section answers.
  const facets = data.facets && data.facets['0'] ? data.facets['0'] : {};
  const labels = facets.authorAffiliation_ss && Array.isArray(facets.authorAffiliation_ss.labels)
    ? facets.authorAffiliation_ss.labels
    : [];
  const pubs = [];
  for (const entry of labels) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [name, c] of Object.entries(entry)) {
      const count = Number(c) || 0;
      if (name && count > 0) pubs.push({ name: name.trim(), count });
    }
  }
  if (pubs.length) result.publishers = topN(pubs, 8);
  else result.notes.push('dataverse: no authorAffiliation facet');
  return result;
}

// data.gov.in (national) — published sample API key raises quota if replaced
const IN_PAGE = 1000;
const IN_PAGE_CAP = 200;

async function fetchDataGovIn(portal, opts, result) {
  const key = process.env.DATA_GOV_IN_API_KEY ||
    '579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b';
  const listUrl = (limit, offset) =>
    'https://api.data.gov.in/lists?format=json&filters%5Bactive%5D=1' +
    `&filters%5Bsource%5D=data.gov.in&limit=${limit}&offset=${offset}&api-key=${key}`;

  await fetchByPath(listUrl(0, 0), 'total', 'data.gov.in', result);

  // Each record's `org` is a hierarchy, outermost first:
  //   ["Ministry of Agriculture and Farmers Welfare", "Department of ..."]
  // The ministry is what makes a readable ranking on a national portal — going
  // one level deeper splits the same body across dozens of departments and
  // turns a top-8 list into noise.
  const tally = {};
  let seen = 0;
  let named = 0;

  for (let page = 0; page < IN_PAGE_CAP; page += 1) {
    const { json, note } = await fetchJson(listUrl(IN_PAGE, page * IN_PAGE), {
      timeoutMs: ARCGIS_TIMEOUT_MS,
    });
    if (note) {
      result.notes.push(`data.gov.in publishers: ${note}`);
      break;
    }
    const records = json && Array.isArray(json.records) ? json.records : [];
    if (records.length === 0) break;

    for (const rec of records) {
      seen += 1;
      const org = rec && rec.org;
      const raw = Array.isArray(org) ? org[0] : org;
      const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
      if (!name) continue;
      named += 1;
      tally[name] = (tally[name] || 0) + 1;
    }

    if (records.length < IN_PAGE) break;
    await sleep(120);
  }

  if (seen >= IN_PAGE * IN_PAGE_CAP) {
    result.notes.push(`data.gov.in publishers: stopped at ${IN_PAGE_CAP} pages, counts are partial`);
  }
  const pubs = Object.entries(tally).map(([name, count]) => ({ name, count }));
  if (pubs.length) result.publishers = topN(pubs, 8);
  result.publisherCoverage = seen > 0 ? named / seen : null;
  return result;
}

// data.gov.in state DMS portals (karnataka/tn/smartcities)
const DMS_PAGE = 1000;
const DMS_PAGE_CAP = 40;

async function fetchDataGovInDms(portal, opts, result) {
  let host;
  try { host = new URL(portal.baseUrl).host; } catch { host = portal.baseUrl; }
  const listUrl = (limit, offset) =>
    `https://${host}/backend/dmspublic/v1/resources` +
    `?filters%5Bdomain%5D=${encodeURIComponent(host)}&limit=${limit}&offset=${offset}`;

  await fetchByPath(listUrl(1, 0), 'total', 'data.gov.in DMS', result);

  // Each resource names its publishing body in `cdos_state_ministry` (an array
  // of one). No facet, so tally by walking — cheap here because this API honours
  // a limit of 1000, unlike data.gov.sg's fixed 10.
  const tally = {};
  let seen = 0;
  let named = 0;

  for (let page = 0; page < DMS_PAGE_CAP; page += 1) {
    const { json, note } = await fetchJson(listUrl(DMS_PAGE, page * DMS_PAGE), {
      timeoutMs: ARCGIS_TIMEOUT_MS,
    });
    if (note) {
      result.notes.push(`data.gov.in DMS publishers: ${note}`);
      break;
    }
    const rows = json && json.data && Array.isArray(json.data.rows) ? json.data.rows : [];
    if (rows.length === 0) break;

    for (const row of rows) {
      seen += 1;
      const field = row && row.cdos_state_ministry;
      const raw = Array.isArray(field) ? field[0] : field;
      const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
      if (!name) continue;
      named += 1;
      tally[name] = (tally[name] || 0) + 1;
    }

    if (rows.length < DMS_PAGE) break;
    if (typeof result.count === 'number' && seen >= result.count) break;
    await sleep(150);
  }

  const pubs = Object.entries(tally).map(([name, count]) => ({ name, count }));
  if (pubs.length) result.publishers = topN(pubs, 8);
  result.publisherCoverage = seen > 0 ? named / seen : null;
  if (seen > 0 && named < seen) {
    result.notes.push(`data.gov.in DMS publishers: ${named} of ${seen} resources named a ministry`);
  }
  return result;
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
