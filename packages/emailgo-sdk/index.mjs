export class EmailgoApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'EmailgoApiError';
    this.status = status;
    this.details = details;
  }
}

export class Emailgo {
  constructor(apiKey, options = {}) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new TypeError('An Emailgo API key is required.');
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? 'http://localhost:3000').replace(/\/+$/, '');
    this.fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.fetch !== 'function') throw new TypeError('A fetch implementation is required.');

    const request = (method, path, { query, body, idempotencyKey } = {}) => this.request(method, path, { query, body, idempotencyKey });
    this.emails = {
      send: (body, options) => request('POST', '/api/v1/emails', { body, idempotencyKey: options?.idempotencyKey }),
      sendBatch: (body, options) => request('POST', '/api/v1/emails/batch', { body, idempotencyKey: options?.idempotencyKey }),
      list: (query) => request('GET', '/api/v1/emails', { query }),
      get: (id) => request('GET', `/api/v1/emails/${encodeURIComponent(id)}`),
      update: (id, body) => request('PATCH', `/api/v1/emails/${encodeURIComponent(id)}`, { body }),
      cancel: (id) => request('POST', `/api/v1/emails/${encodeURIComponent(id)}/cancel`, { body: {} }),
      events: (id) => request('GET', `/api/v1/emails/${encodeURIComponent(id)}/events`),
      receiving: {
        list: (query) => request('GET', '/api/v1/emails/receiving', { query }),
        get: (id) => request('GET', `/api/v1/emails/receiving/${encodeURIComponent(id)}`),
        attachments: (id) => request('GET', `/api/v1/emails/receiving/${encodeURIComponent(id)}/attachments`),
        downloadAttachment: (id, attachmentId) => this.downloadReceivedAttachment(id, attachmentId),
      },
    };
    this.apiKeys = {
      list: () => request('GET', '/api/v1/api-keys'),
      create: (body) => request('POST', '/api/v1/api-keys', { body }),
      get: (id) => request('GET', `/api/v1/api-keys/${encodeURIComponent(id)}`),
      update: (id, body) => request('PATCH', `/api/v1/api-keys/${encodeURIComponent(id)}`, { body }),
      revoke: (id) => request('DELETE', `/api/v1/api-keys/${encodeURIComponent(id)}`),
    };
    this.domains = {
      list: () => request('GET', '/api/v1/domains'),
      create: (body) => request('POST', '/api/v1/domains', { body }),
      get: (id) => request('GET', `/api/v1/domains/${encodeURIComponent(id)}`),
      update: (id, body) => request('PATCH', `/api/v1/domains/${encodeURIComponent(id)}`, { body }),
      delete: (id) => request('DELETE', `/api/v1/domains/${encodeURIComponent(id)}`),
      verify: (id) => request('POST', `/api/v1/domains/${encodeURIComponent(id)}/verify`, { body: {} }),
      dns: (id) => request('GET', `/api/v1/domains/${encodeURIComponent(id)}/dns`),
    };
    this.contacts = {
      list: (query) => request('GET', '/api/v1/contacts', { query }),
      create: (body) => request('POST', '/api/v1/contacts', { body }),
      get: (id) => request('GET', `/api/v1/contacts/${encodeURIComponent(id)}`),
      update: (id, body) => request('PATCH', `/api/v1/contacts/${encodeURIComponent(id)}`, { body }),
      delete: (id) => request('DELETE', `/api/v1/contacts/${encodeURIComponent(id)}`),
      topics: {
        list: (id) => request('GET', `/api/v1/contacts/${encodeURIComponent(id)}/topics`),
        update: (id, body) => request('PUT', `/api/v1/contacts/${encodeURIComponent(id)}/topics`, { body }),
      },
    };
    this.contactProperties = {
      list: () => request('GET', '/api/v1/contact-properties'),
      create: (body) => request('POST', '/api/v1/contact-properties', { body }),
      get: (key) => request('GET', `/api/v1/contact-properties/${encodeURIComponent(key)}`),
      update: (key, body) => request('PATCH', `/api/v1/contact-properties/${encodeURIComponent(key)}`, { body }),
      delete: (key) => request('DELETE', `/api/v1/contact-properties/${encodeURIComponent(key)}`),
    };
    this.segments = {
      list: () => request('GET', '/api/v1/segments'),
      create: (body) => request('POST', '/api/v1/segments', { body }),
      get: (id) => request('GET', `/api/v1/segments/${encodeURIComponent(id)}`),
      update: (id, body) => request('PATCH', `/api/v1/segments/${encodeURIComponent(id)}`, { body }),
      delete: (id) => request('DELETE', `/api/v1/segments/${encodeURIComponent(id)}`),
      contacts: (id, query) => request('GET', `/api/v1/segments/${encodeURIComponent(id)}/contacts`, { query }),
    };
    this.topics = {
      list: () => request('GET', '/api/v1/topics'),
      create: (body) => request('POST', '/api/v1/topics', { body }),
      get: (id) => request('GET', `/api/v1/topics/${encodeURIComponent(id)}`),
      update: (id, body) => request('PATCH', `/api/v1/topics/${encodeURIComponent(id)}`, { body }),
      delete: (id) => request('DELETE', `/api/v1/topics/${encodeURIComponent(id)}`),
    };
    this.broadcasts = {
      list: () => request('GET', '/api/v1/broadcasts'),
      create: (body) => request('POST', '/api/v1/broadcasts', { body }),
      update: (id, body) => request('PATCH', `/api/v1/broadcasts/${encodeURIComponent(id)}`, { body }),
      delete: (id) => request('DELETE', `/api/v1/broadcasts/${encodeURIComponent(id)}`),
      send: (id, body = {}) => request('POST', `/api/v1/broadcasts/${encodeURIComponent(id)}/send`, { body }),
      cancel: (id) => request('POST', `/api/v1/broadcasts/${encodeURIComponent(id)}/cancel`, { body: {} }),
    };
    this.automations = {
      list: () => request('GET', '/api/v1/automations'),
      create: (body) => request('POST', '/api/v1/automations', { body }),
      get: (id) => request('GET', `/api/v1/automations/${encodeURIComponent(id)}`),
      update: (id, body) => request('PATCH', `/api/v1/automations/${encodeURIComponent(id)}`, { body }),
      archive: (id) => request('DELETE', `/api/v1/automations/${encodeURIComponent(id)}`),
      start: (id) => request('POST', `/api/v1/automations/${encodeURIComponent(id)}/start`, { body: {} }),
      stop: (id) => request('POST', `/api/v1/automations/${encodeURIComponent(id)}/stop`, { body: {} }),
      runs: (id, query) => request('GET', `/api/v1/automations/${encodeURIComponent(id)}/runs`, { query }),
      getRun: (id, runId) => request('GET', `/api/v1/automations/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`),
      stopRun: (id, runId) => request('POST', `/api/v1/automations/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/stop`, { body: {} }),
    };
    this.events = {
      list: () => request('GET', '/api/v1/events'),
      send: (body, options) => request('POST', '/api/v1/events', { body, idempotencyKey: options?.idempotencyKey }),
    };
    this.webhooks = {
      list: () => request('GET', '/api/v1/webhooks'),
      create: (body) => request('POST', '/api/v1/webhooks', { body }),
      get: (id) => request('GET', `/api/v1/webhooks/${encodeURIComponent(id)}`),
      update: (id, body) => request('PATCH', `/api/v1/webhooks/${encodeURIComponent(id)}`, { body }),
      delete: (id) => request('DELETE', `/api/v1/webhooks/${encodeURIComponent(id)}`),
      deliveries: (id, query) => request('GET', `/api/v1/webhooks/${encodeURIComponent(id)}/deliveries`, { query }),
      replay: (id, body) => request('POST', `/api/v1/webhooks/${encodeURIComponent(id)}/replay`, { body }),
      rotateSecret: (id) => request('POST', `/api/v1/webhooks/${encodeURIComponent(id)}/rotate-secret`, { body: {} }),
    };
    this.suppressions = {
      list: (query) => request('GET', '/api/v1/suppressions', { query }),
      add: (email) => request('POST', '/api/v1/suppressions', { body: { email } }),
      batchAdd: (emails) => request('POST', '/api/v1/suppressions/batch', { body: { emails } }),
      get: (identifier) => request('GET', `/api/v1/suppressions/${encodeURIComponent(identifier)}`),
      remove: (identifier) => request('DELETE', `/api/v1/suppressions/${encodeURIComponent(identifier)}`),
      batchRemove: (emails) => request('DELETE', '/api/v1/suppressions/batch', { body: { emails } }),
    };
    this.usage = { get: () => request('GET', '/api/v1/usage') };
  }

  async downloadReceivedAttachment(id, attachmentId) {
    const url = new URL(`${this.baseUrl}/api/v1/emails/receiving/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`);
    try {
      const response = await this.fetch(url, { method: 'GET', headers: new Headers({ Authorization: `Bearer ${this.apiKey}`, Accept: '*/*' }) });
      if (!response.ok) {
        const text = await response.text();
        let details;
        try { details = text ? JSON.parse(text) : null; } catch { details = { message: text || response.statusText }; }
        const error = details?.error;
        const message = typeof error === 'string' ? error : error?.message ?? details?.message ?? response.statusText;
        return { data: null, error: new EmailgoApiError(message, response.status, details) };
      }
      return { data: await response.arrayBuffer(), error: null };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error : new Error('Emailgo download failed.') };
    }
  }

  async request(method, path, { query, body, idempotencyKey } = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const headers = new Headers({ Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
    try {
      const response = await this.fetch(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : null; }
      catch { data = { message: text || response.statusText }; }
      if (!response.ok) {
        const errorData = data?.error;
        const message = typeof errorData === 'string' ? errorData : errorData?.message ?? data?.message ?? response.statusText;
        return { data: null, error: new EmailgoApiError(message, response.status, data) };
      }
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error : new Error('Emailgo request failed.') };
    }
  }
}
