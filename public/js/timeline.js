// Draws the trip as a list of days, each with its items and,
// for signed-in users, a "+ Add" button.
import { el, clear, safeHref } from "./api.js";
import { buildDays, formatDay, formatTimeRange } from "./dates.js";

// opts: { canEdit, onAdd(date), onEdit(item), highlightId }
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
  const card = [el("h3", { class: "item-title", text: item.title || "" })];
  if (item.location) card.push(el("p", { class: "item-location", text: item.location }));
  if (item.notes) card.push(el("p", { class: "item-notes", text: item.notes }));
  const href = safeHref(item.link);
  if (href) {
    card.push(el("p", { class: "item-link" }, [
      el("a", { href, target: "_blank", rel: "noopener noreferrer", text: href })
    ]));
  }
  const li = el("li", {
    class: "item" + (item.id === opts.highlightId ? " highlight" : ""),
    "data-id": item.id
  }, [
    el("div", { class: "item-time", text: formatTimeRange(item.start_time, item.end_time) }),
    el("div", { class: "item-card" }, card)
  ]);
  if (opts.canEdit) {
    // The whole row opens the editor. Clicks on the item's link still
    // open the link. Keyboard users can Tab to the row and press Enter.
    li.classList.add("editable");
    li.tabIndex = 0;
    li.title = "Click to edit";
    li.addEventListener("click", (ev) => {
      if (ev.target.closest("a")) return;
      opts.onEdit(item);
    });
    li.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && ev.target === li) {
        ev.preventDefault();
        opts.onEdit(item);
      }
    });
  }
  return li;
}
