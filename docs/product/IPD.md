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
- **Status worker (2026-11-04).** Bagian worker minimal S5 dikerjakan di S7 (Task 15 dan 16, urutan dimajukan R21) di branch `ccr-93c19006-ivqnyt`, belum di-merge dan belum di-deploy: `apps/worker` (pg-boss `createSchema: false`, role `dompetku_worker`, `jobs.job_runs`, alert Healthchecks tanpa nominal), dibundel ke image yang sama dengan web dan dijalankan deployer cosign sebagai layanan compose kedua (K1). Bukti: tes unit worker 34 dan int worker 8 (job CI `auth`: job gagal berakhir `failed` dan `/fail` terkirim, dua instance tidak menjalankan job sama, cron 01:00 WIB), `deploy-test.sh` 25 skenario (job `infra`). Pemasangan di VM: `docs/ops/runbook-s7-worker.md`.

### S6: Catat, transaksi, Sampah, event produk

Gerbang awal: bingkai desain Catat (galat, "Menyimpan…", peringatan saldo, transfer lintas ruang) dan Sampah ada (§8).

- **Cakupan.** Menyambung UI prototipe ke DB; kategori + `api.suggest_categories` + kamus awal; parser nominal ("35rb/35k/1,5jt"); Catat jalur tercepat ≤ 3 ketukan; edit (konflik versi DK409), void, urungkan; **layar Sampah** (daftar dan pulihkan); "Menyimpan…" dan jalur galat nyata; pindah ruang di sheet; **`product_events`** dengan event `catat_dibuka` dan `catat_disimpan` (`catat_id`, `ketukan`, tanpa nominal) dan **tombol "Tidak ada pengeluaran hari ini"** (`api.mark_no_spend_day`), diukur sejak pemakaian pertama.
- **Dependensi.** S5; ADR 0004.
- **Kriteria keluar.** Catat jalur tercepat ≤ 3 ketukan dari Beranda, Transaksi, Dompet di Pribadi dan Bersama; urungkan 6 detik mengembalikan saldo; Sampah memulihkan dalam 90 hari; event tercatat tanpa nominal; keyboard-only lulus; budget JS rute ≤ 162 kB.
- **Status (2026-11-03).** Selesai di branch `claude/inspiring-hypatia-l7rvfz`, belum di-merge ke `main` (menunggu gelombang perbaikan temuan ditunda, review akhir, dan CI). Task 1 sampai 20 plus 17b; kriteria keluar dibuktikan `e2e:ledger` (Catat 3 ketukan di enam kombinasi ruang dan layar, budget JS mode nyata ≤ 162 kB), `test:int`, dan pgTAP. Catatan teknis: BSD §16 "Catatan S6"; keputusan desain: `docs/design/s6-bingkai.md`.
- **Risiko / mitigasi.** Budget JS hanya sisa sekitar 1 kB: ukur tiap PR, muat malas, keputusan pemilik bila perlu naik. Salah kategori tersimpan: kategori tidak pernah terpilih otomatis.

### S7: transfer, talangan, rekonsiliasi

- **Cakupan.** Transfer dalam ruang; `space_transfer` lewat `api.create_transfer` (dua entri bertaut `link_id`, trigger pasangan, void bersama; keterangan Bersama ke Pribadi disimpan di sisi Pribadi); talangan kantor (bukan pengeluaran pribadi; biaya dari Kas Kantor masuk angka Kantor); `dq_reconcile` 01:00 WIB (10 cek, alert tanpa nominal) dijadwalkan di worker S5; Bersama solo dan kosong.
- **Dependensi.** S6.
- **Kriteria keluar (teruji).** Tes konkurensi; ID tes M1 (PRD §6.2) hijau; `dq_reconcile` hijau; hari pertama pakai dimulai. Gerbang M1 sendiri (7 hari WIB beruntun, selisih 0) adalah langkah masa pakai setelah sprint, bukan kriteria keluar sprint.
- **Risiko / mitigasi.** Kebocoran Pribadi lewat kaki Bersama: kaki tujuan tanpa deskripsi, `shared_note` eksplisit. Novanda berhenti memakai: ukur % hari tercatat, perbaiki gesekan sebelum M2.
- **Status (2026-11-04).** Selesai di branch `ccr-93c19006-ivqnyt`, belum di-merge ke `main` dan belum di-deploy (PR menyusul). Task 1 sampai 18; migrasi `0109`-`0113`. Catatan teknis: BSD §16 "Catatan S7"; keputusan desain dan critique: `docs/design/s7-bingkai.md`; serah-terima: `docs/superpowers/handoff/s7.md`. Syarat merge: CI hijau di head PR, pemilik menjalankan `cek-duplikat-dompet-0109.sh` (hasil 0), dan langkah `docs/ops/runbook-s7-worker.md` (build ulang image postgres sebelum `worker.env`).

  | Kriteria keluar                                                                                                | Bukti                                                                                                                                                                                                                          |
  | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | Transfer dalam ruang dan antar ruang (`link_id`, void bersama, keterangan Bersama → Pribadi di sisi Pribadi)   | pgTAP `07`/`08`/`99`; `s7.int` (arah Pribadi ↔ Bersama, hanya pencatat); `s7.spec` (setor Pribadi → Bersama, batalkan berpasangan, kanari Pribadi di 7 rute Bersama). Arah ambil Bersama → Pribadi di UI hanya dijaga `s7.int` |
  | Talangan bukan pengeluaran pribadi; biaya Kas Kantor masuk angka Kantor                                        | pgTAP `15_talangan` (`period_summary`, `x_talangan`, `x_kantor`). Mode nyata belum menampilkan angka periode, jadi tidak ada asersi e2e atas angka itu                                                                         |
  | Reimburse sebagian, pembatalan, Menunggu reimburse                                                             | pgTAP `15_talangan`, `99_konkurensi`; `s7.spec` (talangan 500.000, reimburse 300.000, sisa 200.000)                                                                                                                            |
  | `dq_reconcile` 01:00 WIB di worker, alert tanpa nominal, 10 cek                                                | pgTAP `17_dq` (10 baris, tiap cek diuji positif); int worker; `deploy-test.sh`                                                                                                                                                 |
  | Bersama solo dan kosong                                                                                        | `s7.spec` B1, `ledger.spec` B2 (+ axe)                                                                                                                                                                                         |
  | Tes konkurensi                                                                                                 | `99_konkurensi` (kategori, pindah, reimburse, arsip)                                                                                                                                                                           |
  | ID tes M1 (PRD §6.2)                                                                                           | dipetakan di `docs/superpowers/handoff/s7.md`                                                                                                                                                                                  |
  | `dq_reconcile` hijau                                                                                           | `17_dq`; int worker                                                                                                                                                                                                            |
  | Utang S6 (nama dompet unik, pool Beranda, tes lintas ruang, seed demo keluar dari JS nyata, deadlock kategori) | Task 2, 6, 7, 9, 12, 14                                                                                                                                                                                                        |
  | Hari pertama pakai dimulai                                                                                     | langkah pemilik sesudah merge + deploy (`docs/ops/auth.md`, runbook worker); bukan kriteria sprint                                                                                                                             |

  Angka: pgTAP 965, unit web 1906, worker unit 34 + int 8, `test:int` 154, e2e prototipe 290, `e2e:auth` 21, `e2e:ledger` 38 (+7 screenshot dilewati), `deploy-test.sh` 25; budget JS Beranda prototipe 161,5 kB / nyata 157,4 kB (batas 162).

## 5. M2: Bersama penuh, anggaran, laporan

Gerbang keluar: Farida bergabung; kedua akun 7 hari berturut-turut (definisi PRD §6.1).

### S8: Bersama

- **Cakupan.** Setoran ke Bersama, feed aktivitas (pelaku, sebelum/sesudah), kontribusi per orang; undang Farida dan onboarding Farida nyata (checklist 3 langkah).
- **Dependensi.** S7.
- **Kriteria keluar.** Feed tidak pernah memuat nama dompet atau entri Pribadi (Playwright dua user); isolasi penuh pada tabel baru.
- **Risiko / mitigasi.** Farida menolak alur: pantau penilaian M0a; sesuaikan.
- **Status (2026-11-05).** Selesai dan di-merge ke `main` (PR #20, 2026-11-05; Task 1 sampai 12; migrasi `0114`-`0115`, tanpa tabel baru). Catatan teknis: BSD §16 "Catatan S8"; keputusan desain dan critique: `docs/design/s8-bingkai.md`; serah-terima dan langkah pemilik: `docs/superpowers/handoff/s8.md`.

### S9: anggaran, laporan, tagihan dasar, Beranda

- **Cakupan.** Anggaran per ruang; `app.report_lines` + `app.report_class()` (15 kelas) satu sumber; Ringkasan; **tagihan rutin dasar** (`api.create_bill`, `api.post_bill_occurrence`, UI tagihan; tagihan yang mulai di masa lalu hanya dihitung dari bulan berjalan); "aman dipakai" nyata (`api.safe_to_spend`, default akhir bulan, sudah memuat jadwal tagihan; tanggal gajian opsional Belum diputuskan); aturan satu kewajiban = tagihan atau anggaran wajib, tidak keduanya (`docs/m0a-keputusan.md`, `obligation_double`).
- **Dependensi.** S8.
- **Kriteria keluar.** Angka Beranda cocok dengan laporan; budget JS ≤ 162 kB (target 150 dibatalkan); Web Vitals LCP < 2,5 s, INP < 200 ms, CLS < 0,1 di HP kelas menengah.
- **Risiko / mitigasi.** Dobel hitung kewajiban: aturan tunggal dan tes. Grafik menambah JS: Recharts hanya di rute Laporan, dimuat malas.
- **Status (2026-11-08).** Selesai di branch `claude/bold-pasteur-535stf`, PR #24 (Task 1 sampai 13, 15, 17; Task 14 dan 16 dipindah ke S10 oleh pemilik 2026-11-07). Migrasi `0116`-`0121`, expand-only: periode gajian (`payday_rule = 25`, `app.holidays`, `app.pay_period`, BSD §8.2a menggantikan "tanggal gajian opsional"), tabel `bills`/`bill_occurrences`/`budgets`, API tagihan + job `materialize_bills` 00:05 WIB (dimajukan dari S10), API anggaran + `copy_budgets` (salin anggaran dimajukan dari S10), aman dipakai lengkap + `spend_pace`, fungsi baca Laporan. Grafik Laporan = SVG statis dari Server Component (tanpa Recharts). Merge = deploy + migrasi `0116`-`0121` di produksi. Bukti kriteria keluar:
  - Angka Beranda cocok dengan laporan: golden T17 (`24_aman_dipakai`, `25_laporan`), `rencana.int`, e2e `s9-keluar.spec` (Beranda = Rencana = Laporan pada skenario campuran Pribadi dan Bersama, dengan selisih sah dari SQL; BSD §16 "Catatan S9").
  - Budget JS ≤ 162 kB (js-route): prototipe Beranda 161,6, Transaksi 160,9, Rencana 154,4, Laporan 155,3; nyata Beranda 157,5, Transaksi 156,8, Rencana 150,3, Laporan 151,2 (e2e budget di `s9-keluar.spec`, `s9-bersama.spec`, `tagihan.spec`).
  - Web Vitals: spesifikasi E2E `apps/web/tests/e2e-ledger/vitals.spec.ts` ditambahkan di gelombang Pra-S10 (`claude/m2-pra-s10-utang-s9`; 390×844 dengan throttle CPU 4× + jaringan 4G lambat pada 5 rute terisi, median 3 muat dingin: LCP < 2,5 s, INP < 200 ms, CLS < 0,1).
  - Satu kewajiban (`obligation_double`): `21_kewajiban`, `99_konkurensi` (C9), DQ13, e2e `tagihan.spec`. B13 (Laporan dan Rencana Bersama tanpa kanari Pribadi): pgTAP, `rencana.int`, e2e dua user `s9-bersama.spec` (HTML + payload RSC untuk Novanda dan Farida).
  - Catatan teknis: BSD §16 "Catatan S9"; desain, critique, dan Delivery Gate: `docs/design/s9-bingkai.md`; serah-terima dan langkah pemilik: `docs/superpowers/handoff/s9.md`.

### S10: worker lanjutan, CSV, review bulanan

- **Cakupan.** `recurring_materialize` 00:05 WIB di worker yang sudah ada (jadwal dasar `materialize_bills` sudah di S9); export CSV (escape formula); review bulanan dan salin anggaran 1 ketukan dengan penyesuaian (salin dasar `copy_budgets` sudah di S9); anggaran subkategori (K5). Utang teknis/desain S7/S8/S9 (Task 14 & Task 16 plan S9, critique minor S9-C3/C4/C5/C6/C10, migrasi keamanan rendah `0122_tagihan_batas_idem.sql`) telah diselesaikan lebih dulu di branch `claude/m2-pra-s10-utang-s9` (`docs/superpowers/plans/2026-11-08-dompetku-v2-pra-s10-utang-s9.md`).
- **Dependensi.** S9.
- **Kriteria keluar.** Job idempoten (jalan 2x = 1 entri); CSV cocok dengan laporan; gerbang M2 (masa pakai 7 hari setelah sprint).
- **Status (2026-11-12).** Selesai di branch `ccr-779b3416-vsu3pa` (belum PR). `recurring_materialize` = `jobs.materialize_bills` (S9), jadi "worker lanjutan" = retensi `wa_messages` (`purge_wa_messages` 01:27 WIB) dan utang worker. Migrasi `0124`–`0128`. Bukti: job idempoten (`22_tagihan`, `99_konkurensi` T15, `purge_wa_messages` dijalankan ulang = 0), CSV = Laporan (`28_ekspor`, `rencana.int` [T17], e2e `laporan.spec`/`s9-bersama.spec`), Review = Laporan/Rencana (`rencana.int`), budget JS ≤ 162 kB. **Gerbang M2 (masa pakai 7 hari dua akun) menunggu pemilik.** Catatan teknis: BSD §16 "Catatan S10"; serah-terima dan langkah pemilik: `docs/superpowers/handoff/s10.md`.
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

### S11: status (utang/piutang, cicilan, utang berjalan)

- **Status (2026-11-13).** Selesai di branch `ccr-f260701e-61yx7j`, di-merge ke `main` (PR #34, 2026-11-13). **Merge = deploy + migrasi `0129`–`0131` di produksi**, tanpa langkah VM baru. Task 1 sampai 8 lulus review independen; review akhir (task + keamanan) dan gerbang penuh dijalankan pengendali sebelum PR. Catatan teknis: BSD §16 "Catatan S11"; desain, critique, dan Delivery Gate: `docs/design/s11-bingkai.md`; serah-terima: `docs/superpowers/handoff/s11.md`; keputusan agen: `docs/m0a-keputusan.md`.
- **Bukti kriteria keluar (T6 sampai T9, S4, INT-12, C3, C6, B10, I6; lokasi lengkap di `packages/db/tests/REGISTRY.md`):**
  - T6 dan S4 (ubah judul/catatan/kontak tanpa efek ke saldo, cicilan, sisa): pgTAP `30_utang_api`, `utang.int` (`[S4] [T6]`), e2e `utang.spec` (Ubah utang pada utang yang dicicil).
  - T7 (bayar melebihi sisa ditolak, nol efek): `30_utang_api` (`payment_exceeds`), `utang.int`, e2e `utang.spec` (galat kolom + `Bayar sisa`).
  - T8 (batal cicilan membalik saldo dan sisa, riwayat menandai batal): `30_utang_api`, `utang.int`, e2e `utang.spec`.
  - T9 (Hapus utang membalik semua efek, Pulihkan mengembalikan): `30_utang_api`, `utang.int`, e2e `utang.spec`.
  - INT-12 (`pay_debt` gagal di tengah = rollback utuh, termasuk kunci idempotensi): `99_konkurensi` (`tests.fail_after`), `utang.int`.
  - C3 (dua bayar paralel melebihi sisa: yang kedua `payment_exceeds`, sisa tidak negatif): `99_konkurensi`, `utang.int`.
  - C6 (klik ganda Simpan utang dan Bayar cicilan = satu efek): e2e `utang.spec`, `99_konkurensi` (bayar kembar), `utang.int`.
  - B10 (utang dan kontak tidak ada di Bersama): `29_utang` (CHECK), `30_utang_api`, `utang.int`, e2e `utang.spec` (rute dan payload Bersama tanpa kanari).
  - I6 (pokok dan cicilan tidak mengubah Σ pemasukan/pengeluaran, Laporan, anggaran): `29_utang`, `utang-integrasi.int`, e2e `utang.spec` (Laporan).
  - Angka: pgTAP 2221, unit web 3049, `test:int` 294, e2e prototipe 308, `e2e:ledger` 119 (+30 dilewati), `e2e:bersama` 34, `e2e:auth` 22; budget JS nyata Rencana 150,5, utang 150,5, detail utang 150,6, Kontak 148,5 kB (batas 162).
- **T10 tidak termasuk S11:** tetap `belum` di registry; dikerjakan bersama S12 (gerbang M3). "Aman dipakai" tetap kas murni, jadi meminjam menaikkan angka itu; kartu "Utang yang harus dibayar" menunggu keputusan pemilik (S12).

### S12: status (modal trading, bagi tagihan Bersama, kartu utang, perbaikan S11)

- **Status (2026-11-14).** Selesai di branch `ccr-6b15bf5f-1cnpb6`, di-merge ke `main` (PR #35, 2026-11-15; review task + keamanan bersih, CI 8 job hijau). **Merge = deploy + migrasi `0132`–`0136` di produksi**, tanpa langkah VM baru; DB hanya maju, jadi image web jangan di-rollback ke versi pra-S12 sesudah ada patungan. Catatan teknis: BSD §16 "Catatan S12"; desain dan S12-ADR1: `docs/design/s12-bingkai.md`; serah-terima: `docs/superpowers/handoff/s12.md`; keputusan agen: `docs/m0a-keputusan.md`. Pemilik menyetujui semua saran S12 (2026-11-14). Delivery Gate antislop dan design critique visual belum dijalankan (tidak ada screenshot); tercatat terbuka di handoff.
- **Bukti kriteria keluar (T10, B10, B21, I6, T19; lokasi lengkap di `packages/db/tests/REGISTRY.md`):**
  - T10 (modal trading: setor modal bukan pemasukan/pengeluaran, tarik sebagian benar, tarik > setor = hasil ditarik, `Kurang Rp…` tepat di batas, void/restore menggeser modal tepat sekali, saldo dompet berubah sekali): pgTAP `32_modal_trading` (juga kaki `space_transfer` trading ↔ Bersama dan antar dompet trading), `17_dq` (DQ15), `trading.int`, e2e `trading.spec` (`e2e:ledger`).
  - I6 (setor/tarik modal tidak mengubah Σ pemasukan/pengeluaran, Laporan, anggaran): `32_modal_trading`, e2e `trading.spec` (setor modal: pemasukan/pengeluaran tidak berubah).
  - B10 (dompet trading dan utang tidak ada di Bersama; dompet sistem patungan tidak ada di Pribadi): `32_modal_trading`, `33_patungan`, `34_patungan_api`, `31_utang_perbaikan` (`debt_totals` Bersama).
  - T19 dan B21 (bagi tagihan: saldo antar-anggota nol-jumlah dari data, pelunasan berlebih ditolak atomik, hapus/pulihkan membalik tepat sekali, Pribadi pasangan tidak terbaca atau tertulis): pgTAP `33_patungan`, `34_patungan_api`, `99_konkurensi` (pelunasan paralel, hapus paralel pelunasan, purge, `fail_after` di tengah `create_split`), `17_dq` (DQ16), `patungan.int`, e2e `zz-patungan.spec` (`e2e:bersama`: dua user, Pribadi pasangan tidak bocor di HTML/RSC).
  - Gerbang M3 (T6 sampai T10): T6 sampai T9 aktif sejak S11 (`30_utang_api`, `utang.int`, `utang.spec`), T10 aktif di S12; `pnpm test:registry` lulus dengan `MAX_MILESTONE = 3`.
  - Angka: pgTAP 2449, unit web 3182, worker unit 36, `test:int` 321, e2e prototipe 308, `e2e:ledger` 130 (+30 dilewati), `e2e:bersama` 43; budget JS nyata Beranda Pribadi 157,5, Beranda Bersama dua anggota 157,5, `/bersama/patungan` 148,8, Dompet 153,2, Rencana 150,5 kB (batas 162).
- **Keputusan pemilik yang sudah dijawab:** kartu "Utang yang harus dibayar" dan perbaikan CSV utang (`0132`); definisi T6 sampai T9 (K10 S11); dompet sistem `patungan` (S12-ADR1 opsi C); langkah `Terima ke dompet`; saldo trading ikut kekayaan bersih; transfer antar dua dompet trading tidak dihitung; keluar dari Bersama ditolak selama belum impas; Laporan Pribadi menghitung uang patungan di "Tidak termasuk · Setor ke Bersama"; definisi T10.
- **Belum dikerjakan (ke S13 dan sesudahnya):** tujuan tabungan (S13); gerbang M2 (masa pakai 7 hari dua akun) masih menunggu pemilik. Utang kecil S12 ada di `handoff/s12.md`.

### S13: status (tujuan tabungan, 1 dompet = 1 tujuan aktif)

- **Status (2026-11-15).** Selesai di branch `ccr-6b15bf5f-1cnpb6`, di-merge ke `main` (PR #36, 2026-11-15; review task + keamanan bersih, gerbang penuh lulus, CI 8 job hijau, Release hijau). **Merge = deploy + migrasi `0137`–`0138` di produksi**, tanpa langkah VM baru; DB hanya maju, jadi image web jangan di-rollback ke versi pra-S13 sesudah ada tujuan. Catatan teknis: BSD §16 "Catatan S13"; desain: `docs/design/s13-bingkai.md`; serah-terima: `docs/superpowers/handoff/s13.md`; keputusan agen: `docs/m0a-keputusan.md`. Pemilik menyetujui rekomendasi keputusan S13 (K1 sampai K8, K10; 2026-11-15). **Delivery Gate antislop dan design critique visual S12 dan S13:** hasil di `docs/design/s12-s13-critique.md` (pending; belum dicatat di sini).
- **Bukti bagian tujuan dari T11 (K9; lokasi lengkap di `packages/db/tests/REGISTRY.md`):**
  - Tujuan kedua aktif pada dompet yang sama ditolak DB, juga dua permintaan paralel (satu menang): pgTAP `35_tujuan` (indeks unik parsial `goals_one_active_per_account`), `36_tujuan_api` (`goal_exists`), `99_konkurensi` (dua `create_goal` paralel, `restore_goal` paralel `create_goal`, `archive_account` paralel `create_goal`), `tujuan.int`, e2e `tujuan.spec` (`e2e:ledger`).
  - Progres = saldo dompet vs target dari SQL (`app.goal_progress`), setor/cairkan/ubah/batal transfer menggeser progres tepat sekali, tanpa kolom progres, saldo negatif = 0%: `35_tujuan` (juga `space_transfer` Pribadi ke dompet tabungan Bersama), `36_tujuan_api` (`list_goals` = view), `tujuan.int`, `dompet-tujuan.int`, e2e `tujuan.spec`, `zz-dompet-tujuan.spec`.
  - I6 (setor/cairkan tujuan dan membuat/mengubah/menyelesaikan tujuan tidak mengubah Σ pemasukan/pengeluaran, Laporan, anggaran, "aman dipakai", kekayaan bersih): `35_tujuan`, `36_tujuan_api` (`period_summary`, `budget_progress`, `safe_to_spend`, `net_worth` sama), `tujuan.int` (saldo dompet), `dompet-tujuan.int` (kekayaan bersih), e2e `tujuan.spec` (uang lain tidak berubah) dan `zz-dompet-tujuan.spec` (saldo dan kekayaan bersih sama).
  - "Perlu Rp X/bulan" benar di batas (habis dibagi, tidak habis dibagi, periode terakhir, tanggal lewat, tercapai, gajian mundur akhir pekan, bulan kalender, batas hari WIB): pgTAP `35_tujuan` dengan jam tiruan; e2e `tujuan.spec`.
  - B22 (tujuan Pribadi pasangan tidak terbaca atau tertulis, Luar tidak melihat apa pun): `35_tujuan`, `36_tujuan_api`, `tujuan.int`, e2e `zz-tujuan.spec` (`e2e:bersama`: kanari tujuan dan dompet Pribadi tidak ada di HTML/RSC pasangan); K1 (anggota Bersama kedua boleh menulis): `36_tujuan_api`, `zz-tujuan.spec`.
  - Arsip dompet bertujuan aktif ditolak (`account_has_goal`, K6) dan DQ17: `36_tujuan_api`, `17_dq`, `dompet-tujuan.int`, e2e `zz-dompet-tujuan.spec`.
  - **T11 tetap `belum` penuh** di `REGISTRY.md` (milestone M4): yang aktif hanya bagian tujuan; bagian aset (repro S5: edit setoran ke aset) dan gerbang M4 penuh = S14. `pnpm test:registry` lulus dengan `MAX_MILESTONE = 3`.
  - Angka: pgTAP 2654, unit web 3293, `test:int` 344, e2e prototipe 308, `e2e:ledger` 147 (+36 dilewati), `e2e:bersama` 48, `e2e:auth` 22, worker int 10; budget JS nyata Beranda 157,5, Rencana Tujuan 150,6, Dompet 153,2, Detail dompet tabungan 153,9, `/bersama/patungan` 148,8 kB (batas 162).
- **Keputusan pemilik yang sudah dijawab:** K1 (Pribadi dan Bersama, semua anggota Bersama menulis), K2 (progres = saldo dompet tanpa penanda "goal" di transfer), K3 sampai K8 dan K10 (default plan); izin berdiri PR dan merge S13. K9 (definisi "bagian T11", inferensi agen) tetap **[konfirmasi pemilik]**.
- **Belum dikerjakan (ke S14 dan sesudahnya):** aset, saham (sumber harga saham: keputusan terbuka), net worth per ruang, snapshot 00:10 WIB, bagian aset T11 (S14); gerbang M2 (masa pakai 7 hari dua akun) masih menunggu pemilik. Utang kecil S13 ada di `handoff/s13.md`.

### S14: status (aset, saham, kekayaan bersih, snapshot harian)

- **Status (2026-11-20).** Task 1–7 dan 9–12 selesai di branch `ccr-6b15bf5f-1cnpb6`; **Task 8 (adapter harga otomatis Yahoo) belum dikerjakan** dan tidak menahan rilis (harga manual = jalur utama, K1). **Menunggu merge** [pengendali memperbarui status PR, merge, dan Release di sini dan di `CLAUDE.md`]. **Merge = deploy + migrasi `0139`–`0145` di produksi**; langkah VM baru: pasang egress worker (`docs/ops/runbook-s7-worker.md` "Pasang S14"); DB hanya maju, jadi image web jangan di-rollback ke versi pra-S14 sesudah ada aset atau saham. Catatan teknis: BSD §16 "Catatan S14"; desain: `docs/design/s14-bingkai.md` (critique visual: `docs/design/s14-critique.md`); serah-terima: `docs/superpowers/handoff/s14.md`; keputusan agen: `docs/m0a-keputusan.md`.
- **Bukti bagian aset dari T11 (definisi kerja K13; isi asli INT §4 tidak ada di repo; lokasi lengkap di `packages/db/tests/REGISTRY.md`):**
  - (a) **S5**: setor ke aset 500 rb lalu ubah ke 600 rb (transfer tidak bisa diubah: batalkan + catat ulang): nilai aset 600 rb, dompet −600 rb, kekayaan bersih tetap, batal/pulihkan tepat sekali: pgTAP `37_aset`, `38_aset_api`; `aset.int`/`kekayaan.int` (`test:int`); e2e `zz-aset.spec` (`e2e:ledger`).
  - (b) **I6**: `valuation` dan beli/jual saham (biaya/pajak, harga) tidak mengubah Σ pemasukan/pengeluaran, Laporan, anggaran, "aman dipakai", Ekspor; hanya kelas `x_valuasi` di "Tidak termasuk": `37_aset`, `40_saham_api`, `43_ekspor_saham` (Σ CSV = Laporan), e2e `zz-aset.spec` (@I6), `zz-saham.spec`.
  - (c) **Dompet aset tidak bisa negatif** (DB, semua jalur, terlepas dari `p_allow_negative`) dan tidak masuk jalur pemasukan/pengeluaran/tagihan/utang/patungan/WA: `37_aset`, `38_aset_api`, `99_konkurensi` (dua Perbarui nilai paralel, transfer keluar paralel valuasi turun), DQ19 di `17_dq`.
  - (d) **Saham**: lembar, biaya rata-rata (floor), P/L terealisasi, jual sebagian/habis/impas, biaya/pajak, saham berjalan, jual > lembar ditolak, batal hanya trade terakhir dan tepat sekali, saldo buku dompet saham = Σ biaya posisi (DQ18): `39_saham`, `40_saham_api`, `99_konkurensi` (jual paralel, batal paralel beli baru), `saham.int`, e2e `zz-saham.spec`.
  - (e) **Harga**: ≤ 0, > 10^9, bukan bulat ditolak; lonjakan > 35% = `held` dengan nilai terakhir + label dan konfirmasi untuk harga manual; `price_ingest` dengan data rusak tidak menulis apa pun yang salah; penyedia timeout/4xx/5xx/badan terlalu besar/bentuk salah = run gagal dengan kode singkat tanpa menimpa harga: `41_harga`, `40_saham_api`; worker unit (`price-source.test`, `price-refresh.test`, pagar `fetch`) dan worker int (`StubPriceSource`); e2e `zz-saham.spec`.
  - (f) **Kekayaan bersih satu fungsi SQL** (`app.net_worth_at`) dipakai Dompet, `api.net_worth`, dan snapshot; setoran lintas ruang menggeser per ruang dan Σ tetap (**B16**): `42_kekayaan`, `kekayaan.int`, e2e Bersama `zz-aset.spec` (@B16).
  - (g) **Snapshot**: idempoten, bertanggal hari WIB yang benar (batas 23:59/00:00), hari kotor (entri susulan, koreksi harga) dihitung ulang, malam terlewat diisi ulang, batas 400 hari, backfill, DQ08 = 0: `42_kekayaan`, `17_dq`, worker int (`net_worth_snapshot`, `dq_reconcile` tanpa DQ08/18/19).
  - (h) **Isolasi (B23, B24)**: aset, holding, trade, harga, dan snapshot Pribadi pasangan tidak terbaca atau tertulis, Luar tidak melihat apa pun, `price_targets` tanpa info ruang: `37_aset`, `39_saham`, `41_harga`, `40_saham_api`, e2e Bersama `zz-aset.spec` (kanari tidak ada di HTML/RSC pasangan; Bersama tanpa kata saham).
  - **T11 dan S5 tetap `belum` di `REGISTRY.md`** (`MAX_MILESTONE = 3`): bukti di atas sudah ada, tetapi K13 (definisi bagian aset T11) adalah inferensi agen dan **belum dijawab pemilik**; setelah pemilik menjawab, T11 dan S5 dinaikkan ke `aktif` M4 dan `MAX_MILESTONE` ke 4 (gerbang M4 lulus). `pnpm test:registry` lulus.
  - Angka: pgTAP 3336 (45 berkas), unit web 3463, `test:int` 385, worker unit 63 + int 16, e2e prototipe 308, `e2e:ledger` 161 (+46 dilewati), `e2e:bersama` 53, `e2e:auth` 22; budget JS nyata Beranda 157,5 (tidak berubah), Transaksi 157,6, Dompet 153,4, Detail dompet (aset dan saham) 154,1, Detail transaksi 153,6, Laporan 151,3, Sampah 155,6, Rencana 150,6, Kontak 148,5 kB (batas 162).
- **Keputusan pemilik yang sudah dijawab:** K2, K3, K5, K6, K7 dan K4, K8–K12, K14 default plan ("oke gas aja", 2026-11-15); izin berdiri PR dan merge. **Masih terbuka:** K1 (sumber harga: manual + adapter Yahoo tidak resmi adalah keputusan agen, belum diuji dari VM), K13 (definisi bagian aset T11), `Kurang` total K7 opsi (a)/(b), jenis CSV kunci mesin (S12), setoran Pribadi ke aset Bersama ikut Kontribusi S8.
- **Belum dikerjakan (ke S15 dan sesudahnya):** Task 8 (adapter harga otomatis, runbook harga); gerbang M2 (masa pakai 7 hari dua akun) menunggu pemilik; grafik kekayaan bersih (S-50, M6), "total keluarga", dividen/aksi korporasi (K14). Utang kecil S14 ada di `handoff/s14.md`.

### S15: status (trip dan tagihan rutin lanjutan)

- **Status (2026-11-23).** Selesai penuh (Task 1–12): DB `0146`–`0148` + tagihan lanjutan + server web Task 6 di-merge lewat PR #40 (`f7836ca`); UI Trip + Detail trip + pemilih Catat/Ubah/Detail transaksi/Pindahkan/Patungan + CSV/Sampah + e2e + Delivery Gate + dokumen diselesaikan di branch `feat/s15-trip-ui`. **Merge = deploy + migrasi `0146`–`0148` di produksi** (tanpa langkah VM baru; sehari sesudahnya cek `dompetku-dq` DQ20 = 0; DB maju-saja, jangan rollback image web ke pra-S15 sesudah ada trip karena `update_entry` lama melepas tag diam-diam). Catatan teknis: BSD §16 "Catatan S15"; desain dan Delivery Gate: `docs/design/s15-bingkai.md`, `docs/design/s15-critique.md`; serah-terima: `docs/superpowers/handoff/s15.md`; keputusan agen: `docs/m0a-keputusan.md`.
- **Bukti kriteria keluar (bagian T14/T15, Z4, Z5, B14, B25, I6; lokasi lengkap di `packages/db/tests/REGISTRY.md`):**
  - **Tagihan lanjutan (Z4, Z5, B14, T15 parsial):** `47_tagihan_lanjutan.sql` (tanggal 31: 31 Jan, 28/29 Feb, 31 Mar, 30 Apr; batas hari WIB 23:59/00:00; idempotensi `materialize_bills` dan `post_bill_occurrence`; isolasi Bersama/Luar) + `apps/worker/src/jobs.test.ts`; Z4, Z5, B14 naik ke `aktif`. **T14 dan T15 tetap `belum`** sampai S16 (kalender arus kas, deteksi langganan, ekspor PDF) dan konfirmasi K12 pemilik.
  - **Trip dan I6:** total trip, rata-rata per hari berjalan, sisa/lebih anggaran, dan rincian (kategori, hari, pencatat) seluruhnya dari SQL (`api.list_trips`, `api.trip_overview`, `api.trip_breakdown`, `api.trip_candidates`, `app.report_lines` kelas `expense`); Kantor, talangan, biaya transfer, dan entri batal tidak masuk; Σ pemasukan/pengeluaran, Laporan, anggaran bulanan, "aman dipakai", kekayaan bersih, dan Kontribusi tidak berubah (`44_trip`, `45_trip_api`, `46_trip_tulis`, `trip.int`, `e2e-ledger/zz-trip.spec` `@I6`).
  - **Isolasi dan Bersama (B25, K1, K6, K16):** trip dan tag Pribadi pasangan tidak terbaca/tertulis dan tidak ada di HTML/RSC maupun CSV ruang lain (`44_trip`..`46_trip_tulis`, `trip.int`, `e2e-bersama/zz-trip.spec` `@B25`); semua anggota Bersama menulis; patungan ke trip terkunci (`split_locked`) dan tampil di `Dicatat oleh`; perubahan `trip_id`-saja tidak membanjiri feed Aktivitas (K16).
  - **Konkurensi & DQ20:** urutan kunci trip → entri → dompet, `archive_trip` paralel tag, dua `create_trip` nama sama paralel, `void_entry` paralel tag (`99_konkurensi`); DQ20 di `17_dq` dan `private.dq_run`.
  - **Angka & budget JS:** pgTAP 3817 (49 berkas), unit web 3564 (173 berkas), `test:int` web 411 (31 berkas), worker unit 63, domain 97 (+28×2 tz), demo-data 40, e2e `zz-trip` ledger 5 + bersama 4 (+3 bergabung), prototipe `budget.spec` 9/9; budget JS nyata `/pribadi/trip` **148,3 kB**, `/pribadi/trip/[id]` **148,7 kB**, Beranda **157,4 kB**, Transaksi **157,4 kB**, Detail transaksi **153,4 kB** (batas 162 kB).
- **Keputusan terbuka (default agen dipakai, bisa diubah tanpa migrasi destruktif):** K2 (tag eksplisit, menyimpang dari S-47), K4 (hanya pengeluaran biasa), K9 (saran otomatis Catat), K12 (definisi T14/T15). Opsi saham S14 (K1/K7/K13) tetap ditunda sesuai arahan pemilik 2026-11-22.

### S16: status (kalender arus kas, deteksi langganan, ekspor PDF; gerbang M5)

- **Status (2026-11-24).** Selesai penuh di branch `feat/s16-kalender-langganan-pdf`: DB `0149`, penyusun PDF murni TS (`pdf.ts`), route `/[ruang]/laporan/ekspor-pdf`, halaman Server Component `/[ruang]/rencana/kalender`, kartu `Saran langganan` + `BillPrefill` di `Rencana > Tagihan`, tombol `Ekspor PDF` di Laporan, tes pgTAP/int/unit/e2e, Delivery Gate visual (`docs/design/s16-critique.md`), dan dokumentasi. **Merge = deploy + migrasi `0149` otomatis** tanpa langkah VM baru. Serah-terima: `docs/superpowers/handoff/s16.md`; catatan teknis: BSD §16 "Catatan S16"; desain: `docs/design/s16-bingkai.md`; keputusan agen: `docs/m0a-keputusan.md`.
- **Bukti gerbang M5 (T14, T15, K9, B13 — semuanya `aktif` di `packages/db/tests/REGISTRY.md`):**
  - **Kalender arus kas & tagihan tanggal 31 (T14, T15):** `48_kalender_langganan.sql` (proyeksi 30/90 hari, clamp tanggal 31 -> 30 Apr/31 Mei tanpa occurrence ganda, lewat jatuh tempo di hari ini, saldo operasional = `api.safe_to_spend`, tanda `short`/`Kurang`, dompet aset tidak masuk), `s16.int`, e2e `e2e-ledger/zz-s16.spec` (`@T14`, `@T15`).
  - **Deteksi langganan:** `48_kalender_langganan.sql` (>= 3 bulan berbeda, nominal sama, terakhir <= 45 hari, menyaring tagihan aktif/talangan/abaikan), `s16.int`, unit `langganan-client.test.tsx` + `_actions/langganan.test.ts`, e2e `zz-s16.spec` (Jadikan tagihan prefill `BillSheet` + Abaikan idempoten).
  - **Ekspor PDF (K9, B13, paritas Laporan):** `pdf.test.ts` (escape `\`, `(`, `)`, kontrol/NBSP, muatan injeksi jadi teks literal mati, validasi offset `xref`), `ekspor-pdf/route.test.ts` (`no-store`, `nosniff`, `attachment`, `429`, prototipe `404`), `s16.int` (paritas angka PDF = `loadLaporan`, B13 kanari, K9), e2e `zz-s16.spec` (`@K9`) dan `e2e-bersama/zz-s16.spec` (`@B13`, `@K9`).
  - **Budget JS (muat dingin nyata, batas 162 kB):** Tagihan **150,9 kB**, Kalender **148,9 kB**, Laporan **151,6 kB**; prototipe `budget.spec` 9/9 lulus.

### S17: status (Catat teks bebas `LlmProvider` Claude & Gemini, kuota harian DB, eval set; M6)

- **Status (2026-11-24).** Selesai penuh di branch `feat/s17-catat-teks-bebas-ai`: DB `0150_ai_kuota.sql` (`app.ai_usage` RLS FORCE, `api.ai_quota`, `api.consume_ai_quota` 15 parse / 5 analysis per hari WIB), `LlmProvider` multi-penyedia tanpa SDK (**Google Gemini** `gemini-2.5-flash` & **Anthropic Claude** `claude-haiku-4-5-20251001` dengan failover otomatis primer → cadangan via `LLM_PROVIDER`/`LLM_FALLBACK_PROVIDER`), parser hibrida aturan-dulu (`rules.ts` + `parse-entry.ts`), Eval Set 60 kasus Bahasa Indonesia >= 90% (`eval.test.ts`), Server Action baca-saja `parseFreeTextAction`, bilah `Ketik cepat` + banner pratinjau wajib konfirmasi di `CatatSheet` mode nyata (anti auto-simpan, prototipe tidak berubah), tes pgTAP/int/unit/e2e, Delivery Gate visual 18 PNG (`docs/design/s17-critique.md`), dan dokumentasi. **Merge = deploy + migrasi `0150` otomatis** tanpa langkah VM baru (API key opsional diisi di `web.env` saat ingin menyalakan bantuan LLM; tanpa kunci, parser aturan tetap berjalan 100%).
- **Bukti gerbang M6 (bagian S17):**
  - **Eval Set >= 90%:** `eval.test.ts` (60 kasus nyata Bahasa Indonesia: nominal, jenis, dompet dengan/tanpa `@` termasuk dompet berangka, tanggal relatif/absolut, kategori aktif ruang, kasus tolak/injeksi).
  - **Anti auto-simpan & kuota:** `parseFreeTextAction` 100% baca-saja pada `app.entries`; `s17.int.test.ts` memverifikasi 15/hari kuota parse + fallback aturan saat habis + failover Gemini → Claude; `e2e-ledger/zz-s17.spec` memverifikasi baris `app.entries` tidak bertambah sebelum klik `Simpan`.
  - **Privasi prompt (B13):** `provider.test.ts`, `s17.int.test.ts`, `e2e-bersama/zz-s17.spec` (`@B13`), dan `REGISTRY.md` diperbarui.
  - **Budget JS & prototipe:** `CatatSheet` dimuat malas → 0 byte tambahan pada cold-load rute (`/pribadi/beranda` & `/bersama/beranda` <= 162 kB); prototipe `budget.spec` 9/9 lulus.
- **Berikutnya:** **S18 (M6):** Analisis AI (memakai kuota `analysis` 5/hari yang sudah disiapkan di `0150_ai_kuota.sql` dan `LlmProvider` Claude/Gemini), PWA offline-baca, dan foto struk terenkripsi tanpa OCR (menunggu konfirmasi penyimpanan lampiran & kunci).

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
4. Model LLM dan target eval set M6: selesai S17 (`LlmProvider` Google Gemini `gemini-2.5-flash` & Anthropic Claude `claude-haiku-4-5-20251001` failover otomatis; Eval Set 60 kasus >= 90%, K4 menunggu konfirmasi pemilik).
5. Penyimpanan lampiran foto struk (bucket atau DB) dan kuncinya: selesai S18 (ciphertext AES-256-GCM `bytea` di `app.entry_attachments` dengan RLS FORCE + AAD terikat `(space_id, entry_id, attachment_id)` dan kunci `RECEIPT_ENCRYPTION_KEY` di `web.env`, 0 langkah VM baru, otomatis ikut backup WAL-G; K1–K4 menunggu konfirmasi pemilik).
6. Konflik: Spec §7a (self-hosted runner) sudah digantikan §9.2 dan §9.5 (pull-based, disetujui). Spec §6 (M8 Telegram) digantikan §9.6.
