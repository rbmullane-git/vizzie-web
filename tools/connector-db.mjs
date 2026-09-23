// connector-db.mjs
// One psql-over-the-Render-CLI helper, shared by the fetch-* scripts.
//
// NOTE: fetch-geography-facts.mjs still carries its own copy of this parser —
// it is the original, and it is a working network script that is expensive to
// re-verify. It should adopt this module next time it is touched.
//
// Needs the Render CLI and RENDER_API_KEY (see tools/README.md).

import { execFileSync } from 'node:child_process';

const DB = 'vizzie-connector-db';

/** Rows as arrays of trimmed strings; header, rule and "(n rows)" removed. */
export function psql(sql) {
  const raw = execFileSync('render', ['psql', DB, '--command', sql, '--output', 'json', '--confirm'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const text = JSON.parse(raw).output ?? '';
  const lines = text.split('\n');
  // psql aligned output: header, rule, rows…, "(n rows)", blank. Long values
  // are not wrapped, which is what makes it safe to pull GeoJSON back through.
  const ruleAt = lines.findIndex((l) => /^-+(\+-+)*$/.test(l.trim()));
  if (ruleAt < 0) throw new Error(`unexpected psql output:\n${text.slice(0, 400)}`);
  const end = lines.findIndex((l) => /^\(\d+ rows?\)$/.test(l.trim()));
  return lines
    .slice(ruleAt + 1, end < 0 ? undefined : end)
    .filter((l) => l.trim() !== '')
    .map((l) => l.split('|').map((c) => c.trim()));
}

/** Single-quote a literal for interpolation into SQL. */
export function q(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
