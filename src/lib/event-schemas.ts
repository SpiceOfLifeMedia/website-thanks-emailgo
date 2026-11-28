import { execute, nowIso, query, queryOne, randomId } from '@/lib/database';

export type EventSchemaFieldType = 'string' | 'number' | 'boolean' | 'date';
export type EventSchema = Record<string, EventSchemaFieldType>;
type EventSchemaRow = { id: string; name: string; schema_json: string | null; created_at: string; updated_at: string };

const eventNamePattern = /^(?!resend:)[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/;
const fieldNamePattern = /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/;
const eventSchemaTypes = new Set<EventSchemaFieldType>(['string', 'number', 'boolean', 'date']);

function present(row: EventSchemaRow) {
  let schema: EventSchema | null = null;
  try { schema = row.schema_json ? JSON.parse(row.schema_json) as EventSchema : null; } catch {}
  return { id: row.id, name: row.name, schema, created_at: row.created_at, updated_at: row.updated_at };
}

export function parseEventSchema(value: unknown): { ok: true; schema: EventSchema | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, schema: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'schema must be an object or null.' };
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) return { ok: false, error: 'schema can contain at most 100 fields.' };
  for (const [name, type] of entries) {
    if (!fieldNamePattern.test(name)) return { ok: false, error: `schema field "${name}" has an invalid name.` };
    if (typeof type !== 'string' || !eventSchemaTypes.has(type as EventSchemaFieldType)) return { ok: false, error: `schema field "${name}" must use string, number, boolean, or date.` };
  }
  return { ok: true, schema: value as EventSchema };
}

export function validateEventPayload(payload: Record<string, unknown>, schema: EventSchema) {
  const coerced: Record<string, unknown> = { ...payload };
  for (const [name, type] of Object.entries(schema)) {
    if (!Object.hasOwn(coerced, name)) continue;
    const value = coerced[name];
    if (value === null || typeof value === 'object') return { ok: false as const, error: `payload field "${name}" must be a ${type}.` };
    if (type === 'string') {
      if (typeof value === 'string') continue;
      if (typeof value === 'number' || typeof value === 'boolean') coerced[name] = String(value);
      else return { ok: false as const, error: `payload field "${name}" must be a string.` };
    } else if (type === 'number') {
      const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
      if (!Number.isFinite(number)) return { ok: false as const, error: `payload field "${name}" must be a number.` };
      coerced[name] = number;
    } else if (type === 'boolean') {
      if (typeof value === 'boolean') continue;
      if (value === 'true' || value === 1) coerced[name] = true;
      else if (value === 'false' || value === 0) coerced[name] = false;
      else return { ok: false as const, error: `payload field "${name}" must be a boolean.` };
    } else {
      const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
      if (!date || !Number.isFinite(date.getTime())) return { ok: false as const, error: `payload field "${name}" must be a valid date.` };
      coerced[name] = date.toISOString();
    }
  }
  return { ok: true as const, payload: coerced };
}

export async function listEventSchemas(apiKeyId: string) {
  const rows = await query<EventSchemaRow>('SELECT id,name,schema_json,created_at,updated_at FROM custom_event_schemas WHERE api_key_id=? ORDER BY updated_at DESC,id DESC', [apiKeyId]);
  return rows.rows.map(present);
}

export async function findEventSchema(apiKeyId: string, identifier: string) {
  const row = await queryOne<EventSchemaRow>('SELECT id,name,schema_json,created_at,updated_at FROM custom_event_schemas WHERE api_key_id=? AND (id=? OR name=?) LIMIT 1', [apiKeyId, identifier, identifier]);
  return row ? present(row) : undefined;
}

export async function createEventSchema(apiKeyId: string, name: string, schema: EventSchema | null) {
  const id = randomId('evt');
  const timestamp = nowIso();
  await execute('INSERT INTO custom_event_schemas(id,api_key_id,name,schema_json,created_at,updated_at) VALUES(?,?,?,?,?,?)', [id, apiKeyId, name, schema === null ? null : JSON.stringify(schema), timestamp, timestamp]);
  return { id, name, schema, created_at: timestamp, updated_at: timestamp };
}

export async function updateEventSchema(apiKeyId: string, identifier: string, schema: EventSchema | null) {
  const existing = await findEventSchema(apiKeyId, identifier);
  if (!existing) return undefined;
  const updatedAt = nowIso();
  await execute('UPDATE custom_event_schemas SET schema_json=?,updated_at=? WHERE id=? AND api_key_id=?', [schema === null ? null : JSON.stringify(schema), updatedAt, existing.id, apiKeyId]);
  return { ...existing, schema, updated_at: updatedAt };
}

export async function deleteEventSchema(apiKeyId: string, identifier: string) {
  const existing = await findEventSchema(apiKeyId, identifier);
  if (!existing) return undefined;
  await execute('DELETE FROM custom_event_schemas WHERE id=? AND api_key_id=?', [existing.id, apiKeyId]);
  return existing;
}

export function isValidEventName(name: string) {
  return eventNamePattern.test(name);
}
