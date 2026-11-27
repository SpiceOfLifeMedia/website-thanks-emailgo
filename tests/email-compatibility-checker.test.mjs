import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkEmailCompatibility } from '../src/lib/email-compatibility-checker.ts';

test('flags removed or inconsistently supported email elements', () => {
  const issues = checkEmailCompatibility('<script>alert(1)</script><a onclick="go()">link</a><iframe></iframe><svg></svg><form></form><link rel="stylesheet" href="https://styles.example.test/email.css">');
  assert.deepEqual(issues.map((issue) => [issue.code, issue.severity]), [
    ['script_element', 'error'],
    ['event_handler', 'error'],
    ['unsupported_element', 'warning'],
    ['unsupported_element', 'warning'],
    ['unsupported_element', 'warning'],
    ['external_stylesheet', 'warning'],
  ]);
});

test('flags CSS layout, viewport, math and modern color patterns with line numbers', () => {
  const html = '<style>\n.box { display: grid; position: fixed; width: 90vw; color: clamp(1px, 2vw, 4px); background: color-mix(in srgb, red, blue); }\n</style>';
  const issues = checkEmailCompatibility(html);
  assert.deepEqual(issues.map((issue) => issue.code), ['flex_or_grid', 'fixed_position', 'viewport_units', 'css_math', 'viewport_units', 'modern_color']);
  assert.ok(issues.every((issue) => issue.line === 2 && issue.severity === 'warning'));
});

test('distinguishes a CSS variable fallback and flags framework artifacts', () => {
  const html = '<div id="__next" data-reactroot style="color:var(--ink); background:var(--paper, #fbf9f5)">Hello</div>';
  const issues = checkEmailCompatibility(html);
  assert.deepEqual(issues.map((issue) => issue.code), ['framework_markup', 'framework_markup', 'css_variable_without_fallback']);
});

test('does not report ordinary email-safe markup and caps the issue list', () => {
  assert.deepEqual(checkEmailCompatibility('<table><tr><td style="color:#1c1916">Thanks</td></tr></table>'), []);
  assert.equal(checkEmailCompatibility('<script></script>'.repeat(80)).length, 50);
});

test('returns generic messages without echoing source content', () => {
  const issues = checkEmailCompatibility('<script src="https://private.example/path?key=secret"></script>');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].message.includes('private.example'), false);
  assert.equal(issues[0].message.includes('secret'), false);
});
