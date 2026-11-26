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
