/**
 * build-landing.mjs — generate the paid-test landing pages.
 *
 * Two pages, ONE template. That is the whole point: the campaign brief
 * (Research_Influencers/paid-test-campaign-brief.md) tests exactly one variable
 * — the promise in the <h1> — and hand-maintaining two near-identical files is
 * how that variable quietly becomes three. Everything except `h1`, `title` and
 * `description` is shared code here, so the pages cannot drift.
 *
 * Usage:
 *   node tools/build-landing.mjs           # write ../lp/<slug>/index.html
 *   node tools/build-landing.mjs --check   # non-zero exit if output is stale
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  esc,
  styleBlock,
  footerBlock,
  analyticsBlock,
} from './render-portal.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dir, '..');
const SITE = 'https://www.vizzie.org';
const APP = 'https://app.vizzie.org';

/**
 * The only thing that differs between the two pages.
 *
 * `h1` is raw HTML because the coloured span is part of the design, and it is
 * the one field allowed to diverge. `slug` becomes the URL and the value of
 * `utm_content`, so the PostHog breakdown reads `variant-a` / `variant-b`
 * without any manual tagging.
 */
const VARIANTS = [
  {
    slug: 'variant-a',
    label: 'stem-led',
    // The line live on the homepage since 2 Sep, per the 3 Sep tagline decision.
    h1: `Unlocking the power of public data <br /><span class="accent">for better cities</span>`,
    title: 'Vizzie — Unlocking the power of public data for better cities',
    description:
      "Map and analyse the world's open data in your browser. Nothing to download, no GIS specialist required.",
  },
  {
    slug: 'variant-b',
    label: 'category-led',
    // The only line that has ever won a head-to-head: 33% in the July survey.
    h1: `The Map Studio <br /><span class="accent">for all</span>`,
    title: 'Vizzie — The Map Studio for all',
    description:
      "Map and analyse the world's open data in your browser. Nothing to download, no GIS specialist required.",
  },
];

/**
 * Everything below is IDENTICAL across variants, by construction.
 * If you are tempted to vary one of these per variant, you are adding a second
 * variable to a test sized for one — see §2 of the campaign brief.
 */
const SHARED = {
  lead: `Vizzie is an easy-to-use mapping and analytics platform that connects you to
         the world's open data. There's nothing to download, and you don't need a GIS
         specialist to build beautiful maps, charts, and data stories.`,
  primaryCta: 'Start free',
  secondaryCta: 'Explore a live map first',
  // A real map of a real place, above the fold — not a product screenshot.
  heroImage: '/og-vancouver-street-trees.png',
  heroImageAlt:
    'Vizzie mapping 150,000 Vancouver street trees in 3D, extruded by height and coloured by species, with charts alongside',
  proof: [
    {
      h: 'Nothing to download',
      p: `Connect straight to 170+ open data portals across 28 countries and pull a dataset
          onto a map in a couple of clicks. No shapefiles, no ETL, no waiting on a data team.`,
    },
    {
      h: 'No GIS specialist needed',
      p: `Joins, choropleths, 3D extrusion and catchments without a single line of code —
          and without the week of training a traditional GIS package assumes.`,
    },
    {
      h: 'Client-ready, not screenshot-ready',
      p: `Publish an interactive map on its own link, or drop a finished graphic into a
          report — without the detour through Illustrator and PowerPoint.`,
    },
  ],
};

/**
 * Link resolver + UTM forwarding.
 *
 * Two things here are easy to get wrong and both silently break attribution:
 *
 *  1. **The query string must come BEFORE the hash.** The studio routes on the
 *     hash (`#signup`), and `attribution.ts` reads `window.location.search` —
 *     so `app.vizzie.org/#signup?utm_source=…` would drop every parameter.
 *     Built here as `app.vizzie.org/?utm_source=…#signup`.
 *  2. **Forward the REAL incoming parameters**, rather than hard-coding them.
 *     Google appends `gclid` and whatever else the campaign carries; copying the
 *     live query string preserves all of it. `utm_content` is added only if the
 *     ad did not already set it, so the variant is always identifiable.
 *
 * The cross-subdomain cookie already carries first-touch attribution to the app,
 * so this is belt-and-braces — it keeps the test measurable for anyone whose
 * cookies are blocked.
 */
function appScriptWithUtm(slug) {
  return `<script>
      var APP_URL = ${JSON.stringify(APP)};
      var VARIANT = ${JSON.stringify(slug)};
      (function () {
        var params = new URLSearchParams(window.location.search);
        if (!params.get("utm_content")) params.set("utm_content", VARIANT);
        var qs = params.toString();
        document.querySelectorAll("[data-app]").forEach(function (a) {
          var target = a.getAttribute("data-app") || "/";
          var hash = "";
          var cut = target.indexOf("#");
          if (cut !== -1) { hash = target.slice(cut); target = target.slice(0, cut); }
          if (!target) target = "/";
          a.setAttribute("href", APP_URL + target + (qs ? "?" + qs : "") + hash);
        });
      })();
    </script>`;
}

function render(v) {
  const canonical = `${SITE}/lp/${v.slug}/`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(v.title)}</title>
    <meta name="description" content="${esc(v.description)}" />
    <link rel="canonical" href="${esc(canonical)}" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />

    <!-- Ad destination, not a search result. Indexing these would let two
         competing promises rank against the homepage and against each other,
         and would pollute the CTR the test is measured on with organic traffic. -->
    <meta name="robots" content="noindex,nofollow" />

    <meta property="og:title" content="${esc(v.title)}" />
    <meta property="og:description" content="${esc(v.description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${esc(canonical)}" />
    <meta property="og:site_name" content="Vizzie" />
    <meta property="og:image" content="${SITE}${SHARED.heroImage}" />
    <meta property="og:image:alt" content="${esc(SHARED.heroImageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />

    ${styleBlock()}
    <style>
      /* Landing-page-only additions. The design system comes from styleBlock so
         these pages look like the product, not like an ad. */
      .accent { color: var(--green); }
      .lp-hero { padding: 72px 0 56px; border-bottom: 1px solid var(--line); }
      .lp-hero h1 { max-width: 900px; }
      .lp-hero .lead { margin-top: 20px; }
      .lp-hero .cta-row { margin-top: 28px; display: flex; gap: 12px; flex-wrap: wrap; }
      .lp-note { margin-top: 18px; font-size: 14px; color: var(--faint); }
      .lp-note b { color: var(--green); }
      .lp-shot { width: 100%; height: auto; margin-top: 44px; border-radius: 14px;
                 border: 1px solid var(--line); box-shadow: 0 18px 60px rgba(0,0,0,.45); }
      .lp-proof { padding: 72px 0; }
      .lp-grid { display: grid; gap: 20px; grid-template-columns: repeat(3, 1fr); }
      .lp-final { padding: 72px 0; text-align: center; }
      .lp-final h2 { font-size: 30px; font-weight: 800; letter-spacing: -0.01em; }
      .lp-final .cta-row { margin-top: 24px; display: flex; justify-content: center; gap: 12px; }
      @media (max-width: 860px) { .lp-grid { grid-template-columns: 1fr; } }
    </style>
    ${analyticsBlock()}
  </head>
  <body>
    <!-- Deliberately minimal: brand and one action. A landing page with the full
         site nav leaks the traffic you just paid for. -->
    <header class="site">
      <div class="wrap">
        <span class="brand" style="display:flex;align-items:center;gap:8px">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <polygon points="12,2 22,7 12,12 2,7" fill="#22C55E" />
            <polyline points="2,12 12,17 22,12" stroke="#22C55E" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".65" />
            <polyline points="2,17 12,22 22,17" stroke="#22C55E" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".4" />
          </svg>
          <span class="word">Vizzie</span><span class="beta">beta</span>
        </span>
        <a class="btn" data-app="/#signup">${esc(SHARED.primaryCta)}</a>
      </div>
    </header>

    <section class="lp-hero">
      <div class="wrap">
        <h1>${v.h1}</h1>
        <p class="lead">${esc(SHARED.lead.replace(/\s+/g, ' ').trim())}</p>
        <div class="cta-row">
          <a class="btn" data-app="/#signup">${esc(SHARED.primaryCta)}</a>
          <a class="btn ghost" data-app="/#example=vancouver-street-trees">${esc(SHARED.secondaryCta)}</a>
        </div>
        <p class="lp-note">
          <b>Free while in beta.</b> No credit card. The example opens with no sign-up at all.
        </p>
        <img class="lp-shot" src="${SHARED.heroImage}" alt="${esc(SHARED.heroImageAlt)}"
             width="1200" height="630" />
      </div>
    </section>

    <section class="lp-proof">
      <div class="wrap">
        <div class="lp-grid">
          ${SHARED.proof
            .map(
              (c) => `<div class="card">
            <h3>${esc(c.h)}</h3>
            <p>${esc(c.p.replace(/\s+/g, ' ').trim())}</p>
          </div>`,
            )
            .join('\n          ')}
        </div>
      </div>
    </section>

    <section class="lp-final">
      <div class="wrap">
        <h2>Put your first map on the screen in ten minutes.</h2>
        <div class="cta-row">
          <a class="btn" data-app="/#signup">${esc(SHARED.primaryCta)}</a>
        </div>
      </div>
    </section>

    ${footerBlock()}
    ${appScriptWithUtm(v.slug)}
  </body>
</html>
`;
}

const check = process.argv.includes('--check');
let stale = 0;
for (const v of VARIANTS) {
  const dir = join(WEB, 'lp', v.slug);
  const file = join(dir, 'index.html');
  const html = render(v);
  if (check) {
    const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (current !== html) {
      console.error(`STALE  lp/${v.slug}/index.html`);
      stale++;
    } else {
      console.log(`ok     lp/${v.slug}/index.html`);
    }
    continue;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, html);
  console.log(`wrote  lp/${v.slug}/index.html   (${v.label})`);
}
if (check && stale) process.exit(1);
