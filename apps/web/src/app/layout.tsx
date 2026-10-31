import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../styles/globals.css';
import { DemoProvider } from '@/features/shell/demo-provider';
import { themeBootScript } from '@/features/shell/theme';
import { sans } from './fonts';

export const metadata: Metadata = { title: 'DompetKu' };

export default function RootLayout({ children }: { children: ReactNode }) {
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
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <DemoProvider>{children}</DemoProvider>
      </body>
    </html>
  );
}
