# Keputusan pemilik dari review tim (2026-10-31)

Gabungan butir "Keputusan pemilik" dari `pm.md`, `designer.md`, `backend.md`, `security.md`. Tiap butir punya rekomendasi tim. Pemilik menyetujui semua rekomendasi (2026-10-31).

## A. Auth dan undangan

| #   | Pertanyaan                                    | Rekomendasi                                                                                                                                                                          | Keputusan |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 1   | Faktor kuat login                             | Passkey ATAU kata sandi + TOTP (spec §9.2); kode pemulihan untuk semua akun, termasuk yang hanya passkey                                                                             | Disetujui |
| 2   | Cara kirim undangan                           | Lewat email (sekaligus memverifikasi email Farida)                                                                                                                                   | Disetujui |
| 3   | Tolak, salah email, akun setengah jadi        | Tolak = undangan hangus; Novanda bisa cabut dan kirim ulang; undangan baru terpakai setelah akun diamankan; akun setengah jadi dihapus setelah 72 jam dan tidak memakan kuota 2 user | Disetujui |
| 4   | Sesi dan lockout                              | Sesi idle 7 hari, absolut 30 hari; gagal login = jeda bertahap, tanpa kunci permanen                                                                                                 | Disetujui |
| 5   | Akun pertama, lupa kata sandi, penyedia email | Akun Novanda dari allowlist env; lupa kata sandi lewat email; penyedia Resend                                                                                                        | Disetujui |

## B. Uang

| #   | Pertanyaan                                        | Rekomendasi                                     | Keputusan |
| --- | ------------------------------------------------- | ----------------------------------------------- | --------- |
| 6   | Tagihan yang mulai di masa lalu                   | Bulan sebelumnya dilewati, tidak dihitung lewat | Disetujui |
| 7   | Biaya transfer dari Kas Kantor                    | Masuk angka Kantor, bukan pengeluaran pribadi   | Disetujui |
| 8   | Arsip dompet                                      | Hanya bila saldo 0                              | Disetujui |
| 9   | Keterangan saat mengambil uang Bersama ke Pribadi | Disimpan di sisi Pribadi saja                   | Disetujui |
| 10  | Layar Sampah (dijanjikan teks dialog Batalkan)    | Dibangun di M1                                  | Disetujui |

## C. Rencana dan ukuran

| #   | Pertanyaan                                       | Rekomendasi                                                                                                                                                     | Keputusan |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 11  | Urutan sprint IPD                                | Setujui perbaikan: tabel ruang dan undangan bersama auth; worker minimal sebelum S7; tagihan dasar di S9; event produk dan tombol "Tidak ada pengeluaran" di S6 | Disetujui |
| 12  | Definisi "7 hari berturut-turut" (gerbang M1/M2) | 7 hari kalender WIB beruntun; tiap hari tiap orang punya minimal satu catatan atau menekan "Tidak ada pengeluaran hari ini"                                     | Disetujui |
| 13  | Ambang lulus penilaian M0a                       | Lulus bila tidak ada butir "tidak bisa dipakai"; butir lain jadi issue `m0a-feedback`                                                                           | Disetujui |
| 14  | Penilaian M0a vs M0b                             | Infra M0b jalan paralel; layar auth sungguhan menunggu ADR 0004                                                                                                 | Disetujui |
| 15  | Ukur ketukan dan waktu Catat                     | Tambah event tanpa nominal di `product_events`                                                                                                                  | Disetujui |
| 16  | Target Web Vitals                                | LCP < 2,5 s, INP < 200 ms, CLS < 0,1 (ambang "baik" Google) di HP kelas menengah                                                                                | Disetujui |

## D. Desain

| #   | Pertanyaan                                     | Rekomendasi                                                                                                                                                  | Keputusan |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 17  | Angka besar `display` mengecil di layar sempit | Pertahankan (44 px di 390, mengecil sampai 36 px di 320 agar tidak terpotong)                                                                                | Disetujui |
| 18  | Layar yang belum didesain                      | Agen merancang mengikuti pola Panel Malam + kursi design reviewer; pemilik menilai di pratinjau; layar besar baru (Pengaturan, Analisis) lewat Claude Design | Disetujui |

## Diperbaiki tim tanpa menunggu pemilik

- IPD: urutan sprint (dua temuan kritis PM), BSD divalidasi ulang di PG 17.
- BSD/TRD: tingkat isolasi transaksi ditetapkan dan dikunci (terbukti saldo bisa negatif di REPEATABLE READ), `audit.log` hanya lewat fungsi, indeks FK yang kurang, `month_summary` untuk dompet kantor, tagihan terarsip tidak dihitung, retensi backup vs WAL-G.
- AFD: nama fungsi disamakan dengan BSD, alur masuk dengan TOTP, alur yang belum digambar.
- DBD/kode: kontras tema terang `income` dan `warning` di `surface-3`, `chart-aman` digelapkan; gaya tipografi tambahan dicatat.
- Spec §9.3 diberi catatan "digantikan ADR 0006".
