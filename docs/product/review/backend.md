# Review kursi Backend: BSD, TRD

Tanggal: 2026-10-31. Cakupan: `docs/product/BSD.md`, `docs/product/TRD.md`. Pembanding: Spec induk (§9 mengikat), `docs/adr/`, `docs/m0a-keputusan.md`, `packages/demo-data/src/selectors.ts`, `packages/domain`. Dokumen tidak diubah.

Format: `[tingkat] DOK §bagian: masalah (bukti). Usulan: perbaikan.` Temuan bertanda **[terbukti]** sudah dijalankan.

## Cara verifikasi

Cluster PostgreSQL 16 sekali pakai di `/var/lib/postgresql/rv` (sudah dihentikan dan dihapus). Sepuluh blok SQL BSD dijalankan berurutan (role sebagai superuser, sisanya sebagai `dompetku_owner`, stub `auth."user"` dari `bsd-check/02_auth_stub.sql`). `bsd-check/test.sql` lulus (ALL TESTS PASSED). Probe tambahan dijalankan di klon database: dua koneksi paralel, `month_summary` dengan dompet kantor, `safe_to_spend` dengan tagihan, alur undangan gagal, dan kueri katalog FK/DEFINER.

Yang diperiksa dan **tidak** bermasalah (tidak dicatat sebagai temuan): saldo = Σ lines hidup di `account_balances`; rumus fee transfer (Σ = −fee); pasangan `space_transfer` (2 kaki, Σ main = 0, tanggal dan status void sama, tanpa kantor); idempotensi `(user_id, client_id)` termasuk dua permintaan paralel dengan kunci sama (di READ COMMITTED yang kedua menunggu PK lalu memutar ulang hasil); `DK409` untuk versi lama; void/restore pasangan naik versi bersama; urutan lock entri lalu akun urut id konsisten di semua fungsi yang mengurangi saldo; anggaran wajib XOR tagihan dari kedua arah di bawah advisory lock per ruang; semua fungsi DEFINER punya `search_path=""` dan pemiliknya sesuai daftar (`api.*` tulis = `dompetku_api`, trigger/cek/job = `dompetku_owner`, `dq_run` = `dompetku_auditor`).

## Ringkasan

| Tingkat | BSD | TRD | Total |
| ------- | --- | --- | ----- |
| Kritis  | 0   | 0   | 0     |
| Penting | 4   | 1   | 5     |
| Minor   | 10  | 2   | 12    |

## Uang dan konkurensi

- [Penting] TRD §2.3, BSD §9.1: tingkat isolasi transaksi tulis tidak ditetapkan, padahal penjaga saldo negatif, batas 2 user (`tg_user_cap`), dan kewajiban XOR hanya benar di READ COMMITTED (statement sesudah lock mengambil snapshot baru). **[terbukti]** Dompet saldo 100, dua `create_entry` pengeluaran 80 paralel tanpa `p_allow_negative`: di READ COMMITTED yang kedua ditolak `saldo_negatif` (saldo akhir 20); di REPEATABLE READ keduanya lolos, saldo akhir −60 tanpa peringatan. TRD menyebut retry `40001`, yang mengisyaratkan isolasi lebih tinggi mungkin dipakai. Usulan: tetapkan READ COMMITTED untuk `withUser` tulis (`alter role dompetku_web set default_transaction_isolation = 'read committed'` dan larang override di lint); tiap fungsi `api.*` tulis menolak `DK500` bila `current_setting('transaction_isolation') <> 'read committed'`; tes Vitest dua koneksi untuk saldo, `user_cap`, dan XOR.
- [Penting] BSD §8.2, §10 (`jobs.materialize_bills`, `api.safe_to_spend`): tagihan dengan `starts_on` di masa lalu dimaterialisasi untuk semua bulan sejak `starts_on`, dan semuanya dihitung "lewat" di aman dipakai; tagihan yang diarsipkan tetap dihitung. **[terbukti]** Tagihan Listrik 50 mulai 2026-01-01, tanggal 5: `materialize_bills` membuat 11 kemunculan, `safe_to_spend` = operasional 100, `bills_until_eom` 500, total −400; setelah `bills.archived_at` diisi, angka tetap 500. Usulan: kemunculan sebelum bulan pembuatan tagihan dibuat `skipped_at` (atau tidak dimaterialisasi); `bill_schedule` atau `safe_to_spend` mengecualikan tagihan terarsip; `api.archive_bill` menandai kemunculan terbuka sebagai dilewati; tambah ke tes golden. Lihat Keputusan pemilik 1.
- [Penting] BSD §9.3, §15 butir 2 (`api.accept_invitation`): bila user Better Auth sudah ter-commit lalu `accept_invitation` gagal (email beda, token kedaluwarsa, koneksi putus), user yatim itu memakan kuota 2 user dan pasangan tidak bisa bergabung. **[terbukti]** Undangan untuk `farida@x.test`; user dibuat dengan `farida@x.tes` (salah ketik), `accept_invitation` gagal `invitation_email_mismatch`, undangan tetap terbuka, lalu user dengan email benar ditolak `user_limit`. Usulan: jangan bergantung pada transaksi bersama Better Auth (belum terbukti tersedia). Pindahkan konsumsi undangan ke trigger `BEFORE INSERT` di `auth."user"`: bila sudah ada 1 user, wajib ada undangan terbuka dengan email sama (dikunci `FOR UPDATE`, ditandai terpakai), lalu `AFTER INSERT` memanggil `private.provision_user`. Pembuatan user dan keanggotaan jadi satu statement. Token tetap diperiksa di hook `before` Better Auth. Tambah cek DQ "user tanpa profil" dan perintah CLI pembersih.
- [Penting] BSD §2.2 butir 3, §8 (`api.month_summary`): butir 3 salah menggambarkan demo (selector `monthSummary` sudah menghitung transfer satu kali per entri). Perbedaan yang nyata dan tidak terdokumentasi ada di dompet kantor. **[terbukti]** Transfer BCA ke Kas Kantor 30 menghasilkan `transfer` 0; Kas Kantor ke BCA 10 menghasilkan 10 (demo: 30 dan 10). Transfer Kas Kantor ke BCA 5 dengan fee 2: `transfer` naik 5, fee 2 tidak muncul di `pengeluaran` maupun `kantor`, jadi hilang dari semua angka. Penyebab: aturan 1 (`x_kantor`) menang atas `x_transfer` dan `expense_fee`. Usulan: hitung `transfer` per entri (Σ |main| entri `transfer`/`space_transfer`) tanpa melihat pocket; tetapkan kelas fee dari dompet kantor (Keputusan pemilik 2); perbaiki teks §2.2 butir 3 dan tambah kasus kantor ke `golden.json`.
- [Penting] BSD §2.2 butir 4, §8 (`api.net_worth`): dompet terarsip dikecualikan dari aman dipakai tetapi tetap masuk net worth, jadi dua angka di aplikasi memakai himpunan dompet berbeda. Demo tidak punya konsep arsip, jadi ini aturan baru, bukan sekadar perbedaan. Usulan: `api.archive_account` mensyaratkan saldo 0 (atau menawarkan "Cocokkan saldo ke 0" dulu); dengan begitu kedua angka konsisten dan butir 4 tidak perlu. Lihat Keputusan pemilik 3.

## Penilaian empat perbedaan disengaja (BSD §2.2)

- [Minor] BSD §2.2 butir 1 (talangan dan kantor di luar pengeluaran/anggaran): setuju, sesuai keputusan v1 dan audit INT-08/09. Celah: talangan yang tidak pernah diganti tidak pernah menjadi pengeluaran, dan `month_summary.kantor` menjumlah |masuk| + |keluar| sehingga angkanya tidak bermakna (warisan demo). Usulan: alur "Tidak diganti" (ubah `reimbursable` ke false lewat `update_entry`) dan daftar talangan terbuka; pecah `kantor` menjadi `kantor_masuk` dan `kantor_keluar`.
- [Minor] BSD §2.2 butir 2 (fee masuk pengeluaran): setuju. Catatan: fee tanpa kategori sehingga tidak mengurangi anggaran mana pun, dan fee dari dompet kantor hilang (temuan di atas). Usulan: tulis eksplisit di §8.1 bahwa `expense_fee` tidak masuk `budget_progress`.
- Butir 3: tidak setuju dengan rumusannya (lihat temuan Penting `month_summary`).
- Butir 4: setuju dengan arah, tidak setuju dengan mekanismenya (lihat temuan Penting `net_worth`).
- [Minor] BSD §2.2, §8 (`api.activity_feed`): perbedaan dari selector `activityFeed` tidak terdaftar: DB menampilkan kaki `out` di Bersama (demo melewatinya), menampilkan peristiwa `update`/`void`/`restore`, dan tetap menampilkan entri yang sudah dibatalkan lewat riwayat. Usulan: daftarkan sebagai perbedaan disengaja dan tambahkan ke tes oracle.

## Skema, constraint, indeks

- [Minor] BSD §7 (`tg_obligation_xor`): trigger hanya ada di `bills` dan `budgets`. Memindah induk kategori (fungsi `update_category` yang belum ditulis) bisa membuat tagihan pada subkategori jatuh di bawah induk yang punya anggaran wajib tanpa ditolak. Usulan: larang ubah `parent_id` bila kategori dipakai tagihan atau anggaran, atau tambah trigger yang sama di `categories` untuk `update of parent_id`; masukkan ke tes #25.
- [Minor] BSD §13 tes #7 ("setiap FK punya indeks pendukung"): **[terbukti]** kueri katalog yang ketat menandai dua FK: `entries (space_id, category_id, category_type)` hanya ditopang indeks `(space_id, category_id)`, dan `entry_history (space_id, entry_id)` hanya ditopang PK `(entry_id, version)`. Keduanya cukup secara kinerja. Usulan: definisikan tes sebagai "kolom terdepan indeks memuat kolom FK yang selektif" atau tambah indeks penuh, supaya tes tidak merah di hari pertama.
- [Minor] BSD §9.1 (`api.update_entry`): semantik ganti-penuh dengan default berbahaya. Memanggil tanpa `p_category_id` menghapus kategori; tanpa `p_reimbursable` mematikan talangan. Usulan: hapus default untuk parameter yang diganti penuh, atau wrapper Zod mewajibkan semua field.
- [Minor] BSD §1, Spec §9.1 ("akun aset tidak boleh negatif"): BSD mengizinkan saldo negatif dengan `p_allow_negative` di semua pocket, termasuk tabungan. Usulan: nyatakan bahwa "akun aset" merujuk tabel aset M4, atau tolak negatif untuk `tabungan`.

## Migrasi dan Better Auth

- [Minor] BSD §11, §12: fungsi `api.*` DEFINER baru di migrasi berikutnya dibuat sebagai `dompetku_owner` (BYPASSRLS) dan harus di-ALTER OWNER ulang, kalau lupa fungsi itu melewati RLS. Tes katalog #5 menangkapnya, tetapi baru di CI. Usulan: helper `private.own_api_functions()` (milik owner) dipanggil di akhir setiap file migrasi yang menyentuh `api`, plus template file dbmate.
- [Minor] BSD §5: generator Better Auth menulis kolom id bertipe `text`; `generateId` UUID saja tidak cukup, tipe kolom harus diubah ke `uuid` di file migrasi. Mekanisme agar Better Auth memakai skema `auth` (pool terpisah dengan `search_path=auth`) tidak ditulis. `grant ... on all tables in schema auth` hanya berlaku untuk tabel yang ada saat itu. Usulan: tulis ketiganya; tambah `alter default privileges for role dompetku_owner in schema auth grant select, insert, update, delete on tables to dompetku_web`.
- [Minor] BSD §3: `statement_timeout = 5s` untuk worker terlalu ketat untuk `purge_voided` dan `dq_run` pada fixture 50k entri. Usulan: worker 60 s (web tetap 5 s), ukur di job CI kinerja.

## TRD

- [Minor] TRD §3.4, §3.7, §3.5, §4: rujukan bagian BSD salah. RLS ada di BSD §11 (bukan §10), undangan di §9.3 (bukan §7), daftar pgTAP di §13 (bukan §12), CHECK privasi di §6 (bukan §5), cek DQ di §10 (bukan §9). Usulan: perbaiki rujukan.
- [Minor] TRD §3.4 (Database): menyebut lima role, BSD §3 mendefinisikan enam (`dompetku_monitor`). Usulan: selaraskan setelah BSD §15 butir 11 diputuskan.

## Keputusan pemilik

1. Tagihan rutin yang dibuat dengan tanggal mulai di masa lalu: bulan-bulan sebelumnya dianggap sudah lewat dan mengurangi "aman dipakai", atau otomatis dilewati? Rekomendasi: dilewati otomatis, hanya bulan berjalan yang dihitung.
2. Biaya transfer dari Kas Kantor: dihitung sebagai uang kantor (masuk angka Kantor) atau pengeluaran pribadi? Rekomendasi: uang kantor.
3. Mengarsipkan dompet yang saldonya bukan 0: diizinkan (saldo hilang dari aman dipakai tetapi tetap di net worth) atau wajib dicocokkan ke 0 dulu? Rekomendasi: wajib 0.
