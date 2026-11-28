# Email, thanks broadcast metadata integration

The Claude Design export is preserved in `export/`. The app copies the exported component and CSS into `src/components/` and keeps the existing `reply_to` and `preview_text` draft fields, API payload, and database columns.

The composer places the optional details row after Subject and before audience selection and email content. The desktop form uses a two-column grid, so the host passes `broadcastMetadata` to make the fieldset span the full row. The app copy of the CSS adds a higher-specificity control rule because the existing composer has broad input styles; the original Claude export remains unchanged.

The component validates each field after blur. Before saving a draft, saving from the visual editor, queueing, or scheduling, the workspace validates both fields, shows the inline error, and blocks the request until the value is corrected. The format check is client-side feedback; the API remains the authority for persisted values.

The screenshots in `../screenshots/` show the Claude Design composer prototype at 1440 × 1000 and 390 × 844. The local application had no development environment configured for an authenticated workspace, so the screenshots are design previews rather than a live account capture.
