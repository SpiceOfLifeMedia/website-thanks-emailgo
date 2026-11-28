import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToPlainText, resolvePlainText } from '../src/lib/plain-text.ts';

test('converts HTML structure, entities, and links into readable plain text', () => {
  const text = htmlToPlainText(`<!doctype html><html><head><title>Do not include title</title><style>.hidden{display:none}</style></head><body>
    <h1>Welcome &amp; thanks</h1><p>Read <a href="https://example.test/guide">the guide</a>.</p>
    <script>secret()</script>
  </body></html>`);

  assert.match(text, /Welcome & thanks/);
  assert.match(text, /the guide \[https:\/\/example\.test\/guide\]/);
  assert.doesNotMatch(text, /Do not include title|secret\(\)|\.hidden/);
});

test('skips visually hidden preheaders and aria-hidden content', () => {
  const text = htmlToPlainText('<body><span style="display:none!important">Preview only</span><span aria-hidden="true">Decorative text</span><p>Visible copy</p></body>');
  assert.equal(text, 'Visible copy');
});

test('generates text only when it was omitted, preserving an explicit empty string', () => {
  assert.equal(resolvePlainText(undefined, '<p>Hello</p>'), 'Hello');
  assert.equal(resolvePlainText(null, '<p>Hello</p>'), 'Hello');
  assert.equal(resolvePlainText('', '<p>Hello</p>'), '');
  assert.equal(resolvePlainText('Custom copy', '<p>Hello</p>'), 'Custom copy');
  assert.equal(resolvePlainText(null, null), null);
});
