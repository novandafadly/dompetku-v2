# IPD: rencana implementasi M0b sampai M8

Status: draf revisi setelah review tim dan 18 keputusan pemilik (`review/keputusan-pemilik.md`, semua rekomendasi disetujui 2026-10-31). Tanggal: 2026-10-31.
Sumber: Spec §5.7, §9.1 sampai §9.6 (milestone §9.4 mengikat), `docs/team/round1/{devops-sre,backend-engineer,qa}.md`, `docs/team/round2/register.md`, `docs/m0a-keputusan.md`.
Panjang sprint (1 sampai 2 minggu) adalah **perkiraan perencanaan**, belum diukur dari kecepatan nyata dan belum disetujui pemilik. Gerbang keluar milestone dikutip dari Spec §9.4; kriteria sprint adalah turunan kerja. Cara kerja: irisan vertikal (skema + fungsi + tes dulu, lalu UI, lalu dipakai), logika uang test-first (Spec §4.2), eksekusi per task dengan review (CLAUDE.md). Nama fungsi mengikuti `BSD.md`.

## 0. Posisi sekarang dan urutan M0a terhadap M0b

M0a selesai di branch `claude/m0a-prototype`: prototipe data demo, e2e hijau, budget JS 160,9 kB dari 162 kB. Belum ada PR ke `main`. Menunggu penilaian N dan F (`docs/review/m0a-penilaian.md`), lalu ADR 0004 dan issue `m0a-feedback`.

**Keputusan pemilik: infra M0b (S1 sampai S3) berjalan paralel dengan penilaian M0a; layar auth sungguhan (S4) menunggu ADR 0004.** Alasan: S1 sampai S3 tidak menyentuh layar; layar auth mengikuti AFD dan bisa berubah karena umpan balik N dan F. Penilaian M0a lulus bila tidak ada butir "tidak bisa dipakai" (PRD §6.1).

**Gerbang urutan:**

1. **Sebelum S2:** BSD disetujui (review backend dan security selesai) dan `bsd-check` dijalankan di PostgreSQL 17 (BSD sebelumnya divalidasi di 16.15; S2 memasang 17). **Terpenuhi 2026-10-31:** BSD disetujui pemilik, `bsd-check` lulus di 17.11.
   **S2 dijalankan 2026-10-31:** Postgres 17 + WAL-G + pgaudit live, restore teruji (RTO 11 s, RPO 117 s); alert email terkonfirmasi, lifecycle rule terpasang, retention dikunci. **S2 selesai.** (`docs/ops/runbook-s2.md`).
   **S3 dijalankan 2026-10-31/11-01:** deployer pull-based dengan verifikasi cosign berkunci di VM DB, timer 5 menit, `gw` meneruskan ke web; `/api/health` 200 lewat domain, smoke header lulus, PWA installable, rollback teruji dengan rilis rusak sengaja (`rolled_back` lalu revert `ok`). **S3 selesai.** (`docs/ops/runbook-s3.md`).
2. **Sebelum S4:** ADR 0004 terbit (hasil penilaian M0a) dan bingkai desain auth ada (lihat §8).
3. **Sebelum S6:** bingkai desain Catat (galat, "Menyimpan…", Sampah) ada (§8).

## 1. Yang harus disediakan pemilik (prasyarat M0b)

| Kebutuhan                                                                                                                                                | Untuk                                                  | Status                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| Akun OCI Pay-As-You-Go dan akses ke VM App (`rtp-prod-app-01`) dan VM DB (`rtp-prod-db-01`)                                                              | Semua infra                                            | Akun dan akses VM ada (2026-10-31)                                  |
| SSH: kunci publik pemilik dan akses `sudo` untuk setup awal (sesi cloud tidak bisa SSH, Spec §3); runbook dijalankan pemilik atau sesi Claude Code di VM | Provisioning                                           | Belum ada                                                           |
| Domain: DNS `novandafadly.com` dapat diubah; subdomain akhir (usulan `dompet.novandafadly.com`)                                                          | TLS, proxy, rpID passkey, DNS email Resend (SPF, DKIM) | Disetujui 2026-10-31: `dompet.novandafadly.com`; DNS diubah pemilik |
| Bucket OCI Object Storage + kunci Customer Secret khusus bucket, retention lock                                                                          | Backup WAL-G                                           | Ada 2026-10-31, retention belum dikunci (`docs/ops/backup-oci.md`)  |
| Kunci enkripsi backup disimpan di password manager pemilik                                                                                               | Backup                                                 | Pemilik                                                             |
| Akun Healthchecks.io                                                                                                                                     | Dead-man uji restore                                   | Akun ada (2026-10-31); check dibuat di S2                           |
| Token GHCR read-only untuk VM; repo private GitHub dengan 2FA aktif (sudah, Spec §9.5)                                                                   | Deploy pull-based                                      | Belum ada token                                                     |
| Akun Resend (penyedia email transaksional, diputuskan 2026-10-31) dan verifikasi domain pengirim                                                         | Undangan, lupa kata sandi, alert                       | Akun ada (2026-10-31); verifikasi domain dicek di S4                |
| Email pemilik untuk `AUTH_ALLOWED_EMAILS` (akun Novanda)                                                                                                 | Akun pertama                                           | Pemilik                                                             |
| Konfirmasi: Shareable Link untuk Farida (ADR 0003)                                                                                                       | Penilaian M0a                                          | Disetujui 2026-10-31                                                |
| Cek kapasitas VM App (1 vCPU, 5,8 GiB, swap terpakai, disk 78% per 2026-09-10) dan arsitektur CPU (`uname -m`)                                           | Penempatan beban                                       | Dicek 2026-10-31 (lihat catatan di bawah tabel)                     |

**Hasil cek VM (2026-10-31):**

- VM App: `aarch64`, 1 vCPU, RAM 5,8 GiB (swap 1,9 dari 4 GiB terpakai), disk 77 GB terpakai 86% (sisa 12 GB). Terlalu sempit untuk web + worker; dipakai hanya untuk reverse proxy.
- VM DB: `aarch64`, 3 vCPU, RAM 17 GiB (tersedia 11 GiB), tanpa swap, disk 96 GB terpakai 55% (sisa 44 GB). Postgres, `gw`, web, dan worker dompetku dijalankan di sini (sesuai Spec §7a).
- Image dibangun untuk `linux/arm64` saja.
- Rahasia (token Healthchecks, Resend, GHCR) diisi pemilik langsung di file env VM (`chmod 600`), tidak lewat chat atau repo.

## 2. Ringkasan sprint

Urutan baru (keputusan pemilik): deployer dan HTTPS tetap lebih dulu (passkey butuh origin tetap); tabel ruang dan undangan dibangun bersama auth; worker minimal sebelum S7; `product_events` dan "Tidak ada pengeluaran hari ini" di S6; tagihan dasar di S9.

| Sprint | Milestone | Fokus                                                                                                            | Perkiraan                        | Menunggu pemilik               |
| ------ | --------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------ |
| S1     | M0b       | Provisioning VM, jaringan, `gw`, DNS/TLS                                                                         | 2 minggu                         | Akses VM, SSH, domain          |
| S2     | M0b       | Postgres terisolasi, role, migrasi dasar, backup, uji restore (gerbang BSD disetujui, `bsd-check` PG 17)         | 2 minggu                         | Bucket, kunci, Healthchecks    |
| S3     | M0b       | Deployer pull-based, CI penuh, PWA installable                                                                   | 1 sampai 2 minggu                | Token GHCR                     |
| S4     | M0b       | Tabel ruang + undangan + RLS ruang, Better Auth (faktor kuat, pemulihan, undangan email, sesi), audit log        | 2 minggu                         | ADR 0004, akun Resend          |
| S5     | M1        | Skema ledger, dompet, saldo, idempotensi, fungsi baca Sampah (DB + pgTAP); worker minimal (pg-boss, `job_runs`)  | 2 minggu                         | -                              |
| S6     | M1        | Catat, kategori + saran, parser nominal, edit/void/undo, Sampah, `product_events` + "Tidak ada pengeluaran" (UI) | 2 minggu                         | Bingkai desain                 |
| S7     | M1        | Transfer + `space_transfer`, talangan, `dq_reconcile` di worker, lalu 7 hari pakai                               | 1 sampai 2 minggu + 7 hari pakai | Pemakaian harian               |
| S8     | M2        | Bersama penuh: setoran, feed, kontribusi; Farida bergabung                                                       | 2 minggu                         | Farida                         |
| S9     | M2        | Anggaran, laporan, tagihan rutin dasar, Beranda "aman dipakai" nyata                                             | 2 minggu                         | -                              |
| S10    | M2        | Worker lanjutan (tagihan), CSV, review bulanan, lalu 7 hari pakai                                                | 2 minggu + 7 hari pakai          | Pemakaian harian               |
| S11    | M3        | Utang/piutang                                                                                                    | 2 minggu                         | -                              |
| S12    | M3        | Modal trading, bagi tagihan Bersama                                                                              | 2 minggu                         | -                              |
| S13    | M4        | Tujuan tabungan                                                                                                  | 1 minggu                         | -                              |
| S14    | M4        | Aset, saham, net worth                                                                                           | 2 minggu                         | -                              |
| S15    | M5        | Trip, tagihan rutin lanjutan                                                                                     | 1 sampai 2 minggu                | -                              |
| S16    | M5        | Kalender arus kas, deteksi langganan, PDF                                                                        | 2 minggu                         | -                              |
| S17    | M6        | Catat teks bebas (aturan + LLM), eval set                                                                        | 2 minggu                         | Model dipilih                  |
| S18    | M6        | Analisis AI, PWA offline-baca, foto struk                                                                        | 2 minggu                         | Keputusan penyimpanan lampiran |
| S19    | M7        | Stabilisasi, arsip v1, screenshot portofolio, matikan v1                                                         | 1 sampai 2 minggu                | Persetujuan akhir              |
| -      | M8        | Kosong, backlog                                                                                                  | -                                | -                              |

Total perkiraan: sekitar 33 sampai 37 minggu kerja ditambah 2 minggu masa pakai (M1 dan M2), jadi 35 sampai 39 minggu, belum termasuk waktu tunggu pemilik. Ini perkiraan, bukan janji.

## 3. M0b: infra, auth, ruang

Gerbang keluar (Spec §9.4): restore teruji; login 2 akun dengan 2FA; isolasi ruang lulus pgTAP. Risiko utama milestone: bergantung pada akses yang hanya pemilik punya; mitigasi: runbook langkah demi langkah, sesi Claude Code di VM bila pemilik mau.

### S1: provisioning dan jaringan

- **Cakupan.** Cek kapasitas dan `uname -m`; Docker/Compose; compose project `dompetku` terpisah dari app lain (insiden `:5435`); `gw` (Caddy) mTLS di `10.0.1.68:8443` (app) dan `:9443` (metrik), hanya dari IP privat VM App; reverse proxy VM App (pakai yang ada bila ada, bila tidak Caddy); DNS + TLS; OCI security list (443 publik, tanpa port Postgres). `unattended-upgrades`.
- **Dependensi.** Semua prasyarat §1 (akses VM, SSH, domain). Boleh jalan paralel dengan penilaian M0a.
- **Kriteria keluar.** HTTPS ke domain menjawab dari `gw`; Postgres tanpa port host; header forward hanya dipercaya dari `gw`, `x-middleware-subrequest` dibuang; app lain di VM tidak terganggu.
- **Risiko / mitigasi.** VM App sempit atau CPU ARM: image multi-arch, limit CPU/RAM per container. Port Docker menembus firewall: tidak ada port host untuk Postgres. Salah konfigurasi mengganggu app lain: project compose terpisah, rencana rollback tertulis.

### S2: Postgres, role, backup, restore

- **Cakupan.** Gerbang awal: BSD disetujui dan `bsd-check` hijau di PostgreSQL 17. Postgres 17 + WAL-G di container sendiri, `scram-sha-256`, TLS, `pg_hba` terbatas; 5 role (`dompetku_owner`, `dompetku_api`, `dompetku_web`, `dompetku_worker`, `dompetku_auditor`) dan skema sesuai BSD; dbmate + migrasi dasar (skema, role, `app.now()`/`app.today()`); base backup harian + WAL kontinu ke OCI Object Storage terenkripsi sisi klien, `archive_timeout=300`, retensi 30 hari + bulanan 12 bulan; timer systemd uji restore mingguan + Healthchecks.io; runbook restore.
- **Dependensi.** S1; bucket, kunci, akun Healthchecks.io; BSD disetujui.
- **Kriteria keluar.** Restore ke container sementara berhasil dan pgTAP rekonsiliasi hijau; alert terkirim saat backup sengaja digagalkan; RPO ≤ 5 menit dan RTO ≤ 1 jam terukur pada latihan.
- **Risiko / mitigasi.** Backup ada tapi tidak bisa dipulihkan: uji restore otomatis mingguan + latihan PITR bulanan. Kunci backup hilang: disimpan pemilik di password manager, langkah verifikasi di runbook. Kredensial backup menghapus data: kredensial tanpa izin hapus, retention lock. Perbedaan versi PG (BSD divalidasi 16.15): `bsd-check` di 17 sebagai tugas pertama.

### S3: deployer, CI, PWA

- **Cakupan.** Build + tes + SBOM + attestation di GitHub-hosted runner, push ke GHCR; timer systemd menarik digest `main`, verifikasi attestation, tolak digest lebih tua, `/opt/dompetku/bin/deploy` (kunci migrasi, preflight, migrasi, health `/api/health`, rollback otomatis); manifest PWA installable; CI penuh (gitleaks, Semgrep, osv-scanner, Trivy, actionlint, zizmor, pgTAP). Deploy lebih dulu dari auth karena passkey (WebAuthn) butuh origin HTTPS tetap (rpID = domain).
- **Dependensi.** S1, S2; token GHCR read-only.
- **Kriteria keluar.** Deploy rollback teruji dengan rilis rusak sengaja; PWA installable; `GET /api/health` 200 lewat domain publik; smoke pasca-deploy (K12) hijau.
- **Risiko / mitigasi.** Migrasi tak kompatibel menghalangi rollback: expand/contract, uji N-1 (BR6). Digest lama dipaksa: deployer menolak.

### S4: ruang, undangan, auth

Gerbang awal: ADR 0004 terbit dan bingkai desain auth ada (§8).

- **Cakupan.** Tabel `households`, `spaces`, `space_members`, `invitations`, `product_events`, `app.my_space_ids()`, `private.provision_user`, RLS FORCE, `withUser(userId, spaceId?)`, rute `/pribadi/…` dan `/bersama/…` dengan `spaceId` eksplisit (sprint yang sama dengan auth karena penerimaan undangan memanggil `provision_user` dan batas 2 user menghitung anggota). Better Auth di skema `auth` (di luar RLS, hanya role web): kata sandi; passkey; TOTP; **aturan faktor kuat wajib (passkey ATAU kata sandi + TOTP)**; kode pemulihan untuk semua akun, termasuk yang hanya passkey; sesi `pending_2fa` ditolak di `requireUser`/`withUser`, `amr` di sesi; sesi idle 7 hari dan absolut 30 hari; gagal login = jeda bertahap tanpa kunci permanen; akun Novanda dari allowlist `AUTH_ALLOWED_EMAILS`; lupa kata sandi lewat email (Resend), reset mencabut semua sesi dan tidak mematikan 2FA; undangan lewat email (`api.create_invitation`, `api.invitation_peek`, `api.accept_invitation`, `api.revoke_invitation`, fungsi tolak undangan di BSD), hash + sekali pakai + 72 jam + terikat email; undangan terpakai setelah akun diamankan; layar Undangan tertunda (cabut, kirim ulang); akun setengah jadi dihapus setelah 72 jam dan tidak dihitung kuota; batas keras 2 user di DB; respons login/reset seragam; daftar perangkat dan cabut sesi; audit log append-only; origin check `/api/*`, CSP nonce, `no-store`. Menggantikan layar tiruan M0a (`/masuk`, `/undang`, `/terima-undangan`, `/buat-akun`, `/amankan`) sesuai AFD.
- **Dependensi.** S2, S3; akun Resend; ADR 0004.
- **Kriteria keluar.** Dua akun login dengan faktor kuat; user ketiga ditolak; undangan dipakai ulang, dicabut, ditolak, atau kedaluwarsa ditolak; "lanjutkan mengamankan" bekerja; isolasi ruang lulus pgTAP **untuk tabel yang ada pada sprint ini** (ruang, undangan, `product_events`, audit; dua user × tabel × operasi); tes keamanan Playwright dan pgTAP hijau. Isolasi penuh semua tabel menjadi kriteria S5 dan tiap sprint yang menambah tabel.
- **Risiko / mitigasi.** Terkunci dari akun sendiri: kode pemulihan wajib dan diuji. Kebijakan kata sandi berbeda dari prototipe (minimal 12): ditetapkan di BSD. Library baru berubah cepat: versi dipatok dan dicatat di ADR. Layar auth berubah karena penilaian: itu sebabnya S4 menunggu ADR 0004.

## 4. M1: ledger inti

Gerbang keluar: N memakai 7 hari berturut-turut (PRD §6.1: hari WIB beruntun, tiap hari minimal satu catatan atau "Tidak ada pengeluaran hari ini"), selisih rekonsiliasi 0. Risiko milestone: kesalahan hitung uang (INT-01..04 di v1); mitigasi: DB + pgTAP lebih dulu, lock urut, tes konkurensi dua koneksi.

### S5: skema ledger, dompet, worker minimal

- **Cakupan.** `accounts`, `entries`, `entry_lines`, `entry_history`, `idempotency_keys`, `account_balances`; `api.create_account`, `api.create_entry`, `api.update_entry`, `api.void_entry`, `api.restore_entry`, `api.reconcile_balance`, `api.archive_account` (hanya saldo 0), `api.trash_list` dan `api.purge_entry`; dompet baru dengan `opened_on` + entri `opening_balance` (edit langsung 7 hari pertama); "Cocokkan saldo" → `adjustment`; saldo tidak cukup via `p_allow_negative`; `set constraints all immediate` di akhir fungsi; `app.today()`/`app.now()`. **Worker minimal:** `apps/worker`, pg-boss, `job_runs`, alert, supaya `dq_reconcile` (01:00 WIB), `purge_voided`, `purge_idempotency`, `purge_audit` punya pelaksana sebelum S7.
- **Dependensi.** S4; BSD final.
- **Kriteria keluar.** pgTAP memanggil fungsi (bukan insert mentah); `clientId` sama + isi beda → DK410; klik ganda = 1 entri; tes konkurensi lulus; Σ transfer = −fee; **isolasi ruang penuh pada semua tabel baru**; worker menjalankan job uji dan alert terkirim saat gagal.
- **Risiko / mitigasi.** Deadlock: urutan lock tetap, retry terbatas. Tipe `date`/`int8` salah baca: parser tipe di driver. Tes hijau palsu karena constraint deferrable: cek eksplisit. Beban worker di VM sempit: limit memori.

### S6: Catat, transaksi, Sampah, event produk

Gerbang awal: bingkai desain Catat (galat, "Menyimpan…", peringatan saldo, transfer lintas ruang) dan Sampah ada (§8).

- **Cakupan.** Menyambung UI prototipe ke DB; kategori + `api.suggest_categories` + kamus awal; parser nominal ("35rb/35k/1,5jt"); Catat jalur tercepat ≤ 3 ketukan; edit (konflik versi DK409), void, urungkan; **layar Sampah** (daftar dan pulihkan); "Menyimpan…" dan jalur galat nyata; pindah ruang di sheet; **`product_events`** dengan event `catat_dibuka` dan `catat_disimpan` (`catat_id`, `ketukan`, tanpa nominal) dan **tombol "Tidak ada pengeluaran hari ini"** (`api.mark_no_spend_day`), diukur sejak pemakaian pertama.
- **Dependensi.** S5; ADR 0004.
- **Kriteria keluar.** Catat jalur tercepat ≤ 3 ketukan dari Beranda, Transaksi, Dompet di Pribadi dan Bersama; urungkan 6 detik mengembalikan saldo; Sampah memulihkan dalam 90 hari; event tercatat tanpa nominal; keyboard-only lulus; budget JS rute ≤ 162 kB.
- **Risiko / mitigasi.** Budget JS hanya sisa sekitar 1 kB: ukur tiap PR, muat malas, keputusan pemilik bila perlu naik. Salah kategori tersimpan: kategori tidak pernah terpilih otomatis.

### S7: transfer, talangan, rekonsiliasi

- **Cakupan.** Transfer dalam ruang; `space_transfer` lewat `api.create_transfer` (dua entri bertaut `link_id`, trigger pasangan, void bersama; keterangan Bersama ke Pribadi disimpan di sisi Pribadi); talangan kantor (bukan pengeluaran pribadi; biaya dari Kas Kantor masuk angka Kantor); `dq_reconcile` 01:00 WIB (10 cek, alert tanpa nominal) dijadwalkan di worker S5; Bersama solo dan kosong.
- **Dependensi.** S6.
- **Kriteria keluar (teruji).** Tes konkurensi; ID tes M1 (PRD §6.2) hijau; `dq_reconcile` hijau; hari pertama pakai dimulai. Gerbang M1 sendiri (7 hari WIB beruntun, selisih 0) adalah langkah masa pakai setelah sprint, bukan kriteria keluar sprint.
- **Risiko / mitigasi.** Kebocoran Pribadi lewat kaki Bersama: kaki tujuan tanpa deskripsi, `shared_note` eksplisit. Novanda berhenti memakai: ukur % hari tercatat, perbaiki gesekan sebelum M2.

## 5. M2: Bersama penuh, anggaran, laporan

Gerbang keluar: Farida bergabung; kedua akun 7 hari berturut-turut (definisi PRD §6.1).

### S8: Bersama

- **Cakupan.** Setoran ke Bersama, feed aktivitas (pelaku, sebelum/sesudah), kontribusi per orang; undang Farida dan onboarding Farida nyata (checklist 3 langkah).
- **Dependensi.** S7.
- **Kriteria keluar.** Feed tidak pernah memuat nama dompet atau entri Pribadi (Playwright dua user); isolasi penuh pada tabel baru.
- **Risiko / mitigasi.** Farida menolak alur: pantau penilaian M0a; sesuaikan.

### S9: anggaran, laporan, tagihan dasar, Beranda

- **Cakupan.** Anggaran per ruang; `app.report_lines` + `app.report_class()` (15 kelas) satu sumber; Ringkasan; **tagihan rutin dasar** (`api.create_bill`, `api.post_bill_occurrence`, UI tagihan; tagihan yang mulai di masa lalu hanya dihitung dari bulan berjalan); "aman dipakai" nyata (`api.safe_to_spend`, default akhir bulan, sudah memuat jadwal tagihan; tanggal gajian opsional Belum diputuskan); aturan satu kewajiban = tagihan atau anggaran wajib, tidak keduanya (`docs/m0a-keputusan.md`, `obligation_double`).
- **Dependensi.** S8.
- **Kriteria keluar.** Angka Beranda cocok dengan laporan; budget JS ≤ 162 kB (target 150 dibatalkan); Web Vitals LCP < 2,5 s, INP < 200 ms, CLS < 0,1 di HP kelas menengah.
- **Risiko / mitigasi.** Dobel hitung kewajiban: aturan tunggal dan tes. Grafik menambah JS: Recharts hanya di rute Laporan, dimuat malas.

### S10: worker lanjutan, CSV, review bulanan

- **Cakupan.** `recurring_materialize` 00:05 WIB di worker yang sudah ada; export CSV (escape formula); review bulanan dan salin anggaran 1 ketukan.
- **Dependensi.** S9.
- **Kriteria keluar.** Job idempoten (jalan 2x = 1 entri); CSV cocok dengan laporan; gerbang M2 (masa pakai 7 hari setelah sprint).
- **Risiko / mitigasi.** Job gagal diam: alert dan `job_runs`. Beban di VM sempit: limit memori container worker.

## 6. M3 sampai M8

Rincian dan tes (T6 sampai T15) ada di `docs/team/round1/qa.md`. Sprint M3 sampai M7 dipecah ulang sebelum dimulai, memakai kecepatan nyata M1/M2 (perkiraan di §2 hanya placeholder).

| Sprint | Cakupan                                                                                                                                                                                   | Dependensi                | Gerbang / kriteria keluar                                                     | Risiko dan mitigasi                                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| S11    | Utang/piutang, cicilan, utang berjalan tanpa efek kas                                                                                                                                     | M2                        | T6 sampai T10 (bersama S12)                                                   | Sisa salah: sisa = pokok − Σ pembayaran sebagai view; bayar > sisa ditolak atomik; batal cicilan membalik efek            |
| S12    | Modal trading (hanya Pribadi); bagi tagihan Bersama (saldo antar-anggota + pelunasan)                                                                                                     | S11                       | T6 sampai T10 lulus (gerbang M3)                                              | Salah kaprah siapa berutang ke siapa: dihitung dari data, tanpa logika pelunasan tersembunyi                              |
| S13    | Tujuan tabungan, 1 dompet = 1 tujuan aktif                                                                                                                                                | M3                        | bagian T11                                                                    | Dua tujuan satu dompet: constraint DB                                                                                     |
| S14    | Aset, saham (harga di server), net worth per ruang, snapshot 00:10 WIB                                                                                                                    | S13                       | T11 lulus (gerbang M4)                                                        | Harga gagal atau lonjakan: nilai terakhir + label; validator harga; tanpa proxy CORS publik                               |
| S15    | Trip, tagihan rutin lanjutan                                                                                                                                                              | M4                        | bagian T14, T15                                                               | Tanggal 31: aturan akhir bulan diuji                                                                                      |
| S16    | Kalender arus kas, deteksi langganan, ekspor PDF                                                                                                                                          | S15                       | T14, T15 lulus (gerbang M5)                                                   | PDF beda angka dari laporan: satu view sumber; escape PDF                                                                 |
| S17    | Catat teks bebas (aturan + LLM di balik `LlmProvider`), eval set                                                                                                                          | M5; model dipilih pemilik | Eval set lulus target (target Belum diputuskan)                               | Simpan tanpa konfirmasi: dilarang; kuota habis: parser aturan tetap jalan; data bocor ke LLM: hanya teks itu yang dikirim |
| S18    | Analisis AI (kuota 15 parsing + 5 analisis per hari per user), PWA offline-baca, foto struk terenkripsi tanpa OCR (prasyarat: keputusan penyimpanan lampiran dan kunci, belum ada di TRD) | S17                       | Gerbang M6 (eval set) + offline, cache kosong setelah logout, PWA installable | Data Pribadi pasangan ikut dikirim: analisis memakai view RLS pengguna; cache bocor antar akun: dibersihkan saat logout   |
| S19    | Arsip ekspor v1, screenshot otomatis 390/1280 terang/gelap dari data demo, matikan v1, pembongkaran pratinjau Vercel (ADR 0003)                                                           | M6                        | Pemilik menyetujui (gerbang M7; daftar periksa PRD §6.1)                      | v1 dimatikan sebelum arsip aman: arsip diverifikasi dulu; v1 tetap read-only sampai itu                                   |
| M8     | Kosong. Otomatisasi catat (email bank, WhatsApp Cloud API, Telegram) ditunda ke backlog                                                                                                   | -                         | -                                                                             | -                                                                                                                         |

## 7. Risiko lintas milestone

| Risiko                                     | Mitigasi                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| Pemilik jadi satu-satunya penghubung ke VM | Runbook, sesi Claude Code di VM, deployer pull-based tanpa SSH harian          |
| Kehilangan data                            | Backup + uji restore berkala, soft delete 90 hari, `entry_history` append-only |
| Kebocoran data Pribadi                     | RLS FORCE, pgTAP dua user, `spaceId` eksplisit, log tanpa nominal/deskripsi    |
| Rantai pasok                               | Actions dipatok SHA, `minimumReleaseAge`, patch critical ≤ 48 jam              |
| Budget JS habis                            | Ukur tiap PR; keputusan pemilik bila batas dinaikkan                           |
| Pemakaian berhenti                         | Metrik % hari tercatat; gerbang 7 hari berturut-turut (definisi PRD §6.1)      |

## 8. Utang desain dan proses desain

**Proses (keputusan pemilik):** agen merancang layar yang belum didesain dengan mengikuti pola Panel Malam dan kursi design reviewer di tiap task UI; pemilik menilai di pratinjau; layar besar baru (Pengaturan, Analisis) dipesan lewat Claude Design. Design critique atas pratinjau Panel Malam dilakukan sebelum S4.

| Utang desain                                                                                                                                                        | Sebelum sprint  | Cara                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------- |
| Auth: `/buat-akun`, kode pemulihan, masuk TOTP dan pemulihan, lupa kata sandi, akun pertama, galat auth, halaman galat undangan, Tautan terkirim, Undangan tertunda | S4              | Agen + design reviewer (layar kode pemulihan paling sensitif) |
| Menu → Pengaturan (perangkat, audit log)                                                                                                                            | S4              | Claude Design (layar besar baru)                              |
| Sampah; Catat (saldo kurang, galat simpan, "Menyimpan…", transfer lintas ruang); Detail (Ubah, konflik versi, Pindahkan, transaksi dibatalkan)                      | S6              | Agen + design reviewer                                        |
| Dompet: Cocokkan saldo, saldo awal, arsip, talangan dan reimburse                                                                                                   | S6 sampai S7    | Agen + design reviewer                                        |
| Bersama solo dan kosong, checklist Beranda Farida                                                                                                                   | S7 sampai S8    | Agen + design reviewer                                        |
| Setoran, feed, kontribusi; Anggaran, tagihan, review bulanan, Rencana nyata, ekspor                                                                                 | S8 sampai S10   | Agen + design reviewer                                        |
| Laporan dan grafik                                                                                                                                                  | S9              | Claude Design (layar besar baru)                              |
| Menu: Kategori (S6), Trip, Kontak, Export, Analisis                                                                                                                 | Sprint fiturnya | Analisis lewat Claude Design; lainnya agen                    |
| Bingkai tablet (600 sampai 1023) dan 320 px; terang untuk auth, Menu, Rencana, Tambah dompet, Detail dompet; 404 dan sesi kedaluwarsa                               | S4 sampai S6    | Agen, diuji screenshot                                        |
| PWA: ikon aplikasi, splash, favicon (berkas dari pemilik), dialog pasang                                                                                            | S3              | Favicon dari pemilik                                          |

## Pertanyaan terbuka

Ditutup keputusan pemilik 2026-10-31: urutan sprint, definisi "7 hari berturut-turut" (PRD §6.1), penyedia email (Resend), Web Vitals, urutan M0a dan M0b.

1. Panjang sprint aktual dan kapasitas kerja pemilik per minggu: Belum diputuskan.
2. Subdomain akhir: Belum diputuskan (usulan `dompet.novandafadly.com`).
3. Akses VM dan SSH: tersedia 2026-10-31 (sesi Claude Code di VM App, SSH ke VM DB); S1 selesai (`docs/ops/runbook-s1.md`).
4. Model LLM dan target eval set M6: Belum diputuskan.
5. Penyimpanan lampiran foto struk (bucket atau DB) dan kuncinya: diputuskan sebelum S18.
6. Konflik: Spec §7a (self-hosted runner) sudah digantikan §9.2 dan §9.5 (pull-based, disetujui). Spec §6 (M8 Telegram) digantikan §9.6.
