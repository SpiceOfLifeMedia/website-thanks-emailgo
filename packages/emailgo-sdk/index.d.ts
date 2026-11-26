export type JsonObject = Record<string, unknown>;
export type EmailgoResult<T> = { data: T; error: null } | { data: null; error: Error };
export interface EmailgoOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}
export interface EmailgoEmailInput extends JsonObject {
  from: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string | string[];
  scheduled_at?: string;
}
export interface EmailgoList<T = JsonObject> {
  data: T[];
  has_more?: boolean;
  next_after?: string;
  next_before?: string;
}
export interface EmailgoKeyInput extends JsonObject {
  name: string;
  permission?: 'full_access' | 'sending_access';
  domain_id?: string;
}
export interface EmailgoDomainInput extends JsonObject { domain: string }
export interface EmailgoQuery { limit?: number; after?: string; before?: string; [key: string]: string | number | boolean | undefined }
export declare class EmailgoApiError extends Error {
  status: number;
  details: unknown;
}
export declare class Emailgo {
  constructor(apiKey: string, options?: EmailgoOptions);
  request<T = unknown>(method: string, path: string, options?: { query?: Record<string, string | number | boolean | null | undefined>; body?: JsonObject; idempotencyKey?: string }): Promise<EmailgoResult<T>>;
  emails: {
    send(body: EmailgoEmailInput, options?: { idempotencyKey?: string }): Promise<EmailgoResult<JsonObject>>;
    sendBatch(body: { emails: EmailgoEmailInput[] }, options?: { idempotencyKey?: string }): Promise<EmailgoResult<JsonObject>>;
    list(query?: EmailgoQuery): Promise<EmailgoResult<EmailgoList>>;
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
  };
  segments: {
    list(): Promise<EmailgoResult<EmailgoList>>;
    create(body: JsonObject): Promise<EmailgoResult<JsonObject>>;
    get(id: string): Promise<EmailgoResult<JsonObject>>;
    update(id: string, body: JsonObject): Promise<EmailgoResult<JsonObject>>;
    delete(id: string): Promise<EmailgoResult<JsonObject>>;
    contacts(id: string, query?: EmailgoQuery): Promise<EmailgoResult<EmailgoList>>;
  };
  topics: { list(): Promise<EmailgoResult<EmailgoList>>; create(body: JsonObject): Promise<EmailgoResult<JsonObject>>; get(id: string): Promise<EmailgoResult<JsonObject>>; update(id: string, body: JsonObject): Promise<EmailgoResult<JsonObject>>; delete(id: string): Promise<EmailgoResult<JsonObject>> };
  broadcasts: { list(): Promise<EmailgoResult<EmailgoList>>; create(body: JsonObject): Promise<EmailgoResult<JsonObject>>; get(id: string): Promise<EmailgoResult<JsonObject>>; update(id: string, body: JsonObject): Promise<EmailgoResult<JsonObject>>; delete(id: string): Promise<EmailgoResult<JsonObject>>; send(id: string, body?: JsonObject): Promise<EmailgoResult<JsonObject>>; cancel(id: string): Promise<EmailgoResult<JsonObject>> };
  automations: { list(): Promise<EmailgoResult<EmailgoList>>; create(body: JsonObject): Promise<EmailgoResult<JsonObject>>; get(id: string): Promise<EmailgoResult<JsonObject>>; update(id: string, body: JsonObject): Promise<EmailgoResult<JsonObject>>; archive(id: string): Promise<EmailgoResult<JsonObject>>; start(id: string): Promise<EmailgoResult<JsonObject>>; stop(id: string): Promise<EmailgoResult<JsonObject>>; runs(id: string, query?: EmailgoQuery): Promise<EmailgoResult<EmailgoList>>; getRun(id: string, runId: string): Promise<EmailgoResult<JsonObject>>; stopRun(id: string, runId: string): Promise<EmailgoResult<JsonObject>> };
  events: { list(): Promise<EmailgoResult<EmailgoList>>; send(body: JsonObject, options?: { idempotencyKey?: string }): Promise<EmailgoResult<JsonObject>> };
  webhooks: { list(): Promise<EmailgoResult<EmailgoList>>; create(body: JsonObject): Promise<EmailgoResult<JsonObject>>; get(id: string): Promise<EmailgoResult<JsonObject>>; update(id: string, body: JsonObject): Promise<EmailgoResult<JsonObject>>; delete(id: string): Promise<EmailgoResult<JsonObject>>; deliveries(id: string, query?: EmailgoQuery): Promise<EmailgoResult<EmailgoList>>; replay(id: string, body: JsonObject): Promise<EmailgoResult<JsonObject>>; rotateSecret(id: string): Promise<EmailgoResult<JsonObject>> };
  usage: { get(): Promise<EmailgoResult<JsonObject>> };
}
