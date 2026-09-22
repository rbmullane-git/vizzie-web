# EJScreen 2.32 — census tract extracts

| File | Rows | Size |
|---|---:|---:|
| `ejscreen-2.32-tracts-ca.csv` | 9,107 | 1.95MB |
| `ejscreen-2.32-tracts-tx.csv` | 6,883 | 1.42MB |
| `ejscreen-2.32-tracts-ny.csv` | 5,393 | 1.14MB |

35 columns each. Rebuild with `node tools/build-ejscreen-extracts.mjs`.

## What this is

EPA's Environmental Justice Screening and Mapping Tool, version 2.32 (2024, second
release), at census-tract level with **US-relative percentiles**.

EPA removed EJScreen from its website on **5 February 2025** and the tool was shut
down that March, along with CEQ's Climate & Economic Justice Screening Tool. The data
is a US federal government work and never left the public domain — only the tool that
read it disappeared.

## Provenance

| | |
|---|---|
| Originator | U.S. Environmental Protection Agency |
| Archived by | Public Environmental Data Partners |
| Source of record | Harvard Dataverse, [doi:10.7910/DVN/RLR5AX](https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/RLR5AX) |
| Source file | `EJScreen_2024_Tract_with_AS_CNMI_GU_VI.csv` (datafile 10775979, 152,658,269 bytes, md5 `4debc9e374c352ec571701ed28bc5d69`) |
| Licence declared on the deposit | CC0 1.0, dataset-level on Dataverse |
| Licence Vizzie ingests under | **US-PD** — US Government Public Domain, 17 USC §105 |
| Retrieved | 22 September 2026 |

Cite EPA as the originator. The Dataverse deposit is the archival copy, not the author.

**Why US-PD and not CC0.** CC0 is what the Dataverse deposit declares, but it was
applied by the depositor, not executed by EPA. The publisher of this data is EPA, and
the licence has to describe EPA's work: a federal work that was never in copyright.
The compliance matrix keeps the two classes separate on exactly that ground. Both
permit commercial reuse and neither requires attribution, so nothing about ingest
changes — only what Vizzie tells a user about where the rights come from.

**Why not the ArcGIS mirrors.** The Public Environmental Data Partners feature services
declare no licence at all, and two are mislabelled — `EJScreenUSPercentilesCensusTracts`
is block groups (243,022 rows, 12-digit ids), and the only genuine tract service carries
state-relative rather than US-relative percentiles.

## How the extracts are derived

From the 86,082-row national file, per state:

- **Filtered by `ST_ABBREV`.** The national file is 85,396 tracts against the
  connector's 50,000-row ingest cap, so a US-wide extract would silently truncate to
  58% of the country. A state is the largest honest unit.
- **Dropped territory and water rows.** Territories (AS, CNMI, GU, VI) carry 7- and
  10-character ids and have no Census tract boundary. Water-only tracts (code `99xx`)
  have a boundary but zero population.
- **Kept 35 of 230 columns** — demographic and environmental indicators, the
  supplemental demographic index, and US percentiles for the headline measures.
- **Renamed 5 columns** that surface in the UI (`ID`→`GEOID`, `STATE_NAME`→`State`,
  `CNTY_NAME`→`County`, `ACSTOTPOP`→`Population`,
  `EXCEED_COUNT_80`→`EJ indexes above 80th percentile`). Every indicator keeps its EPA
  field name, because that is what the technical documentation uses and what a
  practitioner searches for.
- **Rounded** shares to 4 decimals, concentrations to 3. EPA ships 15 decimals on
  ACS-derived estimates; the extra digits are not information and tripled the file the
  studio re-fetches on open.

## Join to Vizzie's reference geography

Measured by the build script against `cb_2020_us_tract_500k.zip` — the exact Census
cartographic boundary file the connector's `us-tract` loader seeds from. The script
exits non-zero if boundary-side coverage drops below 99.5%.

| State | row-side | boundary-side | boundaries with no row |
|---|---:|---:|---|
| CA | 100.00% | 99.98% | `06017990000`, `06061990000` — Lake Tahoe |
| TX | 100.00% | 99.99% | water tracts only |
| NY | 100.00% | 99.98% | water tracts only |

Boundary-side is the number that matters for a choropleth. The India gallery example
matched 99.5% of its rows and still drew 13.6% of the map blank, because every miss
was on the boundary side.

## GEOID

11-digit, leading zero significant (CA is state FIPS `06`). Joins to `US/TRACT`,
vintage 2020.

## The headline measure

`EJ indexes above 80th percentile` (EPA's `EXCEED_COUNT_80`) counts how many of the 13
EJ indexes a tract sits in the national top 20% for — 0 to 13 in one number.
California's distribution is sharply bimodal: 3,034 tracts at zero, 1,042 at eleven.
That concentration is the pattern EJScreen existed to show.
