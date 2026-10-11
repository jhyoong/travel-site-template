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
