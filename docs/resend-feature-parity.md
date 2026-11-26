# Emailgo feature parity

Emailgo is an independent mail platform. It must not call the Resend API or require a Resend API key. This checklist tracks behavior, not visual resemblance. Statuses describe the current source tree and are updated as each feature is implemented and verified.

## Core sending and deliverability

| Feature | Status | Notes |
| --- | --- | --- |
| REST email send, get and paginated list | Implemented, local smoke validation passed | SMTP handoff; message list and detail are scoped to the authenticated API key. Detail includes retained text and HTML. Delivery status means relay acceptance, not recipient delivery. No retention windows or self-service message deletion yet. |
| To, Cc, Bcc, reply-to, headers and tags | Implemented, local validation passed | Stored as message metadata; relay behavior depends on the SMTP server. |
| Base64 attachments | Implemented, local validation passed | Request limit is 1 MB; attachments capped at 650 KB total and 10 files per message. Attachment bytes are not retained. |
| Reusable templates with variables | Implemented, local validation passed | Basic CRUD and API rendering; HTML values are escaped. No visual editor, preview, version history or per-workspace isolation. |
| Batch send | Implemented, local smoke validation passed | Up to 100 messages, one API rate-limit unit, five SMTP sends in parallel, per-item result and idempotency keys. Each send is synchronous and can exceed a serverless execution window. |
| Scheduled sends and retry queue | Implemented, local worker smoke validation passed; production activation pending | Durable database records, reschedule/cancel endpoints, three total attempts and a protected worker. Requires `CRON_SECRET`, durable database storage, a production deployment, and a Vercel plan that meets the desired cadence. |
| Domain verification and authentication guidance | Partial | Emailgo TXT ownership checks and read-only SPF, DMARC and MX diagnostics are available. DKIM, custom return paths and custom tracking domains still rely on the selected relay or manual DNS configuration. |
| Open and click tracking | Implemented, local smoke validation passed | Optional per-domain tracking, signed pixels and redirects, event API and aggregate dashboard counts. Custom tracking domains are not implemented. Open counts are approximate because clients can block or prefetch images. |
| Delivery, bounce and complaint events | Not implemented | SMTP acceptance is not proof of recipient delivery. Spacemail event support is not configured. |
| Webhook endpoints, signatures, retry and replay | Partial, local smoke validation passed | API and dashboard CRUD, per-key event filters, one-time signing secrets with rotation, HMAC signatures, bounded retry, per-attempt history and manual replay are implemented. Targets must be public HTTPS endpoints; private and loopback addresses are rejected. Events cover Emailgo relay handoff failures/acceptance, tracking, and API contact lifecycle. Provider delivery, bounce and complaint events are not available. Production delivery still depends on a durable database, `EMAILGO_WEBHOOK_SECRET`, `CRON_SECRET`, and a running worker. |
| Suppression management | Partial | Signed global unsubscribe and per-topic preferences are implemented, including RFC 8058 one-click unsubscribe for broadcasts. Provider bounce/complaint ingestion and provider-wide suppression syncing are absent. |
| Usage metrics and request logs | Partial | Basic message counts exist. Dashboard message history supports server side search, status filters, cursor pagination and a sandboxed HTML preview. Provider delivery metrics and API request logs are absent. |

## Workspace and growth tools

| Feature | Status | Notes |
| --- | --- | --- |
| Contacts, properties, tags and consent state | Partial, local smoke validation passed | API/dashboard CRUD and CSV record unknown consent by default, with opt-in source and time fields. Unsubscribe remains suppressive. Signed public preference pages support topic choices and global unsubscribe. |
| Audiences, segments and topics | Partial, local smoke validation passed | Saved live segments support tag, opt-in and unsubscribe filters, with counts and paginated contact previews. Topic CRUD, a public signed preference center, and contact topic preferences are available; subscriptions require explicit confirmation when restoring a global opt out. API-key topic targeting and broad segmentation rules are absent. |
| Broadcasts/newsletters | Partial, local smoke validation passed | Dashboard can save, edit, schedule, cancel and queue personalized campaigns to saved segments or subscribed topics. Only opted-in, non-suppressed contacts are eligible. Messages include signed preferences links and RFC 8058 unsubscribe headers. Each send is limited to 1,000 recipients and is drained by the existing worker. There is no visual editor, campaign analytics, experiments, provider delivery/bounce/complaint ingestion, or production relay verification. |
| Automations | Not implemented | Requires an event store, durable scheduler and run history. |
| Inbound email and message receiving | Partial | A signed, replay-resistant normalized provider event bridge stores inbound message bodies and attachments; full-access keys and the dashboard Receiving view can list, retrieve and download them. No MX routing or inbound SMTP/provider is configured, so actual receipt depends on an external service forwarding events. Threading and mailbox actions are absent. |
| Shared inboxes | Not implemented | Requires inbound receiving, threads, assignments, drafts and team access controls. |

## Developer and team platform

| Feature | Status | Notes |
| --- | --- | --- |
| API keys and REST reference | Partial, local smoke validation passed | Keys are stored as hashes. Full-access and domain-restricted sending-only keys are implemented. Full-access keys can list, create, inspect, rename and revoke keys through `/api/v1/api-keys`; raw key material is returned only at creation. An OpenAPI 3.1 document is served at `/api/v1/openapi.json`. API key scopes remain coarser than Resend's full platform and OAuth is absent. |
| Domain management API | Partial | Full-access keys can list, create, inspect, verify, update tracking settings and delete unused sender domains through `/api/v1/domains`. DNS checks cover ownership, SPF, DMARC and MX; DKIM and return-path setup still come from the SMTP relay. |
| SDK, CLI and MCP tools | Partial, local smoke validation passed | A dependency-free source Node SDK and repository CLI cover implemented Emailgo API methods. The SDK is not published, CLI has no keychain-backed profiles or local webhook tunnel, MCP is absent, and other language SDKs are absent. |
| Multiple workspaces, members and roles | Not implemented | Current admin is a single shared password session. |
| OAuth, SSO and audit log | Not implemented | Requires identity and account-security design. |
| Billing, quotas and plan controls | Not implemented | No billing provider or usage enforcement exists. |
| Agent inboxes and inbox automation | Not implemented | Resend announced shared agent inboxes in October 2026; Emailgo has no inbound mail, threading, assignments or agent actions. |

## Newly implemented Emailgo endpoints

| Endpoint | Behavior |
| --- | --- |
| `POST /api/v1/webhooks` | Create an HTTPS endpoint for supported Emailgo events. Returns a signing secret once. |
| `GET /api/v1/webhooks` | List endpoints owned by the authenticated full-access API key. |
| `GET`, `PATCH`, `DELETE /api/v1/webhooks/{id}` | Retrieve, update, or disable an owned endpoint. |
| `GET /api/v1/webhooks/{id}/deliveries` | Paginated delivery state and attempt history. |
| `POST /api/v1/webhooks/{id}/replay` | Replay one delivered or failed event using `delivery_id`. |
| `POST /api/v1/webhooks/{id}/rotate-secret` | Rotate the endpoint signing key; the new key is returned once. |
| `GET /api/v1/usage` | Current Emailgo message counts, resource counts, resets, and the configured send rate. Plan quotas are `null` because billing and plan limits do not exist. |
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
| `GET`, `POST /api/v1/api-keys` | List active API keys or create a scoped key; the secret is returned only in the create response. Requires a full-access API key. |
| `GET`, `PATCH`, `DELETE /api/v1/api-keys/{id}` | Inspect, rename or revoke an active key. Requires a full-access API key. |
| `GET`, `POST /api/v1/domains` | List sender domains or add a domain with its ownership TXT token. Requires a full-access API key. |
| `GET`, `PATCH`, `DELETE /api/v1/domains/{id}` | Inspect a sender domain, update tracking or remove it when no active sending-only keys are scoped to it. |
| `POST /api/v1/domains/{id}/verify` | Resolve the domain ownership TXT record and mark it verified. |
| `GET /api/v1/domains/{id}/dns` | Inspect ownership guidance, SPF, DMARC, MX and relay-managed DKIM status. |

Webhook signatures use `svix-id`, `svix-timestamp`, and `svix-signature` headers. The `whsec_` value is base64url encoded HMAC material. The receiver signs/verifies `<event_id>.<timestamp>.<raw_json_body>` using HMAC SHA-256. Delivery payloads remain in the database for retries; bounded receiver response excerpts are retained in attempt history.

## Verified official references

- [Resend API reference](https://resend.com/docs/api-reference/introduction)
- [Send email API](https://resend.com/docs/api-reference/emails/send-email)
- [Domain management](https://resend.com/docs/dashboard/domains/introduction)
- [Contacts](https://resend.com/docs/dashboard/contacts/introduction)
- [Broadcasts](https://resend.com/docs/dashboard/broadcasts/introduction)
- [Automations](https://resend.com/docs/dashboard/automations/introduction)
- [Receiving](https://resend.com/docs/dashboard/receiving/introduction)
- [Inboxes](https://resend.com/docs/dashboard/inboxes/introduction)
- [Webhooks](https://resend.com/features/webhooks)
- [CLI](https://resend.com/changelog/cli)
- [MCP](https://resend.com/changelog/mcp)
- [Resend Inboxes announcement](https://resend.com/blog/announcing-inboxes)
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)

Do not describe Emailgo as a complete Resend clone until every applicable row has implemented behavior and verification evidence. Features requiring a delivery event provider, inbound mail provider, team identity system or worker must remain listed as dependencies until configured.
