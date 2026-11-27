import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMarkdownTable, toEmailHtml } from '../src/components/templates-editor/blocks.ts';

test('Markdown tables retain per-column alignment and become a bounded table block', () => {
  const table = parseMarkdownTable(`
| Plan | Seats | Price |
| :--- | :---: | ---: |
| Starter | 1 | $0 |
| Pro | 5 | $20 |
`);

  assert.equal(table?.kind, 'table');
  assert.deepEqual(table?.rows, [
    [{ type: 'text', text: 'Plan' }, { type: 'text', text: 'Seats' }, { type: 'text', text: 'Price' }],
    [{ type: 'text', text: 'Starter' }, { type: 'text', text: '1' }, { type: 'text', text: '$0' }],
    [{ type: 'text', text: 'Pro' }, { type: 'text', text: '5' }, { type: 'text', text: '$20' }],
  ]);
  assert.deepEqual(table?.alignments, ['left', 'center', 'right']);
  assert.equal(table?.headerRow, true);
  assert.equal(table?.headerColumn, false);
});

test('Markdown image cells require HTTPS and descriptive alt text', () => {
  const table = parseMarkdownTable(`
| Product | Photo |
| --- | ---: |
| Yarn | ![Oatmeal yarn](https://images.example.test/yarn.png) |
`);
  assert.deepEqual(table?.rows?.[1]?.[1], {
    type: 'image',
    src: 'https://images.example.test/yarn.png',
    alt: 'Oatmeal yarn',
  });
  assert.equal(parseMarkdownTable('| Product | Photo |\n| --- | --- |\n| Yarn | ![Unsafe](javascript:alert(1)) |'), null);
  assert.equal(parseMarkdownTable('| Product | Photo |\n| --- | --- |\n| Yarn | ![](https://images.example.test/yarn.png) |'), null);
});

test('table rendering escapes cell text and emits accessible, email-friendly cell styles', () => {
  const html = toEmailHtml([{
    id: 'table-safe',
    kind: 'table',
    content: '',
    rows: [
      [{ type: 'text', text: 'Product' }, { type: 'text', text: 'Cost' }],
      [{ type: 'text', text: '<script>alert(1)</script>' }, { type: 'text', text: '{{first_name}}' }],
      [{ type: 'text', text: 'Delivery' }, { type: 'text', text: '$5' }],
    ],
    headerRow: true,
    headerColumn: true,
    alignments: ['left', 'right'],
    borderMode: 'horizontal',
    stripedRows: true,
    borderColor: '#E3DCD0',
    cellBackground: '#FFFFFF',
    cellPadding: 8,
  }], { background: '#FBF9F5', button: '#FF5A36', font: 'sans' });

  assert.match(html, /<th scope="col"/);
  assert.match(html, /<th scope="row"/);
  assert.match(html, /text-align:right/);
  assert.match(html, /background-color:#F4EEE3/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /\{\{first_name\}\}/);
  assert.doesNotMatch(html, /<script\b/i);
});

test('Markdown table paste rejects inconsistent or oversized grids', () => {
  assert.equal(parseMarkdownTable('| A | B |\n| --- | --- |\n| one |'), null);
  assert.equal(parseMarkdownTable('| A | B | C | D | E |\n| --- | --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 | 5 |'), null);
  assert.equal(parseMarkdownTable('| A |\n| -- |\n| 1 |'), null);
});
