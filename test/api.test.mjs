// Integration tests for the itinerary API. No dependencies.
//
// Easiest way to run (sets up keys, a fresh local D1, wrangler dev, and both
// VIEW_PUBLIC modes, then cleans up):
//
//   bash test/run.sh
//   TEST_PATTERN='^stop:' bash test/run.sh     # one group only
//
// Or run against a wrangler dev you started yourself:
//
//   TEST_API_KEYS='{"alice":"key-a","bob":"key-b"}' \
//   BASE_URL=http://localhost:8787 \
//   TEST_VIEW_PUBLIC=false \
//   node --test test/api.test.mjs
//
// TEST_API_KEYS must use the same format as the API_KEYS secret and match the
// keys the server was started with (needs at least one key; two lets the
// tests check that different actors are recorded).
// TEST_VIEW_PUBLIC must match the server's VIEW_PUBLIC setting ("true" or "false").
// The tests overwrite the trip row and day settings, and delete the stops
// they create. Never point them at a real deployment.

import { before, test } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8787').replace(/\/+$/, '');
const VIEW_PUBLIC = process.env.TEST_VIEW_PUBLIC === 'true';

if (!process.env.TEST_API_KEYS) {
  throw new Error('Set TEST_API_KEYS to a JSON object like {"alice":"key-a","bob":"key-b"}.');
}
const KEYS = Object.entries(JSON.parse(process.env.TEST_API_KEYS));
const [NAME_A, KEY_A] = KEYS[0];
const [NAME_B, KEY_B] = KEYS[1] || KEYS[0];

const TRIP = { start_date: '2099-01-01', end_date: '2099-01-10' };
const DAY1 = '2099-01-02';
const DAY2 = '2099-01-03';
const DAY4 = '2099-01-04'; // computed times test
const DAY5 = '2099-01-05'; // day settings test
const UNTOUCHED = '2099-01-09'; // no test writes to this day
const LAST = '2099-01-10';
const OUTSIDE = '2099-03-01';

async function api(method, path, { key, body, rawBody, headers = {} } = {}) {
  const h = { ...headers };
  if (key) h.Authorization = `Bearer ${key}`;
  let payload;
  if (rawBody !== undefined) {
    payload = rawBody;
    h['Content-Type'] = 'application/json';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h['Content-Type'] = 'application/json';
  }
  const res = await fetch(BASE_URL + path, { method, headers: h, body: payload });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: res.status, headers: res.headers, text, data };
}

function assertError(res, status, pattern) {
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${res.text}`);
  assert.equal(typeof res.data?.error, 'string', `expected JSON error body, got: ${res.text}`);
  if (pattern) assert.match(res.data.error, pattern);
}

async function createStop(fields, key = KEY_A) {
  const res = await api('POST', '/api/stops', { key, body: fields });
  assert.equal(res.status, 201, res.text);
  return res.data;
}

const move = (id, date, index, key = KEY_A) =>
  api('POST', `/api/stops/${id}/move`, { key, body: { date, index } });

async function getItinerary(key = KEY_A) {
  const res = await api('GET', '/api/itinerary', { key });
  assert.equal(res.status, 200, res.text);
  return res.data;
}

// The stops in one column: a date, or null for Ideas.
function column(it, date) {
  return date === null ? it.ideas : it.days.find((d) => d.date === date).schedule.stops;
}

async function columnIds(date) {
  return column(await getItinerary(), date).map((s) => s.id);
}

async function assertPositions(date) {
  const stops = column(await getItinerary(), date);
  assert.deepEqual(stops.map((s) => s.position), stops.map((_, i) => i), `positions in ${date ?? 'Ideas'}`);
}

async function latestAudit(key = KEY_A) {
  const res = await api('GET', '/api/audit?limit=1', { key });
  assert.equal(res.status, 200, res.text);
  return res.data.entries[0];
}

async function cleanup(ids) {
  for (const id of ids) await api('DELETE', `/api/stops/${id}`, { key: KEY_A });
}

const STOP_KEYS = [
  'after_time', 'area', 'booking_ref', 'created_at', 'created_by', 'date', 'duration_min', 'fixed_time',
  'id', 'kind', 'lat', 'link', 'lng', 'notes', 'position', 'status', 'stub', 'title', 'updated_at', 'updated_by',
];

const PROTECTED = [
  ['GET', '/api/whoami'],
  ['PUT', '/api/trip', { name: 'x' }],
  ['PUT', `/api/days/${DAY1}`, { title: 'x' }],
  ['POST', '/api/stops', { title: 'x' }],
  ['PUT', '/api/stops/1', { title: 'x' }],
  ['DELETE', '/api/stops/1'],
  ['POST', '/api/stops/1/move', { date: null, index: 0 }],
  ['GET', '/api/audit'],
];
if (!VIEW_PUBLIC) PROTECTED.push(['GET', '/api/itinerary']);

// Stops and days must fall within the trip dates, so set them before any test runs.
before(async () => {
  const res = await api('PUT', '/api/trip', { key: KEY_A, body: { name: 'Test Trip', ...TRIP } });
  assert.equal(res.status, 200, res.text);
});

test('docs: GET /api returns plain-text docs without auth', async () => {
  const res = await api('GET', '/api');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  assert.match(res.text, /Authorization: Bearer/);
  assert.match(res.text, /\/api\/stops\/:id\/move/);
  assert.match(res.text, /\/api\/days\/:date/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('auth: protected routes return 401 with no key and with a bad key', async () => {
  for (const [method, path, body] of PROTECTED) {
    assertError(await api(method, path, { body }), 401, /Bearer/);
    assertError(await api(method, path, { body, key: 'definitely-not-a-key' }), 401);
    assertError(await api(method, path, { body, headers: { Authorization: KEY_A } }), 401);
  }
});

test('auth: whoami returns the key name', async () => {
  const a = await api('GET', '/api/whoami', { key: KEY_A });
  assert.equal(a.status, 200);
  assert.deepEqual(a.data, { name: NAME_A });
  const b = await api('GET', '/api/whoami', { key: KEY_B });
  assert.deepEqual(b.data, { name: NAME_B });
});

test('trip: update, validation and audit', async () => {
  const res = await api('PUT', '/api/trip', {
    key: KEY_A,
    body: { name: '  Test Trip  ', ...TRIP, timezone: 'Asia/Tokyo', travellers: 2 },
  });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(Object.keys(res.data).sort(),
    ['end_date', 'name', 'start_date', 'timezone', 'travellers', 'updated_at', 'updated_by']);
  assert.equal(res.data.name, 'Test Trip');
  assert.equal(res.data.travellers, 2);
  assert.equal(res.data.updated_by, NAME_A);
  assert.match(res.data.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  const p = await api('PUT', '/api/trip', { key: KEY_B, body: { name: 'Renamed' } });
  assert.equal(p.status, 200, p.text);
  assert.equal(p.data.name, 'Renamed');
  assert.equal(p.data.start_date, TRIP.start_date);
  assert.equal(p.data.updated_by, NAME_B);

  const entry = await latestAudit();
  assert.equal(entry.action, 'update_trip');
  assert.equal(entry.actor, NAME_B);
  assert.equal(entry.item_id, null);
  assert.equal(entry.before.name, 'Test Trip');
  assert.equal(entry.after.name, 'Renamed');

  const cleared = await api('PUT', '/api/trip', { key: KEY_A, body: { travellers: null } });
  assert.equal(cleared.data.travellers, null);

  const bad = async (body, pattern) => assertError(await api('PUT', '/api/trip', { key: KEY_A, body }), 400, pattern);
  await bad({ start_date: '2099-02-30' }, /start_date.*YYYY-MM-DD/);
  await bad({ timezone: 'Mars/Olympus' }, /timezone.*IANA/);
  await bad({ end_date: '2098-12-31' }, /end_date.*start_date/);
  await bad({ start_date: '2099-01-01', end_date: '2100-06-01' }, /at most 366 days/);
  await bad({ travellers: 0 }, /travellers.*between 1 and 99/);
  await bad({ travellers: 2.5 }, /travellers.*whole number/);
  await bad({ travellers: '2' }, /travellers.*number/);
  await bad({ color: 'red' }, /Unknown field.*color.*Allowed fields: name, start_date, end_date, timezone, travellers/);
  await bad({}, /no fields/);
  await bad([1, 2], /JSON object/);
  assertError(await api('PUT', '/api/trip', { key: KEY_A, rawBody: 'not json' }), 400, /JSON/);

  const restore = await api('PUT', '/api/trip', { key: KEY_A, body: { name: 'Test Trip', ...TRIP } });
  assert.equal(restore.status, 200, restore.text);
});

test('itinerary: access follows VIEW_PUBLIC and lists every trip day', async () => {
  const anon = await api('GET', '/api/itinerary');
  if (VIEW_PUBLIC) {
    assert.equal(anon.status, 200, anon.text);
    assertError(await api('POST', '/api/stops', { body: { title: 'x' } }), 401);
    assertError(await api('PUT', `/api/days/${DAY1}`, { body: { title: 'x' } }), 401);
    assertError(await api('GET', '/api/audit'), 401);
  } else {
    assertError(anon, 401);
  }
  const it = await getItinerary();
  assert.deepEqual(Object.keys(it).sort(), ['days', 'ideas', 'trip']);
  assert.equal(it.days.length, 10);
  assert.deepEqual(it.days.map((d) => d.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(it.days[0].date, TRIP.start_date);
  assert.equal(it.days[9].date, LAST);
  const d = it.days.find((x) => x.date === UNTOUCHED);
  assert.deepEqual(Object.keys(d).sort(), [
    'date', 'end_lat', 'end_lng', 'end_place', 'n', 'schedule', 'start_lat', 'start_lng',
    'start_place', 'start_time', 'title', 'updated_at', 'updated_by',
  ]);
  assert.equal(d.start_time, '09:00');
  assert.equal(d.title, null);
  assert.deepEqual(d.schedule, {
    stops: [], start_leg: null, leave_at: null, back_leg: null, back_at: null, total_min: 0, clashes: [],
  });
  assert.ok(Array.isArray(it.ideas));
});

test('routes: unknown routes give 404, wrong methods give 405', async () => {
  assertError(await api('GET', '/api/nope', { key: KEY_A }), 404);
  assertError(await api('GET', '/api/items', { key: KEY_A }), 404);
  assertError(await api('GET', '/api/stops', { key: KEY_A }), 405);
  assertError(await api('POST', '/api/itinerary', { key: KEY_A }), 405);
  assertError(await api('GET', '/api/stops/1', { key: KEY_A }), 405);
  assertError(await api('GET', '/api/stops/1/move', { key: KEY_A }), 405);
  assertError(await api('GET', `/api/days/${DAY1}`, { key: KEY_A }), 405);
  assertError(await api('DELETE', '/api/trip', { key: KEY_A }), 405);
});

test('stop: create in a day and in Ideas, with defaults and audit', async (t) => {
  const a = await createStop({ date: DAY1, title: '  Temple  ', area: 'Higashiyama', notes: '', lat: 35, lng: 135.78 });
  assert.deepEqual(Object.keys(a).sort(), STOP_KEYS);
  assert.equal(a.title, 'Temple');
  assert.equal(a.notes, null);
  assert.equal(a.kind, 'sight');
  assert.equal(a.duration_min, 60);
  assert.equal(a.status, 'planned');
  assert.equal(a.created_by, NAME_A);

  const b = await createStop({ date: DAY1, title: 'Lunch', kind: 'food', duration_min: 75 }, KEY_B);
  assert.equal(b.position, a.position + 1);
  assert.equal(b.created_by, NAME_B);

  const idea = await createStop({ title: 'Museum' });
  t.after(() => cleanup([a.id, b.id, idea.id]));
  assert.equal(idea.date, null);
  assert.equal(idea.status, 'idea');

  const entry = await latestAudit();
  assert.equal(entry.action, 'create');
  assert.equal(entry.item_id, idea.id);
  assert.equal(entry.before, null);
  assert.deepEqual(entry.after, idea);

  const it = await getItinerary();
  assert.ok(column(it, DAY1).some((s) => s.id === a.id));
  assert.ok(it.ideas.some((s) => s.id === idea.id));
  await assertPositions(DAY1);
  await assertPositions(null);
});

test('stop: validation rules', async (t) => {
  const bad = async (body, pattern) => assertError(await api('POST', '/api/stops', { key: KEY_A, body }), 400, pattern);
  await bad({ date: DAY1 }, /"title" is required/);
  await bad({ title: '   ' }, /"title" is required/);
  await bad({ title: 'x', date: '2099/01/02' }, /"date".*YYYY-MM-DD/);
  await bad({ title: 'x', date: '2099-02-30' }, /"date".*real calendar date/);
  await bad({ title: 'x', date: OUTSIDE }, /outside the trip dates/);
  await bad({ title: 'x', kind: 'boat' }, /"kind" must be one of: train, hotel, food, sight, walk/);
  await bad({ title: 'x', status: 'maybe' }, /"status" must be one of/);
  await bad({ title: 'x', status: 'planned' }, /no date is an idea/);
  await bad({ title: 'x', date: DAY1, status: 'idea' }, /only for stops with no date/);
  await bad({ title: 'x', duration_min: 4 }, /"duration_min".*between 5 and 1440/);
  await bad({ title: 'x', duration_min: 30.5 }, /"duration_min".*whole number/);
  await bad({ title: 'x', fixed_time: '9:00' }, /"fixed_time".*HH:MM/);
  await bad({ title: 'x', after_time: '24:00' }, /"after_time"/);
  await bad({ title: 'x', lat: 91, lng: 0 }, /"lat".*between -90 and 90/);
  await bad({ title: 'x', lat: 35 }, /"lat" and "lng" must both be set/);
  await bad({ title: 'x', lat: 35, lng: '135' }, /"lng".*number/);
  await bad({ title: 'x', link: 'javascript:alert(1)' }, /"link".*http/);
  await bad({ title: 'x'.repeat(201) }, /"title".*too long/);
  await bad({ title: 'x', position: 3 }, /Unknown field.*position/);
  assertError(await api('POST', '/api/stops', { key: KEY_A, rawBody: '{bad json' }), 400, /JSON/);

  const s = await createStop({ date: DAY1, title: 'Check' });
  t.after(() => cleanup([s.id]));
  const upd = (body) => api('PUT', `/api/stops/${s.id}`, { key: KEY_A, body });
  assertError(await upd({ title: '' }), 400, /"title" is required/);
  assertError(await upd({ kind: null }), 400, /"kind" cannot be null/);
  assertError(await upd({ duration_min: null }), 400, /"duration_min" cannot be null/);
  assertError(await upd({ status: 'idea' }), 400, /only for stops with no date/);
  assertError(await upd({ date: null }), 400, /no date is an idea/);
  assertError(await upd({ lat: 35 }), 400, /must both be set/);
  assertError(await upd({}), 400, /no fields/);
  assertError(await api('PUT', '/api/stops/999999999', { key: KEY_A, body: { title: 'x' } }), 404, /not found/);
  assertError(await api('DELETE', '/api/stops/999999999', { key: KEY_A }), 404, /not found/);
  assertError(await api('DELETE', '/api/stops/abc', { key: KEY_A }), 400, /positive integer/);
});

test('stop: update, date change and delete keep positions in order', async (t) => {
  const a = await createStop({ date: DAY1, title: 'A' });
  const b = await createStop({ date: DAY1, title: 'B' });
  const c = await createStop({ date: DAY1, title: 'C' });
  t.after(() => cleanup([a.id, b.id, c.id]));

  const upd = await api('PUT', `/api/stops/${b.id}`, {
    key: KEY_B, body: { notes: 'Go early', status: 'booked', stub: 'Table for 2' },
  });
  assert.equal(upd.status, 200, upd.text);
  assert.equal(upd.data.notes, 'Go early');
  assert.equal(upd.data.status, 'booked');
  assert.equal(upd.data.position, b.position);
  assert.equal(upd.data.created_by, NAME_A);
  assert.equal(upd.data.updated_by, NAME_B);
  let entry = await latestAudit();
  assert.equal(entry.action, 'update');
  assert.equal(entry.actor, NAME_B);
  assert.equal(entry.before.notes, null);
  assert.deepEqual(entry.after, upd.data);

  // Changing the date puts the stop at the end of the new day.
  const day2Count = (await columnIds(DAY2)).length;
  const moved = await api('PUT', `/api/stops/${b.id}`, { key: KEY_A, body: { date: DAY2 } });
  assert.equal(moved.status, 200, moved.text);
  assert.equal(moved.data.date, DAY2);
  assert.equal(moved.data.position, day2Count);
  const day1 = await columnIds(DAY1);
  assert.ok(!day1.includes(b.id));
  assert.deepEqual(day1.filter((id) => id === a.id || id === c.id), [a.id, c.id]);
  await assertPositions(DAY1);
  await assertPositions(DAY2);

  // To Ideas with PUT needs status "idea" too.
  const toIdeas = await api('PUT', `/api/stops/${b.id}`, { key: KEY_A, body: { date: null, status: 'idea' } });
  assert.equal(toIdeas.status, 200, toIdeas.text);
  assert.equal(toIdeas.data.status, 'idea');
  await assertPositions(null);
  await assertPositions(DAY2);

  const del = await api('DELETE', `/api/stops/${a.id}`, { key: KEY_A });
  assert.equal(del.status, 200, del.text);
  assert.deepEqual(del.data, { deleted: a.id });
  entry = await latestAudit();
  assert.equal(entry.action, 'delete');
  assert.equal(entry.item_id, a.id);
  assert.equal(entry.before.title, 'A');
  assert.equal(entry.after, null);
  await assertPositions(DAY1);

  assertError(await api('PUT', `/api/stops/${a.id}`, { key: KEY_A, body: { title: 'x' } }), 404);
  assert.equal((await latestAudit()).id, entry.id, 'failed writes must not add audit entries');
});

test('move: reorder within a day', async (t) => {
  const base = (await columnIds(DAY2)).length;
  const a = await createStop({ date: DAY2, title: 'A' });
  const b = await createStop({ date: DAY2, title: 'B' });
  const c = await createStop({ date: DAY2, title: 'C' });
  const d = await createStop({ date: DAY2, title: 'D' });
  const mine = [a.id, b.id, c.id, d.id];
  t.after(() => cleanup(mine));
  const order = async () => (await columnIds(DAY2)).filter((id) => mine.includes(id));

  let r = await move(a.id, DAY2, base + 2);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.position, base + 2);
  assert.deepEqual(await order(), [b.id, c.id, a.id, d.id]);

  r = await move(d.id, DAY2, base);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(await order(), [d.id, b.id, c.id, a.id]);

  r = await move(c.id, DAY2, 999, KEY_B);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(await order(), [d.id, b.id, a.id, c.id]);
  await assertPositions(DAY2);

  const entry = await latestAudit();
  assert.equal(entry.action, 'move');
  assert.equal(entry.actor, NAME_B);
  assert.equal(entry.item_id, c.id);
  assert.equal(entry.before.position, base + 2);
  assert.equal(entry.after.position, base + 3);

  // Moving to where it already is changes nothing and logs nothing.
  r = await move(c.id, DAY2, base + 3);
  assert.equal(r.status, 200, r.text);
  assert.equal((await latestAudit()).id, entry.id);
});

test('move: across days, to and from Ideas', async (t) => {
  const a = await createStop({ date: DAY1, title: 'A' });
  const b = await createStop({ date: DAY1, title: 'B', status: 'booked' });
  const idea = await createStop({ title: 'I' });
  t.after(() => cleanup([a.id, b.id, idea.id]));

  let r = await move(a.id, DAY2, 0);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.date, DAY2);
  assert.equal(r.data.position, 0);
  assert.equal(r.data.status, 'planned');
  assert.equal((await columnIds(DAY2))[0], a.id);
  await assertPositions(DAY1);
  await assertPositions(DAY2);

  r = await move(b.id, null, 999);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.date, null);
  assert.equal(r.data.status, 'idea');
  const ideas = await columnIds(null);
  assert.equal(ideas[ideas.length - 1], b.id);

  r = await move(b.id, DAY1, 0);
  assert.equal(r.data.status, 'planned');

  r = await move(idea.id, DAY1, 1);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.status, 'planned');
  assert.equal(r.data.position, 1);
  await assertPositions(DAY1);
  await assertPositions(null);
});

test('move: errors', async (t) => {
  const s = await createStop({ date: DAY1, title: 'Mover' });
  t.after(() => cleanup([s.id]));
  const post = (body) => api('POST', `/api/stops/${s.id}/move`, { key: KEY_A, body });
  assertError(await move(999999999, DAY1, 0), 404, /not found/);
  assertError(await post({ index: 0 }), 400, /"date" is required/);
  assertError(await post({ date: DAY1 }), 400, /"index" is required/);
  assertError(await post({ date: DAY1, index: -1 }), 400, /"index"/);
  assertError(await post({ date: DAY1, index: 1.5 }), 400, /"index"/);
  assertError(await post({ date: OUTSIDE, index: 0 }), 400, /outside the trip dates/);
  assertError(await post({ date: 'bad', index: 0 }), 400, /"date".*YYYY-MM-DD/);
  assertError(await post({ date: DAY1, index: 0, extra: 1 }), 400, /Unknown field.*extra/);
});

test('day: upsert, validation and audit', async () => {
  const r = await api('PUT', `/api/days/${DAY5}`, {
    key: KEY_A,
    body: { title: '  Arashiyama  ', start_time: '08:00', start_place: null, start_lat: null, start_lng: null,
      end_place: 'Hotel', end_lat: 35.0089, end_lng: 135.77 },
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.date, DAY5);
  assert.equal(r.data.title, 'Arashiyama');
  assert.equal(r.data.start_time, '08:00');
  assert.equal(r.data.end_place, 'Hotel');
  assert.equal(r.data.updated_by, NAME_A);
  let entry = await latestAudit();
  assert.equal(entry.action, 'update_day');
  assert.equal(entry.item_id, null);
  assert.equal(entry.after.title, 'Arashiyama');

  const p = await api('PUT', `/api/days/${DAY5}`, { key: KEY_B, body: { title: 'Renamed' } });
  assert.equal(p.status, 200, p.text);
  assert.equal(p.data.start_time, '08:00');
  assert.equal(p.data.updated_by, NAME_B);
  entry = await latestAudit();
  assert.equal(entry.before.title, 'Arashiyama');
  assert.equal(entry.after.title, 'Renamed');

  const day = (await getItinerary()).days.find((d) => d.date === DAY5);
  assert.equal(day.title, 'Renamed');
  assert.equal(day.end_lat, 35.0089);

  const cleared = await api('PUT', `/api/days/${DAY5}`, { key: KEY_A, body: { end_place: null, end_lat: null, end_lng: null } });
  assert.equal(cleared.data.end_place, null);
  assert.equal(cleared.data.end_lat, null);

  const bad = async (body, pattern, date = DAY5) =>
    assertError(await api('PUT', `/api/days/${date}`, { key: KEY_A, body }), 400, pattern);
  await bad({ start_time: null }, /"start_time" cannot be null/);
  await bad({ start_time: '8am' }, /"start_time".*HH:MM/);
  await bad({ start_lat: 35 }, /"start_lat" and "start_lng" must both be set/);
  await bad({ end_lat: 0, end_lng: 200 }, /"end_lng".*between -180 and 180/);
  await bad({ date: DAY5 }, /Unknown field.*date/);
  await bad({}, /no fields/);
  await bad({ title: 'x' }, /outside the trip dates/, OUTSIDE);
  await bad({ title: 'x' }, /YYYY-MM-DD/, '2099-02-30');
});

test('itinerary: returns computed times from schedule.js', async (t) => {
  const reset = await api('PUT', `/api/days/${DAY4}`, {
    key: KEY_A,
    body: { start_time: '10:00', start_place: null, start_lat: null, start_lng: null, end_place: null, end_lat: null, end_lng: null },
  });
  assert.equal(reset.status, 200, reset.text);
  assert.equal((await columnIds(DAY4)).length, 0, `${DAY4} should start empty`);
  const a = await createStop({ date: DAY4, title: 'A', duration_min: 60 });
  const b = await createStop({ date: DAY4, title: 'B', duration_min: 30, fixed_time: '10:30', status: 'booked' });
  t.after(() => cleanup([a.id, b.id]));

  const sc = (await getItinerary()).days.find((d) => d.date === DAY4).schedule;
  const [ra, rb] = sc.stops;
  assert.equal(ra.id, a.id);
  assert.equal(ra.start, '10:00');
  assert.equal(ra.end, '11:00');
  assert.equal(ra.leg, null);
  assert.equal(rb.start, '10:30');
  assert.equal(rb.end, '11:00');
  assert.equal(rb.late_min, 45);
  assert.deepEqual(rb.leg, { mode: 'any', min: 15, text: 'About 15 min travel' });
  assert.deepEqual(sc.clashes, [{ id: b.id, title: 'B', late_min: 45 }]);
  assert.equal(sc.total_min, 90);
});

test('trip: shrinking dates past existing stops is rejected', async (t) => {
  const s = await createStop({ date: LAST, title: 'Last day' });
  t.after(() => cleanup([s.id]));
  assertError(await api('PUT', '/api/trip', { key: KEY_A, body: { end_date: '2099-01-09' } }), 400, /1 stop is on a date outside/);
  assertError(await api('PUT', '/api/trip', { key: KEY_A, body: { start_date: null } }), 400, /outside/);
  await cleanup([s.id]);
  const ok = await api('PUT', '/api/trip', { key: KEY_A, body: { end_date: '2099-01-09' } });
  assert.equal(ok.status, 200, ok.text);
  const restore = await api('PUT', '/api/trip', { key: KEY_A, body: TRIP });
  assert.equal(restore.status, 200, restore.text);
});

test('audit: newest first, limit rules, parsed snapshots', async (t) => {
  const one = await createStop({ date: DAY1, title: 'audit one' });
  const two = await createStop({ date: DAY1, title: 'audit two' }, KEY_B);
  t.after(() => cleanup([one.id, two.id]));

  const res = await api('GET', '/api/audit?limit=2', { key: KEY_A });
  assert.equal(res.status, 200);
  assert.equal(res.data.entries.length, 2);
  const [e1, e2] = res.data.entries;
  assert.ok(e1.id > e2.id);
  assert.equal(e1.item_id, two.id);
  assert.equal(e1.actor, NAME_B);
  assert.equal(e2.item_id, one.id);
  assert.equal(e2.actor, NAME_A);
  assert.equal(typeof e1.after, 'object');
  assert.match(e1.ts, /Z$/);
  assert.deepEqual(Object.keys(e1).sort(), ['action', 'actor', 'after', 'before', 'id', 'item_id', 'ts']);

  const def = await api('GET', '/api/audit', { key: KEY_A });
  assert.equal(def.status, 200);
  assert.ok(def.data.entries.length <= 50);

  const big = await api('GET', '/api/audit?limit=100000', { key: KEY_A });
  assert.equal(big.status, 200);
  assert.ok(big.data.entries.length <= 200);

  for (const bad of ['0', '-1', '1.5', 'abc', '']) {
    assertError(await api('GET', `/api/audit?limit=${bad}`, { key: KEY_A }), 400, /limit.*positive integer/);
  }
});
