// Shared page helpers: icons, escaping, text helpers, day colours and the
// toast.
import { fmtDur } from "./schedule.js";

const ICON = {
  train: '<path d="M7 3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/><path d="M4 10h16M8.5 21l2-4M15.5 21l-2-4M8 13.5h.01M16 13.5h.01"/>',
  hotel: '<path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11.5" r="1.8"/>',
  food: '<path d="M4 12h16a8 8 0 0 1-16 0z"/><path d="M14 3l-3 7M19 4l-5 6"/>',
  sight: '<path d="M3 6.5c5 1.3 13 1.3 18 0M5.5 10h13M7.5 7.5V21M16.5 7.5V21"/>',
  walk: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  pin: '<path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  list: '<path d="M10 6h10M10 12h10M10 18h10"/><circle cx="5" cy="6" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="5" cy="18" r="1.6"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>'
};

export const ico = (k, s = 18) => `<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] ?? ""}</svg>`;
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const plural = (n, w, p) => `${n} ${n === 1 ? w : (p || w + "s")}`;
export const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Day n -> one of the seven day colours in style.css.
export const dayColor = (n) => `var(--d${((n - 1) % 7) + 1})`;

// Warning for a day's schedule. raw: true for plain text (toasts), false for HTML.
export function clashText(sc, raw) {
  const c = sc.clashes;
  if (!c.length) return "";
  if (c.length === 1) {
    const title = raw ? c[0].title : esc(c[0].title);
    return `You'd arrive ${fmtDur(c[0].late_min)} late for ${title}. Move or shorten an earlier stop.`;
  }
  return `You'd arrive late for ${c.length} stops with fixed start times. Move or shorten earlier stops.`;
}

let toastTimer;
// Shows a short message, with an Undo button when undo is given.
export function toast(msg, undo) {
  const t = document.getElementById("toast");
  t.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = msg;
  t.appendChild(span);
  if (undo) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Undo";
    b.onclick = () => { b.onclick = null; b.disabled = true; t.classList.remove("show"); undo(); };
    t.appendChild(b);
  }
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("show"); const b = t.querySelector("button"); if (b) b.disabled = true; }, undo ? 6000 : 3500);
}
