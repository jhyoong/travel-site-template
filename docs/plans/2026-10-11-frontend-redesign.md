# Frontend Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the separate view and edit pages with one page where signed-in users add and edit events in place, with a single-screen first-time setup and a refreshed look.

**Architecture:** `public/index.html` is the only page. It shows one of four states: sign in, setup, loading/error, or itinerary. The JS is split into small native ES modules under `public/js/`, loaded with `<script type="module">`, so there is still no build step. The add/edit form, the edit-trip form and the history panel use the native `<dialog>` element. The Worker and API are unchanged.

**Tech Stack:** Plain HTML, CSS and JS (ES modules), native `<dialog>`, `node --test` for unit tests of the pure date helpers, Cloudflare Worker + D1 (unchanged).

**Design doc:** `docs/plans/2026-10-11-frontend-redesign-design.md`

---

## Background for the implementer

- `src/worker.js` serves everything in `public/` as static files. Only `/api` and `/api/*` go to the Worker code (`wrangler.toml`, `run_worker_first`). New files in `public/js/` are served with no Worker changes.
- API calls send `Authorization: Bearer <key>`. The key is kept in `localStorage` under `itinerary_api_key`.
- `GET /api/itinerary` returns `{ trip: {name, start_date, end_date, timezone, ...}, items: [...] }`. Items are already sorted by date, then all-day items first, then by start time.
- `PUT /api/trip` accepts a partial body. Empty strings become `null`. It rejects an end date before the start date.
- `POST /api/items` returns the new item (with `id`). `PUT /api/items/:id` returns the updated item. On update, `""` clears an optional field.
- Any 401 means the key is wrong or was revoked. The page must clear the key and go back to sign-in.
- Node 22 can import the ES module files in `public/js/` directly, because there is no `package.json`. This is how the unit tests load `dates.js`.

## Local setup for manual checks

Use a separate local database so your normal dev data is not touched:

```sh
cp .dev.vars.example .dev.vars   # if you don't have one; put a real key in it
npx wrangler d1 execute itinerary-db --local --persist-to .wrangler/ui-state --file=schema.sql
npx wrangler dev --persist-to .wrangler/ui-state
```

Open http://localhost:8787. To get back to a fresh, un-set-up trip, run `rm -rf .wrangler/ui-state` and run the two commands again.

---

### Task 1: Date helpers with unit tests

**Files:**
- Create: `public/js/dates.js`
- Create: `test/dates.test.mjs`
- Modify: `test/run.sh` (run unit tests first)

**Step 1: Write the failing tests**

Create `test/dates.test.mjs`:

```js
// Unit tests for the pure date helpers used by the page.
// Run: node --test test/dates.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, buildDays, formatDay, formatDateRange, formatTimeRange, MAX_DAYS
} from "../public/js/dates.js";

const trip = { start_date: "2026-10-12", end_date: "2026-10-14" };
const item = (id, date, start_time = null) => ({ id, date, start_time, title: "Item " + id });

test("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-12-31", 2), "2027-01-02");
});

test("formatDay shows weekday, day and month", () => {
  assert.equal(formatDay("2026-10-14"), "Wed 14 Oct");
  assert.equal(formatDay("bad"), "bad");
});

test("formatDateRange", () => {
  assert.equal(formatDateRange("2026-10-12", "2026-10-14"), "12 Oct 2026 to 14 Oct 2026");
  assert.equal(formatDateRange("2026-10-12", null), "From 12 Oct 2026");
  assert.equal(formatDateRange(null, "2026-10-14"), "Until 14 Oct 2026");
  assert.equal(formatDateRange(null, null), "");
});

test("formatTimeRange", () => {
  assert.equal(formatTimeRange("09:00", "10:30"), "09:00 – 10:30");
  assert.equal(formatTimeRange("09:00", null), "09:00");
  assert.equal(formatTimeRange(null, "10:30"), "Until 10:30");
  assert.equal(formatTimeRange(null, null), "All day");
});

test("buildDays lists every trip day, including empty ones", () => {
  const days = buildDays(trip, []);
  assert.deepEqual(days.map((d) => [d.date, d.dayNumber, d.outside, d.items.length]), [
    ["2026-10-12", 1, false, 0],
    ["2026-10-13", 2, false, 0],
    ["2026-10-14", 3, false, 0],
  ]);
});

test("buildDays puts items on their day in the given order", () => {
  const days = buildDays(trip, [item(1, "2026-10-13", "09:00"), item(2, "2026-10-13", "12:00")]);
  assert.deepEqual(days[1].items.map((i) => i.id), [1, 2]);
  assert.equal(days[0].items.length, 0);
});

test("buildDays marks items outside the trip dates", () => {
  const days = buildDays(trip, [item(1, "2026-10-10"), item(2, "2026-10-20")]);
  assert.deepEqual(days.map((d) => [d.date, d.dayNumber, d.outside]), [
    ["2026-10-10", null, true],
    ["2026-10-12", 1, false],
    ["2026-10-13", 2, false],
    ["2026-10-14", 3, false],
    ["2026-10-20", null, true],
  ]);
});

test("buildDays without trip dates shows only days that have items", () => {
  const days = buildDays({}, [item(1, "2026-10-13")]);
  assert.deepEqual(days.map((d) => [d.date, d.dayNumber, d.outside]), [["2026-10-13", null, false]]);
});

test("buildDays ignores a range where the end is before the start", () => {
  assert.deepEqual(buildDays({ start_date: "2026-10-14", end_date: "2026-10-12" }, []), []);
});

test("buildDays draws at most MAX_DAYS empty days", () => {
  const days = buildDays({ start_date: "2026-01-01", end_date: "2030-01-01" }, []);
  assert.equal(days.length, MAX_DAYS);
});

test("buildDays numbers an in-range item past the MAX_DAYS limit", () => {
  const days = buildDays({ start_date: "2026-01-01", end_date: "2030-01-01" }, [item(1, "2028-01-01")]);
  const last = days[days.length - 1];
  assert.equal(last.date, "2028-01-01");
  assert.equal(last.outside, false);
  assert.equal(last.dayNumber, 731);
});
```

**Step 2: Run the tests to verify they fail**

Run: `node --test test/dates.test.mjs`
Expected: FAIL with `Cannot find module '.../public/js/dates.js'`.

**Step 3: Write the implementation**

Create `public/js/dates.js`:

```js
// Date and time helpers. No DOM access, so they can be unit tested
// with node --test (see test/dates.test.mjs).

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Most empty days drawn for one trip, so a typo in the end date
// (e.g. 2062 instead of 2026) can't freeze the page.
export const MAX_DAYS = 366;

// "2026-10-12" -> Date at UTC midnight, or null. Using UTC means the
// browser timezone never shifts the day.
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

export function addDays(dateStr, n) {
  const dt = parseDate(dateStr);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// "2026-10-14" -> "Wed 14 Oct"
export function formatDay(dateStr) {
  const dt = parseDate(dateStr);
  if (!dt) return dateStr || "";
  return DAYS[dt.getUTCDay()] + " " + dt.getUTCDate() + " " + MONTHS[dt.getUTCMonth()];
}

// "2026-10-14" -> "14 Oct 2026"
function formatShortDate(dateStr) {
  const dt = parseDate(dateStr);
  if (!dt) return dateStr || "";
  return dt.getUTCDate() + " " + MONTHS[dt.getUTCMonth()] + " " + dt.getUTCFullYear();
}

export function formatDateRange(start, end) {
  if (start && end) return formatShortDate(start) + " to " + formatShortDate(end);
  if (start) return "From " + formatShortDate(start);
  if (end) return "Until " + formatShortDate(end);
  return "";
}

export function formatTimeRange(start, end) {
  if (start && end) return start + " – " + end;
  if (start) return start;
  if (end) return "Until " + end;
  return "All day";
}

// ISO timestamp -> local date and time in the browser's locale.
export function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function dayNumber(start, date) {
  return Math.round((parseDate(date) - parseDate(start)) / 86400000) + 1;
}

// Groups items into days for the timeline.
// Returns [{ date, dayNumber, outside, items }] sorted by date.
// - If the trip has a valid start and end date, every day in that range is
//   included (up to MAX_DAYS), even days with no items.
// - Items on other dates get their own day with dayNumber null and
//   outside true. Without a trip range, outside is always false.
// - Items keep the order they were given in (the API already sorts them).
export function buildDays(trip, items) {
  const start = trip && trip.start_date;
  const end = trip && trip.end_date;
  const hasRange = !!(parseDate(start) && parseDate(end)) && start <= end;
  const byDate = new Map();
  if (hasRange) {
    for (let d = start, n = 1; d <= end && n <= MAX_DAYS; d = addDays(d, 1), n++) {
      byDate.set(d, { date: d, dayNumber: n, outside: false, items: [] });
    }
  }
  for (const item of items || []) {
    let day = byDate.get(item.date);
    if (!day) {
      const inRange = hasRange && item.date >= start && item.date <= end;
      day = {
        date: item.date,
        dayNumber: inRange ? dayNumber(start, item.date) : null,
        outside: hasRange && !inRange,
        items: []
      };
      byDate.set(item.date, day);
    }
    day.items.push(item);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
```

**Step 4: Run the tests to verify they pass**

Run: `node --test test/dates.test.mjs`
Expected: all 11 tests pass, `# fail 0`.

**Step 5: Run unit tests from `test/run.sh`**

In `test/run.sh`, add these lines just before the line `KEYS_JSON="{\"alice\":...`:

```bash
echo "==> Running unit tests"
node --test --test-reporter=spec test/dates.test.mjs
```

Also update the usage comment at the top of the file. Replace:

```bash
# Runs the API integration tests end to end:
#   1. generates random test keys into a temporary env file
```

with:

```bash
# Runs the unit tests, then the API integration tests end to end:
#   0. runs the date helper unit tests (test/dates.test.mjs)
#   1. generates random test keys into a temporary env file
```

**Step 6: Commit**

```bash
git add public/js/dates.js test/dates.test.mjs test/run.sh
git commit -m "Add date helpers for the day timeline, with unit tests"
```

---

### Task 2: Shared API and DOM helpers as an ES module

This is `public/common.js` turned into an ES module, minus the date code (now in `dates.js`) and the login code (moving to `app.js`). Do not delete `common.js` yet. The old pages still use it until Task 7.

**Files:**
- Create: `public/js/api.js`

**Step 1: Create `public/js/api.js`**

```js
// Key storage, API calls and small DOM helpers shared by all modules.

const KEY_NAME = "itinerary_api_key";

export function getKey() {
  try { return localStorage.getItem(KEY_NAME) || ""; } catch (e) { return ""; }
}
export function setKey(key) { localStorage.setItem(KEY_NAME, key); }
export function clearKey() {
  try { localStorage.removeItem(KEY_NAME); } catch (e) { /* ignore */ }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Calls the API. Returns parsed JSON on success; throws ApiError otherwise.
// opts: { key: string to override the stored key, noKey: true to send none }
export async function api(method, path, body, opts = {}) {
  const headers = {};
  const key = opts.noKey ? "" : (opts.key !== undefined ? opts.key : getKey());
  if (key) headers["Authorization"] = "Bearer " + key;
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new ApiError(0, "Network error: could not reach the server.");
  }
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = null; }
  }
  if (!res.ok) {
    const msg = data && typeof data.error === "string" ? data.error : "Request failed (HTTP " + res.status + ").";
    throw new ApiError(res.status, msg);
  }
  return data;
}

// Builds a DOM element. attrs keys: class, text, href, on<event>, and any
// other attribute. Children may be nodes or strings (strings become text).
// null, undefined and false attributes or children are skipped.
export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  attrs = attrs || {};
  Object.keys(attrs).forEach((k) => {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) return;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "href") { const h = safeHref(v); if (h) node.setAttribute("href", h); }
    else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  });
  (children || []).forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Only allow http(s) links.
export function safeHref(url) {
  if (typeof url !== "string") return "";
  const u = url.trim();
  return /^https?:\/\//i.test(u) ? u : "";
}

export function showError(node, message) {
  node.textContent = message || "";
  node.hidden = !message;
}
```

**Step 2: Check it parses**

Run: `node --check public/js/api.js`
Expected: no output, exit code 0.

**Step 3: Commit**

```bash
git add public/js/api.js
git commit -m "Add api.js ES module with shared API and DOM helpers"
```

---

### Task 3: Timeline (day list)

**Files:**
- Create: `public/js/timeline.js`

**Step 1: Create `public/js/timeline.js`**

```js
// Draws the trip as a list of days, each with its items and,
// for signed-in users, a "+ Add" button.
import { el, clear, safeHref } from "./api.js";
import { buildDays, formatDay, formatTimeRange } from "./dates.js";

// opts: { canEdit, onAdd(date), onEdit(item), highlightId }
export function renderTimeline(container, trip, items, opts) {
  clear(container);
  const days = buildDays(trip, items);
  if (days.length === 0) {
    container.appendChild(el("p", {
      class: "empty",
      text: opts.canEdit ? "No dates yet. Use Edit trip to set the trip dates." : "Nothing planned yet."
    }));
    return;
  }
  days.forEach((day) => container.appendChild(renderDay(day, opts)));
}

function renderDay(day, opts) {
  const label = (day.dayNumber ? "Day " + day.dayNumber + " · " : "") + formatDay(day.date);
  const children = [
    el("h2", { class: "day-heading" }, [
      el("span", { text: label }),
      day.outside ? el("span", { class: "tag", text: "Outside trip dates" }) : null
    ])
  ];
  if (day.items.length) {
    children.push(el("ol", { class: "items" }, day.items.map((item) => renderItem(item, opts))));
  } else if (!opts.canEdit) {
    children.push(el("p", { class: "empty", text: "Nothing planned." }));
  }
  if (opts.canEdit) {
    children.push(el("button", {
      type: "button",
      class: "add-button",
      text: "+ Add",
      "aria-label": "Add event on " + label,
      onclick: () => opts.onAdd(day.date)
    }));
  }
  return el("section", { class: "day" }, children);
}

function renderItem(item, opts) {
  const card = [el("h3", { class: "item-title", text: item.title || "" })];
  if (item.location) card.push(el("p", { class: "item-location", text: item.location }));
  if (item.notes) card.push(el("p", { class: "item-notes", text: item.notes }));
  const href = safeHref(item.link);
  if (href) {
    card.push(el("p", { class: "item-link" }, [
      el("a", { href, target: "_blank", rel: "noopener noreferrer", text: href })
    ]));
  }
  const li = el("li", {
    class: "item" + (item.id === opts.highlightId ? " highlight" : ""),
    "data-id": item.id
  }, [
    el("div", { class: "item-time", text: formatTimeRange(item.start_time, item.end_time) }),
    el("div", { class: "item-card" }, card)
  ]);
  if (opts.canEdit) {
    // The whole row opens the editor. Clicks on the item's link still
    // open the link. Keyboard users can Tab to the row and press Enter.
    li.classList.add("editable");
    li.tabIndex = 0;
    li.title = "Click to edit";
    li.addEventListener("click", (ev) => {
      if (ev.target.closest("a")) return;
      opts.onEdit(item);
    });
    li.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target === li) {
        ev.preventDefault();
        opts.onEdit(item);
      }
    });
  }
  return li;
}
```

**Step 2: Check it parses**

Run: `node --check public/js/timeline.js`
Expected: no output, exit code 0.

**Step 3: Commit**

```bash
git add public/js/timeline.js
git commit -m "Add timeline module that draws every trip day with add buttons"
```

---

### Task 4: Trip form (setup and edit trip)

One function builds the trip form. It is used in two places: the setup card (label "Create trip", no Cancel) and the Edit trip dialog (label "Save", with Cancel). The inputs are wrapped in `<label>` elements, so the form needs no ids and can be built twice.

**Files:**
- Create: `public/js/setup.js`

**Step 1: Create `public/js/setup.js`**

```js
// Trip form, used for first-time setup and for "Edit trip".
import { api, el, clear, showError } from "./api.js";

const TZ_LIST_ID = "tz-list";

export function browserTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; }
}

// Adds a <datalist> of all IANA timezones to the page once, so the
// timezone input can suggest matches as the user types.
function ensureTimezoneList() {
  if (document.getElementById(TZ_LIST_ID)) return TZ_LIST_ID;
  let zones = [];
  try { zones = Intl.supportedValuesOf("timeZone"); } catch (e) { /* older browser: free text only */ }
  const list = el("datalist", { id: TZ_LIST_ID },
    ["UTC", ...zones.filter((z) => z !== "UTC")].map((z) => el("option", { value: z })));
  document.body.appendChild(list);
  return TZ_LIST_ID;
}

function field(label, input) {
  return el("label", { class: "field" }, [el("span", { text: label }), input]);
}

// Builds the trip form inside container.
// opts: { trip, submitLabel, onSaved(trip), onCancel (optional), onAuthFailed() }
export function renderTripForm(container, opts) {
  clear(container);
  const trip = opts.trip || {};
  const nameIn = el("input", {
    name: "name", type: "text", required: true, maxlength: 200,
    value: trip.name || "", placeholder: "e.g. Japan in October"
  });
  const startIn = el("input", { name: "start_date", type: "date", required: true, value: trip.start_date || "" });
  const endIn = el("input", {
    name: "end_date", type: "date", required: true,
    value: trip.end_date || "", min: trip.start_date || null
  });
  const tzIn = el("input", {
    name: "timezone", type: "text", required: true, maxlength: 64, autocomplete: "off",
    list: ensureTimezoneList(), value: trip.timezone || browserTimezone(),
    placeholder: "Start typing, e.g. Tokyo"
  });

  // Keep the end date on or after the start date, and fill it in
  // when the start date is picked first.
  startIn.addEventListener("change", () => {
    endIn.min = startIn.value;
    if (startIn.value && (!endIn.value || endIn.value < startIn.value)) endIn.value = startIn.value;
  });

  const error = el("p", { class: "error", role: "alert", hidden: true });
  const submit = el("button", { type: "submit", text: opts.submitLabel });
  const form = el("form", { class: "trip-form" }, [
    field("Trip name", nameIn),
    el("div", { class: "row" }, [field("Start date", startIn), field("End date", endIn)]),
    field("Timezone", tzIn),
    error,
    el("div", { class: "actions" }, [
      submit,
      opts.onCancel ? el("button", { type: "button", class: "secondary", text: "Cancel", onclick: opts.onCancel }) : null
    ])
  ]);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    showError(error, "");
    submit.disabled = true;
    try {
      const saved = await api("PUT", "/api/trip", {
        name: nameIn.value.trim(),
        start_date: startIn.value,
        end_date: endIn.value,
        timezone: tzIn.value.trim()
      });
      opts.onSaved(saved);
    } catch (e) {
      if (e.status === 401) opts.onAuthFailed();
      else showError(error, e.message);
    } finally {
      submit.disabled = false;
    }
  });

  container.appendChild(form);
  nameIn.focus();
}
```

**Step 2: Check it parses**

Run: `node --check public/js/setup.js`
Expected: no output, exit code 0.

**Step 3: Commit**

```bash
git add public/js/setup.js
git commit -m "Add trip form module for setup and edit trip"
```

---

### Task 5: Add/edit item dialog

The dialog markup goes into `index.html` in Task 7. This module finds it by id.

Key behaviour:
- **Save** is the first submit button, so pressing Enter in any single-line field saves.
- `ev.submitter.value` tells **Save** and **Save and add another** apart.
- Esc closes the dialog. This is built into `<dialog>`.
- **Delete** needs two clicks. The first click changes its label to "Confirm delete".

**Files:**
- Create: `public/js/item-dialog.js`

**Step 1: Create `public/js/item-dialog.js`**

```js
// The add/edit event dialog (#item-dialog in index.html).
import { api, showError } from "./api.js";

const FIELDS = ["title", "start_time", "end_time", "location", "notes", "link", "date"];
const OPTIONAL = ["start_time", "end_time", "location", "notes", "link"];

// opts: { onSaved(itemId), onDeleted(), onAuthFailed() }
// Returns { openAdd(date), openEdit(item) }.
export function initItemDialog(opts) {
  const dialog = document.getElementById("item-dialog");
  const form = document.getElementById("item-form");
  const heading = document.getElementById("item-dialog-title");
  const error = form.querySelector(".error");
  const ok = form.querySelector(".ok");
  const anotherBtn = form.querySelector('button[value="another"]');
  const deleteBtn = form.querySelector('[data-action="delete"]');
  const inputs = {};
  FIELDS.forEach((f) => { inputs[f] = form.elements[f]; });

  let editing = null; // the item being edited, or null when adding
  let busy = false;

  function setBusy(value) {
    busy = value;
    form.querySelectorAll("button").forEach((b) => { b.disabled = value; });
  }

  function open(item, date) {
    editing = item;
    form.reset();
    FIELDS.forEach((f) => { inputs[f].value = item && item[f] != null ? item[f] : ""; });
    if (!item) inputs.date.value = date;
    heading.textContent = item ? "Edit event" : "Add event";
    anotherBtn.hidden = !!item;
    deleteBtn.hidden = !item;
    deleteBtn.textContent = "Delete";
    deleteBtn.dataset.confirm = "";
    showError(error, "");
    ok.hidden = true;
    setBusy(false);
    if (!dialog.open) dialog.showModal();
    inputs.title.focus();
  }

  function body() {
    const b = { date: inputs.date.value, title: inputs.title.value.trim() };
    OPTIONAL.forEach((k) => {
      const v = inputs[k].value.trim();
      // On edit, "" clears the field. On create, leave empty fields out.
      if (editing || v !== "") b[k] = v;
    });
    return b;
  }

  // Runs one API action with buttons disabled and errors shown in the dialog.
  async function run(action) {
    showError(error, "");
    ok.hidden = true;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      if (e.status === 401) { dialog.close(); opts.onAuthFailed(); }
      else showError(error, e.message);
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (busy) return;
    const another = ev.submitter && ev.submitter.value === "another";
    run(async () => {
      const saved = editing
        ? await api("PUT", "/api/items/" + encodeURIComponent(editing.id), body())
        : await api("POST", "/api/items", body());
      if (another) {
        open(null, inputs.date.value);
        ok.textContent = "Saved “" + saved.title + "”. Add the next one.";
        ok.hidden = false;
      } else {
        dialog.close();
      }
      opts.onSaved(saved.id);
    });
  });

  deleteBtn.addEventListener("click", () => {
    if (deleteBtn.dataset.confirm !== "yes") {
      deleteBtn.dataset.confirm = "yes";
      deleteBtn.textContent = "Confirm delete";
      return;
    }
    run(async () => {
      await api("DELETE", "/api/items/" + encodeURIComponent(editing.id));
      dialog.close();
      opts.onDeleted();
    });
  });

  form.querySelector('[data-action="cancel"]').addEventListener("click", () => dialog.close());

  return {
    openAdd: (date) => open(null, date),
    openEdit: (item) => open(item)
  };
}
```

**Step 2: Check it parses**

Run: `node --check public/js/item-dialog.js`
Expected: no output, exit code 0.

**Step 3: Commit**

```bash
git add public/js/item-dialog.js
git commit -m "Add item dialog module with save, save and add another, and delete"
```

---

### Task 6: History panel

**Files:**
- Create: `public/js/history.js`

**Step 1: Create `public/js/history.js`**

```js
// The recent changes panel (#history-dialog in index.html).
// Loads the audit log each time it is opened.
import { api, el, clear, showError } from "./api.js";
import { formatTimestamp } from "./dates.js";

const ACTIONS = { create: "added", update: "edited", "delete": "deleted", update_trip: "updated the trip" };

function describe(entry) {
  const snap = entry.after || entry.before || {};
  let subject = "";
  if (entry.action === "update_trip") subject = snap.name ? " “" + snap.name + "”" : "";
  else if (snap.title) subject = " “" + snap.title + "”";
  return (ACTIONS[entry.action] || entry.action) + subject;
}

// opts: { onAuthFailed() }. Returns { open() }.
export function initHistory(opts) {
  const dialog = document.getElementById("history-dialog");
  const list = dialog.querySelector(".audit");
  const status = dialog.querySelector(".status");
  const error = dialog.querySelector(".error");

  dialog.querySelector('[data-action="close"]').addEventListener("click", () => dialog.close());

  function render(entries) {
    if (!entries || entries.length === 0) {
      list.appendChild(el("li", { class: "empty", text: "No changes yet." }));
      return;
    }
    entries.forEach((en) => {
      list.appendChild(el("li", {}, [
        el("span", { class: "audit-time muted", text: formatTimestamp(en.ts) }),
        el("strong", { text: en.actor || "unknown" }),
        " " + describe(en)
      ]));
    });
  }

  async function open() {
    clear(list);
    showError(error, "");
    status.textContent = "Loading...";
    status.hidden = false;
    dialog.showModal();
    try {
      const data = await api("GET", "/api/audit?limit=50");
      render(data && data.entries);
    } catch (e) {
      if (e.status === 401) { dialog.close(); opts.onAuthFailed(); }
      else showError(error, e.message);
    } finally {
      status.hidden = true;
    }
  }

  return { open };
}
```

**Step 2: Check it parses**

Run: `node --check public/js/history.js`
Expected: no output, exit code 0.

**Step 3: Commit**

```bash
git add public/js/history.js
git commit -m "Add history panel module"
```

---

### Task 7: Single page, app startup, redirect and removal of old files

**Files:**
- Create: `public/js/app.js`
- Replace: `public/index.html`
- Replace: `public/edit.html` (redirect only)
- Delete: `public/common.js`

**Step 1: Create `public/js/app.js`**

```js
// Page startup. Decides which state to show (sign in, setup, loading,
// itinerary) and connects the other modules.
import { api, getKey, setKey, clearKey, showError } from "./api.js";
import { formatDateRange } from "./dates.js";
import { renderTimeline } from "./timeline.js";
import { renderTripForm } from "./setup.js";
import { initItemDialog } from "./item-dialog.js";
import { initHistory } from "./history.js";

const $ = (id) => document.getElementById(id);
const STATES = ["status", "signin-section", "setup-section", "trip-section"];

let user = "";   // signed-in key name; "" when signed out or read-only
let data = null; // last { trip, items } from GET /api/itinerary

const itemDialog = initItemDialog({
  onSaved: (id) => load(id),
  onDeleted: () => load(),
  onAuthFailed: authFailed
});
const history = initHistory({ onAuthFailed: authFailed });

function show(id) {
  STATES.forEach((s) => { $(s).hidden = s !== id; });
}

function setStatus(text) {
  $("status").textContent = text;
  show("status");
}

function isSetUp(trip) {
  return !!(trip && trip.name && trip.start_date && trip.end_date);
}

function renderTopbar() {
  $("signed-in").textContent = user ? "Signed in as " + user : "";
  $("signed-in").hidden = !user;
  $("history-button").hidden = !user;
  $("logout-button").hidden = !user;
  // Only shown to read-only visitors when VIEW_PUBLIC is on.
  $("signin-button").hidden = !!user || !data;
}

function showSignIn(message) {
  user = "";
  data = null;
  renderTopbar();
  showError($("signin-error"), message || "");
  show("signin-section");
  $("signin-key").focus();
}

function authFailed() {
  clearKey();
  showSignIn("Your key was not accepted. Please sign in again.");
}

function showSetup() {
  renderTripForm($("setup-form"), {
    trip: data.trip,
    submitLabel: "Create trip",
    onSaved: () => load(),
    onAuthFailed: authFailed
  });
  show("setup-section");
}

function renderTrip(highlightId) {
  const trip = data.trip || {};
  $("trip-name").textContent = trip.name || "Untitled trip";
  document.title = trip.name || "Itinerary";
  const meta = [formatDateRange(trip.start_date, trip.end_date), trip.timezone ? "Times in " + trip.timezone : ""];
  $("trip-meta").textContent = meta.filter(Boolean).join(" · ");
  $("edit-trip-button").hidden = !user;
  renderTimeline($("days"), trip, data.items || [], {
    canEdit: !!user,
    highlightId,
    onAdd: itemDialog.openAdd,
    onEdit: itemDialog.openEdit
  });
  show("trip-section");
  if (highlightId != null) {
    const node = $("days").querySelector('[data-id="' + highlightId + '"]');
    if (node) node.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

// Fetches the itinerary (and the key name on first load) and shows the
// right state. highlightId briefly highlights a just-saved item.
async function load(highlightId) {
  const key = getKey();
  if (!data) setStatus("Loading...");
  showError($("page-error"), "");
  try {
    const [itinerary, who] = await Promise.all([
      api("GET", "/api/itinerary", undefined, key ? {} : { noKey: true }),
      key && !user ? api("GET", "/api/whoami") : null
    ]);
    data = itinerary;
    if (who) user = who.name || "";
    renderTopbar();
    if (user && !isSetUp(data.trip)) showSetup();
    else renderTrip(highlightId);
  } catch (e) {
    if (e.status === 401) {
      if (key) authFailed();
      else showSignIn("");
    } else {
      $("status").hidden = true;
      showError($("page-error"), e.message);
    }
  }
}

$("signin-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const input = $("signin-key");
  const button = ev.target.querySelector("button[type=submit]");
  const key = input.value.trim();
  if (!key) { showError($("signin-error"), "Please enter your key."); return; }
  showError($("signin-error"), "");
  button.disabled = true;
  try {
    const who = await api("GET", "/api/whoami", undefined, { key });
    setKey(key);
    input.value = "";
    user = (who && who.name) || "";
    await load();
  } catch (e) {
    showError($("signin-error"), e.status === 401 ? "That key was not accepted." : e.message);
  } finally {
    button.disabled = false;
  }
});

$("signin-button").addEventListener("click", () => showSignIn(""));
$("logout-button").addEventListener("click", () => { clearKey(); showSignIn(""); });
$("history-button").addEventListener("click", () => history.open());
$("edit-trip-button").addEventListener("click", () => {
  const dialog = $("trip-dialog");
  renderTripForm($("trip-dialog-form"), {
    trip: data.trip,
    submitLabel: "Save",
    onCancel: () => dialog.close(),
    onSaved: () => { dialog.close(); load(); },
    onAuthFailed: () => { dialog.close(); authFailed(); }
  });
  dialog.showModal();
});

load();
```

**Step 2: Replace `public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Itinerary</title>
  <link rel="stylesheet" href="style.css">
  <script type="module" src="js/app.js"></script>
</head>
<body>
  <header class="topbar">
    <span class="brand">Itinerary</span>
    <div class="user-bar">
      <span id="signed-in" class="muted" hidden></span>
      <button type="button" id="history-button" class="ghost" hidden>History</button>
      <button type="button" id="signin-button" class="ghost" hidden>Sign in to edit</button>
      <button type="button" id="logout-button" class="ghost" hidden>Log out</button>
    </div>
  </header>

  <main>
    <p id="page-error" class="error" role="alert" hidden></p>
    <p id="status" class="status">Loading...</p>

    <section id="signin-section" class="card narrow" hidden>
      <h1>Sign in</h1>
      <p class="muted">Enter the key you were given.</p>
      <form id="signin-form">
        <label class="field">
          <span>Your key</span>
          <input id="signin-key" type="password" autocomplete="current-password" required>
        </label>
        <p id="signin-error" class="error" role="alert" hidden></p>
        <div class="actions"><button type="submit">Sign in</button></div>
      </form>
    </section>

    <section id="setup-section" class="card narrow" hidden>
      <h1>Set up your trip</h1>
      <p class="muted">You can change these later.</p>
      <div id="setup-form"></div>
    </section>

    <section id="trip-section" hidden>
      <div class="trip-header">
        <div>
          <h1 id="trip-name"></h1>
          <p id="trip-meta" class="muted"></p>
        </div>
        <button type="button" id="edit-trip-button" class="secondary" hidden>Edit trip</button>
      </div>
      <div id="days"></div>
    </section>
  </main>

  <dialog id="item-dialog" class="sheet" aria-labelledby="item-dialog-title">
    <form id="item-form">
      <h2 id="item-dialog-title">Add event</h2>
      <p class="ok" role="status" hidden></p>
      <label class="field">
        <span>Title</span>
        <input name="title" type="text" required maxlength="200" autocomplete="off">
      </label>
      <div class="row">
        <label class="field"><span>Start time</span><input name="start_time" type="time"></label>
        <label class="field"><span>End time</span><input name="end_time" type="time"></label>
      </div>
      <label class="field"><span>Location</span><input name="location" type="text" maxlength="300"></label>
      <label class="field"><span>Notes</span><textarea name="notes" rows="3" maxlength="5000"></textarea></label>
      <label class="field"><span>Link</span><input name="link" type="url" placeholder="https://"></label>
      <label class="field"><span>Date</span><input name="date" type="date" required></label>
      <p class="error" role="alert" hidden></p>
      <div class="actions">
        <button type="submit" value="save">Save</button>
        <button type="submit" value="another" class="secondary">Save and add another</button>
        <button type="button" class="secondary" data-action="cancel">Cancel</button>
        <button type="button" class="danger" data-action="delete">Delete</button>
      </div>
    </form>
  </dialog>

  <dialog id="trip-dialog" class="sheet" aria-labelledby="trip-dialog-title">
    <h2 id="trip-dialog-title">Edit trip</h2>
    <div id="trip-dialog-form"></div>
  </dialog>

  <dialog id="history-dialog" class="panel" aria-labelledby="history-title">
    <div class="panel-header">
      <h2 id="history-title">History</h2>
      <button type="button" class="secondary" data-action="close">Close</button>
    </div>
    <p class="status" hidden></p>
    <p class="error" role="alert" hidden></p>
    <ol class="audit"></ol>
  </dialog>
</body>
</html>
```

**Step 3: Replace `public/edit.html` with a redirect**

Cloudflare may serve this file at `/edit` (it drops `.html`), so the redirect target is the relative `./`, which resolves to `/` from both `/edit` and `/edit.html`.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=./">
  <title>Itinerary</title>
</head>
<body>
  <p>Editing now happens on the <a href="./">main page</a>.</p>
</body>
</html>
```

**Step 4: Delete the old shared script**

```bash
git rm public/common.js
```

Then confirm nothing still refers to it:

Run: `grep -rn "common.js" public src`
Expected: no output.

**Step 5: Smoke test in the browser**

Start the app as described in "Local setup for manual checks" above, using a fresh `.wrangler/ui-state`. Open http://localhost:8787 and check:
1. The sign-in card appears. Signing in with your key shows the "Set up your trip" card.
2. Filling in the form and clicking "Create trip" shows the itinerary, with one heading per day.
3. "+ Add" on a day opens the dialog with that date. Saving adds the item under that day.
4. The browser console shows no errors.

The page will look unstyled or partly styled at this point. Task 8 fixes that.

**Step 6: Commit**

```bash
git add public/index.html public/edit.html public/js/app.js
git commit -m "Merge view and edit into one page with setup screen and dialogs"
```

---

### Task 8: Rewrite the stylesheet

**Files:**
- Replace: `public/style.css`

**Step 1: Replace `public/style.css`**

```css
/* Itinerary styles. Light and dark palettes come from the CSS variables
   below. Layout switches to one column at 640px and narrower. */

:root {
  --bg: #f5f6f8;
  --card: #ffffff;
  --text: #1b2230;
  --muted: #5f6b7a;
  --border: #dde2e9;
  --line: #c9d1dc;
  --accent: #2459c4;
  --accent-soft: #e8effc;
  --accent-text: #ffffff;
  --danger: #b42318;
  --ok: #157f3b;
  --error-bg: #fdecea;
  --radius: 12px;
  --shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 4px 16px rgb(0 0 0 / 0.04);
  --time-col: 7.5rem;
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121519;
    --card: #1b1f26;
    --text: #e6e9ee;
    --muted: #9aa5b4;
    --border: #2e343e;
    --line: #3a4250;
    --accent: #7aa7ff;
    --accent-soft: #1e2a40;
    --accent-text: #0d1117;
    --danger: #ff8a80;
    --ok: #6fd391;
    --error-bg: #3a1f1f;
    --shadow: none;
  }
}

* { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 16px;
  line-height: 1.5;
}

a { color: var(--accent); }

[hidden] { display: none !important; }

h1, h2, h3 { line-height: 1.25; margin: 0; }
h1 { font-size: 1.75rem; }

.muted { color: var(--muted); }

/* ---------- Top bar ---------- */

.topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.25rem 1rem;
  padding: 0.25rem 1rem;
  background: var(--card);
  border-bottom: 1px solid var(--border);
}

.brand { font-weight: 700; }

.user-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 0.25rem;
  font-size: 0.9rem;
}

main {
  max-width: 760px;
  margin: 0 auto;
  padding: 1.5rem 1rem 4rem;
}

/* ---------- Buttons and form fields ---------- */

button {
  font: inherit;
  font-weight: 600;
  min-height: 44px;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--accent-text);
  cursor: pointer;
}
button:disabled { opacity: 0.6; cursor: default; }
button.secondary { background: transparent; color: var(--text); border-color: var(--border); }
button.ghost { background: transparent; color: var(--accent); border-color: transparent; padding: 0.5rem 0.75rem; }
button.danger { background: transparent; color: var(--danger); border-color: var(--danger); }

button:focus-visible,
input:focus-visible,
textarea:focus-visible,
.item.editable:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.field { display: block; margin-bottom: 0.9rem; }
.field > span {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 0.3rem;
}

input, textarea {
  width: 100%;
  min-height: 44px;
  font: inherit;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
}
textarea { resize: vertical; }

.row { display: grid; grid-template-columns: 1fr 1fr; gap: 0 0.75rem; }

.actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
.actions .danger { margin-left: auto; }

.error {
  color: var(--danger);
  background: var(--error-bg);
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  margin: 0 0 0.75rem;
}
.ok { color: var(--ok); margin: 0 0 0.75rem; }
.status { color: var(--muted); text-align: center; padding: 2rem 0; margin: 0; }
.empty { color: var(--muted); margin: 0.5rem 0; }

/* ---------- Cards (sign in, setup) ---------- */

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 1.5rem;
}
.card.narrow { max-width: 440px; margin: 2rem auto; }
.card h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
.card > .muted { margin: 0 0 1.25rem; }

/* ---------- Trip header ---------- */

.trip-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.trip-header p { margin: 0.25rem 0 0; }

/* ---------- Days and items (timeline) ---------- */

.day { margin-bottom: 1.75rem; }

.day-heading {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0;
  margin-bottom: 0.75rem;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  font-size: 1rem;
}

.tag {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
}

.items { list-style: none; margin: 0; padding: 0; }

.item {
  position: relative;
  display: grid;
  grid-template-columns: var(--time-col) 1fr;
  gap: 0 1rem;
  padding-bottom: 0.75rem;
}

/* Vertical line and dot between the time and the card. */
.item::before {
  content: "";
  position: absolute;
  left: calc(var(--time-col) + 0.5rem - 1px);
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--line);
}
.item::after {
  content: "";
  position: absolute;
  left: calc(var(--time-col) + 0.5rem - 5px);
  top: 1.05rem;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
}

.item-time {
  padding-top: 0.75rem;
  text-align: right;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.item-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem 1rem;
}

.item-title { font-size: 1rem; }
.item-location, .item-notes, .item-link { margin: 0.2rem 0 0; font-size: 0.925rem; }
.item-location { color: var(--muted); }
.item-notes { white-space: pre-wrap; }
.item-link a { word-break: break-all; }

.item.editable { cursor: pointer; border-radius: var(--radius); }
.item.editable:hover .item-card { border-color: var(--accent); }

.item.highlight .item-card { animation: flash 2s ease-out; }
@keyframes flash {
  from { background: var(--accent-soft); border-color: var(--accent); }
  to { background: var(--card); border-color: var(--border); }
}

.add-button {
  display: block;
  width: calc(100% - var(--time-col) - 1rem);
  margin-left: calc(var(--time-col) + 1rem);
  background: transparent;
  color: var(--accent);
  border: 1px dashed var(--line);
}
.add-button:hover { border-color: var(--accent); }

/* ---------- Dialogs ---------- */

dialog {
  width: min(520px, calc(100% - 2rem));
  max-height: calc(100% - 2rem);
  overflow: auto;
  padding: 1.5rem;
  background: var(--card);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 10px 40px rgb(0 0 0 / 0.25);
}
dialog::backdrop { background: rgb(0 0 0 / 0.4); }
dialog h2 { font-size: 1.25rem; margin-bottom: 1rem; }

/* History: a panel on the right edge. */
dialog.panel {
  margin: 0 0 0 auto;
  width: min(420px, 100%);
  max-width: 100%;
  height: 100%;
  max-height: 100%;
  border-radius: 0;
  border-width: 0 0 0 1px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}
.panel-header h2 { margin: 0; }

.audit { list-style: none; margin: 0; padding: 0; }
.audit li { padding: 0.6rem 0; border-bottom: 1px solid var(--border); font-size: 0.925rem; }
.audit-time { display: block; font-size: 0.8rem; }

/* ---------- Phones ---------- */

@media (max-width: 640px) {
  main { padding: 1rem 0.75rem 3rem; }
  h1 { font-size: 1.4rem; }

  .card.narrow { margin: 1rem auto; padding: 1.25rem; }

  /* Time sits above the card; no timeline line. */
  .item { grid-template-columns: 1fr; }
  .item::before, .item::after { display: none; }
  .item-time { text-align: left; padding: 0 0 0.25rem; }
  .add-button { width: 100%; margin-left: 0; }

  /* Dialogs slide up from the bottom. */
  dialog.sheet {
    margin: auto 0 0;
    width: 100%;
    max-width: 100%;
    max-height: 90%;
    border-width: 1px 0 0;
    border-radius: var(--radius) var(--radius) 0 0;
    animation: slide-up 0.2s ease-out;
  }
  dialog.panel { width: 100%; border-width: 0; }
}

@keyframes slide-up {
  from { transform: translateY(100%); }
  to { transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; }
}
```

**Step 2: Check in the browser**

Reload http://localhost:8787 and check:
- The desktop width shows the timeline, with the time on the left, a line with dots, and cards on the right.
- With the window narrowed below 640px (or the browser's device toolbar), the time sits above each card and dialogs slide up from the bottom.
- Day headings stick to the top while scrolling.
- With the OS in dark mode, the page uses the dark palette.

**Step 3: Commit**

```bash
git add public/style.css
git commit -m "Rewrite styles: timeline layout, dialogs, bottom sheets on phones"
```

---

### Task 9: README, full test run and manual checklist

**Files:**
- Modify: `README.md`

**Step 1: Update the README**

In `README.md`:

1. Replace the first two bullets under the title:
   ```markdown
   - People edit the trip through a simple web form (`/edit`).
   - Agents use a REST API (plain-text docs at `GET /api`).
   ```
   with:
   ```markdown
   - People view and edit the trip on one page. Signed-in users add events from each day and click an event to edit it.
   - Agents use a REST API (plain-text docs at `GET /api`).
   ```
2. In the "Deploy" section, after "Open the URL it prints and sign in with one of your keys.", add:
   ```markdown
   The first time you sign in, you'll be asked for the trip name, dates and timezone.
   ```
3. In the "Tests" section, replace:
   ```markdown
   This uses its own throwaway local database and random keys. It starts `wrangler dev`, runs the API tests in `test/api.test.mjs`, then runs them again with `VIEW_PUBLIC=true`.
   ```
   with:
   ```markdown
   This first runs the date helper unit tests in `test/dates.test.mjs`. It then uses its own throwaway local database and random keys, starts `wrangler dev`, runs the API tests in `test/api.test.mjs`, and runs them again with `VIEW_PUBLIC=true`.

   To run only the unit tests: `node --test test/dates.test.mjs`.

   The page itself has no automated tests. Use the manual checklist in `docs/plans/2026-10-11-frontend-redesign-design.md`.
   ```
4. Replace the "Files" block with:
   ````markdown
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
   ````

**Step 2: Run the full test suite**

Run: `bash test/run.sh`
Expected: the unit tests pass, both API passes pass, and the last line is `==> All test passes succeeded.`

**Step 3: Run the manual checklist**

Work through every item in the "Testing" checklist in `docs/plans/2026-10-11-frontend-redesign-design.md`, at desktop width and at phone width (below 640px). Use a fresh `.wrangler/ui-state` for the setup items.

Some items need extra setup:
- **Public read-only view:** stop dev and restart it with `npx wrangler dev --persist-to .wrangler/ui-state --var VIEW_PUBLIC:true`. Then log out.
- **Revoked key mid-session:** while signed in, change the key in `.dev.vars` and restart `wrangler dev`. Then click "+ Add" and save. The page should return to sign-in with "Your key was not accepted."
- **Outside trip dates:** add an item, then use Edit trip to move the start date past that item's date.

Fix any failures before moving on, and commit each fix separately.

**Step 4: Commit**

```bash
git add README.md
git commit -m "Update README for the single-page editor and unit tests"
```
