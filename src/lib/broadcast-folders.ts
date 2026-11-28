import { execute, nowIso, query, queryOne, randomId, transaction } from './database.ts';
import { normalizeTemplateFolderName } from './template-folder-utils.ts';

export type BroadcastFolder = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  broadcast_count: number;
};

type FolderResult =
  | { ok: true; folder: BroadcastFolder }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string };

function isUniqueConflict(cause: unknown) {
  return typeof cause === 'object' && cause !== null && 'code' in cause
    && ['23505', 'ERR_SQLITE_CONSTRAINT_UNIQUE'].includes(String(cause.code));
}

export async function listBroadcastFolders() {
  return (await query<BroadcastFolder>(`SELECT f.id,f.name,f.created_at,f.updated_at,
    CAST((SELECT COUNT(*) FROM broadcasts b WHERE b.folder_id=f.id) AS INTEGER) AS broadcast_count
    FROM broadcast_folders f ORDER BY f.name ASC,f.id ASC`)).rows;
}

export async function createBroadcastFolder(value: unknown): Promise<FolderResult> {
  const normalized = normalizeTemplateFolderName(value);
  if (!normalized.ok) return { ok: false, status: 400, error: normalized.error };
  if (normalized.name.length > 60) return { ok: false, status: 400, error: 'Folder name cannot exceed 60 characters.' };
  if (await queryOne<{ id: string }>('SELECT id FROM broadcast_folders WHERE LOWER(name)=LOWER(?)', [normalized.name])) {
    return { ok: false, status: 409, error: 'A folder with that name already exists.' };
  }

  const id = randomId('bcf');
  const timestamp = nowIso();
  try {
    await execute('INSERT INTO broadcast_folders(id,name,created_at,updated_at) VALUES(?,?,?,?)', [id, normalized.name, timestamp, timestamp]);
  } catch (cause) {
    if (isUniqueConflict(cause)) return { ok: false, status: 409, error: 'A folder with that name already exists.' };
    throw cause;
  }
  const folder = (await listBroadcastFolders()).find((entry) => entry.id === id);
  return folder ? { ok: true, folder } : { ok: false, status: 500, error: 'The folder could not be created.' };
}

export async function renameBroadcastFolder(folderId: string, value: unknown): Promise<FolderResult> {
  const normalized = normalizeTemplateFolderName(value);
  if (!normalized.ok) return { ok: false, status: 400, error: normalized.error };
  if (normalized.name.length > 60) return { ok: false, status: 400, error: 'Folder name cannot exceed 60 characters.' };
  if (!await queryOne<{ id: string }>('SELECT id FROM broadcast_folders WHERE id=?', [folderId])) {
    return { ok: false, status: 404, error: 'Folder not found.' };
  }
  if (await queryOne<{ id: string }>('SELECT id FROM broadcast_folders WHERE LOWER(name)=LOWER(?) AND id<>?', [normalized.name, folderId])) {
    return { ok: false, status: 409, error: 'A folder with that name already exists.' };
  }

  try {
    await execute('UPDATE broadcast_folders SET name=?,updated_at=? WHERE id=?', [normalized.name, nowIso(), folderId]);
  } catch (cause) {
    if (isUniqueConflict(cause)) return { ok: false, status: 409, error: 'A folder with that name already exists.' };
    throw cause;
  }
  const folder = (await listBroadcastFolders()).find((entry) => entry.id === folderId);
  return folder ? { ok: true, folder } : { ok: false, status: 500, error: 'The folder could not be renamed.' };
}

export async function moveBroadcastToFolder(broadcastId: string, folderId: unknown) {
  if (folderId !== null && (typeof folderId !== 'string' || !folderId.trim())) {
    return { ok: false as const, status: 400, error: 'folder_id must be a folder ID or null.' };
  }
  if (typeof folderId === 'string' && !await queryOne<{ id: string }>('SELECT id FROM broadcast_folders WHERE id=?', [folderId])) {
    return { ok: false as const, status: 404, error: 'Folder not found.' };
  }
  const updated = await execute('UPDATE broadcasts SET folder_id=?,updated_at=? WHERE id=?', [folderId as string | null, nowIso(), broadcastId]);
  if (!updated) return { ok: false as const, status: 404, error: 'Campaign not found.' };
  return { ok: true as const };
}

export async function deleteBroadcastFolder(folderId: string) {
  if (!await queryOne<{ id: string }>('SELECT id FROM broadcast_folders WHERE id=?', [folderId])) return false;
  const timestamp = nowIso();
  await transaction([
    { sql: 'UPDATE broadcasts SET folder_id=NULL,updated_at=? WHERE folder_id=?', params: [timestamp, folderId] },
    { sql: 'DELETE FROM broadcast_folders WHERE id=?', params: [folderId] },
  ]);
  return true;
}
