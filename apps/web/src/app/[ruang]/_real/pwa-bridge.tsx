import 'server-only';
import { headers } from 'next/headers';
import { CloudSlashIcon } from '@/components/ui/icons/cloud-slash';

/**
 * Skrip kecil bernonce CSP (pola `themeBootScript` di `app/layout.tsx`) untuk:
 * 1. mendaftarkan Service Worker `/sw.js` di mode nyata;
 * 2. menyinkronkan visibilitas banner offline (`#dk-offline`) terhadap `navigator.onLine`.
 *
 * Dibuat sebagai Server Component tanpa `'use client'` agar:
 * - menambah 0 byte ke bundle JS klien (anggaran 162 kB ADR 0002 aman di semua rute);
 * - banner offline langsung tampil pada halaman cache offline bahkan sebelum hidrasi React.
 */
const PWA_BOOT_SCRIPT = `(function(){try{if('serviceWorker'in navigator&&window.isSecureContext){navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(function(){});}var s=function(){var e=document.getElementById('dk-offline');if(e)e.hidden=navigator.onLine;};s();window.addEventListener('online',s);window.addEventListener('offline',s);}catch(e){}})();`;

export async function PwaBridge() {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <>
      <div
        id="dk-offline"
        role="status"
        aria-live="polite"
        hidden
        suppressHydrationWarning
        className="mb-3 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-meta font-semibold text-text-soft laptop:max-w-180"
      >
        <p className="flex items-center gap-2">
          <CloudSlashIcon size={16} className="shrink-0 text-warning" />
          <span>Sedang offline · Mode baca saja. Catatan baru tersimpan setelah online lagi.</span>
        </p>
      </div>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: PWA_BOOT_SCRIPT }} />
    </>
  );
}
