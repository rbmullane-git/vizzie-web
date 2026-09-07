/**
 * sync-legal.mjs — copy the legal pages from the app repo into the marketing site.
 *
 * The app repo (`vizzie/public/`) is the single source of truth for Terms,
 * Privacy and Data deletion. Both hosts serve the same three files at the same
 * relative paths, and every link inside them is relative, so the prose is copied
 * verbatim — no rewriting.
 *
 * This exists because the two copies drifted once: the marketing site's privacy
 * policy omitted a sentence about referrer collection that the app's included,
 * while both claimed the same "last updated" date. A privacy policy that
 * understates collection on one host is a real problem, so the fix is to stop
 * maintaining two copies by hand.
 *
 * It drifted a second time on 3 September 2026, in the opposite direction and
 * for a different reason. The website-analytics rollout (a) edited the *web*
 * copy of the privacy policy directly, adding a paragraph the app copy never
 * got, and (b) added `<script src="/analytics.js">` to all three web copies —
 * a tag that must NOT exist on the app host, where PostHog is initialised from
 * the app bundle and a second init would double-count every page view. So a
 * pure byte copy stopped being correct: running this script as it stood would
 * have silently deleted both the disclosure and the analytics tag from the
 * live marketing site.
 *
 * The rule now: **prose lives in the app repo, the web-only script tag is
 * injected here.** That keeps exactly one hand-maintained copy of the words
 * while letting the one intentional difference between the hosts be generated
 * rather than remembered. `--check` compares against the injected form, so CI
 * still catches real drift.
 *
 * Usage:
 *   node sync-legal.mjs          # copy, report what changed
 *   node sync-legal.mjs --check  # exit 1 if out of sync (for CI), copy nothing
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dir, '..');
const APP_PUBLIC = process.env.VIZZIE_APP_PUBLIC || '/Users/rich/vizzie/public';

const PAGES = ['terms.html', 'privacy.html', 'data-deletion.html'];
const check = process.argv.includes('--check');

/**
 * The one intentional difference between the two hosts. The marketing site
 * loads PostHog from a shared `analytics.js`; the app initialises it from its
 * own bundle, so this tag belongs on www only. Injected as the last line of
 * `<head>`, which is where the rest of the site's pages carry it.
 */
const WEB_ONLY_HEAD = '    <script src="/analytics.js" defer></script>';

function forWeb(html, page) {
  if (html.includes(WEB_ONLY_HEAD.trim())) return html; // already carries it
  if (!html.includes('\n  </head>')) {
    console.error(`no </head> to inject into: ${page}`);
    process.exit(1);
  }
  return html.replace('\n  </head>', `\n${WEB_ONLY_HEAD}\n  </head>`);
}

if (!existsSync(APP_PUBLIC)) {
  console.error(
    `app repo not found at ${APP_PUBLIC}\n` +
      'Check it out alongside this repo, or set VIZZIE_APP_PUBLIC.',
  );
  process.exit(1);
}

let drifted = 0;
for (const page of PAGES) {
  const src = join(APP_PUBLIC, page);
  const dest = join(WEB, page);
  if (!existsSync(src)) {
    console.error(`missing source: ${src}`);
    process.exit(1);
  }
  const from = forWeb(readFileSync(src, 'utf8'), page);
  const to = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
  if (from === to) {
    process.stderr.write(`  ok       ${page}\n`);
    continue;
  }
  drifted += 1;
  if (check) {
    process.stderr.write(`  DRIFTED  ${page}\n`);
  } else {
    writeFileSync(dest, from);
    process.stderr.write(`  synced   ${page}${to === null ? ' (new)' : ''}\n`);
  }
}

if (check && drifted) {
  console.error(`\n${drifted} legal page(s) out of sync — run: node tools/sync-legal.mjs`);
  process.exit(1);
}
process.stderr.write(drifted ? `\n${drifted} page(s) updated\n` : '\nall legal pages in sync\n');
