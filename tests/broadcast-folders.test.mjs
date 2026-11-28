import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

test('broadcast folders are account-wide, validate names, and preserve campaigns when removed', async (context) => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'send-thanks-broadcast-folders-'));
  process.env.EMAILGO_DATA_DIR = dataDirectory;
  delete process.env.DATABASE_URL;
  const database = await import('../src/lib/database.ts');
  const foldersApi = await import('../src/lib/broadcast-folders.ts');
  context.after(() => {
    const handle = globalThis.emailgoSqlite;
    if (handle) handle.close();
    delete globalThis.emailgoSqlite;
    delete process.env.EMAILGO_DATA_DIR;
    rmSync(dataDirectory, { recursive: true, force: true });
  });

  const folderColumns = await database.query('PRAGMA table_info(broadcast_folders)');
  assert.ok(folderColumns.rows.some(({ name }) => name === 'name'));
  const broadcastColumns = await database.query('PRAGMA table_info(broadcasts)');
  assert.ok(broadcastColumns.rows.some(({ name }) => name === 'folder_id'));

  const created = await foldersApi.createBroadcastFolder('Spring sale');
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.folder.name, 'Spring sale');
  assert.equal(created.folder.broadcast_count, 0);

  const duplicate = await foldersApi.createBroadcastFolder(' spring SALE ');
  assert.deepEqual(duplicate, { ok: false, status: 409, error: 'A folder with that name already exists.' });
  const invalid = await foldersApi.createBroadcastFolder('   ');
  assert.equal(invalid.ok, false);

  const renamed = await foldersApi.renameBroadcastFolder(created.folder.id, 'Spring updates');
  assert.equal(renamed.ok, true);

  const timestamp = new Date().toISOString();
  await database.execute('INSERT INTO api_keys(id,name,prefix,secret_hash,created_at) VALUES(?,?,?,?,?)', ['key_1', 'Test key', 'eg_live_test', 'hash', timestamp]);
  await database.execute(`INSERT INTO broadcasts(id,name,api_key_id,from_address,subject,audience_type,audience_id,status,created_at,updated_at)
    VALUES(?,?,?,?,?,'segment','segment_1','draft',?,?)`, ['bc_1', 'Campaign 1', 'key_1', 'hello@example.com', 'A subject', timestamp, timestamp]);

  const moved = await foldersApi.moveBroadcastToFolder('bc_1', created.folder.id);
  assert.deepEqual(moved, { ok: true });
  assert.equal((await database.queryOne('SELECT folder_id FROM broadcasts WHERE id=?', ['bc_1']))?.folder_id, created.folder.id);
  const folderWithCount = await foldersApi.listBroadcastFolders();
  assert.equal(folderWithCount[0].broadcast_count, 1);

  assert.equal(await foldersApi.deleteBroadcastFolder(created.folder.id), true);
  assert.equal(await foldersApi.deleteBroadcastFolder(created.folder.id), false);
  const preservedCampaign = await database.queryOne('SELECT id,folder_id FROM broadcasts WHERE id=?', ['bc_1']);
  assert.equal(preservedCampaign?.id, 'bc_1');
  assert.equal(preservedCampaign?.folder_id, null);
  assert.deepEqual(await foldersApi.listBroadcastFolders(), []);
});
