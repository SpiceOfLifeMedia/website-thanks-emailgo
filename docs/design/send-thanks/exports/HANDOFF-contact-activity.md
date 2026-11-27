# Send, thanks contact activity

These are the Claude Design contact activity exports ported into the real contacts workspace. The app shell and brand assets remain as they were.

## Files

- `ContactActivityPanel.tsx` renders the inline desktop timeline and full-screen phone sheet.
- `contact-activity.module.css` contains the palette, timeline, icon tiles, state layouts, and responsive sheet styling.
- The design source remains in the Claude Design canvas as `SendThanksContactActivity.dc.html` and `Send, thanks Contact Activity.dc.html`.

## Data and behavior

The panel receives only events returned by the authenticated `/api/contacts/{id}/activity` route. It does not create sample records. The API ties sends and delivery events to the contact's exact address, limits opens and clicks to emails with a single recipient, paginates by a stable cursor, and converts known bounce codes to plain text. Unknown codes and unsupported events are omitted.

The timeline uses the existing `email_events`, `delivery_events`, `emails`, `received_emails`, and `contacts` records. Current change history for past name, property, or tag edits is not recorded, so the screen does not imply those edits. It shows contact creation and the current recorded unsubscribe timestamp.

On desktop, Activity expands under the contact row. On phones, it opens a full-screen sheet that locks background scroll, traps focus, closes on Escape, and returns focus to the Activity action. Loading, error, empty, load-more, and all-loaded states are included.

## Validation notes

Run `npm run typecheck`, `npm test`, and `npm run build` after changing either component file. Screenshot examples in `screenshots/` use fictional data only and are for review; the live panel receives app records.
