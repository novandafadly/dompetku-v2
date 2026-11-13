# DompetKu v2 · S11 (Utang/piutang, cicilan, utang berjalan tanpa efek kas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (implementer per task, task review, fix loop, review akhir). Model: DB/uang/server/worker = terkuat (opus); UI = sonnet dengan lensa desain (design reviewer di tiap task UI).

**Goal:** Membuka M3 (IPD §6 S11): mencatat utang (saya berutang) dan piutang (saya meminjamkan) di ruang **Pribadi**, membayar/menerima cicilan, melihat sisa yang selalu benar, membatalkan cicilan (efek dibalik), dan mencatat **utang berjalan tanpa efek kas** (sisa saat ini dari sebelum memakai app). Gerbang: T6–T9 (+ S4, INT-12, C3, C6, B10) lulus. Modal trading dan bagi tagihan Bersama = S12.

**Status spesifikasi (hasil ringkasan repo, 2026-11-12):** PRD:104–105 dan spec induk §5.4/§9 menetapkan: utang/piutang hanya Pribadi; piutang = aset; cicilan dan pokok **bukan** pemasukan/pengeluaran; bayar lebih ditolak; batal cicilan membalik saldo dan sisa; utang berjalan tanpa efek kas. **BSD final tidak punya skema utang** (BSD:1008 hanya menetapkan nama kelas `x_pokok_utang`, `x_pelunasan_utang`; :2636 aturan `alter type … add value` di file tersendiri; :2714 "polanya sama"). Isi T6–T10 dari v1 tidak ada di repo: plan ini menetapkannya (di bawah) dan meminta persetujuan pemilik. Draf round1 (`docs/team/round1/backend-engineer.md`, `data-engineer.md`) memakai skema `core.*` dan tidak diadopsi; polanya dipakai.

**Arsitektur:** Pola S7 (talangan/reimburse) dan S9 (tagihan). Saldo dompet dihitung dari `entry_lines`, jadi setiap efek kas = entri ledger. Dua `entry_kind` baru, `debt_principal` (uang pinjaman masuk/keluar saat utang dibuat) dan `debt_payment` (cicilan), keduanya berkelas laporan `x_*` (bukan income/expense; `report_class`, `assert_entry_shape`, `report_lines`, `export_entries`, Laporan "Tidak termasuk"). Tabel `app.debts` memegang utang; `entries.debt_id` + FK komposit `(space_id, debt_id)`; `sisa = principal − Σ pembayaran hidup` sebagai view, tanpa kolom sisa tersimpan. Pembayaran serial per utang (kunci `FOR UPDATE` baris utang, pola `create_reimbursement`); void/restore lewat `set_void_state`. Migrasi `alter type … add value` di file sendiri (BSD:2636). Aritmetika uang di SQL; UI tidak menjumlah.

**Cabang:** `ccr-f260701e-61yx7j` (dari `main` `efd7af6`). Tanpa PR sampai CI/review siap; merge = deploy + migrasi di produksi.

## Keputusan pemilik yang dibutuhkan (default agen = rekomendasi)

| # | Keputusan | Default plan | Alasan / bila pemilik memilih lain |
| --- | --- | --- | --- |
| K1 | Pihak lawan (kontak) | **Tabel Kontak** (`app.contacts`, hanya Pribadi, **diputuskan pemilik 2026-11-12**): nama 1–60 huruf, unik tanpa beda huruf di antara kontak aktif, arsip (tidak dihapus bila punya utang); utang wajib punya kontak; kontak baru bisa dibuat langsung dari sheet Tambah utang; Menu → Kontak menjadi halaman nyata (daftar, ganti nama, arsip, ringkasan sisa per kontak) | Identitas pasti untuk ringkasan per kontak dan S12 "siapa berutang ke siapa"; ganti nama berlaku di semua utang |
| K2 | Utang berjalan tanpa efek kas (**disetujui pemilik**) | **Mode `berjalan`**: utang dibuat dengan `principal` = sisa saat ini, **tanpa entri pokok** (saldo dan Laporan tidak berubah); mode `baru` membuat entri pokok ke/dari dompet | PRD:105; sisa = principal − Σ pembayaran sama untuk keduanya |
| K3 | Bunga/biaya cicilan (**disetujui pemilik**) | **Tidak dimodelkan**: bunga dicatat sebagai pengeluaran biasa terpisah | Spec hanya menyebut `fee` opsional di draf; menjaga sisa = pokok − Σ |
| K4 | Edit | Judul, nama pihak, catatan boleh diubah bebas **tanpa efek** pada saldo/cicilan/sisa (S4); **nominal pokok dan nominal cicilan tidak bisa diubah** (batal lalu catat ulang) | Menghindari menulis ulang entri ledger; konsisten dengan "batal cicilan membalik efek" |
| K5 | Hapus utang (**disetujui pemilik**) | `api.void_debt`: **void atomik** pokok + semua cicilan hidup, utang ditandai `voided_at`; entri yang dibatalkan tidak bisa dipulihkan sendiri dari Sampah selama utangnya terhapus (`DK422 debt_deleted`); pemulihan utang = `api.restore_debt` (semua efek kembali, 90 hari) | T9 (inferensi dari PO draf) |
| K6 | Sumber/tujuan dompet | Dompet Pribadi aktif **bukan Kantor**; saldo negatif tanpa flag ditolak seperti mutasi lain (`saldo_negatif`) | Pola `bill_account_kantor` / BSD:770 |
| K7 | Bayar lebih | `DK422 payment_exceeds` atomik; UI menawarkan `Bayar sisa Rp …` (nominal dari SQL) | PRD:157 |
| K8 | Posisi UI | **Rencana > segmen `Utang`** (Pribadi saja, disembunyikan di Bersama, ui-ux:20); detail utang + riwayat pembayaran; sheet bayar dengan 25%/50%/Lunas; dialog akibat dengan kolom buku kas; istilah baku "Utang" (bukan "Hutang") | DBD §9 baris 12 belum mendesain; bingkai di Task 1 |
| K9 | Wizard onboarding utang berjalan | **Tidak** di S11 (hanya mode `berjalan` di sheet Tambah) | Tidak ada di AFD/PRD final; tambah di S11b bila diminta |
| K10 | Definisi tes (isi T6–T10 hilang) | T6 edit keterangan/nama tanpa efek (S4: saldo, jumlah cicilan, sisa, `occurred_on` pokok tetap); T7 bayar > sisa ditolak, nol efek, tawaran `Bayar sisa`; T8 batal cicilan membalik saldo dan sisa, riwayat menandai batal; T9 hapus utang = void atomik semua efek, restore memulihkan; T10 (modal trading) = S12. Plus INT-12 (kegagalan di tengah `pay_debt` = rollback utuh), C3 (dua pembayaran paralel melebihi sisa = satu ditolak), C6 (klik ganda = satu entri), B10 (utang di Bersama ditolak), I6 (Σ income/expense tidak berubah oleh pokok/cicilan) | Inferensi dari backlog PO; **butuh persetujuan pemilik** |

## Global Constraints

- Semua Global Constraints S6–S10 tetap mengikat: M1 (`requireDataUser()` + `withUser`/`withLedger`), `api.*` DEFINER dengan `app.assert_member` lebih dulu, migrasi expand-only dengan penjaga `migrate_down_blocked_prod` dan `select private.own_api_functions();`, pgTAP test-first, tanpa nominal di galat/log, isolasi Pribadi vs Bersama, budget JS ≤ 162 kB rute (UI lazy).
- `alter type … add value` **tidak boleh dipakai di transaksi yang sama**: migrasi pertama hanya menambah nilai enum (`0129`); skema dan fungsi di migrasi berikutnya.
- Kode galat baru dipetakan di `apps/web/src/server/ledger/errors.ts` dan `LedgerErrorCode`.
- Setiap tempat yang `case`/`if` atas `entry_kind` ditinjau (grep `entry_kind`, `kind in`, `'reimbursement'` di migrasi dan TS): `assert_entry_shape`, `report_class`, `update_entry`, `move_entry_to_space`, `void/restore`, `purge`, Transaksi (daftar, detail, Ubah), Laporan, Ekspor, DQ03/DQ04, Sampah.
- Commit kecil Conventional Commits berbahasa Indonesia, trailer sesuai instruksi sesi. Gerbang sebelum push: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm test:registry`, `pnpm build`, e2e, `test:int`, `e2e:ledger`, `e2e:bersama`, pgTAP seluruh suite + rollback/up (lalu `env='prod'`).

## Peta berkas (garis besar)

| Area | Berkas |
| --- | --- |
| DB | `packages/db/migrations/0129_utang_enum.sql`, `0130_utang_tabel.sql`, `0131_utang_api.sql` (baru); `tests/29_utang.sql`, `17_dq.sql`, `00_katalog.sql`, `99_konkurensi.sql`, `REGISTRY.md`, `README.md` |
| Server | `apps/web/src/server/ledger/{utang.ts,errors.ts,read.ts,laporan.ts}`, `_actions/utang.ts` |
| UI | `features/utang/*` (baru), `_real/rencana*.tsx` (segmen Utang), `features/transaksi/*` (jenis baru), `features/laporan/present.ts` |
| Dokumen | `docs/design/s11-bingkai.md`, `docs/product/{BSD.md,IPD.md}`, `docs/m0a-keputusan.md`, `docs/superpowers/handoff/s11.md`, `CLAUDE.md` |

---

### Task 1: Persetujuan keputusan dan bingkai desain (tanpa kode)

- [x] Pemilik menjawab K1 (tabel Kontak), K2, K3, K5 (2026-11-12); K4, K6–K10 default plan (K10 = definisi tes inferensi: dipakai kecuali pemilik keberatan). Catat di `docs/m0a-keputusan.md` (Task 9).
- [x] `docs/design/s11-bingkai.md` (format `s10-bingkai.md`): segmen Utang di Rencana (daftar: Saya berutang / Piutang, sisa, bilah terbayar, jatuh tempo opsional bila K ada), detail utang + riwayat pembayaran (batal ditandai), sheet Tambah (arah, nama pihak, nominal, mode `baru`/`berjalan` + dompet, tanggal, catatan), sheet Bayar (25/50/Lunas + `Bayar sisa`), dialog akibat (kolom buku kas), dialog Hapus, keadaan kosong/galat/memuat, Bersama (disembunyikan), 320/390/1280. Salinan tanpa "Hutang", tanpa merah untuk semua angka utang, tanpa "UTANG −Rp 0" saat kosong (ui-ux:49,79,452,457).

### Task 2: Migrasi `0129` nilai enum (DB) — opus

- [x] `alter type app.entry_kind add value 'debt_principal'`, `'debt_payment'` (file sendiri). Tes: `has_enum_labels`; migrasi lanjutan tidak memakai nilai itu di transaksi yang sama.

### Task 3: Migrasi `0130` tabel utang, bentuk entri, kelas laporan (DB) — opus

- [x] Test-first pgTAP. `app.contacts(id, space_id, space_kind check personal, name 1–60, archived_at, created_*/updated_*; unik `(space_id, lower(name))` untuk kontak aktif; RLS ENABLE+FORCE, tulis hanya `dompetku_api`)` dan `app.debts(id, space_id, space_kind check personal, contact_id → FK komposit `(space_id, contact_id)`, direction borrowed|lent, title, principal > 0 ≤ 1e13, mode baru|berjalan, opened_on, note, created_by/at, voided_at/by, updated_*)`; RLS ENABLE+FORCE (pola ruang, tulis hanya `dompetku_api`); `entries.debt_id` + FK komposit + `check ((kind in ('debt_principal','debt_payment')) = (debt_id is not null))`.
- [x] `private.assert_entry_shape`: `debt_principal` (borrowed: main > 0; lent: main < 0; satu line main, tanpa counter/fee) dan `debt_payment` (borrowed: main < 0; lent: main > 0); `app.report_class`: kelas `x_pokok_utang`, `x_pelunasan_utang` (invarian 9: tidak NULL); `report_lines`/`period_summary`/`excluded_summary` memasukkan kelas baru ke "Tidak termasuk"; view `app.debt_balances` (sisa = principal − Σ pembayaran hidup).
- [x] Tes: kontak (nama unik tanpa beda huruf, arsip, Bersama ditolak, kontak ruang lain `DK404`, utang butuh kontak aktif), B10 (Bersama ditolak), I6 (Σ income/expense tidak berubah), dompet Kantor ditolak, bentuk salah ditolak.

### Task 4: Migrasi `0131` API utang + DQ05 (DB) — opus

- [x] `api.create_debt` (mode `baru`: entri pokok + utang atomik; mode `berjalan`: utang saja, saldo dan Laporan tidak berubah), `api.pay_debt` (kunci `FOR UPDATE` baris utang, `payment_exceeds`, `saldo_negatif`, idempoten `client_id`), `api.create_contact` / `api.rename_contact` / `api.archive_contact` (idempoten; arsip menyembunyikan dari pemilih, utang lama tetap), `api.update_debt_info` (judul/catatan, ganti kontak, tanpa efek ledger), `api.void_debt` / `api.restore_debt` (atomik, 90 hari), pembayaran dibatalkan lewat `void_entry` biasa (`debt_deleted` bila utang terhapus; restore ditolak bila Σ akan melebihi), `api.list_contacts` (+ ringkasan sisa per kontak: Σ sisa utang dan Σ sisa piutang dari view), `api.list_debts` / `api.debt_detail` (INVOKER, sisa dari view). `update_entry` dan `move_entry_to_space` menolak kind baru.
- [x] DQ05 (error): sisa utang tidak negatif dan Σ pembayaran hidup ≤ principal; `17_dq` (jumlah cek 13). Tes konkurensi `99_konkurensi`: C3, C6, INT-12 (`fail_after` di tengah `pay_debt`).
- [x] Review independen (opus).

### Task 5: Server, action, galat

- [x] `server/ledger/utang.ts` (loader + tulis, Zod), `_actions/utang.ts` (pola `mutate`), kode galat (`payment_exceeds`, `debt_deleted`, `debt_account_kantor`, …); tes unit/`__int__` (S4, T6–T9 definisi K10).

### Task 6: UI Rencana > Utang dan Menu > Kontak (sonnet + lensa desain)

- [x] Segmen Utang, daftar, detail + riwayat, sheet Tambah (pemilih kontak + `Tambah kontak baru` inline) / Bayar, dialog akibat dan Hapus; halaman Kontak (`/pribadi/kontak`: daftar + ringkasan sisa, ganti nama, arsip; item Menu → Kontak jadi tautan, e2e shell diperbarui); Bersama disembunyikan; budget JS Rencana ≤ 162 kB (lazy).

### Task 7: Integrasi Transaksi, Laporan, Ekspor

- [x] Jenis `debt_principal`/`debt_payment` di daftar/detail Transaksi (label, tanpa Ubah/Pindah, tautan ke utang), Laporan "Tidak termasuk" (`Pinjaman diterima/diberikan`, `Pelunasan utang / penerimaan piutang`), `export_entries` (kelas baru, kolom Jenis), Sampah.

### Task 8: e2e, registry, budget

- [x] e2e ledger (catat utang → cicilan 25/50/Lunas → batal), e2e prototipe tidak berubah (nyata saja), `REGISTRY.md` T6–T9, S4, C3, C6, B10 diaktifkan dengan lokasi tes; `test:registry` MAX_MILESTONE naik ke M3 bila perlu.

### Task 9: Dokumen, review, penutup

- [x] BSD §16 "Catatan S11" (tabel, fungsi, kelas, DQ05), IPD S11, `docs/m0a-keputusan.md`, `handoff/s11.md`, critique + Delivery Gate (selesai 2026-11-13).
- [ ] Review akhir (task + keamanan, opus), gerbang penuh, PR, CI, merge (pengendali).

## Review Focus

1. **Sisa selalu benar** di bawah konkurensi dan urutan operasi (bayar/batal/void/restore/hapus utang), dan tidak pernah negatif.
2. **Bukan pemasukan/pengeluaran**: Σ income/expense, Beranda "aman dipakai", Laporan, Ekspor, anggaran tidak berubah oleh pokok/cicilan; saldo dompet berubah tepat sekali.
3. **Utang berjalan**: saldo dan Laporan nol efek sampai ada pembayaran.
4. **Kind baru di semua tempat** yang mengenal `entry_kind` (tidak ada kasus yang jatuh ke `else`/NULL).
5. **Hanya Pribadi** (B10), tanpa kebocoran ke Bersama; nama kontak/catatan tidak bocor lewat galat/log; ganti nama dan arsip kontak tidak mengubah angka utang.
