# DESIGN.md: arah visual DompetKu v2 (Panel Malam)

Sumber: handoff "Panel Malam" yang dirancang pemilik di Claude Design (2026-10-31), disimpan utuh di [`docs/design/panel-malam/`](docs/design/panel-malam/). Handoff itu sumber kebenaran: `README.md` (spesifikasi mengikat), `dompetku-tokens.css` (token), dan `designs/*.dc.html` (bingkai B1–B7, C1–C5, T1–T5, D1–D4, W1–W4, R1, A1–A4, L1–L6, X1, G1–G10). Dokumen ini ringkasannya untuk agen dan menggantikan arah "gelap premium" (ADR 0005, biru/emas). Keputusan: [ADR 0006](docs/adr/0006-panel-malam.md). Laporan implementasi: [`IMPLEMENTATION-REPORT.md`](docs/design/panel-malam/IMPLEMENTATION-REPORT.md).

## Identitas

- **Kepribadian:** panel instrumen malam hari. Hampir hitam kehijauan, satu angka besar yang langsung terbaca, aksen lime yang hanya muncul di saat penting.
- **Untuk siapa:** Novanda dan Farida, cek cepat sebelum jajan (sering malam), mencatat di HP, sesekali di laptop.
- **Dial:** ENERGY 2 / RHYTHM 2 / MOTION 1 (transisi sheet 200 ms dan toast 160 ms saja; mati di `prefers-reduced-motion`).

## Tema

- **Gelap bawaan.** Tema terang dan "Ikuti sistem" dipilih di Menu → Tampilan, disimpan di `localStorage` (`dompetku-theme`), ditulis ke `html[data-theme]` oleh skrip kepala sebelum cat pertama. `?theme=light|dark` (tautan pratinjau) menang atas pilihan tersimpan.
- Lime di tema terang **tidak pernah** dipakai sebagai teks; tombol primer terang diberi garis `accent-edge`.

## Palet (ringkas; nilai lengkap di `apps/web/src/styles/tokens.css`)

| Peran                  | Gelap                             | Terang                            |
| ---------------------- | --------------------------------- | --------------------------------- |
| Latar `bg` / `surface` | `#0F1211` / `#1A1F1D`             | `#F4F6F3` / `#FFFFFF`             |
| Teks / lunak / redup   | `#EDF1EE` / `#C9D1CD` / `#9BA5A0` | `#141917` / `#38423D` / `#56605B` |
| Aksen (isi tombol)     | lime `#C4EE6A`                    | lime `#C4EE6A` + garis `#4A6A0F`  |
| Teks aksen             | `#C4EE6A`                         | `#4A6A0F`                         |
| Ruang Pribadi          | lime `#C4EE6A`                    | `#4A6A0F`                         |
| Ruang Bersama          | violet `#B6A3FF`                  | `#5B45C9`                         |
| Bahaya / peringatan    | `#FF8F7D` / `#F0B44C`             | `#B8322A` / `#9A5B00`             |
| Fokus                  | `#C4EE6A`                         | `#3F5F0A`                         |
| Pemasukan (`income`)   | `#5FD8A4`                         | `#1A7447`                         |

Semua pasangan teks ≥ 4,5:1 dan batas kontrol/fokus ≥ 3:1 di kedua tema, diuji di `apps/web/src/styles/contrast.test.ts` terhadap rasio yang tertulis di handoff. Tiga nilai terang sengaja lebih gelap dari handoff (`income` `#1B7A4B`, `warning` `#9A5B00`, `chart-aman` `#7FAE2A`) agar lolos di `surface-3` dan sebagai grafik; lihat `IMPLEMENTATION-REPORT.md`.

## Tipografi

Plus Jakarta Sans 400–800 (OFL, dimuat lokal dari @fontsource). Geometris tapi hangat, kuat di 800 untuk angka besar, digit tabular. Skala: display 44 (laptop 56), amount 40, title 26–28, heading 18, body 15, label 14, meta 13, caption 11–12. Semua nominal `tabular-nums`, tanpa pemenggalan.

## Motif identitas

- **Kartu utama + bilah proporsi:** satu angka besar per layar (aman dipakai, kekayaan bersih) dengan `SpaceTag` ruang; di Beranda bilah proporsi aman / tagihan bergaris / sisa wajib (`role="img"` + `aria-label` berisi angkanya).
- **Ruang selalu tertulis:** judul header, pil pengalih dengan ✓ + `aria-current`, `SpaceTag`, dan judul Catat berwarna ruang tujuan.

## Aturan komponen

- Radius: 6 (tag), 10 (segmen dalam), 12 (tombol, input, chip, ubin), 16 (kartu daftar), 20 (kartu utama, dialog), 24 (sheet), penuh hanya untuk pengalih ruang, filter, avatar.
- Kartu tanpa bayangan, cukup garis `hairline`. Bayangan hanya untuk lapisan mengambang (sheet, dialog, toast, menu).
- Target sentuh ≥ 44, jarak ≥ 8. Status selalu ikon + teks. Fokus = garis 2 px `focus`, offset 2.
- Ikon Phosphor (regular untuk navigasi, fill untuk aktif/status, bold di tombol), path disalin per berkas di `apps/web/src/components/ui/icons/` agar hanya ikon yang dipakai ikut terbundel. Tanpa foto atau avatar gambar; orang = inisial N/F.
