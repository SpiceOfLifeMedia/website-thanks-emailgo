export type ImportedContactProperty = { key: string; type: 'string' | 'number' | 'boolean' };
export type ExistingContactProperty = { property_key: string; type: string };

export function planContactPropertyDefinitions(
  imported: ImportedContactProperty[],
  existing: ExistingContactProperty[],
): { ok: true; create: Array<{ key: string; type: 'string' | 'number' }> } | { ok: false; error: string } {
  const existingByKey = new Map(existing.map((property) => [property.property_key, property.type]));
  const create: Array<{ key: string; type: 'string' | 'number' }> = [];

  for (const property of imported) {
    const existingType = existingByKey.get(property.key);
    if (existingType !== undefined) {
      if (existingType !== property.type) return { ok: false, error: `Custom property "${property.key}" is already defined as ${existingType}, not ${property.type}.` };
      continue;
    }
    if (property.type !== 'boolean') create.push({ key: property.key, type: property.type });
  }

  return { ok: true, create };
}
