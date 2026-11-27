import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';

test('CLI writes streamed CSV exports to stdout without JSON wrapping', async () => {
  let requestDetails;
  const server = createServer((request, response) => {
    requestDetails = { url: request.url, authorization: request.headers.authorization, accept: request.headers.accept };
    response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8' });
    response.end('id,email\r\nct_1,sam@example.test\r\n');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        'bin/send-thanks.mjs', 'exports', 'download', '--resource', 'contacts', '--search', 'sam',
      ], {
        cwd: process.cwd(),
        env: { ...process.env, EMAILGO_BASE_URL: `http://127.0.0.1:${address.port}`, EMAILGO_API_KEY: 'test-key' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout, stderr }));
    });

    assert.deepEqual(result, { code: 0, stdout: 'id,email\r\nct_1,sam@example.test\r\n', stderr: '' });
    assert.deepEqual(requestDetails, {
      url: '/api/v1/exports?search=sam&resource=contacts',
      authorization: 'Bearer test-key',
      accept: 'text/csv',
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
