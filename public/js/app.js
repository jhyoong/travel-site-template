// Page startup and state. Loads the itinerary, picks the screen to show
// (sign in, setup or the trip) and connects the views and dialogs.
import { api, getKey, setKey, clearKey, showError } from "./api.js";
import { formatDateRange, formatDay, formatLongDay } from "./dates.js";
import { schedule } from "./schedule.js";
import { ico, plural, clashText, dayColor, toast } from "./ui.js";
import { initTimeline } from "./timeline.js";
import { initBoard } from "./board.js";
import { renderTripForm } from "./setup.js";
import { initStopDialog } from "./stop-dialog.js";
import { initDayDialog } from "./day-dialog.js";
import { initHistory } from "./history.js";

const $ = (id) => document.getElementById(id);
const STATES = ["status", "signin-section", "setup-section", "trip-section"];

let user = "";             // signed-in key name; "" when signed out or read-only
let model = null;          // last GET /api/itinerary result, plus local changes
let loadSeq = 0;           // ignores results from loads that are no longer current
let canViewPublic = false; // true once the itinerary loaded without a key (VIEW_PUBLIC on)
let landed = null;         // stop id to flash on the board's next render
let started = false;       // the #board hash is applied on the first render only
const openSet = new Set(); // expanded timeline cards
const scrollMem = { timeline: 0, board: 0 };

/* ---------- model helpers ---------- */
const dayByDate = (date) => model.days.find((d) => d.date === date);
const colStops = (col) => (col === "ideas" ? model.ideas : dayByDate(col).schedule.stops);
const stopById = (id) => [...model.ideas, ...model.days.flatMap((d) => d.schedule.stops)].find((s) => s.id === id);

function colOf(id) {
  if (model.ideas.some((s) => s.id === id)) return "ideas";
  const d = model.days.find((day) => day.schedule.stops.some((s) => s.id === id));
  return d ? d.date : null;
}

function colLabel(col) {
  if (col === "ideas") return "Ideas";
  const d = dayByDate(col);
  return `Day ${d.n}, ${d.short}`;
}

// Adds display fields to each day.
function decorate(itinerary) {
  itinerary.days.forEach((d) => {
    d.color = dayColor(d.n);
    d.short = formatDay(d.date);
    d.long = formatLongDay(d.date);
  });
  return itinerary;
}

// Works out times again after a local change, the same way the server does.
function recompute() {
  model.days.forEach((d) => { d.schedule = schedule(d, d.schedule.stops); });
}

// Moves a stop locally. idx is its final position in the target column.
function moveLocal(id, to, idx) {
  const src = colStops(colOf(id));
  const s = src.splice(src.findIndex((x) => x.id === id), 1)[0];
  const dst = colStops(to);
  dst.splice(Math.min(idx, dst.length), 0, s);
  s.date = to === "ideas" ? null : to;
  if (to === "ideas") s.status = "idea";
  else if (s.status === "idea") s.status = "planned";
  recompute();
}

/* ---------- writes ---------- */
// Sends one API write, then reloads so the page matches the server.
// Returns the response, or null if it failed (a toast shows why).
async function send(method, path, body) {
  let result = null;
  try {
    result = await api(method, path, body);
  } catch (e) {
    if (e.status === 401) { authFailed(); return null; }
    toast(e.message);
  }
  load();
  return result;
}

// True when col is Ideas or a day that still exists.
const hasCol = (col) => col === "ideas" || !!dayByDate(col);

function moveStop(id, to, idx) {
  if (!model) return;
  const stop = stopById(id);
  if (!stop || !hasCol(to)) { renderAll(); return; }
  const from = colOf(id), title = stop.title, prevStatus = stop.status;
  const fromIdx = colStops(from).findIndex((s) => s.id === id);
  moveLocal(id, to, idx);
  const toIdx = colStops(to).findIndex((s) => s.id === id);
  // Nothing moved: re-render so the board drops any drag leftovers.
  if (from === to && toIdx === fromIdx) { renderAll(); return; }
  landed = id;
  renderAll();
  let msg = from === to ? `${title} is now number ${toIdx + 1} on ${colLabel(to)}.` : `Moved ${title} to ${colLabel(to)}.`;
  if (to !== "ideas") {
    const sc = dayByDate(to).schedule;
    if (sc.clashes.length) msg += " " + clashText(sc, true);
  }
  send("POST", `/api/stops/${id}/move`, { date: to === "ideas" ? null : to, index: toIdx });
  toast(msg, () => undoMove(id, from, fromIdx, prevStatus));
}

// Moves a stop back and restores its status (a move to or from Ideas
// changes the status).
async function undoMove(id, col, idx, prevStatus) {
  if (!model) return;
  if (!stopById(id) || !hasCol(col)) { renderAll(); return; }
  moveLocal(id, col, idx);
  const s = stopById(id), fixStatus = s.status !== prevStatus;
  s.status = prevStatus;
  landed = id;
  renderAll();
  const moved = await send("POST", `/api/stops/${id}/move`, { date: col === "ideas" ? null : col, index: idx });
  if (moved && fixStatus) send("PUT", `/api/stops/${id}`, { status: prevStatus });
}

function setStatusLocal(id, status) {
  const s = stopById(id);
  if (s) { s.status = status; renderAll(); }
}

function keepSuggestion(id) {
  const title = stopById(id).title;
  setStatusLocal(id, "planned");
  timeline.flashStop(id);
  send("PUT", `/api/stops/${id}`, { status: "planned" });
  toast(`Added ${title} to the plan.`, () => {
    if (!model) return;
    setStatusLocal(id, "suggested");
    send("PUT", `/api/stops/${id}`, { status: "suggested" });
  });
}

async function addIdea(title) {
  const created = await send("POST", "/api/stops", { title });
  if (!created) return;
  landed = created.id;
  toast(`Added ${title} to ideas.`, () => send("DELETE", `/api/stops/${created.id}`));
}

/* ---------- views ---------- */
const stopDialog = initStopDialog({
  days: () => model.days,
  onSaved: (stop) => { landed = stop.id; load(); },
  onDeleted: () => load(),
  onAuthFailed: authFailed
});
const dayDialog = initDayDialog({ onSaved: () => load(), onAuthFailed: authFailed });
const historyPanel = initHistory({ onAuthFailed: authFailed });

const ctx = {
  model: () => model,
  canEdit: () => !!user,
  view: () => $("app").dataset.view,
  openSet,
  colOf,
  colStops,
  colLabel,
  stopById,
  takeLanded: () => { const id = landed; landed = null; return id; },
  onMove: moveStop,
  onKeep: keepSuggestion,
  onToIdeas: (id) => moveStop(id, "ideas", model.ideas.length),
  onAddIdea: addIdea,
  onEditStop: (id) => stopDialog.openEdit(stopById(id)),
  onAddStop: (date) => stopDialog.openAdd(date),
  onEditDay: (date) => dayDialog.open(dayByDate(date)),
  onGoBoard: goBoard,
  onShowInTimeline: showInTimeline
};
const timeline = initTimeline(ctx);
const board = initBoard(ctx);

function renderAll() {
  timeline.render();
  board.render();
}

function setView(v) {
  const app = $("app"), cur = app.dataset.view;
  if (cur === v) return;
  scrollMem[cur] = window.scrollY;
  app.dataset.view = v;
  $("tl-view").hidden = v !== "timeline";
  $("bd-view").hidden = v !== "board";
  $("vswitch").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === v));
  board.closeMenu(false);
  try { history.replaceState(null, "", "#" + v); } catch (e) { /* ignore */ }
  window.scrollTo(0, scrollMem[v] || 0);
  if (v === "timeline") timeline.spy(); else board.renderJump();
}

function goBoard(col) {
  setView("board");
  window.scrollTo(0, 0);
  board.flashCol(col);
}

function showInTimeline(id) {
  setView("timeline");
  openSet.add(id);
  timeline.render();
  timeline.revealStop(id);
}

$("vswitch").querySelector('[data-v="timeline"]').innerHTML = ico("list", 18) + "Timeline";
$("vswitch").querySelector('[data-v="board"]').innerHTML = ico("board", 18) + "Board";
$("vswitch").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) setView(b.dataset.v); });

/* ---------- screens ---------- */
function show(id) {
  STATES.forEach((s) => { $(s).hidden = s !== id; });
}

function setStatus(text) {
  $("status").textContent = text;
  show("status");
}

function isSetUp(trip) {
  return !!(trip && trip.name && trip.start_date && trip.end_date);
}

function renderTopbar() {
  $("signed-in").textContent = user ? "Signed in as " + user : "";
  $("signed-in").hidden = !user;
  $("trip-button").hidden = !user || !model;
  $("history-button").hidden = !user;
  $("logout-button").hidden = !user;
  // Only shown to read-only visitors when VIEW_PUBLIC is on.
  $("signin-button").hidden = !!user || !model;
}

function renderHeader() {
  const t = model.trip || {};
  $("trip-name").textContent = t.name || "Untitled trip";
  document.title = t.name || "Itinerary";
  const meta = [
    formatDateRange(t.start_date, t.end_date),
    t.travellers ? plural(t.travellers, "traveller") : "",
    t.timezone ? "times in " + t.timezone : ""
  ];
  $("trip-meta").textContent = meta.filter(Boolean).join(", ");
  document.querySelectorAll(".edit-only").forEach((n) => { n.hidden = !user; });
}

function showTrip() {
  renderHeader();
  renderAll();
  show("trip-section");
  if (!started) {
    started = true;
    if (location.hash === "#board") setView("board");
  }
  timeline.spy();
}

function showSignIn(message) {
  loadSeq++;
  user = "";
  model = null;
  renderTopbar();
  showError($("page-error"), "");
  showError($("signin-error"), message || "");
  // Hide any toast so its Undo can't run after sign-out.
  $("toast").classList.remove("show");
  const undoButton = $("toast").querySelector("button");
  if (undoButton) undoButton.disabled = true;
  $("signin-back").hidden = !canViewPublic;
  show("signin-section");
  $("signin-key").focus();
}

function authFailed() {
  clearKey();
  showSignIn("Your key was not accepted. Please sign in again.");
}

function showSetup() {
  show("setup-section");
  renderTripForm($("setup-form"), {
    trip: model.trip,
    submitLabel: "Create trip",
    onSaved: () => load(),
    onAuthFailed: authFailed
  });
}

// Fetches the itinerary (and the key name on first load) and shows the
// right screen.
async function load() {
  const seq = ++loadSeq;
  const key = getKey();
  if (!model) setStatus("Loading...");
  showError($("page-error"), "");
  try {
    const [itinerary, who] = await Promise.all([
      api("GET", "/api/itinerary", undefined, key ? {} : { noKey: true }),
      key && !user ? api("GET", "/api/whoami") : null
    ]);
    if (seq !== loadSeq) return;
    model = decorate(itinerary);
    if (!key) canViewPublic = true;
    if (who) user = who.name || "";
    renderTopbar();
    if (user && !isSetUp(model.trip)) showSetup();
    else showTrip();
  } catch (e) {
    if (seq !== loadSeq) return;
    if (e.status === 401) {
      if (key) authFailed();
      else { canViewPublic = false; showSignIn(""); }
    } else {
      $("status").hidden = true;
      renderTopbar();
      showError($("page-error"), model ? e.message : e.message + " Reload the page to try again.");
    }
  }
}

$("signin-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const input = $("signin-key");
  const button = ev.target.querySelector("button[type=submit]");
  const key = input.value.trim();
  if (!key) { showError($("signin-error"), "Please enter your key."); return; }
  showError($("signin-error"), "");
  button.disabled = true;
  try {
    const who = await api("GET", "/api/whoami", undefined, { key });
    setKey(key);
    input.value = "";
    user = (who && who.name) || "";
    await load();
  } catch (e) {
    showError($("signin-error"), e.status === 401 ? "That key was not accepted." : e.message);
  } finally {
    button.disabled = false;
  }
});

$("signin-button").addEventListener("click", () => showSignIn(""));
$("signin-back").addEventListener("click", () => load());
$("logout-button").addEventListener("click", () => { clearKey(); user = ""; model = null; renderTopbar(); load(); });
$("history-button").addEventListener("click", () => historyPanel.open());
// Don't let Esc close the trip dialog while a save is in progress,
// or a failed save's error would be lost.
$("trip-dialog").addEventListener("cancel", (ev) => {
  if ($("trip-dialog").querySelector("button[type=submit]:disabled")) ev.preventDefault();
});
$("trip-button").addEventListener("click", () => {
  const dialog = $("trip-dialog");
  renderTripForm($("trip-dialog-form"), {
    trip: model.trip,
    submitLabel: "Save",
    onCancel: () => dialog.close(),
    onSaved: () => { dialog.close(); load(); },
    onAuthFailed: () => { dialog.close(); authFailed(); }
  });
  dialog.showModal();
});

load();
