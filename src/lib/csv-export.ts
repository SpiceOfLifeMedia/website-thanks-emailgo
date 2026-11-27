type ExportField = { key: string; select: string };
type ExportSpec = {
  table: string;
  cursorColumn: string;
  keyScoped?: boolean;
  fields: ExportField[];
  searchColumns: string[];
  statusColumn?: string;
  statusMode?: 'text' | 'http';
};

const exportSpecs = {
  emails: {
    table: 'emails', cursorColumn: 'created_at', keyScoped: true,
    fields: [
      { key: 'id', select: 'id' }, { key: 'created_at', select: 'created_at' },
      { key: 'from', select: 'from_address' }, { key: 'to', select: 'to_json' },
      { key: 'subject', select: 'subject' }, { key: 'status', select: 'status' },
      { key: 'scheduled_at', select: 'scheduled_at' }, { key: 'error', select: 'error_message' },
      { key: 'track_opens', select: 'track_opens' }, { key: 'track_clicks', select: 'track_clicks' },
      { key: 'broadcast_id', select: 'broadcast_id' },
    ],
    searchColumns: ['id', 'from_address', 'to_json', 'subject'], statusColumn: 'status', statusMode: 'text',
  },
  received_emails: {
    table: 'received_emails', cursorColumn: 'received_at', keyScoped: true,
    fields: [
      { key: 'id', select: 'id' }, { key: 'received_at', select: 'received_at' },
      { key: 'from', select: 'from_address' }, { key: 'to', select: 'to_json' },
      { key: 'subject', select: 'subject' }, { key: 'message_id', select: 'message_id' },
    ],
    searchColumns: ['id', 'from_address', 'to_json', 'subject', 'message_id'],
  },
  broadcasts: {
    table: 'broadcasts', cursorColumn: 'created_at', keyScoped: true,
    fields: [
      { key: 'id', select: 'id' }, { key: 'name', select: 'name' },
      { key: 'from', select: 'from_address' }, { key: 'subject', select: 'subject' },
      { key: 'audience_type', select: 'audience_type' }, { key: 'audience_id', select: 'audience_id' },
      { key: 'status', select: 'status' }, { key: 'scheduled_at', select: 'scheduled_at' },
      { key: 'recipient_count', select: 'recipient_count' }, { key: 'created_at', select: 'created_at' },
      { key: 'updated_at', select: 'updated_at' },
    ],
    searchColumns: ['id', 'name', 'from_address', 'subject'], statusColumn: 'status', statusMode: 'text',
  },
  contacts: {
    table: 'contacts', cursorColumn: 'created_at',
    fields: [
      { key: 'id', select: 'id' }, { key: 'email', select: 'email' }, { key: 'name', select: 'name' },
      { key: 'properties', select: 'properties_json' }, { key: 'tags', select: 'tags_json' },
      { key: 'unsubscribed', select: 'CASE WHEN unsubscribed_at IS NULL THEN 0 ELSE 1 END' },
      { key: 'unsubscribed_at', select: 'unsubscribed_at' }, { key: 'consent_status', select: 'consent_status' },
      { key: 'consent_source', select: 'consent_source' }, { key: 'consented_at', select: 'consented_at' },
      { key: 'created_at', select: 'created_at' }, { key: 'updated_at', select: 'updated_at' },
    ],
    searchColumns: ['id', 'email', 'name'],
  },
  domains: {
    table: 'domains', cursorColumn: 'created_at',
    fields: [
      { key: 'id', select: 'id' }, { key: 'domain', select: 'domain' },
      { key: 'created_at', select: 'created_at' }, { key: 'verified_at', select: 'verified_at' },
      { key: 'open_tracking', select: 'open_tracking' }, { key: 'click_tracking', select: 'click_tracking' },
    ],
    searchColumns: ['id', 'domain'],
  },
  logs: {
    table: 'api_request_logs', cursorColumn: 'created_at',
    fields: [
      { key: 'id', select: 'id' }, { key: 'created_at', select: 'created_at' },
      { key: 'endpoint', select: 'endpoint' }, { key: 'method', select: 'method' },
      { key: 'response_status', select: 'response_status' }, { key: 'api_key_name', select: 'api_key_name' },
      { key: 'api_key_prefix', select: 'api_key_prefix' }, { key: 'user_agent', select: 'user_agent' },
      { key: 'request_bytes', select: 'request_bytes' }, { key: 'response_bytes', select: 'response_bytes' },
    ],
    searchColumns: ['id', 'endpoint', 'method'], statusColumn: 'response_status', statusMode: 'http',
  },
  api_keys: {
    table: 'api_keys', cursorColumn: 'created_at',
    fields: [
      { key: 'id', select: 'id' }, { key: 'name', select: 'name' }, { key: 'prefix', select: 'prefix' },
      { key: 'permission', select: 'permission' }, { key: 'domain_id', select: 'domain_id' },
      { key: 'created_at', select: 'created_at' }, { key: 'last_used_at', select: 'last_used_at' },
      { key: 'revoked_at', select: 'revoked_at' },
    ],
    searchColumns: ['id', 'name', 'prefix'],
  },
} satisfies Record<string, ExportSpec>;

export type ExportResource = keyof typeof exportSpecs;
export type ExportCursor = { id: string; sortAt: string };
export type ExportQuery = { sql: string; params: Array<string | number> };

export function isExportResource(value: string | null): value is ExportResource {
  return value !== null && Object.hasOwn(exportSpecs, value);
}

export function exportFields(resource: ExportResource) {
  return exportSpecs[resource].fields.map(({ key }) => key);
}

export function buildExportPageQuery(
  resource: ExportResource,
  apiKeyId: string,
  filter: { search?: string; status?: string },
  cursor: ExportCursor | null,
  limit: number,
): ExportQuery | { error: string } {
  const spec: ExportSpec = exportSpecs[resource];
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) return { error: 'Export page size is invalid.' };
  if (spec.keyScoped) { where.push('api_key_id=?'); params.push(apiKeyId); }

  if (filter.search) {
    where.push(`(${spec.searchColumns.map((column) => `${column} LIKE ?`).join(' OR ')})`);
    params.push(...spec.searchColumns.map(() => `%${filter.search}%`));
  }

  if (filter.status) {
    if (!spec.statusColumn) return { error: 'status is not supported for this export resource.' };
    if (spec.statusMode === 'http') {
      if (filter.status === 'errors') where.push(`${spec.statusColumn} >= 400`);
      else if (filter.status === 'success') where.push(`${spec.statusColumn} < 400`);
      else {
        const status = Number(filter.status);
        if (!Number.isInteger(status) || status < 100 || status > 599) return { error: 'status must be errors, success, or an HTTP status from 100 to 599.' };
        where.push(`${spec.statusColumn}=?`);
        params.push(status);
      }
    } else {
      if (!/^[a-z_]{1,40}$/i.test(filter.status)) return { error: 'status must contain only letters and underscores.' };
      where.push(`${spec.statusColumn}=?`);
      params.push(filter.status);
    }
  }

  if (cursor) {
    where.push(`(${spec.cursorColumn} < ? OR (${spec.cursorColumn} = ? AND id < ?))`);
    params.push(cursor.sortAt, cursor.sortAt, cursor.id);
  }

  const select = spec.fields.map(({ key, select }) => `${select} AS "${key}"`).join(',');
  const clauses = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return {
    sql: `SELECT ${select},${spec.cursorColumn} AS export_cursor FROM ${spec.table} ${clauses} ORDER BY ${spec.cursorColumn} DESC,id DESC LIMIT ?`,
    params: [...params, limit],
  };
}

export function serializeCsvRow(values: readonly unknown[]) {
  return values.map((value) => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[\u0000-\u0020]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',');
}
