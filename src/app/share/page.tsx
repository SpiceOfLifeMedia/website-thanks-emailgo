import type { Metadata } from 'next';
import SharedEmailLoader from '@/components/SharedEmailLoader';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shared email · Email, thanks',
  robots: { index: false, follow: false, noarchive: true },
};

export default function SharedEmail() {
  return <SharedEmailLoader />;
}
