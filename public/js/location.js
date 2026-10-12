// Reads coordinates from "lat, lng" text or a Google Maps URL. No DOM, so
// it can be unit tested (see test/location.test.mjs).

const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";
const PATTERNS = [
  new RegExp("^" + NUM + "\\s*,\\s*" + NUM + "$"),                              // 35.0089, 135.77
  new RegExp("!3d" + NUM + "!4d" + NUM),                                       // place link pin
  new RegExp("@" + NUM + "," + NUM),                                           // map view centre
  new RegExp("[?&](?:q|query|ll|destination)=" + NUM + "(?:,|%2C)(?:\\+|%20)*" + NUM, "i"),
];

// Returns null for empty input and { lat, lng } on success. Throws an Error
// with a message for the user otherwise.
export function parseLocation(text) {
  const s = (text || "").trim();
  if (!s) return null;
  for (const re of PATTERNS) {
    const m = re.exec(s);
    if (!m) continue;
    const lat = Number(m[1]), lng = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new Error("Those coordinates are out of range. Latitude is -90 to 90 and longitude is -180 to 180.");
    }
    return { lat, lng };
  }
  if (/goo\.gl|maps\.app/i.test(s)) {
    throw new Error("Short Maps links can't be read. Open the link, then copy the full URL from the address bar.");
  }
  throw new Error('Enter coordinates like "35.0089, 135.7700" or paste a Google Maps link.');
}

export function formatLocation(lat, lng) {
  return lat == null || lng == null ? "" : lat + ", " + lng;
}
