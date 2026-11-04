# DompetKu v2 · M2 S8 (Bersama penuh, Farida bergabung) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ruang Bersama untuk dua orang berjalan di mode nyata: feed aktivitas Bersama (pelaku, sebelum/sesudah, label R26 untuk entri yang dipindah, tanpa data Pribadi), kontribusi per orang, dan Farida bergabung lewat undangan email lalu langsung memakai Pribadi kosong + Bersama dengan checklist 3 langkah. Setoran dan ambil Bersama sudah ada sejak S7 (transfer antar ruang). S8 menambah penyajiannya di feed dan Kontribusi, plus bukti e2e dua user. Sesudah merge dan Farida bergabung, S9 (anggaran, laporan) bisa dimulai; gerbang M2 (7 hari dua akun) baru dihitung sesudah S10.

**Architecture:** Pola S6/S7: DB dulu (migrasi `0114`–`0115` + pgTAP dua user, fungsi baca baru ditulis test-first), lalu loader server `apps/web/src/server/ledger/bersama.ts` di transaksi baca yang sama dengan Beranda (Task 7 S7: satu `withLedger` per muat), lalu UI. **Feed dan Kontribusi adalah bacaan murni di Server Component.** Tidak ada Server Action baru, tidak ada JS klien baru di mode nyata. Teks feed disusun di fungsi murni `features/bersama/activity-text.ts` dari baris DB (BSD §1.1: SQL menghitung angka, aplikasi menyusun teks). Mode prototipe tetap memakai `activityFeed` demo. Kontribusi demo dimuat malas.

**Tech Stack:** tanpa dependensi baru. Next.js 16.4.3, React 19.3, `pg` 8.23.1, Zod 4.6.7, Postgres 17.11 + dbmate 2.36.0 + pgTAP, Vitest, Playwright 1.64.1 + `@axe-core/playwright`.

**Spec:** `docs/product/IPD.md` §5 S8 (+ §2, §8 utang desain "Bersama solo dan kosong, checklist Beranda Farida" dan "Setoran, feed, kontribusi"); `docs/product/PRD.md` §5 M2 (cerita F bergabung, setoran/feed/kontribusi, ambil Bersama), §6.1, §6.2 baris M2; `docs/product/AFD.md` §1 (onboarding Farida, Beranda pertama), §4 (antar ruang), §6 (undang); `docs/product/BSD.md` §1.1, §2.2 butir 5, §8 (`api.activity_feed`, `app.report_lines`, kelas `x_setoran_anggota`/`x_diambil_anggota`), §16 "Catatan S7"; `docs/team/round1/qa.md` R4 (B3–B6, B20), R1 (registry); `docs/design/s7-bingkai.md` (S7-B1/B2, S7-D1, T5); `docs/superpowers/handoff/s7.md` ("Yang dibawa ke S8", peta ID tes); `docs/superpowers/handoff/s7-ledger.md` (R9, R24–R28). Bila beda, BSD menang untuk nama fungsi/kolom, spec induk §9 menang untuk perilaku.

## Status awal (diperiksa dari repo, 2026-11-04)

| Bagian | Sudah ada | Dibangun S8 |
| --- | --- | --- |
| Undangan (S4) | `api.create/revoke/decline/accept_invitation`, `invitation_peek`, `list_invitations` (0007, 0010); rute `/undang`, `/terima-undangan`, `/buat-akun`, `/amankan` mode nyata; email lewat Resend (`server/auth/mailer.ts`); `e2e:auth` menguji undang → terima → TOTP → Diterima → B1 hilang | Tidak ada fitur baru. Bukti ledger dua user (Task 5, 10) dan salinan sisi Farida (Task 8) |
| Onboarding Farida | `accept_invitation` membuat Pribadi F + anggota Bersama; kategori awal lewat trigger `tg_seed_categories`; `berandaSteps` memberi F 3 langkah (langkah `undang` hanya untuk pemilik); `bersamaView` menghapus B1 saat anggota ≥ 2 | Bukti e2e, salinan berbasis roster (bukan "Farida" tetap di layar milik Farida), pengantar checklist B1 (T5) |
| Setoran / ambil | `api.create_transfer` antar ruang, Catat S7-C1, Detail S7-D1 ("Setoran dari {Nama}"/"Diambil oleh {Nama}"), kanari `s7.spec` untuk satu user | Feed + Kontribusi, biaya kaki keluar Bersama (utang S7 M6), e2e B3/B5/B6 dua user |
| Feed | `api.activity_feed` (0102) tanpa deskripsi, kategori, catatan, `moved_at`, dan kursor; tidak dipanggil web. Prototipe: `ActivityFeed` klien dari `activityFeed` demo. Mode nyata: Beranda Bersama dua anggota **tidak merender Aktivitas** (hanya kartu kosong B1 saat solo) | `api.shared_activity` (Task 2), loader + teks (Task 4), kartu Beranda (Task 6), halaman Aktivitas (Task 7, K5) |
| Kontribusi | Kelas `x_setoran_anggota` ("Kontribusi") di `report_class`; **tidak ada fungsi per orang**; prototipe tidak punya kartu Kontribusi (hanya kategori pemasukan `Kontribusi Farida`) | `api.member_contributions` (Task 3), kartu (Task 6) |
| Registry ID tes | belum ada (`REGISTRY.md`, `scripts/check-test-registry.ts` disebut PRD §6 tetapi tidak ada) | Task 11 |

Infra pasca-S7: PR #17 (commit 6d12ba1) memindahkan network `worker_db` ke `172.16.25.0/24` (di luar pool Docker; `172.25.0.0/16` bertabrakan dengan `dompetku_egress` di VM produksi). Nilai itu sumber kebenaran di `compose.yml`, `pg_hba.conf`, BSD §16, `s7.md`, dan runbook. S8 tidak menyentuh infra.

## Prasyarat dari pemilik

Agen tidak bisa menjalankan langkah ini. S8 tetap bisa dikerjakan sampai PR siap sebelum semuanya selesai.

| # | Prasyarat | Dibutuhkan untuk | Dokumen |
| --- | --- | --- | --- |
| P1 | S7 live: image postgres dibangun ulang (`pg_hba.conf`, network `worker_db` 172.16.25.0/24) **sebelum** `worker.env`; worker jalan; check Healthchecks `dompetku-dq`/`dompetku-jobs` | Merge S8 (deploy menjalankan `0114`–`0115`); feed bergantung pada ledger S7 di produksi | `docs/ops/runbook-s7-worker.md` |
| P2 | `dompetku-psql` terpasang (`ops.env`, check `dompetku-manual-access`) | Langkah 5 `auth.md` | `docs/ops/akses-db-manual.md` |
| P3 | `auth.md` langkah 1–6: Resend SPF/DKIM (+DMARC), `web.env`, `owner_email`, bootstrap akun Novanda | Email undangan sungguhan | `docs/ops/auth.md` |
| P4 | Alamat email Farida (diketik pemilik di `/undang`, tidak lewat chat) dan perangkat Farida dengan passkey atau aplikasi autentikator | Farida bergabung (`auth.md` langkah 7) | AFD §1, §6 |
| P5 | Jawaban K1–K6 (default = rekomendasi) | Task 1 dan Task 2–7 | bagian berikut |

**Bisa dikerjakan sebelum Farida benar-benar bergabung:** semua task. Persona F ada di pgTAP (`tests.web_exec` dua user), `test:int` (harness `accept_invitation` yang sudah ada), dan e2e dua user baru (Task 5: F diundang lewat mail file lokal, TOTP dari `e2e-auth/helpers.ts`). Yang hanya bisa dibuktikan sesudah P1–P4: email Resend sampai ke kotak masuk Farida, dan pemakaian nyata dua orang (gerbang M2, sesudah S10).

## Keputusan pemilik yang dibutuhkan (rekomendasi agen = default plan ini)

| # | Keputusan | Rekomendasi | Alasan | Bila pemilik memilih lain |
| --- | --- | --- | --- | --- |
| K1 | Nama dompet di feed Aktivitas | **Tidak ada nama dompet sama sekali** (juga dompet Bersama). Feed = siapa, apa, berapa, kapan; dompet tetap terlihat di Detail dan daftar Transaksi (R9) | Bunyi IPD dan PRD harfiah ("feed tidak pernah memuat nama dompet"); kanari jadi lebih kuat (tidak ada kolom dompet di fungsi); baris lebih pendek di 320 | Dompet Bersama boleh: `shared_activity` menambah `account_id` dompet Bersama, teks menambah ` · {dompet}`, kanari tetap melarang dompet Pribadi (±1 langkah di Task 2 dan 4) |
| K2 | Definisi angka Kontribusi | **Per pencatat, per periode: `Setor` = Σ kaki masuk Bersama (`x_setoran_anggota`, line `main`); `Diambil` = Σ kaki keluar Bersama (`x_diambil_anggota`, `main`, tanpa biaya).** Kartu menampilkan `Setor` sebagai angka utama dan `Diambil` sebagai baris kedua bila > 0. Tidak ada angka bersih, persentase, atau peringkat | Selaras BSD §8.1 (kelas 8 "Kontribusi"); biaya transfer adalah pengeluaran Bersama (`expense_fee`), bukan pengurang kontribusi; angka bersih bisa negatif dan terbaca seperti "utang ke pasangan", padahal bagi tagihan baru M3 | Bersih (`Setor − Diambil`) sebagai angka utama: hanya salinan dan VM berubah, fungsi DB tetap |
| K3 | Periode Kontribusi | **Bulan kalender WIB berjalan** di S8; fungsi menerima `p_from`/`p_to`, jadi S9 cukup mengganti pemanggil ke `app.pay_period` (§8.2a, gajian 25 untuk Pribadi dan Bersama) | Periode gajian baru dibangun di S9 bersama anggaran; membuat dua definisi periode di S8 berisiko beda angka dengan laporan S9 | Periode gajian di S8: `app.pay_period` ditarik maju ke Task 3 (+1 migrasi, `app.holidays`, risiko S9 berubah) |
| K4 | Pemasukan Bersama berkategori `Kontribusi Farida` (kategori awal 0106) | **Tidak dihitung sebagai kontribusi.** Kontribusi hanya dari setoran antar ruang | Pemasukan Bersama bisa berupa refund atau hadiah; menebak dari nama kategori rapuh. Bila Farida menyetor tanpa mencatat sisi Pribadinya, ia tetap bisa memakai Catat → Transfer ke Bersama dari Pribadi yang punya dompet | Dihitung: `member_contributions` menambah kolom `pemasukan_kontribusi` = Σ `income` berkategori yang ditandai (butuh penanda kategori di DB, bukan nama; +1 kolom `categories`, migrasi tambahan) |
| K5 | Halaman Aktivitas penuh | **Ya, ringan: `/bersama/aktivitas`** (Server Component, 30 baris per halaman, `Muat sebelumnya` = tautan `?sebelum=` berkursor), dibuka dari `Lihat semua` di kartu Beranda | Beranda hanya 5 baris; perubahan sebelum/sesudah (B20) cepat tergeser. Biaya JS nol (tanpa pulau klien) | Tidak: Task 7 dihapus; kartu Beranda tanpa `Lihat semua`; kursor di `shared_activity` tetap ada (murah, dipakai S9) |
| K6 | Waktu mengundang Farida | **Sesudah S8 live dan P1–P3 selesai; tidak menunggu 7 hari M1 selesai** | Merge S8 aman kapan saja (expand-only; feed dan Kontribusi tidak dirender selama Bersama solo). Hitungan M2 baru sesudah S10, jadi Farida punya waktu membiasakan diri | Menunggu gerbang M1: tidak mengubah plan, hanya urutan langkah pemilik |

Keputusan kecil yang diambil agen di plan ini (biaya bila salah ditulis di tasknya): tidak ada tabel baru (S8 hanya fungsi baca), jadi "isolasi penuh pada tabel baru" dibuktikan pada fungsi baru dan jalur baca baru; fungsi feed baru bernama `api.shared_activity` (tidak mengganti `api.activity_feed` agar migrasi tetap expand-only); kartu Kontribusi dan Aktivitas tidak dirender selama Bersama solo; nama pelaku di feed selalu nama (bukan `kamu`) agar sama bagi kedua anggota (pola judul S7-D1); warna avatar ditentukan peran (pemilik netral, anggota violet), bukan huruf `F`; peristiwa "Farida bergabung" tidak masuk feed (feed hanya dari `entry_history`).

## Global Constraints

**Semua Global Constraints rencana S6 dan S7 berlaku tanpa perubahan** (`docs/superpowers/plans/2026-11-01-dompetku-v2-s6-catat.md` dan `2026-11-03-dompetku-v2-s7-transfer-talangan.md`, bagian Global Constraints: proses, aturan M1, kontrak `api.*`, migrasi, Catat dan event produk, desain dan aksesibilitas, salinan tetap, transfer antar ruang). Ruling S7 R9, R24–R28 tetap mengikat. Konteks subagent: salin `docs/superpowers/handoff/s7-konteks-subagent.md` menjadi `s8-konteks-subagent.md` (nomor sprint, branch, angka, baris `Claude-Session:`). Tambahan S8:

- Branch kerja: `claude/m2-s8-bersama` dari `main` terbaru, atau branch yang ditetapkan sesi. PR ke `main`; merge hanya bila CI hijau di head PR dan review task + keamanan bersih (CLAUDE.md). Merge = deploy + migrasi `0114`–`0115` di produksi.
- Migrasi S8 bernomor `0114` ke atas; tes pgTAP baru `18_` ke atas. **Expand-only**: fungsi baru, tanpa drop/rename, tanpa mengubah tanda tangan fungsi yang sudah dipanggil web (rollback deployer hanya mengganti image).
- **Batas privasi feed dan Kontribusi (kriteria keluar IPD):** fungsi dan VM tidak pernah memuat `account_id`, nama dompet (K1), `link_id`/`linkedEntryId` (R24), id entri ruang lain, deskripsi kaki antar ruang, atau baris ruang Pribadi. Satu-satunya teks bebas dari kaki antar ruang adalah `shared_note`. Fungsi baru `SECURITY INVOKER` (RLS FORCE berlaku), `assert_member` di awal, ruang Pribadi = 0 baris.
- **Aturan budget S8 (setara R28):** headroom Beranda prototipe tinggal 0,5 kB (161,5/162), nyata 4,6 kB (157,4). (a) Feed, Kontribusi, dan halaman Aktivitas mode nyata dirender di Server Component tanpa `'use client'` dan tanpa pulau klien baru; komponen tampilannya tidak boleh mengimpor `@dompetku/demo-data`, `features/shell/demo-context`, atau modul klien. (b) Setiap tambahan di jalur prototipe (kartu Kontribusi demo, perubahan `ActivityFeed`) dimuat malas (`lazy` + `Suspense`, pola `beranda-states`) atau tidak ditambahkan. (c) Setiap task UI melapor angka budget prototipe dan nyata untuk Beranda, Transaksi, dan Aktivitas; berhenti dan minta keputusan pemilik bila > 162 kB, jangan menaikkan konstanta.
- Bacaan Bersama baru masuk transaksi baca Beranda yang sudah ada (`loadBeranda`, satu `withLedger`), hanya untuk ruang `shared` dengan anggota ≥ 2. Satu muat Beranda tetap ≤ 2 koneksi bersamaan (`pool.int.test.ts`).
- Persona tes: **N** (pemilik), **F** (anggota, bergabung lewat undangan), **Luar** (user tanpa rumah tangga), dengan kanari Pribadi per orang (`KANARI-N-*`, `KANARI-F-*`, nominal unik) seperti qa.md R4.
- Tes baru memberi tag ID registry (Task 11): pgTAP `-- ID: B20`, Vitest `it('… [B20]')`, Playwright `{ tag: ['@B20'] }`.

## Review Focus

1. **Feed membocorkan Pribadi lewat snapshot:** `entry_history.snapshot` = `to_jsonb(entries)` + lines, jadi memuat `link_id`, `account_id`, dan untuk entri yang dipindah, `moved_at`. N menyetor dari `KANARI-DOMPET-N` dengan keterangan `KANARI-N-SETOR`, F mengambil ke `KANARI-DOMPET-F` dengan keterangan `KANARI-F-AMBIL`, lalu N memindahkan entri Bersama ke Pribadi. Harapan: keluaran `shared_activity` (semua kolom, `::text`) dan HTML + payload RSC `/bersama/beranda` dan `/bersama/aktivitas` untuk N **dan** F tidak memuat kanari mana pun, `link_id`, atau id entri Pribadi. Tes: Task 2 (pgTAP), Task 4 (int), Task 10 (e2e dua user).
2. **Sebelum/sesudah yang menyesatkan:** F mengubah pengeluaran N Rp 50.000 → Rp 75.000, lalu N mengubah kategorinya, lalu F membatalkan, lalu N memulihkan. Harapan: empat baris berurutan, pelaku benar per baris, `before_amount` = nominal versi sebelumnya (bukan versi pertama), kategori lama/baru benar, entri dipindah memakai label R26 tanpa judul. Tes: Task 2, Task 4 (unit teks), Task 10.
3. **Kontribusi salah hitung:** setoran yang dibatalkan, setoran dengan biaya, ambil oleh F dengan biaya dari dompet Bersama, setoran 31 Okt 23:30 WIB, dan pemasukan berkategori `Kontribusi Farida`. Harapan: void tidak dihitung, biaya tidak mengurangi `Setor`/`Diambil`, 31 Okt masuk Oktober (T13/Z1), pemasukan biasa tidak dihitung (K4), anggota tanpa setoran tetap muncul dengan 0. Tes: Task 3.
4. **Akses Luar dan ruang Pribadi:** Luar memanggil kedua fungsi dengan id Bersama N → `DK404`; F memanggil dengan id Pribadi N → `DK404` seragam; N memanggil dengan id Pribadinya → 0 baris; rute `/pribadi/aktivitas` → 404. Tes: Task 2, 3, 7.
5. **E2E dua user mengganggu tes satu user:** `s7.spec` dan `screens-s7` mengandalkan Bersama solo (B1). Bila F bergabung di DB e2e yang sama, B1 hilang dan tes lama gagal atau, lebih buruk, lulus karena hal yang salah. Harapan: suite dua user berjalan di konfigurasi Playwright terpisah dengan reset DB sendiri. Tes: Task 5.

---

## Peta berkas

| Area | Berkas |
| --- | --- |
| DB | `packages/db/migrations/0114_feed_bersama.sql`, `0115_kontribusi.sql`; `packages/db/tests/18_feed_bersama.sql`, `19_kontribusi.sql`; tambahan di `00_katalog.sql`, `08_ledger_isolasi.sql`; `packages/db/README.md` (tabel migrasi) |
| Server | `apps/web/src/server/ledger/bersama.ts` (baru), `server/ledger/beranda.ts`, `server/ledger/__int__/bersama.int.test.ts` (baru), `__int__/beranda.int.test.ts`, `__int__/pool.int.test.ts`, `__int__/harness.ts` |
| Fitur (presentasional) | `apps/web/src/features/bersama/{activity-text.ts,activity-text.test.ts,activity-card-view.tsx,activity-item-row.tsx,contribution-card-view.tsx,types.ts}` (baru) |
| UI nyata | `apps/web/src/app/[ruang]/_real/beranda.tsx`, `_real/beranda-steps.ts`, `_real/aktivitas.tsx` (baru), `app/[ruang]/aktivitas/page.tsx` (baru), `_real/detail.tsx` (biaya), `features/beranda/bersama-views.tsx` |
| Prototipe | `apps/web/src/app/[ruang]/beranda/view.tsx`, `features/beranda/activity-feed.tsx`, `features/beranda/contribution-demo.tsx` (baru, dimuat malas), `packages/demo-data/src/select/kontribusi.ts` (baru) |
| E2E | `apps/web/playwright.bersama.config.ts` (baru), `apps/web/tests/e2e-bersama/{global-setup,fixtures,s8.spec,screens-s8.spec}.ts` (baru), `apps/web/package.json` (`e2e:bersama`), `tests/e2e/budget.spec.ts`, `.github/workflows/ci.yml` (job `auth`) |
| Registry | `packages/db/tests/REGISTRY.md` (baru), `scripts/check-test-registry.ts` (baru), root `package.json`, job CI `check` |
| Dokumen | `docs/design/s8-bingkai.md` (baru) + `docs/design/s8/`, BSD §16 "Catatan S8", IPD §5 status, `CLAUDE.md`, `docs/superpowers/handoff/s8.md` (baru), `docs/superpowers/handoff/s8-konteks-subagent.md` (baru) |

---

### Task 1: Bingkai desain S8 (gerbang awal) · Model: sonnet + kursi design reviewer

**Files:** Create `docs/design/s8-bingkai.md` (format `s7-bingkai.md`); screenshot prototipe Beranda Bersama yang ada ke `docs/design/s8/` bila membantu (R8 S7: layar baru belum ada, foto layar jadi di Task 12).

**Interfaces:** Produces salinan tetap dan keadaan yang dikutip Task 4, 6, 7, 8, 9 (`S8-A1` dan seterusnya).

- [ ] **Step 1:** Tulis bingkai (pola Panel Malam, DBD §9, aturan bersama S6/S7 + batas privasi S8):
  - `S8-A1` kartu Aktivitas Beranda Bersama (anggota ≥ 2): 5 baris `ActivityRow`, judul `Aktivitas`, `Semua` + sr-only `aktivitas Bersama` (K5, R3), keadaan kosong dua anggota (`Belum ada aktivitas. Yang kamu dan {Nama} catat di Bersama akan muncul di sini, terbaru di atas.`, nama dari roster, bukan "Farida" tetap), urutan di HP dan laptop (prototipe: kolom kanan di atas Terbaru).
  - `S8-A2` **matriks teks peristiwa** (op × kind × arah): `create`/`update`/`void`/`restore` untuk `expense`, `income`, `transfer` (dalam Bersama), `space_transfer` masuk (`menyetor ke Bersama`, + `· {catatan}` bila `shared_note`) dan keluar (`mengambil dari Bersama`), `adjustment` (`mencocokkan saldo`); `update` dengan nominal berubah `{Rp lama} → {Rp baru}`, kategori berubah `{lama} → {baru}`, lainnya `mengubah {judul}`; void entri dipindah = `memindahkan transaksi ke ruang lain` (R26, tanpa judul dan nominal tetap tampil). Tanpa nama dompet (K1). Panah bukan satu-satunya penanda (teks `sr-only` `dari … menjadi …`).
  - `S8-A3` halaman Aktivitas `/bersama/aktivitas` (K5): daftar berkelompok per hari (`dayLabel`), 30 baris, `Muat sebelumnya`, keadaan kosong, Pribadi tidak punya tab/tautan ini.
  - `S8-K1` kartu Kontribusi (K2, K3): judul `Kontribusi {bulan}`, satu baris per anggota (avatar, nama, `Setor {Rp}` utama, `Diambil {Rp}` sekunder bila > 0), tanpa peringkat, persentase, atau warna menang/kalah; keterangan `Setoran dan pengambilan antar ruang bulan ini.`; tidak dirender selama Bersama solo.
  - `S8-O1` Beranda pertama Farida di Pribadi (kosong, checklist 3 langkah `Akun aman`, `Tambah dompet sehari-hari`, `Catat satu pengeluaran`; `1 dari 3 selesai`; tanpa `Undang Farida`, tanpa langkah pengganti, AFD §1).
  - `S8-O2` Beranda Bersama pertama bagi Farida (dompet dan entri N sudah ada): tanpa B1, pengantar checklist bila ada, Aktivitas dan Kontribusi tampil.
  - `S8-B1a` pengantar checklist B1 tanpa pengulangan (T5): usulan `Ruang untuk pengeluaran rumah tangga.` saat kartu ajakan tampil.
  - `S8-D1a` baris `Biaya` di Detail kaki keluar Bersama dan meta daftar (utang S7 M6).
- [ ] **Step 2:** Tabel salinan final S8 (mengikat Task 4–9), tanpa nominal di pesan galat; galat muat feed/Kontribusi memakai pola `State` galat S6 (`Aktivitas belum bisa dimuat.` + `Coba lagi` sebagai tautan muat ulang, tanpa JS).
- [ ] **Step 3:** Kursi design reviewer (reviewer yang di-dispatch controller, R7) menilai bingkai terhadap `DESIGN.md`; perbaiki temuan; commit `docs(desain): bingkai S8`.

### Task 2: Migrasi 0114 feed Bersama · Model: terkuat

**Files:** Create `packages/db/migrations/0114_feed_bersama.sql`, `packages/db/tests/18_feed_bersama.sql`; Modify `00_katalog.sql` (daftar fungsi INVOKER + matriks hak), `08_ledger_isolasi.sql` (daftar fungsi baca untuk ruang Pribadi pasangan = `DK404`, BSD §13 butir 12), `packages/db/README.md`.

**Interfaces:**

- Produces `api.shared_activity(p_space_id uuid, p_limit int default 20, p_before_at timestamptz default null, p_before_entry uuid default null, p_before_version int default null) returns table (entry_id uuid, version int, op app.history_op, kind app.entry_kind, direction app.entry_direction, actor_id uuid, at timestamptz, occurred_on date, amount bigint, before_amount bigint, category_id uuid, before_category_id uuid, description text, shared_note text, moved boolean)`.
- `SECURITY INVOKER`, `stable`, `search_path = ''`; `assert_member` di awal; `p_limit` 1–100 (`DK400 limit`); kursor ketiganya NULL atau ketiganya terisi (`DK400 cursor`); urut `(changed_at, entry_id, version)` turun, kursor = baris sesudah triple itu.
- Hanya ruang `kind = 'shared'` (Pribadi = 0 baris, pola `activity_feed`); tanpa `opening_balance`.
- `before_*` dari versi `version − 1` entri yang sama (join PK `entry_history (entry_id, version)`, bukan `lag` atas seluruh riwayat ruang: kursor dan kinerja); NULL untuk `create`.
- `description` = NULL untuk `kind = 'space_transfer'` (pertahanan berlapis: kaki Bersama memang tanpa deskripsi); `moved = (op = 'void' and snapshot ->> 'moved_at' is not null)`.
- **Tidak ada** kolom `account_id`, `link_id`, lines, atau `created_by` selain `actor_id` (= `changed_by`).
- Grant `EXECUTE` hanya ke `dompetku_web` (baca), tidak ke `dompetku_api`/worker; `api.activity_feed` tidak diubah.

- [ ] **Step 1: Tes gagal** `18_feed_bersama.sql` (lewat `tests.web_exec`/`tests.web_val`, persona N/F/Luar, jam `tests.clock`): N catat pengeluaran Bersama → 1 baris `create`, `actor_id` N; F ubah nominal 50000 → 75000 → baris `update` `amount` 75000 `before_amount` 50000 aktor F; N ubah kategori → `before_category_id` lama; F void, N restore → urutan 5 baris benar, aktor per baris benar [B8, B20]; setor N (keterangan `KANARI-N-SETOR`, `shared_note` `catatan-bersama`) dan ambil F (keterangan `KANARI-F-AMBIL`) → baris `space_transfer` `in`/`out`, `description` NULL, `shared_note` hanya pada yang diisi; keluaran seluruh baris `::text` tidak memuat kanari, nama dompet Pribadi, `link_id`, atau id kaki Pribadi [B4]; pindah Bersama → Pribadi oleh N → baris `void` `moved = true`, Pribadi tidak menerima baris; pindah Pribadi → Bersama → satu `create` di Bersama tanpa id asal; kursor: 25 baris, halaman 1 (`p_limit` 10) + halaman 2 dari triple baris ke-10 = baris 11–20 tanpa duplikat dan tanpa lompatan saat dua baris punya `changed_at` sama; kursor sebagian → `DK400 cursor`; `p_limit` 0/101 → `DK400 limit`; ruang Pribadi N oleh N → 0 baris; Pribadi N oleh F → `DK404`; Bersama oleh Luar → `DK404`; `opening_balance` tidak muncul; katalog: INVOKER, pemilik `dompetku_api`, `dompetku_api` dan `dompetku_worker` tanpa EXECUTE.
- [ ] **Step 2:** `pg_prove … tests/18_feed_bersama.sql tests/00_katalog.sql tests/08_ledger_isolasi.sql` → FAIL.
- [ ] **Step 3: Implementasi** (pola fungsi baca 0102; down = `drop function`, diawali penjaga `migrate_down_blocked_prod`; akhiri `select private.own_api_functions();`). Ukur `explain (analyze)` dengan 5.000 baris riwayat sintetis di satu ruang: memakai indeks `(space_id, changed_at desc)`, < 50 ms lokal; catat angkanya di laporan task.
- [ ] **Step 4:** `pg_prove` seluruh suite → PASS; commit `feat(db): 0114 feed Bersama dengan sebelum/sesudah dan kursor`.

### Task 3: Migrasi 0115 kontribusi per orang · Model: terkuat

**Files:** Create `packages/db/migrations/0115_kontribusi.sql`, `packages/db/tests/19_kontribusi.sql`; Modify `00_katalog.sql`, `08_ledger_isolasi.sql`, `packages/db/README.md`.

**Interfaces:**

- Produces `api.member_contributions(p_space_id uuid, p_from date, p_to date) returns table (user_id uuid, setoran bigint, diambil bigint, setoran_count int, diambil_count int)`.
- `SECURITY INVOKER` atas `app.report_lines` (entri hidup saja); validasi periode sama dengan `period_summary` (`DK400 period`, rentang ≤ 3660 hari); `assert_member`; hanya ruang `shared` (Pribadi = 0 baris).
- Satu baris per anggota dari `app.space_roster(p_space_id)` (left join; anggota tanpa transaksi = 0); dikelompokkan per `created_by`; `setoran` = Σ `amount` line `main` kelas `x_setoran_anggota`; `diambil` = Σ |`amount`| line `main` kelas `x_diambil_anggota`; line `fee` tidak dihitung (K2); urut `user_id`.
- Grant `EXECUTE` hanya ke `dompetku_web`.

- [ ] **Step 1: Tes gagal** `19_kontribusi.sql`: N setor 500000 dan 200000, F setor 300000 lalu ambil 100000 dengan biaya 2500 dari dompet Bersama → N `setoran` 700000, `diambil` 0; F 300000 / 100000 (biaya tidak dihitung) [B3, B6]; setoran N yang dibatalkan tidak dihitung, dipulihkan dihitung lagi; setoran 31 Okt 23:30 WIB (`tests.clock`) masuk periode `2026-10-01..2026-10-31`, bukan November [T13, Z1]; pemasukan Bersama berkategori `Kontribusi Farida` oleh F tidak mengubah angka F (K4); Bersama hanya N (sebelum F bergabung) → 1 baris; anggota tanpa transaksi → baris 0/0; `p_from > p_to` → `DK400 period`; Pribadi N oleh N → 0 baris; Pribadi N oleh F dan Bersama oleh Luar → `DK404`; jumlah `setoran` semua anggota = `period_summary` kelas `x_setoran_anggota` `inflow` (oracle); katalog: INVOKER, grant web saja.
- [ ] **Step 2:** FAIL → **Step 3:** implementasi (down = drop, penjaga prod, `own_api_functions`) → **Step 4:** `pg_prove` seluruh suite PASS; commit `feat(db): 0115 kontribusi per anggota Bersama`.

### Task 4: Loader server feed + Kontribusi dan teks peristiwa · Model: terkuat

**Files:** Create `apps/web/src/server/ledger/bersama.ts`, `apps/web/src/features/bersama/{types.ts,activity-text.ts,activity-text.test.ts}`, `server/ledger/__int__/bersama.int.test.ts`; Modify `server/ledger/beranda.ts`, `__int__/beranda.int.test.ts`, `__int__/pool.int.test.ts`, `__int__/harness.ts` (bantuan setor/ambil/pindah dua persona bila belum ada).

**Interfaces:**

- `features/bersama/types.ts`: `ActivityItemVM = { key: string; entryId: string; actor: { id; name; initial; role: 'owner' | 'member' }; at: string; text: string; srText?: string; amount: Rupiah | null; beforeAmount: Rupiah | null; moved: boolean; href: Route | null }`; `ContributionVM = { period: { from: IsoDate; to: IsoDate; label: string }; rows: { member: { id; name; initial; role }; setoran: Rupiah; diambil: Rupiah }[] }`.
- `activity-text.ts` (murni, tanpa impor server/klien): `activityText(row: SharedActivityRow, ctx: { categoryName(id): string | null }) → { text; srText? }` mengikuti matriks `S8-A2`; tidak pernah menerima atau mengeluarkan nama dompet.
- `bersama.ts`: `sharedActivityTx(c, ctx, { limit; before? }) → { items: ActivityItemVM[]; next: Cursor | null }`; `contributionsTx(c, ctx, period) → ContributionVM`; `loadAktivitas(ctx, { before? }) → { items; next }` (satu `withLedger`); `parseCursor(sp: string | undefined) → Cursor | null` (Zod; base64url dari `at|entryId|version`, panjang ≤ 120, galat = `null`, bukan 500). Nama dan peran anggota dari `app.space_roster` + `space_members.role` di transaksi yang sama. Hasil fungsi DB divalidasi Zod dengan objek ketat (kolom tak dikenal ditolak).
- `BerandaData.bersama` menambah `activity: ActivityItemVM[] | null` dan `contributions: ContributionVM | null`; keduanya hanya dikueri untuk `shared` dengan `members ≥ 2`, di dalam blok `withLedger` yang sudah ada (tanpa koneksi tambahan). Periode = bulan kalender WIB dari `todayWIB()` (K3).

- [ ] **Step 1: Tes gagal unit** `activity-text.test.ts`: setiap sel matriks `S8-A2` (kind × op × arah, nominal berubah, kategori berubah, `moved` R26, `shared_note` ada/tidak) → teks persis bingkai; masukan dengan field tak dikenal tidak memengaruhi teks; tidak ada keluaran yang memuat string dari field selain `description`, `shared_note`, nama kategori, dan nominal.
- [ ] **Step 2: Tes gagal int** `bersama.int.test.ts` (Postgres nyata, persona N/F/Luar): skenario Review Focus #1 → `JSON.stringify(loadBeranda(F, bersama))` dan `loadAktivitas` untuk N dan F tidak memuat kanari Pribadi N/F, nama dompet mana pun (K1), `linkId`, atau id kaki Pribadi [B4]; urutan dan aktor skenario Review Focus #2 [B20]; Kontribusi skenario Task 3 lewat loader; Bersama solo → `activity: null`, `contributions: null`; `parseCursor` sampah → halaman pertama; Luar → `not_found`. `pool.int.test.ts`: puncak koneksi muat Beranda Bersama dua anggota tetap ≤ 2. `beranda.int.test.ts`: Pribadi tidak memuat `activity`/`contributions`.
- [ ] **Step 3:** `pnpm --filter @dompetku/web test` + `test:int` → FAIL; **Step 4:** implementasi; **Step 5:** PASS; commit `feat(web): loader feed Bersama dan kontribusi`.

### Task 5: Suite e2e dua user (harness persona F) · Model: sonnet

**Files:** Create `apps/web/playwright.bersama.config.ts` (port sendiri, mis. 3302; mail file dan storageState sendiri), `apps/web/tests/e2e-bersama/{global-setup.ts,fixtures.ts}`; Modify `apps/web/package.json` (`"e2e:bersama": "playwright test -c playwright.bersama.config.ts"`), `.github/workflows/ci.yml` (job `auth` menjalankan `e2e:bersama` sesudah `e2e:ledger`, laporan HTML terpisah).

**Interfaces:** Fixture `ownerState` (pola `e2e-ledger/fixtures.ts`) dan `partnerState` (worker-scoped): N mengundang lewat `/undang`, F membuka tautan dari mail file, Terima → Buat akun (`Nama panggilan` `Farida`) → TOTP (`totp()` dari `e2e-auth/helpers.ts`) → kode pemulihan → `/pribadi/beranda`; storageState F disimpan. Fixture `kanari` mengisi Pribadi N dan F lewat UI atau `asUser` (dompet `KANARI-DOMPET-N`/`KANARI-DOMPET-F`, keterangan `KANARI-N-PRIBADI`/`KANARI-F-PRIBADI`, nominal 7.777.777 dan 6.666.666). Helper `bersamaResponses` (dari `e2e-ledger/helpers.ts`) dipakai ulang untuk menangkap HTML + RSC.

- [ ] **Step 1: Tes gagal** kerangka `s8.spec.ts` (Task 10 mengisinya): satu tes `F bergabung: Pribadi F kosong, Bersama berisi dua anggota` → FAIL sebelum fixture ada.
- [ ] **Step 2:** Implementasi config + fixture; global-setup me-reset DB sendiri (`resetData`). Alasan konfigurasi terpisah: `s7.spec` dan `screens-s7` mengandalkan Bersama solo (Review Focus #5); `e2e:ledger` tidak berubah.
- [ ] **Step 3:** `pnpm build && pnpm --filter @dompetku/web e2e:bersama` PASS; `e2e:ledger` tetap 38 hijau; commit `test(e2e): suite dua user dengan persona Farida`.

### Task 6: Beranda Bersama: Aktivitas dan Kontribusi · Model: sonnet + kursi design reviewer

**Files:** Create `features/bersama/activity-item-row.tsx` (Server Component baru; `components/ui/activity-row.tsx` prototipe tidak diubah, `docs/design/s8-bingkai.md`), `features/bersama/activity-card-view.tsx`, `features/bersama/contribution-card-view.tsx`, `features/beranda/contribution-demo.tsx`, `packages/demo-data/src/select/kontribusi.ts` (+ tes selector); Modify `_real/beranda.tsx`, `app/[ruang]/beranda/view.tsx`, `features/beranda/activity-feed.tsx` (salinan kosong dua anggota bila perlu; perilaku lain tetap); Test `_real/beranda.test.tsx`, tes view fitur, `packages/demo-data/src/selectors.test.ts`.

**Interfaces:** `ActivityCardView({ items, listHref | null, emptyNames })` dan `ContributionCardView({ vm })`: Server-safe (tanpa `'use client'`), hanya props tampilan. Demo: `memberContributions(state, from, to)` di `select/kontribusi.ts` dengan definisi K2 atas seed; `ContributionDemo` dimuat malas di `view.tsx`.

- [ ] **Step 1: Tes gagal:** Bersama dua anggota (nyata) → kartu `S8-A1` dengan 5 baris dari `data.bersama.activity`, tautan `Semua` (sr-only `aktivitas Bersama`) ke `/bersama/aktivitas` (K5, R3), avatar anggota violet / pemilik netral menurut peran; kosong dua anggota → salinan dengan nama anggota lain (N melihat `Farida`, F melihat `Novanda`); kartu `S8-K1` dengan satu blok per anggota, `Diambil` hanya bila > 0, dan `EmptyLine` bila semua angka nol (bingkai S8-K1); Bersama solo → tidak ada kartu Kontribusi dan Aktivitas tetap `BersamaAktivitasKosong` (S7-B1 tidak berubah); Pribadi → tidak ada keduanya; prototipe Bersama → kartu Kontribusi demo muncul sesudah muat malas, `ActivityFeed` demo tetap; markup tidak memuat nama dompet (K1).
- [ ] **Step 2–4:** FAIL → implementasi → PASS; e2e prototipe (290) tetap hijau tanpa mengubah tes lama; budget: Beranda prototipe ≤ 162 kB dan nyata ≤ 162 kB, angka dilapor (aturan budget S8).
- [ ] **Step 5:** Design reviewer atas screenshot 320/390/1280 terang/gelap (nyata lewat `e2e:bersama` `SCREENS=1`, prototipe lewat pratinjau); perbaiki; commit `feat(web): Beranda Bersama dengan Aktivitas dan Kontribusi`.

### Task 7: Halaman Aktivitas `/bersama/aktivitas` (K5) · Model: sonnet + kursi design reviewer

**Files:** Create `app/[ruang]/aktivitas/page.tsx`, `_real/aktivitas.tsx`; Modify `features/shell/hrefs.ts` (`buildHref(ruang, 'aktivitas', …)` bila perlu), `tests/e2e/routes.ts` dan `budget.spec.ts` (rute baru masuk loop), `_real/no-demo.test.ts` (rute baru tidak mengimpor demo); Test `_real/aktivitas.test.tsx`.

**Interfaces:** Page: `isPrototype()` → halaman demo sederhana dari `activityFeed(state, 100)` (dimuat di rute sendiri, tidak memengaruhi budget Beranda) atau `notFound()` bila pemilik memilih tanpa prototipe; nyata: `ruangContext(params)` (`requireDataUser` → `resolveSpace`), `ruang !== 'bersama'` → `notFound()`, `loadAktivitas(ctx, { before: parseCursor(sp.sebelum) })`, `Cache-Control: no-store` (pola rute lain).

- [ ] **Step 1: Tes gagal:** `/bersama/aktivitas` merender 30 baris berkelompok per hari dengan `Muat sebelumnya` (tautan `?sebelum=<kursor>`) bila `next`; kursor rusak → halaman pertama; `/pribadi/aktivitas` → 404; tidak ada `'use client'` baru di pohon rute nyata; tiap baris menaut ke Detail Bersama (`href`), entri yang sudah dipurge tidak punya baris (riwayat ikut terhapus).
- [ ] **Step 2–4:** FAIL → implementasi → PASS (rute baru ≤ 162 kB di kedua mode).
- [ ] **Step 5:** Design reviewer; commit `feat(web): halaman Aktivitas Bersama`.

### Task 8: Onboarding Farida nyata dan salinan sisi Farida · Model: sonnet + kursi design reviewer

**Files:** Modify `_real/beranda-steps.ts`, `_real/beranda.tsx`, `features/beranda/bersama-views.tsx`, berkas salinan yang menulis "Farida" di layar yang bisa dilihat Farida (daftar dari `grep -rn "Farida" apps/web/src --include=*.tsx`, kecuali layar khusus pemilik seperti `/undang`, kartu ajakan B1, dan langkah `Undang Farida`); Test `_real/beranda-steps.test.ts`, `_real/beranda.test.tsx`.

**Interfaces:** `berandaSteps` tetap (F = 3 langkah sudah benar); tes eksplisit untuk persona anggota. `BERSAMA_SOLO_INTRO` diganti salinan `S8-B1a` (T5) bila pemilik setuju; kalau tidak, tetap.

- [ ] **Step 1: Tes gagal:** persona anggota (F) di Pribadi baru → checklist `0 dari 3`/`1 dari 3 selesai` dengan `Akun aman` selesai, tanpa `Undang Farida` dan tanpa langkah pengganti [AFD §1]; F di Bersama berisi dompet N → tanpa B1 dan tanpa kartu ajakan; F tidak pernah menerima data undangan (`pendingInvite` tidak ada di payload, tes yang sudah ada diperluas); tidak ada salinan `Farida` tetap di layar F (empty state Aktivitas memakai nama roster); pengantar B1 tidak mengulang kartu ajakan (T5).
- [ ] **Step 2–4:** FAIL → implementasi → PASS.
- [ ] **Step 5:** Design reviewer atas `S8-O1`, `S8-O2`, B1 baru; commit `feat(web): onboarding Farida dan salinan berbasis anggota`.

### Task 9: Utang S7 yang menyentuh Bersama: biaya kaki keluar Bersama · Model: sonnet (review: terkuat, menyentuh tampilan uang)

**Files:** Modify sesuai temuan Step 1 (kandidat: `server/ledger/read.ts` kolom `fee`, `_real/detail.tsx`, `features/ledger/present.ts`, `features/transaksi/*` meta TxRow); Test `_real/detail.test.tsx`, `server/ledger/__int__/detail.int.test.ts`.

- [ ] **Step 1: Reproduksi dulu** (ledger S7 M6 hanya menyebut "biaya kaki keluar Bersama tidak ditampilkan"): F mengambil dari dompet Bersama ke Pribadi dengan biaya 2.500 lewat `test:int`, lalu periksa Detail, daftar Transaksi, Beranda Terbaru di `/bersama` dan Detail kaki Pribadi F. Tulis temuan persis (layar mana, kolom mana) di laporan task sebelum mengubah kode.
- [ ] **Step 2: Tes gagal:** kaki keluar Bersama menampilkan baris `Biaya {Rp}` (`S8-D1a`) dan nominal bertanda konsisten dengan saldo dompet Bersama; kaki Pribadi F tidak menampilkan biaya Bersama dua kali; tidak ada nama dompet Pribadi F di Bersama.
- [ ] **Step 3–4:** implementasi → PASS; **Step 5:** design reviewer; commit `fix(web): tampilkan biaya kaki keluar Bersama`.

### Task 10: E2E dua user S8 (kriteria keluar) · Model: terkuat

**Files:** Modify `apps/web/tests/e2e-bersama/s8.spec.ts`; Create `tests/e2e-bersama/screens-s8.spec.ts` (`SCREENS=1`, ke `docs/design/s8/`).

- [ ] **Step 1: Tes** (`e2e:bersama`, dua `browserContext` N dan F, tag ID):
  - **Kanari feed [B4, B20, kriteria keluar]:** N setor dari `KANARI-DOMPET-N` dengan keterangan `KANARI-N-SETOR`; F ambil Bersama → `KANARI-DOMPET-F` dengan keterangan `KANARI-F-AMBIL` lewat Catat di `/bersama` [B6]; N memindahkan pengeluaran Bersama ke Pribadi. Untuk N **dan** F: `/bersama/beranda` dan `/bersama/aktivitas` (navigasi klien + reload, HTML + payload RSC lewat `bersamaResponses`) tidak memuat kanari Pribadi siapa pun, nama dompet mana pun (K1), atau id kaki Pribadi (diambil dari DB lewat `adminQuery`). Feed menampilkan `memindahkan transaksi ke ruang lain` (R26).
  - **Sebelum/sesudah [B8, B20]:** F mengubah pengeluaran yang dicatat N 50.000 → 75.000; N melihat baris `Farida · mengubah …: Rp 50.000 → Rp 75.000` di Beranda dalam 1 reload; F membatalkan, N memulihkan; urutan dan pelaku benar di halaman Aktivitas.
  - **B5:** F membuka Detail setoran N di Bersama → tanpa `Batalkan`, keterangan `Hanya Novanda yang bisa membatalkan transfer ini.`.
  - **Kontribusi [B3, B6]:** angka kartu = jumlah setoran/ambil per orang bulan ini; setoran yang dibatalkan hilang dari angka sesudah reload.
  - **Onboarding F:** Pribadi F kosong dengan checklist 3 langkah tanpa `Undang Farida`; Bersama F tanpa B1; `/undang` milik N menampilkan `Diterima` dan undangan ketiga ditolak (sudah di `e2e:auth`, cukup satu asersi status di sini).
  - **Keyboard-only** untuk Beranda Bersama → `Semua` → `Muat sebelumnya`; axe 0 serious/critical terang/gelap 320/390/1280 untuk Beranda Bersama dua anggota, Aktivitas, Beranda Pribadi F; tanpa gulir horizontal di 320 dengan `Rp 12.345.678.900` dan nama 40 karakter; anotasi `js-route-kB` semua rute ≤ 162 kB.
- [ ] **Step 2:** Jalankan sampai hijau (perbaikan masuk task pemilik kodenya bila temuan nyata); commit `test(e2e): kriteria keluar S8 dua user`.

### Task 11: Registry ID tes + tag · Model: sonnet

**Files:** Create `packages/db/tests/REGISTRY.md`, `scripts/check-test-registry.ts`; Modify root `package.json` (`"test:registry": "node scripts/check-test-registry.ts"`, Node 24 type stripping), job CI `check`, tes yang sudah dipetakan di `docs/superpowers/handoff/s7.md` (tambah tag tanpa mengubah asersi).

**Interfaces:** `REGISTRY.md` = tabel `ID | Maksud (qa.md) | Milestone | Status (aktif/belum/tidak bisa dipetakan) | Lokasi`. Pemeriksa: setiap ID berstatus `aktif` untuk milestone ≤ M2 punya minimal satu tag di `packages/db/tests/*.sql`, `apps/**/*.test.ts(x)`, atau `apps/web/tests/**/*.spec.ts`; tag yang tidak ada di registry = galat; keluaran hanya ID dan berkas.

- [ ] **Step 1: Tes gagal:** unit kecil pemeriksa (registry contoh dengan ID tanpa tag → keluar 1 dan menyebut ID; tag tak dikenal → keluar 1; semua lengkap → 0).
- [ ] **Step 2:** Isi registry dari peta ID S7 + ID S8 (B3–B6, B8, B20, T13, Z1 di `19_kontribusi`); B16 dan T1–T5/T12/T16 berstatus `belum`/`tidak bisa dipetakan` dengan alasan (definisi INT §4 v1 belum ada di repo; `net_worth` UI M6).
- [ ] **Step 3:** Tambah tag di tes yang ada (komentar/judul/tag saja); `pnpm test:registry` PASS; commit `test: registry ID tes dan pemeriksanya`.

### Task 12: Penutup: critique, Delivery Gate, review, dokumen, PR · Model: terkuat (review), sonnet (critique)

**Files:** Modify `docs/product/BSD.md` §16 ("Catatan S8": `shared_activity`, `member_contributions`, keputusan K1–K6 yang dipakai, batas privasi), `docs/product/IPD.md` §5 (status S8), `CLAUDE.md` (Status, Tertunda), `docs/design/s8-bingkai.md` (keputusan penutup, temuan critique); Create `docs/superpowers/handoff/s8.md` (pola `s7.md`: status task, angka, langkah pemilik, peta ID tes dari `REGISTRY.md`, yang dibawa ke S9).

- [ ] **Step 1:** Design critique atas screenshot `screens-s8` + pratinjau prototipe; Delivery Gate antislop (skill `antislop` bila tersedia; bila tidak, daftar periksa tertulis seperti S7, dicatat).
- [ ] **Step 2:** Gerbang penuh: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`, `pnpm build`, `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`, `test:int`, `e2e:auth`, `e2e:ledger`, `e2e:bersama`, `pg_prove` seluruh suite, int worker, `deploy-test.sh`, `test:registry`. Catat angka.
- [ ] **Step 3:** Review akhir seluruh branch (model terkuat) + review keamanan (fokus: jalur baca Bersama, snapshot riwayat, payload RSC, kursor); perbaiki temuan.
- [ ] **Step 4:** Dokumen + handoff; commit `docs: catatan S8`; PR ke `main` (template PR bila ada). Langkah pemilik sesudah merge ditulis di `s8.md`: P1–P4, lalu `auth.md` langkah 7 (undang Farida) dan smoke dua akun.

---

## Kriteria keluar S8 (IPD §5) dan task yang membuktikannya

| Kriteria | Bukti |
| --- | --- |
| Setoran ke Bersama | Fungsi dan UI sudah ada sejak S7 (`07_ledger_uang`, `s7.spec`); presentasi di feed dan Kontribusi: Task 2, 3, 6; dua user (B3, B6): Task 10 |
| Feed aktivitas (pelaku, sebelum/sesudah) | Task 2 (pgTAP), 4 (unit teks + int), 6, 7 (UI), 10 (e2e) |
| Kontribusi per orang | Task 3, 4, 6, 10 |
| Undang Farida dan onboarding nyata (checklist 3 langkah) | S4 (`e2e:auth`) + Task 5, 8, 10 |
| **Feed tidak pernah memuat nama dompet atau entri Pribadi (Playwright dua user)** | Task 10 (kanari N dan F, HTML + RSC, dua `browserContext`), didukung Task 2 dan 4 |
| **Isolasi penuh pada tabel baru** | Tidak ada tabel baru; isolasi dibuktikan pada fungsi baru: Task 2, 3 (`08_ledger_isolasi`, `00_katalog`, Luar/F/N), Task 4 (int), Task 7 (`/pribadi/aktivitas` 404) |
| ID tes M2 yang menyentuh S8 (B4, B20 dari PRD cerita M2) hijau dan bertag | Task 10, 11 |
| Budget JS ≤ 162 kB semua rute, kedua mode | Task 6, 7, 10 (aturan budget S8) |
| Utang S7 yang relevan: biaya kaki keluar Bersama, ambil Bersama → Pribadi e2e, pengantar B1 (T5) | Task 9, 10 (B6), 8 |

**Bukan kriteria S8:** gerbang M2 "Farida bergabung; kedua akun 7 hari berturut-turut" (PRD §6.1) dihitung sesudah S10 selesai dan live. Farida benar-benar bergabung di produksi = langkah pemilik (P1–P4, K6).

## Di luar cakupan

Anggaran Pribadi/Bersama, laporan, tagihan rutin dasar, Beranda "aman dipakai" lengkap, dan periode gajian §8.2a (S9); worker lanjutan, CSV, review bulanan (S10); bagi tagihan Bersama dan "siapa berutang ke siapa" (M3, S12); peristiwa keanggotaan ("Farida bergabung") di feed; notifikasi atau push saat pasangan mencatat; filter Transaksi per pencatat; kontrol Talangan di sheet Ubah (T2) dan chip saran bergeser (T1) karena hanya Pribadi/Catat; DQ07 tanpa alert, `unhandledRejection` worker, dan utang worker lain (`CLAUDE.md` Tertunda #9); `api.update_transfer`.

## Pertanyaan terbuka untuk pemilik

1. K1–K6 di atas (default = rekomendasi bila tidak dijawab sebelum Task 1 selesai).
2. Salinan pengantar B1 (T5): setuju `Ruang untuk pengeluaran rumah tangga.` saat kartu ajakan tampil? (Task 8; bila tidak, salinan S7 tetap.)
3. Kategori awal Bersama `Kontribusi Farida`: tetap, ganti nama, atau diarsipkan pemilik sesudah Farida memakai setoran? (Tidak mengubah kode S8; relevan untuk K4.)
