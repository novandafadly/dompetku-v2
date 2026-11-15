# Bingkai desain S12 (kartu Utang, modal trading, bagi tagihan Bersama)

Gerbang awal S12 (IPD §6 S12; plan S12 Task 1). Ditulis agen mengikuti Panel Malam (`DESIGN.md`, token `apps/web/src/styles/tokens.css`) dan format `docs/design/s11-bingkai.md`. Keputusan K1 sampai K9 di plan S12 mengikat (K1, K5 sampai K7 disetujui pemilik 2026-11-14; K2, K3, K4, K9 default agen **[konfirmasi pemilik]**). Bentuk data bagi tagihan diputuskan di **S12-ADR1** di bawah dan menajamkan K3/K4 (lihat "Penyimpangan"). ID `S12-*` dirujuk Task 3, 5, 7, 9. Semua bingkai hanya untuk **mode nyata**; prototipe (`NEXT_PUBLIC_PROTOTYPE=1`) tidak berubah.

## Fakta kode yang membentuk bingkai

- **Jurnal:** `app.entry_lines.account_id` **NOT NULL** dengan FK komposit `(space_id, account_id)` ke `app.accounts` ruang yang sama (`0100`). Setiap entri, termasuk pengeluaran Bersama, wajib punya kaki di dompet **ruang itu**. Tidak ada "kaki tanpa dompet".
- **Antar ruang hanya lewat `space_transfer`:** dua entri ber-`link_id`, satu `out` (main < 0) dan satu `in` (main > 0), dua ruang berbeda, salah satunya Bersama, Σ main = 0, tanggal sama, status batal seragam, tanpa Kantor (`private.assert_space_transfer_pair`, trigger DEFERRABLE `0101`; DQ04b). Kaki Bersama tanpa `description`, hanya `shared_note`. Batal/ubah hanya oleh pencatat, selain pencatat DK404 (`private.set_void_state`, spec §9.1). `transfer` biasa wajib `counter` di ruang yang sama, jadi tidak bisa menyeberang ruang.
- **Kelas laporan** dihitung `app.report_class(kind, role, pocket, space_kind, direction, reimbursable)` (fungsi immutable, `0130`), yang **mengenal `pocket`**. `space_transfer` di Bersama = `x_setoran_anggota` (in) / `x_diambil_anggota` (out); di Pribadi = `x_setor_bersama` / `x_ambil_bersama`.
- **Kontribusi S8** (`api.member_contributions`, `0115`) hanya menjumlah `report_lines` kelas `x_setoran_anggota`/`x_diambil_anggota` per `created_by`. **Laporan** (`period_summary`, `0102`) dan **Ekspor** (`export_entries`, `0127`) menjumlah `report_lines` per kelas.
- **"Aman dipakai"** (`0120`) dan saldo operasional Beranda hanya `pocket = 'operasional'`; `api.net_worth` (`0102`, tidak dipakai web) hanya operasional + tabungan. Kekayaan bersih di Dompet dihitung UI dari daftar dompet (semua kecuali Kantor, `account-list-view.tsx`), jadi pocket baru **ikut terjumlah kecuali loader menyaringnya**.
- **Cek kualitas data** (`private.dq_run`, terakhir `0131`): DQ01, 03, 04, 04b, 05, 06, 07, 09 sampai 14 sudah terpakai (DQ02, DQ08 dicadangkan BSD). **DQ06 dan DQ07 sudah ada** (versi = jumlah riwayat; dompet negatif 3 hari): plan menyebut "DQ06" untuk modal trading dan "DQ07-analog" untuk patungan; bingkai memakai **DQ15** (modal trading) dan **DQ16** (patungan). DQ07 memberi `warn` untuk dompet mana pun yang negatif 3 hari: dompet sistem patungan tidak boleh pernah negatif.
- **Pola UI yang dipakai ulang:** `ListCard`, `EmptyState`/`ErrorState`/`LoadingRegion`, `CardError` (Beranda Bersama), `MemberAvatar` (inisial N/F, tanpa foto), `Sheet` + `SpaceTag`, `ConfirmDialog` (fokus awal `Kembali`), `MoneyInput`, `SelectField`, `SegmentedControl`, `KolomKas` (S11, `features/utang/kolom-kas.tsx`), `WarningBox`/kotak `warning-tint` (S6-C3), `BackLink`, `Toast` dengan `Urungkan`, sakelar ubin 44 `role="switch"` di sheet Catat (pola Talangan, `catat-sheet.tsx`), sheet transfer yang ada (`type-menu` `Transfer`), `ReconcileSheet` (Cocokkan saldo). Ikon yang sudah ada: `chart-line-up`, `hand-coins`, `receipt`, `user`, `users-three`, `arrows-left-right`, `check-circle`, `minus-circle`, `clock`, `info`, `warning`, `trash`, `arrow-counter-clockwise`, `caret-*`, `plus`.
- **Budget JS (batas 162 kB):** Beranda nyata 157,5, Rencana 150,5, Dompet dan Catat di bawahnya (handoff S11). Kartu baru = Server Component; sheet baru = pulau malas.

## S12-ADR1 · Bentuk kaki lintas ruang bagi tagihan (K3, K4)

**Status:** diputuskan agen 2026-11-14 untuk Task 6; **[konfirmasi pemilik]** bersama K3.

### Konteks

Novanda membayar listrik Bersama Rp400.000 dari BCA (Pribadi). Yang harus benar: (1) saldo BCA turun Rp400.000 tepat sekali; (2) Laporan Bersama memuat listrik Rp400.000 sebagai pengeluaran Bersama **satu kali**, dan Laporan Pribadi Novanda **tidak** memuatnya sebagai pengeluaran pribadi; (3) saldo dompet Bersama tidak bergerak; (4) Kontribusi S8 (setoran sukarela ke kas Bersama) tidak tercemar; (5) Farida tidak pernah melihat dompet atau entri Pribadi Novanda, dan tidak ada fungsi yang menulis ke Pribadi orang lain; (6) `dq_reconcile` tetap hijau; (7) saldo antar-anggota (Farida berutang Rp200.000 ke Novanda) dihitung dari data, nol-jumlah, dan batal/pulih membalik tepat sekali.

Kendala nyata: `entry_lines.account_id` wajib (tidak ada kaki tanpa dompet), uang menyeberang ruang hanya lewat pasangan `space_transfer`, dan pasangan itu dibatalkan bersama hanya oleh pencatat.

### Opsi

| Opsi                                                | Bentuk                                                                                                                                                         | Masalah                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** (plan) kaki Bersama tanpa dompet              | Pengeluaran Bersama menunjuk akun virtual `Dibayar pribadi`; kaki Pribadi = "transfer keluar"                                                                  | Kaki Pribadi tidak bisa `transfer` (wajib `counter` di ruang sama) dan tidak boleh `expense` (masuk Laporan Pribadi). Tanpa kaki masuk ke akun virtual, akun itu negatif permanen (−Rp400.000): DQ07 `warn` tiap malam, dan tidak ada ikatan atomik ke kaki Pribadi. Tidak layak apa adanya.                                                         |
| **B** setoran + pengeluaran di dompet Bersama nyata | `space_transfer` BCA → dompet Bersama, lalu `expense` dari dompet itu, satu fungsi                                                                             | Kaki masuk berkelas `x_setoran_anggota`: **Kontribusi S8 naik** Rp400.000 padahal tidak ada setoran sukarela, dan pelunasan nanti menggandakannya. Butuh dompet Bersama (Bersama tanpa dompet, S7-B2, tidak bisa memakai). Riwayat dompet Bersama penuh pasangan +/−. Mengubah `member_contributions` untuk mengecualikan = mengubah fungsi baca S8. |
| **C** (dipilih) dompet sistem Patungan              | Seperti B, tetapi tujuan pasangan dan sumber pengeluaran adalah **satu dompet sistem per ruang Bersama** ber-pocket baru `patungan`, tersembunyi dari pengguna | Pocket baru harus ditinjau di semua tempat yang mengenal `pocket` (sama dengan `trading` di Task 4, daftar tinjau yang sama).                                                                                                                                                                                                                        |
| D kind baru `split_expense` atau pasangan tiga kaki | Ubah aturan pasangan/bentuk                                                                                                                                    | Mengubah `assert_space_transfer_pair`, `assert_entry_shape`, DQ03/DQ04b, dan semua `case entry_kind` (daftar tinjau S11). Biaya terbesar, tanpa manfaat di atas C.                                                                                                                                                                                   |

### Keputusan

**Opsi C.** Satu fungsi atomik menulis tiga entri yang sudah dikenal ledger, tanpa `entry_kind` baru:

1. **Kaki Pribadi pembayar:** `space_transfer out` dari dompet Pribadi pembayar (aktif, bukan Kantor, bukan Trading), `description` = deskripsi tagihan, tanpa biaya.
2. **Kaki Bersama masuk:** `space_transfer in` ke dompet sistem `patungan` ruang Bersama (pasangan kaki 1, `link_id` sama).
3. **Pengeluaran Bersama:** `expense` dari dompet sistem `patungan`, kategori dan deskripsi tagihan, nominal sama.

Dompet sistem bersaldo **0** sesudah setiap tagihan patungan (+X lalu −X). `app.report_class` mendapat satu cabang sebelum cabang `space_transfer`: `when p_pocket = 'patungan' and p_kind = 'space_transfer' then 'x_patungan'`. Pengeluaran dari dompet itu tetap `expense`.

**Pelunasan (K4)** memakai bentuk yang sama, satu sisi, ditulis hanya oleh pelunas: `space_transfer out` dari dompet Pribadi pelunas → `in` ke dompet sistem (`x_patungan`), plus baris `settlement`. Uangnya **menunggu di dompet sistem** sampai penerima mengetuk `Terima ke dompet` (opsional, S12-PT4), yang menulis pasangan `out` dari dompet sistem → `in` ke dompet Pribadi **penerima sendiri**, oleh penerima. Saldo dompet sistem = Σ pelunasan hidup yang belum diterima (selalu ≥ 0). Ini menggantikan "penerima boleh mencatat pemasukan sendiri" di K4: pemasukan akan menggelembungkan Pemasukan Pribadi penerima dan Laporan, sedangkan `x_ambil_bersama` tidak.

### Konsekuensi

- **Laporan Bersama:** angka data lama tidak berubah (tidak ada baris lama ber-pocket `patungan`; `period_summary`, `category_summary`, `export_entries`, anggaran tidak diubah). Tagihan patungan masuk Pengeluaran Bersama tepat sekali (kaki 3). Kaki masuk/keluar dompet sistem berkelas `x_patungan` (bagian "Tidak termasuk", label `Patungan`), bukan setoran.
- **Kontribusi S8 tidak berubah:** `x_patungan` bukan `x_setoran_anggota`/`x_diambil_anggota`, `member_contributions` tidak disentuh.
- **Pribadi:** kaki 1 berkelas `x_setor_bersama` (bukan pengeluaran pribadi, tidak masuk anggaran atau `spend_pace` Pribadi). Laporan Pribadi menghitungnya di "Tidak termasuk · Setor ke Bersama": jujur (uang memang pindah ke Bersama), tetapi Task 7 memberi label baris Transaksi `Bayar untuk Bersama` lewat tabel patungan. "Aman dipakai" Pribadi turun sebesar kas yang keluar (benar).
- **Reconcile:** DQ01/03/04/04b lulus tanpa perubahan aturan (bentuk entri yang sudah ada). DQ07 aman karena dompet sistem tidak pernah negatif. DQ16 baru menjaga invarian patungan (di bawah). "Aman dipakai" dan kekayaan bersih Bersama otomatis mengecualikan pocket `patungan` di SQL; loader Dompet **wajib** menyaringnya (UI menjumlah daftar dompet).
- **Isolasi:** setiap fungsi hanya menulis Pribadi pemanggil. Bersama hanya melihat kaki Bersama: dompet sistem bernama netral, kaki masuk tanpa `description` (CHECK yang ada), jadi nama dompet Pribadi pembayar tidak pernah sampai ke Bersama. Farida membaca saldo antar-anggota dari tabel Bersama, bukan dari entri Pribadi Novanda.
- **Batal bersama jelas:** `api.void_split` (hanya pembayar = pencatat, pola §9.1) membatalkan ketiga entri + bagian dalam satu transaksi; `api.void_settlement` (hanya pelunas) membatalkan pasangan pelunasan, ditolak `settlement_received` bila sudah diterima (penerima membatalkan penerimaannya dulu, karena itu Pribadinya). Jalur generik (`update_entry`, `void_entry`, `restore_entry`, `move_entry_to_space`, `purge_entry`) menolak entri patungan (`split_locked`, pola `debt_principal_locked` S11); ubah = hapus lalu catat ulang. `trash_list` menyembunyikannya; pemulihan dari grup `Patungan dihapus` di `/bersama/patungan` (pola `Utang dihapus`). `jobs.purge_voided` memurge ketiga entri dan baris patungan bersama.
- **Biaya:** pocket `patungan` ikut daftar tinjau pocket (pemilih dompet, `create_account`/`archive_account`/`reconcile_balance`/`create_entry`/`create_transfer` menolak dompet sistem sebagai pilihan pengguna, WA `@nama`, `move_entry_to_space`, Dompet, Ekspor, DQ). Enum `patungan` ditambah di `0133` bersama `trading` (`alter type … add value` tidak boleh dipakai di transaksi yang sama; `0135` sudah memakainya di CHECK).

### Bentuk tingkat tinggi untuk Task 6

- `0133` (Task 4): `alter type app.pocket add value 'trading'; … add value 'patungan';`
- `0135`:
  - `app.accounts` CHECK `pocket <> 'patungan' or space_kind = 'shared'`; indeks unik parsial satu dompet `patungan` per ruang. Dompet sistem dibuat malas oleh fungsi tulis pertama (`insert … on conflict do nothing`, `opened_on = 2000-01-01`, nama `Patungan`).
  - `app.splits` (ruang `shared`): `id`, `space_id`, `expense_entry_id`, `in_entry_id` (FK komposit `(space_id, …)` ke `app.entries`), `payer_id`, `voided_at`, `voided_by`, `created_*`. Kaki Pribadi dikenali lewat `link_id` kaki masuk (tanpa FK lintas ruang).
  - `app.split_shares`: `(space_id, split_id, user_id)` PK, `amount >= 0`; Σ bagian = nominal pengeluaran (dijaga fungsi + DQ16).
  - `app.settlements` (ruang `shared`): `id`, `space_id`, `from_user`, `to_user` (`from_user <> to_user`, keduanya anggota), `amount > 0`, `occurred_on`, `in_entry_id` (pasangan pelunasan), `received_entry_id` (pasangan terima, null sampai diterima), `voided_at`, `voided_by`.
  - Penanda di entri untuk menutup jalur generik (mis. `entries.split_role` atau pengecekan tabel di `set_void_state`; pilihan implementer, pola `voided_with_debt`).
  - View `app.member_balances` (`security_invoker`): per anggota Σ bayar (split hidup sebagai pembayar) − Σ bagian (split hidup) + Σ pelunasan dibayar − Σ pelunasan diterima; tanpa pembulatan. RLS ENABLE + FORCE di ketiga tabel, tulis hanya `dompetku_api`.
  - `app.report_class` + cabang `x_patungan`.
- `0136`:
  - `api.create_split(p_client_id, p_space_id, p_account_id, p_amount, p_category_id, p_occurred_on, p_description, p_shares jsonb default null, p_allow_negative)`: pembayar = pemanggil; Bersama dua anggota (`split_needs_partner`); dompet Pribadi pemanggil aktif bukan Kantor/Trading; `p_shares` null = sama rata, sisa ganjil Rp1 ke pembayar; Σ ≠ nominal = `invalid_argument/shares`; `saldo_negatif`; idempoten.
  - `api.void_split` / `api.restore_split` (hanya pembayar; restore 90 hari, `saldo_negatif`).
  - `api.settle_split(p_client_id, p_space_id, p_account_id, p_amount, p_occurred_on)`: pelunas = pemanggil, penerima = anggota lain; nominal ≤ yang terutang pemanggil ke penerima, lebih = `payment_exceeds`; kunci dompet sistem dulu (menyerialkan semua mutasi patungan satu ruang, C3-analog).
  - `api.receive_settlement(p_client_id, p_settlement_id, p_account_id)` (hanya `to_user`, ke dompet Pribadinya), `api.void_settlement` (hanya pelunas; `settlement_received`), `api.void_receipt` (hanya penerima).
  - Baca: `api.shared_balances(space)` (per anggota saldo + kalimat arah: `debtor_id`, `creditor_id`, `amount`, atau impas), `api.split_history(space, limit, kursor)` (split dan pelunasan, hidup + dihapus ≤ 90 hari, status terima), tanpa id akun atau nama dompet Pribadi.
  - DQ16 (error): dompet `patungan` bersaldo = Σ pelunasan hidup belum diterima; Σ bagian = |main| pengeluaran per split hidup; entri split hidup ⇔ split hidup; Σ saldo anggota per ruang = 0.

## Aturan bersama

Aturan S6 sampai S11 berlaku (ruang tertulis di judul sheet dan toast; status = ikon + teks; target ≥ 44 dan jarak ≥ 8; 320 px tanpa gulir horizontal termasuk `Rp 12.345.678.900`; salinan galat **tanpa nominal**; tanpa tanda seru; tanpa "rumah tangga"; istilah `Utang`, bukan "Hutang"). Tambahan S12:

1. **Tanpa merah untuk angka utang, saldo patungan, modal, dan `Kurang`.** Angka netral (`text`), arah dibawa kata (`berutang ke`, `Piutang`), bukan hue. `Kurang Rp …` adalah peringatan: kotak `warning-tint` + ikon `warning` + teks, bukan `danger`. `danger` hanya tombol destruktif dan pesan galat. Hasil realisasi tidak diberi hijau (bukan pemasukan).
2. **Tanpa "Rp 0" saat kosong:** kartu yang nilainya nol tidak dirender (kartu Utang, peringatan `Kurang`, baris `Hasil ditarik`), atau diganti kata (`Patungan impas`, `Modal sudah ditarik semua`).
3. **Dompet sistem `Patungan` tidak pernah tampil sebagai dompet** (Dompet, pemilih, kekayaan bersih, riwayat); yang tampil hanya kalimat `Dibayar dari dompet pribadi {nama}` tanpa nama dompet Pribadi.
4. **Ruang selalu tertulis:** semua sheet patungan bertuliskan `· Bersama`; kaki Pribadi yang ikut berubah disebut di toast (`Rp … dari BCA`) hanya kepada pemiliknya.
5. **Kalimat saldo dari SQL:** UI hanya menyusun nama + nominal dari `api.shared_balances`; tidak menjumlah atau mengurangi saldo (pratinjau satu pengurangan di sheet boleh, preseden S6-C3/S11).

## Beranda Pribadi

### S12-UT1 · Kartu `Utang yang harus dibayar` (K1)

- **Tujuan:** menjawab "aman dipakai naik karena saya meminjam": sisa utang terlihat di samping angka kas, tanpa mengubah "aman dipakai".
- **Data:** `api.debt_totals(space)` (Task 2): Σ sisa `borrowed`, Σ sisa `lent`, jumlah utang aktif per arah; utang terhapus tidak dihitung.
- **Tata letak (HP):** `ListCard` judul `Utang yang harus dibayar` (ikon `hand-coins` 18), Server Component. Isi: baris utama label 13/600 `text-soft` `Sisa utang` + `MoneyText` 22/800 netral + sub 12/500 `text-muted` `{n} utang aktif`; bila Σ `lent` > 0, baris kedua `Piutang` 15/700 netral + `{m} piutang aktif`. Di bawah, tautan teks 44 `Lihat utang` (ikon `caret-right` 16) ke `/pribadi/rencana?bagian=utang`. Satu kalimat 12/500 `text-muted`: `Tidak mengurangi angka Aman dipakai.`
- **Bila hanya ada piutang:** judul berganti `Piutang yang masih ditagih`, satu baris `Piutang`, kalimat bawah tidak ada.
- **Bila keduanya 0** (tanpa utang, atau semua lunas/dihapus): kartu **tidak dirender**. Galat loader: kartu tidak dirender dan galat dicatat (kartu sekunder; Aman dipakai tidak boleh ikut gagal); tidak ada keadaan memuat terpisah (data ikut loader Beranda).
- **Posisi:** HP: Aman → S6-B1 → Tagihan 7 hari → Anggaran hampir habis → **Utang** → checklist → Terakhir. Tablet: di grid dua kolom kartu S9, sesudah Anggaran. Laptop: kolom kanan, sesudah Anggaran hampir habis. Pribadi tanpa dompet operasional (`SafeToSpendEmptyView`): kartu tetap tampil sesudah checklist bila ada utang berjalan.
- **Bersama:** tidak pernah dirender; tidak ada kata utang/piutang di markup Beranda Bersama.
- **ARIA:** `section aria-labelledby` judul; tautan `Lihat utang` bernama `Lihat utang` (Label in Name).

## Dompet: modal trading (Pribadi saja)

### S12-TR1 · Tambah dompet `Trading`

- Sheet Tambah dompet (`add-account-sheet.tsx`): `Jenis` (`SegmentedControl`) mendapat opsi `Trading` **hanya di Pribadi** (Bersama: tiga opsi lama, pola `Kantor`). Di 320 empat segmen tidak muat sama lebar: `Jenis` berganti `SelectField` di bawah 390 bila opsi > 3, atau bungkus dua baris 2×2 (pilihan implementer, target 44). Keterangan di bawah, 13/500 `text-soft`, saat `Trading` dipilih: `Untuk rekening saham, kripto, atau sejenisnya. Saldonya tidak dihitung di Aman dipakai.`
- Galat server `pocket_personal_only` (B10) di kolom Jenis: `Dompet Trading hanya ada di Pribadi.`

### S12-TR2 · Kelompok `Trading` dan kartu `Modal trading` di Dompet

- **Kelompok:** urutan `POCKETS` = Operasional, Tabungan, **Trading**, Kantor. `ListCard` `Trading` (ikon `chart-line-up` 18) memuat baris dompet trading seperti kelompok lain (nama, saldo, tanpa warna). Kelompok kosong tidak dirender.
- **Kekayaan bersih:** trading **ikut** (aset pengguna); sub berubah `Operasional, tabungan, dan trading. Kas Kantor tidak dihitung.` hanya bila ada dompet trading (selain itu teks lama).
- **Kartu `Modal trading`** (Server Component, `card`, tepat di bawah kelompok Trading; hanya bila ada ≥ 1 dompet trading dan pernah ada setoran): judul 15/700 `Modal trading`, `dl` dua kolom: `Sisa modal` (`MoneyText` 22/800 netral), `Saldo trading` (15/700), dan bila `realized` > 0 `Hasil ditarik` (15/700 netral, sub 12/500 `text-muted` `Penarikan di atas modal yang disetor.`). Semua dari `api.trading_overview` (Task 4).
- **Peringatan `Kurang`** (hanya bila `shortfall` > 0, di dalam kartu, di bawah `dl`): kotak `warning-tint` radius 12, ikon `warning` 16 + teks 14/700 `Kurang Rp 1.200.000` dan kalimat 13/500 `Saldo trading lebih kecil dari sisa modal yang kamu setor.` Tidak ada nominal dihitung UI. Bila `shortfall` = 0: tidak ada kotak, tidak ada `Rp 0`.
- **Sisa modal 0, pernah ada setoran** (ditarik semua): angka diganti kalimat 15/600 `Modal sudah ditarik semua.`; `Hasil ditarik` tetap tampil bila > 0.
- **Keadaan:** dompet trading ada tetapi belum ada setoran: kartu berisi `EmptyLine` `Belum ada modal yang disetor. Setor modal dari detail dompet trading.`; galat loader trading: `CardError` `Modal trading belum bisa dimuat.` + `Coba lagi` (daftar dompet tetap tampil). Memuat: ikut kerangka halaman Dompet.
- **Laptop:** kelompok di grid tiga kolom yang ada; kartu Modal melebar satu kolom di bawah kelompok Trading (urutan DOM: kelompok Trading → kartu Modal).

### S12-TR3 · Detail dompet trading

- Sama dengan Detail dompet (`dompet-detail.tsx`), ditambah **kartu `Modal`** per dompet di bawah kartu saldo: `Sisa modal`, `Disetor`, `Ditarik`, `Hasil ditarik` (bila > 0), peringatan `Kurang` per dompet (aturan sama dengan TR2).
- **Aksi (urut):** `Setor modal` (primer 48), `Tarik modal` (sekunder 44, tidak ada bila saldo dompet 0 dan sisa modal 0), `Cocokkan saldo` (sekunder 44, aksi yang ada). Kalimat di bawah aksi 12/500 `text-muted`: `Untung atau rugi dicatat lewat Cocokkan saldo, bukan pemasukan.`
- **Riwayat:** baris transfer modal diberi label `Setor modal dari {dompet}` / `Tarik modal ke {dompet}` (bukan `Transfer`), penyesuaian `Cocokkan saldo` seperti biasa.

### S12-TR4 · Sheet `Setor modal` / `Tarik modal` (sheet transfer yang ada)

- Membuka sheet Transfer yang sama (`catat-sheet` mode `transfer`) dengan prasetel: **Setor:** tujuan = dompet trading ini (terkunci, teks), sumber = pemilih dompet Pribadi **bukan Trading, bukan Kantor**; **Tarik:** sumber = dompet trading ini (terkunci), tujuan = pemilih yang sama. Judul `Setor modal · Pribadi` / `Tarik modal · Pribadi` + `SpaceTag`. Biaya transfer tetap tersedia (biaya = pengeluaran, aturan lama).
- Di bawah nominal, satu kalimat 12/500 `text-muted`: `Setor modal bukan pengeluaran. Laporan dan anggaran tidak berubah.` / `Tarik modal bukan pemasukan.`
- **Tarik lebih dari sisa modal:** diizinkan (kelebihan = hasil ditarik); kalimat pratinjau `Rp … di atas sisa modal dicatat sebagai hasil ditarik.` hanya bila jumlah > sisa modal (satu pengurangan pratinjau). Saldo dompet trading kurang: pola `Tetap simpan` S6-C3.
- **Toast:** `Modal disetor ke {trading} · Pribadi · Rp 5.000.000 dari BCA`; `Modal ditarik dari {trading} · Pribadi · Rp 1.000.000 ke BCA` (+ `Urungkan`).
- **Pemilih dompet di tempat lain:** dompet trading **tidak** muncul di pemilih Catat Pengeluaran/Pemasukan, tagihan, utang, dan WA bawaan; muncul di Transfer biasa (sebagai sumber/tujuan) dan di Cocokkan saldo. Transfer biasa ke/dari trading tetap dihitung sebagai setor/tarik (definisi K2 = semua transfer dompet non-trading ↔ trading).

## Bersama: bagi tagihan (patungan)

Semua bingkai di bagian ini hanya untuk Bersama dengan **dua anggota**. Bersama solo/kosong: tidak ada kartu, rute `/bersama/patungan` menampilkan `EmptyState` `Patungan butuh dua anggota.` / `Ajak Farida ke Bersama dulu.` (pemilik) + `Undang Farida`; Pribadi: `/pribadi/patungan` = `notFound()`.

### S12-PT1 · Kartu `Saldo patungan` di Beranda Bersama

- **Tujuan:** satu kalimat siapa berutang berapa ke siapa, dari data.
- **Tata letak (HP):** `ListCard` `Saldo patungan` (ikon `receipt` 18), Server Component. Isi: `MemberAvatar` pengutang + kalimat 15/700 `Farida berutang Rp 200.000 ke Novanda` (dari sudut pandang penonton: `Kamu berutang Rp 200.000 ke Novanda` / `Farida berutang Rp 200.000 ke kamu`), nominal `whitespace-nowrap` boleh turun ke baris sendiri di 320. Sub 12/500 `text-muted` `Dari {n} tagihan patungan dan {m} pelunasan.` Aksi: bila penonton = pengutang, tombol sekunder 44 `Lunasi` (membuka S12-PT3); selalu tautan teks 44 `Lihat patungan` ke `/bersama/patungan`. Bila ada pelunasan menunggu diterima oleh penonton: baris tambahan 13/600 `Farida sudah melunasi Rp 200.000. Terima ke dompet?` + tombol sekunder 44 `Terima` (S12-PT4).
- **Impas, pernah ada patungan:** ikon `check-circle` fill 16 + teks 15/700 `accent-text` `Patungan impas`, tanpa nominal, tanpa `Rp 0`.
- **Belum pernah ada patungan:** kartu **tidak dirender** (fitur diperkenalkan lewat toggle Catat).
- **Galat:** `CardError` `Saldo patungan belum bisa dimuat.` + `Coba lagi` (pola Kontribusi; Aktivitas dan Aman dipakai tidak ikut gagal).
- **Posisi:** HP: … checklist → **Saldo patungan** → Kontribusi → Aktivitas → Terakhir. Laptop: kolom kiri, di atas Kontribusi.
- **ARIA:** kalimat saldo adalah teks biasa (bukan hanya angka); tombol `Lunasi` bernama `Lunasi patungan ke Novanda`.

### S12-PT2 · Halaman `/bersama/patungan`

- **Masuk dari:** kartu PT1, Menu → `Patungan` (ikon `receipt`, hanya mode nyata Bersama dua anggota; disembunyikan di Pribadi), toast sesudah mencatat patungan.
- **Tata letak (HP, satu kolom, `laptop:max-w-180`):** `BackLink` `Beranda`; `h1` `Patungan · Bersama`. (1) **Kartu saldo** (`heroCard`): label `Saldo patungan` 14/500 `text-soft` + `SpaceTag` Bersama, kalimat besar 22/800 (sama dengan PT1), tombol `Lunasi Rp 200.000` (primer 48, penuh) hanya untuk pengutang; impas: `Patungan impas` (ikon + teks). (2) **`ListCard` `Menunggu diterima`** (hanya bila ada pelunasan belum diterima yang ditujukan ke penonton atau dibuat penonton): baris `Farida melunasi Rp 200.000 · 14 Nov` + `Terima` (penerima) atau status `Menunggu Novanda` (ikon `clock` 14 + teks, pelunas). (3) **`ListCard` `Riwayat`** (ikon `clock`): tagihan patungan dan pelunasan berbaur, terbaru di atas, halaman 20 + `Muat lagi`. Baris tagihan: ubin kategori 44, deskripsi 15/600 `line-clamp-2`, meta 13/500 `text-muted` `Dibayar Novanda · bagian Farida Rp 200.000 · 12 Nov`, nominal kanan 15/700 `whitespace-nowrap`. Baris pelunasan: ikon `hand-coins` 44, `Farida melunasi ke Novanda`, meta `14 Nov · Diterima` atau `14 Nov · Menunggu diterima`. Badan baris tagihan = tautan ke Detail transaksi pengeluaran Bersama; kolom kanan untuk pembuatnya: tombol teks 44 `Hapus` (tagihan) / `Batalkan` (pelunasan) membuka dialog S12-AK1/AK2. (4) **`details` `Patungan dihapus ({n})`** (≤ 90 hari, hanya milik penonton): baris + `Pulihkan` (sekunder 44).
- **Keadaan:** kosong (`EmptyState` accent, ikon `receipt` 28) `Belum ada tagihan patungan.` / `Saat kamu membayar tagihan Bersama dari dompet pribadi, catat di sini supaya pembagiannya jelas.` / aksi primer `Catat pengeluaran Bersama` (membuka Catat dengan toggle menyala); memuat `Memuat patungan…` + kerangka kartu dan tiga baris; galat `ErrorState` `Patungan belum bisa dimuat.` / `Sambungan ke server terputus. Catatan yang sudah tersimpan tidak hilang.` + `Coba lagi`.
- **Laptop:** satu kolom; sheet menjadi dialog tengah 520.
- **Privasi:** tidak ada nama dompet Pribadi siapa pun di halaman ini, kecuali di toast pemiliknya.

### S12-PT3 · Sheet `Lunasi patungan · Bersama`

- **Tujuan:** pengutang mengembalikan bagiannya dari dompet pribadinya.
- **Tata letak:** `Sheet` + `SpaceTag` Bersama. Di bawah judul: `Kamu berutang Rp 200.000 ke Novanda` 15/700 (dari SQL). Isian: (1) **Jumlah** (`MoneyInput`, `Jumlah dilunasi`, fokus awal, prasetel = seluruh utang); chip `Semua` (isi ulang dengan seluruh utang). (2) **Dari dompet pribadi** (`SelectField`, dompet Pribadi pemanggil aktif bukan Kantor/Trading; bawaan dompet operasional pertama). (3) **Tanggal** (pilihan 14 hari `pay-bill-sheet`, maks hari ini). (4) **`KolomKas`** `Setelah ini`: `Utang ke Novanda sekarang`, `Dilunasi −Rp …`, garis ganda, `Sesudahnya` (`Lunas` ikon + teks bila 0); baris `Saldo {dompet} berkurang Rp …`.
- **Bayar lebih:** galat kolom `Jumlah ini lebih besar dari utangmu. Kurangi jumlahnya.` + tombol sekunder 44 `Lunasi semua Rp 200.000` (mengisi, tidak menyimpan); server `payment_exceeds` → muat ulang data, galat sama.
- **Saldo kurang:** kotak `warning-tint` S6-C3 + `Tetap lunasi`.
- **Footer:** `Lunasi Rp 200.000` (primer 48).
- **Toast:** `Pelunasan dicatat di Bersama · Rp 200.000 dari BCA · menunggu Novanda menerima` + `Urungkan` (= `void_settlement`).
- **Penjelasan satu kali** (13/500 `text-soft`, di atas footer): `Uangnya menunggu di Bersama sampai Novanda menerimanya ke dompetnya.`

### S12-PT4 · Sheet `Terima pelunasan · Bersama`

- Untuk penerima: `Farida melunasi Rp 200.000` (dari SQL). Isian satu: **Terima ke dompet** (`SelectField`, dompet Pribadi penerima aktif bukan Kantor/Trading). Kalimat 13/500 `text-soft`: `Saldo {dompet} bertambah Rp 200.000. Ini bukan pemasukan.` Footer `Terima Rp 200.000` (primer 48). Toast `Diterima dari Farida · Rp 200.000 ke BCA` + `Urungkan` (= `void_receipt`). Penerima boleh membiarkannya; saldo patungan sudah berkurang sejak pelunasan dicatat.

### S12-CT1 · Catat Bersama: `Dibayar dari dompet pribadi`

- **Di mana:** sheet Catat (`catat-sheet.tsx`), jenis `Pengeluaran`, ruang Bersama, dua anggota. Satu sakelar ubin 44 `role="switch"` di baris pemilih (pola Talangan; ikon `user` 20; tidak tampil bersamaan dengan Talangan karena Talangan hanya Pribadi). Nama aksesibel `Dibayar dari dompet pribadi`.
- **Menyala:** (1) `MetaSelect` dompet berganti label `Dari dompet pribadi` dan opsinya **dompet Pribadi pemanggil** (aktif, bukan Kantor/Trading), bawaan dompet operasional pertama; dompet Bersama tidak ditawarkan. (2) Slot petunjuk (tempat petunjuk Talangan) memuat satu baris 13/600 `text-soft` + ikon `info` 14: `Dibagi rata dengan Farida` dan tombol teks 44 `Ubah pembagian` (membuka S12-CT2); mode keyboard: satu baris terpotong + teks lengkap `sr-only` (pola S7-C2). (3) Judul sheet tetap `Pengeluaran · Bersama`; ruang tujuan tidak berubah. (4) Saldo kurang: `SaldoKurangRow` untuk dompet Pribadi yang dipilih + `Tetap simpan`.
- **Tanpa dompet Pribadi:** sakelar tetap ada; menyalakannya menampilkan baris `Belum ada dompet di Pribadi. Tambah dompet di Pribadi dulu.` dan tombol simpan nonaktif selama menyala.
- **Toast:** `Patungan dicatat di Bersama · Rp 400.000 dari BCA · Farida menanggung Rp 200.000` + `Lihat patungan` (tautan) + `Urungkan` (= `void_split`). Nominal bagian dari balasan SQL.
- **Sesudah simpan:** sakelar kembali mati untuk catatan berikutnya (tidak diingat), supaya pengeluaran dari kas Bersama tidak salah sumber.

### S12-CT2 · Sheet `Pembagian · Bersama` (pulau malas)

- **Isian:** `SegmentedControl` `Cara bagi`: `Sama rata` | `Atur nominal`. Sama rata: kalimat `Masing-masing Rp 200.000. Sisa Rp1 ditanggung kamu.` (sisa hanya bila ganjil; pratinjau satu pembagian, hasil final dari SQL). Atur nominal: `MoneyInput` `Bagian Farida` (0 sampai nominal) dan baris statis `Bagian kamu Rp …` (pratinjau satu pengurangan). Galat: `Bagian Farida tidak boleh lebih dari total.`
- **Footer:** `Pakai pembagian ini` (primer 48) kembali ke Catat; Catat menampilkan `Farida menanggung Rp 150.000` di slot petunjuk.
- **ARIA/Fokus:** fokus awal `Cara bagi`; Esc kembali ke Catat tanpa mengubah; fokus kembali ke `Ubah pembagian`.

## Dialog akibat

### S12-AK1 · `Hapus tagihan patungan ini?`

- **Isi:** `Pengeluaran Bersama {deskripsi} dan pembagiannya dibatalkan. Uangnya kembali ke {dompet}.` Lalu dua `KolomKas` kecil: **`Saldo {dompet}`** (`Sekarang`, `+Rp 400.000`, `Sesudahnya`) dan **`Saldo patungan`** (`Farida berutang sekarang`, `−Rp 200.000`, `Sesudahnya`; bila hasilnya berbalik arah, baris hasil berbunyi `Kamu berutang Rp … ke Farida`, bila 0 `Impas`). Hanya untuk pembayar. Bisa dipulihkan 90 hari dari `Patungan dihapus`.
- **Tombol:** `Hapus tagihan` (bahaya), `Kembali`; ikon `trash`. Toast `Tagihan patungan dihapus di Bersama` + `Urungkan`.

### S12-AK2 · `Batalkan pelunasan ini?`

- **Isi (pelunas):** `Pelunasan {tgl} dibatalkan. Uangnya kembali ke {dompet} dan utangmu ke Novanda bertambah lagi.` + `KolomKas` `Saldo {dompet}` dan `Utang ke Novanda`. Bila sudah diterima: dialog tidak dibuka; baris menampilkan `Sudah diterima Novanda. Minta Novanda membatalkan penerimaannya dulu.` (13/500 `text-muted`).
- **Isi (penerima, batal terima):** `Batalkan penerimaan?` / `Uangnya keluar lagi dari {dompet} dan kembali menunggu di Bersama. Saldo patungan tidak berubah.`
- **Tombol:** `Batalkan pelunasan` / `Batalkan penerimaan` (bahaya), `Kembali`; ikon `arrow-counter-clockwise`.

## Salinan galat S12 (tanpa nominal)

| Kode (usulan Task 4/6)                                        | Tempat                             | Teks                                                                                                     |
| ------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pocket_personal_only`                                        | kolom Jenis (Tambah dompet)        | `Dompet Trading hanya ada di Pribadi.`                                                                   |
| `account_trading` (dompet trading di pemilih yang menolaknya) | kolom Dompet                       | `Dompet Trading tidak bisa dipakai di sini. Pilih dompet lain.`                                          |
| `account_system` (dompet patungan dipakai jalur generik)      | kotak atas                         | `Data ini tidak ditemukan. Muat ulang halaman.`                                                          |
| `split_needs_partner`                                         | kotak atas Catat                   | `Patungan butuh dua anggota di Bersama.`                                                                 |
| `split_locked` (ubah/batal/pindah generik)                    | kotak atas detail                  | `Ini bagian dari patungan. Ubah atau hapus dari halaman Patungan.`                                       |
| `invalid_argument/shares`                                     | kolom Bagian                       | `Pembagian harus sama dengan total.`                                                                     |
| `payment_exceeds` (Lunasi)                                    | kolom Jumlah                       | `Jumlah ini lebih besar dari utangmu. Kurangi jumlahnya.`                                                |
| `settlement_received`                                         | baris pelunasan                    | `Sudah diterima. Minta penerima membatalkan penerimaannya dulu.`                                         |
| `saldo_negatif`                                               | kotak `warning-tint` (bukan galat) | `Saldo {dompet} tinggal Rp …. Kalau disimpan, saldonya jadi −Rp ….`                                      |
| jaringan/`unknown`                                            | kotak atas sheet                   | `Belum berhasil. Sambungan ke server terputus. Coba lagi.`                                               |
| loader                                                        | `ErrorState`/`CardError`           | `Patungan belum bisa dimuat.` / `Saldo patungan belum bisa dimuat.` / `Modal trading belum bisa dimuat.` |

## Salinan final S12 (mengikat Task 3, 5, 7)

| Bingkai | Teks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UT1     | `Utang yang harus dibayar`; `Piutang yang masih ditagih`; `Sisa utang`; `{n} utang aktif`; `Piutang`; `{m} piutang aktif`; `Lihat utang`; `Tidak mengurangi angka Aman dipakai.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| TR1–TR4 | `Trading`; `Untuk rekening saham, kripto, atau sejenisnya. Saldonya tidak dihitung di Aman dipakai.`; `Operasional, tabungan, dan trading. Kas Kantor tidak dihitung.`; `Modal trading`; `Modal`; `Sisa modal`; `Saldo trading`; `Disetor`; `Ditarik`; `Hasil ditarik`; `Penarikan di atas modal yang disetor.`; `Kurang Rp …`; `Saldo trading lebih kecil dari sisa modal yang kamu setor.`; `Modal sudah ditarik semua.`; `Belum ada modal yang disetor. Setor modal dari detail dompet trading.`; `Setor modal`; `Tarik modal`; `Untung atau rugi dicatat lewat Cocokkan saldo, bukan pemasukan.`; `Setor modal dari {dompet}`; `Tarik modal ke {dompet}`; `Setor modal · Pribadi`; `Tarik modal · Pribadi`; `Setor modal bukan pengeluaran. Laporan dan anggaran tidak berubah.`; `Tarik modal bukan pemasukan.`; `Rp … di atas sisa modal dicatat sebagai hasil ditarik.`; toast sesuai TR4 |
| PT1–PT2 | `Saldo patungan`; `{nama} berutang Rp … ke {nama}`; `Kamu berutang Rp … ke {nama}`; `{nama} berutang Rp … ke kamu`; `Dari {n} tagihan patungan dan {m} pelunasan.`; `Patungan impas`; `Lunasi`; `Lunasi patungan ke {nama}`; `Lihat patungan`; `{nama} sudah melunasi Rp …. Terima ke dompet?`; `Terima`; `Patungan · Bersama`; `Lunasi Rp …`; `Menunggu diterima`; `Menunggu {nama}`; `Riwayat`; `Dibayar {nama} · bagian {nama} Rp … · {tgl}`; `{nama} melunasi ke {nama}`; `Diterima`; `Hapus`; `Batalkan`; `Patungan dihapus ({n})`; `Pulihkan`; `Muat lagi`; `Belum ada tagihan patungan.`; `Saat kamu membayar tagihan Bersama dari dompet pribadi, catat di sini supaya pembagiannya jelas.`; `Catat pengeluaran Bersama`; `Memuat patungan…`; `Patungan butuh dua anggota.`; `Ajak Farida ke Bersama dulu.`                                                                              |
| PT3–PT4 | `Lunasi patungan · Bersama`; `Jumlah dilunasi`; `Semua`; `Dari dompet pribadi`; `Setelah ini`; `Utang ke {nama} sekarang`; `Dilunasi`; `Sesudahnya`; `Lunasi semua Rp …`; `Tetap lunasi`; `Uangnya menunggu di Bersama sampai {nama} menerimanya ke dompetnya.`; `Terima pelunasan · Bersama`; `Terima ke dompet`; `Saldo {dompet} bertambah Rp …. Ini bukan pemasukan.`; `Terima Rp …`; toast sesuai PT3/PT4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CT1–CT2 | `Dibayar dari dompet pribadi`; `Dari dompet pribadi`; `Dibagi rata dengan {nama}`; `Ubah pembagian`; `Belum ada dompet di Pribadi. Tambah dompet di Pribadi dulu.`; `{nama} menanggung Rp …`; `Pembagian · Bersama`; `Cara bagi`; `Sama rata`; `Atur nominal`; `Masing-masing Rp …. Sisa Rp1 ditanggung kamu.`; `Bagian {nama}`; `Bagian kamu Rp …`; `Bagian {nama} tidak boleh lebih dari total.`; `Pakai pembagian ini`; toast sesuai CT1                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AK1–AK2 | `Hapus tagihan patungan ini?`; `Pengeluaran Bersama {deskripsi} dan pembagiannya dibatalkan. Uangnya kembali ke {dompet}.`; `Saldo patungan`; `Impas`; `Hapus tagihan`; `Batalkan pelunasan ini?`; `Pelunasan {tgl} dibatalkan. Uangnya kembali ke {dompet} dan utangmu ke {nama} bertambah lagi.`; `Sudah diterima {nama}. Minta {nama} membatalkan penerimaannya dulu.`; `Batalkan penerimaan?`; `Uangnya keluar lagi dari {dompet} dan kembali menunggu di Bersama. Saldo patungan tidak berubah.`; `Batalkan pelunasan`; `Batalkan penerimaan`; `Kembali`; `Sekarang`                                                                                                                                                                                                                                                                                                                        |

## Target sentuh, urutan fokus, nama aksesibel

- Semua kontrol ≥ 44 dengan jarak ≥ 8: `Lihat utang`, `Lihat patungan`, `Lunasi`, `Terima` (44), sakelar patungan (44), `Ubah pembagian` (44), baris riwayat (≥ 64) dan `Hapus`/`Batalkan` (44), footer (48).
- Urutan DOM = urutan baca = urutan fokus. **Patungan:** BackLink → `Lunasi` → baris Menunggu (`Terima`) → riwayat (badan → `Hapus`/`Batalkan`) → `Muat lagi` → `Patungan dihapus`. **Detail trading:** BackLink → `Setor modal` → `Tarik modal` → `Cocokkan saldo` → riwayat. **Catat Bersama:** nominal → kategori → sakelar → `Ubah pembagian` → dompet → tanggal → simpan (urutan kontrol yang ada).
- Status tidak pernah hanya warna: `Patungan impas`, `Lunas`, `Menunggu diterima`, `Diterima` (ikon + teks); `Kurang` (ikon `warning` + teks).

## Budget JS dan aturan implementasi

- Ukur dari `main` **sebelum menambah apa pun** untuk Beranda nyata (Pribadi dan Bersama), Dompet, detail dompet, Catat, dan rute baru Patungan; berhenti bila > 162. Target: Beranda nyata ≤ 158 (kartu Utang dan Saldo patungan Server Component, +0 chunk), Dompet ≤ 152, Patungan ≤ 152.
- Server Component: kartu Utang, kartu Modal + peringatan `Kurang`, kartu Saldo patungan, daftar Patungan. Pulau malas: sheet Lunasi/Terima, dialog AK1/AK2 (satu chunk `patungan-client`), sheet Pembagian (chunk sendiri, tidak masuk Catat awal). Sakelar patungan di Catat memakai komponen ubin yang ada (tanpa ikon baru selain `user`, sudah ada).
- Ukuran uji layar (Task 9): 320, 390, 1280; gelap dan terang; `Rp 12.345.678.900` di kartu Utang, kartu Modal, peringatan `Kurang`, kalimat saldo patungan, `KolomKas`; nama dompet 60 huruf di pemilih `Dari dompet pribadi`; keadaan kosong, memuat, galat, impas, menunggu diterima, saldo kurang, bayar lebih, Bersama solo; axe tanpa pelanggaran serius.

## Dampak ke task lain

1. **Task 2:** `api.debt_totals` mengembalikan Σ sisa per arah dan **jumlah utang aktif per arah** (sub `{n} utang aktif`).
2. **Task 4:** `0133` juga menambah `patungan` (S12-ADR1). DQ modal trading = **DQ15** (DQ06 sudah dipakai). `api.trading_overview` per dompet: `capital_in`, `capital_out`, `capital_left`, `realized`, `balance`, `shortfall`, dan total; `has_deposit` (pernah ada setoran) untuk keadaan TR2. `api.net_worth` tidak dipakai web; bila tetap dipertahankan, tambahkan trading ke `total` (catat di BSD).
3. **Task 5:** pemilih dompet menyaring `trading` sesuai TR4; loader Dompet menyaring `patungan` (selalu) sebelum UI menjumlah kekayaan bersih.
4. **Task 6:** bentuk sesuai S12-ADR1 (tiga tabel, dompet sistem, `x_patungan`, `create_split`/`settle_split`/`receive_settlement`/void/restore, DQ16).
5. **Task 7:** label Transaksi `Bayar untuk Bersama` (kaki Pribadi pembayar), `Lunasi patungan` (kaki Pribadi pelunas), `Terima patungan` (kaki Pribadi penerima); Bersama: kaki masuk/keluar dompet sistem **tidak** tampil sebagai `Setoran dari {nama}` di Transaksi maupun feed Aktivitas (`api.shared_activity` mengembalikan `entry_id`; server mencocokkan dengan tabel patungan dan menampilkan satu baris `Novanda membayar {deskripsi} dari dompet pribadi`); Laporan "Tidak termasuk" label `x_patungan` = `Patungan`; Ekspor Jenis tetap kunci mesin; Sampah menyembunyikan entri patungan (pemulihan dari PT2).

## Keputusan agen atas nama pemilik (Task 1)

1. **S12-ADR1 opsi C** (dompet sistem `patungan`, tiga entri yang sudah dikenal, kelas `x_patungan`), bukan A (tidak layak terhadap `entry_lines.account_id` wajib) atau B (mencemari Kontribusi S8).
2. **Pelunasan satu sisi + `Terima ke dompet` opsional oleh penerima** (bukan "catat pemasukan sendiri").
3. **Pembayar = pencatat** (hanya dompet Pribadi sendiri yang bisa dipilih); ubah patungan = hapus lalu catat ulang.
4. **Untung/rugi trading lewat `Cocokkan saldo`** (adjustment, `x_koreksi`), bukan pemasukan; dompet trading disembunyikan dari pemilih Pengeluaran/Pemasukan.
5. **Kartu Utang di bawah kartu S9**, tidak di dalam kartu Aman dipakai (satu angka besar per layar tetap).
6. **DQ15/DQ16** menggantikan "DQ06"/"DQ07-analog" di plan (nomor sudah terpakai).

## Pertanyaan untuk pemilik dan penyimpangan

1. **K3/K4 ditajamkan, bukan diganti:** kaki Pribadi pembayar dan pelunas adalah `space_transfer` (bukan `transfer` biasa, yang tidak bisa menyeberang ruang), dan kaki Bersama memakai dompet sistem tersembunyi `Patungan` (bukan "tanpa dompet", yang tidak mungkin karena `entry_lines.account_id` wajib). Efek yang dijanjikan K3 tetap: bukan pengeluaran pribadi, bukan kontribusi, dompet Bersama tidak bergerak. Setuju?
2. **Langkah `Terima ke dompet`** menambah satu fungsi dan satu sheet di atas K4. Tanpa itu, uang pelunasan tercatat keluar dari dompet Farida tetapi tidak pernah masuk ke dompet Novanda (Novanda harus `Cocokkan saldo` sendiri, atau mencatatnya sebagai pemasukan yang menggelembungkan Laporan). Rekomendasi: pakai. Bila ditolak, PT4 dan `receive_settlement` dihapus dari Task 6/7.
3. **Laporan Pribadi pembayar** menghitung kaki Pribadi di "Tidak termasuk · Setor ke Bersama" (kelas `x_setor_bersama`), bukan baris terpisah `Patungan`. Memisahkannya butuh `report_lines` mengenal tabel patungan. Cukup?
4. **Anggota keluar dari Bersama saat saldo patungan belum impas:** tidak dibahas di plan. Usulan S12: keluar tidak diblok, saldo tetap tercatat di Bersama dan terlihat oleh anggota yang tinggal. Setuju, atau keluar ditolak sampai impas?
5. **Transfer antar dua dompet trading:** K2 hanya mendefinisikan non-trading ↔ trading. Usulan: tidak dihitung sebagai setor/tarik (total modal tetap benar, per dompet bisa tidak seimbang). Atau ditolak?
6. **Kekayaan bersih Dompet memasukkan saldo trading.** Setuju (aset tetap aset), atau trading dipisah seperti Kantor?
7. **T10 (K9)** tetap butuh konfirmasi isi; bingkai mengikuti K9 apa adanya.

## Untuk kursi design reviewer

Task 3, 5, 7 menugaskan reviewer terpisah memeriksa: tidak ada merah/hijau pada angka utang, modal, hasil ditarik, `Kurang`, dan saldo patungan; tidak ada `Rp 0` (kartu tersembunyi, `Patungan impas`, `Modal sudah ditarik semua`, `Lunas`); dompet sistem `Patungan` tidak tampil di mana pun; nama dompet Pribadi tidak muncul di layar Bersama penonton lain; sakelar `Dibayar dari dompet pribadi` jelas statusnya tanpa warna (ikon + `aria-checked` + baris petunjuk); kalimat saldo terbaca dari kedua sudut pandang (`Kamu berutang …` / `… ke kamu`); `KolomKas` dan kalimat saldo muat di 320 dengan `Rp 12.345.678.900`; Label in Name; galat tanpa nominal; Pribadi tanpa jejak patungan, Bersama tanpa jejak utang dan trading.
