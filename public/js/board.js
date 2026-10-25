// Board view: one column per day plus Ideas. Stops move by dragging the
// handle (pointer events, so mouse and touch both work) or with the menu
// that opens when the handle is tapped.
import { ico, esc, plural, clashText, reduce, toast } from "./ui.js";
import { fmtDur } from "./schedule.js";
import { safeHref } from "./api.js";

const DAY_MAX = 600, BUSY = 540; // minutes: full load bar, "a long day"

// ctx is built in app.js. Returns { render, renderJump, flashCol, closeMenu }.
export function initBoard(ctx) {
  const boardEl = document.getElementById("board");
  const bdJump = document.getElementById("bd-jump");
  const menu = document.getElementById("menu");
  let menuFor = null, dg = null, suppressClick = false, pendingRender = false;
  menu.tabIndex = -1; // lets the menu take focus when none of its items are enabled

  const cols = () => [{ id: "ideas", color: "var(--idea)" }, ...ctx.model().days.map((d) => ({ ...d, id: d.date }))];
  const blocked = (id, to) => ctx.stopById(id).status === "booked" && to !== ctx.colOf(id);
  const indexIn = (col, id) => ctx.colStops(col).findIndex((s) => s.id === id);

  function cardHTML(s, c, scheduled, canEdit, landed) {
    const st = s.status;
    const meta = scheduled
      ? `${s.start} to ${s.end}${s.area ? ", " + esc(s.area) : ""}${st === "suggested" ? ", suggestion" : ""}`
      : `${s.area ? esc(s.area) + ", " : ""}${fmtDur(s.duration_min)}`;
    const body = `<span class="bc-title">${esc(s.title)}</span><span class="bc-meta">${meta}</span>${scheduled && s.late_min ? `<span class="bc-late">${ico("alert", 14)}${fmtDur(s.late_min)} late</span>` : ""}`;
    const bodyEl = scheduled ? `<button class="bc-body" type="button" data-open="${s.id}" title="Show in timeline">${body}</button>`
      : canEdit ? `<button class="bc-body" type="button" data-edit="${s.id}" title="Edit">${body}</button>`
      : `<div class="bc-body">${body}</div>`;
    const href = safeHref(s.link);
    const links = [
      s.lat != null ? `<a href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}" target="_blank" rel="noopener">${ico("pin", 14)}Maps</a>` : "",
      href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${ico("link", 14)}Link</a>` : "",
    ].join("");
    return `<li class="bc is-${st}${canEdit ? "" : " ro"}${landed === s.id ? " landed" : ""}" data-id="${s.id}" style="--day:${c.color}">
      ${canEdit ? `<button class="grip" type="button" aria-label="Move ${esc(s.title)}" aria-haspopup="menu">${ico("grip", 18)}</button>` : ""}
      ${bodyEl}
      ${links ? `<div class="bc-links">${links}</div>` : ""}
      ${st === "booked" ? `<div class="bstub">${ico("lock", 15)}<span>Booked</span></div>` : ""}
    </li>`;
  }

  function colHTML(c, canEdit, landed) {
    if (c.id === "ideas") {
      const ideas = ctx.model().ideas, mins = ideas.reduce((a, s) => a + s.duration_min, 0);
      const sub = ideas.length ? `${fmtDur(mins)} if you did them all.` : canEdit ? "Add places you might visit." : "No ideas yet.";
      const trash = canEdit ? `<div class="trash" aria-hidden="true">${ico("trash", 18)}<span>Drop here to delete</span></div>` : "";
      return `<div class="ideas-stack">${trash}<section class="col ideas" data-col="ideas" style="--day:${c.color}" aria-labelledby="h-ideas">
        <header class="col-head"><div class="ch-top"><h2 id="h-ideas">Ideas</h2><span class="ch-date">${plural(ideas.length, "idea")}</span></div>
          <p class="ch-title">Not on a day yet</p><p class="ch-sub">${sub}</p></header>
        <ol class="cards">${ideas.map((s) => cardHTML(s, c, false, canEdit, landed)).join("")}</ol>
        ${canEdit ? `<form class="add" id="add"><input id="addin" type="text" placeholder="Add an idea" aria-label="New idea" maxlength="200" autocomplete="off"><button type="submit">Add</button></form>` : ""}
      </section></div>`;
    }
    const sc = c.schedule, rows = sc.stops, busy = sc.total_min > BUSY;
    return `<section class="col${busy ? " busy" : ""}" data-col="${c.id}" style="--day:${c.color}" aria-labelledby="h-${c.id}">
      <header class="col-head">
        <div class="ch-top"><h2 id="h-${c.id}">Day ${c.n}</h2><span class="ch-date">${c.short}</span></div>
        <p class="ch-title">${esc(c.title || "")}</p>
        <div class="load"><div class="load-bar" aria-hidden="true"><span style="width:${Math.min(100, sc.total_min / DAY_MAX * 100)}%"></span></div>
          <span class="load-text">${sc.total_min ? `${fmtDur(sc.total_min)} of stops${busy ? ", a long day" : ""}` : "No stops yet"}</span></div>
        ${rows.length ? `<p class="ch-sub">Runs ${rows[0].start} to ${rows[rows.length - 1].end}</p>` : ""}
        ${sc.clashes.length ? `<p class="ch-warn">${ico("alert", 15)}<span>${clashText(sc)}</span></p>` : ""}
      </header>
      <ol class="cards">${rows.map((s) => cardHTML(s, c, true, canEdit, landed)).join("")}</ol>
    </section>`;
  }

  function render() {
    if (dg && dg.active) { pendingRender = true; return; }
    closeMenu(false);
    const canEdit = ctx.canEdit(), landed = ctx.takeLanded();
    const left = boardEl.scrollLeft;
    const input = document.getElementById("addin");
    const draft = input ? input.value : "", hadFocus = !!input && document.activeElement === input;
    boardEl.classList.toggle("ro", !canEdit);
    boardEl.innerHTML = cols().map((c) => colHTML(c, canEdit, landed)).join("");
    boardEl.scrollLeft = left;
    const again = document.getElementById("addin");
    if (again) { again.value = draft; if (hadFocus) again.focus(); }
    renderJump();
  }

  function currentCol() {
    const els = [...boardEl.querySelectorAll(".col")];
    if (!els.length) return "ideas";
    const x = boardEl.scrollLeft + 24;
    let best = els[0];
    for (const c of els) if (c.offsetLeft <= x) best = c;
    return best.dataset.col;
  }
  function renderJump() {
    const cur = currentCol();
    bdJump.innerHTML = cols().map((c) => `<button type="button" data-jump="${c.id}" style="--day:${c.color}" aria-current="${c.id === cur}"><span class="dot"></span>${c.id === "ideas" ? "Ideas" : c.short}</button>`).join("");
  }
  function scrollToCol(col, smooth) {
    boardEl.scrollTo({ left: col.offsetLeft - parseFloat(getComputedStyle(boardEl).paddingLeft), behavior: smooth && !reduce ? "smooth" : "auto" });
  }
  // Scrolls to a column and flashes it (used by "Rearrange" in the timeline).
  function flashCol(id) {
    const col = boardEl.querySelector(`.col[data-col="${id}"]`);
    if (!col) return;
    if (boardEl.scrollWidth > boardEl.clientWidth) scrollToCol(col, false);
    col.classList.remove("flash-col"); void col.offsetWidth; col.classList.add("flash-col");
    renderJump();
  }
  bdJump.addEventListener("click", (e) => {
    const b = e.target.closest("[data-jump]");
    if (!b) return;
    const col = boardEl.querySelector(`.col[data-col="${b.dataset.jump}"]`);
    if (col) scrollToCol(col, true);
  });
  let jt;
  boardEl.addEventListener("scroll", () => { closeMenu(false); clearTimeout(jt); jt = setTimeout(renderJump, 60); }, { passive: true });

  /* drag with pointer events (mouse and touch) */
  boardEl.addEventListener("pointerdown", (e) => {
    if (dg) return;
    const g = e.target.closest(".grip");
    if (!g || e.button > 0) return;
    const card = g.closest(".bc"), r = card.getBoundingClientRect();
    dg = { id: Number(card.dataset.id), card, pid: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY,
      ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width, h: r.height, active: false };
  });
  boardEl.addEventListener("pointermove", (e) => {
    if (!dg || e.pointerId !== dg.pid) return;
    if (!dg.active && e.pointerType === "mouse" && !e.buttons) { dg = null; return; } // button released outside the page
    dg.x = e.clientX; dg.y = e.clientY;
    if (!dg.active) { if (Math.hypot(dg.x - dg.sx, dg.y - dg.sy) < 6) return; startDrag(); }
    e.preventDefault();
    moveGhost(); updateTarget();
  });
  boardEl.addEventListener("pointerup", (e) => { if (dg && e.pointerId === dg.pid) endDrag(true); });
  boardEl.addEventListener("pointercancel", (e) => { if (dg && e.pointerId === dg.pid) endDrag(false); });
  function startDrag() {
    dg.active = true; closeMenu(false);
    try { boardEl.setPointerCapture(dg.pid); } catch (e) { /* ignore */ }
    const ghost = dg.card.cloneNode(true);
    ghost.classList.add("ghost"); ghost.classList.remove("landed");
    ghost.style.width = dg.w + "px"; ghost.style.height = dg.h + "px";
    document.body.appendChild(ghost); dg.ghost = ghost;
    const ph = document.createElement("li");
    ph.className = "ph"; ph.style.height = dg.h + "px";
    ph.style.setProperty("--day", dg.card.style.getPropertyValue("--day"));
    dg.card.after(ph); dg.ph = ph;
    dg.card.classList.add("is-src");
    document.body.classList.add("dragging"); boardEl.classList.add("dragging");
    boardEl.querySelectorAll(".col").forEach((c) => c.classList.toggle("no-drop", blocked(dg.id, c.dataset.col)));
    dg.raf = requestAnimationFrame(autoScroll);
    moveGhost();
  }
  function moveGhost() { dg.ghost.style.transform = `translate(${dg.x - dg.ox}px, ${dg.y - dg.oy}px) rotate(${reduce ? 0 : 1.5}deg)`; }
  function colAtPoint() { const el = document.elementFromPoint(dg.x, dg.y); return el && el.closest(".col"); }
  const overTrash = (x, y) => { const el = document.elementFromPoint(x, y); return !!(el && el.closest(".trash")); };
  function updateTarget() {
    const col = colAtPoint(), trash = boardEl.querySelector(".trash"), del = overTrash(dg.x, dg.y);
    if (trash) trash.classList.toggle("over", del);
    boardEl.querySelectorAll(".col.drop-target").forEach((c) => { if (c !== col) c.classList.remove("drop-target"); });
    // Over the delete box: put the placeholder back so nothing looks moved.
    if (del) { if (dg.ph.previousElementSibling !== dg.card) dg.card.after(dg.ph); return; }
    if (!col || col.classList.contains("no-drop")) return;
    col.classList.add("drop-target");
    const list = col.querySelector(".cards");
    let before = null;
    for (const c of list.querySelectorAll(".bc:not(.is-src)")) {
      const r = c.getBoundingClientRect();
      if (dg.y < r.top + r.height / 2) { before = c; break; }
    }
    if (before) { if (dg.ph.nextElementSibling !== before) list.insertBefore(dg.ph, before); }
    else if (dg.ph.parentNode !== list || dg.ph.nextElementSibling) list.appendChild(dg.ph);
    dg.ph.style.setProperty("--day", col.style.getPropertyValue("--day"));
  }
  function autoScroll() {
    if (!dg || !dg.active) return;
    const edge = 48, sp = 12, br = boardEl.getBoundingClientRect();
    if (dg.x < br.left + edge) boardEl.scrollLeft -= sp;
    else if (dg.x > br.right - edge) boardEl.scrollLeft += sp;
    if (dg.y < edge) window.scrollBy(0, -sp);
    else if (dg.y > window.innerHeight - edge) window.scrollBy(0, sp);
    updateTarget();
    dg.raf = requestAnimationFrame(autoScroll);
  }
  function endDrag(commit) {
    const d = dg; dg = null;
    try { boardEl.releasePointerCapture(d.pid); } catch (e) { /* ignore */ }
    if (!d.active) return;
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    cancelAnimationFrame(d.raf);
    d.ghost.remove();
    document.body.classList.remove("dragging"); boardEl.classList.remove("dragging");
    const el = document.elementFromPoint(d.x, d.y), over = el && el.closest(".col");
    const overBlocked = over && over.classList.contains("no-drop");
    const toCol = d.ph.closest(".col");
    pendingRender = false;
    if (commit && overTrash(d.x, d.y)) { render(); ctx.onDelete(d.id); return; }
    if (!commit || !over || !toCol) { render(); return; }
    if (overBlocked) {
      render();
      toast(`${ctx.stopById(d.id).title} is booked for ${ctx.colLabel(ctx.colOf(d.id))}. Change its day in the edit dialog to move it.`);
      return;
    }
    const to = toCol.dataset.col;
    const idx = [...d.ph.parentNode.children].filter((n) => n === d.ph || (n.classList.contains("bc") && !n.classList.contains("is-src"))).indexOf(d.ph);
    // Dropped back in its own slot: nothing to save, just restore the card.
    if (to === ctx.colOf(d.id) && idx === indexIn(to, d.id)) { render(); return; }
    ctx.onMove(d.id, to, idx);
  }

  /* move menu (tap or keyboard) */
  boardEl.addEventListener("click", (e) => {
    if (suppressClick) return;
    const o = e.target.closest("[data-open]");
    if (o) { ctx.onShowInTimeline(Number(o.dataset.open)); return; }
    const ed = e.target.closest("[data-edit]");
    if (ed) { ctx.onEditStop(Number(ed.dataset.edit)); return; }
    const g = e.target.closest(".grip");
    if (!g) return;
    const id = Number(g.closest(".bc").dataset.id);
    if (!menu.hidden && menuFor === id) closeMenu(true); else openMenu(g);
  });
  function openMenu(grip) {
    closeMenu(false);
    const id = Number(grip.closest(".bc").dataset.id), from = ctx.colOf(id), s = ctx.stopById(id);
    const i = indexIn(from, id), last = ctx.colStops(from).length - 1, isBooked = s.status === "booked";
    menu.innerHTML = `<p class="mt">${esc(s.title)}</p>
      <button type="button" role="menuitem" data-mv="up" ${i === 0 ? "disabled" : ""}>${ico("up", 18)}Move up</button>
      <button type="button" role="menuitem" data-mv="down" ${i === last ? "disabled" : ""}>${ico("down", 18)}Move down</button>
      <hr>
      ${isBooked ? `<p>Booked for ${ctx.colLabel(from)}, so it stays on this day.</p>` : ""}
      ${cols().filter((c) => c.id !== from).map((c) => `<button type="button" role="menuitem" data-to="${c.id}" style="--day:${c.color}" ${isBooked ? "disabled" : ""}><span class="dot"></span>Move to ${ctx.colLabel(c.id)}</button>`).join("")}`;
    menu.hidden = false; menuFor = id;
    const r = grip.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    const left = Math.min(Math.max(8, r.left), document.documentElement.clientWidth - mw - 8);
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8 && r.top - mh - 6 > 8) top = r.top - mh - 6;
    menu.style.left = (left + window.scrollX) + "px"; menu.style.top = (top + window.scrollY) + "px";
    grip.setAttribute("aria-expanded", "true");
    const first = menu.querySelector("button:not([disabled])");
    (first || menu).focus();
  }
  function closeMenu(refocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    const g = boardEl.querySelector(`.bc[data-id="${menuFor}"] .grip`);
    if (g) { g.setAttribute("aria-expanded", "false"); if (refocus) g.focus(); }
    menuFor = null;
  }
  function focusGrip(id) { const g = boardEl.querySelector(`.bc[data-id="${id}"] .grip`); if (g) g.focus(); }
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    const id = menuFor, from = ctx.colOf(id), i = indexIn(from, id);
    closeMenu(false);
    if (b.dataset.mv === "up") ctx.onMove(id, from, i - 1);
    else if (b.dataset.mv === "down") ctx.onMove(id, from, i + 1);
    else {
      const to = b.dataset.to;
      ctx.onMove(id, to, ctx.colStops(to).length);
      const col = boardEl.querySelector(`.col[data-col="${to}"]`);
      if (col) scrollToCol(col, true);
    }
    focusGrip(id);
  });
  menu.addEventListener("keydown", (e) => {
    const items = [...menu.querySelectorAll("button:not([disabled])")], i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); closeMenu(true); }
    else if (e.key === "Tab") closeMenu(false);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
    }
  });
  document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target) && !e.target.closest(".grip")) closeMenu(false); });
  window.addEventListener("resize", () => closeMenu(false));

  /* add idea */
  boardEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("addin"), title = input.value.trim();
    if (!title) { input.focus(); return; }
    input.value = "";
    ctx.onAddIdea(title);
  });

  return { render, renderJump, flashCol, closeMenu };
}
