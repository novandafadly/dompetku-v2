# Galeri Tangkapan Layar Portofolio (DompetKu v2)

Tangkapan layar di direktori ini dihasilkan secara otomatis oleh generator Playwright [`apps/web/tests/e2e-portfolio/portfolio.spec.ts`](../../../apps/web/tests/e2e-portfolio/portfolio.spec.ts) di atas **data demo 100% fiktif** (**Raka** & **Nadia**, email `*.demo.dompetku.invalid`, saldo dan transaksi fiktif Rupiah). Tidak pernah diambil dari data produksi.

- **Arah visual:** Panel Malam (`DESIGN.md`, ADR 0006)
- **Ukuran:** `390×844` (ponsel) dan `1280×800` (desktop)
- **Tema:** `dark` (Panel Malam) dan `light` (Kertas Hangat)
- **Total:** 10 layar utama × 2 ukuran × 2 tema = **40 PNG**

## Cara menghasilkan ulang

Pastikan PostgreSQL uji lokal sudah dimigrasikan (`dbmate up`) dan build produksi sudah siap (`pnpm build`), lalu jalankan:

```sh
AUTH_E2E_DATABASE_URL="postgres://dompetku_web@127.0.0.1:5432/dompetku?sslmode=disable" \
AUTH_E2E_ADMIN_URL="postgres://postgres@127.0.0.1:5432/dompetku?sslmode=disable" \
pnpm e2e:portfolio
```

Untuk menyimpan ke folder lain tanpa menimpa folder ini, tambahkan `PORTFOLIO_DIR=/tmp/portfolio/`.

## Daftar layar

| #   | Layar                                                          | 390 Gelap                                     | 390 Terang                                      | 1280 Gelap                                      | 1280 Terang                                       |
| --- | -------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| 01  | Beranda Pribadi (aman dipakai, ringkasan, anggaran, tagihan)   | [390 dark](01-beranda-pribadi-390-dark.png)   | [390 light](01-beranda-pribadi-390-light.png)   | [1280 dark](01-beranda-pribadi-1280-dark.png)   | [1280 light](01-beranda-pribadi-1280-light.png)   |
| 02  | Sheet Catat cepat (nominal, chip kategori, ketik cepat)        | [390 dark](02-catat-sheet-390-dark.png)       | [390 light](02-catat-sheet-390-light.png)       | [1280 dark](02-catat-sheet-1280-dark.png)       | [1280 light](02-catat-sheet-1280-light.png)       |
| 03  | Daftar Transaksi & filter segmen                               | [390 dark](03-transaksi-390-dark.png)         | [390 light](03-transaksi-390-light.png)         | [1280 dark](03-transaksi-1280-dark.png)         | [1280 light](03-transaksi-1280-light.png)         |
| 04  | Dompet & Kekayaan Bersih (Kas, Tabungan, Aset, Saham IDX)      | [390 dark](04-dompet-kekayaan-390-dark.png)   | [390 light](04-dompet-kekayaan-390-light.png)   | [1280 dark](04-dompet-kekayaan-1280-dark.png)   | [1280 light](04-dompet-kekayaan-1280-light.png)   |
| 05  | Rencana (Anggaran induk + subkategori, Tagihan, Utang, Tujuan) | [390 dark](05-rencana-anggaran-390-dark.png)  | [390 light](05-rencana-anggaran-390-light.png)  | [1280 dark](05-rencana-anggaran-1280-dark.png)  | [1280 light](05-rencana-anggaran-1280-light.png)  |
| 06  | Kalender Arus Kas 30 hari                                      | [390 dark](06-kalender-arus-kas-390-dark.png) | [390 light](06-kalender-arus-kas-390-light.png) | [1280 dark](06-kalender-arus-kas-1280-dark.png) | [1280 light](06-kalender-arus-kas-1280-light.png) |
| 07  | Laporan Bulanan & Ekspor CSV/PDF                               | [390 dark](07-laporan-390-dark.png)           | [390 light](07-laporan-390-light.png)           | [1280 dark](07-laporan-1280-dark.png)           | [1280 light](07-laporan-1280-light.png)           |
| 08  | Beranda Ruang Bersama (Feed Aktivitas, Kontribusi, Patungan)   | [390 dark](08-bersama-beranda-390-dark.png)   | [390 light](08-bersama-beranda-390-light.png)   | [1280 dark](08-bersama-beranda-1280-dark.png)   | [1280 light](08-bersama-beranda-1280-light.png)   |
| 09  | Detail Trip & Progres Anggaran                                 | [390 dark](09-trip-detail-390-dark.png)       | [390 light](09-trip-detail-390-light.png)       | [1280 dark](09-trip-detail-1280-dark.png)       | [1280 light](09-trip-detail-1280-light.png)       |
| 10  | Analisis AI (agregat SQL B13 & kuota harian)                   | [390 dark](10-analisis-ai-390-dark.png)       | [390 light](10-analisis-ai-390-light.png)       | [1280 dark](10-analisis-ai-1280-dark.png)       | [1280 light](10-analisis-ai-1280-light.png)       |
