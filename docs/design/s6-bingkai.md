# Bingkai utang desain S6 (Catat, Detail, Sampah, Beranda, Kategori)

Gerbang awal S6 (IPD §0 butir 3, §4 S6; DBD §9 baris 3 dan 8). Bingkai ini ditulis agen mengikuti pola Panel Malam (`DESIGN.md`, `docs/design/panel-malam/README.md`, token `apps/web/src/styles/tokens.css`) dan ditinjau kursi design reviewer (bagian "Catatan review"). Pemilik menilai di pratinjau. ID `S6-*` dirujuk Task 12 sampai 18 rencana S6, dan setiap bingkai ditambahkan ke galeri `/dev/ui` oleh task yang membangunnya.

Di luar berkas ini (keputusan pemilik 2026-11-01, rencana S6 bagian "Keputusan"): transfer lintas ruang di Catat dan "Pindahkan ke ruang lain" dibingkai dan dibangun di S7; di mode nyata S6 menu jenis Catat hanya menawarkan transfer dalam satu ruang dan tombol Pindahkan tidak dirender.

## Aturan bersama semua bingkai

- **Ruang selalu tertulis:** judul sheet ("Pengeluaran · Pribadi ▾"), `SpaceTag`, toast, dan dialog menyebut ruang. Warna ruang (`pribadi*` / `bersama*`) lewat `data-ruang` pada subtree, tidak pernah satu-satunya penanda.
- **Status = ikon + teks.** Peringatan memakai ikon `warning` fill + teks `warning`; galat memakai ikon `warning-circle` fill + teks `danger`; sukses memakai `check-circle` fill.
- **Target ≥ 44×44, jarak ≥ 8.** Fokus 2 px `focus` offset 2; fokus tidak tertutup tab bar atau toast (toast HP 92 px dari bawah).
- **Tidak ada aksi yang hanya muncul saat hover.** Semua aksi baris terlihat atau ada di layar berikutnya.
- **320 px tanpa gulir horizontal,** termasuk nominal `Rp 12.345.678.900` (gaya `display-long`/`amount-sm`, `nowrap`).
- **Kerangka per lebar:** HP 320 sampai 599 (sheet bawah radius atas 24); tablet 600 sampai 1023 (dialog tengah maks 520, padding 24, radius 20; isi halaman maks 720); laptop ≥ 1024 (sidebar 248, isi maks 1000, dialog tengah).
- **Pesan galat dan log tidak memuat deskripsi;** nominal hanya di UI pengguna sendiri, tidak pernah di log atau event.

## Catat

Rujukan handoff: C1 (mode keyboard), C2 (sheet terisi), C3 (pindah ruang), C4 (Kategori lain…), C5 (toast), L2 dan X1 (dialog tablet/laptop), G3/G4/G10 (terang). Semua bingkai Catat memakai sheet yang sama; hanya bagian yang berubah yang ditulis.

### S6-C1 · Menyimpan…

- **Tujuan:** memberi tahu bahwa simpan sedang berjalan tanpa memindahkan fokus, dan mencegah kirim ganda.
- **Tata letak:** sama dengan C2. Tombol Simpan tetap di tempat dan selebar biasa; isinya ikon `circle-notch` (statis bila `prefers-reduced-motion`) + teks `Menyimpan…`. Kolom lain tetap terlihat, nonaktif (`aria-disabled`, tidak `disabled`, agar fokus tidak hilang). 320 px: teks tidak terpotong karena tombol `flex:1`.
- **Komponen:** `Button` primer keadaan nonaktif (`surface-2`, `text-muted`, `hairline`), chip, `MetaSelect`.
- **Token:** `surface-2`, `text-muted`, `hairline`.
- **Salinan:** `Menyimpan…`.
- **ARIA:** tombol `aria-busy="true"` dan `aria-disabled="true"`; region `role="status"` (sudah terpasang di sheet) mengumumkan `Menyimpan…` sekali.
- **Fokus:** tetap di tombol Simpan. Esc dan Tutup ditahan sampai jawaban server datang (menutup di tengah simpan menghasilkan toast tanpa sheet; dihindari).

### S6-C2 · Galat simpan

- **Tujuan:** sheet tetap terbuka dengan isian utuh; "Coba lagi" memakai `clientId` yang sama sehingga tidak mencatat dua kali.
- **Tata letak:** kotak pesan sebaris di atas baris kaki (di bawah baris meta): `danger-tint`, radius 12, padding 12, ikon `warning-circle` fill `danger` 18 + teks 14/600 `danger` dua baris paling banyak di 390 (tiga di 320). Tombol kaki: `Coba lagi` primer menggantikan `Simpan`. Mode keyboard (C1): kotak pesan satu baris dengan ellipsis dan teks lengkap di `aria-describedby`; tinggi sheet tetap ≤ 356.
- **Komponen:** kotak pesan `state.tsx` gaya galat, `Button` primer.
- **Token:** `danger`, `danger-tint`, `accent`/`on-accent` (tombol).
- **Salinan:** `Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan mencatat dua kali.` + `Coba lagi`.
- **ARIA:** kotak pesan `role="alert"`; tombol `Coba lagi` `aria-describedby` = id kotak pesan.
- **Fokus:** pindah ke `Coba lagi`.

### S6-C3 · Saldo tidak cukup

- **Tujuan:** peringatan inline (bukan dialog) bahwa saldo dompet akan negatif; simpan tetap boleh dengan `p_allow_negative => true`.
- **Tata letak:** baris peringatan tepat di bawah pemilih dompet (di atas kaki): ikon `warning` fill 16 + teks 13/600 `warning`, tanpa kotak (agar tinggi mode keyboard tetap muat). Tombol Simpan berganti label `Tetap simpan` (lebar tetap `flex:1`). Muncul sesudah server menolak `DK422 saldo_negatif` atau sesudah klien menghitung dari saldo dompet yang dimuat; hilang bila nominal atau dompet diubah sampai cukup.
- **Komponen:** baris status (pola `Hint` di `catat-sheet.tsx`), `Button` primer.
- **Token:** `warning` (gelap `#F0B44C` di `surface` 9,0:1; terang `#945700` di `surface` 5,8:1).
- **Salinan:** `Saldo {dompet} tinggal {Rp}. Kalau disimpan, saldonya jadi {−Rp}.` + `Tetap simpan`.
- **ARIA:** baris peringatan `role="status"` (sopan, bukan alert, karena bukan galat); `Tetap simpan` `aria-describedby` = id baris.
- **Fokus:** tidak dipindah bila peringatan muncul saat mengetik; bila muncul sesudah menekan Simpan, fokus tetap di tombol yang sekarang bertuliskan `Tetap simpan`.

### S6-C4 · Kunci idempotensi bentrok (`DK410`)

- **Tujuan:** `clientId` yang sama pernah terkirim dengan isi berbeda (misalnya isian diubah sesudah galat jaringan). Sheet tetap terbuka; pengguna memilih menyimpan sebagai catatan baru (`clientId` baru).
- **Tata letak:** kotak pesan seperti S6-C2 tetapi warna `warning` (`warning-tint`, ikon `warning` fill). Tombol kaki: `Simpan sebagai catatan baru` primer (menggantikan Simpan). 320 px: label tombol dua baris tidak boleh; label muat (26 karakter, 14/800 di lebar ±200 px).
- **Komponen:** kotak pesan, `Button` primer.
- **Token:** `warning`, `warning-tint`.
- **Salinan:** `Catatan ini sudah pernah terkirim dengan isi berbeda. Periksa riwayat Transaksi, lalu simpan sebagai catatan baru bila memang belum ada.` + `Simpan sebagai catatan baru` (dikoreksi reviewer, lihat temuan R4).
- **ARIA:** kotak `role="alert"`.
- **Fokus:** ke `Simpan sebagai catatan baru`.

### S6-C5 · `before_opening` dan `account_archived`

- **Tujuan:** galat yang terikat ke satu kolom ditampilkan di bawah kolom itu, dan fokus pindah ke kolom itu.
- **Tata letak:** pola galat inline W2: kolom terkait mendapat border 2 px `danger`; di bawahnya ikon `warning-circle` fill 16 + teks 13/600 `danger`. `before_opening` menempel pada Select Tanggal; pilihan tanggal sebelum `opened_on` dihapus dari daftar tanggal sesudah galat (dan sejak awal bila tanggal buka dompet sudah diketahui klien). `account_archived` menempel pada Select Dompet; dompet terarsip hilang dari daftar.
- **Komponen:** `MetaSelect`, `FieldLabel`, pola galat `text-field.tsx`.
- **Token:** `danger`.
- **Salinan:** `before_opening`: `{dompet} baru dicatat sejak {tanggal}. Pilih tanggal {tanggal} atau sesudahnya.` (dikoreksi reviewer, R5). `account_archived`: `{dompet} sudah diarsipkan. Pilih dompet lain.`
- **ARIA:** kolom `aria-invalid="true"` + `aria-describedby` ke teks galat; teks galat tidak memakai `role="alert"` (fokus yang pindah sudah mengumumkannya).
- **Fokus:** pindah ke Select terkait.

### S6-C6 · Ruang tanpa dompet

- **Tujuan:** Catat dibuka di ruang yang belum punya dompet operasional (ruang baru, atau Bersama sebelum dompet dibuat).
- **Tata letak:** baris judul tetap (jenis · ruang, Tutup). Isi sheet diganti keadaan kosong: ubin 48 `accent-tint` ikon `wallet`, teks 15/600 `text`, tombol primer `Tambah dompet` lebar penuh. Nominal, chip, dan kaki tidak dirender. Tablet/laptop: dialog tengah dengan isi yang sama, tinggi menyesuaikan.
- **Komponen:** `Sheet`, `State` kosong, `Button` primer.
- **Token:** `accent-tint`, `accent-text` (ikon), `text`.
- **Salinan:** `Belum ada dompet di {Ruang}. Tambah dompet dulu untuk mencatat.` + `Tambah dompet`.
- **ARIA:** judul sheet tetap `Dialog.Title`; teks kosong sebagai `Dialog.Description`.
- **Fokus:** awal di `Tambah dompet`. Tombol menutup Catat lalu membuka sheet Tambah dompet (W2) di ruang yang sama; fokus kembali ke pemicu Catat bila Tambah dompet ditutup.

## Detail transaksi

Rujukan handoff: D1 (detail), D2 (AlertDialog Batalkan), D3, D4 (toast dibatalkan).

### S6-D1 · Sheet Ubah

- **Tujuan:** mengubah pemasukan/pengeluaran dengan bentuk yang sama dengan Catat (ganti penuh, `p_expected_version` dari versi yang dibaca).
- **Tata letak:** sheet Catat (C2/L2) dengan judul `Ubah transaksi` + `SpaceTag` ruang (jenis tidak bisa diganti: tombol jenis diganti teks statis `Pengeluaran · Pribadi`). Nominal, kategori (kategori entri tampil terpilih dan selalu ada di chip pertama walau tidak masuk 6 saran), dompet, tanggal, keterangan terisi nilai sekarang. Kaki: `Simpan perubahan` primer; tanpa "Pindah ke Bersama". Saldo awal (≤ 7 hari): hanya nominal yang bisa diubah, kolom lain tampil sebagai teks.
- **Komponen:** `CatatSheet` (mode ubah), `SpaceTag`.
- **Token:** sama dengan Catat.
- **Salinan:** judul `Ubah transaksi`; tombol `Simpan perubahan`; toast `Perubahan tersimpan di {Ruang}`.
- **ARIA:** `Dialog.Title` = `Ubah transaksi`.
- **Fokus:** awal di nominal; sesudah simpan kembali ke tombol Ubah di Detail.

### S6-D2 · Konflik versi (`DK409`)

- **Tujuan:** entri sudah diubah orang lain (atau tab lain). Tidak pernah menimpa diam-diam.
- **Tata letak:** di dalam sheet Ubah, di atas kaki: kotak `warning-tint` radius 12 padding 12, ikon `warning` fill, teks 14/600 `text`; di bawahnya daftar ringkas nilai terbaru (baris 44: Nominal, Kategori, Dompet, Tanggal; label `text-muted` 13, nilai `text` 14/700). Tombol kaki: `Muat ulang` primer dan `Timpa dengan perubahan saya` sekunder, ditumpuk vertikal di < 360 px dan berdampingan mulai 360.
- **Komponen:** kotak pesan, `ListCard` mini, `Button` primer + sekunder.
- **Token:** `warning`, `warning-tint`, `text`, `text-muted`.
- **Salinan:** `{Nama} mengubah transaksi ini {waktu relatif} ({Rp lama} → {Rp baru}). Muat versi terbaru untuk melanjutkan.` + `Muat ulang` + `Timpa dengan perubahan saya`. Bila nominal sama: bagian dalam kurung dihilangkan.
- **ARIA:** kotak `role="alert"`; daftar nilai `<dl>`.
- **Fokus:** ke `Muat ulang`. `Muat ulang` mengisi sheet dengan nilai terbaru (isian pengguna hilang); `Timpa` mengirim isian pengguna dengan versi terbaru.

### S6-D3 · Transaksi dibatalkan (D5 AFD)

- **Tujuan:** URL entri yang sudah dibatalkan tetap terbuka (bukan 404) dan menawarkan pemulihan.
- **Tata letak:** Detail D1 dengan banner di atas kartu atas: `surface` border 1 px `border`, radius 16, padding 12 16, ikon `arrow-counter-clockwise` 18 `text-soft` + teks 15/600 `text` + tombol sekunder `Pulihkan` 44 di kanan (di bawah teks pada < 360). Nominal di kartu atas dicoret (`line-through`, `text-muted`). Tombol Ubah dan Batalkan tidak dirender. Lewat 90 hari: tombol diganti teks S6-S1 lewat.
- **Komponen:** `BackLink`, banner (pola `ListCard`), `Button` sekunder, `MoneyText` varian dicoret.
- **Token:** `border`, `text`, `text-soft`, `text-muted`.
- **Salinan:** `Transaksi ini sudah dibatalkan.` + `Pulihkan`; toast `Dipulihkan di {Ruang} · {Rp}` (+ `Urungkan` tidak ada).
- **ARIA:** nominal dicoret membawa teks pembaca layar `dibatalkan` (`sr-only`), bukan hanya `<del>`; banner `role="status"` tidak dipakai (konten statis halaman).
- **Fokus:** urutan baca: kembali, banner, Pulihkan, kartu. Sesudah Pulihkan: halaman memuat ulang ke D1 hidup, fokus ke judul.

## Sampah

### S6-S1 · Daftar Sampah

- **Tujuan:** entri batal ≤ 90 hari terakhir (`api.trash_list`) bisa dipulihkan; tempat: butir `Sampah` di Menu (kedua mode) dan tautan `Sampah` di bawah daftar Transaksi (keputusan pemilik 2026-11-01), tanpa tab baru. Rute `/{ruang}/sampah`.
- **Tata letak HP 390:** header halaman (kembali `‹ Transaksi`, H1 `Sampah · {Ruang}`), paragraf 13/500 `text-muted` tentang 90 hari, lalu kartu `surface` radius 16 padding 0 14 berisi baris. Baris (≥ 62, **bukan tautan**, lihat R1): ubin ikon 40 + keterangan 15/600 (ellipsis) + meta 13/500 `text-muted` `Kategori · Dompet · Dibatalkan {hari}` + baris kedua meta `Terhapus permanen {tanggal}` (ikon `clock`), nominal 15/700 di kanan, dan tombol sekunder `Pulihkan` 44 di kanan bawah. **320:** nominal dan `Pulihkan` turun ke baris sendiri (nominal kiri, tombol kanan). **Tablet:** isi maks 720. **Laptop:** isi maks 1000, satu kolom (daftar pendek).
- **Kosong:** ubin `surface-2` ikon `trash` 28 + teks. **Memuat:** skeleton tiga baris + `Memuat Sampah…` `role="status"`. **Gagal muat:** pola B5 dengan ikon `cloud-slash`, `Sampah belum bisa dimuat. Periksa koneksi lalu coba lagi.` + `Coba lagi`. **`restore_window_closed`** (jam server lewat 90 hari saat ditekan): baris menampilkan teks lewat di tempat tombol, ikon `warning` + `warning`.
- **Komponen:** `PageHeader`, `ListCard`, baris Sampah (baru, turunan `TxRow` tanpa `<a>`), `Button` sekunder, `State`.
- **Token:** `surface`, `surface-2`, `text`, `text-muted`, `warning`.
- **Salinan:** kosong `Sampah kosong. Transaksi yang dibatalkan bisa dipulihkan di sini selama 90 hari.`; lewat `Lewat 90 hari, transaksi ini tidak bisa dipulihkan lagi.`; toast `Dipulihkan di {Ruang} · {Rp}`; tombol `Pulihkan`; label tombol pembaca layar `Pulihkan {keterangan} {Rp}`.
- **ARIA:** daftar `<ul>`; tombol `Pulihkan` `aria-label` lengkap; sesudah pulih baris hilang dan toast `role="status"`.
- **Fokus:** sesudah pulih, fokus ke tombol `Pulihkan` baris berikutnya, atau ke judul halaman bila daftar kosong.

## Beranda

### S6-B1 · Tidak ada pengeluaran hari ini

- **Tujuan:** menandai hari ini sebagai tercatat tanpa pengeluaran (`api.mark_no_spend_day`, tanggal = `app.today()` WIB server).
- **Tata letak:** tombol sekunder lebar penuh, tinggi 44, ikon `check` bold 18, tepat di bawah kartu utama (AmanCard). Tampil hanya bila hari ini belum ada pengeluaran hidup di ruang ini dan hari belum ditandai; hanya `expense` yang dihitung (pemasukan, transfer, saldo awal, cocokkan saldo tidak). Bila ada pengeluaran hari ini, tombol maupun baris status tidak tampil walau hari sudah ditandai (ruling review akhir S6). Sesudah ditekan: tombol diganti baris status (tinggi 44, ikon `check-circle` fill `accent-text` 18 + teks 14/600 `text-soft`). Laptop: di kolom kiri di bawah AmanCard. Mode prototipe: tidak tampil di data demo (handoff).
- **Komponen:** `Button` sekunder, baris status.
- **Token:** `border`, `text`, `accent-text`, `text-soft`.
- **Salinan:** `Tidak ada pengeluaran hari ini`; sesudah: `Hari ini tercatat tanpa pengeluaran.`
- **ARIA:** baris sesudah `role="status"`; tombol `aria-busy` selama memanggil server.
- **Fokus:** sesudah ditekan fokus pindah ke baris status (`tabindex="-1"`), agar tidak jatuh ke `<body>`.

## Menu → Kategori

### S6-K1 · Daftar kategori

- **Tujuan:** mengubah dan mengarsipkan kategori awal ruang (keputusan pemilik 2026-11-01) dan menambah kategori. Rute `/{ruang}/kategori`, dibuka dari butir `Kategori` di Menu (tidak lagi "Segera").
- **Tata letak HP:** header halaman (kembali `‹ Menu` menutup ke halaman sebelumnya, H1 `Kategori · {Ruang}`), `SegmentedControl` `Pengeluaran | Pemasukan` (tablist, 44), tombol sekunder `Tambah kategori` (ikon `plus`), lalu `ListCard` berisi baris 52: ubin ikon 36 + nama 15/600; anak menjorok 24 di bawah induknya dengan garis kiri `hairline`. Baris adalah tombol yang membuka sheet ubah (bukan aksi hover). Kategori terarsip tidak tampil di daftar (S6 tidak membuat layar pulihkan arsip). **Tablet/laptop:** isi maks 720, sheet = dialog tengah.
- **Sheet tambah/ubah:** judul `Tambah kategori · {Ruang}` / `Ubah kategori · {Ruang}`; kolom Nama (maks 40), pilihan ikon (grid ubin 44, radio), Select `Induk` (opsional, hanya kategori akar jenis yang sama; tidak tersedia bila kategori punya anak), tombol `Simpan kategori`. Mode ubah: tombol teks bahaya `Arsipkan kategori` di bawah (membuka S6-K2). Galat nama ganda: inline di kolom Nama.
- **Komponen:** `PageHeader`, `SegmentedControl`, `ListCard`, `Sheet`, `TextField`, `Select`.
- **Token:** `surface`, `surface-2`, `hairline`, `danger` (aksi arsip).
- **Salinan:** `Tambah kategori`; `Simpan kategori`; `Arsipkan kategori`; galat nama `Nama ini sudah dipakai kategori lain di {Ruang}.`; galat kedalaman `Kategori hanya bisa dua tingkat.`; kosong (semua diarsipkan) `Belum ada kategori pengeluaran di {Ruang}.` + `Tambah kategori`.
- **ARIA:** daftar `<ul>`, anak dalam `<ul>` bersarang; pilihan ikon `radiogroup` dengan `aria-label` nama ikon.
- **Fokus:** sesudah simpan kembali ke baris yang diubah (atau baris baru).

### S6-K2 · Dialog arsip kategori

- **Tujuan:** menyebut akibat arsip sebelum terjadi.
- **Tata letak:** `ConfirmDialog` (D2): ubin ikon `archive` + judul 19/800 + deskripsi; tombol `Arsipkan` (bahaya) dan `Kembali` (sekunder). Fokus awal di `Kembali`.
- **Salinan:** judul `Arsipkan {nama}?`; deskripsi `{nama} tidak ditawarkan lagi di Catat {Ruang}. Transaksi lama tetap memakai kategori ini.` Bila punya anak aktif: tambah `{n} subkategori ikut diarsipkan.`; toast `{nama} diarsipkan di {Ruang}`.
- **ARIA:** `AlertDialog` (Radix) dengan `Title` + `Description`.
- **Fokus:** sesudah arsip kembali ke daftar, fokus ke judul halaman.

## Salinan final (mengikat Task 12 sampai 18)

| Bingkai                | Teks                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S6-C1                  | `Menyimpan…`                                                                                                                                                               |
| S6-C2                  | `Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan mencatat dua kali.` + `Coba lagi`                                                                   |
| S6-C3                  | `Saldo {dompet} tinggal {Rp}. Kalau disimpan, saldonya jadi {−Rp}.` + `Tetap simpan`                                                                                       |
| S6-C4                  | `Catatan ini sudah pernah terkirim dengan isi berbeda. Periksa riwayat Transaksi, lalu simpan sebagai catatan baru bila memang belum ada.` + `Simpan sebagai catatan baru` |
| S6-C5 before_opening   | `{dompet} baru dicatat sejak {tanggal}. Pilih tanggal {tanggal} atau sesudahnya.`                                                                                          |
| S6-C5 account_archived | `{dompet} sudah diarsipkan. Pilih dompet lain.`                                                                                                                            |
| S6-C6                  | `Belum ada dompet di {Ruang}. Tambah dompet dulu untuk mencatat.` + `Tambah dompet`                                                                                        |
| S6-D1                  | judul `Ubah transaksi`, tombol `Simpan perubahan`, toast `Perubahan tersimpan di {Ruang}`                                                                                  |
| S6-D2                  | `{Nama} mengubah transaksi ini {waktu relatif} ({Rp lama} → {Rp baru}). Muat versi terbaru untuk melanjutkan.` + `Muat ulang` + `Timpa dengan perubahan saya`              |
| S6-D3                  | `Transaksi ini sudah dibatalkan.` + `Pulihkan`                                                                                                                             |
| S6-S1 kosong           | `Sampah kosong. Transaksi yang dibatalkan bisa dipulihkan di sini selama 90 hari.`                                                                                         |
| S6-S1 lewat            | `Lewat 90 hari, transaksi ini tidak bisa dipulihkan lagi.`                                                                                                                 |
| S6-S1 gagal muat       | `Sampah belum bisa dimuat. Periksa koneksi lalu coba lagi.` + `Coba lagi`                                                                                                  |
| S6-B1                  | `Tidak ada pengeluaran hari ini`; sesudah `Hari ini tercatat tanpa pengeluaran.`                                                                                           |
| S6-K1                  | `Tambah kategori`, `Simpan kategori`, `Arsipkan kategori`, `Nama ini sudah dipakai kategori lain di {Ruang}.`, `Kategori hanya bisa dua tingkat.`                          |
| S6-K2                  | `Arsipkan {nama}?` + `{nama} tidak ditawarkan lagi di Catat {Ruang}. Transaksi lama tetap memakai kategori ini.` (+ `{n} subkategori ikut diarsipkan.`)                    |
| Toast pulihkan         | `Dipulihkan di {Ruang} · {Rp}`                                                                                                                                             |

Salinan tetap dari rencana S6 (Global Constraints) tidak diulang di sini dan tidak diubah.

## Tambahan salinan (keputusan controller)

Diputuskan controller atas nama pemilik (2026-11-01, review Task 12) untuk kode galat simpan Catat yang tidak punya bingkai sendiri; `network` tetap memakai salinan S6-C2.

| Kode                              | Tampilan                                                                                    | Teks                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `category_archived`               | galat kolom gaya S6-C5 di bawah chip kategori; chip terpilih dilepas, fokus ke chip pertama | `{kategori} sudah diarsipkan. Pilih kategori lain.`                               |
| `not_found`                       | kotak `role="alert"` gaya S6-C2, tanpa `Coba lagi` (Simpan nonaktif)                        | `Data ini sudah tidak ada. Tutup lalu buka Catat lagi.`                           |
| `unknown`, `invalid`, `conflict`  | kotak `role="alert"` gaya S6-C2 + `Coba lagi` (clientId sama)                               | `Belum tersimpan. Ada kendala di server. Coba lagi tidak akan mencatat dua kali.` |
| Urungkan gagal (toast `Urungkan`) | toast pemberitahuan `role="status"`                                                         | `Belum bisa diurungkan. Buka transaksi itu untuk membatalkannya.`                 |

### Tambahan salinan Task 18 (Dompet nyata dan Kategori)

Keputusan agen atas nama pemilik untuk keadaan yang tidak punya bingkai sendiri; salinan S6-K1/K2 dan S6-C6 di atas tidak diubah.

| Keadaan                        | Teks                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dompet nyata kosong            | `Belum ada dompet di {Ruang}.` + `Tambah dompet` (sama dengan prototipe)                                                                                                              |
| Dompet gagal muat              | `Dompet belum bisa dimuat.` / `Periksa koneksi lalu coba lagi.` + `Coba lagi`                                                                                                         |
| Riwayat dompet gagal muat      | `Riwayat dompet belum bisa dimuat.` / `Periksa koneksi lalu coba lagi.` + `Coba lagi`                                                                                                 |
| Kategori gagal muat            | `Kategori belum bisa dimuat.` / `Periksa koneksi lalu coba lagi.` + `Coba lagi`                                                                                                       |
| Nama dompet terlalu panjang    | `Nama dompet maksimal 40 karakter.`                                                                                                                                                   |
| Nama kategori kosong / panjang | `Nama kategori wajib diisi.` / `Nama kategori maksimal 40 karakter.`                                                                                                                  |
| Induk tak tersedia             | `Punya subkategori, jadi tidak bisa dijadikan subkategori.` (petunjuk di bawah Select Induk)                                                                                          |
| Galat simpan kategori/dompet   | gaya S6-C2: `Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan menyimpan dua kali.` (kategori) / `…menambah dua kali.` (dompet); server: `Ada kendala di server.` |
| Kategori sudah tidak ada       | `Kategori ini sudah tidak ada atau sudah diarsipkan. Tutup lalu muat ulang halaman.`                                                                                                  |
| Toast simpan kategori          | `Kategori {nama} disimpan di {Ruang}`                                                                                                                                                 |
| Arsip kategori gagal           | `Belum bisa diarsipkan. Periksa koneksi lalu coba lagi.` / `Kategori ini sudah tidak ada.` / `Belum bisa diarsipkan. Ada kendala di server.`                                          |

### Tambahan salinan gelombang perbaikan S6 (2026-11-03)

Keputusan controller atas nama pemilik (fix-wave A1, A4); gaya mengikuti galat Batalkan (`Belum bisa dibatalkan. …`).

| Keadaan                                               | Tampilan                                      | Teks                                                             |
| ----------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| Urungkan sesudah Batalkan gagal (Detail)              | toast pemberitahuan `role="status"`           | `Belum bisa diurungkan. Buka transaksi itu untuk memulihkannya.` |
| Pulihkan gagal, `network`                             | pesan `role="alert"` di bawah tombol Pulihkan | `Belum bisa dipulihkan. Periksa koneksi lalu coba lagi.`         |
| Pulihkan gagal, `account_archived`                    | sama                                          | `Belum bisa dipulihkan. Dompetnya sudah diarsipkan.`             |
| Pulihkan gagal, `idem_mismatch`, `not_found`, lainnya | sama                                          | `Belum bisa dipulihkan. Ada kendala di server.`                  |

Perilaku terkait: Simpan perubahan tanpa perubahan menutup sheet Ubah tanpa toast; `Timpa dengan perubahan saya` nonaktif (`aria-disabled`) selama draf tidak valid; `restore_window_closed` memindahkan fokus ke teks lewat 90 hari.

## Keputusan penutup S6 (Task 20, 2026-11-03)

Keputusan agen atas nama pemilik selama implementasi; bingkai di atas tetap berlaku kecuali disebut di sini.

- **Nama dompet maksimal 40 karakter** (DB mengizinkan 60), seragam dengan kategori. Keunikan nama dompet hanya dicek di klien; indeks unik di DB menyusul di S7.
- **Kode galat baru:** `name_taken` (hanya dari indeks `categories_name_unique`, salinan S6-K1) dan `category_depth` (`Kategori hanya bisa dua tingkat.`). Salinan `idem_mismatch` dipakai juga tambah dompet dan tambah kategori.
- **`MoneyText` mengecilkan nominal lebih dari 13 karakter di semua layar** (gaya `amount-sm`), bukan hanya Dompet; mencegah gulir horizontal di 320 px untuk `Rp 12.345.678.900`.
- **`/{ruang}/kategori` menandai tab Transaksi** (sama dengan Sampah: kategori mengklasifikasi transaksi, Menu dibuka dari shell); dikunci di `hrefs.test.ts`.
- **S6-C6 "Tambah dompet"** pada mode nyata menavigasi ke `/{ruang}/dompet?tambah=1`, yang membuka sheet Tambah dompet (bukan sheet di dalam sheet; menjaga budget Catat).
- **Enter pada chip kategori Catat hanya memilih.** Jalur keyboard: Tab ke Simpan, lalu Enter (sama dengan `a11y.spec.ts`).
- **Riwayat per dompet** memakai `accountEntries` (maksimum 1000 baris, `?tampil=` memuat lebih); ringkasan menghitung semua baris.
- **Seed demo masih ikut JS mode nyata** (tidak dipasang, tidak dirender). Pemangkasan ditunda karena butuh mengubah tes prototipe lama; headroom beranda mode nyata 1,2 kB.
- **Enter pada tombol Catat = 1 ketukan**; hanya pintasan `c` yang tidak dihitung. `catat_batal` tidak terkirim saat tab ditutup atau dimuat ulang.
- **Tombol Tanpa pengeluaran** muncul bila hari ini belum ada pemasukan, pengeluaran, atau transfer (saldo awal dan cocokkan saldo tidak dihitung); status per ruang. "Undang Farida" hanya di Pribadi.
- **Peringatan saldo kurang** muncul sesudah server menolak (`saldo_negatif`), tetap inline.
- **Salinan baru yang disetujui atas nama pemilik:** `Belum bisa pindah ke {Ruang}. Periksa koneksi lalu coba lagi.`; `Belum bisa ditandai. Periksa koneksi lalu coba lagi.`; `Saldo operasional sudah minus.`; urungkan gagal (Catat) `Belum bisa diurungkan. Buka transaksi itu untuk membatalkannya.`; urungkan batal gagal (Detail) `Belum bisa diurungkan. Buka transaksi itu untuk memulihkannya.` (terpasang di gelombang perbaikan); toast pulihkan `Dipulihkan di {Ruang} · {Rp}`; lencana "Data demo" disembunyikan di mode nyata.

## Design critique dan Delivery Gate (Task 20)

Skill `antislop` tidak terpasang di sesi ini. Gerbang dijalankan sebagai daftar periksa tertulis atas DESIGN.md (Panel Malam) dan bingkai ini, memakai `/dev/ui` dan rute prototipe pada build lokal (port 3100; pratinjau Vercel tidak bisa dibuka dari sandbox), terang dan gelap, 320/390/1280. Hasil lengkap: `.superpowers/sdd/2026-11-01-dompetku-v2-s6-catat/task-20-report.md`.

| Pemeriksaan                                                                               | Hasil                                                                                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Kontras token (skrip rumus WCAG atas `tokens.css`, 27 pasangan x 2 tema)                  | 0 pasangan di bawah ambang (teks 4,5:1; batas dan fokus 3:1)                                                        |
| Gulir horizontal 320/390/1280, terang dan gelap, enam bagian S6 di `/dev/ui`              | tidak ada                                                                                                           |
| Target sentuh < 44 px pada tombol dan tautan bagian S6                                    | tidak ada                                                                                                           |
| Kontrol tanpa nama aksesibel                                                              | tidak ada                                                                                                           |
| Warna mentah, bayangan kartu, `dangerouslySetInnerHTML` pada 118 berkas UI yang diubah S6 | hanya `themeColor` pra-ada, bayangan token `float`/`rail` untuk lapisan mengambang, dan skrip tema bernonce pra-ada |
| axe serious/critical                                                                      | 0 (`pnpm e2e` 280 lulus, `e2e:ledger` 18 lulus)                                                                     |

Temuan kecil yang ditunda (tidak memblokir): pesan galat S6-C2 mode keyboard terpotong ellipsis (pembaca layar tetap membaca lengkap lewat `role="alert"`); nama dompet panjang di daftar Dompet memakai empat baris saat nominal 12 digit; keterangan baris riwayat dompet terpotong di 390 saat nominal panjang.

## Catatan review

Kursi design reviewer (pass terpisah dari penulisan, 2026-11-01), diperiksa terhadap `docs/design/panel-malam/README.md`, `DESIGN.md`, DBD §3 sampai §7, dan antislop (ui, human, copywriting, layoutmobile). Setiap temuan sudah diterapkan di bingkai di atas.

| #   | Temuan                                                                                                                                                                                                               | Perbaikan                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | S6-S1 draf memakai `TxRow` (`<a>` ke Detail) dengan tombol `Pulihkan` di dalamnya: elemen interaktif bersarang, dua target fokus dalam satu baris tautan.                                                            | Baris Sampah bukan tautan; hanya tombol `Pulihkan` yang interaktif, dengan `aria-label` lengkap. Detail entri batal tetap bisa dibuka dari URL (S6-D3).                                                                                   |
| R2  | S6-S1 di 320 px: ubin 40 + teks + nominal + tombol 44 dalam satu baris menyisakan < 100 px untuk keterangan, nominal panjang terdorong keluar.                                                                       | Di < 360 nominal dan `Pulihkan` turun ke baris kedua. Diuji dengan `Rp 12.345.678.900`.                                                                                                                                                   |
| R3  | Toast pulihkan usulan `Dipulihkan · {Rp}` tidak menyebut ruang (aturan global handoff: toast dan dialog selalu menyebut ruang).                                                                                      | Menjadi `Dipulihkan di {Ruang} · {Rp}`. Hal yang sama diterapkan pada toast Ubah dan arsip kategori.                                                                                                                                      |
| R4  | S6-C4 usulan `Catatan ini pernah terkirim dengan isi lain.` tidak memberi tahu apa yang harus dicek; pengguna bisa mencatat dua kali tanpa sadar.                                                                    | Ditambah langkah periksa: `…Periksa riwayat Transaksi, lalu simpan sebagai catatan baru bila memang belum ada.` Warna `warning` (bukan `danger`) karena tidak ada yang hilang.                                                            |
| R5  | S6-C5 usulan `Pilih tanggal mulai {tanggal}.` ambigu (terbaca seperti menyuruh memilih tanggal mulai dompet).                                                                                                        | Menjadi `Pilih tanggal {tanggal} atau sesudahnya.`; pilihan tanggal sebelum tanggal buka disembunyikan.                                                                                                                                   |
| R6  | S6-B1 draf rencana menulis "hanya bila hari ini belum ada entri"; handoff Beranda menulis "belum ada pengeluaran hari ini". Pemasukan hari ini tidak berarti ada pengeluaran.                                        | Bingkai mengikuti handoff: tombol tampil bila belum ada **pengeluaran** hidup hari ini di ruang ini dan hari belum ditandai. Task 10 (`todayStatus`) menghitung entri `kind = 'expense'` saja.                                            |
| R7  | S6-K1 draf menaruh aksi arsip sebagai ikon di baris (pola yang biasanya muncul saat hover di laptop) dan membuat dua target 44 berdampingan di baris 52 pada 320 px.                                                 | Baris = satu tombol yang membuka sheet ubah; arsip ada di sheet sebagai aksi teks bahaya dengan dialog konfirmasi (S6-K2). Tidak ada aksi hover.                                                                                          |
| R8  | S6-C1 menonaktifkan tombol dengan atribut `disabled` membuat fokus jatuh ke `<body>` dan pembaca layar kehilangan posisi.                                                                                            | Pakai `aria-disabled` + `aria-busy` dan abaikan klik; Esc ditahan selama menyimpan.                                                                                                                                                       |
| R9  | S6-D3 hanya mencoret nominal: status "dibatalkan" tersampaikan lewat gaya saja (status harus ikon + teks).                                                                                                           | Banner bertekstualkan `Transaksi ini sudah dibatalkan.` dengan ikon, plus `sr-only` `dibatalkan` pada nominal.                                                                                                                            |
| R10 | S6-C3 kotak peringatan berlatar menambah ±56 px dan mendorong mode keyboard Catat di 360×640 melewati batas 356 px.                                                                                                  | Peringatan berupa satu baris ikon + teks tanpa kotak (±20 px). Kontras `warning` di `surface`: gelap 9,0:1, terang 5,8:1 (≥ 4,5).                                                                                                         |
| R11 | Ikon kategori awal: nilai `icon` di seed demo (`Motorcycle`, `ShoppingBag`, `Heartbeat`, …) tidak sama dengan peta ikon handoff (`car-simple`, `bag`, `first-aid-kit`), dan peta UI sekarang berkunci nama kategori. | Kolom `icon` disimpan apa adanya dari seed (Task 2). Task 18 (Kategori) menambah peta `icon` → glyph dengan cadangan peta nama lalu `tag`, sehingga kategori awal tetap memakai ikon handoff dan kategori baru memakai ikon yang dipilih. |

Diperiksa dan tidak bermasalah: ruang tertulis di semua judul sheet, halaman, toast, dan dialog; semua status punya ikon + teks; semua target ≥ 44 dengan jarak ≥ 8; tidak ada warna mentah (hanya token); kartu tanpa bayangan; tidak ada placeholder "Segera" baru (Beranda nyata menyembunyikan seksi yang belum ada, keputusan pemilik 5).
