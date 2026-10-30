import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../styles/globals.css';

export const metadata: Metadata = { title: 'DompetKu' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
