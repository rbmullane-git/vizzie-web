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
