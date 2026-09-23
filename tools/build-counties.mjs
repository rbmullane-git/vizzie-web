// build-counties.mjs
// Renders /geography/us-county/<slug>/ from tools/data/county-facts.json.
//
// seo-plan.md §8.6 forbids a page per area, with one exception: "gate them on
// substance — a minimum number of real indicators and a real map — and start
// with a few hundred suburb/LGA rollups, measured, before considering more."
// GATE below is that sentence made executable. A county that fails any clause
// is SKIPPED and reported; the estate is allowed to have holes in it. Filling
// one with a templated paragraph is the exact pattern the policy punishes, and
// the punishment is site-wide.
//
// No network. Run fetch-county-facts.mjs first if the facts are stale.
//
// Usage:  node tools/build-counties.mjs [slug ...]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderCountyPage } from './render-county.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dir, '..');
const FACTS = join(__dir, 'data', 'county-facts.json');
// Share tokens minted by publish-county-projects.mjs. Absent until that has
// run, and a county without one renders the plain studio link rather than a
// dead `#view=`.
const TOKENS = join(__dir, 'data', 'county-tokens.json');

const MIN_INDICATORS = 6;
const MIN_JOIN_RATE = 0.95;
const MIN_EDITORIAL_WORDS = 150;

// The hand-written half. Everything numeric is read from the facts file, so
// these strings never need touching when ACS re-releases — and writing them is
// deliberately the bottleneck. 150 words of something true and particular about
// a place is what separates this from 3,234 templated stubs; if it cannot be
// written, the county does not get a page.
//
// EDITORIAL RULE — describe the pattern, never explain its cause. State what
// the data shows and how it was measured; do not reach for the reason behind
// it. American income geography runs back through redlining and a century of
// housing policy, and a generated page cannot carry that argument responsibly
// — it would be asserting causation the ACS tables do not contain, on a page
// nobody reviewed. The evidence is the whole contribution: a measured ratio, a
// correlation, a boundary-side coverage rate. Readers who want the cause are
// better served by the map than by our guess at it.
const EDITORIAL = {
  'travis-county-tx': {
    intro:
      `Texas's capital county, and a place whose county-level averages hide more than they show. ` +
      `The tract map below is the reason to look underneath them.`,
    heading: 'What the tract map shows',
    body: `
      <p>Travis County added <b>244,000 people in a decade</b> — a 23% rise between the 2013 and 2023
         American Community Surveys. Median household income is $97,169, around $21,000 above both
         the Texas and the national figure. On the county-level measures it is prosperous and
         fast-growing, and the comparison table above says nothing more than that.</p>
      <p>The tract map says what the table cannot. Sort the county's 286 valued tracts into five
         equal groups by income and <b>the top fifth averages $184,323 against $53,743 in the
         bottom fifth</b> — a ratio of 3.4 to 1 inside a single administrative boundary. The pattern is
         geographic, not scattered: income falls as you move east across the county (a correlation
         of −0.40 between a tract's longitude and its median income), so the large western tracts
         sit in the top classes while the dense central and eastern ones sit two and three classes
         below.</p>
      <p>Home ownership runs at 53% against 65% nationally, despite the higher income — the other
         half of the same story, a county where earning well and owning have come apart. Just 1.7%
         of commuters travel by public transport.</p>`,
  },

  'santa-clara-county-ca': {
    intro:
      `The highest median household income of the forty most populous US counties — and, less ` +
      `obviously, one of the narrowest internal spreads.`,
    heading: 'What the tract map shows',
    body: `
      <p>Median household income is <b>$159,674</b>, some $81,000 above the national figure and
         $63,000 above California's. That is the highest of the forty counties in this set.</p>
      <p>The spread inside the county is narrow by comparison. Sort its 408 tracts into five equal
         groups by income and the top fifth averages $242,341 against $89,823 in the bottom fifth —
         <b>2.7 to 1</b>, the seventh-narrowest of the forty. The floor is the unusual part: this
         county's poorest fifth of tracts averages more than the median household of 24 of the
         other counties here.</p>
      <p>It is also one of only two counties in the set whose map carries no hatching at all —
         every one of the 408 tracts is inhabited and every one has a published median. Income
         rises to the west, though only moderately: a correlation of −0.38 between a tract's
         longitude and its median. Home ownership runs at 55% against 65% nationally, and 2.7% of
         commuters travel by public transport.</p>`,
  },

  'wayne-county-mi': {
    intro:
      `Detroit's county, and one of only four in this set whose population fell over the decade.`,
    heading: 'What the tract map shows',
    body: `
      <p>Wayne County lost <b>30,740 people</b> between the 2013 and 2023 American Community
         Surveys — a 1.7% decline, the second-steepest of the forty counties here, behind Cuyahoga.
         Median household income is $59,521, around $19,000 below the national figure and
         thirty-ninth of forty.</p>
      <p>The tract map shows a county pulled wide. Its top fifth of tracts averages $116,354
         against $27,551 in the bottom fifth — <b>4.2 to 1</b>, the third-widest spread in the set
         — and income rises to the west, a correlation of −0.40 between a tract's longitude and its
         median.</p>
      <p>Thirty-nine of its 625 tracts have no occupied households at all, the most of any county
         here and more than Los Angeles, which holds four times as many tracts. Home ownership is
         64%, within a point of the national rate, the median age of 37.8 sits just under the
         national 38.7, and 2.2% of commuters travel by public transport. Eighteen further tracts
         have households but too few for a published median, so 568 of the 586 inhabited tracts
         carry a value.</p>`,
  },

  'new-york-county-ny': {
    intro:
      `Manhattan holds the widest internal income gap of the forty most populous US counties, and ` +
      `its county-level figures give no sign of it.`,
    heading: 'What the tract map shows',
    body: `
      <p>Median household income is $104,553 — comfortably above the national figure, and tenth of
         the forty counties in this set. That single number conceals the largest spread any of them
         contains.</p>
      <p>Sort Manhattan's 310 tracts into five equal groups by income and the top fifth averages
         <b>$213,685 against $39,071 in the bottom fifth — 5.5 to 1</b>, the widest here. The
         bottom-fifth figure sits below the median household income of every one of the forty
         counties, including the poorest of them. Income rises to the west: a correlation of −0.48
         between a tract's longitude and its median, the fourth-strongest gradient in the set.</p>
      <p>Two further measures put it at the edges. 25% of households own their home, against 65%
         nationally, and 45.5% of commuters travel by public transport. Nine tracts have no
         occupied households and four more have too few for the survey to publish a median,
         leaving 297 of the 301 inhabited tracts with a value on the map above.</p>`,
  },

  'bronx-county-ny': {
    intro:
      `The lowest median household income of the forty most populous US counties, the lowest home ` +
      `ownership, and the highest share of commuters on public transport.`,
    heading: 'What the tract map shows',
    body: `
      <p>Median household income in the Bronx is <b>$49,036</b> — $29,500 below the national figure
         and the lowest of the forty counties in this set. Home ownership is 20%, also the lowest.
         <b>53.7% of commuters travel by public transport</b>, the highest here and the only county
         in the set where more than half do.</p>
      <p>Inside the county the spread is 3.8 to 1: the top fifth of tracts averages $99,613 against
         $26,174 in the bottom fifth. The gradient runs opposite to most of the set — income rises
         to the <b>east</b>, a correlation of +0.43 with longitude, one of only six counties here
         where it runs that way.</p>
      <p>Sixteen of the Bronx's 361 tracts have no occupied households — parks, water and
         institutional land — and eleven more have households but too few for the survey to publish
         a median safely. Both are hatched on the map above, which leaves 334 of the 345 inhabited
         tracts carrying a value.</p>`,
  },

  'nassau-county-ny': {
    intro:
      `The flattest county in this set: the narrowest income spread but one, and the highest home ` +
      `ownership of the forty.`,
    heading: 'What the tract map shows',
    body: `
      <p>Nassau County's median household income is $143,408, third of the forty counties here and
         some $65,000 above the national figure. What distinguishes it is not the level but the
         evenness.</p>
      <p>Its top fifth of tracts averages $215,362 against $94,620 in the bottom fifth — <b>2.3 to
         1</b>, the second-narrowest spread in the set. The bottom fifth alone out-earns the median
         household of 24 of these forty counties. <b>82% of households own their home</b>, the
         highest here against a national rate of 65%, and the median age of 41.8 is the
         second-oldest.</p>
      <p>The map is correspondingly unstructured. The strongest spatial gradient runs north–south
         rather than east–west, and it is weak: a correlation of 0.21 between a tract's latitude
         and its median income, twenty-seventh of forty for strength — there is no strong side of this county.
         13.0% of commuters travel by public transport, sixth of the forty. Coverage is all but
         complete: two of its 281 tracts have no occupied households and one more is too small for
         a published median, leaving 278 of 279 inhabited tracts with a value.</p>`,
  },

  'wake-county-nc': {
    intro:
      `The fastest-growing of the forty most populous US counties, and among the least served by ` +
      `public transport.`,
    heading: 'What the tract map shows',
    body: `
      <p>Wake County added <b>221,795 people</b> between the 2013 and 2023 American Community
         Surveys — a 23.9% rise, the fastest of the forty counties in this set. Median household
         income is $101,763, around $23,000 above the national figure and twelfth of the forty,
         and the median age of 37.2 runs a year and a half below the national 38.7.</p>
      <p>Almost none of that movement travels by transit: <b>0.7% of commuters</b> do,
         thirty-eighth of forty. Home ownership is 64%, within a point of the national rate.</p>
      <p>The tract map is moderately graded. The top fifth of its 230 tracts averages $171,683
         against $56,612 in the bottom fifth — 3.0 to 1, close to the middle of the set — and
         income rises to the west, a correlation of −0.35 with longitude. Coverage is near
         complete: one tract has no occupied households and one more is too small for the survey to
         publish a median, leaving 228 of the 229 inhabited tracts with a value.</p>`,
  },
};

/** §8.6's conditions, one clause each. Returns the reasons a county fails. */
function gate(facts, editorial) {
  const fail = [];
  if (!editorial) return ['no editorial copy — add it to build-counties.mjs'];

  const populated = Object.values(facts.indicators).filter((v) => v !== null && v !== undefined).length;
  if (populated < MIN_INDICATORS) fail.push(`only ${populated} populated indicators (need ${MIN_INDICATORS})`);

  // Measured over INHABITED tracts. A tract with no occupied households cannot
  // have a median household income at all, so counting it as a miss measures the
  // wrong thing — on the first 40-county run that wrongly failed Wayne, Bronx,
  // Queens and Philadelphia, whose maps were correct. This clause is still the
  // India lesson: it exists to catch data that SHOULD have joined and did not.
  if (!facts.tracts.count) fail.push('no tract boundaries held');
  else if (facts.tracts.joinRate < MIN_JOIN_RATE) {
    fail.push(`join rate ${(facts.tracts.joinRate * 100).toFixed(1)}% of inhabited tracts (need ${MIN_JOIN_RATE * 100}%)`);
  }
  // A classification needs somewhere to cut. One value repeated across every
  // tract produces no breaks and a single flat colour, which is not a map.
  if (!facts.tracts.breaks?.length) fail.push('no usable class breaks — the choropleth would be one flat colour');

  if (facts.indicators.populationPrev === null) fail.push('only one vintage — nothing to show change against');

  if (!facts.provenance?.attribution) fail.push('no attribution line');
  if (!facts.provenance?.licence) fail.push('no licence');

  const words = editorial.body.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).length;
  if (words < MIN_EDITORIAL_WORDS) fail.push(`editorial is ${words} words (need ${MIN_EDITORIAL_WORDS})`);

  return fail;
}

const facts = JSON.parse(readFileSync(FACTS, 'utf8'));
const tokens = existsSync(TOKENS) ? JSON.parse(readFileSync(TOKENS, 'utf8')) : {};
const wanted = process.argv.slice(2);
const slugs = wanted.length ? wanted : Object.keys(facts.counties);

const ctx = {
  siteUrl: 'https://www.vizzie.org',
  appUrl: 'https://app.vizzie.org',
  generatedDate: facts.generatedAt,
};

let built = 0;
const skipped = [];
for (const slug of slugs) {
  const f = facts.counties[slug];
  if (!f) { skipped.push(`${slug}: no facts — run fetch-county-facts.mjs`); continue; }
  const reasons = gate(f, EDITORIAL[slug]);
  if (reasons.length) { skipped.push(`${slug}: ${reasons.join('; ')}`); continue; }

  const html = renderCountyPage(f, EDITORIAL[slug], { ...ctx, viewToken: tokens[slug] });
  const dir = join(WEB, 'geography', 'us-county', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
  built++;
  process.stderr.write(`wrote geography/us-county/${slug}/index.html (${(html.length / 1024).toFixed(0)} KB)\n`);
}

process.stderr.write(`\n${built} built, ${skipped.length} skipped\n`);
for (const s of skipped) process.stderr.write(`  SKIP ${s}\n`);
