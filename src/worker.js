// Itinerary Worker: serves static pages from ./public and a JSON API under /api.
// See GET /api for the API docs.

const ITEM_FIELDS = ['date', 'start_time', 'end_time', 'title', 'location', 'notes', 'link'];
const TRIP_FIELDS = ['name', 'start_date', 'end_date', 'timezone'];

const ITEM_COLUMNS = [
  'id', 'date', 'start_time', 'end_time', 'title', 'location', 'notes', 'link',
  'created_at', 'created_by', 'updated_at', 'updated_by',
];
const TRIP_COLUMNS = ['name', 'start_date', 'end_date', 'timezone', 'updated_at', 'updated_by'];

const MAX_LENGTHS = {
  title: 200,
  location: 300,
  notes: 5000,
  link: 2000,
  name: 200,
  timezone: 64,
};

const MAX_BODY_BYTES = 64 * 1024;
const AUDIT_DEFAULT_LIMIT = 50;
const AUDIT_MAX_LIMIT = 200;

// SQL expressions that build a full-row JSON snapshot.
const ITEM_JSON = `json_object(${ITEM_COLUMNS.map((c) => `'${c}', ${c}`).join(', ')})`;
const TRIP_JSON = `json_object(${TRIP_COLUMNS.map((c) => `'${c}', ${c}`).join(', ')})`;

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

// Validates fields present in body. Returns an object with cleaned values.
function validateItemFields(body, { isCreate }) {
  checkUnknownFields(body, ITEM_FIELDS);
  const out = {};
  for (const field of ITEM_FIELDS) {
    if (!(field in body)) continue;
    out[field] = cleanString(field, body[field]);
  }
  if (isCreate || 'date' in out) {
    if (out.date == null) {
      throw new HttpError(400, 'Field "date" is required, format YYYY-MM-DD (e.g. "2025-03-14").');
    }
  }
  if (out.date != null && !isRealDate(out.date)) {
    throw new HttpError(400, `Field "date" must be a real calendar date in format YYYY-MM-DD (e.g. "2025-03-14"). Got "${out.date}".`);
  }
  if (isCreate || 'title' in out) {
    if (out.title == null) {
      throw new HttpError(400, 'Field "title" is required and must be a non-empty string.');
    }
  }
  for (const f of ['start_time', 'end_time']) {
    if (out[f] != null && !isTime(out[f])) {
      throw new HttpError(400, `Field "${f}" must be a 24-hour time in format HH:MM (e.g. "09:30", "18:05"). Got "${out[f]}".`);
    }
  }
  if (out.link != null && !isHttpUrl(out.link)) {
    throw new HttpError(400, 'Field "link" must be a full http:// or https:// URL (e.g. "https://example.com").');
  }
  return out;
}

function checkTimeOrder(start, end) {
  if (start != null && end != null && end <= start) {
    throw new HttpError(400, `Field "end_time" (${end}) must be after "start_time" (${start}).`);
  }
}

function validateTripFields(body) {
  checkUnknownFields(body, TRIP_FIELDS);
  const out = {};
  for (const field of TRIP_FIELDS) {
    if (!(field in body)) continue;
    out[field] = cleanString(field, body[field]);
  }
  for (const f of ['start_date', 'end_date']) {
    if (out[f] != null && !isRealDate(out[f])) {
      throw new HttpError(400, `Field "${f}" must be a real calendar date in format YYYY-MM-DD (e.g. "2025-03-14"). Got "${out[f]}".`);
    }
  }
  if (out.timezone != null && !isTimezone(out.timezone)) {
    throw new HttpError(400, `Field "timezone" must be a valid IANA time zone name (e.g. "Asia/Singapore", "Europe/London", "UTC"). Got "${out.timezone}".`);
  }
  return out;
}

function parseId(raw) {
  if (!/^[1-9]\d{0,15}$/.test(raw)) {
    throw new HttpError(400, `Item id must be a positive integer. Got "${raw}".`);
  }
  return Number(raw);
}

// ---------- Data helpers ----------

function tripView(row) {
  const t = {};
  for (const c of TRIP_COLUMNS) t[c] = row ? row[c] ?? null : null;
  return t;
}

function itemView(row) {
  const item = {};
  for (const c of ITEM_COLUMNS) item[c] = row[c] ?? null;
  return item;
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
  const [trip, items] = await Promise.all([
    getTripRow(env),
    env.DB.prepare('SELECT * FROM items ORDER BY date ASC, start_time IS NOT NULL, start_time ASC, id ASC').all(),
  ]);
  return json({ trip: tripView(trip), items: items.results.map(itemView) });
}

async function handleUpdateTrip(request, env, actor) {
  const body = await readJsonObject(request);
  const fields = validateTripFields(body);
  const keys = Object.keys(fields);
  if (keys.length === 0) {
    throw new HttpError(400, `Request body has no fields to update. Allowed fields: ${TRIP_FIELDS.join(', ')}.`);
  }
  const current = await getTripRow(env);
  const merged = { ...current, ...fields };
  if (merged.start_date != null && merged.end_date != null && merged.end_date < merged.start_date) {
    throw new HttpError(400, `Field "end_date" (${merged.end_date}) must be on or after "start_date" (${merged.start_date}).`);
  }
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

async function handleCreateItem(request, env, actor) {
  const body = await readJsonObject(request);
  const fields = validateItemFields(body, { isCreate: true });
  checkTimeOrder(fields.start_time ?? null, fields.end_time ?? null);
  const ts = now();
  const cols = ITEM_FIELDS;
  const values = cols.map((c) => fields[c] ?? null);
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO items (${cols.join(', ')}, created_at, created_by, updated_at, updated_by)
       VALUES (${cols.map(() => '?').join(', ')}, ?, ?, ?, ?) RETURNING *`
    ).bind(...values, ts, actor, ts, actor),
    env.DB.prepare(
      `INSERT INTO audit_log (ts, actor, action, item_id, before, after)
       SELECT ?, ?, 'create', id, NULL, ${ITEM_JSON} FROM items WHERE id = last_insert_rowid()`
    ).bind(ts, actor),
  ]);
  return json(itemView(results[0].results[0]), 201);
}

async function handleUpdateItem(request, env, actor, id) {
  const body = await readJsonObject(request);
  const fields = validateItemFields(body, { isCreate: false });
  const keys = Object.keys(fields);
  if (keys.length === 0) {
    throw new HttpError(400, `Request body has no fields to update. Allowed fields: ${ITEM_FIELDS.join(', ')}.`);
  }
  const current = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  if (!current) throw new HttpError(404, `Item ${id} not found.`);
  const merged = { ...current, ...fields };
  checkTimeOrder(merged.start_time, merged.end_time);
  const ts = now();
  const sets = [...keys.map((k) => `${k} = ?`), 'updated_at = ?', 'updated_by = ?'];
  const values = [...keys.map((k) => fields[k]), ts, actor];
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO audit_log (ts, actor, action, item_id, before) SELECT ?, ?, 'update', id, ${ITEM_JSON} FROM items WHERE id = ?`
    ).bind(ts, actor, id),
    env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ? RETURNING *`).bind(...values, id),
    env.DB.prepare(
      `UPDATE audit_log SET after = (SELECT ${ITEM_JSON} FROM items WHERE id = ?)
       WHERE id = (SELECT max(id) FROM audit_log WHERE action = 'update' AND item_id = ? AND after IS NULL)`
    ).bind(id, id),
  ]);
  const row = results[1].results[0];
  if (!row) throw new HttpError(404, `Item ${id} not found.`);
  return json(itemView(row));
}

async function handleDeleteItem(env, actor, id) {
  const ts = now();
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO audit_log (ts, actor, action, item_id, before, after) SELECT ?, ?, 'delete', id, ${ITEM_JSON}, NULL FROM items WHERE id = ?`
    ).bind(ts, actor, id),
    env.DB.prepare('DELETE FROM items WHERE id = ? RETURNING id').bind(id),
  ]);
  if (!results[1].results.length) throw new HttpError(404, `Item ${id} not found.`);
  return json({ deleted: id });
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

  if (path === '/api/items') {
    if (method !== 'POST') throw methodNotAllowed(['POST']);
    const actor = await requireActor(request, env);
    return handleCreateItem(request, env, actor);
  }

  const itemMatch = /^\/api\/items\/([^/]+)$/.exec(path);
  if (itemMatch) {
    if (method !== 'PUT' && method !== 'DELETE') throw methodNotAllowed(['PUT', 'DELETE']);
    const actor = await requireActor(request, env);
    const id = parseId(itemMatch[1]);
    if (method === 'PUT') return handleUpdateItem(request, env, actor, id);
    return handleDeleteItem(env, actor, id);
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
GET    /api                 This text. No auth.
GET    /api/whoami          -> {"name": "<key name>"}
GET    /api/itinerary       -> {"trip": {...}, "items": [item, ...]}
                            Items sorted by date, then start_time (items with
                            no start_time first in their day), then id.
PUT    /api/trip            Update trip details (partial body allowed).
                            -> the updated trip object
POST   /api/items           Create an item. -> 201 with the created item
PUT    /api/items/:id       Update an item (partial body allowed).
                            -> the updated item. 404 if missing.
DELETE /api/items/:id       Delete an item. -> {"deleted": <id>}. 404 if missing.
GET    /api/audit?limit=50  Recent changes, newest first.
                            limit: positive integer, default ${AUDIT_DEFAULT_LIMIT}, max ${AUDIT_MAX_LIMIT}.
                            -> {"entries": [{"id","ts","actor","action",
                                "item_id","before","after"}]}
                            action is one of: create, update, delete, update_trip.
                            before/after are full row snapshots (or null).

OBJECTS
-------
trip: {"name", "start_date", "end_date", "timezone", "updated_at", "updated_by"}
item: {"id", "date", "start_time", "end_time", "title", "location", "notes",
       "link", "created_at", "created_by", "updated_at", "updated_by"}
Fields that are not set are null. Timestamps are ISO 8601 UTC strings.

FIELDS AND VALIDATION
---------------------
Request bodies must be a JSON object. Unknown fields are rejected.
Strings are trimmed. An empty string for an optional field sets it to null.

Trip fields (PUT /api/trip):
  name        string, max ${MAX_LENGTHS.name} chars
  start_date  YYYY-MM-DD, a real calendar date
  end_date    YYYY-MM-DD, must be on or after start_date
  timezone    IANA time zone name, e.g. "Asia/Singapore", "Europe/London", "UTC"

Item fields (POST /api/items, PUT /api/items/:id):
  date        REQUIRED on create. YYYY-MM-DD, a real calendar date. Cannot be null.
  title       REQUIRED on create. Non-empty string, max ${MAX_LENGTHS.title} chars. Cannot be null.
  start_time  HH:MM, 24-hour (e.g. "09:30")
  end_time    HH:MM, 24-hour. Must be after start_time when both are set
              (on update, checked against the stored values too).
  location    string, max ${MAX_LENGTHS.location} chars
  notes       string, max ${MAX_LENGTHS.notes} chars
  link        http:// or https:// URL, max ${MAX_LENGTHS.link} chars

ERRORS
------
Errors are JSON: {"error": "<message>"}
  400  validation error (the message names the field and expected format)
  401  missing or invalid key
  404  unknown item or route
  405  wrong HTTP method for this path
  500  server error or misconfiguration

EXAMPLES
--------
curl -H "Authorization: Bearer $KEY" ${origin}/api/itinerary

curl -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"name":"Japan 2025","start_date":"2025-04-01","end_date":"2025-04-10","timezone":"Asia/Tokyo"}' \\
  ${origin}/api/trip

curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"date":"2025-04-02","start_time":"09:00","end_time":"11:00","title":"Senso-ji temple","location":"Asakusa"}' \\
  ${origin}/api/items

curl -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"notes":"Go early to avoid crowds"}' \\
  ${origin}/api/items/1

curl -X DELETE -H "Authorization: Bearer $KEY" ${origin}/api/items/1

curl -H "Authorization: Bearer $KEY" "${origin}/api/audit?limit=20"
`;
}
