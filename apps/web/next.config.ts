import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: root,
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  images: { unoptimized: true },
  transpilePackages: ['@dompetku/domain'],
};

export default config;
