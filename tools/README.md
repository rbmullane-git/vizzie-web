# Site build tools

The marketing site is static HTML, committed. These scripts generate the parts
of it that are made of facts — how many portals are connected, how many
datasets they hold, what licences those datasets carry — so that those facts
are read from the connector and the portals themselves rather than retyped.

Every script is safe to re-run and reports what it changed.

## Order

Run in this order; each step consumes what the one before it wrote.

| # | Command | What it does | Network |
| - | ------- | ------------ | ------- |
| 1 | `node tools/sync-connector-data.mjs` | Pulls the compliance matrix, the wizard's portal registry and the country labels out of `vizzie-connector`. | no |
| 2 | `node tools/fetch-bespoke-counts.mjs` | Asks the connector for dataset counts on the statistical APIs this site can't query itself (Eurostat, OECD, WHO, DHS, World Bank, Census…). | yes, slow |
| 3 | `node tools/build-portals.mjs --force-fetch` | Fetches live counts, licence facets and publisher lists from all 178 portals, then renders `/portals/**`, the portals index and `sitemap.xml`. Omit `--force-fetch` to render from the cache and only fetch portals it has never seen. | yes, ~30 min |
| 4 | `node tools/build-homepage-data.mjs` | Rewrites the "Connected today" band and the inline `data-fact` figures in `index.html`. | no |
| 5 | `node tools/build-landing.mjs` | Renders the two paid-test landing pages under `/lp/`. | no |
| 6 | `node tools/build-brand.mjs` | Renders `/brand/`, including the press boilerplate journalists copy verbatim. | no |

Steps 1, 4 and 5 also take `--check`, which exits non-zero instead of writing —
suitable for CI.

Independent of the above: `sync-legal.mjs` copies Terms/Privacy/Data-deletion
from the app repo, and `indexnow-submit.mjs` pings search engines after a
deploy.

## Where the numbers come from

`portal-facts.mjs` is the single reader of the generated data under
`tools/data/`; the homepage, the landing pages, the brand page's press
boilerplate and the portals index all get their headline figures from it. Nothing about connected portals should be typed
into a page by hand — on 15 Sep 2026 five separate surfaces claimed "170
portals across 28 countries" when the real figures were 178 and 32, and the
homepage quoted a dataset count for data.gov.in about 30% above what the portal
actually served.

## Licences

Licence classification is **not** done here. `build-portals.mjs` resolves what a
portal says a licence is through `licence_aliases` in the compliance matrix —
the same table the connector uses to decide whether a dataset may be ingested —
so the pages and the product cannot disagree. Strings the matrix has no alias
for are listed at the end of a build; the fix for those is to add the alias in
`vizzie-connector` and re-run step 1, never to special-case them here.
