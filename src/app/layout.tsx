import type { Metadata, Viewport } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Send, thanks',
  description: 'A friendly workspace for sending and managing email.',
  icons: { icon: '/favicon.svg', apple: '/apple-touch-icon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#F4EEE3' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-AU"><body>{children}</body></html>;
}
