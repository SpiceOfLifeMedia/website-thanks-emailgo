export type JsonObject = Record<string, unknown>;
export type SendThanksResult<T> = { data: T; error: null } | { data: null; error: Error };
export interface SendThanksOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}
export type SendThanksEmailInput = (SendThanksDirectEmailInput | SendThanksTemplateEmailInput | SendThanksLegacyTemplateEmailInput) & JsonObject;
export type SendThanksEmailCommonInput = {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string | string[];
  scheduled_at?: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
  attachments?: unknown[];
};
export type SendThanksDirectEmailInput = SendThanksEmailCommonInput & {
  from: string;
  subject: string;
  template?: never;
  template_id?: never;
  variables?: never;
} & ({ text: string; html?: string } | { text?: string; html: string });
export type SendThanksTemplateEmailInput = SendThanksEmailCommonInput & {
  from?: string;
  subject?: string;
  template: { id: string; variables?: Record<string, string | number> };
  text?: never;
  html?: never;
  template_id?: never;
  variables?: never;
};
export type SendThanksLegacyTemplateEmailInput = SendThanksEmailCommonInput & { from?: string; subject?: string; template_id: string; variables?: Record<string, string | number>; template?: never; text?: never; html?: never };
export interface SendThanksTemplateVariable {
  key: string;
  type: 'string' | 'number';
  fallback_value?: string | number | null;
}
export interface SendThanksTemplateInput extends JsonObject {
  name: string;
  html: string;
  alias?: string;
  from?: string;
  subject?: string;
  reply_to?: string;
  text?: string;
  variables?: SendThanksTemplateVariable[];
}
export interface SendThanksList<T = JsonObject> {
  data: T[];
  has_more?: boolean;
  next_after?: string;
  next_before?: string;
}
export interface SendThanksLog {
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
export interface SendThanksKeyInput extends JsonObject {
  name: string;
  permission?: 'full_access' | 'sending_access';
  domain_id?: string;
}
export interface SendThanksDomainInput extends JsonObject { domain: string }
export interface SendThanksQuery { limit?: number; after?: string; before?: string; [key: string]: string | number | boolean | undefined }
export interface SendThanksMetricsQuery {
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
export interface SendThanksSegmentMetricsQuery {
  metrics?: string | string[];
  dimensions?: 'segment' | string[];
  segment_id?: string | string[];
}
export interface SendThanksContactImportOptions {
  column_map: { email: string; first_name?: string; last_name?: string; properties?: Record<string, { column: string; type?: 'string' | 'number' | 'boolean' }> };
  on_conflict?: 'upsert' | 'skip';
  segments?: Array<{ id: string }>;
  topics?: Array<{ id: string; subscription: 'opt_in' | 'opt_out' }>;
}
export interface SendThanksBroadcastRecipientsQuery extends SendThanksQuery { type: 'opened' | 'clicked' | 'bounced' | 'complained' | 'delivered' | 'unsubscribed' }
export interface SendThanksExportQuery { resource: 'emails' | 'received_emails' | 'broadcasts' | 'contacts' | 'domains' | 'logs' | 'api_keys'; search?: string; status?: string }
export declare class SendThanksApiError extends Error {
  status: number;
  details: unknown;
}
export declare class SendThanks {
  constructor(apiKey: string, options?: SendThanksOptions);
  request<T = unknown>(method: string, path: string, options?: { query?: Record<string, string | number | boolean | null | undefined>; body?: JsonObject | FormData; idempotencyKey?: string }): Promise<SendThanksResult<T>>;
  emails: {
    send(body: SendThanksEmailInput, options?: { idempotencyKey?: string }): Promise<SendThanksResult<JsonObject>>;
    sendBatch(body: { emails: SendThanksEmailInput[] }, options?: { idempotencyKey?: string }): Promise<SendThanksResult<JsonObject>>;
    list(query?: SendThanksQuery): Promise<SendThanksResult<SendThanksList>>;
    metrics(query?: SendThanksMetricsQuery): Promise<SendThanksResult<JsonObject>>;
    get(id: string): Promise<SendThanksResult<JsonObject>>;
    share(id: string, options?: { expiresIn?: string }): Promise<SendThanksResult<JsonObject>>;
    revokeShare(id: string, shareId: string): Promise<SendThanksResult<JsonObject>>;
    update(id: string, body: JsonObject): Promise<SendThanksResult<JsonObject>>;
    cancel(id: string): Promise<SendThanksResult<JsonObject>>;
    events(id: string): Promise<SendThanksResult<JsonObject>>;
    receiving: { list(query?: SendThanksQuery): Promise<SendThanksResult<SendThanksList>>; get(id: string): Promise<SendThanksResult<JsonObject>>; attachments(id: string): Promise<SendThanksResult<SendThanksList>>; downloadAttachment(id: string, attachmentId: string): Promise<SendThanksResult<ArrayBuffer>> };
  };
  apiKeys: {
    list(): Promise<SendThanksResult<SendThanksList>>;
    create(body: SendThanksKeyInput): Promise<SendThanksResult<JsonObject>>;
    get(id: string): Promise<SendThanksResult<JsonObject>>;
    update(id: string, body: { name: string }): Promise<SendThanksResult<JsonObject>>;
    revoke(id: string): Promise<SendThanksResult<JsonObject>>;
  };
  domains: {
    list(): Promise<SendThanksResult<SendThanksList>>;
    create(body: SendThanksDomainInput): Promise<SendThanksResult<JsonObject>>;
    get(id: string): Promise<SendThanksResult<JsonObject>>;
    update(id: string, body: { open_tracking?: boolean; click_tracking?: boolean }): Promise<SendThanksResult<JsonObject>>;
    delete(id: string): Promise<SendThanksResult<JsonObject>>;
    verify(id: string): Promise<SendThanksResult<JsonObject>>;
    dns(id: string): Promise<SendThanksResult<JsonObject>>;
  };
  contacts: {
    list(query?: SendThanksQuery): Promise<SendThanksResult<SendThanksList>>;
    create(body: JsonObject): Promise<SendThanksResult<JsonObject>>;
    get(id: string): Promise<SendThanksResult<JsonObject>>;
    update(id: string, body: JsonObject): Promise<SendThanksResult<JsonObject>>;
    delete(id: string): Promise<SendThanksResult<JsonObject>>;
    topics: { list(id: string): Promise<SendThanksResult<JsonObject>>; update(id: string, body: JsonObject): Promise<SendThanksResult<JsonObject>> };
    segments: { list(contact: { contactId?: string; email?: string }): Promise<SendThanksResult<SendThanksList>>; add(input: { contactId?: string; email?: string; segmentId: string }): Promise<SendThanksResult<JsonObject>>; remove(input: { contactId?: string; email?: string; segmentId: string }): Promise<SendThanksResult<JsonObject>> };
    imports: { create(file: Blob, options: SendThanksContactImportOptions): Promise<SendThanksResult<JsonObject>>; list(query?: SendThanksQuery): Promise<SendThanksResult<SendThanksList>>; get(id: string): Promise<SendThanksResult<JsonObject>> };
  };
  contactProperties: {
    list(): Promise<SendThanksResult<SendThanksList>>;
    create(body: { key: string; type: 'string' | 'number'; fallback_value?: string | number | null }): Promise<SendThanksResult<JsonObject>>;
    get(key: string): Promise<SendThanksResult<JsonObject>>;
    update(key: string, body: { type?: 'string' | 'number'; fallback_value?: string | number | null }): Promise<SendThanksResult<JsonObject>>;
    delete(key: string): Promise<SendThanksResult<JsonObject>>;
  };
  segments: {
    list(): Promise<SendThanksResult<SendThanksList>>;
    create(body: JsonObject): Promise<SendThanksResult<JsonObject>>;
    get(id: string): Promise<SendThanksResult<JsonObject>>;
    update(id: string, body: JsonObject): Promise<SendThanksResult<JsonObject>>;
    delete(id: string): Promise<SendThanksResult<JsonObject>>;
    contacts(id: string, query?: SendThanksQuery): Promise<SendThanksResult<SendThanksList>>;
    metrics(query?: SendThanksSegmentMetricsQuery): Promise<SendThanksResult<JsonObject>>;
  };
  topics: { list(): Promise<SendThanksResult<SendThanksList>>; create(body: JsonObject): Promise<SendThanksResult<JsonObject>>; get(id: string): Promise<SendThanksResult<JsonObject>>; update(id: string, body: JsonObject): Promise<SendThanksResult<JsonObject>>; delete(id: string): Promise<SendThanksResult<JsonObject>> };
  broadcasts: { list(): Promise<SendThanksResult<SendThanksList>>; create(body: JsonObject): Promise<SendThanksResult<JsonObject>>; get(id: string): Promise<SendThanksResult<JsonObject>>; update(id: string, body: JsonObject): Promise<SendThanksResult<JsonObject>>; delete(id: string): Promise<SendThanksResult<JsonObject>>; send(id: string, body?: JsonObject): Promise<SendThanksResult<JsonObject>>; cancel(id: string): Promise<SendThanksResult<JsonObject>>; duplicate(id: string): Promise<SendThanksResult<JsonObject>>; recipients(id: string, query: SendThanksBroadcastRecipientsQuery): Promise<SendThanksResult<SendThanksList>>; clickedLinks(id: string, query?: SendThanksQuery): Promise<SendThanksResult<SendThanksList>> };
  automations: { list(): Promise<SendThanksResult<SendThanksList>>; create(body: JsonObject): Promise<SendThanksResult<JsonObject>>; get(id: string): Promise<SendThanksResult<JsonObject>>; update(id: string, body: JsonObject): Promise<SendThanksResult<JsonObject>>; archive(id: string): Promise<SendThanksResult<JsonObject>>; duplicate(id: string): Promise<SendThanksResult<JsonObject>>; start(id: string): Promise<SendThanksResult<JsonObject>>; stop(id: string): Promise<SendThanksResult<JsonObject>>; runs(id: string, query?: SendThanksQuery): Promise<SendThanksResult<SendThanksList>>; getRun(id: string, runId: string): Promise<SendThanksResult<JsonObject>>; retryRun(id: string, runId: string, body?: { confirm_send_retry?: boolean }): Promise<SendThanksResult<JsonObject>>; stopRun(id: string, runId: string): Promise<SendThanksResult<JsonObject>>; cancelRun(id: string, runId: string): Promise<SendThanksResult<JsonObject>> };
  events: { list(): Promise<SendThanksResult<SendThanksList>>; create(body: { name: string; schema?: Record<string, 'string' | 'number' | 'boolean' | 'date'> | null }): Promise<SendThanksResult<JsonObject>>; get(idOrName: string): Promise<SendThanksResult<JsonObject>>; update(idOrName: string, body: { schema: Record<string, 'string' | 'number' | 'boolean' | 'date'> | null }): Promise<SendThanksResult<JsonObject>>; remove(idOrName: string): Promise<SendThanksResult<JsonObject>>; send(body: JsonObject, options?: { idempotencyKey?: string }): Promise<SendThanksResult<JsonObject>>; observed(): Promise<SendThanksResult<SendThanksList>> };
  webhooks: { list(): Promise<SendThanksResult<SendThanksList>>; create(body: JsonObject): Promise<SendThanksResult<JsonObject>>; get(id: string): Promise<SendThanksResult<JsonObject>>; update(id: string, body: JsonObject): Promise<SendThanksResult<JsonObject>>; delete(id: string): Promise<SendThanksResult<JsonObject>>; deliveries(id: string, query?: SendThanksQuery): Promise<SendThanksResult<SendThanksList>>; replay(id: string, body: JsonObject): Promise<SendThanksResult<JsonObject>>; rotateSecret(id: string): Promise<SendThanksResult<JsonObject>>; events: { list(query: SendThanksQuery & { webhookId: string }): Promise<SendThanksResult<SendThanksList>>; get(ids: { webhookId: string; eventId: string }): Promise<SendThanksResult<JsonObject>>; attempts: { list(query: SendThanksQuery & { webhookId: string; eventId: string }): Promise<SendThanksResult<SendThanksList>> }; replay(ids: { webhookId: string; eventId: string }): Promise<SendThanksResult<JsonObject>> } };
  suppressions: { list(query?: SendThanksQuery): Promise<SendThanksResult<SendThanksList>>; add(email: string): Promise<SendThanksResult<JsonObject>>; batchAdd(emails: string[]): Promise<SendThanksResult<SendThanksList>>; get(identifier: string): Promise<SendThanksResult<JsonObject>>; remove(identifier: string): Promise<SendThanksResult<JsonObject>>; batchRemove(emails: string[]): Promise<SendThanksResult<SendThanksList>> };
  usage: { get(): Promise<SendThanksResult<JsonObject>> };
  logs: { list(query?: SendThanksQuery): Promise<SendThanksResult<SendThanksList<SendThanksLog>>>; get(id: string): Promise<SendThanksResult<SendThanksLog>> };
  exports: { csv(query: SendThanksExportQuery): Promise<SendThanksResult<string>> };
  templates: {
    list(query?: SendThanksQuery): Promise<SendThanksResult<SendThanksList>>;
    create(body: SendThanksTemplateInput): Promise<SendThanksResult<JsonObject>>;
    get(idOrAlias: string): Promise<SendThanksResult<JsonObject>>;
    update(idOrAlias: string, body: Partial<SendThanksTemplateInput>): Promise<SendThanksResult<JsonObject>>;
    delete(idOrAlias: string): Promise<SendThanksResult<JsonObject>>;
    publish(idOrAlias: string): Promise<SendThanksResult<JsonObject>>;
    duplicate(idOrAlias: string, body?: { name?: string }): Promise<SendThanksResult<JsonObject>>;
    versions(idOrAlias: string): Promise<SendThanksResult<SendThanksList>>;
  };
}
