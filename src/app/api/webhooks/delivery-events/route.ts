import { POST as acceptDeliveryNotification } from '../ses/route';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  return acceptDeliveryNotification(request);
}
