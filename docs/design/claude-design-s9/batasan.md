# Batasan DompetKu S9 (wajib)

Batasan ini menyangkut fungsi, data, aksesibilitas, dan teknis. Gaya visual **tidak bebas**: ikuti Panel Malam (`DESIGN.md`, `docs/design/panel-malam/README.md`, `dompetku-tokens.css`).

## Data dan isi

- Semua angka, nama dompet, kategori, tagihan, dan anggaran dari `contoh-data.json`. Jangan mengarang angka, statistik, nama orang, avatar, atau testimoni. Blok bertanda `"ilustrasi": true` boleh dipakai hanya untuk keadaan yang disebut di blok itu.
- Orang hanya Novanda (N) dan Farida (F), ditampilkan dengan inisial, tanpa foto atau avatar gambar.
- Format uang: `Rp 1.250.000` (titik ribuan, tanpa desimal). Negatif memakai tanda minus U+2212: `−Rp 35.000` (bukan tanda hubung). Pemasukan `+Rp …` warna `income`. Ringkas hanya untuk sumbu grafik: `Rp 1,25 jt`, `Rp 12 jt`, `Rp 500 rb`.
- Semua nominal `tabular-nums`, `white-space: nowrap`, rata kanan di daftar; tanpa pemenggalan di tengah angka.
- Tanggal bahasa Indonesia: "Hari ini", "Kemarin", "Kam, 15 Okt", rentang "25 Sep – 22 Okt". Bulan: Jan Feb Mar Apr Mei Jun Jul Agu Sep Okt Nov Des. Jam memakai titik ("10.55").
- **Tanpa istilah "rumah tangga".** Pakai "bersama" ("keuangan bersama", "ruang Bersama"). Nama kategori data ("Sewa Rumah", "Kas Rumah") tetap apa adanya.

## Privasi ruang

- Ruang Bersama tidak pernah menampilkan keterangan, nominal, kategori, tagihan, anggaran, atau nama dompet Pribadi siapa pun. Laporan Bersama hanya berisi transaksi Bersama; Kontribusi hanya menampilkan jumlah setoran/ambil per orang, bukan dompet asalnya.
- Ruang aktif selalu tertulis (judul, `SpaceTag`, pil pengalih), tidak hanya lewat warna.

## Angka dan aturan yang harus tampak jujur

- Pengeluaran = pengeluaran biasa + biaya transfer. Kas Kantor, talangan, transfer antar dompet, setor/ambil Bersama (Kontribusi), dan koreksi saldo **tidak** dihitung; Laporan menyebutnya di "Tidak termasuk".
- Satu kewajiban dicatat sekali: tagihan **atau** anggaran wajib, tidak keduanya. Desain galatnya menjelaskan sebab dan jalan keluar.
- "Aman dipakai" = saldo dompet operasional − tagihan belum dibayar sampai sehari sebelum gajian (termasuk yang lewat) − sisa anggaran wajib. Rumus terlihat lewat empat baris rincian (pola handoff).

## Aksesibilitas

- Kontras WCAG AA di kedua tema: teks 4,5:1, teks besar 3:1, batas komponen, ikon status, dan **elemen grafik** 3:1 terhadap latarnya.
- **Status selalu ikon + teks**, tidak warna saja ("85% terpakai", "Lewat Rp 189.000", "Lewat 3 hari", "Hati-hati", "berjalan").
- **Grafik:** setiap grafik punya `role="img"` dengan `aria-label` ringkas **dan** tabel data setara (terlihat atau bisa dibuka). Seri dibedakan juga oleh pola/posisi/label langsung, bukan warna saja. Tidak ada informasi yang hanya muncul saat hover.
- Target sentuh ≥ 44×44 px dengan jarak ≥ 8 px (pemilih periode, segmen, baris yang bisa dibuka, tombol Bayar).
- Fokus keyboard terlihat (`outline: 2px solid var(--focus); outline-offset: 2px`) di semua elemen interaktif, urutan fokus mengikuti urutan baca.
- Animasi berhenti bila pengguna memilih "kurangi gerakan"; grafik tidak dianimasikan saat muncul.

## Layout

- HP 390 px utama; **rapi di 320 px tanpa gulir ke samping**, termasuk label sumbu grafik dan angka `Rp 12.345.678.900`.
- Tiga keadaan layout: HP (320–599), tablet (600–1023, isi maks 720), laptop (≥ 1024, sidebar 248, isi maks 1000).
- Tab bar dan header tidak menutupi isi.

## Teknis (supaya bisa langsung dipakai kode)

- Stack: Next.js 16 + React 19, **Tailwind CSS v4** dengan token CSS variable semantik yang sudah ada di `dompetku-tokens.css` (`bg`, `surface`, `surface-2`, `surface-3`, `text`, `text-soft`, `text-muted`, `border`, `hairline`, `accent`, `accent-text`, `accent-tint`, `income`, `danger`, `warning`, `pribadi*`, `bersama*`, `chart-aman`, `chart-tagihan`, `chart-tagihan-2`, `chart-wajib`, …). Token baru boleh ditambah (mis. `chart-income`, `chart-expense`, `chart-muted`) dengan nilai gelap dan terang dan rasio kontrasnya.
- Huruf: **Plus Jakarta Sans** 400–800 (Fontsource, dimuat lokal). Tidak ada huruf lain.
- Ikon: **Phosphor** (regular untuk navigasi, fill untuk status, bold di tombol). Ikon kategori mengikuti tabel Assets handoff.
- Komponen dibangun di atas **Radix** (Dialog, AlertDialog, Toast). **Tanpa library animasi.**
- **Budget JavaScript 162 kB per halaman** (gzip, muat dingin). Beranda hampir penuh (sisa 0,3 kB di mode prototipe): desain Beranda tidak boleh menambah interaksi klien baru. Laporan dirender di server; **grafik idealnya SVG statis** tanpa JavaScript. Bila sebuah grafik butuh interaksi, library grafik (Recharts) hanya boleh di halaman Laporan dan dimuat malas, dan angka harus tetap terbaca sebelum library itu termuat.
- Pemilih periode dan tampilan (gajian/kalender) berupa tautan (URL `?periode=2026-10&basis=gajian`), sehingga bekerja tanpa JavaScript.
- Kartu tanpa bayangan (garis `hairline`); bayangan hanya untuk sheet, dialog, toast.
