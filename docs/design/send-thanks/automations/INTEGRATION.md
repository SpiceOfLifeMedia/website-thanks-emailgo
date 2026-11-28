# Email, thanks automation canvas integration

The Claude Design source, prototype, archive, handoff and reference screenshots are saved in this directory. The application component is `src/components/SendThanksAutomationCanvas.tsx`, integrated by `src/components/automation-workspace.tsx`.

## Application behaviour

The canvas edits the existing automation step and connection model. It exposes trigger, condition, delay, wait-for-event, template email, contact update and segment actions. Condition branches can be added and connected from labelled true and false branches. All actions have keyboard controls. The layout switches to a single column below 1040 pixels.

Saving sends the workflow name, steps and connections to the existing dashboard API. Position offsets are stored under `step.config.__sendThanksCanvas`; the existing validator preserves unknown config fields, so no database schema or API route changed. The canvas displays that positions persist only after the save and reload test passes.

Saving never starts a workflow. Activation stays disabled while the draft is unsaved or invalid. The user must save first, press Activate, then confirm. The existing list-level Start action also asks for confirmation. Active definitions remain immutable until paused, matching the server rule.

The contact update editor applies valid JSON objects only. Invalid JSON is shown inline and blocks saving until corrected or the step is removed. Condition fields and operators follow `validCondition()` in `src/lib/automations.ts`.

## Validation

On 28 November 2026, `npm run check` passed TypeScript, all 114 Node tests, and the optimized Next.js production build. The new `tests/automation-canvas.test.mjs` test validates a two-branch definition, rejects a condition path outside the server schema, and confirms canvas offsets plus unknown step configuration survive a save and reload. `git diff --check` passed.

The exported Claude Design screenshots are prototype references with fictional workflow data. The repository also retains the separate rendered application screenshots linked from PR #8. No live app, production mail settings, provider configuration, DNS, deployment, or external service was changed for this integration.

## Remaining limits

The editor has no drag-and-drop gestures. Failed automation runs still have no retry or resume endpoint, and contact-delete actions are not implemented. The canvas does not replace the server validator; it reports server validation failures when saving.
