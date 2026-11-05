# Prompt utama untuk Claude Design (S9)

Salin semua teks di bawah garis ke Claude Design, lalu lampirkan `layar.md`, `batasan.md`, `contoh-data.json`, `DESIGN.md`, `docs/design/panel-malam/README.md`, dan `docs/design/panel-malam/dompetku-tokens.css`.

---

Kamu adalah product designer senior. Tolong rancang layar baru untuk **DompetKu**, aplikasi pencatat keuangan pribadi dan bersama untuk dua orang (Novanda dan Farida). Aplikasinya sudah berjalan dengan arah visual **"Panel Malam"** (lampiran `DESIGN.md`, `README.md` handoff, dan `dompetku-tokens.css`): hampir hitam kehijauan, satu angka besar per layar, aksen lime hanya di saat penting, Bersama bernuansa violet. **Jangan mengusulkan gaya baru.** Pakai token, huruf, radius, dan komponen yang sudah ada; tambah token hanya bila benar-benar perlu (mis. warna seri grafik) dan sebutkan alasannya.

## Konteks produk

- Dipakai harian di HP (390 px, harus rapi di 320 px), kadang di laptop (1280 px, sidebar kiri). Bahasa antarmuka: Indonesia.
- Ada dua **ruang**: **Pribadi** (milik masing-masing) dan **Bersama** (dompet bersama). Ruang aktif selalu tertulis (teks + `SpaceTag`), bukan warna saja. Ruang Bersama tidak pernah menampilkan data Pribadi siapa pun.
- Gaji Novanda dan Farida tanggal 25. Karena itu anggaran dan laporan memakai **periode gajian**: periode "Oktober 2026" = 25 Sep sampai 22 Okt 2026 (25 Okt hari Minggu, jadi gajian maju ke Jumat 23 Okt). Pengguna bisa memilih tampilan **bulan kalender** (1 sampai 31 Okt). Angka di kedua tampilan berasal dari satu sumber; hanya potongan tanggalnya yang berbeda.
- Aturan angka: **Pengeluaran** = pengeluaran biasa + biaya transfer. Yang **tidak termasuk** pemasukan/pengeluaran: Kas Kantor (uang kantor), talangan kantor, transfer antar dompet, setor/ambil antara Pribadi dan Bersama (di Bersama disebut "Kontribusi"), dan koreksi saldo. Layar harus jujur menunjukkan apa yang tidak dihitung.

## Yang saya minta

1. **Prioritas 1 (wajib): layar Laporan** (`layar.md` bagian 1) untuk Pribadi dan Bersama: ringkasan periode, "tidak termasuk", pengeluaran per kategori (dengan subkategori), tren 6 periode (arus kas masuk/keluar), dan Kontribusi per orang di Bersama. Semua keadaan: periode berjalan, periode lengkap, kosong, memuat, galat; HP 320, 390, tablet 768, laptop 1280; gelap dan terang.
2. **Grafik yang bisa dibangun tanpa library animasi**: idealnya SVG statis (batang horizontal, batang berpasangan, atau garis sederhana) yang bisa dirender di server. Interaksi (tooltip, sorot) tidak boleh menjadi satu-satunya cara membaca angka: setiap grafik punya label langsung atau tabel data setara.
3. **Bila waktu cukup (prioritas 2 dan 3):** Anggaran, Tagihan rutin, dan kartu "Aman dipakai" dengan tiga keadaan (`layar.md` bagian 2 sampai 4), memakai pola komponen yang sudah ada (BudgetRow, BillRow, AmanCard).
4. **Spesifikasi untuk developer** per bingkai: kode bingkai (LP1, LP2, …), token yang dipakai, ukuran/tebal huruf, spasi, urutan fokus, nama aksesibel, perilaku 320 px dan angka panjang, dan token baru beserta rasio kontrasnya.

## Wajib

Ikuti `batasan.md`: semua angka dari `contoh-data.json` (jangan mengarang angka, nama, kategori, atau testimoni), format `Rp 1.250.000`, negatif dengan tanda minus U+2212 (`−Rp 35.000`), status selalu ikon + teks, kontras WCAG AA di kedua tema, target sentuh ≥ 44 px, privasi antar ruang, dan tanpa istilah "rumah tangga" (pakai "bersama").
