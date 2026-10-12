# Manual checklist for the page

The page has no automated tests. Work through this list in a browser after changes to `public/`.

## Setup

This uses the local dev database in `.wrangler/state`. If it still has tables from the earlier version, reset it. This deletes your local dev data. (The test database in `.wrangler/test-state` is separate.)

```bash
npx wrangler d1 execute itinerary-db --local --command "DROP TABLE IF EXISTS items; DROP TABLE IF EXISTS stops; DROP TABLE IF EXISTS days; DROP TABLE IF EXISTS audit_log; DROP TABLE IF EXISTS trip;"
npx wrangler d1 execute itinerary-db --local --file=schema.sql
```

Start the dev server with `npx wrangler dev` (needs `.dev.vars` with `API_KEYS`; see the README). Open http://localhost:8787 and keep the browser console open. It should stay free of errors.

Enter all data through the page. Don't seed the database.

## Signed in, desktop width

- [ ] Sign in, then fill in trip setup (name, dates, timezone, travellers). The header shows the date range and travellers.
- [ ] "Add stop" on Day 1: create a few stops with different types, durations and a fixed start time. Times appear and follow on with travel legs.
- [ ] Location box: "35.0089, 135.77" saves. A full Google Maps place URL saves. A `maps.app.goo.gl` link shows the short-link error. "Kyoto" shows the hint error.
- [ ] Edit day: set a title, start time, and start/end place with locations. "Leave ..." and "Back at ..." legs appear.
- [ ] A fixed time that can't be reached shows the red late note, the day warning and the chip's clash count.
- [ ] Expand a card: notes, booking details, Maps link, link and Edit button show. Edit changes the stop. Delete needs two clicks.
- [ ] Set a stop to Suggestion. "Add to plan" and "Move to ideas" work, and Undo reverts each.
- [ ] Board: drag within a day, across days, to and from Ideas. Times update at once and stay after a reload. Undo puts the stop back with its old status.
- [ ] Board: a booked stop can't be dropped on another day (the column fades and a toast explains).
- [ ] Board: tap a grip to open the move menu. Arrow keys, Enter and Escape work.
- [ ] Board: add an idea, and Undo removes it. Clicking an idea card opens the edit dialog. Clicking a day card jumps to it in the timeline.
- [ ] Recent changes lists adds, edits, moves, deletes, trip and day updates with names.
- [ ] Trip settings: shortening the dates past a stop shows the server's error in the dialog.
- [ ] Reloading with `#board` in the URL opens the board.

## Phone width (devtools, 390px)

- [ ] The view switch sits at the bottom. Dialogs open as bottom sheets.
- [ ] Board columns snap. Dragging works with touch emulation.
- [ ] A long title wraps instead of overflowing.

## Public view

- [ ] Stop the server, run `npx wrangler dev --var VIEW_PUBLIC:true`, and log out. Both views show, with no grips, edit buttons, add buttons or suggestion buttons. "Sign in to edit" shows.

## Afterwards

Run `bash test/run.sh`. It should end with `==> All test passes succeeded.`
