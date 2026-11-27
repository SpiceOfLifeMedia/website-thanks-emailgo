import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { test } from 'node:test';
import { parseSesNotification, parseSnsEnvelope, relayMessageIdFromResponse, snsStringToSign, strongerStatus, trustedSnsUrl, verifySnsSignature } from '../src/lib/ses-events.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const certUrl = 'https://sns.ap-southeast-2.amazonaws.com/SimpleNotificationService-abc.pem';
function signed(fields, version = '2') {
  const envelope = { MessageId: 'sns-1', TopicArn: 'arn:aws:sns:ap-southeast-2:1:emailgo', Timestamp: '2026-11-26T00:00:00.000Z', SignatureVersion: version, SigningCertURL: certUrl, Signature: '', ...fields };
  envelope.Signature = createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256').update(snsStringToSign(envelope)).sign(privateKey, 'base64');
  return envelope;
}
const fetchCert = async () => publicPem;
const sesMessage = (body) => JSON.stringify({ mail: { messageId: 'ses-123' }, ...body });

test('accepts a correctly signed SNS notification (v1 and v2)', async () => {
  for (const version of ['1', '2']) {
    const envelope = signed({ Type: 'Notification', Message: sesMessage({ notificationType: 'Delivery' }) }, version);
    assert.ok(parseSnsEnvelope(envelope));
    assert.equal(await verifySnsSignature(envelope, fetchCert), true);
  }
});

test('rejects tampered messages, unknown versions and untrusted certificate hosts', async () => {
  const envelope = signed({ Type: 'Notification', Message: sesMessage({ notificationType: 'Delivery' }) });
  assert.equal(await verifySnsSignature({ ...envelope, Message: sesMessage({ notificationType: 'Complaint' }) }, fetchCert), false);
  assert.equal(await verifySnsSignature({ ...envelope, SignatureVersion: '3' }, fetchCert), false);
  assert.equal(await verifySnsSignature({ ...envelope, SigningCertURL: 'https://evil.example.com/cert.pem' }, fetchCert), false);
  assert.equal(await verifySnsSignature({ ...envelope, SigningCertURL: 'http://sns.ap-southeast-2.amazonaws.com/x.pem' }, fetchCert), false);
  assert.equal(trustedSnsUrl('https://sns.ap-southeast-2.amazonaws.com.evil.com/x'), null);
});

test('rejects malformed envelopes', () => {
  assert.equal(parseSnsEnvelope(null), null);
  assert.equal(parseSnsEnvelope({ Type: 'Notification' }), null);
  assert.equal(parseSnsEnvelope({ ...signed({ Type: 'Notification', Message: '{}' }), Subject: 5 }), null);
});

test('signs subscription confirmations over their own fields', async () => {
  const envelope = signed({ Type: 'SubscriptionConfirmation', Message: 'confirm', Token: 't', SubscribeURL: 'https://sns.ap-southeast-2.amazonaws.com/?Action=ConfirmSubscription' });
  assert.equal(await verifySnsSignature(envelope, fetchCert), true);
});

test('permanent bounces and complaints suppress the recipient; transient bounces do not', () => {
  const permanent = parseSesNotification(sesMessage({ notificationType: 'Bounce', bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'Gone@Example.com' }] } }));
  assert.deepEqual(permanent, [{ type: 'bounced', relayMessageId: 'ses-123', recipient: 'gone@example.com', suppress: true, detail: 'Permanent / General', bounce: { type: 'Permanent', subType: 'General' } }]);
  const transient = parseSesNotification(sesMessage({ notificationType: 'Bounce', bounce: { bounceType: 'Transient', bouncedRecipients: [{ emailAddress: 'full@example.com' }] } }));
  assert.equal(transient[0].type, 'deferred');
  assert.equal(transient[0].suppress, false);
  const complaint = parseSesNotification(sesMessage({ eventType: 'Complaint', complaint: { complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: 'angry@example.com' }] } }));
  assert.deepEqual(complaint.map(({ type, suppress }) => [type, suppress]), [['complained', true]]);
  assert.deepEqual(complaint[0].complaint, { feedbackType: 'abuse' });
  const shared = parseSesNotification(sesMessage({ notificationType: 'Complaint', complaint: { complainedRecipients: [{ emailAddress: 'a@example.com' }, { emailAddress: 'b@example.com' }] } }));
  assert.deepEqual(shared.map(({ type, suppress }) => [type, suppress]), [['complained', false], ['complained', false]]);
  const delivered = parseSesNotification(sesMessage({ notificationType: 'Delivery', delivery: { recipients: ['ok@example.com'] } }));
  assert.equal(delivered[0].type, 'delivered');
});

test('ignores unknown or malformed SES payloads', () => {
  assert.deepEqual(parseSesNotification('not json'), []);
  assert.deepEqual(parseSesNotification(JSON.stringify({ notificationType: 'Bounce' })), []);
  assert.deepEqual(parseSesNotification(sesMessage({ notificationType: 'Open' })), []);
});

test('reads the SES message ID from the SMTP response and ranks statuses', () => {
  assert.equal(relayMessageIdFromResponse('250 Ok 0108019abc-def-000000'), '0108019abc-def-000000');
  assert.equal(relayMessageIdFromResponse('250 2.0.0 queued'), null);
  assert.equal(strongerStatus('sent', 'delivered'), 'delivered');
  assert.equal(strongerStatus('complained', 'delivered'), 'complained');
  assert.equal(strongerStatus('bounced', 'deferred'), 'bounced');
});
