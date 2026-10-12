// Map view: a button per day plus "Entire trip", then an OpenStreetMap map
// with a pin per location. Leaflet loads from a CDN the first time the map
// is shown, so the other views don't wait for it.
import { esc } from "./ui.js";
import { showError } from "./api.js";
import { mapPoints } from "./map-points.js";

const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/";
const LEAFLET_CSS_SRI = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
const LEAFLET_JS_SRI = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
// OpenStreetMap's free tiles need no key, but the credit line must stay.
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const PIN = "#2F55A4"; // --d1 in style.css
const WORLD = { center: [20, 0], zoom: 2 };

const LOAD_FAILED = "The map could not be loaded. Check your internet connection, then reload the page.";
const TILES_FAILED = "Some parts of the map could not be loaded. The pins are still in the right places.";
const DRAW_FAILED = "The map could not show the locations. Reload the page to try again.";

// Adds a <link> or <script> to the page and resolves once it has loaded.
function addTag(tag, attrs) {
  return new Promise((resolve, reject) => {
    const el = Object.assign(document.createElement(tag), attrs, { crossOrigin: "anonymous" });
    el.onload = () => resolve(el);
    el.onerror = () => { el.remove(); reject(new Error("Could not load " + (attrs.src || attrs.href))); };
    document.head.appendChild(el);
  });
}

let leaflet = null; // promise for window.L, shared by every render
function loadLeaflet() {
  if (!leaflet) {
    leaflet = Promise.all([
      addTag("link", { rel: "stylesheet", href: LEAFLET + "leaflet.css", integrity: LEAFLET_CSS_SRI }),
      addTag("script", { src: LEAFLET + "leaflet.js", integrity: LEAFLET_JS_SRI })
    ]).then(() => {
      if (!window.L) throw new Error("Leaflet loaded but window.L is missing");
      return window.L;
    }).catch((e) => {
      leaflet = null; // let the next render try again
      throw e;
    });
  }
  return leaflet;
}

// ctx is built in app.js. Returns { render }.
export function initMap(ctx) {
  const nav = document.getElementById("mp-nav");
  const errEl = document.getElementById("mp-error");
  const mapEl = document.getElementById("mp-map");
  let which = null; // a date, or "all"
  let map = null, pins = null, seq = 0;

  const days = () => ctx.model().days;

  function navHTML(list) {
    const btn = (v, label, color) => `<button type="button" data-which="${v}" aria-current="${v === which}"${color ? ` style="--day:${color}"` : ""}><span class="dot" aria-hidden="true"></span>${label}</button>`;
    return btn("all", "Entire trip", "var(--ink)") + list.map((d) => btn(d.date, `Day ${d.n}, ${d.short}`, d.color)).join("");
  }

  function createMap(L) {
    map = L.map(mapEl);
    let tileWarned = false;
    L.tileLayer(TILES, { maxZoom: 19, attribution: CREDIT })
      .on("tileerror", (e) => {
        if (tileWarned) return; // one warning is enough; an outage fails every tile
        tileWarned = true;
        console.warn("[map] A map tile failed to load (later tile errors are not logged):", e.tile && e.tile.src);
        showError(errEl, TILES_FAILED);
      })
      .addTo(map);
    pins = L.featureGroup().addTo(map);
  }

  function draw(L, list) {
    map.invalidateSize(); // the map box may have been hidden since the last draw
    pins.clearLayers();
    const points = mapPoints(list, which);
    points.forEach((p) => {
      L.circleMarker([p.lat, p.lng], { radius: 9, color: "#fff", weight: 2, fillColor: PIN, fillOpacity: 1 })
        .bindPopup(p.labels.map(esc).join("<br>"))
        .addTo(pins);
    });
    // A day without pins shows the whole trip, or the world if nothing has a location.
    const frame = points.length ? points : mapPoints(list, "all");
    if (frame.length) map.fitBounds(L.latLngBounds(frame.map((p) => [p.lat, p.lng])), { padding: [32, 32], maxZoom: 15 });
    else map.setView(WORLD.center, WORLD.zoom);
  }

  async function render() {
    if (!ctx.model() || ctx.view() !== "map") return;
    const run = ++seq;
    const list = days();
    if (which !== "all" && !list.some((d) => d.date === which)) which = list.length ? list[0].date : "all";
    nav.innerHTML = navHTML(list);
    showError(errEl, "");
    let L;
    try {
      L = await loadLeaflet();
    } catch (e) {
      console.error("[map] Leaflet failed to load:", e);
      if (run === seq) showError(errEl, LOAD_FAILED);
      return;
    }
    if (run !== seq) return; // a newer render has taken over
    try {
      if (!map) createMap(L);
      draw(L, list);
    } catch (e) {
      console.error("[map] Could not draw the map for", which, e);
      showError(errEl, DRAW_FAILED);
    }
  }

  nav.addEventListener("click", (e) => {
    const b = e.target.closest("[data-which]");
    if (!b || b.dataset.which === which) return;
    which = b.dataset.which;
    render();
  });

  return { render };
}
