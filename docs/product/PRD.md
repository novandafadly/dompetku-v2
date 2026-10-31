# PRD: DompetKu v2

Status: draf revisi setelah review tim (PM, designer, security, backend) dan 18 keputusan pemilik (`review/keputusan-pemilik.md`, semua rekomendasi disetujui 2026-10-31). Belum disetujui sebagai dokumen. Tanggal: 2026-10-31.
Dirangkai dari: spec induk `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` (selanjutnya **Spec**, §9 mengikat), `docs/team/round1/product-manager.md`, `product-owner.md`, `qa.md`, `docs/spec/ui-ux.md`, `docs/m0a-keputusan.md`. Dokumen ini tidak mengubah keputusan; bila ada beda, Spec menang.

## 1. Masalah

v1 terbukti bisa salah menghitung uang dan kehilangan data (audit INT-01..04, Spec §1). Mencatat butuh 5 sampai 6 ketukan (ui-ux R3), layar awal berisi deretan "Rp 0" tanpa ajakan (ui-ux R6), dan tidak ada ruang bersama untuk dua orang. Akibatnya angka tidak dipercaya dan pencatatan harian berhenti.

## 2. Pengguna

Hanya dua orang. Tidak ada pendaftaran terbuka (Spec §2).

| Pengguna | Peran                          | Pola pakai                                                                 |
| -------- | ------------------------------ | -------------------------------------------------------------------------- |
| Novanda  | Pemilik, admin, penentu produk | Cek cepat sebelum jajan (sering malam), mencatat di HP, sesekali di laptop |
| Farida   | Pasangan, diundang Novanda     | Sama; bergabung awal M2 (Spec §9.4), undangan lewat email                  |

Tidak ada persona lain, tidak ada testimoni, tidak ada data riset pengguna selain tim agen di `docs/team/`.

## 3. Tujuan

1. Angka selalu benar dan bisa dijelaskan asalnya (saldo turunan dari jurnal).
2. Mencatat cepat: jalur tercepat ke Simpan ≤ 3 ketukan dari layar mana pun (Spec §1, §9.3); aturan hitung ketukan ada di §7. Jalur lain ("Kategori lain…", ganti dompet) boleh lebih panjang; seberapa sering jalur cepat dipakai diukur sebagai metrik, bukan dijanjikan per catatan.
3. Ruang **Pribadi** per orang dan satu ruang **Bersama**, tanpa kebocoran data Pribadi.
4. Tidak pernah kehilangan data: backup + uji restore, batal dengan jendela 90 hari.
5. Aman setara aplikasi finansial: faktor kuat wajib (passkey ATAU kata sandi + TOTP), kode pemulihan untuk semua akun, undangan sekali pakai lewat email, batas 2 user, sesi terbatas.
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

Notasi: N = Novanda, F = Farida. Milestone dan gerbang keluar dari Spec §9.4. Tiap cerita punya butir **Terima** (Given/When/Then ringkas) atau rujukan ke ID tes di §6. Setiap fitur Spec §9.4 punya minimal satu cerita (diperiksa baris per baris, lihat §6.1).

### Aturan lintas cerita (keputusan pemilik 2026-10-31)

- **Faktor kuat wajib (satu aturan di PRD, AFD, IPD, BSD):** setiap akun harus punya passkey ATAU kata sandi + TOTP aktif sebelum sesi penuh (Spec §9.2). Kode pemulihan dibuat untuk semua akun, termasuk yang hanya memakai passkey. Sesi tanpa faktor kuat (`pending_2fa`) tidak boleh membuka halaman data.
- **Sesi:** idle 7 hari, absolut 30 hari. Gagal login memberi jeda bertahap (naik tiap percobaan) tanpa kunci permanen.
- **Akun pertama dan pemulihan:** akun N lahir dari allowlist env (`AUTH_ALLOWED_EMAILS`); "lupa kata sandi" lewat email; penyedia email transaksional **Resend**. Reset kata sandi mencabut semua sesi dan tidak mematikan faktor kuat.
- **Undangan:** dikirim lewat email (sekaligus memverifikasi email F). Berlaku 72 jam (angka dari prototipe dan BSD, bukan dari Spec; dikonfirmasi pemilik), sekali pakai, terikat email. **Tolak** = undangan hangus. N bisa melihat undangan tertunda, **mencabut**, dan **mengirim ulang** (mengatasi email salah ketik). Undangan baru dianggap **terpakai setelah akun F diamankan** (faktor kuat aktif dan kode pemulihan dikonfirmasi). Akun setengah jadi dihapus setelah 72 jam dan tidak memakan kuota 2 user.
- **Aturan uang:** tagihan rutin yang mulai di masa lalu hanya menghitung dari bulan berjalan; bulan sebelumnya dilewati, tidak dihitung lewat. Biaya transfer dari Kas Kantor masuk angka Kantor, bukan pengeluaran pribadi. Dompet hanya bisa diarsipkan bila saldo 0. Keterangan saat mengambil uang Bersama ke Pribadi disimpan di sisi Pribadi saja (Bersama hanya melihat "Diambil oleh nama").
- **Sampah:** layar Sampah dibangun di M1 (dialog Batalkan menjanjikan pemulihan "dari Sampah" 90 hari).

### M0a: prototipe data demo (selesai, menunggu penilaian)

- Sebagai N dan F, saya mencoba prototipe klik di HP agar bisa menilai alur dan arah visual sebelum infra dibangun. **Terima:** semua tugas di formulir bisa dicoba dari tautan pratinjau.
- Sebagai N, saya melihat Beranda "aman dipakai", Transaksi, Dompet, Catat, dan onboarding dengan data fiktif. **Terima:** tidak ada "Rp 0" tanpa ajakan.
- Sebagai N dan F, saya mengisi `docs/review/m0a-penilaian.md`. **Terima:** lulus bila tidak ada butir "tidak bisa dipakai"; butir lain menjadi issue berlabel `m0a-feedback` dan ADR 0004 ditulis.

### M0b: infra, auth, ruang

Infra (VM, Postgres, backup, deployer) berjalan paralel dengan penilaian M0a; layar auth sungguhan menunggu ADR 0004 (IPD §0).

- Sebagai N, saya masuk dengan passkey, atau kata sandi + TOTP, agar akun uang saya aman. **Terima:** akun tanpa faktor kuat hanya bisa membuka `/amankan`; login salah diberi pesan seragam dan jeda bertahap.
- Sebagai N, saya mendapat kode pemulihan saat mendaftar, juga bila hanya memakai passkey, agar tidak terkunci bila perangkat hilang. **Terima:** kode ditampilkan sekali, sesi naik penuh hanya setelah saya menyatakan sudah menyimpan; kode terpakai hangus.
- Sebagai N, saya mengundang F lewat email (tautan sekali pakai, 72 jam), melihat undangan tertunda, mencabutnya, dan mengirim ulang bila alamat salah. **Terima:** user ketiga ditolak di DB; undangan kedaluwarsa, dicabut, ditolak, atau dipakai ulang menghasilkan halaman galat seragam.
- Sebagai F, saya bisa menolak undangan, dan bila berhenti di tengah pembuatan akun saya dapat melanjutkan mengamankan lewat login berikutnya. **Terima:** akun setengah jadi dihapus setelah 72 jam dan tidak memakan kuota 2 user.
- Sebagai N, saya reset kata sandi lewat email bila lupa. **Terima:** semua sesi dicabut, faktor kuat tetap aktif, respons seragam bagi email terdaftar maupun tidak.
- Sebagai N, saya melihat daftar perangkat dan mencabut sesi (Menu → Pengaturan, Spec §5.3). **Terima:** cookie lama ditolak pada permintaan berikutnya (B19).
- Sebagai N (pemilik), saya membaca audit log (login, undangan, akses DB manual). **Terima:** UPDATE/DELETE atas log ditolak bagi role selain owner.
- Sebagai N, saya yakin rilis rusak tidak merusak data karena deploy menolak digest lebih lama dan rollback otomatis. **Terima:** BR6(b)(c), rollback teruji dengan rilis rusak sengaja.
- Sebagai N dan F, saya punya ruang Pribadi sendiri dan satu ruang Bersama; data Pribadi tidak pernah terlihat orang lain. **Terima:** B1, B11, B12, B17 sampai B19.
- Sebagai N, saya memasang app di layar utama (PWA) agar Catat terbuka cepat. **Terima:** manifest installable.
- Sebagai N, saya yakin data bisa dipulihkan karena restore diuji berkala. **Terima:** BR1 sampai BR4.

### M1: ledger inti

- Sebagai N, saya menambah dompet dengan saldo hari ini (entri "Saldo awal") dan bisa "Cocokkan saldo" bila selisih. **Terima:** selisih menjadi entri `adjustment`, income/expense tidak berubah (S2).
- Sebagai N, saya mengarsipkan dompet hanya bila saldonya 0. **Terima:** arsip saldo ≠ 0 ditolak dengan pesan jelas.
- Sebagai N, saya mencatat pengeluaran atau pemasukan dalam ≤ 3 ketukan di jalur tercepat dengan saran kategori dan nominal "35rb/35k/1,5jt". **Terima:** dari Beranda, Transaksi, dan Dompet; kategori tidak pernah terpilih otomatis.
- Sebagai N, saya mengelola kategori (tambah, ubah, arsip). **Terima:** kategori ruang lain tidak bisa dipakai (B9). Layar Menu → Kategori adalah utang desain (DBD).
- Sebagai N, saya yakin klik ganda atau jaringan putus tidak membuat entri ganda. **Terima:** simpan dua kali dengan `clientId` sama = 1 entri; isi beda = DK410.
- Sebagai N, saya mengubah, membatalkan, dan mengurungkan transaksi tanpa kehilangan jejak. **Terima:** urungkan 6 detik mengembalikan saldo; ubah dengan versi usang ditolak (DK409); riwayat append-only.
- Sebagai N, saya membuka **Sampah**, melihat transaksi batal 90 hari terakhir, dan memulihkannya. **Terima:** entri lewat 90 hari hilang, hanya tersisa tombstone tanpa nominal.
- Sebagai N, saya memindahkan uang antar dompet dan dari ruang Pribadi ke Bersama (`space_transfer`), tanpa terhitung pengeluaran. **Terima:** Σ lines transfer = −biaya (B3).
- Sebagai N, saya mencatat talangan kantor yang tidak terhitung pengeluaran pribadi; biaya transfer dari Kas Kantor masuk angka Kantor. **Terima:** angka pribadi tidak berubah.
- Sebagai N, saya menekan "Tidak ada pengeluaran hari ini" bila memang tidak ada. **Terima:** hari itu tercatat untuk north star (`api.mark_no_spend_day`).
- Sebagai N, saya melihat Bersama saat F belum bergabung (solo) dan Bersama kosong, dengan ajakan mengundang. **Terima:** tidak ada avatar F palsu (butuh desain, DBD §9).
- Sebagai N, saya yakin angka benar karena `dq_reconcile` harian bernilai 0. **Terima:** T18.

### M2: Bersama penuh, anggaran, laporan

- Sebagai F, saya bergabung lewat undangan email dan langsung punya ruang Pribadi kosong serta melihat Bersama. **Terima:** B18; checklist Beranda F berisi 3 langkah (tanpa "Undang Farida").
- Sebagai N dan F, kami menyetor ke Bersama, melihat feed dengan pelaku dan sebelum/sesudah, dan kontribusi per orang. **Terima:** feed tanpa nama dompet atau entri Pribadi (B4, B20).
- Sebagai N dan F, saat mengambil uang Bersama ke Pribadi, keterangan saya tersimpan di Pribadi saja. **Terima:** Bersama hanya menampilkan "Diambil oleh nama" (B6).
- Sebagai N, saya memasang anggaran Pribadi dan Bersama dan melihat "aman dipakai sampai akhir bulan" per ruang. **Terima:** angka Beranda = laporan; anggaran induk menjumlah anak (T17).
- Sebagai N, saya punya tagihan rutin dasar dan melihat tagihan 7 hari ke depan; tagihan yang mulai di masa lalu tidak ditagih mundur. **Terima:** `api.create_bill`; bulan lampau dilewati.
- Sebagai N, saya melihat Ringkasan bulanan dan ekspor CSV. **Terima:** CSV cocok dengan laporan, sel rumus di-escape (K9).
- Sebagai N, saya melakukan review bulanan dan menyalin anggaran dalam 1 ketukan. **Terima:** angka bulan lalu vs rencana sama dengan laporan.

### M3: utang/piutang, modal trading, bagi tagihan

- Sebagai N, saya mencatat utang/piutang ke kontak beserta cicilan; sisa selalu benar; bayar lebih ditolak. **Terima:** T6 sampai T10 (§6).
- Sebagai N, saya mencatat utang berjalan tanpa efek kas (mis. cicilan yang belum dibayar). **Terima:** saldo dompet tidak berubah sampai ada pembayaran.
- Sebagai N, saya mencatat modal trading (hanya Pribadi). **Terima:** B10 (ditolak di Bersama).
- Sebagai N dan F, kami membagi tagihan Bersama yang dibayar dari dompet pribadi; ada saldo antar-anggota dan pelunasan.

### M4: tujuan, aset, net worth

- Sebagai N, saya membuat tujuan tabungan (1 dompet = 1 tujuan aktif). **Terima:** tujuan kedua pada dompet sama ditolak constraint.
- Sebagai N, saya mencatat aset dan saham dengan harga dari server dan melihat net worth per ruang. **Terima:** T11.

### M5: trip, tagihan lanjutan, PDF, kalender, langganan

- Sebagai N, saya mengelompokkan pengeluaran per trip.
- Sebagai N, saya memakai tagihan rutin lanjutan (selain dasar M2). **Terima:** T14, T15.
- Sebagai N, saya melihat kalender arus kas (proyeksi saldo per tanggal).
- Sebagai N, sistem mengusulkan tagihan rutin dari pola berulang (deteksi langganan).
- Sebagai N, saya mengekspor PDF yang angkanya sama dengan laporan.

### M6: teks bebas, AI, offline-baca, foto struk

- Sebagai N, saya mengetik "makan siang 35rb bca" dan mendapat pratinjau yang wajib saya konfirmasi sebelum tersimpan. **Terima:** tidak pernah menyimpan tanpa konfirmasi.
- Sebagai N, saya meminta analisis bulanan (kuota harian) tanpa data Pribadi F ikut terkirim.
- Sebagai N, saya membuka Beranda dan Transaksi saat offline dalam mode baca.
- Sebagai N, saya melampirkan foto struk terenkripsi (tanpa OCR).

### M7: stabilisasi dan portofolio

- Sebagai N, saya mengarsipkan ekspor v1 lalu mematikan v1. **Terima:** daftar periksa di §6.
- Sebagai N, saya mendapat screenshot otomatis 390/1280, terang/gelap, dari data demo.

### M8: kosong

Otomatisasi catat ditunda ke backlog (Spec §9.6). Tidak ada cerita.

## 6. Kriteria terima per milestone

Gerbang keluar dikutip dari Spec §9.4 (mengikat). Kolom "ID tes" memakai registry `docs/team/round1/qa.md` Lampiran A (definisi tiap ID ada di R3, R4, R6, R7 dan Lampiran A di sana; `scripts/check-test-registry.ts` menolak milestone bila ID tanpa tes). "Uji turunan" adalah kriteria tim dan menjadi komitmen setelah pemilik menyetujui dokumen ini.

### 6.1 Definisi bersama

- **"7 hari berturut-turut"** (gerbang M1 dan M2): 7 hari kalender WIB beruntun; pada tiap hari, tiap orang yang diwajibkan punya minimal satu catatan **atau** menekan "Tidak ada pengeluaran hari ini"; dan `dq_reconcile` bernilai 0 pada tiap hari itu. M1: hanya N. M2: N dan F. Hari terlewat mengulang hitungan dari awal. Periode pakai adalah langkah sendiri setelah sprint selesai, bukan kriteria keluar sprint.
- **Lulus penilaian M0a:** tidak ada butir berstatus "tidak bisa dipakai"; butir lain menjadi issue `m0a-feedback`.
- **Persetujuan M7 (daftar periksa):** arsip ekspor v1 terverifikasi (dibuka dan dihitung ulang), screenshot otomatis ada, v1 dimatikan hanya setelah dua butir tadi.
- **Uji turunan** dibaca sebagai "masukan, hasil yang diharapkan" pada kolom kanan.

### 6.2 Tabel milestone

| MS  | Gerbang keluar (Spec §9.4)                                         | ID tes (qa.md Lampiran A)                                                     | Uji turunan (masukan, hasil)                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0a | N dan F menilai prototipe; arah visual dipilih                     | e2e prototipe                                                                 | Formulir terisi; tidak ada butir "tidak bisa dipakai"; ADR 0004 ditulis; temuan lain jadi issue `m0a-feedback`; e2e hijau; JS rute ≤ 162 kB; axe serious/critical = 0                                                                                                                                    |
| M0b | Restore teruji; login 2 akun dengan 2FA; isolasi ruang lulus pgTAP | B1, B11, B12, B17, B18, B19, K1 sampai K7, K12, BR1 sampai BR6                | `GET /api/health` 200; sesi `pending_2fa` ditolak; user ke-3 ditolak di DB; undangan kedaluwarsa, dicabut, ditolak, dipakai ulang ditolak; akun setengah jadi dihapus setelah 72 jam dan tidak memakan kuota; reset kata sandi mencabut sesi; deploy menolak digest lebih lama; rollback otomatis teruji |
| M1  | N memakai 7 hari berturut-turut (§6.1), selisih rekonsiliasi 0     | T1 sampai T5, T12, T13, T16, T18; S1, S2, S3, S6, S7; B1 sampai B10, B16, B20 | Catat ≤ 3 ketukan di jalur tercepat dari Beranda, Transaksi, Dompet; simpan dua kali dengan `clientId` sama = 1 entri; urungkan mengembalikan saldo; F-demo tidak melihat entri Pribadi N-demo; Σ lines transfer = −biaya; entri 31 Okt 23:30 WIB masuk Oktober (T13); Sampah memulihkan dalam 90 hari   |
| M2  | F bergabung; kedua akun 7 hari berturut-turut (§6.1)               | T17; Z1, Z3, Z9, Z10; golden numbers laporan; B13 (laporan Bersama), B14      | Feed Bersama tidak memuat nama dompet atau entri Pribadi; anggaran Pribadi/Bersama terpisah; ekspor CSV cocok dengan laporan; JS rute ≤ 162 kB; Web Vitals di §7                                                                                                                                         |
| M3  | Tes T6 sampai T10 lulus                                            | T6 sampai T10; S4; INT-12; C3                                                 | Bayar > sisa ditolak dan menawarkan "Bayar sisa"; batal cicilan membalik saldo dan sisa; edit keterangan utang tidak mengubah saldo, cicilan, sisa (S4); B10 (utang/modal di Bersama ditolak)                                                                                                            |
| M4  | T11 lulus                                                          | T11; S5                                                                       | `valuation` tidak mengubah pemasukan/pengeluaran; validator harga menolak nilai tak wajar; 1 dompet = 1 tujuan aktif                                                                                                                                                                                     |
| M5  | T14 dan T15 lulus                                                  | T14, T15; Z4, Z5; C5; K9                                                      | Tagihan tgl 31 jatuh 31 Jan, 28/29 Feb, 31 Mar, 30 Apr (T14); job dijalankan 2x = 1 entri (T15); PDF sama dengan laporan                                                                                                                                                                                 |
| M6  | Eval set lulus target (target belum ditetapkan, Belum diputuskan)  | AI 401/429, B13 prompt builder                                                | Tidak pernah menyimpan tanpa konfirmasi; catat tetap jalan saat kuota habis; offline: simpan dinonaktifkan dengan pesan jelas; setelah logout cache kosong                                                                                                                                               |
| M7  | Pemilik menyetujui (daftar periksa §6.1)                           | T18 pada DB produksi; BR5; K11; K12                                           | Arsip ekspor v1 terverifikasi; screenshot otomatis terbentuk; v1 dimatikan setelah itu                                                                                                                                                                                                                   |
| M8  | Tidak ada                                                          | -                                                                             | -                                                                                                                                                                                                                                                                                                        |

Pemeriksaan kelengkapan: T1 sampai T5, T12, T13, T16, T18 di M1; T17 di M2; T6 sampai T10 di M3; T11 di M4; T14, T15 di M5 (seluruh T1 sampai T18 punya milestone); S1, S2, S3, S6, S7 di M1, S4 di M3, S5 di M4.

## 7. Metrik keberhasilan

Semua angka di bawah adalah **target** dari Spec §9.3 dan keputusan pemilik, bukan hasil ukur. Belum ada baseline v1 yang terverifikasi; baseline v2 diukur setelah M1 dipakai. Telemetri lewat `product_events` tanpa nominal atau deskripsi.

| Metrik                              | Target                                                      | Cara ukur                                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| North star: persen hari tercatat    | N ≥ 85%, F ≥ 60%                                            | Hari tercatat ÷ hari yang sudah berakhir (WIB) dalam 30 hari terakhir sejak akun aktif; hari tercatat = ≥ 1 entri atau "Tidak ada pengeluaran hari ini"; F dihitung sejak bergabung |
| Median waktu catat                  | ≤ 8 detik                                                   | Event `catat_dibuka` dan `catat_disimpan` dengan `catat_id` yang sama, selisih waktu (tanpa nominal)                                                                                |
| Catatan ≤ 3 ketukan                 | ≥ 70% catatan                                               | Jumlah `ketukan` pada `catat_disimpan`. Aturan hitung: ketukan = aksi pointer dari tombol Catat sampai Simpan; tombol angka dan ketikan tidak dihitung; pintasan `c` tidak dihitung |
| Selisih rekonsiliasi `dq_reconcile` | 0                                                           | Job harian 01:00 WIB                                                                                                                                                                |
| RPO                                 | ≤ 5 menit                                                   | Latihan PITR bulanan (BR2)                                                                                                                                                          |
| RTO                                 | ≤ 1 jam (≤ 3 jam bila VM DB hilang)                         | Uji restore mingguan (BR4) dan drill kuartalan dengan stopwatch (BR5)                                                                                                               |
| Web Vitals (HP kelas menengah)      | LCP < 2,5 s, INP < 200 ms, CLS < 0,1 (ambang "baik" Google) | Lighthouse CI di pratinjau dan Playwright; satu keputusan, menggantikan CLS < 0,05 di `frontend.md` R11                                                                             |
| JS rute dingin                      | ≤ 162 kB gzip                                               | `budget.spec.ts` (ADR 0002); terukur 160,9 kB `/pribadi/beranda`                                                                                                                    |
| Aksesibilitas                       | axe serious/critical = 0 di terang dan gelap, 320/390/1280  | Playwright                                                                                                                                                                          |

Event telemetri yang ditetapkan pemilik: `catat_dibuka`, `catat_disimpan` (membawa `catat_id` dan `ketukan`), dan event hari tanpa pengeluaran; kolom tepatnya ditetapkan di BSD (`app.product_events`). Metrik penilaian M0a (skala 1 sampai 5 per tugas, ketukan per pengeluaran) dikumpulkan di `docs/review/m0a-penilaian.md`; ambang lulus ada di §6.1.

## 8. Asumsi dan batasan

- Zona Asia/Jakarta, mata uang IDR.
- Hosting self-hosted di OCI milik pemilik, domain `dompet.novandafadly.com` (usulan, Spec §8).
- Akun OCI Pay-As-You-Go; arsitektur CPU diverifikasi di M0b (Spec §9.5).
- Privasi ruang Pribadi terhadap admin server diterima tanpa enkripsi sisi klien; akses DB manual tercatat di audit log (Spec §9.5).
- Hak di Bersama setara untuk kedua anggota (Spec §7a).
- Email transaksional (reset kata sandi, undangan, alert) lewat Resend.

## 9. Pertanyaan terbuka

Keputusan pemilik 2026-10-31 sudah menutup: aturan faktor kuat, cara kirim undangan, sesi, akun pertama dan reset, penyedia email, ambang M0a, definisi 7 hari, telemetri ketukan, Web Vitals, layar Sampah.

1. Penilaian M0a belum diisi (ambang lulus sudah ditetapkan, §6.1).
2. Akses Farida ke pratinjau via Shareable Link menunggu konfirmasi pemilik (ADR 0003).
3. Target eval set M6 Belum diputuskan.
4. Model LLM M6 dipilih pemilik saat M6 (Spec §9.6); Gemini berbayar atau Claude Belum diputuskan.
5. Tanggal gajian per orang untuk "aman dipakai": opsional di Pengaturan, Belum diputuskan jadwalnya (Spec §9.3, register C13).
6. Kanal catat pengganti Telegram (email bank, WhatsApp Cloud API) Belum diputuskan; di backlog.
7. Error tracking (GlitchTip atau log+alert) Belum diputuskan (Spec §8).
