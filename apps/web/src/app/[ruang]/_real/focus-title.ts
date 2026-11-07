/**
 * Pemindah fokus ke judul sesudah perubahan halaman (bukan ke <body>), dipakai Detail dan riwayat
 * dompet.
 */

/** Sesudah halaman dimuat ulang (banner/status berubah): fokus ke judul ber-id. */
export function focusTitle(id: string): void {
  setTimeout(() => {
    const title = document.getElementById(id);
    title?.setAttribute('tabindex', '-1');
    title?.focus();
  }, 0);
}

let pending: ReturnType<typeof setInterval> | null = null;

/**
 * Sesudah pindah halaman: tunggu halaman di `href` termuat (maks 2 detik), lalu fokus ke `h1`-nya.
 * Satu pemantau pada satu waktu (panggilan baru membersihkan yang lama); pemantau ini sengaja
 * hidup di luar komponen karena komponen pemanggil ikut tercabut saat navigasi.
 */
export function focusHeadingAt(href: string): void {
  if (pending !== null) clearInterval(pending);
  const path = new URL(href, window.location.origin).pathname;
  let tries = 0;
  const stop = () => {
    if (pending !== null) clearInterval(pending);
    pending = null;
  };
  pending = setInterval(() => {
    tries += 1;
    const h1 = window.location.pathname === path ? document.querySelector('h1') : null;
    if (h1 instanceof HTMLElement) {
      h1.setAttribute('tabindex', '-1');
      h1.focus();
      stop();
    } else if (tries >= 40) {
      stop();
    }
  }, 50);
}

/**
 * Sesudah perubahan yang memuat ulang halaman (simpan/hapus/salin anggaran): bila fokus jatuh ke
 * `<body>` (pemicunya ikut hilang atau pindah daftar), fokus ke `selector` bila ada, selain itu ke
 * `h1`. Dua percobaan menunggu RSC baru masuk; fokus yang sudah di elemen lain tidak diganggu.
 */
export function restoreFocus(selector: string | null): void {
  const attempt = () => {
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const target =
      (selector === null ? null : document.querySelector<HTMLElement>(selector)) ??
      document.querySelector<HTMLElement>('h1');
    if (target === null) return;
    if (!target.hasAttribute('tabindex') && !(target instanceof HTMLButtonElement)) {
      target.setAttribute('tabindex', '-1');
    }
    target.focus();
  };
  setTimeout(attempt, 300);
  setTimeout(attempt, 900);
}
