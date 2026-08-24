/**
 * build-brand.mjs — generate /brand/, the press and brand-asset page.
 *
 * Reuses the shared chrome from render-portal.mjs so the page is the same dark
 * site, not a lookalike. The assets themselves live in /brand/ and are copied
 * there from the design source; this script only writes the page around them.
 *
 * Usage:  node build-brand.mjs
 */
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  esc,
  styleBlock,
  headerBlock,
  footerBlock,
  appScript,
} from './render-portal.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dir, '..');
const SITE = 'https://www.vizzie.org';

const title = 'Brand assets & press kit · Vizzie';
const description =
  'Download the Vizzie logo in SVG and PNG, check the colour and clear-space ' +
  'rules, and copy the company boilerplate. Free to use in any coverage of Vizzie.';
const canonical = `${SITE}/brand/`;
const socialImage = `${SITE}/og-vancouver-street-trees.png`;
const socialImageAlt =
  'Vizzie mapping 150,000 Vancouver street trees in 3D, extruded by height ' +
  'and coloured by species, with charts alongside';

// Every downloadable asset, in the order it appears on the page.
const LOGOS = [
  {
    id: 'horizontal',
    name: 'Horizontal lockup',
    note: 'The primary logo. Use this wherever the space is wider than it is tall — sites, decks, email signatures, event listings.',
    svg: 'vizzie-logo-horizontal.svg',
    png: 'vizzie-logo-horizontal.png',
    pngDims: '1742 × 454',
    extra: [
      { label: 'PNG 512px', file: 'vizzie-logo-horizontal-512.png' },
      { label: 'With clear space (PNG)', file: 'vizzie-logo-horizontal-padded.png' },
      { label: 'With clear space (SVG)', file: 'vizzie-logo-horizontal-padded.svg' },
    ],
    height: 46,
  },
  {
    id: 'stacked',
    name: 'Stacked lockup',
    note: 'For square and near-square spaces — avatars, app icons, social profiles, stickers.',
    svg: 'vizzie-logo-square.svg',
    png: 'vizzie-logo-square.png',
    pngDims: '1024 × 1024',
    extra: [],
    height: 132,
  },
];

const DONTS = [
  'Recolour it. The green is fixed — it is the same #22C55E on light and dark.',
  'Stretch, squash or rotate it, or rebuild the wordmark in a different typeface.',
  'Add shadows, outlines, gradients or a container box.',
  'Place it on a busy photo or a mid-tone background where the green loses contrast.',
  'Separate the mark from the wordmark to make a new lockup — the two files above are the only approved ones.',
];

function logoCard(logo) {
  const extras = logo.extra
    .map((e) => `<a class="dl" href="/brand/${esc(e.file)}" download>${esc(e.label)}</a>`)
    .join('\n            ');
  return `<div class="asset">
          <div class="swatches">
            <div class="sw dark"><img src="/brand/${esc(logo.svg)}" alt="${esc(logo.name)} on the dark background" style="height:${logo.height}px" /></div>
            <div class="sw light"><img src="/brand/${esc(logo.svg)}" alt="${esc(logo.name)} on a light background" style="height:${logo.height}px" /></div>
          </div>
          <h3>${esc(logo.name)}</h3>
          <p class="note">${esc(logo.note)}</p>
          <div class="dls">
            <a class="dl primary" href="/brand/${esc(logo.svg)}" download>SVG</a>
            <a class="dl" href="/brand/${esc(logo.png)}" download>PNG ${esc(logo.pngDims)}</a>
            ${extras}
          </div>
        </div>`;
}

const extraStyle = `<style>
      .brandpage { padding: 56px 0 72px; }
      .brandpage h1 { font-size: 40px; line-height: 1.15; letter-spacing: -0.01em; }
      .brandpage .lede { color: var(--muted); font-size: 18px; max-width: 62ch; margin-top: 14px; }
      /* the shared sheet gives every section 96px of padding — too airy for a
         reference page you scan rather than read */
      .brandpage section { padding: 56px 0; }
      .brandpage section:last-of-type { border-bottom: none; padding-bottom: 24px; }
      .brandpage h2 { font-size: 24px; margin-bottom: 6px; }
      .brandpage h3 { font-size: 17px; margin-bottom: 4px; }
      .brandpage p { color: var(--muted); max-width: 70ch; }
      .brandpage p + p { margin-top: 12px; }
      .assets { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-top: 22px; }
      .asset { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 18px; }
      .swatches { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
      .sw { display: flex; align-items: center; justify-content: center; border-radius: 10px; padding: 22px 14px; min-height: 120px; }
      .sw.dark { background: var(--bg); border: 1px solid var(--line); }
      .sw.light { background: #ffffff; }
      .sw img { max-width: 100%; }
      .note { font-size: 14px; }
      .dls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
      .dl { display: inline-block; font-size: 13px; font-weight: 600; text-decoration: none;
            padding: 7px 12px; border-radius: 8px; border: 1px solid var(--line);
            background: var(--card); color: var(--text); }
      .dl:hover { border-color: var(--green); }
      .dl.primary { background: var(--green-soft); border-color: rgba(34,197,94,.45); color: var(--green); }
      .colours { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 20px; }
      .colour { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; width: 200px; }
      /* the ink chip is the page background — outline it or it reads as a hole */
      .colour .chip { height: 74px; box-shadow: inset 0 0 0 1px var(--line); }
      .colour .meta { padding: 12px 14px; }
      .colour .hex { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 14px; }
      .colour .lbl { font-size: 13px; color: var(--muted); margin-top: 2px; }
      .rules { margin-top: 18px; padding-left: 20px; color: var(--muted); max-width: 70ch; }
      .rules li { margin-bottom: 8px; }
      .boiler { background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--green);
                border-radius: 12px; padding: 20px 22px; margin-top: 18px; max-width: 74ch; }
      .boiler p { color: var(--text); }
      .snippet { background: var(--bg); border: 1px solid var(--line); border-radius: 10px;
                 padding: 14px 16px; margin-top: 16px; overflow-x: auto; max-width: 74ch; }
      .snippet code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px;
                      color: var(--text); white-space: pre; }
      .sigdemo { background: #ffffff; border-radius: 10px; padding: 18px 20px; margin-top: 18px;
                 display: inline-block; }
      .shot { margin-top: 20px; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; max-width: 760px; }
      .shot img { display: block; width: 100%; }
      @media (max-width: 640px) { .brandpage h1 { font-size: 30px; } }
    </style>`;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${esc(canonical)}" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />

    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${esc(canonical)}" />
    <meta property="og:site_name" content="Vizzie" />
    <meta property="og:image" content="${esc(socialImage)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(socialImageAlt)}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${esc(socialImage)}" />
    <meta name="twitter:image:alt" content="${esc(socialImageAlt)}" />

    ${styleBlock()}
    ${extraStyle}
  </head>
  <body>
    ${headerBlock()}

    <main class="brandpage">
      <div class="wrap">
        <h1>Brand assets &amp; press kit</h1>
        <p class="lede">
          Everything you need to write about Vizzie. These files are free to use in
          any article, review, talk or post about Vizzie — no permission needed. If
          you want something that isn't here, email
          <a href="mailto:hello@vizzie.org" style="color: var(--green)">hello@vizzie.org</a>
          and we'll make it.
        </p>

        <section>
          <h2>Logo</h2>
          <p>Prefer the SVG. It stays sharp at any size and the PNGs are transparent, so both sit on light or dark.</p>
          <div class="assets">
            ${LOGOS.map(logoCard).join('\n            ')}
          </div>
        </section>

        <section>
          <h2>Colour</h2>
          <p>One brand colour, and it does not change between light and dark.</p>
          <div class="colours">
            <div class="colour">
              <div class="chip" style="background: #22c55e"></div>
              <div class="meta"><div class="hex">#22C55E</div><div class="lbl">Vizzie green — logo, links, buttons</div></div>
            </div>
            <div class="colour">
              <div class="chip" style="background: #0e1116"></div>
              <div class="meta"><div class="hex">#0E1116</div><div class="lbl">Ink — the dark surface behind it</div></div>
            </div>
            <div class="colour">
              <div class="chip" style="background: #e6e9ef"></div>
              <div class="meta"><div class="hex">#E6E9EF</div><div class="lbl">Paper — text on dark</div></div>
            </div>
          </div>
        </section>

        <section>
          <h2>Clear space and minimum size</h2>
          <p>
            Leave clear space around the logo equal to the height of the stacked mark —
            nothing else should sit inside it. The padded files above already include it.
            Don't set the horizontal lockup below <strong>120px wide</strong> on screen or
            30mm in print; below that the lower two layers of the mark start to close up.
            Use the stacked lockup when you need it smaller.
          </p>
        </section>

        <section>
          <h2>Please don't</h2>
          <ul class="rules">
            ${DONTS.map((d) => `<li>${esc(d)}</li>`).join('\n            ')}
          </ul>
        </section>

        <section>
          <h2>Email signature</h2>
          <p>
            Sized for a signature and served from here, so it renders in every client
            without an attachment. Email clients don't support SVG, so these are PNG.
          </p>
          <p>
            Each file's pixel size <em>is</em> the size it renders at, because most
            signature editors only let you paste a URL with no way to set
            <code>width</code> and <code>height</code>. Pick the file that matches the
            width you want and paste its address on its own.
          </p>
          <div class="sigdemo">
            <img src="/brand/vizzie-logo-email-90.png" width="90" height="23" alt="Vizzie" style="display: block" />
            <img src="/brand/vizzie-logo-email-120.png" width="120" height="31" alt="Vizzie" style="display: block; margin-top: 14px" />
            <img src="/brand/vizzie-logo-email.png" width="180" height="46" alt="Vizzie" style="display: block; margin-top: 14px" />
          </div>
          <div class="dls">
            <a class="dl" href="/brand/vizzie-logo-email-90.png" download>90 × 23 — discreet</a>
            <a class="dl primary" href="/brand/vizzie-logo-email-120.png" download>120 × 31 — recommended</a>
            <a class="dl" href="/brand/vizzie-logo-email.png" download>180 × 46 — prominent</a>
          </div>
          <p style="margin-top: 18px">
            If your editor <em>does</em> accept markup, use the largest file and halve it
            with <code>width</code> and <code>height</code> — that keeps it sharp on a
            retina screen, which a URL on its own can't do.
          </p>
          <div class="snippet"><code>&lt;a href="https://www.vizzie.org"&gt;&lt;img
  src="https://www.vizzie.org/brand/vizzie-logo-email.png"
  width="90" height="23" alt="Vizzie" style="border:0;display:block"&gt;&lt;/a&gt;</code></div>
        </section>

        <section>
          <h2>Product screenshot</h2>
          <p>
            Vizzie mapping the City of Vancouver's street-tree register — 150,000 trees
            extruded by height and coloured by species, with the charts updating alongside.
            Sized 1200 × 630 for social cards; credit the data to the City of Vancouver.
          </p>
          <div class="shot">
            <img src="/og-vancouver-street-trees.png" alt="${esc(socialImageAlt)}" width="1200" height="630" />
          </div>
          <div class="dls">
            <a class="dl primary" href="/og-vancouver-street-trees.png" download>PNG 1200 × 630</a>
            <a class="dl" href="/vizzie-vancouver-3d.gif" download>Animated GIF</a>
            <a class="dl" href="/vizzie-connector-workflow.gif" download>Workflow GIF</a>
          </div>
        </section>

        <section>
          <h2>Boilerplate</h2>
          <p>Copy this straight into a piece if it's useful.</p>
          <div class="boiler">
            <p>
              Vizzie is a mapping and analytics platform that connects people to the
              world's open data. It reaches 170 open-data portals across 28 countries
              and more than 4.1 million datasets, and turns any of them into maps,
              charts and data stories in the browser — with nothing to download and no
              GIS specialist required. Vizzie is in beta at
              <a href="https://www.vizzie.org" style="color: var(--green)">vizzie.org</a>.
            </p>
          </div>
          <p style="margin-top: 14px">
            Written as <strong>Vizzie</strong> — one capital V, never all-caps, never
            "vizzie". It's pronounced <em>VIZ-ee</em>.
          </p>
        </section>

        <section>
          <h2>Press enquiries</h2>
          <p>
            <a href="mailto:hello@vizzie.org" style="color: var(--green)">hello@vizzie.org</a>
            — happy to give a walkthrough, build a map for a story, or check figures before you publish.
          </p>
        </section>
      </div>
    </main>

    ${footerBlock({})}
    ${appScript({})}
  </body>
</html>
`;

// Fail loudly rather than shipping a page full of broken download links.
const missing = [
  'og-vancouver-street-trees.png',
  'brand/vizzie-logo-email.png',
  'brand/vizzie-logo-email-90.png',
  'brand/vizzie-logo-email-120.png',
  'vizzie-vancouver-3d.gif',
  'vizzie-connector-workflow.gif',
  ...LOGOS.flatMap((l) => [`brand/${l.svg}`, `brand/${l.png}`, ...l.extra.map((e) => `brand/${e.file}`)]),
].filter((f) => !existsSync(join(WEB, f)));
if (missing.length) {
  console.error(`missing assets:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

writeFileSync(join(WEB, 'brand', 'index.html'), html);
process.stderr.write('wrote brand/index.html\n');
