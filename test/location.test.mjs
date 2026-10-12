// Unit tests for reading coordinates from text or a Google Maps link.
// Run: node --test test/location.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocation, formatLocation } from "../public/js/location.js";

test("empty input clears the location", () => {
  assert.equal(parseLocation(""), null);
  assert.equal(parseLocation("   "), null);
  assert.equal(parseLocation(undefined), null);
});

test("reads plain coordinates", () => {
  assert.deepEqual(parseLocation("35.0089, 135.77"), { lat: 35.0089, lng: 135.77 });
  assert.deepEqual(parseLocation("-33.8568,151.2153"), { lat: -33.8568, lng: 151.2153 });
});

test("reads a Google Maps place link, preferring the pin over the map centre", () => {
  const url = "https://www.google.com/maps/place/Kiyomizu-dera/@34.9948,135.7850,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d34.9949!4d135.7851";
  assert.deepEqual(parseLocation(url), { lat: 34.9949, lng: 135.7851 });
});

test("reads a Google Maps map view link", () => {
  assert.deepEqual(parseLocation("https://www.google.com/maps/@35.0170,135.6713,15z"), { lat: 35.017, lng: 135.6713 });
});

test("reads a Google Maps search link", () => {
  assert.deepEqual(parseLocation("https://www.google.com/maps/search/?api=1&query=35.0050,135.7649"), { lat: 35.005, lng: 135.7649 });
  assert.deepEqual(parseLocation("https://maps.google.com/?q=35.0050%2C135.7649"), { lat: 35.005, lng: 135.7649 });
});

test("explains that short links can't be read", () => {
  assert.throws(() => parseLocation("https://maps.app.goo.gl/abc123"), /Short Maps links/);
});

test("rejects out-of-range coordinates", () => {
  assert.throws(() => parseLocation("95, 135"), /out of range/);
  assert.throws(() => parseLocation("35, 190"), /out of range/);
});

test("rejects anything else with a hint", () => {
  assert.throws(() => parseLocation("Kyoto Station"), /35\.0089, 135\.7700/);
});

test("formatLocation", () => {
  assert.equal(formatLocation(35.0089, 135.77), "35.0089, 135.77");
  assert.equal(formatLocation(null, null), "");
});
