import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { staticSecurityHeaders } from './src/lib/security-headers';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: root,
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  images: { unoptimized: true },
  transpilePackages: ['@dompetku/domain', '@dompetku/demo-data'],
  // CSP bernonce dipasang src/proxy.ts per request; di sini header yang sama untuk semua respons.
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: [...staticSecurityHeaders] }]);
  },
};

export default config;
