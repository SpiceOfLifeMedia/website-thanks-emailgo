# @emailgo/sdk

Small dependency-free Node.js client for the Emailgo REST API.

```js
import { Emailgo } from '@emailgo/sdk';

const emailgo = new Emailgo(process.env.EMAILGO_API_KEY, {
  baseUrl: process.env.EMAILGO_BASE_URL,
});

const { data, error } = await emailgo.emails.send({
  from: 'hello@example.com',
  to: 'person@example.net',
  subject: 'Welcome',
  html: '<p>Welcome to the service.</p>',
}, { idempotencyKey: 'welcome/123' });

if (error) throw error;
console.log(data.id);
```

The client covers the currently implemented message, key, domain, contact, contact property, segment, topic, broadcast, automation, event, webhook, suppression and usage endpoints. Contact property fallback values are applied to broadcast personalization when a contact value is missing or null. API results use `{ data, error }`. Network errors and non-success HTTP responses are returned as `error`; the SDK does not retry automatically.
