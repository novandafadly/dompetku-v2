# Hasil Claude Design S9: Laporan

Dikerjakan di sesi Design (Claude Code) pada 2026-11-05. Cakupan: **prioritas 1 (Laporan)**. Anggaran, Tagihan, dan kartu "Aman dipakai" belum dirancang (opsional; pola BudgetRow, BillRow, AmanCard sudah ada).

Kanvas (pribadi, hanya pemilik): <https://claude.ai/artifact/Q9APPnefFp1NHXC6VF6ymy>. Bila tautan tidak bisa dibuka, sumber ada di `bingkai/`.

## Isi folder

| Berkas                   | Isi                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spesifikasi-laporan.md` | Spesifikasi per bagian untuk developer: layout, urutan fokus, nama aksesibel, grafik, 320, angka panjang, token, keputusan, peta kode bingkai → props |
| `tokens-s9.css`          | Tiga token grafik baru (`chart-expense`, `chart-income`, `chart-income-tint`) gelap + terang, dengan rasio kontras                                    |
| `bingkai/`               | Sumber kanvas (`.dc.html` + `canvas.json`). `LaporanScreen.dc.html` adalah komponen induk, `LP*.dc.html` hanya memanggilnya dengan props              |

## Bingkai

LP1–LP4 (HP 390 gelap: berjalan, lengkap, Bersama, kalender), LP5 (kosong), LP5b (tren 2 periode), LP6 (memuat), LP7 (galat), LP8a/b (laptop 1280 Pribadi/Bersama), LP9 (tablet 768), LP10 (320), LP11a–c (terang), LP12a/b (angka panjang), LP13 (libur belum diisi). Peta ke props: `spesifikasi-laporan.md` bagian 10.

## Perlu diketahui

- **Belum diperiksa secara visual.** Bingkai ditulis dan diterbitkan tanpa dirender atau dilihat; tinggi bingkai adalah perkiraan dari perhitungan CSS. Buka kanvas, periksa, dan laporkan yang meleset sebelum angka piksel dijadikan acuan.
- Angka semua dari `contoh-data.json`. Yang diturunkan dan bukan dari data: rentang April 2026 (25 Mar – 23 Apr) dan Januari 2028 (24 Des – 24 Jan), selisih LP12, pembanding periode lengkap (Rp 1.628.500 lebih sedikit dari Agustus).
- Keputusan yang menyimpang dari brief ada di `spesifikasi-laporan.md` bagian 9 (dasar periode `nav` bukan `tablist`, periode berjalan tidak dibandingkan, tepat 100% anggaran bukan "Lewat", dan seterusnya). Tolak atau setujui sebelum Task 13.
- Komponen mock memakai `div role="table"` karena pembangun kanvas tidak mengizinkan elemen kustom di dalam `<tbody>`; produksi memakai `<table>`.

## Berikutnya (S9 Task 13)

Tulis `S9-LP*` di `docs/design/s9-bingkai.md` dari `spesifikasi-laporan.md`, pasang token dari `tokens-s9.css` (dengan uji kontras di `contrast.test.ts` dan blok `system`), lalu bangun Laporan sebagai server component dengan tautan URL `?periode=…&basis=…`.
