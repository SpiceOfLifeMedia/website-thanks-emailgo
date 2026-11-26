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

The client covers the currently implemented message, key, domain, contact, segment, topic, broadcast, automation, event, webhook and usage endpoints. API results use `{ data, error }`. Network errors and non-success HTTP responses are returned as `error`; the SDK does not retry automatically.
