# DompetKu v2 · M1 S6 (Catat, transaksi, Sampah, event produk) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catat, kategori + saran, parser nominal, edit/void/urungkan, Sampah, `product_events`, dan "Tidak ada pengeluaran hari ini" berjalan di ledger sungguhan (mode non-prototipe), sementara mode prototipe (`NEXT_PUBLIC_PROTOTYPE=1`, pratinjau Vercel, e2e prototipe 220) tetap jalan tanpa perubahan perilaku.

**Architecture:** Irisan vertikal: DB dulu (migrasi `0106`–`0108` + pgTAP), lalu lapisan akses data server-only di `apps/web/src/server/ledger/` (wrapper `api.*` dengan Zod, selalu lewat `withUser`, retry `40001`/`40P01`), lalu Server Actions di `app/[ruang]/_actions/` (gerbang `requireDataUser()`), lalu UI. Mode dipilih di server per page (`isPrototype()`), seperti layar auth S4: prototipe merender view demo yang sudah ada, mode nyata merender view nyata yang menerima view-model (VM) dari server. Komponen presentasional dipisah dari `DemoState` (VM murni) agar kedua mode memakai markup yang sama; `DemoProvider` hanya dipasang di mode prototipe. Sheet Catat memakai antarmuka `CatatSource` (demo: store sinkron; nyata: Server Actions) sehingga keadaan "Menyimpan…", galat, saldo kurang, dan konflik juga bisa ditinjau di pratinjau prototipe.

**Tech Stack:** Next.js 16.4.3 (RSC baca, Server Actions tulis), React 19.3, `pg` 8.23.1 (parser tipe `date` = string, `int8` = number aman), Zod 4.6.7, Postgres 17.11 + dbmate 2.36.0 + pgTAP, Vitest (unit + `test:int` Postgres sungguhan), Playwright 1.64.1 + `@axe-core/playwright`.

**Spec:** `docs/product/IPD.md` §4 S6 (cakupan, gerbang, kriteria keluar), `docs/product/PRD.md` §5 M1, §6.2, §7; `docs/product/AFD.md` §3, §5, §7, §8; `docs/product/BSD.md` §6, §9, §11, §12, §16; `docs/product/DBD.md` §3, §4, §7, §9; `DESIGN.md` + `docs/design/panel-malam/`; `docs/spec/ui-ux.md` R3, R9, R10; `docs/team/round1/qa.md` Lampiran A (baris M1). Bila beda, spec induk §9 menang (PRD), BSD menang untuk nama fungsi dan kolom.

## Global Constraints

Setiap task mewarisi semua butir ini.

**Proses**

- Branch kerja dari `main` terbaru (`claude/m1-s6-<topik>`), commit kecil Conventional Commits berbahasa Indonesia, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` dan `Claude-Session: …` sesi pelaksana.
- Gerbang sebelum push: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`, `pnpm build`, `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e` (pastikan tidak ada proses Playwright lain); task DB menambah `pg_prove` lokal (packages/db/README.md); task server/UI nyata menambah `test:int` dan `e2e:ledger` (Task 19).
- Task bertanda **Model: terkuat** (uang, RLS, DB, idempotensi) dikerjakan dan direview dengan model terkuat (CLAUDE.md).
- Task UI: antislop mode DURING, kursi **design reviewer** (langkah tersendiri di task) sebelum commit akhir, dan Delivery Gate antislop sebelum UI diserahkan (Task 20).

**Aturan M1 (CLAUDE.md, TRD §2.3, §5)**

- Setiap page dan layout `[ruang]` memanggil `requireDataUser()`; setiap kueri data ruang hanya sesudahnya, lewat `withUser(pools.app, state.userId, fn, spaceId)`.
- Server Actions diperlakukan sebagai endpoint publik: `requireDataUser()` → Zod → `withUser`. Mode prototipe: action menolak (`throw`), tidak pernah menyentuh DB.
- Tidak ada akses DB dari klien. `features/**` dan `components/**` tidak mengimpor `server/**`.
- Ruang di URL (`/pribadi/…`, `/bersama/…`), server me-resolve ke `space_id`; setiap action menerima ruang eksplisit. Rute Bersama tidak memuat data Pribadi sama sekali, termasuk payload RSC (DBD §5).
- Halaman berdata `Cache-Control: no-store`; cache data Next dilarang untuk data user.
- Isolasi transaksi bawaan role (READ COMMITTED); dilarang `SET TRANSACTION ISOLATION` dan opsi `isolationLevel` di `apps/**`.
- `40001`/`40P01` diulang maksimal 3× di Node (BSD §9.2).

**Kontrak `api.*` (BSD §9.1, §9.2)**

- Parameter bernama `p_`, dipanggil `select api.f(p_x => $1, …)`; hasil `jsonb` divalidasi Zod: `{entry_id, version, replayed, warnings[]}` (+ `linked_entry_id`, `link_id`, `affected` bila relevan).
- `p_client_id uuid` di semua fungsi tulis kecuali yang idempoten secara alami (`mark_no_spend_day`, `update_category`, `archive_category`, `archive_account`). Edit dan void memakai `p_expected_version`; edit = ganti-penuh (kirim semua field, boleh NULL).
- Kode galat: `DK400` argumen (detail = nama field), `DK401` tanpa konteks, `DK404` tidak ditemukan atau bukan anggota (disamakan), `DK409` konflik versi, `DK410` kunci idempotensi dipakai ulang dengan isi beda, `DK422` aturan bisnis (`message` = kode mesin: `space_mismatch`, `saldo_negatif`, `account_archived`, `before_opening`, `opening_locked`, `restore_window_closed`, `balance_not_zero`, `category_depth`, `category_in_obligation`, …), `DK500` invarian rusak.
- Pesan galat dan log tidak pernah memuat nominal atau deskripsi.
- Tanggal = `YYYY-MM-DD` kalender WIB dari `app.today()`; tanggal masa depan ditolak `DK400 occurred_on`; `current_date` dan zona browser tidak dipakai.

**Migrasi (packages/db/README.md, BSD §12)**

- S6 memakai nomor `0106` ke atas. Satu blok `-- migrate:up` + satu `-- migrate:down`; down diawali penjaga `migrate_down_blocked_prod` (`app.settings env = 'prod'` → `DK500`), sama seperti `0102`–`0105`.
- File yang menyentuh skema `api` diakhiri `select private.own_api_functions();`.
- Tabel baru di `app`: RLS ENABLE + FORCE, indeks untuk setiap FK, masuk matriks hak `tests/00_katalog.sql`, dan matriks isolasi `tests/03_isolasi.sql`/`tests/08_ledger_isolasi.sql`.
- pgTAP memanggil fungsi (bukan insert mentah) lewat `tests.<role>_exec/_val(uid, sql)`; jam lewat `tests.clock(interval)`.
- Isi fungsi yang sudah ditulis di BSD disalin persis; fungsi yang BSD tandai "belum ditulis" mengikuti pola BSD dan dicatat di BSD §16 "Catatan S6" (Task 20).

**Catat dan event produk (PRD §3, §7; AFD §3; ui-ux R3)**

- Jalur tercepat ≤ 3 ketukan: Catat (1) → chip kategori (2) → Simpan (3), dari Beranda, Transaksi, Dompet, di Pribadi dan Bersama. Ketukan = aksi pointer dari tombol Catat sampai Simpan; tombol angka dan ketikan tidak dihitung; pintasan `c` tidak dihitung.
- Kategori tidak pernah terpilih otomatis. 6 chip saran + chip ke-7 "Kategori lain…" (Combobox); posisi chip tidak berubah selama sheet terbuka.
- `clientId` (UUID v4 berformat `8-4-4-4-12`) lahir saat sheet dibuka; "Coba lagi" memakai `clientId` yang sama; pindah ruang di sheet = `clientId` baru, nominal tetap, dompet = operasional terakhir ruang tujuan, kategori direset.
- Saldo tidak cukup: peringatan inline (bukan dialog), simpan tetap boleh dengan `p_allow_negative => true`.
- Toast: 6 detik, berhenti saat hover/fokus, `role="status"`; "Urungkan" dalam 6 detik membatalkan entri dan mengembalikan saldo. Galat simpan `role="alert"`.
- `app.product_events` (sudah ada di `0004`): event tertutup `catat_dibuka`, `catat_disimpan`, `catat_batal`, `tanpa_pengeluaran`; kolom `flow_id` (= `catat_id`), `taps` (= `ketukan`, 0–100), `duration_ms` (0–3600000), `space_kind`; `catat_disimpan`/`catat_batal` wajib `flow_id`, `taps`, `duration_ms`. Tanpa nominal, deskripsi, id entri, atau id kategori.
- Sampah: entri batal ≤ 90 hari bisa dipulihkan; lewat = `restore_window_closed`.

**Desain dan aksesibilitas (DBD §3–§7, DESIGN.md)**

- Token hanya dari `apps/web/src/styles/tokens.css`; pola Panel Malam (radius 12 kontrol, 16 kartu daftar, 20 kartu utama/dialog, 24 sheet; kartu tanpa bayangan; status = ikon + teks; ruang selalu tertulis).
- Target sentuh ≥ 44×44, jarak ≥ 8; fokus 2 px `focus` offset 2; fokus tidak tertutup tab bar/toast.
- axe serious/critical = 0 di terang dan gelap, 320/390/1280. Tanpa gulir horizontal di 320 px (termasuk `Rp 12.345.678.900`). Mode keyboard Catat 360×640: judul ruang, nominal, ≥ 4 chip, dompet, Simpan terlihat, tinggi sheet ≤ 356.
- Budget JS: **162 kB** gzip JS rute muat dingin (ADR 0002), diukur prototipe (`budget.spec.ts`) dan nyata (Task 19). Kode yang hanya dipakai saat dibuka dimuat malas. Melewati batas = berhenti dan minta keputusan pemilik; jangan menaikkan konstanta.

**Salinan tetap** (dari dokumen; usulan agen untuk keadaan baru ditetapkan di Task 1)

| Keadaan                | Teks                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Simpan nonaktif        | `Pilih kategori untuk menyimpan`                                                                                          |
| Menyimpan              | tombol nonaktif bertuliskan `Menyimpan…`, `aria-busy="true"`                                                              |
| Galat simpan           | `Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan mencatat dua kali.` + tombol `Coba lagi`           |
| Toast simpan           | `Tersimpan di {Ruang} · {Rp} dari {dompet}` (pemasukan: `ke {dompet}`) + aksi `Urungkan`                                  |
| Konflik versi          | `{Nama} mengubah transaksi ini {waktu relatif} ({Rp lama} → {Rp baru}). Muat versi terbaru untuk melanjutkan.`            |
| Transaksi dibatalkan   | `Transaksi ini sudah dibatalkan.` + aksi `Pulihkan`                                                                       |
| Hari tanpa pengeluaran | tombol `Tidak ada pengeluaran hari ini`                                                                                   |
| Kosong Transaksi       | `Belum ada transaksi di {Ruang}.` + aksi `Catat`                                                                          |
| Gagal muat             | `Transaksi belum bisa dimuat. Periksa koneksi lalu coba lagi.` + `Coba lagi`                                              |
| Dialog Batalkan        | teks yang sudah ada di `features/transaksi/void-dialog.tsx` (menjanjikan pemulihan "dari Sampah" 90 hari), tidak diubah |

**Prototipe tetap**

- Mode prototipe ditentukan `isPrototype()` (`NEXT_PUBLIC_PROTOTYPE === '1'`, dibaca saat runtime). Satu build standalone melayani kedua mode.
- 220 tes e2e prototipe yang ada lulus **tanpa diubah** (tes baru boleh ditambah). Bila sebuah task harus mengubah tes lama, berhenti dan laporkan.

## Review Focus

1. **Klik ganda Simpan atau koneksi putus sesudah server commit** → satu entri, satu toast; "Coba lagi" mengembalikan entri yang sama (`replayed: true`), bukan galat. Tes: Task 9 `idempotensi: clientId sama dua kali = satu entri`, Task 12 `galat lalu coba lagi memakai clientId sama`, Task 19 `klik ganda Simpan = satu baris`.
2. **Dua tab mengubah entri yang sama** → tab kedua mendapat layar konflik dengan nilai terbaru, tidak pernah menimpa diam-diam; "Timpa dengan perubahan saya" mengirim versi terbaru. Tes: Task 9 `updateEntry versi usang = conflict`, Task 16 `konflik versi menampilkan nilai terbaru`.
3. **Batas hari WIB** (31 Okt 23:30 WIB, tombol hari tanpa pengeluaran ditekan 00:05 WIB) → entri masuk Oktober, hari yang ditandai = tanggal WIB server, bukan zona browser/UTC. Tes: Task 4 `mark_no_spend_day memakai app.today()`, Task 10 `T13: 31 Okt 23:30 WIB masuk Oktober`.
4. **Rute Bersama memuat data Pribadi** (pindah ruang di sheet Catat, layout yang memuat dompet kedua ruang, payload RSC) → tidak ada nama dompet, deskripsi, atau id Pribadi di HTML/RSC rute Bersama; dompet ruang tujuan diambil lewat action saat pindah. Tes: Task 10 `kanari Pribadi tidak terbaca dari Bersama`, Task 19 `payload rute Bersama tanpa kanari Pribadi`.
5. **Mode tercampur** (pengguna nyata melihat data demo, atau pratinjau memanggil DB) → mode nyata tidak memasang `DemoProvider` dan tidak pernah jatuh ke seed; action di mode prototipe menolak. Tes: Task 7 `mode nyata tanpa DemoProvider`, Task 11 `action menolak di mode prototipe`, Task 19 `tidak ada teks "Data demo" di mode nyata`.

## Peta berkas

```
packages/db/migrations/0106_kategori.sql            create/update/archive_category, kategori awal ruang
packages/db/migrations/0107_saran_kategori.sql      api.suggest_categories + kamus kata kunci
packages/db/migrations/0108_tanpa_pengeluaran.sql   app.no_spend_days, RLS, api.mark_no_spend_day
packages/db/tests/11_kategori.sql | 12_saran_kategori.sql | 13_tanpa_pengeluaran.sql
packages/domain/src/nominal.ts                      parseNominal ("35rb/35k/1,5jt")
apps/web/src/features/ledger/types.ts               VM bersama server↔klien (tanpa impor server)
apps/web/src/features/ledger/present.ts             judul/label entri dari VM (setara selector demo)
apps/web/src/features/shell/nav-provider.tsx        ruang + href, lepas dari store demo
apps/web/src/server/ledger/{errors,retry,space,write,read,events}.ts
apps/web/src/server/ledger/__int__/*.int.test.ts
apps/web/src/app/[ruang]/_actions/{catat,entri,kategori,dompet,beranda}.ts
apps/web/src/app/[ruang]/_real/{ruang-shell-real,beranda,transaksi,detail,dompet,sampah,kategori}.tsx
apps/web/src/features/catat/source.ts               CatatSource + sumber demo
apps/web/src/features/catat/telemetry.ts            hitung ketukan + event
apps/web/src/app/[ruang]/sampah/page.tsx | kategori/page.tsx
apps/web/tests/e2e-ledger/*.spec.ts + playwright.ledger.config.ts
docs/design/s6-bingkai.md                           bingkai utang desain S6
```

---

### Task 1: Bingkai desain S6 (gerbang awal)

Gerbang IPD §0 butir 3 dan §4 S6: bingkai Catat (galat, "Menyimpan…", peringatan saldo) dan Sampah harus ada sebelum task UI mana pun. Transfer lintas ruang dan "Pindahkan ke ruang lain" dibingkai di S7 (pertanyaan terbuka 3).

**Files:**

- Create: `docs/design/s6-bingkai.md`
- Modify: `docs/product/DBD.md` (§9 baris 3 dan 8: tautan ke bingkai, status "dibingkai, menunggu pratinjau")

**Interfaces:**

- Produces: ID bingkai `S6-C1`…`S6-K2` dan salinan final per keadaan; Task 12–18 merujuk ID ini dan menambahkan tiap bingkai ke galeri `/dev/ui`.

- [ ] **Step 1: Tulis bingkai.** Satu bagian per bingkai, isinya: tujuan, tata letak HP 390 dan 320, tablet 600–1023, laptop ≥ 1024, komponen Panel Malam yang dipakai (sebut bingkai handoff rujukan: C1–C5 Catat, D1–D4 Detail, T1–T5 Transaksi, W1–W4 Dompet, B1 Beranda), token warna, salinan, peran ARIA, urutan fokus. Daftar wajib:
  - `S6-C1` Catat "Menyimpan…"; `S6-C2` galat simpan; `S6-C3` saldo tidak cukup (inline di bawah pemilih dompet, warna `warning` + ikon, tombol Simpan berubah menjadi `Tetap simpan`); `S6-C4` `DK410` (sheet terbuka, aksi `Simpan sebagai catatan baru` = `clientId` baru); `S6-C5` `before_opening` dan `account_archived` (pesan di bawah field terkait, fokus pindah ke field); `S6-C6` ruang tanpa dompet (sheet menampilkan ajakan `Tambah dompet`).
  - `S6-D1` sheet Ubah (bentuk = sheet Catat, judul `Ubah transaksi`); `S6-D2` konflik versi (pesan + nilai terbaru, aksi `Muat ulang` primer dan `Timpa dengan perubahan saya` sekunder); `S6-D3` transaksi dibatalkan (D5 AFD: banner + `Pulihkan`, nominal dicoret dengan teks pembaca layar "dibatalkan").
  - `S6-S1` Sampah: daftar (baris = TxRow + meta `Terhapus permanen {tanggal}` + tombol `Pulihkan` 44 px), kosong, memuat, gagal muat, `restore_window_closed`.
  - `S6-B1` Beranda: tombol `Tidak ada pengeluaran hari ini` (sekunder, di bawah kartu utama, hanya bila hari ini belum ada entri) dan keadaan sesudah ditekan.
  - `S6-K1` Menu → Kategori: daftar per jenis (Pengeluaran/Pemasukan, induk lalu anak menjorok), tambah, ubah nama/ikon, arsip; `S6-K2` dialog arsip (akibat: kategori tidak ditawarkan di Catat; entri lama tetap).
- [ ] **Step 2: Salinan usulan** (tulis persis, design reviewer boleh mengoreksi; hasil final di berkas ini mengikat Task 12–18):

  | Bingkai               | Teks                                                                                                         |
  | --------------------- | ------------------------------------------------------------------------------------------------------------ |
  | S6-C3                 | `Saldo {dompet} tinggal {Rp}. Kalau disimpan, saldonya jadi {−Rp}.` + `Tetap simpan`                          |
  | S6-C4                 | `Catatan ini pernah terkirim dengan isi lain.` + `Simpan sebagai catatan baru`                               |
  | S6-C5 before_opening  | `{dompet} baru dicatat sejak {tanggal}. Pilih tanggal mulai {tanggal}.`                                      |
  | S6-C5 account_archived | `{dompet} sudah diarsipkan. Pilih dompet lain.`                                                             |
  | S6-C6                 | `Belum ada dompet di {Ruang}. Tambah dompet dulu untuk mencatat.` + `Tambah dompet`                          |
  | S6-S1 kosong          | `Sampah kosong. Transaksi yang dibatalkan bisa dipulihkan di sini selama 90 hari.`                           |
  | S6-S1 lewat           | `Lewat 90 hari, transaksi ini tidak bisa dipulihkan lagi.`                                                   |
  | S6-B1 sesudah         | `Hari ini tercatat tanpa pengeluaran.`                                                                       |
  | Toast pulihkan        | `Dipulihkan · {Rp}`                                                                                          |

- [ ] **Step 3: Design reviewer.** Tinjau berkas sebagai design reviewer (kursi terpisah dari penulis): konsistensi dengan `docs/design/panel-malam/README.md`, ruang selalu tertulis, status ikon + teks, tidak ada aksi hanya di hover, 320 px. Catat temuan dan perbaikannya di bagian akhir berkas ("Catatan review").
- [ ] **Step 4: Format dan commit.**

```bash
npx prettier --write docs/design/s6-bingkai.md docs/product/DBD.md
git add docs/design/s6-bingkai.md docs/product/DBD.md
git commit -m "docs(desain): bingkai utang desain S6 untuk Catat, Detail, Sampah, Kategori"
```

---

### Task 2: Migrasi 0106 kategori (fungsi api + kategori awal) — **Model: terkuat**

**Files:**

- Create: `packages/db/migrations/0106_kategori.sql`, `packages/db/tests/11_kategori.sql`
- Modify: `packages/db/tests/00_katalog.sql` (daftar fungsi api + DEFINER tertutup), `packages/db/tests/08_ledger_isolasi.sql` (kategori lintas ruang), `apps/web/tests/e2e-auth/global-setup.ts`, `apps/web/src/server/auth/__int__/harness.ts` (pembersihan data: hapus `app.entries`/`entry_lines`/`entry_history`/`accounts`/`categories` dengan `dompetku.purge = on` sebelum `app.spaces`)

**Interfaces:**

- Produces (SQL):
  - `api.create_category(p_client_id uuid, p_space_id uuid, p_type app.category_type, p_name text, p_icon text, p_parent_id uuid default null) returns jsonb` — isi **persis BSD §9** (`{category_id}`).
  - `api.update_category(p_category_id uuid, p_name text, p_icon text, p_parent_id uuid) returns jsonb` — ganti-penuh, idempoten alami, `{category_id}`; tidak bisa mengubah `type` atau `space_id`.
  - `api.archive_category(p_category_id uuid) returns jsonb` — idempoten alami; mengarsipkan juga anak aktifnya; `{category_id, archived: true, affected int}`.
  - `private.seed_categories(p_space_id uuid) returns int` — menyisipkan kategori awal bila ruang belum punya kategori; `is_system = true`.
  - Pemicu kategori awal saat ruang lahir lewat provisioning (`api.bootstrap_owner`/`api.accept_invitation`), plus backfill ruang yang sudah ada di produksi.

- [ ] **Step 1: Tulis tes pgTAP yang gagal** `packages/db/tests/11_kategori.sql` (pola `07_ledger_uang.sql`):

```sql
-- kategori awal
select is(tests.web_val(:n, $$select count(*) from app.categories where space_id = '<pribadi N>'$$)::int,
          <jumlah kategori seed demo ruang pribadi>, 'ruang Pribadi baru punya kategori awal');
select is(tests.web_val(:n, $$select count(*) from app.categories c join app.spaces s on s.id = c.space_id
          where s.kind = 'shared'$$)::int, <jumlah seed bersama>, 'ruang Bersama baru punya kategori awal');
select is(tests.web_val(:n, $$select bool_and(is_system) from app.categories$$), 'true', 'kategori awal is_system');
-- create: idempotensi
select is(tests.api_val(:n, $$select api.create_category(p_client_id => '<k1>', p_space_id => '<pribadi N>',
          p_type => 'expense', p_name => ' Parkir ', p_icon => 'Car')->>'category_id'$$),
          tests.api_val(:n, $$select api.create_category(p_client_id => '<k1>', p_space_id => '<pribadi N>',
          p_type => 'expense', p_name => 'Parkir', p_icon => 'Car')->>'category_id'$$),
          'clientId sama + isi sama = kategori sama (nama di-btrim sebelum hash)');
select throws_ok($$ ... create_category(p_client_id => '<k1>', ..., p_name => 'Tol') $$, 'DK410', null, 'isi beda = DK410');
select throws_ok($$ ... create_category(... p_space_id => '<pribadi F>' ...) $$, 'DK404', null, 'ruang orang lain = DK404');
select throws_ok($$ ... create_category(... p_name => 'parkir' ...) [client baru] $$, '23505', null, 'nama ganda (beda huruf) ditolak');
-- update
select lives_ok($$ ... api.update_category(p_category_id => '<parkir>', p_name => 'Parkir & Tol', p_icon => 'Car', p_parent_id => null) $$);
select throws_ok($$ ... update_category(... p_parent_id => '<anak>') $$, 'DK422', 'category_depth', 'kedalaman > 2 ditolak');
select throws_ok($$ ... update_category(p_category_id => '<kategori Pribadi F>', ...) $$, 'DK404', null, 'bukan anggota = DK404');
-- archive
select is(tests.api_val(:n, $$select api.archive_category(p_category_id => '<induk>')->>'affected'$$), '2', 'induk + 1 anak diarsipkan');
select is(tests.api_val(:n, $$select api.archive_category(p_category_id => '<induk>')->>'affected'$$), '0', 'panggilan kedua tidak mengubah apa pun');
select lives_ok($$ ... api.create_category(... p_name => '<nama yang diarsipkan>' ...) $$, 'nama boleh dipakai lagi sesudah arsip (indeks unik parsial)');
select throws_ok($$ ... api.create_entry(... p_category_id => '<kategori terarsip>' ...) $$, 'DK422', 'category_archived', 'entri baru tidak boleh memakai kategori terarsip');
-- B9
select throws_ok($$ ... api.create_entry(p_space_id => '<bersama>', ... p_category_id => '<kategori pribadi N>') $$, 'DK404', 'category_not_found', 'B9');
```

  Perilaku `category_archived` di `api.create_entry`: tambahkan di 0106 sebagai `create or replace` fungsi `api.create_entry` yang disalin persis dari `0103` dengan satu cek tambahan sesudah `category_not_found` (`archived_at is not null` → `DK422 category_archived`). `api.update_entry` hanya menolak bila `p_category_id` **berubah** ke kategori terarsip (entri lama boleh disimpan ulang dengan kategorinya). Down mengembalikan definisi `0103`.

- [ ] **Step 2: Jalankan dan pastikan gagal.** `pg_prove -U dompetku_test -d dompetku packages/db/tests/11_kategori.sql` → FAIL (`function api.create_category does not exist`).
- [ ] **Step 3: Tulis `0106_kategori.sql`.**
  - Daftar kategori awal = `CATEGORIES` di `packages/demo-data/src/seed.ts` per ruang (`pribadi` → `personal`, `bersama` → `shared`): nama, `type`, `icon`, induk (lewat nama induk), `sort_order` = urutan di seed. Tulis sebagai `values` di `private.seed_categories`.
  - Kategori awal lahir saat **anggota pertama** masuk ruang: trigger `after insert on app.space_members` yang memanggil `private.seed_categories(new.space_id)` bila ruang belum punya kategori. Alasannya FORCE RLS: di titik itu `app.my_space_ids()` sudah memuat ruang baru sehingga insert lolos policy `member_write`. Fungsi trigger `security definer` milik `dompetku_api`, `set search_path = ''`, masuk daftar DEFINER tertutup di `00_katalog.sql`.
  - Backfill di blok up untuk ruang yang sudah ada (produksi sudah punya ruang pemilik): blok `do` yang, per ruang tanpa kategori, mengisi `set_config('app.user_id', <anggota pertama ruang>, true)` lalu memanggil `private.seed_categories(id)`. Jangan memakai `row_security = off`: pemilik migrasi tunduk FORCE RLS dan tidak punya policy tulis; insert harus lewat fungsi DEFINER milik `dompetku_api` dengan konteks anggota. Kosongkan lagi `app.user_id` di akhir blok. Tes: butir backfill memakai ruang yang dibuat sebelum `0106` dipasang (pola uji N-1: `dbmate rollback` ke 0105, provisikan, `dbmate up`).
  - Akhiri dengan `select private.own_api_functions();`. Down: penjaga prod, drop trigger, fungsi, kembalikan `api.create_entry`/`api.update_entry` 0103; kategori awal yang sudah tersisip **tidak** dihapus (data).
- [ ] **Step 4: Perbarui katalog dan pembersihan tes.** `00_katalog.sql`: fungsi baru di matriks EXECUTE (web: execute api.*; tidak ada PUBLIC). `global-setup.ts` dan `harness.ts`: urutan hapus `app.entry_lines`, `app.entry_history`, `app.entries`, `app.entry_tombstones`, `app.accounts`, `app.categories` dengan `set_config('dompetku.purge','on',true)` sebelum `app.space_members`.
- [ ] **Step 5: Jalankan semua tes DB dan auth.** `pg_prove … packages/db/tests/*.sql` → semua PASS; rollback + up menghasilkan skema identik (langkah CI job `db`); `pnpm --filter @dompetku/web test:int` → PASS.
- [ ] **Step 6: Commit.**

```bash
git add packages/db/migrations/0106_kategori.sql packages/db/tests apps/web/tests/e2e-auth/global-setup.ts apps/web/src/server/auth/__int__/harness.ts
git commit -m "feat(db): api kategori dan kategori awal ruang (0106)"
```

---

### Task 3: Migrasi 0107 saran kategori — **Model: terkuat**

**Files:**

- Create: `packages/db/migrations/0107_saran_kategori.sql`, `packages/db/tests/12_saran_kategori.sql`
- Modify: `packages/db/tests/00_katalog.sql`

**Interfaces:**

- Produces:

```sql
api.suggest_categories(
  p_space_id    uuid,
  p_type        app.category_type,
  p_hour        smallint default null,   -- jam WIB 0..23; null = jam app.now() WIB
  p_amount      bigint   default null,
  p_description text     default null,
  p_limit       int      default 6       -- 1..20, di luar = DK400 limit
) returns table (category_id uuid, score numeric, source text)  -- source in ('riwayat','kamus','nama')
-- language sql/plpgsql STABLE, SECURITY INVOKER, set search_path = '', app.assert_member(p_space_id) dulu
```

- [ ] **Step 1: Tulis tes pgTAP yang gagal** `12_saran_kategori.sql`. Kasus (angka persis dari selector demo `suggestCategories`, `packages/demo-data/src/selectors.ts`):
  - Jendela riwayat: entri hidup ruang ini, jenis = `p_type`, berkategori, `occurred_on > app.today() - 30` dan `<= app.today()`.
  - Bobot per entri: jam (`extract(hour from created_at at time zone 'Asia/Jakarta')`) berjarak melingkar ≤ 2 dari `p_hour` → 3, selain itu 1; dikali 1,5 bila `p_amount` diisi dan `|line main| between p_amount/2 and p_amount*2`.
  - Urutan: skor turun, lalu `lower(name)` naik; hanya kategori ruang ini, jenis ini, `archived_at is null`; `limit p_limit`.
  - Kamus: bila `p_description` memuat kata kunci kamus (tanpa beda huruf, batas kata), kategori sistem padanannya mendapat `+ 5` (`source = 'kamus'` bila skor riwayatnya 0). Riwayat kosong + tanpa deskripsi → urutan nama (`source = 'nama'`).
  - `throws_ok` ruang orang lain → `DK404`; entri batal tidak dihitung; kategori ruang lain tidak pernah muncul (QA M1: hanya dari ruang aktif).

```sql
select results_eq(
  $$select category_id from api.suggest_categories('<pribadi N>', 'expense', 12::smallint, 35000, null)$$,
  $$values ('<makan>'::uuid), ('<kopi>'), ('<transport>'), ('<belanja>'), ('<hiburan>'), ('<kesehatan>')$$,
  'urutan sama dengan selector demo untuk fixture yang sama');
select is((select source from api.suggest_categories('<bersama>', 'expense', 9::smallint, null, 'bensin motor') limit 1),
          'kamus', 'riwayat kosong: kamus menaruh Transportasi di depan');
```

- [ ] **Step 2: Jalankan → FAIL** (`function api.suggest_categories does not exist`).
- [ ] **Step 3: Tulis `0107_saran_kategori.sql`.** Kamus `private.category_keywords() returns table (keyword text, category_name text, space_kind app.space_kind)` IMMUTABLE berisi `values`; minimal: `makan, nasi, warteg, siang` → `Makan Siang & Minum`; `kopi, ngopi, camilan, jajan` → `Kopi & Camilan`; `bensin, parkir, ojek, gojek, grab, tol, krl, mrt` → `Transportasi`; `listrik, pln, air, pdam, internet, pulsa` → kategori tagihan ruang; `gaji` → `Gaji`; nama kategori tujuan harus ada di daftar kategori awal Task 2 (tes: setiap `category_name` kamus cocok dengan satu kategori awal ruangnya). Akhiri `select private.own_api_functions();`; down dengan penjaga prod.
- [ ] **Step 4: Jalankan semua tes DB → PASS.**
- [ ] **Step 5: Commit** `feat(db): api.suggest_categories dengan kamus kata kunci (0107)`.

---

### Task 4: Migrasi 0108 hari tanpa pengeluaran — **Model: terkuat**

**Files:**

- Create: `packages/db/migrations/0108_tanpa_pengeluaran.sql`, `packages/db/tests/13_tanpa_pengeluaran.sql`
- Modify: `packages/db/tests/00_katalog.sql` (RLS FORCE, FK berindeks, matriks hak), `packages/db/tests/03_isolasi.sql` atau `08_ledger_isolasi.sql` (dua user × `no_spend_days` × SELECT/INSERT/UPDATE/DELETE untuk web, api, worker), `apps/web/tests/e2e-auth/global-setup.ts` dan `harness.ts` (hapus `app.no_spend_days`)

**Interfaces:**

- Produces: tabel `app.no_spend_days` (**persis BSD §6**: `space_id`, `on_date`, `marked_by`, `marked_at`, PK `(space_id, on_date)`, indeks `(marked_by)`); RLS (**persis BSD §11**: `member_read` SELECT untuk `dompetku_web, dompetku_api`, `member_write` untuk `dompetku_api`; `grant select` ke web/api/auditor; `grant insert, delete on app.no_spend_days to dompetku_api`); `api.mark_no_spend_day(p_space_id uuid, p_on date default null) returns void` (**persis BSD §9**).

- [ ] **Step 1: Tes pgTAP yang gagal:**

```sql
select lives_ok($$ select tests.api_exec(:n, 'select api.mark_no_spend_day(p_space_id => ''<pribadi N>'')') $$);
select is(tests.web_val(:n, $$select on_date::text from app.no_spend_days$$), (select app.today()::text), 'mark_no_spend_day memakai app.today()');
select lives_ok($$ ... mark_no_spend_day lagi $$, 'kedua kali tidak galat (on conflict do nothing)');
select is(tests.web_val(:n, $$select count(*) from app.no_spend_days$$)::int, 1, 'tetap satu baris');
select throws_ok($$ ... mark_no_spend_day(p_space_id => '<pribadi N>', p_on => app.today() + 1) $$, 'DK400', null, 'tanggal depan ditolak');
select throws_ok($$ ... mark_no_spend_day(p_space_id => '<pribadi F>') oleh N $$, 'DK404', null, 'bukan anggota');
select is(tests.web_val(:f, $$select count(*) from app.no_spend_days$$)::int, 0, 'F tidak melihat baris Pribadi N');
select throws_ok($$ select tests.web_exec(:n, 'insert into app.no_spend_days values (...)') $$, '42501', null, 'web tidak bisa insert langsung');
-- batas hari: jam dimajukan ke 00:05 WIB hari berikutnya
select tests.clock('<interval sampai 00:05 WIB besok>');
select lives_ok($$ ... mark_no_spend_day ... $$);
select is(tests.web_val(:n, $$select max(on_date)::text from app.no_spend_days$$), '<besok>', '00:05 WIB = hari baru');
```

- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Tulis `0108_tanpa_pengeluaran.sql`** (tabel, RLS ENABLE + FORCE, policy, grant, fungsi, `own_api_functions`; down: penjaga prod, revoke, drop).
- [ ] **Step 4: Semua tes DB + `test:int` auth → PASS.**
- [ ] **Step 5: Commit** `feat(db): hari tanpa pengeluaran dan api.mark_no_spend_day (0108)`.

---

### Task 5: Parser nominal

**Files:**

- Create: `packages/domain/src/nominal.ts`, `packages/domain/src/nominal.test.ts`
- Modify: `packages/domain/src/index.ts`, `apps/web/src/components/ui/money-input.tsx` (tempel dan keyboard fisik memakai `parseNominal`), `apps/web/src/components/ui/money-input.test.tsx`

**Interfaces:**

- Produces: `export function parseNominal(input: string): Rupiah | null` (`Rupiah` = bilangan bulat aman ≥ 0).

- [ ] **Step 1: Tes tabel yang gagal:**

```ts
it.each([
  ['35rb', 35_000], ['35 rb', 35_000], ['35ribu', 35_000], ['35k', 35_000], ['35K', 35_000],
  ['1,5jt', 1_500_000], ['1.5jt', 1_500_000], ['1,25 juta', 1_250_000], ['2jt', 2_000_000],
  ['35.000', 35_000], ['Rp 35.000', 35_000], ['Rp35.000', 35_000], ['35000', 35_000], ['35', 35],
  ['1,5rb', 1_500], ['0,5jt', 500_000],
])('parseNominal(%s) = %d', (s, n) => expect(parseNominal(s)).toBe(n));
it.each(['', 'abc', '-5000', '1e3', '1,2,3jt', '1,555rb', '35rbx', '9007199254740993', '1.5'])(
  'parseNominal(%s) = null', (s) => expect(parseNominal(s)).toBeNull());
```

  Aturan: satuan `rb|ribu|k` ×1.000, `jt|juta` ×1.000.000 (tanpa beda huruf, spasi boleh); desimal `,` atau `.` hanya bila ada satuan dan hasilnya bulat (`1,555rb` = 1.555,… → null); tanpa satuan berlaku aturan `parseRupiah` (titik = pemisah ribuan, `1.5` → null); "35" tanpa satuan = Rp 35, tidak dikalikan (ui-ux R11).

- [ ] **Step 2: Jalankan** `pnpm --filter @dompetku/domain test` → FAIL.
- [ ] **Step 3: Implementasi** di `nominal.ts`, memakai ulang `parseRupiah` untuk bentuk tanpa satuan.
- [ ] **Step 4: MoneyInput.** Tempel memakai `parseNominal` (ganti `parseRupiah` di baris tempel); keyboard fisik: huruf satuan (`r`, `b`, `k`, `j`, `t`, `,`) ditampung di buffer teks dan dikonversi saat blur atau Enter. `inputMode` HP tetap `numeric` (prototipe tidak berubah). Tes: `MoneyInput tempel "1,5jt" = 1500000`, `MoneyInput tempel "1e3" tidak mengubah nilai`.
- [ ] **Step 5: `pnpm test` + `pnpm e2e` prototipe (catat.spec, money-text.spec) → PASS tanpa mengubah tes lama.**
- [ ] **Step 6: Commit** `feat(domain): parser nominal 35rb, 35k, 1,5jt`.

---

### Task 6: View-model ledger dan presenter

**Files:**

- Create: `apps/web/src/features/ledger/types.ts`, `apps/web/src/features/ledger/present.ts`, `apps/web/src/features/ledger/present.test.ts`

**Interfaces:**

- Produces (hanya tipe dan fungsi murni; tanpa impor `server/` atau `@dompetku/demo-data` runtime):

```ts
export type Ruang = 'pribadi' | 'bersama';
export type Pocket = 'operasional' | 'tabungan' | 'kantor';
export type WalletType = 'cash' | 'bank' | 'ewallet';
export interface AccountVM { id: string; name: string; pocket: Pocket;
  walletType: WalletType; openedOn: IsoDate; archived: boolean; balance: Rupiah }
export interface CategoryVM { id: string; parentId: string | null; name: string; type: 'income' | 'expense';
  icon: string; archived: boolean }
export interface EntryVM { id: string; version: number; kind: 'income' | 'expense' | 'transfer'
  | 'opening_balance' | 'space_transfer' | 'adjustment'; occurredOn: IsoDate; createdAt: string;
  createdBy: { id: string; name: string; initial: string }; accountId: string; accountName: string;
  counterAccountId?: string; counterAccountName?: string; amount: Rupiah; categoryId?: string;
  categoryName?: string; categoryIcon?: string; description?: string; voidedAt?: string;
  direction?: 'out' | 'in'; sharedNote?: string }
export interface HistoryVM { version: number; op: 'create' | 'update' | 'void' | 'restore';
  at: string; by: { name: string; initial: string }; amount?: Rupiah }
export interface TrashVM { entry: EntryVM; purgeAfter: string }
export interface MonthSummaryVM { pemasukan: Rupiah; pengeluaran: Rupiah; selisih: Rupiah; transfer: Rupiah }
export interface SafeToSpendVM { operasional: Rupiah; billsUntilEom: Rupiah; budgetWajibRemaining: Rupiah; aman: Rupiah }
export interface TodayStatusVM { hasEntry: boolean; noSpendMarked: boolean }
export type LedgerErrorCode = 'conflict' | 'idem_mismatch' | 'saldo_negatif' | 'before_opening'
  | 'account_archived' | 'category_archived' | 'restore_window_closed' | 'not_found'
  | 'invalid' | 'network' | 'unknown';
export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: { code: LedgerErrorCode; field?: string } };

export function entryTitleVM(e: EntryVM): string;
export function entryKindLabelVM(e: EntryVM): string;
export function signedAmountVM(e: EntryVM): { value: Rupiah; kind: 'income' | 'expense' | 'neutral' };
```

- [ ] **Step 1: Tes oracle yang gagal.** `present.test.ts`: untuk setiap entri `createSeed('full')`, ubah ke `EntryVM` lewat helper tes, lalu `expect(entryTitleVM(vm)).toBe(entryTitle(state, e))`, sama untuk `entryKindLabel` dan `signedAmount` (impor demo-data hanya di tes). Tambah kasus `adjustment` (judul `Cocokkan saldo`, jenis netral).
- [ ] **Step 2: Jalankan → FAIL. Step 3: Implementasi. Step 4: PASS.**
- [ ] **Step 5: Commit** `feat(web): view-model ledger dan presenter setara selector demo`.

---

### Task 7: Konteks navigasi lepas dari store demo

**Files:**

- Create: `apps/web/src/features/shell/nav-provider.tsx`
- Modify: `apps/web/src/app/layout.tsx` (pasang `DemoProvider` hanya bila `isPrototype()`, `NavProvider` selalu), `apps/web/src/features/shell/{app-header,nav-items,page-header,sidebar,space-switcher,tab-bar,catat}.tsx` (pakai `useNav()`), `apps/web/src/features/shell/demo-provider.tsx` (memakai `NavProvider` untuk href, tetap menyediakan `useDemo()` untuk view demo)

**Interfaces:**

- Produces:

```ts
export interface NavValue { ruang: Ruang; today: IsoDate; query: string; month: string;
  href(ruang: Ruang, tab: Tab): Route; entryHref(ruang: Ruang, id: string): Route;
  accountHref(ruang: Ruang, id: string): Route; monthHref(ruang: Ruang, month: string): Route;
  sampahHref(ruang: Ruang): Route; kategoriHref(ruang: Ruang): Route }
export function NavProvider(props: { today: IsoDate; children: ReactNode }): JSX.Element; // today dari server (todayWIB) di mode nyata
export function useNav(): NavValue;
```

  Mode prototipe: `KEPT_PARAMS` tetap terbawa (perilaku href lama). Mode nyata: query hanya `bulan` dan `theme`.

- [ ] **Step 1: Tes yang gagal.** Vitest `nav-provider.test.tsx`: `href('bersama','transaksi')` mempertahankan `seed`/`today`/`keypad` di prototipe; e2e baru `tests/e2e/shell.spec.ts` **tidak** diubah. Tes server `app/layout` (unit render dengan `NEXT_PUBLIC_PROTOTYPE` kosong): pohon tidak memuat `DemoProvider` (`mode nyata tanpa DemoProvider`).
- [ ] **Step 2: FAIL. Step 3: Implementasi; komponen shell tidak lagi memanggil `useDemo()`.**
- [ ] **Step 4: Verifikasi.** `pnpm test`, `pnpm build`, `pnpm e2e` (220 lama lulus); `budget.spec.ts` prototipe ≤ 162 kB dan selisih terhadap `main` dicatat di pesan commit (mis. `+0,2 kB`).
- [ ] **Step 5: Commit** `refactor(web): konteks navigasi terpisah dari store demo`.

---

### Task 8: Inti akses data server (galat, retry, resolusi ruang) — **Model: terkuat**

**Files:**

- Create: `apps/web/src/server/ledger/errors.ts`, `errors.test.ts`, `retry.ts`, `retry.test.ts`, `space.ts`, `apps/web/src/server/ledger/__int__/space.int.test.ts`, `apps/web/src/server/ledger/__int__/harness.ts` (memakai ulang pola `server/auth/__int__/harness.ts`: pool `dompetku_web`, admin untuk reset, pembuat persona N, F, Luar lewat fungsi provisioning sungguhan)

**Interfaces:**

- Consumes: `withUser`, `domainError`, `Pools` (`apps/web/src/server/db.ts`).
- Produces:

```ts
export function toLedgerError(e: unknown): { code: LedgerErrorCode; field?: string } | null; // null = bukan galat domain → lempar ulang
export async function withLedger<T>(pools: Pools, userId: string, spaceId: string,
  fn: (c: pg.PoolClient) => Promise<T>): Promise<T>;              // withUser + retry 40001/40P01 maks 3
export async function resolveSpace(pools: Pools, userId: string, ruang: Ruang): Promise<{ spaceId: string; kind: 'personal' | 'shared' }>;
// tidak ditemukan / bukan anggota → notFound() di page, { ok:false, code:'not_found' } di action
```

  Pemetaan: `DK409` → `conflict`; `DK410` → `idem_mismatch`; `DK422 saldo_negatif|before_opening|account_archived|category_archived|restore_window_closed` → kode sama; `DK404` → `not_found`; `DK400` → `invalid` + `field` dari `detail`; `DK401`/`DK500` dan lainnya → `unknown` (dilog tanpa argumen); `ECONNREFUSED`/`ETIMEDOUT`/pool habis → `network`.

- [ ] **Step 1: Tes unit yang gagal:** `toLedgerError({code:'DK422', message:'saldo_negatif'})` = `{code:'saldo_negatif'}`; `DK400` dengan `detail:'occurred_on'` = `{code:'invalid', field:'occurred_on'}`; galat non-domain = `null`. `withLedger` dengan fn yang dua kali melempar `{code:'40001'}` lalu berhasil → dipanggil 3 kali; empat kali `40P01` → melempar sesudah percobaan ke-4 (1 + 3 ulang).
- [ ] **Step 2: Tes int yang gagal** (`space.int.test.ts`): N `resolveSpace('pribadi')` = ruang Pribadi N; F yang belum bergabung `resolveSpace('bersama')` → not_found; tanpa `app.user_id` tidak ada baris (B11).
- [ ] **Step 3: Implementasi. Step 4:** `pnpm test` + `test:int` → PASS.
- [ ] **Step 5: Commit** `feat(web): inti akses data ledger server (galat, retry, ruang)`.

---

### Task 9: Wrapper tulis `api.*` — **Model: terkuat**

**Files:**

- Create: `apps/web/src/server/ledger/write.ts`, `apps/web/src/server/ledger/events.ts`, `apps/web/src/server/ledger/__int__/write.int.test.ts`

**Interfaces:**

- Consumes: Task 8.
- Produces (semua `async`, argumen pertama `ctx: { pools: Pools; userId: string; spaceId: string }`, input divalidasi Zod di dalam, hasil `jsonb` divalidasi Zod):

```ts
createEntry(ctx, i: { clientId: string; accountId: string; kind: 'income' | 'expense'; amount: Rupiah;
  categoryId: string; occurredOn?: IsoDate; description?: string; allowNegative?: boolean })
  : Promise<{ entryId: string; version: number; replayed: boolean; warnings: string[] }>;
createTransfer(ctx, i: { clientId: string; fromAccountId: string; toAccountId: string; amount: Rupiah;
  occurredOn?: IsoDate; description?: string; allowNegative?: boolean }) // dalam satu ruang saja di S6
  : Promise<{ entryId: string; version: number; replayed: boolean }>;
updateEntry(ctx, i: { clientId: string; entryId: string; expectedVersion: number; accountId: string;
  amount: Rupiah; categoryId: string | null; occurredOn: IsoDate | null; description: string | null;
  reimbursable: boolean; allowNegative?: boolean }): Promise<{ entryId: string; version: number }>;
voidEntry(ctx, i: { clientId: string; entryId: string; expectedVersion: number }): Promise<{ version: number }>;
restoreEntry(ctx, i: { clientId: string; entryId: string; expectedVersion: number; allowNegative?: boolean }): Promise<{ version: number }>;
createAccount(ctx, i: { clientId: string; name: string; pocket: Pocket; walletType: WalletType; openingBalance: Rupiah }): Promise<{ accountId: string }>;
createCategory(ctx, i: { clientId: string; type: 'income' | 'expense'; name: string; icon: string; parentId?: string }): Promise<{ categoryId: string }>;
updateCategory(ctx, i: { categoryId: string; name: string; icon: string; parentId: string | null }): Promise<void>;
archiveCategory(ctx, i: { categoryId: string }): Promise<{ affected: number }>;
markNoSpendDay(ctx): Promise<void>;
// events.ts
recordProductEvent(pools: Pools, userId: string, e: { event: 'catat_dibuka' | 'catat_disimpan' | 'catat_batal'
  | 'tanpa_pengeluaran'; spaceKind: 'personal' | 'shared'; flowId?: string; taps?: number; durationMs?: number }): Promise<void>;
```

  Zod: `clientId`/id = `z.uuid()`; `amount` = `z.number().int().positive().max(10 ** 13)`; `name` btrim 1–40; `icon` `^[A-Z][A-Za-z0-9]{0,39}$`; `taps` 0–100; `durationMs` 0–3600000. Setiap fungsi tulis memanggil `withLedger(…, ctx.spaceId, …)` dan mengirim `p_space_id => ctx.spaceId` bila fungsi menerimanya. `recordProductEvent` insert langsung (`grant select, insert` web, policy `own`), kolom eksplisit tanpa nominal.

- [ ] **Step 1: Tes int yang gagal** (`write.int.test.ts`, Postgres sungguhan, persona N/F dari harness):
  - `idempotensi: clientId sama dua kali = satu entri` → `entryId` sama, kedua `replayed: true`, `count(entries)` = 1.
  - `clientId sama isi beda = idem_mismatch`.
  - `saldo kurang tanpa allowNegative = saldo_negatif, tanpa baris baru`; dengan `allowNegative` → tersimpan, saldo negatif.
  - `updateEntry versi usang = conflict`; `voidEntry` lalu `restoreEntry` mengembalikan saldo awal (S1 analog di level web).
  - `restore sesudah 90 hari = restore_window_closed` (jam lewat `tests.clock` tidak tersedia di web; gunakan admin untuk memundurkan `voided_at`).
  - `ruang Bersama tidak menerima dompet Pribadi` → `not_found` (B2/S6).
  - `recordProductEvent tanpa nominal`: baris tersimpan; `select column_name from information_schema.columns where table_name='product_events'` tidak memuat kolom nominal/deskripsi; event `catat_disimpan` tanpa `taps` → Zod menolak sebelum DB.
- [ ] **Step 2: FAIL. Step 3: Implementasi. Step 4: `test:int` → PASS.**
- [ ] **Step 5: Commit** `feat(web): wrapper tulis api ledger dengan Zod dan event produk`.

---

### Task 10: Loader baca — **Model: terkuat**

**Files:**

- Create: `apps/web/src/server/ledger/read.ts`, `apps/web/src/server/ledger/__int__/read.int.test.ts`

**Interfaces:**

- Consumes: Task 6 (VM), Task 8.
- Produces (semua via `withLedger`, transaksi pendek; tipe `date` = string, `int8` = number):

```ts
listAccounts(ctx): Promise<AccountVM[]>;                    // app.accounts ⨝ app.account_balances, tanpa yang diarsipkan kecuali saldo ≠ 0 (tidak mungkin, BSD §2.2 butir 4)
listCategories(ctx, opts?: { includeArchived?: boolean }): Promise<CategoryVM[]>;
suggestCategories(ctx, i: { type: 'income' | 'expense'; hour?: number; amount?: Rupiah; description?: string }): Promise<string[]>; // id urut
listEntries(ctx, i: { month: string /* YYYY-MM */; accountId?: string }): Promise<EntryVM[]>; // hidup saja, terbaru di atas
recentEntries(ctx, limit: number): Promise<EntryVM[]>;
getEntry(ctx, entryId: string): Promise<{ entry: EntryVM; history: HistoryVM[] } | null>; // termasuk yang dibatalkan
monthSummary(ctx, month: string): Promise<MonthSummaryVM>;   // api.month_summary
safeToSpend(ctx): Promise<SafeToSpendVM>;                    // api.safe_to_spend
trashList(ctx): Promise<TrashVM[]>;                          // api.trash_list(p_limit => 100)
todayStatus(ctx): Promise<TodayStatusVM>;                    // entri hidup occurred_on = app.today() atau baris no_spend_days
```

  Nama pembuat dari `app.space_roster(space_id)`. Kaki `space_transfer` di ruang Bersama tidak membawa nama dompet atau deskripsi ruang lain (BSD §6 privasi transfer).

- [ ] **Step 1: Tes int yang gagal:**
  - `kanari Pribadi tidak terbaca dari Bersama`: F (Bersama) memanggil semua loader untuk ruang Bersama; `JSON.stringify(hasil)` tidak memuat `KANARI-FARIDA-PRIBADI-7f3a`/`KANARI-DOMPET-F` milik N atau nominal 7777777 (QA R4).
  - `T13: 31 Okt 23:30 WIB masuk Oktober`: entri `occurred_on = '2026-10-31'` dibuat saat jam DB 23:30 WIB muncul di `listEntries({month:'2026-10'})`, tidak di `2026-11`.
  - `saldo listAccounts = Σ lines` setelah create/void/restore.
  - `getEntry entri batal tetap terbaca dengan voidedAt`; `trashList` hanya entri batal ≤ 90 hari, terbaru dulu.
  - `todayStatus` false/false → `markNoSpendDay` → `{hasEntry:false, noSpendMarked:true}`.
  - `suggestCategories` sama dengan `api.suggest_categories` langsung (urutan id).
- [ ] **Step 2: FAIL. Step 3: Implementasi. Step 4: `test:int` → PASS.**
- [ ] **Step 5: Commit** `feat(web): loader baca ledger untuk Beranda, Transaksi, Dompet, Sampah`.

---

### Task 11: Server Actions ruang — **Model: terkuat**

**Files:**

- Create: `apps/web/src/app/[ruang]/_actions/{catat,entri,kategori,dompet,beranda}.ts`, `apps/web/src/app/[ruang]/_actions/context.ts`, `apps/web/src/app/[ruang]/_actions/actions.test.ts`

**Interfaces:**

- Consumes: `requireDataUser()` (`server/auth/next.ts`), Task 8–10.
- Produces (`'use server'`; semua mengembalikan `ActionResult<T>`, tidak pernah melempar galat domain ke klien):

```ts
// context.ts (bukan 'use server')
export async function actionContext(ruang: unknown): Promise<{ pools: Pools; userId: string; spaceId: string; kind: 'personal' | 'shared' }>;
// requireDataUser(); null (prototipe) → throw new Error('prototipe'); ruang lewat z.enum(['pribadi','bersama'])
// catat.ts
saveCatat(ruang, input): Promise<ActionResult<{ entryId: string; version: number; replayed: boolean }>>; // expense/income/transfer
catatOptions(ruang): Promise<ActionResult<{ accounts: AccountVM[]; categories: CategoryVM[] }>>; // dipakai saat pindah ruang di sheet
suggestFor(ruang, i: { type: 'income' | 'expense'; hour: number; amount?: Rupiah; description?: string }): Promise<ActionResult<string[]>>;
logCatatEvent(ruang, e: { event: 'catat_dibuka' | 'catat_disimpan' | 'catat_batal'; flowId: string; taps?: number; durationMs?: number }): Promise<void>; // galat ditelan
// entri.ts
updateEntryAction, voidEntryAction, restoreEntryAction, reloadEntry(ruang, entryId) // reloadEntry untuk layar konflik
// kategori.ts
createCategoryAction, updateCategoryAction, archiveCategoryAction
// dompet.ts
createAccountAction
// beranda.ts
markNoSpendDayAction(ruang): Promise<ActionResult<void>>; // juga mencatat event 'tanpa_pengeluaran'
```

  Sesudah mutasi sukses, action memanggil `refresh()` dari `next/cache` (Next 16; bila tidak tersedia di 16.4.3, `revalidatePath('/[ruang]', 'layout')`) agar RSC ruang dimuat ulang tanpa cache data.

- [ ] **Step 1: Tes yang gagal** (`actions.test.ts`, Vitest, `vi.mock` untuk `requireDataUser` dan wrapper):
  - `action menolak di mode prototipe`: `requireDataUser` → `null` → setiap action exported melempar dan wrapper tidak pernah dipanggil.
  - `setiap action memanggil requireDataUser sebelum wrapper` (urutan panggilan mock).
  - Pemindaian sumber: setiap `export async function` di `_actions/*.ts` (kecuali `context.ts`) memanggil `actionContext(` di baris pertama badannya (regex atas isi berkas).
  - `ruang tidak sah` (`'kantor'`) → `{ok:false, error:{code:'invalid', field:'ruang'}}`.
- [ ] **Step 2: FAIL. Step 3: Implementasi. Step 4: `pnpm test` → PASS.**
- [ ] **Step 5: Commit** `feat(web): server action ruang dengan gerbang requireDataUser`.

---

### Task 12: Sheet Catat lewat `CatatSource` + keadaan nyata

**Files:**

- Create: `apps/web/src/features/catat/source.ts`, `apps/web/src/features/catat/demo-source.ts`, `apps/web/src/features/catat/catat-status.tsx` (pesan inline S6-C1…C6), `apps/web/src/app/[ruang]/_real/catat-source-real.ts`
- Modify: `apps/web/src/features/catat/use-catat.tsx`, `use-catat.test.ts`, `catat-sheet.tsx`, `apps/web/src/app/[ruang]/ruang-shell.tsx` (sumber demo), `apps/web/src/app/dev/ui/gallery.tsx` (bingkai S6-C1…C6)

**Interfaces:**

- Consumes: Task 6 (VM), Task 11 (`saveCatat`, `catatOptions`, `suggestFor`).
- Produces:

```ts
export interface CatatSource {
  ruangLabel: Record<Ruang, string>;
  options(ruang: Ruang): { accounts: AccountVM[]; categories: CategoryVM[] } | Promise<{ accounts: AccountVM[]; categories: CategoryVM[] }>;
  chips(ruang: Ruang, type: 'income' | 'expense', hour: number): CategoryVM[] | Promise<CategoryVM[]>; // 6 kategori
  save(draft: CatatDraft & { allowNegative: boolean }): Promise<SaveOutcome>;
  undo(saved: { entryId: string; version: number; ruang: Ruang }): Promise<boolean>;
}
export type SaveOutcome =
  | { ok: true; entryId: string; version: number; replayed: boolean; toast: string }
  | { ok: false; code: LedgerErrorCode; field?: string };
export type CatatStatus = 'idle' | 'menyimpan' | 'galat' | 'saldo_kurang' | 'idem_mismatch' | 'field';
// useCatat({ source, today, ruang, hourWIB?, initialAmount? }) → { …yang lama, status, retry(), saveAnyway(), saveAsNew(), save(): Promise<SaveOutcome | null> }
export function demoCatatSource(state: DemoState, store: DemoStore): CatatSource; // perilaku lama, Promise.resolve
```

  Sumber nyata: `options(ruang)` ruang awal dari props layout (data ruang ini saja), ruang lain lewat `catatOptions` saat `switchRuang`; `chips` lewat `suggestFor` sekali per (ruang, jenis) lalu dibekukan; `save` lewat `saveCatat`; `undo` lewat `voidEntryAction` dengan `expectedVersion` = versi hasil simpan. `clientId` dibuat `crypto.getRandomValues` lalu diformat UUID v4.

- [ ] **Step 1: Tes yang gagal** (`use-catat.test.ts`, sumber palsu):
  - `menyimpan: save menunggu → status 'menyimpan', canSave false`.
  - `galat lalu coba lagi memakai clientId sama`: `save` pertama `{ok:false, code:'network'}` → status `galat`, isian utuh; `retry()` memanggil sumber dengan `clientId` yang sama.
  - `saldo_negatif → status saldo_kurang; saveAnyway() mengirim allowNegative true`.
  - `idem_mismatch → saveAsNew() mengirim clientId baru`.
  - `before_opening → status field, field 'occurred_on'`.
  - `switchRuang meminta options ruang tujuan dan clientId baru` (prototipe: sinkron dari demo).
  - Tes lama `use-catat.test.ts` tetap lulus dengan `demoCatatSource`.
- [ ] **Step 2: FAIL. Step 3: Implementasi** sesuai bingkai S6-C1…C6 dan salinan Task 1. "Menyimpan…" = `Button` nonaktif + teks + `aria-busy`; galat `role="alert"` + fokus ke pesan; saldo kurang muncul di bawah pemilih dompet.
- [ ] **Step 4: Galeri.** Tambah S6-C1…C6 ke `/dev/ui` (prop sumber palsu).
- [ ] **Step 5: Design reviewer.** Bandingkan galeri dengan `docs/design/s6-bingkai.md` di 320/390/1280, terang dan gelap; jalankan `mcp__plugin_antislop_antislop-contrast__check_contrast` untuk pasangan warna baru; catat temuan di PR.
- [ ] **Step 6: Verifikasi.** `pnpm test`; `pnpm e2e` (220 lama lulus); mode keyboard 360×640 dengan pesan galat tampil: Simpan tetap terlihat, sheet ≤ 356 (tambah tes `catat galat muat di atas keyboard`).
- [ ] **Step 7: Commit** `feat(web): sheet Catat lewat CatatSource dengan keadaan menyimpan, galat, saldo kurang`.

---

### Task 13: Telemetri Catat (ketukan dan event)

**Files:**

- Create: `apps/web/src/features/catat/telemetry.ts`, `telemetry.test.ts`
- Modify: `catat-sheet.tsx`, `apps/web/src/features/shell/catat.tsx` (`OpenCatatOptions.via: 'pointer' | 'shortcut'`), `catat-shortcut.ts`, `source.ts` (`CatatSource.track?(e)`)

**Interfaces:**

- Produces:

```ts
export interface CatatTelemetry { flowId: string; openedAt: number; taps: number }
export function startTelemetry(via: 'pointer' | 'shortcut', now: number): CatatTelemetry; // taps awal = 1 bila pointer, 0 bila 'c'
export function countTap(t: CatatTelemetry, e: { detail: number; target: Element }): CatatTelemetry;
// dihitung: click dengan detail > 0 pada elemen interaktif di sheet; tidak dihitung: tombol keypad angka
// ([data-keypad-digit]), MoneyInput, aktivasi keyboard (detail === 0)
export function finishTelemetry(t: CatatTelemetry, now: number): { flowId: string; taps: number; durationMs: number }; // taps dibatasi 100, durasi 3600000
```

  Event: `catat_dibuka` saat sheet terbuka; `catat_disimpan` saat simpan sukses (sekali per flow; replay tidak mengirim ulang); `catat_batal` saat ditutup tanpa simpan. Sumber demo: `track` no-op (prototipe tidak menulis apa pun).

- [ ] **Step 1: Tes yang gagal:** jalur Catat → chip → Simpan = `taps 3`; via `c` → chip → Simpan = `2`; ketik nominal di keypad aplikasi tidak menambah; Enter di keyboard tidak menambah; payload `finishTelemetry` hanya berkunci `flowId`, `taps`, `durationMs`.
- [ ] **Step 2: FAIL. Step 3: Implementasi. Step 4: `pnpm test` + `pnpm e2e` → PASS.**
- [ ] **Step 5: Commit** `feat(web): hitung ketukan Catat dan event produk tanpa nominal`.

---

### Task 14: Shell nyata dan Beranda nyata

**Files:**

- Create: `apps/web/src/app/[ruang]/_real/ruang-shell-real.tsx`, `apps/web/src/app/[ruang]/_real/beranda.tsx`, `apps/web/src/features/beranda/no-spend-button.tsx`
- Modify: `apps/web/src/app/[ruang]/layout.tsx` (prototipe → `RuangShell`; nyata → muat `listAccounts`, `listCategories` ruang ini lalu `RuangShellReal`), `apps/web/src/app/[ruang]/beranda/page.tsx`, presentasional Beranda yang dipakai ulang (`safe-to-spend.tsx`, `recent-entries.tsx`, `onboarding-checklist.tsx`) dipisah menjadi `*-view.tsx` ber-prop VM + pembungkus demo (pembungkus demo memakai selector seperti sekarang), `apps/web/src/app/dev/ui/gallery.tsx` (S6-B1)

**Interfaces:**

- Consumes: Task 10 (`safeToSpend`, `recentEntries`, `todayStatus`, `listAccounts`), Task 11 (`markNoSpendDayAction`), Task 12 (sumber nyata).
- Produces: `RuangShellReal({ ruang, accounts, categories, today, children })`; Beranda nyata = kartu utama (`SafeToSpendVM`), checklist (Akun aman selesai; Tambah dompet; Catat satu pengeluaran; Undang Farida untuk pemilik bila Bersama belum lengkap), Transaksi terbaru, tombol S6-B1. Seksi anggaran, tagihan, feed aktivitas **tidak dirender** di mode nyata sampai S8/S9.

- [ ] **Step 1: Tes yang gagal.** Unit `no-spend-button.test.tsx`: tampil hanya bila `!hasEntry && !noSpendMarked`; sesudah sukses menampilkan `Hari ini tercatat tanpa pengeluaran.` dengan `role="status"`. Unit view kartu: `SafeToSpendVM` negatif → `danger` + kotak peringatan (pola DBD §3).
- [ ] **Step 2: FAIL. Step 3: Implementasi.** Page: `if (isPrototype()) return <BerandaPage/>; const s = await requireDataUser(); …loader…; return <BerandaReal …/>`. Layout dan page memanggil `requireDataUser()`.
- [ ] **Step 4: Design reviewer** (S6-B1, kartu nyata tanpa anggaran/tagihan, 320 px).
- [ ] **Step 5: Verifikasi.** `pnpm test`, `pnpm build`, `pnpm e2e` (prototipe, `beranda.spec` lama lulus), budget prototipe ≤ 162 kB.
- [ ] **Step 6: Commit** `feat(web): Beranda nyata dengan tombol tidak ada pengeluaran hari ini`.

---

### Task 15: Transaksi nyata (daftar + ringkasan)

**Files:**

- Create: `apps/web/src/app/[ruang]/_real/transaksi.tsx`, `apps/web/src/features/transaksi/entry-row-view.tsx`, `entry-list-view.tsx`, `summary-view-vm.tsx`
- Modify: `apps/web/src/features/transaksi/{entry-row,entry-list,summary-view}.tsx` (pembungkus demo memetakan ke VM lalu merender view), `apps/web/src/app/[ruang]/transaksi/page.tsx`

**Interfaces:**

- Consumes: Task 6, Task 10 (`listEntries`, `monthSummary`).
- Produces: `EntryRowView({ entry: EntryVM, href: Route })`, `EntryListView({ groups: { date: IsoDate; label: string; total: Rupiah; entries: EntryVM[] }[], … })`; pengelompokan hari dihitung di server dengan logika yang sama dengan `groupByDay` (unit tes oracle seperti Task 6). Ringkasan nyata = `MonthSummaryVM` (`api.month_summary`); progres anggaran tidak dirender (S9). Tautan `Sampah` di bawah daftar (Task 17).

- [ ] **Step 1: Tes yang gagal.** `entry-row-view.test.tsx`: markup untuk VM dari seed = markup `EntryRow` demo lama (snapshot DOM sama); `groupByDayVM` oracle terhadap `groupByDay`.
- [ ] **Step 2: FAIL. Step 3: Implementasi. Step 4: Design reviewer** (kosong pertama, kosong karena filter, gagal muat; 320 px).
- [ ] **Step 5: Verifikasi.** `pnpm e2e` (`transaksi.spec` lama lulus), budget `/pribadi/transaksi` prototipe ≤ 162 kB.
- [ ] **Step 6: Commit** `feat(web): daftar dan ringkasan Transaksi dari ledger`.

---

### Task 16: Detail nyata: Ubah, konflik versi, Batalkan, dibatalkan — **Model: terkuat** (jalur uang)

**Files:**

- Create: `apps/web/src/app/[ruang]/_real/detail.tsx`, `apps/web/src/features/transaksi/edit-sheet.tsx`, `conflict-notice.tsx`, `voided-banner.tsx`
- Modify: `apps/web/src/app/[ruang]/transaksi/[id]/page.tsx`, `apps/web/src/features/transaksi/{entry-detail,void-dialog}.tsx` (view ber-VM + pembungkus demo), `apps/web/src/app/dev/ui/gallery.tsx` (S6-D1…D3)

**Interfaces:**

- Consumes: Task 10 (`getEntry`), Task 11 (`updateEntryAction`, `voidEntryAction`, `restoreEntryAction`, `reloadEntry`).
- Produces: `EditSheet({ entry: EntryVM, accounts, categories, onSaved })` memakai bentuk sheet Catat (S6-D1), mengirim ganti-penuh dengan `expectedVersion = entry.version`. Konflik (`conflict`) → `reloadEntry` → `ConflictNotice({ latest: EntryVM, by, at, before: Rupiah, after: Rupiah })` dengan `Muat ulang` (ganti draf dengan nilai terbaru) dan `Timpa dengan perubahan saya` (kirim draf dengan `expectedVersion = latest.version`). Batalkan → `voidEntryAction` → kembali ke daftar + toast `Urungkan` (6 detik, `restoreEntryAction`). Entri batal (`voidedAt`) → `VoidedBanner` + `Pulihkan`; bukan 404. "Pindahkan ke ruang lain" tidak dirender di mode nyata (S7).

- [ ] **Step 1: Tes yang gagal.** Unit `conflict-notice.test.tsx` (`konflik versi menampilkan nilai terbaru`): teks persis `Farida mengubah transaksi ini 2 menit lalu (Rp 50.000 → Rp 45.000). Muat versi terbaru untuk melanjutkan.`; `Timpa` memanggil action dengan versi terbaru. Unit `edit-sheet.test.tsx`: field yang tidak diubah tetap dikirim (ganti-penuh), deskripsi dikosongkan dikirim `null`.
- [ ] **Step 2: FAIL. Step 3: Implementasi. Step 4: Galeri + design reviewer** (S6-D1…D3, fokus awal dialog Batalkan di `Kembali`).
- [ ] **Step 5: Verifikasi** `pnpm test`, `pnpm e2e`.
- [ ] **Step 6: Commit** `feat(web): ubah transaksi dengan konflik versi, batalkan, dan pulihkan`.

---

### Task 17: Layar Sampah (kedua mode)

**Files:**

- Create: `apps/web/src/app/[ruang]/sampah/page.tsx`, `apps/web/src/app/[ruang]/sampah/view.tsx` (prototipe: entri `voidedAt` dari store demo ≤ 90 hari terhadap `today`), `apps/web/src/app/[ruang]/_real/sampah.tsx`, `apps/web/src/features/sampah/trash-list-view.tsx`, `apps/web/tests/e2e/sampah.spec.ts` (prototipe, baru)
- Modify: `apps/web/src/features/shell/menu-sheet.tsx` (butir `Sampah` aktif di kedua mode; butir lain tetap "Segera"), `apps/web/src/features/shell/hrefs.ts` (`sampah` bukan `Tab`, rute tambahan), `apps/web/src/app/dev/ui/gallery.tsx` (S6-S1), `apps/web/tests/e2e/routes.ts` dan `a11y.spec.ts` (tambah rute baru ke daftar audit tanpa mengubah tes lama)

**Interfaces:**

- Consumes: Task 10 (`trashList`), Task 11 (`restoreEntryAction`), Task 7 (`sampahHref`).
- Produces: `TrashListView({ items: TrashVM[], onRestore(id, version) })`; baris = TxRow + `Terhapus permanen {fullDateLabel(purgeAfter)}` + tombol `Pulihkan`. `restore_window_closed` → pesan S6-S1 sebaris, baris tetap. Page memanggil `requireDataUser()`.

- [ ] **Step 1: Tes e2e prototipe yang gagal** (`sampah.spec.ts`): batalkan entri dari Detail → buka Menu → Sampah → entri tampil dengan `Terhapus permanen` → `Pulihkan` → toast `Dipulihkan · Rp …` → entri kembali di Transaksi; Sampah kosong menampilkan salinan S6-S1; axe 0 serious/critical terang/gelap 320/390/1280.
- [ ] **Step 2: FAIL. Step 3: Implementasi. Step 4: Design reviewer** (S6-S1 semua keadaan).
- [ ] **Step 5: Verifikasi** `pnpm e2e` (220 lama + baru).
- [ ] **Step 6: Commit** `feat(web): layar Sampah untuk memulihkan transaksi batal 90 hari`.

---

### Task 18: Dompet nyata dan Menu → Kategori

**Files:**

- Create: `apps/web/src/app/[ruang]/_real/dompet.tsx`, `apps/web/src/app/[ruang]/_real/dompet-detail.tsx`, `apps/web/src/app/[ruang]/kategori/page.tsx`, `apps/web/src/app/[ruang]/_real/kategori.tsx`, `apps/web/src/features/kategori/{category-list,category-form,archive-dialog}.tsx`
- Modify: `apps/web/src/app/[ruang]/dompet/page.tsx`, `dompet/[id]/page.tsx`, `apps/web/src/features/dompet/{account-list,account-history,add-account-sheet}.tsx` (view ber-VM + pembungkus demo; `AddAccountSheet` menerima `onSubmit` async), `apps/web/src/features/shell/menu-sheet.tsx` (`Kategori` aktif hanya di mode nyata; prototipe tetap "Segera"), `apps/web/src/app/dev/ui/gallery.tsx` (S6-K1, S6-K2)

**Interfaces:**

- Consumes: Task 10 (`listAccounts`, `listEntries({accountId})`, `listCategories`), Task 11 (`createAccountAction`, `createCategoryAction`, `updateCategoryAction`, `archiveCategoryAction`).
- Produces: Dompet nyata = daftar dengan saldo `account_balances`, Tambah dompet (`api.create_account`, saldo hari ini → entri Saldo awal), riwayat per dompet. Cocokkan saldo, edit saldo awal, arsip dompet: S7 (tidak dirender di mode nyata). Kategori: S6-K1/K2; ikon dipilih dari `category-icon-map.tsx`.

- [ ] **Step 1: Tes yang gagal.** Unit `category-form.test.tsx`: nama kosong → `Nama kategori wajib diisi.` di bawah field + fokus; nama 41 karakter ditolak; `archive-dialog` fokus awal `Kembali`. Unit `account-list` view: saldo dari VM, bukan selector.
- [ ] **Step 2: FAIL. Step 3: Implementasi. Step 4: Design reviewer** (S6-K1/K2, Dompet nyata kosong: `Belum ada dompet di {Ruang}.` + `Tambah dompet`).
- [ ] **Step 5: Verifikasi** `pnpm test`, `pnpm e2e` (`dompet-onboarding.spec` lama lulus).
- [ ] **Step 6: Commit** `feat(web): Dompet nyata dan pengelolaan kategori`.

---

### Task 19: E2E mode nyata (`e2e:ledger`) + CI

**Files:**

- Create: `apps/web/playwright.ledger.config.ts` (port 3301, `testDir: './tests/e2e-ledger'`, env sama dengan `playwright.auth.config.ts`, tanpa `NEXT_PUBLIC_PROTOTYPE`), `apps/web/tests/e2e-ledger/global-setup.ts` (reset data seperti Task 2/4 + pasang `owner_email`), `apps/web/tests/e2e-ledger/fixtures.ts` (daftar pemilik lewat alur nyata + passkey virtual, `storageState` disimpan; helper dipindah dari `tests/e2e-auth/auth.spec.ts` ke `tests/e2e-auth/helpers.ts` dan diimpor ulang tanpa mengubah perilaku tes auth), `apps/web/tests/e2e-ledger/ledger.spec.ts`
- Modify: `apps/web/package.json` (`"e2e:ledger": "playwright test -c playwright.ledger.config.ts"`), `.github/workflows/ci.yml` (job `auth`: langkah `E2E ledger mode nyata` sesudah `e2e:auth`, env `AUTH_E2E_DATABASE_URL`/`AUTH_E2E_ADMIN_URL` sama; tanpa action baru), `packages/db/README.md` (cara menjalankan lokal)

**Interfaces:**

- Consumes: semua task sebelumnya.

- [ ] **Step 1: Tulis spesifikasi (serial):**
  - `Tambah dompet lalu Catat ≤ 3 ketukan dari Beranda, Transaksi, Dompet di Pribadi dan Bersama`: helper menghitung `click` dari tombol Catat sampai toast `Tersimpan`, gagal bila > 3; 6 kombinasi.
  - `Catat → Transaksi → Batalkan → Sampah → Pulihkan`: saldo dompet (dibaca dari UI Dompet) kembali; baris kembali di Transaksi.
  - `Urungkan 6 detik mengembalikan saldo`.
  - `klik ganda Simpan = satu baris` (dua klik cepat; satu baris di Transaksi; satu baris `entries` via admin).
  - `koneksi putus lalu Coba lagi`: `page.route` menggagalkan POST action pertama → pesan galat simpan; Coba lagi → satu entri.
  - `saldo kurang: peringatan inline lalu Tetap simpan`.
  - `konflik versi`: dua `browserContext` pemilik mengubah entri sama; konteks kedua melihat `ConflictNotice`.
  - `Tidak ada pengeluaran hari ini`: tombol hilang, status tampil; admin memastikan satu baris `no_spend_days` dan satu event `tanpa_pengeluaran`.
  - `event tanpa nominal`: sesudah Catat, admin membaca `app.product_events`: ada `catat_dibuka` dan `catat_disimpan` dengan `flow_id` sama, `taps` = 3.
  - `payload rute Bersama tanpa kanari Pribadi`: Catat di Pribadi dengan deskripsi `KANARI-N-PRIBADI`, dompet `KANARI-DOMPET-N`; `page.goto('/bersama/…')` untuk beranda/transaksi/dompet/sampah, teks respons mentah tidak memuat kanari; buka sheet Catat di Bersama dan pindah ruang tidak menaruh kanari di HTML awal.
  - `tidak ada teks "Data demo" di mode nyata`.
  - `keyboard saja`: `c` → ketik nominal → Tab ke chip → Space → Enter simpan → Esc; fokus kembali ke pemicu.
  - `axe 0 serious/critical` terang + gelap di 320/390/1280 untuk Beranda, Transaksi, Detail, Dompet, Sampah, Kategori, sheet Catat dalam keadaan galat; `tanpa gulir horizontal di 320`.
  - `JS muat dingin ≤ 162 kB` untuk `/pribadi/beranda`, `/pribadi/transaksi`, `/pribadi/sampah` mode nyata (pola `budget.spec.ts`, konstanta sama).
- [ ] **Step 2: Jalankan lokal** (cluster sekali pakai, `pnpm build`, `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm --filter @dompetku/web e2e:ledger`) → semua PASS. Bila budget > 162 kB: berhenti, ukur per chunk, kurangi lewat muat malas; jangan ubah konstanta (pertanyaan terbuka 4).
- [ ] **Step 3: Pastikan prototipe dan auth tetap hijau:** `pnpm e2e` (220 lama + baru), `pnpm --filter @dompetku/web e2e:auth`.
- [ ] **Step 4: Commit** `test(web): e2e ledger mode nyata dan langkah CI`.

---

### Task 20: Penutup: dokumen, critique, Delivery Gate

**Files:**

- Modify: `docs/product/BSD.md` (§16 "Catatan S6": `create_category` disalin; `update_category`, `archive_category`, `suggest_categories`, kamus, kategori awal, cek `category_archived` di `create_entry`/`update_entry` ditulis mengikuti pola dan dicatat di sini), `packages/db/README.md` (tabel migrasi 0106–0108, tes 11–13, `e2e:ledger`), `docs/product/IPD.md` (§4 S6 status), `docs/product/DBD.md` (§9 baris 3 dan 8 selesai; §7 angka budget terukur), `CLAUDE.md` (Status dan Tertunda)

- [ ] **Step 1: Design critique** atas pratinjau (prototipe) dan `/dev/ui` untuk semua bingkai S6 (skill `design:design-critique`), sebagai design reviewer; perbaikan kecil dikerjakan di sini, sisanya jadi issue.
- [ ] **Step 2: Delivery Gate antislop** (skill `antislop:antislop` + `antislop-ui` + `antislop-human`) atas semua berkas UI yang diubah S6; temuan diperbaiki sebelum lanjut.
- [ ] **Step 3: Perbarui dokumen** sesuai daftar Files; angka budget dan jumlah tes dari keluaran nyata, bukan perkiraan.
- [ ] **Step 4: Gerbang lengkap:** lint, typecheck, test, format:check, build, `pnpm e2e`, `test:int`, `e2e:auth`, `e2e:ledger`, `pg_prove` semua berkas.
- [ ] **Step 5: Commit** `docs: catatan S6 di BSD, README db, IPD, DBD, CLAUDE.md`.

---

## Kriteria keluar S6 (IPD §4) dan task yang membuktikannya

| Kriteria                                                                       | Task          |
| ------------------------------------------------------------------------------ | ------------- |
| Catat ≤ 3 ketukan dari Beranda, Transaksi, Dompet di Pribadi dan Bersama       | 12, 13, 19    |
| Urungkan 6 detik mengembalikan saldo                                           | 12, 16, 19    |
| Sampah memulihkan dalam 90 hari                                                | 9, 10, 17, 19 |
| Event tercatat tanpa nominal                                                   | 9, 13, 19     |
| Keyboard-only lulus                                                            | 12, 19        |
| Budget JS rute ≤ 162 kB                                                        | 7, 14, 15, 19 |
| `clientId` sama = 1 entri; isi beda = DK410; edit versi usang = DK409          | 9, 12, 16, 19 |
| Kategori ruang lain ditolak (B9); saran hanya dari ruang aktif                 | 2, 3          |
| "Tidak ada pengeluaran hari ini" (`api.mark_no_spend_day`)                     | 4, 14, 19     |
| Prototipe tetap (220 e2e lama tanpa diubah)                                    | 5, 7, 12–18   |

Di luar S6 (menurut IPD): transfer antar ruang (`space_transfer`) di Catat, "Pindahkan ke ruang lain", talangan dan reimburse, Cocokkan saldo/arsip dompet, `dq_reconcile` terjadwal (S7); anggaran, tagihan, feed Bersama (S8–S9).

## Pertanyaan terbuka untuk pemilik

Setiap butir punya bawaan agar eksekusi tidak menunggu.

1. **Letak Sampah di navigasi** (AFD pertanyaan terbuka 2). Bawaan: butir `Sampah` di Menu (kedua mode) ditambah tautan di bawah daftar Transaksi; tidak menambah tab.
2. **Kategori awal ruang baru.** Bawaan: daftar sama dengan seed demo per ruang (yang sudah dinilai di M0a), bisa diubah atau diarsipkan di Menu → Kategori.
3. **Transfer lintas ruang di Catat dan "Pindahkan ke ruang lain".** IPD menaruh bingkainya di gerbang S6 tetapi fungsinya (`api.move_entry_to_space`, alur `space_transfer` di sheet) di S7. Bawaan: bingkai dan implementasi keduanya di S7; di mode nyata S6 menu jenis Catat hanya menawarkan transfer dalam satu ruang dan tombol Pindahkan tidak dirender.
4. **Budget JS bila mode nyata melewati 162 kB.** Bawaan: kurangi kode (muat malas sheet Ubah, Kategori, Sampah) dan tidak menaikkan batas; bila tetap lewat, task berhenti dan menunggu keputusan pemilik.
5. **Beranda nyata sebelum anggaran dan tagihan ada (S9).** Bawaan: kartu "aman dipakai" dari `api.safe_to_spend` (tagihan dan anggaran wajib bernilai 0 sampai S9), seksi anggaran, tagihan, dan feed tidak dirender (bukan placeholder "Segera").
