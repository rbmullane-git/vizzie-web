/**
 * build-ejscreen-page.mjs — render /ejscreen/.
 *
 * A topic page for EPA's Environmental Justice Screening tool, which EPA
 * removed from its website on 5 February 2025 and shut down that March. The
 * data is a US federal government work and never left the public domain, so
 * the page's job is to say where it went and hand back a working map of it.
 *
 * EVERY FIGURE ABOUT OUR OWN FILES IS MEASURED, NOT TYPED. Row counts, file
 * sizes and the California score distribution are read out of the CSVs in
 * data/ejscreen/, and the three map cards read their titles and blurbs from the
 * app's own example JSON. That is the portal-facts.mjs rule: five surfaces once
 * drifted to a stale "170 portals / 28 countries" because each kept its own
 * copy of the number.
 *
 * Two figures cannot be measured from anything in this repo and are declared in
 * EXTERNAL below, with their provenance: the national tract count, and the row
 * count of the mislabelled ArcGIS mirrors. Both were verified on 22 Sep 2026.
 *
 * Usage:  node tools/build-ejscreen-page.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  esc,
  styleBlock,
  headerBlock,
  footerBlock,
  appScript,
  analyticsBlock,
} from './render-portal.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dir, '..');
const DATA_DIR = join(WEB, 'data', 'ejscreen');
// The app repo, same as build-portals.mjs reads for its example cards.
const EXAMPLES_DIR = '/Users/rich/vizzie/src/examples/data';

const SITE = 'https://www.vizzie.org';
const APP = 'https://app.vizzie.org';
const OUT = join(WEB, 'ejscreen');

const STATES = [
  { code: 'ca', slug: 'ejscreen-ca', name: 'California' },
  { code: 'tx', slug: 'ejscreen-tx', name: 'Texas' },
  { code: 'ny', slug: 'ejscreen-ny', name: 'New York' },
];

// Facts about things outside this repo, so nothing here can measure them.
const EXTERNAL = {
  // Rows in EJScreen's national tract file (Harvard Dataverse datafile 10775979),
  // less the 686 territory rows that have no Census tract boundary.
  nationalTracts: 85396,
  // Rows in the PEDP ArcGIS services named "...CensusTracts" and
  // "...BlockGroups". Both return this count, and both carry 12-digit ids —
  // i.e. both are block groups, whatever the first one is called.
  mirrorBlockGroups: 243022,
};

const num = (n) => Number(n).toLocaleString('en-US');
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

/** Header-less data lines and the score histogram, read from the file itself. */
function readCsv(path) {
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  const header = lines[0].split(',');
  const scoreAt = header.indexOf('EJ indexes above 80th percentile');
  if (scoreAt < 0) throw new Error(`no score column in ${path}`);
  const scores = new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const v = lines[i].split(',')[scoreAt];
    scores.set(v, (scores.get(v) ?? 0) + 1);
  }
  return { rows: lines.length - 1, scores };
}

function loadState(s) {
  const file = `ejscreen-2.32-tracts-${s.code}.csv`;
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) {
    throw new Error(`missing ${path} — run tools/build-ejscreen-extracts.mjs first`);
  }
  const examplePath = join(EXAMPLES_DIR, `${s.slug}.json`);
  if (!existsSync(examplePath)) {
    throw new Error(`missing ${examplePath} — run build-project-examples.mjs in ~/vizzie first`);
  }
  const example = JSON.parse(readFileSync(examplePath, 'utf8'));
  const { rows, scores } = readCsv(path);
  return {
    ...s,
    file,
    rows,
    scores,
    bytes: statSync(path).size,
    title: example.name,
    // The example's description is written for someone standing in front of the
    // map; the first sentence is the part that works as a card.
    blurb: `${String(example.description).split('. ')[1] || ''}.`.trim(),
  };
}

const states = STATES.map(loadState);
const totalRows = states.reduce((n, s) => n + s.rows, 0);

// The concentration claim in the prose, measured rather than asserted: how many
// California tracts score zero, and how many sit at the mode of the upper hump.
const ca = states.find((s) => s.code === 'ca');
const caZero = ca.scores.get('0') ?? 0;
const [caPeakScore, caPeakCount] = [...ca.scores.entries()]
  .filter(([k]) => Number(k) >= 8)
  .sort((a, b) => b[1] - a[1])[0];
const SPELT = { 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve', 13: 'thirteen' };

const title =
  'EJScreen after EPA took it down — the data, mapped again | Vizzie';
const description =
  `EPA removed EJScreen in February 2025. The data is US public domain and survives. ` +
  `${num(totalRows)} census tracts across California, Texas and New York, on a live map ` +
  `you can open in a browser, plus the CSVs to download.`;

// Dataset schema: Google Dataset Search indexes it, which is free distribution
// on exactly the "ejscreen download" queries this page is for.
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Dataset',
      name: 'EJScreen 2.32 — census tract extracts (California, Texas, New York)',
      description,
      url: `${SITE}/ejscreen/`,
      license: 'https://resources.data.gov/open-licenses/',
      creator: {
        '@type': 'GovernmentOrganization',
        name: 'U.S. Environmental Protection Agency',
      },
      isBasedOn: 'https://doi.org/10.7910/DVN/RLR5AX',
      spatialCoverage: 'United States',
      temporalCoverage: '2024',
      isAccessibleForFree: true,
      keywords: [
        'EJScreen', 'EJScreen download', 'environmental justice', 'EPA',
        'census tract', 'environmental justice index', 'EJScreen alternative',
        'environmental justice map',
      ],
      distribution: states.map((s) => ({
        '@type': 'DataDownload',
        name: `EJScreen 2.32 — ${s.name} census tracts`,
        encodingFormat: 'text/csv',
        contentUrl: `${SITE}/data/ejscreen/${s.file}`,
        contentSize: String(s.bytes),
      })),
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Vizzie', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'EJScreen', item: `${SITE}/ejscreen/` },
      ],
    },
  ],
};

const cards = states
  .map(
    (s) => `<a class="card example" data-app="/#example=${esc(s.slug)}" style="text-decoration:none;color:inherit;display:flex;flex-direction:column">
            <h3>${esc(s.name)}</h3>
            <p>${esc(s.blurb)}</p>
            <p class="meta">${num(s.rows)} census tracts</p>
            <span class="openlink">Open the live map →</span>
          </a>`,
  )
  .join('\n          ');

const downloads = states
  .map(
    (s) => `<tr>
        <td><a href="/data/ejscreen/${esc(s.file)}" download>${esc(s.file)}</a></td>
        <td>${num(s.rows)} tracts</td>
        <td>${mb(s.bytes)}</td>
      </tr>`,
  )
  .join('\n      ');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${SITE}/ejscreen/" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${SITE}/ejscreen/" />
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
${styleBlock()}
<style>
  main p { max-width: 720px; margin-bottom: 14px; }
  main h2 { margin-top: 44px; }
  main h2 + p, main h2 + table, main h2 + .grid { margin-top: 14px; }
  .card.example .meta { color: var(--muted); font-size: 14px; margin: 6px 0 0; }
  .card.example .openlink { margin-top: auto; padding-top: 12px; color: var(--brand); font-weight: 600; }
  table.dl { border-collapse: collapse; margin: 14px 0 6px; width: 100%; max-width: 560px; }
  table.dl td { border-bottom: 1px solid var(--line); padding: 10px 14px 10px 0; }
  table.dl td:first-child { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  code { background: rgba(255,255,255,0.06); padding: 0 3px; border-radius: 4px; font-size: 0.92em; }
  .prov { color: var(--muted); font-size: 14px; border-top: 1px solid var(--line); padding-top: 16px; margin-top: 44px; max-width: 720px; }
  .note { border-left: 2px solid var(--brand); padding: 4px 0 4px 16px; margin: 22px 0; }
</style>
</head>
<body>
${headerBlock()}
<main class="wrap" style="padding-top:44px;padding-bottom:64px">
  <p class="kicker">Public data, still public</p>
  <h1>EJScreen, after EPA took it down</h1>
  <p class="lead">EPA removed its Environmental Justice Screening and Mapping tool on
     5 February 2025, and shut it down the following month. The tool is gone. The data is
     not — it is a US federal government work, it was never in copyright, and it is still
     downloadable. Here it is on a map again.</p>

  <div class="grid g3" style="margin-top:32px">
          ${cards}
  </div>

  <h2>What the colour means</h2>
  <p>EJScreen combines thirteen environmental indicators — particulate matter, ozone, diesel
     particulates, traffic proximity, lead paint, proximity to Superfund, risk-management-plan
     and hazardous-waste sites, wastewater discharge, nitrogen dioxide, drinking water and
     underground storage tanks — with a demographic index, and reports where each census tract
     sits against the rest of the country.</p>
  <p>These maps colour each tract by <b>how many of the thirteen it lands in the national top
     20% for</b>: a single number from 0 to 13. It is a blunt measure and a legible one. The
     pattern it shows is concentration — in California ${num(caZero)} tracts score zero while
     ${num(caPeakCount)} score ${SPELT[caPeakScore] ?? caPeakScore}. Burden stacks up in
     particular places rather than spreading out.</p>

  <div class="note">
    <p style="margin:0">Every indicator keeps EPA's own field name — <code>PM25</code>,
       <code>DSLPM</code>, <code>PTRAF</code>, <code>P_DEMOGIDX_2</code> — so the EJScreen
       technical documentation still describes the columns you are looking at.</p>
  </div>

  <h2>Where this copy comes from</h2>
  <p>EPA's own service stopped answering. The archival copy used here is the
     <a href="https://doi.org/10.7910/DVN/RLR5AX" rel="noopener">Harvard Dataverse deposit</a>
     made by the Public Environmental Data Partners after the shutdown — specifically the
     tract-level file with US-relative percentiles from the 2024 release, version 2.32.</p>
  <p>Several ArcGIS mirrors of EJScreen are also circulating. They are worth knowing about and
     worth checking: two of the most visible ones are labelled as census tracts but actually
     contain ${num(EXTERNAL.mirrorBlockGroups)} <em>block groups</em>, and the one genuine tract service carries
     state-relative rather than national percentiles. Percentiles that compare a tract to its
     own state answer a different question from percentiles that compare it to the country.</p>

  <h2>Download the data</h2>
  <p>Plain CSV, one row per census tract, 35 columns. The join key is <code>GEOID</code>, the
     standard 11-digit census tract identifier — the leading zero matters
     (California is <code>06</code>).</p>
  <table class="dl">
      ${downloads}
  </table>
  <p>Cut per state rather than shipped as one national file, because the national tract table
     runs to ${num(EXTERNAL.nationalTracts)} rows and would quietly truncate on load. If you want a state that
     is not here, <a href="mailto:hello@vizzie.org">ask</a> — it is a one-line change.</p>

  <h2>Map your own data against it</h2>
  <p>These tracts are the same boundaries Vizzie joins any tract-keyed spreadsheet to, so a
     CSV of your own — sites, facilities, case counts, service locations — lands on the same
     map as the EJScreen layer. See
     <a href="/geography/us-tract/">US census tracts</a> for how the codes are built and what
     they roll up into.</p>
  <p><a class="btn" data-app="/">Open Vizzie</a>
     <a class="btn ghost" data-app="/#example=ejscreen-ca">Open the California map</a></p>

  <p class="prov">
    EJScreen version 2.32 (2024) — U.S. Environmental Protection Agency. US Government
    public domain (17 U.S.C. §105); attributed here as good practice rather than obligation.
    Archived copy: Harvard Dataverse <code>doi:10.7910/DVN/RLR5AX</code>, retrieved
    22 September 2026. Tract boundaries: U.S. Census Bureau 2020 cartographic boundary files.
    Vizzie is not affiliated with EPA.
  </p>
</main>
${footerBlock({ siteUrl: SITE, appUrl: APP })}
${appScript({ appUrl: APP })}
${analyticsBlock()}
</body>
</html>`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'index.html'), html);
process.stderr.write(
  `wrote ejscreen/index.html (${(html.length / 1024).toFixed(0)} KB) — ` +
    `${states.map((s) => `${s.name} ${num(s.rows)}`).join(', ')}\n`,
);
