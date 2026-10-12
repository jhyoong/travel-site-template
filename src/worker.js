// Itinerary Worker: serves static pages from ./public and a JSON API under /api.
// See GET /api for the API docs.
import { schedule, DEFAULT_START } from '../public/js/schedule.js';
import { tripDates, dayCount, MAX_DAYS } from '../public/js/dates.js';

const KINDS = ['train', 'hotel', 'food', 'sight', 'walk'];
const STATUSES = ['booked', 'planned', 'suggested', 'idea'];

const TRIP_FIELDS = ['name', 'start_date', 'end_date', 'timezone', 'travellers'];
const DAY_FIELDS = ['title', 'start_time', 'start_place', 'start_lat', 'start_lng', 'end_place', 'end_lat', 'end_lng'];
const STOP_FIELDS = [
  'date', 'title', 'area', 'kind', 'duration_min', 'status', 'fixed_time', 'after_time',
  'stub', 'booking_ref', 'notes', 'link', 'lat', 'lng',
];

const TRIP_COLUMNS = [...TRIP_FIELDS, 'updated_at', 'updated_by'];
const DAY_COLUMNS = ['date', ...DAY_FIELDS, 'updated_at', 'updated_by'];
const STOP_COLUMNS = ['id', 'position', ...STOP_FIELDS, 'created_at', 'created_by', 'updated_at', 'updated_by'];

const MAX_LENGTHS = {
  name: 200,
  timezone: 64,
  title: 200,
  area: 100,
  stub: 40,
  booking_ref: 500,
  notes: 5000,
  link: 2000,
  start_place: 200,
  end_place: 200,
};

const LAT = { min: -90, max: 90 };
const LNG = { min: -180, max: 180 };
const NUMBER_RULES = {
  travellers: { min: 1, max: 99, integer: true },
  duration_min: { min: 5, max: 1440, integer: true },
  lat: LAT,
  lng: LNG,
  start_lat: LAT,
  start_lng: LNG,
  end_lat: LAT,
  end_lng: LNG,
};
const DATE_FIELDS = ['date', 'start_date', 'end_date'];
const TIME_FIELDS = ['start_time', 'fixed_time', 'after_time'];

const MAX_BODY_BYTES = 64 * 1024;
const AUDIT_DEFAULT_LIMIT = 50;
const AUDIT_MAX_LIMIT = 200;

// SQL expressions that build a full-row JSON snapshot.
const jsonObject = (cols) => `json_object(${cols.map((c) => `'${c}', ${c}`).join(', ')})`;
const TRIP_JSON = jsonObject(TRIP_COLUMNS);
const DAY_JSON = jsonObject(DAY_COLUMNS);
const STOP_JSON = jsonObject(STOP_COLUMNS);

const API_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

class HttpError extends Error {
  constructor(status, message, headers) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...API_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: { ...API_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function now() {
  return new Date().toISOString();
}

// ---------- Auth ----------

async function sha256(value) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
}

function parseApiKeys(env) {
  const raw = env.API_KEYS;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new HttpError(500, 'Server misconfigured: the API_KEYS secret is not set. Set it to a JSON object like {"alice":"<key>"}.');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(500, 'Server misconfigured: the API_KEYS secret is not valid JSON. Expected a JSON object like {"alice":"<key>"}.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(500, 'Server misconfigured: the API_KEYS secret must be a JSON object like {"alice":"<key>"}.');
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    throw new HttpError(500, 'Server misconfigured: the API_KEYS secret has no keys.');
  }
  for (const [name, key] of entries) {
    if (typeof key !== 'string' || key.length === 0 || name.length === 0) {
      throw new HttpError(500, 'Server misconfigured: every API_KEYS entry must map a non-empty name to a non-empty string key.');
    }
  }
  return entries;
}

// Returns the matched key name, or null. Checks every key, no early exit.
async function identify(request, env) {
  const entries = parseApiKeys(env);
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match ? match[1].trim() : '';
  const tokenHash = await sha256(token);
  let actor = null;
  for (const [name, key] of entries) {
    const keyHash = await sha256(key);
    const equal = crypto.subtle.timingSafeEqual(tokenHash, keyHash);
    if (equal && token !== '' && actor === null) actor = name;
  }
  return actor;
}

async function requireActor(request, env) {
  const actor = await identify(request, env);
  if (!actor) {
    throw new HttpError(401, 'Missing or invalid API key. Send the header "Authorization: Bearer <key>".');
  }
  return actor;
}

// ---------- Validation ----------

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isTime(s) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function isTimezone(s) {
  if (!/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(s)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: s });
    return true;
  } catch {
    return false;
  }
}

function isHttpUrl(s) {
  if (/\s/.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function readJsonObject(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new HttpError(400, `Request body is too large (max ${MAX_BODY_BYTES} bytes).`);
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON (a JSON object). Send header "Content-Type: application/json".');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object, e.g. {"title": "Dinner"}.');
  }
  return body;
}

function checkUnknownFields(body, allowed) {
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) {
    throw new HttpError(400, `Unknown field(s): ${unknown.join(', ')}. Allowed fields: ${allowed.join(', ')}.`);
  }
}

// Trim strings; empty string becomes null. Non-string, non-null values are rejected.
function cleanString(field, value) {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new HttpError(400, `Field "${field}" must be a string or null.`);
  }
  const v = value.trim();
  if (v === '') return null;
  const max = MAX_LENGTHS[field];
  if (max && v.length > max) {
    throw new HttpError(400, `Field "${field}" is too long (max ${max} characters).`);
  }
  return v;
}

function cleanNumber(field, value) {
  if (value === null) return null;
  const rule = NUMBER_RULES[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, `Field "${field}" must be a number or null.`);
  }
  if (rule.integer && !Number.isInteger(value)) {
    throw new HttpError(400, `Field "${field}" must be a whole number.`);
  }
  if (value < rule.min || value > rule.max) {
    throw new HttpError(400, `Field "${field}" must be between ${rule.min} and ${rule.max}. Got ${value}.`);
  }
  return value;
}

// Checks and cleans the fields present in body. Returns { field: value }.
function cleanFields(body, allowed) {
  checkUnknownFields(body, allowed);
  const out = {};
  for (const field of allowed) {
    if (!(field in body)) continue;
    const value = NUMBER_RULES[field] ? cleanNumber(field, body[field]) : cleanString(field, body[field]);
    out[field] = value;
    if (value == null) continue;
    if (DATE_FIELDS.includes(field) && !isRealDate(value)) {
      throw new HttpError(400, `Field "${field}" must be a real calendar date in format YYYY-MM-DD (e.g. "2025-03-14"). Got "${value}".`);
    }
    if (TIME_FIELDS.includes(field) && !isTime(value)) {
      throw new HttpError(400, `Field "${field}" must be a 24-hour time in format HH:MM (e.g. "09:30", "18:05"). Got "${value}".`);
    }
  }
  if (out.timezone != null && !isTimezone(out.timezone)) {
    throw new HttpError(400, `Field "timezone" must be a valid IANA time zone name (e.g. "Asia/Singapore", "Europe/London", "UTC"). Got "${out.timezone}".`);
  }
  if (out.link != null && !isHttpUrl(out.link)) {
    throw new HttpError(400, 'Field "link" must be a full http:// or https:// URL (e.g. "https://example.com").');
  }
  if (out.kind != null && !KINDS.includes(out.kind)) {
    throw new HttpError(400, `Field "kind" must be one of: ${KINDS.join(', ')}. Got "${out.kind}".`);
  }
  if (out.status != null && !STATUSES.includes(out.status)) {
    throw new HttpError(400, `Field "status" must be one of: ${STATUSES.join(', ')}. Got "${out.status}".`);
  }
  return out;
}

function requireSomeFields(fields, allowed) {
  if (Object.keys(fields).length === 0) {
    throw new HttpError(400, `Request body has no fields to update. Allowed fields: ${allowed.join(', ')}.`);
  }
}

function requireTitle(fields) {
  if (fields.title == null) {
    throw new HttpError(400, 'Field "title" is required and must be a non-empty string.');
  }
}

function rejectNulls(fields, names) {
  for (const f of names) {
    if (f in fields && fields[f] == null) throw new HttpError(400, `Field "${f}" cannot be null.`);
  }
}

function checkPair(row, latKey, lngKey) {
  if ((row[latKey] == null) !== (row[lngKey] == null)) {
    throw new HttpError(400, `Fields "${latKey}" and "${lngKey}" must both be set or both be null.`);
  }
}

// A stop is in Ideas exactly when it has no date.
function checkIdeaRule(row) {
  if (row.date == null && row.status !== 'idea') {
    throw new HttpError(400, 'A stop with no date is an idea, so "status" must be "idea". To put it on a day, send a "date" (or use POST /api/stops/:id/move).');
  }
  if (row.date != null && row.status === 'idea') {
    throw new HttpError(400, 'Status "idea" is only for stops with no date. To send it to Ideas, also send "date": null. To keep it on a day, use a status such as "planned". (Or use POST /api/stops/:id/move.)');
  }
}

function checkInTrip(trip, date) {
  if (!trip.start_date || !trip.end_date) {
    throw new HttpError(400, 'The trip has no start and end date yet. Set them with PUT /api/trip first.');
  }
  if (date < trip.start_date || date > trip.end_date) {
    throw new HttpError(400, `Date ${date} is outside the trip dates (${trip.start_date} to ${trip.end_date}).`);
  }
}

function parseId(raw) {
  if (!/^[1-9]\d{0,15}$/.test(raw)) {
    throw new HttpError(400, `Stop id must be a positive integer. Got "${raw}".`);
  }
  return Number(raw);
}

// ---------- Data helpers ----------

function pick(row, cols) {
  const out = {};
  for (const c of cols) out[c] = row ? row[c] ?? null : null;
  return out;
}

const tripView = (row) => pick(row, TRIP_COLUMNS);
const stopView = (row) => pick(row, STOP_COLUMNS);

// Day settings for a date. Dates with no row get the defaults.
function dayView(date, row) {
  const day = pick(row, DAY_COLUMNS);
  day.date = date;
  day.start_time = day.start_time || DEFAULT_START;
  return day;
}

// Renumbers one column (a date, or null for Ideas) to 0..n-1, keeping the
// current order. UPDATE ... FROM computes all new numbers before writing.
function renumber(env, date) {
  return env.DB.prepare(
    `UPDATE stops SET position = r.rn
     FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) - 1 AS rn FROM stops WHERE date IS ?) AS r
     WHERE stops.id = r.id`
  ).bind(date);
}

// Audit rows for a stop: "before" is written first, "after" is filled in
// at the end of the same batch.
function auditBefore(env, ts, actor, action, id) {
  return env.DB.prepare(
    `INSERT INTO audit_log (ts, actor, action, item_id, before) SELECT ?, ?, ?, id, ${STOP_JSON} FROM stops WHERE id = ?`
  ).bind(ts, actor, action, id);
}

function auditAfter(env, action, id) {
  return env.DB.prepare(
    `UPDATE audit_log SET after = (SELECT ${STOP_JSON} FROM stops WHERE id = ?)
     WHERE id = (SELECT max(id) FROM audit_log WHERE action = ? AND item_id = ? AND after IS NULL)`
  ).bind(id, action, id);
}

async function getStopRow(env, id) {
  const row = await env.DB.prepare('SELECT * FROM stops WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, `Stop ${id} not found.`);
  return row;
}

async function getTripRow(env) {
  const row = await env.DB.prepare('SELECT * FROM trip WHERE id = 1').first();
  if (!row) {
    throw new HttpError(500, 'Trip row is missing. Apply schema.sql to the database.');
  }
  return row;
}

function parseSnapshot(value) {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// ---------- Handlers ----------

async function handleItinerary(env) {
  const [trip, days, stops] = await Promise.all([
    getTripRow(env),
    env.DB.prepare('SELECT * FROM days').all(),
    env.DB.prepare('SELECT * FROM stops ORDER BY position ASC, id ASC').all(),
  ]);
  const t = tripView(trip);
  const dayRows = new Map(days.results.map((r) => [r.date, r]));
  const byDate = new Map(); // date -> stops in order; '' is Ideas
  for (const row of stops.results) {
    const key = row.date ?? '';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(stopView(row));
  }
  const dayList = tripDates(t.start_date, t.end_date).map((date, i) => {
    const day = dayView(date, dayRows.get(date));
    day.n = i + 1;
    day.schedule = schedule(day, byDate.get(date) || []);
    return day;
  });
  return json({ trip: t, days: dayList, ideas: byDate.get('') || [] });
}

async function handleUpdateTrip(request, env, actor) {
  const body = await readJsonObject(request);
  const fields = cleanFields(body, TRIP_FIELDS);
  requireSomeFields(fields, TRIP_FIELDS);
  const current = await getTripRow(env);
  const merged = { ...current, ...fields };
  const start = merged.start_date;
  const end = merged.end_date;
  if (start != null && end != null) {
    if (end < start) {
      throw new HttpError(400, `Field "end_date" (${end}) must be on or after "start_date" (${start}).`);
    }
    if (dayCount(start, end) > MAX_DAYS) {
      throw new HttpError(400, `The trip can be at most ${MAX_DAYS} days long.`);
    }
  }
  if ('start_date' in fields || 'end_date' in fields) {
    const { n } = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM stops WHERE date IS NOT NULL AND (? IS NULL OR ? IS NULL OR date < ? OR date > ?)'
    ).bind(start, end, start, end).first();
    if (n > 0) {
      throw new HttpError(400, `${n === 1 ? '1 stop is' : `${n} stops are`} on a date outside the new trip dates. Move them to other days or to Ideas first (POST /api/stops/:id/move).`);
    }
  }
  const keys = Object.keys(fields);
  const ts = now();
  const sets = [...keys.map((k) => `${k} = ?`), 'updated_at = ?', 'updated_by = ?'];
  const values = [...keys.map((k) => fields[k]), ts, actor];
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO audit_log (ts, actor, action, item_id, before) SELECT ?, ?, 'update_trip', NULL, ${TRIP_JSON} FROM trip WHERE id = 1`
    ).bind(ts, actor),
    env.DB.prepare(`UPDATE trip SET ${sets.join(', ')} WHERE id = 1 RETURNING *`).bind(...values),
    env.DB.prepare(
      `UPDATE audit_log SET after = (SELECT ${TRIP_JSON} FROM trip WHERE id = 1)
       WHERE id = (SELECT max(id) FROM audit_log WHERE action = 'update_trip' AND after IS NULL)`
    ),
  ]);
  const row = results[1].results[0];
  if (!row) throw new HttpError(500, 'Trip row is missing. Apply schema.sql to the database.');
  return json(tripView(row));
}

async function handleCreateStop(request, env, actor) {
  const body = await readJsonObject(request);
  const row = cleanFields(body, STOP_FIELDS);
  requireTitle(row);
  row.date ??= null;
  row.kind ??= 'sight';
  row.duration_min ??= 60;
  row.status ??= row.date == null ? 'idea' : 'planned';
  checkIdeaRule(row);
  checkPair(row, 'lat', 'lng');
  if (row.date != null) checkInTrip(await getTripRow(env), row.date);
  const ts = now();
  const values = STOP_FIELDS.map((c) => row[c] ?? null);
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO stops (${STOP_FIELDS.join(', ')}, position, created_at, created_by, updated_at, updated_by)
       VALUES (${STOP_FIELDS.map(() => '?').join(', ')}, (SELECT COUNT(*) FROM stops WHERE date IS ?), ?, ?, ?, ?)
       RETURNING *`
    ).bind(...values, row.date, ts, actor, ts, actor),
    env.DB.prepare(
      `INSERT INTO audit_log (ts, actor, action, item_id, before, after)
       SELECT ?, ?, 'create', id, NULL, ${STOP_JSON} FROM stops WHERE id = last_insert_rowid()`
    ).bind(ts, actor),
  ]);
  return json(stopView(results[0].results[0]), 201);
}

async function handleUpdateStop(request, env, actor, id) {
  const body = await readJsonObject(request);
  const fields = cleanFields(body, STOP_FIELDS);
  requireSomeFields(fields, STOP_FIELDS);
  if ('title' in fields) requireTitle(fields);
  rejectNulls(fields, ['kind', 'duration_min', 'status']);
  const current = await getStopRow(env, id);
  const merged = { ...current, ...fields };
  checkIdeaRule(merged);
  checkPair(merged, 'lat', 'lng');
  const dateChanged = 'date' in fields && fields.date !== current.date;
  if (dateChanged && merged.date != null) checkInTrip(await getTripRow(env), merged.date);
  const keys = Object.keys(fields);
  const ts = now();
  const sets = [...keys.map((k) => `${k} = ?`), 'updated_at = ?', 'updated_by = ?'];
  const values = [...keys.map((k) => fields[k]), ts, actor];
  if (dateChanged) {
    // End of the new column. The count runs before this row changes.
    sets.push('position = (SELECT COUNT(*) FROM stops WHERE date IS ?)');
    values.push(merged.date);
  }
  const statements = [
    auditBefore(env, ts, actor, 'update', id),
    env.DB.prepare(`UPDATE stops SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id),
  ];
  if (dateChanged) statements.push(renumber(env, current.date));
  statements.push(auditAfter(env, 'update', id), env.DB.prepare('SELECT * FROM stops WHERE id = ?').bind(id));
  const results = await env.DB.batch(statements);
  const row = results[results.length - 1].results[0];
  if (!row) throw new HttpError(404, `Stop ${id} not found.`);
  return json(stopView(row));
}

async function handleDeleteStop(env, actor, id) {
  const current = await getStopRow(env, id);
  const ts = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO audit_log (ts, actor, action, item_id, before, after) SELECT ?, ?, 'delete', id, ${STOP_JSON}, NULL FROM stops WHERE id = ?`
    ).bind(ts, actor, id),
    env.DB.prepare('DELETE FROM stops WHERE id = ?').bind(id),
    renumber(env, current.date),
  ]);
  return json({ deleted: id });
}

async function handleMoveStop(request, env, actor, id) {
  const body = await readJsonObject(request);
  checkUnknownFields(body, ['date', 'index']);
  if (!('date' in body)) {
    throw new HttpError(400, 'Field "date" is required: a day in format YYYY-MM-DD, or null for Ideas.');
  }
  const date = body.date === null ? null : cleanString('date', body.date);
  if (date != null && !isRealDate(date)) {
    throw new HttpError(400, `Field "date" must be a real calendar date in format YYYY-MM-DD (e.g. "2025-03-14"), or null for Ideas. Got "${date}".`);
  }
  if (!Number.isInteger(body.index) || body.index < 0) {
    throw new HttpError(400, 'Field "index" is required: a whole number, 0 for the top of the column. Larger numbers go to the end.');
  }
  const current = await getStopRow(env, id);
  if (date != null) checkInTrip(await getTripRow(env), date);
  const same = current.date === date;
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM stops WHERE date IS ?').bind(date).first();
  const index = Math.min(body.index, same ? n - 1 : n);
  if (same && index === current.position) return json(stopView(current));
  const position = same && index > current.position ? index + 0.5 : index - 0.5;
  const status = date == null ? 'idea' : current.status === 'idea' ? 'planned' : current.status;
  const ts = now();
  const statements = [
    auditBefore(env, ts, actor, 'move', id),
    env.DB.prepare(
      'UPDATE stops SET date = ?, position = ?, status = ?, updated_at = ?, updated_by = ? WHERE id = ?'
    ).bind(date, position, status, ts, actor, id),
    renumber(env, date),
  ];
  if (!same) statements.push(renumber(env, current.date));
  statements.push(auditAfter(env, 'move', id), env.DB.prepare('SELECT * FROM stops WHERE id = ?').bind(id));
  const results = await env.DB.batch(statements);
  return json(stopView(results[results.length - 1].results[0]));
}

async function handleUpdateDay(request, env, actor, date) {
  if (!isRealDate(date)) {
    throw new HttpError(400, `The day in the URL must be a real calendar date in format YYYY-MM-DD (e.g. /api/days/2025-03-14). Got "${date}".`);
  }
  const body = await readJsonObject(request);
  const fields = cleanFields(body, DAY_FIELDS);
  requireSomeFields(fields, DAY_FIELDS);
  rejectNulls(fields, ['start_time']);
  checkInTrip(await getTripRow(env), date);
  const current = await env.DB.prepare('SELECT * FROM days WHERE date = ?').bind(date).first();
  const merged = { ...current, ...fields };
  checkPair(merged, 'start_lat', 'start_lng');
  checkPair(merged, 'end_lat', 'end_lng');
  const keys = Object.keys(fields);
  const cols = ['date', ...keys, 'updated_at', 'updated_by'];
  const ts = now();
  const values = [date, ...keys.map((k) => fields[k]), ts, actor];
  const updates = [...keys, 'updated_at', 'updated_by'].map((c) => `${c} = excluded.${c}`).join(', ');
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO audit_log (ts, actor, action, item_id, before)
       VALUES (?, ?, 'update_day', NULL, (SELECT ${DAY_JSON} FROM days WHERE date = ?))`
    ).bind(ts, actor, date),
    env.DB.prepare(
      `INSERT INTO days (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
       ON CONFLICT (date) DO UPDATE SET ${updates}`
    ).bind(...values),
    env.DB.prepare(
      `UPDATE audit_log SET after = (SELECT ${DAY_JSON} FROM days WHERE date = ?)
       WHERE id = (SELECT max(id) FROM audit_log WHERE action = 'update_day' AND after IS NULL)`
    ).bind(date),
    env.DB.prepare('SELECT * FROM days WHERE date = ?').bind(date),
  ]);
  return json(dayView(date, results[3].results[0]));
}

async function handleAudit(url, env) {
  let limit = AUDIT_DEFAULT_LIMIT;
  const raw = url.searchParams.get('limit');
  if (raw !== null) {
    if (!/^\d+$/.test(raw) || Number(raw) < 1) {
      throw new HttpError(400, `Query parameter "limit" must be a positive integer (max ${AUDIT_MAX_LIMIT}). Got "${raw}".`);
    }
    limit = Math.min(Number(raw), AUDIT_MAX_LIMIT);
  }
  const { results } = await env.DB.prepare(
    'SELECT id, ts, actor, action, item_id, before, after FROM audit_log ORDER BY id DESC LIMIT ?'
  ).bind(limit).all();
  const entries = results.map((r) => ({
    id: r.id,
    ts: r.ts,
    actor: r.actor,
    action: r.action,
    item_id: r.item_id ?? null,
    before: parseSnapshot(r.before),
    after: parseSnapshot(r.after),
  }));
  return json({ entries });
}

function methodNotAllowed(allowed) {
  return new HttpError(405, `Method not allowed. Allowed: ${allowed.join(', ')}.`, { Allow: allowed.join(', ') });
}

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (path === '/api') {
    if (method !== 'GET' && method !== 'HEAD') throw methodNotAllowed(['GET']);
    return text(apiDocs(url.origin));
  }

  if (path === '/api/whoami') {
    if (method !== 'GET') throw methodNotAllowed(['GET']);
    const actor = await requireActor(request, env);
    return json({ name: actor });
  }

  if (path === '/api/itinerary') {
    if (method !== 'GET') throw methodNotAllowed(['GET']);
    if (env.VIEW_PUBLIC !== 'true') await requireActor(request, env);
    return handleItinerary(env);
  }

  if (path === '/api/trip') {
    if (method !== 'PUT') throw methodNotAllowed(['PUT']);
    const actor = await requireActor(request, env);
    return handleUpdateTrip(request, env, actor);
  }

  const dayMatch = /^\/api\/days\/([^/]+)$/.exec(path);
  if (dayMatch) {
    if (method !== 'PUT') throw methodNotAllowed(['PUT']);
    const actor = await requireActor(request, env);
    return handleUpdateDay(request, env, actor, dayMatch[1]);
  }

  if (path === '/api/stops') {
    if (method !== 'POST') throw methodNotAllowed(['POST']);
    const actor = await requireActor(request, env);
    return handleCreateStop(request, env, actor);
  }

  const moveMatch = /^\/api\/stops\/([^/]+)\/move$/.exec(path);
  if (moveMatch) {
    if (method !== 'POST') throw methodNotAllowed(['POST']);
    const actor = await requireActor(request, env);
    return handleMoveStop(request, env, actor, parseId(moveMatch[1]));
  }

  const stopMatch = /^\/api\/stops\/([^/]+)$/.exec(path);
  if (stopMatch) {
    if (method !== 'PUT' && method !== 'DELETE') throw methodNotAllowed(['PUT', 'DELETE']);
    const actor = await requireActor(request, env);
    const id = parseId(stopMatch[1]);
    if (method === 'PUT') return handleUpdateStop(request, env, actor, id);
    return handleDeleteStop(env, actor, id);
  }

  if (path === '/api/audit') {
    if (method !== 'GET') throw methodNotAllowed(['GET']);
    await requireActor(request, env);
    return handleAudit(url, env);
  }

  throw new HttpError(404, `Unknown API route: ${method} ${url.pathname}. See GET /api for the list of endpoints.`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.message }, err.status, err.headers || {});
      }
      console.error(err);
      const msg = String(err && err.message || err);
      if (/no such table/i.test(msg)) {
        return json({ error: 'Database is not initialised. Apply schema.sql to the D1 database.' }, 500);
      }
      return json({ error: 'Internal server error.' }, 500);
    }
  },
};

// ---------- Docs ----------

function apiDocs(origin) {
  return `Itinerary API
=============

Base URL: ${origin}
All responses are JSON except this page (GET /api), which is plain text.

HOW THE ITINERARY WORKS
-----------------------
A trip has a start and end date. Each date is a "day" with optional
settings (title, start time, start place, end place).

Stops belong to a day, in order, or to "Ideas" (no date). Stop start
times are NOT stored. They are worked out from:
  - the day's start_time (default 09:00) for the first stop,
  - each stop's duration_min,
  - rough travel time between stops (from lat/lng; 15 min if unknown),
  - after_time (earliest start) and fixed_time (a start that never moves).
If a fixed_time can't be reached in time, the stop shows as late
("clashes"). To change when something happens, change the order,
durations, after_time or fixed_time.

AUTHENTICATION
--------------
Send your key in every request (except GET /api):

  Authorization: Bearer <your-key>

Each key has a name. That name is recorded as the actor on every change.
Missing or invalid key -> 401.
GET /api/itinerary may be open without a key if the site owner enabled
public viewing. Writes and the audit log always need a key.

ENDPOINTS
---------
GET    /api                    This text. No auth.
GET    /api/whoami             -> {"name": "<key name>"}
GET    /api/itinerary          -> {"trip": {...}, "days": [day, ...], "ideas": [stop, ...]}
                               days lists every date from start_date to end_date.
PUT    /api/trip               Update trip details (partial body allowed). -> trip
PUT    /api/days/:date         Create or update one day's settings (partial body
                               allowed). :date is YYYY-MM-DD within the trip.
                               -> the day's settings (no "n" or "schedule").
POST   /api/stops              Create a stop. -> 201 with the stop.
                               No "date" (or null) puts it in Ideas.
                               It is added at the end of its day or of Ideas.
PUT    /api/stops/:id          Update a stop (partial body allowed). -> stop
                               If "date" changes, the stop goes to the end of the
                               new day. 404 if missing.
                               PUT does not change status for you. To put an
                               idea on a day, send "date" and a non-idea "status"
                               (e.g. "planned"). To send a stop to Ideas, send
                               "date": null and "status": "idea". The move
                               endpoint below does this for you.
POST   /api/stops/:id/move     Reorder a stop or move it to another day or Ideas.
                               Body: {"date": "YYYY-MM-DD" or null, "index": n}
                               Both "date" and "index" are required.
                               index is the stop's new position in that column,
                               0 = first. Larger numbers mean last.
                               Moving to Ideas sets status "idea". Moving out of
                               Ideas sets status "planned", so a "booked" stop
                               sent to Ideas and back comes back "planned". -> stop
DELETE /api/stops/:id          Delete a stop. -> {"deleted": <id>}. 404 if missing.
GET    /api/audit?limit=50     Recent changes, newest first.
                               limit: positive integer, default ${AUDIT_DEFAULT_LIMIT}, max ${AUDIT_MAX_LIMIT}.
                               -> {"entries": [{"id","ts","actor","action",
                                   "item_id","before","after"}]}
                               action: create, update, delete, move, update_trip, update_day.
                               item_id is the stop id (null for trip and day changes).
                               before/after are full row snapshots (or null).

OBJECTS
-------
trip: {"name", "start_date", "end_date", "timezone", "travellers",
       "updated_at", "updated_by"}

stop: {"id", "date", "position", "title", "area", "kind", "duration_min",
       "status", "fixed_time", "after_time", "stub", "booking_ref", "notes",
       "link", "lat", "lng", "created_at", "created_by", "updated_at", "updated_by"}
       position is the order within its day or Ideas, 0 = first.

day (in GET /api/itinerary):
  {"date", "n", "title", "start_time", "start_place", "start_lat", "start_lng",
   "end_place", "end_lat", "end_lng", "updated_at", "updated_by",
   "schedule": {
     "stops": [stop + {"start", "end", "leg", "free_min", "late_min"}],
     "start_leg", "leave_at", "back_leg", "back_at", "total_min",
     "clashes": [{"id", "title", "late_min"}]
   }}
  n is the day number (1 = first day). start/end/leave_at/back_at are HH:MM.
  leg is the travel before a stop: {"mode": "walk"|"taxi"|"train"|"any",
  "min", "text"}, null for the first stop. start_leg/back_leg are the legs
  from start_place and to end_place (null if those have no lat/lng).

Fields that are not set are null. Timestamps are ISO 8601 UTC strings.

FIELDS AND VALIDATION
---------------------
Request bodies must be a JSON object. Unknown fields are rejected.
Strings are trimmed. An empty string for an optional field sets it to null.

Trip fields (PUT /api/trip):
  name        string, max ${MAX_LENGTHS.name} chars
  start_date  YYYY-MM-DD, a real calendar date
  end_date    YYYY-MM-DD, on or after start_date. At most ${MAX_DAYS} days in total.
  timezone    IANA time zone name, e.g. "Asia/Singapore", "Europe/London", "UTC"
  travellers  whole number 1 to 99, or null
  Changing the dates is rejected if any stop would fall outside them.

Day fields (PUT /api/days/:date):
  title        string, max ${MAX_LENGTHS.title} chars
  start_time   HH:MM, 24-hour. Cannot be null. Default 09:00.
  start_place  string, max ${MAX_LENGTHS.start_place} chars (e.g. "Hotel")
  start_lat, start_lng   numbers; set both or neither
  end_place    string, max ${MAX_LENGTHS.end_place} chars
  end_lat, end_lng       numbers; set both or neither

Stop fields (POST /api/stops, PUT /api/stops/:id):
  title        REQUIRED on create. Non-empty string, max ${MAX_LENGTHS.title} chars.
  date         YYYY-MM-DD within the trip dates, or null for Ideas.
  status       one of: ${STATUSES.join(', ')}. Default "planned" (or "idea" with no date).
               "idea" is used exactly when date is null.
  kind         one of: ${KINDS.join(', ')}. Default "sight". Sets the icon.
  duration_min whole number 5 to 1440. Default 60.
  fixed_time   HH:MM. A start time that never moves (train, restaurant booking).
  after_time   HH:MM. Earliest start (e.g. lunch not before 11:30).
  area         string, max ${MAX_LENGTHS.area} chars (e.g. "Higashiyama")
  stub         string, max ${MAX_LENGTHS.stub} chars. Short booking label ("Car 8").
  booking_ref  string, max ${MAX_LENGTHS.booking_ref} chars. Full booking details.
  notes        string, max ${MAX_LENGTHS.notes} chars
  link         http:// or https:// URL, max ${MAX_LENGTHS.link} chars
  lat          number -90 to 90. Set lat and lng together, or neither.
  lng          number -180 to 180. Used for travel estimates.
  title, kind, duration_min and status cannot be set to null.

ERRORS
------
Errors are JSON: {"error": "<message>"}
  400  validation error (the message names the field and expected format)
  401  missing or invalid key
  404  unknown stop or route
  405  wrong HTTP method for this path
  500  server error or misconfiguration

EXAMPLES
--------
curl -H "Authorization: Bearer $KEY" ${origin}/api/itinerary

curl -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"name":"Kyoto in autumn","start_date":"2026-11-20","end_date":"2026-11-22","timezone":"Asia/Tokyo","travellers":2}' \\
  ${origin}/api/trip

curl -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"title":"Arashiyama","start_time":"08:00","start_place":"Hotel","start_lat":35.0089,"start_lng":135.77}' \\
  ${origin}/api/days/2026-11-21

curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"date":"2026-11-21","title":"Tenryu-ji garden","kind":"sight","duration_min":60,"lat":35.0156,"lng":135.6737}' \\
  ${origin}/api/stops

curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"date":"2026-11-21","title":"Yudofu lunch","kind":"food","status":"booked","fixed_time":"11:30","stub":"Table for 2"}' \\
  ${origin}/api/stops

curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"date":null,"index":0}' \\
  ${origin}/api/stops/1/move

curl -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"notes":"Go early to avoid crowds"}' \\
  ${origin}/api/stops/1

curl -X DELETE -H "Authorization: Bearer $KEY" ${origin}/api/stops/1

curl -H "Authorization: Bearer $KEY" "${origin}/api/audit?limit=20"
`;
}
