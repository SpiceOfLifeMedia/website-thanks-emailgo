# Automation failed run recovery

The design was created in the [Email, thanks Claude Design project](https://claude.ai/design/p/4e50820b-1ab2-45da-bd4c-3d8e8642dd94), in `automation-failed-run-retry/`. The React component and CSS module below were copied from Claude's export and integrated in `src/components/`.

## Implemented behavior

The Automation workspace shows event, contact, run and step history. Each step groups its attempts in order and keeps earlier failure messages visible. Retrying resumes from the failed step, retaining steps that already completed.

`POST /api/v1/automations/{id}/runs/{runId}/retry` and the admin dashboard route `POST /api/automations/{id}/runs/{runId}/retry` queue a retry. Email steps require `confirm_send_retry: true`, which the UI only sends after the operator acknowledges possible duplicate delivery. The retry endpoint remains scoped to the API key's automation and run.

## Saved exports

- `export/AutomationRunRetry.tsx`: Claude's React component with an inline retry error state for dashboard network failures and suppressed hydration warnings for locale-formatted dates.
- `export/send-thanks-automation-run-retry.module.css`: Claude's responsive Website, thanks styles.
- `screenshots/automation-run-retry-desktop-1440x1000.png`: local render of the integrated component with fictional run data.
- `screenshots/automation-run-retry-phone-390x844.png`: phone-sized local render focused on the duplicate-risk confirmation.

The Claude project's prototype HTML and its original screenshots remain in Claude Design. The in-app preview did not materialize the ZIP in the workspace, so those original files are not included here; these PNGs are fresh captures of the integrated component instead.

## Verification

Claude Design checked its prototype at 1440 × 1000 and 390 × 844 for horizontal overflow, target sizes, duplicate-risk confirmation, Escape handling and class mapping. The local app render was captured at 1440 × 1000 and 390 × 844; both viewport widths had no horizontal overflow, and the send retry button stayed disabled until acknowledgment. `npm run check` passed, including TypeScript, all 147 tests and the production build. A screen-reader review remains outstanding.
