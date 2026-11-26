import { sendThroughSmtp } from '@/lib/smtp';
import { execute, hashSecret, nowIso, query, queryOne, randomId, transaction } from '@/lib/database';
import { emitWebhookEvent } from '@/lib/webhooks';
import { emitEmailSuppressed, findSuppressedAddresses } from '@/lib/suppressions';
import { findEmailTemplate, getPublishedTemplateContent } from '@/lib/email-templates';
import { relayMessageIdFromResponse } from '@/lib/ses-events';

export type AutomationStep = { key: string; type: string; config: Record<string, unknown> };
export type AutomationConnection = { from: string; to: string; condition?: 'true' | 'false' };
export type AutomationDefinition = { name: string; status: 'draft' | 'active' | 'paused'; triggerEvent: string; steps: AutomationStep[]; connections: AutomationConnection[] };
export type AutomationRecord = { id: string; api_key_id: string; name: string; status: string; trigger_event: string; steps: AutomationStep[]; connections: AutomationConnection[]; created_at: string; updated_at: string };
const eventNamePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/;
const stepKeyPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const stepTypes = new Set(['trigger', 'condition', 'delay', 'wait_for_event', 'send_email', 'contact_update', 'add_to_segment']);
const operators = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts_with', 'ends_with', 'exists', 'is_empty']);

export function parseAutomationDefinition(value: unknown): { ok: true; definition: AutomationDefinition } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Automation body must be an object.' };
  const body = value as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 100 || /[\r\n]/.test(name)) return { ok: false, error: 'name must contain 1 to 100 single-line characters.' };
  const status = body.status === undefined ? 'draft' : body.status;
  if (status !== 'draft' && status !== 'active' && status !== 'paused') return { ok: false, error: 'status must be draft, active, or paused.' };
  if (!Array.isArray(body.steps) || body.steps.length < 1 || body.steps.length > 50) return { ok: false, error: 'steps must contain between 1 and 50 workflow nodes.' };
  const steps: AutomationStep[] = [];
  const keys = new Set<string>();
  for (const entry of body.steps) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, error: 'Each step must be an object.' };
    const step = entry as Record<string, unknown>;
    const config = step.config && typeof step.config === 'object' && !Array.isArray(step.config) ? step.config as Record<string, unknown> : null;
    if (typeof step.key !== 'string' || !stepKeyPattern.test(step.key) || keys.has(step.key)) return { ok: false, error: 'Every step needs a unique key using letters, numbers, underscores, or hyphens.' };
    if (typeof step.type !== 'string' || !stepTypes.has(step.type) || !config) return { ok: false, error: 'Each step needs a supported type and a config object.' };
    keys.add(step.key);
    steps.push({ key: step.key, type: step.type, config });
  }
  if (steps[0]?.type !== 'trigger' || steps.filter((step) => step.type === 'trigger').length !== 1) return { ok: false, error: 'The first and only trigger step must start the workflow.' };
  const triggerEvent = steps[0].config.event_name ?? steps[0].config.eventName;
  if (typeof triggerEvent !== 'string' || !eventNamePattern.test(triggerEvent)) return { ok: false, error: 'The trigger step needs a valid event_name.' };
  if (!Array.isArray(body.connections) || body.connections.length > 100) return { ok: false, error: 'connections must be an array of at most 100 edges.' };
  const connections: AutomationConnection[] = [];
  const edgeKeys = new Set<string>();
  for (const entry of body.connections) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, error: 'Each connection must be an object.' };
    const edge = entry as Record<string, unknown>;
    const condition = edge.condition ?? edge.branch;
    if (typeof edge.from !== 'string' || !keys.has(edge.from) || typeof edge.to !== 'string' || !keys.has(edge.to) || condition !== undefined && condition !== 'true' && condition !== 'false') return { ok: false, error: 'Connections must reference step keys and may use condition true or false.' };
    const edgeKey = `${edge.from}:${condition ?? ''}:${edge.to}`;
    if (edgeKeys.has(edgeKey)) return { ok: false, error: 'Duplicate workflow connections are not allowed.' };
    edgeKeys.add(edgeKey);
    connections.push({ from: edge.from, to: edge.to, ...(condition ? { condition } : {}) });
  }
  for (const step of steps) {
    const outgoing = connections.filter((edge) => edge.from === step.key);
    if (step.type === 'condition' && outgoing.length !== 2) return { ok: false, error: `Condition step "${step.key}" needs two outgoing connections.` };
    if (step.type !== 'condition' && outgoing.some((edge) => edge.condition)) return { ok: false, error: `Only condition steps may use branch connections (${step.key}).` };
    if (step.type === 'condition' && outgoing.some((edge) => !edge.condition) && outgoing.some((edge) => edge.condition)) return { ok: false, error: `Both outgoing connections from ${step.key} must use true or false conditions.` };
    if (step.type === 'condition' && outgoing.every((edge) => edge.condition) && new Set(outgoing.map((edge) => edge.condition)).size !== 2) return { ok: false, error: `Condition step "${step.key}" needs one true and one false connection.` };
    const config = step.config;
    if (step.type === 'condition' && !validCondition(config)) return { ok: false, error: `Condition step "${step.key}" has an invalid rule.` };
    if (step.type === 'delay' && !parseDuration(config.duration)) return { ok: false, error: `Delay step "${step.key}" needs a duration of at most 30 days.` };
    if (step.type === 'wait_for_event' && (typeof config.event_name !== 'string' || !eventNamePattern.test(config.event_name) || !parseDuration(config.timeout))) return { ok: false, error: `Wait step "${step.key}" needs a valid event_name and timeout of at most 30 days.` };
    if (step.type === 'wait_for_event' && config.filter_rule !== undefined && (!config.filter_rule || typeof config.filter_rule !== 'object' || Array.isArray(config.filter_rule) || !validCondition(config.filter_rule as Record<string, unknown>))) return { ok: false, error: `Wait step "${step.key}" has an invalid filter_rule.` };
    if (step.type === 'send_email') {
      const template = config.template && typeof config.template === 'object' ? config.template as Record<string, unknown> : null;
      if (!template || typeof template.id !== 'string' || !template.id || template.id.length > 120) return { ok: false, error: `Send email step "${step.key}" needs a template.id.` };
      if (typeof config.from !== 'string' || config.from.length > 320 || !emailPattern.test(extractAddress(config.from))) return { ok: false, error: `Send email step "${step.key}" needs a valid verified sender address in from.` };
    }
    if (step.type === 'contact_update' && !validContactUpdates(config.updates)) return { ok: false, error: `Contact update step "${step.key}" needs valid name, properties, or tags updates.` };
    if (step.type === 'add_to_segment' && (typeof config.segment_id !== 'string' || !config.segment_id || config.segment_id.length > 120)) return { ok: false, error: `Add to segment step "${step.key}" needs a segment_id.` };
  }
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(key: string): boolean {
    if (visiting.has(key)) return false;
    if (visited.has(key)) return true;
    visiting.add(key);
    for (const edge of connections.filter((item) => item.from === key)) if (!visit(edge.to)) return false;
    visiting.delete(key);
    visited.add(key);
    return true;
  }
  if (!visit(steps[0].key)) return { ok: false, error: 'Workflow connections cannot contain loops.' };
  if (visited.size !== byKey.size) return { ok: false, error: 'Every workflow step must be connected to the trigger.' };
  return { ok: true, definition: { name, status, triggerEvent, steps, connections } };
}

export function parseDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d{1,5})\s*(seconds?|minutes?|hours?|days?)\s*$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const seconds = amount * (unit.startsWith('second') ? 1 : unit.startsWith('minute') ? 60 : unit.startsWith('hour') ? 3600 : 86400);
  return amount > 0 && seconds <= 30 * 86400 ? seconds : null;
}

export async function saveAutomation(apiKeyId: string, id: string | null, value: unknown): Promise<{ ok: true; automation: AutomationRecord } | { ok: false; status: 400 | 404 | 409; error: string }> {
  let existing: { id: string; api_key_id: string; name: string; status: string; trigger_event: string; steps_json: string; connections_json: string; created_at: string; updated_at: string } | undefined;
  if (id) {
    existing = await queryOne<{ id: string; api_key_id: string; name: string; status: string; trigger_event: string; steps_json: string; connections_json: string; created_at: string; updated_at: string }>("SELECT id,api_key_id,name,status,trigger_event,steps_json,connections_json,created_at,updated_at FROM automations WHERE id=? AND api_key_id=? AND status<>'archived'", [id, apiKeyId]);
    if (!existing) return { ok: false, status: 404, error: 'Automation not found.' };
  }
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (existing?.status === 'active' && Object.keys(body).length === 1 && body.status === 'paused') {
    const updatedAt = nowIso();
    await execute("UPDATE automations SET status='paused',updated_at=? WHERE id=? AND api_key_id=?", [updatedAt, existing.id, apiKeyId]);
    const updated = await getAutomationByKey(apiKeyId, existing.id);
    return updated ? { ok: true, automation: updated } : { ok: false, status: 404, error: 'Automation not found.' };
  }
  if (existing?.status === 'active') return { ok: false, status: 409, error: 'Pause an active automation before changing its workflow.' };
  const source = existing ? {
    name: existing.name,
    status: existing.status === 'paused' ? 'paused' : 'draft',
    steps: parseJson<AutomationStep[]>(existing.steps_json, []),
    connections: parseJson<AutomationConnection[]>(existing.connections_json, []),
    ...body,
  } : value;
  const parsed = parseAutomationDefinition(source);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  for (const step of parsed.definition.steps) {
    if (step.type === 'send_email') {
      const template = (step.config.template as Record<string, unknown>).id;
      const emailTemplate = await findEmailTemplate(String(template));
      if (!emailTemplate) return { ok: false, status: 400, error: `Template "${String(template)}" does not exist.` };
      if (parsed.definition.status === 'active' && !emailTemplate.published_version_id) return { ok: false, status: 400, error: `Template "${String(template)}" must be published before an active automation can send it.` };
      if (parsed.definition.status === 'active') {
        const domain = extractAddress(String(step.config.from)).split('@').at(-1)?.toLowerCase() ?? '';
        if (!await queryOne<{ id: string }>('SELECT id FROM domains WHERE lower(domain)=? AND verified_at IS NOT NULL', [domain])) return { ok: false, status: 400, error: `Sender domain "${domain}" is not verified in Emailgo.` };
      }
    }
    if (step.type === 'add_to_segment' && !await queryOne<{ id: string }>('SELECT id FROM segments WHERE id=?', [String(step.config.segment_id)])) return { ok: false, status: 400, error: `Segment "${String(step.config.segment_id)}" does not exist.` };
  }
  const updatedAt = nowIso();
  const templateIds = [...new Set(parsed.definition.steps.flatMap((step) => {
    if (step.type !== 'send_email') return [];
    const template = step.config.template as Record<string, unknown>;
    return [String(template.id)];
  }))];
  const templateReferenceStatements = (automationId: string) => [
    { sql: 'DELETE FROM automation_template_refs WHERE automation_id=?', params: [automationId] },
    ...templateIds.map((templateId) => ({
      sql: 'INSERT INTO automation_template_refs(automation_id,template_id) VALUES(?,?)',
      params: [automationId, templateId],
    })),
  ];
  const isReferenceConflict = (cause: unknown) => {
    if (!cause || typeof cause !== 'object') return false;
    const error = cause as { code?: unknown; errcode?: unknown };
    return error.code === '23503' || error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || error.errcode === 787;
  };
  if (existing) {
    try {
      await transaction([
        { sql: 'UPDATE automations SET name=?,status=?,trigger_event=?,steps_json=?,connections_json=?,updated_at=? WHERE id=? AND api_key_id=?', params: [parsed.definition.name, parsed.definition.status, parsed.definition.triggerEvent, JSON.stringify(parsed.definition.steps), JSON.stringify(parsed.definition.connections), updatedAt, existing.id, apiKeyId] },
        ...templateReferenceStatements(existing.id),
      ]);
    } catch (cause) {
      if (isReferenceConflict(cause)) return { ok: false, status: 409, error: 'A referenced template changed while this automation was being saved. Fetch the latest template and retry.' };
      throw cause;
    }
    const updated = await getAutomationByKey(apiKeyId, existing.id);
    return updated ? { ok: true, automation: updated } : { ok: false, status: 404, error: 'Automation not found.' };
  }
  const automationId = randomId('aut');
  try {
    await transaction([
      { sql: 'INSERT INTO automations(id,api_key_id,name,status,trigger_event,steps_json,connections_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', params: [automationId, apiKeyId, parsed.definition.name, parsed.definition.status, parsed.definition.triggerEvent, JSON.stringify(parsed.definition.steps), JSON.stringify(parsed.definition.connections), updatedAt, updatedAt] },
      ...templateReferenceStatements(automationId).slice(1),
    ]);
  } catch (cause) {
    if (isReferenceConflict(cause)) return { ok: false, status: 409, error: 'A referenced template changed while this automation was being saved. Fetch the latest template and retry.' };
    throw cause;
  }
  const created = await getAutomationByKey(apiKeyId, automationId);
  return created ? { ok: true, automation: created } : { ok: false, status: 404, error: 'Automation was not created.' };
}

export async function getAutomationByKey(apiKeyId: string, id: string): Promise<AutomationRecord | undefined> {
  const row = await queryOne<{ id: string; api_key_id: string; name: string; status: string; trigger_event: string; steps_json: string; connections_json: string; created_at: string; updated_at: string }>("SELECT id,api_key_id,name,status,trigger_event,steps_json,connections_json,created_at,updated_at FROM automations WHERE id=? AND api_key_id=? AND status<>'archived'", [id, apiKeyId]);
  return row ? recordAutomation(row) : undefined;
}

export async function listAutomationsByKey(apiKeyId: string) {
  const rows = await query<{ id: string; api_key_id: string; name: string; status: string; trigger_event: string; steps_json: string; connections_json: string; created_at: string; updated_at: string }>("SELECT id,api_key_id,name,status,trigger_event,steps_json,connections_json,created_at,updated_at FROM automations WHERE api_key_id=? AND status<>'archived' ORDER BY updated_at DESC,id DESC", [apiKeyId]);
  return rows.rows.map(recordAutomation);
}

export async function listAutomationsForDashboard() {
  const rows = await query<{ id: string; api_key_id: string; key_name: string; name: string; status: string; trigger_event: string; steps_json: string; connections_json: string; created_at: string; updated_at: string }>(`SELECT a.id,a.api_key_id,k.name AS key_name,a.name,a.status,a.trigger_event,a.steps_json,a.connections_json,a.created_at,a.updated_at
    FROM automations a JOIN api_keys k ON k.id=a.api_key_id WHERE a.status<>'archived' AND k.revoked_at IS NULL ORDER BY a.updated_at DESC,a.id DESC`);
  return rows.rows.map((row) => ({ ...recordAutomation(row), key_name: row.key_name }));
}

export async function archiveAutomation(apiKeyId: string, id: string) {
  return execute("UPDATE automations SET status='archived',updated_at=? WHERE id=? AND api_key_id=? AND status<>'archived'", [nowIso(), id, apiKeyId]);
}

export async function getAutomationRun(apiKeyId: string, automationId: string, runId: string) {
  const run = await queryOne<Record<string, unknown>>('SELECT id,automation_id,event_id,event_name,contact_id,email,payload_json,current_step_key,status,waiting_event_name,resume_at,context_json,started_at,updated_at,completed_at,error FROM automation_runs WHERE id=? AND automation_id=? AND api_key_id=?', [runId, automationId, apiKeyId]);
  if (!run) return undefined;
  const steps = await query<{ id: string; step_key: string; step_type: string; status: string; input_json: string | null; output_json: string | null; started_at: string; finished_at: string | null; error: string | null }>('SELECT id,step_key,step_type,status,input_json,output_json,started_at,finished_at,error FROM automation_run_steps WHERE run_id=? ORDER BY started_at,id', [runId]);
  return { ...run, payload: parseJson<Record<string, unknown>>(run.payload_json as string, {}), context: parseJson<Record<string, unknown>>(run.context_json as string, {}), steps: steps.rows.map((step) => ({ ...step, input: parseJson<Record<string, unknown>>(step.input_json, {}), output: parseJson<Record<string, unknown>>(step.output_json, {}) })) };
}

function recordAutomation(row: { id: string; api_key_id: string; name: string; status: string; trigger_event: string; steps_json: string; connections_json: string; created_at: string; updated_at: string }): AutomationRecord {
  return { id: row.id, api_key_id: row.api_key_id, name: row.name, status: row.status, trigger_event: row.trigger_event, steps: parseJson<AutomationStep[]>(row.steps_json, []), connections: parseJson<AutomationConnection[]>(row.connections_json, []), created_at: row.created_at, updated_at: row.updated_at };
}

function validCondition(value: Record<string, unknown>, depth = 0): boolean {
  if (depth > 4) return false;
  const type = value.type ?? 'rule';
  if (type === 'and' || type === 'or') return Array.isArray(value.rules) && value.rules.length > 0 && value.rules.length <= 20 && value.rules.every((rule) => rule && typeof rule === 'object' && !Array.isArray(rule) && validCondition(rule as Record<string, unknown>, depth + 1));
  if (type !== 'rule' || typeof value.field !== 'string' || !/^(event|contact|wait_events)\.[A-Za-z0-9_.-]{1,250}$/.test(value.field) || typeof value.operator !== 'string' || !operators.has(value.operator)) return false;
  if (value.operator !== 'exists' && value.operator !== 'is_empty' && !Object.hasOwn(value, 'value')) return false;
  return true;
}

function validDynamicValue(value: unknown, maxString = 1000): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return true;
  if (typeof value === 'string') return value.length <= maxString;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && typeof record.var === 'string' && /^(event|contact|wait_events)\.[A-Za-z0-9_.-]{1,250}$/.test(record.var);
}

function validContactUpdates(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const updates = value as Record<string, unknown>;
  const keys = Object.keys(updates);
  if (keys.length < 1 || keys.some((key) => !['name', 'properties', 'tags'].includes(key))) return false;
  if (Object.hasOwn(updates, 'name') && !(updates.name === null || validDynamicValue(updates.name, 120))) return false;
  if (Object.hasOwn(updates, 'properties')) {
    const properties = updates.properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return false;
    const entries = Object.entries(properties as Record<string, unknown>);
    if (entries.length > 50 || !entries.every(([key, item]) => /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(key) && validDynamicValue(item))) return false;
  }
  if (Object.hasOwn(updates, 'tags') && (!Array.isArray(updates.tags) || updates.tags.length > 50 || !updates.tags.every((tag) => typeof tag === 'string' && /^[A-Za-z0-9_-]{1,50}$/.test(tag)))) return false;
  return true;
}

function extractAddress(value: string) { return /<([^<>]+)>$/.exec(value.trim())?.[1] ?? value.trim(); }

export async function emitAutomationEvent(input: { apiKeyId: string; event: string; payload: Record<string, unknown>; contactId?: string | null; email?: string | null; idempotencyKey?: string | null }) {
  const requestHash = hashSecret(stableStringify({ event: input.event, payload: input.payload, contactId: input.contactId ?? null, email: input.email ?? null }));
  const existing = input.idempotencyKey ? await queryOne<{ id: string; request_hash: string | null; event_name: string; contact_id: string | null; email: string | null; payload_json: string }>('SELECT id,request_hash,event_name,contact_id,email,payload_json FROM automation_events WHERE api_key_id=? AND idempotency_key=?', [input.apiKeyId, input.idempotencyKey]) : undefined;
  if (existing) {
    const existingHash = existing.request_hash ?? hashSecret(stableStringify({ event: existing.event_name, payload: parseJson<Record<string, unknown>>(existing.payload_json, {}), contactId: existing.contact_id, email: existing.email }));
    if (existingHash !== requestHash) return { eventId: existing.id, runIds: [], duplicate: false, conflict: true as const };
    const runs = await query<{ id: string }>('SELECT id FROM automation_runs WHERE event_id=? ORDER BY started_at,id', [existing.id]);
    return { eventId: existing.id, runIds: runs.rows.map((run) => run.id), duplicate: true, conflict: false as const };
  }
  const eventId = randomId('evt');
  const createdAt = nowIso();
  const automations = await query<{ id: string; trigger_event: string; steps_json: string; connections_json: string }>("SELECT id,trigger_event,steps_json,connections_json FROM automations WHERE api_key_id=? AND status='active' AND trigger_event=?", [input.apiKeyId, input.event]);
  const runIds: string[] = [];
  const statements = [{
    sql: 'INSERT INTO automation_events(id,api_key_id,event_name,contact_id,email,payload_json,idempotency_key,request_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    params: [eventId, input.apiKeyId, input.event, input.contactId ?? null, input.email ?? null, JSON.stringify(input.payload), input.idempotencyKey ?? null, requestHash, createdAt],
  }];
  for (const automation of automations.rows) {
    const steps = parseJson<AutomationStep[]>(automation.steps_json, []);
    const connections = parseJson<AutomationConnection[]>(automation.connections_json, []);
    const trigger = steps.find((step) => step.type === 'trigger');
    const first = trigger ? connections.find((edge) => edge.from === trigger.key)?.to ?? null : null;
    const runId = randomId('run');
    runIds.push(runId);
    statements.push({
      sql: `INSERT INTO automation_runs(id,automation_id,api_key_id,event_id,event_name,contact_id,email,payload_json,steps_json,connections_json,current_step_key,status,context_json,started_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'running',?,?,?)`,
      params: [runId, automation.id, input.apiKeyId, eventId, input.event, input.contactId ?? null, input.email ?? null, JSON.stringify(input.payload), automation.steps_json, automation.connections_json, first, JSON.stringify({ event: { ...input.payload, event_name: input.event }, contact: {}, wait_events: {} }), createdAt, createdAt],
    });
  }
  try { await transaction(statements); }
  catch (cause) {
    if (input.idempotencyKey) {
      const duplicate = await queryOne<{ id: string; request_hash: string | null; event_name: string; contact_id: string | null; email: string | null; payload_json: string }>('SELECT id,request_hash,event_name,contact_id,email,payload_json FROM automation_events WHERE api_key_id=? AND idempotency_key=?', [input.apiKeyId, input.idempotencyKey]);
      if (duplicate) {
        const existingHash = duplicate.request_hash ?? hashSecret(stableStringify({ event: duplicate.event_name, payload: parseJson<Record<string, unknown>>(duplicate.payload_json, {}), contactId: duplicate.contact_id, email: duplicate.email }));
        if (existingHash !== requestHash) return { eventId: duplicate.id, runIds: [], duplicate: false, conflict: true as const };
        const runs = await query<{ id: string }>('SELECT id FROM automation_runs WHERE event_id=? ORDER BY started_at,id', [duplicate.id]);
        return { eventId: duplicate.id, runIds: runs.rows.map((run) => run.id), duplicate: true, conflict: false as const };
      }
    }
    throw cause;
  }
  return { eventId, runIds, duplicate: false, conflict: false as const };
}

type RunRow = { id: string; automation_id: string; api_key_id: string; event_id: string; event_name: string; contact_id: string | null; email: string | null; payload_json: string; steps_json: string; connections_json: string; current_step_key: string | null; status: string; waiting_event_name: string | null; waiting_since: string | null; resume_at: string | null; context_json: string; started_at: string; updated_at: string; processing_started_at: string | null };
type ContactContext = { id: string; email: string; name: string | null; properties_json: string; tags_json: string; unsubscribed_at: string | null; consent_status: string };

export async function processAutomationRuns(limit = 10) {
  const now = nowIso();
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const due = await query<RunRow>(`SELECT r.* FROM automation_runs r WHERE
      r.status='running'
      OR r.status='processing' AND r.processing_started_at<=?
      OR r.status='waiting' AND (r.resume_at<=? OR EXISTS(
        SELECT 1 FROM automation_events e WHERE e.api_key_id=r.api_key_id AND e.event_name=r.waiting_event_name
          AND e.created_at>=r.waiting_since AND (r.contact_id IS NULL OR e.contact_id=r.contact_id OR lower(e.email)=lower(r.email))
      )) ORDER BY r.started_at,r.id LIMIT ?`, [staleBefore, now, limit]);
  let completed = 0;
  let waiting = 0;
  let failed = 0;
  let checked = 0;
  for (const candidate of due.rows) {
    const claimedAt = nowIso();
    const claimed = await execute(`UPDATE automation_runs SET status='processing',processing_started_at=?,updated_at=? WHERE id=? AND (
      status='running' OR status='processing' AND processing_started_at<=? OR status='waiting' AND (resume_at<=? OR EXISTS(
        SELECT 1 FROM automation_events e WHERE e.api_key_id=automation_runs.api_key_id AND e.event_name=automation_runs.waiting_event_name
          AND e.created_at>=automation_runs.waiting_since AND (automation_runs.contact_id IS NULL OR e.contact_id=automation_runs.contact_id OR lower(e.email)=lower(automation_runs.email))
      )))`, [claimedAt, claimedAt, candidate.id, staleBefore, claimedAt]);
    if (!claimed) continue;
    checked += 1;
    try {
      const result = await advanceAutomationRun(candidate.id);
      if (result === 'completed') completed += 1;
      if (result === 'waiting') waiting += 1;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.slice(0, 500) : 'Automation step failed.';
      const failedRun = await queryOne<{ current_step_key: string | null }>('SELECT current_step_key FROM automation_runs WHERE id=?', [candidate.id]);
      if (failedRun?.current_step_key) await execute("UPDATE automation_run_steps SET status='failed',error=?,finished_at=? WHERE run_id=? AND step_key=?", [message, nowIso(), candidate.id, failedRun.current_step_key]);
      await execute("UPDATE automation_runs SET status='failed',error=?,processing_started_at=NULL,completed_at=?,updated_at=? WHERE id=?", [message, nowIso(), nowIso(), candidate.id]);
      failed += 1;
    }
  }
  return { checked, completed, waiting, failed };
}

async function advanceAutomationRun(runId: string): Promise<'completed' | 'waiting' | 'running'> {
  let run = await queryOne<RunRow>('SELECT * FROM automation_runs WHERE id=?', [runId]);
  if (!run) throw new Error('Automation run disappeared.');
  const steps = parseJson<AutomationStep[]>(run.steps_json, []);
  const connections = parseJson<AutomationConnection[]>(run.connections_json, []);
  let context = parseJson<Record<string, unknown>>(run.context_json, {});
  let contact: ContactContext | undefined;
  if (run.contact_id) contact = await queryOne<ContactContext>('SELECT id,email,name,properties_json,tags_json,unsubscribed_at,consent_status FROM contacts WHERE id=?', [run.contact_id]);
  if (!contact && run.email) contact = await queryOne<ContactContext>('SELECT id,email,name,properties_json,tags_json,unsubscribed_at,consent_status FROM contacts WHERE lower(email)=lower(?)', [run.email]);
  const contactData = contact ? { id: contact.id, email: contact.email, name: contact.name, properties: parseJson<Record<string, unknown>>(contact.properties_json, {}), tags: parseJson<string[]>(contact.tags_json, []), consent_status: contact.consent_status, unsubscribed: Boolean(contact.unsubscribed_at) } : {};
  context = { ...context, contact: contactData, event: { ...parseJson<Record<string, unknown>>(run.payload_json, {}), event_name: run.event_name }, wait_events: recordValue(context.wait_events) };
  await execute('UPDATE automation_runs SET context_json=? WHERE id=?', [JSON.stringify(context), runId]);

  for (let count = 0; count < 20; count += 1) {
    run = await queryOne<RunRow>('SELECT * FROM automation_runs WHERE id=?', [runId]);
    if (!run) throw new Error('Automation run disappeared.');
    if (!run.current_step_key) {
      const at = nowIso();
      await execute("UPDATE automation_runs SET status='completed',completed_at=?,processing_started_at=NULL,updated_at=?,error=NULL WHERE id=?", [at, at, runId]);
      return 'completed';
    }
    const step = steps.find((item) => item.key === run.current_step_key);
    if (!step) throw new Error(`Automation step "${run.current_step_key}" is missing from its saved version.`);
    if (step.type === 'trigger') throw new Error('A workflow cannot return to its trigger step.');
    const startedAt = nowIso();
    const existingHistory = await queryOne<{ id: string }>('SELECT id FROM automation_run_steps WHERE run_id=? AND step_key=?', [runId, step.key]);
    const historyId = existingHistory?.id ?? randomId('rstep');
    if (!existingHistory) await execute('INSERT INTO automation_run_steps(id,run_id,step_key,step_type,status,input_json,started_at) VALUES(?,?,?,?,?,?,?)', [historyId, runId, step.key, step.type, 'processing', JSON.stringify(step.config), startedAt]);
    else await execute("UPDATE automation_run_steps SET status='processing',error=NULL WHERE id=?", [historyId]);

    if (step.type === 'delay') {
      const seconds = parseDuration(step.config.duration);
      if (!seconds) throw new Error(`Delay step "${step.key}" has an invalid duration.`);
      const resumeAt = new Date(Date.now() + seconds * 1000).toISOString();
      const next = nextStep(connections, step.key);
      await execute("UPDATE automation_run_steps SET status='completed',output_json=?,finished_at=? WHERE id=?", [JSON.stringify({ resume_at: resumeAt }), startedAt, historyId]);
      await execute("UPDATE automation_runs SET status='waiting',current_step_key=?,resume_at=?,waiting_event_name=NULL,waiting_since=NULL,processing_started_at=NULL,updated_at=? WHERE id=?", [next, resumeAt, startedAt, runId]);
      return 'waiting';
    }

    if (step.type === 'wait_for_event') {
      const eventName = String(step.config.event_name);
      const filter = step.config.filter_rule && typeof step.config.filter_rule === 'object' ? step.config.filter_rule as Record<string, unknown> : null;
      let received: { payload_json: string; email: string | null; contact_id: string | null; created_at: string } | undefined;
      if (run.waiting_event_name === eventName && run.waiting_since) {
        const events = await query<{ payload_json: string; email: string | null; contact_id: string | null; created_at: string }>(`SELECT payload_json,email,contact_id,created_at FROM automation_events
          WHERE api_key_id=? AND event_name=? AND created_at>=? AND (? IS NULL OR contact_id=? OR lower(email)=lower(?)) ORDER BY created_at,id LIMIT 50`, [run.api_key_id, eventName, run.waiting_since, run.contact_id ?? run.email, run.contact_id ?? run.email, run.email]);
        for (const event of events.rows) {
          const incoming = { event: { ...parseJson<Record<string, unknown>>(event.payload_json, {}), event_name: eventName }, contact: contactData, wait_events: context.wait_events };
          if (!filter || evaluateCondition(filter, incoming)) { received = event; break; }
        }
      }
      const timedOut = Boolean(run.resume_at && Date.parse(run.resume_at) <= Date.now());
      if (!received && !timedOut) {
        const since = run.waiting_since ?? startedAt;
        const timeoutSeconds = parseDuration(step.config.timeout);
        if (!timeoutSeconds) throw new Error(`Wait step "${step.key}" has an invalid timeout.`);
        const resumeAt = new Date(Date.parse(since) + timeoutSeconds * 1000).toISOString();
        await execute("UPDATE automation_run_steps SET status='waiting',output_json=? WHERE id=?", [JSON.stringify({ event_name: eventName, resume_at: resumeAt }), historyId]);
        await execute("UPDATE automation_runs SET status='waiting',waiting_event_name=?,waiting_since=?,resume_at=?,processing_started_at=NULL,updated_at=? WHERE id=?", [eventName, since, resumeAt, startedAt, runId]);
        return 'waiting';
      }
      context = { ...context, wait_events: { ...recordValue(context.wait_events), [eventName]: received ? { ...parseJson<Record<string, unknown>>(received.payload_json, {}), received_at: received.created_at } : { timed_out: true } } };
      const next = nextStep(connections, step.key);
      await execute("UPDATE automation_run_steps SET status='completed',output_json=?,finished_at=?,error=NULL WHERE id=?", [JSON.stringify(received ? { event_name: eventName, received_at: received.created_at } : { event_name: eventName, timed_out: true }), startedAt, historyId]);
      await execute("UPDATE automation_runs SET status='processing',current_step_key=?,waiting_event_name=NULL,waiting_since=NULL,resume_at=NULL,context_json=?,updated_at=? WHERE id=?", [next, JSON.stringify(context), startedAt, runId]);
      continue;
    }

    if (step.type === 'condition') {
      const matched = evaluateCondition(step.config, context);
      const next = nextStep(connections, step.key, matched);
      await execute("UPDATE automation_run_steps SET status='completed',output_json=?,finished_at=? WHERE id=?", [JSON.stringify({ matched }), startedAt, historyId]);
      await execute("UPDATE automation_runs SET current_step_key=?,updated_at=? WHERE id=?", [next, startedAt, runId]);
      continue;
    }

    if (step.type === 'contact_update') {
      if (!contact) throw new Error('Contact update requires a contact attached to the event.');
      const updates = step.config.updates as Record<string, unknown>;
      let name = contact.name;
      let properties = parseJson<Record<string, unknown>>(contact.properties_json, {});
      let tags = parseJson<string[]>(contact.tags_json, []);
      if (Object.hasOwn(updates, 'name')) {
        const value = updates.name === null ? null : materializeValue(updates.name, context);
        if (value !== null && typeof value !== 'string') throw new Error('Contact name update must resolve to text or null.');
        name = value as string | null;
      }
      if (Object.hasOwn(updates, 'properties')) {
        const patch = updates.properties as Record<string, unknown>;
        properties = { ...properties, ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, materializeValue(value, context)])) };
      }
      if (Object.hasOwn(updates, 'tags')) tags = [...new Set(updates.tags as string[])];
      const updatedAt = nowIso();
      await execute('UPDATE contacts SET name=?,properties_json=?,tags_json=?,updated_at=? WHERE id=?', [name, JSON.stringify(properties), JSON.stringify(tags), updatedAt, contact.id]);
      await emitWebhookEvent(run.api_key_id, 'contact.updated', { contact_id: contact.id, email: contact.email });
      context = { ...context, contact: { ...contactData, name, properties, tags } };
      await execute("UPDATE automation_run_steps SET status='completed',output_json=?,finished_at=? WHERE id=?", [JSON.stringify({ contact_id: contact.id, updated: Object.keys(updates) }), nowIso(), historyId]);
      const next = nextStep(connections, step.key);
      await execute('UPDATE automation_runs SET current_step_key=?,context_json=?,updated_at=? WHERE id=?', [next, JSON.stringify(context), nowIso(), runId]);
      continue;
    }

    if (step.type === 'add_to_segment') {
      if (!contact) throw new Error('Add to segment requires a contact attached to the event.');
      const segmentId = String(step.config.segment_id);
      if (!await queryOne<{ id: string }>('SELECT id FROM segments WHERE id=?', [segmentId])) throw new Error(`Segment "${segmentId}" no longer exists.`);
      await execute('INSERT INTO segment_contacts(segment_id,contact_id,created_at) VALUES(?,?,?) ON CONFLICT(segment_id,contact_id) DO NOTHING', [segmentId, contact.id, nowIso()]);
      await execute("UPDATE automation_run_steps SET status='completed',output_json=?,finished_at=? WHERE id=?", [JSON.stringify({ segment_id: segmentId, contact_id: contact.id }), nowIso(), historyId]);
      const next = nextStep(connections, step.key);
      await execute('UPDATE automation_runs SET current_step_key=?,updated_at=? WHERE id=?', [next, nowIso(), runId]);
      continue;
    }

    if (step.type === 'send_email') {
      const output = await sendAutomationEmail(run, step, context, contact);
      const next = nextStep(connections, step.key);
      await execute("UPDATE automation_run_steps SET status='completed',output_json=?,finished_at=? WHERE id=?", [JSON.stringify(output), nowIso(), historyId]);
      await execute("UPDATE automation_runs SET current_step_key=?,updated_at=? WHERE id=?", [next, nowIso(), runId]);
      continue;
    }
    throw new Error(`Step type "${step.type}" is not supported by the worker.`);
  }
  throw new Error('Automation exceeded 20 immediate steps. Add a delay or event wait to keep worker execution bounded.');
}

async function sendAutomationEmail(run: RunRow, step: AutomationStep, context: Record<string, unknown>, contact?: ContactContext) {
  const templateRef = step.config.template as Record<string, unknown>;
  const templateId = typeof templateRef.id === 'string' ? templateRef.id : '';
  const template = await findEmailTemplate(templateId);
  if (!template) throw new Error(`Email template "${templateId}" was not found.`);
  const published = await getPublishedTemplateContent(template);
  if (!published) throw new Error(`Email template "${templateId}" is not published.`);
  const values = { ...context };
  const declaredVariables = new Map((published.variables ?? []).map((variable) => [variable.key, variable]));
  const requiredVariables = new Set<string>();
  for (const source of [published.subject, published.html, published.text ?? '']) {
    for (const match of source.matchAll(/\{\{\{?\s*([A-Za-z_][A-Za-z0-9_.-]{0,99})\s*\}\}\}?/g)) requiredVariables.add(match[1]);
  }
  for (const name of requiredVariables) {
    const existing = resolvePath(values, name);
    if (existing !== undefined && existing !== null) continue;
    const eventValue = values.event && typeof values.event === 'object' && !Array.isArray(values.event)
      ? (values.event as Record<string, unknown>)[name]
      : undefined;
    if (eventValue !== undefined && eventValue !== null) {
      values[name] = eventValue;
      continue;
    }
    const fallback = declaredVariables.get(name)?.fallback_value;
    if (fallback === undefined || fallback === null) throw new Error(`Email template variable "${name}" has no value or fallback.`);
    values[name] = fallback;
  }
  const recipient = contact?.email ?? run.email;
  if (!recipient || !emailPattern.test(recipient)) throw new Error('Send email needs a contact or valid event email address.');
  if (contact?.unsubscribed_at) throw new Error('The contact is globally unsubscribed; automation email was suppressed.');
  const from = typeof step.config.from === 'string' ? step.config.from : '';
  const fromAddress = extractAddress(from);
  if (!from || !emailPattern.test(fromAddress)) throw new Error('Send email needs a verified from address.');
  const domain = fromAddress.split('@').at(-1)?.toLowerCase() ?? '';
  const verified = await queryOne<{ id: string }>('SELECT id FROM domains WHERE lower(domain)=? AND verified_at IS NOT NULL', [domain]);
  if (!verified) throw new Error('Send email requires a verified Emailgo sender domain.');
  const subject = renderVariables(published.subject, values, false);
  const text = published.text === null ? null : renderVariables(published.text, values, false);
  const html = published.html === null ? null : renderVariables(published.html, values, true);
  if (!text && !html) throw new Error('The email template has no text or HTML body.');
  const id = randomId('eml');
  const createdAt = nowIso();
  const suppression = (await findSuppressedAddresses([recipient]))[0];
  if (suppression) {
    const message = 'Emailgo skipped sending because the address is on the workspace suppression list.';
    await execute(`INSERT INTO emails(id,api_key_id,from_address,to_json,subject,status,error_message,created_at,text_body,html_body)
      VALUES(?,?,?,?,?,'suppressed',?,?,?,?)`, [id, run.api_key_id, from, JSON.stringify([recipient]), subject, message, createdAt, text, html]);
    await emitEmailSuppressed(run.api_key_id, id, from, suppression.email, subject);
    return { email_id: id, status: 'suppressed' };
  }
  await execute(`INSERT INTO emails(id,api_key_id,from_address,to_json,subject,status,created_at,text_body,html_body)
    VALUES(?,?,?,?,?,'processing',?,?,?)`, [id, run.api_key_id, from, JSON.stringify([recipient]), subject, createdAt, text, html]);
  try {
    const result = await sendThroughSmtp({ from, to: [recipient], subject, ...(text !== null ? { text } : {}), ...(html !== null ? { html } : {}) });
    await execute("UPDATE emails SET status='sent',provider_id=?,message_id=?,relay_message_id=?,error_message=NULL WHERE id=?", [result.response.slice(0, 500), result.messageId, relayMessageIdFromResponse(result.response), id]);
    await emitWebhookEvent(run.api_key_id, 'email.sent', { email_id: id, from, to: [recipient], subject, message_id: result.messageId });
    return { email_id: id, message_id: result.messageId };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.slice(0, 500) : 'Automation email failed.';
    await execute("UPDATE emails SET status='failed',error_message=? WHERE id=?", [message, id]);
    await emitWebhookEvent(run.api_key_id, 'email.failed', { email_id: id, error: message });
    throw new Error(message);
  }
}

function renderVariables(value: string, context: Record<string, unknown>, html: boolean) {
  return value.replace(/\{\{\{\s*([A-Za-z0-9_.-]{1,200})\s*\}\}\}|\{\{\s*([A-Za-z0-9_.-]{1,200})\s*\}\}/g, (_match, triplePath: string | undefined, doublePath: string | undefined) => {
    const path = triplePath ?? doublePath;
    if (!path) return '';
    const found = resolvePath(context, path);
    const text = found === undefined || found === null ? '' : typeof found === 'string' ? found : JSON.stringify(found);
    return html && !triplePath ? escapeHtml(text) : text;
  });
}

function materializeValue(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === 'string') return renderVariables(value, context, false);
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).var === 'string') return resolvePath(context, String((value as Record<string, unknown>).var)) ?? null;
  return value;
}

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char); }

function resolvePath(context: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.') && Object.hasOwn(context, path)) return context[path];
  let segments = path.split('.');
  if (!path.includes('.')) segments = ['contact', path];
  let current: unknown = context;
  if (segments[0] === 'wait_events' && context.wait_events && typeof context.wait_events === 'object') {
    const waitEvents = context.wait_events as Record<string, unknown>;
    const keys = Object.keys(waitEvents).sort((a, b) => b.length - a.length);
    const match = keys.find((key) => path === `wait_events.${key}` || path.startsWith(`wait_events.${key}.`));
    if (match) {
      current = waitEvents[match];
      const remainder = path.slice(`wait_events.${match}`.length).replace(/^\./, '');
      segments = remainder ? remainder.split('.') : [];
    }
  }
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function evaluateCondition(config: Record<string, unknown>, context: Record<string, unknown>): boolean {
  const type = config.type ?? 'rule';
  if (type === 'and' && Array.isArray(config.rules)) return config.rules.every((rule) => rule && typeof rule === 'object' && evaluateCondition(rule as Record<string, unknown>, context));
  if (type === 'or' && Array.isArray(config.rules)) return config.rules.some((rule) => rule && typeof rule === 'object' && evaluateCondition(rule as Record<string, unknown>, context));
  if (type !== 'rule' || typeof config.field !== 'string' || typeof config.operator !== 'string') return false;
  const actual = resolvePath(context, config.field);
  const expectedValue = config.value && typeof config.value === 'object' && !Array.isArray(config.value) && typeof (config.value as Record<string, unknown>).var === 'string'
    ? resolvePath(context, String((config.value as Record<string, unknown>).var))
    : config.value;
  switch (config.operator) {
    case 'exists': return actual !== undefined && actual !== null;
    case 'is_empty': return actual === undefined || actual === null || actual === '' || Array.isArray(actual) && actual.length === 0;
    case 'eq': return actual === expectedValue;
    case 'neq': return actual !== expectedValue;
    case 'gt': return Number(actual) > Number(expectedValue);
    case 'gte': return Number(actual) >= Number(expectedValue);
    case 'lt': return Number(actual) < Number(expectedValue);
    case 'lte': return Number(actual) <= Number(expectedValue);
    case 'contains': return Array.isArray(actual) ? actual.includes(expectedValue) : typeof actual === 'string' && actual.includes(String(expectedValue));
    case 'starts_with': return typeof actual === 'string' && actual.startsWith(String(expectedValue));
    case 'ends_with': return typeof actual === 'string' && actual.endsWith(String(expectedValue));
    default: return false;
  }
}

function nextStep(connections: AutomationConnection[], stepKey: string, condition?: boolean) {
  const outgoing = connections.filter((edge) => edge.from === stepKey);
  if (condition !== undefined) {
    const label = condition ? 'true' : 'false';
    return outgoing.find((edge) => edge.condition === label)?.to ?? outgoing[condition ? 0 : 1]?.to ?? null;
  }
  return outgoing[0]?.to ?? null;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function stableStringify(value: unknown): string {
  const sortObject = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sortObject);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.keys(item as Record<string, unknown>).sort().map((key) => [key, sortObject((item as Record<string, unknown>)[key])]));
  };
  return JSON.stringify(sortObject(value));
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
