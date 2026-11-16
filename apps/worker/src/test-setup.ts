import { afterEach } from 'vitest';

/**
 * Pagar jaringan suite tes worker (unit dan int): fetch global hanya boleh ke loopback (stub
 * Healthchecks/penyedia lokal). Panggilan ke host lain ditolak dan dicatat, jadi tes yang tanpa
 * sengaja memanggil penyedia sungguhan gagal di CI alih-alih keluar ke internet.
 */
const realFetch = globalThis.fetch;
export const blockedFetches: string[] = [];

globalThis.fetch = (input, init) => {
  const raw = input instanceof Request ? input.url : String(input);
  const host = URL.canParse(raw) ? new URL(raw).hostname : '';
  if (host !== '127.0.0.1' && host !== 'localhost') {
    blockedFetches.push(host);
    return Promise.reject(new Error('fetch_blocked_in_tests'));
  }
  return realFetch(input, init);
};

// Tes yang tanpa sengaja memanggil host luar tidak boleh lolos hijau karena galatnya ditelan (mis. ping
// Healthchecks): suite gagal bila ada fetch terblokir yang tidak diambil oleh tes pagar itu sendiri.
afterEach(() => {
  const unexpected = blockedFetches.splice(0).filter((h) => h !== 'query1.finance.yahoo.com');
  if (unexpected.length > 0) throw new Error(`fetch_blocked_in_tests: ${unexpected.join(',')}`);
});
