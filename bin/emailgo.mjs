#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const usage = `Emailgo CLI

Usage:
  npm run emailgo -- <resource> <action> [id] [options]

Environment:
  EMAILGO_BASE_URL  API origin, defaults to http://localhost:3000
  EMAILGO_API_KEY   Full-access or sending-only Emailgo key

Common commands:
  emails list [--limit 20] [--after id|--before id]
  emails send --data '{"from":"...","to":"...","subject":"...","text":"..."}'
  emails send --file ./message.json
  emails get <id>
  emails cancel <id>
  emails events <id>
  emails receiving [--limit 20] [--after id]
  emails received <id>
  emails attachments <id>
  api-keys list|create|get|rename|revoke [id] [--data JSON|--file PATH|--name NAME]
  domains list|create|get|verify|dns|delete [id] [--domain DOMAIN]
  contacts list|create|get|update|delete [id] [--data JSON|--file PATH]
  contact-properties list|create|get|update|delete [key] [--data JSON|--file PATH]
  segments list|create|get|update|delete|contacts [id] [--data JSON]
  topics list|create|get|update|delete [id] [--data JSON]
  broadcasts list|create|get|update|delete|queue|cancel [id] [--data JSON]
  automations list|create|get|update|archive|start|stop|runs|run|stop-run [id] [--run-id id] [--data JSON]
  events list|send [--data JSON] [--idempotency-key KEY]
  webhooks list|create|get|update|delete|deliveries|replay|rotate-secret [id] [--data JSON]
  suppressions list|add|get|remove|batch-add|batch-remove [email|id] [--data JSON]
  usage get
  logs list [--limit 20] [--after id|--before id]
  logs get <log_id>
`;

const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args[0] === 'help') {
  process.stdout.write(usage);
  process.exit(0);
}

const [resource, action, id] = args;
const flags = new Map();
for (let index = 2; index < args.length; index += 1) {
  const token = args[index];
  if (!token.startsWith('--')) continue;
  const name = token.slice(2);
  const next = args[index + 1];
  if (next && !next.startsWith('--')) { flags.set(name, next); index += 1; }
  else flags.set(name, true);
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const apiKey = process.env.EMAILGO_API_KEY;
if (!apiKey) fail('Set EMAILGO_API_KEY in the current shell. The CLI does not save credentials.');
const baseUrl = (process.env.EMAILGO_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const query = new URLSearchParams();
for (const key of ['limit', 'after', 'before', 'search', 'status', 'cursor', 'format']) if (flags.has(key)) query.set(key, String(flags.get(key)));
const withQuery = (path) => query.size ? `${path}?${query}` : path;
const item = (path) => `${path}/${encodeURIComponent(id || '')}`;
const jsonBody = async () => {
  if (flags.has('data')) return JSON.parse(String(flags.get('data')));
  if (flags.has('file')) return JSON.parse(await readFile(String(flags.get('file')), 'utf8'));
  if (resource === 'domains' && action === 'create' && flags.has('domain')) return { domain: flags.get('domain') };
  if (resource === 'api-keys' && action === 'rename' && flags.has('name')) return { name: flags.get('name') };
  if (resource === 'suppressions' && action === 'add' && id) return { email: id };
  return undefined;
};

const resourceRoutes = {
  emails: {
    list: ['GET', withQuery('/api/v1/emails')], send: ['POST', '/api/v1/emails'], batch: ['POST', '/api/v1/emails/batch'],
    get: ['GET', item('/api/v1/emails')], cancel: ['POST', `${item('/api/v1/emails')}/cancel`], events: ['GET', `${item('/api/v1/emails')}/events`],
    receiving: ['GET', withQuery('/api/v1/emails/receiving')], received: ['GET', item('/api/v1/emails/receiving')], attachments: ['GET', `${item('/api/v1/emails/receiving')}/attachments`],
  },
  'api-keys': {
    list: ['GET', '/api/v1/api-keys'], create: ['POST', '/api/v1/api-keys'], get: ['GET', item('/api/v1/api-keys')],
    rename: ['PATCH', item('/api/v1/api-keys')], revoke: ['DELETE', item('/api/v1/api-keys')],
  },
  domains: {
    list: ['GET', '/api/v1/domains'], create: ['POST', '/api/v1/domains'], get: ['GET', item('/api/v1/domains')],
    verify: ['POST', `${item('/api/v1/domains')}/verify`], dns: ['GET', `${item('/api/v1/domains')}/dns`], delete: ['DELETE', item('/api/v1/domains')],
  },
  contacts: {
    list: ['GET', withQuery('/api/v1/contacts')], create: ['POST', '/api/v1/contacts'], get: ['GET', item('/api/v1/contacts')],
    update: ['PATCH', item('/api/v1/contacts')], delete: ['DELETE', item('/api/v1/contacts')],
  },
  'contact-properties': {
    list: ['GET', '/api/v1/contact-properties'], create: ['POST', '/api/v1/contact-properties'], get: ['GET', item('/api/v1/contact-properties')],
    update: ['PATCH', item('/api/v1/contact-properties')], delete: ['DELETE', item('/api/v1/contact-properties')],
  },
  segments: {
    list: ['GET', '/api/v1/segments'], create: ['POST', '/api/v1/segments'], get: ['GET', item('/api/v1/segments')],
    update: ['PATCH', item('/api/v1/segments')], delete: ['DELETE', item('/api/v1/segments')], contacts: ['GET', `${item('/api/v1/segments')}/contacts`],
  },
  topics: {
    list: ['GET', '/api/v1/topics'], create: ['POST', '/api/v1/topics'], get: ['GET', item('/api/v1/topics')],
    update: ['PATCH', item('/api/v1/topics')], delete: ['DELETE', item('/api/v1/topics')],
  },
  broadcasts: {
    list: ['GET', '/api/v1/broadcasts'], create: ['POST', '/api/v1/broadcasts'], get: ['GET', item('/api/v1/broadcasts')],
    update: ['PATCH', item('/api/v1/broadcasts')], delete: ['DELETE', item('/api/v1/broadcasts')],
    queue: ['POST', `${item('/api/v1/broadcasts')}/send`], cancel: ['POST', `${item('/api/v1/broadcasts')}/cancel`],
  },
  automations: {
    list: ['GET', '/api/v1/automations'], create: ['POST', '/api/v1/automations'], get: ['GET', item('/api/v1/automations')],
    update: ['PATCH', item('/api/v1/automations')], archive: ['DELETE', item('/api/v1/automations')],
    start: ['POST', `${item('/api/v1/automations')}/start`], stop: ['POST', `${item('/api/v1/automations')}/stop`],
    runs: ['GET', withQuery(`${item('/api/v1/automations')}/runs`)],
    run: ['GET', `${item('/api/v1/automations')}/runs/${encodeURIComponent(String(flags.get('run-id') || ''))}`],
    'stop-run': ['POST', `${item('/api/v1/automations')}/runs/${encodeURIComponent(String(flags.get('run-id') || ''))}/stop`],
  },
  events: { list: ['GET', '/api/v1/events'], send: ['POST', '/api/v1/events'] },
  webhooks: {
    list: ['GET', '/api/v1/webhooks'], create: ['POST', '/api/v1/webhooks'], get: ['GET', item('/api/v1/webhooks')],
    update: ['PATCH', item('/api/v1/webhooks')], delete: ['DELETE', item('/api/v1/webhooks')],
    deliveries: ['GET', `${item('/api/v1/webhooks')}/deliveries`], replay: ['POST', `${item('/api/v1/webhooks')}/replay`],
    'rotate-secret': ['POST', `${item('/api/v1/webhooks')}/rotate-secret`],
  },
  suppressions: {
    list: ['GET', withQuery('/api/v1/suppressions')], add: ['POST', '/api/v1/suppressions'],
    get: ['GET', item('/api/v1/suppressions')], remove: ['DELETE', item('/api/v1/suppressions')],
    'batch-add': ['POST', '/api/v1/suppressions/batch'], 'batch-remove': ['DELETE', '/api/v1/suppressions/batch'],
  },
  usage: { get: ['GET', '/api/v1/usage'] },
  logs: { list: ['GET', withQuery('/api/v1/logs')], get: ['GET', item('/api/v1/logs')] },
};

const route = resourceRoutes[resource]?.[action];
if (!route) fail(`Unknown command: ${resource} ${action}. Run with --help for available commands.`, 2);
let body;
try { body = await jsonBody(); }
catch (error) { fail(`Could not read JSON input: ${error instanceof Error ? error.message : 'invalid input'}`, 2); }
const [method, path] = route;
const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
if (body !== undefined) headers['Content-Type'] = 'application/json';
if (flags.has('idempotency-key')) headers['Idempotency-Key'] = String(flags.get('idempotency-key'));
let response;
try {
  response = await fetch(`${baseUrl}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
} catch (error) {
  fail(`Request failed: ${error instanceof Error ? error.message : 'network error'}`);
}
const text = await response.text();
let result;
try { result = text ? JSON.parse(text) : null; }
catch { result = { message: text }; }
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!response.ok) process.exitCode = 1;
