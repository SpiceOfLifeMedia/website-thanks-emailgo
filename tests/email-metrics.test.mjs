import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEmailMetricRates, deliveryEventMetrics, emailMetricNames } from '../src/lib/email-metrics.ts';

test('exposes the complete email metrics name set', () => {
  assert.deepEqual(emailMetricNames, [
    'received', 'sent', 'failed', 'suppressed', 'delivered', 'delivery_delayed', 'bounced',
    'bounced_transient', 'bounced_permanent', 'bounced_undetermined', 'complained', 'opened',
    'unique_opened', 'clicked', 'unique_clicked', 'unsubscribed', 'delivery_rate', 'open_rate',
    'click_rate', 'bounce_rate', 'complaint_rate', 'unsubscribe_rate',
  ]);
});

test('classifies recipient bounce subtypes and delivery outcomes', () => {
  assert.deepEqual(deliveryEventMetrics('bounced', 'Permanent / General'), { bounced: 1, bounced_permanent: 1 });
  assert.deepEqual(deliveryEventMetrics('deferred', 'Transient / MailboxFull'), { delivery_delayed: 1, bounced: 1, bounced_transient: 1 });
  assert.deepEqual(deliveryEventMetrics('deferred', 'Undetermined'), { delivery_delayed: 1, bounced: 1, bounced_undetermined: 1 });
  assert.deepEqual(deliveryEventMetrics('deferred', 'temporary failure'), { delivery_delayed: 1 });
  assert.deepEqual(deliveryEventMetrics('delivered', 'Delivered'), { delivered: 1 });
  assert.deepEqual(deliveryEventMetrics('complained', 'abuse'), { complained: 1 });
});

test('calculates decimal rates with zero-denominator protection', () => {
  assert.deepEqual(applyEmailMetricRates({ sent: 10, delivered: 8, unique_opened: 4, unique_clicked: 2, bounced: 1, complained: 1, unsubscribed: 1 }), {
    delivery_rate: 0.8,
    open_rate: 0.5,
    click_rate: 0.25,
    bounce_rate: 0.125,
    complaint_rate: 0.125,
    unsubscribe_rate: 0.125,
  });
  assert.deepEqual(applyEmailMetricRates({ sent: 0, delivered: 0, unique_opened: 0, unique_clicked: 0, bounced: 0, complained: 0, unsubscribed: 0 }), {
    delivery_rate: 0,
    open_rate: 0,
    click_rate: 0,
    bounce_rate: 0,
    complaint_rate: 0,
    unsubscribe_rate: 0,
  });
});
