# Email, thanks

Internal code name: Emailgo (environment variables keep the `EMAILGO_` prefix).

Email, thanks is an independent email delivery API and workspace for Website Thanks. It owns the API keys, sender domain verification, request validation, message log and dashboard. Outbound transport is configured through standard SMTP credentials. Email, thanks does not call Resend or use a Resend API key.

## What works

- Admin password sign in with signed, HTTP only sessions.
- Create and revoke Email, thanks API keys. Only key hashes are stored, and a new secret is shown once.
- Add sender domains and verify ownership through a DNS TXT record.
- Send transactional emails through the Email, thanks API using a configured SMTP relay.
- Persist recipients, subject lines, relay response IDs, failures and key last-use times in PostgreSQL in production and SQLite during local development. Email bodies are used for SMTP handoff and are not saved to the message log.
- Filter recent message activity and inspect relay failures.
- Per-key send limit of 60 requests per minute, a 1 MB request body limit, and 24-hour idempotency keys to prevent accidental duplicate sends.
- Authenticated `GET /api/v1/emails` and `GET /api/v1/emails/:id` endpoints for message history.
- Docker image designed for a persistent `./data` volume.

SMTP credentials are only sent over TLS. Port 587 requires STARTTLS; port 465 uses implicit TLS. SMTP acceptance is recorded as `sent`. Opens and clicks are not tracked.

## Bounces and spam complaints (Amazon SES)

`POST /api/webhooks/ses?token=<EMAILGO_WEBHOOK_TOKEN>` accepts Amazon SNS messages carrying SES Bounce, Complaint and Delivery notifications. Each request must carry the token, come from an allowed topic (`EMAILGO_SNS_TOPIC_ARNS`, if set) and pass SNS signature verification against a certificate served from `sns.<region>.amazonaws.com`. Subscription confirmations are accepted automatically after the same checks.

- The SES message ID from the SMTP reply (`250 Ok <id>`) is stored as `relay_message_id` and links events to messages.
- Message status moves forward only: `sent` → `deferred` (transient bounce) → `delivered` → `bounced` → `complained`.
- Permanent bounces and complaints add the recipient to `suppressions`. Later sends to a suppressed address return 422 and list the addresses.
- Events are de-duplicated per SNS message and recipient, so SNS retries are safe. Only addresses, event types and short reasons are stored, never message bodies.

To connect SES: create an SNS topic, subscribe the URL above over HTTPS, and set the topic as the Bounce, Complaint and (optionally) Delivery notification topic on the SES identity.

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

Create a key in **API keys**, verify a domain in **Domains**, then send:

```sh
curl -X POST http://localhost:3000/api/v1/emails \
  -H 'Authorization: Bearer eg_live_your_key' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-123-confirmation' \
  -d '{"from":"hello@example.com","to":"person@example.net","subject":"Hello","text":"Sent with Email, thanks."}'
```

The `from` domain must be verified. Provide either `text`, `html`, or both. An `Idempotency-Key` makes retries safe for 24 hours. Reusing it with different content returns 409. A `to` value can be one address or an array of up to 50 addresses. Invalid keys receive 401, unverified domains receive 403, and SMTP delivery errors receive 502.

List the latest messages with optional pagination:

```sh
curl 'http://localhost:3000/api/v1/emails?limit=20' \
  -H 'Authorization: Bearer eg_live_your_key'
```

Follow `next_after` as the `after` query parameter to load the next page. Retrieve one message with `GET /api/v1/emails/{email_id}`. Both endpoints return status and relay metadata; message bodies are not retained or returned.

## Domain authentication

Email, thanks provides a TXT ownership record at `_emailgo.<domain>`. Configure SPF and DKIM records for your SMTP relay too. The relay remains responsible for final delivery, reputation and its own authentication records.

## Production deployment

For Vercel, set a dedicated PostgreSQL connection string as `DATABASE_URL`; the health endpoint checks that the database is reachable, and Vercel deployments fail closed instead of falling back to ephemeral SQLite. The repository config places functions in Sydney to match the Neon project region. Set `EMAILGO_ADMIN_PASSWORD`, `EMAILGO_SESSION_SECRET`, and the SMTP settings as production secrets. The included example uses Spacemail's `mail.spacemail.com` SMTP host on port 465; use credentials for the intended sender mailbox.

For a Docker host, mount a persistent volume at `/app/data` and set all admin and SMTP values as server secrets. SQLite requires a single app instance with persistent local storage. You can also set `DATABASE_URL` to use PostgreSQL. The message log contains recipient addresses and subject lines, so restrict access and configure backups. Put TLS and request-size protection at the trusted reverse proxy.
