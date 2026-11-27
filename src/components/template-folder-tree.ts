export type TemplateFolderNode = { id: string; name: string; parent_id: string | null };
export type TemplateFolderRow<T extends TemplateFolderNode = TemplateFolderNode> = { folder: T; depth: number; path: string };

export function flattenTemplateFolders<T extends TemplateFolderNode>(folders: T[]): TemplateFolderRow<T>[] {
  const children = new Map<string | null, T[]>();
  for (const folder of folders) children.set(folder.parent_id, [...(children.get(folder.parent_id) ?? []), folder]);
  for (const siblings of children.values()) siblings.sort((first, second) => first.name.localeCompare(second.name));

  const rows: TemplateFolderRow<T>[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, depth: number, parentPath: string) => {
    for (const folder of children.get(parentId) ?? []) {
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      const path = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
      rows.push({ folder, depth, path });
      visit(folder.id, depth + 1, path);
    }
  };

  visit(null, 0, '');
  return rows;
}
