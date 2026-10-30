import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../styles/globals.css';
import { DemoProvider } from '@/features/shell/demo-provider';
import { hero, sans } from './fonts';

export const metadata: Metadata = { title: 'DompetKu' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" data-ruang="pribadi" className={`${sans.variable} ${hero.variable}`}>
      <body>
        <DemoProvider>{children}</DemoProvider>
      </body>
    </html>
  );
}
