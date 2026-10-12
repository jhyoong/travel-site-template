// Date helpers. No DOM access, so the Worker imports them too and they
// can be unit tested with node --test (see test/dates.test.mjs).

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

// Longest trip allowed. The Worker rejects longer date ranges.
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

// "2026-11-20" -> "Friday 20 November"
export function formatLongDay(dateStr) {
  const dt = parseDate(dateStr);
  if (!dt) return dateStr || "";
  return LONG_DAYS[dt.getUTCDay()] + " " + dt.getUTCDate() + " " + LONG_MONTHS[dt.getUTCMonth()];
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

// ISO timestamp -> local date and time in the browser's locale.
export function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

// Number of days from start to end, counting both.
export function dayCount(start, end) {
  return Math.round((parseDate(end) - parseDate(start)) / 86400000) + 1;
}

// Every date from start to end (at most MAX_DAYS). Empty if either date
// is missing or end is before start.
export function tripDates(start, end) {
  if (!parseDate(start) || !parseDate(end) || end < start) return [];
  const out = [];
  for (let d = start; d <= end && out.length < MAX_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}
