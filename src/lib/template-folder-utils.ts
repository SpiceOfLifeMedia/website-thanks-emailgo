export function normalizeTemplateFolderName(value: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof value !== 'string') return { ok: false, error: 'Folder name must be text.' };
  const name = value.trim();
  if (!name || name.length > 64 || /[\/\\\u0000-\u001f\u007f]/.test(name)) {
    return { ok: false, error: 'Folder name must be 1 to 64 characters and cannot contain slashes or control characters.' };
  }
  return { ok: true, name };
}

export function getTemplateFolderBranchIds(folderId: string, folders: Array<{ id: string; parent_id: string | null }>) {
  const childrenByParent = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parent_id) continue;
    childrenByParent.set(folder.parent_id, [...(childrenByParent.get(folder.parent_id) ?? []), folder.id]);
  }

  const branchIds = new Set([folderId]);
  const pending = [folderId];
  while (pending.length) {
    const parentId = pending.pop();
    if (!parentId) continue;
    for (const childId of childrenByParent.get(parentId) ?? []) {
      if (branchIds.has(childId)) continue;
      branchIds.add(childId);
      pending.push(childId);
    }
  }
  return branchIds;
}
