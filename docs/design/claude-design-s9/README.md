# Pesanan Claude Design S9: Laporan dan grafik

Paket ini dipakai untuk memesan layar besar baru S9 di Claude Design (IPD §8: "Laporan dan grafik", S9). Berbeda dari brief M0a (`docs/design/claude-design/`), arah visual **sudah ditetapkan**: Panel Malam (ADR 0006). Claude Design diminta merancang layar baru di dalam sistem itu, bukan mengusulkan gaya baru. Hasilnya diterapkan ke kode di S9 Task 13 (plan `docs/superpowers/plans/2026-11-05-dompetku-v2-s9-anggaran-laporan.md`).

## Isi

| File               | Untuk apa                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `prompt.md`        | Prompt utama: salin ke Claude Design                                                       |
| `layar.md`         | Layar, isi, teks, dan keadaan; prioritas per layar                                         |
| `batasan.md`       | Aturan wajib: data, privasi ruang, aksesibilitas, teknis, budget JS                        |
| `contoh-data.json` | Angka demo dari seed aplikasi (17 Okt 2026), versi bulan kalender dan versi periode gajian |

Lampiran dari repo (bukan bagian paket ini, tapi wajib ikut dilampirkan):

| File                                                   | Untuk apa                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `DESIGN.md`                                            | Ringkasan arah Panel Malam                                    |
| `docs/design/panel-malam/README.md`                    | Spesifikasi komponen yang mengikat (AmanCard, ListCard, dst.) |
| `docs/design/panel-malam/dompetku-tokens.css`          | Token warna, huruf, radius                                    |
| `docs/design/panel-malam/designs/*.dc.html` (opsional) | Bingkai lama sebagai acuan gaya (B1–B7, T1–T5, L1–L6, G1–G10) |

## Prioritas

| Prioritas     | Layar                                                   | Dipesan?                                                                                        |
| ------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **1 (wajib)** | Laporan: ringkasan, tidak termasuk, per kategori, tren  | Ya. S9 Task 13 menunggu hasilnya                                                                |
| 2 (opsional)  | Anggaran per ruang (daftar + sheet Atur anggaran)       | Agen bisa merancang sendiri dengan pola BudgetRow (rekomendasi K9). Pesan bila ingin pembanding |
| 2 (opsional)  | Tagihan rutin (daftar, sheet Tambah/Ubah, sheet Bayar)  | Sama: pola BillRow                                                                              |
| 3 (opsional)  | Beranda "aman dipakai" keadaan Aman / Hati-hati / Lewat | Sama: pola AmanCard. Paling kecil; cukup bila pemilik ingin melihat tiga keadaan berdampingan   |

Saran: pesan prioritas 1 dulu. Bila sesi Claude Design masih longgar, tambahkan prioritas 2 di percakapan yang sama supaya gaya grafik dan baris anggaran seragam.

## Cara pakai

1. Buka proyek Claude Design yang dipakai untuk Panel Malam (bila masih ada), atau buat proyek baru.
2. Lampirkan `layar.md`, `batasan.md`, `contoh-data.json`, ditambah `DESIGN.md`, `docs/design/panel-malam/README.md`, dan `docs/design/panel-malam/dompetku-tokens.css`.
3. Tempel isi `prompt.md` (bagian di bawah garis).
4. Minta Laporan dulu (HP 390 gelap), nilai, lalu minta sisa keadaan dan lebar.
5. Ulangi sampai kamu dan Farida puas. Periksa angka: harus sama dengan `contoh-data.json`.

## Bawa hasilnya balik

Minta Claude Design mengekspor:

1. **Bingkai berkode** (`.dc.html` atau link) untuk setiap layar dan keadaan di `layar.md`, memakai kode yang sama (LP1, LP2, …; AN1…, TG1…, BR1… bila dipesan), di 390 dan 1280 (plus 320 dan 768 untuk Laporan), gelap dan terang.
2. **Token baru** bila ada (mis. warna seri grafik), sebagai CSS variable bernama semantik, gelap dan terang, dengan rasio kontras terhadap `surface` dan `bg` (grafik ≥ 3:1, teks ≥ 4,5:1).
3. **Spesifikasi per bingkai:** ukuran huruf/tebal, spasi, radius, urutan fokus, nama aksesibel elemen interaktif, perilaku di 320, apa yang terjadi saat angka sangat panjang (`Rp 12.345.678.900`).
4. **Spesifikasi grafik:** jenis, sumbu, label, legenda, perlakuan nilai 0 dan negatif, periode berjalan, dan tabel data setara untuk pembaca layar.
5. HTML/React contoh bila ada (acuan saja, bukan kode produksi).

Simpan di `docs/design/claude-design-s9/hasil/` (berkas) atau kirim link-nya. Agen lalu menulis bingkai `S9-LP*` di `docs/design/s9-bingkai.md`, memasang token baru (dengan uji kontras), membangun Laporan, menjalankan semua tes dan Delivery Gate antislop, dan mengirim pratinjau.
