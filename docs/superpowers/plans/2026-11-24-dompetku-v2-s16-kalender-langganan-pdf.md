# Rencana S16 — Kalender arus kas, deteksi langganan, ekspor PDF (M5)

**Tanggal:** 2026-11-24  
**Cakupan (`IPD.md` §6, `PRD.md` M5):** tiga kemampuan M5 yang menutup gerbang M5 (**T14, T15, K9, B13**):

1. **Kalender arus kas** (`/[ruang]/rencana/kalender`): proyeksi saldo operasional per tanggal WIB (jendela 30 / 60 / 90 hari), sumber tunggal dari saldo operasional dompet aktif + tagihan terbuka + proyeksi tagihan aktif yang belum dimaterialisasi.
2. **Deteksi langganan** (di `Rencana > Tagihan`): saran tagihan rutin dari pola pengeluaran biasa yang berulang, dengan tombol "Jadikan tagihan" (mengisi awal sheet Tagihan) dan "Abaikan".
3. **Ekspor PDF** (`GET /[ruang]/laporan/ekspor-pdf?periode=YYYY-MM&basis=gajian|kalender`): ringkasan, kategori, kelas di luar Laporan, dan daftar transaksi dari sumber SQL yang sama dengan Laporan (`loadLaporan` + `api.export_entries`), tanpa dependensi PDF pihak ketiga (murni TS, PDF 1.4 WinAnsi), escape penuh (**K9**), dan isolasi ruang ketat (**B13**).

## Keputusan desain S16 (default agen; dapat diubah tanpa migrasi destruktif)

| ID | Topik | Pilihan (default) | Alternatif |
| --- | --- | --- | --- |
| **K1** | Sumber proyeksi kalender | Hanya saldo operasional dompet aktif (`app.account_balances`) dikurangi tagihan terbuka (`app.bill_schedule`) + proyeksi tagihan aktif yang belum dimaterialisasi (`least(day_of_month, akhir bulan)`). Pemasukan tidak diproyeksikan (tidak ada jadwal gaji); catatan di atas kalender menjelaskannya. `[konfirmasi pemilik]` | Tambah estimasi pemasukan rutin |
| **K2** | Tagihan lewat jatuh tempo di kalender | Tagihan terbuka dengan `due_on < app.today()` dihitung di hari ini dengan penanda `overdue` dan tanggal jatuh tempo asli agar saldo akhir hari ini konsisten dengan "aman dipakai". `[konfirmasi pemilik]` | Pisah ke bagian terpisah tanpa memotong hari ini |
| **K3** | Jendela hari kalender | Pilihan 30 (bawaan), 60, atau 90 hari WIB (`?hari=30\|60\|90`; fungsi SQL membatasi 1..90). `[konfirmasi pemilik]` | Tetap 30 hari |
| **K4** | Aturan deteksi langganan | Pengeluaran biasa (`report_class = 'expense'`, kaki `main`, bukan Kantor/talangan/transfer) dalam 180 hari terakhir, dikelompokkan per `(app.subscription_key(description), amount)` sama persis, muncul di >= 3 bulan kalender berbeda, transaksi terakhir <= 45 hari lalu; menyaring nama tagihan aktif ruang itu dan daftar `app.subscription_dismissals`. Maks 20 saran. `[konfirmasi pemilik]` | Toleransi selisih nominal ±5% atau >= 2 bulan |
| **K5** | Ruang lingkup abaikan langganan | Per `(space_id, desc_key, amount)` di `app.subscription_dismissals` (RLS ENABLE+FORCE); menaikkan/menurunkan nominal memunculkan saran baru. Tidak ada hapus fisik. `[konfirmasi pemilik]` | Per nama saja tanpa nominal |
| **K6** | Format & mesin ekspor PDF | Penyusun PDF 1.4 murni TS tanpa dependensi eksternal (`server/ledger/pdf.ts`), fon standar Helvetica + Helvetica-Bold (WinAnsi), escape literal `\`, `(`, `)`, tanpa JS/anotasi/tautan/lampiran (**K9**). Satu sumber angka SQL dengan Laporan; berbagi `exportLimiter` (10/jam/user) dengan CSV. `[konfirmasi pemilik]` | Pustaka pihak ketiga (`pdfkit`/`pdf-lib`) |
| **K7** | Audit ekspor PDF | Memperluas `api.export_entries` dengan parameter keempat `p_via text default 'csv'` (`'csv' \| 'pdf'`), mencatat `audit.log('export', ..., { count, via })` tanpa isi/nama/nominal. | Fungsi SQL terpisah |
| **K8** | Status T14, T15, K9 di `REGISTRY.md` | **K9** naik ke `aktif` (CSV + PDF escape teruji). **T14** dan **T15** naik ke `aktif` sesudah semua bagian M5 (tagihan lanjutan tanggal 31, idempotensi/konkurensi occurrence, proyeksi kalender tanggal 31, deteksi langganan) teruji. `[konfirmasi pemilik]` | Menunggu konfirmasi tertulis sebelum naik status |

## Fokus Review (Wajib diperiksa sebelum merge)

1. **Uang selalu di SQL (bigint):** `opening`, `bills_amount`, `closing`, `short` di `api.cashflow_calendar`, total Laporan di PDF, dan nominal deteksi langganan seluruhnya dari SQL; TypeScript hanya memformat (`formatRupiah`) dan mengelompokkan tampilan.
2. **Isolasi ruang & B13:** Semua fungsi `api.*` memanggil `app.assert_member(p_space_id)` lebih dulu; RLS ENABLE+FORCE pada `app.subscription_dismissals`; PDF Bersama dan kalender/langganan Bersama tidak pernah memuat kanari Pribadi.
3. **Keamanan PDF (K9):** Semua string pengguna di-escape (`\`, `(`, `)`), karakter kontrol dibersihkan, tidak ada `/JavaScript`, `/URI`, `/OpenAction`, `/Launch`, `/EmbeddedFile`; header respons `Content-Type: application/pdf`, `Content-Disposition: attachment`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`; berbagi batas laju 10/jam/user (`429`).
4. **Halaman & prototipe:** `/[ruang]/rencana/kalender` dan `/[ruang]/laporan/ekspor-pdf` mengembalikan `404` pada mode prototipe (`isPrototype()`); setiap page/route nyata memanggil `ruangContext()`; budget JS muat dingin <= 162 kB per rute dan mode prototipe tidak berubah.

## Rincian Tugas

- **Task 1 — Rencana & Bingkai Desain:** `docs/superpowers/plans/2026-11-24-dompetku-v2-s16-kalender-langganan-pdf.md` dan `docs/design/s16-bingkai.md`.
- **Task 2 — Migrasi DB `0149_kalender_langganan_pdf.sql` + pgTAP `48_kalender_langganan.sql` + `00_katalog.sql`:**
  - `app.subscription_key`, `app.subscription_dismissals` (RLS ENABLE+FORCE), `api.cashflow_calendar` (dengan rincian `bills jsonb`), `api.detect_subscriptions`, `api.dismiss_subscription`, `api.export_entries(..., p_via default 'csv')`.
  - Uji `migrate:down` ditolak di `env='prod'`, siklus `down` -> `up` di `env='dev'`, seluruh 50 berkas pgTAP lulus.
- **Task 3 — Penyusun PDF murni (`server/ledger/pdf.ts`) + unit test (`pdf.test.ts`):**
  - Escape K9 (`(`, `)`, `\`, karakter kontrol, rumus `=cmd`, `<script>`, WinAnsi, multi-halaman, struktur PDF valid `%PDF-1.4`..`%%EOF`, tanpa tag aksi berbahaya).
- **Task 4 — Server loaders, ekspor PDF, dan route/action:**
  - `server/ledger/kalender.ts` (`loadKalender`, `parseKalenderDays`).
  - `server/ledger/langganan.ts` (`loadLanggananTx`, `dismissSubscription`), integrasi ke `loadRencana` (`subscriptions`).
  - `server/ledger/ekspor.ts` (`exportLaporanPdf` — satu transaksi membaca `loadLaporan`-komponen + `api.export_entries(..., 'pdf')` agar angka ringkasan/kategori/kelas = Laporan = daftar transaksi).
  - `app/[ruang]/laporan/ekspor-pdf/route.ts` + unit test route.
  - `app/[ruang]/_actions/langganan.ts` (`dismissSubscriptionAction`).
  - `features/laporan/href.ts` (`eksporPdfHref`, `eksporPdfFilename`) + `features/rencana/href.ts` atau helper `kalenderHref`.
  - Tes integrasi `server/ledger/__int__/s16.int.test.ts` (paritas angka PDF = Laporan, B13 kanari PDF/kalender/langganan, K9 escape di PDF nyata, abaikan langganan).
- **Task 5 — UI Ekspor PDF, Kalender Arus Kas, dan Saran Langganan + Unit Test:**
  - `ExportButton` di `ekspor-client.tsx` mendukung format CSV dan PDF (atau tombol `Ekspor PDF` di sebelah `Ekspor CSV` di Laporan, pulau malas tetap di `ekspor-islands.tsx`).
  - Halaman `/[ruang]/rencana/kalender` (`page.tsx`, `loading.tsx`, `_real/kalender.tsx`, `features/rencana/kalender-view.tsx`): pemilih jendela 30/60/90 hari (tautan murni tanpa JS tambahan), kartu ringkasan (saldo operasional hari ini, total tagihan dalam jendela, saldo terendah + status "Kurang" bila negatif dengan ikon + teks), daftar hari bertagihan (plus sakelar/tautan semua hari), catatan jujur "Pemasukan belum diproyeksikan". Tautan ke Kalender dari Rencana > Tagihan.
  - Kartu "Saran langganan" di Rencana > Tagihan (`features/rencana/subscription-card.tsx` + pulau malas di `rencana-client.tsx`/`rencana-islands.tsx`): tombol "Jadikan tagihan" (membuka `BillSheet` dengan `prefill`: nama dipotong 60 huruf, nominal, tanggal bulan, kategori & dompet aktif bila ada) dan tombol "Abaikan" (memanggil `dismissSubscriptionAction` + toast).
  - Unit test komponen & helper.
- **Task 6 — E2E (`e2e-ledger/zz-s16.spec.ts`, `e2e-bersama/zz-s16.spec.ts`) + Delivery Gate Visual (`screens-s16.spec.ts`, `docs/design/s16-critique.md`):**
  - Verifikasi `@B13`, `@K9`, `@T14`, `@T15`, 320/390/1280 gelap+terang, axe 0 pelanggaran serius, budget JS <= 162 kB, prototipe tidak berubah.
- **Task 7 — Dokumentasi & Registry + Review Independen + PR & CI hijau:**
  - Perbarui `packages/db/tests/REGISTRY.md`, `BSD.md`, `IPD.md`, `AFD.md`, `DBD.md`, `m0a-keputusan.md`, `docs/superpowers/handoff/s16.md`, `CLAUDE.md`.
  - Review independen (task + keamanan uang/auth/DB), perbaiki temuan Blocker/Penting, buka PR, tunggu CI hijau penuh, merge.
