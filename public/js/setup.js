// Trip form, used for first-time setup and for "Edit trip".
import { api, el, clear, showError } from "./api.js";

const TZ_LIST_ID = "tz-list";

export function browserTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; }
}

// Adds a <datalist> of all IANA timezones to the page once, so the
// timezone input can suggest matches as the user types.
function ensureTimezoneList() {
  if (document.getElementById(TZ_LIST_ID)) return TZ_LIST_ID;
  let zones = [];
  try { zones = Intl.supportedValuesOf("timeZone"); } catch (e) { /* older browser: free text only */ }
  const list = el("datalist", { id: TZ_LIST_ID },
    ["UTC", ...zones.filter((z) => z !== "UTC")].map((z) => el("option", { value: z })));
  document.body.appendChild(list);
  return TZ_LIST_ID;
}

function field(label, input) {
  return el("label", { class: "field" }, [el("span", { text: label }), input]);
}

// Builds the trip form inside container.
// opts: { trip, submitLabel, onSaved(trip), onCancel (optional), onAuthFailed() }
export function renderTripForm(container, opts) {
  clear(container);
  const trip = opts.trip || {};
  const nameIn = el("input", {
    name: "name", type: "text", required: true, maxlength: 200,
    value: trip.name || "", placeholder: "e.g. Japan in October"
  });
  const startIn = el("input", { name: "start_date", type: "date", required: true, value: trip.start_date || "" });
  const endIn = el("input", {
    name: "end_date", type: "date", required: true,
    value: trip.end_date || "", min: trip.start_date || null
  });
  const tzIn = el("input", {
    name: "timezone", type: "text", required: true, maxlength: 64, autocomplete: "off",
    list: ensureTimezoneList(), value: trip.timezone || browserTimezone(),
    placeholder: "Start typing, e.g. Tokyo"
  });
  const travIn = el("input", {
    name: "travellers", type: "number", min: 1, max: 99, step: 1,
    value: trip.travellers || "", placeholder: "Optional"
  });

  // Keep the end date on or after the start date, and fill it in
  // when the start date is picked first.
  startIn.addEventListener("change", () => {
    endIn.min = startIn.value;
    if (startIn.value && (!endIn.value || endIn.value < startIn.value)) endIn.value = startIn.value;
  });

  const error = el("p", { class: "error", role: "alert", hidden: true });
  const submit = el("button", { type: "submit", class: "btn btn-ink", text: opts.submitLabel });
  const form = el("form", { class: "trip-form" }, [
    field("Trip name", nameIn),
    el("div", { class: "row" }, [field("Start date", startIn), field("End date", endIn)]),
    el("div", { class: "row" }, [field("Timezone", tzIn), field("Travellers", travIn)]),
    error,
    el("div", { class: "actions" }, [
      submit,
      opts.onCancel ? el("button", { type: "button", class: "btn", text: "Cancel", onclick: opts.onCancel }) : null
    ])
  ]);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    showError(error, "");
    if (!nameIn.value.trim()) { showError(error, "Please enter a trip name."); return; }
    if (!tzIn.value.trim()) { showError(error, "Please choose a timezone."); return; }
    submit.disabled = true;
    try {
      const saved = await api("PUT", "/api/trip", {
        name: nameIn.value.trim(),
        start_date: startIn.value,
        end_date: endIn.value,
        timezone: tzIn.value.trim(),
        travellers: travIn.value ? Number(travIn.value) : null
      });
      // Leave the button disabled: the form is replaced once the page reloads,
      // and a second click would only save the same trip again.
      opts.onSaved(saved);
    } catch (e) {
      submit.disabled = false;
      if (e.status === 401) opts.onAuthFailed();
      else showError(error, e.message);
    }
  });

  container.appendChild(form);
  nameIn.focus();
}
