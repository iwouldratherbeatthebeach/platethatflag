# Flag That Plate for Splunk

Researches the diplomatic plate codes [flagthatplate.com](https://flagthatplate.com) doesn't know
yet, and shows what happens on the site: lookups, sightings, sign-ins and errors. It reads the
events the site's Cloudflare Pages Functions send to the HTTP Event Collector (source type
`platethatflag:event`).

Written for Splunk Enterprise 9.0 or later and Splunk Cloud Platform, with the KV store on. The
dashboards are classic Simple XML (`version="1.1"`).

## Install

1. **Apps > Manage Apps > Install app from file**, choose `flag_that_plate-<version>.spl`, and tick
   *Upgrade app* when replacing an earlier version. Restart if Splunk asks. On Splunk Cloud Platform,
   upload it as a private app (**Apps > Manage Apps > Upload App**), which runs it through
   app vetting first.
2. Get the site's events into Splunk, if they aren't already:
   - Create an index named `platethatflag` (**Settings > Indexes > New Index**).
   - Create an HEC token that writes to it (**Settings > Data inputs > HTTP Event Collector > New
     Token**).
   - Give the site `SPLUNK_HEC_URL` and `SPLUNK_HEC_TOKEN` and redeploy it. The site's README,
     section *Splunk HEC forwarding*, has every setting.
3. Using another index? Change the `ptf_index` macro (**Settings > Advanced search > Search
   macros**); every dashboard and alert uses it.

Look up a plate on the site: the Overview shows it within seconds.

## Researching unknown codes

A plate whose code isn't in the site's `plates.csv` is logged as an `unknown_plate` event with its
parts (code, role letter, serial) and how it was entered (typed, read from a photo, or opened from
a link). Visitors who looked up a full plate can say where they saw it and what car it was on; those
sightings are filed under the country `UNKNOWN`. Codes that `plates.csv` itself lists as `UNKNOWN`
are researched the same way.

1. **The queue fills itself.** The alert *Flag That Plate - New codes to research* runs every 30
   minutes, adds each new code to the research queue (a KV store collection, `ptf_research`) and
   lists it under **Activity > Triggered Alerts**. Entries that aren't plate-shaped (typos, state
   plates, misread photos) are kept out of the queue and listed separately.
2. **Research queue** lists every code in the queue, however long ago it was seen, and any code seen
   in the time range that the alert hasn't queued yet: how often it was looked up in that range, by
   how many visitors, the plates and roles seen, how they were entered, any sightings, and whether
   the same two letters are already listed for other roles. Pick a row to research the code.
3. **Research a code** shows every lookup, plate and sighting for the code, the listed codes it could
   be (a letter that is easy to misread or mistype, or the letters swapped), and the code's rows in
   the app's copy of `plates.csv`. Record what you find there: a status, the country as
   `plates.csv` names it, and a note, then *Save findings*. Splunk 9 and later usually ask before a
   dashboard writes to a lookup (`outputlookup` is on its list of risky commands): choose *Run Query
   Anyway* to save, *Cancel* to leave the queue as it is.
4. **Identified codes** appear under *Rows to add to plates.csv* on the Research queue, written the
   way the file writes them. Add the rows to `plates.csv` in the site's repository, then mark the code
   *Added to plates.csv*.

| Status | Means |
| --- | --- |
| New | Seen, not looked at yet |
| Researching | Someone is on it |
| Identified | Country known; the rows still have to be added to `plates.csv` |
| Added | In `plates.csv` |
| Not a code | A typo, a misread photo, or not a diplomatic plate |

To record findings from the search bar instead, quote every value, and keep double quotes and
commas out of them (the dashboard has neither limit):

```spl
| `ptf_research_set("GK", "identified", "Country as plates.csv names it", "Where and how you found out")`
```

Writing to the queue takes the `admin`, `power` or `sc_admin` role (`metadata/default.meta`).

## Alerts

Each lists its results under **Activity > Triggered Alerts**. To be told directly, add an email or
another action (**Alerts > Edit > Edit Alert**).

| Alert | Runs | Triggers when |
| --- | --- | --- |
| Flag That Plate - New codes to research | every 30 minutes | a code is seen for the first time (and adds it to the queue) |
| Flag That Plate - Repeated sign-in failures | every 15 minutes | one visitor (by IP hash) fails to sign in 10 or more times in 15 minutes |
| Flag That Plate - Server errors | every 15 minutes | a Function answered 500 |
| Flag That Plate - Events stopped arriving | hourly, **off** until enabled | the site has sent nothing for 24 hours |

## Keeping the plates.csv copy current

The app carries a copy of the site's `plates.csv` (`lookups/ptf_plate_codes.csv`) for the "codes it
could be" and "the code in plates.csv" panels. After `plates.csv` changes, rebuild and reinstall the
app from the site's repository:

```bash
node splunk/build.mjs
```

That regenerates the lookups and writes `splunk/dist/flag_that_plate-<version>.spl`. Installing it
with *Upgrade app* replaces the copy; the research queue lives in the KV store and is kept.

## What's inside

| File | What it does |
| --- | --- |
| `default/props.conf` | JSON fields; CIM aliases `src` (the IP hash) and `dest` (the site's hostname) |
| `default/eventtypes.conf`, `tags.conf` | `ptf_lookup`, `ptf_unknown_plate`, `ptf_sighting`, `ptf_authentication` (tagged `authentication` for the CIM), `ptf_account`, `ptf_error` |
| `default/macros.conf` | `ptf_index`, `ptf_events`, `ptf_plate_parts` (a plate's code, role letter and serial, the way the site reads them), `ptf_needs_research`, `ptf_country_name`, `ptf_research_set` |
| `default/collections.conf`, `transforms.conf` | The research queue (`ptf_research`) and the two lookups |
| `default/savedsearches.conf` | The four alerts |
| `default/data/ui/views/` | Overview, Research queue, Research a code, Sightings, Sign-ins and errors |
| `lookups/` | `ptf_plate_codes.csv` (from `plates.csv`), `ptf_letter_confusions.csv` |

The events never carry an IP address or a password: visitors are identified by a SHA-256 hash of
their IP address (`src_ip_hash`).
