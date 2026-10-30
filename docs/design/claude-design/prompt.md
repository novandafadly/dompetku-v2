# Prompt utama untuk Claude Design

Salin semua teks di bawah garis ke Claude Design, lalu lampirkan `layar.md`, `batasan.md`, dan `contoh-data.json`.

---

Kamu adalah product designer senior. Tolong rancang tampilan **DompetKu**, aplikasi pencatat keuangan pribadi dan bersama untuk dua orang (pasangan: Novanda dan Farida). Aplikasinya sudah berjalan sebagai prototipe; alur dan fungsinya sudah benar. Gaya visualnya **sepenuhnya kamu yang tentukan**: warna, huruf, mood, gelap atau terang, kepadatan, komponen. Saya ingin hasil yang terasa modern, berkarakter, dan enak dipakai setiap hari, bukan tampilan template.

## Konteks produk

- Dipakai harian di HP (390 px), kadang di laptop (1280 px). Bahasa antarmuka: Indonesia.
- Ada dua **ruang**: **Pribadi** (milik masing-masing) dan **Bersama** (dompet bersama pasangan). Pengguna berpindah ruang dengan satu ketukan. Ruang aktif harus selalu jelas, lewat teks dan bukan warna saja.
- Navigasi HP: tab bar bawah `Beranda · Transaksi · [Catat] · Dompet · Rencana`; "Menu" di header. Laptop: sidebar kiri.
- Aksi terpenting: **Catat** pengeluaran dalam ≤ 3 ketukan (buka → ketik nominal → pilih kategori → Simpan).
- Angka terpenting di Beranda: **"Aman dipakai sampai 31 Okt"** = saldo dompet operasional − tagihan belum dibayar s.d. akhir bulan − sisa anggaran wajib, plus "≈ Rp … per hari untuk 15 hari".

## Yang saya minta

1. **Tiga arah visual yang benar-benar berbeda**, masing-masing satu layar Beranda Pribadi versi HP. Beri nama, satu kalimat alasan, dan paletnya.
2. Setelah saya memilih: rancang **semua layar** di `layar.md` untuk HP 390 px dan laptop 1280 px, termasuk keadaan kosong, memuat, galat, dan sheet terbuka. Sediakan tema terang dan gelap (salah satunya bawaan, kamu yang usulkan).
3. **Spesifikasi untuk developer:** token warna (gelap dan terang, dengan rasio kontras), skala spasi, radius, tipografi, daftar komponen dan keadaannya (default, hover, aktif, fokus, nonaktif), dan catatan layout per breakpoint. Pakai nama token semantik di `batasan.md` supaya mudah dipasang ke kode.

## Wajib

Ikuti `batasan.md`: semua angka dari `contoh-data.json` (jangan mengarang angka, nama, atau testimoni), format rupiah `Rp 1.250.000`, kontras WCAG AA, target sentuh ≥ 44 px, dan privasi antar ruang.
