import type { MetadataRoute } from 'next';

/**
 * Manifest PWA (IPD S3). Syarat instal Chrome: name/short_name, start_url, display standalone,
 * ikon 192 dan 512, HTTPS; service worker tidak wajib (Chrome 108+ mobile, 112+ desktop).
 *
 * SEMENTARA: public/icons/*.png dan src/app/icon.svg adalah placeholder (lingkaran lime di
 * latar #0F1211). Ganti dengan berkas pemilik dari docs/design/favicon-prompt.md, nama sama.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'DompetKu',
    short_name: 'DompetKu',
    description: 'Catatan keuangan Pribadi dan Bersama.',
    lang: 'id',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Token --bg tema gelap (bawaan) di src/styles/tokens.css.
    background_color: '#0F1211',
    theme_color: '#0F1211',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
