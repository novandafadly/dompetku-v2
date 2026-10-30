# Batasan desain DompetKu (wajib)

Batasan ini berasal dari kode yang sudah berjalan dan dari aturan antislop yang dipakai proyek. Desain yang melanggarnya tidak bisa dipakai apa adanya.

## Data dan isi

- Semua angka, nama dompet, kategori, dan tagihan dari `contoh-data.json`. Jangan mengarang angka, statistik, nama orang, avatar, atau testimoni. Orang hanya Novanda (N) dan Farida (F), ditampilkan dengan inisial, tanpa foto.
- Format uang: `Rp 1.250.000` (titik ribuan, tanpa desimal, spasi tak putus setelah "Rp"). Negatif: `−Rp 35.000` (tanda minus U+2212). Ringkas boleh: `Rp 1,25 jt`, `Rp 12,5 rb`.
- Tanggal WIB, bahasa Indonesia: "Hari ini", "Kemarin", "Sen, 12 Okt". Bulan: Jan Feb Mar Apr Mei Jun Jul Agu Sep Okt Nov Des.
- Angka memakai digit tabular (lebar sama) agar kolom nominal rata.

## Privasi ruang

- Ruang Bersama tidak pernah menampilkan keterangan, nominal, atau nama dompet Pribadi.
- Ruang aktif selalu tertulis (teks), tidak hanya lewat warna.

## Aksesibilitas

- Kontras WCAG AA: teks 4,5:1, teks besar 3:1, batas komponen dan ikon status 3:1. Cantumkan rasio untuk setiap pasangan token, di tema gelap dan terang.
- Status selalu ikon + teks, tidak warna saja.
- Target sentuh ≥ 44×44 px dengan jarak antar target.
- Fokus keyboard terlihat jelas di setiap elemen interaktif.
- Animasi berhenti bila pengguna memilih "kurangi gerakan".

## Layout

- HP 390 px utama; tetap rapi di 320 px tanpa gulir ke samping.
- Minimal tiga keadaan layout: HP, tablet (≈ 768), laptop (≥ 1024, sidebar 248 px).
- Tab bar dan header tidak menutupi isi.

## Anti-slop (yang langsung ketahuan "buatan AI")

- Tanpa: gradien biru-ungu/ungu-pink sebagai warna utama, glow di banyak elemen, glassmorphism di lebih dari 1–2 elemen, bayangan besar di semua kartu, semua elemen berbentuk pil, latar grid/titik, badge kapsul "AI/Beta/New", emoji, ikon sparkle/bintang/petir, em dash (—).
- Satu titik fokus per layar; satu aksen dipakai hemat (bukan di semua ikon dan garis).
- Setiap keputusan (warna, huruf, layout, kartu) punya alasan satu kalimat.
- Kartu hanya untuk satu objek yang bisa diketuk utuh (dompet) atau satu fokus layar (kartu saldo); sisanya baris datar.

## Teknis (supaya bisa langsung dipakai kode)

- Stack: Next.js + Tailwind CSS v4 dengan token CSS variable semantik (`bg`, `surface`, `surface-2`, `text`, `text-muted`, `border`, `hairline`, `accent`, `accent-tint`, `on-accent`, `income`, `danger`, `warning`, `pribadi`, `bersama`). Palet bawaan Tailwind tidak dipakai.
- Huruf dimuat lokal (tanpa Google Fonts saat build). Ikon Phosphor.
- Komponen pakai Radix (Dialog, Toast, AlertDialog). Tidak ada library UI lain.
- Batas JavaScript per halaman 162 kB: hindari efek yang butuh library animasi tambahan.
