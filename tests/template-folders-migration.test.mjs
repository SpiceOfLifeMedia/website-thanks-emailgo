import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

test('SQLite upgrades existing templates and returns nested-folder templates to All templates on deletion', async (context) => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'send-thanks-folders-'));
  mkdirSync(dataDirectory, { recursive: true });
  const databaseFile = join(dataDirectory, 'emailgo.sqlite');
  const legacy = new DatabaseSync(databaseFile);
  legacy.exec(`CREATE TABLE email_templates (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, alias TEXT, from_address TEXT,
    subject TEXT NOT NULL DEFAULT '', reply_to TEXT, html TEXT, text TEXT,
    variables_json TEXT NOT NULL DEFAULT '[]', editor_json TEXT, current_version_id TEXT, published_version_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft', published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  legacy.close();

  process.env.EMAILGO_DATA_DIR = dataDirectory;
  delete process.env.DATABASE_URL;
  const database = await import('../src/lib/database.ts');
  context.after(() => {
    const handle = globalThis.emailgoSqlite;
    if (handle) handle.close();
    delete globalThis.emailgoSqlite;
    delete process.env.EMAILGO_DATA_DIR;
    rmSync(dataDirectory, { recursive: true, force: true });
  });

  const columns = await database.query('PRAGMA table_info(email_templates)');
  assert.ok(columns.rows.some(({ name }) => name === 'folder_id'));

  const timestamp = new Date().toISOString();
  await database.execute('INSERT INTO email_template_folders(id,name,parent_id,created_at,updated_at) VALUES(?,?,?,?,?)', ['root', 'Product', null, timestamp, timestamp]);
  await database.execute('INSERT INTO email_template_folders(id,name,parent_id,created_at,updated_at) VALUES(?,?,?,?,?)', ['child', 'Updates', 'root', timestamp, timestamp]);
  await database.execute('INSERT INTO email_templates(id,name,created_at,updated_at,folder_id) VALUES(?,?,?,?,?)', ['template', 'Welcome', timestamp, timestamp, 'child']);

  await database.execute('DELETE FROM email_template_folders WHERE id=?', ['root']);

  const remaining = await database.queryOne('SELECT id,folder_id FROM email_templates WHERE id=?', ['template']);
  assert.equal(remaining?.id, 'template');
  assert.equal(remaining?.folder_id, null);
  const folders = await database.query('SELECT id FROM email_template_folders');
  assert.deepEqual(folders.rows, []);
});
