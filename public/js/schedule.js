// Works out stop times for one day from stop order and durations. Pure
// functions with no DOM, shared by the page and the Worker so both show the
// same times.

export const DEFAULT_START = "09:00";
export const FREE_MIN = 20; // free time shorter than this isn't shown

const pad = (n) => String(n).padStart(2, "0");
export const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const fmtT = (x) => { const v = ((Math.round(x) % 1440) + 1440) % 1440; return pad(Math.floor(v / 60)) + ":" + pad(v % 60); };
export const fmtDur = (m) => { const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r} min`; };
const hasPlace = (name, lat) => !!name || lat != null;

// day: { start_time, start_place, start_lat, start_lng, end_place, end_lat, end_lng }
// stops: in order, each with duration_min, fixed_time, after_time and late_ok.
// Each stop starts when the one before ends; travel time is not included.
// late_ok: the late warning was dismissed, so the stop is never marked late.
// Returns { stops, leave_at, back_at, total_min, clashes }. leave_at is the
// first stop's start and back_at the last stop's end, set only when the day
// has a start or end place.
// Each returned stop is a copy with start, end, free_min and late_min added.
export function schedule(day, stops) {
  const out = { stops: [], leave_at: null, back_at: null, total_min: 0, clashes: [] };
  let prevEnd = 0;
  stops.forEach((s, i) => {
    const earliest = i === 0 ? toMin(day.start_time || DEFAULT_START) : prevEnd;
    let start = earliest, late = 0;
    if (s.after_time) start = Math.max(start, toMin(s.after_time));
    if (s.fixed_time) {
      const f = toMin(s.fixed_time);
      if (i > 0 && earliest > f && !s.late_ok) late = earliest - f;
      start = f;
    }
    const free = i > 0 && !late ? Math.max(0, start - earliest) : 0;
    if (i === 0 && hasPlace(day.start_place, day.start_lat)) out.leave_at = fmtT(start);
    out.stops.push({ ...s, start: fmtT(start), end: fmtT(start + s.duration_min), free_min: free, late_min: late });
    if (late) out.clashes.push({ id: s.id, title: s.title, late_min: late });
    out.total_min += s.duration_min;
    prevEnd = start + s.duration_min;
  });
  if (stops.length && hasPlace(day.end_place, day.end_lat)) out.back_at = fmtT(prevEnd);
  return out;
}
