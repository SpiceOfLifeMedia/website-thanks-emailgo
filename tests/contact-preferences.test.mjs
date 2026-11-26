import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContactPreferenceToken, verifyContactPreferenceToken } from '../src/lib/contact-preference-token.ts';

test('broadcast preference links retain their source email while legacy links remain valid', () => {
  const original = process.env.EMAILGO_PREFERENCES_SECRET;
  process.env.EMAILGO_PREFERENCES_SECRET = 'unit-test-preference-secret-value-32';
  try {
    const identity = { contactId: 'contact-1', email: 'person@example.com' };
    const legacyToken = createContactPreferenceToken(identity);
    assert.deepEqual(verifyContactPreferenceToken(legacyToken), identity);

    const broadcastToken = createContactPreferenceToken({ ...identity, emailId: 'email-1' });
    assert.deepEqual(verifyContactPreferenceToken(broadcastToken), { ...identity, emailId: 'email-1' });
    assert.equal(verifyContactPreferenceToken(`${broadcastToken}tampered`), null);
  } finally {
    if (original === undefined) delete process.env.EMAILGO_PREFERENCES_SECRET;
    else process.env.EMAILGO_PREFERENCES_SECRET = original;
  }
});
