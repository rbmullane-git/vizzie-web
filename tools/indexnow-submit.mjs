// Submit all site URLs to IndexNow (Bing, Yandex, Seznam, Naver).
// Usage: node tools/indexnow-submit.mjs <key>
import { readFileSync, readdirSync } from 'node:fs';
const HOST = 'www.vizzie.org';
const key = process.argv[2];
if (!key) { console.error('usage: node indexnow-submit.mjs <key>'); process.exit(1); }
// gather URLs from sitemap.xml
const sm = readFileSync(new URL('../sitemap.xml', import.meta.url), 'utf8');
const urlList = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
console.error(`submitting ${urlList.length} URLs to IndexNow…`);
const body = { host: HOST, key, keyLocation: `https://${HOST}/${key}.txt`, urlList };
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});
console.error('IndexNow HTTP', res.status, res.statusText);
console.error(await res.text().catch(() => ''));
