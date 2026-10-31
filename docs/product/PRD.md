# PRD: DompetKu v2

Status: draf untuk review tim, belum disetujui pemilik. Tanggal: 2026-10-31.
Dirangkai dari: spec induk `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` (selanjutnya **Spec**, §9 mengikat), `docs/team/round1/product-manager.md`, `product-owner.md`, `qa.md`, `docs/spec/ui-ux.md`, `docs/m0a-keputusan.md`. Dokumen ini tidak mengubah keputusan; bila ada beda, Spec menang.

## 1. Masalah

v1 terbukti bisa salah menghitung uang dan kehilangan data (audit INT-01..04, Spec §1). Mencatat butuh 5 sampai 6 ketukan (ui-ux R3), layar awal berisi deretan "Rp 0" tanpa ajakan (ui-ux R6), dan tidak ada ruang bersama untuk dua orang. Akibatnya angka tidak dipercaya dan pencatatan harian berhenti.

## 2. Pengguna

Hanya dua orang. Tidak ada pendaftaran terbuka (Spec §2).

| Pengguna | Peran                          | Pola pakai                                                                 |
| -------- | ------------------------------ | -------------------------------------------------------------------------- |
| Novanda  | Pemilik, admin, penentu produk | Cek cepat sebelum jajan (sering malam), mencatat di HP, sesekali di laptop |
| Farida   | Pasangan, diundang Novanda     | Sama; bergabung awal M2 (Spec §9.4)                                        |

Tidak ada persona lain, tidak ada testimoni, tidak ada data riset pengguna selain tim agen di `docs/team/`.

## 3. Tujuan

1. Angka selalu benar dan bisa dijelaskan asalnya (saldo turunan dari jurnal).
2. Mencatat cepat: ≤ 3 ketukan dari layar mana pun (Spec §1, §9.3).
3. Ruang **Pribadi** per orang dan satu ruang **Bersama**, tanpa kebocoran data Pribadi.
4. Tidak pernah kehilangan data: backup + uji restore, batal dengan jendela 90 hari.
5. Aman setara aplikasi finansial: passkey atau password+TOTP, kode pemulihan, undangan sekali pakai, batas 2 user.
6. Tampilan rapi dan layak jadi portofolio (screenshot data demo saja), arah visual Panel Malam (ADR 0006).

## 4. Bukan tujuan

- Bukan SaaS: tanpa pendaftaran terbuka, billing, atau trial (Spec §2).
- Repo private, tanpa mode demo publik.
- Tanpa multi-mata-uang, tanpa impor mutasi bank di MVP, tanpa berbagi selain satu ruang Bersama.
- Tanpa migrasi data v1; kedua akun mulai dari nol (Spec §3, §7a). v1 diarsipkan lewat ekspor.
- Kartu kredit ditunda (Spec §7).
- Otomatisasi catat (email, WhatsApp, Telegram) ditunda ke backlog; M8 kosong (Spec §9.6).
- "Total keluarga" lintas ruang ditunda (Spec §5.4).

Anti-tujuan (gagal walau "jalan"): saldo melenceng dari riwayat, data Pribadi terlihat pasangan lewat jalur apa pun (laporan, ekspor, AI, log), database terbuka ke internet, kontras gagal AA, aksi tersembunyi di hover (Spec §2).

## 5. Cerita pengguna per milestone

Notasi: N = Novanda, F = Farida. Milestone dan gerbang keluar dari Spec §9.4. Kriteria terima rinci ada di §6.

### M0a: prototipe data demo (selesai, menunggu penilaian)

- Sebagai N dan F, saya mencoba prototipe klik di HP agar bisa menilai alur dan arah visual sebelum infra dibangun.
- Sebagai N, saya melihat Beranda "aman dipakai", Transaksi, Dompet, Catat, dan onboarding dengan data fiktif.
- Sebagai N dan F, saya mengisi `docs/review/m0a-penilaian.md`.

### M0b: infra, auth, ruang

- Sebagai N, saya masuk dengan passkey, atau password+TOTP, agar akun uang saya aman.
- Sebagai N, saya mendapat kode pemulihan saat mendaftar agar tidak terkunci bila perangkat hilang.
- Sebagai N, saya mengundang F lewat tautan sekali pakai (72 jam) dan sistem menolak user ketiga.
- Sebagai N dan F, saya punya ruang Pribadi sendiri dan satu ruang Bersama; data Pribadi tidak pernah terlihat orang lain.
- Sebagai N, saya memasang app di layar utama (PWA) agar Catat terbuka cepat.
- Sebagai N, saya yakin data bisa dipulihkan karena restore diuji berkala.

### M1: ledger inti

- Sebagai N, saya menambah dompet dengan saldo hari ini (tercatat sebagai entri "Saldo awal") dan bisa "Cocokkan saldo" bila selisih.
- Sebagai N, saya mencatat pengeluaran atau pemasukan dalam ≤ 3 ketukan dengan saran kategori dan nominal "35rb/35k/1,5jt".
- Sebagai N, saya yakin klik ganda atau jaringan putus tidak membuat entri ganda (idempoten).
- Sebagai N, saya mengubah, membatalkan, dan mengurungkan transaksi tanpa kehilangan jejak.
- Sebagai N, saya memindahkan uang antar dompet dan dari ruang Pribadi ke Bersama (`space_transfer`), tanpa terhitung sebagai pengeluaran.
- Sebagai N, saya mencatat talangan kantor yang tidak terhitung sebagai pengeluaran pribadi.

### M2: Bersama penuh, anggaran, laporan

- Sebagai F, saya bergabung lewat undangan dan langsung punya ruang Pribadi kosong serta melihat ruang Bersama.
- Sebagai N dan F, kami menyetor ke Bersama, melihat feed aktivitas dengan pelaku dan sebelum/sesudah, dan kontribusi per orang.
- Sebagai N, saya memasang anggaran Pribadi dan Bersama dan melihat "aman dipakai sampai akhir bulan" per ruang.
- Sebagai N, saya punya tagihan rutin dasar dan melihat tagihan 7 hari ke depan.
- Sebagai N, saya melihat Ringkasan bulanan dan ekspor CSV.
- Sebagai N, saya melakukan review bulanan (bulan lalu vs rencana) dan menyalin anggaran dalam 1 ketukan.

### M3: utang/piutang, modal trading, bagi tagihan

- Sebagai N, saya mencatat utang/piutang ke kontak beserta cicilan; sisa selalu benar; bayar lebih ditolak.
- Sebagai N, saya mencatat modal trading (hanya ruang Pribadi).
- Sebagai N dan F, kami membagi tagihan Bersama yang dibayar dari dompet pribadi; ada saldo antar-anggota dan pelunasan.

### M4: tujuan, aset, net worth

- Sebagai N, saya membuat tujuan tabungan (1 dompet = 1 tujuan aktif).
- Sebagai N, saya mencatat aset dan saham dengan harga dari server dan melihat net worth per ruang.

### M5: trip, tagihan lanjutan, PDF, kalender, langganan

- Sebagai N, saya mengelompokkan pengeluaran per trip.
- Sebagai N, saya melihat kalender arus kas (proyeksi saldo per tanggal).
- Sebagai N, sistem mengusulkan tagihan rutin dari pola berulang (deteksi langganan).
- Sebagai N, saya mengekspor PDF yang angkanya sama dengan laporan.

### M6: teks bebas, AI, offline-baca, foto struk

- Sebagai N, saya mengetik "makan siang 35rb bca" dan mendapat pratinjau yang wajib saya konfirmasi sebelum tersimpan.
- Sebagai N, saya meminta analisis bulanan (kuota harian) tanpa data Pribadi F ikut terkirim.
- Sebagai N, saya membuka Beranda dan Transaksi saat offline dalam mode baca.
- Sebagai N, saya melampirkan foto struk terenkripsi (tanpa OCR).

### M7: stabilisasi dan portofolio

- Sebagai N, saya mengarsipkan ekspor v1 lalu mematikan v1.
- Sebagai N, saya mendapat screenshot otomatis 390/1280, terang/gelap, dari data demo.

### M8: kosong

Otomatisasi catat ditunda ke backlog (Spec §9.6). Tidak ada cerita.

## 6. Kriteria terima per milestone

Gerbang keluar dikutip dari Spec §9.4 (mengikat). Butir "uji" diambil dari kriteria tim (`docs/team/round1/*.md` §5, `qa.md`) dan menjadi turunan, bukan tambahan komitmen sampai pemilik menyetujui dokumen ini.

| MS  | Gerbang keluar (Spec §9.4)                                         | Uji turunan                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0a | N dan F menilai prototipe; arah visual dipilih                     | Formulir `docs/review/m0a-penilaian.md` terisi; ADR 0004 ditulis; temuan menjadi issue label `m0a-feedback`; e2e hijau; JS rute ≤ 162 kB; axe serious/critical = 0                                    |
| M0b | Restore teruji; login 2 akun dengan 2FA; isolasi ruang lulus pgTAP | `GET /api/health` 200; sesi `pending_2fa` ditolak; user ke-3 ditolak di DB; undangan kedaluwarsa/dipakai ulang ditolak; deploy menolak digest lebih lama; rollback otomatis teruji                    |
| M1  | N memakai 7 hari berturut-turut, selisih rekonsiliasi 0            | Catat ≤ 3 ketukan dari Beranda, Transaksi, Dompet; simpan dua kali dengan `clientId` sama = 1 entri; urungkan mengembalikan saldo; F-demo tidak melihat entri Pribadi N-demo; Σ lines transfer = −fee |
| M2  | F bergabung; kedua akun 7 hari berturut-turut                      | Feed Bersama tidak memuat nama dompet atau entri Pribadi; anggaran Pribadi/Bersama terpisah; ekspor CSV cocok dengan laporan; JS rute ≤ 162 kB                                                        |
| M3  | Tes T6 sampai T10 lulus (definisi di `docs/team/round1/qa.md` §M3) | Bayar > sisa ditolak dan tawarkan "Bayar sisa"; batal cicilan membalik saldo dan sisa                                                                                                                 |
| M4  | T11 lulus                                                          | `valuation` tidak mengubah pemasukan/pengeluaran; validator harga menolak nilai tak wajar                                                                                                             |
| M5  | T14 dan T15 lulus                                                  | Tagihan tgl 31 jatuh 31 Jan, 28/29 Feb, 31 Mar, 30 Apr; job dijalankan 2x = 1 entri; PDF sama dengan laporan                                                                                          |
| M6  | Eval set lulus target (target belum ditetapkan, Belum diputuskan)  | Tidak pernah menyimpan tanpa konfirmasi; catat tetap jalan saat kuota habis; offline: simpan dinonaktifkan dengan pesan jelas; setelah logout cache kosong                                            |
| M7  | Pemilik menyetujui                                                 | Arsip ekspor v1 ada; screenshot otomatis terbentuk                                                                                                                                                    |
| M8  | Tidak ada                                                          | Tidak ada                                                                                                                                                                                             |

## 7. Metrik keberhasilan

Semua angka di bawah adalah **target** dari Spec §9.3, bukan hasil ukur. Belum ada baseline v1 yang terverifikasi; baseline v2 diukur setelah M1 dipakai. Pengukuran lewat `product_events` tanpa nominal/deskripsi.

| Metrik                              | Target                                                     | Cara ukur                                                          |
| ----------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| North star: persen hari tercatat    | N ≥ 85%, F ≥ 60%                                           | Hari dengan ≥ 1 entri atau tombol "Tidak ada pengeluaran hari ini" |
| Median waktu catat                  | ≤ 8 detik                                                  | Dari buka Catat sampai tersimpan                                   |
| Catatan ≤ 3 ketukan                 | ≥ 70%                                                      | Hitung aksi pointer, tidak termasuk tombol angka (ui-ux R3)        |
| Selisih rekonsiliasi `dq_reconcile` | 0                                                          | Job harian 01:00 WIB                                               |
| RPO / RTO                           | ≤ 5 menit / ≤ 1 jam (≤ 3 jam bila VM DB hilang)            | Uji restore mingguan, latihan PITR bulanan                         |
| JS rute dingin                      | ≤ 162 kB gzip                                              | `budget.spec.ts` (ADR 0002); terukur 160,9 kB `/pribadi/beranda`   |
| Aksesibilitas                       | axe serious/critical = 0 di terang dan gelap, 320/390/1280 | Playwright                                                         |

Metrik penilaian M0a (skala 1 sampai 5 per tugas, ketukan per pengeluaran) dikumpulkan di `docs/review/m0a-penilaian.md`; belum ada ambang lulus tertulis (Belum diputuskan).

## 8. Asumsi dan batasan

- Zona Asia/Jakarta, mata uang IDR.
- Hosting self-hosted di OCI milik pemilik, domain `dompet.novandafadly.com` (usulan, Spec §8).
- Akun OCI Pay-As-You-Go; arsitektur CPU diverifikasi di M0b (Spec §9.5).
- Privasi ruang Pribadi terhadap admin server diterima tanpa enkripsi sisi klien; akses DB manual tercatat di audit log (Spec §9.5).
- Hak di Bersama setara untuk kedua anggota (Spec §7a).

## 9. Pertanyaan terbuka

1. Penilaian M0a belum diisi; ambang lulus (selain "dinilai") Belum diputuskan.
2. Akses Farida ke pratinjau via Shareable Link menunggu konfirmasi pemilik (ADR 0003).
3. Target eval set M6 Belum diputuskan.
4. Model LLM M6 dipilih pemilik saat M6 (Spec §9.6); Gemini berbayar atau Claude Belum diputuskan.
5. Tanggal gajian per orang untuk "aman dipakai": opsional di Pengaturan, Belum diputuskan jadwalnya (Spec §9.3, register C13).
6. Apakah TOTP wajib selain passkey: Spec §9.2 mengizinkan "passkey ATAU password+TOTP"; prototipe menampilkan passkey lalu TOTP lalu pemulihan. Aturan akhir Belum diputuskan, ditetapkan di BSD/M0b.
7. Kanal catat pengganti Telegram (email bank, WhatsApp Cloud API) Belum diputuskan; di backlog.
8. Penyedia email transaksional dan error tracking (GlitchTip atau log+alert) Belum diputuskan (Spec §8).
