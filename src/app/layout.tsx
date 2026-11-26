import type { Metadata, Viewport } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Send, thanks · Email delivery',
  description: 'A thoughtful email sending workspace for the Website Thanks team.',
  icons: { icon: '/favicon.svg', apple: '/apple-touch-icon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#F4EEE3' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-AU"><body>{children}</body></html>;
}
