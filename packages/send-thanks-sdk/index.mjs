export class SendThanksApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'SendThanksApiError';
    this.status = status;
    this.details = details;
  }
}

export class SendThanks {
  constructor(apiKey, options = {}) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new TypeError('A Send, thanks API key is required.');
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? 'http://localhost:3000').replace(/\/+$/, '');
    this.fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.fetch !== 'function') throw new TypeError('A fetch implementation is required.');

    const request = (method, path, { query, body, idempotencyKey } = {}) => this.request(method, path, { query, body, idempotencyKey });
    this.emails = {
      send: (body, options) => request('POST', '/api/v1/emails', { body, idempotencyKey: options?.idempotencyKey }),
      sendBatch: (body, options) => request('POST', '/api/v1/emails/batch', { body, idempotencyKey: options?.idempotencyKey }),
      list: (query) => request('GET', '/api/v1/emails', { query }),
      metrics: (query = {}) => request('GET', '/api/v1/emails/metrics', { query: Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value])) }),
      get: (id) => request('GET', `/api/v1/emails/${encodeURIComponent(id)}`),
      share: (id, options = {}) => request('POST', `/api/v1/emails/${encodeURIComponent(id)}/share`, { body: options.expiresIn ? { expires_in: options.expiresIn } : {} }),
      revokeShare: (id, shareId) => request('DELETE', `/api/v1/emails/${encodeURIComponent(id)}/share/${encodeURIComponent(shareId)}`),
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
      segments: {
        list: ({ contactId, email }) => request('GET', `/api/v1/contacts/${encodeURIComponent(contactId ?? email ?? '')}/segments`),
        add: ({ contactId, email, segmentId }) => request('POST', `/api/v1/contacts/${encodeURIComponent(contactId ?? email ?? '')}/segments/${encodeURIComponent(segmentId)}`, { body: {} }),
        remove: ({ contactId, email, segmentId }) => request('DELETE', `/api/v1/contacts/${encodeURIComponent(contactId ?? email ?? '')}/segments/${encodeURIComponent(segmentId)}`, { body: {} }),
      },
      imports: {
        create: (file, options) => {
          const form = new FormData();
          form.append('file', file, 'contacts.csv');
          form.append('column_map', JSON.stringify(options.column_map));
          if (options.on_conflict) form.append('on_conflict', options.on_conflict);
          if (options.segments) form.append('segments', JSON.stringify(options.segments));
          if (options.topics) form.append('topics', JSON.stringify(options.topics));
          return request('POST', '/api/v1/contacts/imports', { body: form });
        },
        list: (query) => request('GET', '/api/v1/contacts/imports', { query }),
        get: (id) => request('GET', `/api/v1/contacts/imports/${encodeURIComponent(id)}`),
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
      metrics: (query = {}) => request('GET', '/api/v1/segments/metrics', { query: Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value])) }),
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
      get: (id) => request('GET', `/api/v1/broadcasts/${encodeURIComponent(id)}`),
      update: (id, body) => request('PATCH', `/api/v1/broadcasts/${encodeURIComponent(id)}`, { body }),
      delete: (id) => request('DELETE', `/api/v1/broadcasts/${encodeURIComponent(id)}`),
      send: (id, body = {}) => request('POST', `/api/v1/broadcasts/${encodeURIComponent(id)}/send`, { body }),
      cancel: (id) => request('POST', `/api/v1/broadcasts/${encodeURIComponent(id)}/cancel`, { body: {} }),
      duplicate: (id) => request('POST', `/api/v1/broadcasts/${encodeURIComponent(id)}/duplicate`, { body: {} }),
      recipients: (id, query) => request('GET', `/api/v1/broadcasts/${encodeURIComponent(id)}/recipients`, { query }),
      clickedLinks: (id, query) => request('GET', `/api/v1/broadcasts/${encodeURIComponent(id)}/clicked-links`, { query }),
    };
    this.automations = {
      list: () => request('GET', '/api/v1/automations'),
      create: (body) => request('POST', '/api/v1/automations', { body }),
      get: (id) => request('GET', `/api/v1/automations/${encodeURIComponent(id)}`),
      update: (id, body) => request('PATCH', `/api/v1/automations/${encodeURIComponent(id)}`, { body }),
      archive: (id) => request('DELETE', `/api/v1/automations/${encodeURIComponent(id)}`),
      duplicate: (id) => request('POST', `/api/v1/automations/${encodeURIComponent(id)}/duplicate`, { body: {} }),
      start: (id) => request('POST', `/api/v1/automations/${encodeURIComponent(id)}/start`, { body: {} }),
      stop: (id) => request('POST', `/api/v1/automations/${encodeURIComponent(id)}/stop`, { body: {} }),
      runs: (id, query) => request('GET', `/api/v1/automations/${encodeURIComponent(id)}/runs`, { query }),
      getRun: (id, runId) => request('GET', `/api/v1/automations/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`),
      retryRun: (id, runId, body = {}) => request('POST', `/api/v1/automations/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/retry`, { body }),
      stopRun: (id, runId) => request('POST', `/api/v1/automations/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/cancel`, { body: {} }),
      cancelRun: (id, runId) => request('POST', `/api/v1/automations/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/cancel`, { body: {} }),
    };
    this.events = {
      list: () => request('GET', '/api/v1/events'),
      create: (body) => request('POST', '/api/v1/events', { body }),
      get: (idOrName) => request('GET', `/api/v1/events/${encodeURIComponent(idOrName)}`),
      update: (idOrName, body) => request('PATCH', `/api/v1/events/${encodeURIComponent(idOrName)}`, { body }),
      remove: (idOrName) => request('DELETE', `/api/v1/events/${encodeURIComponent(idOrName)}`),
      send: (body, options) => request('POST', '/api/v1/events/send', { body, idempotencyKey: options?.idempotencyKey }),
      observed: () => request('GET', '/api/v1/events/observed'),
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
      events: {
        list: ({ webhookId, ...query }) => request('GET', `/api/v1/webhooks/${encodeURIComponent(webhookId)}/events`, { query }),
        get: ({ webhookId, eventId }) => request('GET', `/api/v1/webhooks/${encodeURIComponent(webhookId)}/events/${encodeURIComponent(eventId)}`),
        attempts: {
          list: ({ webhookId, eventId, ...query }) => request('GET', `/api/v1/webhooks/${encodeURIComponent(webhookId)}/events/${encodeURIComponent(eventId)}/attempts`, { query }),
        },
        replay: ({ webhookId, eventId }) => request('POST', `/api/v1/webhooks/${encodeURIComponent(webhookId)}/events/${encodeURIComponent(eventId)}/replay`, { body: {} }),
      },
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
    this.logs = {
      list: (query) => request('GET', '/api/v1/logs', { query }),
      get: (id) => request('GET', `/api/v1/logs/${encodeURIComponent(id)}`),
    };
    this.exports = { csv: (query) => this.downloadCsvExport(query) };
    this.templates = {
      list: (query) => request('GET', '/api/v1/templates', { query }),
      create: (body) => request('POST', '/api/v1/templates', { body }),
      get: (id) => request('GET', `/api/v1/templates/${encodeURIComponent(id)}`),
      update: (id, body) => request('PATCH', `/api/v1/templates/${encodeURIComponent(id)}`, { body }),
      delete: (id) => request('DELETE', `/api/v1/templates/${encodeURIComponent(id)}`),
      publish: (id) => request('POST', `/api/v1/templates/${encodeURIComponent(id)}/publish`, { body: {} }),
      duplicate: (id, body = {}) => request('POST', `/api/v1/templates/${encodeURIComponent(id)}/duplicate`, { body }),
      versions: (id) => request('GET', `/api/v1/templates/${encodeURIComponent(id)}/versions`),
    };
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
        return { data: null, error: new SendThanksApiError(message, response.status, details) };
      }
      return { data: await response.arrayBuffer(), error: null };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error : new Error('Send, thanks download failed.') };
    }
  }

  async downloadCsvExport(query) {
    const url = new URL(`${this.baseUrl}/api/v1/exports`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    try {
      const response = await this.fetch(url, { method: 'GET', headers: new Headers({ Authorization: `Bearer ${this.apiKey}`, Accept: 'text/csv' }) });
      if (!response.ok) {
        const text = await response.text();
        let details;
        try { details = text ? JSON.parse(text) : null; } catch { details = { message: text || response.statusText }; }
        const error = details?.error;
        const message = typeof error === 'string' ? error : error?.message ?? details?.message ?? response.statusText;
        return { data: null, error: new SendThanksApiError(message, response.status, details) };
      }
      return { data: await response.text(), error: null };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error : new Error('Send, thanks export failed.') };
    }
  }

  async request(method, path, { query, body, idempotencyKey } = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const headers = new Headers({ Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' });
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isFormData) headers.set('Content-Type', 'application/json');
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
    try {
      const serializedBody = body === undefined ? undefined : isFormData ? body : JSON.stringify(body);
      const response = await this.fetch(url, { method, headers, ...(serializedBody === undefined ? {} : { body: serializedBody }) });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : null; }
      catch { data = { message: text || response.statusText }; }
      if (!response.ok) {
        const errorData = data?.error;
        const message = typeof errorData === 'string' ? errorData : errorData?.message ?? data?.message ?? response.statusText;
        return { data: null, error: new SendThanksApiError(message, response.status, data) };
      }
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error : new Error('Send, thanks request failed.') };
    }
  }
}
