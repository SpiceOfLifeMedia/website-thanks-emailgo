import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planContactPropertyDefinitions } from '../src/lib/contact-import-properties.ts';

test('planned imports create missing string and number property definitions', () => {
  assert.deepEqual(planContactPropertyDefinitions([
    { key: 'plan', type: 'string' },
    { key: 'order_count', type: 'number' },
  ], []), {
    ok: true,
    create: [
      { key: 'plan', type: 'string' },
      { key: 'order_count', type: 'number' },
    ],
  });
});

test('planned imports preserve matching definitions and leave boolean values untyped', () => {
  assert.deepEqual(planContactPropertyDefinitions([
    { key: 'plan', type: 'string' },
    { key: 'vip', type: 'boolean' },
  ], [{ property_key: 'plan', type: 'string' }]), {
    ok: true,
    create: [],
  });
});

test('planned imports reject property type conflicts without mutating definitions', () => {
  assert.deepEqual(planContactPropertyDefinitions([
    { key: 'order_count', type: 'string' },
  ], [{ property_key: 'order_count', type: 'number' }]), {
    ok: false,
    error: 'Custom property "order_count" is already defined as number, not string.',
  });
});
