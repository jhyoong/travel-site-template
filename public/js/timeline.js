// Timeline view: a button per day, then one section per day with its stops
// in order and the travel between them.
import { ico, esc, plural, clashText, reduce, LEG } from "./ui.js";
import { fmtDur, FREE_MIN } from "./schedule.js";
import { safeHref } from "./api.js";

// ctx is built in app.js. Returns { render, spy, flashStop, revealStop }.
export function initTimeline(ctx) {
  const nav = document.getElementById("tl-nav");
  const daysEl = document.getElementById("tl-days");
  let active = null, spyLock = false, spyRaf = 0;
  // On wide screens the day buttons sit in a sidebar instead of a sticky bar
  // above the days (matches the breakpoint in style.css).
  const side = window.matchMedia("(min-width:1240px)");
  const barH = () => side.matches ? 0 : nav.offsetHeight;

  const days = () => ctx.model().days;

  function chipHTML(d) {
    const sc = d.schedule, rows = sc.stops, n = sc.clashes.length;
    const meta = n ? plural(n, "timing clash", "timing clashes")
      : rows.length ? `${plural(rows.length, "stop")}, ${rows[0].start} to ${rows[rows.length - 1].end}` : "Nothing planned yet";
    return `<button class="dchip${n ? " has-clash" : ""}" type="button" data-jump="${d.date}" aria-current="${d.date === active}" style="--day:${d.color}">
      <span class="n">Day ${d.n}</span><span class="dt">${d.short}</span><span class="ttl">${esc(d.title || "")}</span><span class="meta">${meta}</span>
      ${n ? `<span class="wdot" aria-hidden="true"></span><span class="sr">, has a timing clash</span>` : ""}</button>`;
  }

  function stopHTML(r, canEdit) {
    const id = r.id, st = r.status, open = ctx.openSet.has(id);
    const rowCls = st === "booked" ? "is-booked" : st === "suggested" ? "is-sugg" : "is-planned";
    const cardCls = st === "booked" ? "card ticket" : st === "suggested" ? "card sugg" : "card";
    const maps = r.lat != null ? `<a class="maplink" href="https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}" target="_blank" rel="noopener">${ico("pin", 16)}Open in Google Maps</a>` : "";
    const href = safeHref(r.link);
    const link = href ? `<a class="maplink" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${ico("link", 16)}Open link</a>` : "";
    return `<li class="stop ${rowCls}" data-id="${id}">
      <div class="time"><span class="t">${r.start}</span><span class="dur">${fmtDur(r.duration_min)}</span></div>
      <div class="node" aria-hidden="true">${ico(r.kind, 16)}</div>
      <article class="${cardCls}">
        <h3 class="ch"><button class="card-main" type="button" aria-expanded="${open}" aria-controls="det-${id}">
          <span class="cm-text"><span class="title">${esc(r.title)}</span>${r.area ? `<span class="area">${esc(r.area)}</span>` : ""}${st === "suggested" ? '<span class="sugg-line">Suggested stop, not confirmed yet</span>' : ""}</span>
          <span class="chev">${ico("chev", 18)}</span>
        </button></h3>
        ${st === "booked" ? `<div class="stub">${ico("check", 16)}<span>Booked</span>${r.stub ? `<small>${esc(r.stub)}</small>` : ""}</div>` : ""}
        ${r.late_min ? `<p class="late">${ico("alert", 16)}<span>You'd arrive ${fmtDur(r.late_min)} late for this ${st === "booked" ? "booking" : "fixed start time"}.</span>${canEdit ? `<button class="late-x" type="button" data-act="late-ok" data-id="${id}">Dismiss</button>` : ""}</p>` : ""}
        <div class="details" id="det-${id}" ${open ? "" : "hidden"}>
          ${r.notes ? `<p class="notes">${esc(r.notes)}</p>` : ""}
          ${r.booking_ref ? `<p class="ref"><strong>Booking:</strong> ${esc(r.booking_ref)}</p>` : ""}
          ${maps}${link}
          ${canEdit ? `<p class="card-actions"><button class="btn" type="button" data-act="edit" data-id="${id}">${ico("edit", 16)}Edit</button></p>` : ""}
        </div>
        ${st === "suggested" && canEdit ? `<div class="sugg-actions"><button class="btn btn-ink" type="button" data-act="keep" data-id="${id}">Add to plan</button><button class="btn" type="button" data-act="ideas" data-id="${id}">Move to ideas</button></div>` : ""}
      </article>
    </li>`;
  }

  const legRow = (r) => `<li class="leg"><span class="leg-text">${ico(LEG[r.leg.mode], 16)}<span>${r.leg.text}${r.free_min >= FREE_MIN ? `<span class="free">, then ${fmtDur(r.free_min)} free</span>` : ""}</span></span></li>`;
  const edgeRow = (t, leg, label) => `<li class="leg edge"><span class="leg-time">${t}</span><span class="leg-dot" aria-hidden="true"></span><span class="leg-text">${ico(LEG[leg.mode], 16)}<span>${label} (${leg.text})</span></span></li>`;

  function dayHTML(d, isLast, canEdit) {
    const sc = d.schedule, rows = sc.stops, first = rows[0], last = rows[rows.length - 1];
    const booked = rows.filter((r) => r.status === "booked").length;
    const sugg = rows.filter((r) => r.status === "suggested").length;
    const sum = rows.length
      ? `${plural(rows.length, "stop")} from ${first.start} to ${last.end}. ${booked} booked${sugg ? `, ${plural(sugg, "suggestion")} to decide on` : ""}.`
      : "Nothing planned yet.";
    let list = "";
    if (rows.length) {
      if (sc.start_leg) list += edgeRow(sc.leave_at, sc.start_leg, d.start_place ? "Leave " + esc(d.start_place) : "Set off");
      rows.forEach((r, i) => { if (i > 0) list += legRow(r); list += stopHTML(r, canEdit); });
      if (sc.back_leg) list += edgeRow(sc.back_at, sc.back_leg, d.end_place ? "Back at " + esc(d.end_place) : "Arrive at the end point");
      if (isLast) list += `<li class="stop tripend"><div class="time"><span class="t">${last.end}</span></div><div class="node" aria-hidden="true">${ico("flag", 16)}</div><div class="te-text"><strong>End of trip</strong><span>${d.long}</span></div></li>`;
    }
    const warn = clashText(sc);
    const tools = canEdit ? `<div class="day-actions">
        <button class="linkbtn" type="button" data-editday="${d.date}" aria-label="Edit day ${d.n}">${ico("edit", 16)}Edit day</button>
        <button class="linkbtn" type="button" data-goboard="${d.date}" aria-label="Rearrange day ${d.n} on the board">${ico("board", 16)}Rearrange</button>
      </div>` : "";
    return `<section class="day" id="day-${d.date}" style="--day:${d.color}" aria-labelledby="dh-${d.date}">
      <header class="day-head">
        <div class="day-top"><p class="day-date">Day ${d.n}, ${d.long}</p>${tools}</div>
        <h2 id="dh-${d.date}">${esc(d.title || "Day " + d.n)}</h2>
        <p class="day-sum">${sum}</p>
        ${warn ? `<p class="warnline">${ico("alert", 16)}<span>${warn}</span></p>` : ""}
      </header>
      ${rows.length ? `<ol class="tl">${list}</ol>` : `<p class="empty">${canEdit ? "No stops on this day yet." : "Nothing planned for this day."}</p>`}
      ${canEdit ? `<button class="addstop" type="button" data-addstop="${d.date}">${ico("plus", 16)}Add stop</button>` : ""}
    </section>`;
  }

  function render() {
    const list = days(), canEdit = ctx.canEdit(), n = ctx.model().ideas.length;
    if (!list.length) {
      nav.innerHTML = "";
      daysEl.innerHTML = `<p class="empty">${canEdit ? "No dates yet. Use Trip settings to set the trip dates." : "Nothing planned yet."}</p>`;
      return;
    }
    if (!list.some((d) => d.date === active)) active = list[0].date;
    nav.innerHTML = list.map(chipHTML).join("");
    daysEl.innerHTML = list.map((d, i) => dayHTML(d, i === list.length - 1, canEdit)).join("")
      + (n ? `<div class="ideas-cta"><p><strong>${plural(n, "idea")}</strong> not on a day yet.</p><button class="btn" type="button" data-goboard="ideas">${ico("board", 16)}${canEdit ? "Place them on the board" : "See them on the board"}</button></div>` : "");
  }

  /* scroll tracking for the day buttons */
  function setActive(date) {
    active = date;
    nav.querySelectorAll(".dchip").forEach((b) => b.setAttribute("aria-current", b.dataset.jump === date));
    const chip = nav.querySelector(`[data-jump="${date}"]`);
    if (!chip) return;
    const behavior = reduce ? "auto" : "smooth";
    if (side.matches) {
      const t = chip.offsetTop, b = t + chip.offsetHeight;
      if (t < nav.scrollTop + 8 || b > nav.scrollTop + nav.clientHeight - 8) nav.scrollTo({ top: t - 16, behavior });
    } else if (nav.scrollWidth > nav.clientWidth) {
      const l = chip.offsetLeft, r = l + chip.offsetWidth;
      if (l < nav.scrollLeft + 8 || r > nav.scrollLeft + nav.clientWidth - 8) nav.scrollTo({ left: l - 16, behavior });
    }
  }
  function spy() {
    if (!ctx.model()) return;
    const list = days();
    if (ctx.view() !== "timeline" || spyLock || !list.length) return;
    const line = (side.matches ? 0 : nav.getBoundingClientRect().bottom) + 48;
    let cur = list[0].date;
    for (const d of list) { const el = document.getElementById("day-" + d.date); if (el && el.getBoundingClientRect().top <= line) cur = d.date; }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = list[list.length - 1].date;
    if (cur !== active) setActive(cur);
  }
  window.addEventListener("scroll", () => { cancelAnimationFrame(spyRaf); spyRaf = requestAnimationFrame(spy); }, { passive: true });
  function scrollToY(top, after) {
    top = Math.max(0, Math.min(top, document.documentElement.scrollHeight - window.innerHeight));
    if (reduce || Math.abs(top - window.scrollY) < 2) { window.scrollTo(0, top); if (after) after(); return; }
    spyLock = true;
    let done = false;
    const fin = () => { if (done) return; done = true; spyLock = false; window.removeEventListener("scrollend", fin); if (after) after(); };
    window.addEventListener("scrollend", fin);
    setTimeout(fin, 1200);
    window.scrollTo({ top, behavior: "smooth" });
  }
  function jumpTo(date) {
    const el = document.getElementById("day-" + date);
    if (!el) return;
    setActive(date);
    scrollToY(el.getBoundingClientRect().top + window.scrollY - barH() + 1);
  }
  function flashStop(id) {
    const li = daysEl.querySelector(`.stop[data-id="${id}"]`);
    if (!li) return;
    li.classList.remove("flash"); void li.offsetWidth; li.classList.add("flash");
  }
  // Scrolls to a stop (already expanded and rendered) and flashes it.
  function revealStop(id) {
    const li = daysEl.querySelector(`.stop[data-id="${id}"]`);
    if (!li) return;
    setActive(ctx.colOf(id));
    scrollToY(li.getBoundingClientRect().top + window.scrollY - barH() - 24, () => flashStop(id));
  }

  nav.addEventListener("click", (e) => { const b = e.target.closest("[data-jump]"); if (b) jumpTo(b.dataset.jump); });
  daysEl.addEventListener("click", (e) => {
    const m = e.target.closest(".card-main");
    if (m) {
      const id = Number(m.closest(".stop").dataset.id);
      if (ctx.openSet.has(id)) ctx.openSet.delete(id); else ctx.openSet.add(id);
      const open = ctx.openSet.has(id);
      m.setAttribute("aria-expanded", open);
      document.getElementById("det-" + id).hidden = !open;
      return;
    }
    const g = e.target.closest("[data-goboard]");
    if (g) { ctx.onGoBoard(g.dataset.goboard); return; }
    const ed = e.target.closest("[data-editday]");
    if (ed) { ctx.onEditDay(ed.dataset.editday); return; }
    const add = e.target.closest("[data-addstop]");
    if (add) { ctx.onAddStop(add.dataset.addstop); return; }
    const a = e.target.closest("[data-act]");
    if (!a) return;
    const id = Number(a.dataset.id);
    if (a.dataset.act === "keep") ctx.onKeep(id);
    else if (a.dataset.act === "ideas") ctx.onToIdeas(id);
    else if (a.dataset.act === "edit") ctx.onEditStop(id);
    else if (a.dataset.act === "late-ok") ctx.onDismissLate(id);
  });

  return { render, spy, flashStop, revealStop };
}
