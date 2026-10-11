// Shared helpers for index.html and edit.html: key storage, API calls,
// safe DOM building, date formatting and the login form.
(function () {
  "use strict";

  var KEY_NAME = "itinerary_api_key";

  function getKey() {
    try { return localStorage.getItem(KEY_NAME) || ""; } catch (e) { return ""; }
  }
  function setKey(key) { localStorage.setItem(KEY_NAME, key); }
  function clearKey() {
    try { localStorage.removeItem(KEY_NAME); } catch (e) { /* ignore */ }
  }

  function ApiError(status, message) {
    this.status = status;
    this.message = message;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.name = "ApiError";

  // Calls the API. Returns parsed JSON on success; throws ApiError otherwise.
  // opts: { key: string to override the stored key, noKey: true to send none }
  async function api(method, path, body, opts) {
    opts = opts || {};
    var headers = {};
    var key = opts.noKey ? "" : (opts.key !== undefined ? opts.key : getKey());
    if (key) headers["Authorization"] = "Bearer " + key;
    var init = { method: method, headers: headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    var res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      throw new ApiError(0, "Network error: could not reach the server.");
    }
    var data = null;
    var text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = null; }
    }
    if (!res.ok) {
      var msg = data && typeof data.error === "string" ? data.error : "Request failed (HTTP " + res.status + ").";
      throw new ApiError(res.status, msg);
    }
    return data;
  }

  // Builds a DOM element. attrs keys: class, text, href, and any attribute.
  // Children may be nodes or strings (strings become text nodes).
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "href") { var h = safeHref(v); if (h) node.setAttribute("href", h); }
      else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // Only allow http(s) links.
  function safeHref(url) {
    if (typeof url !== "string") return "";
    var u = url.trim();
    return /^https?:\/\//i.test(u) ? u : "";
  }

  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // "2026-10-12" -> "Mon 12 Oct 2026". Uses UTC so the browser timezone
  // never shifts the day.
  function formatDay(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
    if (!m) return dateStr || "";
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(Date.UTC(y, mo - 1, d));
    return DAYS[dt.getUTCDay()] + " " + d + " " + MONTHS[mo - 1] + " " + y;
  }

  // "12 Oct 2026" style without weekday, for date ranges.
  function formatShortDate(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
    if (!m) return dateStr || "";
    return +m[3] + " " + MONTHS[+m[2] - 1] + " " + m[1];
  }

  function formatDateRange(start, end) {
    if (start && end) return formatShortDate(start) + " to " + formatShortDate(end);
    if (start) return "From " + formatShortDate(start);
    if (end) return "Until " + formatShortDate(end);
    return "";
  }

  function formatTimeRange(start, end) {
    if (start && end) return start + " to " + end;
    if (start) return start;
    if (end) return "until " + end;
    return "All day";
  }

  // Formats an ISO timestamp in the browser's local time.
  function formatTimestamp(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
  }

  function showError(node, message) {
    node.textContent = message || "";
    node.hidden = !message;
  }

  // Wires up the shared login form markup:
  //   #login-section, #login-form, #login-key, #login-error
  // onSuccess(name) is called after the key is checked and stored.
  function setupLogin(onSuccess) {
    var form = document.getElementById("login-form");
    var input = document.getElementById("login-key");
    var errorBox = document.getElementById("login-error");
    var button = form.querySelector("button[type=submit]");
    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var key = input.value.trim();
      if (!key) { showError(errorBox, "Please enter your key."); return; }
      showError(errorBox, "");
      button.disabled = true;
      try {
        var who = await api("GET", "/api/whoami", undefined, { key: key });
        setKey(key);
        input.value = "";
        onSuccess(who && who.name ? who.name : "");
      } catch (e) {
        showError(errorBox, e.status === 401 ? "That key was not accepted." : e.message);
      } finally {
        button.disabled = false;
      }
    });
  }

  function showLogin(show) {
    document.getElementById("login-section").hidden = !show;
    if (show) {
      var input = document.getElementById("login-key");
      if (input) input.focus();
    }
  }

  window.Itin = {
    getKey: getKey, setKey: setKey, clearKey: clearKey,
    api: api, ApiError: ApiError,
    el: el, clear: clear, safeHref: safeHref,
    formatDay: formatDay, formatDateRange: formatDateRange,
    formatTimeRange: formatTimeRange, formatTimestamp: formatTimestamp,
    showError: showError, setupLogin: setupLogin, showLogin: showLogin
  };
})();
