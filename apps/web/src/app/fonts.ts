import localFont from 'next/font/local';

export const sans = localFont({
  src: [
    { path: './fonts/plus-jakarta-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/plus-jakarta-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-sans',
  display: 'swap',
});

export const hero = localFont({
  src: [{ path: './fonts/source-serif-4-latin-600-normal.woff2', weight: '600', style: 'normal' }],
  variable: '--font-hero',
  display: 'swap',
});
