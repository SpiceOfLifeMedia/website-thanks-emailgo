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
  emails metrics [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--metrics sent,opened] [--dimensions period,domain]
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
  contacts list|create|get|update|delete|segments|add-segment|remove-segment [id_or_email] [--segment-id ID] [--data JSON|--file PATH]
  contact-imports list|get|create [id] [--file ./contacts.csv --column-map JSON] [--on-conflict upsert|skip]
  contact-properties list|create|get|update|delete [key] [--data JSON|--file PATH]
  segments list|create|get|update|delete|contacts|metrics [id] [--segment-id ID] [--metrics all_contacts,subscribers]
  topics list|create|get|update|delete [id] [--data JSON]
  broadcasts list|create|get|update|delete|queue|cancel|duplicate|recipients|clicked-links [id] [--data JSON] [--type opened|clicked]
  automations list|create|get|update|archive|duplicate|start|stop|runs|run|cancel-run|stop-run [id] [--run-id id] [--data JSON]
  events list|create|get|update|delete|send|observed [id_or_name] [--data JSON] [--idempotency-key KEY]
  webhooks list|create|get|update|delete|deliveries|replay|rotate-secret|events|event|attempts|replay-event [webhook_id] [--event-id ID] [--data JSON]
  suppressions list|add|get|remove|batch-add|batch-remove [email|id] [--data JSON]
  usage get
  logs list [--limit 20] [--after id|--before id]
  logs get <log_id>
  templates list [--limit 20] [--after id|--before id]
  templates create --data '{"name":"welcome","html":"<p>Hello {{{NAME}}}</p>"}'
  templates get|update|delete|publish|duplicate <id_or_alias> [--data JSON|--file PATH]
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
for (const key of ['limit', 'after', 'before', 'search', 'status', 'type', 'cursor', 'format', 'start-date', 'end-date', 'timezone', 'granularity', 'metrics', 'dimensions', 'domain-id', 'email-id', 'broadcast-id', 'segment-id']) {
  if (flags.has(key)) query.set(key.replaceAll('-', '_'), String(flags.get(key)));
}
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
    metrics: ['GET', withQuery('/api/v1/emails/metrics')],
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
    segments: ['GET', `${item('/api/v1/contacts')}/segments`],
    'add-segment': ['POST', `${item('/api/v1/contacts')}/segments/${encodeURIComponent(String(flags.get('segment-id') || ''))}`],
    'remove-segment': ['DELETE', `${item('/api/v1/contacts')}/segments/${encodeURIComponent(String(flags.get('segment-id') || ''))}`],
  },
  'contact-imports': {
    list: ['GET', withQuery('/api/v1/contacts/imports')],
    get: ['GET', item('/api/v1/contacts/imports')],
    create: ['POST', '/api/v1/contacts/imports'],
  },
  'contact-properties': {
    list: ['GET', '/api/v1/contact-properties'], create: ['POST', '/api/v1/contact-properties'], get: ['GET', item('/api/v1/contact-properties')],
    update: ['PATCH', item('/api/v1/contact-properties')], delete: ['DELETE', item('/api/v1/contact-properties')],
  },
  segments: {
    list: ['GET', '/api/v1/segments'], create: ['POST', '/api/v1/segments'], get: ['GET', item('/api/v1/segments')],
    update: ['PATCH', item('/api/v1/segments')], delete: ['DELETE', item('/api/v1/segments')], contacts: ['GET', `${item('/api/v1/segments')}/contacts`],
    metrics: ['GET', withQuery('/api/v1/segments/metrics')],
  },
  topics: {
    list: ['GET', '/api/v1/topics'], create: ['POST', '/api/v1/topics'], get: ['GET', item('/api/v1/topics')],
    update: ['PATCH', item('/api/v1/topics')], delete: ['DELETE', item('/api/v1/topics')],
  },
  broadcasts: {
    list: ['GET', '/api/v1/broadcasts'], create: ['POST', '/api/v1/broadcasts'], get: ['GET', item('/api/v1/broadcasts')],
    update: ['PATCH', item('/api/v1/broadcasts')], delete: ['DELETE', item('/api/v1/broadcasts')],
    queue: ['POST', `${item('/api/v1/broadcasts')}/send`], cancel: ['POST', `${item('/api/v1/broadcasts')}/cancel`],
    duplicate: ['POST', `${item('/api/v1/broadcasts')}/duplicate`],
    recipients: ['GET', withQuery(`${item('/api/v1/broadcasts')}/recipients`)],
    'clicked-links': ['GET', withQuery(`${item('/api/v1/broadcasts')}/clicked-links`)],
  },
  automations: {
    list: ['GET', '/api/v1/automations'], create: ['POST', '/api/v1/automations'], get: ['GET', item('/api/v1/automations')],
    update: ['PATCH', item('/api/v1/automations')], archive: ['DELETE', item('/api/v1/automations')], duplicate: ['POST', `${item('/api/v1/automations')}/duplicate`],
    start: ['POST', `${item('/api/v1/automations')}/start`], stop: ['POST', `${item('/api/v1/automations')}/stop`],
    runs: ['GET', withQuery(`${item('/api/v1/automations')}/runs`)],
    run: ['GET', `${item('/api/v1/automations')}/runs/${encodeURIComponent(String(flags.get('run-id') || ''))}`],
    'stop-run': ['POST', `${item('/api/v1/automations')}/runs/${encodeURIComponent(String(flags.get('run-id') || ''))}/cancel`],
    'cancel-run': ['POST', `${item('/api/v1/automations')}/runs/${encodeURIComponent(String(flags.get('run-id') || ''))}/cancel`],
  },
  events: {
    list: ['GET', '/api/v1/events'], create: ['POST', '/api/v1/events'],
    get: ['GET', item('/api/v1/events')], update: ['PATCH', item('/api/v1/events')], delete: ['DELETE', item('/api/v1/events')],
    send: ['POST', '/api/v1/events/send'], observed: ['GET', '/api/v1/events/observed'],
  },
  webhooks: {
    list: ['GET', '/api/v1/webhooks'], create: ['POST', '/api/v1/webhooks'], get: ['GET', item('/api/v1/webhooks')],
    update: ['PATCH', item('/api/v1/webhooks')], delete: ['DELETE', item('/api/v1/webhooks')],
    deliveries: ['GET', `${item('/api/v1/webhooks')}/deliveries`], replay: ['POST', `${item('/api/v1/webhooks')}/replay`],
    'rotate-secret': ['POST', `${item('/api/v1/webhooks')}/rotate-secret`],
    events: ['GET', withQuery(`${item('/api/v1/webhooks')}/events`)],
    event: ['GET', `${item('/api/v1/webhooks')}/events/${encodeURIComponent(String(flags.get('event-id') || ''))}`],
    attempts: ['GET', withQuery(`${item('/api/v1/webhooks')}/events/${encodeURIComponent(String(flags.get('event-id') || ''))}/attempts`)],
    'replay-event': ['POST', `${item('/api/v1/webhooks')}/events/${encodeURIComponent(String(flags.get('event-id') || ''))}/replay`],
  },
  suppressions: {
    list: ['GET', withQuery('/api/v1/suppressions')], add: ['POST', '/api/v1/suppressions'],
    get: ['GET', item('/api/v1/suppressions')], remove: ['DELETE', item('/api/v1/suppressions')],
    'batch-add': ['POST', '/api/v1/suppressions/batch'], 'batch-remove': ['DELETE', '/api/v1/suppressions/batch'],
  },
  usage: { get: ['GET', '/api/v1/usage'] },
  logs: { list: ['GET', withQuery('/api/v1/logs')], get: ['GET', item('/api/v1/logs')] },
  templates: {
    list: ['GET', withQuery('/api/v1/templates')], create: ['POST', '/api/v1/templates'],
    get: ['GET', item('/api/v1/templates')], update: ['PATCH', item('/api/v1/templates')],
    delete: ['DELETE', item('/api/v1/templates')], publish: ['POST', `${item('/api/v1/templates')}/publish`],
    duplicate: ['POST', `${item('/api/v1/templates')}/duplicate`],
  },
};

const route = resourceRoutes[resource]?.[action];
if (!route) fail(`Unknown command: ${resource} ${action}. Run with --help for available commands.`, 2);
if ((action === 'add-segment' || action === 'remove-segment') && !flags.get('segment-id')) fail(`${action} requires --segment-id.`, 2);
let body;
try { body = resource === 'contact-imports' && action === 'create' ? undefined : await jsonBody(); }
catch (error) { fail(`Could not read JSON input: ${error instanceof Error ? error.message : 'invalid input'}`, 2); }
const [method, path] = route;
const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
if (body !== undefined) headers['Content-Type'] = 'application/json';
if (flags.has('idempotency-key')) headers['Idempotency-Key'] = String(flags.get('idempotency-key'));
let response;
try {
  if (resource === 'contact-imports' && action === 'create') {
    if (!flags.has('file') || !flags.has('column-map')) fail('contact-imports create requires --file and --column-map.', 2);
    const form = new FormData();
    form.append('file', new Blob([await readFile(String(flags.get('file')))]), 'contacts.csv');
    try { form.append('column_map', JSON.stringify(JSON.parse(String(flags.get('column-map'))))); }
    catch { fail('--column-map must contain valid JSON.', 2); }
    if (flags.has('on-conflict')) form.append('on_conflict', String(flags.get('on-conflict')));
    if (flags.has('segments')) form.append('segments', String(flags.get('segments')));
    if (flags.has('topics')) form.append('topics', String(flags.get('topics')));
    response = await fetch(`${baseUrl}${path}`, { method, headers, body: form });
  } else {
    response = await fetch(`${baseUrl}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
} catch (error) {
  fail(`Request failed: ${error instanceof Error ? error.message : 'network error'}`);
}
const text = await response.text();
let result;
try { result = text ? JSON.parse(text) : null; }
catch { result = { message: text }; }
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!response.ok) process.exitCode = 1;
