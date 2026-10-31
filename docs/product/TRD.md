# TRD: Technical Requirements Document DompetKu v2

Status: draf untuk review tim (PM, backend, security, designer), lalu persetujuan pemilik. Tanggal: 2026-10-31.

Dokumen ini merangkum persyaratan teknis dari bahan yang sudah disetujui. Bila ada pertentangan, urutan yang berlaku:

1. Spec induk `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` §9 (keputusan tim, mengalahkan §1 sampai §8).
2. ADR di `docs/adr/` dan `docs/m0a-keputusan.md`.
3. Riset tim di `docs/team/round1` dan `docs/team/round2` (usulan, bukan keputusan, kecuali sudah masuk spec §9).

Nilai yang tidak ada di spec atau ADR ditandai **Belum diputuskan**. Nilai yang berasal dari riset tim tetapi belum disahkan ditandai **usulan** beserta sumbernya. Skema database, role, RLS, dan fungsi ada di `docs/product/BSD.md`.

## 1. Ruang lingkup

- Produk: aplikasi keuangan dua orang (Novanda, Farida) dengan ruang Pribadi per orang dan satu ruang Bersama (spec §1, §5.4).
- Bukan SaaS: tanpa pendaftaran terbuka, tanpa billing, batas keras 2 user (spec §2, §9.2).
- Self-hosted di OCI milik pemilik, domain publik `dompet.novandafadly.com` (spec §4.3, §8 usulan nama).
- Tidak ada migrasi data v1; semua ruang mulai kosong (spec §3, §7a).

## 2. Arsitektur

### 2.1 Topologi

Web dan worker berjalan di VM DB, bukan VM App, karena VM App sempit (spec §7a). VM App hanya memegang reverse proxy publik.

```mermaid
flowchart LR
  B["Browser / PWA"] -- "HTTPS 443" --> E["edge proxy<br/>VM App rtp-prod-app-01"]
  subgraph VMDB["VM DB rtp-prod-db-01 (10.0.1.68, privat)"]
    G["gw (Caddy)<br/>mTLS :8443 app, :9443 metrik"]
    W["web<br/>Next.js standalone, Node 24"]
    K["worker<br/>pg-boss"]
    P[("postgres-dompetku<br/>Postgres 17 + WAL-G<br/>network internal, tanpa port host")]
    D["deployer<br/>timer systemd"]
    R["restore-test<br/>timer systemd"]
    G --> W
    W --> P
    K --> P
    D -. "pull digest + verifikasi" .-> GH["GHCR (private)"]
    R -. "restore ke container sementara" .-> OS
  end
  E -- "mTLS, IP privat saja" --> G
  P -- "WAL + base backup terenkripsi" --> OS[("OCI Object Storage<br/>retention lock")]
  PR["Prometheus/Grafana<br/>(sudah ada di VM App)"] -- "mTLS :9443" --> G
  HC["Healthchecks.io<br/>dead-man"] -. "ping saat sukses" .- D
  HC -. "ping" .- R
```

### 2.2 Komponen

| Komponen            | Isi                                                                                                                                                           | Sumber                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| edge proxy (VM App) | Proxy yang sudah ada bila ada, bila tidak Caddy. TLS publik, HSTS, menimpa `X-Forwarded-For`/`X-Forwarded-Proto`/`Host`, membuang `x-middleware-subrequest`.  | spec §5.7, §9.2; security r2 B3 |
| `gw` (Caddy, VM DB) | Satu-satunya port yang dipublikasikan: `10.0.1.68:8443` (app) dan `:9443` (metrik), mTLS, hanya dari IP privat VM App.                                        | spec §9.2                       |
| `web`               | Next.js 16.4.3 `output: 'standalone'`, React 19.3.1, Node 24 LTS. RSC untuk baca, Server Actions untuk tulis. Akses DB hanya dari server lewat `pg` + Kysely. | ADR 0001; spec §5.1, §9.3       |
| `worker`            | Proses Node terpisah, pg-boss (antrean + cron di Postgres, tanpa Redis).                                                                                      | spec §5.5                       |
| `postgres-dompetku` | Postgres 17 + WAL-G dalam compose project `dompetku` sendiri, network Docker `internal`, tanpa port host, `scram-sha-256`, limit CPU/RAM.                     | spec §5.7, §9.2                 |
| deployer            | Timer systemd: tarik digest `main` terbaru dari GHCR (token read-only), verifikasi attestation, tolak digest lebih lama, jalankan `/opt/dompetku/bin/deploy`. | spec §9.2, §9.5                 |
| restore-test        | Timer systemd di host (bukan job pg-boss) untuk uji restore mingguan.                                                                                         | spec §9.2                       |
| OCI Object Storage  | Bucket backup, kunci Customer Secret khusus bucket tanpa izin hapus, retention lock.                                                                          | spec §5.7, §9.2                 |

### 2.3 Alur baca dan tulis

Setiap request terautentikasi berjalan dalam transaksi pendek `withUser`. `set_config('app.user_id', $1, true)` dijalankan sebelum query apa pun, dan RLS membaca nilai itu (spec §5.1, §9.1).

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser
  participant A as Server Action (web)
  participant DB as Postgres
  U->>A: Simpan (client_id dari sheet, spaceId, input)
  A->>A: requireUser(): tolak sesi pending_2fa / tanpa amr kuat
  A->>A: Zod parse input
  A->>DB: BEGIN; select set_config('app.user_id', uid, true)
  A->>DB: select api.create_entry(p_client_id => ..., ...)
  DB->>DB: SECURITY DEFINER (dompetku_api), RLS, idempotensi, lock akun, cek bentuk
  DB-->>A: jsonb {entry_id, version, replayed, warnings}
  A->>DB: COMMIT
  A-->>U: hasil + toast Urungkan (optimistic UI)
  Note over A,DB: Error DKxxx dipetakan ke pesan Indonesia. 40001/40P01 diulang maks 3x (aman karena idempoten).
```

Baca memakai RSC dengan loader per data, masing-masing satu transaksi `read only` pendek. Cache data Next dilarang untuk data user; halaman berdata memakai `Cache-Control: no-store` (spec §9.2).

### 2.4 Alur deploy

```mermaid
flowchart TD
  M["merge ke main"] --> CI["GitHub-hosted runner:<br/>lint, test, pgTAP, e2e, scan"]
  CI --> IMG["build image + SBOM + attestation<br/>push ke GHCR"]
  IMG --> T["timer systemd di VM DB<br/>baca digest main terbaru"]
  T --> V{"attestation valid<br/>dan digest lebih baru?"}
  V -- tidak --> X["tolak + alert"]
  V -- ya --> L["flock + pg_advisory_lock"]
  L --> PF["preflight: disk, backup segar, archive sehat"]
  PF --> RP["pg_create_restore_point"]
  RP --> MG["dbmate up (role owner, container migrate)"]
  MG --> UP["docker compose up -d web worker (by digest)"]
  UP --> H{"/api/health/ready OK?"}
  H -- ya --> OK["selesai, status ke metrik"]
  H -- tidak --> RB["rollback image ke digest sebelumnya<br/>(tanpa down-migration) + alert"]
```

Syarat rollback aman: migrasi maju-saja dengan pola expand/contract, dan job CI `compat-n-1` (image produksi saat ini terhadap skema baru) wajib hijau (spec §5.7, §9.1; round2 backend B1).

## 3. Persyaratan non-fungsional

### 3.1 Performa

| Persyaratan                                                  | Target                                                                                | Sumber / status                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| JS rute muat dingin `/pribadi/beranda`, `/pribadi/transaksi` | ≤ 162 kB gzip (hanya JS rute; prefetch dan muat malas dikecualikan)                   | ADR 0002; target 150 kB di M2 dibatalkan pemilik 2026-10-31 |
| Catat cepat                                                  | ≤ 3 ketukan (Catat, chip kategori, Simpan), median waktu catat ≤ 8 detik              | spec §1, §9.3                                               |
| Saldo semua akun pada fixture 50k entri per ruang            | p95 ≤ 20 ms; di atas itu baru boleh ada cache saldo (dengan tes rekonsiliasi dan ADR) | usulan round1 backend R7, job CI tidak memblokir            |
| `period_summary`                                             | p95 ≤ 50 ms pada data demo ×10; di atas itu baru boleh tabel agregat                  | usulan round1 data-engineer R3                              |
| Daftar transaksi                                             | paginasi kursor 50 baris                                                              | v1 DESIGN §10, m0a-keputusan T10                            |
| Latensi server (TTFB, Server Action)                         | **Belum diputuskan**: spec tidak menetapkan angka p95                                 | celah, lihat Pertanyaan terbuka                             |
| Web Vitals (LCP, INP, CLS)                                   | **Belum diputuskan**: hanya prinsip "tanpa kerja berat di handler ketik"              | `docs/spec/frontend.md`                                     |

### 3.2 Ketersediaan

- Satu host tanpa HA. Target SLO **Belum diputuskan**; usulan 99,5% per bulan (round1 devops R12).
- Deploy otomatis dengan rollback otomatis ke digest sebelumnya bila health check gagal (spec §9.2).
- Dua endpoint kesehatan tanpa data pribadi: `/api/health/live` (proses hidup) dan `/api/health/ready` (DB bisa di-query, versi migrasi cocok, pg-boss terhubung). Usulan round1 devops §6.
- Dead-man di luar VM App: cek jalur publik tiap 5 menit dan ping Healthchecks.io (usulan round1 devops R10; Healthchecks.io disebut di spec §9.2).
- Limit memori/CPU per container agar tidak mengganggu app lain di VM yang sama (spec §5.7). Angka usulan: total DompetKu ≤ 1,7 vCPU dan ≤ 3,6 GiB di VM DB (round1 devops R4), **Belum diputuskan**.

### 3.3 Backup, RPO, RTO

| Butir                                          | Nilai                                                                                                              | Sumber                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| RPO                                            | ≤ 5 menit                                                                                                          | spec §5.7, §9.2                            |
| RTO                                            | ≤ 1 jam; ≤ 3 jam bila VM DB hilang, sampai provisioning dilatih                                                    | spec §9.2                                  |
| Mekanisme                                      | WAL-G: base backup harian + WAL archiving kontinu, `archive_timeout=300`                                           | spec §5.7, §9.2                            |
| Enkripsi                                       | sisi klien; kunci di password manager pemilik; runbook memuat verifikasi                                           | spec §7a, §9.2                             |
| Penyimpanan                                    | OCI Object Storage, bucket dengan retention lock, kredensial tanpa izin hapus                                      | spec §9.2                                  |
| Retensi                                        | 30 hari + bulanan 12 bulan                                                                                         | spec §5.7                                  |
| Uji restore                                    | mingguan, timer host, restore ke container sementara + pgTAP rekonsiliasi; gagal = alert; dead-man Healthchecks.io | spec §5.7, §9.2                            |
| Latihan PITR                                   | bulanan, durasi dicatat sebagai bukti RTO                                                                          | spec §9.2                                  |
| Sebelum migrasi                                | `pg_create_restore_point`                                                                                          | round2 backend B1                          |
| Jam base backup dan uji restore                | usulan 02:15 WIB harian dan Minggu 03:30 WIB                                                                       | round1 devops R8, R9; **Belum diputuskan** |
| Jalur kedua independen (`pg_dump` terenkripsi) | sebaiknya, **Belum diputuskan**                                                                                    | round1 devops R8                           |

Data entri yang dipurge setelah 90 hari masih ada di backup sampai 12 bulan. UI wajib menyebut hal ini (round2 backend A9).

### 3.4 Keamanan

**Autentikasi (Better Auth, tabel di skema `auth`)**

- Faktor kuat wajib: passkey ATAU password + TOTP. Ditegakkan di `requireUser`/`withUser`, bukan di middleware. Sesi `pending_2fa` ditolak; metode autentikasi disimpan di field sesi `amr` lewat hook (spec §9.2; round2 backend B5).
- Kode pemulihan wajib saat daftar. Usulan: 10 kode, di-hash, sekali pakai (round2 security B5).
- Tambah/hapus faktor wajib step-up (≤ 10 menit); faktor kuat terakhir tidak bisa dihapus (round2 security B5, usulan).
- Reset password mencabut semua sesi dan tidak mematikan 2FA (spec §9.2).
- Pendaftaran tertutup: allowlist `AUTH_ALLOWED_EMAILS`, akun pemilik dibuat lewat CLI, pasangan lewat undangan (spec §5.3).
- Undangan: token di-hash, sekali pakai, kedaluwarsa 72 jam, batas keras 2 user di DB (spec §9.2; round2 security B5). Detail di BSD §7.
- Respons login/reset seragam; rate limit per IP + per akun dengan penyimpanan di DB; lockout bertahap (spec §9.2). Ambang usulan: 5 gagal jeda 1 menit, 10 gagal 15 menit, 20 gagal kunci + email (round1 security R4), **Belum diputuskan**.
- Cookie sesi `HttpOnly; Secure; SameSite=Lax` (spec §5.3), prefix `__Host-` (usulan). Durasi sesi **Belum diputuskan**; usulan idle 7 hari, absolut 30 hari (round1 security R4).
- Panjang password minimum: 12 karakter di prototipe, bisa berubah saat kebijakan Better Auth ditetapkan (m0a-keputusan).
- ID user Better Auth bertipe UUID (`generateId`), bukan `text`, supaya FK domain bertipe `uuid` (round2 backend §2.1).
- Rahasia TOTP terenkripsi; `dompetku_worker` tanpa akses ke skema `auth` (round2 security §2.7).

**Aplikasi dan header**

- Server Actions diperlakukan sebagai endpoint publik: `requireUser()`, Zod, lalu `withUser`. Origin check sendiri untuk `/api/*` (spec §9.2).
- CSP nonce dengan `strict-dynamic`, HSTS, `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy (spec §5.7; round1 security R7).
- `Cache-Control: no-store` untuk halaman berdata; cache data Next dilarang untuk data user (spec §9.2).
- Ruang aktif di URL (`/pribadi/...`, `/bersama/...`); action menerima `spaceId` eksplisit sebagai selektor, bukan izin. DB menurunkan ruang dari akun dan menolak bila tidak cocok (spec §9.2; round2 backend C2).
- Header forward hanya dipercaya dari `gw` (spec §9.2).
- Lint melarang `SET` sesi, `set_config(..., false)`, `sql.raw`, `current_date`, dan `dangerouslySetInnerHTML` (spec §9.1; round1 security R5, R7).

**Database**: lima role (`dompetku_owner`, `dompetku_api`, `dompetku_web`, `dompetku_worker`, `dompetku_auditor`), `FORCE ROW LEVEL SECURITY`, `REVOKE EXECUTE ... FROM PUBLIC`. Detail di BSD §3 dan §10.

**Secrets**

- Per file di VM (`chmod 600`) dan GitHub Environments; tidak ada di repo; `.env.example` tanpa nilai (spec §5.7, §9.2). Security mengusulkan `0400` per service (round2 security §2.5), **Belum diputuskan**.
- Validasi Zod saat start; container gagal jalan bila secret hilang (usulan round1 security R10).
- Rotasi tahunan dan saat insiden (usulan round1 security R10).

**Audit log** append-only untuk login, 2FA, ekspor, undangan, sesi dicabut, pindah ruang, akses DB manual, purge, deploy (spec §9.2, §9.5). Retensi usulan 1 tahun (round1 security R12). Detail tabel di BSD §6.

**Rantai pasok**: gitleaks, Semgrep OSS, osv-scanner, Trivy, actionlint + zizmor; Actions dipatok SHA; `pnpm` `minimumReleaseAge` 3 hari; Renovate; patch critical ≤ 48 jam (spec §9.2; ADR 0001).

**Host**: `unattended-upgrades`, SSH key-only, MFA di GitHub dan OCI (sudah aktif, spec §9.5), `chrony` untuk TOTP (usulan round1 security R4).

### 3.5 Privasi antar ruang

Anti-tujuan: data Pribadi pasangan terlihat lewat jalur apa pun (laporan, ekspor, AI, log) (spec §2).

- RLS per tabel: baris terlihat hanya bila `app.current_user_id()` anggota `space_id`-nya. Ruang Pribadi hanya beranggota pemiliknya (spec §5.4).
- Transfer antar ruang = dua entri `space_transfer` terikat `link_id`. Kaki tujuan tanpa deskripsi; catatan ke Bersama hanya lewat `shared_note` eksplisit; ruang tujuan tidak melihat nama dompet sumber (spec §9.1). Ditegakkan oleh CHECK di DB (BSD §5).
- "Tidak ada" dan "bukan milikmu" memakai kode yang sama, `DK404` (round2 security A1).
- Fungsi baca dan view = `SECURITY INVOKER`, sehingga laporan, ekspor, dan AI ikut RLS (spec §9.1).
- Log tanpa nominal, deskripsi, atau email; payload job hanya id; metrik tanpa label ber-PII (spec §5.7, §9.2).
- `product_events` tanpa nominal/deskripsi (spec §9.3).
- AI (M6): hanya agregat ruang aktif (round1 security R9).
- Admin server bisa melihat data (diterima pemilik, spec §9.5); akses DB manual tercatat di audit log. Halaman onboarding Farida menyatakan hal ini (round2 PM §2.1, usulan).

### 3.6 Waktu dan tanggal

- Semua tanggal kalender = WIB (`Asia/Jakarta`). Server Postgres `timezone=UTC`; fungsi memakai `app.today()`/`app.now()` (BSD §4).
- Override jam hanya di env dev/test (spec §9.1).
- Driver `pg`: `date` (OID 1082) jadi string `YYYY-MM-DD`, `int8` jadi `number` dengan assert `Number.isSafeInteger`, `numeric` jadi string (spec §9.1; round2 backend A7).
- Klien memakai `todayWIB()` di `packages/domain`.

### 3.7 Observabilitas

- Log: pino JSON dengan `redact`, `request_id` dari web sampai DB. Postgres: `log_parameter_max_length=0`, `log_parameter_max_length_on_error=0`, `auto_explain` mati (spec §5.7; round2 backend §2.3).
- Metrik: `postgres_exporter` + metrik app ke Prometheus/Grafana yang sudah ada di VM App lewat `gw:9443` (spec §5.7, §9.2). Label rute ter-template (usulan round1 devops §6).
- Alert ke email pemilik (spec §7a): app down, backup gagal, job gagal, disk > 80%, error rate (spec §5.7); anomali audit (spec §9.2). Usulan tambahan: umur arsip WAL > 15 menit, `pg_wal` > 2 GiB, sertifikat mTLS < 30 hari (round1 devops §3).
- `dq_reconcile` 01:00 WIB, 10 cek, alert tanpa nominal (spec §9.1). BSD §9 mengimplementasikan 6 cek pertama.
- Error tracking: GlitchTip atau log + alert, **Belum diputuskan** (spec §8, keputusan builder).

### 3.8 Job terjadwal

| Job                                                | Jadwal (WIB)          | Tempat     | Sumber                                 |
| -------------------------------------------------- | --------------------- | ---------- | -------------------------------------- |
| `recurring_materialize` (`jobs.materialize_bills`) | 00:05                 | worker     | spec §5.5                              |
| `net_worth_snapshot` (untuk H−1, plus hari kotor)  | 00:10                 | worker     | spec §9.1 (menggantikan 23:55 di §5.5) |
| `dq_reconcile`                                     | 01:00                 | worker     | spec §9.1                              |
| `purge_voided`                                     | mingguan              | worker     | spec §5.5                              |
| `purge_idempotency` (kunci > 30 hari)              | **Belum diputuskan**  | worker     | round2 backend A6                      |
| uji restore (`backup_verify`)                      | mingguan              | timer host | spec §9.2                              |
| `price_refresh`                                    | 16:30 hari bursa (M4) | worker     | spec §5.5                              |

Semua job idempoten, status di `jobs.job_runs`, gagal = alert (spec §5.5).

## 4. Strategi pengujian

| Lapisan        | Alat                                                              | Cakupan wajib                                                                                                                                             |
| -------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit           | Vitest + fast-check                                               | `packages/domain` (uang, tanggal WIB), parser nominal "35rb/35k/1,5jt", peta error DK, selector                                                           |
| Komponen       | Vitest + Testing Library + happy-dom                              | MoneyInput, sheet Catat (client_id tetap saat retry), combobox keyboard                                                                                   |
| Database       | pgTAP + `pg_prove`, dijalankan sebagai role app (bukan superuser) | daftar lengkap di BSD §12: katalog, isolasi dua user × tabel × operasi, bentuk lines, pasangan `space_transfer`, idempotensi, versi, kewajiban XOR, purge |
| Integrasi DB   | Vitest dengan dua koneksi                                         | konkurensi: kunci idempotensi paralel, DK409, transfer A→B ∥ B→A, arsip ∥ catat (pgTAP tidak bisa menguji ini)                                            |
| Properti SQL   | pgTAP `setseed` + 1.000 operasi acak                              | saldo view = Σ ulang, transfer Σ = −fee, pasangan konsisten, version = jumlah history                                                                     |
| Golden numbers | fixture kecil + `golden.json` dihitung manual                     | laporan M2 termasuk fee, kantor, talangan, `space_transfer`                                                                                               |
| E2E            | Playwright desktop + mobile                                       | alur utama, budget JS 162 kB, keamanan (header, origin, sesi), smoke pasca-deploy                                                                         |
| Aksesibilitas  | `@axe-core/playwright`                                            | pelanggaran serious/critical = 0 (m0a-keputusan T11)                                                                                                      |
| Restore        | timer host mingguan                                               | restore + rekonsiliasi lulus, selisih commit terakhir ≤ RPO                                                                                               |

Saat ini (M0a) ada 215 tes e2e dan unit di `packages/domain`, `packages/demo-data`, `apps/web`.

## 5. Gerbang CI

Sudah ada di `.github/workflows/ci.yml`: lint, format, typecheck, unit, build, e2e Playwright, gitleaks, osv-scanner, actionlint; Actions dipatok SHA; `permissions` minimal.

Wajib ditambahkan di M0b (spec §5.7, §9.1, §9.2):

1. Postgres 17 service, `dbmate up`, pgTAP via `pg_prove`.
2. `kysely-codegen` dan diff `schema.sql`; build gagal bila berbeda.
3. `compat-n-1`: image produksi saat ini terhadap migrasi baru + smoke.
4. Semgrep OSS, Trivy, zizmor.
5. Build image, SBOM, attestation, push GHCR hanya dari `main`.
6. Lint larangan: `SET` sesi, `set_config(..., false)`, `sql.raw`, `current_date`/`localtimestamp`, DML langsung ke `app.*` dari `apps/**`.
7. CODEOWNERS untuk `db/migrations/`, `.github/`, `infra/` (round2 security B1).

Gerbang lokal sebelum push (CLAUDE.md): `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`, `pnpm build`, e2e.

## 6. Konflik dan celah terhadap spec

| #   | Hal                                                                               | Penanganan di TRD                                                |
| --- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | §5.3 menulis TOTP wajib untuk kedua akun; §9.2 menulis passkey ATAU password+TOTP | Mengikuti §9.2 (mengalahkan §5.3). Dicatat di Pertanyaan terbuka |
| 2   | §5.2 tiga role (`dompetku_app`, `dompetku_readonly`)                              | Digantikan lima role §9.1                                        |
| 3   | §5.7 port Postgres 5437 dan TLS app→DB                                            | Digantikan §9.2: tanpa port host; mTLS di hop proxy→`gw`         |
| 4   | §5.5 `backup_verify` di pg-boss, snapshot 23:55                                   | Digantikan §9.2 (timer host) dan §9.1 (00:10 untuk H−1)          |
| 5   | §5.7 CD lewat SSH, §7a self-hosted runner                                         | Digantikan deployer pull-based §9.2 (disetujui §9.5)             |
| 6   | Target latensi server                                                             | Tidak ada di spec; ditandai Belum diputuskan                     |

## 7. Pertanyaan terbuka

1. Konflik faktor kuat: konfirmasi §9.2 (passkey ATAU password+TOTP) mengalahkan §5.3 (TOTP wajib). Bila TOTP tetap wajib bagi pemakai passkey, onboarding Farida bertambah satu langkah.
2. Target latensi p95 untuk TTFB halaman dan Server Action, serta target LCP/INP. Usul: ukur dulu di M1 dengan data nyata, lalu tetapkan.
3. SLO ketersediaan: terima 99,5% per bulan (usulan devops)?
4. Durasi sesi (idle/absolut) dan ambang lockout: terima angka usulan security?
5. Timeout per role: round2 backend mengusulkan `statement_timeout=5s`, `lock_timeout=3s`, `idle_in_transaction_session_timeout=15s`; round1 security mengusulkan 15 s dan 30 s. BSD memakai angka backend.
6. Izin file secret: `chmod 600` (spec) atau `0400` per service (security)?
7. Error tracking: GlitchTip atau log + alert?
8. Penyedia email transaksional dan alert (usulan: Resend) dan akun Healthchecks.io.
9. Jam base backup harian dan uji restore mingguan; jalur kedua `pg_dump` terenkripsi ke luar OCI.
10. Anggaran sumber daya container di VM DB (usulan ≤ 1,7 vCPU, ≤ 3,6 GiB).
11. Approval manual per deploy di GitHub Environment `production`, atau otomatis setelah CI hijau?
12. Hasil `uname -m` kedua VM (spec §9.5 butir 1) untuk build image satu arsitektur.
