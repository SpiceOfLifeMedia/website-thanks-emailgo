import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkEmailLinks } from '../src/lib/email-link-checker.ts';

test('finds missing, empty, unsafe, relative and placeholder HTML links', () => {
  const issues = checkEmailLinks(`
    <a>Missing</a>
    <a href="">Empty</a>
    <a href="#">Placeholder</a>
    <a href="javascript:alert(1)">Unsafe</a>
    <a href="/relative/path">Relative</a>
    <a href="https://example.com/order">Example</a>
  `, null);
  assert.deepEqual(issues.map((issue) => issue.code), [
    'missing_href', 'empty_href', 'placeholder', 'unsafe_scheme', 'invalid_url', 'placeholder',
  ]);
  assert.ok(issues.every((issue) => issue.source === 'html' && !('href' in issue)));
});

test('accepts web, mail and phone links and declared dynamic URL fallbacks', () => {
  const html = '<a href="https://shop.example.net">Shop</a><a href="mailto:help@shop.test">Email</a><a href="tel:+15551234567">Call</a><a href="{{website_url}}">Visit</a><a href="{{UNSUBSCRIBE_URL}}">Unsubscribe</a>';
  const issues = checkEmailLinks(html, 'See https://shop.example.net and [contact](mailto:help@shop.test).', new Map([['website_url', 'https://shop.example.net/thanks']]));
  assert.deepEqual(issues, []);
});

test('checks text and Markdown destinations without making network requests', () => {
  const issues = checkEmailLinks(null, 'Visit [our site](#) or https://example.org/welcome.');
  assert.deepEqual(issues.map((issue) => issue.code), ['placeholder', 'placeholder']);
  assert.ok(issues.every((issue) => issue.source === 'text'));
});

test('flags unresolved dynamic links and limits returned issues', () => {
  const unresolved = checkEmailLinks('<a href="{{campaign_url}}">Campaign</a>', null);
  assert.deepEqual(unresolved.map((issue) => issue.code), ['placeholder']);
  const many = '<a>Broken</a>'.repeat(80);
  assert.equal(checkEmailLinks(many, null).length, 50);
});
