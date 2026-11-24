# Bingkai Desain S16 — Kalender arus kas, deteksi langganan, ekspor PDF

**Tanggal:** 2026-11-24  
**Arah visual:** Panel Malam (`DESIGN.md`), token warna semantik yang sudah ada (`bg-canvas`, `bg-surface`, `border-hairline`, `text-text`, `text-text-soft`, `text-text-muted`, `text-accent-text`, `text-danger`, `bg-danger-soft`, `text-ok`), tanpa warna baru dan tanpa ikon pihak ketiga baru.  
**Prinsip antislop:** tidak ada `Rp 0`, tidak ada tanda seru `!`, tidak ada kata "rumah tangga" di teks UI, tidak ada emoji, tidak ada istilah Inggris keuangan terlarang, tidak ada status berbasis warna saja (selalu ikon + teks), target sentuh >= 44 px, tata letak bersih pada 320 / 390 / 1280 px mode gelap & terang, budget JS muat dingin <= 162 kB per rute, mode prototipe tidak berubah.

## Daftar layar & titik masuk (S16-KL*, S16-LG*, S16-PD*)

| ID          | Layar / komponen                                  | Rute / tempat                               | Keterangan                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S16-KL1** | Tautan masuk Kalender arus kas                    | `/[ruang]/rencana?bagian=tagihan`           | Tautan teks berikon `CalendarDotsIcon` di atas daftar Tagihan (pola tautan Review bulanan di Anggaran): `Lihat kalender arus kas`.                                                                                                                                                                                                                                                |
| **S16-KL2** | Halaman Kalender arus kas (jendela 30/60/90 hari) | `/[ruang]/rencana/kalender?hari=30\|60\|90` | Server Component murni (tanpa pulau JS baru; pemilih hari = tautan `Link` bersegmen). Header dengan tombol kembali ke `Rencana > Tagihan`, pemilih jendela `30 hari` / `60 hari` / `90 hari`, kartu ringkasan saldo operasional + total tagihan + saldo terendah, catatan jujur pemasukan belum diproyeksikan, dan daftar hari yang memuat tagihan.                               |
| **S16-KL3** | Keadaan "Kurang" di Kalender arus kas             | `/[ruang]/rencana/kalender`                 | Saat ada hari dengan `closing < 0`: lencana ikon `WarningCircleIcon` + teks `Kurang` pada ringkasan dan baris hari yang kurang (tidak hanya warna merah), menyebut hari pertama saldo turun di bawah nol.                                                                                                                                                                         |
| **S16-KL4** | Keadaan kosong & gagal muat Kalender              | `/[ruang]/rencana/kalender`                 | Tanpa tagihan terbuka dalam jendela: kartu tenang menyebut saldo operasional tetap datar dan tombol ke `Rencana > Tagihan`. Gagal muat: `ErrorState` + `RetryIsland`.                                                                                                                                                                                                             |
| **S16-LG1** | Kartu Saran langganan                             | `/[ruang]/rencana?bagian=tagihan`           | Hanya muncul bila `api.detect_subscriptions` mengembalikan >= 1 baris (tidak menampilkan kartu kosong agar layar tetap tenang). Daftar baris: nama, pola `Terdeteksi N bulan · tgl D`, nominal, tombol `Jadikan tagihan` dan `Abaikan`.                                                                                                                                           |
| **S16-LG2** | Isi awal sheet Tambah tagihan                     | Sheet `BillSheet` di Rencana                | Menekan `Jadikan tagihan` membuka `BillSheet` yang sudah diisi nama (dipotong maks 60 huruf), nominal, tanggal jatuh tempo, kategori aktif (bila ada), dan dompet operasional aktif (bila ada). Pengguna tetap meninjau lalu menekan `Simpan`.                                                                                                                                    |
| **S16-LG3** | Abaikan saran langganan                           | Tombol `Abaikan` di S16-LG1                 | Memanggil `dismissSubscriptionAction` (idempoten), menyegarkan daftar, dan menampilkan toast `Saran <nama> diabaikan`.                                                                                                                                                                                                                                                            |
| **S16-PD1** | Tombol Ekspor PDF di Laporan                      | `/[ruang]/laporan`                          | Diletakkan sejajar (responsif wrap di 320 px) bersama `Ekspor CSV` dalam pulau malas `ExportIsland`. Tautan unduh langsung (`download`) dengan progres `Menyiapkan…`, validasi `Content-Type: application/pdf`, toast selesai/galat yang sama jelasnya dengan CSV.                                                                                                                |
| **S16-PD2** | Isi berkas PDF Laporan                            | `GET /[ruang]/laporan/ekspor-pdf`           | Judul `Laporan Dompetku · Pribadi/Bersama`, subjudul periode + basis, blok Ringkasan (Pemasukan, Pengeluaran, Selisih — identik dengan Laporan), tabel Kategori pengeluaran & pemasukan, tabel Di luar ringkasan (bila ada), tabel Daftar transaksi (Tanggal, Dompet, Kategori, Catatan, Nominal — sama dengan baris `api.export_entries`), kaki `Dompetku` + `Halaman X dari Y`. |

## Salinan final S16 (Bahasa Indonesia, tanpa `!`, tanpa `Rp 0`)

- **Kalender arus kas (`features/rencana/kalender-copy.ts`):**
  - Tautan masuk: `Kalender arus kas`
  - Judul halaman: `Kalender arus kas`
  - Tombol kembali: `Kembali ke Tagihan`
  - Jendela: `30 hari`, `60 hari`, `90 hari`
  - Label ringkasan: `Saldo operasional`, `Tagihan dalam jendela`, `Saldo terendah`
  - Status negatif (ikon + teks): `Kurang`
  - Keterangan tanggal pertama kurang: `(d) => \`Saldo diperkirakan kurang mulai ${d}\``
  - Catatan jujur: `Hanya menghitung saldo operasional hari ini dikurangi tagihan terjadwal. Pemasukan belum diproyeksikan.`
  - Penanda tagihan terlambat: `(d) => \`Lewat jatuh tempo (${d})\``
  - Penanda proyeksi: `Perkiraan`
  - Baris saldo akhir hari: `Saldo akhir`
  - Kosong: judul `Tidak ada tagihan terjadwal`, deskripsi `(n) => \`Tidak ada tagihan terbuka dalam ${n} hari ke depan. Saldo operasional diperkirakan tetap.\``
  - Gagal muat: judul `Kalender belum bisa dimuat`, deskripsi `Sambungan ke server terputus. Coba muat ulang.`
- **Deteksi langganan (`features/rencana/copy.ts` `LANGGANAN_COPY`):**
  - Judul kartu: `Saran langganan`
  - Subjudul: `Pengeluaran berulang yang belum masuk daftar tagihan.`
  - Meta baris: `(months, day) => \`${months} bulan berulang · sekitar tgl ${day}\``
  - Tombol utama baris: `Jadikan tagihan`
  - Tombol sekunder baris: `Abaikan`
  - Toast abaikan: `(name) => \`Saran ${name} diabaikan\``
  - Toast gagal abaikan: `Belum berhasil mengabaikan saran. Coba lagi.`
- **Ekspor PDF (`app/[ruang]/_real/ekspor-copy.ts`):**
  - Tombol CSV: `Ekspor CSV` (tetap)
  - Tombol PDF: `Ekspor PDF`
  - Petunjuk baru di Laporan: `(title, ruang) => \`Laporan ${title} · ${RUANG_NAME[ruang]}. CSV untuk Excel atau Sheets; PDF siap cetak.\``
  - Toast PDF selesai: `(title, ruang) => \`PDF ${title} · ${RUANG_NAME[ruang]} selesai\``

## Kriteria Delivery Gate S16

- Tangkapan layar nyata (Playwright) pada 320, 390, dan 1280 px, gelap & terang, untuk:
  1. `/pribadi/rencana?bagian=tagihan` (tautan Kalender + kartu Saran langganan)
  2. `/pribadi/rencana/kalender` (30 hari, ada tagihan & saldo kurang)
  3. `/pribadi/rencana/kalender?hari=90` (proyeksi 90 hari)
  4. `/pribadi/laporan` (tombol `Ekspor CSV` + `Ekspor PDF` berdampingan, bebas overflow 320 px)
  5. `/bersama/rencana/kalender` (ruang Bersama)
- Overflow horizontal = 0 di semua viewport; 0 kata terlarang; 0 `Rp 0`; 0 pelanggaran axe serius; budget JS muat dingin <= 162 kB per rute; kritik dicatat di `docs/design/s16-critique.md`.
