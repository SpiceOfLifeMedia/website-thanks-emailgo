# Automation run retry component

This component replaces the run history block in `AutomationWorkspace` and calls the dashboard retry route. It does not retry a step on its own.

The dashboard calls `POST /api/automations/{id}/runs/{runId}/retry`. The public API equivalent is `POST /api/v1/automations/{id}/runs/{runId}/retry`. Both resume the failed run at its current failed step. Completed steps remain complete, and each retry is retained as a new attempt with its status and error.

For `send_email`, the dashboard sends `confirm_send_retry: true` only after the operator checks the duplicate-risk acknowledgment. The server also rejects unconfirmed retries. The mail handoff may have succeeded before the recorded failure, so a retry can deliver a duplicate.

`AutomationRunRetry.tsx` and `send-thanks-automation-run-retry.module.css` are the design source used by the app integration. The root `HANDOFF.md` records the design project link, screenshots and verification details.
