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
