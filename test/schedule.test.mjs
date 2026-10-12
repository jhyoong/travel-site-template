// Unit tests for the schedule module shared by the page and the Worker.
// Run: node --test test/schedule.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { travel, schedule, toMin, fmtT, fmtDur, DEFAULT_START } from "../public/js/schedule.js";

const HOTEL = { lat: 35.0089, lng: 135.77 };
const stop = (id, extra = {}) => ({
  id, title: "Stop " + id, duration_min: 60, fixed_time: null, after_time: null, lat: null, lng: null, ...extra
});
const day = (extra = {}) => ({
  start_time: "09:00", start_lat: null, start_lng: null, end_lat: null, end_lng: null, ...extra
});
const EMPTY = { stops: [], start_leg: null, leave_at: null, back_leg: null, back_at: null, total_min: 0, clashes: [] };

test("time helpers", () => {
  assert.equal(toMin("10:30"), 630);
  assert.equal(fmtT(630), "10:30");
  assert.equal(fmtT(1440 + 65), "01:05");
  assert.equal(fmtDur(45), "45 min");
  assert.equal(fmtDur(60), "1h");
  assert.equal(fmtDur(135), "2h 15m");
});

test("travel falls back to 15 minutes when a location is missing", () => {
  const fallback = { mode: "any", min: 15, text: "About 15 min travel" };
  assert.deepEqual(travel(null, [35, 135]), fallback);
  assert.deepEqual(travel([35, 135], null), fallback);
});

test("travel picks walk, taxi or train by distance", () => {
  assert.deepEqual(travel([35, 135.77], [35, 135.77]), { mode: "walk", min: 2, text: "2 min walk" });
  // 0.009 degrees of latitude is about 1 km.
  assert.deepEqual(travel([35, 135.77], [35.009, 135.77]), { mode: "walk", min: 17, text: "17 min walk" });
  assert.deepEqual(travel([35, 135.77], [35.05, 135.77]), { mode: "taxi", min: 25, text: "25 min taxi" });
  assert.deepEqual(travel([35, 135.77], [35.2, 135.77]), { mode: "train", min: 60, text: "60 min by train" });
});

test("an empty day has no stops, legs or clashes", () => {
  assert.deepEqual(schedule(day(), []), EMPTY);
});

test("the first stop starts at the day start, or 09:00 if unset", () => {
  assert.equal(schedule(day({ start_time: "10:30" }), [stop(1)]).stops[0].start, "10:30");
  assert.equal(schedule(day({ start_time: null }), [stop(1)]).stops[0].start, DEFAULT_START);
  assert.equal(DEFAULT_START, "09:00");
});

test("later stops follow on after travel, rounded up to 5 minutes", () => {
  const sc = schedule(day(), [stop(1), stop(2)]);
  const [a, b] = sc.stops;
  assert.equal(a.start, "09:00");
  assert.equal(a.end, "10:00");
  assert.equal(a.leg, null);
  assert.equal(b.start, "10:15");
  assert.equal(b.end, "11:15");
  assert.deepEqual(b.leg, { mode: "any", min: 15, text: "About 15 min travel" });
  assert.equal(b.free_min, 0);
  assert.equal(b.late_min, 0);
});

test("after_time pushes a stop later and leaves free time", () => {
  const b = schedule(day(), [stop(1), stop(2, { after_time: "11:30" })]).stops[1];
  assert.equal(b.start, "11:30");
  assert.equal(b.free_min, 75);
});

test("fixed_time holds and reports how late you would be", () => {
  const sc = schedule(day(), [stop(1, { duration_min: 120 }), stop(2, { fixed_time: "10:30", duration_min: 30 })]);
  const b = sc.stops[1];
  assert.equal(b.start, "10:30");
  assert.equal(b.end, "11:00");
  assert.equal(b.late_min, 45);
  assert.equal(b.free_min, 0);
  assert.deepEqual(sc.clashes, [{ id: 2, title: "Stop 2", late_min: 45 }]);
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

test("start and end places add leave and back legs", () => {
  const d = day({ start_lat: HOTEL.lat, start_lng: HOTEL.lng, end_lat: HOTEL.lat, end_lng: HOTEL.lng });
  const sc = schedule(d, [stop(1, HOTEL)]);
  assert.deepEqual(sc.start_leg, { mode: "walk", min: 2, text: "2 min walk" });
  assert.equal(sc.leave_at, "08:55");
  assert.deepEqual(sc.back_leg, { mode: "walk", min: 2, text: "2 min walk" });
  assert.equal(sc.back_at, "10:05");
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
