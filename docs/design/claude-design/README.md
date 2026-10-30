# Paket desain untuk Claude Design

Paket ini dipakai untuk merancang ulang tampilan DompetKu di Claude Design, dengan hasil yang bisa langsung diterapkan ke kode tanpa mengubah fungsi.

## Isi paket

| File                                      | Untuk apa                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `prompt.md`                               | Prompt utama: salin ke Claude Design                                        |
| `layar.md`                                | Daftar semua layar, isi, teks, dan keadaannya                               |
| `batasan.md`                              | Aturan wajib: data, privasi ruang, aksesibilitas, layout, anti-slop, teknis |
| `contoh-data.json`                        | Angka demo nyata dari aplikasi (17 Okt 2026)                                |
| `../../../DESIGN.md`                      | Arah visual sekarang (gelap premium)                                        |
| `../../../apps/web/src/styles/tokens.css` | Token warna yang dipakai kode sekarang                                      |
| `../../screenshots/m0a/*-390-dark.png`    | Tampilan sekarang, untuk perbandingan                                       |

## Cara pakai

1. Buka Claude Design, buat proyek baru.
2. Lampirkan: `DESIGN.md`, `layar.md`, `batasan.md`, `contoh-data.json`, `tokens.css`, dan 3–4 screenshot (`pribadi-beranda-390-dark.png`, `pribadi-transaksi-390-dark.png`, `pribadi-dompet-390-dark.png`, `bersama-beranda-390-dark.png`).
3. Tempel isi `prompt.md` (bagian di bawah garis).
4. Pilih satu dari tiga arah yang ditawarkan, lalu minta semua layar dirancang.
5. Ulangi sampai kamu dan Farida puas.

## Bawa hasilnya balik ke repo

Supaya saya bisa menerapkannya tanpa menebak, minta Claude Design mengekspor:

1. **Token final** sebagai CSS variable dengan nama token yang sama seperti di `tokens.css` (tema gelap dan `[data-theme="light"]`), plus rasio kontrasnya.
2. **Spesifikasi komponen**: radius, spasi, ukuran huruf, berat, dan keadaan (hover, aktif, fokus, nonaktif).
3. **Screenshot atau link** tiap layar di 390 px dan 1280 px, gelap dan terang.
4. **HTML/React contoh** bila ada (opsional, sebagai acuan, bukan disalin mentah).

Simpan semuanya di `docs/design/claude-design/hasil/` (atau kirim link artifact-nya ke saya). Setelah itu, saya:

- memperbarui `DESIGN.md` dan menulis ADR baru;
- mengganti token, lalu menyesuaikan komponen dan layar;
- menjalankan semua tes (fungsi, kontras, aksesibilitas, 320 px, budget JS) dan Delivery Gate antislop;
- mengirim pratinjau baru untuk dinilai.

Fungsi, alur, dan data tidak berubah; hanya tampilan.
