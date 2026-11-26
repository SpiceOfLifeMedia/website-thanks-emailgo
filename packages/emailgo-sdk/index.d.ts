export type JsonObject = Record<string, unknown>;
export type EmailgoResult<T> = { data: T; error: null } | { data: null; error: Error };
export interface EmailgoOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}
export type EmailgoEmailInput = (EmailgoDirectEmailInput | EmailgoTemplateEmailInput | EmailgoLegacyTemplateEmailInput) & JsonObject;
export type EmailgoEmailCommonInput = {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string | string[];
  scheduled_at?: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
  attachments?: unknown[];
};
export type EmailgoDirectEmailInput = EmailgoEmailCommonInput & {
  from: string;
  subject: string;
  template?: never;
  template_id?: never;
  variables?: never;
} & ({ text: string; html?: string } | { text?: string; html: string });
export type EmailgoTemplateEmailInput = EmailgoEmailCommonInput & {
  from?: string;
  subject?: string;
  template: { id: string; variables?: Record<string, string | number> };
  text?: never;
  html?: never;
  template_id?: never;
  variables?: never;
};
export type EmailgoLegacyTemplateEmailInput = EmailgoEmailCommonInput & { from?: string; subject?: string; template_id: string; variables?: Record<string, string | number>; template?: never; text?: never; html?: never };
export interface EmailgoTemplateVariable {
  key: string;
  type: 'string' | 'number';
  fallback_value?: string | number | null;
}
export interface EmailgoTemplateInput extends JsonObject {
  name: string;
  html: string;
  alias?: string;
  from?: string;
  subject?: string;
  reply_to?: string;
  text?: string;
  variables?: EmailgoTemplateVariable[];
}
export interface EmailgoList<T = JsonObject> {
  data: T[];
  has_more?: boolean;
  next_after?: string;
  next_before?: string;
}
export interface EmailgoLog {
  id: string;
  object: 'log';
  created_at: string;
  endpoint: string;
  method: string;
  response_status: number;
  user_agent: string | null;
  request_bytes: number | null;
  response_bytes: number | null;
  api_key?: { name: string | null; prefix: string | null };
  request_body?: JsonObject | unknown[] | null;
  response_body?: JsonObject | unknown[] | null;
}
export interface EmailgoKeyInput extends JsonObject {
  name: string;
  permission?: 'full_access' | 'sending_access';
  domain_id?: string;
}
export interface EmailgoDomainInput extends JsonObject { domain: string }
export interface EmailgoQuery { limit?: number; after?: string; before?: string; [key: string]: string | number | boolean | undefined }
export interface EmailgoMetricsQuery {
  start_date?: string;
  end_date?: string;
  timezone?: string;
  granularity?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  metrics?: string | string[];
  dimensions?: string | string[];
  domain_id?: string | string[];
  email_id?: string | string[];
  broadcast_id?: string | string[];
}
export interface EmailgoSegmentMetricsQuery {
  metrics?: string | string[];
  dimensions?: 'segment' | string[];
  segment_id?: string | string[];
}
export interface EmailgoContactImportOptions {
  column_map: { email: string; first_name?: string; last_name?: string; properties?: Record<string, { column: string; type?: 'string' | 'number' | 'boolean' }> };
  on_conflict?: 'upsert' | 'skip';
  segments?: Array<{ id: string }>;
  topics?: Array<{ id: string; subscription: 'opt_in' | 'opt_out' }>;
}
export interface EmailgoBroadcastRecipientsQuery extends EmailgoQuery { type: 'opened' | 'clicked' | 'bounced' | 'complained' | 'delivered' | 'unsubscribed' }
export declare class EmailgoApiError extends Error {
  status: number;
  details: unknown;
}
export declare class Emailgo {
  constructor(apiKey: string, options?: EmailgoOptions);
  request<T = unknown>(method: string, path: string, options?: { query?: Record<string, string | number | boolean | null | undefined>; body?: JsonObject | FormData; idempotencyKey?: string }): Promise<EmailgoResult<T>>;
  emails: {
    send(body: EmailgoEmailInput, options?: { idempotencyKey?: string }): Promise<EmailgoResult<JsonObject>>;
    sendBatch(body: { emails: EmailgoEmailInput[] }, options?: { idempotencyKey?: string }): Promise<EmailgoResult<JsonObject>>;
    list(query?: EmailgoQuery): Promise<EmailgoResult<EmailgoList>>;
    metrics(query?: EmailgoMetricsQuery): Promise<EmailgoResult<JsonObject>>;
    get(id: string): Promise<EmailgoResult<JsonObject>>;
    update(id: string, body: JsonObject): Promise<EmailgoResult<JsonObject>>;
    cancel(id: string): Promise<EmailgoResult<JsonObject>>;
    events(id: string): Promise<EmailgoResult<JsonObject>>;
    receiving: { list(query?: EmailgoQuery): Promise<EmailgoResult<EmailgoList>>; get(id: string): Promise<EmailgoResult<JsonObject>>; attachments(id: string): Promise<EmailgoResult<EmailgoList>>; downloadAttachment(id: string, attachmentId: string): Promise<EmailgoResult<ArrayBuffer>> };
  };
  apiKeys: {
    list(): Promise<EmailgoResult<EmailgoList>>;
    create(body: EmailgoKeyInput): Promise<EmailgoResult<JsonObject>>;
    get(id: string): Promise<EmailgoResult<JsonObject>>;
    update(id: string, body: { name: string }): Promise<EmailgoResult<JsonObject>>;
    revoke(id: string): Promise<EmailgoResult<JsonObject>>;
  };
  domains: {
    list(): Promise<EmailgoResult<EmailgoList>>;
    create(body: EmailgoDomainInput): Promise<EmailgoResult<JsonObject>>;
    get(id: string): Promise<EmailgoResult<JsonObject>>;
    update(id: string, body: { open_tracking?: boolean; click_tracking?: boolean }): Promise<EmailgoResult<JsonObject>>;
    delete(id: string): Promise<EmailgoResult<JsonObject>>;
    verify(id: string): Promise<EmailgoResult<JsonObject>>;
    dns(id: string): Promise<EmailgoResult<JsonObject>>;
  };
  contacts: {
    list(query?: EmailgoQuery): Promise<EmailgoResult<EmailgoList>>;
    create(body: JsonObject): Promise<EmailgoResult<JsonObject>>;
    get(id: string): Promise<EmailgoResult<JsonObject>>;
    update(id: string, body: JsonObject): Promise<EmailgoResult<JsonObject>>;
    delete(id: string): Promise<EmailgoResult<JsonObject>>;
    topics: { list(id: string): Promise<EmailgoResult<JsonObject>>; update(id: string, body: JsonObject): Promise<EmailgoResult<JsonObject>> };
    segments: { list(contact: { contactId?: string; email?: string }): Promise<EmailgoResult<EmailgoList>>; add(input: { contactId?: string; email?: string; segmentId: string }): Promise<EmailgoResult<JsonObject>>; remove(input: { contactId?: string; email?: string; segmentId: string }): Promise<EmailgoResult<JsonObject>> };
    imports: { create(file: Blob, options: EmailgoContactImportOptions): Promise<EmailgoResult<JsonObject>>; list(query?: EmailgoQuery): Promise<EmailgoResult<EmailgoList>>; get(id: string): Promise<EmailgoResult<JsonObject>> };
  };
  contactProperties: {
    list(): Promise<EmailgoResult<EmailgoList>>;
    create(body: { key: string; type: 'string' | 'number'; fallback_value?: string | number | null }): Promise<EmailgoResult<JsonObject>>;
    get(key: string): Promise<EmailgoResult<JsonObject>>;
    update(key: string, body: { type?: 'string' | 'number'; fallback_value?: string | number | null }): Promise<EmailgoResult<JsonObject>>;
    delete(key: string): Promise<EmailgoResult<JsonObject>>;
  };
  segments: {
    list(): Promise<EmailgoResult<EmailgoList>>;
    create(body: JsonObject): Promise<EmailgoResult<JsonObject>>;
    get(id: string): Promise<EmailgoResult<JsonObject>>;
    update(id: string, body: JsonObject): Promise<EmailgoResult<JsonObject>>;
    delete(id: string): Promise<EmailgoResult<JsonObject>>;
    contacts(id: string, query?: EmailgoQuery): Promise<EmailgoResult<EmailgoList>>;
    metrics(query?: EmailgoSegmentMetricsQuery): Promise<EmailgoResult<JsonObject>>;
  };
  topics: { list(): Promise<EmailgoResult<EmailgoList>>; create(body: JsonObject): Promise<EmailgoResult<JsonObject>>; get(id: string): Promise<EmailgoResult<JsonObject>>; update(id: string, body: JsonObject): Promise<EmailgoResult<JsonObject>>; delete(id: string): Promise<EmailgoResult<JsonObject>> };
  broadcasts: { list(): Promise<EmailgoResult<EmailgoList>>; create(body: JsonObject): Promise<EmailgoResult<JsonObject>>; get(id: string): Promise<EmailgoResult<JsonObject>>; update(id: string, body: JsonObject): Promise<EmailgoResult<JsonObject>>; delete(id: string): Promise<EmailgoResult<JsonObject>>; send(id: string, body?: JsonObject): Promise<EmailgoResult<JsonObject>>; cancel(id: string): Promise<EmailgoResult<JsonObject>>; duplicate(id: string): Promise<EmailgoResult<JsonObject>>; recipients(id: string, query: EmailgoBroadcastRecipientsQuery): Promise<EmailgoResult<EmailgoList>>; clickedLinks(id: string, query?: EmailgoQuery): Promise<EmailgoResult<EmailgoList>> };
  automations: { list(): Promise<EmailgoResult<EmailgoList>>; create(body: JsonObject): Promise<EmailgoResult<JsonObject>>; get(id: string): Promise<EmailgoResult<JsonObject>>; update(id: string, body: JsonObject): Promise<EmailgoResult<JsonObject>>; archive(id: string): Promise<EmailgoResult<JsonObject>>; duplicate(id: string): Promise<EmailgoResult<JsonObject>>; start(id: string): Promise<EmailgoResult<JsonObject>>; stop(id: string): Promise<EmailgoResult<JsonObject>>; runs(id: string, query?: EmailgoQuery): Promise<EmailgoResult<EmailgoList>>; getRun(id: string, runId: string): Promise<EmailgoResult<JsonObject>>; stopRun(id: string, runId: string): Promise<EmailgoResult<JsonObject>>; cancelRun(id: string, runId: string): Promise<EmailgoResult<JsonObject>> };
  events: { list(): Promise<EmailgoResult<EmailgoList>>; create(body: { name: string; schema?: Record<string, 'string' | 'number' | 'boolean' | 'date'> | null }): Promise<EmailgoResult<JsonObject>>; get(idOrName: string): Promise<EmailgoResult<JsonObject>>; update(idOrName: string, body: { schema: Record<string, 'string' | 'number' | 'boolean' | 'date'> | null }): Promise<EmailgoResult<JsonObject>>; remove(idOrName: string): Promise<EmailgoResult<JsonObject>>; send(body: JsonObject, options?: { idempotencyKey?: string }): Promise<EmailgoResult<JsonObject>>; observed(): Promise<EmailgoResult<EmailgoList>> };
  webhooks: { list(): Promise<EmailgoResult<EmailgoList>>; create(body: JsonObject): Promise<EmailgoResult<JsonObject>>; get(id: string): Promise<EmailgoResult<JsonObject>>; update(id: string, body: JsonObject): Promise<EmailgoResult<JsonObject>>; delete(id: string): Promise<EmailgoResult<JsonObject>>; deliveries(id: string, query?: EmailgoQuery): Promise<EmailgoResult<EmailgoList>>; replay(id: string, body: JsonObject): Promise<EmailgoResult<JsonObject>>; rotateSecret(id: string): Promise<EmailgoResult<JsonObject>>; events: { list(query: EmailgoQuery & { webhookId: string }): Promise<EmailgoResult<EmailgoList>>; get(ids: { webhookId: string; eventId: string }): Promise<EmailgoResult<JsonObject>>; attempts: { list(query: EmailgoQuery & { webhookId: string; eventId: string }): Promise<EmailgoResult<EmailgoList>> }; replay(ids: { webhookId: string; eventId: string }): Promise<EmailgoResult<JsonObject>> } };
  suppressions: { list(query?: EmailgoQuery): Promise<EmailgoResult<EmailgoList>>; add(email: string): Promise<EmailgoResult<JsonObject>>; batchAdd(emails: string[]): Promise<EmailgoResult<EmailgoList>>; get(identifier: string): Promise<EmailgoResult<JsonObject>>; remove(identifier: string): Promise<EmailgoResult<JsonObject>>; batchRemove(emails: string[]): Promise<EmailgoResult<EmailgoList>> };
  usage: { get(): Promise<EmailgoResult<JsonObject>> };
  logs: { list(query?: EmailgoQuery): Promise<EmailgoResult<EmailgoList<EmailgoLog>>>; get(id: string): Promise<EmailgoResult<EmailgoLog>> };
  templates: {
    list(query?: EmailgoQuery): Promise<EmailgoResult<EmailgoList>>;
    create(body: EmailgoTemplateInput): Promise<EmailgoResult<JsonObject>>;
    get(idOrAlias: string): Promise<EmailgoResult<JsonObject>>;
    update(idOrAlias: string, body: Partial<EmailgoTemplateInput>): Promise<EmailgoResult<JsonObject>>;
    delete(idOrAlias: string): Promise<EmailgoResult<JsonObject>>;
    publish(idOrAlias: string): Promise<EmailgoResult<JsonObject>>;
    duplicate(idOrAlias: string, body?: { name?: string }): Promise<EmailgoResult<JsonObject>>;
    versions(idOrAlias: string): Promise<EmailgoResult<EmailgoList>>;
  };
}
