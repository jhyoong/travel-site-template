// Backup download and restore. The "Backup and restore" section is shown in
// Trip settings and on the setup screen; the warning before a restore is
// #restore-dialog in index.html.
import { api, el, clear, showError } from "./api.js";
import { formatTimestamp } from "./dates.js";
import { plural } from "./ui.js";

const FORMAT = "itinerary-backup";
const VERSION = 1;

// Saves GET /api/backup as a file. The API needs the key header, so the
// file is fetched first and then saved from memory.
export async function downloadBackup() {
  const data = await api("GET", "/api/backup");
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  const a = el("a", { download: "itinerary-backup-" + data.exported_at.slice(0, 10) + ".json" });
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Reads a picked file. Returns the backup, or throws an Error with a message
// for the user. The server checks everything again before restoring.
async function readBackupFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    throw new Error("This file is not a backup (it is not valid JSON).");
  }
  if (!data || data.format !== FORMAT) throw new Error("This file is not an itinerary backup.");
  if (data.version !== VERSION) throw new Error("This backup is from a different version of the site and cannot be restored here.");
  return data;
}

// Shows the warning and restores when confirmed.
// opts: { showDownload, onRestored(), onAuthFailed() }
function confirmRestore(backup, opts) {
  const dialog = document.getElementById("restore-dialog");
  const error = dialog.querySelector(".error");
  const buttons = dialog.querySelectorAll("button");
  const download = dialog.querySelector('[data-action="download"]');
  const stops = Array.isArray(backup.stops) ? backup.stops.length : 0;
  const changes = Array.isArray(backup.audit_log) ? backup.audit_log.length : 0;
  const name = backup.trip && backup.trip.name ? " of “" + backup.trip.name + "”" : "";
  dialog.querySelector(".restore-summary").textContent =
    "This will replace the trip, all days, all stops and all change history with the backup" + name +
    " from " + formatTimestamp(backup.exported_at) + " (" + plural(stops, "stop") + ", " + plural(changes, "change") + ")." +
    " This cannot be undone.";
  download.hidden = !opts.showDownload;
  showError(error, "");
  buttons.forEach((b) => { b.disabled = false; });

  const busy = (on) => buttons.forEach((b) => { b.disabled = on; });
  dialog.onclick = async (ev) => {
    const action = ev.target.closest("button") && ev.target.closest("button").dataset.action;
    if (!action) return;
    if (action === "cancel") { dialog.close(); return; }
    showError(error, "");
    busy(true);
    try {
      if (action === "download") await downloadBackup();
      else {
        await api("POST", "/api/restore", backup);
        dialog.close();
        opts.onRestored();
        return;
      }
    } catch (e) {
      if (e.status === 401) { dialog.close(); opts.onAuthFailed(); return; }
      showError(error, e.message);
    }
    busy(false);
  };
  // Don't let Esc close the dialog while a request is in progress.
  dialog.oncancel = (ev) => { if (buttons[0].disabled) ev.preventDefault(); };
  dialog.showModal();
}

// Builds the "Backup and restore" section inside container.
// opts: { showDownload, onRestored(), onAuthFailed() }
export function renderBackupSection(container, opts) {
  clear(container);
  const error = el("p", { class: "error", role: "alert", hidden: true });
  const fileIn = el("input", { type: "file", accept: ".json,application/json", hidden: true });
  const download = el("button", { type: "button", class: "btn", text: "Download backup" });
  const restore = el("button", { type: "button", class: "btn", text: "Restore from backup" });

  download.addEventListener("click", async () => {
    showError(error, "");
    download.disabled = true;
    try {
      await downloadBackup();
    } catch (e) {
      if (e.status === 401) opts.onAuthFailed();
      else showError(error, e.message);
    } finally {
      download.disabled = false;
    }
  });
  restore.addEventListener("click", () => fileIn.click());
  fileIn.addEventListener("change", async () => {
    const file = fileIn.files[0];
    fileIn.value = "";
    if (!file) return;
    showError(error, "");
    try {
      confirmRestore(await readBackupFile(file), opts);
    } catch (e) {
      showError(error, e.message);
    }
  });

  container.appendChild(el("section", { class: "backup" }, [
    el("h3", { text: opts.showDownload ? "Backup and restore" : "Restore from a backup" }),
    el("p", {
      text: opts.showDownload
        ? "Download the trip, all days, all stops and the full change history to a file. Restoring a file replaces everything."
        : "Moving from another setup? Restore a backup file instead of creating a new trip."
    }),
    error,
    el("div", { class: "actions" }, [opts.showDownload ? download : null, restore, fileIn])
  ]));
}
