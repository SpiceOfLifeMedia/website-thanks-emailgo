# Send, thanks: automation canvas handoff

This package is new and lives in `automations/`. No other project file was changed. It's front-end only: saving and activating are callbacks, and nothing runs in the design.

## Files
- `automations/SendThanksAutomationCanvas.dc.html`: the live prototype, with fictional data and five frames:
  - a1a: desktop 1440 × 1000, condition selected
  - a1b: desktop, validation errors plus the activation confirmation
  - a1c: desktop, empty workflow (trigger only)
  - a2a: phone 390 × 844, a step selected
  - a2b: phone, validation errors
- `automations/export/SendThanksAutomationCanvas.tsx`: the controlled `'use client'` component, plus pure graph helpers. No new dependencies.
- `automations/export/send-thanks-automation-canvas.module.css`
- `automations/screenshots/`:
  - `canvas-desktop-1440x1000.png`
  - `canvas-desktop-validation-confirm.png`
  - `canvas-desktop-empty.png`
  - `canvas-phone-390x844.png`
  - `canvas-phone-validation.png`

## Model: unchanged
`AutomationStep { key, type, config }` and `AutomationConnection { from, to, condition?: 'true' | 'false' }` are copied exactly from `lib/automations.ts`.
- **Step types:** trigger, condition, delay, wait_for_event, send_email, contact_update and add_to_segment.
- **Inspector fields:** the inspector edits only the known config fields, writing them with `setPath`. Every other config key, including unknown ones, is kept exactly as it was.
- **condition:** edits `config.field`, the exact key `validCondition()` reads, under the label "Contact field". The server requires the field to start with `contact.`, `event.` or `wait_events.`. The fixture therefore uses `contact.properties.plan`; a bare `properties.plan` fails `validCondition()`. **Operator** is a select limited to the 11 server operators: eq, neq, gt, gte, lt, lte, contains, starts_with, ends_with, exists and is_empty (exported as `OPERATORS`). Value isn't needed for exists or is_empty.
- **contact_update:** an accessible JSON editor for `config.updates`, with a label, a hint and `aria-describedby`.
  - Valid JSON objects are applied with `{ ...config, updates }`, so other config keys are kept.
  - Malformed JSON, or anything that isn't an object, shows an inline `role="alert"` message and is **not** applied.
  - The server still checks the allowed keys (name, properties, tags).

## Props
- **Data:** `name`, `status`, `steps`, `connections` and `selectedKey`.
- **Draft and checks:** `saveState` (`saved` | `unsaved` | `saving` | `error`), `savedAtLabel`, `issues: { stepKey?, message }[]`, `activation` (`idle` | `confirming` | `activating`), `positionsPersist` and `layout`.
- **Callbacks:**
  - `onNameChange`, `onSelect`
  - `onAddStep(type, afterKey, branch?)`, `onRemoveStep`
  - `onConfigChange(key, config)`, `onConnectionsChange(connections)`
  - `onPositionChange(key, meta)`
  - `onSaveDraft`
  - `onRequestActivate`, `onConfirmActivate`, `onCancelActivate`
- **Helpers you can use inside the callbacks:**
  - `insertStep`: inserts a step after another one, and keeps the old next step after it.
  - `removeStep`: removes a step and reconnects the gap if it had a single next step.
  - `moveEarlier`: swaps a step with the one before it by rewiring connections. It returns null where that isn't safe.
  - `setPath`, `outgoing` and `canvasMeta`.

Run your existing `parseAutomationDefinition` and pass its error back as `issues`. The server stays the authority on validation.

## Saving and activating
- **Save draft** calls `onSaveDraft` only. The note "Save draft only saves. Nothing runs until you activate." is always visible.
- **Activate:**
  - Disabled while there are issues.
  - Clicking it calls `onRequestActivate`. Set `activation='confirming'` to show the confirmation.
  - **Activate workflow** calls `onConfirmActivate`; **Keep as draft** calls `onCancelActivate`.
- **Not included:** retry and resume controls, on purpose.

## Canvas position and its persistence limit
- **Where it lives:** position is stored only in `step.config.__sendThanksCanvas = { dx, dy }`. These are offsets in pixels from the automatic layout, limited to ±240 horizontally and ±120 vertically. They never change how the workflow runs.
- **Will it persist?** `parseAutomationDefinition` currently keeps the whole `config` object, so the field should survive a save. That hasn't been tested end to end, though.
- **What the UI says until then:** while `positionsPersist` is false (the default), the inspector says "Position is for this session only. It isn't saved yet." Set it to true only after you've confirmed a saved draft reloads with the offsets.

## Keyboard alternatives for every canvas action
| Action | How |
| --- | --- |
| Select | Each card is a button |
| Add | The palette buttons add after the selected step; the "+ Add step" button sits at the end of each path |
| Build an empty branch | Each empty If true / If false branch has its own Step type select and an "Add step to If true/false" button, which calls `onAddStep(type, conditionKey, branch)` |
| Connect a branch | "If true, go to" and "If false, go to" selects |
| Connect the next step | The "Next step" select |
| Reorder | Move earlier |
| Move | Left, Up, Down, Right and Reset buttons, or Alt + arrow keys on a focused card |
| Remove | Remove step |

Nothing depends on dragging.

## Responsive behaviour
- **Desktop:** the palette (200px), canvas (solid paper `#F4EEE3`, no texture) and inspector (340px) sit side by side. Condition branches split into labelled columns, If true (basil) and If false (chalk, dashed). Controls are 44px.
- **Phone (`layout="mobile"`):**
  - One column: header, canvas as a stacked list with each branch in its own labelled card, the inspector right after the canvas, then the palette as a 2-column grid.
  - Controls are 52px and position nudging is hidden.
  - Text wraps anywhere, so nothing scrolls sideways.

## Checked
- **TSX:** `SendThanksAutomationCanvas.tsx` parses with no errors through the TypeScript 5.4 transpiler.
- **CSS:** every `styles.*` class the TSX uses exists in the CSS module.
- **Graph helpers:** `insertStep`, `removeStep` and `moveEarlier` were run on sample connections and gave the expected edges.
- **Server schema:** `validCondition` and `validContactUpdates` were copied from `src/lib/automations.ts` and run on the outputs.
  - `{ field: 'contact.properties.plan', operator: 'eq', value: 'pro' }` passes, and so does `exists` with no value.
  - The old `properties.plan` fails.
  - The fixture updates `{ tags: ['trial-nudge'] }` pass, and an unknown key such as `tag` fails.
- **Building both branches:** `insertStep(…, conditionKey, 'true')` and then `'false'` gave `{from:cond,to:yes1,condition:'true'}` and `{from:cond,to:no1,condition:'false'}`. The existing `start → cond` connection stayed, and an unknown config field on the new step was kept.
- **No gradients:** none in the TSX, the CSS or the prototype.
- **Prototype frames:** desktop is 1440 × 1000 and phone is 390 × 844, each plus a 2px border. Nothing extends past the right edge, and all header, inspector and palette controls are at least 44px on desktop and 52px on phone.

## Not checked
- A full type-check against your app's React types and `tsconfig`.
- Rendering inside the Next.js app.
- An end-to-end save and reload of `__sendThanksCanvas`.
- Running the full `parseAutomationDefinition` on drafts produced by the component; only `validCondition` and `validContactUpdates` were run.
- **JSON editor:** it doesn't check allowed keys itself, so an object with unsupported keys is applied and then rejected by the server on save.
- **Prototype limit:** a nested condition can’t be added inside a branch in the prototype. The exported component allows it, and the new condition starts with no outgoing connections.
- **Screenshots:** they’re rendered from the page structure and may show a dropdown’s first option rather than its live value. In the live prototype the dropdowns show the right value.
