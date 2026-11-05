# Layar S9 DompetKu: Laporan, Anggaran, Tagihan, Beranda "aman dipakai"

Teks dalam tanda kutip adalah salinan yang diusulkan; boleh diperhalus selama artinya sama dan tetap tanpa istilah "rumah tangga". Angka dari `contoh-data.json` (tanggal demo Sab, 17 Okt 2026). Kode bingkai di kurung siku dipakai untuk mengembalikan hasil.

Kerangka aplikasi (header HP 66 px dengan pengalih ruang, tab bar `Beranda · Transaksi · [Catat] · Dompet · Rencana`, sidebar 248 px di ≥ 1024, Menu sebagai sheet) **tidak berubah**; lihat `docs/design/panel-malam/README.md` bagian Kerangka. Tambahan S9: item **Laporan** di Menu (dan di sidebar laptop di bawah Rencana), dan tautan "Laporan lengkap" di bawah Ringkasan Transaksi.

## Periode (berlaku untuk semua layar S9)

- **Periode gajian (bawaan):** dinamai bulan yang dibiayai gaji. Contoh di data: periode **"Oktober 2026" = 25 Sep – 22 Okt 2026** (berjalan, 6 hari lagi termasuk hari ini); **"September 2026" = 25 Agu – 24 Sep 2026** (lengkap). Periode berikutnya "November 2026" mulai 23 Okt.
- **Bulan kalender (pilihan tampilan di Laporan):** "Oktober 2026" = 1 – 31 Okt.
- Bila data libur nasional tahun itu belum diisi, tampil tanda kecil "Libur nasional 2027 belum diisi; hari gajian dihitung tanpa libur." (ikon `info` + teks, bukan peringatan merah).

---

## 1. Laporan (`/[ruang]/laporan`) · PRIORITAS 1 (wajib dipesan)

Tujuan: dalam satu layar tahu ke mana uang periode ini pergi, apakah lebih boros dari periode sebelumnya, dan apa yang sengaja tidak dihitung.

**Isi (urutan HP, satu kolom):**

1. **Header halaman:** "Laporan" + `SpaceTag` ruang. Laptop: label "Ruang Pribadi"/"Ruang Bersama" 12/800 kapital + H1.
2. **Pemilih periode:** IconButton ‹ · judul periode "Oktober 2026" 16/800 · ›; di bawahnya rentang "25 Sep – 22 Okt · berjalan, 6 hari lagi" (periode lengkap: "25 Agu – 24 Sep"). Tombol › nonaktif di periode berjalan. Segmen kecil **`Periode gajian | Bulan kalender`** (role tablist, item 44). Semua berupa tautan (tidak butuh JavaScript).
3. **Kartu ringkasan (satu angka besar):** usulan angka besar = **Pengeluaran** periode; di bawahnya tiga baris: Pemasukan (`+Rp …` warna `income`), Pengeluaran (`−Rp …`), **Selisih** (800; negatif `−Rp …` dengan ikon + kata "Defisit", bukan warna saja). Periode berjalan: catatan "Periode belum selesai; angka masih bisa bertambah." Perbandingan dengan periode sebelumnya boleh (mis. "Rp 1.383.500 lebih sedikit dari September"), dihitung dari data yang ada.
4. **Tidak termasuk:** kotak `surface-2` dengan daftar baris yang nilainya > 0 saja, masing-masing dengan penjelasan singkat:
   - Pribadi: "Kas kantor" (uang kantor, bukan uang pribadi), "Talangan kantor" (menunggu diganti), "Transfer antar dompet", "Setor ke Bersama", "Ambil dari Bersama", "Koreksi saldo".
   - Bersama: "Kontribusi anggota" (setoran dari Pribadi), "Diambil anggota", "Transfer antar dompet", "Koreksi saldo".
5. **Pengeluaran per kategori:** satu baris per kategori induk, urut terbesar: ikon kategori (Phosphor, tabel Assets di handoff), nama, nominal, persen dari total pengeluaran berkategori, dan **batang horizontal** proporsional. Kategori yang punya subkategori bisa dibuka (contoh data Bersama: "Belanja Dapur" → langsung Rp 1.120.000 + "Sayur & Buah" Rp 1.178.000) memakai pola `details`/disclosure 44 px. Bila kategori punya anggaran, baris menampilkan "dari anggaran Rp 3.000.000" dan status ≥ 80% / ≥ 100% (ikon + teks), tautan ke Rencana. Biaya transfer tidak berkategori: satu baris terakhir "Biaya transfer" bila > 0. Pemasukan per kategori sebagai blok kecil di bawahnya (Pribadi: Gaji; Bersama: Kontribusi Farida).
6. **Tren 6 periode (arus kas):** grafik pemasukan vs pengeluaran per periode (usulan: batang berpasangan, atau batang pengeluaran + garis pemasukan). Periode berjalan ditandai berbeda (pola garis/arsir + label "berjalan", bukan warna saja). Sumbu nilai ringkas (`Rp 12 jt`), label periode `Jun Jul Agu Sep Okt`. Wajib ada **tabel setara** (periode, pemasukan, pengeluaran, selisih) yang bisa dibuka atau terbaca pembaca layar. Data tren Pribadi punya 5 periode gajian (Jun–Okt) karena seed mulai Mei; tampilkan apa adanya dan rancang juga keadaan "baru ada 2 periode".
7. **Bersama saja: Kontribusi per orang** (pola kartu Kontribusi S8: avatar inisial N/F, nama, `Setor Rp …` utama, `Diambil Rp …` bila > 0; tanpa peringkat, persen, atau warna menang/kalah). Keterangan: "Setoran dan pengambilan antar ruang periode ini."

**Laptop (≥ 1024):** usulan dua kolom: kiri ringkasan + tidak termasuk + tren; kanan per kategori (+ Kontribusi di Bersama). Isi maks 1000 px. **Tablet (768):** isi maks 720, satu kolom atau ringkasan + tidak termasuk berdampingan.

**Bingkai yang diminta:**

| Kode | Bingkai                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------- |
| LP1  | Pribadi, periode gajian berjalan "Oktober 2026", HP 390, gelap                                                       |
| LP2  | Pribadi, periode lengkap "September 2026", HP 390, gelap (tren dengan 5 periode)                                     |
| LP3  | Bersama, periode berjalan, dengan Kontribusi dan subkategori "Belanja Dapur" terbuka, HP 390, gelap                  |
| LP4  | Pribadi, tampilan **Bulan kalender** "Oktober 2026" (1–31 Okt), HP 390, gelap                                        |
| LP5  | Kosong: periode tanpa transaksi ("Belum ada transaksi di periode ini." + tombol Catat); tren dengan 1–2 periode saja |
| LP6  | Memuat (skeleton berbentuk isi akhir + "Memuat laporan…" terlihat, `role="status"`)                                  |
| LP7  | Galat ("Laporan belum bisa dimuat." + sebab + "Coba lagi" sebagai tautan)                                            |
| LP8  | Laptop 1280 Pribadi dan Bersama, gelap                                                                               |
| LP9  | Tablet 768 Pribadi, gelap                                                                                            |
| LP10 | HP 320 Pribadi (tanpa gulir ke samping; label grafik tetap terbaca)                                                  |
| LP11 | Tema terang: LP1, LP3, LP8                                                                                           |
| LP12 | Angka panjang: Pengeluaran `Rp 12.345.678.900` dan nama kategori 40 karakter di 320 dan 390                          |
| LP13 | Tanda libur belum diisi (pemilih periode "Januari 2028")                                                             |

---

## 2. Anggaran (`/[ruang]/rencana`, segmen Anggaran) · PRIORITAS 2 (opsional; agen bisa merancang)

Tujuan: atur batas per kategori induk untuk periode ini dan lihat sisa dengan cepat. Anggaran Pribadi dan Bersama terpisah.

- **Header Rencana:** segmen `Anggaran | Tagihan` (role tablist, item 44), judul periode "Oktober 2026 · 25 Sep – 22 Okt".
- **Kartu total:** total anggaran vs terpakai periode ini (mis. Pribadi Rp 2.880.000 dianggarkan, terpakai Rp 1.439.500 pada tiga kategori beranggaran).
- **BudgetRow** (pola handoff): nama kategori + tag "Wajib" bila wajib, status kanan (≥ 80% `warning` + ikon `warning` fill + "85% terpakai"; ≥ 100% `danger` + ikon `warning-octagon` + "Lewat Rp 189.000"), bilah 6 px, sub "Rp 154.000 dari Rp 180.000 · sisa Rp 26.000". Baris = tombol/tautan "Atur" (44).
- **Belum dianggarkan:** kategori induk pengeluaran tanpa anggaran, dengan realisasi periode ini dan tautan "Atur".
- **Sheet Atur anggaran:** judul "Anggaran · Pribadi" (warna ruang), kategori (hanya kategori induk pengeluaran), nominal (pola Catat, pemisah ribuan saat mengetik), sakelar **Wajib** dengan satu kalimat "Dipotong dari aman dipakai sampai terpakai.", tombol "Simpan anggaran", dan "Hapus anggaran" (AlertDialog, fokus awal "Kembali").
- **Galat satu kewajiban:** "Kategori ini sudah punya tagihan Sewa rumah. Satu kewajiban cukup dicatat sekali: hapus tagihannya atau jadikan anggaran ini tidak wajib." (ikon `warning-circle` + teks, fokus ke sakelar Wajib).

| Kode | Bingkai                                                                  |
| ---- | ------------------------------------------------------------------------ |
| AN1  | Daftar Anggaran Pribadi, HP 390 gelap                                    |
| AN2  | Daftar Anggaran Bersama (ada "Makan di Luar" lewat batas), HP 390 gelap  |
| AN3  | Sheet Atur anggaran (baru dan ubah), HP + dialog laptop                  |
| AN4  | Galat satu kewajiban di sheet                                            |
| AN5  | Rencana kosong: "Atur anggaran pertama" + "Tambah tagihan", tanpa "Rp 0" |
| AN6  | Laptop 1280 dan terang                                                   |

---

## 3. Tagihan rutin (`/[ruang]/rencana`, segmen Tagihan) · PRIORITAS 2 (opsional; agen bisa merancang)

Tujuan: lihat tagihan yang harus dibayar, bayar dengan satu sheet, dan atur tagihan bulanan.

- **Kelompok:** "Lewat jatuh tempo", "Periode ini", "Berikutnya", lalu "Diarsipkan" (terlipat). **BillRow** (pola handoff): ubin tanggal 44×44 (hari 10/700 kapital + tanggal 17/800), nama, sub ("4 hari lagi" ikon `clock`; "Lewat 3 hari" ubin `danger-tint` + ikon `warning-circle` fill; "Lunas · 21 Sep" ikon `check-circle`; "Dilewati" ikon `skip-forward`), nominal, tombol **Bayar** (44) di baris belum dibayar.
- **Sheet Tambah/Ubah tagihan:** nama, nominal, kategori pengeluaran (induk atau sub), dompet bayar bawaan (hanya dompet ruang ini, bukan Kas Kantor), "Tanggal tiap bulan" 1–31 (keterangan "Tanggal 29–31 jatuh ke hari terakhir bulan pendek."), "Mulai" (masa lalu → keterangan "Bulan sebelum Oktober tidak ditagih."), "Berakhir" opsional, "Simpan tagihan". Ubah: keterangan "Berlaku untuk tagihan yang belum dibayar mulai hari ini." + "Arsipkan tagihan" (AlertDialog).
- **Sheet Bayar:** judul "Bayar Listrik PLN · Bersama", nominal terisi nominal tagihan dan bisa diubah (keterangan "Perkiraan Rp 485.000" bila diubah), dompet, tanggal bayar ("Hari ini" s.d. 13 hari lalu), peringatan saldo kurang (pola Catat), tombol "Bayar Rp 485.000"; aksi sekunder "Lewati bulan ini" (untuk tagihan yang sudah dibayar di luar aplikasi). Sesudah bayar: toast "Tagihan Listrik PLN dibayar · Rp 485.000 dari Kas Rumah" + "Urungkan".

| Kode | Bingkai                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| TG1  | Daftar Tagihan Bersama (ada "Iuran kebersihan RT" lewat 3 hari), HP 390 gelap |
| TG2  | Daftar Tagihan Pribadi dengan kelompok "Lunas" periode lalu                   |
| TG3  | Sheet Tambah tagihan (mulai di masa lalu) dan Ubah tagihan                    |
| TG4  | Sheet Bayar (nominal diubah, saldo kurang)                                    |
| TG5  | Galat satu kewajiban ("Sewa Rumah" sudah beranggaran wajib)                   |
| TG6  | Laptop 1280 dan terang                                                        |

---

## 4. Beranda: kartu "aman dipakai" dengan keadaan · PRIORITAS 3 (opsional)

Kartu yang sudah ada (AmanCard, handoff B1/B6) kini memuat tagihan dan anggaran wajib nyata dan batasnya **sehari sebelum gajian**: "Aman dipakai sampai 22 Okt". Tambahan S9: **status** di baris judul atau di bawah angka, selalu ikon + teks:

- **Aman** (ikon `check-circle`): total ≥ 0 dan jatah per hari ≥ rata-rata belanja harian 30 hari terakhir.
- **Hati-hati** (ikon `warning`, `warning`): total ≥ 0 tetapi jatah per hari di bawah rata-rata belanja, **atau** ada tagihan lewat jatuh tempo. Satu kalimat sebab: "Ada 1 tagihan lewat jatuh tempo." (data Bersama) / "Rata-rata belanjamu Rp … per hari, lebih dari jatah harian." (pola kalimat; data demo tidak punya contoh ini, jadi cukup tunjukkan bentuknya di BR4)
- **Lewat batas** (ikon `warning-octagon` fill, `danger`): total < 0; kalimat B6 "Pengeluaran wajib bulan ini melebihi saldo operasional." (boleh diperhalus menjadi "…periode ini…").

Di bawah kartu: **Tagihan 7 hari** (BillRow) dan **Anggaran hampir habis** (BudgetRow ≥ 80%), masing-masing dengan "Semua ›" ke Rencana.

| Kode | Bingkai                                                      |
| ---- | ------------------------------------------------------------ |
| BR1  | Pribadi "Aman" (periode gajian, sampai 22 Okt), HP 390 gelap |
| BR2  | Bersama "Hati-hati" (tagihan lewat), HP 390 gelap            |
| BR3  | "Lewat batas" (data ilustrasi di `contoh-data.json`)         |
| BR4  | Tiga keadaan berdampingan di 320 dan terang                  |

---

## Keadaan yang wajib dirancang (semua layar yang dipesan)

Kosong (tanpa "Rp 0" tanpa ajakan), memuat (skeleton + teks terlihat), galat (sebab + tindakan), fokus keyboard (garis 2 px `focus`), nonaktif, sheet/dialog terbuka, toast, 320 / 390 / 768 / 1280, gelap dan terang, Pribadi dan Bersama.
