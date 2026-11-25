import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Mailroom · Website Thanks',
  description: 'A clear place to review and resend Website Thanks emails.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-AU"><body>{children}</body></html>;
}
