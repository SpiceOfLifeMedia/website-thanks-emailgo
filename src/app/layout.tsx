import type { Metadata, Viewport } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Emailgo · Email delivery API',
  description: 'Send transactional email through the Emailgo API and see every message in one place.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f7f7f3' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-AU"><body>{children}</body></html>;
}
