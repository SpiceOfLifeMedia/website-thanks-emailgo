import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStarterEmailDesign, normalizeEmailDesign, renderEmailDesign } from '../src/lib/email-design.ts';

test('email design renders an email-safe table layout and preserves template variables', () => {
  const html = renderEmailDesign(createStarterEmailDesign());
  assert.match(html, /role="presentation"/);
  assert.match(html, /Hello \{\{\{FIRST_NAME\}\}\}/);
  assert.match(html, /https:\/\/example\.com/);
  assert.doesNotMatch(html, /<script\b/i);
});

test('email design escapes block text and rejects executable links', () => {
  const design = createStarterEmailDesign();
  design.blocks = [{ id: 'heading-1', type: 'heading', content: '<script>alert(1)</script>', alignment: 'left', fontSize: 32 }];
  const html = renderEmailDesign(design);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script\b/i);

  design.blocks = [{ id: 'button-1', type: 'button', label: 'Open', href: 'javascript:alert(1)', alignment: 'left' }];
  const result = normalizeEmailDesign(design);
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTPS, HTTP, or email/);
});

test('email design normalizes theme colors and bounds dimensions', () => {
  const design = createStarterEmailDesign();
  design.theme.accentColor = '#ff5a36';
  const result = normalizeEmailDesign(design);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.design.theme.accentColor, '#FF5A36');

  design.theme.contentWidth = 900;
  const invalid = normalizeEmailDesign(design);
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /between 320 and 680/);
});

test('email design keeps template editor typography, spacing and blank image blocks', () => {
  const design = createStarterEmailDesign();
  design.theme.font = 'georgia';
  design.blocks = [
    { id: 'heading', type: 'heading', content: 'Welcome {{first_name}}', alignment: 'center', fontSize: 28, color: '#1C1916', spaceAbove: 8, spaceBelow: 20 },
    { id: 'image', type: 'image', src: '', alt: 'Add a picture', href: null },
  ];
  const result = normalizeEmailDesign(design);
  assert.equal(result.ok, true);
  const html = renderEmailDesign(design);
  assert.match(html, /font-family:Georgia,serif/);
  assert.match(html, /padding:8px 28px 20px/);
  assert.match(html, /Welcome \{\{first_name\}\}/);
  assert.doesNotMatch(html, /images\.example\.com/);
});

test('email design rejects duplicate IDs and nested columns', () => {
  const design = createStarterEmailDesign();
  design.blocks = [
    { id: 'same', type: 'divider' },
    { id: 'same', type: 'spacer', height: 16 },
  ];
  const duplicate = normalizeEmailDesign(design);
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /unique/);

  design.blocks = [{ id: 'columns', type: 'columns', columns: [[{ id: 'nested', type: 'columns', columns: [[], []] }], []] }];
  const nested = normalizeEmailDesign(design);
  assert.equal(nested.ok, false);
  assert.match(nested.error, /nested columns/);
});

test('email table blocks normalize within the row, column and content limits', () => {
  const design = createStarterEmailDesign();
  design.blocks = [{
    id: 'table-1',
    type: 'table',
    rows: [['Item', 'Qty'], ['Wool', '2'] ],
    headerRow: true,
    headerColumn: true,
    alignments: ['left', 'right'],
    borderMode: 'all',
    stripedRows: true,
    borderColor: '#e3dcd0',
    cellBackground: '#fbf9f5',
    cellPadding: 8,
  }];

  const normalized = normalizeEmailDesign(design);
  assert.equal(normalized.ok, true);
  if (normalized.ok) {
    assert.deepEqual(normalized.design.blocks[0], {
      id: 'table-1',
      type: 'table',
      rows: [
        [{ type: 'text', text: 'Item' }, { type: 'text', text: 'Qty' }],
        [{ type: 'text', text: 'Wool' }, { type: 'text', text: '2' }],
      ],
      headerRow: true,
      headerColumn: true,
      alignments: ['left', 'right'],
      borderMode: 'all',
      stripedRows: true,
      borderColor: '#E3DCD0',
      cellBackground: '#FBF9F5',
      cellPadding: 8,
    });
  }

  design.blocks[0].rows = Array.from({ length: 9 }, () => ['cell']);
  const tooManyRows = normalizeEmailDesign(design);
  assert.equal(tooManyRows.ok, false);
  assert.match(tooManyRows.error, /one to eight rows/);

  design.blocks[0].rows = [['a', 'b', 'c', 'd', 'e']];
  const tooManyColumns = normalizeEmailDesign(design);
  assert.equal(tooManyColumns.ok, false);
  assert.match(tooManyColumns.error, /one to four cells/);

  design.blocks[0].rows = [['a', 'b'], ['c']];
  const inconsistentRows = normalizeEmailDesign(design);
  assert.equal(inconsistentRows.ok, false);
  assert.match(inconsistentRows.error, /must contain 2 cells/);
});

test('email table blocks reject unsafe styling and oversized content', () => {
  const design = createStarterEmailDesign();
  const table = {
    id: 'table-1',
    type: 'table',
    rows: [['Value']],
    headerRow: false,
    headerColumn: false,
    alignments: ['left'],
    borderMode: 'all',
    stripedRows: false,
    borderColor: '#E3DCD0',
    cellBackground: '#FBF9F5',
    cellPadding: 8,
  };
  design.blocks = [{ ...table, borderColor: 'red' }];
  const invalidColor = normalizeEmailDesign(design);
  assert.equal(invalidColor.ok, false);
  assert.match(invalidColor.error, /six digit hex color/);

  design.blocks = [{ ...table, alignments: ['justify'] }];
  const invalidAlignment = normalizeEmailDesign(design);
  assert.equal(invalidAlignment.ok, false);
  assert.match(invalidAlignment.error, /alignments must contain one left, center, or right value per column/);

  design.blocks = [{ ...table, alignments: [] }];
  const missingAlignment = normalizeEmailDesign(design);
  assert.equal(missingAlignment.ok, false);
  assert.match(missingAlignment.error, /one left, center, or right value per column/);

  design.blocks = [{ ...table, borderMode: 'vertical' }];
  const invalidBorderMode = normalizeEmailDesign(design);
  assert.equal(invalidBorderMode.ok, false);
  assert.match(invalidBorderMode.error, /borderMode must be all, horizontal, or none/);

  design.blocks = [{ ...table, cellPadding: 25 }];
  const invalidPadding = normalizeEmailDesign(design);
  assert.equal(invalidPadding.ok, false);
  assert.match(invalidPadding.error, /between 0 and 24 pixels/);

  design.blocks = [{ ...table, rows: [['x'.repeat(201)]] }];
  const oversizedCell = normalizeEmailDesign(design);
  assert.equal(oversizedCell.ok, false);
  assert.match(oversizedCell.error, /at most 200 characters/);
});

test('email table image cells require HTTPS and render escaped alt text', () => {
  const design = createStarterEmailDesign();
  const table = {
    id: 'table-image',
    type: 'table',
    rows: [[{ type: 'image', src: 'https://images.example.test/item.png', alt: '<A & B>' }]],
    headerRow: false,
    headerColumn: false,
    alignments: ['left'],
    borderMode: 'none',
    stripedRows: false,
    borderColor: '#E3DCD0',
    cellBackground: '#FFFFFF',
    cellPadding: 8,
  };
  design.blocks = [table];

  const normalized = normalizeEmailDesign(design);
  assert.equal(normalized.ok, true);
  const html = renderEmailDesign(design);
  assert.match(html, /<img src="https:\/\/images\.example\.test\/item\.png" alt="&lt;A &amp; B&gt;"/);

  design.blocks = [{ ...table, rows: [[{ type: 'image', src: 'javascript:alert(1)', alt: 'Unsafe' }]] }];
  const unsafe = normalizeEmailDesign(design);
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.error, /HTTPS image URL/);

  design.blocks = [{ ...table, rows: [[{ type: 'image', src: 'https://images.example.test/item.png', alt: '' }]] }];
  const missingAlt = normalizeEmailDesign(design);
  assert.equal(missingAlt.ok, false);
  assert.match(missingAlt.error, /must describe the image/);
});

test('email table rendering uses semantic headers, inline styling, escaping and variables', () => {
  const design = createStarterEmailDesign();
  design.blocks = [{
    id: 'table-1',
    type: 'table',
    rows: [['<Product>', 'Count'], ['{{item_name}} & more', '3'] ],
    headerRow: true,
    headerColumn: true,
    alignments: ['left', 'right'],
    borderMode: 'all',
    stripedRows: false,
    borderColor: '#E3DCD0',
    cellBackground: '#FBF9F5',
    cellPadding: 6,
  }];

  const html = renderEmailDesign(design);
  assert.match(html, /<th align="left" scope="col"/);
  assert.match(html, /<th align="left" scope="row"/);
  assert.match(html, /<td align="right"/);
  assert.match(html, /border:1px solid #E3DCD0;padding:6px/);
  assert.match(html, /bgcolor="#F7D56E"/);
  assert.match(html, /&lt;Product&gt;/);
  assert.match(html, /\{\{item_name\}\} &amp; more/);
  assert.doesNotMatch(html, /<script\b/i);

  const striped = createStarterEmailDesign();
  striped.blocks = [{
    id: 'table-2',
    type: 'table',
    rows: [['a', 'b'], ['c', 'd'], ['e', 'f']],
    headerRow: false,
    headerColumn: false,
    alignments: ['center', 'left'],
    borderMode: 'horizontal',
    stripedRows: true,
    borderColor: '#E3DCD0',
    cellBackground: '#FBF9F5',
    cellPadding: 4,
  }];
  const stripedHtml = renderEmailDesign(striped);
  assert.match(stripedHtml, /align="center"/);
  assert.match(stripedHtml, /border-bottom:1px solid #E3DCD0/);
  assert.match(stripedHtml, /bgcolor="#F4EEE3"/);
  assert.doesNotMatch(stripedHtml, /;border:1px solid #E3DCD0;padding:/);

  striped.blocks[0].borderMode = 'none';
  const borderlessHtml = renderEmailDesign(striped);
  assert.match(borderlessHtml, /border:0;padding:4px/);
});
