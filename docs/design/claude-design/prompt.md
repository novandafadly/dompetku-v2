# Prompt utama untuk Claude Design

Salin semua teks di bawah garis ke Claude Design, lalu lampirkan file yang disebut di bagian "Lampiran".

---

Kamu adalah product designer senior. Tolong rancang ulang tampilan **DompetKu**, aplikasi pencatat keuangan pribadi dan bersama untuk dua orang (pasangan: Novanda dan Farida). Aplikasinya sudah berjalan sebagai prototipe dengan data demo. Fungsi dan alurnya sudah benar; yang perlu diperbaiki adalah **rasa visual**: sekarang terasa kaku dan belum "premium".

## Konteks produk

- Dipakai harian di HP (390 px), kadang di laptop (1280 px). Bahasa antarmuka: Indonesia.
- Ada dua **ruang**: **Pribadi** (milik masing-masing) dan **Bersama** (dompet bersama pasangan). Pengguna berpindah ruang dengan satu ketukan. Ruang harus selalu jelas lewat **teks dan warna**, tidak warna saja.
- Navigasi HP: tab bar bawah `Beranda · Transaksi · [Catat] · Dompet · Rencana`; "Menu" di header. Laptop: sidebar kiri 248 px.
- Aksi terpenting: **Catat** pengeluaran dalam ≤ 3 ketukan (buka sheet → ketik nominal → pilih kategori → Simpan).
- Angka terpenting di Beranda: **"Aman dipakai sampai 31 Okt"** = saldo dompet operasional − tagihan belum dibayar s.d. akhir bulan − sisa anggaran wajib, plus "≈ Rp … per hari untuk 15 hari".

## Arah visual (dari pemilik)

Baca `DESIGN.md`. Ringkasnya: **gelap premium** seperti kartu bank premium di saku; tenang, tegas, rapi; angka besar; permukaan berlapis datar tanpa bayangan besar; satu aksen per ruang (usulan sekarang: Pribadi biru langit `#6CB4FF`, Bersama emas `#F4B860`, boleh kamu usulkan ulang); tema terang tetap ada. Huruf: Plus Jakarta Sans. Ikon: Phosphor.

Kamu boleh mengubah palet, tipografi, kepadatan, komposisi, dan komponen. **Jangan** mengubah alur, isi data, label navigasi, atau aturan di `batasan.md`.

## Yang saya minta

1. **Tiga arah visual berbeda** (bukan variasi warna saja), masing-masing satu layar Beranda Pribadi versi HP. Beri nama, satu kalimat alasan, dan palet tokennya.
2. Setelah saya memilih satu arah: rancang **semua layar** di `layar.md` untuk HP 390 px dan laptop 1280 px, tema gelap (utama) dan terang. Termasuk keadaan kosong, memuat, galat, dan sheet terbuka.
3. **Spesifikasi untuk developer**: tabel token final (warna gelap+terang dengan rasio kontras, skala spasi, radius, tipografi), daftar komponen dan variannya (default, hover, aktif, fokus, nonaktif), dan catatan layout per breakpoint.

## Aturan keras

Ikuti `batasan.md`. Paling penting: semua angka dari `contoh-data.json` (jangan mengarang angka, nama, atau testimoni); format rupiah `Rp 1.250.000`; kontras WCAG AA; target sentuh ≥ 44 px; tanpa gradien ungu-biru, glow, glassmorphism di mana-mana, atau emoji; tanpa em dash.

## Lampiran

`DESIGN.md`, `layar.md`, `batasan.md`, `contoh-data.json`, `tokens.css` (token yang dipakai kode sekarang), dan screenshot tampilan saat ini dari `docs/screenshots/m0a/` (untuk perbandingan, bukan untuk ditiru).
