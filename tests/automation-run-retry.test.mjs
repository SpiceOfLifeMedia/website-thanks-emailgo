import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

test('failed automation runs retry only the current step and retain attempt errors', async (context) => {
  const { resolve } = await import('./tsconfig-paths-loader.mjs');
  registerHooks({ resolve });
  const dataDirectory = mkdtempSync(join(tmpdir(), 'send-thanks-automation-retry-'));
  process.env.EMAILGO_DATA_DIR = dataDirectory;
  delete process.env.DATABASE_URL;
  const database = await import('../src/lib/database.ts');
  const automations = await import('../src/lib/automations.ts');
  context.after(() => {
    const handle = globalThis.emailgoSqlite;
    if (handle) handle.close();
    delete globalThis.emailgoSqlite;
    delete process.env.EMAILGO_DATA_DIR;
    rmSync(dataDirectory, { recursive: true, force: true });
  });

  const now = new Date().toISOString();
  await database.execute('INSERT INTO api_keys(id,name,prefix,secret_hash,created_at) VALUES(?,?,?,?,?)', ['key_retry', 'Retry test', 'eg_live_retry', 'retry_hash', now]);
  await database.execute('INSERT INTO contacts(id,email,name,properties_json,tags_json,consent_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', [
    'contact_retry', 'retry@example.test', 'Already changed', '{}', '[]', 'unknown', now, 'original-contact-time',
  ]);

  const steps = [
    { key: 'start', type: 'trigger', config: { event_name: 'user.created' } },
    { key: 'update', type: 'contact_update', config: { updates: { name: 'Already changed' } } },
    { key: 'pause', type: 'delay', config: { duration: '1 day' } },
  ];
  const connections = [{ from: 'start', to: 'update' }, { from: 'update', to: 'pause' }];
  await database.execute('INSERT INTO automations(id,api_key_id,name,status,trigger_event,steps_json,connections_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', [
    'automation_retry', 'key_retry', 'Retry workflow', 'paused', 'user.created', JSON.stringify(steps), JSON.stringify(connections), now, now,
  ]);
  await database.execute('INSERT INTO automation_events(id,api_key_id,event_name,payload_json,created_at) VALUES(?,?,?,?,?)', ['event_retry', 'key_retry', 'user.created', '{}', now]);
  await database.execute(`INSERT INTO automation_runs(id,automation_id,api_key_id,event_id,event_name,contact_id,email,payload_json,steps_json,connections_json,current_step_key,status,context_json,started_at,updated_at,completed_at,error)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,'failed',?,?,?,?,?)`, [
    'run_retry', 'automation_retry', 'key_retry', 'event_retry', 'user.created', 'contact_retry', 'retry@example.test', '{}', JSON.stringify(steps), JSON.stringify(connections), 'pause', '{}', now, now, now, 'Initial failure',
  ]);
  await database.transaction([
    { sql: 'INSERT INTO automation_run_steps(id,run_id,step_key,step_type,status,input_json,output_json,started_at,finished_at,error) VALUES(?,?,?,?,?,?,?,?,?,?)', params: ['step_update', 'run_retry', 'update', 'contact_update', 'completed', '{}', '{"updated":["name"]}', now, now, null] },
    { sql: 'INSERT INTO automation_run_steps(id,run_id,step_key,step_type,status,input_json,output_json,started_at,finished_at,error) VALUES(?,?,?,?,?,?,?,?,?,?)', params: ['step_pause', 'run_retry', 'pause', 'delay', 'failed', '{}', null, now, now, 'Delay worker stopped unexpectedly'] },
  ]);

  const wrongOwner = await automations.retryAutomationRun('different_key', 'automation_retry', 'run_retry');
  assert.equal(wrongOwner.ok, false);
  if (!wrongOwner.ok) assert.equal(wrongOwner.status, 404);

  const retried = await automations.retryAutomationRun('key_retry', 'automation_retry', 'run_retry');
  assert.deepEqual(retried, { ok: true, run: { id: 'run_retry', status: 'running', step_key: 'pause', attempt: 2 } });
  const secondRetry = await automations.retryAutomationRun('key_retry', 'automation_retry', 'run_retry');
  assert.equal(secondRetry.ok, false);
  if (!secondRetry.ok) assert.equal(secondRetry.status, 409);

  const worker = await automations.processAutomationRuns();
  assert.equal(worker.checked, 1);
  assert.equal(worker.waiting, 1);
  const currentRun = await database.queryOne('SELECT status,current_step_key FROM automation_runs WHERE id=?', ['run_retry']);
  assert.equal(currentRun.status, 'waiting');
  assert.equal(currentRun.current_step_key, null);
  const contact = await database.queryOne('SELECT name,updated_at FROM contacts WHERE id=?', ['contact_retry']);
  assert.equal(contact.name, 'Already changed');
  assert.equal(contact.updated_at, 'original-contact-time');

  const detail = await automations.getAutomationRun('key_retry', 'automation_retry', 'run_retry');
  const attempts = detail.steps.find((step) => step.step_key === 'pause').attempts;
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts.map(({ attempt_number, status, error }) => ({ attempt_number, status, error })), [
    { attempt_number: 1, status: 'failed', error: 'Delay worker stopped unexpectedly' },
    { attempt_number: 2, status: 'completed', error: null },
  ]);
});

test('retrying a failed email step requires explicit duplicate-send acknowledgment', async (context) => {
  const { resolve } = await import('./tsconfig-paths-loader.mjs');
  registerHooks({ resolve });
  const dataDirectory = mkdtempSync(join(tmpdir(), 'send-thanks-automation-send-retry-'));
  process.env.EMAILGO_DATA_DIR = dataDirectory;
  delete process.env.DATABASE_URL;
  const database = await import('../src/lib/database.ts');
  const automations = await import('../src/lib/automations.ts');
  context.after(() => {
    const handle = globalThis.emailgoSqlite;
    if (handle) handle.close();
    delete globalThis.emailgoSqlite;
    delete process.env.EMAILGO_DATA_DIR;
    rmSync(dataDirectory, { recursive: true, force: true });
  });

  const now = new Date().toISOString();
  await database.execute('INSERT INTO api_keys(id,name,prefix,secret_hash,created_at) VALUES(?,?,?,?,?)', ['key_send_retry', 'Send retry test', 'eg_live_send_retry', 'send_retry_hash', now]);
  const steps = [
    { key: 'start', type: 'trigger', config: { event_name: 'user.created' } },
    { key: 'send', type: 'send_email', config: { template: { id: 'template_missing' }, from: 'hello@example.test' } },
  ];
  const connections = [{ from: 'start', to: 'send' }];
  await database.execute('INSERT INTO automations(id,api_key_id,name,status,trigger_event,steps_json,connections_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', [
    'automation_send_retry', 'key_send_retry', 'Retry email', 'paused', 'user.created', JSON.stringify(steps), JSON.stringify(connections), now, now,
  ]);
  await database.execute('INSERT INTO automation_events(id,api_key_id,event_name,payload_json,created_at) VALUES(?,?,?,?,?)', ['event_send_retry', 'key_send_retry', 'user.created', '{}', now]);
  await database.execute(`INSERT INTO automation_runs(id,automation_id,api_key_id,event_id,event_name,email,payload_json,steps_json,connections_json,current_step_key,status,context_json,started_at,updated_at,completed_at,error)
    VALUES(?,?,?,?,?,?,?,?,?,?,'failed',?,?,?,?,?)`, [
    'run_send_retry', 'automation_send_retry', 'key_send_retry', 'event_send_retry', 'user.created', 'person@example.test', '{}', JSON.stringify(steps), JSON.stringify(connections), 'send', '{}', now, now, now, 'Mail result uncertain',
  ]);
  await database.execute('INSERT INTO automation_run_steps(id,run_id,step_key,step_type,status,input_json,started_at,finished_at,error) VALUES(?,?,?,?,?,?,?,?,?)', [
    'step_send_retry', 'run_send_retry', 'send', 'send_email', 'failed', '{}', now, now, 'Mail result uncertain',
  ]);

  const unconfirmed = await automations.retryAutomationRun('key_send_retry', 'automation_send_retry', 'run_send_retry');
  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) {
    assert.equal(unconfirmed.status, 409);
    assert.match(unconfirmed.error, /may send a duplicate/);
  }
  assert.equal((await database.queryOne('SELECT status FROM automation_runs WHERE id=?', ['run_send_retry'])).status, 'failed');

  const confirmed = await automations.retryAutomationRun('key_send_retry', 'automation_send_retry', 'run_send_retry', true);
  assert.equal(confirmed.ok, true);
  if (confirmed.ok) assert.equal(confirmed.run.attempt, 2);
  assert.equal((await database.queryOne('SELECT status FROM automation_runs WHERE id=?', ['run_send_retry'])).status, 'running');
});
