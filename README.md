# Itinerary Template

A private, single-trip itinerary site that runs within limits of Cloudflare's free tier (as of OCT 2026).
Meant for single use deployments, so fork it once per trip.

- A timeline view shows each day's stops in order, with times worked out from durations and rough travel estimates. A board view lets you drag stops between days and an Ideas column.
- Stops can be booked (with fixed times), planned, suggested, or ideas.
- A map view shows one day's locations, or the entire trip, with place names in English and the local language.
- Agents use a REST API (plain-text docs at `GET /api`). The API returns the same computed times the page shows.
- Every reader and writer uses a named key. Every change is logged with the key's name.
- Private by default: viewing and editing both need a key.

Stack: one Cloudflare Worker (pages and API) and a D1 (SQLite) database. Plain HTML, CSS and JavaScript, with no build step.

## Dependencies

There is no `package.json` and nothing to install. Everything below is either run with `npx` or loaded by the browser.

To run and deploy:

| Dependency | Used for | Cost and sign-up |
|---|---|---|
| [Cloudflare Workers](https://developers.cloudflare.com/workers/) and [D1](https://developers.cloudflare.com/d1/) | hosting the site, the API and the database | Cloudflare account; free tier is enough |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/) | local development and deploys, run with `npx wrangler` | free |
| [Node.js](https://nodejs.org/) | running Wrangler and the tests (`node --test`) | free |

Loaded by the browser from third parties:

| Dependency | Used for | Cost and sign-up |
|---|---|---|
| [Google Fonts](https://fonts.google.com/) | the Schibsted Grotesk font | free, no key |
| [MapLibre GL JS](https://maplibre.org/) 5.24.0, from the unpkg CDN | drawing the map view; loaded only when the map is opened, with an integrity check | free, open source (BSD), no key |
| [OpenFreeMap](https://openfreemap.org/) | map style, map data and fonts for the map view | free, no key; no uptime guarantee |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | the map data behind OpenFreeMap | free; the credit line on the map must stay |

If unpkg or OpenFreeMap can't be reached, the map view shows an error message and the rest of the site still works. Google Maps is only used for the "Open in Google Maps" links on stops; it needs no key.

## Deploy

You need Node.js and a Cloudflare account. All commands use `npx wrangler`, so you don't need a global install.

To do every step below in one go, run `bash deploy.sh`. It is safe to run again later to redeploy. It also asks for the Worker name (which sets the `workers.dev` URL) and an optional custom domain. A custom domain must be active in your Cloudflare account; Cloudflare creates its DNS record and certificate. The steps it runs are:

1. Fork or clone this repo, then log in:
   ```sh
   npx wrangler login
   ```
2. Create the database, then paste the `database_id` it prints into `wrangler.toml`:
   ```sh
   npx wrangler d1 create itinerary-db
   ```
3. Create the tables:
   ```sh
   npx wrangler d1 execute itinerary-db --remote --file=schema.sql
   ```
4. Set the keys. When prompted, paste a JSON object that maps each name to a key:
   ```sh
   npx wrangler secret put API_KEYS
   ```
   ```json
   {"alice":"k_...","bob":"k_...","claude-agent":"k_..."}
   ```
   To generate a random key:
   ```sh
   node -e 'console.log("k_"+require("crypto").randomBytes(24).toString("hex"))'
   ```
5. Deploy:
   ```sh
   npx wrangler deploy
   ```

Open the URL it prints and sign in with one of your keys.

The first time you sign in, you'll be asked for the trip name, dates and timezone.

## Keys

- Send the key in an `Authorization: Bearer <key>` header. The web pages do this for you after you sign in.
- Every key has the same access: read, write, and view the change log.
- To add or revoke a key, edit the JSON and run `npx wrangler secret put API_KEYS` again. No code changes or redeploy are needed.

## Public viewing

Viewing needs a key by default. To let anyone view the itinerary, set this in `wrangler.toml` and redeploy:

```toml
[vars]
VIEW_PUBLIC = "true"
```

Writes and the change log always need a key.

## Using the API (agents)

`GET /api` returns plain-text docs covering every endpoint, field format and validation rule, with example curl calls. Point an agent at it along with a key.

```sh
curl -H "Authorization: Bearer $KEY" https://<your-worker>/api/itinerary
```

## Local development

```sh
cp .dev.vars.example .dev.vars      # then put real keys in it
npx wrangler d1 execute itinerary-db --local --file=schema.sql
npx wrangler dev
```

Open http://localhost:8787.

## Tests

```sh
bash test/run.sh
```

This first runs the unit tests (`test/dates.test.mjs`, `test/schedule.test.mjs`, `test/location.test.mjs`, `test/map-points.test.mjs`). It then uses its own throwaway local database and random keys, starts `wrangler dev`, runs the API tests in `test/api.test.mjs`, and runs them again with `VIEW_PUBLIC=true`.

To run only the unit tests: `node --test test/dates.test.mjs test/schedule.test.mjs test/location.test.mjs test/map-points.test.mjs`.

To run one group of API tests: `TEST_PATTERN='^move:' bash test/run.sh`.

Do not point `test/api.test.mjs` at a real deployment. It overwrites the trip details.

## Files

```
src/worker.js            routing, auth, API, validation, audit log
public/index.html        the only page: sign in, setup, timeline, board, map, dialogs
public/js/app.js         page startup, state, moves and undo
public/js/api.js         key storage, API calls, DOM helpers
public/js/schedule.js    computed stop times (shared with the Worker)
public/js/dates.js       date helpers (shared with the Worker)
public/js/location.js    reads coordinates from text or a Maps link
public/js/ui.js          icons, escaping, toast
public/js/timeline.js    timeline view
public/js/board.js       board view: drag and move menu
public/js/map.js         map view: loads MapLibre, draws pins, shows load errors
public/js/map-points.js  picks which pins the map shows (no DOM)
public/js/stop-dialog.js add/edit stop dialog
public/js/day-dialog.js  day settings dialog
public/js/setup.js       trip form (setup and trip settings)
public/js/history.js     recent changes panel
public/style.css         styles
schema.sql               D1 tables: trip, days, stops, audit_log
wrangler.toml            Worker, assets, D1 binding, VIEW_PUBLIC
test/                    unit tests and API integration tests
```
