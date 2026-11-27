export type DomainWebhookRecord = {
  id: string;
  domain: string;
  created_at: string;
  verified_at: string | null;
  open_tracking?: number | boolean;
  click_tracking?: number | boolean;
};

export function domainWebhookData(domain: DomainWebhookRecord) {
  return {
    id: domain.id,
    name: domain.domain,
    status: domain.verified_at ? 'verified' : 'not_started',
    created_at: domain.created_at,
    ...(domain.open_tracking === undefined ? {} : { open_tracking: Boolean(domain.open_tracking) }),
    ...(domain.click_tracking === undefined ? {} : { click_tracking: Boolean(domain.click_tracking) }),
  };
}
