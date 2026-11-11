# DompetKu v2 · S10 (Anggaran subkategori, Review bulanan, Ekspor CSV, Worker lanjutan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (implementer per task, task review, fix loop, review akhir). Langkah memakai checkbox `- [ ]`. Model: DB/uang/server/worker = terkuat; UI = sonnet dengan lensa desain (design reviewer di tiap task UI).

**Goal:** Menutup M2 (IPD §5 S10): (1) anggaran subkategori (K5, BSD §15 butir 1); (2) review bulanan (bulan lalu vs rencana) + salin anggaran dengan penyesuaian; (3) ekspor CSV yang cocok dengan Laporan, dengan escape formula (K9); (4) worker lanjutan: retensi `wa_messages` dan utang worker S7. Sesudah merge: masa pakai 7 hari kedua akun (gerbang M2).

**Arsitektur:** Pola S6–S9. Aritmetika uang di SQL (BSD §1.1); fungsi tulis `api.*` DEFINER milik `dompetku_api` dengan `app.assert_member` lebih dulu; fungsi baca INVOKER; migrasi expand-only dengan penjaga `migrate_down_blocked_prod` dan `select private.own_api_functions();`; pgTAP test-first. Review bulanan **tidak** membuat fungsi baca baru: loader menyusun `api.budget_progress`/`budget_overview`, `api.category_summary`, `api.period_trend` yang sudah dipakai Laporan, jadi angkanya identik (kriteria PRD "sama dengan laporan"). CSV memakai `app.report_lines` + `app.report_class()` (satu sumber dengan Laporan).

**Cabang:** `ccr-779b3416-vsu3pa` (ditetapkan sesi ini; aturan CLAUDE.md `claude/s10-<topik>` tidak dipakai). Tanpa PR sampai pemilik meminta. Merge = deploy + migrasi di produksi.

## Status awal (diperiksa dari repo, 2026-11-11, `main` `b803e3c` + commit utang WA `0124`)

- `jobs.materialize_bills` (00:05 WIB) **sudah** = `recurring_materialize` (TRD §5 baris 233); tidak ada job materialisasi baru. "Worker lanjutan" S10 = retensi `wa_messages` + utang worker (Task 9).
- `app.budgets` (0117): FK `(space_id, category_id, category_type, category_is_root)` + `check (category_is_root)` memaksa induk; `api.set_budget` menolak sub dengan `category_not_root` (0119); `budget_progress`/`budget_overview` hanya induk; `copy_budgets` mengasumsikan baris asal induk; `tg_category_depth` melarang pindah induk kategori yang punya anggaran; `tg_obligation_xor` membandingkan induk (anggaran wajib vs tagihan).
- Pembaca `budget_progress`: `api.safe_to_spend` (0120:55), loader Laporan (`server/ledger/laporan.ts`), Rencana. **Tidak boleh** menjumlah sub (dobel di "aman dipakai").
- UI: tidak ada util CSV, tidak ada rute Pengaturan; "Export" di `features/shell/menu-sheet.tsx` hanya placeholder "Segera"; Laporan belum di sidebar laptop. Route handler hanya `/api/health` dan `/api/wa/webhook`.
- Migrasi terakhir `0124`; pgTAP terakhir `26_wa.sql` (`99_konkurensi.sql` tetap terakhir); berikutnya `0125`, `27_*.sql`.
- **Angka baseline:** pgTAP 1870 (28 berkas), unit web 2745, `test:int` web 262, worker unit 35 + int 10; budget JS (batas 162 kB): Beranda nyata 157,5, Rencana nyata 150,3, Laporan nyata 151,2.

## Keputusan pemilik yang dibutuhkan (default = rekomendasi agen; dicatat di `docs/m0a-keputusan.md` bila dipakai)

| # | Keputusan | Default plan | Alasan |
| --- | --- | --- | --- |
| K1 | Hubungan anggaran sub dengan induk | Sub = **rincian di dalam** anggaran induk: sub hanya boleh ada bila induk punya anggaran di label yang sama (`DK422 parent_budget_required`), `Σ sub ≤ induk` (`DK422 sub_exceeds_parent`, juga saat induk diturunkan di bawah Σ sub). Hanya anggaran induk dihitung di "aman dipakai" dan Laporan. | BSD §15.1: anggaran sub tidak menambah total induk; menghindari dobel. |
| K2 | Menghapus anggaran induk yang punya sub | Ikut menghapus anggaran sub label itu (UI memberi teks konfirmasi). | Alternatif (tolak) memaksa hapus satu-satu. |
| K3 | `wajib` pada sub | Ditolak (`DK422 sub_not_wajib`); wajib hanya induk (XOR dengan tagihan tetap di induk). | XOR sudah dinilai di induk; sub wajib membuka celah dobel. |
| K4 | "Penyesuaian" salin anggaran | Persen bilangan bulat −90..+100 untuk semua baris, dibulatkan ke Rp1.000: anggaran induk ke atas, rincian ke bawah (minimal Rp1.000), supaya `Σ rincian ≤ induk` terjaga setelah pembulatan (hasil review Task 2); induk ditulis lebih dulu; sesudah salin, tiap baris diubah lewat editor yang ada. Sub disalin sesudah induknya dan ikut persen yang sama (jadi `Σ sub ≤ induk` tetap). | Sederhana, uang dihitung di SQL. |
| K5 | Isi CSV | Satu baris per entri hidup pada periode Laporan (basis gajian/kalender), kolom: tanggal, jenis, kelas laporan, dompet, kategori induk, subkategori, nominal bertanda (integer rupiah), catatan, pencatat (nama tampil). Ruang Bersama tidak pernah memuat entri Pribadi (B13). Batas 50.000 baris (`DK422 export_too_large`). Pencatatan audit `export` (meta jumlah baris + rentang, tanpa isi). | Cocok dengan Laporan secara terbukti (Σ per kelas = angka Laporan). |
| K6 | Tombol Ekspor | Di header Laporan (membawa periode + basis yang sedang dilihat); item "Export" di menu tetap "Segera". | Konteks periode terbawa. |
| K7 | Retensi `wa_messages` | 14 hari (di bawah retensi idempotensi 30 hari; pesan lama yang diputar ulang tetap tertahan idempotensi ledger), job `purge_wa_messages` 01:35 WIB. Baris `pending` tidak dihapus. | Handoff wa.md "Data dan DB". |

## Global Constraints

- Semua Global Constraints S6–S9 dan Pra-S10 tetap mengikat (M1: `requireDataUser()` + `withUser`/`withLedger`; tanpa nominal di galat/log; isolasi Pribadi vs Bersama; fungsi tulis menerima/menyiapkan idempotensi sesuai BSD §9).
- Ekspor: `statement_timeout` boleh dinaikkan lokal transaksi sampai 30 s hanya di fungsi terdaftar (BSD §15 butir 7).
- Budget JS 162 kB per rute: UI baru memakai `dynamic`/pulau lazy seperti `rencana-islands.tsx`; ukur dengan `e2e/budget.spec.ts`.
- Commit kecil Conventional Commits berbahasa Indonesia, trailer sesuai instruksi sesi. Gerbang sebelum push: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm test:registry`, `pnpm build`, e2e, `test:int`, `e2e:ledger`, `e2e:bersama`, pgTAP seluruh suite + rollback/up (lalu `env='prod'`); jalankan `db-reset-lokal.sh` bila `test:int` sudah mengisi pengguna (`signup_closed`).

## Peta berkas

| Area | Berkas |
| --- | --- |
| DB | `packages/db/migrations/0125_anggaran_sub.sql`, `0126_anggaran_sub_baca_salin.sql`, `0127_ekspor.sql`, `0128_purge_wa_messages.sql` (baru); `packages/db/tests/27_anggaran_sub.sql`, `28_ekspor.sql` (baru), `17_dq.sql`, `00_katalog.sql`, `REGISTRY.md`, `packages/db/README.md` |
| Server | `apps/web/src/server/ledger/{rencana.ts,laporan.ts,review.ts (baru),ekspor.ts (baru),csv.ts (baru)}`, `apps/web/src/app/[ruang]/_actions/rencana.ts` |
| Route | `apps/web/src/app/[ruang]/laporan/ekspor/route.ts` (baru), `apps/web/src/app/[ruang]/rencana/review/page.tsx` (baru), `_real/review.tsx` |
| UI | `features/rencana/{budget-sheet.tsx,budget-row-view.tsx,copy.ts,types.ts}`, `features/review/*` (baru), `features/laporan` (tombol Ekspor), `_real/rencana*.tsx` |
| Worker | `apps/worker/src/{jobs.ts,jobs.test.ts,worker.ts,index.ts,__int__/worker.int.test.ts}`, `infra/db-vm/deploy/worker.env.example`, `docs/ops/runbook-s7-worker.md` |
| Dokumen | `docs/design/s10-bingkai.md` (baru), `docs/product/{BSD.md,IPD.md}`, `docs/superpowers/handoff/s10.md` (baru), `docs/m0a-keputusan.md`, `CLAUDE.md` |

---

### Task 1: Bingkai desain S10 (gerbang awal, tanpa kode)

**Files:** Create `docs/design/s10-bingkai.md` (format `s9-bingkai.md`). **Selesai 2026-11-11** (S10-SB1/SB2 rincian, S10-RV1/RV2 review + salin penyesuaian, S10-EX1 ekspor, salinan final, galat tanpa nominal; critique dan Delivery Gate diisi di Task 10).

- [ ] Tulis bingkai: (a) editor anggaran dengan sub (baris sub menjorok di bawah induk, "Tambah anggaran rincian", sisa induk = induk − Σ sub, konfirmasi hapus induk); (b) layar Review bulanan `/[ruang]/rencana/review` (ringkasan: pemasukan, pengeluaran, selisih periode lalu vs sebelumnya; per kategori: rencana vs realisasi; tombol "Salin ke periode ini" dengan pilihan penyesuaian persen); (c) tombol Ekspor di header Laporan (keadaan memuat, galat, `export_too_large`); (d) keadaan kosong, 320 px, terang/gelap, salinan tanpa "rumah tangga".
- [ ] Antislop mode DURING + Delivery Gate sebagai daftar periksa; critique tersimpan di dokumen sama.

### Task 2: Anggaran subkategori, skema dan fungsi tulis (migrasi `0125`) — model terkuat

**Selesai 2026-11-11** (commit `4b0a0bc` + perbaikan hasil review independen: asersi 21 memeriksa pesan, asersi `safe_to_spend` tautologis dibuang, tes DELETE massal owner, `copy_budgets` induk terarsip, konkurensi turunkan-induk vs naikkan-rincian; pgTAP 1928). Catatan: rincian dari sheet lama (stale) bisa tersimpan tanpa terlihat sampai `budget_overview` menampilkan rincian (Task 3) dan sheet punya `case 'sub_exceeds_parent'` (Task 5).

**Files:** Create `0125_anggaran_sub.sql`, `tests/27_anggaran_sub.sql`; Modify tes BSD butir 27 (`docs/product/BSD.md` §13 #27 dan tes yang menegaskannya, mis. `21_kewajiban.sql`), `00_katalog.sql`.

- [ ] Test-first (pgTAP): sub tanpa anggaran induk ditolak (`parent_budget_required`); `Σ sub ≤ induk` di tiga arah (set sub, turunkan induk, salin); `sub_not_wajib`; hapus induk menghapus sub label itu; kategori terarsip/ruang lain/pemasukan = `DK404`/`DK422` seperti induk; `assert_member` lebih dulu (tanpa oracle XOR); pindah induk kategori yang punya anggaran tetap `category_in_obligation`; XOR wajib vs tagihan tetap di induk (sub tidak mengubah hasil); konkurensi dua `set_budget` sub paralel tidak melanggar `Σ sub ≤ induk` (kunci advisory per ruang `dompetku.budget:<space>`, di `99_konkurensi.sql` bila perlu).
- [ ] Skema: lepas `check (category_is_root)` dan FK berkolom `category_is_root`, ganti FK `(space_id, category_id, category_type) → app.categories (space_id, id, type)`; kolom `category_is_root` ditandai usang (komentar; dihapus di migrasi kontrak kemudian). Tambah `private.check_budget_tree` dipanggil trigger `budgets_tree` (BEFORE INSERT/UPDATE) memakai kunci advisory; `api.set_budget` mengganti pemeriksaan `category_not_root`; `api.delete_budget` cascade ke sub (K2).
- [ ] `api.budget_progress` (dipakai `safe_to_spend`, Laporan): tambahkan `where` induk saja (kategori tanpa `parent_id`) agar tidak berubah perilaku; verifikasi `safe_to_spend` tidak berubah (golden T17 tetap lulus).
- [ ] Gerbang DB: pgTAP seluruh suite + rollback/up.

### Task 3: Baca anggaran sub, salin dengan penyesuaian, DQ14 (migrasi `0126`) — model terkuat

**Selesai 2026-11-11** (migrasi `0126`, review independen bersih + perbaikan pembulatan rincian < Rp1.000; pgTAP 1947; golden dihitung tangan di `27_anggaran_sub.sql`, tanpa berkas golden terpisah). `budgetOverviewTx`/`budgetTotalsTx` menyaring baris rincian sampai Task 4 membawanya ke VM (tanpa itu urutan `n` bergeser dan total kartu menghitung dua kali).

**Files:** Create `0126_anggaran_sub_baca_salin.sql`; extend `27_anggaran_sub.sql`, `17_dq.sql`.

- [ ] `api.budget_overview`: tambah kolom `parent_id`, `sub_allocated` (induk: Σ anggaran rinciannya; 0 bila tidak ada) dan `max_amount` (rincian, termasuk yang belum beranggaran: anggaran induk − Σ anggaran rincian saudaranya; UI tidak menghitung uang, `docs/design/s10-bingkai.md`); baris sub (anak kategori induk yang dipilih) dengan `spent` per `category_id` (bukan `root_category_id`); induk tetap realisasi total (induk + semua sub); urutan: induk lalu sub-subnya. Induk terarsip yang punya anggaran tetap tampil dengan sub-sub beranggaran.
- [ ] `api.copy_budgets(p_space_id, p_from_month, p_to_month, p_adjust_pct int default 0)`: drop tanda tangan lama (tiga argumen) lalu buat ulang; urut induk dulu lalu sub (urut `category_id` di tiap kelompok); `p_adjust_pct` di luar −90..+100 = `DK400`; nominal induk = `ceil(amount × (100+pct)/100 / 1000) × 1000`, rincian = `floor(...) × 1000` (di bawah Rp1.000 dilewati sebagai `skipped_conflict`, tidak dinaikkan paksa), dihitung bigint di SQL (pembulatan induk ke atas dan rincian ke bawah menjamin Σ rincian ≤ induk; bila tetap melanggar, rincian dilewati sebagai `skipped_conflict`, bukan diam-diam); sub yang induknya dilewati (`skipped_*`) ikut dilewati (`skipped_parent`, kolom hasil baru); idempoten (jalan ulang = copied 0).
- [ ] DQ14 (error): sub beranggaran tanpa anggaran induk label sama, atau `Σ sub > induk`; tambahkan ke `private.dq_run` dan `17_dq.sql` (daftar DQ01..DQ14), `INFO_ONLY` tidak berubah.
- [ ] pgTAP: golden baru (`support/golden-s10.{sql,json}`) untuk overview dengan sub dan salin ±persen; `budget_progress`/`safe_to_spend` tidak berubah.

### Task 4: Server dan action Rencana (sub + salin penyesuaian)

**Selesai 2026-11-11:** `BudgetOverviewVM` + `parentId`/`subAllocated`/`maxAmount`, `RencanaData.subBudgets` (rincian) terpisah dari `budgets` (induk); total kartu tetap induk saja; `copyBudgetsSchema.adjustPct` (−90..100, bawaan 0) dan `skippedParent`; `previousOf` menghitung rincian; kode galat S10 dipetakan sejak Task 2. Tes: unit 2748, `test:int` 264 (+2).

**Files:** Modify `server/ledger/rencana.ts`, `_actions/rencana.ts`, `features/rencana/types.ts`, tes unit/`__int__`.

- [ ] Zod: `setBudgetSchema` menerima kategori sub; `copyBudgetsSchema` menerima `adjustPct` (int −90..100, bawaan 0); `BudgetOverviewVM` + `parentId`; galat baru dipetakan di `server/ledger/errors.ts` (`parent_budget_required`, `sub_exceeds_parent`, `sub_not_wajib`).
- [ ] `budget-sheet.tsx`: tambahkan `case 'sub_exceeds_parent'` (dan `sub_not_wajib`) agar tidak jatuh ke galat umum (Task 5 memakai salinan bingkai).
- [ ] `copyResult`/`copyBudgets` meneruskan `skipped_parent`; `previousOf()` menghitung juga baris rincian (`copy_budgets` menyalin rincian; sekarang `budgetOverviewTx` menyaringnya, hasil review Task 3).
- [ ] Hasil `copyBudgets` memuat `skippedParent`; tes `__int__` untuk sub, `Σ sub`, penyesuaian, galat.

### Task 5: UI Rencana: anggaran rincian (sonnet + lensa desain)

**Files:** Modify `features/rencana/{budget-sheet.tsx,budget-row-view.tsx,copy.ts}`, `_real/rencana.tsx`, `rencana-client.tsx`; tes unit + e2e:ledger.

- [ ] Baris sub menjorok di bawah induk; sheet editor menampilkan "Sisa induk"; tombol "Tambah anggaran rincian" hanya bila induk beranggaran; teks konfirmasi saat hapus induk beranggaran-sub (K2); galat Task 4 berbahasa awam.
- [ ] Prototipe (`pnpm e2e`) tidak berubah kecuali data demo bila dibutuhkan; budget JS Rencana nyata ≤ 162 (target ≤ 152).
- [ ] Screenshot 320/390 terang+gelap di `screens-s10-rencana.spec.ts` (daftarkan di `DATA_SPECS`); axe nol pelanggaran.

### Task 6: Review bulanan (loader + halaman + salin dengan penyesuaian) — loader model terkuat, UI sonnet

**Files:** Create `server/ledger/review.ts`, `app/[ruang]/rencana/review/page.tsx`, `_real/review.tsx`, `features/review/*`; Modify `_real/rencana.tsx` (tautan), `features/laporan/href.ts` bila perlu.

- [ ] `loadReview(ctx,{label})`: satu `withLedger` memanggil `api.pay_period`, `api.period_trend` (periode ini + sebelumnya), `api.category_summary`, `api.budget_overview` dan `api.budget_progress` untuk label itu; **tidak** menghitung uang di JS. Tes `__int__`: setiap angka = keluaran fungsi Laporan yang sama (golden T17), Bersama tanpa data Pribadi (B13).
- [ ] Halaman: kartu "Bulan lalu vs rencana" (realisasi vs anggaran per kategori induk/sub, sisa/lebih), ringkasan selisih dengan periode sebelumnya, aksi "Salin anggaran ke periode ini" dengan pilihan persen (0, ±5, ±10, kustom) memakai `copyBudgetsAction`; hasil di toast (`copied`, `skipped*`). Keadaan: belum ada anggaran periode lalu, periode berjalan belum selesai (label "Sementara", `days_left`).
- [ ] Rute nyata saja (prototipe 404 seperti Laporan nyata); tes unit, `e2e:ledger` (spec data), screenshot, budget JS ≤ 162.

### Task 7: Ekspor CSV: DB dan util (migrasi `0127`) — model terkuat

**Files:** Create `0127_ekspor.sql`, `tests/28_ekspor.sql`, `server/ledger/csv.ts`, `server/ledger/ekspor.ts`; tes unit.

- [ ] Test-first pgTAP: `api.export_entries(p_space_id, p_from, p_to)` (INVOKER, STABLE, `assert_member` lebih dulu; baca `app.report_lines`/`report_class`, entri batal/dipindah/dipurge tidak ikut): Σ nominal per kelas = angka `period_trend`/`category_summary` periode itu (golden T17); Bersama tidak memuat entri Pribadi (kanari B13, dua anggota); Pribadi pasangan = `DK404`; > 50.000 baris = `DK422 export_too_large`; rentang tidak sah = `DK400`; `statement_timeout` dinaikkan lokal transaksi ≤ 30 s hanya di fungsi ini (daftar terdaftar di `00_katalog.sql`); pencatatan audit `export` lewat `audit.log` (non-reserved) dengan meta `{rows, from, to}` tanpa isi (tes katalog audit).
- [ ] `csv.ts` (murni): CRLF, kutip RFC 4180, BOM UTF-8; **escape formula (K9)** pada kolom teks (awalan `= + - @ \t \r` diberi `'`); kolom nominal ditulis integer polos yang divalidasi `^-?\d+$` dan **tidak** di-escape (kalau tidak `-15000` rusak); CR/LF dalam sel; tes tabel kasus (termasuk `=cmd|' /C calc'!A0`, `@SUM(1+1)`, `+1`, `-1` di teks, tab, nama dompet berawalan `=`).
- [ ] `ekspor.ts`: `exportLaporanCsv(ctx,{label,basis})` memanggil `api.pay_period` untuk rentang yang sama dengan Laporan, lalu `api.export_entries`; mengembalikan teks CSV + nama berkas (`dompetku-<ruang>-<periode>.csv`, tanpa nama orang).

### Task 8: Route ekspor + tombol (sonnet + lensa desain untuk tombol, server model terkuat)

**Files:** Create `app/[ruang]/laporan/ekspor/route.ts` (+ tes), modify `_real/laporan.tsx`, `features/laporan/*`.

- [ ] Route GET (mode nyata saja; prototipe 404): gerbang `requireDataUser` + `resolveSpace` (bukan helper halaman), parameter `periode`/`basis` divalidasi seperti `parseLaporanParams`, header `text/csv; charset=utf-8`, `Content-Disposition: attachment`, `Cache-Control: no-store`; tanpa nominal/isi di log. Batas laju per user (mis. 10/jam, di memori) dan `export_too_large` → 422 dengan pesan awam.
- [ ] Tombol "Ekspor CSV" di header Laporan (K6) membawa periode+basis; keadaan memuat/galat.
- [ ] `e2e:ledger`: unduh CSV periode golden dan cocokkan Σ per kelas dengan angka di layar Laporan; `e2e:bersama`: anggota kedua mengunduh, tidak ada baris Pribadi. Daftarkan ID di `REGISTRY.md` (B13, T17 lokasi bertambah).

### Task 9: Worker lanjutan dan utang (migrasi `0128`) — model terkuat

**Files:** Create `0128_purge_wa_messages.sql`; modify `apps/worker/src/{jobs.ts,jobs.test.ts,index.ts,__int__/worker.int.test.ts}`, `00_katalog.sql`, `infra/db-vm/deploy/worker.env.example`, `docs/ops/runbook-s7-worker.md`, `packages/db/README.md`.

- [ ] `jobs.purge_wa_messages()` (DEFINER owner, EXECUTE hanya `dompetku_worker`): hapus baris `status <> 'pending'` dengan `created_at < app.now() - interval '14 days'` (K7); idempoten; tidak menyentuh `recorded` dalam jendela `batal` (10 menit) karena 14 hari ≫ 10 menit. Job `purge_wa_messages` 01:35 WIB, check `jobs`; semua titik daftar job (lihat peta di tes katalog: DEFINER owner, matriks EXECUTE, `jobs.test.ts`, int test, runbook, `worker.env.example`).
- [ ] pgTAP + int: pesan > 14 hari terhapus, baru dan `pending` tetap; jalan 2× = 0 baris kedua; revoke execute → `failed` (pola int test `materialize_bills`).
- [ ] Worker: `unhandledRejection` memicu alert + keluar bersih (bukan hanya log); DQ07 dipantau lewat ringkasan alert (butir R20 handoff S7, bila rancangannya sederhana; selain itu catat dan tunda).
- [ ] Tutup T15 di `REGISTRY.md` bila ada: `materialize_bills` dijalankan 2× = tidak ada kemunculan ganda (tes ada di `22_tagihan.sql`/int; petakan, jangan duplikasi).

### Task 10: Dokumen, review, penutup

- [ ] BSD §16 "Catatan S10" (migrasi 0125–0128, aturan sub K1–K3, `copy_budgets` baru, ekspor K5, retensi K7), BSD §13 butir 27 diganti aturan sub, `IPD.md` S10 (status, bukti kriteria keluar, `recurring_materialize` = `materialize_bills`), `docs/m0a-keputusan.md` (K1–K7), `CLAUDE.md` status, `docs/superpowers/handoff/s10.md` (langkah pemilik: masa pakai 7 hari kedua akun, runbook worker memasang job baru).
- [ ] Review akhir: task review per task, review keamanan (uang/RLS/DB, ekspor CSV, injeksi formula, kebocoran lintas ruang), gerbang penuh (lihat Global Constraints), `deploy-test.sh`.
- [ ] Tidak dikerjakan di S10 (dicatat di handoff): bump OpenWA `0.29.1` (PR terpisah sesudah 2026-11-14 18:52 WIB; `0.30.0` sesudah 2026-11-17), cabut pengecualian Trivy `zlib1g` (batas 2026-11-21), kontrol Talangan di sheet Ubah, chip saran Catat bergeser, nama dompet panjang terpotong, kontrol tanggal tagihan, item Laporan di sidebar laptop, screenshot Kontribusi dua anggota, kategori `Kontribusi Farida`.

## Review Focus

1. **Tidak dobel:** `safe_to_spend`, Laporan, dan realisasi induk tidak berubah oleh anggaran sub (golden T17 sama sebelum/sesudah 0125–0126).
2. **Invarian pohon anggaran** di bawah konkurensi dan urutan operasi (set/hapus/turunkan/salin), termasuk kategori diarsipkan dan induk dipindah.
3. **CSV:** escape formula tidak merusak nominal bertanda; Σ per kelas = Laporan; tidak ada entri Pribadi di ekspor Bersama; tanpa kebocoran lewat nama berkas, log, atau cache.
4. **Retensi WA** tidak membuka replay: jendela purge (14 hari) di dalam retensi idempotensi (30 hari).
5. **Budget JS** Rencana/Laporan ≤ 162 kB dan keterbacaan 320 px.
