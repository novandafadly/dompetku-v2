# ADR 0005: Arah visual gelap premium

Status: diterima (2026-10-30)

## Konteks

Arah visual M0a mengikuti `docs/spec/ui-ux.md` Lampiran A: "buku kas" dengan kertas krem, aksen nila (Pribadi) dan bata (Bersama), angka hero serif (Source Serif 4), dan garis total ganda. Setelah melihat pratinjau, pemilik menilai tampilannya jadul dan memilih arah **gelap premium**, dengan warna ruang diganti. Arah baru ditulis di `DESIGN.md` di akar repo.

## Keputusan

`DESIGN.md` menggantikan Lampiran A ui-ux.md (A.1 palet, A.2 tipografi, A.3 bentuk, motif kolom buku kas). Bagian lain ui-ux.md tetap berlaku.

- **Tema.** Gelap adalah bawaan tanpa media query. Tema terang ada di `html[data-theme='light']` dan dipilih lewat `?theme=light` sampai halaman Pengaturan ada. Parameter ini dibaca `DemoProvider` dan ikut di setiap tautan, sama seperti `?seed`.
- **Palet.** Nilai gelap persis seperti DESIGN.md. Palet terang diturunkan dari hue yang sama, digelapkan sampai teks lolos 4,5:1 di semua permukaan. `border` dituning sampai ≥ 3:1 di `bg`, `surface`, dan `surface-2` di kedua tema (gelap `#69707D`, terang `#767D8A`). Semua pasangan teks dan non-teks diuji di `apps/web/src/styles/contrast.test.ts`.
- **Aksen ruang.** Pribadi biru langit `#6CB4FF`, Bersama emas `#F4B860`. Aksen hanya di tab aktif, tombol Catat dan tombol primer, dan kartu saldo. Cincin fokus memakai warna teks, bukan aksen. Tint ruang juga tetap di judul sheet yang menulis ke ruang tertentu (Catat, Dompet baru), karena ui-ux.md mewajibkan judul sheet Catat berlatar tint ruang tujuan.
- **Tipografi.** Plus Jakarta Sans saja (400/600/700). Source Serif dan parameter `?hero` dihapus. Angka hero memakai 700 tabular, `clamp()` 28 sampai 42 px.
- **Motif identitas.** Kartu saldo: satu per layar (Beranda: aman dipakai; Dompet: kekayaan bersih), latar tint ruang dengan garis atas aksen. Daftar lain berupa baris datar di `surface`.
- **Bentuk.** Radius field 10, kartu 16, sheet 20; pill hanya untuk chip. Elevasi lewat tingkat `surface`; bayangan hanya untuk sheet dan dialog.
- **Tata letak.** Tiga keadaan: satu kolom di bawah 768 px, daftar berpasangan di 768 sampai 1023 px, dan dua kolom (kartu | daftar) mulai 1024 px untuk Beranda dan Dompet (spec R12, sebelumnya ditunda).

## Akibat

- Aturan "tombol primer tema gelap berteks `#121210`" di global constraints kini berarti teks `on-accent` gelap `#0D0E11`.
- Kolom buku kas tidak lagi bergaris ganda; rincian rumus memakai satu garis `border` di atas total.
- Formulir penilaian M0a menanyakan warna ruang, bukan lagi pilihan serif/sans.
- Budget JS rute tetap ≤ 162 kB (ADR 0002): 157,3 kB `/pribadi/beranda`, 157,8 kB `/pribadi/transaksi`.

## Alternatif yang ditolak

- **Menyempurnakan buku kas.** Pemilik menolak arahnya, bukan detailnya.
- **Tema mengikuti sistem.** Pemilik memilih gelap sebagai identitas; mengikuti sistem membuat sebagian besar pengguna HP siang hari melihat tema terang lebih dulu.
