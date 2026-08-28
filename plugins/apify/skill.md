---
name: career-ops-plugin-apify
description: How to scan a job source through an Apify actor as a keyed provider.
license: MIT
---

# apify plugin

A keyed provider: runs an Apify actor and maps its dataset items into the
scanner. It fires ONLY on a `portals.yml` entry that sets `provider: apify` —
never via auto-detection. Put `APIFY_TOKEN` in `.env`.

More ready-to-use entries (LinkedIn, Indeed, Glassdoor), each verified
against its actor's own Store/input-schema page with a re-verification date,
live in `templates/portals.example.yml` (search "Keyed provider examples")
and `templates/job-data-sources.yml` (the provenance record).

## portals.yml entry

```yaml
tracked_companies:
  - name: "Indeed — VP Engineering (Chicago)"
    provider: apify
    actor: misceres/indeed-scraper
    input: { position: "VP of Engineering", location: "Chicago, IL", maxItemsPerSearch: 25 }
    field_map:
      title:    [positionName, title]    # array = first non-empty wins
      url:      url
      company:  [company, companyName]
      location: [location, formattedLocation]
```

The cost-bound input key is **actor-specific** — this actor's is
`maxItemsPerSearch`, not the more common-looking `maxItems`. Apify silently
ignores unrecognized input keys rather than rejecting them, so a wrong key
name here doesn't error — it just leaves the run unbounded. Confirm the real
key on the actor's own input-schema page before enabling, every time.

## Then

`node scan.mjs` runs the provider for that entry and writes the results to the
pipeline like any other source. An optional `field_map.description` caches the
JD locally under `jds/`.

## Known gap

`field_map` only ever populates `{title, url, company, location, description}`
— never `salary` or `postedAt`, even when the actor's own output carries
them. `portals.yml`'s `salary_filter` and any posting-age filtering
therefore **never apply** to a `provider: apify` entry; every job the actor
returns reaches your pipeline regardless of comp or recency. Per
`docs/PLUGINS.md`, bundled plugins take no feature PRs — closing this
requires a registry successor (`career-ops-plugin-apify` with
`"supersedesBundled": true`), not an edit to this file.
