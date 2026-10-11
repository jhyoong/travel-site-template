// The recent changes panel (#history-dialog in index.html).
// Loads the audit log each time it is opened.
import { api, el, clear, showError } from "./api.js";
import { formatTimestamp } from "./dates.js";

const ACTIONS = { create: "added", update: "edited", "delete": "deleted", update_trip: "updated the trip" };

function describe(entry) {
  const snap = entry.after || entry.before || {};
  let subject = "";
  if (entry.action === "update_trip") subject = snap.name ? " “" + snap.name + "”" : "";
  else if (snap.title) subject = " “" + snap.title + "”";
  return (ACTIONS[entry.action] || entry.action) + subject;
}

// opts: { onAuthFailed() }. Returns { open() }.
export function initHistory(opts) {
  const dialog = document.getElementById("history-dialog");
  const list = dialog.querySelector(".audit");
  const status = dialog.querySelector(".status");
  const error = dialog.querySelector(".error");

  dialog.querySelector('[data-action="close"]').addEventListener("click", () => dialog.close());

  function render(entries) {
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
