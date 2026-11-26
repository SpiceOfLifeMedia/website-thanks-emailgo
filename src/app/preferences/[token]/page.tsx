import { PublicPreferences } from '@/components/public-preferences';

export const dynamic = 'force-dynamic';

export default async function PreferencesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicPreferences token={token} />;
}
