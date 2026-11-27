import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

test('automation condition branches validate and canvas positions survive draft saves', async (context) => {
  const { resolve } = await import('./tsconfig-paths-loader.mjs');
  registerHooks({ resolve });
  const dataDirectory = mkdtempSync(join(tmpdir(), 'send-thanks-automation-canvas-'));
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
  await database.execute('INSERT INTO api_keys(id,name,prefix,secret_hash,created_at) VALUES(?,?,?,?,?)', ['key_canvas', 'Canvas test', 'eg_live_test', 'hash', now]);
  await database.execute('INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)', ['workspace_other', 'Other workspace', now]);
  await database.execute('INSERT INTO api_keys(id,name,prefix,secret_hash,created_at,workspace_id) VALUES(?,?,?,?,?,?)', ['key_other', 'Other workspace key', 'eg_live_other', 'other_hash', now, 'workspace_other']);
  await database.execute('INSERT INTO segments(id,name,filters_json,created_at,updated_at,workspace_id) VALUES(?,?,?,?,?,?)', ['segment_other', 'Other segment', '{"tags_all":["other"]}', now, now, 'workspace_other']);

  const definition = {
    name: 'Welcome path',
    status: 'draft',
    steps: [
      { key: 'start', type: 'trigger', config: { event_name: 'user.created' } },
      { key: 'qualified', type: 'condition', config: { field: 'contact.properties.plan', operator: 'eq', value: 'pro' } },
      { key: 'positive', type: 'delay', config: { duration: '1 day', __sendThanksCanvas: { dx: 32, dy: -16 }, preserved_option: { source: 'existing' } } },
      { key: 'fallback', type: 'contact_update', config: { updates: { tags: ['new'] } } },
    ],
    connections: [
      { from: 'start', to: 'qualified' },
      { from: 'qualified', to: 'positive', condition: 'true' },
      { from: 'qualified', to: 'fallback', condition: 'false' },
    ],
  };

  assert.equal(automations.parseAutomationDefinition(definition).ok, true);
  const invalidCondition = structuredClone(definition);
  invalidCondition.steps[1].config.field = 'properties.plan';
  assert.match(automations.parseAutomationDefinition(invalidCondition).error, /invalid rule/);

  const created = await automations.saveAutomation('key_canvas', null, definition);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const saved = await automations.getAutomationByKey('key_canvas', created.automation.id);
  assert.deepEqual(saved?.steps[2].config, definition.steps[2].config);

  const edited = structuredClone(definition);
  edited.steps[2].config.__sendThanksCanvas = { dx: -48, dy: 24 };
  const updated = await automations.saveAutomation('key_canvas', created.automation.id, {
    steps: edited.steps,
    connections: edited.connections,
  });
  assert.equal(updated.ok, true);
  const reloaded = await automations.getAutomationByKey('key_canvas', created.automation.id);
  assert.deepEqual(reloaded?.steps[2].config.__sendThanksCanvas, { dx: -48, dy: 24 });
  assert.deepEqual(reloaded?.steps[2].config.preserved_option, { source: 'existing' });
  assert.deepEqual(reloaded?.connections, definition.connections);

  const crossWorkspaceDefinition = {
    name: 'Foreign segment attempt',
    status: 'draft',
    steps: [
      { key: 'start', type: 'trigger', config: { event_name: 'user.created' } },
      { key: 'segment', type: 'add_to_segment', config: { segment_id: 'segment_other' } },
    ],
    connections: [{ from: 'start', to: 'segment' }],
  };
  const rejectedForeignSegment = await automations.saveAutomation('key_canvas', null, crossWorkspaceDefinition);
  assert.equal(rejectedForeignSegment.ok, false);
  if (!rejectedForeignSegment.ok) assert.match(rejectedForeignSegment.error, /does not exist/);
});
