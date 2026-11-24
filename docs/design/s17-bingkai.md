# Bingkai Desain S17 — Catat teks bebas (Ketik cepat)

**Tanggal:** 2026-11-24  
**Arah visual:** Panel Malam (`DESIGN.md`), token semantik yang ada (`bg-surface`, `bg-bg`, `border-hairline`, `border-border`, `text-text`, `text-text-soft`, `text-text-muted`, `text-accent-text`, `bg-accent-tint`, `bg-danger-tint`, `text-danger`), tanpa warna baru dan tanpa ikon pihak ketiga baru.  
**Prinsip antislop:** tanpa `Rp 0`, tanpa `!`, tanpa "rumah tangga", tanpa emoji, tanpa istilah Inggris terlarang, target sentuh >= 44 px, bersih pada 320 / 390 / 1280 px gelap & terang, prototipe tidak berubah, budget JS <= 162 kB.

## Komponen & Alur (S17-TB*)

| ID          | Komponen                          | Tempat                                                                         | Perilaku                                                                                                                                                                                                                                           |
| ----------- | --------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S17-TB1** | Bilah `Ketik cepat`               | Bagian atas `CatatSheet` (mode nyata saja, saat bukan preset & bukan transfer) | Kolom teks satu baris (`min-h-11`, maks 300 huruf, placeholder `Misal: makan 35rb bca`) + tombol `Isi` (`min-h-11`). Tekan Enter atau klik `Isi` memanggil `parseFreeTextAction`.                                                                  |
| **S17-TB2** | Banner pratinjau wajib konfirmasi | Tepat di bawah bilah `Ketik cepat` sesudah terbaca                             | Menampilkan ikon `InfoIcon` + sumber (`Terbaca otomatis` / `Terbaca dengan Gemini` / `Terbaca dengan Claude`) + kalimat `Periksa nominal, kategori, dan dompet sebelum simpan.` serta sisa kuota bila memakai AI. Tidak pernah otomatis menyimpan. |
| **S17-TB3** | Umpan balik gagal / kuota habis   | Tepat di bawah bilah `Ketik cepat` (`role="alert"`)                            | Jika teks tidak punya nominal atau format tidak dikenali: kalimat jelas berbahasa Indonesia dengan contoh format. Jika kuota AI harian (15/15) habis: menyebut parser aturan tetap jalan untuk format langsung seperti `makan siang 35rb bca`.     |

## Salinan final S17 (Bahasa Indonesia, tanpa `!`, tanpa `Rp 0`)

- Label kolom: `Ketik cepat`
- Placeholder: `Misal: makan 35rb bca`
- Tombol: `Isi` (saat memuat: `Membaca…`)
- Banner sumber:
  - `rules`: `Terbaca otomatis. Periksa isian di bawah sebelum simpan.`
  - `gemini`: `Terbaca dengan Gemini. Periksa isian di bawah sebelum simpan.`
  - `anthropic`: `Terbaca dengan Claude. Periksa isian di bawah sebelum simpan.`
- Sisa kuota (opsional, saat memakai AI): `(rem, lim) => \`Sisa bantuan AI hari ini: ${rem} dari ${lim}.\``
- Peringatan kuota habis (aturan tetap jalan): `Kuota AI hari ini habis. Format langsung seperti "makan siang 35rb bca" tetap bisa dipakai.`
- Galat tidak terbaca: `Nominal belum terbaca. Coba tulis misalnya "makan siang 35rb bca".`
- Galat tanggal masa depan: `Tanggal di masa depan belum didukung. Pakai tanggal hari ini atau sebelumnya.`
- Galat jaringan/server: `Belum bisa membaca kalimat. Isi manual atau coba lagi.`
