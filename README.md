# Flag That Plate

Decode a U.S. diplomatic license plate: type its letters (or scan a photo) to see the country, the
mission role and the flag, log the vehicle you saw, and see which countries people look up most.

Live at <https://platethatflag.pages.dev>. Static pages on Cloudflare Pages, Pages Functions for the
API, D1 (`platethatflag-db`) for lookups, sightings and accounts.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | The decoder: a text box for the plate, which the plate graphic and its decode follow as you type; lookup, photo reading, sighting form, most looked-up countries, recent lookups |
| `leaderboard.html` | Most looked-up countries, most logged vehicles, top spotters |
| `login.html` | Sign in, create an account, signed-in state |
| `about.html` | How the codes work, what the site records, license, contact |
| `assets/css/site.css` | The whole design system: tokens (light and dark), type, layout, components, the plate, motion |
| `assets/js/` | ES modules, no build step: `core.js` (shell, safe DOM builder, API, formatting), `toast.js`, `plates.js` (decoding, pure), `reader.js` (reading a plate from a photo), one module per page |
| `assets/img/` | The logo (`logo.svg`; `logo-tile.svg` is the app-icon version the PNG favicons are rendered from) and the social preview image, made from `diplomatic-plate.png` |
| `plates.csv`, `iso_mapping.json` | The plate codes and the country-to-flag map, fetched by the pages |
| `functions/` | Pages Functions: `/track`, `/unknown`, `/observe`, `/login`, `/signup`, `/logout`, `/me`, `/stats`, `/recent`, `/api/leaderboard`, `/ocr` |
| `functions/_lib/splunk.js` | Splunk HTTP Event Collector forwarding (below) |
| `tests/` | `node --test tests/*.test.mjs` (Node 22 or newer, no dependencies) |

## Running locally

```bash
npx wrangler pages dev
```

Wrangler reads `wrangler.jsonc` (output folder `.`, the `DB` binding) and serves the pages and the
Functions together, with a local database in `.wrangler/`. `schema.sql` only creates
`country_queries` and an early `query_events`; the Functions also use `users`, `sessions`,
`plate_queries`, `unknown_queries`, `vehicle_observations` and more `query_events` columns, so a
fresh local database needs those tables too.

## Tests

```bash
node --test tests/*.test.mjs
```

- `tests/plates.test.mjs` checks that the decoder gives the same country and role as the previous
  implementation for every code in `plates.csv` and a few thousand plate shapes, so stats keep
  aggregating under the same country strings. One change is deliberate: a plate whose letters
  aren't a listed code (`DGK 0001`) no longer borrows a shorter code from inside them (`DG`,
  Ecuador). It shows its role letter and the unlisted code, and a lookup logs it as unknown.
- `tests/splunk.test.mjs` runs the HEC module against a local mock collector and calls the real
  `/track`, `/login`, `/unknown` and `/observe` handlers with a fake D1 database.
- `tests/reader.test.mjs` checks the photo reader's pure parts: turning OCR text into plate
  candidates, when a reading counts as clear, and finding a row of characters in synthetic images
  (level, turned, light on dark).

## Reading plates from photos

**Scan a photo** reads the plate in the browser with Tesseract (tesseract.js 5.1.1 from jsDelivr,
loaded on first use). The photo never leaves the device.

Tesseract run on a whole photo reads the small print and misses the plate, so `assets/js/reader.js`
first finds the plate's row of characters (an adaptive threshold, blobs shaped like characters, rows
of 4 to 12 of them), turns the photo so the row is level, redraws only those characters black on
white and reads that as one line, in up to five drawings. What it reads becomes plate candidates,
scored higher when the code is in `plates.csv`:

- 3 letters and 2 to 4 digits (`DCY 0477`, `DJZ 832`, `DTG 76`), the serial first as on UN plates
  in New York (`1034 CYD`), or 2 letters when a separately boxed role letter was missed;
- O/0, I/1, B/8, S/5 and Z/2 fixed by position, a misread role letter fixed when that gives a listed
  code, and J, T or V read as I or Y swapped back, but only as a guess (`plates.csv` is not complete,
  so a wider swap turns real unlisted codes, such as LN, into listed wrong ones).

If the whole photo gives nothing, the reader looks for the plate's pale blue and crimson and reads
up to three such spots up close, which finds plates that are small in a photo of a whole car.

- A clear reading (one read scores at least `CONFIDENT`, two drawings put it first, no other reading
  comes within `RIVAL_MARGIN`, and nothing was guessed) fills in the plate and looks it up. Anything
  less fills in the plate and asks the visitor to check it, with up to two other readings to pick
  from; nothing is counted until they look it up. Readings under `FLOOR` are treated as no plate.
- When the plate isn't found, tapping it in the photo reads that part of the photo at a higher
  resolution.
- Measured in Chrome on 192 Wikimedia Commons street photos of diplomatic cars around Washington,
  100 of them with a legible diplomatic plate: 64 read exactly (41 before these changes), 27 looked
  up without asking, and 1 of those wrong (`DJM 1098` read as `DJH 1098`, also a listed code). Each
  photo took 0.2 s at the median and under 0.8 s at most, after the reader had loaded.
- Plates whose role letter sits in its own box (the 2007 design) are not read; type those.

`functions/ocr.js` (Google Cloud Vision, needs `GOOGLE_VISION_API_KEY`) is still in the repository,
but no page calls it.

## Splunk HEC forwarding

The Functions can send an event to a Splunk HTTP Event Collector for every lookup, unknown code,
vehicle sighting, sign-in, account creation, sign-out and server error. It is off until both
`SPLUNK_HEC_URL` and `SPLUNK_HEC_TOKEN` are set.

How it behaves:

- Delivery runs in `context.waitUntil()`, after the response is built, so visitors never wait for
  Splunk and a slow or unreachable collector cannot change a response.
- Each request has a timeout (`SPLUNK_HEC_TIMEOUT_MS`, 3 s by default). Network errors, `429` and
  `5xx` (HEC answers `503` when its queue is full) are retried (`SPLUNK_HEC_RETRIES`, once by
  default); other `4xx`, such as a bad token (`403`) or an index the token may not write to (`400`),
  are not retried.
- Failures are logged to Workers logs as `[splunk-hec] … not delivered: <status> <message>`.
- Passwords and session ids are never sent. The IP address is sent only as the same SHA-256 hash the
  database already stores (`src_ip_hash`).

### 1. Create a token in Splunk

Splunk Enterprise: **Settings > Data inputs > HTTP Event Collector > New Token**, and turn HEC on
under **Global Settings**. Splunk Cloud: **Settings > Data inputs > HTTP Event Collector > New
Token**. Pick the index (for example `platethatflag`) and, if you like, make `platethatflag:event`
the token's default source type.

The collector has to be reachable from Cloudflare over HTTPS, with a certificate from a public CA
(Splunk Enterprise's default HEC certificate is self-signed):

- Splunk Cloud: `https://http-inputs-<stack>.splunkcloud.com`
- Splunk Enterprise: `https://<host>:8088`. Port 8088 works when the hostname is not proxied by
  Cloudflare. A proxied (orange-cloud) hostname only passes Cloudflare's HTTPS ports: 443, 2053,
  2083, 2087, 2096 and 8443.

### 2. Give the Functions the settings

This repository's `wrangler.jsonc` has `pages_build_output_dir`, so Pages treats it as the source of
truth for the settings it can hold, `vars` among them: the dashboard shows those settings but does
not let you edit them. Secrets never live in that file, so the simplest route is to store every
`SPLUNK_HEC_*` setting as a secret:

- Dashboard: **Workers & Pages > platethatflag > Settings > Variables and Secrets > Add**, choose
  **Encrypt**, then **Save**. Do this for Production, and for Preview if you want preview
  deployments to forward too.
- Or Wrangler, one setting at a time:

  ```bash
  npx wrangler pages secret put SPLUNK_HEC_TOKEN --project-name platethatflag
  ```

Settings reach deployments made after you save them, so redeploy afterwards.

To keep the settings that are not secret in git instead, add a `vars` block to `wrangler.jsonc` and
keep only the token as a secret:

```jsonc
"vars": {
  "SPLUNK_HEC_URL": "https://splunk.example.com:8088",
  "SPLUNK_HEC_INDEX": "platethatflag",
  "SPLUNK_HEC_FIELDS": "{\"env\":\"production\"}"
}
```

For `wrangler pages dev`, put the settings in a `.dev.vars` file next to `wrangler.jsonc`
(`SPLUNK_HEC_TOKEN="..."`, one per line). `.gitignore` keeps it out of commits. This site publishes
its whole folder, so also keep it out of files you upload through GitHub's web page or deploy
with `wrangler pages deploy`.

| Variable | Default | What it does |
| --- | --- | --- |
| `SPLUNK_HEC_URL` | none (off) | Collector base URL or full endpoint. `https://host:8088`, `.../services/collector` and `.../services/collector/raw` are all sent to `.../services/collector/event` |
| `SPLUNK_HEC_TOKEN` | none (off) | HEC token. Store it as a secret |
| `SPLUNK_HEC_ENABLED` | `true` | `false` turns forwarding off without removing the other settings |
| `SPLUNK_HEC_INDEX` | token default | Index to write to; the token must be allowed to write there |
| `SPLUNK_HEC_SOURCETYPE` | `platethatflag:event` | Source type for every event |
| `SPLUNK_HEC_SOURCE` | `platethatflag` | Source for every event |
| `SPLUNK_HEC_HOST` | request hostname | Host for every event |
| `SPLUNK_HEC_EVENTS` | all | Comma-separated event types to send: `lookup`, `unknown_plate`, `sighting`, `login`, `signup`, `logout`, `error` |
| `SPLUNK_HEC_FIELDS` | none | JSON object of indexed fields added to every event, for example `{"env":"production"}` |
| `SPLUNK_HEC_CHANNEL` | none | Channel GUID, sent as `X-Splunk-Request-Channel`; needed when indexer acknowledgment is on |
| `SPLUNK_HEC_TIMEOUT_MS` | `3000` | Per-request timeout, 250 to 10000 |
| `SPLUNK_HEC_RETRIES` | `1` | Retries for network errors, 429 and 5xx, 0 to 3 |
| `SPLUNK_HEC_INCLUDE_IP_HASH` | `true` | `false` leaves out `src_ip_hash` |
| `SPLUNK_HEC_INCLUDE_USER_AGENT` | `true` | `false` leaves out `http_user_agent` |
| `SPLUNK_HEC_DEBUG` | `false` | `true` also logs successful deliveries |

### 3. Check it

Send one test event to the collector from your machine:

```bash
curl -s "https://splunk.example.com:8088/services/collector/event" \
  -H "Authorization: Splunk <token>" \
  -d '{"sourcetype":"platethatflag:event","index":"platethatflag","event":{"event_type":"test"}}'
```

Then look up a plate on the site and search `index=platethatflag sourcetype=platethatflag:event`.

### Events

Every event has `event_type`, `app` (`platethatflag`), `http_method`, `uri_path`, `src_country`
(`CF-IPCountry`), `cf_ray`, `cf_colo`, `src_ip_hash` and `http_user_agent` (unless switched off),
plus:

| `event_type` | Sent by | Fields |
| --- | --- | --- |
| `lookup` | `POST /track` | `country`, `plate`, `mission_role`, `full_plate`, `country_lookups`, `plate_lookups`, `user`, `user_id`, `anonymous`, `status` |
| `unknown_plate` | `POST /unknown` | `plate`, `status` |
| `sighting` | `POST /observe` | `country`, `plate`, `city`, `state`, `vehicle_make`, `vehicle_model`, `vehicle_color`, `user`, `user_id`, `anonymous`, `status` |
| `login` | `POST /login` | `signature`, `action` (`success`, `failure`), `reason` (`missing_fields`, `unknown_user`, `bad_password`), `user`, `user_id`, `status` |
| `signup` | `POST /signup` | `signature`, `action`, `reason` (`missing_fields`, `too_short`, `duplicate_username`), `user`, `user_id`, `status` |
| `logout` | `POST /logout` | `signature`, `action`, `user`, `user_id`, `status` |
| `error` | any of the above on a 500 | `status`, `error` |

Empty values are left out, so a field appears only when it was recorded. `action`, `app`,
`reason`, `signature`, `user` and `user_id` use the CIM Authentication field names; to map
`login` and `signup` events into that data model, alias `src_ip_hash` to `src`.

Example searches:

```spl
index=platethatflag event_type=lookup | stats count by country | sort - count
index=platethatflag event_type=login action=failure | stats count by user, reason, src_ip_hash
index=platethatflag event_type=unknown_plate | stats count by plate | sort - count
index=platethatflag event_type=sighting | stats count by vehicle_make, vehicle_model
```

## Design notes

- One stylesheet, tokens first. The plate's crimson band (`--accent`, sampled from the plate) is the
  only brand hue: full strength on the primary button, the rank bars and the active nav item, pale
  tints of it on areas. Light and dark themes follow the system and can be set in the footer.
- Type: DM Sans for everything, Barlow Condensed only for the plate's characters.
- The plate is typed into a plain text box ("Type your plate here"). The plate under it starts
  blank and fills in as the box does, stamped the way plates are, and Look up plate under the plate
  sends it (so does Enter). On a computer the cursor starts in the box; on a phone it doesn't, so
  the keyboard stays closed until asked for. A press on the plate also puts the cursor in the box.
- The logo is the plate flying as a flag. Each page carries it inline in the header and footer, so
  its outline takes the text colour in light and dark; the favicons use the crimson tile.
- Motion tokens (`--ease-out`, `--ease-in-out`, `--ease-drawer`, `--dur-*`) follow the
  animate and emil-design-eng skills: press feedback, a short arrival for results, the phone menu
  sheet, Sonner-style toasts. Nothing animates while you type, and everything has a
  `prefers-reduced-motion` version.
- Server data is never inserted as HTML: pages build DOM through `h()` in `core.js`, so country
  names, usernames and vehicle details always render as text.
