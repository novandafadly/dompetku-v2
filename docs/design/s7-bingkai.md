# Bingkai desain S7 (transfer antar ruang, talangan, Pindahkan, rekonsiliasi dompet, Bersama solo/kosong)

Gerbang awal S7 (IPD §0 butir 3, §4 S7; DBD §9). Bingkai ini ditulis agen mengikuti pola Panel Malam (`DESIGN.md`, `docs/design/panel-malam/README.md`, token `apps/web/src/styles/tokens.css`) dan format `docs/design/s6-bingkai.md`. Alur: AFD §4, §7, §8, §9; aturan data: BSD §2.2, §8.1. ID `S7-*` dirujuk Task 10 sampai 14 rencana S7; setiap bingkai ditambahkan ke galeri `/dev/ui` oleh task yang membangunnya. Bingkai ini tekstual (layar baru belum ada, jadi tidak ada screenshot); kursi design reviewer dijalankan controller sesudah berkas ini diserahkan, dan self-review agen ada di bagian "Self-review".

Semua bingkai memakai ulang komponen yang sudah ada (`CatatSheet`, `MetaSelect`, `Chip`/`ChipGroup`, `Sheet`, `ConfirmDialog`, `ListCard`, `TxRow` + prop `status`, `WalletRow`, `DetailRow`, `State`/`EmptyLine`, `FieldErrorText`, `Button`, `IconButton`, `SpaceTag`, `MoneyText`/`MoneyInput`, pola toast `Urungkan`). Tidak ada pola, token, atau ikon-keluarga baru. Sudah ada di `components/ui/icons`: `briefcase`, `clock`, `arrows-left-right`, `check-circle`, `info`, `archive`, `wallet`, `warning`, `warning-circle`. **Belum ada (disalin per berkas oleh task UI pemakainya, Phosphor):** `plus-circle` dan `minus-circle` (Task 12, S7-W1; bila ditolak pakai `plus`/`check` + teks), `user-plus` (Task 13, S7-B1; cadangan `users-three`).

## Aturan bersama semua bingkai

Aturan bersama S6 berlaku tanpa perubahan (ruang selalu tertulis; status = ikon + teks; target ≥ 44 dan jarak ≥ 8; tidak ada aksi hover; 320 px tanpa gulir horizontal termasuk `Rp 12.345.678.900`; kerangka HP/tablet/laptop; pesan galat dan log tanpa deskripsi). Tambahan S7:

- **Salinan galat tanpa nominal.** Nominal hanya muncul di UI yang pengguna lihat sendiri sebagai data (pratinjau, toast, daftar), tidak pernah di pesan galat.
- **Batas privasi Pribadi/Bersama.** Di mana pun kaki Bersama dari transfer antar ruang tampil (Beranda, Transaksi, Detail, Sampah, toast, payload RSC), tidak ada nama dompet Pribadi, keterangan Pribadi, atau id kaki Pribadi. Satu-satunya jalur teks bebas ke Bersama adalah field `Catatan untuk Bersama` (`shared_note`, 1 sampai 200 karakter, diisi eksplisit).
- **Ruang pada transfer antar ruang ditulis dua kali:** `Pribadi → Bersama` dengan dua `SpaceTag` berwarna ruang masing-masing (panah dan teks, bukan warna saja).
- **Aksi yang tidak diizinkan tidak dirender,** diganti satu baris keterangan (ikon `info` 14 + teks 13/500 `text-muted`) yang menyebut alasannya. Tombol `aria-disabled` hanya dipakai bila alasannya bergantung isian yang bisa diperbaiki pengguna.
- **Dompet Kantor** hanya ada di Pribadi dan tidak pernah ikut transfer antar ruang atau "Pindahkan".
- **Mode prototipe** (`isPrototype()`) tidak berubah; layar S7 mode nyata dan demo memakai markup yang sama, dengan sumber data berbeda.

## Catat

Semua bingkai Catat memakai sheet yang sama; hanya bagian yang berubah yang ditulis.

### S7-C1 · Transfer ke dompet di ruang lain

- **Tujuan:** menyetor dari Pribadi ke Bersama, atau mengambil dari Bersama ke dompet Pribadi sendiri, dari menu jenis Transfer yang sudah ada, tanpa jenis baru di menu.
- **Tata letak (bagian yang berubah):**
  - **Kelompok `Ke dompet`** tetap `ChipGroup` dompet tujuan satu ruang (`DestinationChips`). Chip terakhir ditambahkan: `Ruang lain…` (varian sama dengan chip `Kategori lain…`, ikon `arrows-left-right` 16). Menekannya membuka halaman dalam sheet (pola `setPage('kategori')` yang ada), bukan sheet baru.
  - **Halaman `Ke dompet di {Ruang tujuan}`:** `BackLink`-gaya baris judul (`‹ Transfer`), daftar dompet operasional dan tabungan ruang tujuan sebagai baris 52 (ubin ikon dompet 36 + nama 15/600 + jenis 13/500 `text-muted`; **tanpa saldo**, supaya Bersama tidak tampil di layar Pribadi lewat angka dan sebaliknya). Dompet `kantor` dan terarsip tidak ditawarkan. Dari Pribadi, ruang tujuan = Bersama (semua dompet Bersama). Dari Bersama, ruang tujuan = Pribadi (hanya dompet milik pengguna). Memilih satu dompet menutup halaman dan kembali ke sheet utama.
  - **Sesudah memilih:** chip terpilih bertuliskan `{Dompet} · {Ruang tujuan}` (maks satu baris, ellipsis, `title` penuh) menggantikan deretan chip satu ruang yang dilepas pilihannya; chip `Ruang lain…` tetap ada sebagai cara mengganti. Judul sheet menjadi `Transfer · Pribadi → Bersama` (dua `SpaceTag`).
  - **Pemilih `Dari dompet`** hanya menawarkan dompet non-Kantor selama tujuan di ruang lain. Bila sumber saat ini dompet Kantor: chip `Ruang lain…` tidak dirender, diganti baris keterangan di bawah deretan chip `Dompet Kantor tidak bisa ikut transfer antar ruang.`.
  - **Field `Catatan untuk Bersama`:** muncul hanya bila tujuan atau sumber Bersama, di bawah baris meta, diawali tombol ikon `Tambah keterangan` yang sudah ada diperluas menjadi dua kolom teks bila dibuka: `Keterangan` (label berubah menjadi `Keterangan (hanya di Pribadi)`) dan `Catatan untuk Bersama` (placeholder `Terlihat oleh {Nama anggota lain} di Bersama`; bila Bersama hanya berisi satu anggota `Terlihat oleh anggota Bersama`; maks 200, penghitung muncul dari 160). Keterangan selalu hanya tersimpan di kaki Pribadi, ke arah mana pun; catatan hanya di kaki Bersama dan hanya bila diisi.
  - **Nominal, biaya transfer, tanggal:** sama dengan transfer satu ruang. Tidak ada kolom kategori.
- **Komponen:** `CatatSheet`, `DestinationChips` (+chip `Ruang lain…`), halaman dalam sheet (turunan halaman kategori), `SpaceTag`, `TextField`.
- **Token:** `pribadi*`/`bersama*` lewat `data-ruang` pada `SpaceTag`; `text-muted`, `hairline`, `accent`/`on-accent` (tombol).
- **Keadaan:** (a) tujuan belum dipilih: kaki Simpan `aria-disabled` + petunjuk `Pilih dompet tujuan untuk menyimpan` (sudah ada). (b) Tujuan di ruang lain dipilih: tombol `Simpan`. (c) Saldo sumber tidak cukup: salinan S6-C3 apa adanya. (d) Galat server: kotak S6-C2/C4 atau galat kolom S6-C5; kode S7 pada tabel galat di bawah. (e) Ruang tujuan tanpa dompet (Bersama belum punya dompet; Pribadi tanpa dompet operasional): halaman dalam sheet menampilkan `State` kosong `Belum ada dompet di {Ruang tujuan}.` + `Tambah dompet` (navigasi seperti S6-C6, menutup Catat). (f) Pindah ruang sumber lewat judul sheet sesudah memilih tujuan: pilihan tujuan dan catatan direset.
- **Salinan:** `Ruang lain…`; judul halaman `Ke dompet di {Ruang tujuan}`; `Dompet Kantor tidak bisa ikut transfer antar ruang.`; label `Keterangan (hanya di Pribadi)`; label `Catatan untuk Bersama`; placeholder `Terlihat oleh {Nama anggota lain} di Bersama` (solo: `Terlihat oleh anggota Bersama`); toast `Tersimpan di {Ruang} · {Rp} ke {Ruang tujuan}` + `Urungkan` (urungkan membatalkan kedua kaki; gagal: `Belum bisa diurungkan. Buka transaksi itu untuk membatalkannya.`).
- **ARIA:** `Ruang lain…` tombol dengan `aria-label` `Pilih dompet di ruang lain`; halaman dalam sheet `role="group"` berjudul; baris dompet `role="radio"` dalam `radiogroup` berlabel `Dompet di {Ruang tujuan}`; chip terpilih membawa nama ruang di teksnya (bukan hanya warna); textarea catatan `aria-describedby` ke penghitung.
- **Fokus:** buka halaman dalam: ke dompet pertama (atau yang terpilih); kembali ke sheet utama: ke chip `Ruang lain…`/chip terpilih; Esc di halaman dalam kembali ke sheet utama (bukan menutup sheet). Fokus awal sheet tetap di nominal.
- **Jumlah ketukan:** transfer antar ruang tidak masuk target 3 ketukan; jalur pengeluaran tercepat tidak berubah.

### S7-C2 · Talangan kantor

- **Tujuan:** menandai pengeluaran Pribadi yang akan diganti kantor, sehingga tidak masuk hitungan pengeluaran pribadi (BSD §8.1 `x_talangan`).
- **Tata letak:** tombol ikon 44×44 `briefcase` (`<button role="switch" aria-checked>`, bukan Radix Switch) di baris meta setelah `Tambah keterangan`, tanpa baris baru; hanya saat jenis = Pengeluaran, ruang = Pribadi, dan dompet terpilih bukan Kantor (sudah `x_kantor`). Mati: ikon `text-soft` di ubin `surface-2`; aktif: ikon `accent-text` di ubin `accent-tint` + garis 1 px `accent-text` (tanda aktif juga lewat `aria-checked` dan petunjuk, bukan warna saja). `aria-label` `Talangan kantor`. Saat aktif, satu baris petunjuk (ikon `info` 14 + `Tidak masuk hitungan pribadi. Tercatat di Menunggu reimburse.` 13/600 `text-soft`, satu baris ellipsis dengan teks lengkap di `aria-describedby`) memakai slot petunjuk yang sama dengan `Pilih kategori untuk menyimpan` (keduanya tidak tampil bersamaan: petunjuk kategori didahulukan sampai kategori dipilih); tidak ada baris tambahan. Default mati; reset saat pindah ruang atau jenis. Jalur tercepat tidak menyentuhnya.
- **Anggaran piksel mode keyboard 360×640 (batas sheet 356):** baris meta tetap satu baris 44. Lebar isi 360 − 32 = 328; dua tombol ikon 44 + tiga jarak 8 = 112, sisa 216, jadi dua `MetaSelect` ±104 (ikon 18 + nilai ellipsis; tanggal disingkat `Hari ini`/`12 Nov`). Tinggi tidak bertambah dari S6 (judul, nominal `compact`, ≥ 4 chip, meta 44, slot petunjuk, Simpan), sehingga ≤ 356 tetap; Simpan, ≥ 4 chip, dan pemilih dompet tetap terlihat. Task 10 membuktikan dengan tes ukuran 360×640 dan 320×568 (tanpa gulir horizontal); bila `MetaSelect` < 88 px, nilai dompet tampil sebagai ikon + ellipsis.
- **Mode ubah (S6-D1):** toggle ikut tampil dengan nilai sekarang. Bila talangan sudah punya reimburse hidup: toggle `aria-disabled` dengan petunjuk `Sudah ada reimburse. Batalkan reimburse itu dulu untuk mengubah ini.` (kode `reimbursement_exists`).
- **Komponen:** `CatatSheet`, `IconButton` (varian toggle), baris petunjuk (pola `Hint` di `catat-sheet.tsx`).
- **Token:** `text`, `text-soft`, `accent` (switch aktif), `border`.
- **Salinan:** `Talangan kantor`; `Tidak masuk hitungan pribadi. Tercatat di Menunggu reimburse.` (mode keyboard: versi pendek utuh `Tidak masuk hitungan pribadi.`, teks lengkap di `aria-describedby`); toast tambahan `Tersimpan di Pribadi · {Rp} dari {dompet} · Talangan kantor`.
- **ARIA:** `button role="switch"` `aria-checked`, `aria-describedby` = id petunjuk.
- **Fokus:** tetap di tombol sesudah diketuk; tidak memindahkan fokus ke tempat lain.

## Detail transaksi

Rujukan: bingkai S6-D1 sampai D3 dan `EntryDetailView` (rincian `dl`, banner, aksi di bawah). Nama jenis tampil lewat `KIND_NAME`; S7 menambah `reimbursement: 'Reimburse'` dan memakai `space_transfer: 'Antar ruang'` yang sudah ada.

### S7-D1 · Detail kaki transfer antar ruang

- **Tujuan:** kedua sisi dibaca sebagai satu peristiwa tanpa membocorkan sisi Pribadi ke Bersama.
- **Tata letak, kaki Pribadi** (pencatat, ruang Pribadi): judul H1 `Setor ke Bersama` (kaki keluar) atau `Ambil dari Bersama` (kaki masuk); jenis `Antar ruang`; nominal gaya transfer (bukan pemasukan/pengeluaran). Rincian: Kategori `Antar ruang`, Dompet `{dompet Pribadi}`, Tanggal, Ruang `Pribadi → Bersama` (dua `SpaceTag`), Dicatat oleh, Keterangan (bila ada). Baris Biaya bila ada.
- **Tata letak, kaki Bersama** (dilihat siapa pun anggota): H1 `Setoran dari {Nama}` (kaki masuk) atau `Diambil oleh {Nama}` (kaki keluar); jenis `Antar ruang`. Rincian: Kategori `Antar ruang`, Dompet `{dompet Bersama}` (hanya dompet milik Bersama; **tidak ada** dompet counter, nama dompet Pribadi, atau keterangan), Tanggal, Ruang `Bersama`, Dicatat oleh `{Nama}`, Catatan = `shared_note` bila diisi. Nama diri sendiri ditulis sebagai nama (bukan `kamu`) di judul agar sama untuk kedua anggota.
- **Aksi:** hanya pencatat melihat `Batalkan` (sekunder bahaya, pola Detail S6 yang ada) di kedua kaki. Tidak ada tombol Ubah. Di bawah Batalkan, baris keterangan: `Transfer tidak bisa diubah. Batalkan, lalu catat lagi.` Bukan pencatat (kaki Bersama): tanpa Batalkan; baris keterangan `Hanya {Nama} yang bisa membatalkan transfer ini.` (kode `not_creator` bila tetap tertembus).
- **Dialog Batalkan:** `ConfirmDialog` (fokus awal `Kembali`): judul `Batalkan transfer antar ruang?`; deskripsi `Kedua sisinya dibatalkan bersamaan, di Pribadi dan Bersama. Saldo kedua dompet kembali. Bisa dipulihkan dari Sampah selama 90 hari.`; tombol `Batalkan transfer` (bahaya) dan `Kembali`. Toast `Dibatalkan di Pribadi dan Bersama · {Rp}` + `Urungkan`.
- **Sampah:** kaki transfer antar ruang yang dibatalkan muncul di Sampah kedua ruang (S6-S1) dengan label sama seperti Detail. Tombol `Pulihkan` hanya untuk pencatat (memulihkan kedua kaki); bukan pencatat: tombol diganti baris `Hanya {Nama} yang bisa memulihkan.`. Pulihkan: toast `Dipulihkan di Pribadi dan Bersama · {Rp}`.
- **Daftar (TxRow):** kaki Pribadi label `Setor ke Bersama`/`Ambil dari Bersama`, meta `Antar ruang · {dompet} · {hari}`; kaki Bersama label `Setoran dari {Nama}`/`Diambil oleh {Nama}`, meta `Antar ruang · {dompet Bersama} · {hari}` (dompet Bersama saja, tidak pernah dompet Pribadi; sama di Detail, Beranda Terbaru, dan feed Aktivitas).
- **Komponen:** `EntryDetailView`, `ConfirmDialog`, `SpaceTag`, baris keterangan.
- **Token:** `text`, `text-muted`, `danger` (tombol Batalkan).
- **ARIA:** panah `→` bukan satu-satunya penanda: `SpaceTag` membawa teks ruang, dan baris Ruang punya teks `dari Pribadi ke Bersama` sebagai `sr-only`.
- **Fokus:** sesudah Batalkan fokus ke judul halaman; urutan baca: kembali, kartu atas, rincian, aksi.

### S7-D2 · Pindahkan ke ruang lain

- **Tujuan:** memindahkan satu pengeluaran atau pemasukan ke ruang lain (`api.move_entry`, dibatalkan di ruang asal dan dibuat ulang di ruang tujuan dalam satu transaksi).
- **Tata letak, pemicu:** tombol sekunder `Pindahkan ke {Ruang tujuan}` (ikon `arrows-left-right`) di bawah Ubah dan Batalkan. Hanya dirender untuk **pencatat entri** (bukan pencatat: tidak dirender; `not_creator` dari server dipetakan juga untuk Pindahkan dengan salinan tabel galat), pengeluaran/pemasukan hidup, bukan talangan, bukan dari/ke dompet Kantor, bukan transfer, saldo awal, cocokkan saldo, atau reimburse (`kind_not_movable`).
- **Sheet `Pindahkan ke {Ruang tujuan}`** (HP sheet bawah; tablet/laptop dialog tengah): baris ringkasan entri (keterangan, nominal, `Dari {Ruang asal}`) read-only; `Dompet di {Ruang tujuan}` (`MetaSelect`, wajib; sumber kosong awalnya bila nama dompet tidak ada padanan; Kantor tidak ditawarkan); `Kategori di {Ruang tujuan}` (`CategoryChips` ruang tujuan, wajib; terpilih otomatis bila ada kategori bernama sama di ruang tujuan, kalau tidak kosong); tanggal ikut entri. Kaki: `Lanjut` primer (`aria-disabled` + petunjuk `Pilih dompet dan kategori untuk melanjutkan` sampai keduanya terisi) dan `Batal`.
- **Dialog konfirmasi akibat** (`ConfirmDialog`, sesudah `Lanjut`; fokus awal `Kembali`): judul `Pindahkan ke {Ruang tujuan}?`; daftar akibat (`ul`, ikon `info` per butir): `Transaksi ini dibatalkan di {Ruang asal} dan dibuat ulang di {Ruang tujuan}.` / `Saldo {dompet asal} dan {dompet tujuan} ikut berubah.` / `Yang sudah dipindah tidak bisa dipulihkan dari Sampah {Ruang asal}.` Dari Pribadi ke Bersama, bila entri berketerangan, kontrol `Bawa keterangan` (kotak centang 44, **bawaan mati**) di sheet pilih, dengan satu baris penjelasan 13/500 `text-muted` tanpa mengutip isi keterangan: `Bila dicentang, keterangan ikut dipindah dan terlihat oleh anggota Bersama. Bila tidak, transaksi dibuat tanpa keterangan.`; konfirmasi hanya menambah butir `Keterangan ikut dipindah.` / `Keterangan tidak ikut dipindah.` sesuai pilihan. Tombol `Pindahkan` (primer) dan `Kembali`. Toast `Dipindahkan ke {Ruang tujuan} · {Rp}`.
- **URL entri asal sesudah dipindah:** Detail tidak 404; banner (gaya S6-D3) ikon `arrows-left-right` + `Transaksi ini sudah dipindahkan ke {Ruang tujuan}.` + tautan sekunder `Buka di {Ruang tujuan}`. Tidak ada Pulihkan (kode `entry_moved`) dan entri tidak tampil di Sampah. Nominal dicoret + `sr-only` `dipindahkan`.
- **Komponen:** `Sheet`, `MetaSelect`, `CategoryChips`, `ConfirmDialog`, banner.
- **Token:** `text-muted`, `border`.
- **ARIA:** daftar akibat `<ul>` bagian dari `Description` dialog; kotak centang `Bawa keterangan` berlabel dan `aria-describedby` ke penjelasannya. Tidak ada pengumuman (`role="alert"`/`status`) yang mengutip isi keterangan.
- **Fokus:** buka sheet: ke Dompet; sesudah pindah: navigasi ke Detail entri baru di ruang tujuan, fokus ke judul; bila gagal: dialog tetap terbuka dengan pesan di dalamnya, fokus ke `Kembali`.

### S7-D3 · Detail talangan

- **Tujuan:** melihat status penggantian, mencatat reimburse (boleh sebagian), atau menyerah (`Tidak diganti`).
- **Tata letak:** Detail pengeluaran biasa (S6-D1) ditambah baris status di kartu atas di bawah nominal, ikon + teks: menunggu `clock` fill + `Menunggu reimburse · sisa {Rp}` (`warning`); sebagian `clock` + `Menunggu reimburse · sisa {Rp} dari {Rp total}`; lunas `check-circle` fill `accent-text` + `Sudah diganti penuh`. Rincian ditambah baris `Talangan` = `Ya, kantor` dan, bila ada, bagian `Reimburse` (`dl` bersarang atau daftar baris 44, tiap baris tautan ke Detail reimburse: `{tanggal} · {Rp}`). Aksi (hanya saat belum lunas dan hidup): `Catat reimburse` primer, `Tidak diganti` sekunder; lalu Ubah dan Batalkan seperti biasa, **kecuali** talangan yang punya reimburse hidup: `Batalkan` tidak dirender dan diganti baris keterangan statis (ikon `info` 14 + 13/500 `text-muted`) `Batalkan reimburse di bawah dulu untuk membatalkan talangan ini.` (kode `reimbursement_exists` tetap dipetakan bila tertembus). Talangan lunas: tanpa kedua aksi itu.
- **Sheet `Catat reimburse`:** judul `Reimburse talangan · Pribadi`; kolom `Jumlah diganti` (`MoneyInput`, terisi sisa, boleh dikurangi, 0 tidak boleh); `Ke dompet` (`MetaSelect` dompet Pribadi non-Kantor, default dompet talangan); `Tanggal` (default hari ini, tidak sebelum tanggal talangan). Kaki: `Simpan reimburse`. Toast `Reimburse tersimpan di Pribadi · {Rp}` + `Urungkan`.
- **Dialog `Tidak diganti`** (`ConfirmDialog`, fokus awal `Kembali`): judul `Tandai tidak diganti?`; deskripsi `Pengeluaran ini jadi pengeluaran pribadi biasa dan masuk hitungan Pribadi. Bisa ditandai talangan lagi lewat Ubah.`; tombol `Tandai tidak diganti` (primer) dan `Kembali`. Toast `Ditandai tidak diganti di Pribadi`.
- **Detail reimburse:** judul `Reimburse talangan`, tautan `Lihat talangan` (ke entri induk), dapat `Batalkan` (membuka kembali sisa); dialog Batalkan biasa dengan tambahan `Sisa talangan bertambah lagi.`.
- **Galat:** `reimbursement_exceeds`, `not_reimbursable`, `reimbursement_exists` (tabel galat). Galat jumlah tampil inline di bawah kolom `Jumlah diganti` (pola S6-C5), fokus ke kolom; lainnya kotak `role="alert"` gaya S6-C2.
- **Komponen:** `EntryDetailView` + `DetailRow`, `Sheet`, `MoneyInput`, `MetaSelect`, `ConfirmDialog`, `Button`.
- **Token:** `warning`, `accent-text`, `text`, `text-muted`.
- **ARIA:** baris status `role="status"` tidak dipakai (konten statis halaman); teks status utuh dibaca; daftar reimburse `<ul>` berlabel `Reimburse untuk talangan ini`.
- **Fokus:** sheet reimburse awal di `Jumlah diganti`; sesudah simpan atau tandai, halaman memuat ulang dan fokus ke judul.

## Dompet

### S7-W1 · Cocokkan saldo

- **Tujuan:** menyamakan saldo di aplikasi dengan saldo nyata lewat entri `adjustment` sebesar selisih (`api.reconcile_balance`); pemasukan dan pengeluaran tidak berubah.
- **Tata letak:** pemicu tombol sekunder `Cocokkan saldo` di kepala riwayat dompet (di samping saldo). Sheet `Cocokkan saldo · {Dompet}` + `SpaceTag`: baris `Saldo di DompetKu` (label 13 `text-muted`, `MoneyText` 17/700), kolom `Saldo sebenarnya` (`MoneyInput` besar, terisi kosong, fokus awal), lalu **pratinjau selisih** (baris 44): kosong sebelum diisi; terisi lebih besar: ikon `plus-circle` fill `income` + `Selisih +{Rp}` dan penjelasan 13/500 `Akan dicatat penyesuaian naik. Pemasukan dan pengeluaran tidak berubah.`; lebih kecil: ikon `minus-circle` fill `warning` + `Selisih −{Rp}` dan `Akan dicatat penyesuaian turun. Pemasukan dan pengeluaran tidak berubah.`; sama: ikon `check-circle` fill `accent-text` + `Saldo sudah sama. Tidak ada yang perlu dicocokkan.` dan tombol `aria-disabled`. Tanggal selalu hari ini (tanpa pemilih). Kaki: `Cocokkan saldo` primer. Selisih ditampilkan dengan tanda `+`/`−` dan kata, tidak warna saja.
- **Keadaan:** menyimpan (S6-C1), galat jaringan (S6-C2), dompet terarsip (`account_archived`: kolom Dompet tak ada, kotak `role="alert"` `{dompet} sudah diarsipkan.`). Saldo berubah di antara pratinjau dan simpan: toast memakai selisih sebenarnya dari server.
- **Salinan:** toast `Saldo {dompet} dicocokkan di {Ruang} · selisih +{Rp}` / `−{Rp}` + `Urungkan` (membatalkan entri penyesuaian) **hanya bila entri adjustment bisa dibatalkan** (dicek Task 12); bila tidak, toast tanpa `Urungkan`.
- **Komponen:** `Sheet`, `MoneyInput`, baris pratinjau (pola `Hint`), `Button`.
- **Token:** `income`, `warning`, `accent-text`, `text-muted`.
- **ARIA:** pratinjau `role="status"` `aria-live="polite"` (berubah saat mengetik); tombol nonaktif `aria-describedby` = id pratinjau.
- **Fokus:** awal di `Saldo sebenarnya`; sesudah simpan fokus kembali ke `Cocokkan saldo`.

### S7-W2 · Ubah saldo awal

- **Tujuan:** koreksi saldo awal dalam 7 hari pertama tanpa jalur baru.
- **Tata letak:** di kepala riwayat dompet, tautan teks `Ubah saldo awal` (13/700 `accent-text`, target 44) hanya bila entri saldo awal masih bisa diubah (≤ 7 hari sejak `opened_on`, `editable`). Tautan menuju Detail entri saldo awal, yang sudah punya Ubah nominal (S6-D1: kolom lain sebagai teks). Lewat 7 hari: tautan tidak dirender; Detail entri saldo awal tanpa tombol Ubah dan dengan baris keterangan `Saldo awal terkunci sejak {tanggal}. Pakai Cocokkan saldo untuk menyesuaikan.` (kode `opening_locked`).
- **Komponen:** tautan teks, `EntryDetailView`, baris keterangan.
- **Token:** `accent-text`, `text-muted`.
- **Salinan:** `Ubah saldo awal`; `Saldo awal terkunci sejak {tanggal}. Pakai Cocokkan saldo untuk menyesuaikan.`
- **ARIA:** tautan `aria-label` `Ubah saldo awal {Dompet}`.
- **Fokus:** sesudah menyimpan di Detail, kembali ke Detail (S6-D1).

### S7-W3 · Arsipkan dompet

- **Tujuan:** mengarsipkan dompet kosong; menjelaskan mengapa dompet berisi belum bisa.
- **Siapa:** anggota mana pun ruang itu, termasuk Bersama (hak setara Spec §7a; `api.archive_account` hanya memeriksa keanggotaan lewat RLS dan saldo 0, tanpa cek pemilik). Dialog Bersama menambah butir `Dompet ini dipakai bersama; anggota lain juga tidak melihatnya di Catat lagi.`
- **Tata letak:** di bagian bawah detail dompet. **Saldo 0:** tombol teks bahaya `Arsipkan dompet` (pola `Arsipkan kategori`) membuka `ConfirmDialog` (fokus awal `Kembali`): ubin ikon `archive`, judul `Arsipkan {nama}?`, deskripsi `{nama} tidak ditawarkan lagi di Catat {Ruang}. Riwayat transaksinya tetap ada.`, tombol `Arsipkan` (bahaya) dan `Kembali`. **Saldo ≠ 0:** tombol arsip **tidak dirender**; di tempatnya kartu keterangan `surface` border `border` radius 16 padding 12 16: ikon `info` 18 `text-soft` + teks 14/600 `text`, `{nama} masih berisi saldo. Pindahkan isinya dengan Transfer, lalu arsipkan.` Race (`balance_not_zero` dari server): dialog tetap terbuka dengan galat `role="alert"` `{nama} masih berisi saldo, jadi belum bisa diarsipkan.` dan tombol `Arsipkan` `aria-disabled`.
- **Daftar Dompet:** dompet terarsip pindah ke kartu `Diarsipkan` di paling bawah (baris redup `text-muted`, tetap tautan ke riwayat, tanpa saldo besar, tanpa aksi pulihkan di S7). Tidak dirender bila kosong.
- **Salinan:** `Arsipkan dompet`; toast `{nama} diarsipkan di {Ruang}`.
- **Komponen:** `ConfirmDialog`, `ListCard`, `WalletRow`, kartu keterangan.
- **Token:** `danger`, `text-soft`, `text-muted`, `border`.
- **ARIA:** `AlertDialog` (Radix) `Title` + `Description`; kartu keterangan statis (bukan `role="alert"`).
- **Fokus:** sesudah arsip kembali ke daftar Dompet, fokus ke judul halaman.

### S7-W4 · Menunggu reimburse

- **Tujuan:** satu tempat melihat talangan yang belum diganti penuh.
- **Tata letak:** `ListCard` berjudul `Menunggu reimburse` (ikon `clock`, `aside` total sisa) di halaman Dompet **Pribadi** saja, tepat di atas kelompok dompet; tidak dirender bila tidak ada (tanpa placeholder) dan tidak pernah di Bersama. Baris = `TxRow` (tautan ke Detail talangan): label keterangan atau kategori, meta `Talangan · {dompet} · {hari}`, nominal = sisa; `status` ikon `clock` 14 + `sisa {Rp} dari {Rp total}` 13/600 `warning` hanya bila sebagian sudah diganti. HP 320: nominal turun ke baris sendiri seperti S6-S1. Maksimal 5 baris; lebih dari itu tautan `Lihat semua ({n})` ke filter talangan di Transaksi, **dirender hanya bila filter itu tersedia di mode nyata** (Task 12 memastikan; bila belum, hanya 5 baris tanpa tautan).
- **Komponen:** `ListCard`, `TxRow` (`status`), `MoneyText`.
- **Token:** `warning`, `text-muted`.
- **Salinan:** `Menunggu reimburse`; `Talangan · {dompet} · {hari}`; `Lihat semua ({n})`.
- **ARIA:** daftar `<ul>` berlabel `Talangan menunggu reimburse`.
- **Fokus:** tab normal; tidak ada fokus programatik.

## Beranda

### S7-B1 · Bersama dengan satu anggota

- **Tujuan:** ruang Bersama sebelum Farida bergabung tidak berpura-pura berisi dua orang.
- **Tata letak:** Beranda Bersama seperti S6 (AmanCard, tombol Tanpa pengeluaran, Terbaru), dengan perbedaan: (1) tidak ada avatar, inisial, atau nama Farida di mana pun (`ActivityRow` hanya merender aktor nyata; judul/pengantar tidak menyebut dua orang); (2) kartu pengantar checklist menjadi `Ruang untuk pengeluaran rumah tangga. Sekarang hanya kamu di sini; Farida belum bergabung.`; (3) kartu Aktivitas kosong: `Belum ada aktivitas. Yang dicatat di Bersama akan muncul di sini, terbaru di atas.`; (4) **kartu ajakan** tepat di bawah AmanCard, hanya bila pengguna pemilik Bersama (`isOwner`): `surface` border `border` radius 16 padding 12 16, ikon `user-plus` 20 `accent-text`, teks 15/600 `Farida belum bergabung di Bersama.` dan tombol sekunder `Undang Farida` 44 (menuju `/undang`; HP < 360 tombol turun di bawah teks). Bukan pemilik: kartu tidak dirender dan tidak ada tombol Undang. **Dua keadaan kartu:** (a) belum ada undangan: seperti di atas; (b) undangan sudah terkirim dan menunggu: teks `Undangan untuk {email} menunggu, berlaku sampai {tanggal}.` (ikon `clock` 18 `text-soft`; pola `Undangan tertunda` di `undang-real.tsx`) dan tombol sekunder `Kelola undangan` ke `/undang`.
- **Komponen:** `ListCard`/kartu `surface`, `Button` sekunder, `EmptyLine`, `OnboardingChecklistView` (pengantar berprop).
- **Token:** `border`, `accent-text`, `text`, `text-soft`.
- **ARIA:** kartu ajakan `<section aria-labelledby>`; tombol `aria-label` `Undang Farida ke Bersama`.
- **Fokus:** tab normal; tidak ada fokus programatik.
- **Aturan hilang:** bila anggota ≥ 2, B1 hilang sepenuhnya dan Beranda Bersama sama dengan S6.

### S7-B2 · Bersama kosong

- **Tujuan:** Bersama tanpa dompet operasional dan tanpa entri tidak menampilkan angka palsu `Rp 0 aman`.
- **Tata letak:** kartu utama (AmanCard) diganti `State` kosong dalam kartu utama (`heroCard`, radius 20): ubin 48 `accent-tint` ikon `wallet`, judul 17/700 `text` `Bersama belum punya dompet.`, teks 15/500 `text-soft` `Buat dompet bersama dulu, lalu catat pengeluaran rumah tangga di sini.`, tombol primer lebar penuh `Tambah dompet` (ke `/bersama/dompet?tambah=1`, sama dengan S6-C6). Tombol Tanpa pengeluaran, Terbaru, dan seksi tagihan/anggaran tidak dirender; checklist `Mulai dari sini` dan (bila B1 berlaku) kartu ajakan tetap tampil di bawahnya. Lengkap bersama B1: urutan = kosong, ajakan, checklist, Aktivitas.
- **Komponen:** `State` kosong, `Button` primer, `OnboardingChecklistView`.
- **Token:** `accent-tint`, `accent-text`, `text`, `text-soft`.
- **Salinan:** `Bersama belum punya dompet.` + `Buat dompet bersama dulu, lalu catat pengeluaran rumah tangga di sini.` + `Tambah dompet`.
- **ARIA:** judul keadaan `h2`; tombol fokusable pertama setelah header.
- **Fokus:** tidak ada fokus programatik; sesudah Tambah dompet ditutup kembali ke Beranda, fokus ke tombol pemicu.

## Salinan galat baru (tanpa nominal)

Kode galat mesin dipetakan ke `LedgerError.code` oleh Task 8; salinan di bawah mengikat Task 10 sampai 12. Tampilan mengikuti pola S6 (galat kolom S6-C5 atau kotak S6-C2); `Coba lagi` hanya untuk galat jaringan.

| Kode                      | Tampilan                                                                                | Teks                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `cross_space_not_allowed` | kotak `role="alert"` di atas kaki Catat, tanpa `Coba lagi`; fokus ke chip `Ruang lain…` | `Dompet ini tidak bisa dipakai untuk transfer antar ruang. Pilih dompet tujuan lain.`    |
| `cross_space_kantor`      | sama; fokus ke Select `Dari dompet`                                                     | `Dompet Kantor tidak bisa ikut transfer antar ruang. Pilih dompet lain.`                 |
| `name_taken` (dompet)     | galat kolom di bawah kolom Nama sheet Tambah dompet (pola S6-K1)                        | `Nama ini sudah dipakai dompet lain di {Ruang}.`                                         |
| `balance_not_zero`        | di dalam dialog S7-W3 (`role="alert"`)                                                  | `{nama} masih berisi saldo, jadi belum bisa diarsipkan. Pindahkan isinya dulu.`          |
| `not_reimbursable`        | kotak `role="alert"` di sheet reimburse atau dialog `Tidak diganti`                     | `Transaksi ini bukan talangan yang menunggu diganti. Muat ulang halaman.`                |
| `reimbursement_exceeds`   | galat kolom di bawah `Jumlah diganti`; fokus ke kolom                                   | `Jumlah ini lebih besar dari sisa yang belum diganti. Kurangi jumlahnya.`                |
| `reimbursement_exists`    | kotak `role="alert"` pada Batalkan/`Tidak diganti`/Ubah talangan                        | `Talangan ini sudah punya reimburse. Batalkan reimburse itu dulu.`                       |
| `entry_moved`             | banner di Detail entri asal (S7-D2) dan, bila Pulihkan tertembus, pesan di bawah tombol | `Transaksi ini sudah dipindahkan ke {Ruang tujuan} dan tidak bisa dipulihkan dari sini.` |
| `kind_not_movable`        | kotak `role="alert"` di sheet Pindahkan (tombol seharusnya tidak dirender)              | `Jenis transaksi ini tidak bisa dipindahkan ke ruang lain.`                              |
| `not_creator`             | kotak `role="alert"` di dialog Batalkan/Pulihkan/Pindahkan                              | `Hanya pencatat yang bisa membatalkan, memulihkan, atau memindahkan transaksi ini.`      |

## Salinan final S7 (mengikat Task 10 sampai 14)

| Bingkai           | Teks                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S7-C1             | `Ruang lain…`; `Ke dompet di {Ruang tujuan}`; `Dompet Kantor tidak bisa ikut transfer antar ruang.`; `Keterangan (hanya di Pribadi)`; `Catatan untuk Bersama`                                                                                                                                                                                                                                                                                                     |
| S7-C1 placeholder | `Terlihat oleh {Nama anggota lain} di Bersama` (solo: `Terlihat oleh anggota Bersama`)                                                                                                                                                                                                                                                                                                                                                                            |
| S7-C1 toast       | `Tersimpan di {Ruang} · {Rp} ke {Ruang tujuan}`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| S7-C2             | `Talangan kantor`; `Tidak masuk hitungan pribadi. Tercatat di Menunggu reimburse.`; mode keyboard `Tidak masuk hitungan pribadi.`; ubah: `Sudah ada reimburse. Batalkan reimburse itu dulu untuk mengubah ini.`                                                                                                                                                                                                                                                   |
| S7-D1             | `Setor ke Bersama`; `Ambil dari Bersama`; `Setoran dari {Nama}`; `Diambil oleh {Nama}`; `Transfer tidak bisa diubah. Batalkan, lalu catat lagi.`; `Hanya {Nama} yang bisa membatalkan transfer ini.`                                                                                                                                                                                                                                                              |
| S7-D1 dialog      | `Batalkan transfer antar ruang?` + `Kedua sisinya dibatalkan bersamaan, di Pribadi dan Bersama. Saldo kedua dompet kembali. Bisa dipulihkan dari Sampah selama 90 hari.` + `Batalkan transfer` / `Kembali`                                                                                                                                                                                                                                                        |
| S7-D1 toast       | `Dibatalkan di Pribadi dan Bersama · {Rp}`; `Dipulihkan di Pribadi dan Bersama · {Rp}`; Sampah bukan pencatat `Hanya {Nama} yang bisa memulihkan.`                                                                                                                                                                                                                                                                                                                |
| S7-D2             | `Pindahkan ke {Ruang tujuan}`; `Dompet di {Ruang tujuan}`; `Kategori di {Ruang tujuan}`; `Pilih dompet dan kategori untuk melanjutkan`; `Lanjut`; `Pindahkan`                                                                                                                                                                                                                                                                                                     |
| S7-D2 dialog      | `Pindahkan ke {Ruang tujuan}?`; `Transaksi ini dibatalkan di {Ruang asal} dan dibuat ulang di {Ruang tujuan}.`; `Saldo {dompet asal} dan {dompet tujuan} ikut berubah.`; `Yang sudah dipindah tidak bisa dipulihkan dari Sampah {Ruang asal}.`; `Bawa keterangan` + `Bila dicentang, keterangan ikut dipindah dan terlihat oleh anggota Bersama. Bila tidak, transaksi dibuat tanpa keterangan.`; `Keterangan ikut dipindah.` / `Keterangan tidak ikut dipindah.` |
| S7-D2 asal        | `Transaksi ini sudah dipindahkan ke {Ruang tujuan}.` + `Buka di {Ruang tujuan}`; toast `Dipindahkan ke {Ruang tujuan} · {Rp}`                                                                                                                                                                                                                                                                                                                                     |
| S7-D3             | `Menunggu reimburse · sisa {Rp}`; `Menunggu reimburse · sisa {Rp} dari {Rp total}`; `Sudah diganti penuh`; `Catat reimburse`; `Tidak diganti`; `Simpan reimburse`; `Jumlah diganti`                                                                                                                                                                                                                                                                               |
| S7-D3 dialog      | `Tandai tidak diganti?` + `Pengeluaran ini jadi pengeluaran pribadi biasa dan masuk hitungan Pribadi. Bisa ditandai talangan lagi lewat Ubah.` + `Tandai tidak diganti` / `Kembali`                                                                                                                                                                                                                                                                               |
| S7-D3 toast       | `Reimburse tersimpan di Pribadi · {Rp}`; `Ditandai tidak diganti di Pribadi`                                                                                                                                                                                                                                                                                                                                                                                      |
| S7-W1             | `Cocokkan saldo`; `Saldo di DompetKu`; `Saldo sebenarnya`; `Selisih +{Rp}` / `Selisih −{Rp}`; `Saldo sudah sama. Tidak ada yang perlu dicocokkan.`; toast `Saldo {dompet} dicocokkan di {Ruang} · selisih +{Rp}`                                                                                                                                                                                                                                                  |
| S7-W1 penjelasan  | `Akan dicatat penyesuaian naik. Pemasukan dan pengeluaran tidak berubah.` / `Akan dicatat penyesuaian turun. Pemasukan dan pengeluaran tidak berubah.`                                                                                                                                                                                                                                                                                                            |
| S7-W2             | `Ubah saldo awal`; `Saldo awal terkunci sejak {tanggal}. Pakai Cocokkan saldo untuk menyesuaikan.`                                                                                                                                                                                                                                                                                                                                                                |
| S7-W3             | `Arsipkan dompet`; `Arsipkan {nama}?` + `{nama} tidak ditawarkan lagi di Catat {Ruang}. Riwayat transaksinya tetap ada.`; `{nama} masih berisi saldo. Pindahkan isinya dengan Transfer, lalu arsipkan.`; toast `{nama} diarsipkan di {Ruang}`; kartu `Diarsipkan`                                                                                                                                                                                                 |
| S7-W4             | `Menunggu reimburse`; `Talangan · {dompet} · {hari}`; `Lihat semua ({n})`                                                                                                                                                                                                                                                                                                                                                                                         |
| S7-B1             | `Ruang untuk pengeluaran rumah tangga. Sekarang hanya kamu di sini; Farida belum bergabung.`; `Belum ada aktivitas. Yang dicatat di Bersama akan muncul di sini, terbaru di atas.`; `Farida belum bergabung di Bersama.` + `Undang Farida`; undangan menunggu: `Undangan untuk {email} menunggu, berlaku sampai {tanggal}.` + `Kelola undangan`                                                                                                                   |
| S7-B2             | `Bersama belum punya dompet.` + `Buat dompet bersama dulu, lalu catat pengeluaran rumah tangga di sini.` + `Tambah dompet`                                                                                                                                                                                                                                                                                                                                        |

Salinan tetap dari rencana S6/S7 (Global Constraints) dan salinan S6 yang tidak disebut di sini tidak diubah. Hubungan ke bingkai S6: S6-C3 (saldo kurang) dan S6-C2/C4 (galat simpan) dipakai apa adanya oleh S7-C1 dan S7-W1; S6-D3 (banner batal) menjadi pola banner S7-D2; S6-K2 menjadi pola S7-W3.

## Keputusan agen atas nama pemilik (Task 1)

Dasar: rencana S7, AFD §4/§7/§8/§9, dan fakta kode. Biaya bila salah ditulis di sisi masing-masing.

1. **Tujuan antar ruang lewat chip `Ruang lain…` + halaman dalam sheet,** bukan menu jenis baru atau pemilih ruang terpisah (pola `Kategori lain…`; menjaga budget JS Catat dan jalur 3 ketukan). Halaman tujuan tidak menampilkan saldo dompet.
2. **Bersama bukan pencatat tidak bisa Batalkan/Pulihkan kaki transfer, dan tidak ada tombol Ubah;** kata `Batalkan, lalu catat lagi` dipakai sebagai satu-satunya jalan (tidak ada `api.update_transfer`).
3. **Keputusan controller (R9):** kaki Bersama menampilkan dompet Bersama sendiri di Detail dan di daftar, tidak pernah dompet Pribadi atau counter.
4. **Toggle Talangan tidak ditawarkan untuk dompet Kantor** (sudah `x_kantor`, di luar hitungan pribadi) dan **Pindahkan tidak ditawarkan untuk talangan dan entri dompet Kantor.** Bila Task 3/4 memutuskan sebaliknya, bingkai ini diperbarui.
5. **Pindahkan memakai dua langkah** (sheet pilih lalu dialog akibat), karena akibatnya tidak bisa dipulihkan. **Keputusan controller (R10, R11):** hanya pencatat entri melihat Pindahkan; keterangan Pribadi→Bersama tidak ikut kecuali `Bawa keterangan` dicentang (bawaan mati). **Keputusan controller (R12):** toggle Talangan = tombol ikon 44×44 di baris meta tanpa baris baru (anggaran piksel di S7-C2).
6. **Saldo sebenarnya tidak boleh negatif** di Cocokkan saldo (kolom nominal yang ada); dompet kartu kredit minus ditunda sampai ada kebutuhan.
7. **Dompet terarsip dilihat di kartu `Diarsipkan` tanpa pemulihan;** pulihkan arsip di luar S7.
8. **`Tidak diganti` dapat dibalik lewat Ubah** (toggle talangan di sheet Ubah): dasar `api.update_entry` dengan `p_reimbursable` (BSD §8.1 catatan 1).

## Self-review terhadap DESIGN.md (agen)

Diperiksa terhadap `DESIGN.md` dan README Panel Malam; reviewer controller menyusul.

| Pemeriksaan                                                                                                 | Hasil                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Hanya token yang ada; tidak ada warna mentah, bayangan kartu, radius di luar skala (6/10/12/16/20/24/penuh) | Lolos; kartu ajakan, keterangan, dan banner memakai `surface` + `border` radius 16.                                                          |
| Status = ikon + teks (menunggu, lunas, selisih, kosong, dipindah, dibatalkan)                               | Lolos; selisih memakai tanda `+`/`−` dan kata, bukan warna saja.                                                                             |
| Ruang selalu tertulis (judul, toast, dialog, kartu)                                                         | Lolos; transfer antar ruang menulis kedua ruang di judul, toast, dan dialog.                                                                 |
| Target ≥ 44, jarak ≥ 8; tidak ada aksi hover                                                                | Lolos; toggle talangan 44, tautan `Ubah saldo awal` 44, tombol dilipat di mode keyboard tetap 44.                                            |
| Satu aksen: lime hanya untuk aksi utama dan teks aksen; violet hanya ruang Bersama                          | Lolos; peringatan memakai `warning`, bukan lime/violet.                                                                                      |
| 320 px tanpa gulir; nominal 12 digit                                                                        | Dirancang (nominal turun baris); pembuktian di tes Task 10 sampai 14.                                                                        |
| Tidak ada salinan dengan nominal di pesan galat, tidak ada nama dompet/keterangan Pribadi di sisi Bersama   | Lolos; daftar privasi di aturan bersama dan S7-D1.                                                                                           |
| Slop salinan (kalimat kosong, tanda seru, "Oops")                                                           | Tidak ada; kalimat pendek, kata kerja langsung, ada langkah berikutnya di setiap galat.                                                      |
| Kekhawatiran terbuka                                                                                        | Tinggi mode keyboard 356 px dengan baris Talangan (fallback tertulis di S7-C2); lebar `Ruang lain…` + chip terpilih di 320 px diuji Task 10. |
