# Emailgo

Emailgo is an independent email delivery API and workspace for Website Thanks. It owns the API keys, sender domain verification, request validation, message log and dashboard. Outbound transport is configured through standard SMTP credentials. Emailgo does not call Resend or use a Resend API key.

## What works

- Admin password sign in with signed, HTTP only sessions.
- Create and revoke Emailgo API keys. Only key hashes are stored, and a new secret is shown once.
- Add sender domains and verify ownership through a DNS TXT record.
- Send transactional emails through the Emailgo API using a configured SMTP relay.
- Persist recipients, subject lines, relay response IDs, failures and key last-use times in SQLite. Email bodies are used for SMTP handoff and are not saved to the message log.
- Filter recent message activity and inspect relay failures.
- Per-key send limit of 60 requests per minute and a 1 MB request body limit.
- Docker image designed for a persistent `./data` volume.

SMTP acceptance is recorded as `sent`. The first version does not yet track recipient delivery, opens, bounces or complaints. Those need delivery event webhooks from a mail transport or a delivery event ingestion endpoint.

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
  -d '{"from":"hello@example.com","to":"person@example.net","subject":"Hello","text":"Sent with Emailgo."}'
```

The `from` domain must be verified. Provide either `text`, `html`, or both. A `to` value can be one address or an array of up to 50 addresses. The API returns an Emailgo email ID on success. Invalid keys receive 401, unverified domains receive 403, and SMTP delivery errors receive 502.

## Domain authentication

Emailgo provides a TXT ownership record at `_emailgo.<domain>`. Configure SPF and DKIM records for your SMTP relay too. The relay remains responsible for final delivery, reputation and its own authentication records.

## Production deployment

Use the Dockerfile and mount a persistent volume at `/app/data`. Set all admin and SMTP values as server secrets. The message log contains recipient addresses and subject lines, so restrict and back up the data volume appropriately. The SQLite file requires a single app instance with persistent local storage; use a PostgreSQL adapter before scaling horizontally or deploying to ephemeral serverless functions. Put TLS and request-size protection at the trusted reverse proxy. Public production deployment has not been configured by this repository change.
