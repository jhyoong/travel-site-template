// The recent changes panel (#history-dialog in index.html).
// Loads the newest changes each time it is opened; "Load more" adds older ones.
import { api, el, clear, showError } from "./api.js";
import { formatDay, formatTimestamp } from "./dates.js";

const PAGE = 50;
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
  const more = dialog.querySelector(".audit-more");
  const moreButton = more.querySelector("button");
  let oldestId = null; // smallest id shown, for the next page
  let seq = 0;         // ignores results after the panel was reopened

  dialog.querySelector('[data-action="close"]').addEventListener("click", () => dialog.close());
  moreButton.addEventListener("click", () => loadPage());

  function render(entries) {
    if (oldestId === null && entries.length === 0) {
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

  async function loadPage() {
    const mine = seq;
    showError(error, "");
    moreButton.disabled = true;
    try {
      const data = await api("GET", "/api/audit?limit=" + PAGE + (oldestId === null ? "" : "&before_id=" + oldestId));
      if (mine !== seq) return;
      const entries = (data && data.entries) || [];
      render(entries);
      if (entries.length) oldestId = entries[entries.length - 1].id;
      more.hidden = entries.length < PAGE;
    } catch (e) {
      if (mine !== seq) return;
      if (e.status === 401) { dialog.close(); opts.onAuthFailed(); }
      else showError(error, e.message);
    } finally {
      if (mine === seq) {
        status.hidden = true;
        moreButton.disabled = false;
      }
    }
  }

  function open() {
    seq++;
    oldestId = null;
    clear(list);
    more.hidden = true;
    status.textContent = "Loading...";
    status.hidden = false;
    dialog.showModal();
    return loadPage();
  }

  return { open };
}
