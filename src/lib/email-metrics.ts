export const emailMetricNames = [
  'received', 'sent', 'failed', 'suppressed', 'delivered', 'delivery_delayed', 'bounced',
  'bounced_transient', 'bounced_permanent', 'bounced_undetermined', 'complained', 'opened',
  'unique_opened', 'clicked', 'unique_clicked', 'unsubscribed', 'delivery_rate', 'open_rate',
  'click_rate', 'bounce_rate', 'complaint_rate', 'unsubscribe_rate',
] as const;

export const emailMetricCounterNames = emailMetricNames.filter((metric) => !metric.endsWith('_rate'));

export type EmailMetricName = typeof emailMetricNames[number];
export type EmailMetricCounters = Record<string, number>;

export function deliveryEventMetrics(eventType: string, detail: string | null): Partial<Record<EmailMetricName, number>> {
  const output: Partial<Record<EmailMetricName, number>> = {};
  if (eventType === 'delivered') output.delivered = 1;
  if (eventType === 'deferred') output.delivery_delayed = 1;
  if (eventType === 'complained') output.complained = 1;

  if (eventType === 'bounced' || eventType === 'deferred') {
    const subtype = /^(transient|permanent|undetermined)(?:\s*\/|$)/i.exec(detail?.trim() ?? '')?.[1]?.toLowerCase();
    if (eventType === 'bounced' || subtype) output.bounced = 1;
    if (subtype === 'transient') output.bounced_transient = 1;
    if (subtype === 'permanent') output.bounced_permanent = 1;
    if (subtype === 'undetermined') output.bounced_undetermined = 1;
  }
  return output;
}

export function applyEmailMetricRates(values: EmailMetricCounters) {
  const ratio = (numerator: string, denominator: string) => values[denominator] > 0 ? values[numerator] / values[denominator] : 0;
  return {
    delivery_rate: ratio('delivered', 'sent'),
    open_rate: ratio('unique_opened', 'delivered'),
    click_rate: ratio('unique_clicked', 'delivered'),
    bounce_rate: ratio('bounced', 'delivered'),
    complaint_rate: ratio('complained', 'delivered'),
    unsubscribe_rate: ratio('unsubscribed', 'delivered'),
  };
}
