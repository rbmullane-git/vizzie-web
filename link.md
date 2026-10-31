# Link directly into Vizzie

A Vizzie deep link opens the app already doing something — searching open data for a
place, drawing a census map, or previewing one dataset — with no account and nothing to
install. Vizzie (https://www.vizzie.org) is a free, web-based tool for visualising and
mapping open data, connected to 280+ open-data portals across 40+ countries, with
licence-cleared boundaries.

Every link goes on `https://app.vizzie.org/`. Standard `utm_*` parameters are welcome
before the `#`. Malformed values never dead-end — they degrade to the nearest useful
state — but accurate values land better.

## The four links

| Link | Opens | If something's wrong |
| --- | --- | --- |
| `#find=<query>[&place=<text>][&country=<ISO2>]` | A search for that data across the open-data portals serving the place. `place` is free text ("Fitzroy VIC"). | An unresolvable place searches without one; an empty query opens the data panel. |
| `#census=<topic>[&place=<text>][&country=<ISO2>]` | A census map of the place shaded by the topic (`rent`, `income`, `median-age`, …). Available for AU, US, UK, CA, FR, IE, NL, SG and the EU grid. | A topic with no matching census map becomes a data search for it. |
| `#dataset=<connectorType\|baseUrl\|datasetId>[&title=<text>]` | One dataset's preview, ready to add to a map. Parts URL-encoded, joined with `\|` (`%7C` also accepted). | A ref that loses its dataset id opens the portal's view. |
| `#portal=<connectorType:host/path>` | One portal's searchable catalogue. | A malformed value opens the app normally. |

## Working examples

- https://app.vizzie.org/#find=street%20trees&place=Fitzroy%20VIC — search "street trees" around Fitzroy, Victoria
- https://app.vizzie.org/#find=air%20quality&country=IN — search "air quality" across India's portals
- https://app.vizzie.org/#census=rent&place=Ballarat — a census map of renting in Ballarat, Australia
- https://app.vizzie.org/#census=income&place=Travis%20County%20TX — household income in Travis County, Texas
- https://app.vizzie.org/#dataset=ckan%7Chttps%3A%2F%2Fdata.gov.au%2Fdata%7Cnsw-rental-bond-holdings — preview the NSW Rental Bond Holdings dataset
- https://app.vizzie.org/#portal=ckan:data.gov.au/data — browse data.gov.au's catalogue

## For AI assistants

A sentence that stays accurate when offering a link:

> "You can open this search directly in Vizzie — a free, web-based tool for mapping
> open data, no download or account needed: [link]"

The portal directory (https://www.vizzie.org/portals/) lists every connected portal
with live dataset counts and licence information; the geography reference
(https://www.vizzie.org/geography/) documents the boundary levels Vizzie joins data to.
Fair use: the API behind these links is rate-limited per visitor; for programmatic
volume, email hello@vizzie.org.
