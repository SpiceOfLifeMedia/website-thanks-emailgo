# Send, thanks

Send, thanks is a private email sending workspace for Website Thanks. It manages API keys, sender domain verification, request validation, message history, delivery event statuses and a block list. Outbound delivery uses the SMTP connection configured by the operator.

## What works

1. Admin password sign in with signed, HTTP only sessions.
2. Create and revoke API keys. Key hashes are stored, and each new secret is shown once.
3. Add sender domains and verify ownership with a DNS TXT record.
4. Send transactional email through the existing `/api/v1/emails` API route.
5. Store recipients, subjects, delivery states, failures and key activity in PostgreSQL in production and SQLite during local development. Email bodies are handed off but are not stored in the message log.
6. Process signed delivery notifications and show Delivered, Bounced or Complained when an event is received.
7. Add and remove manually blocked addresses. Permanent bounces and complaints are also suppressed from future sends.
8. Apply a per-key limit of 60 requests per minute, a 1 MB request body limit and 24 hour idempotency keys.
9. Retrieve message history through authenticated `GET /api/v1/emails` and `GET /api/v1/emails/:id` endpoints.
10. Run in Docker with a persistent `./data` volume.

The dashboard labels an email Sent when the SMTP connection accepts it for handoff. Delivery events update the record later. The usage count shows requests recorded this calendar month. No monthly send cap is configured.

## Delivery events

Configure signed delivery notifications at `POST /api/webhooks/delivery-events?token=<EMAILGO_WEBHOOK_TOKEN>`. Set `EMAILGO_WEBHOOK_TOKEN` to a long random value. Optionally restrict accepted notification sources in the server configuration. Configure the event source to post bounce, complaint and delivery notifications to this HTTPS address.

Message state moves forward through Queued, Sent, Deferred, Delivered, Bounced and Complained as corresponding events arrive. Permanent bounces and complaints are added to the suppression list. Notifications are verified and deduplicated before they update message history.

## Run locally

Requires Node.js 24 or later.

```sh
cp .env.example .env.local
# Fill in unique admin and session secrets and SMTP connection settings.
npm install
npm run dev
```

Open `http://localhost:3000`. The SQLite database is created under `./data`. Without admin secrets, the app shows first run setup. Without SMTP settings, requests are safely recorded as failed and no email is delivered.

## API

Create a key in **API keys**, verify a domain in **Domains**, then send:

```sh
curl -X POST http://localhost:3000/api/v1/emails \
  -H 'Authorization: Bearer st_live_your_key' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-123-confirmation' \
  -d '{"from":"hello@example.com","to":"person@example.net","subject":"Hello","text":"Sent with Send, thanks."}'
```

The `from` domain must be verified. Provide `text`, `html` or both. An `Idempotency-Key` makes retries safe for 24 hours. Reusing it with different content returns 409. The `to` value can contain one address or an array of up to 50. A blocked or suppressed address is rejected before sending. Invalid keys receive 401, unverified domains receive 403, and handoff failures receive 502.

List messages with optional pagination:

```sh
curl 'http://localhost:3000/api/v1/emails?limit=20' \
  -H 'Authorization: Bearer st_live_your_key'
```

Follow `next_after` as the `after` query parameter to load another page. Retrieve one message with `GET /api/v1/emails/{email_id}`. Message bodies and SMTP response details are not returned.

## Domain authentication

New sender domains receive a TXT ownership record at `_send-thanks.<domain>`. Existing ownership records continue to verify. Configure SPF and DKIM records for your sending connection too.

## Production setup

Set a dedicated PostgreSQL connection string as `DATABASE_URL`. The health endpoint checks database availability, and managed deployments fail closed instead of falling back to temporary SQLite. Set `EMAILGO_ADMIN_PASSWORD`, `EMAILGO_SESSION_SECRET` and SMTP settings as server secrets.

For a Docker host, mount a persistent volume at `/app/data` and set admin and SMTP values as server secrets. SQLite requires one app instance with persistent local storage. The message log contains recipient addresses and subjects, so restrict access and configure backups. Put TLS and request size protection at the trusted reverse proxy.
