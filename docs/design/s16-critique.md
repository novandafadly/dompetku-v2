# Delivery Gate Visual S16 — Kalender arus kas, deteksi langganan, ekspor PDF

**Tanggal:** 2026-11-24  
**Cakupan:** 24 tangkapan layar penuh (`320`, `390`, `1280` px × mode gelap & terang) di atas build produksi nyata (`next build` + Postgres migrasi `0149`) untuk 4 layar utama S16:

1. `/pribadi/rencana?bagian=tagihan` (tautan `Lihat kalender arus kas` + kartu `Saran langganan`)
2. `/pribadi/rencana/kalender` (jendela 30 hari, status `Kurang` + catatan jujur)
3. `/pribadi/rencana/kalender?hari=90` (proyeksi 90 hari, lencana `Perkiraan`)
4. `/pribadi/laporan` (tombol `Ekspor CSV` + `Ekspor PDF` sejajar)

## Pemeriksaan otomatis

| Gerbang                                                                 | Hasil        |
| ----------------------------------------------------------------------- | ------------ |
| Overflow horizontal (320 / 390 / 1280 px, gelap & terang)               | **0**        |
| Kata terlarang (`!`, `rumah tangga`, emoji, istilah Inggris terlarang)  | **0**        |
| Kemunculan `Rp 0`                                                       | **0**        |
| Axe (pelanggaran serius/kritis di e2e ledger & bersama)                 | **0**        |
| Budget JS muat dingin (batas 162 kB): `/pribadi/rencana?bagian=tagihan` | **150,9 kB** |
| Budget JS muat dingin (batas 162 kB): `/pribadi/rencana/kalender`       | **148,9 kB** |
| Budget JS muat dingin (batas 162 kB): `/pribadi/laporan`                | **151,6 kB** |

## Temuan kritik visual

| ID         | Tingkat | Layar                                       | Temuan                                                                                                                                                                                                                                        | Tindak lanjut                                                                                                                                                                                                                                                                                                                              |
| ---------- | ------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S16-C1** | Penting | `/pribadi/rencana/kalender` (390 & 1280 px) | Pada tata letak awal dua kolom sejajar, nominal tagihan (`−Rp 9.500.000`) di kolom kiri berdekatan langsung (`gap-2`) dengan nominal `Saldo akhir` (`−Rp 1.162.000`) di kolom kanan, sehingga pemindaian dua angka berdampingan terasa padat. | **Diperbaiki & diverifikasi ulang:** baris tanggal dipisah ke baris atas bersama `Saldo akhir` + lencana `[(!) Kurang]`, sedangkan daftar tagihan ditaruh di bawahnya dengan garis kiri `border-l-2 border-hairline pl-3`. Diverifikasi ulang pada 320 px terang, 390 px gelap, dan 1280 px terang: angka tidak pernah saling bertabrakan. |

## Ringkasan

**0 Blocker, 1 Penting (`S16-C1`, sudah diperbaiki dan diverifikasi ulang), 0 Minor.** Semua syarat Panel Malam (`DESIGN.md`), antislop, aksesibilitas (status `Kurang` memakai ikon + teks, target sentuh >= 44 px), dan budget JS terpenuhi.
