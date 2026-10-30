# DESIGN.md — arah visual DompetKu v2

Sumber: jawaban pemilik 2026-10-30 ("semuanya jadul", pilih **gelap premium**, warna ruang **ganti, usulkan baru**). Palet di bawah adalah usulan agen atas permintaan pemilik; ganti bebas setelah dilihat di pratinjau. Menggantikan arah "buku kas" (kertas krem, nila/bata, serif) di `docs/spec/ui-ux.md` Lampiran A.

## Identitas

- **Kepribadian:** tenang, tegas, rapi. Seperti kartu bank premium di saku: gelap, angka besar, satu warna penanda.
- **Untuk siapa:** dua orang (Novanda, Farida) yang mencatat harian di HP, sekali-sekali di laptop.
- **Mood:** gelap sebagai bawaan, kontras tinggi, permukaan berlapis datar (tanpa bayangan besar), satu aksen per ruang.
- **Dial:** ENERGY 2 / RHYTHM 2 / MOTION 1.

## Tema

- **Bawaan gelap.** Alasan: pilihan pemilik ("gelap premium"); dipakai malam hari saat mencatat. Tema terang tetap tersedia dan harus lolos semua cek (R-21, R-34). Sampai halaman Pengaturan ada, tema terang dipilih lewat `?theme=light`.

## Palet (gelap)

| Token        | Hex                         | Catatan                                                |
| ------------ | --------------------------- | ------------------------------------------------------ |
| `bg`         | `#0D0E11`                   | hampir hitam, sedikit dingin                           |
| `surface`    | `#15171C`                   | lapisan 1 (baris, kartu)                               |
| `surface-2`  | `#1D2027`                   | lapisan 2 (input, sheet)                               |
| `text`       | `#F2F3F5`                   | 17,4:1 di `bg`                                         |
| `text-muted` | `#A0A6B2`                   | 7,9:1 di `bg`, 6,7:1 di `surface-2`                    |
| `border`     | ≥ 3:1 di `bg` dan `surface` | batas input/kontrol (nilai final dihitung tes kontras) |
| `pribadi`    | `#6CB4FF` biru langit       | 8,8:1 di `bg`                                          |
| `bersama`    | `#F4B860` emas              | 10,9:1 di `bg`                                         |
| `on-accent`  | `#0D0E11`                   | teks di atas tombol aksen (8,8:1 / 10,9:1)             |
| `income`     | `#5BD69A`                   |                                                        |
| `danger`     | `#FF7A72`                   |                                                        |
| `warning`    | `#FF9B5E`                   | selalu bersama ikon + teks                             |

Biru vs emas dipilih karena tetap terbedakan bagi buta warna merah-hijau (beda hue dan terang). Tint ruang: permukaan gelap bernuansa ruang (contoh `#132235` Pribadi, `#2A2113` Bersama), teks di atasnya ≥ 6,5:1.

Palet tema terang diturunkan dari hue yang sama dan diverifikasi tes kontras (teks 4,5:1, non-teks 3:1).

## Tipografi

- **Plus Jakarta Sans** saja (400/600/700). Alasan: typeface buatan studio Jakarta, cocok untuk produk berbahasa Indonesia, angka tabular jelas.
- Serif dihapus. Angka besar (saldo, aman dipakai) memakai Plus Jakarta Sans 700, `tabular-nums`, ukuran hero.

## Motif identitas

- **Kartu saldo ruang:** satu blok utama per layar (Beranda: "aman dipakai"; Dompet: kekayaan bersih) berlatar tint ruang dengan garis atas aksen ruang tipis. Hanya satu per layar; sisanya baris datar di `surface`.

## Aturan komponen

- Radius: field 10, kartu 16, sheet 20, pill hanya untuk chip filter.
- Elevasi lewat tingkat `surface`, bukan bayangan. Bayangan hanya untuk sheet/dialog.
- Aksen ruang hanya di: tab aktif, tombol Catat/primer, kartu saldo. Bukan di ikon, garis, atau latar lain.
- Ikon Phosphor (bobot regular, fill untuk tab aktif). Tanpa emoji.
- Gerak: hanya transisi sheet dan umpan balik tekan; mati di `prefers-reduced-motion`.
