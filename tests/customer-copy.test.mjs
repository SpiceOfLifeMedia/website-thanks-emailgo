import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeCustomerCopy } from '../src/lib/customer-copy.ts';

test('customer copy hides named delivery providers in errors and relay responses', () => {
  const result = sanitizeCustomerCopy('Amazon SES through AWS; Resend, Migadu and Spacemail');
  assert.equal(result, 'mail service through mail service; mail service, mail service and mail service');
});

test('customer copy hides provider hostnames embedded in transport errors', () => {
  const result = sanitizeCustomerCopy('Connection to email-smtp.ap-southeast-2.amazonaws.com failed; see sns.us-east-1.amazonaws.com.');
  assert.equal(result, 'Connection to mail service failed; see mail service.');
});

test('customer copy leaves neutral delivery details readable', () => {
  assert.equal(sanitizeCustomerCopy('SMTP handoff timed out after 10 seconds.'), 'SMTP handoff timed out after 10 seconds.');
});
