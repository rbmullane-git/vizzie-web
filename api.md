# The Vizzie API and MCP server

The Vizzie API lets an AI agent or a script find open data for a place, identify a
column of area codes, fetch licence-cleared boundaries, draw the area within reach of a
place, and make a map someone can open with one link. It is free, needs no key, and every answer carries the data's licence and
a link into Vizzie. Vizzie (https://www.vizzie.org) is a free, web-based tool for
visualising and mapping open data, connected to 280+ open-data portals across 40+
countries. The same calls are offered as an MCP server, so Claude and other assistants
can use Vizzie directly.

## Add Vizzie to an AI assistant

The MCP server is at `https://api.vizzie.org/mcp` (Streamable HTTP). In Claude, open
the connector settings, add a custom connector, and give it that URL. Any client that
supports remote MCP servers can use the same address. Searching and making maps need no
sign-in. Saving, editing and publishing a map need a free Vizzie account: the first time
you ask, the assistant opens Vizzie's sign-in, where you can also sign up.

Then ask for things like "map median weekly rent by SA2 in Ballarat, Victoria", "find
street tree data for Fitzroy, Victoria", "show everywhere within a 15-minute walk of
Flinders Street Station", or "here's a CSV of tract values for Seattle —
map it". The answer ends in a Vizzie link that opens the map, no account needed to view.

## The calls

| MCP tool | REST call | What it does |
| --- | --- | --- |
| `search_datasets` | `POST /v1/datasets/search` | Open datasets and census maps for a topic and place, across the portals Vizzie connects to. Each result has its licence (and how sure that is), whether Vizzie can map it, and a link to open it. Census topics come first, as ready-made map links. **Send the place's two-letter country code with it** — place names repeat across countries. |
| `describe_dataset` | `GET /v1/datasets/describe?ref=…` | A dataset's columns — what each holds, its type, role and unit — plus its licence and the boundaries it joins to. Example values are included only when the licence lets Vizzie pass them on. |
| `resolve_geography` | `POST /v1/geography/resolve` | Which boundary level and vintage a column of area codes is (LSOA, SA2, census tract, LGA, NUTS and more), the share that match — over every code, not a sample — some matched areas by name, and whether the boundaries can be fetched. |
| `get_boundaries` | `POST /v1/boundaries` | Boundary polygons as GeoJSON for a list of codes or a bounding box, with attribution. Up to 2,000 areas per call, and only for boundaries whose licence allows it. |
| `get_catchment` | `POST /v1/catchment` | The area within reach of an address, or of up to 1,000 points or GeoJSON shapes: everywhere within a straight-line distance (a shape grows outward from its edge), or an isochrone — how far you can walk or drive along roads (up to 100 origins). 0.1–10 km or 0.1–5 mi. Returns the polygons as GeoJSON and a `map_url` that opens them in Vizzie. |
| `create_map` | `POST /v1/maps` | A link that opens a map in Vizzie: a census map of a topic for a place; your own table of area codes and values, joined to boundaries (the level is worked out from the codes if you don't name it); or a dataset's preview. A map from your rows can carry a `catchment` (the same fields as `get_catchment`), and `crop_to_catchment` keeps only the areas that touch it. |
| `save_map` | `POST /v1/maps/{token}/save` | Keeps a map from `create_map` in your Vizzie account, so its link doesn't expire. Saved maps are listed on your projects page. **Needs sign-in.** |
| `edit_map` | `PATCH /v1/maps/{token}` | Changes a map's title, colours or values (new rows go through the same checks as `create_map`), and saves it. **Needs sign-in.** |
| `publish_map` | `POST /v1/maps/{token}/publish` | Saves the map and returns a `publish_url` that opens it in Vizzie with the Share panel open; one click there publishes a public link. **Needs sign-in.** |

REST calls go to `https://api.vizzie.org`; `GET /v1` lists them, and an OpenAPI 3.1
document is at https://api.vizzie.org/v1/openapi.json. Every failure answers
with a plain-language `error.message`, a `next` step and, where there is one, a
`fallback_url` to open instead.

The three calls that need sign-in take a Vizzie access token as
`Authorization: Bearer …`. MCP clients get one through OAuth: the server's metadata is
at `https://api.vizzie.org/.well-known/oauth-protected-resource/mcp`. A call without a
token answers 401 with a `WWW-Authenticate` header pointing there. A token issued to an
assistant works with these calls only, not with the rest of your account.

## Examples

```
curl -s https://api.vizzie.org/v1/datasets/search \
  -H 'content-type: application/json' \
  -d '{"query": "median rent", "place": "Ballarat", "country": "AU"}'
```

```
curl -s https://api.vizzie.org/v1/maps \
  -H 'content-type: application/json' \
  -d '{"source": "rows", "title": "Walking to work by tract",
       "code_column": "tract", "value_column": "share",
       "rows": [{"tract": "53033000101", "share": 12.5},
                {"tract": "53033000102", "share": 9.1}]}'
```

```
curl -s https://api.vizzie.org/v1/catchment \
  -H 'content-type: application/json' \
  -d '{"address": "Flinders Street Station, Melbourne", "country": "AU",
       "method": "isochrone", "mode": "walk", "distance": 1.2, "unit": "km"}'
```

The second answers with a `map_url` on `app.vizzie.org`, the boundary level it joined
to, how many rows matched, and the boundaries' licence and attribution. The third
answers with the walking catchment as GeoJSON and a `map_url` that draws it.

## Licences

Every result says what licence its data carries. Search and descriptions are metadata
and cover everything Vizzie catalogues; data and geometry are handed on only when the
licence is confirmed, declared and allows commercial use — share-alike licences are
served with a `share_alike` flag. A map made with `create_map` is drawn inside Vizzie,
so its boundaries stay on Vizzie's side.

## Limits

| What | Limit |
| --- | --- |
| Search, describe, resolve | 60 calls per 5 minutes each |
| Boundaries, maps, catchments | 20 calls per 5 minutes each |
| Isochrone origins (each one is a routing request) | 200 a day per address |
| All calls | 2,000 a day per address |
| Maps from your own rows | 5,000 rows, 1 MB, 200 maps a day; links last 30 days unless saved |
| Saved maps | 200 per account |

For more, email hello@vizzie.org.

## For AI assistants

A sentence that stays accurate when sharing a Vizzie link:

> "You can open this map directly in Vizzie — a free, web-based tool for mapping open
> data, no download or account needed: [link]"

The portal directory (https://www.vizzie.org/portals/), the geography reference
(https://www.vizzie.org/geography/) and the deep links (https://www.vizzie.org/link.md)
document the rest.
