# Itinerary Template

A private, single-trip itinerary site that runs on Cloudflare's free tier.
Fork it once per trip.

- People view and edit the trip on one page. Signed-in users add events from each day and click an event to edit it.
- Agents use a REST API (plain-text docs at `GET /api`).
- Every reader and writer uses a named key. Every change is logged with the key's name.
- Private by default: viewing and editing both need a key.

Stack: one Cloudflare Worker (pages and API) and a D1 (SQLite) database. Plain HTML, CSS and JavaScript, with no build step.

## Deploy

You need Node.js and a Cloudflare account. All commands use `npx wrangler`, so you don't need a global install.

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

This first runs the date helper unit tests in `test/dates.test.mjs`. It then uses its own throwaway local database and random keys, starts `wrangler dev`, runs the API tests in `test/api.test.mjs`, and runs them again with `VIEW_PUBLIC=true`.

To run only the unit tests: `node --test test/dates.test.mjs`.

The page itself has no automated tests. Use the manual checklist in `docs/plans/2026-10-11-frontend-redesign-design.md`.

Do not point `test/api.test.mjs` at a real deployment. It overwrites the trip details.

## Files

```
src/worker.js         routing, auth, API, validation, audit log
public/index.html     the only page: sign in, setup, itinerary, dialogs
public/edit.html      redirect to / (old link)
public/js/app.js      page startup and state
public/js/api.js      key storage, API calls, DOM helpers
public/js/dates.js    date helpers and day grouping
public/js/timeline.js day list
public/js/setup.js    trip form (setup and edit trip)
public/js/item-dialog.js  add/edit event dialog
public/js/history.js  recent changes panel
public/style.css      styles
schema.sql            D1 tables: trip, items, audit_log
wrangler.toml         Worker, assets, D1 binding, VIEW_PUBLIC
test/                 unit tests and API integration tests
```
