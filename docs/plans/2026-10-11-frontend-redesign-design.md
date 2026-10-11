# Frontend Redesign: Design

## Problem
- Adding an event takes too many steps. View and edit are separate pages, the add form is at the top of `/edit` with no default date, and editing an item scrolls you back to that form.
- First-time setup feels unpolished. A new deploy shows "Untitled trip" and a plain form with a free-text timezone field.

## Goals
- Add an event in as few steps as possible, on both phone and desktop.
- A clear, guided first-time setup.
- Refresh the visual style.
- Keep the current constraints: plain HTML, CSS and JS, no framework, no build step.
- No API or database changes.

## Decisions
- One page (`index.html`) for viewing and editing. `/edit.html` redirects to `/`.
- Each day has a "+ Add" button that opens a form with the date already set.
- First-time setup is a single screen.
- JS is split into small native ES modules (`<script type="module">`).
- The add/edit form uses the native `<dialog>` element.
- Testing is a manual checklist. The existing API tests must still pass.

## Page states
`index.html` shows one of four states, based on the key and the trip data:

1. **Sign in.** No key is stored, or the stored key was rejected. This is a centered card with the key input. If `VIEW_PUBLIC=true` and there is no key, skip to state 4 as read-only, with a "Sign in to edit" link in the top bar. In that case the sign-in card also has a **Back to itinerary** button.
2. **Setup.** Signed in, and the trip has no name or no dates. A centered card with:
   - Trip name
   - Start date and end date (the end date can't be before the start date)
   - Timezone: a searchable dropdown from `Intl.supportedValuesOf("timeZone")`, defaulting to the browser's timezone
   - A "Create trip" button that saves with `PUT /api/trip`, then shows state 4
3. **Loading or error.** A simple message.
4. **Itinerary.** The main view. Read-only visitors see the same view without edit controls.

Everything stays on one URL, so there is no client-side routing.

## Itinerary layout

**Header**
- Trip name, date range, and "Times in <timezone>".
- Signed-in users see an **Edit trip** button. It opens the setup form in a dialog, pre-filled with the current trip.
- Top bar: signed-in name, **History**, **Log out**.

**Day list**
- Every day from the start date to the end date is shown, including empty days. Each header shows "Day N · Wed 14 Oct". Headers stick to the top while scrolling.
- Items outside the trip dates appear in their own day groups with an "Outside trip dates" label.
- Item row: the time on the left (or "All day"), the title on the right, and location, notes and link below. On phones, the time sits above the title.

## Adding and editing (signed in only)
- Each day ends with a **+ Add** button. It opens the item dialog with the date set and the cursor in the title field.
- Items show the time, title and location. Click or tap an item to expand it and show its notes, link and an **Edit** button. **Edit** opens the same dialog, filled in. A just-saved item is shown expanded.
- Dialog fields, in order: title, start time, end time, then location, notes, link and date. The date field lets you move an item to another day.
- Dialog buttons:
  - **Save**. Pressing Enter in a single-line field also saves.
  - **Save and add another** (when adding only). Keeps the dialog open with the same date.
  - **Cancel**. Esc also closes the dialog.
  - **Delete** (when editing only). Clicking it turns it into "Confirm delete" instead of using `confirm()`.
- After a successful save, reload the itinerary and briefly highlight the changed item.

## History
- The **History** button opens recent changes (`GET /api/audit?limit=50`) in a side panel on desktop, or a full-screen sheet on phones.
- It loads only when opened.

## Files
```
public/index.html        only page: markup for every state, the dialogs and the history panel
public/edit.html         redirect to /
public/js/api.js         key storage, api(), el(), formatters (moved from common.js)
public/js/app.js         startup: picks the page state and wires up the other modules
public/js/setup.js       setup / edit-trip form, timezone list
public/js/timeline.js    builds the day list and the "+ Add" buttons
public/js/item-dialog.js add/edit dialog, save, delete
public/js/history.js     history panel
public/style.css         rewritten
```
`public/common.js` is removed. `src/worker.js` stays the same, because the assets binding already serves `public/js/*`.

## Visuals
- System font stack and one accent colour. The palette is set with CSS variables, with dark mode via `prefers-color-scheme`.
- Day groups use a timeline layout: a time column, then a thin vertical line, then an item card.
- Tap targets are at least 44px. The layout is a single column under 640px.
- `<dialog>` is a centered modal on desktop and slides up from the bottom on phones.

## Error handling
- A 401 from any request clears the key and returns to sign-in.
- Save and delete errors appear inside the dialog, and the user's input is kept.
- Load errors appear at the top of the page.
- Buttons are disabled while a request is in progress, so a double click can't create a duplicate.

## Testing
- `bash test/run.sh` must still pass.
- Manual checklist, run in a browser against `wrangler dev`, at desktop and phone widths:
  - [ ] Sign in with a valid key, a wrong key, and an empty key
  - [ ] Fresh database shows the setup screen, and the timezone defaults to the browser's
  - [ ] Setup rejects an end date before the start date
  - [ ] Creating the trip shows every day in the range, all empty
  - [ ] "+ Add" opens the dialog with the correct date and the cursor in the title
  - [ ] Enter saves; Esc cancels
  - [ ] "Save and add another" keeps the dialog open with the same date
  - [ ] Clicking an item expands it (notes, link, Edit); clicking again collapses it
  - [ ] Edit opens the item in the dialog; changing the date moves it
  - [ ] Delete needs a second click to confirm
  - [ ] An API validation error (e.g. end time before start time) shows in the dialog and keeps the input
  - [ ] Items outside the trip dates show with the "Outside trip dates" label
  - [ ] Edit trip updates the header and the day range
  - [ ] History panel lists recent changes
  - [ ] `VIEW_PUBLIC=true` with no key: read-only view, no edit controls, "Sign in to edit" works, and "Back to itinerary" returns to the read-only view
  - [ ] Revoked key mid-session returns to sign-in
  - [ ] `/edit.html` redirects to `/`
  - [ ] Dark mode looks correct
