// Unit tests for the pure date helpers used by the page and the Worker.
// Run: node --test test/dates.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, formatDay, formatLongDay, formatDateRange, dayCount, tripDates, MAX_DAYS
} from "../public/js/dates.js";

test("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-12-31", 2), "2027-01-02");
});

test("formatDay shows weekday, day and month", () => {
  assert.equal(formatDay("2026-10-14"), "Wed 14 Oct");
  assert.equal(formatDay("bad"), "bad");
});

test("formatLongDay shows the full weekday and month", () => {
  assert.equal(formatLongDay("2026-11-20"), "Friday 20 November");
  assert.equal(formatLongDay("bad"), "bad");
});

test("formatDateRange", () => {
  assert.equal(formatDateRange("2026-10-12", "2026-10-14"), "12 Oct 2026 to 14 Oct 2026");
  assert.equal(formatDateRange("2026-10-12", null), "From 12 Oct 2026");
  assert.equal(formatDateRange(null, "2026-10-14"), "Until 14 Oct 2026");
  assert.equal(formatDateRange(null, null), "");
});

test("dayCount counts both ends", () => {
  assert.equal(dayCount("2026-10-12", "2026-10-12"), 1);
  assert.equal(dayCount("2026-10-12", "2026-10-14"), 3);
  assert.equal(dayCount("2026-12-31", "2027-01-01"), 2);
});

test("tripDates lists every date in the range", () => {
  assert.deepEqual(tripDates("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
});

test("tripDates is empty for a missing or reversed range", () => {
  assert.deepEqual(tripDates(null, "2026-10-14"), []);
  assert.deepEqual(tripDates("2026-10-14", null), []);
  assert.deepEqual(tripDates("2026-10-14", "2026-10-12"), []);
});

test("tripDates returns at most MAX_DAYS dates", () => {
  assert.equal(tripDates("2026-01-01", "2030-01-01").length, MAX_DAYS);
});
