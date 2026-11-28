import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeApiLogValue } from '../src/lib/request-log-sanitization.ts';

test('API logs redact visual email designs as a whole while retaining sender domain', () => {
  const sanitized = sanitizeApiLogValue({
    from: 'Team <hello@example.com>',
    to: ['customer@example.net'],
    subject: 'Private order update',
    design: {
      blocks: [{ type: 'button', label: 'View order 1042', href: 'https://shop.example.com/order?access_token=private-value' }],
    },
  });

  assert.deepEqual(sanitized, {
    from: '[REDACTED]@example.com',
    to: '[REDACTED]',
    subject: '[REDACTED]',
    design: '[REDACTED]',
  });
  assert.doesNotMatch(JSON.stringify(sanitized), /Private order|customer@example|private-value|View order/);
});
