// Unit tests for choosing which pins the map shows.
// Run: node --test test/map-points.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPoints } from "../public/js/map-points.js";

const day = (date, stops, extra = {}) => ({ date, ...extra, schedule: { stops } });
const stop = (title, lat, lng, status = "planned") => ({ title, lat, lng, status });

const days = [
  day("2026-11-01", [stop("Shrine", 35.1, 135.7), stop("Lunch", 35.2, 135.8, "booked"), stop("Somewhere", null, null)], {
    start_place: "Hotel", start_lat: 35.0, start_lng: 135.6
  }),
  day("2026-11-02", [stop("Temple", 34.9, 135.5, "suggested")], {
    end_place: "Hotel", end_lat: 35.0, end_lng: 135.6
  }),
  day("2026-11-03", [])
];

test("one day shows its start point and every stop with coordinates", () => {
  assert.deepEqual(mapPoints(days, "2026-11-01"), [
    { lat: 35.0, lng: 135.6, labels: ["Start: Hotel"] },
    { lat: 35.1, lng: 135.7, labels: ["Shrine"] },
    { lat: 35.2, lng: 135.8, labels: ["Lunch"] }
  ]);
});

test("one day shows its end point and suggested stops", () => {
  assert.deepEqual(mapPoints(days, "2026-11-02"), [
    { lat: 34.9, lng: 135.5, labels: ["Temple"] },
    { lat: 35.0, lng: 135.6, labels: ["End: Hotel"] }
  ]);
});

test("the entire trip merges pins at the same spot", () => {
  assert.deepEqual(mapPoints(days, "all"), [
    { lat: 35.0, lng: 135.6, labels: ["Start: Hotel", "End: Hotel"] },
    { lat: 35.1, lng: 135.7, labels: ["Shrine"] },
    { lat: 35.2, lng: 135.8, labels: ["Lunch"] },
    { lat: 34.9, lng: 135.5, labels: ["Temple"] }
  ]);
});

test("the same label at the same spot is listed once", () => {
  const twice = [
    day("2026-11-01", [], { start_place: "Hotel", start_lat: 1, start_lng: 2 }),
    day("2026-11-02", [], { start_place: "Hotel", start_lat: 1, start_lng: 2 })
  ];
  assert.deepEqual(mapPoints(twice, "all"), [{ lat: 1, lng: 2, labels: ["Start: Hotel"] }]);
});

test("unnamed start and end points get a plain label", () => {
  const d = [day("2026-11-01", [], { start_lat: 1, start_lng: 2, end_lat: 3, end_lng: 4 })];
  assert.deepEqual(mapPoints(d, "2026-11-01"), [
    { lat: 1, lng: 2, labels: ["Start of the day"] },
    { lat: 3, lng: 4, labels: ["End of the day"] }
  ]);
});

test("a day with no locations, or an unknown date, has no pins", () => {
  assert.deepEqual(mapPoints(days, "2026-11-03"), []);
  assert.deepEqual(mapPoints(days, "2030-01-01"), []);
});
