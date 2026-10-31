# Review kursi designer: DBD dan AFD

Tanggal: 2026-10-31. Cakupan: `docs/product/DBD.md` dan `docs/product/AFD.md` terhadap `DESIGN.md`, ADR 0006, `docs/design/panel-malam/README.md`, `dompetku-tokens.css`, dan kode (`apps/web/src/styles/tokens.css`, `globals.css`; di repo berkas ini ada di `apps/web/src/styles/`, bukan `apps/web/src/app/globals.css`). Dokumen tidak diubah.

Format: `[tingkat] DOK §bagian: masalah. Usulan: perbaikan.`

## Hasil pemeriksaan token

- Semua nilai warna heks di `tokens.css` kode sama persis dengan `dompetku-tokens.css` handoff untuk gelap, terang, dan `system` (dibandingkan tanpa membedakan huruf besar atau kecil; kode memakai huruf kecil). Tidak ada nilai berbeda.
- Selisih yang ada hanya penambahan: `--hover`, `--tab` (ada di tabel README handoff, tidak ada di berkas CSS handoff), `--ruang*`, `--shadow-*`, `--on-ruang`. `--scrim` hanya beda notasi (`rgba(...)` vs `rgb(... / ...)`), nilainya sama.
- Tabel peran di DBD §2.1 dan DESIGN.md cocok dengan token (semua baris dicek, termasuk violet `#B6A3FF` dan `#5B45C9`).
- Rasio kontras di DBD §2.2 saya hitung ulang dan semuanya cocok sampai satu desimal (mis. `border` di `bg` gelap 4,48 ditulis 4,5; `accent-text` terang 5,75 ditulis 5,8).
- Radius, `--spacing: 4px`, breakpoint 600 dan 1024, durasi sheet 200 ms dan toast 160 ms, dan DURATION toast 6000 cocok dengan DBD.
- Teks "Bisa dipulihkan 90 hari dari Sampah", judul Catat, toast Catat, dan "Pilih kategori untuk menyimpan" di kode dan AFD cocok dengan handoff.

## Ringkasan

| Tingkat | DBD | AFD | Total |
| ------- | --- | --- | ----- |
| Kritis  | 0   | 0   | 0     |
| Penting | 4   | 2   | 6     |
| Minor   | 8   | 3   | 11    |

## DBD

- [Penting] DBD §2.3 (tipografi): `display` ditulis 44 (HP), tetapi `globals.css` memakai `clamp(2rem, 11.3vw, 2.75rem)`, jadi 36 px pada 320 px; ada pula gaya yang tidak tercantum di DBD maupun di "Penyimpangan lain yang disengaja" di `IMPLEMENTATION-REPORT.md`: `display-lg` 52, `display-long` (clamp), `amount-sm` 36, `title-lg` 28, `headline` 20, `header` 19, `subheading` 17, `keypad` 22. Angka hero adalah elemen utama layar, jadi selisih dari handoff harus tercatat. Usulan: tambahkan semua gaya ke tabel DBD dengan pemakaiannya, dan catat clamp sebagai penyimpangan sengaja (alasan: nominal panjang `Rp 12.345.678.900` pada 320 px) di laporan implementasi.
- [Penting] DBD §3 (komponen dan keadaan): keadaan yang dijanjikan AFD §3 tidak ada di tabel DBD maupun handoff: peringatan saldo tidak cukup (inline, bukan dialog), galat simpan Catat (sheet tetap terbuka, "Coba lagi"), keadaan "Menyimpan…", bentrok `DK410`. Baris "State" hanya mencakup kosong, memuat, galat per layar. Usulan: tambah keadaan ini ke daftar komponen dan buat bingkai desain sebelum S6.
- [Penting] DBD §5 dan §8: tidak ada keadaan ruang Bersama saat hanya Novanda (Farida belum bergabung sampai M2). Padahal M1 sudah memuat `space_transfer` ke Bersama, Beranda Bersama, feed, dan "Setoran dari nama". Handoff selalu menampilkan dua anggota (avatar N dan F). Usulan: rancang keadaan Bersama solo (aktivitas, kontribusi, ajakan mengundang) dan Bersama kosong sebelum setoran pertama.
- [Penting] DBD §8 dan "Konflik" butir 4: `/buat-akun` dan langkah 3 kode pemulihan sudah diimplementasikan di `apps/web/src/app/(auth)` tetapi tidak ada bingkai handoff (README: A1 sampai A4; langkah 3 "belum digambar"; `/buat-akun` ditambahkan agen, `docs/m0a-keputusan.md`). Layar yang menyimpan kode pemulihan adalah layar paling sensitif di produk. Usulan: pesan desain untuk `/buat-akun` dan kode pemulihan (salin, unduh, konfirmasi "sudah menyimpan", keadaan galat), dan jalankan design critique sebelum M0b.
- [Minor] DBD §2.1: tulisan "Token turunan di kode: `tab`, `hover`, ..." menyiratkan keduanya tambahan agen. Keduanya ada di tabel token README handoff (tab `#141816`/`#FFFFFF`, hover `#212725`/`#F0F3EF`) tetapi tidak di `dompetku-tokens.css` handoff. Usulan: tulis bahwa sumbernya tabel README dan berkas CSS handoff belum lengkap.
- [Minor] DBD §2.1: nilai `chart-aman/tagihan/tagihan-2/wajib`, `accent-hover/press`, `*-tint`, `toast-*` tidak dicantumkan, hanya dirujuk. Bilah proporsi adalah motif identitas, jadi nilai chart sebaiknya ada di DBD. Usulan: tambah baris chart ke tabel §2.1.
- [Minor] DBD §2.2: pasangan di atas `surface-2`, `surface-3`, dan `hover` tidak ada di tabel. Hasil hitung tema terang: `income` di `surface-3` 4,22 dan `warning` di `surface-3` 4,29 (gagal 4,5), `income` di `surface-2` 4,59 dan `warning` 4,67 (lolos tipis). `border` gelap di `surface-3` 3,07 (lolos tipis). Usulan: tambah aturan "teks `income` dan `warning` terang hanya di `bg`, `surface`, `surface-2`" atau pastikan `contrast.test.ts` memuat pasangan itu bila dipakai.
- [Minor] DBD §2.2 dan §6: `chart-aman` terang `#7FAE2A` di atas putih hanya 2,63:1 (di bawah 3:1 untuk grafik non-teks, WCAG 1.4.11); keterangan `aria-label` dan baris rincian dengan swatch menutup informasinya. Usulan: tulis bahwa bilah dikecualikan karena nilainya diulang sebagai teks, atau gelapkan segmen terang.
- [Minor] DBD §2.4: `--radius-xs: 3px` dan `--radius-toast: 14px` ada di kode, sedangkan handoff menulis radius bilah proporsi 4 dan hanya daftar 6, 10, 12, 16, 20, 24. Usulan: perbarui daftar radius atau samakan kode (bilah 4).
- [Minor] DBD §4: kerangka 600 sampai 1023 dan 320 hanya punya bingkai untuk Beranda (X1) dan dialog Catat (L2); Transaksi, Dompet, Detail, dan auth di tablet, serta semua layar di 320, tidak punya bingkai. "Uji wajib 320" ada, desainnya tidak. Usulan: daftarkan sebagai utang desain dan uji lewat screenshot.
- [Minor] DBD §6: WCAG 2.2 disebut, tetapi 3.3.8 Authentication (Minimum) tidak dibahas untuk layar auth: enam kotak kode 6 digit harus menerima tempel dan isi otomatis, kata sandi boleh tempel, dan kode pemulihan bisa disalin. Usulan: tambah butir ke §6 dan ke uji axe/Playwright auth.
- [Minor] DBD pembuka dan Spec §9.3: baris "Visual" di Spec induk (mengikat, "buku kas", nila dan bata) belum diberi catatan penggantian; DBD hanya menyatakan menggantikan `design.md` §9.3 dan `ui-ux.md`. Pembaca yang mengikuti hierarki "§9 menang" bisa salah arah. Usulan: tambah catatan "digantikan ADR 0006" di Spec §9.3 setelah persetujuan pemilik.

## AFD

- [Penting] AFD §1 dan §2: keadaan layar auth yang diperlukan alurnya tidak ada di handoff: kode TOTP salah dan rate limit (A3 hanya satu keadaan), masuk dengan kode pemulihan, passkey dibatalkan atau tidak didukung (pesan dan jalur ke TOTP), pesan "email atau kata sandi salah" seragam, lockout bertahap. Usulan: pesan desain untuk satu set keadaan galat auth sebelum S3.
- [Penting] AFD §1 (B1) dan §6: halaman galat "undangan tidak berlaku", keadaan "Tautan terkirim" setelah Kirim undangan (kode sudah membuatnya, tidak ada bingkai), dan daftar atau pencabutan undangan tidak didesain. Usulan: bingkai untuk ketiganya, dengan salinan yang tidak membocorkan alasan (token salah, kedaluwarsa, terpakai).
- [Minor] AFD §1 (Beranda pertama): checklist "Mulai dari sini" didesain 4 langkah untuk Novanda; untuk Farida langkah "Undang Farida" tidak ada dan penggantinya Belum diputuskan. Usulan: rancang versi 3 langkah (mis. "1 dari 3 selesai") dan butir pengganti.
- [Minor] AFD §4: baris transaksi `space_transfer` ("Setor ke Bersama", "Setoran dari nama", "Diambil oleh nama") tidak punya spesifikasi ikon, warna, dan teks di handoff (TxRow dan ActivityRow hanya menggambarkan pengeluaran). Usulan: tambah spesifikasi TxRow transfer dan ActivityRow setoran; pastikan label teks, bukan warna, yang membedakan.
- [Minor] AFD §5: halaman "Transaksi ini sudah dibatalkan." (URL transaksi yang sudah void) ada di kode tanpa bingkai. Usulan: tambah bingkai D5 dengan aksi "Pulihkan".

## Utang desain (layar atau keadaan disebut dokumen, belum didesain)

M0b sampai M1 (menghalangi pembangunan):

1. Layar Sampah (disebut dialog batalkan, AFD §5, DBD Konflik 4).
2. Menu → Pengaturan: daftar perangkat dan cabut sesi, audit log yang bisa dibaca.
3. `/buat-akun`, langkah 3 kode pemulihan, layar masuk dengan TOTP dan kode pemulihan, lupa kata sandi, pendaftaran pemilik pertama, halaman galat undangan, keadaan tautan terkirim, daftar undangan tertunda.
4. Catat: peringatan saldo tidak cukup, galat simpan, "Menyimpan…", transfer lintas ruang (jenis Transfer ke dompet Bersama), mode "Pindahkan ke ruang lain" bila dari detail.
5. Detail transaksi: sheet Ubah (dan konflik versi), Pindahkan ke ruang lain, halaman transaksi sudah dibatalkan.
6. Dompet: Cocokkan saldo, edit saldo awal 7 hari pertama, arsipkan dompet, talangan dan reimburse (ikon dan alur "Menunggu reimburse").
7. Bersama solo (Farida belum bergabung) dan Bersama kosong.
8. Checklist Beranda untuk Farida.

M2 sampai M7:

9. Setoran ke Bersama, feed dengan sebelum dan sesudah, kontribusi per orang.
10. Anggaran (editor, salin 1 ketukan), tagihan rutin (form, tampilan lanjutan), review bulanan, Rencana yang nyata (menggantikan R1), laporan dan grafik (Recharts), ekspor CSV dan PDF.
11. Menu: Trip, Kategori, Kontak, Export, Analisis (semuanya "Segera").
12. M3 sampai M6: utang/piutang dan cicilan, modal trading, bagi tagihan Bersama, tujuan, aset dan saham, net worth, kalender arus kas, deteksi langganan, Catat teks bebas (pratinjau wajib konfirmasi), analisis AI, mode offline-baca, foto struk, keadaan kuota habis.
13. PWA: ikon aplikasi, layar splash, favicon (menunggu berkas dari pemilik), dialog pasang.

Lintas layar:

14. Bingkai tablet (600 sampai 1023) selain Beranda dan Catat; bingkai 320 px; bingkai terang untuk auth, Menu, Rencana, Tambah dompet, dan Detail dompet.
15. Halaman 404 dan sesi kedaluwarsa (pengalihan ke masuk).

## Keputusan pemilik

1. Selisih tipografi sengaja: `display` memakai clamp (36 sampai 44) dan gaya tambahan di kode. Dipertahankan, atau dipaksa mengikuti handoff 44 tetap dengan risiko nominal panjang meluap di 320.
2. Utang desain butir 1 sampai 8: siapa yang merancang (Claude Design lagi atau agen mengikuti pola handoff) dan sebelum sprint mana (usulan: auth sebelum S3, Sampah dan keadaan Catat sebelum S6, Bersama solo sebelum S7).
3. Layar Sampah di M1 atau teks dialog diganti sementara (juga di Keputusan pemilik pada `pm.md`).
4. Segmen grafik terang `chart-aman` (2,63:1): terima karena informasi diulang sebagai teks, atau gelapkan.
5. Catatan penggantian pada Spec §9.3 ("buku kas" digantikan ADR 0006): boleh ditambahkan ke Spec induk yang sudah disetujui.
