import { execute, nowIso, query, queryOne } from '@/lib/database';
import { DEFAULT_WORKSPACE_ID } from './workspaces.ts';

export type ContactPropertyType = 'string' | 'number';
export type ContactPropertyRow = {
  property_key: string;
  type: ContactPropertyType;
  fallback_value_json: string | null;
  created_at: string;
  updated_at: string;
  workspace_id?: string;
};

export function parseContactPropertyValue(bodyValue: unknown, type: ContactPropertyType, field: string) {
  if (bodyValue === undefined || bodyValue === null) return { ok: true as const, value: null };
  if (type === 'string' && typeof bodyValue === 'string' && bodyValue.length <= 1000) return { ok: true as const, value: bodyValue };
  if (type === 'number' && typeof bodyValue === 'number' && Number.isFinite(bodyValue)) return { ok: true as const, value: bodyValue };
  return { ok: false as const, error: `${field} must be ${type === 'string' ? 'a string of up to 1,000 characters' : 'a finite number'} or null.` };
}

export function contactPropertyResponse(row: ContactPropertyRow) {
  let fallbackValue: unknown = null;
  if (row.fallback_value_json !== null) {
    try { fallbackValue = JSON.parse(row.fallback_value_json); } catch {}
  }
  return {
    id: row.property_key,
    object: 'contact_property',
    key: row.property_key,
    type: row.type,
    fallback_value: fallbackValue,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function listContactProperties(workspaceId = DEFAULT_WORKSPACE_ID) {
  return (await query<ContactPropertyRow>('SELECT property_key,type,fallback_value_json,created_at,updated_at,workspace_id FROM contact_properties WHERE workspace_id=? ORDER BY property_key ASC', [workspaceId])).rows;
}

export async function getContactProperty(key: string, workspaceId = DEFAULT_WORKSPACE_ID) {
  return queryOne<ContactPropertyRow>('SELECT property_key,type,fallback_value_json,created_at,updated_at,workspace_id FROM contact_properties WHERE property_key=? AND workspace_id=?', [key, workspaceId]);
}

export async function createContactProperty(key: string, type: ContactPropertyType, fallbackValue: unknown, workspaceId = DEFAULT_WORKSPACE_ID) {
  const now = nowIso();
  await execute('INSERT INTO contact_properties(property_key,type,fallback_value_json,created_at,updated_at,workspace_id) VALUES(?,?,?,?,?,?)', [key, type, fallbackValue === null ? null : JSON.stringify(fallbackValue), now, now, workspaceId]);
  return getContactProperty(key, workspaceId);
}

export async function updateContactProperty(key: string, type: ContactPropertyType, fallbackValue: unknown, workspaceId = DEFAULT_WORKSPACE_ID) {
  const updated = await execute('UPDATE contact_properties SET type=?,fallback_value_json=?,updated_at=? WHERE property_key=? AND workspace_id=?', [type, fallbackValue === null ? null : JSON.stringify(fallbackValue), nowIso(), key, workspaceId]);
  return updated ? getContactProperty(key, workspaceId) : null;
}

export async function deleteContactProperty(key: string, workspaceId = DEFAULT_WORKSPACE_ID) {
  return execute('DELETE FROM contact_properties WHERE property_key=? AND workspace_id=?', [key, workspaceId]);
}
