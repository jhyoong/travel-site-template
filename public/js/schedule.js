// Works out stop times for one day from stop order, durations and rough
// travel estimates. Pure functions with no DOM, shared by the page and
// the Worker so both show the same times.

export const DEFAULT_START = "09:00";
export const FREE_MIN = 20; // free time shorter than this isn't shown

const pad = (n) => String(n).padStart(2, "0");
export const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const fmtT = (x) => { const v = ((Math.round(x) % 1440) + 1440) % 1440; return pad(Math.floor(v / 60)) + ":" + pad(v % 60); };
export const fmtDur = (m) => { const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r} min`; };
const ceil5 = (x) => Math.ceil(x / 5) * 5;
const floor5 = (x) => Math.floor(x / 5) * 5;
const point = (lat, lng) => (lat == null || lng == null ? null : [lat, lng]);

function km(a, b) {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Rough estimate from straight-line distance. a and b are [lat, lng] or null.
export function travel(a, b) {
  if (!a || !b) return { mode: "any", min: 15, text: "About 15 min travel" };
  const d = km(a, b) * 1.3;
  if (d < 0.15) return { mode: "walk", min: 2, text: "2 min walk" };
  if (d <= 1.6) { const m = Math.max(3, Math.round(d / 4.5 * 60)); return { mode: "walk", min: m, text: `${m} min walk` }; }
  if (d <= 10) { const m = Math.max(5, Math.round((6 + d * 2.4) / 5) * 5); return { mode: "taxi", min: m, text: `${m} min taxi` }; }
  const m = Math.round((15 + d * 1.6) / 5) * 5;
  return { mode: "train", min: m, text: `${m} min by train` };
}

// day: { start_time, start_lat, start_lng, end_lat, end_lng }
// stops: in order, each with duration_min, fixed_time, after_time, lat, lng.
// Returns { stops, start_leg, leave_at, back_leg, back_at, total_min, clashes }.
// Each returned stop is a copy with start, end, leg, free_min and late_min added.
export function schedule(day, stops) {
  const from = point(day.start_lat, day.start_lng);
  const to = point(day.end_lat, day.end_lng);
  const out = { stops: [], start_leg: null, leave_at: null, back_leg: null, back_at: null, total_min: 0, clashes: [] };
  let prevEnd = 0, prevLL = null, firstStart = 0;
  stops.forEach((s, i) => {
    const ll = point(s.lat, s.lng);
    let leg = null, earliest;
    if (i === 0) {
      earliest = toMin(day.start_time || DEFAULT_START);
      if (from) out.start_leg = travel(from, ll);
    } else {
      leg = travel(prevLL, ll);
      earliest = ceil5(prevEnd + leg.min);
    }
    let start = earliest, late = 0;
    if (s.after_time) start = Math.max(start, toMin(s.after_time));
    if (s.fixed_time) {
      const f = toMin(s.fixed_time);
      if (i > 0 && earliest > f) late = earliest - f;
      start = f;
    }
    const free = i > 0 && !late ? Math.max(0, start - earliest) : 0;
    if (i === 0) firstStart = start;
    out.stops.push({ ...s, start: fmtT(start), end: fmtT(start + s.duration_min), leg, free_min: free, late_min: late });
    if (late) out.clashes.push({ id: s.id, title: s.title, late_min: late });
    out.total_min += s.duration_min;
    prevEnd = start + s.duration_min;
    prevLL = ll;
  });
  if (stops.length && out.start_leg) out.leave_at = fmtT(floor5(firstStart - out.start_leg.min));
  if (stops.length && to) {
    out.back_leg = travel(prevLL, to);
    out.back_at = fmtT(ceil5(prevEnd + out.back_leg.min));
  }
  return out;
}
