// Picks the pins the map shows. No DOM, so it runs in tests too.

// days: the itinerary's days, each with start/end coordinates and
// schedule.stops. which: a date, or "all" for the entire trip.
// Returns [{ lat, lng, labels }] in trip order. Points at the same spot
// share one pin, and a label is listed once per pin.
export function mapPoints(days, which) {
  const pins = new Map(); // "lat,lng" -> pin
  const add = (lat, lng, label) => {
    if (lat == null || lng == null) return;
    const k = lat + "," + lng;
    if (!pins.has(k)) pins.set(k, { lat, lng, labels: [] });
    const labels = pins.get(k).labels;
    if (!labels.includes(label)) labels.push(label);
  };
  days.filter((d) => which === "all" || d.date === which).forEach((d) => {
    add(d.start_lat, d.start_lng, d.start_place ? "Start: " + d.start_place : "Start of the day");
    d.schedule.stops.forEach((s) => add(s.lat, s.lng, s.title));
    add(d.end_lat, d.end_lng, d.end_place ? "End: " + d.end_place : "End of the day");
  });
  return [...pins.values()];
}
