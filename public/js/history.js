// The recent changes panel (#history-dialog in index.html).
// Loads the audit log each time it is opened.
import { api, el, clear, showError } from "./api.js";
import { formatDay, formatTimestamp } from "./dates.js";

const ACTIONS = { create: "added", update: "edited", "delete": "deleted", move: "moved" };

function describe(entry) {
  const snap = entry.after || entry.before || {};
  if (entry.action === "update_trip") return "updated the trip" + (snap.name ? " “" + snap.name + "”" : "");
  if (entry.action === "update_day") return "updated " + formatDay(snap.date);
  let text = (ACTIONS[entry.action] || entry.action) + (snap.title ? " “" + snap.title + "”" : "");
  if (entry.action === "move") text += " to " + (snap.date ? formatDay(snap.date) : "Ideas");
  return text;
}

// opts: { onAuthFailed() }. Returns { open() }.
export function initHistory(opts) {
  const dialog = document.getElementById("history-dialog");
  const list = dialog.querySelector(".audit");
  const status = dialog.querySelector(".status");
  const error = dialog.querySelector(".error");

  dialog.querySelector('[data-action="close"]').addEventListener("click", () => dialog.close());

  function render(entries) {
    clear(list);
    if (!entries || entries.length === 0) {
      list.appendChild(el("li", { class: "empty", text: "No changes yet." }));
      return;
    }
    entries.forEach((en) => {
      list.appendChild(el("li", {}, [
        el("span", { class: "audit-time muted", text: formatTimestamp(en.ts) }),
        el("strong", { text: en.actor || "unknown" }),
        " " + describe(en)
      ]));
    });
  }

  async function open() {
    clear(list);
    showError(error, "");
    status.textContent = "Loading...";
    status.hidden = false;
    dialog.showModal();
    try {
      const data = await api("GET", "/api/audit?limit=50");
      render(data && data.entries);
    } catch (e) {
      if (e.status === 401) { dialog.close(); opts.onAuthFailed(); }
      else showError(error, e.message);
    } finally {
      status.hidden = true;
    }
  }

  return { open };
}
