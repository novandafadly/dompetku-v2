import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../styles/globals.css';
import { hero, sans } from './fonts';

export const metadata: Metadata = { title: 'DompetKu' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="id"
      data-ruang="pribadi"
      data-theme="light"
      className={`${sans.variable} ${hero.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
