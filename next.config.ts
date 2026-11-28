import type { NextConfig } from 'next';
const sharePageHeaders = [
  { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
];
const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: 'standalone',
  async headers() {
    return [
      { source: '/share', headers: sharePageHeaders },
      { source: '/share/:path*', headers: sharePageHeaders },
    ];
  },
};
export default nextConfig;
