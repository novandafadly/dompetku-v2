# Bingkai Desain S18 — Analisis AI, PWA offline-baca, dan Foto struk terenkripsi

**Tanggal:** 2026-11-24  
**Arah visual:** Panel Malam (`DESIGN.md`), token semantik yang ada (`bg-surface`, `bg-bg`, `border-hairline`, `border-border`, `text-text`, `text-text-soft`, `text-text-muted`, `text-accent-text`, `bg-accent-tint`, `bg-danger-tint`, `text-danger`), tanpa warna baru dan tanpa ikon pihak ketiga baru.  
**Prinsip antislop:** tanpa `Rp 0`, tanpa `!`, tanpa "rumah tangga", tanpa emoji, tanpa istilah Inggris terlarang, target sentuh >= 44 px, bersih pada 320 / 390 / 1280 px gelap & terang, prototipe tidak berubah, budget JS <= 162 kB.

## Komponen & Alur (S18-*)

| ID          | Komponen                                            | Tempat                                                                        | Perilaku                                                                                                                                                                                                                                                                                 |
| ----------- | --------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S18-AN1** | Halaman `/[ruang]/analisis`                         | Menu → `Analisis AI` (mode nyata saja; prototipe 404)                         | Pemilih bulan (Bulan ini / Bulan lalu), ringkasan angka SQL (Pemasukan, Pengeluaran, Selisih, Top kategori), dan kartu Analisis AI dengan sisa kuota (`X dari 5 hari ini`) + tombol `Buat analisis AI` (`min-h-11`).                                                                     |
| **S18-AN2** | Kartu hasil Analisis AI                             | Di bawah tombol `Buat analisis AI`                                            | Menampilkan sumber (`Gemini` / `Claude`), `Ringkasan`, `Sorotan utama` (poin singkat), `Langkah praktis`, dan catatan jujur (`Analisis ini bersifat informatif berdasarkan ringkasan ruang ini saja.`).                                                                                  |
| **S18-AN3** | Keadaan kuota habis / AI mati / belum ada transaksi | Kartu Analisis AI                                                             | Jika kuota 5/5 habis: pesan jelas tanpa crash, ringkasan angka SQL tetap tampil. Jika belum ada transaksi pada periode itu: tidak memotong kuota, tampilkan pesan kosong jujur.                                                                                                          |
| **S18-ST1** | Kartu `Foto struk` di Detail transaksi              | `DetailReal` mode nyata saja (di bawah rincian transaksi)                     | Menampilkan jumlah foto (`n dari 3`), daftar gambar terenkripsi dengan tombol `Lihat` (buka tab/pratinjau penuh) dan `Hapus` (`min-h-11`), serta tombol `Tambah foto struk` (`accept="image/jpeg,image/png,image/webp"`, maks 2 MB, maks 3 foto). Entri batal hanya baca (tanpa unggah). |
| **S18-PW1** | Banner status offline                               | Bagian atas `RuangShellReal` (muncul hanya saat `navigator.onLine === false`) | `role="status"` bernada tenang: `Sedang offline. Menampilkan data terakhir yang tersimpan. Pencatatan butuh koneksi.`                                                                                                                                                                    |

## Salinan final S18 (Bahasa Indonesia, tanpa `!`, tanpa `Rp 0`)

- Judul halaman analisis: `Analisis AI`
- Subjudul: `Ringkasan pola pengeluaran dari data ruang ini saja.`
- Tombol utama: `Buat analisis AI` (saat memuat: `Menganalisis…`)
- Sisa kuota: `(rem, lim) => \`Sisa analisis AI hari ini: ${rem} dari ${lim}.\``
- Kuota habis: `Kuota analisis AI hari ini sudah habis. Coba lagi besok sesudah 00.00 WIB.`
- AI belum aktif: `Analisis AI belum diaktifkan di server. Ringkasan angka di atas tetap bisa dilihat.`
- Tanpa transaksi: `Belum ada pengeluaran atau pemasukan pada periode ini untuk dianalisis.`
- Catatan disclaimer: `Analisis ini bersifat informatif berdasarkan ringkasan angka ruang ini saja.`
- Kartu foto struk: judul `Foto struk`, keterangan `JPG, PNG, atau WebP, maksimal 2 MB per foto (hingga 3 foto). Disimpan terenkripsi.`
- Tombol unggah: `Tambah foto struk` (saat memuat: `Mengunggah…`)
- Kunci server kosong: `Unggah foto struk belum diaktifkan di server.`
- Banner offline: `Sedang offline. Menampilkan data terakhir yang tersimpan. Pencatatan butuh koneksi.`
