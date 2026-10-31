# Batasan DompetKu (wajib)

Batasan ini menyangkut fungsi, data, dan aksesibilitas. Gaya visual bebas.

## Data dan isi

- Semua angka, nama dompet, kategori, dan tagihan dari `contoh-data.json`. Jangan mengarang angka, statistik, nama orang, avatar, atau testimoni. Orang hanya Novanda (N) dan Farida (F), ditampilkan dengan inisial, tanpa foto.
- Format uang: `Rp 1.250.000` (titik ribuan, tanpa desimal). Negatif: `−Rp 35.000`. Ringkas boleh: `Rp 1,25 jt`, `Rp 12,5 rb`.
- Tanggal bahasa Indonesia: "Hari ini", "Kemarin", "Sen, 12 Okt". Bulan: Jan Feb Mar Apr Mei Jun Jul Agu Sep Okt Nov Des.
- Angka nominal memakai digit tabular (lebar sama) agar kolom rata.

## Privasi ruang

- Ruang Bersama tidak pernah menampilkan keterangan, nominal, atau nama dompet Pribadi.
- Ruang aktif selalu tertulis (teks), tidak hanya lewat warna.

## Aksesibilitas

- Kontras WCAG AA: teks 4,5:1, teks besar 3:1, batas komponen dan ikon status 3:1, di kedua tema.
- Status selalu ikon + teks, tidak warna saja.
- Target sentuh ≥ 44×44 px dengan jarak antar target.
- Fokus keyboard terlihat jelas di setiap elemen interaktif.
- Animasi berhenti bila pengguna memilih "kurangi gerakan".

## Layout

- HP 390 px utama; tetap rapi di 320 px tanpa gulir ke samping.
- Minimal tiga keadaan layout: HP, tablet (≈ 768), laptop (≥ 1024, dengan sidebar).
- Tab bar dan header tidak menutupi isi.

## Teknis (supaya bisa langsung dipakai kode)

- Stack: Next.js + Tailwind CSS v4 dengan token CSS variable semantik: `bg`, `surface`, `surface-2`, `text`, `text-muted`, `border`, `hairline`, `accent`, `accent-tint`, `on-accent`, `income`, `danger`, `warning`, `pribadi`, `pribadi-tint`, `bersama`, `bersama-tint`. Token baru boleh ditambah.
- Huruf harus tersedia sebagai file (misalnya Google Fonts/Fontsource) karena dimuat lokal.
- Ikon: satu set ikon terbuka (sekarang Phosphor; boleh usulkan lain).
- Komponen dibangun di atas Radix (Dialog, Toast, AlertDialog). Hindari efek yang butuh library animasi tambahan (batas JavaScript per halaman 162 kB).
