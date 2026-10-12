// The edit day dialog (#day-dialog in index.html): title, start time,
// and the places the day starts and ends at.
import { api, showError } from "./api.js";
import { parseLocation, formatLocation } from "./location.js";

// Reads a location input. Throws with a message naming the field.
function readLocation(input, label) {
  try { return parseLocation(input.value); } catch (e) { throw new Error(label + ": " + e.message); }
}

// opts: { onSaved(), onAuthFailed() }. Returns { open(day) }.
export function initDayDialog(opts) {
  const dialog = document.getElementById("day-dialog");
  const form = document.getElementById("day-form");
  const heading = document.getElementById("day-dialog-title");
  const error = form.querySelector(".error");
  const f = form.elements;
  let day = null;
  let busy = false;

  function setBusy(value) {
    busy = value;
    form.querySelectorAll("button").forEach((b) => { b.disabled = value; });
  }

  function open(d) {
    day = d;
    form.reset();
    heading.textContent = `Edit day ${d.n}, ${d.short}`;
    f.title.value = d.title || "";
    f.start_time.value = d.start_time;
    f.start_place.value = d.start_place || "";
    f.start_location.value = formatLocation(d.start_lat, d.start_lng);
    f.end_place.value = d.end_place || "";
    f.end_location.value = formatLocation(d.end_lat, d.end_lng);
    showError(error, "");
    setBusy(false);
    dialog.showModal();
    f.title.focus();
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (busy) return;
    showError(error, "");
    let start, end;
    try { start = readLocation(f.start_location, "Start location"); } catch (e) { showError(error, e.message); f.start_location.focus(); return; }
    try { end = readLocation(f.end_location, "End location"); } catch (e) { showError(error, e.message); f.end_location.focus(); return; }
    setBusy(true);
    try {
      await api("PUT", "/api/days/" + encodeURIComponent(day.date), {
        title: f.title.value.trim(),
        start_time: f.start_time.value,
        start_place: f.start_place.value.trim(),
        start_lat: start ? start.lat : null,
        start_lng: start ? start.lng : null,
        end_place: f.end_place.value.trim(),
        end_lat: end ? end.lat : null,
        end_lng: end ? end.lng : null
      });
      dialog.close();
      opts.onSaved();
    } catch (e) {
      if (e.status === 401) { dialog.close(); opts.onAuthFailed(); }
      else showError(error, e.message);
    } finally {
      setBusy(false);
    }
  });

  // Don't let Esc close the dialog while a save is running.
  dialog.addEventListener("cancel", (ev) => { if (busy) ev.preventDefault(); });
  form.querySelector('[data-action="cancel"]').addEventListener("click", () => dialog.close());

  return { open };
}
