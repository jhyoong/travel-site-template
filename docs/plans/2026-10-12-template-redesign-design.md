# Template Redesign: Design

Date: 2026-10-12
Base: `itinerary-combined.html` (reference prototype, not shipped)

## Goal

Rebuild the app on the `itinerary-combined.html` template: a timeline view and a board view where stops have an order, a duration and a status, and start times are computed from the order, durations and estimated travel. The data model, API and frontend all change. This is a clean break: no migration and no old endpoints.

## Decisions

- Full template behaviour: computed times, statuses (booked, planned, suggested, idea), Ideas column, board drag-and-drop, travel estimates from lat/lng.
- Stop details are edited in a dialog.
- Locations are entered as "lat, lng" or a pasted Google Maps URL. No geocoding service.
- Per-day settings (title, start time, start place, end place) live in a `days` table.
- One shared schedule module (`public/js/schedule.js`) is used by both the page and the Worker, so the API returns the same computed times people see.

## 1. Data model (`schema.sql`, replaces the old one)

**trip** (single row, `id = 1`)
- `name`, `start_date`, `end_date`, `timezone`
- `travellers` INTEGER, optional
- `updated_at`, `updated_by`

**days** (row created on first edit of that date)
- `date` TEXT PRIMARY KEY (YYYY-MM-DD)
- `title` TEXT
- `start_time` TEXT (HH:MM). Default `09:00` when no row exists.
- `start_place`, `start_lat`, `start_lng`: optional. Gives the "Leave" leg.
- `end_place`, `end_lat`, `end_lng`: optional. Gives the "Back" leg.
- `updated_at`, `updated_by`

**stops** (replaces `items`)
- `id` INTEGER PK
- `date` TEXT, NULL means the stop is in Ideas
- `position` INTEGER, order within its column
- `title` TEXT, required
- `area`, `notes`, `link` TEXT, optional
- `kind` TEXT: `train`, `hotel`, `food`, `sight`, `walk`
- `duration_min` INTEGER, required, default 60
- `status` TEXT: `booked`, `planned`, `suggested`, `idea`
- `fixed_time` TEXT (HH:MM), optional: a start time that never moves
- `after_time` TEXT (HH:MM), optional: earliest start
- `stub` TEXT, optional: short booking label ("Car 8")
- `booking_ref` TEXT, optional: full booking details
- `lat`, `lng` REAL, optional
- `created_at`, `created_by`, `updated_at`, `updated_by`

**audit_log**
- Same columns as now.
- Actions: `create`, `update`, `delete`, `move`, `update_trip`, `update_day`.

**Rules the server enforces**
- `status = 'idea'` exactly when `date` is NULL. Moving to Ideas sets `idea`; moving out of Ideas sets `planned`.
- Stop dates and day dates must fall within the trip dates.
- Positions in each column stay as 0..n-1. The server renumbers after every create, move, date change and delete.

Day colours are not stored. The page cycles through a fixed palette by day number.

## 2. API

All writes need a key. Every change is logged with the key name.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api` | Plain-text docs (rewritten) |
| GET | `/api/whoami` | Unchanged |
| GET | `/api/itinerary` | Trip, days with computed schedule, ideas. Key needed unless `VIEW_PUBLIC=true`. |
| PUT | `/api/trip` | Update trip details, including `travellers` |
| PUT | `/api/days/:date` | Create or update a day's settings (partial) |
| POST | `/api/stops` | Create a stop. No `date` means Ideas. Added at the end of its column. |
| PUT | `/api/stops/:id` | Partial update. A `date` change puts the stop at the end of the new column. |
| POST | `/api/stops/:id/move` | Body `{ "date": "YYYY-MM-DD" or null, "index": n }`. Reorder or change column. |
| DELETE | `/api/stops/:id` | Delete a stop |
| GET | `/api/audit?limit=50` | Unchanged |

**`GET /api/itinerary` response**

```json
{
  "trip": { "name": "...", "start_date": "...", "end_date": "...", "timezone": "...", "travellers": 2 },
  "days": [{
    "date": "2026-11-20", "n": 1, "title": "...", "start_time": "10:30",
    "start_place": null, "start_lat": null, "start_lng": null,
    "end_place": "Hotel", "end_lat": 35.0089, "end_lng": 135.77,
    "schedule": {
      "stops": [{ "id": 1, "title": "...", "...": "all stop fields",
                  "start": "10:30", "end": "11:00",
                  "leg": { "mode": "walk", "min": 8, "text": "8 min walk" },
                  "free_min": 0, "late_min": 0 }],
      "start_leg": null, "leave_at": null,
      "back_leg": { "mode": "taxi", "min": 15, "text": "15 min taxi" }, "back_at": "21:05",
      "total_min": 480,
      "clashes": [{ "id": 6, "late_min": 15 }]
    }
  }],
  "ideas": [{ "id": 19, "title": "...", "...": "all stop fields" }]
}
```

- `days` lists every date from `start_date` to `end_date`. Dates without a `days` row get defaults.
- `leg` is null for the first stop of a day.

**Validation (400 with a clear JSON message)**
- Title required. `kind` and `status` must be from their lists.
- Dates and times must match their formats. `duration_min` is 5 to 1440.
- `lat` is -90 to 90, `lng` is -180 to 180, and both or neither must be set.
- `status: "idea"` with a date, or a non-idea status without a date, is rejected. The message points to `/move`.
- Move `index` is clamped to the column length. Missing stop returns 404. Date outside the trip returns 400.
- `PUT /api/trip` that would leave stops outside the new date range is rejected, with a message giving the count.
- Moves and renumbering run in one D1 batch.

**Not enforced on the server**
- "Booked stops stay on their day" is a UI rule only. Agents can change a booked stop's date with `PUT`.

## 3. Frontend

Plain HTML, CSS and JavaScript (ES modules), no build step. The template's markup and CSS are the base. The current sign-in, setup, dialogs and history panel are restyled to match.

| File | Role |
|---|---|
| `public/index.html` | Template layout (header, view switch, timeline, board, menu, toast), plus sign-in, setup, dialogs, history panel |
| `public/style.css` | Template CSS as the base, with existing dialog, form and sign-in styles moved onto its colours and font |
| `public/js/schedule.js` | New, shared with the Worker. `travel()`, `schedule()`, time helpers. Pure functions, no DOM. |
| `public/js/api.js` | Kept: key storage, fetch, errors |
| `public/js/dates.js` | Kept, trimmed: trip day list, date labels |
| `public/js/app.js` | State, load, render, optimistic writes, toast and undo |
| `public/js/timeline.js` | Rewritten from the template's timeline code |
| `public/js/board.js` | New: columns, pointer drag, move menu, add idea |
| `public/js/stop-dialog.js` | Replaces `item-dialog.js`. All stop fields. Location box accepts "lat, lng" or a Google Maps URL. |
| `public/js/day-dialog.js` | New: day title, start time, start and end place |
| `public/js/setup.js` | Kept, adds `travellers` |
| `public/js/history.js` | Kept |
| `public/edit.html` | Kept as a redirect to `/` |

The Worker imports `../public/js/schedule.js`. Wrangler bundles it.

**Additions to the template UI**
- "Edit" button in an expanded timeline card.
- "Edit day" button in each day header, next to "Rearrange". "Add stop" button under each day.
- Header buttons: trip settings, recent changes, log out.

**Data flow**
1. Load `GET /api/itinerary` into state.
2. On a change (move, accept suggestion, add idea), update local state, recompute with `schedule.js`, and re-render.
3. Send the API call. On success, fetch the itinerary again.
4. On failure, show an error toast and fetch again, which reverts the local change.
5. Undo sends the reverse call: move back, revert status, or delete the new idea.
6. Existing guards for stale loads and logout stay.

**Public view (no key)**
- Both views show. Drag handles, edit buttons, suggestion actions and the add-idea form are hidden.

## 4. Error handling

- API keeps the current `HttpError` pattern and JSON messages.
- Failed page writes show a toast with the server message, then refetch.
- The location box shows an inline error if it can't read coordinates. Empty clears the location.
- Stops without a location use the template's "About 15 min travel" fallback.

## 5. Testing

- `test/schedule.test.mjs` (new, `node --test`): travel bands, fixed times, after times, late clashes, free time, leave and back legs, empty day, missing location.
- `test/dates.test.mjs`: kept, trimmed to match `dates.js`.
- `test/api.test.mjs`: rewritten. Covers auth and public mode, day upsert, stop create in a day and in Ideas, the idea/date rule, move (reorder, across days, to and from Ideas, index clamping, positions stay 0..n-1), delete renumbering, trip date shrink rejection, computed times in `GET /api/itinerary`, and audit entries for every action.
- `test/run.sh`: same flow, adds the schedule tests.

**Manual checklist (page)**
- Drag on desktop and on a phone. Move menu by keyboard.
- Booked stop can't be dragged to another day.
- Accept a suggestion, move to Ideas, add an idea, and undo each.
- Stop dialog: create, edit, delete, location parsing (coords, Maps URL, bad input).
- Day dialog: title, start time, places; leave and back legs appear.
- Trip settings, recent changes, log out.
- Public mode hides all edit controls.
- Narrow screens: bottom view switch, board columns snap, long titles wrap.

## 6. Docs

- README: new schema, endpoints and file list.
- `GET /api`: rewritten for the new model.
