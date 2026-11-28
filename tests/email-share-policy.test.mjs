import test from 'node:test';
import assert from 'node:assert/strict';
import { emailHtmlToPlainText, shareExpirationMs, sharePublicOrigin } from '../src/lib/email-share-policy.ts';
import { redactShareTokens } from '../src/lib/request-log-sanitization.ts';

test('share link durations default to 48 hours and accept common human-readable values', () => {
  assert.equal(shareExpirationMs(undefined), 48 * 60 * 60 * 1000);
  assert.equal(shareExpirationMs('10m'), 10 * 60 * 1000);
  assert.equal(shareExpirationMs('2 hours'), 2 * 60 * 60 * 1000);
  assert.equal(shareExpirationMs('1 day'), 24 * 60 * 60 * 1000);
  assert.equal(shareExpirationMs('48h'), 48 * 60 * 60 * 1000);
});

test('share link duration rejects empty, malformed and over-limit values', () => {
  for (const value of [null, 10, '', '0m', '-1h', '1.5h', '49h', '2 weeks']) assert.equal(shareExpirationMs(value), null);
});

test('share URL origin must be canonical and use HTTPS in production', () => {
  assert.equal(sharePublicOrigin('https://mail.example.test/', true), 'https://mail.example.test');
  assert.equal(sharePublicOrigin('http://localhost:3000', false), 'http://localhost:3000');
  assert.equal(sharePublicOrigin('http://mail.example.test', true), null);
  assert.equal(sharePublicOrigin('https://mail.example.test/path', false), null);
  assert.equal(sharePublicOrigin('https://user:pass@mail.example.test', false), null);
  assert.equal(sharePublicOrigin(undefined, false), null);
});

test('shared HTML is converted to inert plain text with readable link URLs', () => {
  const html = '<html><head><style>.x{background:url(https://bad.example)}</style><title>Hidden title</title></head><body><script>window.hacked = true</script><p>Hello&nbsp;there</p><a href="https://example.test/order">View order</a><img src="https://bad.example/pixel.png" alt="Order photo"><p>Done.</p></body></html>';
  const text = emailHtmlToPlainText(html);
  assert.equal(text, 'Hello there\nView order (https://example.test/order) Order photo\nDone.');
  assert.doesNotMatch(text, /<|script|background|bad\.example/);
});

test('API request log sanitization removes the bearer token from a returned share URL', () => {
  const token = `shr_live_${'a'.repeat(43)}`;
  assert.equal(redactShareTokens(`https://mail.example.test/share/${token}`), 'https://mail.example.test/share/[REDACTED]');
  const trailingHyphen = `shr_live_${'a'.repeat(42)}-`;
  assert.equal(redactShareTokens(`https://mail.example.test/share/${trailingHyphen}`), 'https://mail.example.test/share/[REDACTED]');
});
