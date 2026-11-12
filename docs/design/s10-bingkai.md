# Bingkai desain S10 (anggaran rincian, Review bulanan, Ekspor CSV)

Gerbang awal S10 (IPD §0 butir 3, §5 S10; plan S10 Task 1). Ditulis agen mengikuti Panel Malam (`DESIGN.md`, `docs/design/panel-malam/README.md`, token `apps/web/src/styles/tokens.css`) dan format `docs/design/s9-bingkai.md`. Keputusan K1 sampai K7 di plan S10 adalah default; bingkai ini mengikatnya. ID `S10-*` dirujuk Task 5, 6, 8. Semua bingkai hanya untuk **mode nyata**; prototipe (`NEXT_PUBLIC_PROTOTYPE=1`) tidak berubah.

## Fakta kode yang membentuk bingkai

- **Anggaran = satu `BudgetItemView` per kategori induk** (Server Component, `features/rencana/`); sheet `Atur anggaran` (`budget-sheet.tsx`) adalah pulau klien malas dari `_real/rencana-islands.tsx`. S10 memperluas keduanya, tidak membuat sheet baru untuk rincian.
- **Aturan data (plan S10 Task 2 sampai 3):** rincian (sub) hanya boleh bila induk punya anggaran di periode yang sama; `Σ rincian ≤ induk`; rincian tidak punya `Wajib`; hanya anggaran induk dihitung di Aman dipakai dan Laporan; menghapus anggaran induk ikut menghapus rinciannya.
- **Uang dihitung di SQL (BSD §1.1).** UI tidak menjumlah atau mengurangi nominal anggaran. Karena itu `api.budget_overview` (Task 3) harus mengembalikan, selain `parent_id`: `sub_allocated` (induk: jumlah anggaran rinciannya) dan `max_amount` (rincian, termasuk yang belum beranggaran: batas atas yang masih boleh diisi = anggaran induk dikurangi anggaran rincian saudaranya). Plan S10 Task 3 diperbarui.
- **Review bulanan** tidak punya angka sendiri: semua dari fungsi yang dipakai Laporan (`period_trend`, `category_summary`, `budget_overview`, `budget_progress`), sehingga PRD "angka bulan lalu vs rencana sama dengan laporan" benar secara konstruksi.
- **Tidak ada rute Pengaturan dan tidak ada util CSV.** Menu → Export tetap placeholder "Segera" (K6); tombol Ekspor ada di Laporan.
- **Budget JS (batas 162 kB):** Rencana nyata 150,3, Laporan nyata 151,2 (handoff WA). Semua UI baru memakai Server Component atau pulau malas.

## Aturan bersama

Aturan bersama S6 sampai S9 berlaku (ruang selalu tertulis di judul sheet/toast; status = ikon + teks; target ≥ 44 dan jarak ≥ 8; 320 px tanpa gulir horizontal termasuk `Rp 12.345.678.900`; salinan galat **tanpa nominal**; tanpa "rumah tangga"; tanpa tanda seru; tangga status anggaran S9 tidak berubah dan dipakai untuk induk **dan** rincian).

## Rencana: anggaran rincian

### S10-SB1 · Daftar Anggaran dengan rincian

- **Tujuan:** melihat berapa dari batas induk sudah dibagi ke rincian, dan sisanya, tanpa membuka sheet.
- **Tata letak (HP):** baris induk tidak berubah (S9-AN1) kecuali satu baris tambahan di bawah teks sub (hanya bila induk punya ≥ 1 rincian): `Dibagi ke {n} rincian · Rp {sub_allocated}` 12/500 `text-muted`. Di bawah baris induk, daftar rincian bersarang (`ul` di dalam `li` induk): tiap rincian menjorok 16 dengan garis kiri 2 px `hairline` (struktur terlihat tanpa warna), tinggi min 64, nama 14/600, status kanan (tangga S9), bilah 4 px, sub `Rp {terpakai} dari Rp {anggaran}`. Rincian hanya yang **beranggaran**.
- **Aksi `Tambah rincian`:** tombol teks 44 px, ikon `plus`, menjorok sama dengan rincian, di bawah daftar rincian induk itu; tampil hanya bila induk punya ≥ 1 subkategori aktif yang belum beranggaran. Membuka S10-SB2 dengan induk terkunci.
- **Rincian terarsip yang masih beranggaran** tampil (label `Diarsipkan`, hanya `Hapus` di sheet), sama dengan induk terarsip S9.
- **Laptop (≥ 1024):** satu kolom `laptop:max-w-180` seperti S9; sheet menjadi dialog tengah 520.
- **Keadaan:** memuat/galat/kosong tidak berubah dari S9-AN1/RC0. Induk tanpa subkategori sama sekali tidak menampilkan apa pun tentang rincian (tanpa ajakan; subkategori dibuat di Kategori).
- **Komponen:** `BudgetItemView` (induk, ditambah baris `Dibagi ke…`), `BudgetSubItemView` (baru, Server Component), `buttonClass`, `CategoryIcon`. Tag `Wajib` hanya di induk.
- **ARIA:** `ul` bersarang dengan `aria-label="Rincian {induk}"`; nama aksesibel tombol rincian disusun dari isi terlihat (Label in Name); `Tambah rincian` bernama `Tambah rincian untuk {induk}`.

### S10-SB2 · Sheet `Atur anggaran` untuk rincian

- **Tujuan:** menyetel batas satu subkategori di dalam batas induknya.
- **Tata letak:** sheet S9-AN2 yang sama, judul `Anggaran rincian` + `SpaceTag`; kolom: **Induk** (teks terkunci di kotak `surface-2`, nama induk + `Anggaran Rp {anggaran induk}`), **Kategori** (`<select>` subkategori aktif induk itu yang belum beranggaran; saat dibuka dari baris rincian, terkunci), **Nominal** (`MoneyInput`, label `Anggaran periode ini`) dengan keterangan `Maksimal Rp {max_amount}` 12/500 `text-muted` (dari SQL, bukan dihitung UI). **Tanpa sakelar `Wajib`** (K3). Tombol `Hapus` hanya saat mengubah.
- **Sheet induk (S9-AN2) bertambah dua hal:** bila induk punya rincian, keterangan di bawah Nominal `Dibagi ke rincian Rp {sub_allocated}; anggaran induk tidak bisa lebih kecil dari itu.` dan konfirmasi hapus berubah (lihat salinan). Induk tanpa anggaran tidak menawarkan rincian.
- **Galat:** lihat "Salinan galat S10". Galat `sub_exceeds_parent` ditaruh di kolom Nominal (`role="alert"`, fokus pindah ke kolom, pola S6-C5), `parent_budget_required` di kotak atas sheet.
- **ARIA/Fokus:** judul = nama aksesibel dialog (`Anggaran rincian {Ruang}`); fokus awal Nominal bila induk dan kategori terkunci, selain itu Kategori; Esc menutup (kecuali menyimpan); fokus kembali ke pemicu.

## Review bulanan

### S10-RV1 · Layar `Review {Bulan}` (`/[ruang]/rencana/review?periode=YYYY-MM`)

- **Tujuan:** menjawab "bulan lalu aku sesuai rencana atau tidak?" lalu menyiapkan periode berikutnya dalam satu ketukan.
- **Masuk:** tautan `Review bulanan` (ikon `chart-bar`, 44 px) di bagian Anggaran Rencana di bawah kartu total, dan dari toast salin. Bawaan `periode` = periode yang **baru selesai** (bila hari ini di periode pertama data, periode berjalan). Hanya dasar **gajian** (anggaran terikat label periode gajian; tanpa pilihan bulan kalender).
- **Tata letak (HP, satu kolom):** (1) `PageHeader` `Review {Bulan}` + `SpaceTag`, pemilih periode ‹ › memakai `PeriodPicker` Laporan (rentang `{tgl} – {tgl} · lengkap` atau `· berjalan, {n} hari lagi`; ‹ sampai `2020-01`, › nonaktif di periode berjalan). (2) **Kartu Ringkasan** (`card`): `Terpakai` 13/600 + `Rp {terpakai}` `MoneyText` 28/800 + ` dari Rp {anggaran}` (hanya anggaran induk, label sr-only `dari anggaran`), bilah 6 px + status (tangga S9), lalu dua petak: `Pemasukan` dan `Selisih` (`Surplus`/`Defisit`/`Seimbang` dengan ikon; salinan Laporan), dan pembanding `Rp … lebih sedikit/lebih banyak dari {Bulan}` bila periode sebelumnya ada dan periode ini lengkap. (3) **Kartu `Rencana vs kenyataan`**: satu baris per induk beranggaran, urut: yang `Lewat` dulu, lalu terpakai terbesar; baris = `BudgetItemView` read-only (bukan tombol) + rincian di bawahnya sebagai `details/summary` ≥ 44 (pola Laporan, caret 16). Di bawahnya kelompok `Tanpa anggaran` (induk yang punya pengeluaran tetapi tanpa anggaran: nama + `Rp {terpakai}`, tanpa bilah) dengan tautan `Atur di Rencana` bila periode = berjalan. (4) **Kartu aksi `Siapkan {Bulan berikutnya}`** (lihat S10-RV2).
- **Laptop:** kolom kiri Ringkasan, kolom kanan Rencana vs kenyataan; kartu aksi penuh di bawah; DOM tidak berubah.
- **Keadaan:** (a) **memuat** `loading.tsx` skeleton berbentuk isi + `Memuat review…` `role="status"`; (b) **galat** `ErrorState` `Review belum bisa dimuat.` + tautan `Coba lagi`; (c) **periode tanpa anggaran** kartu `note` `Belum ada anggaran di periode ini.` + tautan `Ke Rencana`, Ringkasan tetap tampil bila ada transaksi; (d) **periode tanpa transaksi dan anggaran** `EmptyState` `Belum ada data di periode ini.`; (e) **periode berjalan**: lencana `Sementara` + `Periode belum selesai; angka masih bisa bertambah.`, tanpa pembanding; (f) libur belum diisi: catatan Laporan yang sama.
- **Bersama:** hanya data Bersama (B13), `SpaceTag` violet; tanpa nama orang kecuali yang sudah ada di Laporan.
- **ARIA:** tiap kartu `section aria-labelledby` ke `h2` (`Ringkasan`, `Rencana vs kenyataan`, `Tanpa anggaran`, `Siapkan {Bulan}`); bilah `aria-hidden` (angka sudah teks); `details` rincian punya nama dari isi; urutan DOM = urutan baca = urutan fokus.

### S10-RV2 · Kartu `Siapkan {Bulan berikutnya}` (salin dengan penyesuaian, K4)

- **Tampil hanya bila** periode yang dilihat adalah periode yang baru selesai atau periode berjalan **dan** punya ≥ 1 anggaran. Selain itu kartu tidak ada (tanpa tombol mati).
- **Isi:** judul `Siapkan {Bulan berikutnya}`; kalimat `Salin anggaran {Bulan ini} ke {Bulan berikutnya}. Yang sudah ada di tujuan tidak ditimpa.`; **pilihan penyesuaian** = kontrol segmen satu-pilihan (`role="radiogroup"`, 44 px) `Sama` (bawaan), `−10%`, `−5%`, `+5%`, `+10%`, dan `Lain…` yang membuka kolom angka bulat `−90` sampai `+100` (`inputMode="numeric"`, label `Penyesuaian (%)`); baris keterangan `Dibulatkan ke Rp1.000.`; tombol primer 48 `Salin {n} anggaran` (`n` = jumlah baris, bukan uang). Menyalin tidak pernah menimpa; hasil lewat toast.
- **Hasil (toast, tanpa nominal):** `{n} anggaran disalin ke {Bulan} · {Ruang}`; bila ada yang dilewati: ` · {k} dilewati (sudah ada, bentrok, diarsipkan, atau induknya dilewati)`; bila penyesuaian ≠ 0: ` · disesuaikan {±p}%`. Toast memuat tautan `Atur di Rencana` ke periode tujuan.
- **Keadaan:** menyalin (`Menyalin…`, tombol nonaktif, `aria-busy`), galat jaringan (kotak atas dengan `Coba lagi`; aman diulang karena idempoten), `0 anggaran disalin` bila semua sudah ada: toast `Semua anggaran sudah ada di {Bulan}.` dan tidak dianggap galat.
- **Komponen:** `SegmentedControl` (`components/ui/segmented-control.tsx`; kelasnya di `segment-styles.ts` yang server-safe, interaktif di pulau klien malas), `MoneyInput` tidak dipakai (persen, bukan uang), `Button`, `Toast`.

## Ekspor CSV

### S10-EX1 · Tombol `Ekspor CSV` di Laporan

- **Tujuan:** mengunduh semua transaksi periode yang sedang dilihat, untuk Excel/Sheets/arsip.
- **Letak:** baris aksi di bawah pemilih periode dan dasar periode, **di atas Ringkasan**, rata kanan di laptop, selebar penuh di 320. Tombol sekunder 44 px, ikon `export` (sudah ada, bold), teks `Ekspor CSV`; keterangan 12/500 `text-muted` di bawahnya `Semua transaksi {periode} · {Ruang}. Dibuka di Excel atau Sheets.`
- **Perilaku:** `<a href="/{ruang}/laporan/ekspor?periode=…&basis=…" download>` sebagai dasar (jalan tanpa JS); pulau klien malas menambah keadaan: klik → `fetch` → blob → unduh, tombol `Menyiapkan…` (`aria-busy`, nonaktif) agar galat tidak membuka halaman kosong. Berhasil: toast `Ekspor {periode} · {Ruang} selesai`. Nama berkas `dompetku-{ruang}-{periode}.csv`; tanpa nama orang.
- **Galat (tanpa nominal):** lihat salinan. `export_too_large` menyarankan memilih periode lebih pendek; batas laju memberi `Coba lagi nanti`.
- **Periode kosong:** tombol tetap ada; CSV hanya berisi baris judul (bukan galat); toast `Periode ini belum punya transaksi. Berkas hanya berisi judul kolom.`
- **Menu:** item `Export` di Menu tetap `Segera` (K6).
- **Komponen:** `Button`, `Toast`, ikon `export`. **ARIA:** nama aksesibel = teks terlihat + `, unduh berkas CSV`; status `Menyiapkan…` lewat `aria-live="polite"`.

## Salinan galat S10 (tanpa nominal)

| Kode                                       | Tempat                                              | Teks                                                                                                     |
| ------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `parent_budget_required`                   | kotak atas sheet rincian                            | `Atur anggaran {induk} dulu, baru rinciannya.`                                                           |
| `sub_exceeds_parent`                       | kolom Nominal (rincian)                             | `Rincian melebihi anggaran induk. Kecilkan nominal atau naikkan anggaran induk lebih dulu.`              |
| `sub_exceeds_parent`                       | kolom Nominal (induk diturunkan)                    | `Anggaran induk tidak boleh lebih kecil dari jumlah anggaran rinciannya.`                                |
| `sub_not_wajib`                            | tidak ditampilkan (sakelar tidak ada); bila terjadi | `Anggaran rincian tidak bisa diwajibkan. Wajib hanya untuk anggaran induk.`                              |
| `category_not_found` / `category_archived` | kolom Kategori                                      | salinan S9                                                                                               |
| `obligation_double`                        | sakelar `Wajib` (induk)                             | salinan S9                                                                                               |
| `invalid` (persen)                         | kolom `Penyesuaian (%)`                             | `Isi bilangan bulat antara −90 dan 100.`                                                                 |
| `export_too_large`                         | toast                                               | `Terlalu banyak transaksi untuk satu ekspor. Pilih periode yang lebih pendek.`                           |
| rate limit ekspor                          | toast                                               | `Terlalu sering mengunduh. Coba lagi nanti.`                                                             |
| jaringan/`unknown`                         | toast / kotak atas                                  | `Belum berhasil. Sambungan ke server terputus. Coba lagi.`                                               |
| loader review                              | `ErrorState`                                        | `Review belum bisa dimuat.` + `Sambungan ke server terputus. Catatan yang sudah tersimpan tidak hilang.` |

## Salinan final S10 (mengikat Task 5, 6, 8)

| Bingkai                   | Teks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rincian                   | `Dibagi ke {n} rincian · Rp …`; `Tambah rincian`; `Tambah rincian untuk {induk}`; `Anggaran rincian`; `Induk`; `Maksimal Rp …`; `Dibagi ke rincian Rp …; anggaran induk tidak bisa lebih kecil dari itu.`; `Rincian {induk}`                                                                                                                                                                                                                                                               |
| Hapus induk (AlertDialog) | `Hapus anggaran {induk}?` / tanpa rincian: `Pengeluaran kategori ini tetap tercatat. Hanya batasnya yang dihapus.` / dengan rincian: `Anggaran {n} rinciannya ikut dihapus. Pengeluaran tetap tercatat.` Tombol `Hapus anggaran`, `Kembali` (fokus awal `Kembali`). Toast `Anggaran {induk} dihapus · {Ruang}` (tanpa nominal).                                                                                                                                                            |
| Review                    | `Review bulanan`; `Review {Bulan}`; `Ringkasan`; `Rencana vs kenyataan`; `Tanpa anggaran`; `Atur di Rencana`; `Ke Rencana`; `Sementara`; `Belum ada anggaran di periode ini.`; `Belum ada data di periode ini.`; `Memuat review…`; `Siapkan {Bulan}`; `Salin anggaran {Bulan} ke {Bulan}. Yang sudah ada di tujuan tidak ditimpa.`; `Penyesuaian`; `Sama`; `Lain…`; `Penyesuaian (%)`; `Dibulatkan ke Rp1.000.`; `Salin {n} anggaran`; `Menyalin…`; `Semua anggaran sudah ada di {Bulan}.` |
| Ekspor                    | `Ekspor CSV`; `Menyiapkan…`; `Semua transaksi {periode} · {Ruang}. Dibuka di Excel atau Sheets.`; `Ekspor {periode} · {Ruang} selesai`; `Periode ini belum punya transaksi. Berkas hanya berisi judul kolom.`                                                                                                                                                                                                                                                                              |

## Target sentuh, urutan fokus, nama aksesibel

- Semua kontrol ≥ 44 dengan jarak ≥ 8: baris rincian (64), `Tambah rincian` (44), segmen penyesuaian (44 per pilihan), `Salin {n} anggaran` (48), `Ekspor CSV` (44), pemilih periode (‹ ›).
- **Urutan fokus Rencana (Anggaran):** segmen → `Review bulanan` → baris induk → rincian induk itu → `Tambah rincian` → induk berikut. **Review:** pengalih ruang → Menu → ‹ › → rincian/`details` per baris → `Atur di Rencana` → segmen penyesuaian → `Salin`. **Laporan:** … → dasar periode → `Ekspor CSV` → kartu.
- Status tidak pernah hanya warna; `Lewat`/`Terpakai penuh` memakai ikon + teks; sakelar/segmen memakai teks terlihat.

## Budget JS dan aturan implementasi

- Ukur dari `main` sebelum menambah apa pun dan laporkan `js-route-kB` dan `js-all-kB` (nyata) untuk Rencana, Review, Laporan; berhenti bila > 162. Targetnya Rencana ≤ 152, Review ≤ 150, Laporan ≤ 153.
- Server Component: `BudgetSubItemView`, `ReviewView`, daftar Rencana vs kenyataan. Pulau klien malas: sheet Anggaran (diperluas), kartu penyesuaian salin, tombol Ekspor. Tidak ada modul demo di bundel nyata.
- Ukuran uji layar (Task 5, 6, 8): 320, 390, 768, 1280; gelap dan terang; Pribadi dan Bersama; nama induk/rincian 40 huruf; `Rp 12.345.678.900` di Ringkasan dan baris; keadaan kosong, memuat, galat; axe tanpa pelanggaran serius.

## Keputusan agen atas nama pemilik (Task 1)

1. **Rincian beranggaran saja yang tampil di daftar**, subkategori tanpa anggaran muncul hanya lewat `Tambah rincian` (daftar tidak penuh baris kosong).
2. **`Maksimal Rp …` dan `sub_allocated` datang dari SQL** (bukan hitungan UI); menambah dua kolom ke `api.budget_overview` di Task 3.
3. **Review hanya dasar gajian**, bawaan = periode yang baru selesai; aksi salin hanya untuk periode yang baru selesai atau berjalan.
4. **Persen penyesuaian = pilihan cepat + `Lain…`**; tanpa mengubah nominal per baris di layar review (per baris tetap lewat editor Rencana).
5. **Ekspor memakai tautan unduh + pulau klien** agar jalan tanpa JS dan galat tidak membuka halaman kosong.
6. **Tombol Ekspor di Laporan, bukan Menu** (periode dan dasar terbawa).

## Self-review terhadap DESIGN.md (agen)

- Satu angka besar per layar dengan `SpaceTag`: Review memakai `Terpakai` sebagai angka besar; rincian tidak menambah angka besar.
- Aksen lime hanya untuk aksi primer (`Salin {n} anggaran`) dan fokus; status memakai token `warning`/`danger`/`chart-aman`; struktur induk-rincian lewat garis kiri + indentasi, bukan hue.
- Tanpa bayangan di kartu; radius 16 daftar, 20 kartu utama; ikon Phosphor yang sudah ada (`plus`, `chart-bar`, `export`, `warning*`, `caret-*`).
- Salinan tanpa "rumah tangga", tanpa tanda seru, galat tanpa nominal; keterangan `Maksimal Rp …` adalah data, bukan galat.
- Motion: tidak ada animasi baru (hanya transisi sheet 200 ms yang ada).

## Pertanyaan untuk pemilik

1. Selain Rencana, perlukah pengingat di Beranda `Review {Bulan} siap` pada hari gajian? Default: **tidak** (ditunda; tautan di Rencana cukup).
2. Menu → Export tetap `Segera` dan tombol hanya di Laporan: setuju (K6)?

## Untuk kursi design reviewer

Tiap task UI (5, 6, 8) menugaskan satu reviewer terpisah memeriksa: tangga status induk **dan** rincian identik; struktur induk-rincian terbaca tanpa warna di 320 px; `Maksimal Rp …`/`Dibagi ke rincian` tidak dipotong pada nominal panjang; kontrol penyesuaian dapat dipakai dengan satu tangan di HP; keadaan Ekspor (memuat, galat, kosong) benar; Label in Name; tidak ada nominal di toast/galat.

## Design critique dan Delivery Gate

Antislop mode DURING; Delivery Gate dijalankan sebagai daftar periksa manual (skill tidak tersedia, seperti S7 sampai S9). Screenshot: `docs/design/s10/` (320/390/1280, terang dan gelap, `SCREENS=1`): `sb1-daftar-rincian`, `sb2-sheet-rincian-{baru,ubah}`, `sb2-sheet-induk`, `rv1-review`, `ex1-laporan-ekspor`. Design review terpisah (subagent) untuk Task 5; Task 6 dan 8 dikritik penulis dari screenshot.

### Daftar periksa

| Butir                                                                                      | Hasil                                                           |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Token dan komponen Panel Malam dipakai ulang (tanpa warna/ikon baru, tanpa bayangan kartu) | lulus                                                           |
| Status = ikon + teks, tangga sama untuk induk dan rincian                                  | lulus (rincian `near/full/over` belum dipotret)                 |
| Target sentuh ≥ 44, jarak ≥ 8                                                              | lulus; pengecualian S9 untuk baris yang menempel (target 64/44) |
| 320 px tanpa gulir horizontal                                                              | lulus (e2e `noHorizontalScroll` di Rencana, Review, Laporan)    |
| axe tanpa pelanggaran serius, terang dan gelap                                             | lulus (`s9.spec` Review 320/1280, Rencana, Laporan)             |
| Label in Name, ul berlabel, urutan fokus = urutan DOM                                      | lulus                                                           |
| Salinan tanpa "rumah tangga", tanpa tanda seru, galat tanpa nominal                        | lulus (galat S10 dites tanpa digit)                             |
| Budget JS ≤ 162 kB, pulau malas                                                            | lulus (e2e budget Rencana, Review, Laporan)                     |

### Temuan

1. **S10-C1 (diperbaiki)** Review di HP tidak punya judul terlihat (`h1` sr-only, pemilih periode hanya menyebut bulan): ditambah judul dekoratif `Review bulanan` seperti Laporan.
2. **S10-C2 (diperbaiki)** Kotak Induk di sheet rincian hanya nominal tanpa kata `Anggaran`; `Maksimal` terpencil di akhir hint; kasus induk habis dibagi (Task 5 review).
3. **S10-C3 (diperbaiki)** Ekspor saat sesi habis mengunduh halaman masuk sebagai `.csv`: kini ditolak dengan toast `Sesi berakhir…` (review akhir).
4. **S10-C4 (catatan)** Nama rincian sangat panjang: caret ke tepi kanan saat status turun ke baris kedua (kosmetik).
5. **S10-C5 (catatan)** Tangga `near/full/over` pada rincian, `Rp 12.345.678.900` di baris rincian, Review dengan banyak induk, dan keadaan `Menyiapkan…` Ekspor belum dipotret.
6. **S10-C6 (catatan)** Review memakai dua kartu angka besar berurutan di HP (Ringkasan Laporan lalu Terpakai): padat; layak ditinjau bila pemilik merasa sesak.
