# Konteks bersama untuk setiap subagent S6

## Lingkungan
- Repo: /home/user/dompetku-v2, branch `claude/gifted-sagan-40uzy0` (sudah checkout). Jangan pindah branch, jangan push (controller yang push).
- Deps sudah terpasang (`pnpm install` selesai).
- Postgres lokal PG16 sekali pakai di 127.0.0.1:5432 (trust). Reset penuh (roles + dbmate up + pgTAP setup):
  `bash docs/superpowers/handoff/db-reset-lokal.sh`
  - pgTAP: `pg_prove -h 127.0.0.1 -U dompetku_test -d dompetku packages/db/tests/*.sql`
  - test:int: `TEST_DATABASE_URL='postgres://dompetku_web@127.0.0.1:5432/dompetku' TEST_DATABASE_ADMIN_URL='postgres://postgres@127.0.0.1:5432/dompetku' pnpm --filter @dompetku/web test:int`
- e2e prototipe: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e` (pastikan tidak ada proses Playwright lain: `pgrep -f playwright`).
- Gerbang sebelum melapor DONE (yang relevan dengan task): `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`, `pnpm build`, e2e.

## Commit
- Conventional Commits berbahasa Indonesia (pesan sesuai brief). Akhiri pesan dengan dua baris trailer persis:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017LUztPvQox5w5vomCkpXUx
- Jangan menulis identitas model lain di kode/komentar.

## Aturan proyek
- Baca `CLAUDE.md` di root. Komentar/kode/teks UI berbahasa Indonesia mengikuti gaya berkas sekitar.
- 
## Global Constraints (dari plan, mengikat)

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

