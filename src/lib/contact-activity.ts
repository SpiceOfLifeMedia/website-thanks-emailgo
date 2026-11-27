export type ContactActivityCursor = { created_at: string; id: string };

export type ContactActivityRow = {
  id: string;
  type: string;
  created_at: string;
  subject: string | null;
  detail: string | null;
  email_id: string | null;
};

const MAX_CURSOR_LENGTH = 1024;

export function encodeContactActivityCursor(cursor: ContactActivityCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeContactActivityCursor(value: string | null): ContactActivityCursor | null | undefined {
  if (value === null) return null;
  if (!value || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof parsed.created_at !== 'string' || !Number.isFinite(Date.parse(parsed.created_at))) return undefined;
    if (typeof parsed.id !== 'string' || !/^[A-Za-z0-9:._-]{1,220}$/.test(parsed.id)) return undefined;
    return { created_at: parsed.created_at, id: parsed.id };
  } catch {
    return undefined;
  }
}

function recipientContains(column: string, isPostgres: boolean) {
  const source = isPostgres
    ? `jsonb_array_elements_text(COALESCE(${column}::jsonb, '[]'::jsonb)) AS recipient(value)`
    : `json_each(COALESCE(${column}, '[]')) AS recipient`;
  const value = isPostgres ? 'recipient.value' : 'CAST(recipient.value AS TEXT)';
  return `EXISTS (SELECT 1 FROM ${source} WHERE lower(${value})=lower(?))`;
}

function recipientCount(isPostgres: boolean) {
  const length = (column: string) => isPostgres
    ? `jsonb_array_length(COALESCE(${column}::jsonb, '[]'::jsonb))`
    : `json_array_length(COALESCE(${column}, '[]'))`;
  return `${length('e.to_json')} + ${length('e.cc_json')} + ${length('e.bcc_json')}`;
}

export function contactActivityQuery(contactId: string, email: string, cursor: ContactActivityCursor | null, limit: number, isPostgres: boolean) {
  const recipientColumns = ['e.to_json', 'e.cc_json', 'e.bcc_json'];
  const emailRecipientMatch = recipientColumns.map((column) => recipientContains(column, isPostgres)).join(' OR ');
  const singleRecipient = recipientCount(isPostgres);
  const activity = [
    `SELECT 'contact.created:' || id AS id,'contact.created' AS type,created_at,NULL AS subject,NULL AS detail,NULL AS email_id FROM contacts WHERE id=?`,
    `SELECT 'contact.unsubscribed:' || id AS id,'contact.unsubscribed' AS type,unsubscribed_at AS created_at,NULL AS subject,NULL AS detail,NULL AS email_id FROM contacts WHERE id=? AND unsubscribed_at IS NOT NULL`,
    `SELECT 'sent-event:' || ev.id AS id,'email.sent' AS type,ev.created_at,e.subject,NULL AS detail,e.id AS email_id FROM email_events ev JOIN emails e ON e.id=ev.email_id WHERE ev.type='email.sent' AND (${emailRecipientMatch})`,
    `SELECT 'email.sent:' || e.id AS id,'email.sent' AS type,e.created_at,e.subject,NULL AS detail,e.id AS email_id FROM emails e WHERE e.status IN ('sent','deferred','delivered','bounced','complained') AND NOT EXISTS (SELECT 1 FROM email_events ev WHERE ev.email_id=e.id AND ev.type='email.sent') AND (${emailRecipientMatch})`,
    `SELECT 'event:' || ev.id AS id,ev.type,ev.created_at,e.subject,NULL AS detail,e.id AS email_id FROM email_events ev JOIN emails e ON e.id=ev.email_id WHERE ev.type IN ('email.opened','email.clicked') AND (${emailRecipientMatch}) AND (${singleRecipient})=1`,
    `SELECT 'delivery:' || d.id AS id,CASE d.event_type WHEN 'deferred' THEN 'delivery.delayed' ELSE 'delivery.' || d.event_type END AS type,d.created_at,e.subject,d.detail,d.email_id FROM delivery_events d LEFT JOIN emails e ON e.id=d.email_id WHERE lower(d.recipient)=lower(?) AND d.event_type IN ('delivered','bounced','complained','deferred')`,
    `SELECT 'received:' || id AS id,'email.received' AS type,received_at AS created_at,subject,NULL AS detail,id AS email_id FROM received_emails WHERE lower(from_address)=lower(?)`,
  ];
  const params: Array<string | number> = [contactId, contactId];
  for (const _column of recipientColumns) params.push(email);
  for (const _column of recipientColumns) params.push(email);
  for (const _column of recipientColumns) params.push(email);
  params.push(email, email);

  const cursorFilter = cursor ? 'WHERE created_at<? OR (created_at=? AND id<?)' : '';
  if (cursor) params.push(cursor.created_at, cursor.created_at, cursor.id);
  params.push(limit + 1);

  return {
    sql: `WITH activity AS (${activity.join(' UNION ALL ')}) SELECT id,type,created_at,subject,detail,email_id FROM activity ${cursorFilter} ORDER BY created_at DESC,id DESC LIMIT ?`,
    params,
  };
}

export const contactActivityLabels: Record<string, string> = {
  'contact.created': 'Contact added',
  'contact.subscribed': 'Opted in',
  'contact.unsubscribed': 'Unsubscribed',
  'email.sent': 'Email sent',
  'email.received': 'Email received',
  'email.opened': 'Opened email',
  'email.clicked': 'Clicked email',
  'delivery.delivered': 'Delivered',
  'delivery.delayed': 'Delivery delayed',
  'delivery.bounced': 'Bounced',
  'delivery.complained': 'Complained',
};

export function safeContactActivityBounce(detail: string | null) {
  const [rawType = '', rawSubtype = ''] = (detail ?? '').split('/').map((value) => value.trim());
  const bounceType = rawType === 'Permanent' ? 'Permanent' : rawType === 'Transient' ? 'Temporary' : 'Undetermined';
  const known: Record<string, string> = {
    NoEmail: 'Address does not exist',
    MailboxFull: 'Mailbox is full',
    MessageTooLarge: 'Message was too large',
    ContentRejected: 'Message was rejected',
    AttachmentRejected: 'An attachment was rejected',
  };
  return { bounceType, bounceSubtype: known[rawSubtype] ?? null };
}

export function safeContactActivityDetail(type: string, detail: string | null) {
  if (type === 'delivery.delayed') return detail && /^(Transient|Undetermined)\s*\//.test(detail) ? null : 'Delivery will be tried again.';
  if (type === 'delivery.complained') return 'The recipient marked this message as unwanted.';
  if (type !== 'delivery.bounced' || !detail) return null;
  return safeContactActivityBounce(detail).bounceSubtype;
}
