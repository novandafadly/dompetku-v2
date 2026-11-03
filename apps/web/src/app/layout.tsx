import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { todayWIB } from '@dompetku/domain';
import '../styles/globals.css';
import { DemoProvider } from '@/features/shell/demo-provider';
import { NavProvider } from '@/features/shell/nav-provider';
import { themeBootScript } from '@/features/shell/theme';
import { styleNonceBootScript } from '@/lib/security-headers';
import { isPrototype } from '@/server/env';
import { sans } from './fonts';

export const metadata: Metadata = { title: 'DompetKu', applicationName: 'DompetKu' };

export const viewport: Viewport = { themeColor: '#0f1211' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Nonce CSP dari src/proxy.ts; membaca header membuat semua halaman dirender per request.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const prototype = isPrototype();
  return (
    // data-theme ditulis skrip kepala sebelum hidrasi, jadi nilainya boleh berbeda dari HTML server.
    <html
      lang="id"
      data-ruang="pribadi"
      data-theme="dark"
      className={sans.variable}
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: styleNonceBootScript }} />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        {/* Data demo hanya di prototipe; mode nyata tidak pernah memasang DemoProvider. */}
        <NavProvider today={todayWIB()} prototype={prototype}>
          {prototype ? <DemoProvider>{children}</DemoProvider> : children}
        </NavProvider>
      </body>
    </html>
  );
}
