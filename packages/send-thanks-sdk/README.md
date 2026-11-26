# @send-thanks/sdk

Small dependency-free Node.js client for the Send, thanks REST API.

```js
import { SendThanks } from '@send-thanks/sdk';

const sendThanks = new SendThanks(process.env.EMAILGO_API_KEY, {
  baseUrl: process.env.EMAILGO_BASE_URL,
});

const { data, error } = await sendThanks.emails.send({
  from: 'hello@example.com',
  to: 'person@example.net',
  subject: 'Welcome',
  html: '<p>Welcome to the service.</p>',
}, { idempotencyKey: 'welcome/123' });

if (error) throw error;
console.log(data.id);
```

The client covers the currently implemented message, key, domain, contact, contact property, segment, topic, broadcast, automation, event, webhook, suppression, usage, logs and template endpoints. Email metrics are available through `emails.metrics(query)`. Contact segment membership can be managed with `contacts.segments.add/list/remove`. Event schemas support `events.create/list/get/update/remove`; trigger an event with `events.send`, and inspect received names with `events.observed`. Webhook event history, payloads, attempts, and replay are available under `webhooks.events`. Automations can be duplicated as drafts and active runs can be canceled with `automations.duplicate(id)` and `automations.cancelRun(id, runId)`. Templates support aliases, versions, draft updates, publishing, duplication, version history through `templates.versions(id)`, and sending through `emails.send({ template: { id, variables } })`. Template list responses contain metadata; `templates.get(id)` returns content. Contact property fallback values are applied to broadcast personalization when a contact value is missing or null. API results use `{ data, error }`. Network errors and non-success HTTP responses are returned as `error`; the SDK does not retry automatically.
