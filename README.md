# Send, thanks

Send, thanks is an independent email delivery API and workspace for Website Thanks. It owns the API keys, sender domain verification, request validation, message log and dashboard. Outbound transport is configured through standard SMTP credentials.

## What works

- Admin password sign in with signed, HTTP only sessions.
- Create and revoke Send, thanks API keys. Only key hashes are stored, and a new secret is shown once. Keys support full access or sending-only access restricted to a verified sender domain. Full-access keys can also list, create, inspect, rename and revoke keys through `/api/v1/api-keys`.
- Add sender domains, verify ownership through a DNS TXT record, and inspect SPF, DMARC and MX records. DKIM is provided by the selected SMTP relay.
- Send transactional emails through the Send, thanks API using a configured SMTP relay.
- Persist message metadata and text or HTML bodies in PostgreSQL in production and SQLite during local development. Encoded attachment bytes are removed after scheduled sends complete and are not retained for immediate sends. Retention windows and self-service message deletion are not implemented yet.
- Filter recent message activity and inspect relay failures.
- Shared-workspace API limit of 10 requests per second, a 1 MB request body limit, and 24-hour idempotency keys to prevent accidental duplicate sends. Authenticated `/api/v1` responses include `ratelimit-limit`, `ratelimit-remaining`, and `ratelimit-reset` (seconds); a `429` also includes `retry-after`.
- Authenticated `GET /api/v1/emails` and `GET /api/v1/emails/:id` endpoints for message history.
- To, Cc, Bcc, reply-to, custom headers, tags, base64 attachments, reusable versioned templates with draft/publish, aliases, variables, and batch sends.
- Workspace contacts with properties, tags, explicit opt-in source and recorded time. New contacts default to unknown consent. Unsubscribe state is separate and preserved during imports.
- Optional domain-level open and link tracking, disabled by default, with authenticated event retrieval.
- Full-access API and dashboard webhook management with signed event delivery, secret rotation, bounded retries, attempt history and replay. Events include Send, thanks activity, provider-bridged inbound email and verified delivery outcomes when a compatible event source is configured.
- A full-access usage endpoint reports message and resource counts. It does not enforce paid plan quotas because Send, thanks has no billing or plan system.
- Docker image designed for a persistent `./data` volume.

SMTP credentials are only sent over TLS. Port 587 requires STARTTLS; port 465 uses implicit TLS. SMTP acceptance is recorded as `sent`. A signed notification endpoint can later update a message to `delivered`, `deferred`, `bounced` or `complained`; no external event source is configured by this repository.

Open and click tracking are separate from transport delivery events. Configure `EMAILGO_PUBLIC_URL` and an independent `EMAILGO_TRACKING_SECRET`, then enable tracking per verified domain. Send, thanks records event time and clicked URL domain and path, not the recipient's IP address, location or device. Open pixels can be blocked or prefetched by mail clients, so an open is an approximate signal. Custom tracking domains and bounce, complaint or delivery events still require additional infrastructure.

## Run locally

Requires Node.js 24 or later.

```sh
cp .env.example .env.local
# Fill in unique admin/session secrets and SMTP relay settings.
npm install
npm run dev
```

Open `http://localhost:3000`. The SQLite database is created under `./data`. Without admin secrets, the app shows first-run setup. Without SMTP settings, API requests are safely recorded as failed and no email is delivered.

## API

The repository includes a dependency-free Node.js client, a shell-friendly CLI, and an OpenAPI document at `GET /api/v1/openapi.json`. Run `npm run send-thanks -- --help` to see CLI commands. Set `EMAILGO_BASE_URL` and `EMAILGO_API_KEY` in your local shell; the CLI reads the key from the environment and does not save it to a profile file. These tools cover the API currently implemented in this repository. The SDK is source-only and is not published to npm.

### Local MCP server

Send, thanks can run as a local Model Context Protocol server over stdio. Set `EMAILGO_API_KEY` in the MCP host's process environment, optionally set `EMAILGO_BASE_URL` (defaults to `http://localhost:3000`), and start `npm run send-thanks-mcp`. Standard output is reserved for the MCP protocol. The server exposes tools for email, domains, contacts and imports, segments, topics, templates, broadcasts, automations, events, webhooks, suppressions, usage, request logs, CSV exports, and inbound attachments. Sending and state changes run only when the connected user or agent calls the matching tool; destructive tools require `confirm: true`, and broadcasts require `confirm_send: true`. Tool results remove provider names and hostnames, API keys, and signing secrets. Inbound attachment downloads are limited to 4 MiB and return file contents to the agent. API-key management, bearer share links, webhook secret rotation, and remote HTTP MCP hosting are not exposed.

Full-access keys can inspect API request logs with `GET /api/v1/logs` and `GET /api/v1/logs/{log_id}`. Requests that authenticate successfully receive an `x-request-id` header matching the log ID. Bodies are capped at 64 KiB and sanitized before persistence: recipient addresses, names, message content, attachments, headers, contact properties, and credentials are redacted; only the sender domain is retained. Request and response headers are not stored. Non-JSON bodies are omitted, and bodies larger than the cap are marked truncated. The dashboard supports status and ID/endpoint search, detail views, and filtered CSV export. Logs currently have no automatic retention policy.

Full-access keys can stream CSV from `GET /api/v1/exports?resource=...` for `emails`, `received_emails`, `broadcasts`, `contacts`, `domains`, `logs`, and API key metadata. Add `search` for a text filter; `status` filters emails or broadcasts by status, and logs by `errors`, `success`, or an HTTP code. Email, received email, and broadcast rows are scoped to the authenticated key. The other resources are workspace-wide. Exports omit email bodies, attachment bytes, API log bodies, domain verification tokens, and API key secret material. CSV cells are escaped against spreadsheet formula execution. Export generation streams 500 rows at a time, but runs synchronously and does not create a durable export job or download link. Use `client.exports.csv({ resource: 'contacts', search: 'example.net' })` in the Node SDK, or `npm run send-thanks -- exports download --resource contacts --output ./contacts.csv` in the CLI.

`GET /api/v1/usage` reports current daily and monthly sent/received counts, contacts, segments, broadcasts, domains and automation runs, with UTC reset times. This self-hosted app does not have subscription plans, billing quotas, or AI credits, so quota limits are reported as `null`. Its `/api/v1` limit is a shared 10 requests per second across API keys in the single workspace. Authenticated `/api/v1` responses expose `ratelimit-limit`, `ratelimit-remaining`, and `ratelimit-reset` in seconds; `429` responses include `retry-after`.

Create a key in **API keys**, verify a domain in **Domains**, then send:

```sh
curl -X POST http://localhost:3000/api/v1/emails \
  -H 'Authorization: Bearer st_live_your_key' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-123-confirmation' \
  -d '{"from":"hello@example.com","to":"person@example.net","subject":"Hello","text":"Sent with Send, thanks."}'
```

The `from` domain must be verified. Provide `text`, `html`, or both. If you provide HTML without `text`, Send, thanks generates a plain-text version; set `text` to an empty string to omit that version. An `Idempotency-Key` makes retries safe for 24 hours. Reusing it with different content returns 409. A `to` value can be one address or an array of up to 50 addresses. Invalid keys receive 401, unverified domains receive 403, and SMTP delivery errors receive 502.

List the latest messages with optional pagination:

```sh
curl 'http://localhost:3000/api/v1/emails?limit=20' \
  -H 'Authorization: Bearer st_live_your_key'
```

Follow `next_after` as the `after` query parameter to load the next page. Use `before` with the first ID on a page to navigate back toward newer messages; the response returns `next_before` when more results remain in that direction. Cursors are scoped to the API key. Retrieve one message with `GET /api/v1/emails/{email_id}` to read its stored text and HTML body. The authenticated dashboard also provides searchable and filterable message history through `/api/emails` and opens a sandboxed HTML preview from the message detail view.

Create a temporary read-only preview link for a sent or received email with `POST /api/v1/emails/{email_id}/share` and an optional `expires_in` value such as `10m`, `2 hours`, or `1 day`. Links default to 48 hours and cannot last longer. The returned URL is a bearer link: anyone who has it can view the sender, visible recipients, subject and message body until it expires. Bcc and attachment files are never included. Keep the URL private. Revoke a link with `DELETE /api/v1/emails/{email_id}/share/{share_id}`. Sharing requires a full-access API key and a canonical `EMAILGO_PUBLIC_URL`; the CLI exposes `emails share` and `emails unshare`, and the Node SDK exposes `emails.share()` and `emails.revokeShare()`. The token stays in the URL fragment and is submitted to the view endpoint in a POST body so it does not appear in the page request path.

Full-access API keys can manage sender domains with `GET` and `POST /api/v1/domains`, `GET`, `PATCH` and `DELETE /api/v1/domains/{domain_id}`, `POST /api/v1/domains/{domain_id}/verify`, and `GET /api/v1/domains/{domain_id}/dns`. Verification performs a live DNS TXT lookup. Delete is rejected while active domain-scoped sending keys still reference the domain.

Send multiple messages in one request, up to 100 per batch:

```sh
curl -X POST http://localhost:3000/api/v1/emails/batch \
  -H 'Authorization: Bearer st_live_your_key' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-123-receipts' \
  -d '[{"from":"hello@example.com","to":"one@example.net","subject":"First","text":"Hello."},{"from":"hello@example.com","to":"two@example.net","subject":"Second","text":"Hello."}]'
```

The batch counts as one API request toward the per-key request limit and processes at most five SMTP deliveries at a time. The response `data` array stays in request order. If a message fails, its entry includes `http_status` and a generic error; the top-level `has_failures` flag is true. The endpoint also accepts the legacy `{ "emails": [...] }` wrapper. Use an idempotency key when retrying. This is synchronous SMTP delivery, so it does not provide a durable queue, background retries or delivery events.

To schedule a message, `scheduled_at` accepts a future ISO 8601 timestamp or a supported natural time such as `in 5 minutes`, `tomorrow at 9am`, or `Friday at 3pm ET`. Calendar expressions without a zone use UTC. Scheduling is limited to 30 days ahead. The protected `/api/internal/worker` route drains due jobs and retries SMTP failures twice with backoff. Scheduled messages can be moved with `PATCH /api/v1/emails/{email_id}` or canceled with `POST /api/v1/emails/{email_id}/cancel`. Vercel runs the worker from `vercel.json`; configure a random `CRON_SECRET` in the production environment before deployment. Vercel Cron invokes production deployments only, and its effective frequency depends on the account plan. For local or Docker use, call the worker route from a scheduler and provide the same bearer secret. Use durable PostgreSQL or a persistent SQLite volume so queued messages survive restarts.

Use `template: { id, variables }` to send a published template by ID or alias. Template sends use the published version, apply fallback values, and reject missing variables. Double-brace variables in HTML are escaped; triple-brace variables are inserted as authored. The legacy `template_id` field remains supported for existing dashboard workflows. Manage templates with `/api/v1/templates` or the Templates page in the dashboard. List responses contain metadata; retrieve a template by ID or alias for its content, and use `/api/v1/templates/{id}/versions` to read version history. Existing templates migrate as published snapshots so saved content keeps sending. The Templates workspace also offers a visual block editor with a sandboxed preview and editable HTML source; its validated design model is stored with template versions and can be used by broadcast drafts.

`GET /api/v1/emails/metrics` supports date ranges, time zones, hourly/daily/weekly/monthly buckets, domain/email/broadcast grouping, and corresponding ID filters. Results are scoped to the authenticated API key. Each query is limited to 50,000 matching emails, tracking events and delivery events; narrow the range or ID filters if it returns `413`. Available metrics include `received`, `sent`, `failed`, `suppressed`, `delivered`, `delivery_delayed`, `bounced`, `complained`, `opened`, `unique_opened`, `clicked`, and `unique_clicked`. `sent` means the configured relay accepted the message, not recipient-server delivery. Delivery metrics count recipient outcomes from signed notifications; they are empty until a compatible event source is configured. Bounce subtypes, unsubscribes and derived rates remain unavailable and return `422` when requested.

`GET /api/v1/segments/metrics` returns point-in-time contact counts for `all_contacts`, `subscribers`, and `unsubscribers`, optionally grouped by saved segment or filtered by `segment_id`. Segment membership honors live filters and manual exclusions.

Contacts can also be managed with `GET` and `POST /api/v1/contacts`, plus `GET`, `PATCH` and `DELETE /api/v1/contacts/{contact_id}`. Full-access Send, thanks keys support pagination, names, tags, custom properties, consent status and unsubscribe state. New contacts default to `consent_status: unknown`; recording `opted_in` requires a `consent_source` and the app records the time it received that statement. This is an account record, not independent proof of consent. Clearing an unsubscribe requires a new explicit opt-in and source. The dashboard imports UTF-8 CSV files up to 2 MB, can skip or update matching addresses, and exports up to 10,000 contacts. CSV opt-in rows require a source and valid `consented_at` timestamp. Re-importing opt-outs never resubscribes them. Saved segments at `/api/v1/segments` support grouped all/any filters for tags, consent, unsubscribe state, typed string and number contact properties, and recent sent, delivered, opened, clicked, bounced or complained activity, with a paginated contact preview. Add or remove a contact from a segment with `POST` or `DELETE /api/v1/contacts/{contact_id}/segments/{segment_id}`, and list memberships with `GET /api/v1/contacts/{contact_id}/segments`. Manual removals are stored as exclusions so a contact does not reappear through the segment's filters. Topics can be managed in the dashboard and API; `GET` and `PUT /api/v1/contacts/{contact_id}/topics` read or replace preferences. Subscribing requires explicit consent source text. Set an independent `EMAILGO_PREFERENCES_SECRET` of at least 32 characters to create signed preference links from the Contacts dashboard. Public preference pages manage topic subscriptions and global unsubscribe, and require a clear confirmation to opt back in after a global opt out.

`POST /api/v1/contacts/imports` accepts a multipart CSV upload with a `column_map`, conflict policy, and optional segment/topic assignments. Missing string and number property definitions named in `column_map.properties` are created in the same transaction as imported contacts; existing property types must match the mapping. Imports are limited to 2 MB and 2,000 data rows, run synchronously, and return a completed import record. Use `GET /api/v1/contacts/imports` and `GET /api/v1/contacts/imports/{id}` to inspect saved counts. Topic opt-in imports require explicit `consent_status`, `consent_source`, and `consented_at` columns; the importer does not infer consent from an address list.

Contact property definitions can be managed with `GET`, `POST /api/v1/contact-properties` and `GET`, `PATCH`, `DELETE /api/v1/contact-properties/{key}`. Definitions support `string` and `number` types with optional fallback values. Broadcast personalization uses the fallback only when the contact property is missing or `null`; deleting a definition preserves values already stored on contacts.

The Broadcasts workspace creates personalized campaign drafts from saved segments or subscribed topics, then queues them immediately or up to 30 days in advance. Only contacts with recorded opt-in consent and no global unsubscribe are eligible. Send, thanks inserts a signed preferences link and RFC 8058 one-click unsubscribe header. A campaign is capped at 1,000 recipients per queue operation and uses the scheduled worker and SMTP relay. Delivery counts show SMTP handoff acceptance until signed outcome notifications arrive. Broadcast merge tags include `{{FIRST_NAME}}`, `{{LAST_NAME}}`, `{{EMAIL}}`, `{{name}}`, `{{preferences_url}}` and `{{unsubscribe_url}}`. Add a per-tag fallback with `{{{FIRST_NAME|there}}}`. Double-brace HTML values are escaped; triple braces insert raw markup and should only be used with trusted values. Broadcasts include the shared visual block editor and sandboxed email preview. Campaign sending remains unavailable until `EMAILGO_SMTP_*`, `EMAILGO_PUBLIC_URL`, `EMAILGO_PREFERENCES_SECRET` and `CRON_SECRET` are configured.

Full-access API keys can create and manage broadcast drafts with `GET`, `POST /api/v1/broadcasts`, `PATCH` or `DELETE /api/v1/broadcasts/{broadcast_id}`. Set `send: true` on the create request to save and queue a campaign in one call. Include a future ISO 8601 or supported natural time in `scheduled_at` (up to 30 days ahead) to schedule it instead. Set optional `reply_to` and `preview_text` values when creating or updating a draft. Reply-to accepts one email address, optionally with a display name. Preview text is limited to 500 single-line characters and is inserted as a hidden HTML preheader when the campaign has HTML content. Text-only messages use the beginning of their body for inbox previews. The dashboard composer exposes both optional fields after Subject and validates them before saving or queueing. These values are retained when a campaign is duplicated. The separate `/send` endpoint remains available to queue or schedule an existing draft. Pending messages can be canceled with `POST /api/v1/broadcasts/{broadcast_id}/cancel`.

Broadcast recipients and clicked-link reports are scoped to the authenticated key and use stable keyset cursors. They process up to 5,000 matching tracking events per request; larger reports return `413` rather than using unbounded memory.

### Automations

The dashboard and full-access REST API support event-triggered workflows with condition branches, delays of up to 30 days, wait-for-event steps, template email steps, and per-run step history. Active definitions are immutable; pause them before editing. Events are sent with `POST /api/v1/events`, with exactly one `contact_id` or `email`, an `event` name, optional object `payload`, and optional `Idempotency-Key`. Use the same full-access API key that owns the automation.

Automation definitions use a `steps` array and `connections` array. Each workflow starts with one `trigger` step. Supported step types are `trigger`, `condition`, `delay`, `wait_for_event`, `send_email`, `contact_update`, and `add_to_segment`. Condition rules support `and`/`or` groups, event/contact/wait-event fields and common comparison operators. Email steps reference a published template ID and a verified sender address; sends use the published snapshot and its fallback values, even while a newer draft exists. The dashboard includes a visual workflow canvas for connected steps and both condition branches. It supports keyboard-based selection, insertion, connection and reordering; it does not use drag-and-drop. Saving a draft only changes its definition. Activation requires a separate confirmation. Canvas positions are saved with the workflow. The worker advances runs and sends due automation emails; it must be configured with `CRON_SECRET` and a durable database. Contact-delete actions, event schema builder, and retry or resume for failed runs are not implemented.

Create an automation with `POST /api/v1/automations`, activate it with `POST /api/v1/automations/{id}/start`, and monitor it through `GET /api/v1/automations/{id}/runs`. Retrieve an individual run for step-level inputs, outputs and errors. The CLI and Node SDK expose the automation and event endpoints.

```json
{
  "name": "Welcome sequence",
  "status": "active",
  "steps": [
    { "key": "start", "type": "trigger", "config": { "event_name": "user.created" } },
    { "key": "welcome", "type": "send_email", "config": { "template": { "id": "tpl_..." }, "from": "hello@example.com" } }
  ],
  "connections": [{ "from": "start", "to": "welcome" }]
}
```

Send the matching event with `POST /api/v1/events`:

```json
{ "event": "user.created", "email": "person@example.net", "payload": { "plan": "pro" } }
```

Automation graphs also support condition branches, filtered event waits, contact updates and adding a contact to a saved segment. Contact update values can use `{{event.field}}`, `{{contact.field}}`, or a `{ "var": "event.field" }` value for a property. For example:

```json
{
  "name": "Activate a new customer",
  "status": "active",
  "steps": [
    { "key": "start", "type": "trigger", "config": { "event_name": "user.activated" } },
    { "key": "update", "type": "contact_update", "config": { "updates": { "name": "{{event.display_name}}", "properties": { "plan": { "var": "event.plan" } }, "tags": ["active"] } } },
    { "key": "segment", "type": "add_to_segment", "config": { "segment_id": "seg_..." } }
  ],
  "connections": [{ "from": "start", "to": "update" }, { "from": "update", "to": "segment" }]
}
```

Event waits may use a `filter_rule` against the incoming event. The runner records each step and checks the associated contact's unsubscribe state before sending an automation email. Failed runs are terminal; there is no retry or resume endpoint yet. A new event creates a separate run.

Custom event definitions use a flat `schema`: `POST /api/v1/events` creates a named event with optional `string`, `number`, `boolean`, or `date` fields; `GET /api/v1/events` lists definitions; and `/api/v1/events/{id_or_name}` supports retrieve, schema update, and delete. Send event payloads to `POST /api/v1/events/send`; declared values are validated and coerced before matching automations run. Existing clients can still trigger an event through `POST /api/v1/events` with the legacy `{ "event": "..." }` payload. Use `GET /api/v1/events/observed` to inspect events received so far.

Retrieve tracking events for an email with `GET /api/v1/emails/{email_id}/events`. Event access is scoped to the API key that sent the email.

Send, thanks retains submitted text and HTML bodies in its database so message details can show their contents. Encoded attachment bytes are removed after scheduled sends complete, and immediate-send attachment bytes are not retained. Configure protected, durable database storage and backups for production. Retention windows and self-service message deletion are not implemented yet.

### Receiving email

Send, thanks can accept normalized inbound mail events from a separately configured receiving service. The signed bridge is `POST /api/internal/receiving`; set an independent `EMAILGO_INBOUND_SECRET` and set `EMAILGO_RECEIVING_API_KEY_ID` to an active full-access key ID. Sign the exact raw JSON body with HMAC SHA 256 over `<unix_timestamp>.<raw_body>`, then send the base64url digest in `x-send-thanks-signature`, the timestamp in `x-send-thanks-timestamp`, and a stable event ID in `x-send-thanks-event-id`. The endpoint rejects stale or invalid signatures and deduplicates event IDs.

The normalized payload contains `from`, `to`, optional `cc`, `bcc`, `subject`, `message_id`, `headers`, `text`, `html` and optional base64 `attachments`. `GET /api/v1/emails/receiving` lists messages. Retrieve content and attachment metadata with `GET /api/v1/emails/receiving/{id}`, list attachments with `/attachments`, and download a file from `/attachments/{attachment_id}`. Bodies and attachments are retained in the configured database. Send, thanks does not provide inbound SMTP service, MX routing or a receiving provider, so mail will not arrive until an upstream service is configured to forward signed events to the bridge.

### Webhooks

Set `EMAILGO_WEBHOOK_SECRET` to a separate random secret of at least 32 characters. Create a webhook from **Webhooks** in the dashboard or with `POST /api/v1/webhooks`, including an HTTPS `endpoint` and one or more `events`. Supported types include `email.sent`, `email.failed`, `email.suppressed`, `email.scheduled`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`, `email.received`, `contact.created`, `contact.updated`, `contact.deleted`, `contact.subscribed`, `contact.unsubscribed`, `suppression.added`, `suppression.removed`, `domain.created`, `domain.updated`, and `domain.deleted`. Delivery outcomes include one `to` recipient per event and require signed delivery notifications to be configured.

Webhook event history is available at `GET /api/v1/webhooks/{webhook_id}/events`, with payload detail, attempt history and replay at `/events/{event_id}`, `/events/{event_id}/attempts` and `/events/{event_id}/replay`. Replay queues a separate delivery row for the same event and leaves the existing automatic retry schedule and attempt records intact. SMTP acceptance alone does not generate recipient outcome events. The signed `/api/webhooks/delivery-events` endpoint accepts compatible delivery notifications when `EMAILGO_WEBHOOK_TOKEN` is configured.

### Suppression management

Manage workspace-wide do-not-send addresses in **Suppressions** or through `GET` and `POST /api/v1/suppressions`, `GET` and `DELETE /api/v1/suppressions/{id-or-email}`, and `POST` or `DELETE /api/v1/suppressions/batch` for up to 100 addresses. The dashboard supports CSV import and export. Before SMTP handoff, Send, thanks removes suppressed addresses from To, Cc, and Bcc; if every recipient is suppressed, the message is recorded with `suppressed` status and no relay call is made. Scheduled and broadcast sends recheck the list immediately before handoff. Permanent-bounce and complaint notifications add suppressions when a compatible event source is configured.

Send, thanks returns a `whsec_` signing secret once. The database stores only the secret generation, and the secret is derived from the server master secret and webhook ID. Rotating `EMAILGO_WEBHOOK_SECRET` invalidates all existing endpoint secrets, so use the per-endpoint rotation API when needed. The receiver gets `svix-id`, `svix-timestamp`, and `svix-signature`; verify HMAC SHA 256 over `<svix-id>.<svix-timestamp>.<raw request body>` using the base64url value after `whsec_` as the key. Verify the timestamp window to reject replay attacks.

Send, thanks retries failed delivery up to five attempts with increasing delay and stores attempt status, duration and a bounded response excerpt. Individual delivered or failed events can be replayed. The worker must run for delivery to progress. Targets require public HTTPS on port 443; DNS results are checked and pinned per attempt, private addresses are blocked, and redirects are not followed. Keep event receiver responses free of secrets because response excerpts appear in the authenticated dashboard and API delivery history.

`GET /api/v1/usage` reports current day and month sent and received counts, contacts, domains, webhooks, segments, topics, broadcasts, automation runs and the per-key API request limit. It has no paid-plan quotas or billing data.

## Domain authentication

Send, thanks provides a TXT ownership record at `_send-thanks.<domain>`. The dashboard can inspect SPF, DMARC and MX records but does not configure them. Publish SPF and DKIM records supplied by your SMTP relay. The relay remains responsible for final delivery, reputation and its own authentication records.

## Production deployment

For Vercel, set a dedicated PostgreSQL connection string as `DATABASE_URL`; the health endpoint checks that the database is reachable, and Vercel deployments fail closed instead of falling back to ephemeral SQLite. The repository config places functions in Sydney to match the Neon project region. Set `EMAILGO_ADMIN_PASSWORD`, `EMAILGO_SESSION_SECRET`, `EMAILGO_WEBHOOK_SECRET`, `EMAILGO_WEBHOOK_TOKEN`, `CRON_SECRET`, and the SMTP settings as production secrets. Replace the example SMTP host and port with values for the intended sender mailbox.

For a Docker host, mount a persistent volume at `/app/data` and set all admin and SMTP values as server secrets. SQLite requires a single app instance with persistent local storage. You can also set `DATABASE_URL` to use PostgreSQL. The message log contains recipient addresses and subject lines, so restrict access and configure backups. Put TLS and request-size protection at the trusted reverse proxy.
