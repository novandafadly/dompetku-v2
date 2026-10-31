# ADR 0002: Budget JS muat dingin M0a

Status: diterima (2026-10-30)

## Konteks

`docs/spec/frontend.md` menargetkan JS ≤ 120 kB terkirim pada muat dingin `/pribadi/beranda` dan `/pribadi/transaksi`. Target itu ditulis sebelum stack terpasang (ADR 0001: Next 16.4.3, React 19.3.1, Turbopack).

Pengukuran memakai build standalone produksi yang sama dengan e2e. Ukurannya Σ `encodedBodySize` (gzip, sesuai kiriman server Next) di Chromium Playwright, dengan konteks baru dan cache kosong.

## Pengukuran

### Baseline framework: rute kosong

Pengukuran ini memakai aplikasi Next terpisah di luar repo, dengan versi `next`/`react` yang sama. Isinya hanya `app/layout.tsx` (`<html><body>`) dan `app/page.tsx` (`<p>`), tanpa kode DompetKu. Build-nya `output: 'standalone'`.

| Chunk              | kB (gzip) |
| ------------------ | --------- |
| react-dom          | 70,3      |
| runtime App Router | 48,5      |
| preload            | 5,9       |
| turbopack runtime  | 3,8       |
| lain-lain          | 3,4       |
| **Total**          | **131,9** |

Framework sendirian sudah melampaui 120 kB. Akibatnya, target 120 kB tidak bisa dicapai dengan stack ADR 0001 tanpa kode aplikasi sekalipun.

### DompetKu

| Rute                 | Sebelum Task 12 (semua JS) | Sesudah: JS rute (gerbang tes) | Sesudah: semua JS sampai jaringan diam |
| -------------------- | -------------------------- | ------------------------------ | -------------------------------------- |
| `/pribadi/beranda`   | 193,0                      | 156,8                          | 187,0                                  |
| `/pribadi/transaksi` | 193,0                      | 157,0                          | 187,0                                  |

"Semua JS sampai jaringan diam" mencakup tiga hal:

- JS rute;
- prefetch rute lain oleh `<Link>`;
- preload senggang sheet Catat (sekitar 23 kB), yang sengaja dimuat setelah hidrasi supaya sheet siap saat dibuka.

Pengurangan di Task 12 memindahkan kode yang hanya dipakai saat sesuatu dibuka keluar dari muat awal:

- Sheet Catat (beserta cmdk, keypad, chip), lewat `React.lazy`. Kodenya dimuat saat browser senggang setelah hidrasi, saat pointer atau fokus berada di tombol Catat, atau paling lambat saat sheet dibuka. Selama kode belum tiba, placeholder ringan dengan field Nominal yang nyata menangkap ketikan.
- Sheet Tambah dompet (`next/dynamic`).
- Sheet Menu (Radix Dialog) (`next/dynamic`).
- Tampilan toast (Radix Toast) (`next/dynamic`). Wilayah "Notifikasi (F8)" dan live region pengumumannya tetap terpasang sejak awal.

Ikon Phosphor sudah ter-tree-shake per ikon. Satu ikon tetap membawa enam bobot path, sekitar 0,5 kB gzip per ikon.

## Keputusan

1. **Batas tes = baseline + 30 kB = 162 kB** (`apps/web/tests/e2e/budget.spec.ts`). Ruang 30 kB adalah anggaran kode aplikasi di atas framework.
2. **Cakupan gerbang: hanya JS rute.** Yang dijumlahkan adalah skrip yang dirujuk HTML rute itu sendiri (`<script src>` tanpa `nomodule`, dan `<link … .js>`). Tes gagal bila ada skrip HTML yang tidak punya entri ukuran atau berukuran 0. Yang sengaja tidak dihitung:
   - prefetch rute lain;
   - preload senggang sheet Catat;
   - chunk muat malas.

   Ketiganya tidak menghalangi muat awal atau interaksi pertama. Angka semua JS tetap dicatat sebagai anotasi tes `js-all-kB` (187,0 kB saat ADR ini ditulis).

3. Target 120 kB di `frontend.md` dibaca sebagai "≤ 30 kB kode aplikasi di atas baseline framework" sampai stack berubah.

## Konsekuensi

- Penambahan fitur yang memuat ulang dialog, cmdk, atau toast ke muat awal akan menggagalkan tes.
- Budget ROADMAP M2 (≤ 150 kB) juga di bawah angka sekarang (157 kB rute, 187 kB semua JS). Budget itu perlu diputuskan ulang sebelum M2: naikkan batasnya, atau kurangi kode, misalnya ikon dengan bobot terbatas atau data demo di server. **Keputusan pemilik 2026-10-31:** target 150 kB di M2 dibatalkan; batas tetap 162 kB rute.
