import { McpServer } from '@modelcontextprotocol/server';
import { SendThanks } from '../../packages/send-thanks-sdk/index.mjs';
import { sanitizeCustomerCopy } from './customer-copy.ts';
import * as z from 'zod/v4';

const jsonObject = z.record(z.string(), z.unknown());
const filterValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()]))]);
const filters = z.record(z.string(), filterValue).optional();
const exportFilters = z.object({ resource: z.enum(['emails', 'received_emails', 'broadcasts', 'contacts', 'domains', 'logs', 'api_keys']), search: z.string().optional(), status: z.string().optional() });
const maxMcpAttachmentBytes = 4 * 1024 * 1024;
const idSchema = z.object({ id: z.string().min(1).max(200) });
const deleteSchema = z.object({ id: z.string().min(1).max(200), confirm: z.literal(true).describe('Set true only after the user explicitly confirmed this deletion.') });
const sendAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const deleteAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const secretFields = /^(?:secret|signing_secret|signingSecret|webhook_secret|webhookSecret|password|authorization|api_key|apiKey|api_key_secret|apiKeySecret)$/i;
const liveKeyPattern = /\b(?:eg|st)_live_[A-Za-z0-9_-]{8,}\b/g;
const webhookSecretPattern = /\bwhsec_[A-Za-z0-9_-]{8,}\b/g;

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === 'string') return sanitizeCustomerCopy(value).replace(liveKeyPattern, '[redacted key]').replace(webhookSecretPattern, '[redacted secret]');
  if (!value || typeof value !== 'object') return value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return '[binary content omitted]';
  if (value instanceof Error) return { name: value.name, message: redactSecrets(value.message), ...(Number.isInteger(value.status) ? { status: value.status } : {}), ...(value.details ? { details: redactSecrets(value.details) } : {}) };
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [sanitizeCustomerCopy(key), secretFields.test(key) ? '[redacted]' : redactSecrets(child)]));
}

function toolResult(value) {
  if (value && typeof value === 'object' && value.error) return toolError(value.error);
  const payload = value && typeof value === 'object' && Object.hasOwn(value, 'data') ? value.data : value;
  const safePayload = redactSecrets(payload ?? null);
  const text = typeof safePayload === 'string' ? safePayload : JSON.stringify(safePayload, null, 2);
  return { content: [{ type: 'text', text }] };
}

function toolError(cause) {
  const message = cause instanceof Error ? cause.message : 'The request could not be completed.';
  const safeMessage = redactSecrets(message);
  return { content: [{ type: 'text', text: safeMessage || 'The request could not be completed.' }], isError: true };
}

export function createSendThanksMcpServer(options = {}) {
  const apiKey = options.apiKey ?? process.env.EMAILGO_API_KEY;
  if (!options.api && (!apiKey || !apiKey.trim())) throw new Error('Set EMAILGO_API_KEY in the MCP server process environment.');
  const api = options.api ?? new SendThanks(apiKey, {
    baseUrl: options.baseUrl ?? process.env.EMAILGO_BASE_URL ?? 'http://localhost:3000',
    ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
  });
  const server = new McpServer({
    name: 'Send, thanks',
    version: '0.2.0',
    instructions: 'Use these tools only for actions the user requested. Sending email, triggering events, changing suppression state, publishing templates, and cancelling campaigns can affect real recipients. Deletion tools require confirm=true. Never reveal API keys or one-time signing secrets.',
  });

  function register(name, description, inputSchema, run, annotations = writeAnnotations) {
    server.registerTool(name, { description, inputSchema, annotations }, async (args) => {
      try { return toolResult(await run(args)); }
      catch (cause) { return toolError(cause); }
    });
  }

  function registerRaw(name, description, inputSchema, run, annotations = readAnnotations) {
    server.registerTool(name, { description, inputSchema, annotations }, async (args) => {
      try { return await run(args); }
      catch (cause) { return toolError(cause); }
    });
  }

  register('send_email', 'Send one transactional email. This contacts real recipients; call only after the user asked to send and supplied a valid sender, recipients, subject, and content.', z.object({ body: jsonObject, idempotency_key: z.string().min(1).max(256).optional() }), ({ body, idempotency_key }) => api.emails.send(body, { idempotencyKey: idempotency_key }), sendAnnotations);
  register('send_email_batch', 'Send a batch of transactional emails. This contacts real recipients; call only after the user explicitly requested the batch.', z.object({ emails: z.array(jsonObject).min(1).max(100), idempotency_key: z.string().min(1).max(256).optional() }), ({ emails, idempotency_key }) => api.emails.sendBatch(emails, { idempotencyKey: idempotency_key }), sendAnnotations);
  register('list_emails', 'List sent and scheduled emails with optional supported filters and pagination.', z.object({ filters }), ({ filters }) => api.emails.list(filters), readAnnotations);
  register('get_email', 'Retrieve one email by its ID.', idSchema, ({ id }) => api.emails.get(id), readAnnotations);
  register('update_email', 'Update permitted metadata for one scheduled email.', z.object({ id: z.string().min(1), body: jsonObject }), ({ id, body }) => api.emails.update(id, body));
  register('cancel_email', 'Cancel one scheduled email before it is handed off.', idSchema, ({ id }) => api.emails.cancel(id));
  register('get_email_events', 'List tracking and delivery events for one email.', idSchema, ({ id }) => api.emails.events(id), readAnnotations);
  register('get_email_metrics', 'Retrieve sending, delivery, engagement, and unsubscribe metrics with optional filters.', z.object({ filters }), ({ filters }) => api.emails.metrics(filters), readAnnotations);
  register('list_received_emails', 'List inbound emails accepted through the configured receiving bridge.', z.object({ filters }), ({ filters }) => api.emails.receiving.list(filters), readAnnotations);
  register('get_received_email', 'Retrieve one inbound email by its ID.', idSchema, ({ id }) => api.emails.receiving.get(id), readAnnotations);
  register('list_received_email_attachments', 'List attachment metadata for one inbound email. File contents are not returned by this tool.', idSchema, ({ id }) => api.emails.receiving.attachments(id), readAnnotations);
  registerRaw('download_received_email_attachment', 'Retrieve an inbound email attachment into the agent context. This exposes private file contents; call only when the user requested the file. Attachments larger than 4 MiB are refused.', z.object({ id: z.string().min(1), attachment_id: z.string().min(1) }), async ({ id, attachment_id }) => {
    const listed = await api.emails.receiving.attachments(id);
    if (listed?.error) return toolError(listed.error);
    const attachment = listed?.data?.data?.find((item) => item.id === attachment_id);
    if (!attachment) return toolError(new Error('Received email attachment not found.'));
    const size = Number(attachment.size);
    if (!Number.isFinite(size) || size < 0 || size > maxMcpAttachmentBytes) return toolError(new Error('This attachment is larger than the 4 MiB MCP download limit.'));
    const downloaded = await api.emails.receiving.downloadAttachment(id, attachment_id);
    if (downloaded?.error) return toolError(downloaded.error);
    const bytes = Buffer.from(downloaded?.data ?? new ArrayBuffer(0));
    if (bytes.byteLength > maxMcpAttachmentBytes) return toolError(new Error('This attachment is larger than the 4 MiB MCP download limit.'));
    const metadata = redactSecrets({ id: attachment.id, filename: attachment.filename, content_type: attachment.content_type, size: bytes.byteLength });
    const mimeType = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(metadata.content_type ?? '') ? metadata.content_type : 'application/octet-stream';
    return { content: [
      { type: 'text', text: JSON.stringify(metadata, null, 2) },
      { type: 'resource', resource: { uri: `send-thanks://received-emails/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachment_id)}`, mimeType, blob: bytes.toString('base64') } },
    ] };
  });
  register('get_usage', 'Retrieve current daily and monthly usage counts, configured limits, and API request rate limit.', z.object({}), () => api.usage.get(), readAnnotations);

  register('list_domains', 'List sender domains in the account.', z.object({}), () => api.domains.list(), readAnnotations);
  register('create_domain', 'Add a sender domain and return the ownership record needed for verification.', z.object({ domain: z.string().min(1).max(253) }), ({ domain }) => api.domains.create({ domain }));
  register('get_domain', 'Retrieve a sender domain by ID.', idSchema, ({ id }) => api.domains.get(id), readAnnotations);
  register('update_domain', 'Update supported settings for one sender domain.', z.object({ id: z.string().min(1), body: jsonObject }), ({ id, body }) => api.domains.update(id, body));
  register('verify_domain', 'Check the sender domain ownership record and update its verification status.', idSchema, ({ id }) => api.domains.verify(id));
  register('get_domain_dns', 'Read DNS diagnostics for one sender domain. This tool does not change DNS.', idSchema, ({ id }) => api.domains.dns(id), readAnnotations);
  register('delete_domain', 'Delete a sender domain. This is a destructive action and requires explicit user confirmation.', deleteSchema, ({ id }) => api.domains.delete(id), deleteAnnotations);

  register('list_contacts', 'List contacts using optional filters and pagination.', z.object({ filters }), ({ filters }) => api.contacts.list(filters), readAnnotations);
  register('create_contact', 'Create or update a contact using the supplied contact record.', z.object({ body: jsonObject }), ({ body }) => api.contacts.create(body));
  register('get_contact', 'Retrieve one contact by ID.', idSchema, ({ id }) => api.contacts.get(id), readAnnotations);
  register('update_contact', 'Update one contact using supported contact fields.', z.object({ id: z.string().min(1), body: jsonObject }), ({ id, body }) => api.contacts.update(id, body));
  register('delete_contact', 'Delete a contact and its associated preferences. This cannot be undone and requires explicit user confirmation.', deleteSchema, ({ id }) => api.contacts.delete(id), deleteAnnotations);
  register('list_contact_topics', 'List topic preferences for one contact.', idSchema, ({ id }) => api.contacts.topics.list(id), readAnnotations);
  register('update_contact_topics', 'Update topic preferences for one contact.', z.object({ id: z.string().min(1), body: jsonObject }), ({ id, body }) => api.contacts.topics.update(id, body));
  register('list_contact_segments', 'List saved segment memberships for one contact.', idSchema, ({ id }) => api.contacts.segments.list({ contactId: id }), readAnnotations);
  register('add_contact_to_segment', 'Add a contact to a segment, preserving the explicit membership override.', z.object({ contact_id: z.string().min(1), segment_id: z.string().min(1) }), ({ contact_id, segment_id }) => api.contacts.segments.add({ contactId: contact_id, segmentId: segment_id }));
  register('remove_contact_from_segment', 'Remove a contact from a segment and retain the exclusion.', z.object({ contact_id: z.string().min(1), segment_id: z.string().min(1) }), ({ contact_id, segment_id }) => api.contacts.segments.remove({ contactId: contact_id, segmentId: segment_id }));
  register('create_contact_import', 'Import contacts from CSV text using a column map. The import changes contact records and should only run when the user requested it.', z.object({ csv: z.string().min(1).max(2_000_000), column_map: jsonObject, on_conflict: z.enum(['upsert', 'skip']).optional(), segments: z.array(z.string()).optional(), topics: z.array(z.string()).optional() }), ({ csv, column_map, on_conflict, segments, topics }) => api.contacts.imports.create(new Blob([csv], { type: 'text/csv' }), { column_map, on_conflict, segments, topics }));
  register('list_contact_imports', 'List recent contact import jobs.', z.object({ filters }), ({ filters }) => api.contacts.imports.list(filters), readAnnotations);
  register('get_contact_import', 'Retrieve one contact import job by ID.', idSchema, ({ id }) => api.contacts.imports.get(id), readAnnotations);

  register('list_segments', 'List saved live segments.', z.object({}), () => api.segments.list(), readAnnotations);
  register('create_segment', 'Create a saved contact segment.', z.object({ body: jsonObject }), ({ body }) => api.segments.create(body));
  register('get_segment', 'Retrieve one contact segment by ID.', idSchema, ({ id }) => api.segments.get(id), readAnnotations);
  register('update_segment', 'Update one saved segment.', z.object({ id: z.string().min(1), body: jsonObject }), ({ id, body }) => api.segments.update(id, body));
  register('get_segment_contacts', 'List contacts currently matching a segment.', z.object({ id: z.string().min(1), filters }), ({ id, filters }) => api.segments.contacts(id, filters), readAnnotations);
  register('delete_segment', 'Delete a saved segment. This is destructive and requires explicit user confirmation.', deleteSchema, ({ id }) => api.segments.delete(id), deleteAnnotations);
  register('get_segment_metrics', 'Retrieve contact counts for the account or selected segments.', z.object({ filters }), ({ filters }) => api.segments.metrics(filters), readAnnotations);

  register('list_topics', 'List contact preference topics.', z.object({}), () => api.topics.list(), readAnnotations);
  register('create_topic', 'Create a contact preference topic.', z.object({ body: jsonObject }), ({ body }) => api.topics.create(body));
  register('get_topic', 'Retrieve one preference topic by ID.', idSchema, ({ id }) => api.topics.get(id), readAnnotations);
  register('update_topic', 'Update or archive a preference topic.', z.object({ id: z.string().min(1), body: jsonObject }), ({ id, body }) => api.topics.update(id, body));
  register('delete_topic', 'Delete a preference topic. This is destructive and requires explicit user confirmation.', deleteSchema, ({ id }) => api.topics.delete(id), deleteAnnotations);

  register('list_templates', 'List reusable email templates with optional pagination.', z.object({ filters }), ({ filters }) => api.templates.list(filters), readAnnotations);
  register('create_template', 'Create an email template draft.', z.object({ body: jsonObject }), ({ body }) => api.templates.create(body));
  register('get_template', 'Retrieve a template by ID or alias.', idSchema, ({ id }) => api.templates.get(id), readAnnotations);
  register('update_template', 'Update a template draft.', z.object({ id: z.string().min(1), body: jsonObject }), ({ id, body }) => api.templates.update(id, body));
  register('publish_template', 'Validate and publish the current template draft.', idSchema, ({ id }) => api.templates.publish(id));
  register('duplicate_template', 'Create a draft copy of a template.', idSchema, ({ id }) => api.templates.duplicate(id));
  register('delete_template', 'Delete a template. This is destructive and requires explicit user confirmation.', deleteSchema, ({ id }) => api.templates.delete(id), deleteAnnotations);
  register('list_template_versions', 'List the saved versions of a template.', idSchema, ({ id }) => api.templates.versions(id), readAnnotations);

  register('list_broadcasts', 'List email broadcasts and their current states.', z.object({}), () => api.broadcasts.list(), readAnnotations);
  register('create_broadcast', 'Create a broadcast draft.', z.object({ body: jsonObject }), ({ body }) => api.broadcasts.create(body));
  register('get_broadcast', 'Retrieve one broadcast by ID.', idSchema, ({ id }) => api.broadcasts.get(id), readAnnotations);
  register('update_broadcast', 'Update a broadcast draft.', z.object({ id: z.string().min(1), body: jsonObject }), ({ id, body }) => api.broadcasts.update(id, body));
  register('send_broadcast', 'Queue or schedule a broadcast. This may send to many people; include confirm_send=true only after the user explicitly approved this broadcast.', z.object({ id: z.string().min(1), body: jsonObject, confirm_send: z.literal(true) }), ({ id, body }) => api.broadcasts.send(id, body), sendAnnotations);
  register('cancel_broadcast', 'Cancel a scheduled or in-progress broadcast before it is complete.', idSchema, ({ id }) => api.broadcasts.cancel(id));
  register('duplicate_broadcast', 'Create a draft copy of a broadcast, including a previously sent broadcast.', idSchema, ({ id }) => api.broadcasts.duplicate(id));
  register('get_broadcast_recipients', 'List per-recipient broadcast analytics.', z.object({ id: z.string().min(1), filters }), ({ id, filters }) => api.broadcasts.recipients(id, filters), readAnnotations);
  register('get_broadcast_clicked_links', 'List clicked-link analytics for a broadcast.', z.object({ id: z.string().min(1), filters }), ({ id, filters }) => api.broadcasts.clickedLinks(id, filters), readAnnotations);
  register('delete_broadcast', 'Delete a broadcast draft. This is destructive and requires explicit user confirmation.', deleteSchema, ({ id }) => api.broadcasts.delete(id), deleteAnnotations);

  register('list_automations', 'List event-triggered automations.', z.object({}), () => api.automations.list(), readAnnotations);
  register('create_automation', 'Create an automation draft.', z.object({ body: jsonObject }), ({ body }) => api.automations.create(body));
  register('get_automation', 'Retrieve an automation by ID.', idSchema, ({ id }) => api.automations.get(id), readAnnotations);
  register('update_automation', 'Update or pause an automation.', z.object({ id: z.string().min(1), body: jsonObject }), ({ id, body }) => api.automations.update(id, body));
  register('start_automation', 'Activate an automation for future event-triggered runs.', idSchema, ({ id }) => api.automations.start(id));
  register('stop_automation', 'Pause an automation so it does not start new runs.', idSchema, ({ id }) => api.automations.stop(id));
  register('duplicate_automation', 'Create a draft copy of an automation.', idSchema, ({ id }) => api.automations.duplicate(id));
  register('list_automation_runs', 'List runs for one automation.', z.object({ id: z.string().min(1), filters }), ({ id, filters }) => api.automations.runs(id, filters), readAnnotations);
  register('get_automation_run', 'Retrieve the step history and context of one automation run.', z.object({ id: z.string().min(1), run_id: z.string().min(1) }), ({ id, run_id }) => api.automations.getRun(id, run_id), readAnnotations);
  register('retry_automation_run', 'Retry a failed automation run from its failed step. Completed steps are preserved. If the failed step sends email, retrying may send a duplicate; pass confirm_send_retry=true only after the user explicitly approved retrying that run.', z.object({ id: z.string().min(1), run_id: z.string().min(1), confirm_send_retry: z.literal(true).optional() }), ({ id, run_id, confirm_send_retry }) => api.automations.retryRun(id, run_id, confirm_send_retry ? { confirm_send_retry } : {}), sendAnnotations);
  register('stop_automation_run', 'Stop one running or waiting automation run.', z.object({ id: z.string().min(1), run_id: z.string().min(1) }), ({ id, run_id }) => api.automations.stopRun(id, run_id));
  register('archive_automation', 'Archive an automation. This is destructive and requires explicit user confirmation.', deleteSchema, ({ id }) => api.automations.archive(id), deleteAnnotations);
  register('cancel_automation_run', 'Cancel one running or waiting automation run.', z.object({ id: z.string().min(1), run_id: z.string().min(1) }), ({ id, run_id }) => api.automations.cancelRun(id, run_id));

  register('list_events', 'List custom event definitions.', z.object({}), () => api.events.list(), readAnnotations);
  register('create_event_definition', 'Create a custom event definition.', z.object({ body: jsonObject }), ({ body }) => api.events.create(body));
  register('get_event_definition', 'Retrieve a custom event definition by ID or name.', idSchema, ({ id }) => api.events.get(id), readAnnotations);
  register('update_event_definition', 'Update a custom event definition.', z.object({ id: z.string().min(1), body: jsonObject }), ({ id, body }) => api.events.update(id, body));
  register('send_event', 'Record a custom event that can start or resume automations and send messages. Call only when the user requested this event.', z.object({ body: jsonObject, idempotency_key: z.string().min(1).max(256).optional() }), ({ body, idempotency_key }) => api.events.send(body, { idempotencyKey: idempotency_key }), sendAnnotations);
  register('list_observed_events', 'List event names received by the account.', z.object({}), () => api.events.observed(), readAnnotations);
  register('delete_event_definition', 'Delete a custom event definition. This is destructive and requires explicit user confirmation.', deleteSchema, ({ id }) => api.events.remove(id), deleteAnnotations);

  register('list_webhooks', 'List configured webhook endpoints.', z.object({}), () => api.webhooks.list(), readAnnotations);
  register('create_webhook', 'Create a signed webhook endpoint. A one-time signing secret may be returned; handle it as a secret.', z.object({ body: jsonObject }), ({ body }) => api.webhooks.create(body));
  register('get_webhook', 'Retrieve a webhook endpoint and its event filters.', idSchema, ({ id }) => api.webhooks.get(id), readAnnotations);
  register('update_webhook', 'Update a webhook endpoint or its event filters.', z.object({ id: z.string().min(1), body: jsonObject }), ({ id, body }) => api.webhooks.update(id, body));
  register('list_webhook_deliveries', 'List webhook deliveries and their most recent attempt status.', z.object({ id: z.string().min(1), filters }), ({ id, filters }) => api.webhooks.deliveries(id, filters), readAnnotations);
  register('list_webhook_events', 'List events created for one webhook endpoint.', z.object({ webhook_id: z.string().min(1), filters }), ({ webhook_id, filters }) => api.webhooks.events.list({ webhookId: webhook_id, ...filters }), readAnnotations);
  register('get_webhook_event', 'Retrieve one event for a webhook endpoint.', z.object({ webhook_id: z.string().min(1), event_id: z.string().min(1) }), ({ webhook_id, event_id }) => api.webhooks.events.get({ webhookId: webhook_id, eventId: event_id }), readAnnotations);
  register('list_webhook_event_attempts', 'List delivery attempts for one webhook event.', z.object({ webhook_id: z.string().min(1), event_id: z.string().min(1), filters }), ({ webhook_id, event_id, filters }) => api.webhooks.events.attempts.list({ webhookId: webhook_id, eventId: event_id, ...filters }), readAnnotations);
  register('replay_webhook_event', 'Queue another delivery attempt for a webhook event.', z.object({ webhook_id: z.string().min(1), event_id: z.string().min(1) }), ({ webhook_id, event_id }) => api.webhooks.events.replay({ webhookId: webhook_id, eventId: event_id }));
  register('delete_webhook', 'Delete a webhook endpoint. This is destructive and requires explicit user confirmation.', deleteSchema, ({ id }) => api.webhooks.delete(id), deleteAnnotations);

  register('list_suppressions', 'List addresses currently blocked from sending.', z.object({ filters }), ({ filters }) => api.suppressions.list(filters), readAnnotations);
  register('get_suppression', 'Retrieve a suppression by email or ID.', z.object({ identifier: z.string().min(1) }), ({ identifier }) => api.suppressions.get(identifier), readAnnotations);
  register('add_suppression', 'Block an address from future sends.', z.object({ email: z.string().email() }), ({ email }) => api.suppressions.add(email));
  register('remove_suppression', 'Remove an address from the block list, allowing future sends. This requires explicit user confirmation.', z.object({ identifier: z.string().min(1), confirm: z.literal(true) }), ({ identifier }) => api.suppressions.remove(identifier), deleteAnnotations);
  register('add_suppressions_batch', 'Block a batch of addresses from future sends. Call only after the user requested these addresses be blocked.', z.object({ emails: z.array(z.string().email()).min(1).max(2000) }), ({ emails }) => api.suppressions.batchAdd(emails));
  register('remove_suppressions_batch', 'Remove addresses from the block list, allowing future sends. This is destructive and requires explicit user confirmation.', z.object({ emails: z.array(z.string().email()).min(1).max(2000), confirm: z.literal(true) }), ({ emails }) => api.suppressions.batchRemove(emails), deleteAnnotations);

  register('list_api_request_logs', 'List API request logs using optional pagination and filters.', z.object({ filters }), ({ filters }) => api.logs.list(filters), readAnnotations);
  register('get_api_request_log', 'Retrieve one API request log.', idSchema, ({ id }) => api.logs.get(id), readAnnotations);
  register('list_contact_properties', 'List contact property definitions.', z.object({}), () => api.contactProperties.list(), readAnnotations);
  register('get_contact_property', 'Retrieve a contact property definition by key.', z.object({ key: z.string().min(1) }), ({ key }) => api.contactProperties.get(key), readAnnotations);
  register('create_contact_property', 'Create a typed contact property definition.', z.object({ body: jsonObject }), ({ body }) => api.contactProperties.create(body));
  register('update_contact_property', 'Update a contact property definition and optional fallback.', z.object({ id: z.string().min(1), body: jsonObject }), ({ id, body }) => api.contactProperties.update(id, body));
  register('delete_contact_property', 'Delete a contact property definition. This is destructive and requires explicit user confirmation.', deleteSchema, ({ id }) => api.contactProperties.delete(id), deleteAnnotations);
  register('download_csv_export', 'Download a filtered CSV export from the account. This may return a large text result; use a narrow resource and search where possible.', exportFilters, (query) => api.exports.csv(query), readAnnotations);

  return server;
}
