const providerNames = /\b(?:Amazon\s+Web\s+Services|Amazon\s+SES|AWS\s+SES|Amazon|AWS|SES|Resend|Migadu|Spacemail)\b/gi;

export function sanitizeCustomerCopy(value: string) {
  return value.replace(providerNames, 'mail service');
}
