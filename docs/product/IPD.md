# IPD: rencana implementasi M0b sampai M8

Status: draf untuk review tim. Tanggal: 2026-10-31.
Sumber: Spec §5.7, §9.1 sampai §9.6 (milestone §9.4 mengikat), `docs/team/round1/{devops-sre,backend-engineer,qa}.md`, `docs/team/round2/register.md`, `docs/m0a-keputusan.md`.
Panjang sprint (1 sampai 2 minggu) adalah **perkiraan perencanaan**, belum diukur dari kecepatan nyata dan belum disetujui pemilik. Gerbang keluar milestone dikutip dari Spec §9.4; kriteria sprint adalah turunan kerja. Cara kerja: irisan vertikal (skema + fungsi + tes dulu, lalu UI, lalu dipakai), logika uang test-first (Spec §4.2), eksekusi per task dengan review (CLAUDE.md).

## 0. Posisi sekarang

M0a selesai di branch `claude/m0a-prototype`: prototipe data demo, e2e hijau, budget JS 160,9 kB dari 162 kB. Belum ada PR ke `main`. Menunggu penilaian N dan F (`docs/review/m0a-penilaian.md`), lalu ADR 0004 dan issue `m0a-feedback`.

## 1. Yang harus disediakan pemilik (prasyarat M0b)

| Kebutuhan                                                                                                                                                | Untuk                 | Status                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------- |
| Akun OCI Pay-As-You-Go dan akses ke VM App (`rtp-prod-app-01`) dan VM DB (`rtp-prod-db-01`)                                                              | Semua infra           | Akun ada (Spec §9.5); akses VM perlu disediakan            |
| SSH: kunci publik pemilik dan akses `sudo` untuk setup awal (sesi cloud tidak bisa SSH, Spec §3); runbook dijalankan pemilik atau sesi Claude Code di VM | Provisioning          | Belum ada                                                  |
| Domain: DNS `novandafadly.com` dapat diubah; subdomain akhir (usulan `dompet.novandafadly.com`)                                                          | TLS, proxy            | Subdomain Belum diputuskan final                           |
| Bucket OCI Object Storage + kunci Customer Secret khusus bucket, retention lock                                                                          | Backup WAL-G          | Belum ada                                                  |
| Kunci enkripsi backup disimpan di password manager pemilik                                                                                               | Backup                | Pemilik                                                    |
| Akun Healthchecks.io                                                                                                                                     | Dead-man uji restore  | Belum ada                                                  |
| Token GHCR read-only untuk VM; repo private GitHub dengan 2FA aktif (sudah, Spec §9.5)                                                                   | Deploy pull-based     | Belum ada token                                            |
| Penyedia email transaksional (Resend atau lain)                                                                                                          | Reset password, alert | Belum diputuskan (Spec §8)                                 |
| Konfirmasi: Shareable Link untuk Farida (ADR 0003)                                                                                                       | Penilaian M0a         | Menunggu                                                   |
| Cek kapasitas VM App (1 vCPU, 5,8 GiB, swap terpakai, disk 78% per 2026-09-10) dan arsitektur CPU (`uname -m`)                                           | Penempatan beban      | Belum dicek; per Spec §7a web + worker dijalankan di VM DB |

## 2. Ringkasan sprint

| Sprint | Milestone | Fokus                                                                    | Perkiraan                        |
| ------ | --------- | ------------------------------------------------------------------------ | -------------------------------- |
| S1     | M0b       | Provisioning VM, jaringan, `gw`, DNS/TLS                                 | 2 minggu                         |
| S2     | M0b       | Postgres terisolasi, role, migrasi dasar, backup, uji restore            | 2 minggu                         |
| S3     | M0b       | Better Auth: passkey, TOTP, pemulihan, undangan, batas 2 user, audit log | 2 minggu                         |
| S4     | M0b       | Deployer pull-based, ruang + RLS pgTAP, PWA installable                  | 1 sampai 2 minggu                |
| S5     | M1        | Skema ledger, dompet, saldo, idempotensi (DB + pgTAP)                    | 2 minggu                         |
| S6     | M1        | Catat, kategori + saran, parser nominal, transaksi edit/void/undo (UI)   | 2 minggu                         |
| S7     | M1        | Transfer + `space_transfer`, talangan, `dq_reconcile`, pakai 7 hari      | 1 sampai 2 minggu + 7 hari pakai |
| S8     | M2        | Bersama penuh: setoran, feed, kontribusi; Farida bergabung               | 2 minggu                         |
| S9     | M2        | Anggaran, laporan, Beranda "aman dipakai" nyata                          | 2 minggu                         |
| S10    | M2        | Tagihan rutin dasar, worker, CSV, review bulanan                         | 2 minggu + 7 hari pakai          |
| S11    | M3        | Utang/piutang                                                            | 2 minggu                         |
| S12    | M3        | Modal trading, bagi tagihan Bersama                                      | 2 minggu                         |
| S13    | M4        | Tujuan tabungan                                                          | 1 minggu                         |
| S14    | M4        | Aset, saham, net worth                                                   | 2 minggu                         |
| S15    | M5        | Trip, tagihan rutin lanjutan                                             | 1 sampai 2 minggu                |
| S16    | M5        | Kalender arus kas, deteksi langganan, PDF                                | 2 minggu                         |
| S17    | M6        | Catat teks bebas (aturan + LLM), eval set                                | 2 minggu                         |
| S18    | M6        | Analisis AI, PWA offline-baca, foto struk                                | 2 minggu                         |
| S19    | M7        | Stabilisasi, arsip v1, screenshot portofolio, matikan v1                 | 1 sampai 2 minggu                |
| -      | M8        | Kosong, backlog                                                          | -                                |

## 3. M0b: infra, auth, ruang

Gerbang keluar (Spec §9.4): restore teruji; login 2 akun dengan 2FA; isolasi ruang lulus pgTAP. Risiko utama milestone: bergantung pada akses yang hanya pemilik punya; mitigasi: runbook langkah demi langkah, sesi Claude Code di VM bila pemilik mau.

### S1: provisioning dan jaringan

- **Cakupan.** Cek kapasitas dan `uname -m`; Docker/Compose; compose project `dompetku` terpisah dari app lain (insiden `:5435`); `gw` (Caddy) mTLS di `10.0.1.68:8443` (app) dan `:9443` (metrik), hanya dari IP privat VM App; reverse proxy VM App (pakai yang ada bila ada, bila tidak Caddy); DNS + TLS; OCI security list (443 publik, tanpa port Postgres). `unattended-upgrades`.
- **Dependensi.** Semua prasyarat §1 (akses VM, SSH, domain).
- **Kriteria keluar.** HTTPS ke domain menjawab dari `gw`; Postgres tanpa port host; header forward hanya dipercaya dari `gw`, `x-middleware-subrequest` dibuang; app lain di VM tidak terganggu.
- **Risiko / mitigasi.** VM App sempit atau CPU ARM: image multi-arch, limit CPU/RAM per container. Port Docker menembus firewall: tidak ada port host untuk Postgres. Salah konfigurasi mengganggu app lain: project compose terpisah, rencana rollback tertulis.

### S2: Postgres, role, backup, restore

- **Cakupan.** Postgres 17 + WAL-G di container sendiri, `scram-sha-256`, TLS, `pg_hba` terbatas; 5 role (`dompetku_owner`, `dompetku_api`, `dompetku_web`, `dompetku_worker`, `dompetku_auditor`); dbmate + migrasi dasar; base backup harian + WAL kontinu ke OCI Object Storage terenkripsi sisi klien, `archive_timeout=300`, retensi 30 hari + bulanan 12 bulan; timer systemd uji restore mingguan + Healthchecks.io; runbook restore.
- **Dependensi.** S1; bucket, kunci, akun Healthchecks.io.
- **Kriteria keluar.** Restore ke container sementara berhasil dan pgTAP rekonsiliasi hijau; alert terkirim saat backup sengaja digagalkan; RPO ≤ 5 menit dan RTO ≤ 1 jam terukur pada latihan.
- **Risiko / mitigasi.** Backup ada tapi tidak bisa dipulihkan: uji restore otomatis mingguan + latihan PITR bulanan. Kunci backup hilang: disimpan pemilik di password manager, langkah verifikasi di runbook. Kredensial backup menghapus data: kredensial tanpa izin hapus, retention lock.

### S3: auth

- **Cakupan.** Better Auth di skema `auth` (di luar RLS, hanya role web); password; passkey; TOTP; kode pemulihan wajib saat daftar; sesi `pending_2fa` ditolak di `requireUser`/`withUser`, `amr` di sesi; undangan hash + sekali pakai + 72 jam + terikat email; batas keras 2 user di DB; allowlist `AUTH_ALLOWED_EMAILS`; respons login/reset seragam; rate limit + lockout bertahap; reset password mencabut semua sesi dan tidak mematikan 2FA; audit log append-only; origin check `/api/*`, CSP nonce, `no-store`. Menggantikan layar tiruan M0a (`/masuk`, `/undang`, `/terima-undangan`, `/buat-akun`, `/amankan`) sesuai AFD.
- **Dependensi.** S2; penyedia email (Belum diputuskan) untuk reset password.
- **Kriteria keluar.** Dua akun login dengan faktor kuat; user ketiga ditolak; undangan dipakai ulang atau kedaluwarsa ditolak; tes keamanan Playwright dan pgTAP hijau.
- **Risiko / mitigasi.** Terkunci dari akun sendiri: kode pemulihan wajib dan diuji. Kebijakan kata sandi berbeda dari prototipe (minimal 12): ditetapkan di BSD. Library baru berubah cepat: versi dipatok dan dicatat di ADR.

### S4: deployer, ruang, PWA

- **Cakupan.** Build + tes + SBOM + attestation di GitHub-hosted runner, push ke GHCR; timer systemd menarik digest `main`, verifikasi attestation, tolak digest lebih tua, `/opt/dompetku/bin/deploy` (kunci migrasi, preflight, migrasi, health `/api/health`, rollback otomatis); tabel `households`, `spaces`, `space_members`, `app.my_space_ids()`, RLS FORCE; `withUser(userId, spaceId?)`; rute `/pribadi/…` dan `/bersama/…` dengan `spaceId` eksplisit; manifest PWA installable; CI penuh (gitleaks, Semgrep, osv-scanner, Trivy, actionlint, zizmor, pgTAP).
- **Dependensi.** S2, S3; token GHCR read-only.
- **Kriteria keluar.** Isolasi ruang lulus pgTAP (dua user x semua tabel x semua operasi); deploy rollback teruji dengan rilis rusak sengaja; PWA installable; `GET /api/health` 200.
- **Risiko / mitigasi.** Migrasi tak kompatibel menghalangi rollback: expand/contract, uji N-1. Digest lama dipaksa: deployer menolak. RLS bocor lewat fungsi DEFINER: DEFINER hanya untuk penulisan dan dua fungsi baca yang tercatat.

## 4. M1: ledger inti

Gerbang keluar: N memakai 7 hari berturut-turut, selisih rekonsiliasi 0. Risiko milestone: kesalahan hitung uang (INT-01..04 di v1); mitigasi: DB + pgTAP lebih dulu, lock urut, tes konkurensi dua koneksi.

### S5: skema ledger dan dompet

- **Cakupan.** `accounts`, `entries`, `entry_lines`, `entry_history`, `idempotency_keys`, `account_balances`; `api.create_entry` dan lawan; dompet baru dengan `opened_on` + entri `opening_balance` (edit langsung 7 hari pertama); "Cocokkan saldo" → `adjustment`; saldo tidak cukup via `p_allow_negative`; `set constraints all immediate` di akhir fungsi; `app.today()`/`app.now()`.
- **Dependensi.** S4; BSD final (DDL lengkap; celah terbesar, wajib sebelum M1).
- **Kriteria keluar.** pgTAP memanggil fungsi (bukan insert mentah); `clientId` sama + isi beda → DK410; klik ganda = 1 entri; tes konkurensi lulus; Σ transfer = −fee.
- **Risiko / mitigasi.** Deadlock: urutan lock tetap, retry terbatas. Tipe `date`/`int8` salah baca: parser tipe di driver. Tes hijau palsu karena constraint deferrable: cek eksplisit.

### S6: Catat dan transaksi

- **Cakupan.** Menyambung UI prototipe ke DB; kategori + `api.suggest_categories` + kamus awal; parser nominal ("35rb/35k/1,5jt"); Catat ≤ 3 ketukan; edit, void, urungkan; "Menyimpan…" dan jalur galat nyata; pindah ruang di sheet.
- **Dependensi.** S5; hasil penilaian M0a (ADR 0004).
- **Kriteria keluar.** Catat ≤ 3 ketukan dari Beranda, Transaksi, Dompet di Pribadi dan Bersama; urungkan 6 detik mengembalikan saldo; keyboard-only lulus; budget JS rute ≤ 162 kB.
- **Risiko / mitigasi.** Budget JS hanya sisa sekitar 1 kB: ukur tiap PR, muat malas, keputusan pemilik bila perlu naik. Salah kategori tersimpan: kategori tidak pernah terpilih otomatis.

### S7: transfer, talangan, rekonsiliasi

- **Cakupan.** Transfer dalam ruang; `space_transfer` (dua entri bertaut `link_id`, trigger pasangan, void bersama); talangan kantor (bukan pengeluaran pribadi); `dq_reconcile` 01:00 WIB (10 cek, alert tanpa nominal); `product_events`; masa pakai 7 hari.
- **Dependensi.** S6.
- **Kriteria keluar.** Gerbang M1 terpenuhi.
- **Risiko / mitigasi.** Kebocoran Pribadi lewat kaki Bersama: kaki tujuan tanpa deskripsi, `shared_note` eksplisit. Novanda berhenti memakai: ukur % hari tercatat, perbaiki gesekan sebelum M2.

## 5. M2: Bersama penuh, anggaran, laporan

Gerbang keluar: Farida bergabung; kedua akun 7 hari berturut-turut.

### S8: Bersama

- **Cakupan.** Setoran ke Bersama, feed aktivitas (pelaku, sebelum/sesudah), kontribusi per orang; undang Farida dan onboarding Farida nyata.
- **Dependensi.** S7.
- **Kriteria keluar.** Feed tidak pernah memuat nama dompet atau entri Pribadi (Playwright dua user).
- **Risiko / mitigasi.** Farida menolak alur: pantau penilaian M0a; sesuaikan.

### S9: anggaran, laporan, Beranda

- **Cakupan.** Anggaran per ruang; `app.report_lines` + `app.report_class()` (15 kelas) satu sumber; Ringkasan; "aman dipakai" nyata (default akhir bulan; tanggal gajian opsional Belum diputuskan); aturan satu kewajiban = tagihan atau anggaran wajib, tidak keduanya (`docs/m0a-keputusan.md`).
- **Dependensi.** S8.
- **Kriteria keluar.** Angka Beranda cocok dengan laporan; budget JS ≤ 162 kB (target 150 dibatalkan); CLS < 0,05 (target dari frontend.md R11, Belum dikonfirmasi pemilik).
- **Risiko / mitigasi.** Dobel hitung kewajiban: aturan tunggal dan tes. Grafik menambah JS: Recharts hanya di rute Laporan, dimuat malas.

### S10: tagihan rutin, worker, CSV, review bulanan

- **Cakupan.** `apps/worker` + pg-boss (`recurring_materialize` 00:05 WIB, `purge_voided`, `job_runs`); tagihan rutin dasar; export CSV (escape formula); review bulanan dan salin anggaran 1 ketukan; tombol "Tidak ada pengeluaran hari ini".
- **Dependensi.** S9.
- **Kriteria keluar.** Job idempoten (jalan 2x = 1 entri); CSV cocok dengan laporan; gerbang M2.
- **Risiko / mitigasi.** Job gagal diam: alert dan `job_runs`. Beban di VM sempit: limit memori container worker.

## 6. M3 sampai M8

Rincian dan tes (T6 sampai T15) ada di `docs/team/round1/qa.md`. Sprint M3 sampai M7 dipecah ulang sebelum dimulai, memakai kecepatan nyata M1/M2 (perkiraan di §2 hanya placeholder).

| Sprint | Cakupan                                                                                                                         | Dependensi                | Gerbang / kriteria keluar                                                     | Risiko dan mitigasi                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| S11    | Utang/piutang, cicilan, utang berjalan tanpa efek kas                                                                           | M2                        | T6 sampai T10 (bersama S12)                                                   | Sisa salah: sisa = pokok − Σ pembayaran sebagai view; bayar > sisa ditolak atomik; batal cicilan membalik efek            |
| S12    | Modal trading (hanya Pribadi); bagi tagihan Bersama (saldo antar-anggota + pelunasan)                                           | S11                       | T6 sampai T10 lulus (gerbang M3)                                              | Salah kaprah siapa berutang ke siapa: dihitung dari data, tanpa logika pelunasan tersembunyi                              |
| S13    | Tujuan tabungan, 1 dompet = 1 tujuan aktif                                                                                      | M3                        | bagian T11                                                                    | Dua tujuan satu dompet: constraint DB                                                                                     |
| S14    | Aset, saham (harga di server), net worth per ruang, snapshot 00:10 WIB                                                          | S13                       | T11 lulus (gerbang M4)                                                        | Harga gagal atau lonjakan: nilai terakhir + label; validator harga; tanpa proxy CORS publik                               |
| S15    | Trip, tagihan rutin lanjutan                                                                                                    | M4                        | bagian T14, T15                                                               | Tanggal 31: aturan akhir bulan diuji                                                                                      |
| S16    | Kalender arus kas, deteksi langganan, ekspor PDF                                                                                | S15                       | T14, T15 lulus (gerbang M5)                                                   | PDF beda angka dari laporan: satu view sumber; escape PDF                                                                 |
| S17    | Catat teks bebas (aturan + LLM di balik `LlmProvider`), eval set                                                                | M5; model dipilih pemilik | Eval set lulus target (target Belum diputuskan)                               | Simpan tanpa konfirmasi: dilarang; kuota habis: parser aturan tetap jalan; data bocor ke LLM: hanya teks itu yang dikirim |
| S18    | Analisis AI (kuota 15 parsing + 5 analisis per hari per user), PWA offline-baca, foto struk terenkripsi tanpa OCR               | S17                       | Gerbang M6 (eval set) + offline, cache kosong setelah logout, PWA installable | Data Pribadi pasangan ikut dikirim: analisis memakai view RLS pengguna; cache bocor antar akun: dibersihkan saat logout   |
| S19    | Arsip ekspor v1, screenshot otomatis 390/1280 terang/gelap dari data demo, matikan v1, pembongkaran pratinjau Vercel (ADR 0003) | M6                        | Pemilik menyetujui (gerbang M7)                                               | v1 dimatikan sebelum arsip aman: arsip diverifikasi dulu; v1 tetap read-only sampai itu                                   |
| M8     | Kosong. Otomatisasi catat (email bank, WhatsApp Cloud API, Telegram) ditunda ke backlog                                         | -                         | -                                                                             | -                                                                                                                         |

## 7. Risiko lintas milestone

| Risiko                                     | Mitigasi                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| Pemilik jadi satu-satunya penghubung ke VM | Runbook, sesi Claude Code di VM, deployer pull-based tanpa SSH harian          |
| Kehilangan data                            | Backup + uji restore berkala, soft delete 90 hari, `entry_history` append-only |
| Kebocoran data Pribadi                     | RLS FORCE, pgTAP dua user, `spaceId` eksplisit, log tanpa nominal/deskripsi    |
| Rantai pasok                               | Actions dipatok SHA, `minimumReleaseAge`, patch critical ≤ 48 jam              |
| Budget JS habis                            | Ukur tiap PR; keputusan pemilik bila batas dinaikkan                           |
| Pemakaian berhenti                         | Metrik % hari tercatat; gerbang 7 hari berturut-turut                          |

## Pertanyaan terbuka

1. Panjang sprint aktual dan kapasitas kerja pemilik per minggu: Belum diputuskan.
2. Subdomain akhir dan penyedia email: Belum diputuskan.
3. Akses VM dan SSH: menunggu pemilik; tanpa itu M0b tidak mulai.
4. Model LLM dan target eval set M6: Belum diputuskan.
5. Apakah gerbang M1 "7 hari" dihitung sebelum atau sesudah S7 selesai.
6. Konflik: Spec §7a (self-hosted runner) sudah digantikan §9.2 dan §9.5 (pull-based, disetujui). Spec §6 (M8 Telegram) digantikan §9.6.
