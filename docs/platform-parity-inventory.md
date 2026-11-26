# Send, thanks feature parity

Send, thanks is an independent mail platform. It must not call the external mail API or require a external mail API key. This checklist tracks behavior, not visual resemblance. Statuses describe the current source tree and are updated as each feature is implemented and verified.

## Core sending and deliverability

| Feature | Status | Notes |
| --- | --- | --- |
| REST email send, get and paginated list | Implemented, local smoke validation passed | SMTP handoff; message list and detail are scoped to the authenticated API key. Detail includes retained text and HTML. Delivery status means relay acceptance, not recipient delivery. No retention windows or self-service message deletion yet. |
| To, Cc, Bcc, reply-to, headers and tags | Implemented, local validation passed | Stored as message metadata; relay behavior depends on the SMTP server. |
| Base64 attachments | Implemented, local validation passed | Request limit is 1 MB; attachments capped at 650 KB total and 10 files per message. Attachment bytes are not retained. |
| Reusable templates with variables | Implemented, local smoke validation passed | Draft and published versions, immutable version history, aliases, fallback values, duplicate/publish operations, HTML escaping, a visual block editor with sandboxed preview, and protection against deleting templates referenced by automations. Per-workspace isolation is not implemented. |
| Batch send | Implemented, local smoke validation passed | Accepts the standard direct JSON array and the earlier `{ "emails": [...] }` wrapper. Up to 100 messages, one API rate-limit unit, five SMTP sends in parallel, per-item results and idempotency keys. Each send is synchronous and can exceed a serverless execution window. |
| Scheduled sends and retry queue | Implemented, local worker smoke validation passed; production activation pending | Durable database records, reschedule/cancel endpoints, three total attempts and a protected worker. Requires `CRON_SECRET`, durable database storage, a production deployment, and a Vercel plan that meets the desired cadence. |
| Domain verification and authentication guidance | Partial | Send, thanks TXT ownership checks and read-only SPF, DMARC and MX diagnostics are available. DKIM, custom return paths and custom tracking domains still rely on the selected relay or manual DNS configuration. |
| Open and click tracking | Implemented, local smoke validation passed | Optional per-domain tracking, signed pixels and redirects, event API and aggregate dashboard counts. Custom tracking domains are not implemented. Open counts are approximate because clients can block or prefetch images. |
| Delivery, bounce and complaint events | Partial, local signature and parser tests passed | A signed delivery-notification endpoint validates envelopes, deduplicates events, links outcomes to saved relay message IDs, advances message status without downgrades, and adds permanent bounces and complaints to the workspace suppression list. A compatible event source is not configured or production verified. |
| Webhook endpoints, signatures, retry and replay | Partial, local smoke validation passed | API and dashboard CRUD, per-key event filters, event/attempt history, one-time signing secrets with rotation, HMAC signatures, bounded retry and replay are implemented. Targets must be public HTTPS endpoints; private and loopback addresses are rejected. Events cover relay handoff failures/acceptance, tracking, API contact lifecycle, and signed recipient delivery outcomes when configured. Production delivery still depends on a durable database, `EMAILGO_WEBHOOK_SECRET`, `CRON_SECRET`, and a running worker. |
| Suppression management | Partial, local smoke validation passed | Workspace-wide manual suppression list supports API/dashboard add, get, paginated list, remove, batch import/remove, dashboard CSV import/export, and `suppression.added`, `suppression.removed`, and `email.suppressed` webhook events. Transactional recipients are filtered from To/Cc/Bcc and scheduled/broadcast messages recheck before relay handoff. Permanent bounce and complaint events add suppressions when a compatible delivery source is configured; automatic provider-wide syncing is absent. Signed global unsubscribe and topic preferences remain separate and include RFC 8058 one-click handling for broadcasts. |
| Usage metrics and request logs | Partial, local smoke validation passed | Email metrics and API request log list/detail endpoints are implemented, with API-key scoping and bounded result sets. Signed delivery notifications add delivered, delayed, bounced and complained counts; they remain empty until an event source is configured. Bounce subtypes and derived rates remain unavailable. Dashboard message history supports server-side search, status filters, cursor pagination and sandboxed HTML preview. |

## Workspace and growth tools

| Feature | Status | Notes |
| --- | --- | --- |
| Contacts, properties, tags and consent state | Partial, local smoke validation passed | API/dashboard CRUD and CSV record unknown consent by default, with opt-in source and time fields. Unsubscribe remains suppressive. Signed public preference pages support topic choices and global unsubscribe. |
| Contact property definitions and fallbacks | Partial, local smoke validation passed | Typed string/number definitions, per-property fallback values, dashboard, API, SDK and CLI support. Broadcast rendering uses fallback values only when a contact value is missing or null; template-level fallbacks and automatic definition creation during import remain absent. |
| Audiences, segments and topics | Partial, local smoke validation passed | Saved live segments support tag, opt-in and unsubscribe filters, with counts, paginated contact previews, and point-in-time `all_contacts`, `subscribers` and `unsubscribers` metrics by segment. Topic CRUD, a public signed preference center, contact topic preferences, and multipart contact imports with column mapping, conflict handling, segment assignment, and explicit-consent topic opt-in are available. Imports are synchronous, limited to 2 MB and 2,000 rows. Broad segmentation rules remain absent. |
| Broadcasts/newsletters | Partial, local smoke validation passed | Dashboard can save, edit, schedule, cancel and queue personalized campaigns to saved segments or subscribed topics. Only opted-in, non-suppressed contacts are eligible. Messages include signed preferences links and RFC 8058 unsubscribe headers. Each send is limited to 1,000 recipients and is drained by the existing worker. Recipient and clicked-link analytics are available through key-scoped, bounded APIs. Broadcast drafts include the visual block editor and sandboxed preview. Experiments, recipient outcome ingestion, and production relay verification are not implemented. |
| Automations | Partial, local smoke validation passed | Full-access API and dashboard create, activate, pause and archive event-triggered workflows. Supports condition branches, delays up to 30 days, filtered wait-for-event, template email, contact name/property/tag updates, add-to-segment, idempotent custom event sends and per-step run history/cancel. Event schema CRUD and payload validation are implemented. Template references are protected from deletion. The dashboard has a simple action builder and JSON graph editor; a drag-and-drop visual canvas is absent. A durable database and scheduled worker are required. Contact deletion actions and retry/resume for failed runs are absent. |
| Inbound email and message receiving | Partial | A signed, replay-resistant normalized provider event bridge stores inbound message bodies and attachments; full-access keys and the dashboard Receiving view can list, retrieve and download them. No MX routing or inbound SMTP/provider is configured, so actual receipt depends on an external service forwarding events. Threading and mailbox actions are absent. |
| Shared inboxes | Not implemented | Requires inbound receiving, threads, assignments, drafts and team access controls. |

## Developer and team platform

| Feature | Status | Notes |
| --- | --- | --- |
| API keys and REST reference | Partial, local smoke validation passed | Keys are stored as hashes. Full-access and domain-restricted sending-only keys are implemented. Full-access keys can list, create, inspect, rename and revoke keys through `/api/v1/api-keys`; raw key material is returned only at creation. An OpenAPI 3.1 document is served at `/api/v1/openapi.json`. API key scopes remain coarse and OAuth is absent. |
| Domain management API | Partial | Full-access keys can list, create, inspect, verify, update tracking settings and delete unused sender domains through `/api/v1/domains`. DNS checks cover ownership, SPF, DMARC and MX; DKIM and return-path setup still come from the SMTP relay. |
| SDK, CLI and MCP tools | Partial, local smoke validation passed | A dependency-free source Node SDK and repository CLI cover implemented Send, thanks API methods, including automation/event methods. The SDK is not published, CLI has no keychain-backed profiles or local webhook tunnel, MCP is absent, and other language SDKs are absent. |
| Multiple workspaces, members and roles | Not implemented | Current admin is a single shared password session. |
| OAuth, SSO and audit log | Not implemented | Requires identity and account-security design. |
| Billing, quotas and plan controls | Not implemented | No billing provider or usage enforcement exists. |
| Agent inboxes and inbox automation | Not implemented | Send, thanks has no inbox threads, assignments or agent actions. |

## Newly implemented Send, thanks endpoints

| Endpoint | Behavior |
| --- | --- |
| `POST /api/v1/webhooks` | Create an HTTPS endpoint for supported Send, thanks events. Returns a signing secret once. |
| `GET /api/v1/webhooks` | List endpoints owned by the authenticated full-access API key. |
| `GET`, `PATCH`, `DELETE /api/v1/webhooks/{id}` | Retrieve, update, or disable an owned endpoint. |
| `GET /api/v1/webhooks/{id}/deliveries` | Paginated delivery state and attempt history. |
| `POST /api/v1/webhooks/{id}/replay` | Replay one delivered or failed event using `delivery_id`. |
| `POST /api/v1/webhooks/{id}/rotate-secret` | Rotate the endpoint signing key; the new key is returned once. |
| `GET`, `POST /api/v1/suppressions` | Paginated workspace list and manual addition of an address. |
| `GET`, `DELETE /api/v1/suppressions/{id-or-email}` | Retrieve or remove a suppression by identifier or address. |
| `POST`, `DELETE /api/v1/suppressions/batch` | Add or remove up to 100 addresses in one request. |
| `GET /api/suppressions?format=csv` | Export the dashboard suppression list. Dashboard CSV import accepts up to 2,000 rows per file. |
| `GET`, `POST /api/v1/contact-properties` | List or create typed string/number property definitions with optional fallback values. |
| `GET`, `PATCH`, `DELETE /api/v1/contact-properties/{key}` | Retrieve or update a definition, or delete the definition while preserving saved contact values. |
| `GET /api/v1/usage` | Current Send, thanks message counts, resource counts, resets, and the configured send rate. Plan quotas are `null` because billing and plan limits do not exist. |
| `POST /api/internal/receiving` | Accept a signed, five-minute-window `email.received` event from a separately configured provider. Requires `EMAILGO_INBOUND_SECRET` and `EMAILGO_RECEIVING_API_KEY_ID`. Provider event IDs are deduplicated. |
| `GET /api/v1/emails/receiving` | List inbound email received through the provider bridge, scoped to the configured full-access API key. |
| `GET /api/v1/emails/receiving/{id}` | Retrieve inbound content and attachment metadata. |
| `GET /api/v1/emails/receiving/{id}/attachments` | List stored attachment metadata and download URLs. |
| `GET /api/v1/emails/receiving/{id}/attachments/{attachment_id}` | Download the stored attachment bytes through an authenticated API request. |
| `GET /api/receiving` | Authenticated dashboard inbox list with cursor pagination. |
| `GET /api/receiving/{id}` | Authenticated dashboard inbox detail with body, headers and attachment metadata. |
| `GET /api/receiving/{id}/attachments/{attachment_id}` | Download an inbound attachment from the authenticated dashboard. |
| `GET`, `POST /api/v1/segments` | List and create saved live contact segments. Filters support tags, consent state and unsubscribe state. |
| `GET`, `PATCH`, `DELETE /api/v1/segments/{id}` | Read, update or remove a saved segment. Contact membership is dynamic. |
| `GET /api/v1/segments/{id}/contacts` | Paginated contacts currently matching a segment. |
| `GET /api/v1/segments/metrics` | Point-in-time account or segment counts for all contacts, subscribers and unsubscribers; optional `segment_id` filters and segment dimension. |
| `POST /api/v1/contacts/imports` | Import a 2 MB, 2,000-row multipart CSV with a column map, upsert/skip mode, and optional segment/topic assignments. Completion is synchronous; the app does not store the uploaded file. |
| `GET /api/v1/contacts/imports` | Paginated import history with status filters; the result is scoped to the authenticated API key. |
| `GET /api/v1/contacts/imports/{id}` | Retrieve one owned import with completion time, counts and row-level validation summaries. |
| `GET`, `POST /api/v1/topics` | List and create contact preference topics. |
| `GET`, `PATCH`, `DELETE /api/v1/topics/{id}` | Read, update or archive a preference topic. Archives retain historical subscriptions. |
| `GET`, `PUT /api/v1/contacts/{id}/topics` | Read or replace a contact's topic preferences; subscription requires a consent source. |
| `GET /api/emails` | Authenticated dashboard history with search, status filtering, totals and cursor pagination. |
| `GET /api/emails/{id}` | Authenticated dashboard details including recipients, metadata, body and attachment metadata. |
| `GET /api/contacts/{id}/preferences` | Create a signed public preference link for an authenticated dashboard contact. Requires `EMAILGO_PREFERENCES_SECRET`. |
| `GET`, `POST /api/preferences/{token}` | Read topics and update topic preferences or globally unsubscribe through a contact-bound signed link. |
| `POST /api/preferences/{token}/one-click` | Process an RFC 8058 URL-encoded global unsubscribe request from a broadcast's `List-Unsubscribe` headers. |
| `GET`, `POST /api/v1/broadcasts` | List campaign records and create a validated draft through a full-access API key. The dashboard also uses `/api/broadcasts`. |
| `PATCH`, `DELETE /api/v1/broadcasts/{id}` | Update or delete a draft. Queued campaigns cannot be rewritten. |
| `POST /api/v1/broadcasts/{id}/send` | Queue up to 1,000 eligible, consented recipients for immediate or scheduled SMTP handoff. Requires the worker, SMTP, public URL and signed preference configuration. |
| `POST /api/v1/broadcasts/{id}/cancel` | Cancel pending campaign messages before the worker claims them. |
| `GET`, `POST /api/v1/automations` | List or create a graph workflow with a trigger, connections, conditions, waits, delays, template email, contact update, or segment membership actions. |
| `GET`, `PATCH`, `DELETE /api/v1/automations/{id}` | Read, edit while paused/draft, pause, or archive an owned automation. Archived definitions and runs are retained. |
| `POST /api/v1/automations/{id}/start`, `POST /stop` | Activate or pause new runs. In-flight runs retain their original workflow snapshot. |
| `GET /api/v1/automations/{id}/runs` | List scoped workflow runs with status and cursor pagination. |
| `GET /api/v1/automations/{id}/runs/{runId}` | Retrieve run context and step-level input/output/error history. |
| `POST /api/v1/automations/{id}/runs/{runId}/stop` | Cancel a running or waiting run. |
| `GET`, `POST /api/v1/events` | List or create custom event definitions with flat payload schemas. The legacy event-send body remains supported for existing clients. |
| `GET`, `PATCH`, `DELETE /api/v1/events/{id-or-name}` | Retrieve, update or remove an event schema owned by the authenticated key. |
| `POST /api/v1/events/send` | Send an idempotent custom event for a contact/email to trigger or resume workflows. Reusing an idempotency key with a different event returns 409. |
| `GET /api/v1/events/observed` | List received event names and counts. |
| `GET /api/v1/emails/metrics` | Return supported send, engagement and configured delivery outcome counts with date ranges, time zones, dimensions, filters and bounded result sets. Derived delivery rates and bounce subtypes remain unavailable. |
| `GET /api/v1/emails/{id}/events` | List tracking and signed delivery events for one owned message with stable cursor pagination. |
| `POST /api/webhooks/delivery-events` | Accept signed delivery notifications through the internal event bridge; requires a configured notification token and optional source allowlist. |
| `GET /api/v1/broadcasts/{id}/recipients` | Return key-scoped broadcast recipient analytics with stable keyset pagination and a 5,000-event request cap. |
| `GET /api/v1/broadcasts/{id}/clicked-links` | Return key-scoped clicked-link analytics with stable keyset pagination and a 5,000-event request cap. |
| `GET`, `POST /api/v1/templates` | List or create templates. Existing templates migrate as published snapshots; new templates start as drafts. |
| `GET`, `PATCH`, `DELETE /api/v1/templates/{id}` | Retrieve, save a new draft version, or delete a template if no automation references it. |
| `POST /api/v1/templates/{id}/publish` | Publish the current draft version using a compare-and-set update. |
| `POST /api/v1/templates/{id}/duplicate` | Create a draft copy from a template. |
| `GET /api/v1/templates/{id}/versions` | List immutable draft and published template versions. |
| `GET`, `POST /api/v1/api-keys` | List active API keys or create a scoped key; the secret is returned only in the create response. Requires a full-access API key. |
| `GET`, `PATCH`, `DELETE /api/v1/api-keys/{id}` | Inspect, rename or revoke an active key. Requires a full-access API key. |
| `GET`, `POST /api/v1/domains` | List sender domains or add a domain with its ownership TXT token. Requires a full-access API key. |
| `GET`, `PATCH`, `DELETE /api/v1/domains/{id}` | Inspect a sender domain, update tracking or remove it when no active sending-only keys are scoped to it. |
| `POST /api/v1/domains/{id}/verify` | Resolve the domain ownership TXT record and mark it verified. |
| `GET /api/v1/domains/{id}/dns` | Inspect ownership guidance, SPF, DMARC, MX and relay-managed DKIM status. |

Webhook signatures use `svix-id`, `svix-timestamp`, and `svix-signature` headers. The `whsec_` value is base64url encoded HMAC material. The receiver signs/verifies `<event_id>.<timestamp>.<raw_json_body>` using HMAC SHA-256. Delivery payloads remain in the database for retries; bounded receiver response excerpts are retained in attempt history.

## Verified official references

- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)

Do not describe Send, thanks as a complete email platform until every applicable row has implemented behavior and verification evidence. Features requiring a delivery event provider, inbound mail provider, team identity system or worker must remain listed as dependencies until configured.
