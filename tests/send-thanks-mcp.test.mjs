import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createSendThanksMcpServer } from '../src/lib/send-thanks-mcp.mjs';

async function withMcpClient(api, run) {
  const server = createSendThanksMcpServer({ api });
  const client = new Client({ name: 'send-thanks-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await run(client);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

function responseText(result) {
  return result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
}

test('MCP exposes the Email, thanks API surface as local tools', async () => {
  await withMcpClient({}, async (client) => {
    const { tools } = await client.listTools();
    const names = new Set(tools.map((tool) => tool.name));
    for (const name of ['send_email', 'get_usage', 'list_domains', 'list_contacts', 'send_broadcast', 'list_automations', 'list_webhooks', 'list_suppressions', 'download_csv_export']) {
      assert.equal(names.has(name), true, `${name} is registered`);
    }
    assert.ok(tools.length >= 75);
  });
});

test('MCP forwards sends and redacts provider names and secrets in returned data', async () => {
  let received;
  const api = {
    emails: {
      send: async (body, options) => {
        received = { body, options };
        return { data: { id: 'em_123', provider: 'Resend', relay: 'email-smtp.ap-southeast-2.amazonaws.com', api_key: 'st_live_abcdefghijk', signing_secret: 'whsec_abcdefghijk' }, error: null };
      },
    },
  };

  await withMcpClient(api, async (client) => {
    const result = await client.callTool({ name: 'send_email', arguments: { body: { from: 'hello@example.test', to: 'person@example.test', subject: 'Hello', text: 'Hi' }, idempotency_key: 'order-123' } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(received, { body: { from: 'hello@example.test', to: 'person@example.test', subject: 'Hello', text: 'Hi' }, options: { idempotencyKey: 'order-123' } });
    const text = responseText(result);
    assert.match(text, /mail service/);
    assert.doesNotMatch(text, /Resend|amazonaws|st_live_|whsec_/i);
    assert.match(text, /\[redacted\]/);
  });
});

test('MCP errors hide provider names, hostnames, and API key material', async () => {
  const api = { emails: { get: async () => ({ data: null, error: new Error('SES failed at email-smtp.us-east-1.amazonaws.com with st_live_abcdefghijk') }) } };
  await withMcpClient(api, async (client) => {
    const result = await client.callTool({ name: 'get_email', arguments: { id: 'em_123' } });
    assert.equal(result.isError, true);
    assert.match(responseText(result), /mail service/);
    assert.doesNotMatch(responseText(result), /SES|amazonaws|st_live_/i);
  });
});

test('MCP returns CSV export data as readable sanitized text', async () => {
  const api = { exports: { csv: async () => ({ data: 'id,provider\n1,Amazon SES\n', error: null }) } };
  await withMcpClient(api, async (client) => {
    const result = await client.callTool({ name: 'download_csv_export', arguments: { resource: 'emails' } });
    assert.equal(responseText(result), 'id,provider\n1,mail service\n');
  });
});

test('MCP downloads small inbound attachments as embedded resources', async () => {
  const payload = Buffer.from('invoice, amount\n1, 42\n');
  let downloaded = false;
  const api = {
    emails: {
      receiving: {
        attachments: async () => ({ data: { data: [{ id: 'att_1', filename: 'invoice.csv', content_type: 'text/csv', size: payload.byteLength }] }, error: null }),
        downloadAttachment: async () => { downloaded = true; return { data: payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength), error: null }; },
      },
    },
  };
  await withMcpClient(api, async (client) => {
    const result = await client.callTool({ name: 'download_received_email_attachment', arguments: { id: 're_123', attachment_id: 'att_1' } });
    assert.equal(result.isError, undefined);
    assert.equal(downloaded, true);
    const resource = result.content.find((item) => item.type === 'resource');
    assert.equal(resource.resource.mimeType, 'text/csv');
    assert.equal(Buffer.from(resource.resource.blob, 'base64').toString('utf8'), payload.toString('utf8'));
    assert.match(responseText(result), /invoice\.csv/);
  });
});

test('MCP refuses oversized inbound attachments before downloading bytes', async () => {
  let downloaded = false;
  const api = {
    emails: {
      receiving: {
        attachments: async () => ({ data: { data: [{ id: 'att_big', filename: 'large.bin', content_type: 'application/octet-stream', size: 4 * 1024 * 1024 + 1 }] }, error: null }),
        downloadAttachment: async () => { downloaded = true; return { data: new ArrayBuffer(0), error: null }; },
      },
    },
  };
  await withMcpClient(api, async (client) => {
    const result = await client.callTool({ name: 'download_received_email_attachment', arguments: { id: 're_123', attachment_id: 'att_big' } });
    assert.equal(result.isError, true);
    assert.match(responseText(result), /4 MiB/);
    assert.equal(downloaded, false);
  });
});

test('MCP deletion requires an explicit confirmation field', async () => {
  let deleted = false;
  const api = { contacts: { delete: async () => { deleted = true; return { data: { deleted: true }, error: null }; } } };
  await withMcpClient(api, async (client) => {
    const unconfirmed = await client.callTool({ name: 'delete_contact', arguments: { id: 'ct_123' } });
    assert.equal(unconfirmed.isError, true);
    assert.equal(deleted, false);
    const confirmed = await client.callTool({ name: 'delete_contact', arguments: { id: 'ct_123', confirm: true } });
    assert.equal(confirmed.isError, undefined);
    assert.equal(deleted, true);
  });
});

test('MCP cannot start without a supplied API client or key', () => {
  assert.throws(() => createSendThanksMcpServer({ apiKey: '' }), /Set EMAILGO_API_KEY/);
});
