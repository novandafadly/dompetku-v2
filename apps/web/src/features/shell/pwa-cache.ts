'use client';

/**
 * Manajemen Service Worker & pembersihan cache klien saat keluar (S18, BSD §11).
 * Menghapus semua cache halaman pengguna (`dompetku-pages-*`), memberi tahu SW aktif,
 * dan membersihkan `sessionStorage` agar perangkat bersama tidak menyimpan sisa halaman akun lama.
 */

export const USER_CACHE_PREFIX = 'dompetku-pages-';

function notifyWorkerClear(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 400);
    try {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        clearTimeout(timer);
        resolve();
      };
      worker.postMessage({ type: 'CLEAR_USER_CACHES' }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

export async function clearClientCaches(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if ('caches' in window) {
      const keys = await window.caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith(USER_CACHE_PREFIX)).map((k) => window.caches.delete(k)),
      );
    }
  } catch {
    // Abaikan galat CacheStorage di mode privat / sandbox ketat.
  }

  try {
    if ('serviceWorker' in navigator) {
      const controller = navigator.serviceWorker.controller;
      if (controller !== null) {
        await notifyWorkerClear(controller);
      } else {
        const reg = await navigator.serviceWorker.getRegistration('/');
        if (reg?.active !== null && reg?.active !== undefined) {
          await notifyWorkerClear(reg.active);
        }
      }
    }
  } catch {
    // Abaikan bila SW belum terpasang.
  }

  try {
    window.sessionStorage.clear();
  } catch {
    // Abaikan bila storage diblokir.
  }
}

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
  } catch {
    // Registrasi SW adalah peningkatan progresif; kegagalan tidak mengganggu aplikasi.
  }
}
