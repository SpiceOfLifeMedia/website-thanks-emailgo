import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flattenTemplateFolders } from '../src/components/template-folder-tree.ts';
import { getTemplateFolderBranchIds, normalizeTemplateFolderName } from '../src/lib/template-folder-utils.ts';

test('template folders flatten into sorted nested paths without losing IDs', () => {
  const folders = [
    { id: 'child-b', name: 'Beta', parent_id: 'root' },
    { id: 'root', name: 'Product', parent_id: null },
    { id: 'root-2', name: 'Campaigns', parent_id: null },
    { id: 'child-a', name: 'Alpha', parent_id: 'root' },
  ];

  assert.deepEqual(flattenTemplateFolders(folders).map(({ folder, depth, path }) => ({ id: folder.id, depth, path })), [
    { id: 'root-2', depth: 0, path: 'Campaigns' },
    { id: 'root', depth: 0, path: 'Product' },
    { id: 'child-a', depth: 1, path: 'Product / Alpha' },
    { id: 'child-b', depth: 1, path: 'Product / Beta' },
  ]);
});

test('template folder names trim whitespace and reject unsafe hierarchy characters', () => {
  assert.deepEqual(normalizeTemplateFolderName('  Product updates  '), { ok: true, name: 'Product updates' });
  for (const name of ['', '  ', 'nested/folder', 'nested\\folder', 'bad\nname', 'x'.repeat(65)]) {
    assert.equal(normalizeTemplateFolderName(name).ok, false, `expected ${JSON.stringify(name)} to be rejected`);
  }
  assert.equal(normalizeTemplateFolderName(null).ok, false);
});

test('selecting a template folder includes templates in every nested folder', () => {
  const folders = [
    { id: 'root', parent_id: null },
    { id: 'child', parent_id: 'root' },
    { id: 'grandchild', parent_id: 'child' },
    { id: 'sibling', parent_id: null },
  ];

  assert.deepEqual([...getTemplateFolderBranchIds('root', folders)], ['root', 'child', 'grandchild']);
  assert.deepEqual([...getTemplateFolderBranchIds('child', folders)], ['child', 'grandchild']);
});
