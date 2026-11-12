# Bingkai desain S11 (Utang/piutang, cicilan, utang berjalan, Kontak)

Gerbang awal S11 (IPD §6 S11; plan S11 Task 1). Ditulis agen mengikuti Panel Malam (`DESIGN.md`, token `apps/web/src/styles/tokens.css`) dan format `docs/design/s10-bingkai.md`. Keputusan K1 sampai K10 di plan S11 mengikat (K1, K2, K3, K5 disetujui pemilik 2026-11-12; K4, K6 sampai K10 default plan). ID `S11-*` dirujuk Task 5, 6, 7, 8. Semua bingkai hanya untuk **mode nyata** dan **ruang Pribadi**; prototipe (`NEXT_PUBLIC_PROTOTYPE=1`) tidak berubah (Menu → Kontak tetap `Segera` di sana).

## Fakta kode yang membentuk bingkai

- **Rencana = satu halaman, segmen tautan** `?bagian=` (`_real/rencana.tsx`, `Segmen` memakai `segmentTrack`/`segmentItem`). Nilai selain `tagihan` jatuh ke Anggaran, jadi `?bagian=utang` di Bersama otomatis jatuh ke Anggaran (tidak ada tautan mati, ui-ux:20). Segmen ketiga `Utang` hanya dirender di Pribadi.
- **Penjaga `empty` di `RencanaReal`** (tanpa anggaran, tagihan, maupun anggaran lama) menggantikan isi semua bagian dengan satu `EmptyState`. Untuk `bagian=utang` penjaga itu **tidak boleh berlaku**: Pribadi tanpa anggaran dan tagihan tetap harus bisa membuka Utang.
- **`loadRencana` memuat anggaran, tagihan, dompet, kategori sekaligus.** Utang dimuat **hanya saat bagiannya dibuka** (`loadUtang`), dan galatnya menjadi `ErrorState` di dalam bagian Utang (Segmen tetap tampil), bukan `RencanaFailed` seluruh halaman: Anggaran dan Tagihan tidak ikut rusak oleh galat utang.
- **Pola yang dipakai ulang, bukan dibuat baru:** `Sheet` + `SpaceTag` (judul memuat ruang), `ListCard`, `EmptyState`/`ErrorState`/`LoadingRegion`, `ConfirmDialog` (fokus awal `Kembali`), `MoneyInput`, `TextField`, `SegmentedControl` (radiogroup), `ChipGroup`/`Chip variant="filter"`, `SelectField`/`Alert`/`payableAccounts` (diekspor `features/rencana/bill-sheet.tsx`, dompet Pribadi non-Kantor), pilihan tanggal 14 hari (`pay-bill-sheet.tsx`), `BackLink`, `buttonClass`, `Toast` dengan `Urungkan`, pulau malas (`rencana-islands.tsx`). Dua-target-per-baris dari `BillRow` (badan baris = tautan, tombol di kolom kanan).
- **Satu-satunya komponen tampilan baru: `KolomKas`** (`features/utang/kolom-kas.tsx`), tabel buku kas ui-ux R4 (angka rata kanan tabular, baris pengurang bertanda `−`, garis ganda di atas total). Markupnya salinan tabel rumus `SafeToSpendCard` (`caption` sr-only, `th scope="row"`, `tfoot`), ditambah `border-t-3 border-double border-border` di atas baris hasil. Server-safe, tanpa JS. Beranda tidak disentuh.
- **Tanda angka:** `MoneyText` netral tidak menampilkan `+`; baris `KolomKas` memakai `formatRupiah(v, { sign: 'always' })` di `span.num` (negatif sudah `−Rp`). `MoneyText kind="income"` **tidak dipakai** (hijau berarti pemasukan; pokok dan cicilan bukan pemasukan).
- **Uang dihitung di SQL (BSD §1.1).** Dari SQL: `principal`, `paid`, `remaining`, `paid_pct` (persen/permil terbayar), `quick` (nominal 25%, 50% dari sisa), total sisa per arah, ringkasan per kontak, dan efek bersih membatalkan per dompet untuk dialog Hapus. UI hanya membandingkan (`jumlah > sisa`) dan, pada pratinjau saja, mengurangkan dua bilangan bulat dari SQL (`sisa − jumlah`, saldo − jumlah) seperti peringatan saldo S6-C3 dan S9-TG3. Hasil sesudah simpan selalu dari balasan SQL (toast).
- **Budget JS (batas 162 kB):** Rencana nyata 150,3 kB (S10 menargetkan ≤ 152). Daftar Utang, detail, dan Kontak adalah Server Component; semua sheet/dialog ada di satu chunk malas baru `utang-client` yang **terpisah** dari `rencana-client` (pengguna Anggaran/Tagihan tidak membayar byte Utang).

## Aturan bersama

Aturan S6 sampai S10 berlaku (ruang tertulis di judul sheet dan toast; status = ikon + teks; target ≥ 44 dan jarak ≥ 8; 320 px tanpa gulir horizontal termasuk `Rp 12.345.678.900`; salinan galat **tanpa nominal**; tanpa tanda seru; tanpa "rumah tangga"). Tambahan S11:

1. **Istilah baku `Utang`** (bukan "Hutang"); arah: `Saya berutang` dan `Piutang`. Judul dan kalimat: `Utang ke {nama}`, `Piutang pada {nama}`.
2. **Tanpa merah untuk angka utang** (ui-ux Lampiran C, R4). Sisa, pokok, cicilan, total memakai teks biasa; piutang tidak diberi hijau (bukan pemasukan). Beda arah dibawa oleh kata, urutan kelompok, dan judul, bukan hue. `danger` hanya untuk tombol destruktif (`Hapus utang`, `Batalkan pembayaran`) dan pesan galat.
3. **Tanpa "Rp 0" dan tanpa "UTANG −Rp 0":** kartu/baris yang nilainya nol tidak dirender; utang yang sisanya 0 tampil sebagai `Lunas` (ikon `check-circle` fill + teks `accent-text`), bukan angka nol.
4. **Tanpa wizard** (K9): utang berjalan hanya lewat mode `Sudah berjalan` di sheet Tambah.
5. **Tanpa jatuh tempo, bunga, atau cicilan terjadwal** (tidak ada di plan; K3). Daftar tidak punya kolom tanggal jatuh tempo.

## Rencana: segmen Utang

### S11-UT1 · Daftar Utang (`/pribadi/rencana?bagian=utang`)

- **Tujuan:** melihat berapa yang masih harus dibayar dan masih ditagih, per orang, lalu mencatat cicilan tanpa membuka detail.
- **Segmen:** `Anggaran | Tagihan | Utang` (tiga segmen sama lebar, 44 px; di 320 masing-masing ≈ 100 px, label satu kata). Hanya Pribadi.
- **Tata letak (HP, satu kolom):** (1) **Kartu `Sisa`** (`card`, padding 16, `section aria-labelledby`): dua baris, `Saya berutang` dan `Piutang`, masing-masing label 13/600 `text-soft` + `MoneyText` 28/800 netral + sub `{n} kontak` 12/500 `text-muted`; baris yang totalnya 0 **tidak dirender**; bila keduanya 0 (hanya ada yang lunas) kartu tidak ada. Dua nominal ditumpuk (bukan berdampingan: `Rp 12.345.678.900` tidak muat dua kolom di 320). (2) **`ListCard` `Saya berutang`** (ikon `hand-coins` 18) lalu **`ListCard` `Piutang`**; kelompok kosong tidak dirender (tanpa placeholder). Urut sisa terbesar, lalu nama kontak. Hanya utang yang **belum lunas**. (3) **`details` `Lunas ({n})`** (pola `Tagihan diarsipkan`, caret 16, ≥ 44) berisi baris baca-saja (nama + `Lunas` + `Rp {pokok}`), tautan ke detail. (4) **`details` `Utang dihapus ({n})`** (hanya bila ada, 90 hari terakhir): baris nama + `Dihapus {tgl}` + tombol `Pulihkan` (sekunder 44); lihat S11-AK2. (5) Tombol sekunder `Tambah utang` (ikon `plus`, penuh, `laptop:hidden`); di laptop aksi yang sama ada di `PageHeader`.
- **Baris `DebtRowView` (Server Component, dua target):** badan = tautan ke detail (`min-h-18`, `-mx-4 px-4`): ubin 44 berisi **inisial kontak** (`aria-hidden`; tanpa foto), nama kontak 15/600 `line-clamp-2` `break-words`, bila ada judul: baris 13/500 `text-muted` `line-clamp-1`; **sisa** 14/700 (`Sisa Rp 1.500.000`, `whitespace-nowrap`, turun ke baris sendiri di 320 bila perlu), bilah terbayar 4 px (`aria-hidden`; isi `chart-aman`, jalur `surface-2`; lebar dari `paid_pct` SQL), caption 12/500 `text-muted` `{pct}% terbayar · dari Rp 2.000.000`. Kolom kanan: tombol sekunder kecil 44 `Bayar` (Saya berutang) atau `Terima` (Piutang), rata kanan atas, jarak ≥ 8 dari badan. Tata letak deterministik: nominal ada di badan, kolom kanan hanya berisi tombol, jadi `Rp 12.345.678.900` tidak berebut ruang dengan nama.
- **Keadaan:** (a) **kosong** (`EmptyState` accent, ikon `hand-coins` 28, `headingLevel=2`) `Belum ada utang atau piutang.` / `Catat uang yang kamu pinjam atau pinjamkan, lalu cicilannya, supaya sisanya selalu jelas.` / aksi primer `Tambah utang`; tanpa kartu `Sisa`, tanpa "Rp 0". (b) **memuat** `Memuat utang…` (`LoadingRegion`) + kerangka kartu `Sisa` dan dua baris. (c) **galat** `ErrorState` `Utang belum bisa dimuat.` / `Sambungan ke server terputus. Catatan yang sudah tersimpan tidak hilang.` / `Coba lagi` (`RetryIsland`). (d) hanya yang lunas: tidak ada kartu dan tidak ada `ListCard`; `details` `Lunas` + `Tambah utang`.
- **Laptop (≥ 1024):** `laptop:max-w-180` satu kolom seperti S9/S10; sheet jadi dialog tengah 520.
- **Bersama:** segmen Utang tidak ada; tidak ada kata utang/piutang/kontak di markup Rencana Bersama.
- **ARIA:** `nav aria-label="Bagian Rencana"` (sudah ada) dengan `aria-current="page"`; tiap `ListCard` heading level 2; nama tautan badan disusun dari isi terlihat (`Utang ke Budi, sisa Rp 1.500.000` tanpa teks sr-only yang bukan bagian dari isi terlihat); tombol `Bayar` bernama `Bayar utang ke {nama}` (diawali kata terlihat, Label in Name).
- **Urutan fokus:** segmen → `Tambah utang` (laptop) → baris pertama (badan → `Bayar`) → … → `Lunas` → `Utang dihapus` → `Tambah utang` (HP).

### S11-DT1 · Detail utang (`/pribadi/rencana/utang/{id}`)

- **Tujuan:** melihat sisa yang pasti benar, riwayat pembayaran, dan mencatat atau membatalkan cicilan. Halaman (bukan sheet) karena memuat daftar yang bisa panjang dan dua dialog; pola Detail Dompet.
- **Tata letak (HP):** `BackLink` `Utang` (ke `?bagian=utang`). **Kartu utama** (`heroCard`, `p-4`): ubin inisial 48 + `h1` `Utang ke {nama}` / `Piutang pada {nama}` (headline 800, `break-words`) + sub 13/500 `text-muted` `{judul} · sejak 12 Okt 2026` (judul hanya bila ada). Lalu satu angka besar: label `Sisa` 14/500 `text-soft`, `MoneyText size="amount-sm"` netral. Bilah terbayar 6 px (`aria-hidden`), caption `{pct}% terbayar · Rp 500.000 dari Rp 2.000.000`. Bila **lunas**: pengganti angka besar adalah `Lunas` (ikon `check-circle` fill, `accent-text`, 28/800) dan caption `Rp 2.000.000 terbayar penuh`; tidak ada `Rp 0`.
- **Aksi (urut):** `Bayar utang` / `Terima pembayaran` (primer 48, penuh; tidak ada bila lunas); `Ubah` (sekunder 44); `Hapus utang` (tombol teks `danger` 44).
- **Kartu `Rincian`** (`dl`): `Arah` (`Saya berutang`/`Piutang`), `Kontak`, `Dicatat sebagai` (`Uang baru` atau `Sudah berjalan`; untuk berjalan baris pelengkap `Saldo dompet tidak ikut berubah.`), `Dompet` (hanya mode baru: dompet entri pokok), `Catatan` (hanya bila ada).
- **`ListCard` `Riwayat pembayaran`** (ikon `clock`): baris dua-target seperti `BillRow`: badan = tautan ke Detail transaksi entri itu (`min-h-16`): tanggal 15/600 (`14 Okt 2026`), meta 13/500 `text-muted` `Dibayar dari BCA` / `Diterima di BCA`, nominal kanan 15/700 `whitespace-nowrap`; tombol sekunder kecil 44 `Batalkan` di bawah nominal (kolom kanan, rata kanan). **Pembayaran yang dibatalkan tetap tampil**, redup (`text-muted`), diberi tanda `Dibatalkan` (ikon `minus-circle` fill 14 + teks 13/700 `text-muted`) di tempat tombol; nominalnya tidak dicoret satu-satunya penanda (teks `Dibatalkan` yang membawa arti). Urut terbaru di atas; pembayaran hidup dan batal berbaur menurut tanggal. Baris terakhir (statis, 13/500 `text-muted`): `Utang dicatat 12 Okt 2026`. Kosong: `EmptyLine` `Belum ada pembayaran.` (tanpa tombol kedua; aksinya di atas).
- **Keadaan:** memuat `loading.tsx` (`Memuat utang…` + kerangka kartu utama dan tiga baris); galat `ErrorState` `Utang belum bisa dimuat.` + `Coba lagi`; utang tidak ada, milik ruang lain, atau **sudah dihapus**: `notFound()` (pemulihan lewat grup `Utang dihapus` di daftar); `/bersama/rencana/utang/{id}` selalu `notFound()` (B10).
- **Laptop:** satu kolom `laptop:max-w-180`.
- **ARIA/Fokus:** `h1` jadi sasaran fokus sesudah aksi yang memuat ulang halaman (pola `focus-title`); kartu utama `section aria-labelledby` ke `h1`; `ul aria-label="Pembayaran utang ke {nama}"` (kata kerja sesuai arah); bilah `aria-hidden` (angka sudah teks); tombol `Batalkan` bernama `Batalkan pembayaran 14 Okt 2026`.

### S11-DT2 · Sheet `Ubah utang`

- **Tujuan:** memperbaiki judul, kontak, atau catatan tanpa efek ke uang (K4).
- **Tata letak:** `Sheet`, judul `Ubah utang · Pribadi` + `SpaceTag`. Kalimat di atas (13/500 `text-soft`, `aria-describedby`): `Perubahan ini tidak mengubah saldo, pembayaran, atau sisa.` Kolom: **Kontak** (kontrol yang sama dengan S11-AD1), **Untuk apa** (opsional), **Catatan** (opsional). Di bawah, kotak `surface-2` statis (ikon `info` 14): `Jumlah dan pembayaran tidak bisa diubah. Batalkan pembayarannya atau hapus utang ini, lalu catat ulang.` Footer: `Simpan perubahan` (primer 48). Nominal pokok **tidak** tampil sebagai kolom (K4).
- **Toast:** `Utang ke {nama} disimpan · Pribadi`. Fokus awal di Kontak.

## Sheet Tambah utang

### S11-AD1 · `Tambah utang · Pribadi`

- **Tujuan:** mencatat utang atau piutang baru, atau yang sudah berjalan, dalam satu sheet.
- **Tata letak (urut dari atas; sheet menggulir, footer tetap):**
  1. **Arah** (`SegmentedControl`, `label="Arah"`, **tanpa pilihan awal**, `value=null`): `Saya berutang` | `Piutang`. Di bawahnya satu kalimat 13/500 `text-soft` yang mengikuti pilihan: `Kamu meminjam uang dari orang lain.` / `Kamu meminjamkan uang ke orang lain.` Arah tidak diberi bawaan karena salah arah membalik efek ke dompet.
  2. **Kontak:** bila belum ada kontak aktif, langsung `TextField` `Nama kontak` (maks 60). Bila ada: `SelectField` `Kontak` (kontak aktif, urut nama) dan di bawahnya tombol teks 44 `Tambah kontak baru` (ikon `user-plus` 16, `accent-text`). Mengetuknya **menukar** pilihan dengan `TextField` `Nama kontak` + tombol teks `Pilih dari daftar` (menukar kembali); kontak dibuat bersama utangnya saat `Simpan utang`. Tanpa halaman atau sheet kedua.
  3. **Untuk apa** (`TextField`, opsional, placeholder `Mis. cicilan motor`, maks 80).
  4. **Cara mencatat** (`SegmentedControl`, `label="Cara mencatat"`, bawaan `Baru`): `Baru` | `Sudah berjalan`. Kalimat di bawahnya mengikuti: Baru: `Uangnya {masuk ke / keluar dari} dompet yang kamu pilih.` (sesuai arah; sebelum arah dipilih `Uangnya masuk atau keluar dari dompet yang kamu pilih.`). Sudah berjalan: `Hanya mencatat sisa saat ini. Saldo dompet dan Laporan tidak berubah.`
  5. **Jumlah** (`MoneyInput`): label `Jumlah pinjaman` (Baru) atau `Sisa saat ini` (Sudah berjalan); label berganti, kolom dan nilainya tetap.
  6. **Dompet** (hanya Baru; `SelectField`, dompet Pribadi aktif bukan Kantor, K6): label `Uang masuk ke` (Saya berutang) / `Uang keluar dari` (Piutang) / `Dompet` (arah belum dipilih). Bawaan dompet operasional pertama. Tepat di bawah: **`KolomKas` pratinjau** (`Saldo {dompet}` sekarang, `+/−` jumlah, garis ganda, `Saldo sesudahnya`), tampil hanya bila arah dan jumlah terisi. Piutang yang membuat saldo negatif: kotak `warning-tint` (pola S6-C3, bukan galat) `Saldo {dompet} tinggal Rp …. Kalau disimpan, saldonya jadi −Rp ….` dan tombol utama berganti `Tetap simpan`. Tanpa dompet sama sekali: `NoAccountState` S6-C6 menggantikan kolom ini (`Belum ada dompet di Pribadi. Tambah dompet dulu, atau pilih Sudah berjalan.`); tombol utama nonaktif selama mode Baru.
  7. **Tanggal** (`<input type="date">` berlabel seperti S9-TG2 `Mulai`; `max` hari ini): label `Tanggal` (Baru; tanggal entri pokok) atau `Utang mulai` (Sudah berjalan); bawaan hari ini.
  8. **Catatan** (`TextField`, opsional).
- **Footer:** `Simpan utang` (primer 48, penuh). Ketuk dengan isian kurang tetap diterima dan memunculkan galat kolom (`role="alert"`, fokus ke kolom, pola S6-C5), bukan tombol mati.
- **Toast:** Baru, Saya berutang: `Utang ke {nama} dicatat di Pribadi · Rp 2.000.000 masuk ke BCA`; Baru, Piutang: `Piutang pada {nama} dicatat di Pribadi · Rp 2.000.000 keluar dari BCA`; Sudah berjalan: `Utang ke {nama} dicatat di Pribadi · saldo tidak berubah` (`Piutang pada …` untuk piutang).
- **Keadaan:** menyimpan (`Menyimpan…`, `aria-busy`, sheet tidak bisa ditutup); galat jaringan di kotak atas dengan `Coba lagi` (aman diulang: `client_id` sama, kontak baru ikut idempoten).
- **ARIA/Fokus:** judul = nama dialog (`Tambah utang Pribadi`); fokus awal di Arah (kontrol pertama); `SegmentedControl` radiogroup dengan panah; kalimat bantu lewat `aria-describedby`; Esc menutup kecuali menyimpan; fokus kembali ke pemicu.

## Sheet Bayar

### S11-BY1 · `Bayar utang ke {nama} · Pribadi` / `Terima dari {nama} · Pribadi`

- **Tujuan:** mencatat satu cicilan secepat mungkin, dengan sisa selalu terlihat dan bayar lebih tidak bisa lolos.
- **Tata letak:** `Sheet` + `SpaceTag`. Di bawah judul: `Sisa Rp 1.500.000` 15/700 dan ` dari Rp 2.000.000` 13/500 `text-soft` (dari SQL). Isian: (1) **Jumlah** (`MoneyInput`, label `Jumlah dibayar` / `Jumlah diterima`, fokus awal, kosong). (2) **Pintasan** (`ChipGroup label="Pintasan jumlah"`, `Chip variant="filter"`, 44): `25%`, `50%`, `Lunas`; mengisi kolom Jumlah dengan nilai `quick` dari SQL (25% dan 50% **dari sisa**, dibulatkan ke bawah ke rupiah penuh; chip yang hasilnya 0 atau sama dengan Lunas disembunyikan); terpilih bila jumlah di kolom sama persis dengan nilainya (diturunkan, bukan state ganda). Nama aksesibel `25% dari sisa, Rp 375.000`. (3) **Dompet** (`SelectField`, `Dibayar dari` / `Diterima di`; dompet Pribadi non-Kantor; bawaan dompet entri pokok bila masih aktif). (4) **Tanggal** (pilihan 14 hari `pay-bill-sheet`, `Tanggal bayar` / `Tanggal terima`, bawaan hari ini, tidak lebih awal dari tanggal mulai utang). (5) **`KolomKas`** `Setelah ini`: `Sisa sekarang`, `Dibayar`/`Diterima` (selalu bertanda `−`: pembayaran mengurangi sisa di kedua arah), garis ganda, `Sisa sesudahnya`; baris tunggal di bawahnya `Saldo {dompet} berkurang Rp …` / `bertambah Rp …`. Hanya tampil bila jumlah valid.
- **Bayar lebih (K7):** bila jumlah > sisa: galat kolom (live lewat `aria-describedby`, `role="alert"` saat disimpan) `Jumlah ini lebih besar dari sisa. Kurangi jumlahnya atau bayar sisanya.` dan tepat di bawah kolom tombol sekunder 44 `Bayar sisa Rp 1.500.000` / `Terima sisa Rp 1.500.000` (nominal = sisa terbaru dari data, **bukan dari pesan galat**) yang **mengisi** kolom Jumlah (tidak menyimpan). Bila server menolak (`payment_exceeds`, mis. cicilan lain masuk lebih dulu): halaman memuat ulang datanya, galat yang sama muncul, tombol memakai sisa yang baru. Kolom tidak dibatasi diam-diam.
- **Saldo kurang (hanya Saya berutang):** kotak `warning-tint` `Saldo {dompet} tinggal Rp …. Kalau dibayar, saldonya jadi −Rp ….`; tombol berganti `Tetap bayar` (pola S9-TG3).
- **Footer:** `Bayar Rp 375.000` / `Terima Rp 375.000` (primer 48, nominal mengikuti isian); `Lunasi Rp 1.500.000` / `Terima pelunasan Rp 1.500.000` saat jumlah = sisa. Tanpa dialog konfirmasi (jalur cepat; efeknya terlihat di `KolomKas` dan bisa diurungkan).
- **Toast (dengan `Urungkan` = batalkan pembayaran itu):** `Dibayar ke {nama} · Rp 375.000 dari BCA · sisa Rp 1.125.000`; `Diterima dari {nama} · Rp 375.000 di BCA · sisa Rp 1.125.000`; lunas: `Utang ke {nama} lunas · Rp 375.000 dari BCA` / `Piutang pada {nama} lunas · Rp 375.000 di BCA`. Sisa dari balasan SQL.
- **Keadaan:** menyimpan (`Menyimpan…`, tombol nonaktif); utang sudah lunas atau terhapus saat sheet terbuka: kotak atas `Utang ini sudah lunas atau dihapus. Muat ulang halaman.` + `Muat ulang`; tanpa dompet: `NoAccountState` (`Belum ada dompet di Pribadi. Tambah dompet dulu untuk membayar.`).
- **ARIA/Fokus:** `KolomKas` sebagai `table` dengan `caption`; fokus awal Jumlah; chip radiogroup berpanah; Esc menutup kecuali menyimpan.

## Dialog akibat (kolom buku kas)

Hanya aksi yang **membalik** uang memakai dialog (`ConfirmDialog`, `AlertDialog`, fokus awal `Kembali`, lebar maks 360). Tambah dan Bayar tidak memakai dialog (tidak merusak; ada `KolomKas` di sheet dan `Urungkan`).

### S11-AK1 · `Batalkan pembayaran ini?`

- **Isi:** kalimat `Pembayaran 14 Okt 2026 dibatalkan. Uangnya kembali ke {dompet} dan sisa utang bertambah lagi.` (Piutang: `Uangnya keluar lagi dari {dompet} dan sisa piutang bertambah lagi.`). Lalu dua `KolomKas` kecil, masing-masing berjudul 13/700: **`Saldo {dompet}`** (`Sekarang`, `+Rp 375.000`, garis ganda, `Sesudahnya`) dan **`Sisa utang`** (`Sekarang`, `+Rp 375.000`, garis ganda, `Sesudahnya`). Nilai dari data detail (saldo dompet dan sisa) dengan satu penjumlahan pratinjau; hasil akhir dari SQL.
- **Tombol:** `Batalkan pembayaran` (bahaya) dan `Kembali`. Ikon `arrow-counter-clockwise`, seperti VoidDialog. Toast `Pembayaran dibatalkan · Pribadi · Rp 375.000` + `Urungkan` (memulihkan lewat `restore`; bila ditolak `payment_exceeds`: salinan di bawah).
- **Galat di dalam dialog (`alert`):** `debt_deleted`, jaringan.

### S11-AK2 · `Hapus utang ke {nama}?`

- **Isi (K5, void atomik):** `Utang ini dan semua pembayarannya dibatalkan sekaligus. Bisa dipulihkan {90} hari dari Utang dihapus.` Di bawahnya **`KolomKas` `Saldo dompet berubah`**: satu baris per dompet yang terkena (`Saldo BCA`, `+Rp 1.625.000`), efek **bersih** per dompet dari SQL; garis ganda dan total tidak dipakai (dompet berbeda tidak dijumlahkan), cukup daftar dua kolom. Mode `berjalan` tanpa pembayaran: tidak ada kolom, satu kalimat `Saldo dompet tidak berubah.` Satu baris tambahan `Sisa utang ke {nama} menjadi tidak ada.` tanpa nominal.
- **Tombol:** `Hapus utang` (bahaya) dan `Kembali`; ikon `trash`. Toast `Utang ke {nama} dihapus di Pribadi` + `Urungkan` (= `restore_debt`). Sesudah hapus: kembali ke daftar Utang (`?bagian=utang`), fokus ke judul.
- **Pulihkan:** tombol `Pulihkan` di grup `Utang dihapus` memanggil `restore_debt` langsung (tanpa dialog; semua efek kembali). Toast `Utang ke {nama} dipulihkan di Pribadi`. Bila saldo dompet pembayaran sudah tidak cukup, ditolak dengan pesan di bawah baris (`Belum bisa dipulihkan. Saldo dompet tidak cukup untuk mengembalikan pembayarannya.`).

## Kontak dan Menu

### S11-KT1 · Halaman Kontak (`/pribadi/kontak`)

- **Tujuan:** mengelola orang yang terhubung ke utang, dan melihat sisa per orang. Pola halaman Kategori (`KategoriBackIsland`, `h1` `Kontak · Pribadi`, daftar di `card`, sheet, dialog arsip; satu kolom `laptop:max-w-180`).
- **Daftar:** kontak **aktif** urut nama (A sampai Z). Baris = tombol 62 px yang membuka S11-KT2: ubin inisial 36, nama 15/600 `break-words`, sub 13/500 `text-muted` dengan **ringkasan sisa dari SQL**: `Saya berutang Rp 1.500.000` dan/atau `Piutang Rp 300.000` (satu baris per arah, hanya yang > 0); bila tidak ada: `Tidak ada utang aktif`. Caret `caret-right` 16. Tanpa merah, tanpa hijau.
- **Aksi:** `Tambah kontak` (sekunder 44, ikon `plus`; di laptop di header halaman) membuka S11-KT2 kosong.
- **Keadaan:** kosong `Belum ada kontak.` / `Kontak dibuat saat kamu mencatat utang, atau dari sini.` / `Tambah kontak`; memuat kerangka tiga baris + `Memuat kontak…`; galat `Kontak belum bisa dimuat.` / `Periksa koneksi lalu coba lagi.` + `Coba lagi`.
- **Bersama:** `/bersama/kontak` = `notFound()`.

### S11-KT2 · Sheet `Tambah kontak` / `Ubah kontak`

- **Tata letak:** `Sheet`, judul `Tambah kontak · Pribadi` / `Ubah kontak · Pribadi` + `SpaceTag`. Kolom **Nama** (`TextField`, 1 sampai 60 huruf). Mengubah: kalimat di bawah kolom `Nama baru berlaku di semua utang kontak ini.`; ringkasan statis `Utang aktif {n} · Piutang aktif {m}` (jumlah, bukan uang). Footer: `Simpan` (primer 48); mengubah juga tombol teks `Arsipkan kontak` (44).
- **Dialog arsip** (`ConfirmDialog`, ikon `archive`): `Arsipkan {nama}?` / `{nama} tidak muncul lagi di pilihan kontak. Utang yang sudah ada tetap tercatat dan tetap bisa dibayar.` / `Arsipkan` / `Kembali`. Toast `{nama} diarsipkan`.
- **Galat:** nama kosong atau > 60 di kolom (`Nama kontak diisi 1 sampai 60 huruf.`); nama sama dengan kontak aktif lain (`contact_name_taken`) di kolom (`Sudah ada kontak dengan nama ini.`); jaringan kotak atas.
- **Fokus:** awal di Nama; sesudah arsip, fokus ke judul halaman.

### S11-MN1 · Menu → Kontak

Item `Kontak` (ikon `address-book`, sudah ada) menjadi `MenuLink` ke `/pribadi/kontak` **hanya di mode nyata ruang Pribadi** (pola `Kategori`: `kontakHref(ruang)`). Di Bersama mode nyata item **tidak dirender** (disembunyikan, bukan dinonaktifkan; ui-ux:20). Prototipe: tetap `Segera`. e2e shell diperbarui (Task 6).

## Salinan galat S11 (tanpa nominal)

| Kode (usulan Task 5)                             | Tempat                             | Teks                                                                                                                                                      |
| ------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment_exceeds`                                | kolom Jumlah (Bayar)               | `Jumlah ini lebih besar dari sisa. Kurangi jumlahnya atau bayar sisanya.` (Piutang: `…atau terima sisanya.`)                                              |
| `saldo_negatif`                                  | kotak `warning-tint` (bukan galat) | `Saldo {dompet} tinggal Rp …. Kalau dibayar, saldonya jadi −Rp ….` (`disimpan` untuk piutang baru)                                                        |
| `debt_account_kantor`                            | kolom Dompet                       | `Dompet Kantor tidak bisa dipakai untuk utang. Pilih dompet lain.`                                                                                        |
| `debt_deleted`                                   | kotak atas sheet/dialog            | `Utang ini sudah dihapus. Pulihkan utangnya dulu.`                                                                                                        |
| `debt_not_found` / `contact_not_found`           | kotak atas                         | `Data ini tidak ditemukan. Muat ulang halaman.`                                                                                                           |
| `contact_archived`                               | kolom Kontak                       | `Kontak ini sudah diarsipkan. Pilih kontak lain.`                                                                                                         |
| `contact_name_taken`                             | kolom Nama kontak                  | `Sudah ada kontak dengan nama ini. Pilih dari daftar.` (Tambah utang) / `Sudah ada kontak dengan nama ini.` (Kontak)                                      |
| `payment_exceeds` (Pulihkan/Urungkan pembayaran) | di bawah baris/toast               | `Belum bisa dipulihkan. Sisa utangnya tidak cukup untuk pembayaran ini.`                                                                                  |
| `invalid`                                        | per kolom                          | `Pilih arah utang.` / `Pilih kontak atau tambah kontak baru.` / `Nama kontak diisi 1 sampai 60 huruf.` / `Jumlah harus lebih dari nol.` / `Pilih dompet.` |
| jaringan/`unknown`                               | kotak atas sheet                   | `Belum berhasil. Sambungan ke server terputus. Coba lagi.`                                                                                                |
| loader                                           | `ErrorState`                       | `Utang belum bisa dimuat.` + `Sambungan ke server terputus. Catatan yang sudah tersimpan tidak hilang.`                                                   |

## Salinan final S11 (mengikat Task 6)

| Bingkai     | Teks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UT1         | `Utang`; `Saya berutang`; `Piutang`; `Sisa`; `{n} kontak`; `Sisa Rp …`; `{pct}% terbayar · dari Rp …`; `Bayar`; `Terima`; `Bayar utang ke {nama}`; `Lunas ({n})`; `Utang dihapus ({n})`; `Dihapus {tgl}`; `Pulihkan`; `Tambah utang`; `Belum ada utang atau piutang.`; `Catat uang yang kamu pinjam atau pinjamkan, lalu cicilannya, supaya sisanya selalu jelas.`; `Memuat utang…`; `Utang belum bisa dimuat.`                                                                                                                                                                        |
| DT1         | `Utang ke {nama}`; `Piutang pada {nama}`; `{judul} · sejak {tgl}`; `Sisa`; `Lunas`; `{pct}% terbayar · Rp … dari Rp …`; `Rp … terbayar penuh`; `Bayar utang`; `Terima pembayaran`; `Ubah`; `Hapus utang`; `Rincian`; `Arah`; `Kontak`; `Dicatat sebagai`; `Uang baru`; `Sudah berjalan`; `Saldo dompet tidak ikut berubah.`; `Riwayat pembayaran`; `Dibayar dari {dompet}`; `Diterima di {dompet}`; `Dibatalkan`; `Batalkan`; `Utang dicatat {tgl}`; `Belum ada pembayaran.`                                                                                                           |
| DT2         | `Ubah utang · Pribadi`; `Perubahan ini tidak mengubah saldo, pembayaran, atau sisa.`; `Untuk apa`; `Catatan`; `Jumlah dan pembayaran tidak bisa diubah. Batalkan pembayarannya atau hapus utang ini, lalu catat ulang.`; `Simpan perubahan`; toast `Utang ke {nama} disimpan · Pribadi`                                                                                                                                                                                                                                                                                                |
| AD1         | `Tambah utang · Pribadi`; `Arah`; `Kamu meminjam uang dari orang lain.`; `Kamu meminjamkan uang ke orang lain.`; `Kontak`; `Tambah kontak baru`; `Pilih dari daftar`; `Nama kontak`; `Untuk apa`; `Cara mencatat`; `Baru`; `Sudah berjalan`; `Uangnya masuk ke dompet yang kamu pilih.`; `Uangnya keluar dari dompet yang kamu pilih.`; `Hanya mencatat sisa saat ini. Saldo dompet dan Laporan tidak berubah.`; `Jumlah pinjaman`; `Sisa saat ini`; `Uang masuk ke`; `Uang keluar dari`; `Tanggal`; `Utang mulai`; `Catatan`; `Simpan utang`; `Tetap simpan`; toast sesuai bagian AD1 |
| BY1         | `Bayar utang ke {nama} · Pribadi`; `Terima dari {nama} · Pribadi`; `Sisa Rp … dari Rp …`; `Jumlah dibayar`; `Jumlah diterima`; `Pintasan jumlah`; `25%`; `50%`; `Lunas`; `Dibayar dari`; `Diterima di`; `Tanggal bayar`; `Tanggal terima`; `Setelah ini`; `Sisa sekarang`; `Sisa sesudahnya`; `Bayar sisa Rp …`; `Terima sisa Rp …`; `Bayar Rp …`; `Terima Rp …`; `Lunasi Rp …`; `Terima pelunasan Rp …`; `Tetap bayar`; toast sesuai bagian BY1                                                                                                                                       |
| AK1/AK2     | `Batalkan pembayaran ini?`; `Batalkan pembayaran`; `Hapus utang ke {nama}?`; `Utang ini dan semua pembayarannya dibatalkan sekaligus. Bisa dipulihkan 90 hari dari Utang dihapus.`; `Saldo dompet berubah`; `Saldo dompet tidak berubah.`; `Hapus utang`; `Kembali`; `Sekarang`; `Sesudahnya`                                                                                                                                                                                                                                                                                          |
| KT1/KT2/MN1 | `Kontak · Pribadi`; `Tambah kontak`; `Ubah kontak · Pribadi`; `Nama`; `Nama baru berlaku di semua utang kontak ini.`; `Utang aktif {n} · Piutang aktif {m}`; `Tidak ada utang aktif`; `Arsipkan kontak`; `Arsipkan {nama}?`; `{nama} tidak muncul lagi di pilihan kontak. Utang yang sudah ada tetap tercatat dan tetap bisa dibayar.`; `Belum ada kontak.`; `Kontak dibuat saat kamu mencatat utang, atau dari sini.`; `Memuat kontak…`; `Kontak belum bisa dimuat.`                                                                                                                  |

## Target sentuh, urutan fokus, nama aksesibel

- Semua kontrol ≥ 44 dengan jarak ≥ 8: segmen (44), baris utang (≥ 72, badan) dan `Bayar`/`Terima` (44), baris riwayat (≥ 64) dan `Batalkan` (44), chip pintasan (44), `Tambah kontak baru` (44), `Lunas`/`Utang dihapus` (summary ≥ 44), `Pulihkan` (44), tombol footer (48).
- Urutan DOM = urutan baca = urutan fokus. **Detail:** BackLink → `Bayar utang` → `Ubah` → `Hapus utang` → baris riwayat (badan → `Batalkan`). **Kontak:** BackLink → `Tambah kontak` → baris. **Sheet Bayar:** Jumlah → pintasan → (`Bayar sisa`) → Dompet → Tanggal → footer.
- Status tidak pernah hanya warna: `Lunas` (ikon + teks), `Dibatalkan` (ikon + teks), `Berjalan` lewat kata `Sudah berjalan`; arah lewat kata.
- Label in Name untuk tombol yang diawali kata terlihat (`Bayar utang ke {nama}`, `Batalkan pembayaran {tgl}`, `25% dari sisa, Rp …`).

## Budget JS dan aturan implementasi

- Ukur dari `main` **sebelum menambah apa pun** dan laporkan `js-route-kB` dan `js-all-kB` (nyata) untuk Rencana (bagian Utang), detail utang, dan Kontak; berhenti bila > 162. Target: Rencana ≤ 152 (tanpa selisih berarti dari S10), detail ≤ 150, Kontak ≤ 150.
- Server Component: kartu `Sisa`, `DebtRowView`, detail, riwayat, `KolomKas`, daftar Kontak. Pulau malas (satu chunk `utang-client`, **bukan** `rencana-client`): sheet Tambah/Ubah/Bayar, dialog AK1/AK2/arsip, tombol pemicu, sheet Kontak. Tidak ada modul demo di bundel nyata. Menu hanya menambah satu `MenuLink` (ikon sudah ada).
- Ukuran uji layar (Task 6): 320, 390, 1280; gelap dan terang; Pribadi (Bersama: bukti segmen/menu/rute tidak ada); nama kontak 60 huruf; `Rp 12.345.678.900` di kartu `Sisa`, baris, detail, dan `KolomKas`; keadaan kosong, memuat, galat, lunas, berjalan, pembayaran dibatalkan, saldo kurang, bayar lebih; axe tanpa pelanggaran serius. Screenshot ke `docs/design/s11/` (`SCREENS=1`): `ut1-daftar`, `ut1-kosong`, `dt1-detail-{aktif,lunas,berjalan}`, `ad1-sheet-{baru,berjalan}`, `by1-sheet-{normal,lebih}`, `ak1-batal`, `ak2-hapus`, `kt1-kontak`.

## Dampak ke task lain (data yang dibutuhkan UI)

1. **Task 4 (API baca):** `api.list_debts` mengembalikan per utang `principal`, `paid`, `remaining`, `paid_pct`, `mode`, `direction`, `contact_id/name`, `title`, `opened_on`, `voided_at` (utang dihapus ≤ 90 hari ikut, untuk grup `Utang dihapus`), dan total sisa per arah + jumlah kontak; `api.debt_detail` menambah `quick` (25%, 50% sisa), daftar pembayaran (termasuk yang dibatalkan, dengan akun dan `voided`), dan `void_effects` (efek bersih per dompet bila semua dibatalkan); `api.list_contacts` memberi ringkasan sisa per arah dan jumlah utang aktif per kontak.
2. **Task 5:** `loadUtang` terpisah dari `loadRencana`; kode galat pada tabel di atas; `create_contact` + `create_debt` dalam satu action (kontak baru ikut `client_id`).
3. **Task 7 (Transaksi/Sampah):** entri yang dibatalkan oleh Hapus utang **tidak** menawarkan `Pulihkan` sendiri di Sampah; tampilkan `Utang ke {nama} dihapus. Pulihkan dari Utang.` + tautan ke `?bagian=utang`. Detail transaksi `debt_principal`/`debt_payment` memuat tautan `Lihat utang`.

## Keputusan agen atas nama pemilik (Task 1)

1. **Utang = segmen ketiga di Rencana yang sama**, dimuat per bagian (`loadUtang`), dengan chunk malas sendiri; galat utang tidak merusak Anggaran dan Tagihan.
2. **Detail utang = halaman** (`/pribadi/rencana/utang/{id}`), bukan sheet; utang terhapus = 404, pemulihan lewat grup `Utang dihapus` di daftar.
3. **Bayar tanpa dialog; dialog akibat hanya untuk membalik uang** (batal pembayaran, hapus utang). Kolom buku kas (`KolomKas`) tampil inline di sheet Bayar/Tambah (pratinjau) dan di kedua dialog.
4. **Pintasan 25%/50%/Lunas dari sisa** (nilai dari SQL); `Bayar sisa Rp …` mengisi kolom, tidak menyimpan.
5. **Nol merah, nol "Rp 0":** angka utang netral; `Lunas` menggantikan angka nol; kartu `Sisa` tidak merender arah yang kosong.
6. **Kontak inline = tukar pilihan dengan kolom nama** (tanpa sheet kedua); kontak hanya Pribadi, item Menu disembunyikan di Bersama.
7. **Arah tanpa bawaan, cara mencatat bawaan `Baru`**; label Jumlah berganti (`Jumlah pinjaman` / `Sisa saat ini`) agar K2 (principal = sisa saat ini) terbaca dari layar.

## Self-review terhadap DESIGN.md (agen)

- Satu angka besar per layar dengan ruang tertulis: Utang memakai kartu `Sisa` (dua baris, sama berat, tanpa hero kedua) dan detail memakai `Sisa` sebagai angka besar tunggal; Kontak tanpa angka besar.
- Aksen lime hanya untuk aksi primer, fokus, dan status `Lunas` (`accent-text`); tidak ada hue baru; bilah terbayar memakai `chart-aman` yang sudah ada; struktur dibawa oleh kata, ikon, dan urutan.
- Tanpa bayangan di kartu; radius 16 daftar, 20 kartu utama dan dialog, 24 sheet; ikon Phosphor yang sudah ada (`hand-coins`, `address-book`, `user-plus`, `plus`, `check-circle`, `minus-circle`, `clock`, `info`, `archive`, `trash`, `arrow-counter-clockwise`, `caret-*`).
- Salinan tanpa "Hutang", "rumah tangga", tanda seru, dan "UTANG −Rp 0"; galat tanpa nominal (tombol `Bayar sisa Rp …` adalah data dari sisa, bukan galat).
- Motion: tidak ada animasi baru (transisi sheet 200 ms yang ada).

## Pertanyaan untuk pemilik dan penyimpangan

1. **Kolom `title` utang:** plan memuat `title` di `app.debts` dan K4 menyebut Judul boleh diubah, tetapi daftar Task 1 tidak menyebut kolomnya di sheet. Bingkai memasukkannya sebagai `Untuk apa` **opsional** (maks 80). Setuju, atau dihilangkan dan hanya `Catatan`? (Bila opsional, `title` di migrasi `0130` harus nullable.)
2. **Dasar 25%/50%:** dari **sisa saat ini** (rekomendasi, supaya `50%` berarti "setengah dari yang tersisa") atau dari pokok? Pembulatan ke rupiah penuh atau ke Rp1.000?
3. **Pratinjau saldo/sisa di sheet memakai satu pengurangan di UI** (menyimpang dari "UI tidak menjumlah" K10, mengikuti S6-C3/S9-TG3). Alternatif: fungsi pratinjau SQL. Rekomendasi: tetap pengurangan UI untuk pratinjau, hasil sesungguhnya dari SQL.
4. **Pemulihan utang yang dihapus** (K5) butuh tempat: bingkai menaruhnya di grup `Utang dihapus` di segmen Utang (bukan Sampah). Setuju? Atau Sampah memuat satu baris per utang terhapus?
5. **Tidak ada `Pulihkan kontak`/`Hapus kontak`** di plan (hanya arsip); nama yang sama bisa dibuat ulang sebagai kontak baru. Cukup untuk S11?
6. **Tanggal pembayaran sebelum tanggal mulai utang:** UI membatasi pilihan; apakah server juga harus menolak (kode galat baru)? Usulan: ya, `payment_before_opened`.
7. **Beranda dan Laporan:** S11 tidak menambah kartu utang di Beranda dan tidak mengubah "aman dipakai" (pokok/cicilan bukan pemasukan/pengeluaran, review focus 2). Net worth dan piutang-sebagai-aset ditunda (bukan bagian plan S11). Setuju?
8. **Penyimpangan dari plan:** Task 1 menyebut "jatuh tempo opsional bila K ada"; tidak ada K untuk itu, jadi **tidak ada** jatuh tempo di S11. Satu kontak dengan dua utang berbeda dibedakan lewat `Untuk apa`.

## Untuk kursi design reviewer

Task 6 menugaskan satu reviewer terpisah memeriksa: tidak ada merah/hijau pada angka utang dan piutang (kecuali pesan galat/tombol destruktif); `Lunas` tidak pernah tampil sebagai `Rp 0`; `KolomKas` terbaca di 320 dengan `Rp 12.345.678.900` (garis ganda, tanda `+`/`−`); sheet Bayar dapat dipakai satu tangan dengan keyboard HP (Jumlah, pintasan, footer tetap terlihat di 356 px); `Bayar sisa Rp …` jelas mengisi (bukan menyimpan); pembayaran dibatalkan terbaca tanpa warna; Label in Name; tidak ada nominal di galat; Bersama tidak menampilkan jejak utang atau kontak.

## Design critique dan Delivery Gate

Antislop mode DURING; Delivery Gate dijalankan sebagai daftar periksa manual (skill tidak tersedia, seperti S7 sampai S10). Bagian ini diisi Task 6 dan 9 setelah screenshot ada: daftar periksa (token dan komponen dipakai ulang, status = ikon + teks, target sentuh, 320 tanpa gulir horizontal, axe, Label in Name, salinan, budget JS) dan temuan `S11-C1…`.
