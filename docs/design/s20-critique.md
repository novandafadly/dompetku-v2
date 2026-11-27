# Critique visual S20: periode tagihan

Delivery Gate untuk UI baru periode tagihan (2026-11-27). Mode nyata, data uji sendiri. Spec: `apps/web/tests/e2e-ledger/screens-s20-tagihan.spec.ts` (dilewati kecuali `SCREENS=1`). Hasil: 36 PNG di `docs/design/s20/` (6 layar × 320/390/1280 × gelap/terang), 0 luapan horizontal di semua lebar dan tema.

## Layar

| Kode   | Layar                                                                                              |
| ------ | -------------------------------------------------------------------------------------------------- |
| S20-1  | Daftar Tagihan dengan ritme di sub baris (bulanan, minggu, 2 minggu, 2 bulan, tahun, nama panjang) |
| S20-2a | Sheet Tambah, bawaan (Tiap bulan)                                                                  |
| S20-2b | Sheet Tambah, Tiap 2 minggu (kolom tanggal hilang, petunjuk hari)                                  |
| S20-2c | Sheet Tambah, Tiap 2 bulan (petunjuk bulan jatuh tempo pertama)                                    |
| S20-3  | Sheet Ubah: periode baca-saja (mingguan, nama panjang)                                             |

## Temuan

| ID     | Tingkat | Temuan                                                                                                                                                                                                 | Status                                                                       |
| ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| S20-C1 | Penting | Sub baris mingguan terbaca ambigu: "Tiap minggu · Minggu" (minggu = pekan atau hari Minggu?).                                                                                                          | Diperbaiki: "Tiap minggu · hari Minggu"; screenshot diambil ulang.           |
| S20-C2 | Minor   | Di 320 px (tinggi 640) kolom `Ulangi`, petunjuk Mulai, dan periode baca-saja di sheet Ubah jatuh di bawah lipatan; sheet digulir, tombol Simpan tetap terlihat. Pola sama dengan kolom lain sheet ini. | Ditunda: perilaku sheet yang ada, tanpa data hilang.                         |
| S20-C3 | Minor   | Petunjuk tiap N bulan baru terlihat setelah menggulir di 390 px.                                                                                                                                       | Ditunda.                                                                     |
| S20-C4 | Info    | Salah petunjuk sebelumnya (review kode): "mulai bulan <bulan Mulai>" salah bila tanggal jatuh tempo sudah lewat dari Mulai.                                                                            | Diperbaiki: `firstDueMonth` mengikuti `app.bill_dues` (tes unit + komponen). |

Tanpa Blocker. Kontras, fokus, dan label mengikuti komponen yang sudah ada (`SelectField`, `DateField`, `FieldHint`); tidak ada token warna baru. Belum diperiksa: pembaca layar sungguhan (hanya nama aksesibel lewat Playwright) dan 768 px.
