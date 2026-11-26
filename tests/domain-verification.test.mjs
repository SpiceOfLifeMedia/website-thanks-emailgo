import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicVerificationToken, verificationRecordHosts } from '../src/lib/domain-verification.ts';

test('new verification tokens use the Send, thanks record name', () => {
  assert.equal(publicVerificationToken('send-thanks-verify=abc123'), 'send-thanks-verify=abc123');
  assert.deepEqual(verificationRecordHosts('example.com', 'send-thanks-verify=abc123'), ['_send-thanks.example.com']);
});

test('existing verification tokens are shown with the new brand and old DNS remains accepted', () => {
  assert.equal(publicVerificationToken('emailgo-verify=abc123'), 'send-thanks-verify=abc123');
  assert.deepEqual(verificationRecordHosts('example.com', 'emailgo-verify=abc123'), ['_send-thanks.example.com', '_emailgo.example.com']);
});
