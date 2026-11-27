import { execute, nowIso, queryOne, randomId } from './database.ts';

const COPY_SUFFIX = ' (copy)';
const MAX_COPY_NAME_LENGTH = 70;

export function duplicateBroadcastName(name: string) {
  return `${name.slice(0, MAX_COPY_NAME_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
}

export async function duplicateBroadcast(apiKeyId: string, broadcastId: string) {
  const source = await queryOne<{
    name: string;
    from_address: string;
    subject: string;
    text_body: string | null;
    html_body: string | null;
    editor_json: string | null;
    audience_type: string;
    audience_id: string;
  }>(`SELECT name,from_address,subject,text_body,html_body,editor_json,audience_type,audience_id
    FROM broadcasts WHERE id=? AND api_key_id=?`, [broadcastId, apiKeyId]);
  if (!source) return null;

  const duplicateId = randomId('bc');
  const timestamp = nowIso();
  await execute(`INSERT INTO broadcasts(id,name,api_key_id,from_address,subject,text_body,html_body,editor_json,audience_type,audience_id,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'draft',?,?)`, [
    duplicateId,
    duplicateBroadcastName(source.name),
    apiKeyId,
    source.from_address,
    source.subject,
    source.text_body,
    source.html_body,
    source.editor_json,
    source.audience_type,
    source.audience_id,
    timestamp,
    timestamp,
  ]);
  return duplicateId;
}
