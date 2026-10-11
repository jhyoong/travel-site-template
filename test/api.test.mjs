// Integration tests for the itinerary API. No dependencies.
//
// Easiest way to run (sets up keys, a fresh local D1, wrangler dev, and both
// VIEW_PUBLIC modes, then cleans up):
//
//   bash test/run.sh
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
// The tests create, change and delete their own items. They do change the trip row.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8787').replace(/\/+$/, '');
const VIEW_PUBLIC = process.env.TEST_VIEW_PUBLIC === 'true';

if (!process.env.TEST_API_KEYS) {
  throw new Error('Set TEST_API_KEYS to a JSON object like {"alice":"key-a","bob":"key-b"}.');
}
const KEYS = Object.entries(JSON.parse(process.env.TEST_API_KEYS));
const [NAME_A, KEY_A] = KEYS[0];
const [NAME_B, KEY_B] = KEYS[1] || KEYS[0];

// A date range unlikely to clash with real data.
const RUN = Math.floor(Math.random() * 9000) + 1000;
const DAY1 = `2099-01-${String((RUN % 27) + 1).padStart(2, '0')}`;
const DAY2 = `2099-02-${String((RUN % 27) + 1).padStart(2, '0')}`;

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

async function createItem(fields, key = KEY_A) {
  const res = await api('POST', '/api/items', { key, body: fields });
  assert.equal(res.status, 201, res.text);
  return res.data;
}

async function latestAudit(key = KEY_A) {
  const res = await api('GET', '/api/audit?limit=1', { key });
  assert.equal(res.status, 200, res.text);
  return res.data.entries[0];
}

const PROTECTED = [
  ['GET', '/api/whoami'],
  ['PUT', '/api/trip', { name: 'x' }],
  ['POST', '/api/items', { date: '2099-01-01', title: 'x' }],
  ['PUT', '/api/items/1', { title: 'x' }],
  ['DELETE', '/api/items/1'],
  ['GET', '/api/audit'],
];
if (!VIEW_PUBLIC) PROTECTED.push(['GET', '/api/itinerary']);

test('GET /api returns plain-text docs without auth', async () => {
  const res = await api('GET', '/api');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  assert.match(res.text, /Authorization: Bearer/);
  assert.match(res.text, /\/api\/items/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('protected routes return 401 with no key and with a bad key', async () => {
  for (const [method, path, body] of PROTECTED) {
    assertError(await api(method, path, { body }), 401, /Bearer/);
    assertError(await api(method, path, { body, key: 'definitely-not-a-key' }), 401);
    assertError(await api(method, path, { body, headers: { Authorization: KEY_A } }), 401);
  }
});

test('whoami returns the key name', async () => {
  const a = await api('GET', '/api/whoami', { key: KEY_A });
  assert.equal(a.status, 200);
  assert.deepEqual(a.data, { name: NAME_A });
  const b = await api('GET', '/api/whoami', { key: KEY_B });
  assert.deepEqual(b.data, { name: NAME_B });
});

test('itinerary access follows VIEW_PUBLIC', async () => {
  const anon = await api('GET', '/api/itinerary');
  if (VIEW_PUBLIC) {
    assert.equal(anon.status, 200, anon.text);
    assert.ok(anon.data.trip);
    assert.ok(Array.isArray(anon.data.items));
    // Writes and audit still need a key.
    assertError(await api('POST', '/api/items', { body: { date: DAY1, title: 'x' } }), 401);
    assertError(await api('PUT', '/api/trip', { body: { name: 'x' } }), 401);
    assertError(await api('GET', '/api/audit'), 401);
  } else {
    assertError(anon, 401);
  }
  const authed = await api('GET', '/api/itinerary', { key: KEY_A });
  assert.equal(authed.status, 200);
  assert.deepEqual(Object.keys(authed.data.trip).sort(),
    ['end_date', 'name', 'start_date', 'timezone', 'updated_at', 'updated_by']);
});

test('unknown routes give 404, wrong methods give 405', async () => {
  assertError(await api('GET', '/api/nope', { key: KEY_A }), 404);
  assertError(await api('GET', '/api/items', { key: KEY_A }), 405);
  assertError(await api('POST', '/api/itinerary', { key: KEY_A }), 405);
  assertError(await api('GET', '/api/items/1', { key: KEY_A }), 405);
  assertError(await api('DELETE', '/api/trip', { key: KEY_A }), 405);
});

test('trip update, validation and audit', async () => {
  const res = await api('PUT', '/api/trip', {
    key: KEY_A,
    body: { name: '  Test Trip  ', start_date: '2099-01-01', end_date: '2099-01-31', timezone: 'Asia/Singapore' },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.data.name, 'Test Trip');
  assert.equal(res.data.start_date, '2099-01-01');
  assert.equal(res.data.end_date, '2099-01-31');
  assert.equal(res.data.timezone, 'Asia/Singapore');
  assert.equal(res.data.updated_by, NAME_A);
  assert.match(res.data.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  // Partial update by another key.
  const p = await api('PUT', '/api/trip', { key: KEY_B, body: { name: 'Renamed' } });
  assert.equal(p.status, 200, p.text);
  assert.equal(p.data.name, 'Renamed');
  assert.equal(p.data.start_date, '2099-01-01');
  assert.equal(p.data.updated_by, NAME_B);

  const entry = await latestAudit();
  assert.equal(entry.action, 'update_trip');
  assert.equal(entry.actor, NAME_B);
  assert.equal(entry.item_id, null);
  assert.equal(entry.before.name, 'Test Trip');
  assert.equal(entry.after.name, 'Renamed');

  // Empty string clears an optional field.
  const cleared = await api('PUT', '/api/trip', { key: KEY_A, body: { name: '' } });
  assert.equal(cleared.data.name, null);

  // Validation.
  assertError(await api('PUT', '/api/trip', { key: KEY_A, body: { start_date: '2099-02-30' } }), 400, /start_date.*YYYY-MM-DD/);
  assertError(await api('PUT', '/api/trip', { key: KEY_A, body: { end_date: '01/02/2099' } }), 400, /end_date/);
  assertError(await api('PUT', '/api/trip', { key: KEY_A, body: { timezone: 'Mars/Olympus' } }), 400, /timezone.*IANA/);
  // end_date before the stored start_date (merged check).
  assertError(await api('PUT', '/api/trip', { key: KEY_A, body: { end_date: '2098-12-31' } }), 400, /end_date.*start_date/);
  assertError(await api('PUT', '/api/trip', { key: KEY_A, body: { start_date: '2099-03-01', end_date: '2099-02-01' } }), 400, /end_date/);
  assertError(await api('PUT', '/api/trip', { key: KEY_A, body: { color: 'red' } }), 400, /Unknown field.*color.*Allowed fields: name, start_date, end_date, timezone/);
  assertError(await api('PUT', '/api/trip', { key: KEY_A, rawBody: 'not json' }), 400, /JSON/);
  assertError(await api('PUT', '/api/trip', { key: KEY_A, body: [1, 2] }), 400, /JSON object/);
  assertError(await api('PUT', '/api/trip', { key: KEY_A, body: { name: 5 } }), 400, /name/);
  assertError(await api('PUT', '/api/trip', { key: KEY_A, body: {} }), 400, /no fields/);

  // Restore a sensible trip.
  const restore = await api('PUT', '/api/trip', { key: KEY_A, body: { name: 'Test Trip' } });
  assert.equal(restore.status, 200);
});

test('item create, update, delete with audit', async () => {
  const created = await api('POST', '/api/items', {
    key: KEY_A,
    body: { date: DAY1, start_time: '09:00', end_time: '10:30', title: '  Breakfast  ', location: 'Cafe', notes: '', link: 'https://example.com/menu' },
  });
  assert.equal(created.status, 201, created.text);
  const item = created.data;
  assert.deepEqual(Object.keys(item).sort(), [
    'created_at', 'created_by', 'date', 'end_time', 'id', 'link', 'location', 'notes',
    'start_time', 'title', 'updated_at', 'updated_by',
  ]);
  assert.equal(item.title, 'Breakfast');
  assert.equal(item.notes, null);
  assert.equal(item.created_by, NAME_A);
  assert.equal(item.updated_by, NAME_A);
  assert.equal(typeof item.id, 'number');

  let entry = await latestAudit();
  assert.equal(entry.action, 'create');
  assert.equal(entry.actor, NAME_A);
  assert.equal(entry.item_id, item.id);
  assert.equal(entry.before, null);
  assert.deepEqual(entry.after, item);

  // Partial update by key B.
  const upd = await api('PUT', `/api/items/${item.id}`, { key: KEY_B, body: { title: 'Brunch', link: '' } });
  assert.equal(upd.status, 200, upd.text);
  assert.equal(upd.data.title, 'Brunch');
  assert.equal(upd.data.link, null);
  assert.equal(upd.data.location, 'Cafe');
  assert.equal(upd.data.created_by, NAME_A);
  assert.equal(upd.data.updated_by, NAME_B);

  entry = await latestAudit();
  assert.equal(entry.action, 'update');
  assert.equal(entry.actor, NAME_B);
  assert.equal(entry.item_id, item.id);
  assert.deepEqual(entry.before, item);
  assert.deepEqual(entry.after, upd.data);

  // Optional time can be cleared with null.
  const cleared = await api('PUT', `/api/items/${item.id}`, { key: KEY_A, body: { end_time: null } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.end_time, null);

  // Delete.
  const del = await api('DELETE', `/api/items/${item.id}`, { key: KEY_A });
  assert.equal(del.status, 200, del.text);
  assert.deepEqual(del.data, { deleted: item.id });

  entry = await latestAudit();
  assert.equal(entry.action, 'delete');
  assert.equal(entry.actor, NAME_A);
  assert.equal(entry.item_id, item.id);
  assert.deepEqual(entry.before, cleared.data);
  assert.equal(entry.after, null);

  // Now gone.
  assertError(await api('PUT', `/api/items/${item.id}`, { key: KEY_A, body: { title: 'x' } }), 404);
  assertError(await api('DELETE', `/api/items/${item.id}`, { key: KEY_A }), 404);
  const after404 = await latestAudit();
  assert.equal(after404.id, entry.id, 'failed writes must not add audit entries');
});

test('item 404s and bad ids', async () => {
  assertError(await api('PUT', '/api/items/999999999', { key: KEY_A, body: { title: 'x' } }), 404, /not found/);
  assertError(await api('DELETE', '/api/items/999999999', { key: KEY_A }), 404, /not found/);
  assertError(await api('DELETE', '/api/items/abc', { key: KEY_A }), 400, /positive integer/);
});

test('item validation rules', async () => {
  const bad = async (body, pattern) =>
    assertError(await api('POST', '/api/items', { key: KEY_A, body }), 400, pattern);

  await bad({ title: 'No date' }, /"date" is required.*YYYY-MM-DD/);
  await bad({ date: DAY1 }, /"title" is required/);
  await bad({ date: DAY1, title: '   ' }, /"title" is required/);
  await bad({ date: DAY1, title: null }, /"title" is required/);
  await bad({ date: '2099/01/01', title: 'x' }, /"date".*YYYY-MM-DD/);
  await bad({ date: '2099-02-30', title: 'x' }, /"date".*real calendar date/);
  await bad({ date: '2099-13-01', title: 'x' }, /"date"/);
  await bad({ date: DAY1, title: 'x', start_time: '9:00' }, /"start_time".*HH:MM/);
  await bad({ date: DAY1, title: 'x', start_time: '24:00' }, /"start_time"/);
  await bad({ date: DAY1, title: 'x', end_time: '10:60' }, /"end_time".*HH:MM/);
  await bad({ date: DAY1, title: 'x', start_time: '10:00', end_time: '09:00' }, /"end_time".*after.*"start_time"/);
  await bad({ date: DAY1, title: 'x', start_time: '10:00', end_time: '10:00' }, /"end_time"/);
  await bad({ date: DAY1, title: 'x', colour: 'red' }, /Unknown field.*colour.*Allowed fields: date, start_time, end_time, title, location, notes, link/);
  await bad({ date: DAY1, title: 'x', link: 'javascript:alert(1)' }, /"link".*http/);
  await bad({ date: DAY1, title: 'x', link: 'ftp://example.com' }, /"link"/);
  await bad({ date: DAY1, title: 'x', link: 'not a url' }, /"link"/);
  await bad({ date: DAY1, title: 'x'.repeat(201) }, /"title".*too long/);
  await bad({ date: DAY1, title: 123 }, /"title".*string/);
  assertError(await api('POST', '/api/items', { key: KEY_A, rawBody: '{bad json' }), 400, /JSON/);
  assertError(await api('POST', '/api/items', { key: KEY_A, rawBody: '"a string"' }), 400, /JSON object/);
  assertError(await api('POST', '/api/items', { key: KEY_A, rawBody: 'null' }), 400, /JSON object/);

  // Partial update checked against stored values.
  const item = await createItem({ date: DAY1, start_time: '14:00', end_time: '15:00', title: 'Museum' });
  const upd = (body) => api('PUT', `/api/items/${item.id}`, { key: KEY_A, body });
  assertError(await upd({ end_time: '13:00' }), 400, /"end_time" \(13:00\).*"start_time" \(14:00\)/);
  assertError(await upd({ start_time: '16:00' }), 400, /"end_time" \(15:00\).*"start_time" \(16:00\)/);
  assertError(await upd({ title: '' }), 400, /"title" is required/);
  assertError(await upd({ date: null }), 400, /"date" is required/);
  assertError(await upd({ date: '2099-02-29' }), 400, /"date"/);
  assertError(await upd({ id: 5 }), 400, /Unknown field.*id/);
  assertError(await upd({}), 400, /no fields/);
  assertError(await api('PUT', `/api/items/${item.id}`, { key: KEY_A, rawBody: 'nope' }), 400, /JSON/);
  const ok = await upd({ start_time: '13:00', end_time: '16:00' });
  assert.equal(ok.status, 200, ok.text);
  // Leap day is a real date.
  const leap = await upd({ date: '2096-02-29' });
  assert.equal(leap.status, 200, leap.text);
  await api('DELETE', `/api/items/${item.id}`, { key: KEY_A });
});

test('itinerary items are sorted by date, start_time (nulls first), then id', async () => {
  const made = [];
  made.push(await createItem({ date: DAY2, start_time: '08:00', title: 'd2 08:00' }));
  made.push(await createItem({ date: DAY1, start_time: '12:00', title: 'd1 12:00' }));
  made.push(await createItem({ date: DAY1, title: 'd1 no time A' }));
  made.push(await createItem({ date: DAY1, start_time: '07:30', title: 'd1 07:30' }));
  made.push(await createItem({ date: DAY1, title: 'd1 no time B' }));
  made.push(await createItem({ date: DAY1, start_time: '12:00', title: 'd1 12:00 second' }));

  const res = await api('GET', '/api/itinerary', { key: KEY_A });
  assert.equal(res.status, 200);
  const ids = new Set(made.map((i) => i.id));
  const titles = res.data.items.filter((i) => ids.has(i.id)).map((i) => i.title);
  assert.deepEqual(titles, [
    'd1 no time A', 'd1 no time B', 'd1 07:30', 'd1 12:00', 'd1 12:00 second', 'd2 08:00',
  ]);

  // Whole list is sorted too.
  const all = res.data.items;
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1];
    const b = all[i];
    const ka = [a.date, a.start_time === null ? '' : a.start_time, a.id];
    const kb = [b.date, b.start_time === null ? '' : b.start_time, b.id];
    const cmp = ka[0].localeCompare(kb[0]) || ka[1].localeCompare(kb[1]) || ka[2] - kb[2];
    assert.ok(cmp < 0, `items out of order at index ${i}`);
  }

  for (const item of made) {
    const del = await api('DELETE', `/api/items/${item.id}`, { key: KEY_A });
    assert.equal(del.status, 200);
  }
});

test('audit log: newest first, limit rules, parsed snapshots', async () => {
  const one = await createItem({ date: DAY1, title: 'audit one' });
  const two = await createItem({ date: DAY1, title: 'audit two' }, KEY_B);

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

  await api('DELETE', `/api/items/${one.id}`, { key: KEY_A });
  await api('DELETE', `/api/items/${two.id}`, { key: KEY_A });
});
