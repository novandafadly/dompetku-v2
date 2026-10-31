# Laporan implementasi Panel Malam

Tanggal: 2026-10-31 · Branch `claude/m0a-prototype` · Handoff: `docs/design/panel-malam/` · Keputusan: [ADR 0006](../../adr/0006-panel-malam.md)

antislop: mode **during** (instruksi sesi). Arah = handoff pemilik (R-37). Dial: ENERGY 2 / RHYTHM 2 / MOTION 1.

> Design Read: aplikasi keuangan pribadi + bersama untuk dua orang, cek cepat malam hari di HP, bahasa visual "panel instrumen malam" (hampir hitam kehijauan, satu angka lime), dial ENERGY 2 / RHYTHM 2 / MOTION 1.

## Ringkasan

- Semua layar, keadaan, sheet, dan dialog di handoff dibangun ulang di komponen yang ada. Alur, fungsi, dan data tidak berubah; format uang dan tanggal tetap hanya di `@dompetku/domain` (fungsi baru: `weekdayShort`, `dayOfMonth`, `weekdayDateLabel`, `fullDateLabel`, `detailDateLabel`, `dueLabel`).
- Token persis handoff di kedua tema plus "Ikuti sistem"; tema dipilih di Menu → Tampilan, disimpan, dan diterapkan sebelum cat pertama (isu kilasan gelap ditutup).
- Kontrol dan keadaan baru dari handoff: pemilih jenis di judul Catat, halaman kedua "Kategori lain…", mode keyboard HP, segmen Tampilan, `?state=loading|error` (B4, B5, T4), tab Daftar/Ringkasan sebagai `tablist`, ringkasan berdampingan di laptop, entri pembuka di riwayat dompet, kode 6 kotak di `/amankan`.

## Gerbang

**GATES**

## Delivery Gate antislop

**GATE**

## Fidelitas handoff

Kode bingkai → diimplementasikan (ya / sebagian / tidak) + catatan. Hitungan: **COUNT**.

| Kode | Bingkai                       | Status   | Catatan                                                                                                                                                                                                                            |
| ---- | ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1   | Beranda Pribadi               | ya       | AmanCard + bilah proporsi `role=img`, BillRow, BudgetRow, TxRow (tautan ke detail), "Semua ›".                                                                                                                                     |
| B2   | Beranda Bersama               | ya       | Aktivitas dengan avatar N/F, tagihan terlambat "Lewat 3 hari" + ikon, 100% `warning-octagon`.                                                                                                                                      |
| B3   | Kosong (`?seed=empty`)        | ya       | Kartu tanpa angka + "Tambah dompet", checklist 1 dari 4, Terakhir kosong; tidak ada "Rp 0" (diuji).                                                                                                                                |
| B4   | Memuat                        | ya       | `?state=loading`: kerangka bentuk akhir tanpa denyut, "Memuat…" `role=status`.                                                                                                                                                     |
| B5   | Galat                         | ya       | `?state=error`: ikon `cloud-slash`, Coba lagi (membuang `?state`), Catat tetap bisa.                                                                                                                                               |
| B6   | Kartu negatif                 | ya       | Nominal `danger`, kotak `danger-tint` + `warning-octagon`, bilah bergaris bahaya. Data demo tidak punya kasus negatif; diperiksa lewat kode.                                                                                       |
| B7   | Menu (sheet)                  | ya       | Enam item `aria-disabled` + badge "Segera", segmen Tampilan Gelap · Terang · Ikuti sistem.                                                                                                                                         |
| C1   | Catat, keyboard HP            | ya       | `visualViewport`: tanpa pegangan, nominal 36, tombol 44; tinggi ≤ 356 px di 360×640 (diuji).                                                                                                                                       |
| C2   | Keypad aplikasi               | ya       | Tuts 52 px, gap 8, `⌫` = ikon `backspace` dengan `aria-label="Hapus"`.                                                                                                                                                             |
| C3   | Setelah pindah ke Bersama     | ya       | Nominal tetap, dompet ke Kas Rumah, kategori direset, semua aksen violet.                                                                                                                                                          |
| C4   | Kategori lain…                | ya       | Halaman kedua di sheet yang sama: Kembali, "Kategori · Pribadi", cari langsung fokus, baris 52 dengan ikon.                                                                                                                        |
| C5   | Toast setelah Simpan          | ya       | Dibalik dari tema, 52 px, radius 14, centang, Urungkan 44 px, 6 detik, jeda saat hover/fokus, 92 px dari bawah.                                                                                                                    |
| T1   | Daftar Pribadi                | ya       | Segmen `tablist`, pemilih bulan, cari 44, filter pil digeser, grup per hari, Muat lagi.                                                                                                                                            |
| T2   | Ringkasan                     | ya       | Pemasukan/Pengeluaran/Selisih 52 px, kotak "Tidak termasuk", Anggaran bulan ini.                                                                                                                                                   |
| T3   | Kosong karena filter          | ya       | Ikon `funnel-x`, kalimat, "Hapus filter".                                                                                                                                                                                          |
| T4   | Memuat                        | ya       | `?state=loading`: "Memuat transaksi Oktober…" + kerangka baris.                                                                                                                                                                    |
| T5   | Daftar Bersama                | ya       | Filter Semua · Operasional saja.                                                                                                                                                                                                   |
| D1   | Detail                        | ya       | "‹ Transaksi", kartu ikon + nominal 40, baris Kategori/Dompet/Tanggal/Ruang (SpaceTag)/Dicatat oleh.                                                                                                                               |
| D2   | AlertDialog Batalkan          | ya       | Ubin `danger-tint`, "Batalkan transaksi ini?", fokus awal di Kembali (diuji), fokus kembali ke pemicu.                                                                                                                             |
| D3   | Toast "Segera di M1"          | ya       | Ikon `info` fill.                                                                                                                                                                                                                  |
| D4   | Kembali ke daftar             | sebagian | Baris hilang, total harian dihitung ulang, toast + Urungkan. Teks toast tetap "Dibatalkan di Pribadi · Rp 22.000 dari BCA" (aturan global handoff: toast selalu menyebut ruang; bingkai menulis "Transaksi Rp 22.000 dibatalkan"). |
| W1   | Dompet Pribadi                | ya       | Kekayaan bersih + SpaceTag, Tambah dompet, kelompok dengan subtotal, label Kantor `warning`.                                                                                                                                       |
| W2   | Tambah dompet, galat          | sebagian | Judul + SpaceTag, segmen Jenis/Tipe, galat 2 px + ikon + `aria-describedby`, fokus ke kolom salah. Jenis tidak terpilih otomatis (perilaku lama dipertahankan; bingkai menampilkan Operasional terpilih).                          |
| W3   | Detail dompet BCA             | ya       | Riwayat per hari, Muat lagi, "Entri pembuka" di paling bawah dengan ikon `flag`.                                                                                                                                                   |
| W4   | Dompet Bersama                | ya       | Tanpa kelompok Kantor.                                                                                                                                                                                                             |
| R1   | Rencana                       | ya       | Ubin `accent-tint`, "Rencana segera hadir", "Ke Beranda".                                                                                                                                                                          |
| A1   | /masuk                        | ya       | Pita prototipe, wordmark, passkey 52, pemisah, Email, Kata sandi + ikon mata, kotak peringatan, Masuk.                                                                                                                             |
| A2   | /amankan langkah 2            | ya       | Stepper 3 bagian, 6 kotak 56 px (satu input nyata), Verifikasi nonaktif sampai 6 digit.                                                                                                                                            |
| A3   | /undang                       | sebagian | Salinan, label, petunjuk, ikon sesuai. "Kirim undangan" tetap aktif dengan validasi inline (perilaku lama); bingkai menggambar tombol nonaktif saat kosong.                                                                        |
| A4   | /terima-undangan              | ya       | Avatar N → ikon Bersama, kotak terlihat/tidak terlihat, Terima undangan → /amankan, Tolak → /masuk.                                                                                                                                |
| L1   | Laptop Beranda Pribadi        | ya       | Sidebar 248 (merek, pengalih, Catat + `kbd C`, NavLink aktif inset 3 px), header "Ruang Pribadi" + H1 + tanggal, grid 1,3fr/1fr.                                                                                                   |
| L2   | Catat dialog tengah           | sebagian | Maks 520, chip dibungkus dengan ikon, Keterangan tampil, `↵` + "Enter untuk simpan · Esc untuk menutup". Tombol ikon "Tambah keterangan" disembunyikan mulai 600 px karena kolomnya sudah tampil.                                  |
| L3   | Laptop Beranda Bersama        | ya       | Kolom kanan: Aktivitas lalu Terakhir.                                                                                                                                                                                              |
| L4   | Laptop Transaksi              | ya       | Daftar + kolom Ringkasan 340 px, tanpa segmen; hover baris `--hover`.                                                                                                                                                              |
| L5   | Laptop Dompet                 | ya       | Tambah dompet di header, kekayaan lebar penuh, grid 3 kolom.                                                                                                                                                                       |
| L6   | Laptop /masuk                 | ya       | Kartu di tengah.                                                                                                                                                                                                                   |
| X1   | Tablet Beranda                | ya       | Tab bar tetap, isi maks 720, Tagihan + Anggaran dua kolom.                                                                                                                                                                         |
| G1   | Terang Beranda Pribadi        | ya       | Token terang; tombol Catat bergaris `accent-edge`.                                                                                                                                                                                 |
| G2   | Terang Beranda Bersama        | ya       | Violet `#5B45C9`, pil Bersama teks putih.                                                                                                                                                                                          |
| G3   | Terang Catat keypad           | ya       |                                                                                                                                                                                                                                    |
| G4   | Terang Catat Bersama keyboard | ya       |                                                                                                                                                                                                                                    |
| G5   | Terang Transaksi              | ya       |                                                                                                                                                                                                                                    |
| G6   | Terang Detail + dialog        | ya       |                                                                                                                                                                                                                                    |
| G7   | Terang Dompet galat           | ya       |                                                                                                                                                                                                                                    |
| G8   | Terang Kosong                 | ya       |                                                                                                                                                                                                                                    |
| G9   | Terang laptop Beranda         | ya       | Sidebar `tab` putih.                                                                                                                                                                                                               |
| G10  | Terang laptop Catat           | ya       |                                                                                                                                                                                                                                    |

## Penyimpangan lain yang disengaja

- **Chip kategori dan filter** memakai pola `radiogroup` + `radio`/`aria-checked` (perilaku dan uji lama, termasuk panah kiri/kanan), bukan `aria-pressed`. Pilihan tetap tunggal; tampilan sama dengan handoff.
- **Select Dompet/Tanggal Catat** memakai `<select>` bawaan bergaya handoff (ikon + nilai + caret) dengan label hanya untuk pembaca layar; ikon dompet/kalender menjadi label visual seperti di bingkai.
- **Ikon Phosphor** disalin per berkas dengan bobot yang dipakai saja dan peta ikon kategori dimuat setelah hidrasi, karena paket React membawa enam bobot per ikon (168 kB, melampaui budget).
- **Mode keyboard Catat**: uji e2e kini memakai anggaran handoff C1 (bilah status 24 + keyboard 260 = 284 px), sebelumnya 300 px.
- **Token terang digelapkan minimal (kontras, review designer 2026-10-31)**, hue tetap: `income` `#1B7A4B` menjadi `#1A7447` (di `surface-3` 4,22 menjadi 4,57; di `bg` 4,9 menjadi 5,3), `warning` `#9A5B00` menjadi `#945700` (di `surface-3` 4,29 menjadi 4,58; di `surface` 5,4 menjadi 5,8), `chart-aman` terang `#7FAE2A` menjadi `#75A127` (di putih 2,63 menjadi 3,05, WCAG 1.4.11). Rasio terang `income`/`warning` tidak lagi dicocokkan dengan angka handoff di `token-pairs.ts`; pasangan di `surface-2`, `surface-3`, `hover` ditambahkan.
- **Angka besar `display` mengecil di layar sempit** (`clamp(2rem, 11.3vw, 2.75rem)`: 44 px di 390, 36 px di 320) agar `Rp 12.345.678.900` tidak terpotong; disetujui pemilik 2026-10-31. Gaya tambahan di kode yang tidak ada di handoff: `display-lg` 52, `display-long` (clamp), `amount-sm` 36, `title-lg` 28, `headline` 20, `header` 19, `subheading` 17, `keypad` 22. Token `--hover` dan `--tab` berasal dari tabel README handoff (tidak ada di berkas CSS handoff); `--radius-xs` 3 px dan `--radius-toast` 14 px adalah tambahan kode.

## Tabrakan dengan pola slop antislop (diimplementasikan sesuai handoff, R-37)

1. **Aksen violet Bersama di tema gelap** (`#B6A3FF` di atas `#0F1211`) bersinggungan dengan "purple-and-black scheme" (R-01, AI Default Palette). Di sini violet adalah warna ruang yang selalu berpasangan dengan teks/ikon, bukan gradien atau latar.
2. **Label kapital berjarak "RUANG PRIBADI"** di header laptop dan `SpaceTag` kapital +0,05em bersinggungan dengan "uppercase labels with extreme letter-spacing" (R-06). Jaraknya kecil (0,05–0,06em) dan label membawa informasi ruang.

Keduanya perlu jawaban pemilik: pertahankan atau ganti (pertanyaan ada di `docs/review/m0a-penilaian.md`, butir warna ruang).

## Lampiran: klik R-35, 390 px gelap

<details>
<summary>143 kontrol</summary>

- `/pribadi/beranda` · Pribadi → tampilan berubah
- `/pribadi/beranda` · Bersama → navigasi → /bersama/beranda
- `/pribadi/beranda` · Menu → dialog terbuka
- `/pribadi/beranda` · Semua transaksi → navigasi → /pribadi/transaksi
- `/pribadi/beranda` · Kopi sore (QRIS)Kopi & Camilan · BCA · H → navigasi → /pribadi/transaksi/e548
- `/pribadi/beranda` · Kopi susuKopi & Camilan · Tunai · Hari i → navigasi → /pribadi/transaksi/e546
- `/pribadi/beranda` · Beranda → tampilan berubah
- `/pribadi/beranda` · Transaksi → navigasi → /pribadi/transaksi
- `/pribadi/beranda` · Catat → dialog terbuka
- `/pribadi/beranda` · Dompet → navigasi → /pribadi/dompet
- `/pribadi/beranda` · Rencana → navigasi → /pribadi/rencana
- `/bersama/beranda` · Pribadi → navigasi → /pribadi/beranda
- `/bersama/beranda` · Bersama → tampilan berubah
- `/bersama/beranda` · Menu → dialog terbuka
- `/bersama/beranda` · Semua transaksi → navigasi → /bersama/transaksi
- `/bersama/beranda` · MinimarketBelanja Dapur · Kas Rumah · Ha → navigasi → /bersama/transaksi/e547
- `/bersama/beranda` · Belanja kebutuhan dapurBelanja Dapur · K → navigasi → /bersama/transaksi/e545
- `/bersama/beranda` · Beranda → tampilan berubah
- `/bersama/beranda` · Transaksi → navigasi → /bersama/transaksi
- `/bersama/beranda` · Catat → dialog terbuka
- `/bersama/beranda` · Dompet → navigasi → /bersama/dompet
- `/bersama/beranda` · Rencana → navigasi → /bersama/rencana
- `/pribadi/beranda` · Pribadi → tampilan berubah
- `/pribadi/beranda` · Bersama → navigasi → /bersama/beranda
- `/pribadi/beranda` · Menu → dialog terbuka
- `/pribadi/beranda` · Tambah dompet → dialog terbuka
- `/pribadi/beranda` · Tambah dompet sehari-hariBelum → dialog terbuka
- `/pribadi/beranda` · Catat satu pengeluaranBelum → dialog terbuka
- `/pribadi/beranda` · Undang FaridaBelum → navigasi → /undang
- `/pribadi/beranda` · Beranda → tampilan berubah
- `/pribadi/beranda` · Transaksi → navigasi → /pribadi/transaksi
- `/pribadi/beranda` · Catat → dialog terbuka
- `/pribadi/beranda` · Dompet → navigasi → /pribadi/dompet
- `/pribadi/beranda` · Pribadi → navigasi → /pribadi/beranda
- `/pribadi/beranda` · Bersama → navigasi → /bersama/beranda
- `/pribadi/beranda` · Menu → dialog terbuka
- `/pribadi/beranda` · Beranda → navigasi → /pribadi/beranda
- `/pribadi/beranda` · Transaksi → navigasi → /pribadi/transaksi
- `/pribadi/beranda` · Catat → dialog terbuka
- `/pribadi/beranda` · Dompet → navigasi → /pribadi/dompet
- `/pribadi/beranda` · Rencana → navigasi → /pribadi/rencana
- `/pribadi/beranda` · Pribadi → navigasi → /pribadi/beranda
- `/pribadi/beranda` · Bersama → navigasi → /bersama/beranda
- `/pribadi/beranda` · Menu → dialog terbuka
- `/pribadi/beranda` · Coba lagi → tampilan berubah
- `/pribadi/beranda` · Catat tetap bisa → dialog terbuka
- `/pribadi/beranda` · Beranda → navigasi → /pribadi/beranda
- `/pribadi/beranda` · Transaksi → navigasi → /pribadi/transaksi
- `/pribadi/beranda` · Catat → dialog terbuka
- `/pribadi/beranda` · Dompet → navigasi → /pribadi/dompet
- `/pribadi/beranda` · Rencana → navigasi → /pribadi/rencana
- `/pribadi/transaksi` · Pribadi → tampilan berubah
- `/pribadi/transaksi` · Bersama → navigasi → /bersama/transaksi
- `/pribadi/transaksi` · Menu → dialog terbuka
- `/pribadi/transaksi` · Daftar → sudah aktif (pilihan tetap)
- `/pribadi/transaksi` · Ringkasan → tampilan berubah
- `/pribadi/transaksi` · Bulan sebelumnya → navigasi → /pribadi/transaksi
- `/pribadi/transaksi` · Bulan berikutnya → nonaktif (diharapkan, tidak diklik)
- `/pribadi/transaksi` · Cari keterangan → terisi
- `/pribadi/transaksi` · Semua → sudah aktif (pilihan tetap)
- `/pribadi/transaksi` · Operasional → tampilan berubah
- `/pribadi/transaksi` · Kantor → tampilan berubah
- `/pribadi/transaksi` · Menunggu reimburse → tampilan berubah
- `/pribadi/transaksi` · Kopi sore (QRIS)Kopi & Camilan · BCA −Rp → navigasi → /pribadi/transaksi/e548
- `/pribadi/transaksi` · Kopi susuKopi & Camilan · Tunai −Rp 21.5 → navigasi → /pribadi/transaksi/e546
- `/pribadi/transaksi` · Beranda → navigasi → /pribadi/beranda
- `/pribadi/transaksi` · Transaksi → tampilan berubah
- `/pribadi/transaksi` · Catat → dialog terbuka
- `/pribadi/transaksi` · Dompet → navigasi → /pribadi/dompet
- `/pribadi/transaksi` · Rencana → navigasi → /pribadi/rencana
- `/bersama/transaksi` · Pribadi → navigasi → /pribadi/transaksi
- `/bersama/transaksi` · Bersama → tampilan berubah
- `/bersama/transaksi` · Menu → dialog terbuka
- `/bersama/transaksi` · Daftar → sudah aktif (pilihan tetap)
- `/bersama/transaksi` · Ringkasan → tampilan berubah
- `/bersama/transaksi` · Bulan sebelumnya → navigasi → /bersama/transaksi
- `/bersama/transaksi` · Bulan berikutnya → nonaktif (diharapkan, tidak diklik)
- `/bersama/transaksi` · Cari keterangan → terisi
- `/bersama/transaksi` · Semua → sudah aktif (pilihan tetap)
- `/bersama/transaksi` · Operasional → filter tetap (semua entri Bersama operasional; aria-checked berubah, diverifikasi terpisah)
- `/bersama/transaksi` · MinimarketBelanja Dapur · Kas Rumah −Rp → navigasi → /bersama/transaksi/e547
- `/bersama/transaksi` · Belanja kebutuhan dapurBelanja Dapur · K → navigasi → /bersama/transaksi/e545
- `/bersama/transaksi` · Beranda → navigasi → /bersama/beranda
- `/bersama/transaksi` · Transaksi → tampilan berubah
- `/bersama/transaksi` · Catat → dialog terbuka
- `/bersama/transaksi` · Dompet → navigasi → /bersama/dompet
- `/bersama/transaksi` · Rencana → navigasi → /bersama/rencana
- `/pribadi/transaksi/e548` · Pribadi → navigasi → /pribadi/transaksi
- `/pribadi/transaksi/e548` · Bersama → navigasi → /bersama/transaksi
- `/pribadi/transaksi/e548` · Menu → dialog terbuka
- `/pribadi/transaksi/e548` · Transaksi → navigasi → /pribadi/transaksi
- `/pribadi/transaksi/e548` · Ubah → tampilan berubah
- `/pribadi/transaksi/e548` · Pindahkan ke ruang lain → tampilan berubah
- `/pribadi/transaksi/e548` · Batalkan transaksi → dialog terbuka
- `/pribadi/transaksi/e548` · Beranda → navigasi → /pribadi/beranda
- `/pribadi/transaksi/e548` · Transaksi → navigasi → /pribadi/transaksi
- `/pribadi/transaksi/e548` · Catat → dialog terbuka
- `/pribadi/transaksi/e548` · Dompet → navigasi → /pribadi/dompet
- `/pribadi/transaksi/e548` · Rencana → navigasi → /pribadi/rencana
- `/pribadi/dompet` · Pribadi → tampilan berubah
- `/pribadi/dompet` · Bersama → navigasi → /bersama/dompet
- `/pribadi/dompet` · Menu → dialog terbuka
- `/pribadi/dompet` · Tambah dompet → dialog terbuka
- `/pribadi/dompet` · BCABank Rp 3.105.500Rp 3.105.500 → navigasi → /pribadi/dompet/acc-bca
- `/pribadi/dompet` · TunaiTunai Rp 1.148.000Rp 1.148.000 → navigasi → /pribadi/dompet/acc-tunai
- `/pribadi/dompet` · Beranda → navigasi → /pribadi/beranda
- `/pribadi/dompet` · Transaksi → navigasi → /pribadi/transaksi
- `/pribadi/dompet` · Catat → dialog terbuka
- `/pribadi/dompet` · Dompet → tampilan berubah
- `/pribadi/dompet` · Rencana → navigasi → /pribadi/rencana
- `/pribadi/dompet/acc-bca` · Pribadi → navigasi → /pribadi/dompet
- `/pribadi/dompet/acc-bca` · Bersama → navigasi → /bersama/dompet
- `/pribadi/dompet/acc-bca` · Menu → dialog terbuka
- `/pribadi/dompet/acc-bca` · Dompet → navigasi → /pribadi/dompet
- `/pribadi/dompet/acc-bca` · Kopi sore (QRIS)Kopi & Camilan · BCA −Rp → navigasi → /pribadi/transaksi/e548
- `/pribadi/dompet/acc-bca` · Tol & parkirTransportasi · BCA −Rp 25.00 → navigasi → /pribadi/transaksi/e544
- `/pribadi/dompet/acc-bca` · Muat lagi → tampilan berubah
- `/pribadi/dompet/acc-bca` · Beranda → navigasi → /pribadi/beranda
- `/pribadi/dompet/acc-bca` · Transaksi → navigasi → /pribadi/transaksi
- `/pribadi/dompet/acc-bca` · Catat → dialog terbuka
- `/pribadi/dompet/acc-bca` · Dompet → navigasi → /pribadi/dompet
- `/pribadi/dompet/acc-bca` · Rencana → navigasi → /pribadi/rencana
- `/pribadi/rencana` · Pribadi → tampilan berubah
- `/pribadi/rencana` · Bersama → navigasi → /bersama/rencana
- `/pribadi/rencana` · Menu → dialog terbuka
- `/pribadi/rencana` · Ke Beranda → navigasi → /pribadi/beranda
- `/pribadi/rencana` · Beranda → navigasi → /pribadi/beranda
- `/pribadi/rencana` · Transaksi → navigasi → /pribadi/transaksi
- `/pribadi/rencana` · Catat → dialog terbuka
- `/pribadi/rencana` · Dompet → navigasi → /pribadi/dompet
- `/pribadi/rencana` · Rencana → tampilan berubah
- `/masuk` · Masuk dengan passkey → navigasi → /pribadi/beranda
- `/masuk` · nama@email.com → terisi
- `/masuk` · Kata sandi → terisi
- `/masuk` · Tampilkan kata sandi → tampilan berubah
- `/masuk` · Masuk → navigasi → /amankan
- `/amankan` · Kembali → navigasi → /masuk
- `/amankan` · Buat passkey → tampilan berubah
- `/undang` · Beranda → navigasi → /pribadi/beranda
- `/undang` · nama@email.com → terisi
- `/undang` · Kirim undangan → tampilan berubah
- `/terima-undangan` · Terima undangan → navigasi → /amankan
- `/terima-undangan` · Tolak → navigasi → /masuk

</details>
