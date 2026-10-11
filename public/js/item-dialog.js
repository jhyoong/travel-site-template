// The add/edit event dialog (#item-dialog in index.html).
import { api, showError } from "./api.js";

const FIELDS = ["title", "start_time", "end_time", "location", "notes", "link", "date"];
const OPTIONAL = ["start_time", "end_time", "location", "notes", "link"];

// opts: { onSaved(itemId), onDeleted(), onAuthFailed() }
// Returns { openAdd(date), openEdit(item) }.
export function initItemDialog(opts) {
  const dialog = document.getElementById("item-dialog");
  const form = document.getElementById("item-form");
  const heading = document.getElementById("item-dialog-title");
  const error = form.querySelector(".error");
  const ok = form.querySelector(".ok");
  const anotherBtn = form.querySelector('button[value="another"]');
  const deleteBtn = form.querySelector('[data-action="delete"]');
  const inputs = {};
  FIELDS.forEach((f) => { inputs[f] = form.elements[f]; });

  let editing = null; // the item being edited, or null when adding
  let busy = false;

  function setBusy(value) {
    busy = value;
    form.querySelectorAll("button").forEach((b) => { b.disabled = value; });
  }

  function open(item, date) {
    editing = item;
    form.reset();
    FIELDS.forEach((f) => { inputs[f].value = item && item[f] != null ? item[f] : ""; });
    if (!item) inputs.date.value = date;
    heading.textContent = item ? "Edit event" : "Add event";
    anotherBtn.hidden = !!item;
    deleteBtn.hidden = !item;
    deleteBtn.textContent = "Delete";
    deleteBtn.dataset.confirm = "";
    showError(error, "");
    ok.hidden = true;
    setBusy(false);
    if (!dialog.open) dialog.showModal();
    inputs.title.focus();
  }

  function body() {
    const b = { date: inputs.date.value, title: inputs.title.value.trim() };
    OPTIONAL.forEach((k) => {
      const v = inputs[k].value.trim();
      // On edit, "" clears the field. On create, leave empty fields out.
      if (editing || v !== "") b[k] = v;
    });
    return b;
  }

  // Runs one API action with buttons disabled and errors shown in the dialog.
  async function run(action) {
    showError(error, "");
    ok.hidden = true;
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
    const another = ev.submitter && ev.submitter.value === "another";
    run(async () => {
      const saved = editing
        ? await api("PUT", "/api/items/" + encodeURIComponent(editing.id), body())
        : await api("POST", "/api/items", body());
      if (another) {
        open(null, inputs.date.value);
        ok.textContent = "Saved “" + saved.title + "”. Add the next one.";
        ok.hidden = false;
      } else {
        dialog.close();
      }
      opts.onSaved(saved.id);
    });
  });

  deleteBtn.addEventListener("click", () => {
    if (deleteBtn.dataset.confirm !== "yes") {
      deleteBtn.dataset.confirm = "yes";
      deleteBtn.textContent = "Confirm delete";
      return;
    }
    run(async () => {
      await api("DELETE", "/api/items/" + encodeURIComponent(editing.id));
      dialog.close();
      opts.onDeleted();
    });
  });

  // Don't let Esc close the dialog while a save or delete is running.
  dialog.addEventListener("cancel", (ev) => { if (busy) ev.preventDefault(); });

  form.querySelector('[data-action="cancel"]').addEventListener("click", () => dialog.close());

  return {
    openAdd: (date) => open(null, date),
    openEdit: (item) => open(item)
  };
}
