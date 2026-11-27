import { execute, nowIso, query, queryOne, randomId, transaction } from '@/lib/database';
import { normalizeTemplateFolderName } from '@/lib/template-folder-utils';

export type TemplateFolder = {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function listTemplateFolders() {
  return (await query<TemplateFolder>('SELECT id,name,parent_id,created_at,updated_at FROM email_template_folders ORDER BY name ASC,id ASC')).rows;
}

export async function createTemplateFolder(input: { name: unknown; parent_id?: unknown }) {
  const normalized = normalizeTemplateFolderName(input.name);
  if (!normalized.ok) return { ok: false as const, status: 400, error: normalized.error };
  const parentId = input.parent_id ?? null;
  if (parentId !== null && (typeof parentId !== 'string' || !parentId.trim())) {
    return { ok: false as const, status: 400, error: 'parent_id must be a folder ID or null.' };
  }
  if (typeof parentId === 'string' && !await queryOne<{ id: string }>('SELECT id FROM email_template_folders WHERE id=?', [parentId])) {
    return { ok: false as const, status: 404, error: 'Parent folder not found.' };
  }

  const parent = parentId as string | null;
  const duplicateSql = parent === null
    ? 'SELECT id FROM email_template_folders WHERE name=? AND parent_id IS NULL'
    : 'SELECT id FROM email_template_folders WHERE name=? AND parent_id=?';
  const duplicateParams = parent === null ? [normalized.name] : [normalized.name, parent];
  if (await queryOne<{ id: string }>(duplicateSql, duplicateParams)) {
    return { ok: false as const, status: 409, error: 'A folder with that name already exists here.' };
  }

  const id = randomId('tpf');
  const timestamp = nowIso();
  try {
    await execute('INSERT INTO email_template_folders(id,name,parent_id,created_at,updated_at) VALUES(?,?,?,?,?)', [id, normalized.name, parent, timestamp, timestamp]);
  } catch (cause) {
    if (typeof cause === 'object' && cause !== null && 'code' in cause && ['23505', 'ERR_SQLITE_CONSTRAINT_UNIQUE'].includes(String(cause.code))) {
      return { ok: false as const, status: 409, error: 'A folder with that name already exists here.' };
    }
    throw cause;
  }
  const folder = await queryOne<TemplateFolder>('SELECT id,name,parent_id,created_at,updated_at FROM email_template_folders WHERE id=?', [id]);
  return folder ? { ok: true as const, folder } : { ok: false as const, status: 500, error: 'The folder could not be created.' };
}

export async function moveTemplateToFolder(templateId: string, folderId: string | null) {
  if (folderId !== null && (!folderId.trim() || !await queryOne<{ id: string }>('SELECT id FROM email_template_folders WHERE id=?', [folderId]))) {
    return { ok: false as const, status: 404, error: 'Folder not found.' };
  }
  const updated = await execute('UPDATE email_templates SET folder_id=?,updated_at=? WHERE id=?', [folderId, nowIso(), templateId]);
  if (!updated) return { ok: false as const, status: 404, error: 'Template not found.' };
  return { ok: true as const };
}

export async function deleteTemplateFolder(folderId: string) {
  const folders = await listTemplateFolders();
  if (!folders.some((folder) => folder.id === folderId)) return false;
  const childrenByParent = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parent_id) childrenByParent.set(folder.parent_id, [...(childrenByParent.get(folder.parent_id) ?? []), folder.id]);
  }
  const descendants = new Set<string>([folderId]);
  const pending = [folderId];
  while (pending.length) {
    for (const childId of childrenByParent.get(pending.pop()!) ?? []) {
      if (descendants.has(childId)) continue;
      descendants.add(childId);
      pending.push(childId);
    }
  }
  const ids = [...descendants];
  await transaction([
    { sql: `UPDATE email_templates SET folder_id=NULL,updated_at=? WHERE folder_id IN (${ids.map(() => '?').join(',')})`, params: [nowIso(), ...ids] },
    { sql: 'DELETE FROM email_template_folders WHERE id=?', params: [folderId] },
  ]);
  return true;
}
