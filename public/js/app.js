// Page startup. Decides which state to show (sign in, setup, loading,
// itinerary) and connects the other modules.
import { api, getKey, setKey, clearKey, showError } from "./api.js";
import { formatDateRange } from "./dates.js";
import { renderTimeline } from "./timeline.js";
import { renderTripForm } from "./setup.js";
import { initItemDialog } from "./item-dialog.js";
import { initHistory } from "./history.js";

const $ = (id) => document.getElementById(id);
const STATES = ["status", "signin-section", "setup-section", "trip-section"];

let user = "";   // signed-in key name; "" when signed out or read-only
let data = null; // last { trip, items } from GET /api/itinerary

const itemDialog = initItemDialog({
  onSaved: (id) => load(id),
  onDeleted: () => load(),
  onAuthFailed: authFailed
});
const history = initHistory({ onAuthFailed: authFailed });

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
  $("history-button").hidden = !user;
  $("logout-button").hidden = !user;
  // Only shown to read-only visitors when VIEW_PUBLIC is on.
  $("signin-button").hidden = !!user || !data;
}

function showSignIn(message) {
  user = "";
  data = null;
  renderTopbar();
  showError($("signin-error"), message || "");
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
    trip: data.trip,
    submitLabel: "Create trip",
    onSaved: () => load(),
    onAuthFailed: authFailed
  });
}

function renderTrip(highlightId) {
  const trip = data.trip || {};
  $("trip-name").textContent = trip.name || "Untitled trip";
  document.title = trip.name || "Itinerary";
  const meta = [formatDateRange(trip.start_date, trip.end_date), trip.timezone ? "Times in " + trip.timezone : ""];
  $("trip-meta").textContent = meta.filter(Boolean).join(" · ");
  $("edit-trip-button").hidden = !user;
  renderTimeline($("days"), trip, data.items || [], {
    canEdit: !!user,
    highlightId,
    onAdd: itemDialog.openAdd,
    onEdit: itemDialog.openEdit
  });
  show("trip-section");
  if (highlightId != null) {
    const node = $("days").querySelector('[data-id="' + highlightId + '"]');
    if (node) node.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

// Fetches the itinerary (and the key name on first load) and shows the
// right state. highlightId briefly highlights a just-saved item.
async function load(highlightId) {
  const key = getKey();
  if (!data) setStatus("Loading...");
  showError($("page-error"), "");
  try {
    const [itinerary, who] = await Promise.all([
      api("GET", "/api/itinerary", undefined, key ? {} : { noKey: true }),
      key && !user ? api("GET", "/api/whoami") : null
    ]);
    data = itinerary;
    if (who) user = who.name || "";
    renderTopbar();
    if (user && !isSetUp(data.trip)) showSetup();
    else renderTrip(highlightId);
  } catch (e) {
    if (e.status === 401) {
      if (key) authFailed();
      else showSignIn("");
    } else {
      $("status").hidden = true;
      showError($("page-error"), e.message);
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
$("logout-button").addEventListener("click", () => { clearKey(); showSignIn(""); });
$("history-button").addEventListener("click", () => history.open());
$("edit-trip-button").addEventListener("click", () => {
  const dialog = $("trip-dialog");
  renderTripForm($("trip-dialog-form"), {
    trip: data.trip,
    submitLabel: "Save",
    onCancel: () => dialog.close(),
    onSaved: () => { dialog.close(); load(); },
    onAuthFailed: () => { dialog.close(); authFailed(); }
  });
  dialog.showModal();
});

load();
