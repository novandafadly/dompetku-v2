# Bingkai desain S14 (aset, saham, kekayaan bersih per ruang)

Gerbang awal S14 (IPD §6 S14; plan `docs/superpowers/plans/2026-11-15-dompetku-v2-s14-aset-saham-net-worth.md` Task 1). Ditulis agen mengikuti Panel Malam (`DESIGN.md`, token `apps/web/src/styles/tokens.css`), `docs/spec/ui-ux.md`, dan format `docs/design/s13-bingkai.md`. Keputusan K1 sampai K14 di plan mengikat: pemilik menyetujui plan dan rekomendasinya (2026-11-15, `docs/m0a-keputusan.md` "S14"); K1 = input harga manual sebagai jalur utama + adapter Yahoo best-effort di Task 8 (**[konfirmasi pemilik]**, keputusan agen); K13 tetap **[konfirmasi pemilik]**. ID `S14-NW*` (kekayaan bersih), `S14-AS*` (aset non-saham), `S14-SH*` (saham) dirujuk Task 9, 10, 11, 12, 13. Semua bingkai hanya untuk **mode nyata**; prototipe (`NEXT_PUBLIC_PROTOTYPE=1`) tidak berubah (hero prototipe tetap menjumlah data demo, plan Task 9).

## Fakta kode yang membentuk bingkai

Diperiksa di cabang `ccr-6b15bf5f-1cnpb6` `a577225` (di atas `main` sesudah PR #38). Nomor baris yang disebut plan dicocokkan; koreksi ditulis.

- **Hero Dompet menjumlah di TS:** `features/dompet/account-list-view.tsx:111–113` (`netWorth = accounts.filter(pocket !== 'kantor' && pocket !== 'patungan').reduce(...)`; plan `:111` cocok). Subjudul `:131–135` (`Operasional, tabungan, dan trading. Kas Kantor tidak dihitung.` / `Operasional + tabungan. …`). **Subtotal kelompok juga dijumlah di TS** (`:29`, `Group`), plan tidak menyebutnya: untuk kelompok Aset subtotal itu akan mencampur saldo buku dan biaya perolehan saham (lihat S14-AS1).
- **`api.net_worth` tidak dipakai web:** `grep net_worth apps/web/src` = kosong. Versi terakhir `0134_modal_trading.sql:183` (kolom `operasional, tabungan, kantor_excluded, total`; total = operasional + tabungan + trading; down `:599`). Asal `0102_ledger_baca.sql:138`.
- **Modal trading menghitung transfer ke dompet non-trading mana pun sebagai tarik modal:** `app.trading_capital` `0134_modal_trading.sql:107–143` (cocok; cabang `transfer` `:110–122` hanya menyaring `pocket <> 'trading'` di sisi lawan). `api.trading_overview` `:145`; `shortfall` per dompet dan total di `:168` dan `:173–174`. Tanpa K7, beli saham dari RDN = `Tarik modal`.
- **Label riwayat juga salah tanpa perubahan (tidak disebut plan):** `app/[ruang]/_real/dompet-detail.tsx:57–74` (`modalMoveOf`) memberi label `Setor modal dari …`/`Tarik modal ke …` untuk setiap transfer antara dompet trading dan dompet **non-trading**. Dompet saham ber-pocket `aset`, jadi beli saham dari dompet trading akan berlabel `Tarik modal ke {dompet saham}` di Detail dompet trading. S14-SH9 menggantinya.
- **`Kurang` hanya di total:** `features/dompet/modal-card.tsx:97–99` (`!detail && figures.shortfall > 0`); kartu `Modal` di Detail dompet trading tidak menampilkannya (S12S13-C9, sengaja).
- **`worker_egress` tanpa filter dan tanpa subnet dipatok:** komentar layanan worker `infra/db-vm/compose.yml:131–134` (cocok). Deklarasi network ada di **`:286–288`** (`worker_egress: {}`), bukan `:276–279` seperti plan (baris itu komentar `worker_db` yang menyebut `worker_egress` sebagai network tanpa subnet). Komentar keliru "web butuh egress untuk Resend dan harga saham" di `:268` (cocok). `firewall.sh` punya rantai `DOMPETKU-WA-EGRESS` (`:24`), belum ada rantai worker.
- **Job worker hanya SQL:** `apps/worker/src/jobs.ts:24–25` (`kind: 'count' | 'dq'`, `sql: string`); tujuh job (`dq_reconcile`, `purge_*`, `materialize_bills`). Pola `kind: 'price'` belum ada (plan Task 7).
- **Kalender hari bursa:** `app.holidays` `0116_periode_gajian.sql:36` (cocok), global, `kind in ('libur', 'cuti_bersama')`. Cuti bersama pemerintah tidak selalu hari libur bursa; K9 sudah menerima "run tanpa data, tidak dianggap gagal". Untuk label `usang` (> 3 hari bursa) ini bisa membuat harga terlihat usang sehari lebih cepat atau lambat di sekitar cuti bersama; dapat diterima.
- **Pocket dan nama tidak bisa diubah sesudah dibuat:** satu-satunya `update app.accounts` adalah arsip (`0103_ledger_api.sql:571`, versi terakhir `0138_tujuan_api.sql:242`). Akibat: dompet biasa tidak bisa "dijadikan" aset; jenis aset (K4) juga tetap. Nama dompet unik per ruang (`0109`), jadi aset berbagi ruang nama dengan dompet (`Emas` tidak bisa ada dua kali).
- **Arsip dompet butuh saldo 0:** `api.archive_account` versi terakhir `0138_tujuan_api.sql:227` (tujuan aktif lebih dulu `:237`, lalu `balance_not_zero` `:240`). UI: `ArchiveIsland` hanya bila saldo 0 dan tanpa tujuan, selain itu `ArchiveBlockedCard` (`dompet-detail.tsx:220–236`; teks bawaan `features/dompet/archive-blocked-card.tsx:22–24` `{nama} masih berisi saldo. Pindahkan isinya dengan Transfer, lalu arsipkan.`).
- **`app.accounts.wallet_type` NOT NULL** (`0100_ledger_tabel.sql:24`, enum `cash`/`bank`/`ewallet`). Plan tidak menyebut nilai untuk dompet aset. Sheet Tambah aset tidak menanyakan Tipe; Task 3 memilih nilai tetap (usul `bank` untuk `saham`/`deposito`/`reksa_dana`, `cash` untuk lainnya, atau satu nilai tetap) dan UI **tidak pernah** menampilkan tipe dompet untuk aset (baris tipe diganti jenis aset, S14-AS1).
- **Cocokkan saldo dan Ubah saldo awal ada di semua Detail dompet:** `dompet-detail.tsx:153–185` (`ReconcileIsland` → `api.reconcile_balance`, tautan `Ubah saldo awal`). Pada dompet saham keduanya merusak "saldo buku = Σ biaya perolehan" (DQ18); pada aset non-saham `Cocokkan saldo` menulis `adjustment`/`x_koreksi`, bukan `valuation`/`x_valuasi`. Plan tidak menutupnya (lihat "Kendala rancangan plan" butir 2).
- **Sheet Transfer = mode `transfer` sheet Catat:** pemilih dompet disaring di `features/catat/use-catat.tsx:74–87` dan `:262–276` (`ordinary` = bukan Kantor, bukan Trading; mode transfer biasa menerima semua dompet aktif). Prasetel setor/tarik (`preset`, `lockedTo`) sudah ada untuk Modal trading dan dipakai ulang untuk aset (S14-AS5).
- **Laporan "Tidak termasuk":** `features/laporan/class-breakdown-view.tsx` + `present.ts:120–165` memetakan setiap kelas `x_*` ke nama dan catatan; kelas baru `x_valuasi` butuh cabang (S14-AS9).
- **Pola UI yang dipakai ulang:** `ListCard`, `WalletRow` (nama `line-clamp-2`), `EmptyState`/`ErrorState`/`CardError`, `Sheet` + `SpaceTag`, `ConfirmDialog`, `TextField`, `MoneyInput`, `SelectField`, `SegmentedControl`, `DateInput`, `SaveButton` (`components/ui`), `MoneyText`, `Toast` + `Urungkan`, `CatatAlert` (`tone` `warning`/`danger`), kotak `warning-tint`, `ArchiveBlockedCard`, `ModalCard`, `BackLink`. Ikon yang ada dan cukup: `house-line` (properti), `car-simple` (kendaraan), `bank` (deposito), `chart-bar` (reksa dana), `chart-line-up` (saham), `dots-three-circle` (lainnya), `clock`, `warning`, `info`, `check-circle`, `arrows-left-right`, `plus`, `pencil-simple`, `caret-*`, `arrow-counter-clockwise`, `archive`. **Satu ikon baru:** Phosphor `coins` untuk `emas` (tidak ada ikon yang mewakili emas; `hand-coins` sudah berarti utang, `money` berarti tunai).
- **Budget JS (batas 162 kB):** Dompet nyata 153,2, Detail dompet 153,9 (CLAUDE.md S13). Beranda tidak tersentuh.

## Kendala rancangan plan (ditulis terang, usul perbaikan)

1. **Dompet saham tidak boleh ada di sheet Transfer.** Plan Task 9 menulis "sheet Transfer menerima dompet aset sebagai asal/tujuan". Transfer biasa ke/dari dompet saham mengubah saldo buku tanpa trade, jadi saldo ≠ Σ biaya posisi (DQ18 gagal). **Usul:** Transfer menerima aset **non-saham** saja; dompet saham hanya bergerak lewat `buy_stock`/`sell_stock`/`open_stock_holding`. DB juga menolak (Task 2/4: transfer, `space_transfer`, `opening_balance` generik, `reconcile_balance`, `move_entry_to_space` ke/dari dompet `asset_kind = 'saham'` tanpa tautan trade → `DK422`; kode usul `stock_account_trade_only`), bukan hanya UI.
2. **`Cocokkan saldo` dan `Ubah saldo awal` di dompet aset.** Untuk saham keduanya ditolak (alasan sama, butir 1). Untuk aset non-saham `Cocokkan saldo` diganti `Perbarui nilai` (valuasi, `x_valuasi`); `Ubah saldo awal` tetap tetapi berlabel `Ubah nilai awal`. **Usul:** `api.reconcile_balance` menolak pocket `aset` (Task 2 atau 3), supaya penyesuaian aset selalu `valuation`.
3. **Sheet `Tambah aset` untuk jenis `saham` tanpa `Nilai sekarang`.** Plan menulis "jenis, nama, nilai sekarang" untuk semua; saldo awal dompet saham akan menjadi biaya tanpa lembar (DQ18). **Usul:** jenis `saham` = nama sekuritas saja; isi lewat `Beli saham` / `Saham yang sudah dimiliki`. `api.create_account` menolak `p_opening_balance ≠ 0` untuk `saham` (Task 3).
4. **Subtotal kelompok Aset dan nilai baris dompet saham.** `Group` menjumlah saldo di TS; untuk dompet saham saldo buku = biaya perolehan, sedangkan hero memakai nilai pasar. Dua angka berbeda untuk dompet yang sama membingungkan. **Usul:** baris dompet saham menampilkan **nilai pasar dari SQL** (kolom per dompet di `api.asset_overview` atau loader Dompet), dan kelompok Aset **tanpa subtotal** (rincian `Aset` dan `Saham` sudah di hero). Task 3/5 menambah kolom `market_value`, `missing_price_count` per dompet saham.
5. **Total beli di sheet `Beli saham`** (`lembar × harga + biaya`) adalah perkalian di UI. Plan hanya meminta pratinjau server untuk Jual. **Usul (keputusan agen):** pratinjau `Total keluar` dihitung klien dengan `BigInt` dari isian pengguna sendiri, ditandai sebagai perkiraan; angka di toast dan riwayat dari server. Alternatif tanpa matematika UI: `api.preview_buy` (Task 5, kecil).
6. **`stock_overview` perlu kolom tampilan.** Bingkai butuh per holding: `ticker`, `shares`, `avg_cost`, `cost_total`, `close`, `close_on`, `stale`, `held_pending` (+ `held_on`), `market_value`, `unrealized`, `realized`, `last_trade` (id, side, shares, on, apakah bisa dibatalkan); per dompet: Σ `market_value`, Σ `unrealized`, Σ `realized`, `missing_price_count`. Semua dari SQL (aturan 5).
7. **Riwayat dan Transaksi perlu tautan trade.** Label `Beli BBCA` di dompet sumber dan dompet saham butuh `trade_id`/`ticker`/`side` di VM entri (loader riwayat dan Transaksi, Task 10/11). Tanpa itu baris tampil sebagai `Transfer` dan, di dompet trading, `Tarik modal` (fakta kode `modalMoveOf`).
8. **Antar ruang:** `space_transfer` Pribadi → aset Bersama (B16, Task 12) diizinkan. Bingkai **tidak** menawarkan aset Pribadi sebagai sisi Pribadi `space_transfer` (pemilih antar ruang tetap `ordinary`) agar aset tidak "pindah ruang" lewat kas; dompet saham tidak pernah antar ruang. Bila DB mengizinkan aset Pribadi sebagai sisi Pribadi, UI tetap menyaringnya.

## Aturan bersama

Aturan S6 sampai S13 berlaku (ruang tertulis di judul sheet dan toast; status = ikon + teks; target ≥ 44 dan jarak ≥ 8; 320 px tanpa gulir horizontal termasuk `Rp 12.345.678.900`; salinan galat **tanpa nominal**; tanpa tanda seru; tanpa "rumah tangga"). Tambahan S14:

1. **Istilah.** `Kekayaan bersih` (tidak pernah "Net worth"), `Aset`, `Saham`, `Harga`, `Nilai pasar`, `Biaya beli` (biaya perolehan), `Harga rata-rata`, `Untung`/`Rugi`, `lot`/`lembar`. Tidak ada "Portfolio", "portofolio", "P/L", "unrealized", "holding", "ticker" di layar, `aria-label`, `title`, atau toast. Kode saham ditulis apa adanya (`BBCA`), tanpa `.JK`.
2. **Untung/rugi tanpa warna sebagai penanda.** Format: `+Rp 195.000 untung` / `−Rp 120.000 rugi` (minus U+2212, tanpa spasi antara tanda dan `Rp`: `−Rp`), selalu dengan kata. Warna teks netral (`text`/`text-soft`); tidak ada hijau `income` atau merah `danger` untuk untung/rugi, perubahan nilai, atau `30 hari lalu` (untung saham bukan pemasukan; preseden S12 "Hasil ditarik" tanpa hijau). Nilai 0 = kata `Impas`, bukan `Rp 0`. Tidak ada persen untung/rugi di S14 (butuh pembagian di UI; ui-ux:88 dan R7 menolak "▲ 2,1%").
3. **Perubahan nilai aset** ditulis `Naik Rp …` / `Turun Rp …` (kata, netral), di riwayat `+Rp …`/`−Rp …` dengan meta `Perubahan nilai`.
4. **Tanpa "Rp 0" sebagai pencapaian atau isi.** Komponen hero yang bernilai 0 tidak dirender; aset bernilai 0 menampilkan `Belum ada nilai`; dompet saham tanpa saham `Belum ada saham`.
5. **Angka dari SQL.** Kekayaan bersih dan komponennya (`api.net_worth`), nilai pasar, biaya beli, harga rata-rata, untung/rugi (belum dan sudah terealisasi), pratinjau jual (`api.preview_sell`), `stale`, `held_pending`. UI hanya memilih kalimat (perbandingan dengan 0/null boleh) dan memformat. Pengecualian yang diizinkan: konversi tampilan lot ↔ lembar (× / ÷ 100, bukan uang), satu pengurangan pratinjau `Perbarui nilai` (preseden S6-C3/S11), dan perkiraan `Total keluar` Beli (Kendala 5).
6. **Label harga jujur.** Setiap nilai pasar punya tanggal harga di dekatnya (`Harga 14 Nov`); tanpa harga = dinilai sebesar biaya beli dan ditulis begitu. Harga yang ditahan tidak pernah tampil sebagai harga terpakai.
7. **Kode saham, nominal, dan harga tidak pernah di pesan galat DB, log, `job_runs`, alert** (Global Constraints). Teks UI boleh menyusun kode dari data yang sudah dimuat.

## Dompet: kekayaan bersih

### S14-NW1 · Hero `Kekayaan bersih` (angka dari SQL)

Kartu utama yang ada (`heroCard`, `aria-labelledby="kekayaan"`, `SpaceTag`); hanya isinya yang berubah. Data: `api.net_worth(space)` (Task 6): `kas`, `aset`, `saham_pasar`, `saham_tanpa_harga`, `piutang`, `utang`, `total`, `price_as_of`, `month_ago_total`.

- **Baris 1:** `h2` `Kekayaan bersih` 14/600 `text-soft` + `SpaceTag` (tetap).
- **Baris 2:** `MoneyText` `total` `size="amount"` (laptop `display-lg`), `data-testid="net-worth"` tetap. Total minus (utang > semua aset) memakai `−Rp …` netral, tanpa merah.
- **Baris 3 `30 hari lalu`** (hanya bila `month_ago_total` tidak null): 13/500 `text-soft` `30 hari lalu Rp 149.000.000`. Tanpa panah, tanpa persen, tanpa warna, tanpa selisih (selisih = pengurangan UI dan pola "▲" yang ditolak ui-ux R7). Tanpa snapshot (ruang baru, backfill belum jalan): baris tidak ada.
- **Baris 4 rincian** (`dl`, hanya komponen ≠ 0; tidak dirender bila hanya `kas` yang ≠ 0, karena subjudul sudah menjelaskan): urutan **Kas · Aset · Saham · Piutang · Utang**. HP/tablet: satu baris per komponen, `dt` 13/500 `text-soft` kiri, `dd` `MoneyText` 13/700 `num` kanan (`whitespace-nowrap`; label boleh membungkus). Laptop: grid 5 kolom di bawah angka besar (`dt` di atas `dd`). Label: `Kas`, `Aset`, `Saham`, `Piutang`, `Utang`. `Utang` ditampilkan `−Rp …` (dikurangkan), `Piutang` `Rp …`. Hanya Pribadi yang punya Piutang/Utang (K5).
- **Baris 5 label harga** (hanya bila ada saham, `saham_pasar` ≠ 0 atau `saham_tanpa_harga` > 0), 12/500 `text-muted`, ikon `clock` 14: semua berharga → `Harga saham {price_as_of}` (`14 Nov 2026`); ada yang tanpa harga → ikon `info` 14 + `Sebagian saham belum ada harga, jadi dinilai sebesar biaya beli.`
- **Subjudul** (13/500 `text-soft`, menggantikan teks `:131–135`): Pribadi `Kas, aset, saham, dan sisa utang-piutang. Kas Kantor tidak dihitung.`; Bersama `Kas dan aset bersama.` bila ada aset, selain itu `Kas Bersama.` Kalimat pendek dipilih dari keberadaan komponen, bukan dari jumlah.
- **Galat loader `net_worth`:** angka besar diganti `CardError` di dalam hero `Kekayaan bersih belum bisa dimuat.` + `Coba lagi`; daftar dompet tetap tampil (hero tidak boleh menjatuhkan halaman).
- **Bersama:** sama tanpa Piutang/Utang; Bersama solo dan dua anggota identik (tidak ada rincian per anggota).

## Dompet: aset non-saham

### S14-AS1 · Kelompok `Aset` di daftar Dompet

- **Urutan `POCKETS`:** Operasional, Tabungan, Trading, **Aset**, Kantor. Kelompok kosong tidak dirender. Judul `Aset`, tanpa ikon kelompok (pola Operasional/Tabungan).
- **Baris:** `WalletRow` dengan ubin ikon **jenis aset** (`coins` emas, `house-line` properti, `car-simple` kendaraan, `chart-bar` reksa dana, `bank` deposito, `chart-line-up` saham, `dots-three-circle` lainnya), nama (≤ 2 baris), baris tipe diganti label jenis (`Emas`, `Properti`, `Kendaraan`, `Reksa dana`, `Deposito`, `Saham`, `Lainnya`), nilai kanan.
- **Nilai kanan:** aset non-saham = saldo buku; aset bernilai 0 = teks `Belum ada nilai` 13/500 `text-muted` (bukan `Rp 0`). Dompet saham = **nilai pasar dari SQL** (Kendala 4), baris tipe `Saham · nilai pasar`; ada saham tanpa harga → `Saham · sebagian belum ada harga`; tanpa saham → `Belum ada saham`.
- **Tanpa subtotal kelompok** (Kendala 4). Kekayaan bersih tidak lagi dari daftar (NW1).
- **Tombol `Tambah aset`:** di bawah tombol `Tambah dompet` yang ada sebagai tautan teks 44 (ikon `plus`) di HP, dan di header halaman laptop di samping `Tambah dompet` (sekunder). Tidak menambah opsi ke `SegmentedControl` Jenis di sheet Tambah dompet (lima/enam segmen tidak muat di 320; aset punya isian sendiri).
- **Keadaan kosong (belum ada aset):** tidak ada kartu ajakan di daftar (Dompet bukan tempat promosi); tautan `Tambah aset` cukup. Halaman tanpa dompet sama sekali: `EmptyState` lama + tautan `Tambah aset` di bawah aksi primer.

### S14-AS2 · Sheet `Tambah aset · {Ruang}` (pulau malas)

`Sheet` + `SpaceTag`; laptop dialog tengah 520. `clientId` lahir saat sheet dibuka.

1. **`Jenis aset`** (`SelectField`, fokus awal): Emas, Properti, Kendaraan, Reksa dana, Deposito, Saham (**hanya Pribadi**), Lainnya. Petunjuk 12/500 `text-muted`: `Jenis tidak bisa diganti sesudah disimpan.`
2. **`Nama`** (`TextField`, maks 60, petunjuk contoh 13/500 `text-soft` mengikuti jenis: `Misalnya Emas Antam 10 gram.` / `Misalnya Rumah Bekasi.` / `Misalnya Motor Vario.` / `Misalnya Reksa dana pasar uang.` / `Misalnya Deposito BCA 6 bulan.` / saham: `Nama sekuritas, misalnya Ajaib atau Stockbit.` / `Misalnya Koleksi jam.`). Nama bentrok dengan dompet lain: `Dompet atau aset bernama {nama} sudah ada di {Ruang}.`
3. **`Nilai sekarang (opsional)`** (`MoneyInput`, ≥ 0), **tidak tampil untuk Saham** (Kendala 3). Petunjuk: `Isi bila aset ini sudah kamu punya. Bila baru dibeli dari dompet, kosongkan lalu pakai Isi dari dompet sesudah disimpan, supaya saldo dompetnya ikut turun.` Saham: petunjuk pengganti `Saham diisi sesudah ini lewat Beli saham atau Saham yang sudah dimiliki.`
4. **`Sejak`** (`DateInput`, bawaan hari ini, `max` hari ini) hanya bila nilai diisi (= `opened_on` saldo awal).

- **Footer:** `Simpan aset` (primer 48, `Menyimpan…`).
- **Toast:** `Aset {nama} ditambahkan di {Ruang}`. Saham: sheet ditutup lalu langsung ke Detail dompet saham baru (S14-SH1) dengan fokus di `Beli saham`.
- **Bersama:** opsi Saham tidak ada; isian lain sama.

### S14-AS3 · Detail aset (non-saham)

Memakai `dompet-detail.tsx` dengan cabang `pocket = 'aset'`.

- **Kartu saldo:** label `Nilai {nama}` (bukan `Saldo`), `MoneyText` amount; nilai 0 = `Belum ada nilai`. Sub 13/500 `text-soft`: `{Jenis} · diperbarui {tgl valuasi terakhir}` atau, tanpa valuasi, `{Jenis} · nilai sejak {opened_on}`. Tidak ada kata "saldo".
- **Aksi (urut):** `Perbarui nilai` (primer 48, S14-AS4), `Isi dari dompet` (sekunder 44), `Cairkan ke dompet` (sekunder 44, tidak ada bila nilai 0), `Ubah nilai awal` (tautan teks 44, menggantikan `Ubah saldo awal`). **Tidak ada `Cocokkan saldo`** (Kendala 2). Kalimat 12/500 `text-muted` di bawah aksi: `Perubahan nilai tidak dihitung sebagai pemasukan atau pengeluaran.`
- **Riwayat** (pola riwayat dompet): `Nilai awal` (opening), `Isi dari {dompet}` / `Cair ke {dompet}` (transfer; di dompet lawan `Isi {aset}` / `Cair dari {aset}`), `Perubahan nilai` dengan nominal `+Rp …`/`−Rp …` netral dan meta `Naik`/`Turun · {tgl}`. Baris valuasi bisa dibatalkan dari Transaksi (pola void), bukan diubah: `Ubah` generik tidak ada; koreksi = `Perbarui nilai` lagi.
- **Tanpa kartu tujuan** (S13 K3 tetap `tabungan`) dan tanpa kartu Modal.

### S14-AS4 · Sheet `Perbarui nilai {nama} · {Ruang}`

- **Isian:** `Nilai sekarang` (`MoneyInput` ≥ 0, fokus awal, kosong); di atasnya teks 13/500 `text-soft` `Tercatat Rp {saldo} per {tgl}.` dari data yang sudah dimuat. `Tanggal` (`DateInput`, bawaan hari ini, `max` hari ini).
- **Pratinjau** (satu pengurangan, `aria-live="polite"`): `Naik Rp …` / `Turun Rp …` / `Nilainya sama, tidak ada yang dicatat.`
- **Petunjuk** 12/500 `text-muted`: `Pakai harga pasar atau taksiran yang wajar. Perubahan nilai tidak masuk Laporan dan anggaran.`
- **Footer:** `Simpan nilai` (primer 48). Nilai sama → sheet tertutup tanpa toast (server no-op).
- **Toast:** `Nilai {nama} diperbarui` + `Urungkan` (batal entri valuasi).

### S14-AS5 · Isi dan cairkan aset (sheet Transfer yang ada) + S12S13-C7

- `Isi dari dompet` / `Cairkan ke dompet` membuka sheet Transfer (mode `transfer`) dengan prasetel, pola S12-TR4: **Isi:** tujuan = aset ini (terkunci, teks), sumber = pemilih dompet ruang ini bukan Kantor, bukan aset; **Cairkan:** sumber = aset ini (terkunci), tujuan = pemilih yang sama. Judul `Isi {nama} · {Ruang}` / `Cairkan {nama} · {Ruang}`. Kalimat 12/500 `text-muted` di bawah nominal: `Bukan pengeluaran. Laporan dan anggaran tidak berubah.` / `Bukan pemasukan.`
- **Transfer biasa** (dari menu Catat) menampilkan aset **non-saham** di pemilih asal dan tujuan, dengan label opsi `{nama} · Aset`. Dompet saham tidak pernah tampil (Kendala 1). Mode pengeluaran/pemasukan, tagihan, utang, patungan, talangan, `Pindahkan ke ruang lain`, dan dompet bawaan WA tidak pernah menampilkan aset.
- **Aset tidak bisa minus:** bila sumber aset dan nominal > nilainya, peringatan di kolom (bukan kotak `warning` yang bisa dilewati seperti dompet biasa): `Nilai {aset} tidak cukup. Aset tidak bisa minus.` dan tombol simpan `aria-disabled`. Server `asset_negative` → teks sama.
- **S12S13-C7 (pemilih meta terpotong di 320):** pada sheet Transfer berprasetel (Setor modal, Tarik modal, Isi, Cairkan) di bawah 360 px, baris meta dua kolom (±108 px per pemilih) menjadi **satu kolom**: setiap pemilih penuh lebar dengan label tampak 12/600 (`Dari`, `Ke`, `Tanggal`), nama dompet `truncate` + `title`, target 44. Hanya sheet Transfer berprasetel; pemilih Catat lain tidak disentuh (plan Task 9).

### S14-AS6 · Arsip aset ditolak

- **Aset non-saham bernilai ≠ 0:** `ArchiveBlockedCard` varian aset: `{nama} masih bernilai. Perbarui nilainya ke 0 atau cairkan ke dompet, lalu arsipkan.` (tanpa nominal).
- **Dompet saham masih memegang saham** (`account_has_holdings`): varian saham: `{nama} masih memegang saham. Jual semua saham dulu, lalu arsipkan.` Tautan teks 44 `Lihat saham` ke daftar saham di halaman yang sama (anchor).
- **Balapan** (saham dibeli dari tab lain sesudah dialog arsip dibuka): `archiveFailedText` cabang `account_has_holdings` dengan teks varian saham, `confirmDisabled`.

### S14-AS7 · Transaksi, Laporan, Ekspor, Sampah

- **Transaksi:** baris valuasi `Perubahan nilai · {aset}` (ikon jenis aset, nominal `+Rp`/`−Rp` netral). Trade saham: `Beli {kode} · {lembar} lembar` (kaki transfer), `Jual {kode} · {lembar} lembar` (kaki transfer), `Untung jual {kode}` / `Rugi jual {kode}` (kaki valuasi; teks kata, bukan warna). Detail entri trade **tanpa** `Ubah` generik dan tanpa `Batalkan` generik; tautan teks 44 `Buka {dompet saham}` ke Detail dompet saham (batal hanya lewat S14-SH7).
- **Laporan:** kartu `Tidak termasuk` mendapat kelas `x_valuasi`: nama `Perubahan nilai aset · naik` / `· turun`, catatan `Nilai aset dan untung/rugi saham; bukan pemasukan atau pengeluaran.` Σ pemasukan/pengeluaran tidak berubah.
- **Ekspor CSV:** jenis `Perubahan nilai`, kelas `x_valuasi`; kolom Catatan trade `Beli BBCA 200 lembar @ 9.150` / `Jual BBCA 100 lembar @ 9.800` (data milik pengguna sendiri, bukan pesan galat).
- **Sampah:** entri valuasi batal tampil sebagai `Perubahan nilai · {aset}` dengan `Pulihkan` generik; trade batal tampil satu baris per trade `Beli {kode}` / `Jual {kode}` (kedua kaki jual digabung) dengan `Pulihkan` = `restore_stock_trade`. Pulihkan yang bukan trade terakhir lagi → galat `trade_not_latest` di baris.

## Dompet saham (hanya Pribadi)

### S14-SH1 · Detail dompet saham

- **Kartu saldo:** label `Nilai pasar {nama}`, `MoneyText` amount = Σ nilai pasar dari SQL. Sub (13/500 `text-soft`, tiap kalimat satu baris): `Biaya beli Rp …`; `Belum terealisasi +Rp … untung` / `−Rp … rugi` / `Belum terealisasi impas`; bila Σ terealisasi ≠ 0 `Sudah terealisasi +Rp … untung` / `−Rp … rugi`. Label harga 12/500 `text-muted`: semua berharga `Harga {tgl terlama}`; ada tanpa harga `Sebagian saham belum ada harga, dinilai sebesar biaya beli.` Tanpa saham: angka besar diganti `Belum ada saham` 15/600 `text-soft`, tanpa sub.
- **Aksi (urut):** `Beli saham` (primer 48), `Jual saham` (sekunder 44, hanya bila ada saham), `Isi harga` (sekunder 44, hanya bila ada saham), `Saham yang sudah dimiliki` (tautan teks 44). Tidak ada `Cocokkan saldo`, `Ubah saldo awal`, `Isi dari dompet` (Kendala 1–2). Kalimat 12/500 `text-muted`: `Biaya broker masuk ke biaya beli. Untung atau rugi tidak masuk Laporan.`
- **Daftar `Saham`** (`ListCard`, `id` untuk anchor `Lihat saham`): satu baris per kode dengan lembar > 0 (S14-SH2), urutan nilai pasar terbesar (dari SQL). Di bawahnya `details` terlipat `Sudah dijual habis ({n})` untuk kode berlembar 0: kode, `Sudah terealisasi +Rp … untung`/`−Rp … rugi`, tanpa harga.
- **Riwayat dompet:** sama dengan S14-AS7 (label trade), urut tanggal.
- **Keadaan:** memuat (kerangka dua baris), galat `CardError` `Saham belum bisa dimuat.` + `Coba lagi` (kartu saldo dari daftar Dompet tetap), kosong (`EmptyState` ikon `chart-line-up` 26 `Belum ada saham di {nama}.` / `Catat pembelian baru, atau masukkan saham yang sudah kamu punya sebelum memakai DompetKu.` / aksi primer `Beli saham` + tautan `Saham yang sudah dimiliki`).

### S14-SH2 · Baris saham (holding) dan keadaan harga

Baris `details` (≥ 72), ringkasan:

- **Kiri:** kode 15/700 (`BBCA`), di bawahnya 13/500 `text-muted` lembar: `300 lembar · 3 lot` (habis dibagi 100) atau `250 lembar` (odd lot; tanpa pecahan lot).
- **Kanan:** nilai pasar 15/700 `num`; di bawahnya untung/rugi belum terealisasi 13/600 netral (`+Rp 195.000 untung` / `−Rp 60.000 rugi` / `Impas`).
- **Baris meta** (13/500 `text-soft`, membungkus): `Rata-rata Rp 9.150 · Harga Rp 9.800 · 14 Nov` + penanda keadaan.

Isi terbuka: `dl` `Biaya beli`, `Harga rata-rata`, `Harga terakhir` (+ tanggal), `Nilai pasar`, `Belum terealisasi`, `Sudah terealisasi` (bila ≠ 0); aksi flex-wrap 44: `Beli lagi`, `Jual`, `Isi harga` (prasetel kode, nama aksesibel `Jual BBCA`); daftar `Transaksi BBCA` (tanggal, `Beli 2 lot @ Rp 9.150`, `Jual 1 lot @ Rp 9.800`), tombol teks 44 `Batalkan` hanya pada transaksi hidup **terakhir** (S14-SH7); transaksi lain tanpa tombol, dengan satu kalimat 12/500 `text-muted` di bawah daftar `Hanya transaksi terakhir yang bisa dibatalkan.`

| Keadaan                                         | Harga di meta                                         | Penanda (ikon + teks, 13/600)                                                                                                                                    | Nilai pasar                            | Untung/rugi belum terealisasi     |
| ----------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------- |
| Berharga, segar                                 | `Harga Rp 9.800 · 14 Nov`                             | tidak ada                                                                                                                                                        | `lembar × harga` dari SQL              | dari SQL                          |
| **`usang`** (`stale`: > 3 hari bursa)           | `Harga Rp 9.800 · 7 Nov`                              | `clock` + `Harga lama` (`text-soft`); isi terbuka: `Isi harga terbaru.`                                                                                          | sama (harga lama)                      | sama                              |
| **`Belum ada harga`**                           | tidak ada harga                                       | `info` + `Belum ada harga` (`text-soft`)                                                                                                                         | = biaya beli, sub `sebesar biaya beli` | tidak ditampilkan (bukan `Impas`) |
| **`Harga perlu dicek`** (`held_pending`)        | harga `ok` terakhir apa adanya (`Harga Rp … · 7 Nov`) | `warning` + `Harga perlu dicek` (`warning`); isi terbuka: `Harga {held_on} ditahan karena berubah lebih dari 35%. Yang dipakai masih harga {tgl}.` + `Isi harga` | dari harga `ok` terakhir               | dari harga `ok` terakhir          |
| `Harga perlu dicek` tanpa harga `ok` sebelumnya | tidak ada harga                                       | tidak mungkin (harga pertama selalu `ok`, K8)                                                                                                                    | –                                      | –                                 |

Label plan `usang` ditulis di layar sebagai **`Harga lama`** (kata "usang" kaku untuk harga; pertanyaan pemilik 3). Penanda keadaan juga tampil di kartu saldo bila ada ≥ 1 kode dalam keadaan itu: `Ada harga yang perlu dicek.` (`warning`) / `Ada harga lama.` (`clock`).

### S14-SH3 · Sheet `Beli saham · Pribadi`

- **Isian:** `Kode saham` (`TextField`, fokus awal, 4 huruf, otomatis kapital, `autocapitalize="characters"`, `inputmode="text"`, petunjuk `4 huruf, misalnya BBCA.`; dari `Beli lagi` terkunci sebagai teks); `Jumlah` (`SegmentedControl` `Lot | Lembar`, bawaan `Lot`, lalu angka bulat ≥ 1; teks pasti di bawah `= 200 lembar` / `= 2 lot` bila habis dibagi); `Harga per lembar` (`MoneyInput`, > 0); `Biaya broker (opsional)` (`MoneyInput`, petunjuk `Dari konfirmasi broker. Masuk ke biaya beli.`); `Dari dompet` (`SelectField`: dompet Pribadi aktif bukan Kantor, bukan aset; trading lebih dulu bila ada); `Tanggal` (`DateInput`, bawaan hari ini, `max` hari ini).
- **Perkiraan** (`aria-live="polite"`, 15/700): `Total keluar Rp …` + 12/500 `text-muted` `Perkiraan. Angka pasti muncul sesudah disimpan.` (Kendala 5). Saldo dompet sumber tidak cukup: peringatan biasa dompet (`warning-tint`, boleh minus seperti pengeluaran biasa, aturan S6), kecuali sumber trading: peringatan sama.
- **Footer:** `Simpan pembelian` (primer 48).
- **Toast:** `Beli {kode} {n} lot dicatat · Rp … dari {dompet}` (nominal dari server) + tanpa `Urungkan` (batal lewat S14-SH7, karena hanya trade terakhir yang bisa dibatalkan dan aturan itu harus terlihat).
- Kalimat 12/500 `text-muted` di bawah total bila sumber trading: `Pindah dari {dompet trading} ke saham tidak mengubah modal trading.` (K7).

### S14-SH4 · Sheet `Jual saham · Pribadi`

- **Isian:** `Kode saham` (`SelectField` kode berlembar > 0; dari `Jual` baris terkunci) dengan teks 13/500 `text-soft` di bawah `Dimiliki 300 lembar · 3 lot`; `Jumlah` (`Lot | Lembar`, tombol teks 44 `Jual semua` mengisi lembar penuh); `Harga per lembar`; `Biaya broker (opsional)`; `Pajak jual (opsional)` (petunjuk `PPh final dari konfirmasi broker.`); `Ke dompet` (`SelectField`, aturan sama dengan Dari dompet Beli); `Tanggal`.
- **Pratinjau dari server** (`api.preview_sell`, dipanggil sesudah kode, jumlah, dan harga valid; tunda 400 ms sesudah ketikan terakhir; `aria-live="polite"`, `aria-busy` saat menghitung): kotak `surface-2` radius 12, `dl`: `Hasil bersih Rp …` (15/700), `Biaya beli yang keluar Rp …`, lalu `+Rp … untung` / `−Rp … rugi` / `Impas` 15/700 netral. Memuat: `Menghitung…`. Gagal jaringan: `Pratinjau belum bisa dihitung. Angka pasti muncul sesudah disimpan.` (simpan tetap boleh; server yang menentukan). Jumlah > dimiliki: galat kolom `insufficient_shares` (di bawah), pratinjau tidak dipanggil.
- **Footer:** `Simpan penjualan` (primer 48).
- **Toast:** `Jual {kode} {n} lot dicatat · Rp … ke {dompet}` (+ kalimat kedua `+Rp … untung`/`−Rp … rugi` dari server).
- Tidak menyebut "PPh 0,1%" atau tarif lain (K6: tanpa tarif bawaan).

### S14-SH5 · Sheet `Isi harga · Pribadi`

- **Isian:** `Kode saham` (`SelectField` kode berlembar > 0 di **semua** dompet saham Pribadi; dari baris terkunci); `Harga penutupan per lembar` (`MoneyInput`, bulat > 0); `Tanggal harga` (`DateInput`, bawaan hari ini WIB, `max` hari ini). Teks 13/500 `text-soft` dari data dimuat: `Harga terakhir Rp 9.800 · 14 Nov` atau `Belum ada harga.` Petunjuk 12/500 `text-muted`: `Harga berlaku untuk {kode} di semua dompet saham Pribadi.` (harga per ruang, K1).
- **Lonjakan** (server `price_spike_unconfirmed`, plan K8): kotak `warning-tint` + ikon `warning` 16: `Harga ini berubah lebih dari 35% dari harga {tgl}. Periksa lagi angkanya, misalnya bila ada pemecahan saham.` + sakelar kotak centang 44 `Ya, harga ini benar` (mengirim ulang dengan `p_confirm_spike`); tombol simpan tetap, label tidak berubah. Tanpa nominal di teks ini (cukup tanggal pembanding).
- **Footer:** `Simpan harga` (primer 48). **Toast:** `Harga {kode} {tgl} disimpan`.
- Bila K1/Task 8 menyalakan penyedia otomatis: sheet tetap ada (cadangan); teks pembanding menyebut sumber `Harga terakhir Rp … · 14 Nov · otomatis` / `· diisi manual`.

### S14-SH6 · Sheet `Saham yang sudah dimiliki · Pribadi`

- **Untuk:** saham yang dibeli sebelum memakai DompetKu (`open_stock_holding`, tanpa efek kas, pola utang berjalan S11).
- **Isian:** `Kode saham`, `Jumlah` (`Lot | Lembar`, bawaan `Lembar`, karena saldo lama sering odd lot), `Harga rata-rata per lembar` (petunjuk `Lihat di aplikasi broker, biasanya tertulis harga rata-rata atau avg price.`; "avg price" sengaja sebagai kutipan label broker, bukan istilah aplikasi), `Sejak` (`DateInput`, `max` hari ini).
- Kalimat 13/500 `text-soft`: `Tidak mengurangi dompet mana pun. Saham ini langsung masuk kekayaan bersih.`
- Kode yang sudah dimiliki di dompet ini: tetap boleh (posisi ditambah sebagai transaksi `opening`), teks `Menambah ke BBCA yang sudah ada.`
- **Footer:** `Simpan saham` (primer 48). **Toast:** `{kode} {n} lembar ditambahkan ke {dompet}`.

### S14-SH7 · Dialog `Batalkan transaksi saham terakhir?`

- Dari tombol `Batalkan` di transaksi hidup terakhir satu kode. `ConfirmDialog` pola batal Transaksi (`void-dialog-view`), fokus awal `Kembali`.
- **Judul:** `Batalkan transaksi saham terakhir?` **Isi** menurut sisi: beli `Beli {kode} {n} lot pada {tgl} dibatalkan. {dompet sumber} bertambah lagi, lembar dan harga rata-rata kembali seperti sebelumnya.`; jual `Jual {kode} {n} lot pada {tgl} dibatalkan. {dompet tujuan} berkurang lagi, dan untung atau rugi penjualan itu ikut batal.`; saham yang sudah dimiliki `{kode} {n} lembar yang dimasukkan pada {tgl} dihapus dari {dompet}.` Penutup: `Bisa dipulihkan dari Sampah.`
- **Tombol:** `Batalkan transaksi` (destruktif), `Kembali`.
- **Toast:** `Transaksi {kode} dibatalkan` + `Urungkan` (= `restore_stock_trade`).
- **Galat:** `trade_not_latest` (ada transaksi lebih baru dari tab lain): `alert` di dialog `Sudah ada transaksi {kode} yang lebih baru. Muat ulang halaman.`, `confirmDisabled`. `asset_negative` (membatalkan beli membuat aset minus karena ada jual sesudahnya tidak mungkin, tetapi bila terjadi): `Transaksi ini belum bisa dibatalkan. Muat ulang halaman.`

### S14-SH8 · Dompet saham di daftar Dompet dan pemilih lain

- Baris di kelompok Aset (S14-AS1). Tidak muncul di pemilih Catat, Transfer, tagihan, utang, patungan, talangan, WA, `Pindahkan ke ruang lain`.
- Tidak ada dompet saham di Bersama (K2); sheet Tambah aset Bersama tidak menawarkan jenis Saham; markup Bersama tidak memuat kata `saham`.

### S14-SH9 · Modal trading sesudah S14 (K7) + S12S13-C9

- **Riwayat Detail dompet trading:** transfer antara dompet trading dan dompet saham **bukan** `Setor modal`/`Tarik modal`; labelnya `Beli {kode} · {n} lembar` / `Jual {kode} · {n} lembar` (selaras AS7; ruling review Task 11) (dari tautan trade, Kendala 7). `modalMoveOf` mengecualikan lawan ber-`asset_kind = 'saham'`.
- **Kartu `Modal trading` (Dompet):** `shortfall` total baru dari SQL (Σ sisa modal − Σ saldo trading − Σ biaya beli saham). Bila ada dompet saham Pribadi, satu baris tambahan di `dl`: `Saham (biaya beli)` 15/700 dan sub 12/500 `text-muted` `Dihitung dengan biaya beli, bukan nilai pasar, supaya modal tidak ikut naik-turun harga.` Peringatan `Kurang` tetap hanya di total.
- **S12S13-C9:** kartu `Modal` per dompet (Detail dompet trading) tetap **tanpa** `Kurang`; bingkai TR3 di `s12-bingkai.md` diselaraskan oleh Task 10 (satu paragraf catatan, plan Task 10 butir 2; Task 1 tidak menyentuh berkas itu).

## Bersama

### S14-NW2 · Aset di Bersama (K2)

- Aset non-saham boleh di Bersama; semua anggota boleh menambah, memperbarui nilai, mengisi, mencairkan, dan mengarsipkan (pola tujuan S13 K1). Tidak ada kunci "hanya pembuat"; tidak ada `Dibuat {nama}` (dompet Bersama lain juga tidak menampilkannya).
- **Setor dari Pribadi ke aset Bersama** (`space_transfer`, B16): Pribadi → aset Bersama lewat sheet Transfer antar ruang yang ada; kaki masuk `x_setoran_anggota` **ikut Kontribusi S8** penyetor (sama dengan tujuan Bersama, S13-TJ12). Kekayaan bersih Pribadi turun dan Bersama naik sebesar setoran; Σ kedua ruang tetap.
- **Privasi:** aset, saham, harga, dan snapshot Pribadi tidak pernah tampil di Bersama atau ke pasangan; toast dan judul sheet selalu `· Bersama`. Harga saham per ruang, jadi Farida tidak melihat kode yang dipegang Novanda (dan sebaliknya), termasuk di pemilih `Isi harga` (yang memang hanya Pribadi).
- **Bersama tanpa dompet** (S7-B2): hero dengan `Kas Bersama.` dan, bila ada aset, rincian. Bersama tanpa dompet dan tanpa aset: keadaan lama.

## Salinan galat S14 (tanpa nominal, tanpa kode saham dari DB)

| Kode                                     | Tempat                                    | Teks                                                                                          |
| ---------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `asset_negative` (DK422)                 | kolom Nominal (Transfer/Cairkan) / dialog | `Nilai {aset} tidak cukup. Aset tidak bisa minus.`                                            |
| `asset_kind_invalid` (DK400)             | kolom Jenis aset                          | `Pilih jenis aset.`                                                                           |
| `pocket_personal_only` (saham, DK422)    | kolom Jenis aset                          | `Saham hanya bisa dicatat di Pribadi.`                                                        |
| `account_has_holdings` (DK422)           | dialog arsip / `ArchiveBlockedCard`       | `{dompet} masih memegang saham. Jual semua saham dulu, lalu arsipkan.`                        |
| `insufficient_shares` (DK422)            | kolom Jumlah (Jual)                       | `Jumlahnya melebihi saham yang dimiliki.`                                                     |
| `trade_not_latest` (DK409/422)           | dialog Batalkan / baris Sampah            | `Sudah ada transaksi {kode} yang lebih baru. Muat ulang halaman.`                             |
| `price_invalid` (DK400)                  | kolom Harga                               | `Harga harus angka bulat lebih dari nol dan masuk akal.`                                      |
| `price_spike_unconfirmed` (DK422)        | kotak di sheet Isi harga                  | (kotak lonjakan S14-SH5) `Harga ini berubah lebih dari 35% dari harga {tgl}. …`               |
| `ticker_invalid` (DK400)                 | kolom Kode saham                          | `Kode saham terdiri dari 4 huruf, misalnya BBCA.`                                             |
| `holding_not_found` (DK404)              | kotak atas sheet                          | `Saham ini tidak ditemukan. Muat ulang halaman.`                                              |
| `trade_not_found` (DK404)                | dialog Batalkan / baris Sampah            | `Transaksi ini tidak ditemukan. Muat ulang halaman.`                                          |
| `stock_account_trade_only` (usul, DK422) | kotak atas sheet Transfer                 | `Dompet saham hanya berubah lewat Beli atau Jual saham.`                                      |
| `balance_not_zero` (aset)                | dialog arsip                              | `{aset} masih bernilai. Perbarui nilainya ke 0 atau cairkan ke dompet, lalu arsipkan.`        |
| `name_taken`                             | kolom Nama                                | `Dompet atau aset bernama {nama} sudah ada di {Ruang}.`                                       |
| `invalid_argument/shares`                | kolom Jumlah                              | `Isi jumlah bulat, paling sedikit 1.`                                                         |
| `invalid_argument/value`                 | kolom Nilai sekarang                      | `Nilai tidak boleh minus.`                                                                    |
| `invalid_argument/on`                    | kolom Tanggal                             | `Tanggal tidak boleh setelah hari ini.`                                                       |
| jaringan/`unknown`                       | kotak atas sheet                          | `Belum berhasil. Sambungan ke server terputus. Coba lagi.`                                    |
| loader                                   | `CardError`                               | `Kekayaan bersih belum bisa dimuat.` / `Saham belum bisa dimuat.` / `Aset belum bisa dimuat.` |

`{aset}`, `{dompet}`, `{kode}`, `{tgl}` disusun klien dari data yang sudah dimuat; pesan galat DB, log, `job_runs`, dan alert tidak memuat nominal, nama dompet, kode saham, atau harga.

## Salinan final S14 (mengikat Task 9, 10, 11)

| Bingkai  | Teks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NW1      | `Kekayaan bersih`; `30 hari lalu Rp …`; `Kas`; `Aset`; `Saham`; `Piutang`; `Utang`; `Harga saham {tgl}`; `Sebagian saham belum ada harga, jadi dinilai sebesar biaya beli.`; `Kas, aset, saham, dan sisa utang-piutang. Kas Kantor tidak dihitung.`; `Kas dan aset bersama.`; `Kas Bersama.`; `Kekayaan bersih belum bisa dimuat.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| AS1–AS2  | `Aset`; `Emas`; `Properti`; `Kendaraan`; `Reksa dana`; `Deposito`; `Saham`; `Lainnya`; `Belum ada nilai`; `Saham · nilai pasar`; `Saham · sebagian belum ada harga`; `Belum ada saham`; `Tambah aset`; `Tambah aset · {Ruang}`; `Jenis aset`; `Jenis tidak bisa diganti sesudah disimpan.`; `Nama`; contoh nama per jenis; `Nilai sekarang (opsional)`; `Isi bila aset ini sudah kamu punya. …`; `Saham diisi sesudah ini lewat Beli saham atau Saham yang sudah dimiliki.`; `Sejak`; `Simpan aset`; `Aset {nama} ditambahkan di {Ruang}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AS3–AS6  | `Nilai {nama}`; `{Jenis} · diperbarui {tgl}`; `{Jenis} · nilai sejak {tgl}`; `Perbarui nilai`; `Isi dari dompet`; `Cairkan ke dompet`; `Ubah nilai awal`; `Perubahan nilai tidak dihitung sebagai pemasukan atau pengeluaran.`; `Nilai awal`; `Isi dari {dompet}`; `Cair ke {dompet}`; `Perubahan nilai`; `Naik`; `Turun`; `Perbarui nilai {nama} · {Ruang}`; `Tercatat Rp … per {tgl}.`; `Naik Rp …`; `Turun Rp …`; `Nilainya sama, tidak ada yang dicatat.`; `Pakai harga pasar atau taksiran yang wajar. …`; `Simpan nilai`; `Nilai {nama} diperbarui`; `Isi {nama} · {Ruang}`; `Cairkan {nama} · {Ruang}`; `Bukan pengeluaran. Laporan dan anggaran tidak berubah.`; `Bukan pemasukan.`; `{nama} · Aset`; `Dari`; `Ke`; `Tanggal`; `{nama} masih bernilai. …`; `{nama} masih memegang saham. …`; `Lihat saham`                                                                                                                                                                                                                                                                                                                     |
| AS7      | `Perubahan nilai · {aset}`; `Beli {kode} · {n} lembar`; `Jual {kode} · {n} lembar`; `Untung jual {kode}`; `Rugi jual {kode}`; `Buka {dompet}`; `Perubahan nilai aset · naik`/`· turun`; `Nilai aset dan untung/rugi saham; bukan pemasukan atau pengeluaran.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| SH1–SH2  | `Nilai pasar {nama}`; `Biaya beli Rp …`; `Belum terealisasi +Rp … untung`; `−Rp … rugi`; `Belum terealisasi impas`; `Sudah terealisasi …`; `Harga {tgl}`; `Beli saham`; `Jual saham`; `Isi harga`; `Saham yang sudah dimiliki`; `Biaya broker masuk ke biaya beli. Untung atau rugi tidak masuk Laporan.`; `Saham`; `Sudah dijual habis ({n})`; `{n} lembar · {m} lot`; `Rata-rata Rp …`; `Harga Rp … · {tgl}`; `Impas`; `Harga lama`; `Isi harga terbaru.`; `Belum ada harga`; `sebesar biaya beli`; `Harga perlu dicek`; `Harga {tgl} ditahan karena berubah lebih dari 35%. Yang dipakai masih harga {tgl}.`; `Ada harga yang perlu dicek.`; `Ada harga lama.`; `Beli lagi`; `Jual`; `Transaksi {kode}`; `Batalkan`; `Hanya transaksi terakhir yang bisa dibatalkan.`; `Belum ada saham di {nama}.`; `Saham belum bisa dimuat.`                                                                                                                                                                                                                                                                                                     |
| SH3–SH6  | `Beli saham · Pribadi`; `Kode saham`; `4 huruf, misalnya BBCA.`; `Jumlah`; `Lot`; `Lembar`; `= {n} lembar`; `Harga per lembar`; `Biaya broker (opsional)`; `Dari konfirmasi broker. Masuk ke biaya beli.`; `Dari dompet`; `Total keluar Rp …`; `Perkiraan. Angka pasti muncul sesudah disimpan.`; `Pindah dari {dompet} ke saham tidak mengubah modal trading.`; `Simpan pembelian`; `Jual saham · Pribadi`; `Dimiliki {n} lembar · {m} lot`; `Jual semua`; `Pajak jual (opsional)`; `PPh final dari konfirmasi broker.`; `Ke dompet`; `Hasil bersih Rp …`; `Biaya beli yang keluar Rp …`; `Menghitung…`; `Pratinjau belum bisa dihitung. …`; `Simpan penjualan`; `Isi harga · Pribadi`; `Harga penutupan per lembar`; `Tanggal harga`; `Harga terakhir Rp … · {tgl}`; `Belum ada harga.`; `Harga berlaku untuk {kode} di semua dompet saham Pribadi.`; `Ya, harga ini benar`; `Simpan harga`; `Harga {kode} {tgl} disimpan`; `Saham yang sudah dimiliki · Pribadi`; `Harga rata-rata per lembar`; `Tidak mengurangi dompet mana pun. Saham ini langsung masuk kekayaan bersih.`; `Menambah ke {kode} yang sudah ada.`; `Simpan saham` |
| SH7, SH9 | `Batalkan transaksi saham terakhir?`; isi per sisi (SH7); `Bisa dipulihkan dari Sampah.`; `Batalkan transaksi`; `Kembali`; `Transaksi {kode} dibatalkan`; `Urungkan`; `Beli {kode} · {dompet}`; `Jual {kode} · {dompet}`; `Saham (biaya beli)`; `Dihitung dengan biaya beli, bukan nilai pasar, supaya modal tidak ikut naik-turun harga.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Ukuran layar dan tema

- **320:** hero dengan lima komponen dan `Rp 12.345.678.900` di total dan setiap komponen (label kiri membungkus, nominal kanan `whitespace-nowrap`, tanpa gulir horizontal); `30 hari lalu Rp 12.345.678.900` membungkus di spasi; baris saham dengan kode + `12.345.600 lembar · 123.456 lot` + nilai pasar besar (nilai turun ke baris sendiri bila perlu, rata kanan); meta `Rata-rata … · Harga … · {tgl}` membungkus di `·`; sheet Beli/Jual/Isi harga penuh layar dengan footer menempel dan `Lot | Lembar` 44; sheet Transfer berprasetel satu kolom (C7); nama aset 60 huruf ≤ 2 baris.
- **390:** semua keadaan SH2 (segar, harga lama, belum ada harga, perlu dicek), dompet saham kosong dan dengan `Sudah dijual habis`, kotak lonjakan Isi harga, pratinjau jual untung/rugi/impas/memuat/gagal, aset bernilai 0, hero Pribadi dengan utang lebih besar dari aset (total minus), hero Bersama dengan aset.
- **1280:** hero rincian grid 5 kolom; kelompok Aset di grid tiga kolom yang ada; Detail dompet saham dengan daftar saham di kolom yang sama dengan kartu saldo; sheet = dialog tengah 520 (Jual 560 bila pratinjau membuat kolom terlalu sempit, pilihan implementer).
- **Tema:** gelap (bawaan) dan terang. Untung/rugi netral di kedua tema; `warning` hanya untuk `Harga perlu dicek` dan kotak lonjakan (terang `#9A5B00` di `warning-tint`, sudah lulus `contrast.test.ts`); lime tidak pernah teks di terang. Ikon `coins` baru mengikuti warna teks.

## Target sentuh, urutan fokus, nama aksesibel

- Semua kontrol ≥ 44 dengan jarak ≥ 8: `Tambah aset`, aksi Detail aset/saham (44/48), ringkasan `details` baris saham (≥ 72), `Beli lagi`/`Jual`/`Isi harga`/`Batalkan` (44, nama aksesibel memuat kode: `Batalkan transaksi BBCA terakhir`), `Lot | Lembar` (44), `Jual semua` (44), sakelar `Ya, harga ini benar` (44), footer sheet (48).
- **Urutan Dompet:** hero (angka → 30 hari lalu → rincian → label harga) → `Tambah dompet` → `Tambah aset` → kelompok. **Detail dompet saham:** BackLink → kartu saldo → aksi → daftar Saham (per baris: ringkasan → isi) → `Sudah dijual habis` → riwayat → footer arsip. **Sheet Beli:** Kode → Jumlah (satuan → angka) → Harga → Biaya → Dari dompet → Tanggal → perkiraan → Simpan. **Sheet Jual:** Kode → Jumlah → `Jual semua` → Harga → Biaya → Pajak → Ke dompet → Tanggal → pratinjau → Simpan.
- `dl` rincian hero dibaca sebagai pasangan `Kas Rp …`; `Utang` dibaca `Utang minus Rp …` (teks `sr-only` untuk tanda U+2212, karena pembaca layar tidak selalu membacanya).
- Untung/rugi selalu dengan kata; pembaca layar mendengar `ditambah Rp … untung` / `dikurangi Rp … rugi` (teks `sr-only` mengganti tanda).
- Pratinjau Jual dan perkiraan Beli `aria-live="polite"`; penanda keadaan harga = ikon + teks; kotak lonjakan `role="alert"` saat muncul.

## Budget JS dan aturan implementasi

- Ukur dari cabang sebelum menambah: Dompet nyata (153,2), Detail dompet (153,9); Detail dompet saham = rute Detail dompet yang sama. Target: Dompet ≤ 155, Detail dompet ≤ 156. Beranda tidak tersentuh.
- **Server Component:** hero NW1, kelompok Aset, kartu saldo aset/saham, daftar Saham dan `details` (HTML murni), riwayat, `ArchiveBlockedCard` varian, label harga. **Pulau malas:** chunk `aset-client` (sheet Tambah aset, Perbarui nilai), chunk `saham-client` (Beli, Jual dengan pratinjau, Isi harga, Saham yang sudah dimiliki, dialog Batalkan). Sheet Transfer berprasetel memakai pulau Catat yang ada.
- Tidak ada pustaka grafik dan tidak ada grafik net worth (S-50 = M6).
- Ukuran uji layar (Task 12/13): 320, 390, 1280; gelap dan terang; `Rp 12.345.678.900` di hero, komponen, baris aset, nilai pasar, pratinjau; nama 60 huruf; semua keadaan SH2; aset bernilai 0; Bersama solo dan dua anggota; axe tanpa pelanggaran serius.

## Dampak ke task lain

1. **Task 2/3/4 (DB):** penjaga dompet saham hanya lewat trade (Kendala 1, kode usul `stock_account_trade_only`); `reconcile_balance` menolak pocket `aset` (Kendala 2); `create_account` menolak saldo awal untuk `saham` dan menentukan `wallet_type` tetap untuk aset (Kendala 3, fakta `wallet_type`).
2. **Task 3/5 (`asset_overview`, `stock_overview`):** kolom di Kendala 4 dan 6, termasuk `market_value` dan `missing_price_count` per dompet saham untuk baris daftar, tanggal valuasi terakhir per aset (AS3), `held_on` (SH2), dan penanda transaksi terakhir yang bisa dibatalkan (SH7).
3. **Task 5:** opsional `api.preview_buy` bila pemilik menolak perkiraan klien (Kendala 5).
4. **Task 6 (`api.net_worth`):** kolom NW1 apa adanya; `month_ago_total` = snapshot tepat `today − 30` (atau terdekat sebelumnya, maks 3 hari; selain itu null). Usul: tanggal pembanding ikut dikembalikan supaya label bisa jujur bila bukan tepat 30 hari (`Sekitar 30 hari lalu` tidak dipakai; bila tanggal ≠ today − 30, label `{tgl}` saja).
5. **Task 9:** `Group` tanpa subtotal untuk Aset; `account-list-view` tidak lagi menghitung `netWorth` di mode nyata; `modalMoveOf` dan C7 (S14-AS5).
6. **Task 10/11:** VM entri riwayat dan Transaksi membawa `trade` (`ticker`, `side`, `shares`) dan `assetKind` (Kendala 7, S14-AS7, S14-SH9).
7. **Task 13:** Delivery Gate + critique visual dengan daftar periksa di bawah; ikon `coins` disalin ke `components/ui/icons/`.

## Keputusan agen atas nama pemilik (Task 1)

1. **Untung/rugi netral tanpa warna dan tanpa persen** (aturan 2): untung saham bukan pemasukan; persen butuh pembagian di UI dan pola "▲ %" ditolak ui-ux R7.
2. **`30 hari lalu` hanya nominal lampau**, tanpa selisih/panah/warna.
3. **Komponen hero yang 0 tidak dirender**; rincian tidak tampil bila hanya Kas.
4. **Dompet saham tidak di sheet Transfer; aset tidak punya `Cocokkan saldo`; Tambah aset Saham tanpa nilai awal** (Kendala 1–3; butuh penjaga DB di Task 2–4).
5. **Kelompok Aset tanpa subtotal; baris dompet saham memakai nilai pasar dari SQL** (Kendala 4).
6. **`Total keluar` Beli sebagai perkiraan klien** (Kendala 5).
7. **Label `usang` di layar = `Harga lama`.**
8. **Tambah aset terpisah dari Tambah dompet** (tautan sendiri, bukan segmen Jenis baru).
9. **Satu ikon baru `coins`** untuk emas.
10. **Batal trade tanpa `Urungkan` di toast Beli/Jual**; batal lewat dialog SH7 (dengan `Urungkan` di toast batal).
11. **C7 diperbaiki hanya di sheet Transfer berprasetel**; C9 tetap "hanya total"; catatan sinkron di `s12-bingkai.md` = Task 10.

## Pertanyaan untuk pemilik dan penyimpangan

1. **Label tombol aset:** `Isi dari dompet` / `Cairkan ke dompet` (usul) vs `Tambah` / `Tarik` vs `Setor` / `Tarik` (bertabrakan dengan Setor/Tarik modal). Rekomendasi: usul bingkai.
2. **Urutan komponen hero:** Kas · Aset · Saham · Piutang · Utang (plan). Alternatif: Utang tepat di bawah Kas supaya "punya vs berutang" bersebelahan. Rekomendasi: urutan plan.
3. **`usang` → `Harga lama`:** setuju kata ini? Alternatif `Harga belum diperbarui`.
4. **Penyimpangan dari plan Task 9 ("sheet Transfer menerima dompet aset"):** dompet saham dikecualikan, ditambah penjaga DB (Kendala 1). Rekomendasi: setujui; tanpa ini DQ18 bisa dilanggar dari UI.
5. **Penyimpangan dari plan Task 1 ("Tambah aset: jenis, nama, nilai sekarang"):** Saham tanpa nilai sekarang (Kendala 3).
6. **Perkiraan `Total keluar` di sheet Beli** dihitung klien (Kendala 5), atau tambah `api.preview_buy`? Rekomendasi: perkiraan klien (satu perkalian dari isian pengguna sendiri, angka pasti dari server).
7. **Tambah aset dari dompet sekaligus** (beli emas Rp 10 juta dari BCA dalam satu sheet) tidak ada: pengguna menyimpan aset kosong lalu `Isi dari dompet`. Cukup, atau perlu pilihan `Dibeli dari dompet` di sheet (fungsi atomik baru di Task 3)?
8. **K13** (definisi bagian aset T11) tetap butuh konfirmasi isi; bingkai mengikuti K13 apa adanya. **K1** (Yahoo best-effort) keputusan agen; bingkai S14-SH5 sudah menyiapkan teks `otomatis`/`diisi manual`.

## Untuk kursi design reviewer

Daftar periksa Task 9 (Dompet, aset), Task 10 (saham, modal), Task 11 (Transaksi, Laporan, Ekspor, Sampah), dinilai dari screenshot 320/390/1280 terang dan gelap, bukan dari kode saja:

1. **Salinan:** tidak ada "Net worth", "Portfolio"/"portofolio", "P/L", "holding", "ticker", "unrealized", "Goal" di layar, `aria-label`, `title`, toast; tidak ada tanda seru; tidak ada "rumah tangga"; kode tanpa `.JK`; semua teks cocok dengan "Salinan final S14".
2. **Untung/rugi:** selalu tanda + kata (`+Rp … untung`, `−Rp … rugi` dengan U+2212, `Impas`); warna netral di kedua tema; tidak ada hijau `income` atau merah `danger` untuk untung/rugi, perubahan nilai, `30 hari lalu`, atau total minus; tidak ada persen.
3. **Tanpa `Rp 0`:** komponen hero 0 tidak tampil; aset 0 = `Belum ada nilai`; dompet saham kosong = `Belum ada saham`; untung/rugi 0 = `Impas`; `Belum ada harga` tidak menampilkan `Impas`.
4. **Label harga jujur:** setiap nilai pasar punya tanggal harga di dekatnya; `Belum ada harga` menyebut "sebesar biaya beli"; `Harga perlu dicek` menunjukkan harga lama yang dipakai, bukan harga yang ditahan; `Harga lama` muncul untuk harga > 3 hari bursa.
5. **Angka cocok antar layar:** hero `total` = Σ komponen yang tampil (cek dari angka SQL, bukan dihitung UI); `Aset` + `Saham` di hero cocok dengan baris kelompok Aset (nilai pasar untuk saham); nilai pasar di daftar Dompet = kartu saldo Detail dompet saham; Laporan, Aman dipakai, anggaran, Kontribusi tidak berubah sesudah valuasi/beli/jual.
6. **Status = ikon + teks:** `Harga lama` (`clock`), `Belum ada harga` (`info`), `Harga perlu dicek` (`warning`), kotak lonjakan, `Kurang` modal.
7. **320 px:** hero lima komponen dengan `Rp 12.345.678.900` tanpa gulir horizontal dan tanpa nominal terpotong; baris saham dengan lembar besar; sheet Transfer berprasetel satu kolom dengan label tampak (C7 tertutup); nama aset 60 huruf ≤ 2 baris; `Lot | Lembar` terbaca utuh.
8. **Target sentuh ≥ 44, jarak ≥ 8;** urutan fokus sesuai bagian "Target sentuh"; fokus kembali ke pembuka sesudah sheet/dialog; fokus awal dialog Batalkan = `Kembali`; nama aksesibel memuat kode saham bila ada banyak baris.
9. **Ruang tertulis:** judul sheet `· Pribadi`/`· Bersama` + `SpaceTag`; Bersama tidak punya opsi atau kata Saham; tidak ada jejak aset/saham Pribadi di Bersama.
10. **Pemilih:** aset tidak muncul di Catat pengeluaran/pemasukan, tagihan, utang, patungan, talangan, `Pindahkan ke ruang lain`, WA; dompet saham tidak muncul di Transfer; aset non-saham muncul di Transfer dengan label `· Aset`.
11. **Modal trading:** beli/jual saham dari dompet trading tidak memunculkan `Setor modal`/`Tarik modal` di riwayat, tidak memunculkan `Kurang` palsu; baris `Saham (biaya beli)` tampil bila ada dompet saham.
12. **Keadaan:** hero (tanpa snapshot, tanpa saham, sebagian tanpa harga, total minus, galat); Detail aset (nilai 0, tanpa valuasi, dengan valuasi); Detail dompet saham (kosong, satu, banyak, semua keadaan SH2, `Sudah dijual habis`, memuat, galat); sheet Jual (pratinjau untung, rugi, impas, memuat, gagal, jumlah berlebih); Isi harga (lonjakan); arsip ditolak (aset bernilai, saham berlembar); Bersama solo dan dua anggota.
13. **Hirarki:** satu angka besar per layar (kekayaan bersih di Dompet; nilai di Detail aset/saham); rincian hero lebih kecil dari angka utama; kartu tanpa bayangan; Beranda tidak berubah (tidak ada kartu kekayaan atau aset).
14. **Transaksi/Laporan/Sampah:** `Perubahan nilai · {aset}`, `Beli/Jual {kode}`, `Untung/Rugi jual {kode}` tanpa `Ubah` generik; Laporan `Tidak termasuk` memuat `Perubahan nilai aset`; Sampah memulihkan trade lewat jalurnya dan menampilkan `trade_not_latest` di baris.

## Hasil Delivery Gate

Task 13 (2026-11-20): daftar periksa butir 1–14 dinilai dari 246 screenshot (41 layar x 320/390/1280 x gelap/terang), rincian dan bukti di `docs/design/s14-critique.md`. Blocker 0, Penting 2, Minor 13; diperbaiki 3 (S14-C1 label harga baris dompet saham terpotong, S14-C2 Biaya broker setengah lebar di Beli, S14-C3 `Saham berjalan` → `Sudah dimiliki`), ditunda 12. Terbuka untuk keputusan: S14-C4 (`Rp 0` di kepala hari Transaksi, daftar bersama prototipe). Penyimpangan dari bingkai yang dicatat, bukan diubah: urutan perkiraan/pratinjau di sheet Beli/Jual (S14-C9) dan satu penanda harga di kartu saldo (S14-C7).
