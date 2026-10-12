// Map view: a button per day plus "Entire trip", then a map with a pin per
// location. MapLibre loads from a CDN the first time the map is shown, so
// the other views don't wait for it.
import { esc } from "./ui.js";
import { showError } from "./api.js";
import { mapPoints } from "./map-points.js";

const MAPLIBRE = "https://unpkg.com/maplibre-gl@5.24.0/dist/";
const MAPLIBRE_CSS_SRI = "sha384-uTttxo/aOKbdE5RlD/SPzSDoDmNvGlUYPjONi2MN/b7c9HPSvW07OIuyP7uL6jxK";
const MAPLIBRE_JS_SRI = "sha384-5+cfbwT0iiub6VsQAdn6yz16nr6sDiQoHx6tm4O8OVYXHYOxcffFmCJBL0dgdvGp";
// OpenFreeMap needs no key. This style labels places in English (or Latin
// letters) with the local name next to it, and adds its own credit line.
const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const PIN = "#2F55A4"; // --d1 in style.css
const WORLD = { center: [0, 20], zoom: 1 };

const LOAD_FAILED = "The map could not be loaded. Check your internet connection, then reload the page.";
const START_FAILED = "The map could not start. Your browser may not support it; try another browser.";
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

let lib = null; // promise for window.maplibregl, shared by every render
function loadMapLibre() {
  if (!lib) {
    lib = Promise.all([
      addTag("link", { rel: "stylesheet", href: MAPLIBRE + "maplibre-gl.css", integrity: MAPLIBRE_CSS_SRI }),
      addTag("script", { src: MAPLIBRE + "maplibre-gl.js", integrity: MAPLIBRE_JS_SRI })
    ]).then(() => {
      if (!window.maplibregl) throw new Error("MapLibre loaded but window.maplibregl is missing");
      return window.maplibregl;
    }).catch((e) => {
      lib = null; // let the next render try again
      throw e;
    });
  }
  return lib;
}

// ctx is built in app.js. Returns { render }.
export function initMap(ctx) {
  const nav = document.getElementById("mp-nav");
  const errEl = document.getElementById("mp-error");
  const mapEl = document.getElementById("mp-map");
  let which = null; // a date, or "all"
  let map = null, markers = [], seq = 0;

  const days = () => ctx.model().days;

  function navHTML(list) {
    const btn = (v, label, color) => `<button type="button" data-which="${v}" aria-current="${v === which}"${color ? ` style="--day:${color}"` : ""}><span class="dot" aria-hidden="true"></span>${label}</button>`;
    return btn("all", "Entire trip", "var(--ink)") + list.map((d) => btn(d.date, `Day ${d.n}, ${d.short}`, d.color)).join("");
  }

  function createMap(ml) {
    map = new ml.Map({ container: mapEl, style: STYLE, center: WORLD.center, zoom: WORLD.zoom });
    map.addControl(new ml.NavigationControl({ showCompass: false }), "top-left");
    let warned = false;
    // Style, tile and font failures all arrive here.
    map.on("error", (e) => {
      if (warned) return; // one warning is enough; an outage fails every tile
      warned = true;
      const err = e.error || e;
      console.warn("[map] Part of the map failed to load (later errors are not logged):", err.message || String(err));
      showError(errEl, TILES_FAILED);
    });
  }

  function draw(ml, list) {
    map.resize(); // the map box may have been hidden since the last draw
    markers.forEach((m) => m.remove());
    const points = mapPoints(list, which);
    markers = points.map((p) => new ml.Marker({ color: PIN })
      .setLngLat([p.lng, p.lat])
      .setPopup(new ml.Popup({ offset: 25 }).setHTML(p.labels.map(esc).join("<br>")))
      .addTo(map));
    // A day without pins shows the whole trip, or the world if nothing has a location.
    const frame = points.length ? points : mapPoints(list, "all");
    if (!frame.length) { map.jumpTo(WORLD); return; }
    const bounds = new ml.LngLatBounds();
    frame.forEach((p) => bounds.extend([p.lng, p.lat]));
    map.fitBounds(bounds, { padding: 48, maxZoom: 15 });
  }

  async function render() {
    if (!ctx.model() || ctx.view() !== "map") return;
    const run = ++seq;
    const list = days();
    if (which !== "all" && !list.some((d) => d.date === which)) which = list.length ? list[0].date : "all";
    nav.innerHTML = navHTML(list);
    showError(errEl, "");
    let ml;
    try {
      ml = await loadMapLibre();
    } catch (e) {
      console.error("[map] MapLibre failed to load:", e);
      if (run === seq) showError(errEl, LOAD_FAILED);
      return;
    }
    if (run !== seq) return; // a newer render has taken over
    if (!map) {
      try {
        createMap(ml);
      } catch (e) {
        console.error("[map] Could not start the map (WebGL may be unavailable):", e);
        showError(errEl, START_FAILED);
        return;
      }
    }
    try {
      draw(ml, list);
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
