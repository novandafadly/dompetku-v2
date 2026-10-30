# Brief untuk Claude Design

Brief ini dipakai untuk merancang tampilan DompetKu di Claude Design. Gaya visual sengaja tidak ditentukan; Claude Design yang mengusulkan. Hasilnya diterapkan ke kode tanpa mengubah fungsi.

## Isi

| File               | Untuk apa                                                |
| ------------------ | -------------------------------------------------------- |
| `prompt.md`        | Prompt utama: salin ke Claude Design                     |
| `layar.md`         | Semua layar, isi, teks, dan keadaannya                   |
| `batasan.md`       | Aturan wajib: data, privasi ruang, aksesibilitas, teknis |
| `contoh-data.json` | Angka demo nyata dari aplikasi (17 Okt 2026)             |

## Cara pakai

1. Buka Claude Design, buat proyek baru.
2. Lampirkan `layar.md`, `batasan.md`, `contoh-data.json`.
3. Tempel isi `prompt.md` (bagian di bawah garis).
4. Pilih satu dari tiga arah yang ditawarkan, lalu minta semua layar dirancang.
5. Ulangi sampai kamu dan Farida puas.

## Bawa hasilnya balik

Minta Claude Design mengekspor:

1. Token final sebagai CSS variable dengan nama di `batasan.md` (gelap dan terang), plus rasio kontras.
2. Spesifikasi komponen: radius, spasi, huruf, keadaan (hover, aktif, fokus, nonaktif).
3. Screenshot atau link tiap layar di 390 px dan 1280 px, kedua tema.
4. HTML/React contoh bila ada (acuan saja).

Simpan di `docs/design/claude-design/hasil/` atau kirim link-nya. Agen lalu memperbarui `DESIGN.md` + ADR, mengganti token dan komponen, menjalankan semua tes dan Delivery Gate antislop, dan mengirim pratinjau baru.
