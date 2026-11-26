import { execute, nowIso, query, queryOne, randomId, transaction } from '@/lib/database';
import { normalizeEmailDesign, renderEmailDesign, type EmailDesign } from '@/lib/email-design';

export type TemplateVariable = {
  id: string;
  key: string;
  type: 'string' | 'number';
  fallback_value: string | number | null;
  created_at: string;
  updated_at: string;
};

export type TemplateContent = {
  name: string;
  alias: string | null;
  from: string | null;
  subject: string;
  reply_to: string | null;
  html: string;
  text: string | null;
  variables: TemplateVariable[];
  design?: EmailDesign | null;
};

export type TemplateRecord = TemplateContent & {
  id: string;
  current_version_id: string | null;
  published_version_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TemplateRequestInput = {
  name?: unknown;
  alias?: unknown;
  from?: unknown;
  subject?: unknown;
  reply_to?: unknown;
  html?: unknown;
  text?: unknown;
  variables?: unknown;
  design?: unknown;
};

type StoredTemplate = Omit<TemplateRecord, 'from' | 'variables'> & {
  from_address: string | null;
  variables_json: string | null;
  editor_json: string | null;
};
type StoredTemplateSummary = Omit<StoredTemplate, 'html' | 'text'>;

type StoredVersion = { id: string; template_id: string; snapshot_json: string; created_at: string; published_at: string | null };

const templateColumns = 'id,name,alias,from_address,subject,reply_to,html,text,variables_json,editor_json,current_version_id,published_version_id,published_at,created_at,updated_at';
const templateSummaryColumns = 'id,name,alias,from_address,subject,reply_to,variables_json,current_version_id,published_version_id,published_at,created_at,updated_at';
const reservedVariables = new Set(['FIRST_NAME', 'LAST_NAME', 'EMAIL', 'RESEND_UNSUBSCRIBE_URL', 'UNSUBSCRIBE_URL', 'CONTACT', 'THIS']);
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function storedTemplateToContent(template: StoredTemplate): TemplateContent {
  return {
    name: template.name,
    alias: template.alias,
    from: template.from_address,
    subject: template.subject,
    reply_to: template.reply_to,
    html: template.html ?? '',
    text: template.text,
    variables: parseJson<TemplateVariable[]>(template.variables_json, []),
    design: parseJson<EmailDesign | null>(template.editor_json, null),
  };
}

export function normalizeTemplateVariables(value: unknown, existing: TemplateVariable[] = []): { ok: true; variables: TemplateVariable[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, variables: existing };
  if (!Array.isArray(value) || value.length > 50) return { ok: false, error: 'variables must be an array with no more than 50 entries.' };
  const currentByKey = new Map(existing.map((variable) => [variable.key, variable]));
  const keys = new Set<string>();
  const timestamp = nowIso();
  const variables: TemplateVariable[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, error: 'Each variable must be an object with a key and type.' };
    const { key, type } = item as { key?: unknown; type?: unknown };
    const fallbackValue = (item as { fallback_value?: unknown; fallbackValue?: unknown }).fallback_value ?? (item as { fallbackValue?: unknown }).fallbackValue ?? null;
    if (typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,49}$/.test(key) || reservedVariables.has(key.toUpperCase())) {
      return { ok: false, error: 'Variable keys must be 1 to 50 letters, numbers or underscores and cannot use reserved names.' };
    }
    if (type !== 'string' && type !== 'number') return { ok: false, error: `Variable "${key}" type must be string or number.` };
    if (fallbackValue !== null) {
      const invalidFallback = type === 'string'
        ? typeof fallbackValue !== 'string' || fallbackValue.length > 2_000
        : typeof fallbackValue !== 'number' || !Number.isFinite(fallbackValue) || Math.abs(fallbackValue) > Number.MAX_SAFE_INTEGER;
      if (invalidFallback) return { ok: false, error: `Variable "${key}" has an invalid fallback value.` };
    }
    if (keys.has(key)) return { ok: false, error: `Variable "${key}" is duplicated.` };
    keys.add(key);
    const current = currentByKey.get(key);
    variables.push({ id: current?.id ?? randomId('var'), key, type, fallback_value: fallbackValue as string | number | null, created_at: current?.created_at ?? timestamp, updated_at: timestamp });
  }
  return { ok: true, variables };
}

function normalizeOptionalText(value: unknown, field: string, maxLength: number): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'string' || value.length > maxLength || /[\r\n]/.test(value)) return { ok: false, error: `${field} must be a single-line string of up to ${maxLength} characters or null.` };
  return { ok: true, value: value.trim() || null };
}

export function validateTemplateRequest(input: unknown, current?: TemplateContent, requireHtml = false): { ok: true; content: TemplateContent } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Request body must be a JSON object.' };
  const body = input as TemplateRequestInput;
  const nameValue = body.name === undefined ? current?.name : body.name;
  const name = typeof nameValue === 'string' ? nameValue.trim() : '';
  if (!name || name.length > 120) return { ok: false, error: 'name must be 1 to 120 characters.' };

  const aliasValue = body.alias === undefined ? current?.alias ?? null : body.alias;
  if (aliasValue !== null && (typeof aliasValue !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(aliasValue))) return { ok: false, error: 'alias must be up to 120 letters, numbers, dots, underscores or hyphens.' };

  const fromResult = normalizeOptionalText(body.from === undefined ? current?.from : body.from, 'from', 320);
  if (!fromResult.ok) return fromResult;
  if (fromResult.value && !emailPattern.test((/<([^<>]+)>$/.exec(fromResult.value)?.[1] ?? fromResult.value).trim())) return { ok: false, error: 'from must contain a valid email address.' };
  const replyResult = normalizeOptionalText(body.reply_to === undefined ? current?.reply_to : body.reply_to, 'reply_to', 320);
  if (!replyResult.ok) return replyResult;
  if (replyResult.value && !emailPattern.test((/<([^<>]+)>$/.exec(replyResult.value)?.[1] ?? replyResult.value).trim())) return { ok: false, error: 'reply_to must contain a valid email address.' };

  const subjectValue = body.subject === undefined ? current?.subject ?? '' : body.subject;
  if (typeof subjectValue !== 'string' || subjectValue.length > 998 || /[\r\n]/.test(subjectValue)) return { ok: false, error: 'subject must be a single-line string of up to 998 characters.' };

  const designProvided = Object.prototype.hasOwnProperty.call(body, 'design');
  let design = current?.design ?? null;
  if (designProvided) {
    if (body.design === null) design = null;
    else {
      const normalized = normalizeEmailDesign(body.design);
      if (!normalized.ok) return normalized;
      design = normalized.design;
    }
  } else if (Object.prototype.hasOwnProperty.call(body, 'html')) {
    design = null;
  }

  let htmlValue: unknown;
  if (designProvided && design) htmlValue = renderEmailDesign(design);
  else htmlValue = body.html === undefined ? current?.html : body.html;
  if (requireHtml && typeof htmlValue !== 'string') return { ok: false, error: 'html must be a string.' };
  if (htmlValue !== undefined && htmlValue !== null && typeof htmlValue !== 'string') return { ok: false, error: 'html must be a string.' };
  if (typeof htmlValue === 'string' && htmlValue.length > 500_000) return { ok: false, error: 'html must not exceed 500 KB.' };

  const textValue = body.text === undefined ? current?.text ?? null : body.text;
  if (textValue !== null && typeof textValue !== 'string') return { ok: false, error: 'text must be a string or null.' };
  if (typeof textValue === 'string' && textValue.length > 500_000) return { ok: false, error: 'text must not exceed 500 KB.' };
  if (requireHtml && typeof htmlValue === 'string' && !htmlValue.trim()) return { ok: false, error: 'html must contain some content.' };
  if (!requireHtml && !(typeof htmlValue === 'string' && htmlValue.trim()) && !(typeof textValue === 'string' && textValue.trim())) return { ok: false, error: 'Provide HTML content, text content or both.' };

  const variables = normalizeTemplateVariables(body.variables, current?.variables ?? []);
  if (!variables.ok) return variables;
  return { ok: true, content: { name, alias: aliasValue as string | null, from: fromResult.value, subject: subjectValue.trim(), reply_to: replyResult.value, html: typeof htmlValue === 'string' ? htmlValue : '', text: textValue as string | null, variables: variables.variables, design } };
}

export async function findEmailTemplate(identifier: string) {
  return queryOne<StoredTemplate>(`SELECT ${templateColumns} FROM email_templates WHERE id=? OR alias=? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`, [identifier, identifier, identifier]);
}

export async function listEmailTemplates() {
  return (await query<StoredTemplateSummary>(`SELECT ${templateSummaryColumns} FROM email_templates ORDER BY updated_at DESC,id DESC LIMIT 200`)).rows;
}

export async function listEmailTemplatePage(limit: number, after: string | null, before: string | null) {
  if (after && before) return { ok: false as const, error: 'Use either after or before, not both.' };
  const cursorId = after ?? before;
  const cursor = cursorId ? await queryOne<{ id: string; updated_at: string }>('SELECT id,updated_at FROM email_templates WHERE id=?', [cursorId]) : undefined;
  if (cursorId && !cursor) return { ok: false as const, error: 'The pagination cursor was not found.' };
  let rows: StoredTemplateSummary[];
  if (after && cursor) {
    rows = (await query<StoredTemplateSummary>(`SELECT ${templateSummaryColumns} FROM email_templates
      WHERE updated_at<? OR (updated_at=? AND id<?) ORDER BY updated_at DESC,id DESC LIMIT ?`, [cursor.updated_at, cursor.updated_at, cursor.id, limit + 1])).rows;
  } else if (before && cursor) {
    rows = (await query<StoredTemplateSummary>(`SELECT ${templateSummaryColumns} FROM email_templates
      WHERE updated_at>? OR (updated_at=? AND id>?) ORDER BY updated_at ASC,id ASC LIMIT ?`, [cursor.updated_at, cursor.updated_at, cursor.id, limit + 1])).rows;
  } else {
    rows = (await query<StoredTemplateSummary>(`SELECT ${templateSummaryColumns} FROM email_templates ORDER BY updated_at DESC,id DESC LIMIT ?`, [limit + 1])).rows;
  }
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  if (before) data.reverse();
  return { ok: true as const, data, hasMore };
}

export function emailTemplateResponse(template: StoredTemplate) {
  const content = storedTemplateToContent(template);
  return {
    object: 'template',
    id: template.id,
    current_version_id: template.current_version_id,
    alias: content.alias,
    name: content.name,
    created_at: template.created_at,
    updated_at: template.updated_at,
    status: template.published_version_id ? 'published' : 'draft',
    published_at: template.published_at,
    from: content.from,
    subject: content.subject,
    reply_to: content.reply_to,
    html: content.html,
    text: content.text,
    variables: content.variables,
    design: content.design ?? null,
    has_unpublished_versions: Boolean(template.current_version_id && template.current_version_id !== template.published_version_id),
  };
}

export function emailTemplateSummaryResponse(template: StoredTemplateSummary) {
  const content = { name: template.name, alias: template.alias, from: template.from_address, subject: template.subject, reply_to: template.reply_to, variables: parseJson<TemplateVariable[]>(template.variables_json, []) };
  return {
    object: 'template',
    id: template.id,
    current_version_id: template.current_version_id,
    alias: content.alias,
    name: content.name,
    created_at: template.created_at,
    updated_at: template.updated_at,
    status: template.published_version_id ? 'published' : 'draft',
    published_at: template.published_at,
    from: content.from,
    subject: content.subject,
    reply_to: content.reply_to,
    variables: content.variables,
    has_unpublished_versions: Boolean(template.current_version_id && template.current_version_id !== template.published_version_id),
  };
}

function serializeContent(content: TemplateContent) {
  return JSON.stringify(content);
}

export async function ensureCurrentTemplateVersion(template: StoredTemplate) {
  if (template.current_version_id) return template.current_version_id;
  const versionId = randomId('tplv');
  await transaction([
    { sql: 'INSERT INTO email_template_versions(id,template_id,snapshot_json,created_at,published_at) VALUES(?,?,?,?,NULL)', params: [versionId, template.id, serializeContent(storedTemplateToContent(template)), template.updated_at] },
    { sql: 'UPDATE email_templates SET current_version_id=? WHERE id=? AND current_version_id IS NULL', params: [versionId, template.id] },
  ]);
  const refreshed = await findEmailTemplate(template.id);
  if (refreshed?.current_version_id !== versionId) await execute('DELETE FROM email_template_versions WHERE id=? AND template_id=?', [versionId, template.id]);
  return refreshed?.current_version_id ?? versionId;
}

export async function createEmailTemplate(content: TemplateContent) {
  const id = randomId('tpl');
  const versionId = randomId('tplv');
  const timestamp = nowIso();
  await transaction([
    { sql: `INSERT INTO email_templates(id,name,alias,from_address,subject,reply_to,html,text,variables_json,editor_json,current_version_id,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`, params: [id, content.name, content.alias, content.from, content.subject, content.reply_to, content.html, content.text, JSON.stringify(content.variables), content.design ? JSON.stringify(content.design) : null, versionId, timestamp, timestamp] },
    { sql: 'INSERT INTO email_template_versions(id,template_id,snapshot_json,created_at,published_at) VALUES(?,?,?,?,NULL)', params: [versionId, id, serializeContent(content), timestamp] },
  ]);
  return findEmailTemplate(id);
}

export async function saveEmailTemplateDraft(id: string, content: TemplateContent, expectedVersionId: string) {
  const current = await findEmailTemplate(id);
  if (!current) return undefined;
  const previousContent = storedTemplateToContent(current);
  const timestamp = nowIso();
  if (JSON.stringify(previousContent) === JSON.stringify(content)) return current;
  const versionId = randomId('tplv');
  await transaction([
    { sql: `UPDATE email_templates SET name=?,alias=?,from_address=?,subject=?,reply_to=?,html=?,text=?,variables_json=?,editor_json=?,current_version_id=?,updated_at=? WHERE id=? AND current_version_id=?`,
      params: [content.name, content.alias, content.from, content.subject, content.reply_to, content.html, content.text, JSON.stringify(content.variables), content.design ? JSON.stringify(content.design) : null, versionId, timestamp, id, expectedVersionId] },
    { sql: `INSERT INTO email_template_versions(id,template_id,snapshot_json,created_at,published_at)
      SELECT ?,?,?,?,NULL WHERE EXISTS (SELECT 1 FROM email_templates WHERE id=? AND current_version_id=?)`,
      params: [versionId, id, serializeContent(content), timestamp, id, versionId] },
  ]);
  const updated = await findEmailTemplate(id);
  return updated?.current_version_id === versionId ? updated : null;
}

export async function publishEmailTemplate(template: StoredTemplate) {
  const current = await findEmailTemplate(template.id);
  if (!current) return undefined;
  const versionId = await ensureCurrentTemplateVersion(current);
  const timestamp = nowIso();
  await transaction([
    { sql: 'UPDATE email_templates SET published_version_id=?,published_at=?,status=\'published\',updated_at=? WHERE id=? AND current_version_id=?', params: [versionId, timestamp, timestamp, template.id, versionId] },
    { sql: `UPDATE email_template_versions SET published_at=COALESCE(published_at,?) WHERE id=? AND template_id=?
      AND EXISTS (SELECT 1 FROM email_templates WHERE id=? AND current_version_id=? AND published_version_id=?)`,
      params: [timestamp, versionId, template.id, template.id, versionId, versionId] },
  ]);
  const updated = await findEmailTemplate(template.id);
  return updated?.current_version_id === versionId && updated.published_version_id === versionId ? updated : null;
}

export async function getPublishedTemplateContent(template: StoredTemplate) {
  if (!template.published_version_id) return undefined;
  const version = await queryOne<StoredVersion>('SELECT id,template_id,snapshot_json,created_at,published_at FROM email_template_versions WHERE id=? AND template_id=? AND published_at IS NOT NULL', [template.published_version_id, template.id]);
  if (!version) return undefined;
  const parsed = parseJson<TemplateContent | undefined>(version.snapshot_json, undefined);
  return parsed;
}

export async function listEmailTemplateVersions(template: StoredTemplate) {
  const versions = (await query<StoredVersion>('SELECT id,template_id,snapshot_json,created_at,published_at FROM email_template_versions WHERE template_id=? ORDER BY created_at DESC,id DESC', [template.id])).rows;
  return versions.map((version) => ({
    id: version.id,
    object: 'template_version',
    created_at: version.created_at,
    published_at: version.published_at,
    is_current: version.id === template.current_version_id,
    is_published: version.id === template.published_version_id,
    ...parseJson<TemplateContent>(version.snapshot_json, storedTemplateToContent(template)),
  }));
}
