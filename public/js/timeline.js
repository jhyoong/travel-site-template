// Draws the trip as a list of days, each with its items and,
// for signed-in users, a "+ Add" button.
import { el, clear, safeHref } from "./api.js";
import { buildDays, formatDay, formatTimeRange } from "./dates.js";

// opts: { canEdit, onAdd(date), onEdit(item), highlightId }
// Items show time, title and location. Clicking one expands it to show
// notes, link and (for signed-in users) an Edit button.
export function renderTimeline(container, trip, items, opts) {
  clear(container);
  const days = buildDays(trip, items);
  if (days.length === 0) {
    container.appendChild(el("p", {
      class: "empty",
      text: opts.canEdit ? "No dates yet. Use Edit trip to set the trip dates." : "Nothing planned yet."
    }));
    return;
  }
  days.forEach((day) => container.appendChild(renderDay(day, opts)));
}

function renderDay(day, opts) {
  const label = (day.dayNumber ? "Day " + day.dayNumber + " · " : "") + formatDay(day.date);
  const children = [
    el("h2", { class: "day-heading" }, [
      el("span", { text: label }),
      day.outside ? el("span", { class: "tag", text: "Outside trip dates" }) : null
    ])
  ];
  if (day.items.length) {
    children.push(el("ol", { class: "items" }, day.items.map((item) => renderItem(item, opts))));
  } else if (!opts.canEdit) {
    children.push(el("p", { class: "empty", text: "Nothing planned." }));
  }
  if (opts.canEdit) {
    children.push(el("button", {
      type: "button",
      class: "add-button",
      text: "+ Add",
      "aria-label": "Add event on " + label,
      onclick: () => opts.onAdd(day.date)
    }));
  }
  return el("section", { class: "day" }, children);
}

function renderItem(item, opts) {
  const details = [];
  if (item.notes) details.push(el("p", { class: "item-notes", text: item.notes }));
  const href = safeHref(item.link);
  if (href) {
    details.push(el("p", { class: "item-link" }, [
      el("a", { href, target: "_blank", rel: "noopener noreferrer", text: href })
    ]));
  }
  if (opts.canEdit) {
    details.push(el("div", { class: "item-actions" }, [
      el("button", { type: "button", class: "secondary", text: "Edit", onclick: () => opts.onEdit(item) })
    ]));
  }
  const summary = [
    el("span", { class: "item-title", text: item.title || "" }),
    item.location ? el("span", { class: "item-location", text: item.location }) : null
  ];
  const time = el("div", { class: "item-time", text: formatTimeRange(item.start_time, item.end_time) });
  const highlight = item.id === opts.highlightId;
  const li = el("li", { class: "item" + (highlight ? " highlight" : ""), "data-id": item.id });

  // Nothing to expand: a plain card with time, title and location.
  if (details.length === 0) {
    li.append(time, el("div", { class: "item-card" }, [el("div", { class: "item-summary" }, summary)]));
    return li;
  }

  // Clicking anywhere on the row (except inside the details) expands it to
  // show notes, link and the Edit button. The summary is a real button, so
  // keyboard and screen reader users get the same toggle.
  const toggle = el("button", { type: "button", class: "item-summary" }, summary);
  const panel = el("div", { class: "item-details" }, details);
  function setOpen(open) {
    toggle.setAttribute("aria-expanded", String(open));
    panel.hidden = !open;
    li.classList.toggle("expanded", open);
  }
  li.classList.add("expandable");
  li.append(time, el("div", { class: "item-card" }, [toggle, panel]));
  li.addEventListener("click", (ev) => {
    if (ev.target.closest(".item-details")) return;
    setOpen(panel.hidden);
  });
  // A just-saved item opens expanded so its changes are visible.
  setOpen(highlight);
  return li;
}
