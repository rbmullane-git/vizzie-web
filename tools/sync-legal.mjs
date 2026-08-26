/**
 * sync-legal.mjs — copy the legal pages from the app repo into the marketing site.
 *
 * The app repo (`vizzie/public/`) is the single source of truth for Terms,
 * Privacy and Data deletion. Both hosts serve the same three files at the same
 * relative paths, and every link inside them is relative, so a byte copy is all
 * that's needed — no rewriting.
 *
 * This exists because the two copies drifted once: the marketing site's privacy
 * policy omitted a sentence about referrer collection that the app's included,
 * while both claimed the same "last updated" date. A privacy policy that
 * understates collection on one host is a real problem, so the fix is to stop
 * maintaining two copies by hand.
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
  const from = readFileSync(src, 'utf8');
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
