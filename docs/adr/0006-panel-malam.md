# ADR 0006: Arah visual Panel Malam

Status: diterima (2026-10-31). Menggantikan [ADR 0005](0005-visual-dark-premium.md).

## Konteks

Arah "gelap premium" (ADR 0005, aksen biru/emas, palet usulan agen) dibangun cepat untuk M0a. Pemilik lalu merancang arah sendiri di Claude Design, memilih varian 1b "Panel Malam", dan menyerahkan paket handoff lengkap di `docs/design/panel-malam/`: spesifikasi mengikat (`README.md`), token (`dompetku-tokens.css`), dan bingkai HTML untuk HP, tablet, laptop, dan tema terang. Pemilik meminta semuanya dikerjakan otomatis; alur, fungsi, dan data tidak berubah.

## Keputusan

- `docs/design/panel-malam/` adalah sumber kebenaran visual; `DESIGN.md` diringkas ulang darinya.
- **Token:** `apps/web/src/styles/tokens.css` memuat nilai handoff persis untuk gelap (bawaan), `[data-theme='light']`, dan `[data-theme='system']` di dalam `prefers-color-scheme: light`. Ditambah `tab`, `hover`, `chart-*`, `toast-*`, `*-fill`, `on-*`, `accent-edge`, dan warna ruang per subtree (`--ruang*` lewat `data-ruang`). Kelas Tailwind tetap hanya semantik (`--color-*: initial`).
- **Tema:** Menu → Tampilan (Gelap · Terang · Ikuti sistem), disimpan di `localStorage`. Skrip inline di `<head>` menulis `data-theme` sebelum cat pertama (menutup isu kilasan gelap di `?theme=light`). Urutan: `?theme`, lalu pilihan tersimpan, lalu gelap. CSP situs hanya `frame-ancestors`, jadi skrip inline diizinkan.
- **Ikon:** Phosphor tetap, tetapi path disalin ke satu berkas per ikon dengan bobot yang dipakai saja. Paket React membawa enam bobot per ikon dan tidak ter-tree-shake per ekspor di Turbopack; peta ikon kategori dimuat setelah hidrasi. Hasilnya rute tetap di bawah 162 kB (ADR 0002).
- **Keadaan demo:** `?state=loading|error` menampilkan B4/B5 (dan T4) agar bisa ditinjau dan diuji; "Coba lagi" membuang parameter itu.

## Akibat

- Budget JS rute: 160,9 kB `/pribadi/beranda`, 161,0 kB `/pribadi/transaksi` (sisa ±1 kB). Target 150 kB di M2 makin perlu diputuskan ulang.
- Uji e2e yang menyentuh salinan atau semantik lama diperbarui (judul H1 halaman, tab Daftar/Ringkasan sebagai `tablist`, menu jenis di judul Catat, label auth baru). Anggaran tinggi mode keyboard Catat mengikuti handoff C1 (360×640, bilah status 24 + keyboard 260).
- Penyimpangan kecil dari handoff dicatat di laporan implementasi beserta alasannya (mis. chip kategori tetap `radio` dengan `aria-checked`, bukan `aria-pressed`).

## Hal yang perlu konfirmasi pemilik

Dua pola handoff bertabrakan dengan pola slop yang disebut antislop, dan diimplementasikan persis seperti handoff (R-37: arah pemilik): aksen violet untuk Bersama di tema gelap (R-01, "purple-and-black"), dan label kapital berjarak "RUANG PRIBADI" di header laptop serta `SpaceTag` (R-06). Pemilik diminta mempertahankan atau mengganti di penilaian M0a.

## Alternatif yang ditolak

- **Mempertahankan ADR 0005 dan hanya mengganti palet.** Handoff mengubah juga tata letak, keadaan, dan komponen; tambal palet saja tidak setia.
- **Memakai `@phosphor-icons/react` apa adanya.** Melampaui budget JS 162 kB (168 kB terukur).
