// publish-county-projects.mjs
// Hosts the payloads from build-county-projects.mjs as published maps, so each
// county page's button can open `#view=<token>` — that county's own map, opened
// by a stranger with no account.
//
// Writes to `published_maps` under the owning account. A row is revocable
// (set revoked_at) and the reader path is the SECURITY DEFINER
// `get_published_map`, so holding the link is the whole authorisation.
//
// Idempotent: a county already hosted keeps its token and has its payload
// refreshed, so re-running after a data rebuild never orphans a live link.
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
// Usage:  node tools/publish-county-projects.mjs [--from-render] <owner-uuid> <slug ...>

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dir, 'data', 'county-projects');
// Credentials come from the environment, or — with --from-render — straight out
// of the vizzie-connector service, which already holds both. That saves digging
// the service-role key out of the dashboard to paste it into a shell, which is
// the moment a key like this usually ends up somewhere it should not be.
const RENDER_SERVICE = 'srv-da01hutbedkc739m6tj0'; // vizzie-connector

async function credentials() {
  if (!process.argv.includes('--from-render')) {
    return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  }
  const token = process.env.RENDER_API_KEY;
  if (!token) throw new Error('--from-render needs RENDER_API_KEY in the environment');
  const res = await fetch(
    `https://api.render.com/v1/services/${RENDER_SERVICE}/env-vars?limit=100`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Render env-vars: ${res.status} ${await res.text()}`);
  const vars = (await res.json()).map((v) => v.envVar).filter(Boolean);
  const pick = (k) => vars.find((v) => v.key === k)?.value;
  return { url: pick('SUPABASE_URL'), key: pick('SUPABASE_SERVICE_ROLE_KEY') };
}

const { url: URL_BASE, key: KEY } = await credentials();
if (!URL_BASE || !KEY) {
  console.error(
    'Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment,\n' +
      'or pass --from-render to read both from the vizzie-connector service.',
  );
  process.exit(1);
}
const [owner, ...slugs] = process.argv.slice(2).filter((a) => a !== '--from-render');
if (!owner || !slugs.length) {
  console.error('usage: node tools/publish-county-projects.mjs <owner-uuid> <slug ...>');
  process.exit(1);
}

const headers = {
  apikey: KEY,
  authorization: `Bearer ${KEY}`,
  'content-type': 'application/json',
};

async function rest(path, init) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Tokens land in a file the page generator reads, so publishing and rendering
// stay decoupled: this script needs a privileged key, build-counties.mjs needs
// none, and a county with no token yet simply renders the plain studio link.
const TOKENS = join(__dir, 'data', 'county-tokens.json');
const tokens = existsSync(TOKENS) ? JSON.parse(readFileSync(TOKENS, 'utf8')) : {};

// project_client_id is the idempotency key: it is the county slug, so a rerun
// finds the existing row instead of minting a second link for the same page.
for (const slug of slugs) {
  const payload = JSON.parse(readFileSync(join(DIR, `${slug}.json`), 'utf8'));
  const clientId = `county-profile:${slug}`;
  const existing = await rest(
    `published_maps?project_client_id=eq.${encodeURIComponent(clientId)}&select=id,public_token`,
  );
  if (existing.length) {
    await rest(`published_maps?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify({ payload, revoked_at: null }),
    });
    tokens[slug] = existing[0].public_token;
    console.log(`${slug}\t${existing[0].public_token}\t(refreshed)`);
    continue;
  }
  const [row] = await rest('published_maps?select=public_token', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: owner,
      project_client_id: clientId,
      title: payload.dashboard.name,
      payload,
      // is_hosted is GENERATED ALWAYS AS (payload IS NOT NULL) — supplying it
      // is rejected outright. A null column_default does not mean a column is
      // writable; is_generated is the field that says so.
    }),
  });
  tokens[slug] = row.public_token;
  console.log(`${slug}\t${row.public_token}\t(created)`);
}

writeFileSync(TOKENS, JSON.stringify(tokens, null, 1));
console.error(`\nwrote ${TOKENS} (${Object.keys(tokens).length} token(s)) — now run:\n  node tools/build-counties.mjs`);
