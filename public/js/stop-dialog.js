// The add/edit stop dialog (#stop-dialog in index.html).
import { api, showError } from "./api.js";
import { parseLocation, formatLocation } from "./location.js";

// Text fields sent as typed; "" clears the field.
const TEXT = ["title", "area", "fixed_time", "after_time", "stub", "booking_ref", "notes", "link"];

// opts: { days() -> the itinerary days, onSaved(stop), onDeleted(), onAuthFailed() }
// Returns { openAdd(date), openEdit(stop) }. openAdd(null) adds an idea.
export function initStopDialog(opts) {
  const dialog = document.getElementById("stop-dialog");
  const form = document.getElementById("stop-form");
  const heading = document.getElementById("stop-dialog-title");
  const error = form.querySelector(".error");
  const deleteBtn = form.querySelector('[data-action="delete"]');
  const statusField = form.querySelector("[data-status-field]");
  const f = form.elements;

  let editing = null; // the stop being edited, or null when adding
  let busy = false;

  function setBusy(value) {
    busy = value;
    form.querySelectorAll("button").forEach((b) => { b.disabled = value; });
  }

  // Ideas have no status choice: they are always "idea".
  function syncStatus() { statusField.hidden = f.date.value === ""; }

  function fillDays(selected) {
    f.date.replaceChildren(
      new Option("Ideas (no day yet)", ""),
      ...opts.days().map((d) => new Option(`Day ${d.n}, ${d.short}`, d.date))
    );
    f.date.value = selected || "";
  }

  function open(stop, date) {
    editing = stop;
    form.reset();
    fillDays(stop ? stop.date : date);
    TEXT.forEach((k) => { f[k].value = stop && stop[k] != null ? stop[k] : ""; });
    f.kind.value = stop ? stop.kind : "sight";
    f.duration_min.value = stop ? stop.duration_min : 60;
    f.status.value = stop && stop.status !== "idea" ? stop.status : "planned";
    f.location.value = stop ? formatLocation(stop.lat, stop.lng) : "";
    syncStatus();
    heading.textContent = stop ? "Edit stop" : "Add stop";
    deleteBtn.hidden = !stop;
    deleteBtn.textContent = "Delete";
    deleteBtn.dataset.confirm = "";
    showError(error, "");
    setBusy(false);
    if (!dialog.open) dialog.showModal();
    f.title.focus();
  }

  // Throws with a message if the location can't be read.
  function body() {
    const loc = parseLocation(f.location.value);
    const date = f.date.value || null;
    const b = {
      date,
      status: date ? f.status.value : "idea",
      kind: f.kind.value,
      duration_min: Number(f.duration_min.value),
      lat: loc ? loc.lat : null,
      lng: loc ? loc.lng : null
    };
    TEXT.forEach((k) => { b[k] = f[k].value.trim(); });
    return b;
  }

  // Runs one API action with buttons disabled and errors shown in the dialog.
  async function run(action) {
    showError(error, "");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      if (e.status === 401) { dialog.close(); opts.onAuthFailed(); }
      else {
        showError(error, e.message);
        deleteBtn.textContent = "Delete";
        deleteBtn.dataset.confirm = "";
      }
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (busy) return;
    let b;
    try { b = body(); } catch (e) { showError(error, e.message); f.location.focus(); return; }
    run(async () => {
      const saved = editing
        ? await api("PUT", "/api/stops/" + encodeURIComponent(editing.id), b)
        : await api("POST", "/api/stops", b);
      dialog.close();
      opts.onSaved(saved);
    });
  });

  deleteBtn.addEventListener("click", () => {
    if (deleteBtn.dataset.confirm !== "yes") {
      deleteBtn.dataset.confirm = "yes";
      deleteBtn.textContent = "Confirm delete";
      return;
    }
    run(async () => {
      await api("DELETE", "/api/stops/" + encodeURIComponent(editing.id));
      dialog.close();
      opts.onDeleted();
    });
  });

  f.date.addEventListener("change", syncStatus);
  // Don't let Esc close the dialog while a save or delete is running.
  dialog.addEventListener("cancel", (ev) => { if (busy) ev.preventDefault(); });
  form.querySelector('[data-action="cancel"]').addEventListener("click", () => dialog.close());

  return {
    openAdd: (date) => open(null, date),
    openEdit: (stop) => open(stop)
  };
}
