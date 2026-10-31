# Inventaris layar DompetKu (M0a)

Semua layar ada di kode dan sudah berfungsi. Teks dalam tanda kutip adalah teks yang dipakai sekarang; boleh diperhalus selama artinya sama. Angka diambil dari `contoh-data.json` (tanggal demo 17 Okt 2026).

## Kerangka (semua layar aplikasi)

- **Header (HP):** nama ruang aktif, pengalih ruang `Pribadi | Bersama` (dua tautan, yang aktif ditandai), tombol "Menu". Spanduk kecil "Data demo".
- **Tab bar (HP, bawah):** `Beranda`, `Transaksi`, `Catat` (tombol utama, bukan tautan), `Dompet`, `Rencana`. Rencana disembunyikan bila ruang belum punya anggaran/tagihan. Tidak boleh menutupi isi; hormati safe area.
- **Sidebar (≥ 1024 px, 248 px):** pengalih ruang, tombol Catat, lima tautan yang sama. Tab bar disembunyikan.
- **Menu (sheet):** Trip, Kategori, Kontak, Export, Analisis, Pengaturan, semuanya berlabel "Segera" (belum tersedia).
- Pintasan keyboard `c` membuka Catat.

## 1. Beranda (`/pribadi/beranda`, `/bersama/beranda`)

Tujuan: dalam 3 detik tahu berapa yang aman dibelanjakan sampai akhir bulan.

- **Kartu utama (fokus layar):** judul "Aman dipakai sampai 31 Okt" (Bersama: "Aman dipakai bersama sampai 31 Okt"), angka besar, lalu rincian 3 baris: "Saldo operasional", "Tagihan s.d. 31 Okt" (dikurangi), "Sisa anggaran wajib" (dikurangi), total "Aman dipakai". Di bawahnya "≈ Rp 197.900 per hari untuk 15 hari". Bila total negatif: kalimat "Pengeluaran wajib bulan ini melebihi saldo operasional." menggantikan baris per hari.
- **Tagihan 7 hari:** daftar tagihan belum dibayar yang jatuh tempo ≤ 7 hari, termasuk yang terlambat ("Lewat 2 hari").
- **Anggaran hampir habis:** anggaran ≥ 80%, dengan ikon peringatan + "85% terpakai". Kosong: "Belum ada anggaran yang mendekati batas."
- **Terakhir:** 5 transaksi terbaru.
- **Bersama saja:** "Aktivitas", yaitu siapa mencatat apa (inisial N/F, nama, teks, nominal, waktu).
- Tombol "Tidak ada pengeluaran hari ini", berubah jadi teks "Hari ini tercatat tanpa pengeluaran" setelah ditekan (hanya muncul bila hari ini belum ada pengeluaran).
- **Keadaan kosong (`?seed=empty`):** checklist "Mulai dari sini": Akun aman (selesai), Tambah dompet sehari-hari, Catat satu pengeluaran, Undang Farida; kalimat "Tambahkan dompet operasional untuk melihat berapa yang aman dipakai bulan ini." Tidak boleh ada "Rp 0".
- Kekayaan bersih **tidak** di Beranda.
- Laptop: dua kolom (kartu utama + tagihan/anggaran di kiri, terakhir/aktivitas di kanan, atau komposisi lain yang lebih baik).

## 2. Sheet Catat (dibuka dari mana saja)

Tujuan: catat pengeluaran ≤ 3 ketukan, tanpa salah ruang.

- Judul menyebut ruang tujuan: "Pengeluaran · Pribadi" (wajib, dengan nuansa warna ruang).
- Jenis: Pengeluaran / Pemasukan / Transfer.
- **Nominal** besar, pemisah ribuan saat mengetik. Varian B (`?keypad=app`): keypad di layar `1–9, 000, 0, ⌫`.
- Chip kategori: 6 saran teratas (tidak pernah terpilih otomatis) + "Kategori lain…" (pencarian).
- Dompet (bawaan: dompet operasional terakhir dipakai), tanggal ("Hari ini" atau 13 hari sebelumnya), keterangan opsional.
- Tautan "Pindah ke Bersama/Pribadi": ganti ruang, nominal tetap, dompet & kategori direset.
- Tombol "Simpan" (nonaktif sampai nominal > 0 dan kategori dipilih). Setelah simpan: toast "Tersimpan di Pribadi · Rp 35.000 dari BCA" + "Urungkan".
- Harus muat di atas keyboard HP (360×640 dikurangi keyboard): nominal, label ruang, ≥ 4 chip, dompet, Simpan terlihat tanpa gulir.
- HP: bottom sheet. Laptop (≥ 600 px): dialog tengah.

## 3. Transaksi (`/[ruang]/transaksi`)

- Segmen `Daftar | Ringkasan`. Pemilih bulan "Oktober 2026" dengan sebelumnya/berikutnya.
- Filter chip: `Semua · Operasional · Kantor · Menunggu reimburse` (Bersama hanya `Semua · Operasional`). Kolom cari.
- Daftar dikelompokkan per hari (label hari + total bersih harian). Baris ≥ 60 px: keterangan, "kategori · dompet", nominal rata kanan (pemasukan hijau dengan +, pengeluaran netral dengan −).
- "Muat lagi" per 50 entri. Kosong: "Tidak ada transaksi Kantor di Oktober." + "Hapus filter".
- **Ringkasan:** Pemasukan, Pengeluaran, Selisih bulan ini + baris "Tidak termasuk: Kas kantor Rp 334.000, Transfer internal Rp 1.000.000".

## 4. Detail transaksi (`/[ruang]/transaksi/[id]`)

- Nominal besar, kategori, dompet, tanggal, keterangan, "dicatat oleh kamu" / "dicatat oleh Farida".
- Tombol Ubah dan "Pindahkan ke ruang lain" (keduanya toast "Segera di M1"), "Batalkan".
- Dialog Batalkan: "Transaksi Rp 35.000 dibatalkan. Saldo BCA bertambah Rp 35.000. Bisa dipulihkan 90 hari dari Sampah." → konfirmasi → kembali ke daftar, toast dengan "Urungkan".

## 5. Dompet (`/[ruang]/dompet`)

- **Kartu utama:** Kekayaan bersih (operasional + tabungan; Kas Kantor tidak dihitung).
- Kelompok Operasional, Tabungan, Kantor (Pribadi saja) dengan subtotal. Kas Kantor diberi label "Tidak masuk hitungan pribadi".
- Tombol "Tambah dompet" → sheet: Nama, Jenis (Operasional/Tabungan/Kantor), Tipe (Bank/E-wallet/Tunai), "Saldo hari ini" (opsional), "Simpan dompet". Galat inline.
- **Detail dompet (`/[ruang]/dompet/[id]`):** saldo, riwayat per hari, "Saldo awal Rp 4.100.000" untuk entri pembuka.

## 6. Rencana

Placeholder untuk anggaran dan tagihan (M2). Cukup keadaan kosong yang jujur.

## 7. Auth tiruan (di luar kerangka aplikasi, label "Prototipe: belum aktif")

- `/masuk`: masuk dengan passkey, atau email + kata sandi. Peringatan "Prototipe: jangan isi kata sandi asli."
- `/amankan`: langkah 1 passkey → langkah 2 kode TOTP 6 digit → kode pemulihan.
- `/undang`: email pasangan, "Tautan berlaku 72 jam, sekali pakai."
- `/terima-undangan`: "Novanda mengundang kamu ke ruang Bersama".

## Keadaan yang wajib dirancang

Kosong, memuat (skeleton atau teks), galat (sebab + tindakan), fokus keyboard, nonaktif, toast, dialog konfirmasi, sheet terbuka, tema terang.
