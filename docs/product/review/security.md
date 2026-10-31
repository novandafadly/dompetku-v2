# Review kursi Security: BSD, TRD

Tanggal: 2026-10-31. Cakupan: `docs/product/BSD.md`, `docs/product/TRD.md` (dengan AFD §1 dan §6 untuk alur undangan). Pembanding: Spec induk (§9 mengikat), `docs/adr/`, `docs/m0a-keputusan.md`. Dokumen tidak diubah.

Format: `[tingkat] DOK §bagian: masalah (bukti). Usulan: perbaikan.` Temuan bertanda **[terbukti]** sudah dijalankan di cluster PostgreSQL 16 sekali pakai (DDL BSD dimuat berurutan, `bsd-check/test.sql` lulus; cluster sudah dihapus).

Yang diperiksa dan **tidak** bermasalah: 18 tabel `app`/`audit` ENABLE + FORCE RLS; Farida tidak melihat ruang, akun, entri, lines, history, tombstone, atau laporan Pribadi Novanda dan mendapat `DK404` di fungsi baca/tulis (tes BSD); kaki `in` tanpa deskripsi dan snapshot history tanpa deskripsi; pelanggaran CHECK/UNIQUE dari dalam fungsi tidak membawa `DETAIL` berisi nilai baris karena tabel ber-RLS (diuji: pesan hanya nama constraint); semua fungsi DEFINER `search_path=""` dan pemiliknya sesuai daftar tertutup; undangan disimpan sebagai hash SHA-256, `FOR UPDATE` + `used_at` membuat sekali pakai, CHECK 72 jam, satu undangan terbuka per rumah tangga, `user_cap` di bawah advisory lock; `app.now()` override hanya bila `env` dev/test.

## Ringkasan

| Tingkat | BSD | TRD | Total |
| ------- | --- | --- | ----- |
| Kritis  | 0   | 0   | 0     |
| Penting | 3   | 5   | 8     |
| Minor   | 9   | 6   | 15    |

## Privasi antar ruang dan RLS

- [Penting] BSD §9 (`api.create_transfer`), Spec §9.1: aturan "kaki tujuan tanpa deskripsi" hanya melindungi setoran Pribadi ke Bersama. Saat mengambil uang dari Bersama ke Pribadi, deskripsi ditulis di kaki `out` yang ada di ruang Bersama, sehingga pasangan membacanya di `entries` dan `entry_history.snapshot`. **[terbukti]** Novanda memindah 40 dari Kas Rumah (Bersama) ke BCA (Pribadi) dengan deskripsi "kado rahasia untuk Farida"; sesi Farida membaca teks itu di kedua tabel. Usulan: deskripsi selalu ditempel di kaki yang berada di ruang Pribadi; kaki di ruang Bersama hanya membawa `shared_note`; tambah CHECK `kind <> 'space_transfer' or space_kind = 'personal' or description is null`; tambah ke tes #13. Lihat Keputusan pemilik 1.
- [Minor] BSD §11: FORCE RLS tidak berpengaruh karena pemilik tabel (`dompetku_owner`) punya BYPASSRLS. Kontrol yang sebenarnya adalah daftar tertutup fungsi DEFINER milik owner (tes katalog #5). Usulan: tulis ini eksplisit di §11 supaya tidak ada yang mengira FORCE melindungi dari fungsi owner, dan jadikan tes #5 penghalang merge.
- [Minor] BSD §6 (`audit.events`, `product_events`): id identity global; Farida melihat celah nomor di baris auditnya sendiri sehingga bisa memperkirakan jumlah dan waktu aktivitas Novanda. Risiko rendah. Usulan: terima dan catat, atau pakai UUID untuk baris yang terlihat web.

## Undangan dan pembuatan user

- [Penting] BSD §9.3, AFD §6: undangan diikat ke email, tetapi email tidak diverifikasi saat `/buat-akun`. Siapa pun yang memegang tautan bisa mendaftar dengan email yang tertera dan menjadi anggota Bersama. Pengikatan email hanya bermakna bila tautan dikirim ke kotak masuk itu. Cara kirim masih terbuka (AFD pertanyaan 5). Usulan: kirim tautan hanya lewat email ke alamat undangan, atau minta kode verifikasi email di `/buat-akun` dan isi `emailVerified` sebelum `accept_invitation`. Lihat Keputusan pemilik 2.
- [Penting] BSD §9.3, §15 butir 2: user Better Auth yang ter-commit tanpa `accept_invitation` berhasil memakan kuota 2 user. **[terbukti]** (rinciannya di `backend.md`). Dari sisi keamanan: perbaikan lewat trigger `auth."user"` yang mengonsumsi undangan dalam statement yang sama juga menutup jendela di mana user ada tanpa keanggotaan.
- [Minor] BSD §9.3 (`api.accept_invitation`): `p_user_id` bebas dari pemanggil; fungsi tidak memeriksa bahwa user itu baru dibuat dan belum punya profil. Unique index ruang Pribadi mencegah penyalahgunaan terbesar, tetapi aturannya implisit. Usulan: tolak bila profil sudah ada atau `createdAt` lebih dari 15 menit; atau hilangkan fungsi ini bila trigger di atas dipakai.
- [Minor] AFD §1 ("Tolak: token dicabut"), BSD §9.3: tidak ada fungsi untuk penerima menolak undangan; `api.revoke_invitation` hanya untuk pembuat. Usulan: `api.decline_invitation(p_token_hash)` lewat jalur GUC yang sama, atau ubah AFD menjadi "tidak terjadi apa-apa, tautan kedaluwarsa sendiri".
- [Minor] BSD §15 butir 1 (`api.invitation_peek` DEFINER): rekomendasi security: terima masuk daftar tertutup (tes katalog jadi tiga fungsi). Alternatif tabel di skema `auth` yang dibaca web memperluas hak web tanpa manfaat. Tambah rate limit rute `/terima-undangan`.

## Auth

- [Penting] TRD §3.4 (kode pemulihan): kode cadangan bawaan plugin two-factor Better Auth terikat ke TOTP, sehingga akun yang hanya memakai passkey (alur utama Farida) tidak otomatis punya kode pemulihan. Penyimpanan bawaannya dienkripsi dengan secret aplikasi, bukan di-hash seperti tertulis di TRD (perlu diverifikasi di versi Better Auth yang dipatok). Usulan: tabel kode pemulihan sendiri di skema `auth` (10 kode, hash argon2id, sekali pakai) yang berlaku untuk semua akun, atau wajibkan TOTP sebagai faktor cadangan. Lihat Keputusan pemilik 3.
- [Penting] TRD §3.4, BSD §5 (`amr`): nilai `amr` hanya `passkey`, `password+totp`, `password`. Masuk dengan kode pemulihan tidak punya nilai sendiri dan berisiko dianggap `password+totp` (sesi penuh). Usulan: `amr = 'recovery'` hanya membuka `/amankan` untuk daftar faktor baru; cabut sesi lain, catat audit, kirim email pemberitahuan. Definisikan juga keadaan `enrolling` (sesi `password` setelah `/buat-akun`) yang hanya boleh ke `/amankan`.
- [Penting] TRD §3.4 (lockout): usulan "20 gagal: kunci + email" di domain publik membuat penyerang bisa mengunci akun Novanda kapan saja hanya dengan email-nya. Usulan: lockout hanya untuk jalur password, berupa jeda bertahap tanpa kunci keras; passkey tetap bisa dipakai saat jalur password dijeda; buka kunci lewat email atau kode pemulihan. Lihat Keputusan pemilik 4.
- [Minor] TRD §3.4: opsi Better Auth yang menentukan aturan spec tidak ditulis. Reset password mencabut sesi hanya bila `revokeSessionsOnPasswordReset` diaktifkan (default mati); `minPasswordLength` default 8; `session.cookieCache` menunda pencabutan sesi sampai cache kedaluwarsa. Usulan: tulis nilai wajib: `revokeSessionsOnPasswordReset: true`, `minPasswordLength: 12`, `cookieCache` mati, `requireUser` membaca `amr` dari baris sesi DB; verifikasi nama opsi pada versi terpatok.
- [Minor] TRD §3.4 (rate limit per IP): ada dua hop proxy (edge lalu `gw`). Tanpa aturan header, IP yang dilihat web adalah IP `gw`, atau IP palsu dari `X-Forwarded-For` klien. Usulan: edge menimpa XFF, `gw` meneruskan nilai edge apa adanya, web memakai satu header tepercaya (`ipAddressHeaders` Better Auth) dan mengabaikan sisanya; tes Playwright keamanan.

## Audit log

- [Penting] TRD §3.4, Spec §9.5 ("akses DB manual tercatat di audit log"): tidak ada mekanisme. Sesi `psql` sebagai superuser atau `dompetku_owner` tidak menulis ke `audit.events` dan bisa menghapus isinya. Usulan: `log_connections`, `log_disconnections`, dan `pgaudit` (`pgaudit.log = 'all'` untuk role `postgres` dan `dompetku_owner` lewat `pgaudit.role`) dikirim ke log di luar VM DB; skrip `dompetku-psql` di host yang menulis `audit.log('db_manual_access')` dan memicu alert.
- [Minor] BSD §10 (`audit.log`): web bisa menulis event apa pun atas nama user mana pun. **[terbukti]** `audit.log('login_success', <id Farida>, '1.2.3.4')` dari `dompetku_web` tanpa konteks user berhasil. Daftar larangan kunci `meta` mudah dilewati: **[terbukti]** `{"nominal": 999999}` tersimpan. Usulan: daftar nama event tertutup (enum atau CHECK), `meta` dengan daftar kunci yang diizinkan dan batas ukuran (misalnya 1 kB); untuk event yang dipicu user, isi `user_id` dari `app.current_user_id()` bila tersedia.
- [Minor] BSD §7 (`tg_append_only`): trigger baris tidak menahan `TRUNCATE`, dan `dompetku_owner` bisa `DELETE` baris mana pun, bukan hanya lewat purge. Usulan: trigger `before truncate` per statement di `entry_history` dan `audit.events`; DELETE oleh owner hanya bila GUC lokal `dompetku.purge = 'on'` yang diisi fungsi job.

## Peran dan fungsi

- [Minor] BSD §10 (`jobs.purge_voided`): tabel sementara `doomed` dirujuk tanpa skema di fungsi DEFINER dengan `search_path=''`. `pg_temp` dicari implisit lebih dulu untuk relasi. Saat ini tidak bisa dieksploitasi (fungsi membuat tabelnya sendiri), tetapi polanya rapuh. Usulan: tulis `pg_temp.doomed`, dan tambah ke tes katalog: fungsi DEFINER tanpa relasi tak berskema.
- [Minor] BSD §3 (`dompetku_monitor in role pg_monitor`): `pg_read_all_stats` memperlihatkan teks query semua sesi. Aman selama semua query berparameter. Usulan: catat syarat ini di BSD dan pastikan lint `sql.raw` mencakup worker.

## Secrets dan backup

- [Penting] TRD §3.3: "kredensial tanpa izin hapus" + retention lock bertentangan dengan retensi WAL-G 30 hari + bulanan 12 bulan (`wal-g delete` butuh izin hapus). Retention rule juga menolak menimpa objek; bila `archive_command` mengulang unggah segmen WAL yang sama, arsip macet dan `pg_wal` penuh. Usulan: kedaluwarsa lewat lifecycle policy OCI per prefix (prefix harian 30 hari, prefix bulanan base backup penuh 12 bulan beserta WAL yang dibutuhkannya), retention rule terkunci sedikit di atas masa itu, `WALG_PREVENT_WAL_OVERWRITE=true`; uji di M0b: unggah ulang segmen, hapus dengan kredensial VM (harus gagal), restore dari backup bulanan.
- [Minor] TRD §3.3 (kunci enkripsi backup "di password manager pemilik"): WAL-G dan uji restore mingguan butuh kunci di VM. Usulan: tulis bahwa kunci ada di file secret VM, password manager menyimpan salinan escrow, dan latihan PITR bulanan memakai salinan escrow agar terbukti cocok.
- [Minor] TRD §3.4 (rotasi secret tahunan): `BETTER_AUTH_SECRET` mengenkripsi rahasia TOTP (dan kode cadangan bawaan). Rotasi tanpa enkripsi ulang mematikan 2FA kedua akun. Usulan: rotasi hanya saat insiden, dengan skrip enkripsi ulang yang diuji; secret lain (DB, GHCR, Healthchecks) tetap tahunan.
- [Minor] TRD §3.4 (CSP): hanya `strict-dynamic`, `frame-ancestors`, dan nonce yang disebut. Usulan: kebijakan lengkap `default-src 'self'; script-src 'nonce-…' 'strict-dynamic'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; connect-src 'self'; worker-src 'self'; img-src 'self' data:`; mode report-only satu minggu di M0b; style inline Next/font memakai nonce yang sama.

## Lintas kursi

- [Minor] TRD §2.3: isolasi transaksi tidak ditetapkan (rinciannya di `backend.md`, terbukti untuk saldo). Mekanisme yang sama membuat `tg_user_cap` menghitung dengan snapshot lama di REPEATABLE READ, jadi batas 2 user bisa tembus pada pendaftaran paralel (tidak dijalankan; mekanismenya sama dengan yang terbukti). Usulan: READ COMMITTED wajib, seperti di `backend.md`.

## Keputusan pemilik

1. Deskripsi saat mengambil uang dari Bersama ke Pribadi: tetap terlihat oleh pasangan di Bersama, atau hanya tersimpan di Pribadi (Bersama melihat "Diambil oleh Novanda" plus catatan bersama bila diisi)? Rekomendasi: hanya di Pribadi.
2. Cara mengirim undangan Farida: lewat email ke alamat undangan (sekaligus membuktikan kepemilikan email), atau salin tautan lalu Farida memasukkan kode verifikasi email saat membuat akun? Rekomendasi: email.
3. Pemulihan akun yang hanya memakai passkey: kode pemulihan untuk semua akun (dibuat sendiri, di-hash), atau TOTP wajib sebagai cadangan di samping passkey (menambah satu langkah onboarding Farida)? Rekomendasi: kode pemulihan untuk semua akun.
4. Durasi sesi dan lockout: usulan idle 7 hari, absolut 30 hari; gagal password berulang memberi jeda bertahap (1 menit, 15 menit, 1 jam) tanpa kunci permanen, passkey tetap bisa dipakai. Setuju?
