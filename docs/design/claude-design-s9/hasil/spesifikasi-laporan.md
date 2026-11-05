# Spesifikasi Laporan S9 (LP1–LP13)

Sumber visual: kanvas Claude Design "DompetKu S9 Laporan" (<https://claude.ai/artifact/Q9APPnefFp1NHXC6VF6ymy>, pribadi) dan salinan sumbernya di `bingkai/`. Semua bingkai lahir dari satu komponen, `LaporanScreen.dc.html`, dengan props `ruang`, `basis`, `periode`, `keadaan`, `tema`, `lebar`, `bukaDapur`, `bukaTabel`, `panjang`, `libur`, `bagian`, `trenN`. Peta kode bingkai → props ada di bagian 10.

Arah visual tidak baru: Panel Malam apa adanya. Satu-satunya tambahan adalah tiga token grafik (bagian 8). Angka semua dari `contoh-data.json` (demo Sab, 17 Okt 2026).

> **Status verifikasi:** bingkai ditulis dan diterbitkan, tetapi **belum dirender atau diperiksa secara visual** oleh agen perancang. Tinggi bingkai adalah perkiraan dari perhitungan CSS. Periksa di kanvas sebelum dipakai sebagai acuan piksel, dan laporkan bila ada yang meleset.

## 1. Kerangka dan layout per lebar

| Lebar    | Kerangka                                                                                                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 320–599  | Header 66 px, `main` padding 12 / 12 / 24, jarak antar kartu 12, satu kolom, tab bar. Di < 360 judul ruang header hanya `sr-only` dan Catat jadi ikon 48 × 48 dengan label di bawah.                                                    |
| 600–1023 | Header dan tab bar tetap. Isi maks 720, padding 24. Ringkasan dan Tidak termasuk berdampingan (2 kolom, jarak 12); Kategori, Tren, Kontribusi selebar penuh. Keadaan kosong selebar penuh.                                              |
| ≥ 1024   | Sidebar 248, tanpa header dan tab bar. Isi maks 1000, padding 24, jarak 16. Baris 1: kolom kiri (Ringkasan + Tidak termasuk) dan kolom kanan (Kategori). Baris 2: Tren selebar penuh. Baris 3: Kontribusi (separuh kiri, Bersama saja). |

Item **Laporan** ditambahkan di sidebar (di bawah Rencana, aktif: `surface-2` + garis kiri 3 px `accent-text` + 800) dan di Menu. Tab bar tidak menandai halaman aktif di Laporan.

## 2. Urutan DOM = urutan baca = urutan fokus

Urutan visual HP sama dengan urutan DOM, jadi fokus tidak melompat:

1. Ringkasan · 2. Tidak termasuk · 3. Pengeluaran per kategori (+ Pemasukan per kategori) · 4. Tren · 5. Kontribusi (Bersama).

Laptop memakai grid yang menempatkan kolom kiri (1, 2) dan kanan (3) berdampingan, Tren penuh di bawahnya, lalu Kontribusi; urutan DOM tidak berubah.

**Urutan fokus HP:** Pribadi → Bersama → Menu → ‹ periode sebelumnya → › periode berikutnya (bila aktif) → Periode gajian → Bulan kalender → baris kategori yang bisa dibuka (summary) dan tautan anggaran berstatus, sesuai urutan baca → "Tabel data" → tab bar: Beranda, Transaksi, Catat, Dompet, Rencana.
**Laptop:** pengalih ruang sidebar → Catat → Beranda, Transaksi, Dompet, Rencana, Laporan, Menu → ‹ › → dasar periode → kategori (kolom kanan) → "Tabel data".
Fokus = `outline: 2px solid var(--focus); outline-offset: 2px` pada semua tautan, tombol, dan `summary`.

## 3. Anatomi dan ukuran

Semua teks Plus Jakarta Sans. Nominal selalu `tabular-nums` + `white-space: nowrap`. Uang `Rp 1.250.000` (NBSP setelah "Rp"), negatif `−Rp 35.000` (U+2212), pemasukan `+Rp …` warna `income`.

| Bagian                 | Spesifikasi                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Judul halaman HP       | `h1` "Laporan" 26/800, −0.01em; `SpaceTag` di kanan (11/800 kapital +0.06em, radius 6, padding 5 × 8, tint ruang). Laptop: label "Ruang Pribadi" 12/800 kapital warna ruang, H1 28/800, tanggal "Sab, 17 Okt 2026" 14/500 `text-muted`.                                                                                                                                                                                |
| Pemilih periode        | `nav aria-label="Pilih periode"`: IconButton 44 × 44 radius 12 border `border` (‹ ›) mengapit judul 16/800 dan rentang 13/500 `text-muted` ("25 Sep – 22 Okt · berjalan, 6 hari lagi" / "· lengkap"), rata tengah, boleh 2 baris. › nonaktif di periode berjalan: `surface-2`, border `hairline`, `text-muted`, `role="img" aria-label="Periode berikutnya belum tersedia"`.                                           |
| Dasar periode          | `nav aria-label="Dasar periode"`: track `surface-2`, border `hairline`, radius 14, padding 2. Item 44 tinggi, radius 12, 14/600 `text-soft`; terpilih: border `border`, isi `surface`, 14/700 `text`, `aria-current="page"`. Tautan `?basis=gajian` / `?basis=kalender`.                                                                                                                                               |
| Petunjuk libur (LP13)  | Kotak `surface-2` radius 12, padding 10 12, ikon `info` 18 + 13/500 `text-soft`: "Libur nasional 2027 belum diisi; hari gajian dihitung tanpa libur." Bukan peringatan merah.                                                                                                                                                                                                                                          |
| Kartu Ringkasan        | `card hero`: `surface`, border `hairline`, radius 20, padding 16 (laptop 24). Judul "Pengeluaran Oktober 2026" 14/700 `text-soft` + SpaceTag. Angka: "Rp" 20/700 `text-muted` + digit 44/800 −0.025em (laptop 56, mengecil bila panjang, bagian 7).                                                                                                                                                                    |
| Catatan di Ringkasan   | 13/500 `text-soft`, ikon 16 `text-muted`: periode berjalan "Periode belum selesai; angka masih bisa bertambah."; pembanding (bagian 9); kalender "Gaji Oktober baru masuk 23 Okt, jadi selisih sementara negatif."                                                                                                                                                                                                     |
| Buku besar (3 baris)   | Baris padding 9 0, garis atas `hairline`, 14/500. Pemasukan `+Rp …` `income` 700 ("Rp 0" polos bila 0). Pengeluaran `−Rp …` 700. **Selisih** label 800, kata + ikon 14 ("Surplus" `plus-circle` `income` / "Defisit" `minus-circle` `danger`) lalu nominal 800 berwarna sama. Baris membungkus; nominal turun, rata kanan.                                                                                             |
| Tidak termasuk         | Kotak `surface-2`, border `hairline`, radius 16, padding 14 16. Judul 14/700 `text-soft` + `info` 18; hint 13/500 `text-muted`. Baris padding 10 0, garis atas `hairline`: nama 15/600, keterangan 13/500 `text-muted`, nominal 15/700 kanan. Hanya baris bernilai > 0.                                                                                                                                                |
| Kartu Kategori         | `card`: radius 16, padding 14 16. Header: judul 14/700 + total di kanan 14/700. Baris: ubin 40 radius 12 `surface-2` ikon 22 `text-soft`; nama 15/600 maks 2 baris; meta "37,8% dari total" 13/500 `text-muted`; nominal 15/700; bilah 8, radius 4 (bagian 6). Jarak baris: padding 10 0, garis atas `hairline`, tinggi isi ≥ 44.                                                                                      |
| Baris anggaran         | 13/500 `text-muted` di bawah bilah: "dari anggaran Rp 2.000.000 · 45% terpakai". Mulai 80% jadi tautan 44 ke Rencana dengan status ikon 16 fill + teks 700 (bagian 6).                                                                                                                                                                                                                                                 |
| Subkategori            | Induk = `summary` (≥ 44) dengan caret 16 `text-muted` (berputar saat terbuka). Isi dari indentasi 52: nama 14/600, nominal 14/700, "51,3% dari Belanja Dapur" 12/500 `text-muted`, bilah 6.                                                                                                                                                                                                                            |
| Pemasukan per kategori | Di kartu yang sama, di bawah garis `hairline`: judul 14/700 + total `+Rp` `income`; baris ubin + nama + `+Rp …` `income` 700. Disembunyikan bila 0 (kalender sebelum gaji masuk).                                                                                                                                                                                                                                      |
| Kontribusi (Bersama)   | `card` radius 16. Judul 14/700, keterangan "Setoran dan pengambilan antar ruang periode ini." Baris ≥ 60: avatar 36 bulat (N: `surface-3` + `text`; F: `bersama-tint` + `bersama`, border `border`), nama 15/600, "Setor Rp …" 15/700, "Diambil Rp …" 13/500 `text-muted` hanya bila > 0. Belum ada setoran: "Belum ada setoran" 14/500 `text-muted` (bukan "Rp 0"). Tanpa peringkat, persen, atau warna menang/kalah. |

## 4. Nama aksesibel dan peran

- Ruang: pengalih `nav aria-label="Pilih ruang"`, yang aktif `aria-current="page"` + ikon ✓ + teks. SpaceTag memuat nama ruang. Header 320: judul ruang `sr-only`.
- Pemilih: tombol sebelumnya `aria-label="Periode sebelumnya: September 2026"`, berikutnya "Periode berikutnya: …".
- Bagian: setiap kartu `aria-labelledby` ke `h2`-nya ("Pengeluaran Oktober 2026", "Tidak termasuk", "Pengeluaran per kategori", "Arus kas 5 periode", "Kontribusi per orang").
- Ikon dekoratif `aria-hidden`; bilah kategori `aria-hidden` (persen dan nominal ada sebagai teks).
- Tautan anggaran: `aria-label="Langganan: dari anggaran Rp 180.000, 85% terpakai. Buka di Rencana."`
- Grafik tren: wadah `role="img"` dengan `aria-label` "Grafik batang berpasangan: pemasukan dan pengeluaran per periode, Jun sampai Okt. Okt masih berjalan. Rincian angka ada di tabel data di bawah." Isi visual `aria-hidden`.
- Tabel data: `role="table"` + `aria-label` ("Pemasukan, pengeluaran, dan selisih per periode"), header `columnheader`, baris `rowheader`/`cell`. **Produksi: pakai `<table>` sungguhan** (mock memakai `div role` karena pembangun kanvas memindahkan `<tr>` keluar dari `<tbody>`).
- Memuat: `role="status"` + "Memuat laporan…" terlihat; wadah `aria-busy="true"`. Skeleton `aria-hidden`.
- Galat: judul `h2`, tombol "Coba lagi" adalah tautan (`<a href>` ke URL yang sama).

## 5. Keadaan

| Keadaan           | Bingkai   | Isi                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kosong            | LP5, LP13 | Kartu `hero`: ubin 56 radius 16 `accent-tint` + `chart-bar` 28, `h2` 20/800 "Belum ada transaksi di periode ini.", 15/500 `text-soft` "Catat pengeluaran atau pemasukan, lalu ringkasannya muncul di sini.", tombol Catat primer 48 (`aria-keyshortcuts="c"`). Tanpa "Rp 0". Tren tetap tampil (periode lain punya data); LP13 menyembunyikannya. |
| Memuat            | LP6       | Skeleton `surface-3` berbentuk isi akhir (ringkasan, Tidak termasuk, 4 baris kategori, tren) + "Memuat laporan…". Tanpa denyut; bila ingin, denyut opacity 1,2 s dan mati di `prefers-reduced-motion`.                                                                                                                                            |
| Galat             | LP7       | Ubin `danger-tint` + `cloud-slash`, "Laporan belum bisa dimuat." 20/800, "Sambungan ke server terputus. Catatan yang sudah tersimpan tidak hilang.", tombol primer "Coba lagi" (`arrow-clockwise` bold) berupa tautan. Pemilih periode tetap tampil.                                                                                              |
| Tren 2 periode    | LP5b      | Kartu tren dengan 2 grup. Aturan: 1 periode → tanpa grafik, hanya pembacaan langsung + tabel; ≥ 2 → grafik.                                                                                                                                                                                                                                       |
| Libur belum diisi | LP13      | Petunjuk `info` di bawah pemilih (bagian 3). Hitungan hari gajian tetap jalan tanpa libur.                                                                                                                                                                                                                                                        |

## 6. Spesifikasi grafik

### 6.1 Tren: batang berpasangan, pemasukan vs pengeluaran

- **Data:** enam periode terakhir yang berakhir di periode berjalan (gajian: Jun–Okt, lima, karena seed mulai Mei; kalender: Mei–Okt, enam). Periode yang sedang dilihat ditandai; bila di luar yang tampil, tidak ada tanda.
- **Sumbu nilai:** `0` sampai `3 × langkah`, langkah dari {1, 2, 2,5, 4, 5} × 10ⁿ yang pertama ≥ `max / 3` (data demo: langkah Rp 4 jt, puncak Rp 12 jt). Empat garis bantu: nol memakai `border`, lainnya `hairline`. Label `Rp 4 jt`, `Rp 12 jt`, `Rp 500 rb` (desimal koma: `Rp 2,5 jt`), 11/500 `text-muted`, rata kanan, lebar 44, kolom label 50 di kiri plot.
- **Plot:** tinggi 150 (HP), 170 (tablet), 190 (laptop). Tinggi batang = `nilai / puncak`.
- **Grup:** `flex: 1` per periode, padding 0 2, jarak dalam grup 3. Batang lebar maks 20 (laptop 28), minimum 8, radius atas 4.
- **Pemasukan (kiri):** isi `chart-income-tint`, tepi 2 px `chart-income`. **Pengeluaran (kanan):** padat `chart-expense`. Dibedakan oleh bentuk dan posisi, bukan hue; legenda berlabel di atas grafik.
- **Nilai 0:** batang tetap 2 px di garis dasar. **Negatif:** tidak ada (nilai grafik selalu ≥ 0). Selisih negatif hanya muncul di tabel dan Ringkasan.
- **Periode berjalan:** pengeluaran berarsir diagonal 135° (2 px isi / 3 px kosong, latar `surface`) bertepi 2 px; pemasukan bertepi putus-putus; label sumbu x ditambah baris "berjalan" 11/600 `text-muted`; legenda "Periode berjalan" dengan swatch arsir.
- **Label sumbu x:** nama periode 12/600 `text-soft`; yang dipilih 800 `text` + garis bawah 2 px.
- **Pembacaan langsung:** kotak `surface-2` radius 12 dengan nilai penuh periode dipilih ("Okt · berjalan", Pemasukan, Pengeluaran). Ini label langsung; tidak ada tooltip.
- **Tabel setara:** `details` "Tabel data" (ringkasan 44, caret). Kolom Periode | Pemasukan | Pengeluaran | Selisih; selisih bertanda `+`/`−`; baris periode dipilih diberi isi `surface-2`. HP: angka tanpa "Rp", caption "Dalam rupiah (Rp)", kolom periode 34 px dan sisanya berbagi sama rata, 12/500 tabular. ≥ 768: "Rp" penuh, 13/500. LP2 memperlihatkan keadaan terbuka.
- **Tidak ada** animasi, hover, atau tooltip. Render server (div berpersen atau SVG `<rect>`), nol JavaScript klien.

### 6.2 Batang per kategori

- Tinggi 8, radius 4, jalur `surface-2`, isi `chart-expense`. **Panjang = persen dari total pengeluaran berkategori** (1 desimal, koma), jadi batang = angka di meta.
- Urut terbesar. "Biaya transfer" (tanpa kategori) jadi baris terakhir **hanya bila > 0** (ikon `arrows-left-right`); data demo tidak punya.
- Status anggaran (hanya kategori beranggaran), pembulatan persen ke bawah (cocok dengan `contoh-data.json`):

| Kondisi           | Teks               | Ikon (fill)       | Warna        | Bentuk               |
| ----------------- | ------------------ | ----------------- | ------------ | -------------------- |
| < 80%             | `45% terpakai`     | tanpa             | `text-muted` | teks biasa           |
| ≥ 80% dan < 100%  | `85% terpakai`     | `warning`         | `warning`    | tautan 44 ke Rencana |
| tepat 100% (sama) | `Terpakai penuh`   | `warning-octagon` | `warning`    | tautan 44 ke Rencana |
| > 100%            | `Lewat Rp 189.000` | `warning-octagon` | `danger`     | tautan 44 ke Rencana |

Tepat 100% (Sewa Rumah Rp 4.500.000 dari Rp 4.500.000) sengaja **bukan** "Lewat": "Lewat Rp 0" menyesatkan. Aturan yang sama sebaiknya dipakai BudgetRow di Anggaran.

## 7. Angka panjang dan 320 px

- **Angka besar:** digit mengecil agar satu baris. Rumus (ekuivalen CSS): `font-size = min(44px, (lebarKartu − padding − 30px) / (digit × 0,62 + titik × 0,28))`; laptop batas atas 56, minimum 20. Produksi: `container-type: inline-size` pada kartu dan `min(44px, calc((100cqw − 30px) / (var(--em))))` dengan `--em` dihitung server dari jumlah digit dan titik. `Rp 12.345.678.900` ≈ 30 px di 320 dan ≈ 39 px di 390 (LP12a, LP12b).
- **Nominal baris:** `nowrap`, rata kanan. Bila nama + nominal tidak muat, baris membungkus: nominal turun ke baris berikutnya di kanan. Nama kategori maks 2 baris lalu ellipsis, nama penuh di `title` (LP12: "Perawatan kendaraan & servis rutin bulan", 40 karakter).
- **Baris buku besar:** membungkus; Selisih: kata + ikon di atas, nominal di bawah rata kanan bila tidak muat.
- **Tren 320 (LP10):** 5 grup × ≈ 43 px; batang minimum 8; label "berjalan" 11/600 melebar sedikit di luar grupnya tetapi tidak menabrak (label tetangga pendek). Kalender (6 grup) di 320: sembunyikan kata "berjalan" dan andalkan legenda arsir + pembacaan langsung.
- **Header 320:** judul ruang `sr-only`, pengalih ruang + Menu; Catat ikon 48 × 48 dengan label di bawah.
- Tidak ada gulir ke samping di semua lebar; tabel data muat tanpa kotak gulir di 320.

## 8. Token baru dan kontras

Nilai gelap / terang; rasio dihitung dengan rumus WCAG. Tambahkan juga ke blok `[data-theme="system"]` dan ke `contrast.test.ts`.

| Token                 | Gelap                     | Terang                    | Pemakaian                                                    | Rasio gelap / terang                                                               |
| --------------------- | ------------------------- | ------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `--chart-expense`     | `#8A9590`                 | `#6B7670`                 | Batang pengeluaran, arsir, swatch                            | vs `surface` 5,39 / 4,72 · vs `surface-2` 4,78 / 4,06 · vs `surface-3` 4,18 / 3,73 |
| `--chart-income`      | `var(--income)` `#5FD8A4` | `var(--income)` `#1B7A4B` | Tepi 2 px batang pemasukan, swatch (alias, tanpa warna baru) | vs `surface` 9,42 / 5,34 · vs `surface-2` 8,35 / 4,59                              |
| `--chart-income-tint` | `#253D33`                 | `#E4EFE9`                 | Isi batang pemasukan (dekoratif)                             | `chart-income` di atas tint 6,60 / 4,53                                            |

Semua elemen grafik yang membawa informasi (tepi pemasukan, batang pengeluaran) ≥ 3:1 terhadap `surface` dan `surface-2`. Dipakai ulang: `hairline` (garis bantu, dekoratif), `border` (garis nol, 3,97 / 3,71 vs `surface`), `text-muted` (label sumbu, 6,59 / 5,61 vs `surface` / `surface-2`), `warning` (9,02 / 5,43), `danger` (7,54 / 5,95), `income`.

**Alasan bukan warna ruang atau `danger`:** pengeluaran biasa bukan bahaya, dan lime/violet menandai ruang; lime harus tetap hanya muncul di saat penting.

## 9. Keputusan yang menyimpang dari brief

1. **Dasar periode memakai `nav` + `aria-current="page"`, bukan `role="tablist"`.** Itu tautan tanpa JavaScript; pola tab menuntut panel dan navigasi panah. Tampilan sama dengan segmen Panel Malam.
2. **Periode berjalan tidak dibandingkan** dengan periode lalu (belum selesai). Teks: "Periode belum selesai; angka masih bisa bertambah." + "September (lengkap): Rp 4.178.500 pengeluaran." Periode lengkap: "Rp 1.628.500 lebih sedikit dari Agustus." (`arrow-down`; "lebih banyak" memutar ikon 180°).
3. **Selisih positif juga ditandai kata** ("Surplus") agar simetris dengan "Defisit".
4. **Tren selalu berakhir di periode berjalan**; periode yang dilihat hanya ditandai.
5. **Kontribusi belum ada** ditulis "Belum ada setoran", bukan "Setor Rp 0".
6. **Tepat 100% anggaran bukan "Lewat"** (bagian 6.2).
7. **Tren disembunyikan di LP12** (angka ilustrasi tidak boleh bertabrakan dengan data tren).
8. **Tanggal turunan:** April 2026 = 25 Mar – 23 Apr; Januari 2028 = 24 Des 2027 – 24 Jan 2028, dari aturan gajian (tanggal 25, maju ke hari kerja sebelumnya bila Sabtu/Minggu) tanpa data libur; bukan dari `contoh-data.json`.
9. **Data ilustrasi:** LP12 memakai blok `angka_panjang` (satu kategori Rp 12.345.678.900; Pemasukan Rp 12.000.000 dari data Pribadi; Selisih −Rp 12.333.678.900 turunan). LP5 dan LP13 tidak memuat angka.

## 10. Peta bingkai → props

| Kode  | `ruang` | `basis`  | `periode` | `keadaan` | `tema` | `lebar` | Lain                     |
| ----- | ------- | -------- | --------- | --------- | ------ | ------- | ------------------------ |
| LP1   | pribadi | gajian   | 2026-10   | siap      | dark   | 390     |                          |
| LP2   | pribadi | gajian   | 2026-09   | siap      | dark   | 390     | `bukaTabel`              |
| LP3   | bersama | gajian   | 2026-10   | siap      | dark   | 390     | `bukaDapur`              |
| LP4   | pribadi | kalender | 2026-10   | siap      | dark   | 390     |                          |
| LP5   | pribadi | gajian   | 2026-04   | kosong    | dark   | 390     |                          |
| LP5b  | pribadi | gajian   | 2026-10   | siap      | dark   | 390     | `bagian=tren`, `trenN=2` |
| LP6   | pribadi | gajian   | 2026-10   | memuat    | dark   | 390     |                          |
| LP7   | pribadi | gajian   | 2026-10   | galat     | dark   | 390     |                          |
| LP8a  | pribadi | gajian   | 2026-10   | siap      | dark   | 1280    |                          |
| LP8b  | bersama | gajian   | 2026-10   | siap      | dark   | 1280    | `bukaDapur`              |
| LP9   | pribadi | gajian   | 2026-10   | siap      | dark   | 768     |                          |
| LP10  | pribadi | gajian   | 2026-10   | siap      | dark   | 320     |                          |
| LP11a | pribadi | gajian   | 2026-10   | siap      | light  | 390     | = LP1                    |
| LP11b | bersama | gajian   | 2026-10   | siap      | light  | 390     | = LP3                    |
| LP11c | pribadi | gajian   | 2026-10   | siap      | light  | 1280    | = LP8a                   |
| LP12a | pribadi | gajian   | 2026-10   | siap      | dark   | 320     | `panjang`                |
| LP12b | pribadi | gajian   | 2026-10   | siap      | dark   | 390     | `panjang`                |
| LP13  | pribadi | gajian   | 2028-01   | kosong    | dark   | 390     | `libur`                  |

## 11. Catatan untuk Task 13 (implementasi)

- Server component penuh; pemilih periode dan dasar periode hanya tautan (`?periode=2026-10&basis=gajian`). Tidak ada `'use client'` di Laporan.
- Semua ikon sudah ada di `apps/web/src/components/ui/icons/` (`chart-bar`, `plus-circle`, `minus-circle`, `arrow-down`, `cloud-slash`, `arrow-clockwise`, `film-slate`, dst.). Tidak ada ikon baru.
- Ganti hal yang hanya akal-akalan mock: `div role="table"` → `<table>`; `details` untuk subkategori dan tabel data memang dipertahankan (tanpa JS).
- Grafik: `div` berpersen atau SVG statis, nol JavaScript, jauh di bawah budget 162 kB.
- Tinggi plot, lebar batang, dan angka-angka bagian 6 adalah nilai kerja; boleh disetel di pratinjau selama batasan kontras dan "tanpa informasi hanya di hover" terjaga.
- Hal yang belum dirancang di sini: Anggaran, Tagihan, kartu "Aman dipakai" (prioritas 2 dan 3). Laporan sudah memakai baris status anggaran yang sama dengan BudgetRow.
