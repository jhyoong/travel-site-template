// Key storage, API calls and small DOM helpers shared by all modules.

const KEY_NAME = "itinerary_api_key";

export function getKey() {
  try { return localStorage.getItem(KEY_NAME) || ""; } catch (e) { return ""; }
}
export function setKey(key) { localStorage.setItem(KEY_NAME, key); }
export function clearKey() {
  try { localStorage.removeItem(KEY_NAME); } catch (e) { /* ignore */ }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Calls the API. Returns parsed JSON on success; throws ApiError otherwise.
// opts: { key: string to override the stored key, noKey: true to send none }
export async function api(method, path, body, opts = {}) {
  const headers = {};
  const key = opts.noKey ? "" : (opts.key !== undefined ? opts.key : getKey());
  if (key) headers["Authorization"] = "Bearer " + key;
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new ApiError(0, "Network error: could not reach the server.");
  }
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = null; }
  }
  if (!res.ok) {
    const msg = data && typeof data.error === "string" ? data.error : "Request failed (HTTP " + res.status + ").";
    throw new ApiError(res.status, msg);
  }
  return data;
}

// Builds a DOM element. attrs keys: class, text, href, on<event>, and any
// other attribute. Children may be nodes or strings (strings become text).
// null, undefined and false attributes or children are skipped.
export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  attrs = attrs || {};
  Object.keys(attrs).forEach((k) => {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) return;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "href") { const h = safeHref(v); if (h) node.setAttribute("href", h); }
    else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  });
  (children || []).forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Only allow http(s) links.
export function safeHref(url) {
  if (typeof url !== "string") return "";
  const u = url.trim();
  return /^https?:\/\//i.test(u) ? u : "";
}

export function showError(node, message) {
  node.textContent = message || "";
  node.hidden = !message;
}
