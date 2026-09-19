// build-geography.mjs
// Renders /geography/<slug>/ from tools/data/geography-facts.json.
//
// Every number on these pages comes from that file, which is written by
// fetch-geography-facts.mjs straight out of the connector database. The prose
// below is the only hand-written part, and it is the part a database cannot
// supply: what the geography IS, and what its codes mean.
//
// No network. Run fetch-geography-facts.mjs first if the facts are stale.
//
// Usage:  node tools/build-geography.mjs [slug ...]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderGeographyPage } from './render-geography.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dir, '..');
const FACTS = join(__dir, 'data', 'geography-facts.json');

// The editorial half. One entry per page; everything numeric is read from the
// facts file instead, so these strings never need touching when a boundary set
// is re-seeded.
const EDITORIAL = {
  'uk-lsoa': {
    name: 'Lower Layer Super Output Areas',
    abbr: 'LSOA',
    plural: 'LSOAs',
    publisher: 'Office for National Statistics',
    licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
    coverage: 'England and Wales',
    keywords: ['LSOA', 'LSOA boundaries', 'LSOA shapefile', 'census geography', 'England', 'Wales', 'ONS'],
    intro:
      `The standard small-area geography for England and Wales. Almost every neighbourhood statistic ` +
      `the government publishes — deprivation, income, health, census tables — is published against ` +
      `these, which is why a spreadsheet of LSOA codes is the commonest thing an analyst has and the ` +
      `hardest thing to map.`,
    codeFormat: `
      <p>An LSOA code is a letter and eight digits: <code>E01000001</code>. <b>E</b> is England and
         <b>W</b> is Wales; <code>01</code> marks the LSOA layer, and the rest is the identifier. The
         name is the district plus a number and letter, so <code>Hounslow 001A</code> tells you where
         you are without a lookup.</p>
      <p>Because the code starts with a letter, it survives a spreadsheet. Numeric area codes do not —
         Excel strips the leading zero from an <code>01001</code> and the join silently misses. That
         failure mode is worth knowing about; it just is not this geography's.</p>`,
    rollup: [
      'Output Area (OA) — the smallest, about 125 households',
      'Lower Layer Super Output Area (LSOA) — about 1,500 people',
      'Middle Layer Super Output Area (MSOA) — about 7,200 people',
      'Local Authority District (LAD)',
      'Region, then country',
    ],
    rollupIndex: 1,
    vintages: `
      <p>LSOAs are redrawn with each census — 2001, 2011 and 2021 — and they are deliberately stable
         in between, which is what makes them usable for a time series. The 2021 revision only
         touched areas where population had moved enough to push them outside the target range:
         most codes carry straight over, but a minority were split, merged or renumbered, so a
         2011-coded dataset will not join cleanly to 2021 boundaries everywhere.</p>
      <p>Vizzie holds the 2021 set. A dataset published against 2011 boundaries will report a
         partial match rate rather than pretending — the unmatched codes are the ones that changed.</p>`,
  },

  'us-tract': {
    name: 'Census Tracts',
    abbr: 'tract',
    plural: 'census tracts',
    publisher: 'US Census Bureau',
    licenceUrl: 'https://www.census.gov/about/policies/open-gov/open-data.html',
    coverage: 'All 50 states, the District of Columbia and Puerto Rico',
    keywords: ['census tract', 'census tract boundaries', 'tract shapefile', 'GEOID', 'FIPS', 'American Community Survey', 'US Census'],
    intro:
      `The neighbourhood unit of American statistics. The American Community Survey, the decennial ` +
      `census and most federal programme data are published against these, so a column of eleven-digit ` +
      `codes is what an analyst usually has — and a tract map is what they usually cannot make.`,
    codeFormat: `
      <p>A tract GEOID is eleven digits that nest: two for the state, three for the county, six for the
         tract itself. <code>06075010100</code> is California, San Francisco County, tract 101. The
         first five digits are the county FIPS code on its own, which is why a tract file can be split
         by county without a lookup table.</p>
      <p><b>The leading zero is the thing that breaks.</b> Every state below FIPS 10 — Alabama through
         Connecticut, and California at 06 — starts with a zero, and a spreadsheet will silently strip
         it the moment the column is read as a number. <code>06075010100</code> becomes
         <code>6075010100</code>, ten digits that match nothing. If a join comes back near-empty on US
         data, check the width of the codes before anything else.</p>`,
    rollup: [
      'Census block — the smallest unit published',
      'Block group — a few hundred to a few thousand people',
      'Census tract — around 4,000 people, between 1,200 and 8,000',
      'County',
      'State',
    ],
    rollupIndex: 2,
    vintages: `
      <p>Tracts are redrawn for each decennial census. Where population has grown they are split, where
         it has fallen they are merged, and the new pieces get new numbers — so a 2010-coded dataset
         will not join cleanly to 2020 boundaries in exactly the places that changed most, which are
         usually the places being studied.</p>
      <p>Vizzie holds the 2020 set. A dataset published on 2010 tracts reports a partial match rather
         than a silent one: the unmatched codes are the tracts that moved.</p>`,
  },
  'us-county': {
    name: 'Counties and county equivalents',
    abbr: 'county',
    plural: 'counties',
    publisher: 'US Census Bureau',
    licenceUrl: 'https://www.census.gov/about/policies/open-gov/open-data.html',
    coverage: 'All 50 states, the District of Columbia and Puerto Rico',
    keywords: ['county FIPS', 'county boundaries', 'county shapefile', 'county map', 'FIPS code', 'US Census'],
    intro:
      `The unit almost every American dataset can be rolled up to, and the one most likely to be ` +
      `keyed by a five-digit code nobody labelled. Health, labour, agriculture and election data all ` +
      `land here.`,
    codeFormat: `
      <p>Five digits: two for the state, three for the county. <code>06075</code> is San Francisco,
         <code>36061</code> is New York County. The same leading-zero trap as tracts applies and bites
         harder, because a five-digit code looks so much like a number —
         <code>01001</code> (Autauga County, Alabama) becomes <code>1001</code> and matches nothing.</p>
      <p>"County equivalent" is doing real work in the name. Louisiana has parishes, Alaska has
         boroughs and census areas, Virginia has independent cities that sit outside any county, and
         Puerto Rico has municipios. They all carry county-shaped FIPS codes and all appear here.</p>`,
    rollup: [
      'Census tract — around 4,000 people',
      'County or county equivalent',
      'State',
    ],
    rollupIndex: 1,
    vintages: `
      <p>County boundaries are the most stable geography on this site — most have not moved in a
         century. The exceptions are worth knowing: Connecticut replaced its eight counties with nine
         planning regions for statistical purposes, which the Census Bureau adopted from 2022, so
         Connecticut data published either side of that line uses different codes for the same ground.</p>
      <p>Vizzie holds the 2020 set, which is counties for Connecticut.</p>`,
  },
  'uk-lad': {
    name: 'Local Authority Districts',
    abbr: 'LAD',
    plural: 'LADs',
    publisher: 'Office for National Statistics',
    licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
    coverage: 'England, Wales, Scotland and Northern Ireland',
    keywords: ['local authority district', 'LAD boundaries', 'council boundaries', 'local authority map', 'GSS code', 'ONS'],
    intro:
      `The council that actually decides things — planning, licensing, waste, local plans — and the ` +
      `level most UK policy data is published at. Coarser than an LSOA and far more likely to be the ` +
      `unit a client asks about by name.`,
    codeFormat: `
      <p>A nine-character GSS code whose first three characters say what kind of authority it is:
         <code>E06</code> unitary authorities (63 of them), <code>E07</code> non-metropolitan districts
         (164), <code>E08</code> metropolitan boroughs (36), <code>E09</code> London boroughs (33),
         <code>W06</code> Welsh principal areas (22), <code>S12</code> Scottish council areas (32) and
         <code>N09</code> Northern Irish districts (11).</p>
      <p>Names are not keys. There are councils that share a name with the county around them, and
         "Newcastle" alone will not tell you whether you mean Tyne or Lyme. Join on the code.</p>`,
    rollup: [
      'Lower Layer Super Output Area (LSOA) — about 1,500 people',
      'Middle Layer Super Output Area (MSOA) — about 7,200 people',
      'Local Authority District (LAD)',
      'Region, then country',
    ],
    rollupIndex: 2,
    vintages: `
      <p>This is the least stable geography here, because local government keeps being reorganised.
         April 2023 alone replaced the districts of North Yorkshire, Somerset and Cumbria with
         unitaries, retiring their codes. ONS issues a new set most years and the changed areas get new
         codes rather than amended ones, which is deliberate: a code always means one shape.</p>
      <p>Vizzie holds the 2024 set. Older datasets will match everywhere except the places that
         reorganised, and those are usually the ones worth asking about.</p>`,
  },
  'au-sa2': {
    name: 'Statistical Areas Level 2',
    abbr: 'SA2',
    plural: 'SA2s',
    publisher: 'Australian Bureau of Statistics',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    coverage: 'All states and territories',
    keywords: ['SA2', 'SA2 boundaries', 'ASGS', 'statistical area level 2', 'ABS geography', 'Australia census'],
    intro:
      `The ABS designed SA2s to approximate communities that interact socially and economically, which ` +
      `is why they are the level most Australian analysis settles on: small enough to be a suburb, big ` +
      `enough that the census still publishes numbers for it.`,
    codeFormat: `
      <p>Nine digits, nesting upward through the Australian Statistical Geography Standard: the first
         digit is the state or territory, and the rest place the area inside its SA3 and SA4. An SA2
         therefore carries its whole hierarchy in the code — no lookup needed to roll a table up to
         SA4.</p>
      <p>Names repeat across states. There is a Richmond in Victoria, New South Wales and Queensland,
         and the ABS distinguishes them only by code, so a name-keyed join will quietly merge them.</p>`,
    rollup: [
      'Mesh Block — the smallest ABS unit, around 50 dwellings',
      'Statistical Area Level 1 (SA1) — around 400 people',
      'Statistical Area Level 2 (SA2) — 3,000 to 25,000 people',
      'Statistical Area Level 3 (SA3), then Level 4 (SA4)',
      'State or territory',
    ],
    rollupIndex: 2,
    vintages: `
      <p>The ASGS is rebuilt for each census — 2011, 2016 and 2021 — and SA2 codes were renumbered
         between editions, not just added to. A 2016-coded dataset will not join to 2021 boundaries on
         code alone even where the boundary itself did not move.</p>
      <p>Vizzie holds the 2021 edition, the current one.</p>`,
  },
  'eu-nuts3': {
    name: 'NUTS level 3 regions',
    abbr: 'NUTS 3',
    plural: 'NUTS 3 regions',
    publisher: 'Eurostat (GISCO)',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    coverage: 'EU member states, EFTA and candidate countries',
    keywords: ['NUTS', 'NUTS 3', 'NUTS boundaries', 'NUTS shapefile', 'Eurostat regions', 'European regional statistics'],
    intro:
      `Eurostat publishes almost everything regional against NUTS, so a NUTS code is the key to ` +
      `comparable statistics across the whole of Europe — and NUTS 3 is the finest level at which most ` +
      `of it exists.`,
    codeFormat: `
      <p>Five characters: the two-letter country code, then three that narrow it down one level at a
         time. <code>PT150</code> is Portugal, region 1, sub-region 5, NUTS 3 area 0 — so truncating a
         NUTS 3 code to four characters gives its NUTS 2 parent, and to three its NUTS 1. That makes
         aggregation a string operation rather than a join.</p>
      <p>The country prefix is the ISO two-letter code with one long-standing exception: Greece is
         <code>EL</code>, not GR. A join that drops every Greek region has usually met it.</p>`,
    rollup: [
      'Local Administrative Unit (LAU) — municipalities',
      'NUTS 3 — small regions, provinces and their equivalents',
      'NUTS 2 — basic regions for regional policy',
      'NUTS 1 — major socio-economic regions',
      'NUTS 0 — the country',
    ],
    rollupIndex: 1,
    vintages: `
      <p>NUTS is revised roughly every three years — 2013, 2016, 2021 and now 2024 — and revisions
         renumber regions rather than only adding them. Eurostat republishes its own time series on the
         current classification, but a dataset downloaded a few years ago will carry the codes of its
         day.</p>
      <p>Vizzie holds the 2024 edition, the same one the Eurostat connector reads, so statistics pulled
         through Vizzie and boundaries held by Vizzie agree by construction.</p>`,
  },
};

const facts = JSON.parse(readFileSync(FACTS, 'utf8'));
const wanted = process.argv.slice(2);
const slugs = (wanted.length ? wanted : Object.keys(facts.levels)).filter((s) => {
  if (!facts.levels[s]) { console.error(`no facts for ${s} — run fetch-geography-facts.mjs ${s}`); return false; }
  if (!EDITORIAL[s]) { console.error(`no editorial copy for ${s} — add it to build-geography.mjs`); return false; }
  return true;
});
if (!slugs.length) process.exit(1);

const ctx = {
  siteUrl: 'https://www.vizzie.org',
  appUrl: 'https://app.vizzie.org',
  generatedDate: facts.generatedAt,
};

for (const slug of slugs) {
  const html = renderGeographyPage(facts.levels[slug], EDITORIAL[slug], ctx);
  const dir = join(WEB, 'geography', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
  process.stderr.write(`wrote geography/${slug}/index.html (${(html.length / 1024).toFixed(0)} KB)\n`);
}
