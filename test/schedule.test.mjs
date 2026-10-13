// Unit tests for the schedule module shared by the page and the Worker.
// Run: node --test test/schedule.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { schedule, toMin, fmtT, fmtDur, DEFAULT_START } from "../public/js/schedule.js";

const HOTEL = { lat: 35.0089, lng: 135.77 };
const stop = (id, extra = {}) => ({
  id, title: "Stop " + id, duration_min: 60, fixed_time: null, after_time: null, lat: null, lng: null, ...extra
});
const day = (extra = {}) => ({
  start_time: "09:00", start_place: null, start_lat: null, start_lng: null, end_place: null, end_lat: null, end_lng: null, ...extra
});
const EMPTY = { stops: [], leave_at: null, back_at: null, total_min: 0, clashes: [] };

test("time helpers", () => {
  assert.equal(toMin("10:30"), 630);
  assert.equal(fmtT(630), "10:30");
  assert.equal(fmtT(1440 + 65), "01:05");
  assert.equal(fmtDur(45), "45 min");
  assert.equal(fmtDur(60), "1h");
  assert.equal(fmtDur(135), "2h 15m");
});

test("an empty day has no stops or clashes", () => {
  assert.deepEqual(schedule(day(), []), EMPTY);
});

test("the first stop starts at the day start, or 09:00 if unset", () => {
  assert.equal(schedule(day({ start_time: "10:30" }), [stop(1)]).stops[0].start, "10:30");
  assert.equal(schedule(day({ start_time: null }), [stop(1)]).stops[0].start, DEFAULT_START);
  assert.equal(DEFAULT_START, "09:00");
});

test("later stops start when the one before ends, with no travel time", () => {
  const sc = schedule(day(), [stop(1, { duration_min: 50, lat: 35, lng: 135 }), stop(2, { lat: 35.2, lng: 135.77 })]);
  const [a, b] = sc.stops;
  assert.equal(a.start, "09:00");
  assert.equal(a.end, "09:50");
  assert.equal(b.start, "09:50");
  assert.equal(b.end, "10:50");
  assert.equal(b.free_min, 0);
  assert.equal(b.late_min, 0);
});

test("after_time pushes a stop later and leaves free time", () => {
  const b = schedule(day(), [stop(1), stop(2, { after_time: "11:30" })]).stops[1];
  assert.equal(b.start, "11:30");
  assert.equal(b.free_min, 90);
});

test("fixed_time holds and reports how late you would be", () => {
  const sc = schedule(day(), [stop(1, { duration_min: 120 }), stop(2, { fixed_time: "10:30", duration_min: 30 })]);
  const b = sc.stops[1];
  assert.equal(b.start, "10:30");
  assert.equal(b.end, "11:00");
  assert.equal(b.late_min, 30);
  assert.equal(b.free_min, 0);
  assert.deepEqual(sc.clashes, [{ id: 2, title: "Stop 2", late_min: 30 }]);
});

test("late_ok keeps the fixed time but drops the late warning", () => {
  const sc = schedule(day(), [stop(1, { duration_min: 120 }), stop(2, { fixed_time: "10:30", duration_min: 30, late_ok: true })]);
  const b = sc.stops[1];
  assert.equal(b.start, "10:30");
  assert.equal(b.late_min, 0);
  assert.equal(b.free_min, 0);
  assert.deepEqual(sc.clashes, []);
});

test("fixed_time on the first stop overrides the day start without a clash", () => {
  const sc = schedule(day(), [stop(1, { fixed_time: "08:00" })]);
  assert.equal(sc.stops[0].start, "08:00");
  assert.equal(sc.stops[0].late_min, 0);
  assert.deepEqual(sc.clashes, []);
});

test("start and end places set leave and back times at the first start and last end", () => {
  assert.deepEqual(schedule(day({ start_place: "Hotel", end_place: "Hotel" }), [stop(1), stop(2)]),
    { ...schedule(day(), [stop(1), stop(2)]), leave_at: "09:00", back_at: "11:00" });
  const byLocation = schedule(day({ start_lat: HOTEL.lat, start_lng: HOTEL.lng, end_lat: HOTEL.lat, end_lng: HOTEL.lng }), [stop(1)]);
  assert.equal(byLocation.leave_at, "09:00");
  assert.equal(byLocation.back_at, "10:00");
  assert.equal(schedule(day({ start_place: "Hotel", end_place: "Hotel" }), []).leave_at, null);
});

test("total_min adds up durations and stop fields are kept", () => {
  const sc = schedule(day(), [stop(1, { duration_min: 45 }), stop(2, { duration_min: 30 })]);
  assert.equal(sc.total_min, 75);
  assert.equal(sc.stops[0].title, "Stop 1");
  assert.equal(sc.stops[0].id, 1);
});

test("schedule can run again on its own output", () => {
  const first = schedule(day(), [stop(1), stop(2)]);
  assert.deepEqual(schedule(day(), first.stops), first);
});
