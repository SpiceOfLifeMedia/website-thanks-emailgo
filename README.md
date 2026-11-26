# Send, thanks

Send, thanks is a private email sending workspace for Website Thanks. It manages API keys, sender domain verification, request validation, a message log, a manual block list and a dashboard. Outbound delivery uses the SMTP connection configured by the operator.

## What works

- Admin password sign in with signed, HTTP only sessions.
- Create and revoke API keys. Key hashes are stored, and each new secret is shown once.
- Add sender domains and verify ownership with a DNS TXT record.
- Send transactional emails through the existing `/api/v1/emails` API route.
- Persist recipients, subject lines, internal handoff details, failures and key last-use times in PostgreSQL in production and SQLite during local development. Email bodies are handed off but are not saved to the message log.
- View recent send requests and filter the message log.
- Add and remove addresses from a persistent block list. A request containing a blocked recipient is rejected before sending.
- Apply a per-key limit of 60 requests per minute, a 1 MB request body limit and 24-hour idempotency keys.
- Retrieve message history through authenticated `GET /api/v1/emails` and `GET /api/v1/emails/:id` endpoints.
- Run in Docker with a persistent `./data` volume.

The dashboard labels a message `Sent` when the SMTP server accepts it for handoff. Recipient delivery, opens, bounces and complaints are not tracked. The usage meter counts requests recorded this calendar month. There is no monthly sending cap configured.

## Run locally

Requires Node.js 24 or later.

```sh
cp .env.example .env.local
# Fill in unique admin/session secrets and SMTP connection settings.
npm install
npm run dev
```

Open `http://localhost:3000`. The SQLite database is created under `./data`. Without admin secrets, the app shows first-run setup. Without SMTP settings, requests are safely recorded as failed and no email is delivered.

## API

Create a key in **API keys**, verify a domain in **Domains**, then send:

```sh
curl -X POST http://localhost:3000/api/v1/emails \
  -H 'Authorization: Bearer st_live_your_key' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-123-confirmation' \
  -d '{"from":"hello@example.com","to":"person@example.net","subject":"Hello","text":"Sent with Send, thanks."}'
```

The `from` domain must be verified. Provide either `text`, `html`, or both. An `Idempotency-Key` makes retries safe for 24 hours. Reusing it with different content returns 409. A `to` value can be one address or an array of up to 50 addresses. If any recipient is on the block list, the whole request is rejected. Invalid keys receive 401, unverified domains receive 403, and SMTP handoff failures receive 502.

List messages with optional pagination:

```sh
curl 'http://localhost:3000/api/v1/emails?limit=20' \
  -H 'Authorization: Bearer st_live_your_key'
```

Follow `next_after` as the `after` query parameter to load the next page. Retrieve one message with `GET /api/v1/emails/{email_id}`. The API returns message status and stored request fields. Message bodies and SMTP response details are not returned.

## Domain authentication

New sender domains receive a TXT ownership record at `_send-thanks.<domain>`. Existing ownership records continue to verify. Configure SPF and DKIM records for your sending connection too.

## Production deployment

Set a dedicated PostgreSQL connection string as `DATABASE_URL`. The health endpoint checks database availability, and managed deployments fail closed rather than falling back to temporary SQLite. Set `EMAILGO_ADMIN_PASSWORD`, `EMAILGO_SESSION_SECRET` and SMTP settings as server secrets.

For a Docker host, mount a persistent volume at `/app/data` and set admin and SMTP values as server secrets. SQLite requires one app instance with persistent local storage. You can also set `DATABASE_URL` to use PostgreSQL. The message log contains recipient addresses and subject lines, so restrict access and configure backups. Put TLS and request-size protection at the trusted reverse proxy.
