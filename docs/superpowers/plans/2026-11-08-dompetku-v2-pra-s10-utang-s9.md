# DompetKu v2 · Pra-S10 (Penyelesaian Utang S7–S9, Critique Minor, & Web Vitals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyelesaikan seluruh pekerjaan yang belum tuntas dari S7, S8, dan S9 sebelum memulai fitur inti S10 (ekspor CSV, review bulanan & salin anggaran dengan penyesuaian, anggaran subkategori): (1) Plan S9 Task 14 (riwayat dompet dengan biaya transfer/antar ruang sehingga Σ efek baris = perubahan saldo dompet, pemetaan `DK401` + loader `not_found` → 404 saat keanggotaan dicabut di tengah request, rapihan salinan & komponen, critique minor S8, dan deduplikasi fixture tes + pemeriksa registry), (2) Plan S9 Task 16 (pengukuran Web Vitals mode nyata dengan CPU 4× throttle + jaringan setara Fast 3G lewat CDP di Playwright), dan (3) sisa review akhir, keamanan rendah (`0122` batas `p_through` di `jobs.materialize_bills` & urutan `assert_member` sebelum `idem_begin`, `purls` di `.trivyignore.yaml`), serta critique minor S9 (`S9-C3`, `S9-C4`, `S9-C5`, `S9-C6`, `S9-C10`). Sesudah PR pra-S10 ini merge ke `main`, pengerjaan S10 hanya fokus pada fitur baru S10 dan gerbang keluar M2.

**Architecture:** Pola S6 sampai S9: perbaikan skema/fungsi DB lewat migrasi expand-only (`0122_tagihan_batas_idem.sql`) + pgTAP test-first; perbaikan kueri baca dan pemetaan galat di `apps/web/src/server/ledger/*` dengan tes unit dan integrasi; perbaikan tampilan presentasional di Server Component / View tanpa menambah byte ke rute prototipe Beranda (saat ini 161,6 kB dari batas 162 kB; penghapusan cabang mati `showObligations={false}` di `SafeToSpendCard` justru menghemat byte); serta spec Playwright baru `vitals.spec.ts` di atas build produksi standalone. **Semua angka uang tetap dihitung atau diturunkan dari kolom SQL** (`BSD.md` §1.1); khusus efek baris terhadap satu dompet di `effectOnAccountVM`, nilai `amount` dan `fee` yang keduanya berasal dari `app.entry_lines` digabungkan untuk menampilkan perubahan saldo dompet pada baris keluar (`-(amount + fee)`).

**Tech Stack:** Tanpa dependensi baru. Next.js 16.4.3, React 19.3, `pg` 8.23.1, Zod 4.6.7, Postgres 17.11 + dbmate 2.36.0 + pgTAP, Vitest, Playwright 1.64.1 + CDP (`Emulation.setCPUThrottlingRate`, `Network.emulateNetworkConditions`, `PerformanceObserver`).

**Spec:** `docs/superpowers/plans/2026-11-05-dompetku-v2-s9-anggaran-laporan.md` (Task 14 & Task 16); `docs/superpowers/handoff/s9.md` ("Review akhir dan keamanan", "Critique dan Delivery Gate", "Dibawa ke S10"); `docs/superpowers/handoff/s8.md` ("Dibawa ke S9 dan sesudahnya"); `docs/design/s9-bingkai.md` (`S9-C3`, `S9-C4`, `S9-C5`, `S9-C6`, `S9-C10`); `docs/design/s8-bingkai.md` (`S8-D1a`, critique minor S8); `docs/product/IPD.md` §5 S9 (kriteria keluar Web Vitals); `docs/product/BSD.md` §1.1, §8, §9, §10, §12, §16.

## Status awal (diperiksa dari repo, 2026-11-08, `main` `fd63950` sesudah PR #26)

| Bagian | Kondisi saat ini di `main` (`fd63950`) | Diselesaikan di Pra-S10 |
| --- | --- | --- |
| Riwayat dompet & biaya transfer (Task 14 Step 1) | `ENTRY_COLUMNS` di `apps/web/src/server/ledger/read.ts:142` hanya memuat `fee` untuk `e.kind = 'space_transfer' and e.direction = 'out'`; transfer dalam ruang (`e.kind = 'transfer'`) selalu `fee = null`. `effectOnAccountVM` di `apps/web/src/features/ledger/present.ts:75` mengembalikan `-e.amount` tanpa mengurangi `e.fee` pada dompet sumber, dan baris di `/[ruang]/dompet/[id]` tidak menampilkan keterangan `Biaya Rp …` (`S8-D1a`). Akibatnya Σ efek baris di riwayat dompet tidak sama dengan perubahan saldo dompet saat ada biaya transfer/Kas Kantor | Task 1 |
| Pemetaan `DK401` & loader `not_found` → 404 (Task 14 Step 2) | `apps/web/src/server/ledger/errors.ts:118` belum memetakan SQLSTATE `DK401` (`unauthenticated`), sehingga jatuh ke `unknown`. Semua `apps/web/src/app/[ruang]/**/page.tsx` menangkap galat loader dan merender `<*Failed />` (HTTP 200) alih-alih memanggil `notFound()` (HTTP 404) bila keanggotaan ruang dicabut di tengah request (`DK404` `space_not_found` atau `DK401`). Di `apps/web/src/server/ledger/guarded.ts:8`, `RETHROW` melempar ulang semua `DK404` dari dalam savepoint kartu Beranda, belum membedakan `space_not_found` dari `DK404` level item | Task 2 |
| Kueri duplikat `hasBills` di Beranda & cabang mati `SafeToSpendCard` (Review akhir S9) | `hasObligationsTx` (`beranda.ts:114`) dan `billsCardTx` (`beranda.ts:125`) menjalankan `select exists (select 1 from app.bills b where b.space_id = $1 and b.archived_at is null)` dua kali dalam transaksi `loadBeranda` yang sama. `SafeToSpendCard` (`safe-to-spend-view.tsx:16`) masih menyimpan prop `showObligations` yang cabangnya (`false`) hanya dipakai `apps/web/src/app/dev/ui/beranda-frames.tsx:76`, sedangkan Beranda nyata sudah memakai `AmanCardView` | Task 2 & Task 3 |
| Salinan & label komponen (Task 14 Step 3) | `OnboardingChecklistView` (`onboarding-checklist-view.tsx:106`) memakai default `partnerName = 'Farida'`. `EntryDetailView` (`entry-detail-view.tsx:153-158`) menampilkan dua baris terpisah `Catatan` (`sharedNote`) dan `Keterangan` (`description`). `DetailReal` (`_real/detail.tsx:177`) mengirim `'kamu'` huruf kecil ke `Dicatat oleh`, sedangkan baris daftar menampilkan `'Kamu'` | Task 3 |
| Critique S9 minor & S8 minor (Task 14 Step 4 + Handoff S9) | `S9-C3` perataan kolom kanan baris Tagihan & nominal `Dilewati`; `S9-C4` nama anggaran panjang terpotong di tengah kata pada 320 px; `S9-C5` pemisahan nama–nominal kategori dan titik tengah menggantung di Laporan 320 px; `S9-C6` grafik tren & tombol `Catat` ganda pada Laporan periode kosong lampau (`Jan 2020`); `S9-C10` keseimbangan tinggi kolom kiri–kanan Beranda laptop 1280 px; critique S8 minor: `TxRow` elipsis tengah kata di 320 px (`rows.tsx:148`) dan tepi kanan kartu Kontribusi di HP | Task 4 |
| Keamanan rendah DB & CI (Review keamanan S9) | `jobs.materialize_bills(p_through)` (`0118_tagihan_api.sql:145`) meneruskan `p_through` tanpa batas atas (input tanggal jauh di masa depan memicu deret `generate_series` besar). `api.create_bill` (`0118:213`) dan `api.post_bill_occurrence` (`0118:335`) memanggil `private.idem_begin` sebelum `app.assert_member` / `private.lock_occurrence`. `.trivyignore.yaml` mengabaikan `CVE-2026-22184` tanpa filter `purls` `pkg:deb/debian/zlib1g` | Task 5 |
| Rapihan tes, registry, & screenshot (Task 14 Step 5 + Handoff S9) | `PASSWORD`, `registerOwner`, dan `adminQuery`/`adminRows` terduplikasi di `tests/e2e-ledger/fixtures.ts` dan `tests/e2e-bersama/fixtures.ts`. Konteks browser terakhir di `tests/e2e-bersama/screens-s8.spec.ts:116` belum dibungkus `try/finally`. Tag Playwright huruf kecil berpola ID registry (mis. `@b20`) di `scripts/check-test-registry.ts:80` diabaikan diam-diam. Screenshot Laporan Bersama dengan Kontribusi 2 anggota belum diambil | Task 6 |
| Pengukuran Web Vitals (Task 16 S9) | Belum ada `apps/web/tests/e2e-ledger/vitals.spec.ts` untuk mengukur LCP < 2,5 dtk, INP < 200 mdtk, CLS < 0,1 pada `/[ruang]/{beranda,rencana,laporan,transaksi}` dengan CPU 4× throttle + jaringan Fast 3G | Task 7 |

**Angka baseline (`main` `fd63950`):** pgTAP 1726 asersi di 27 berkas, unit web 2272, worker unit 35 + int 10, domain 97 + 28 + 28, demo-data 40, `test:registry` 7, `test:int` 192, e2e prototipe 308, `e2e:auth` 22, `e2e:ledger` 95 (+25 screenshot), `e2e:bersama` 33, `deploy-test.sh` 25. **Budget JS (js-route, batas 162 kB):** Beranda prototipe **161,6 kB** / nyata 157,8 kB; Transaksi 160,9 / 157,1; Rencana 154,1 / 158,3; Laporan — / 153,0; Detail 157,6 / 153,9; Aktivitas 155,1 / 151,3. Headroom prototipe Beranda **0,4 kB**.

## Keputusan pemilik yang dibutuhkan (rekomendasi agen = default plan ini)

| # | Keputusan | Rekomendasi | Alasan | Bila pemilik memilih lain |
| --- | --- | --- | --- | --- |
| K1 | Label `Catatan` (`sharedNote`) vs `Keterangan` (`description`) di `EntryDetailView` (Task 14 Step 3) | **Satukan label menjadi `Catatan` bila hanya satu yang ada; bila entri pemindahan ruang di Pribadi memiliki keduanya (`sharedNote` untuk Bersama dan `description` pribadi) yang berbeda, tampilkan `Catatan Bersama` dan `Catatan pribadi`** (bila isinya sama, tampilkan satu baris `Catatan`) | Di formulir Catat dan sheet pemindahan ruang, pengguna mengenalnya sebagai catatan; menampilkan "Catatan" dan "Keterangan" berdampingan membingungkan bedanya | Tetap dua label tetapi diperjelas: `Catatan Bersama` dan `Keterangan` |
| K2 | Salinan bawaan `partnerName` di `OnboardingChecklistView` (Task 14 Step 3) | **Default parameter `'Farida'` dihapus dari `OnboardingChecklistView`; bila `partnerName` kosong/tidak dikirim, langkah 3 menampilkan `'Undang pasangan ke ruang Bersama'`** (`onboarding.tsx` prototipe tetap mengirim `partnerName="Farida"` secara eksplisit; Beranda nyata tidak merender checklist ini karena memakai `OnboardingBanner`) | Menghilangkan nama hardcoded dari komponen presentasional bersama dan menghemat beberapa byte di bundel | Hapus prop `partnerName` seluruhnya dan selalu tampilkan `'Undang pasangan ke ruang Bersama'` |
| K3 | Laporan periode lampau kosong (`S9-C6`, mis. `Jan 2020`) | **Sembunyikan kartu grafik `Arus kas 6 periode` bila periode yang sedang dilihat berada di luar jendela 6 periode tren (`!data.trend.some((t) => t.isCurrent)`), dan ubah aksi keadaan kosong dari tombol `Catat transaksi` menjadi tautan sekunder `Ke periode ini` bila yang dilihat bukan periode berjalan** (pada periode berjalan yang masih kosong, tombol `Catat transaksi` tetap tampil) | Menjawab langsung kedua poin `S9-C6`: grafik 6 periode terakhir (Mei–Okt 2026) menyesatkan saat judul halaman adalah `Januari 2020`, dan mencatat transaksi ke `Jan 2020` tetap akan ditolak batas 14 hari (`date_too_old`) | Tetap tampilkan grafik tren di semua periode dengan judul diubah menjadi `Arus kas 6 periode terakhir` |
| K4 | Mode gerbang `vitals.spec.ts` di CI vs lokal (Task 16 S9) | **Tetap mengikuti Plan S9 Task 16:** di lokal (`!process.env.CI`) asersi wajib lulus (`LCP < 2500`, `INP < 200`, `CLS < 0.1` dari median 3 muat); di runner CI bersama (`process.env.CI`) dicatat sebagai `test.info().annotations` + `::notice`/`::warning` tanpa menggagalkan job bila runner sedang lambat, sambil tetap menguji bahwa metrik terukur (bukan `NaN`/kosong) | Runner GitHub Actions berbagi CPU virtual dengan jitter tinggi saat di-throttle 4× via CDP; bukti lokal dicatat di dokumen handoff dan `IPD.md` | Blokir CI dengan ambang longgar di CI (mis. 1,5× ambang lokal: LCP < 3750 mdtk, INP < 300 mdtk, CLS < 0,1) |

## Global Constraints

- **Semua Global Constraints rencana S6–S9 tetap mengikat:** aturan M1 (`requireDataUser()` + `withUser`/`withLedger`), kontrak `api.*`, semua aritmetika uang di SQL (`BSD.md` §1.1), migrasi expand-only dengan penjaga `migrate_down_blocked_prod` dan `select private.own_api_functions();`, tanpa nominal di pesan galat/log, serta isolasi penuh Pribadi vs Bersama.
- **Cabang kerja:** `claude/m2-pra-s10-utang-s9` dari `main` (`fd63950`). Commit kecil berbahasa Indonesia dengan Conventional Commits dan trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Aturan budget JS (R28 S7):** Beranda prototipe saat ini **161,6 kB** (batas 162,0 kB). Setiap perubahan pada komponen bersama (`SafeToSpendCard`, `OnboardingChecklistView`, `TxRow`) wajib diverifikasi dengan `pnpm --filter @dompetku/web e2e -- tests/e2e/budget.spec.ts` agar Beranda prototipe ≤ 161,6 kB (target turun menjadi ~161,4 kB setelah membersihkan cabang mati `SafeToSpendCard`).
- **PowerShell di Windows:** Saat menjalankan perintah terminal yang menyentuh path dengan `[ruang]` atau `[id]`, selalu gunakan `-LiteralPath` atau tanda kutip tunggal agar tidak ditafsirkan sebagai wildcard.

## Review Focus

1. **Invarian saldo riwayat dompet (`/dompet/[id]`):** Untuk dompet sumber pada transfer dalam ruang (`kind = 'transfer'`) dan pemindahan keluar antar ruang (`kind = 'space_transfer'`, `direction = 'out'`) yang memiliki biaya (`fee > 0`), `effectOnAccountVM(entry, accountId)` harus menghasilkan `-(entry.amount + entry.fee)` dan baris menampilkan catatan `Biaya Rp …`. Pada dompet tujuan (`toAccountId === accountId` atau `direction = 'in'`), efek tetap `+entry.amount` tanpa biaya (biaya ditanggung dompet pengirim sesuai `0103_ledger_api.sql:211` dan `0111_pindah_ruang.sql`). Jumlah seluruh efek baris + saldo awal dompet = `current_balance` dompet di SQL.
2. **Keamanan & ketepatan 404 saat kehilangan keanggotaan:** Bila pengguna kehilangan akses ruang setelah `ruangContext` tetapi sebelum transaksi loader selesai, `withLedger` melempar `DK404` dengan `message = 'space_not_found'` (dari `app.assert_member`) atau `DK401` (`unauthenticated` dari `private.require_user`). Loader/page harus memanggil `notFound()` (HTTP 404), **bukan** merender `<*Failed />`. Sebaliknya, `DK404` level item di dalam savepoint kartu Beranda (jika ada) tidak boleh meruntuhkan seluruh halaman Beranda menjadi 404 kecuali pesan galatnya adalah `'space_not_found'`.
3. **Batas `jobs.materialize_bills(p_through)` dan urutan `assert_member`:** Di migrasi `0122`, `p_through` dibatasi maksimum `app.today() + 400` di `private.materialize_bill` / `jobs.materialize_bills` agar pemanggilan dengan tanggal ekstrem (mis. tahun `2999-12-31`) tidak membuat puluhan ribu baris. Di `api.create_bill`, `app.assert_member(p_space_id)` dipanggil sebelum `private.idem_begin` (sama seperti `api.create_entry` di `0103_ledger_api.sql:92`), sehingga non-anggota langsung mendapat `DK404 space_not_found` tanpa menulis baris ke `app.idempotency_keys`. Di `api.post_bill_occurrence`, keanggotaan ruang kemunculan diperiksa sebelum `private.idem_begin`.
4. **Keterbacaan 320 px tanpa geser horizontal (`scrollWidth <= 320`):** Perbaikan `S9-C3`, `S9-C4`, `S9-C5`, dan `TxRow` diuji pada lebar 320 px (terang & gelap) tanpa menghasilkan scroll horizontal maupun potongan kata yang menghilangkan konteks.

---

## Peta berkas

| Area | Berkas |
| --- | --- |
| DB | `packages/db/migrations/0122_tagihan_batas_idem.sql` (baru); `packages/db/tests/22_tagihan.sql`, `packages/db/README.md` |
| Server ledger | `apps/web/src/server/ledger/{read.ts,errors.ts,guarded.ts,beranda.ts}`, `apps/web/src/server/ledger/{errors,guarded}.test.ts`, `apps/web/src/server/ledger/__int__/{dompet,beranda,rencana,laporan}.int.test.ts` |
| Page `[ruang]` | `apps/web/src/app/[ruang]/{beranda,transaksi,transaksi/[id],dompet,dompet/[id],kategori,sampah,aktivitas,rencana,laporan}/page.tsx`, `apps/web/src/app/[ruang]/_real/{dompet-detail,detail,beranda,laporan,rencana}.tsx` |
| Fitur & UI | `apps/web/src/features/ledger/{present.ts,present.test.ts}`, `apps/web/src/features/dompet/account-history-view.tsx`, `apps/web/src/features/beranda/{safe-to-spend-view.tsx,onboarding-checklist-view.tsx}`, `apps/web/src/features/transaksi/entry-detail-view.tsx`, `apps/web/src/features/rencana/{bill-row-view.tsx,budget-row-view.tsx}`, `apps/web/src/features/laporan/{category-chart-view.tsx,copy.ts}`, `apps/web/src/components/ui/rows.tsx`, `apps/web/src/app/dev/ui/beranda-frames.tsx` |
| Skrip & CI | `scripts/check-test-registry.ts`, `scripts/check-test-registry.test.ts`, `.trivyignore.yaml`, `.github/workflows/ci.yml` |
| E2E & Fixtures | `apps/web/tests/e2e-auth/helpers.ts`, `apps/web/tests/e2e-ledger/{fixtures.ts,vitals.spec.ts,s9-keluar.spec.ts,screens-s9.spec.ts,screens-s9-tagihan.spec.ts}`, `apps/web/tests/e2e-bersama/{fixtures.ts,screens-s8.spec.ts,screens-s9-bersama.spec.ts}`, `apps/web/playwright.ledger.config.ts` |
| Dokumen | `docs/design/s9-bingkai.md`, `docs/product/{BSD.md,IPD.md}`, `docs/superpowers/handoff/s9.md` |

---

### Task 1: Riwayat dompet dengan biaya transfer & pemindahan ruang (Plan S9 Task 14 Step 1)

**Files:**
- Modify `apps/web/src/server/ledger/read.ts`
- Modify `apps/web/src/features/ledger/present.ts`
- Modify `apps/web/src/features/dompet/account-history-view.tsx`
- Modify `apps/web/src/app/[ruang]/_real/dompet-detail.tsx`
- Modify `apps/web/src/features/ledger/present.test.ts`
- Modify `apps/web/src/server/ledger/__int__/dompet.int.test.ts`

**Interfaces:**
- `ENTRY_COLUMNS` di `apps/web/src/server/ledger/read.ts:142`: muat kolom `fee` dari `app.entry_lines` (`role = 'fee'`) untuk `e.kind = 'transfer'` **dan** `(e.kind = 'space_transfer' and e.direction = 'out')`.
- `effectOnAccountVM(e: EntryVM, accountId: string): number` di `apps/web/src/features/ledger/present.ts:75`:
  - `expense`: `-(e.amount + (e.fee ?? 0))` (tetap).
  - `income`: `e.amount` (tetap).
  - `transfer`: bila `e.accountId === accountId` (dompet pengirim), kembalikan `-(e.amount + (e.fee ?? 0))`; bila dompet penerima (`e.toAccountId === accountId`), kembalikan `e.amount`.
  - `space_transfer`: bila `e.direction === 'out'`, kembalikan `-(e.amount + (e.fee ?? 0))`; bila `'in'`, kembalikan `e.amount`.
- `AccountHistoryRow` di `apps/web/src/features/dompet/account-history-view.tsx` dan `toRow` di `apps/web/src/app/[ruang]/_real/dompet-detail.tsx`: tambahkan `note?: string` (dari `feeNoteVM(e)` saat baris adalah sisi pembayar biaya: `expense`, `transfer` keluar pada `e.accountId === accountId`, atau `space_transfer` keluar) dan teruskan ke `<TxRow note={row.note} ... />` (pola `S8-D1a`: menampilkan `Biaya Rp …` di bawah subjudul baris).

- [x] **Step 1:** Tulis tes gagal lebih dulu di `apps/web/src/features/ledger/present.test.ts`:
  - Transfer dalam ruang Rp 500.000 dengan biaya Rp 2.500 dari BCA (`acc-1`) ke GoPay (`acc-2`): `effectOnAccountVM(e, 'acc-1') === -502_500`, `effectOnAccountVM(e, 'acc-2') === 500_000`, `feeNoteVM(e) === 'Biaya Rp 2.500'`.
  - Pemindahan ruang keluar (`space_transfer`, `direction: 'out'`) Rp 1.000.000 dengan biaya Rp 6.500: `effectOnAccountVM(e, 'acc-1') === -1_006_500`; sisi masuk (`direction: 'in'`, `fee: null`): `effectOnAccountVM(e, 'acc-2') === 1_000_000`.
  - Pengeluaran Kas Kantor atau talangan dengan `fee`: `effectOnAccountVM(e, 'acc-1') === -(e.amount + e.fee)`.
- [x] **Step 2:** Perbarui `ENTRY_COLUMNS` di `apps/web/src/server/ledger/read.ts`, `effectOnAccountVM` di `apps/web/src/features/ledger/present.ts`, `AccountHistoryRow` di `apps/web/src/features/dompet/account-history-view.tsx`, dan `toRow` di `apps/web/src/app/[ruang]/_real/dompet-detail.tsx` (hanya tampilkan `note: feeNoteVM(e)` pada sisi dompet yang menanggung biaya, yaitu bukan sisi masuk transfer).
- [x] **Step 3:** Tambahkan tes integrasi di `apps/web/src/server/ledger/__int__/dompet.int.test.ts` (Pribadi & Bersama, termasuk transfer dengan biaya, pemindahan ruang dengan biaya, dan pengeluaran Kas Kantor dengan biaya): verifikasi bahwa `opening_balance` + Σ `effectOnAccountVM(row, accountId)` dari `loadDompetRiwayat` sama persis dengan `account.balance` (`current_balance` SQL).
- [x] **Step 4:** Jalankan `pnpm --filter @dompetku/web test` dan `pnpm --filter @dompetku/web test:int -- dompet.int.test.ts`. Commit `fix(web): sertakan biaya transfer dan pindah ruang di riwayat dompet`.

---

### Task 2: Pemetaan `DK401`, loader `not_found` → 404, dan kueri `hasBills` Beranda (Plan S9 Task 14 Step 2 + Review S9)

**Files:**
- Modify `apps/web/src/server/ledger/errors.ts`
- Modify `apps/web/src/server/ledger/errors.test.ts`
- Modify `apps/web/src/server/ledger/guarded.ts`
- Modify `apps/web/src/server/ledger/guarded.test.ts`
- Modify `apps/web/src/server/ledger/beranda.ts`
- Modify `apps/web/src/app/[ruang]/{beranda,transaksi,transaksi/[id],dompet,dompet/[id],kategori,sampah,aktivitas,rencana,laporan}/page.tsx`
- Modify `apps/web/src/server/ledger/__int__/beranda.int.test.ts`

**Interfaces:**
- `mapPgError` di `apps/web/src/server/ledger/errors.ts`:
  - `code === 'DK401'` → `{ code: 'not_found', message: 'Halaman atau data tidak ditemukan.' }` (konsisten dengan aturan B14/M1: ruang tanpa sesi/bukan anggota disamarkan sebagai tidak ditemukan di lapisan ledger).
  - Tambahkan helper `export function isSpaceNotFoundError(err: unknown): boolean` di `errors.ts` yang bernilai `true` bila `err` adalah galat PG dengan `code === 'DK401'` atau (`code === 'DK404'` dan `message === 'space_not_found'`).
  - Tambahkan helper `export function rethrowIfNotFound(err: unknown): void` (atau panggil `unstable_rethrow(err); if (isSpaceNotFoundError(err)) notFound();`) untuk dipakai seragam di blok `catch` semua `apps/web/src/app/[ruang]/**/page.tsx`.
- `guarded` di `apps/web/src/server/ledger/guarded.ts`:
  - Ubah pengecekan rethrow dari `RETHROW.has(code)` menjadi hanya melempar ulang `40001`, `40P01`, `DK401`, atau (`DK404` dengan `message === 'space_not_found'`), sehingga `DK404` level item di dalam savepoint kartu Beranda tetap ditangkap sebagai `{ ok: false }` pada kartu tersebut, sementara kehilangan keanggotaan ruang (`space_not_found` / `DK401`) dilempar keluar ke `beranda/page.tsx` dan menjadi `notFound()` (404).
- `loadBeranda` di `apps/web/src/server/ledger/beranda.ts`:
  - Jalankan kueri `hasActiveBillsTx(tx, spaceId)` sekali di transaksi `loadBeranda`, lalu teruskan hasilnya (`hasBills: boolean`) ke `hasObligationsTx` dan `billsCardTx` sehingga tidak ada lagi kueri `exists (select 1 from app.bills ...)` duplikat.

- [x] **Step 1:** Tulis tes unit di `apps/web/src/server/ledger/errors.test.ts` (`DK401` dipetakan ke `not_found`, `isSpaceNotFoundError` membedakan `DK404 space_not_found` dari `DK404 entry_not_found`) dan di `apps/web/src/server/ledger/guarded.test.ts` (`DK404 space_not_found` dan `DK401` dilempar ulang dari `guarded`; `DK404 bill_not_found` ditangkap sebagai `{ ok: false }`).
- [x] **Step 2:** Implementasikan perubahan di `errors.ts`, `guarded.ts`, `beranda.ts`, dan ke-10 berkas `apps/web/src/app/[ruang]/**/page.tsx`.
- [x] **Step 3:** Tambahkan tes integrasi di `apps/web/src/server/ledger/__int__/beranda.int.test.ts`: cabut keanggotaan pasangan di tengah alur / panggil `loadBeranda` sebagai pengguna non-anggota → melempar galat yang dikenali `isSpaceNotFoundError(err) === true`.
- [x] **Step 4:** Jalankan `pnpm --filter @dompetku/web test` dan `pnpm --filter @dompetku/web test:int -- beranda.int.test.ts`. Commit `fix(web): petakan DK401 dan arahkan kehilangan akses ruang di loader ke 404`.

---

### Task 3: Rapihan salinan & komponen (`OnboardingChecklistView`, `EntryDetailView`, `DetailReal`, `SafeToSpendCard`) (Plan S9 Task 14 Step 3 + Review S9)

**Files:**
- Modify `apps/web/src/features/beranda/onboarding-checklist-view.tsx`
- Modify `apps/web/src/features/beranda/onboarding.tsx`
- Modify `apps/web/src/features/transaksi/entry-detail-view.tsx`
- Modify `apps/web/src/app/[ruang]/_real/detail.tsx`
- Modify `apps/web/src/features/beranda/safe-to-spend-view.tsx`
- Modify `apps/web/src/app/dev/ui/beranda-frames.tsx`
- Modify tes unit terkait (`entry-detail-view.test.tsx`, `safe-to-spend-view.test.tsx`, `onboarding-checklist-view.test.tsx` bila ada)

**Interfaces:**
- `OnboardingChecklistView` (`apps/web/src/features/beranda/onboarding-checklist-view.tsx:106`): hapus default `partnerName = 'Farida'`; bila `partnerName` diberikan dan tidak kosong tampilkan `Undang ${partnerName} ke ruang Bersama`, bila kosong tampilkan `Undang pasangan ke ruang Bersama`. Pastikan pemanggil prototipe di `apps/web/src/features/beranda/onboarding.tsx` tetap meneruskan `partnerName="Farida"`.
- `EntryDetailView` (`apps/web/src/features/transaksi/entry-detail-view.tsx:153-158`, K1):
  - Bila `entry.sharedNote` dan `entry.description` keduanya ada dan berbeda: tampilkan `Catatan Bersama` (`entry.sharedNote`) dan `Catatan pribadi` (`entry.description`).
  - Bila hanya salah satu yang ada (atau keduanya sama): tampilkan satu baris berlabel `Catatan`.
- `DetailReal` (`apps/web/src/app/[ruang]/_real/detail.tsx:177`): ubah `'kamu'` menjadi `'Kamu'` pada `creatorName` agar konsisten dengan daftar Transaksi dan Aktivitas (`Dicatat oleh` → `Kamu`).
- `SafeToSpendCard` (`apps/web/src/features/beranda/safe-to-spend-view.tsx`) & `apps/web/src/app/dev/ui/beranda-frames.tsx`:
  - Ganti penggunaan `<SafeToSpendCard ... showObligations={false} />` di `beranda-frames.tsx` dengan `<AmanCardView ... />` (komponen nyata S9 yang sesungguhnya).
  - Hapus prop `showObligations` dan cabang mati `!showObligations` dari `SafeToSpendCard` sehingga `SafeToSpendCard` murni untuk mode prototipe dan ukuran bundel Beranda prototipe berkurang.

- [x] **Step 1:** Perbarui tes unit untuk `EntryDetailView`, `SafeToSpendCard`, dan `OnboardingChecklistView`.
- [x] **Step 2:** Terapkan perubahan di ke-6 berkas komponen.
- [x] **Step 3:** Jalankan `pnpm --filter @dompetku/web test` dan verifikasi ukuran bundel dengan `pnpm build` + `pnpm --filter @dompetku/web e2e -- tests/e2e/budget.spec.ts` (pastikan `js-route-kB` Beranda prototipe ≤ 161,6 kB). Commit `refactor(web): rapikan label catatan detail, checklist onboarding, dan SafeToSpendCard`.

---

### Task 4: Perbaikan Critique Minor S9 (`S9-C3`, `S9-C4`, `S9-C5`, `S9-C6`, `S9-C10`) & S8 Minor

**Files:**
- Modify `apps/web/src/features/rencana/bill-row-view.tsx`
- Modify `apps/web/src/app/[ruang]/_real/rencana.tsx`
- Modify `apps/web/src/features/rencana/budget-row-view.tsx`
- Modify `apps/web/src/features/laporan/category-chart-view.tsx`
- Modify `apps/web/src/features/laporan/copy.ts`
- Modify `apps/web/src/app/[ruang]/_real/laporan.tsx`
- Modify `apps/web/src/app/[ruang]/_real/beranda.tsx`
- Modify `apps/web/src/components/ui/rows.tsx`
- Modify `apps/web/src/features/beranda/contributions-card-view.tsx` (bila perlu untuk tepi kanan di HP)
- Modify tes unit komponen terkait (`bill-row-view.test.tsx`, `budget-row-view.test.tsx`, `category-chart-view.test.tsx`, `laporan.test.tsx`)

**Interfaces & Perilaku:**
- **`S9-C3` (Baris Tagihan di Rencana — perataan kolom kanan & nominal `Dilewati`):**
  - Di `apps/web/src/features/rencana/bill-row-view.tsx` dan `apps/web/src/app/[ruang]/_real/rencana.tsx`:
    - Untuk kemunculan berstatus `Dilewati` (`occ?.skipped`), masukkan nominal ke sub-baris (`Dilewati · Rp 55.000`) dan di kolom kanan hanya tampilkan tombol `Batalkan lewati` (tanpa menumpuk nominal di atas tombol).
    - Untuk baris lain, sejajarkan tepi atas kolom kanan (`items-start pt-3`) dengan baris pertama judul tagihan agar nominal dan aksi `Bayar` tidak melayang di tengah saat judul membungkus 2 baris.
- **`S9-C4` (Nama anggaran panjang di 320 px):**
  - Di `BudgetItemView` (`apps/web/src/features/rencana/budget-row-view.tsx:100`): ganti `truncate` pada nama kategori anggaran dengan ` min-w-0 break-words leading-snug` (maksimum 2 baris / bungkus kata utuh), sementara lencana `Wajib` dan lencana status (`Lewat batas` / `Hampir habis`) tetap `shrink-0 whitespace-nowrap`. Baris kepala memakai `items-start`.
- **`S9-C5` (Laporan 320 px — perataan nama–nominal kategori & titik tengah `BudgetLine`):**
  - Di `CategoryRow` (`apps/web/src/features/laporan/category-chart-view.tsx:96`): gunakan `flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5` tanpa memaksa nama pendek turun baris; nominal (`tabular-nums shrink-0`) tetap di kanan pada satu baris dan hanya turun ke baris kedua bila nama kategori panjang.
  - Di `BudgetLine` (`category-chart-view.tsx:66`): pisahkan segmen dengan elemen `flex flex-wrap items-center gap-x-1.5` dan gunakan pemisah `·` di dalam span pasangan kedua (`· sisa Rp …`) atau sembunyikan titik tengah saat membungkus agar tidak ada `·` menggantung di ujung kanan baris pertama pada 320 px.
- **`S9-C6` (Laporan periode kosong di luar jendela tren, K3):**
  - Di `LaporanReal` (`apps/web/src/app/[ruang]/_real/laporan.tsx:151`):
    - Tampilkan `TrendChartView` hanya bila periode yang sedang dilihat berada di dalam jendela tren (`const inTrendWindow = data.trend.some((t) => t.isCurrent);` → `{!allZero && inTrendWindow ? <TrendChartView ... /> : null}`).
    - Pada `EmptyState` saat `!hasActivity`: bila yang dilihat adalah periode berjalan (`data.period.isCurrent`), tampilkan tombol `Catat transaksi`; bila yang dilihat adalah periode lain (mis. `Jan 2020`), tampilkan tautan sekunder `Ke periode ini` (menuju `laporanHref(ruang, data.mode, null, query)`) sehingga tidak ada dua tombol `Catat` yang menjanjikan pencatatan ke periode lampau yang ditolak batas 14 hari.
- **`S9-C10` (Keseimbangan kolom Beranda laptop 1280 px):**
  - Di `BerandaReal` (`apps/web/src/app/[ruang]/_real/beranda.tsx:167-206`): pada breakpoint `laptop:grid-cols-12`, tempatkan `Tagihan 7 hari` dan `Anggaran hampir habis` di kolom kanan (`laptop:col-span-5 laptop:col-start-8`) bersama Aktivitas/Terakhir, sementara kolom kiri (`laptop:col-span-7 laptop:col-start-1`) memuat kartu `Aman dipakai`, `OnboardingBanner`, dan `Kontribusi` (di Bersama). Urutan DOM untuk pembaca layar dan tampilan HP (< 1024 px) tetap: Aman → Banner → Tagihan → Anggaran → Kontribusi → Aktivitas → Terakhir.
- **Critique S8 minor (`TxRow` 320 px & Kontribusi HP):**
  - Di `TxRow` (`apps/web/src/components/ui/rows.tsx:148`): izinkan judul transaksi membungkus hingga 2 baris pada layar sempit (`line-clamp-2 break-words` alih-alih `truncate` satu baris yang memotong kata di tengah pada 320 px), dengan perataan atas (`items-start`) bila ada catatan tambahan.
  - Di `ContributionsCardView` (`apps/web/src/features/beranda/contributions-card-view.tsx`): pastikan padding kanan dan ukuran font nominal di HP tidak menempel ke tepi kartu dan sejajar dengan kartu daftar di bawahnya.

- [x] **Step 1:** Perbarui tes unit di `apps/web/src/features/rencana/`, `apps/web/src/features/laporan/`, dan `apps/web/src/app/[ruang]/_real/`.
- [x] **Step 2:** Terapkan perbaikan `S9-C3`, `S9-C4`, `S9-C5`, `S9-C6`, `S9-C10`, dan S8 minor.
- [x] **Step 3:** Jalankan `pnpm --filter @dompetku/web test`, `pnpm typecheck`, dan `pnpm build`. Commit `fix(web): perbaiki temuan critique minor S9 (C3-C6, C10) dan S8`.

---

### Task 5: Keamanan rendah DB (`0122_tagihan_batas_idem.sql`) & `.trivyignore.yaml` (Review keamanan S9)

**Files:**
- Create `packages/db/migrations/0122_tagihan_batas_idem.sql`
- Modify `packages/db/tests/22_tagihan.sql`
- Modify `packages/db/README.md`
- Modify `.trivyignore.yaml`

**Interfaces:**
- Migrasi `packages/db/migrations/0122_tagihan_batas_idem.sql` (expand-only, `create or replace function`, tanda tangan identik):
  1. `private.materialize_bill(p_bill_id uuid, p_through date default null, p_from date default null)`: batasi `v_through := least(v_through, app.today() + 400, coalesce(v_b.ends_on, v_through));` sehingga meskipun `jobs.materialize_bills('2999-12-31')` dipanggil dengan tanggal jauh di masa depan, deret `generate_series` paling banyak ~13 bulan ke depan dari `app.today()`.
  2. `api.create_bill(...)`: pindahkan `perform app.assert_member(p_space_id);` ke **sebelum** `private.idem_begin(...)` (konsisten dengan `api.create_entry` di `0103_ledger_api.sql:92`), sehingga non-anggota ditolak `DK404 space_not_found` sebelum menyentuh `app.idempotency_keys`.
  3. `api.post_bill_occurrence(...)`: periksa keberadaan kemunculan dan `perform app.assert_member(v_o.space_id);` sebelum `private.idem_begin(...)`, sehingga non-anggota langsung ditolak `DK404` sebelum menyentuh `app.idempotency_keys`.
  4. Akhiri blok `-- migrate:up` dengan `select private.own_api_functions();`, dan awali `-- migrate:down` dengan penjaga `migrate_down_blocked_prod` yang mengembalikan definisi ketiga fungsi ke versi `0118_tagihan_api.sql`.
- `.trivyignore.yaml`:
  - Batasi entri `CVE-2026-22184` dengan `purls: ["pkg:deb/debian/zlib1g"]` (format didukung Trivy v0.69+) agar pengecualian sementara sampai `2026-11-21` hanya berlaku untuk paket `zlib1g` Debian 13 di base image distroless.

- [x] **Step 1:** Tambahkan asersi pgTAP di `packages/db/tests/22_tagihan.sql`:
  - `jobs.materialize_bills(app.today() + 5000)` hanya mematerialisasi kemunculan sampai `<= app.today() + 400`.
  - Non-anggota yang memanggil `api.create_bill` atau `api.post_bill_occurrence` ditolak `DK404` dan tidak meninggalkan baris di `app.idempotency_keys`.
- [x] **Step 2:** Tulis migrasi `packages/db/migrations/0122_tagihan_batas_idem.sql` dan perbarui `packages/db/README.md` serta `.trivyignore.yaml`.
- [x] **Step 3:** Jalankan migrasi & pgTAP di cluster Postgres lokal (termasuk uji rollback ke `0121` lalu `up` kembali dan `pg_prove`). Commit `fix(db): batasi rentang materialize_bills dan assert_member sebelum idem_begin (0122)`.

---

### Task 6: Deduplikasi fixture E2E, `try/finally` screenshot, pemeriksa registry, & screenshot Laporan Bersama (Plan S9 Task 14 Step 5 + Handoff S9)

**Files:**
- Modify `apps/web/tests/e2e-auth/helpers.ts`
- Modify `apps/web/tests/e2e-ledger/fixtures.ts`
- Modify `apps/web/tests/e2e-bersama/fixtures.ts`
- Modify `apps/web/tests/e2e-bersama/screens-s8.spec.ts`
- Modify `apps/web/tests/e2e-bersama/screens-s9-bersama.spec.ts` (atau tambahkan tangkapan Kontribusi 2 anggota di Laporan Bersama)
- Modify `scripts/check-test-registry.ts`
- Modify `scripts/check-test-registry.test.ts`

**Interfaces:**
- `apps/web/tests/e2e-auth/helpers.ts`:
  - Ekspor konstanta `E2E_PASSWORD = 'kuda-lari-di-sawah-42'`, fungsi `adminQuery<T>(sql, params = [])`, dan helper `registerOwnerOnPage(browser, { baseURL, email, mailFile, statePath })` agar `tests/e2e-ledger/fixtures.ts` dan `tests/e2e-bersama/fixtures.ts` memanggil satu implementasi tanpa duplikasi.
- `apps/web/tests/e2e-bersama/screens-s8.spec.ts:116`:
  - Bungkus `const ctx = await browser.newContext(...)` pada tes terakhir dalam blok `try { ... } finally { await ctx.close(); }`.
- `scripts/check-test-registry.ts:80`:
  - Tangkap juga tag Playwright huruf kecil yang menyerupai pola ID registry (`/(?<![\w@])@([A-Z][\w-]*|(?:br|[itsbczk])\d+[\w-]*)/gi` atau periksa semua tag `@...` yang cocok dengan `/^(?:br|[itsbczk])\d+/i`): bila ditulis huruf kecil seperti `@b20` atau `@t17`, masukkan ke `unknown` agar `pnpm test:registry` gagal (exit 1) alih-alih mengabaikannya diam-diam.
- Screenshot S9 yang diperbarui:
  - Ambil ulang screenshot yang terpengaruh perbaikan Task 4 (`S9-C3`, `S9-C4`, `S9-C5`, `S9-C6`, `S9-C10`) dan tambahkan screenshot Laporan Bersama dengan Kontribusi 2 anggota (`lp-bersama-kontribusi`).

- [x] **Step 1:** Tambahkan kasus uji di `scripts/check-test-registry.test.ts` untuk tag Playwright huruf kecil (`{ tag: ['@b20'] }` dan `{ tag: ['@br1'] }` harus terdeteksi sebagai `unknown` / tidak sah), lalu perbarui `scripts/check-test-registry.ts`.
- [x] **Step 2:** Ekstrak `E2E_PASSWORD`, `adminQuery`, dan `registerOwnerOnPage` ke `apps/web/tests/e2e-auth/helpers.ts`; sederhanakan `e2e-ledger/fixtures.ts` dan `e2e-bersama/fixtures.ts`; tambahkan `try/finally` di `screens-s8.spec.ts`.
- [x] **Step 3:** Jalankan `pnpm test:registry` dan `pnpm test`. Commit `refactor(test): satukan helper fixture e2e dan tolak tag registry huruf kecil`.

---

### Task 7: Pengukuran Web Vitals mode nyata (Plan S9 Task 16 — kriteria keluar IPD S9)

**Files:**
- Create `apps/web/tests/e2e-ledger/vitals.spec.ts`
- Modify `apps/web/playwright.ledger.config.ts`
- Modify `.github/workflows/ci.yml`

**Interfaces:**
- `apps/web/tests/e2e-ledger/vitals.spec.ts`:
  - Masuk ke `DATA_SPECS` di `apps/web/playwright.ledger.config.ts` (berjalan di project `data` di atas server produksi standalone `.next/standalone/apps/web/server.js`).
  - Memastikan ruang Pribadi memiliki data representatif (dompet, entri transaksi, tagihan, anggaran) lewat helper yang idempoten.
  - Untuk setiap rute di `['/pribadi/beranda', '/pribadi/rencana', '/pribadi/laporan', '/pribadi/transaksi']`:
    - Buka halaman dengan viewport `{ width: 390, height: 844 }`.
    - Aktifkan sesi CDP (`page.context().newCDPSession(page)`):
      - `Emulation.setCPUThrottlingRate({ rate: 4 })` (CPU 4× throttle).
      - `Network.enable()` + `Network.emulateNetworkConditions({ offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })` (setara Fast 3G).
    - Pasang `PerformanceObserver` lewat `page.addInitScript` untuk merekam `largest-contentful-paint`, `layout-shift` (tanpa `hadRecentInput`), dan `event` (`duration` interaksi klik/ketuk kontrol nyata pada halaman untuk mengukur INP).
    - Lakukan 3 kali muat per rute, ambil nilai median `LCP`, `INP`, dan `CLS`, lalu catat ke `test.info().annotations` (`vitals-lcp-ms`, `vitals-inp-ms`, `vitals-cls`).
    - Di lokal (`!process.env.CI`): wajib `expect(medianLcp).toBeLessThan(2500)`, `expect(medianInp).toBeLessThan(200)`, `expect(medianCls).toBeLessThan(0.1)`.
    - Di CI (`process.env.CI`, K4): wajib metrik valid (`Number.isFinite`) dan cetak `::notice` (atau `::warning` bila melewati ambang lokal) tanpa menggagalkan job CI bersama.

- [x] **Step 1:** Buat `apps/web/tests/e2e-ledger/vitals.spec.ts` dan daftarkan di `DATA_SPECS` pada `apps/web/playwright.ledger.config.ts`.
- [x] **Step 2:** Jalankan `pnpm build` lalu `pnpm --filter @dompetku/web e2e:ledger -- --project=data tests/e2e-ledger/vitals.spec.ts` secara lokal; catat angka median LCP, INP, dan CLS keempat rute.
- [x] **Step 3:** Periksa `.github/workflows/ci.yml` (job `auth` sudah menjalankan `pnpm --filter @dompetku/web e2e:ledger` yang otomatis mencakup project `data`); pastikan anotasi/log tampil bersih. Commit `test(e2e): ukur Web Vitals mode nyata dengan throttle CPU 4x dan Fast 3G`.

---

### Task 8: Gerbang penuh, pembaruan screenshot & dokumen (`s9-bingkai.md`, `BSD.md`, `IPD.md`, `s9.md`), dan PR

**Files:**
- Modify `docs/design/s9-bingkai.md`
- Modify `docs/design/s9/*.png` (screenshot yang diperbarui dari Task 4 & Task 6)
- Modify `docs/product/BSD.md`
- Modify `docs/product/IPD.md`
- Modify `docs/superpowers/handoff/s9.md`

- [ ] **Step 1:** Jalankan ulang spec screenshot S9 (`screens-s9.spec.ts`, `screens-s9-tagihan.spec.ts`, `screens-s9-bersama.spec.ts` dengan `UPDATE_SCREENS=1`) untuk memperbarui tangkapan layar yang berubah akibat `S9-C3`, `S9-C4`, `S9-C5`, `S9-C6`, `S9-C10`, serta menambahkan tangkapan Kontribusi 2 anggota di Laporan Bersama.
- [ ] **Step 2:** Jalankan seluruh gerbang lokal:
  - `pnpm lint`
  - `pnpm format:check`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:registry`
  - `pnpm --filter @dompetku/worker test:int`
  - `pnpm --filter @dompetku/web test:int`
  - `pnpm build`
  - `pnpm --filter @dompetku/web e2e -- tests/e2e/budget.spec.ts`
  - `pnpm --filter @dompetku/web e2e:ledger`
  - `pnpm --filter @dompetku/web e2e:bersama`
- [x] **Step 3:** Perbarui dokumentasi:
  - `docs/design/s9-bingkai.md`: tandai `S9-C3`, `S9-C4`, `S9-C5`, `S9-C6`, `S9-C10` menjadi **Diperbaiki** di tabel Critique & Delivery Gate.
  - `docs/product/BSD.md` §16 "Catatan S9": catat migrasi `0122_tagihan_batas_idem.sql` (batas `p_through <= app.today() + 400` dan `assert_member` sebelum `idem_begin`).
  - `docs/product/IPD.md` §5 S9: catat hasil pengukuran Web Vitals (`vitals.spec.ts`) dan tuntasnya Task 14 & 16 S9.
  - `docs/superpowers/handoff/s9.md`: perbarui bagian "Dibawa ke S10" sehingga yang tersisa untuk S10 murni fitur S10 (ekspor CSV, review bulanan & salin anggaran dengan penyesuaian, anggaran subkategori, dan gerbang keluar M2).
- [ ] **Step 4:** Commit perubahan dokumentasi & screenshot, push cabang `claude/m2-pra-s10-utang-s9`, dan buat PR ke `main` setelah seluruh cek hijau.
