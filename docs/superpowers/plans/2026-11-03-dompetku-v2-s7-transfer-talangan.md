# DompetKu v2 · M1 S7 (transfer, talangan, rekonsiliasi, worker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transfer antar ruang, talangan kantor + reimburse, "Pindahkan ke ruang lain", Cocokkan saldo / ubah saldo awal / arsip dompet, dan Bersama solo/kosong berjalan di mode nyata; worker minimal (`apps/worker`, pg-boss) menjalankan `dq_reconcile` 01:00 WIB dan job purge dengan alert; utang S6 (indeks unik nama dompet, deadlock kategori, tekanan pool Beranda, tes lintas ruang) lunas. Sesudah merge, hari pertama masa pakai M1 bisa dimulai.

**Architecture:** Sama dengan S6: DB dulu (migrasi `0109`–`0112` + pgTAP, fungsi BSD "belum ditulis" ditulis test-first), lalu wrapper server `apps/web/src/server/ledger/` + Server Actions, lalu UI (mode nyata dan demo memakai markup yang sama). Worker adalah paket baru `apps/worker` (Node 24, pg-boss, role `dompetku_worker`) yang dibundel esbuild ke **image yang sama** dengan web, sehingga satu tanda tangan cosign, satu digest, satu migrasi, dan satu rollback mencakup keduanya. Beranda membaca dalam satu transaksi `withUser` per page (bukan ≈7 paralel).

**Tech Stack:** Next.js 16.4.3, React 19.3, `pg` 8.23.1, Zod 4.6.7, Postgres 17.11 + dbmate 2.36.0 + pgTAP, Vitest, Playwright 1.64.1; baru: `pg-boss` 12.38.0 (rilis 2026-10-13, lolos `minimumReleaseAge`), `esbuild` (versi yang sudah ada di lockfile bila ada, bila tidak versi terbaru ≥ 7 hari).

**Spec:** `docs/product/IPD.md` §4 S5 (bagian worker minimal) dan S7; `docs/product/PRD.md` §5 M1, §6.2, §7; `docs/product/AFD.md` §4, §7, §8, §9; `docs/product/BSD.md` §2.2, §8.1, §9, §10, §11, §16; `docs/product/DBD.md` §9; `DESIGN.md`; `docs/team/round1/data-engineer.md` §3 (DQ). Utang S6: `CLAUDE.md` Tertunda #6–#8, `docs/superpowers/handoff/s6.md` ("Ditunda ke S7", "Lainnya"). Bila beda, BSD menang untuk nama fungsi/kolom, spec induk §9 menang untuk perilaku.

## Keputusan pemilik yang dibutuhkan (rekomendasi agen = default plan ini)

| # | Keputusan | Rekomendasi | Alasan | Bila pemilik memilih lain |
| --- | --- | --- | --- | --- |
| K1 | Deploy worker | **Lewat deployer cosign yang ada**, worker = layanan compose kedua dari image `dompetku-web` yang sama | Rilis web, worker, dan migrasi selalu satu digest (tidak ada worker lama memanggil fungsi `jobs.*` yang sudah berubah); tanpa jalur tanda tangan kedua; rollback otomatis ikut. Biaya: deployer + `deploy-test.sh` diubah (Task 16) | Manual: Task 16 jadi runbook `docker compose up -d worker` saja; risiko versi worker tertinggal dari migrasi, dan image tetap harus diverifikasi cosign manual |
| K2 | Alert `dq_reconcile` | **Healthchecks saja** | Sudah dipakai backup/restore/deploy; ada dead-man switch (worker mati atau jadwal tidak jalan = alert, sesuatu yang Resend tidak bisa); worker tidak perlu `RESEND_API_KEY`; email ke pemilik tetap terkirim dari Healthchecks | Keduanya: tambah `alert-resend.ts` + `RESEND_API_KEY` di `worker.env` + egress `api.resend.com` (± 1 langkah di Task 15). Resend saja: kehilangan dead-man switch |
| K3 | Pangkas seed demo dari JS mode nyata | **Di S7, sebagai Task 9 sebelum UI baru** | Headroom Beranda nyata tinggal 1,2 kB, sedangkan S7 menambah Bersama solo/kosong di Beranda dan dua mode baru di Catat. Tanpa pemangkasan, risiko berhenti di tengah S7 karena budget | Tunda: Task 9 dihapus; tiap task UI wajib muat malas semua tambahan dan berhenti bila Beranda > 162 kB |

Keputusan kecil yang diambil agen di plan ini (biaya bila salah ditulis di tasknya): DQ02 (checkpoint saldo) ditunda ke S10; `api.update_transfer` tidak dibuat (transfer diubah dengan Batalkan + catat ulang); entri asal "Pindahkan" tidak bisa dipulihkan dan tidak tampil di Sampah; reimburse boleh sebagian.

## Global Constraints

**Semua Global Constraints rencana S6 berlaku tanpa perubahan** (`docs/superpowers/plans/2026-11-01-dompetku-v2-s6-catat.md` bagian Global Constraints: proses, aturan M1, kontrak `api.*`, migrasi, Catat dan event produk, desain dan aksesibilitas, salinan tetap). Konteks subagent: `docs/superpowers/handoff/s6-konteks-subagent.md` (perbarui nomor sprint, branch, angka). Tambahan S7:

- Branch kerja sesi ini: `ccr-9793f2cb-vij139` (ditetapkan sesi); PR ke `main`, merge hanya bila CI hijau di head PR dan review task + keamanan bersih (CLAUDE.md). Merge = deploy + migrasi `0109`–`0112` di produksi.
- Migrasi S7 bernomor `0109` ke atas; tes pgTAP baru `14_` ke atas. Semua migrasi **expand-only** (kolom baru nullable, tanpa drop/rename), karena rollback deployer hanya mengganti image.
- Transfer antar ruang: deskripsi hanya di kaki Pribadi, `shared_note` hanya di kaki Bersama dan hanya bila diisi eksplisit; Bersama tidak pernah menerima nama dompet Pribadi, deskripsi Pribadi, atau id entri Pribadi (termasuk payload RSC). Void/pulihkan/purge `space_transfer` selalu berpasangan dan hanya oleh pencatat.
- Talangan: hanya `expense` di ruang Pribadi (`reimbursable_personal_expense_only`); talangan dan biaya dari dompet `kantor` tidak mengubah angka pengeluaran pribadi (`x_talangan`, `x_kantor`, BSD §8.1).
- Worker: role `dompetku_worker` saja (EXECUTE `jobs.*`, R/W `jobs.job_runs`, tanpa tabel domain); log, `job_runs.error_code`, dan isi alert hanya memuat nama job, SQLSTATE, id cek DQ, severity, dan jumlah pelanggaran, **tanpa nominal, deskripsi, id entri, atau email**. Jadwal dalam WIB (`tz: 'Asia/Jakarta'`).
- Rahasia worker (`DATABASE_URL` role worker, URL ping Healthchecks) diisi pemilik di `/opt/dompetku/env/worker.env` (`600 root`), tidak lewat chat atau repo.
- Budget JS 162 kB per rute (mode prototipe dan nyata) tetap; rute baru masuk loop `budget.spec.ts` dan anotasi `js-route-kB` `e2e:ledger`.

## Review Focus

1. **Bocor Pribadi lewat transfer antar ruang:** N menyetor dari "BCA Pribadi" ke Bersama dengan keterangan "bayar kos adik"; di semua rute Bersama (Beranda, Transaksi, Detail kaki masuk, Sampah) dan payload RSC-nya tidak ada "BCA Pribadi", "bayar kos adik", atau id kaki keluar. Tes: kanari di Task 17, unit loader di Task 7.
2. **"Pindahkan" lalu "Pulihkan":** entri yang sudah dipindah ke ruang lain dipulihkan dari URL lamanya; orang wajar mengharapkan tidak ada transaksi ganda. Harapan: `restore_entry` menolak `entry_moved`, entri asal tidak tampil di Sampah. Tes: Task 4 (pgTAP) dan Task 11 (UI salinan).
3. **Reimburse sebagian dan pembatalan:** talangan Rp 500.000 diganti 300.000 lalu 200.000; reimburse ketiga Rp 1 ditolak; membatalkan reimburse kedua membuka lagi sisa 200.000; membatalkan talangan yang masih punya reimburse hidup ditolak. Tes: Task 3.
4. **Nama dompet ganda dalam variasi:** "BCA" lalu " bca " di ruang yang sama ditolak `name_taken`; nama yang sama di ruang lain atau milik dompet terarsip boleh. Tes: Task 2 dan Task 6.
5. **Worker di jam sulit:** DB tidak terjangkau pukul 01:00 WIB, job melempar galat, atau worker restart saat job berjalan: `job_runs` berakhir `failed` (bukan `running` selamanya) dan Healthchecks menerima `/fail`; dua instance tidak menjalankan job yang sama bersamaan; cron 01:00 WIB = 18:00 UTC hari sebelumnya. Tes: Task 15.

---

## Peta berkas

| Area | Berkas |
| --- | --- |
| DB | `packages/db/migrations/0109_dompet_nama_kategori_lock.sql`, `0110_talangan.sql`, `0111_pindah_ruang.sql`, `0112_dq_worker.sql`; `packages/db/tests/14_dompet_nama.sql`, `15_talangan.sql`, `16_pindah_ruang.sql`, `17_dq.sql`, tambahan di `99_konkurensi.sql`, `00_katalog.sql`, `08_ledger_isolasi.sql`; skrip `docs/superpowers/handoff/cek-duplikat-dompet-0109.sh` |
| Server | `apps/web/src/server/ledger/{write,read,errors,beranda,dompet}.ts`, `server/ledger/reimburse.ts` (baru), `server/ledger/__int__/*.int.test.ts` |
| Actions | `apps/web/src/app/[ruang]/_actions/{catat,entri,dompet,inputs}.ts`, `_actions/reimburse.ts` (baru) |
| UI | `features/catat/*` (transfer antar ruang, talangan), `features/transaksi/*` + `_real/detail*.tsx` (Pindahkan, Batalkan antar ruang, reimburse), `features/dompet/*` + `_real/dompet*.tsx` (Cocokkan, saldo awal, arsip, Menunggu reimburse), `features/beranda/*` + `_real/beranda*.tsx` (Bersama solo/kosong) |
| Worker | `apps/worker/{package.json,tsconfig.json,vitest.config.ts,build.mjs}`, `apps/worker/src/{index,jobs,run-job,alert,config}.ts`, `apps/worker/src/__int__/worker.int.test.ts` |
| Infra | `apps/web/Dockerfile`, `infra/db-vm/compose.yml`, `infra/db-vm/deploy/{deploy,test/deploy-test.sh,README.md,worker.env.example}`, `.github/workflows/ci.yml`, `docs/ops/runbook-s7-worker.md` |
| Dokumen | `docs/design/s7-bingkai.md`, BSD §16 "Catatan S7", IPD §4 status, `CLAUDE.md`, `docs/superpowers/handoff/s7.md` |

---

### Task 1: Bingkai desain S7 (gerbang awal)

**Files:** Create `docs/design/s7-bingkai.md`; screenshot ke `docs/design/s7/` (prototipe, 390 dan 1280, terang dan gelap).

**Interfaces:** Produces salinan tetap dan keadaan yang dipakai Task 10–14 (setiap task UI mengutip id bingkai, mis. `S7-C1`).

- [ ] **Step 1:** Tulis bingkai (pola Panel Malam, DBD §9) untuk: `S7-C1` Catat → Transfer dengan tujuan di ruang lain (pemilih ruang tujuan di dalam pemilih dompet tujuan, field "Catatan untuk Bersama" hanya saat tujuan/sumber Bersama, keterangan hanya di sisi Pribadi); `S7-C2` toggle "Talangan kantor" di Catat pengeluaran Pribadi; `S7-D1` Detail kaki antar ruang (Pribadi: "Setor ke Bersama"; Bersama: "Setoran dari {Nama}" / "Diambil oleh {Nama}", tanpa nama dompet), Batalkan hanya untuk pencatat; `S7-D2` "Pindahkan ke ruang lain" (sheet pilih dompet + kategori ruang tujuan, konfirmasi akibat); `S7-D3` Detail talangan: status "Menunggu reimburse · sisa {Rp}", aksi "Catat reimburse" dan "Tidak diganti"; `S7-W1` Cocokkan saldo (isi saldo nyata, pratinjau selisih); `S7-W2` ubah saldo awal (tautan dari detail dompet ke Detail entri saldo awal, hanya ≤ 7 hari); `S7-W3` Arsipkan dompet (dialog; saldo ≠ 0 = penjelasan + tidak ada tombol arsip aktif); `S7-W4` daftar "Menunggu reimburse" di Dompet Pribadi; `S7-B1` Beranda Bersama solo (F belum bergabung: tanpa avatar F palsu, ajakan Undang hanya bila pemilik) dan `S7-B2` Bersama kosong.
- [ ] **Step 2:** Tabel salinan galat baru: `cross_space_not_allowed`, `cross_space_kantor`, `name_taken` (dompet), `balance_not_zero`, `not_reimbursable`, `reimbursement_exceeds`, `reimbursement_exists`, `entry_moved`, `not_creator`, `kind_not_movable`. Tanpa nominal di pesan galat.
- [ ] **Step 3:** Kursi design reviewer (subagent terpisah) menilai bingkai terhadap `DESIGN.md`; perbaiki temuan; commit `docs(desain): bingkai S7`.

### Task 2: Migrasi 0109 nama dompet unik + kunci arsip kategori — **Model: terkuat**

**Files:** Create `packages/db/migrations/0109_dompet_nama_kategori_lock.sql`, `packages/db/tests/14_dompet_nama.sql`, `docs/superpowers/handoff/cek-duplikat-dompet-0109.sh`; Modify `packages/db/tests/99_konkurensi.sql`, `00_katalog.sql`.

**Interfaces:** Produces indeks `app.accounts_name_unique` (nama indeks dipakai Task 6 untuk memetakan `23505` → `name_taken`); `api.archive_category` versi baru (tanda tangan tetap).

- [ ] **Step 1: Tes gagal** `14_dompet_nama.sql`: `create_account` "BCA" lalu " bca " di ruang sama → `throws_ok(…, '23505')`; nama sama di ruang Bersama → lolos; arsipkan dompet saldo 0 lalu buat lagi "BCA" → lolos; `index_is_unique('app','accounts','accounts_name_unique')`.
- [ ] **Step 2: Tes gagal** di `99_konkurensi.sql` (dblink, pola kasus kategori S6): koneksi A `archive_category(P)`, koneksi B `update_category(C, …, p_parent_id => P)` dengan `C.id < P.id`, keduanya dimulai sebelum salah satu commit → tidak ada `40P01`; hasil akhir konsisten (C terarsip atau ditolak `category_archived`).
- [ ] **Step 3:** Jalankan `pg_prove … tests/14_dompet_nama.sql tests/99_konkurensi.sql` → FAIL.
- [ ] **Step 4: Implementasi.** `create unique index accounts_name_unique on app.accounts (space_id, lower(btrim(name))) where archived_at is null;` didahului blok `do` yang menolak dengan `DK500 duplicate_account_names` bila ada duplikat (pesan tanpa nama). `api.archive_category`: kunci kategori + anak aktifnya dalam satu `select … where space_id = … and (id = p or parent_id = p) order by id for update` sebelum `update` (urutan id sama dengan `update_category`). Down: drop indeks, kembalikan definisi 0106. Akhiri `select private.own_api_functions();`.
- [ ] **Step 5:** Skrip `cek-duplikat-dompet-0109.sh` (pola `cek-backfill-0106.sh`): hitung grup duplikat di DB produksi via `dompetku-psql`, keluaran hanya jumlah. Dijalankan pemilik sebelum merge; hasil > 0 = berhenti, minta keputusan.
- [ ] **Step 6:** `pg_prove` seluruh suite → PASS; commit `feat(db): 0109 nama dompet unik per ruang dan kunci urut arsip kategori`.

### Task 3: Migrasi 0110 talangan dan reimburse — **Model: terkuat**

**Files:** Create `packages/db/migrations/0110_talangan.sql`, `packages/db/tests/15_talangan.sql`; Modify `00_katalog.sql`, `08_ledger_isolasi.sql`.

**Interfaces:**
- Produces `api.create_reimbursement(p_client_id uuid, p_entry_id uuid, p_account_id uuid, p_amount bigint, p_occurred_on date default null, p_description text default null) returns jsonb` → `{entry_id, version, replayed, warnings, remaining}`; galat `DK404` (talangan tidak ada/bukan anggota), `DK422 not_reimbursable` (bukan expense reimbursable hidup), `DK422 reimbursement_exceeds` (Σ reimburse hidup + p_amount > nominal talangan), `space_mismatch` (dompet bukan ruang talangan), `account_archived`, `before_opening`.
- Produces `api.open_reimbursables(p_space_id uuid) returns table (entry_id uuid, occurred_on date, description text, account_id uuid, amount bigint, reimbursed bigint, remaining bigint)` (INVOKER, RLS), hanya talangan hidup dengan `remaining > 0`, urut `occurred_on` lalu `id`.
- `api.update_entry` dengan `p_reimbursable => false` pada talangan yang punya reimburse hidup → `DK422 reimbursement_exists`.

- [ ] **Step 1: Tes gagal** `15_talangan.sql` (lewat `tests.web_exec`): talangan 500000 → `open_reimbursables` sisa 500000; reimburse 300000 lalu 200000 → sisa hilang dari daftar, `remaining` = 0; reimburse 1 → `reimbursement_exceeds`; void reimburse kedua → sisa 200000 kembali; void talangan dengan reimburse hidup → ditolak (perilaku 0103 `set_void_state`); `update_entry(p_reimbursable => false)` dengan reimburse hidup → `reimbursement_exists`; talangan di Bersama → `reimbursable_personal_expense_only`; `period_summary` Pribadi: pengeluaran tidak berubah oleh talangan maupun reimburse; transfer dari dompet `kantor` dengan fee: fee tidak masuk pengeluaran pribadi; clientId sama + isi beda → `DK410`; F tidak bisa memanggil keduanya atas talangan N (`DK404`, 0 baris).
- [ ] **Step 2:** `pg_prove tests/15_talangan.sql` → FAIL.
- [ ] **Step 3: Implementasi** mengikuti pola `create_entry` (BSD §9; `idem_begin`, `lock_accounts`, kunci talangan `for update` sesudah akun dalam urutan tetap: akun dulu, lalu entri), satu line `main` +p_amount (bentuk `reimbursement` di BSD §7 baris 870). `update_entry`: diganti utuh dari 0106 + cek `reimbursement_exists`; down mengembalikan definisi 0106. Grant `EXECUTE` ke `dompetku_web`, `dompetku_api`; katalog hak diperbarui.
- [ ] **Step 4:** `pg_prove` seluruh suite → PASS; commit `feat(db): 0110 talangan, reimburse, dan daftar talangan terbuka`.

### Task 4: Migrasi 0111 pindah ke ruang lain — **Model: terkuat**

**Files:** Create `packages/db/migrations/0111_pindah_ruang.sql`, `packages/db/tests/16_pindah_ruang.sql`; Modify `00_katalog.sql`, `08_ledger_isolasi.sql`, `09_sampah_purge.sql`.

**Interfaces:**
- Kolom baru `app.entries.moved_to_entry_id uuid null` (FK tidak dipakai: lintas ruang; dicek DQ di Task 5).
- Produces `api.move_entry_to_space(p_client_id uuid, p_entry_id uuid, p_expected_version int, p_to_space_id uuid, p_account_id uuid, p_category_id uuid) returns jsonb` → `{entry_id (baru), moved_from_entry_id, version: 1, replayed, warnings}`. Hanya `income`/`expense` hidup; lainnya `DK422 kind_not_movable`; ruang tujuan = ruang asal → `DK400 to_space_id`; bukan anggota tujuan → `DK404`; talangan dipindah ke Bersama → flag `reimbursable` dilepas bila belum ada reimburse, `reimbursement_exists` bila ada; versi usang `DK409`.
- `api.restore_entry` pada entri ber-`moved_to_entry_id` → `DK422 entry_moved`; `api.trash_list` tidak memuatnya.

- [ ] **Step 1: Tes gagal** `16_pindah_ruang.sql`: pindah pengeluaran Pribadi → Bersama: asal void + `moved_to_entry_id` terisi, entri baru di Bersama dengan nominal, tanggal, deskripsi sama (deskripsi ikut karena pengguna memilih memindahkan), saldo kedua dompet benar; `restore_entry(asal)` → `entry_moved`; `trash_list` Pribadi tidak memuat asal; purge 90 hari tetap menghapus asal; replay clientId → entri yang sama; transfer/saldo awal → `kind_not_movable`; F memindahkan entri Pribadi N → `DK404`.
- [ ] **Step 2:** `pg_prove tests/16_pindah_ruang.sql` → FAIL.
- [ ] **Step 3: Implementasi:** satu transaksi: `idem_begin` → kunci kedua akun urut id → `set_void_state` asal (versi diperiksa) → insert entri baru (pola `create_entry`, ruang tujuan) → set `moved_to_entry_id` → `write_history` keduanya → `set constraints all immediate`. `restore_entry` dan `trash_list` diganti utuh dari definisi terakhir + aturan `moved_to_entry_id`; down mengembalikan definisi sebelumnya.
- [ ] **Step 4:** `pg_prove` seluruh suite → PASS; commit `feat(db): 0111 pindahkan transaksi ke ruang lain`.

### Task 5: Migrasi 0112 cek DQ tambahan dan skema pg-boss — **Model: terkuat**

**Files:** Create `packages/db/migrations/0112_dq_worker.sql`, `packages/db/tests/17_dq.sql`; Modify `00_katalog.sql`.

**Interfaces:**
- `jobs.dq_reconcile()` tetap `returns table (check_id text, severity text, violations int)`; `private.dq_run` menambah **DQ03** (bentuk line per kind untuk entri hidup, memanggil logika `private.assert_entry_shape` dalam mode hitung, error), **DQ07** (dompet `tabungan` negatif, atau dompet mana pun negatif > 3 hari berturut, warn), **DQ11** (reimburse menunjuk talangan hidup reimbursable di ruang yang sama, dan Σ reimburse hidup ≤ nominal, error), **DQ12** (`moved_to_entry_id` menunjuk entri yang ada, error). Total 10 cek: DQ01, 03, 04, 04b, 06, 07, 09, 10, 11, 12. DQ02 (checkpoint) ditunda ke S10, DQ05/DQ08 menunggu tabel M3/M4 (dicatat di BSD §16).
- Skema `pgboss` dibuat migrasi (pemilik `dompetku_owner`) dengan `grant usage, create on schema pgboss to dompetku_worker`, sehingga tabel pg-boss milik worker dan worker tidak butuh `CREATE` di database. Bila Task 15 Step 1 membuktikan pg-boss 12 bisa jalan dengan skema yang sudah ada tanpa hak `CREATE` database, bentuk ini final; bila tidak, Task 15 kembali ke task ini sebelum lanjut.

- [ ] **Step 1: Tes gagal** `17_dq.sql`: DB bersih + skenario Task 3/4 → semua `violations = 0` dan tepat 10 baris; tiap cek baru diuji positif dengan merusak data sebagai owner (`set session_replication_role = replica` lokal dalam tes, rollback di akhir) → cek itu = 1; keluaran tidak punya kolom selain tiga di atas; `dompetku_worker` bisa `select * from jobs.dq_reconcile()`, `dompetku_web` tidak; `has_schema_privilege('dompetku_worker','pgboss','CREATE')` benar dan `has_database_privilege('dompetku_worker','dompetku','CREATE')` salah.
- [ ] **Step 2:** FAIL → **Step 3:** implementasi (`private.dq_run` diganti utuh, pemilik tetap `dompetku_auditor`; down mengembalikan definisi 0104 dan drop skema `pgboss` cascade) → **Step 4:** `pg_prove` seluruh suite PASS; commit `feat(db): 0112 cek DQ S7 dan skema pg-boss untuk worker`.

### Task 6: Wrapper server baru + peta galat + tes lintas ruang — **Model: terkuat**

**Files:** Modify `apps/web/src/server/ledger/{write,read,errors}.ts`; Create `server/ledger/reimburse.ts`; Test `server/ledger/errors.test.ts`, `server/ledger/__int__/write.int.test.ts`, `__int__/read.int.test.ts`.

**Interfaces:** (semua lewat `withLedger`/`withUser`, Zod atas hasil `jsonb`, pola wrapper S6)
- `createSpaceTransfer(ctx, i: { clientId; fromAccountId; toSpaceId; toAccountId; amount; fee; occurredOn?; description?; sharedNote?; allowNegative }) → { entryId; linkedEntryId; linkId; version; replayed }` (memanggil `api.create_transfer`; `ctx.spaceId` = ruang sumber).
- `reconcileBalance(ctx, i: { clientId; accountId; actualBalance; occurredOn? }) → { entryId: string | null; difference: number; replayed }`.
- `archiveAccount(ctx, accountId) → { archived: boolean }`.
- `createReimbursement(ctx, i: { clientId; entryId; accountId; amount; occurredOn?; description? }) → { entryId; remaining; replayed }`; `openReimbursables(ctx) → ReimbursableVM[]` (`{ entryId, occurredOn, description, accountId, amount, reimbursed, remaining }`).
- `moveEntryToSpace(ctx, i: { clientId; entryId; expectedVersion; toSpaceId; accountId; categoryId }) → { entryId; version; replayed }`.
- `errors.ts`: `name_taken` juga dari `23505` pada `accounts_name_unique`; kode mesin baru diteruskan apa adanya: `balance_not_zero`, `cross_space_not_allowed`, `cross_space_kantor`, `not_reimbursable`, `reimbursement_exceeds`, `reimbursement_exists`, `entry_moved`, `kind_not_movable`, `not_creator`.

- [ ] **Step 1: Tes gagal** unit `errors.test.ts` (setiap kode di atas → `LedgerError.code` yang benar; `23505` di indeks lain tetap `unknown`) dan int: persona N/F/Luar — setor N Pribadi → Bersama lalu F membaca `listEntries` Bersama: kaki masuk tanpa `description` dan tanpa akun sumber; Luar → `not_found`; **utang S6:** `restoreEntry` atas entri ruang lain dengan `ctx.spaceId` ruang sendiri → `not_found`; `createCategory`/`updateCategory` dengan `parentId` kategori ruang asing → `not_found`; reconcile selisih 0 → `entryId: null`; archive saldo ≠ 0 → `balance_not_zero`; dompet nama ganda → `name_taken`.
- [ ] **Step 2:** `pnpm --filter web test` + `test:int` → FAIL; **Step 3:** implementasi; **Step 4:** PASS; commit `feat(web): wrapper transfer antar ruang, talangan, pindah ruang, cocokkan, arsip`.

### Task 7: Tekanan pool Beranda: satu transaksi baca per page — **Model: terkuat**

**Files:** Modify `apps/web/src/server/ledger/{read,beranda,transaksi,dompet,detail,sampah}.ts`, `apps/web/src/app/[ruang]/layout.tsx`, `_real/context.ts`; Test `server/ledger/__int__/pool.int.test.ts`.

**Interfaces:**
- Fungsi baca di `read.ts` mendapat bentuk `(c: pg.PoolClient, ctx: LedgerCtx, …)`; bentuk lama `(ctx, …)` tetap ada sebagai pembungkus satu-`withUser` untuk pemanggil tunggal.
- `loadBeranda(ctx, opts)` menjalankan semua bacaan **berurutan di satu `withUser`**; layout memuat `accounts` + `categories` di satu `withUser` (di-`cache` per request). Satu muat Beranda = maksimal 2 koneksi bersamaan.

- [ ] **Step 1: Tes gagal** `pool.int.test.ts`: instrumentasi `pool.on('acquire'/'release')` menghitung puncak koneksi bersamaan selama `loadBeranda` → ≤ 1; tiga muat Beranda paralel dengan pool `max: 5` → tanpa galat `network`; hasil `loadBeranda` sama persis dengan versi lama (snapshot VM atas data harness).
- [ ] **Step 2:** FAIL; **Step 3:** implementasi; **Step 4:** `test:int` + `e2e:ledger` PASS (tidak ada perubahan perilaku); commit `perf(web): Beranda membaca dalam satu transaksi`.

### Task 8: Server Actions S7 — **Model: terkuat**

**Files:** Modify `apps/web/src/app/[ruang]/_actions/{catat,entri,dompet,inputs}.ts`; Create `_actions/reimburse.ts`; Test `_actions/actions.test.ts`, `_actions/__int__/*.int.test.ts`.

**Interfaces:** (bentuk `return mutate|query('<nama>', actionContext(ruang), …)`, Zod di `inputs.ts`)
- `saveCatat` menerima `kind: 'space_transfer'` dengan `toRuang: 'pribadi' | 'bersama'` (server me-resolve `toSpaceId`, tidak pernah menerima uuid ruang dari klien) dan `reimbursable?: boolean` untuk `expense`.
- `moveEntryAction(ruang, { clientId, entryId, expectedVersion, toRuang, accountId, categoryId })`, `moveTargetsAction(ruang, toRuang)` (dompet aktif + kategori ruang tujuan), `reconcileAction(ruang, { clientId, accountId, actualBalance })`, `archiveAccountAction(ruang, accountId)`, `createReimbursementAction(ruang, {...})`, `openReimbursablesAction(ruang)`; `voidEntryAction`/`restoreEntryAction` menerima `space_transfer`.

- [ ] **Step 1: Tes gagal** `actions.test.ts`: tiap action baru lolos pemindai gerbang (`actionContext(` di baris pertama), mode prototipe menolak, Zod menolak `toRuang` lain dan `toSpaceId` mentah; int: `saveCatat` antar ruang dari `/bersama` ke Pribadi oleh F → kaki Pribadi F memuat keterangan, kaki Bersama hanya `shared_note`.
- [ ] **Step 2–4:** FAIL → implementasi → PASS; commit `feat(web): aksi transfer antar ruang, pindah, cocokkan, arsip, reimburse`.

### Task 9: Pangkas seed demo dari JS mode nyata (K3)

**Files:** Modify `apps/web/src/app/layout.tsx` (root), `apps/web/src/app/[ruang]/layout.tsx`, tes prototipe lama yang bergantung pada `DemoProvider` di root (daftar dari `grep -rl DemoProvider apps/web/src apps/web/tests`); Test `tests/e2e/budget.spec.ts`, `e2e:ledger` anotasi.

**Interfaces:** `DemoProvider` + seed hanya diimpor dari cabang `isPrototype()` (impor dinamis di server atau modul terpisah), sehingga chunk mode nyata tidak memuatnya.

- [ ] **Step 1: Tes gagal:** tambahkan asersi di `e2e:ledger`: tidak ada chunk JS rute nyata yang memuat penanda seed demo (string unik dari `packages/demo-data`, mis. nama dompet demo), dan Beranda nyata ≤ 157 kB (target headroom ≥ 5 kB; angka akhir dicatat, bukan konstanta budget).
- [ ] **Step 2:** FAIL; **Step 3:** implementasi + sesuaikan tes prototipe lama (perilaku prototipe tidak berubah: e2e prototipe 280 tetap hijau); **Step 4:** gerbang penuh PASS; commit `perf(web): seed demo tidak ikut JS mode nyata`.

### Task 10: Catat: transfer antar ruang dan talangan

**Files:** Modify `features/catat/{use-catat.tsx,catat-sheet.tsx,wallet-picker.tsx,type-menu.tsx,source.ts,demo-source.ts}`, `_real/catat-source-real.ts`; Test `features/catat/use-catat.test.ts`, `catat-sheet` tes terkait, `_real/catat-source-real.test.ts`.

**Interfaces:** `CatatSource` menambah `spaceTransferTargets(toRuang)` dan `save` menerima draf `space_transfer`/`reimbursable`; demo source memakai store demo (kaki bertaut seperti seed).

- [ ] **Step 1: Tes gagal:** pilih Transfer → dompet tujuan di ruang lain (bingkai `S7-C1`) → simpan memanggil `save({ kind: 'space_transfer', toRuang, … })`; dompet `kantor` tidak ditawarkan untuk antar ruang; field catatan Bersama hanya muncul saat Bersama terlibat; toggle Talangan (`S7-C2`) hanya di pengeluaran Pribadi dan reset saat pindah ruang/jenis; toast `Tersimpan di {Ruang} · {Rp} ke {Ruang tujuan}`; jalur tercepat pengeluaran tetap 3 ketukan (tes ketukan S6 tetap hijau).
- [ ] **Step 2–4:** FAIL → implementasi (bagian baru dimuat malas) → PASS.
- [ ] **Step 5:** Design reviewer atas screenshot 390/1280 terang/gelap; perbaiki; commit `feat(web): Catat transfer antar ruang dan talangan`.

### Task 11: Detail: Pindahkan, antar ruang, talangan

**Files:** Modify `_real/detail.tsx`, `_real/detail-client.tsx`, `_real/detail-islands.tsx`, `features/transaksi/{entry-detail.tsx,entry-detail-view.tsx,void-dialog*.tsx}`; Create `features/transaksi/move-sheet.tsx`, `features/transaksi/reimburse-sheet.tsx`; Test `_real/detail.test.tsx`, tes fitur terkait.

**Interfaces:** `detailAbilities` menambah `movable` (income/expense hidup, user anggota ≥ 2 ruang), `voidable` untuk `space_transfer` hanya bila `createdBy === userId`, `reimbursable: { remaining } | null`.

- [ ] **Step 1: Tes gagal:** "Pindahkan ke ruang lain" tampil sesuai `movable`, sheet memuat dompet/kategori ruang tujuan lewat `moveTargetsAction`, sukses → navigasi ke entri baru + toast; entri asal yang dipindah menampilkan salinan `entry_moved` tanpa Pulihkan; kaki antar ruang Bersama tidak menampilkan nama dompet Pribadi; Batalkan antar ruang oleh bukan pencatat tidak dirender; talangan: status sisa, "Catat reimburse" (sheet nominal default = sisa), "Tidak diganti" (dialog → `updateEntry` `reimbursable: false`), `reimbursement_exists` → salinan Task 1.
- [ ] **Step 2–4:** FAIL → implementasi (sheet dimuat malas) → PASS; **Step 5:** design reviewer; commit `feat(web): Detail pindah ruang, antar ruang, dan talangan`.

### Task 12: Dompet: Cocokkan saldo, saldo awal, arsip, Menunggu reimburse

**Files:** Modify `_real/dompet.tsx`, `_real/dompet-detail.tsx`, `_real/dompet-islands.tsx`, `features/dompet/*`; Create `features/dompet/reconcile-sheet.tsx`, `features/dompet/archive-dialog.tsx`, `features/dompet/reimburse-list.tsx`; Test `_real/dompet.test.tsx`, `_real/dompet-client.test.tsx`.

**Interfaces:** Detail dompet menerima `openingEntry: { id; editable }` dan `openReimbursables` (Pribadi saja).

- [ ] **Step 1: Tes gagal** (mengganti asersi S6 `queryByText(/Cocokkan saldo/)).toBeNull()`): Cocokkan saldo → pratinjau selisih bertanda, selisih 0 = tombol nonaktif dengan alasan; sukses → saldo baru + toast; "Ubah saldo awal" hanya bila `editable` dan menuju Detail entri saldo awal; Arsipkan saldo 0 → dompet pindah ke bagian terarsip, saldo ≠ 0 → penjelasan `S7-W3` tanpa tombol aktif; daftar Menunggu reimburse di Dompet Pribadi (tidak ada di Bersama); `name_taken` dari server tampil di sheet Tambah dompet (cek klien S6 tetap).
- [ ] **Step 2–4:** FAIL → implementasi → PASS; **Step 5:** design reviewer; commit `feat(web): Dompet cocokkan saldo, saldo awal, arsip, talangan terbuka`.

### Task 13: Beranda Bersama solo dan kosong

**Files:** Modify `_real/beranda.tsx`, `_real/beranda-islands.tsx`, `features/beranda/*`; Test `_real/beranda-steps.test.ts`, tes Beranda terkait.

**Interfaces:** `BerandaData` menambah `bersama: { members: number; isOwner: boolean; empty: boolean } | null` (dihitung di transaksi baca Task 7, tanpa koneksi tambahan).

- [ ] **Step 1: Tes gagal:** Bersama dengan 1 anggota → `S7-B1` tanpa avatar/nama F, ajakan Undang hanya bila `isOwner`; Bersama tanpa dompet/entri → `S7-B2` dengan aksi Tambah dompet; Bersama dua anggota tidak berubah dari S6.
- [ ] **Step 2–4:** FAIL → implementasi → PASS (Beranda ≤ 162 kB di kedua mode); **Step 5:** design reviewer; commit `feat(web): Beranda Bersama solo dan kosong`.

### Task 14: Utang UI S6

**Files:** Modify `features/catat/use-catat.tsx`, berkas critique terkait (`features/catat/catat-status.tsx`, `features/dompet/account-list-view.tsx`, `features/dompet/account-history-view.tsx`); Test tes masing-masing.

- [ ] **Step 1: Tes gagal:** `useCatat` tidak memanggil `source.*` di initializer `useState` (spy: 0 panggilan saat render pertama di StrictMode; panggilan terjadi di efek, satu kali); galat S6-C2 di mode keyboard 360×640 tidak terpotong ellipsis (teks utuh, boleh 2 baris); nama dompet 40 karakter di daftar Dompet ≤ 2 baris di 320 px; keterangan riwayat dompet tetap terbaca dengan nominal `Rp 12.345.678.900` di 320 px (nominal tidak terpotong, keterangan ellipsis 1 baris dengan `title`).
- [ ] **Step 2–4:** FAIL → implementasi → PASS; **Step 5:** design reviewer; commit `fix(web): utang S6 (initializer useCatat, temuan critique)`.

### Task 15: Worker minimal `apps/worker` — **Model: terkuat**

**Files:** Create `apps/worker/{package.json,tsconfig.json,vitest.config.ts,build.mjs}`, `apps/worker/src/{config,run-job,alert,jobs,index}.ts`, tes `apps/worker/src/*.test.ts`, `apps/worker/src/__int__/worker.int.test.ts`; Modify `.github/workflows/ci.yml` (int worker di job `db`), root `package.json` bila skrip perlu.

**Interfaces:**
- `config.ts`: `loadConfig(env) → { databaseUrl; hc: { dq?: string; jobs?: string } }` (Zod; URL HC opsional, kosong = alert dilewati dengan log `alert_skipped`).
- `run-job.ts`: `runJob(pool, job: JobDef, alert: Alerter) → Promise<JobResult>`; menyisipkan `jobs.job_runs` (`running`), memanggil SQL job, menutup baris dengan `ok`/`failed` + `error_code` (SQLSTATE atau `timeout`/`unknown`, ≤ 40 char) + `rows`; baris `running` yatim > 1 jam ditutup `status = 'failed'`, `error_code = 'abandoned'` saat worker start.
- `jobs.ts`: `JOBS: JobDef[]`: `dq_reconcile` `0 1 * * *`, `purge_idempotency` `20 1 * * *`, `purge_unfinished_users` `25 1 * * *`, `purge_audit` `30 1 * * *`, `purge_voided` `15 1 * * 1` (Senin, AFD §5 "mingguan"), semua `tz: 'Asia/Jakarta'`, tidak bentrok dengan backup 02:00 dan uji restore Minggu 04:00.
- `alert.ts`: `healthchecks(url) → Alerter` dengan `start()`, `ok(body)`, `fail(body)`; body hanya `job=<nama> code=<kode>` atau baris `DQ04b error 1`. `dq_reconcile`: semua `violations = 0` → `ok`; ada pelanggaran (error **atau** warn) → `fail` dengan daftar cek > 0. Job lain memakai check `jobs`.
- `index.ts`: pg-boss (`schema: 'pgboss'`, satu instance, `singletonKey` per job agar tidak tumpang tindih), `SIGTERM` → `boss.stop({ graceful: true })`.

- [ ] **Step 1: Spike hak (gerbang Task 5):** di Postgres lokal yang sudah dimigrasi, jalankan pg-boss 12.38.0 sebagai `dompetku_worker` dengan `schema: 'pgboss'`: start, schedule, kirim job, stop. Harapan: tanpa galat izin. Gagal = catat galatnya, kembali ke Task 5, jangan memberi `CREATE` database.
- [ ] **Step 2: Tes gagal unit:** `runJob` sukses → urutan query `insert … running` lalu `update … ok, rows`; galat `57014` → `failed`, `error_code = '57014'`, `alert.fail` dipanggil dengan body tanpa angka selain jumlah pelanggaran; `dq_reconcile` dengan baris `[{DQ01,error,0},…,{DQ10,warn,2}]` → `fail('DQ10 warn 2')`; semua 0 → `ok`; cron `0 1 * * *` dengan tz Asia/Jakarta → kejadian berikutnya dari `2026-11-03T17:59:00Z` = `2026-11-03T18:00:00Z`; tidak ada log/alert yang memuat string mirip nominal (`/\d{4,}/` selain id cek dan tahun di timestamp).
- [ ] **Step 3: Tes gagal int** (`worker.int.test.ts`, Postgres CI + server HTTP stub Healthchecks lokal): migrasi bersih → `runJob(dq_reconcile)` → `job_runs` `ok`, stub menerima ping sukses; DB dimatikan (pool ke port mati) → `failed` + stub menerima `/fail`; dua `runJob` bersamaan untuk job sama lewat pg-boss → satu yang jalan.
- [ ] **Step 4:** FAIL → implementasi → **Step 5:** `pnpm --filter worker test` + int PASS; `pnpm lint && pnpm typecheck` mencakup paket baru; commit `feat(worker): worker minimal pg-boss dengan dq_reconcile dan alert Healthchecks`.

### Task 16: Worker di image, compose, dan deployer (K1)

**Files:** Modify `apps/web/Dockerfile` (tahap build menjalankan `pnpm --filter worker build`, runtime menyalin `apps/worker/dist/worker.mjs` ke `/app/worker/worker.mjs`), `infra/db-vm/compose.yml` (layanan `worker`: `image: dompetku-web:current`, `pull_policy: never`, `profiles: [web]`, `command: ['worker/worker.mjs']`, `env_file: ./env/worker.env`, networks `internal` + jaringan baru `worker_egress` (hanya worker, untuk Healthchecks), `read_only`, `cap_drop: [ALL]`, `user: '65532:65532'`, `mem_limit: 256m`, `cpus: 0.5`), `infra/db-vm/deploy/deploy` (ganti `web` lalu `worker`; health worker = container `running` dan `RestartCount` tidak naik selama 20 detik; rollback mengembalikan keduanya), `infra/db-vm/deploy/test/deploy-test.sh`, `infra/db-vm/deploy/README.md`; Create `infra/db-vm/deploy/worker.env.example`, `docs/ops/runbook-s7-worker.md`.

- [ ] **Step 1: Tes gagal** `deploy-test.sh` (harness palsu docker yang sudah ada): rilis baru mengganti `web` dan `worker`; worker restart berulang → kode 3, keduanya kembali ke digest lama; `worker.env` tidak ada → web tetap terpasang, worker dilewati dengan log `worker_env_missing` (deploy pertama sebelum pemilik mengisi env tidak gagal).
- [ ] **Step 2:** FAIL → **Step 3:** implementasi → **Step 4:** `bash infra/db-vm/deploy/test/deploy-test.sh` PASS; `docker build --platform linux/arm64` lokal bila tersedia, bila tidak cukup job `release` di PR (catat); image runtime `node worker/worker.mjs --check-config` keluar 0 dengan env contoh.
- [ ] **Step 5:** `runbook-s7-worker.md` dengan langkah **[PEMILIK]**: buat 2 check Healthchecks (`dompetku-dq` jadwal harian 01:00 WIB grace 2 jam; `dompetku-jobs` harian grace 2 jam), isi `/opt/dompetku/env/worker.env` (`DATABASE_URL` role worker `sslmode=verify-full`, `HC_DQ_URL`, `HC_JOBS_URL`), salin `compose.yml` baru, verifikasi tanpa mencetak rahasia, latihan gagal (salahkan sementara `DATABASE_URL` → alert diterima), dan rollback pemasangan. Commit `feat(infra): worker ikut rilis dan deployer`.

### Task 17: E2E mode nyata S7 + CI

**Files:** Modify `apps/web/tests/e2e-auth/*.spec.ts` (`e2e:ledger`), `apps/web/tests/e2e/budget.spec.ts`, `.github/workflows/ci.yml`.

- [ ] **Step 1: Tes** `e2e:ledger` baru: setor Pribadi → Bersama via Catat lalu kanari: rute Bersama (navigasi klien + reload, HTML + payload RSC) tidak memuat nama dompet Pribadi, keterangan Pribadi, atau `PRIBADI_KANARI`; Batalkan satu kaki → kedua ruang kembali; talangan → reimburse sebagian → sisa di Dompet; Pindahkan ke Bersama → entri asal tidak di Sampah; Cocokkan saldo; arsip dompet saldo 0; Bersama solo (persona N tanpa F); keyboard-only untuk Cocokkan saldo dan Pindahkan; axe 0 serious/critical terang/gelap 320/390/1280 di layar baru; anotasi `js-route-kB` semua rute ≤ 162 kB.
- [ ] **Step 2:** Jalankan sampai hijau (perbaikan masuk task pemilik kodenya bila temuan nyata); CI menjalankan int worker (Task 15) dan `deploy-test.sh`; commit `test(e2e): kriteria keluar S7 di mode nyata`.

### Task 18: Penutup: dokumen, critique, Delivery Gate, PR

**Files:** Modify `docs/product/BSD.md` §16 ("Catatan S7": fungsi baru dan bentuk finalnya, DQ yang ditunda, aturan `moved_to_entry_id`, skema `pgboss`), `docs/product/IPD.md` §4 (status S5 worker + S7), `CLAUDE.md` (Status, Tertunda), `docs/design/s7-bingkai.md` (keputusan penutup); Create `docs/superpowers/handoff/s7.md`.

- [ ] **Step 1:** Design critique atas pratinjau prototipe layar S7 + Delivery Gate antislop (skill `antislop` bila tersedia; bila tidak, daftar periksa tertulis seperti S6, dicatat).
- [ ] **Step 2:** Gerbang penuh: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`, `pnpm build`, `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`, `test:int`, `e2e:auth`, `e2e:ledger`, `pg_prove` semua, int worker, `deploy-test.sh`. Catat angka.
- [ ] **Step 3:** Review akhir seluruh branch (model terkuat) + review keamanan (uang/DB/infra); perbaiki temuan.
- [ ] **Step 4:** Dokumen + handoff; commit `docs: catatan S7`; PR ke `main` (template PR bila ada). Merge hanya sesudah CI hijau di head PR **dan** pemilik menjalankan `cek-duplikat-dompet-0109.sh` (hasil 0).

---

## Kriteria keluar S7 (IPD §4) dan task yang membuktikannya

| Kriteria | Bukti |
| --- | --- |
| Transfer dalam ruang dan antar ruang (`link_id`, pasangan, void bersama, keterangan Bersama → Pribadi di sisi Pribadi) | DB sudah ada (pgTAP 07/08/99 S5 tetap hijau); UI dan aksi: Task 6, 8, 10, 11, 17 |
| Talangan bukan pengeluaran pribadi; biaya Kas Kantor masuk angka Kantor | Task 3 (`period_summary`), Task 17 |
| `dq_reconcile` 01:00 WIB di worker, alert tanpa nominal | Task 5, 15, 16 |
| Bersama solo dan kosong | Task 13, 17 |
| Tes konkurensi | Task 2 (kategori), 99_konkurensi S5 tetap hijau |
| ID tes M1 (PRD §6.2) hijau | S6 + Task 17; daftar T/S/B dipetakan ulang di handoff S7 |
| `dq_reconcile` hijau | Task 5 (`17_dq`), Task 15 int |
| Hari pertama pakai dimulai | Sesudah merge + deploy + pemilik menyelesaikan `docs/ops/auth.md` dan `runbook-s7-worker.md` (bukan kriteria sprint) |
| Utang S6 (#6–#8) | Task 2, 6, 7, 9, 12, 14 |

## Di luar cakupan

`api.update_transfer` (ubah transfer = Batalkan + catat ulang; BSD tetap mencatatnya "belum ditulis"); DQ02 checkpoint (S10); tagihan/anggaran (S9); Farida bergabung (S8); utang kecil CLAUDE.md #7 (`99_konkurensi` meninggalkan `env='test'`, dbmate `--strict`).

## Pertanyaan terbuka untuk pemilik

1. K1–K3 di atas.
2. IPD menyebut "10 cek" DQ; plan ini mencapai 10 dengan DQ11 (reimburse) dan DQ12 (pindah ruang) sambil menunda DQ02 ke S10. Setuju?
