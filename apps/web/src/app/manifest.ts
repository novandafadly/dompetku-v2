import type { MetadataRoute } from 'next';

/**
 * Manifest PWA (IPD S3). Syarat instal Chrome: name/short_name, start_url, display standalone,
 * ikon 192 dan 512, HTTPS; service worker tidak wajib (Chrome 108+ mobile, 112+ desktop).
 *
 * Ikon: logo "Cincin emas" (docs/design/logo.md). icon.svg, favicon.ico, apple-icon.png ada di
 * src/app; PNG PWA di public/icons. Ganti berkas dengan nama sama bila logo berubah.
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
