# Pengecualian pemindai keamanan CI

Setiap pengecualian punya alasan, cakupan sesempit mungkin, dan (bila alatnya mendukung) tanggal kedaluwarsa. Tinjau berkas ini saat tanggal lewat atau saat dependensi terkait naik versi.

## osv-scanner (`osv-scanner.toml`)

| ID                    | Paket                                | Kedaluwarsa | Alasan                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GHSA-g3hv-75wg-m249` | `minimatch` 3.1.5, 10.2.6 (dev saja) | 2026-11-30  | Hanya lewat `eslint`, `@eslint/*`, dan `@typescript-eslint/typescript-estree` (tidak ada di dependensi produksi, `pnpm why -r minimatch --prod` kosong; tidak masuk image). Perbaikan hanya di 11.0.1, rilis 2026-10-27: belum lolos `minimumReleaseAge` 7 hari dan versi mayor (belum diuji dengan konsumen 3.x/10.x); tidak ada backport 3.x/10.x. Pola glob berasal dari konfigurasi repo, bukan masukan pengguna. |

Saat kedaluwarsa: cek apakah ESLint/typescript-eslint sudah memakai minimatch yang diperbaiki; bila belum, uji `overrides` ke 11.x (`pnpm lint`) atau perpanjang paling lama 30 hari dengan alasan baru.

`handlebars` 4.7.8 (dev, lewat `eslint-plugin-boundaries`) diperbaiki dengan `overrides: handlebars: ^4.7.10` di `pnpm-workspace.yaml`, bukan dikecualikan.

## Trivy (`.trivyignore.yaml`, job `image`)

| ID               | Paket                                     | Kedaluwarsa | Alasan                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CVE-2026-76844` | `zlib1g` 1:1.3.dfsg+really1.3.1-1+b1 (OS) | 2026-11-21  | Ada di image dasar `gcr.io/distroless/nodejs24-debian13:nonroot`, bukan dependensi kita. Debian sudah merilis `+deb13u1`, tetapi build distroless terbaru (digest `b8cec4b…`, 2026-11-07) belum memuatnya; tidak bisa di-`apt` di distroless. Aplikasi tidak memanggil zlib sistem langsung (Node membawa zlib sendiri, dugaan belum dibuktikan). Persetujuan pemilik 2026-11-07. |
| `CVE-2026-85091` | `zlib1g` (sama)                           | 2026-11-21  | Sama; cacat di `gz_vacate()` (API file gzip), tidak dipakai aplikasi.                                                                                                                                                                                                                                                                                                             |

Saat distroless rilis build dengan `zlib1g` `+deb13u1`: naikkan digest di `apps/web/Dockerfile`, hapus kedua entri. Bila tanggal lewat tanpa rebuild: pertimbangkan base image lain atau perpanjang paling lama 14 hari dengan alasan baru dan persetujuan pemilik.

## Semgrep (`.semgrepignore`)

- `docs/design/panel-malam/designs/support.js`: runtime pratinjau dari handoff Claude Design (kode pihak ketiga), hanya dimuat berkas `*.dc.html` di folder yang sama saat dibuka lokal. Tidak diimpor `apps/web`, tidak dibundel, tidak dideploy. Temuannya (`postMessage` ke `*`, `console.log` dengan string gabungan, prototype pollution loop) relevan untuk aplikasi web yang berjalan, bukan berkas referensi desain.
- Sisa isi `.semgrepignore` adalah salinan bawaan Semgrep (berkas ini menggantikan bawaan), termasuk `test/` dan `tests/`.

Tidak ada komentar `nosemgrep` di kode. Temuan `react-dangerouslysetinnerhtml` di `apps/web/src/components/ui/icon.tsx` diperbaiki dengan merender `<path d>` langsung.

## gitleaks: kredensial tiruan di tes auth

`.gitleaks.toml` memakai aturan bawaan dan hanya mengecualikan `apps/web/src/server/auth/__int__/` dan `apps/web/tests/e2e-auth/`. Berkas itu memuat kata sandi dan secret contoh untuk Postgres sekali pakai di tes integrasi dan e2e auth; nilai produksi selalu dari env di VM. Pengecualian berbasis path (bukan komentar inline) karena gitleaks memindai seluruh commit PR, termasuk commit lama.

## Dependensi worker yang dibundel (review keamanan S7 L3)

Keputusan pemilik 2026-11-04: **opsi B**. Worker tetap dibundel esbuild ke `/app/worker/worker.mjs` (image web yang sama). Di image tidak ada `package.json`/`node_modules` untuk `pg`, `pg-boss`, `zod` dan dependensi transitifnya, sehingga SBOM yang diattest dan Trivy (rilis dan CI) tidak melihatnya.

Kontrol pengganti:

- osv-scanner atas `pnpm-lock.yaml` di job `security` setiap PR dan push ke `main` (`ci.yml`).
- osv-scanner mingguan atas lockfile `main` (`.github/workflows/osv-mingguan.yml`, Senin 02:37 UTC = 09:37 WIB, juga `workflow_dispatch`): action dan SHA sama dengan `ci.yml`, `contents: read`, tanpa secret. Pengecualian tetap dari `osv-scanner.toml` (tabel di atas).

Notifikasi kegagalan **belum terverifikasi**. Menurut dokumentasi GitHub, notifikasi run terjadwal dikirim ke user yang terakhir mengubah sintaks cron di workflow, jadi penerimanya bergantung pada akun yang mem-push/merge berkas ini dan setelan notifikasi Actions akun itu. Langkah pemilik sesudah merge:

1. Actions → "osv-scanner mingguan" → Run workflow (`workflow_dispatch`) sekali; pastikan run selesai dan actor-nya akun pemilik.
2. Cek Settings → Notifications → Actions: "Notify on failed workflows" aktif dengan email.
3. Bukti email sampai: belum ada cara murah memaksa run gagal tanpa mengubah lockfile `main`; anggap terverifikasi baru setelah run gagal pertama benar-benar menghasilkan email (cek tab Actions bila ragu).

Risiko sisa yang diterima: CVE yang belum punya entri OSV, dan kode yang tidak berasal dari lockfile (mis. disalin ke bundel). Bila temuan mingguan muncul: naikkan versi di lockfile lewat PR biasa (rilis = image baru), atau catat pengecualian bertanggal di tabel osv-scanner.

## Image OpenWA (Catat via WhatsApp)

`openwa` di `infra/db-vm/compose.yml` memakai image pihak ketiga `ghcr.io/rmyndharis/openwa:0.27.1@sha256:1a2d0c39…af9068` (indeks multi-arch, varian `linux/arm64` dipakai VM). Image ini tidak dibangun repo ini, jadi tidak tercakup Trivy job `image`/release (hanya `dompetku-web`) maupun osv-scanner (hanya `pnpm-lock.yaml`). Spec §6 dipenuhi dengan pemindaian image tersendiri:

- **Workflow `.github/workflows/openwa-image.yml`** (Trivy, image `ghcr.io/aquasecurity/trivy@sha256:790fd66d…` yang sama dengan `ci.yml`/`release.yml`, satu versi Trivy di repo): Senin 02:43 UTC = 09:43 WIB, `workflow_dispatch`, dan setiap PR yang mengubah `infra/db-vm/compose.yml`, `.trivyignore-openwa.yaml`, atau workflow itu. `--platform linux/arm64 --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --scanners vuln`; tabel temuan di ringkasan run. `contents: read`, tanpa secret (image publik), `concurrency` per ref, batas 15 menit.
- **Satu sumber pin:** referensi dibaca dari baris `image:` layanan `openwa` di `compose.yml` (harus tepat satu, bentuk `ghcr.io/rmyndharis/openwa:X.Y.Z@sha256:<64 hex>`, selain itu job gagal). Naik versi di `compose.yml` otomatis memicu pemindaian di PR-nya.
- **Pengecualian:** `.trivyignore-openwa.yaml` (terpisah dari `.trivyignore.yaml` image web), berisi 21 entri bertanggal (tabel di bawah, kedaluwarsa 2026-11-21). Entri baru wajib `purls`, `expired_at` paling lama 30 hari, alasan, dan persetujuan pemilik, dicatat di tabel di bawah. Perbaikan yang benar untuk CVE image pihak ketiga = naik versi OpenWA, bukan pengecualian.
- Image `arm64` memuat paket Chromium Debian yang tidak dipakai engine Baileys (`ENGINE_TYPE: baileys` dipatok di compose; env compose menang atas pengaturan dasbor; Chromium hanya diluncurkan adapter whatsapp-web.js). Langkah workflow "Premis pengecualian" menggagalkan job kecuali layanan `openwa` punya tepat satu baris `ENGINE_TYPE: baileys`, karena pengecualian di bawah bergantung padanya. Tidak ada pengecualian per paket tanpa tanggal (`--skip-dirs` tidak berpengaruh: Trivy membaca dpkg).
- Run pertama (2026-11-10, Trivy 0.76.1) merah pada `0.27.1`: 62 temuan HIGH, 0 CRITICAL, semuanya sudah ada perbaikan = 21 CVE (20 Chromium x 3 paket + apt x 2), semuanya diperbaiki di `0.28.0`+. Diperiksa ulang lokal: tanpa berkas pengecualian 62 temuan (exit 1), dengan berkas exit 0. Notifikasi kegagalan jadwal: sama dengan osv-scanner mingguan (bagian di bawah, belum terverifikasi).

| ID                                                  | Paket                                                     | Kedaluwarsa | Alasan                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CVE-2026-76024..76031, CVE-2026-119260..119271 (20) | chromium, chromium-common, chromium-sandbox 156.0.8078.73 | 2026-11-21  | Hanya engine whatsapp-web.js; `ENGINE_TYPE: baileys` dipatok dan dijaga workflow; Chromium tidak pernah diluncurkan; setuid sandbox dinetralkan `no-new-privileges`, uid 997, `read_only`, `cap_drop: ALL`. Gugur saat naik ke 0.29.1 (>= 2026-11-14 18:52 WIB). Persetujuan: disetujui pemilik lewat delegasi 2026-11-10 ("kerjain aja best practices dan terbaik dari sisi keamanan"); keputusan terbuka untuk dicabut. |
| CVE-2026-109518                                     | apt, libapt-pkg6.0 2.6.1                                  | 2026-11-21  | apt hanya saat build; runtime uid 997, rootfs read-only, `cap_drop: ALL`. Gugur saat naik ke 0.29.1. Persetujuan: disetujui pemilik lewat delegasi 2026-11-10 ("kerjain aja best practices dan terbaik dari sisi keamanan"); keputusan terbuka untuk dicabut.                                                                                                                                                             |

**Umur rilis dan naik versi.** Image dipatok ke rilis terbaru yang berumur paling sedikit 7 hari saat dipatok (sama dengan `minimumReleaseAge` di `renovate.json` dan pnpm). 2026-11-10: `0.30.0` (2026-11-10, belum memenuhi 7 hari sampai 2026-11-17), `0.29.1` (2026-11-07, memenuhi 7 hari pada 2026-11-14 18:52 WIB) dan `0.28.0`/`0.29.0` (2026-11-06) belum 7 hari; `0.27.1` (tag `v0.27.1` 2026-11-02, CHANGELOG 2026-11-02) dipilih. Fitur yang dipakai runbook ada di `0.27.1` (diperiksa di sumber tag: `RESOLVE_LID_TO_PHONE`, key `operator` dengan `allowedSessions`/`allowedIps`, `AUTO_START_SESSIONS`, `WEBHOOK_SSRF_PROTECT`/`SSRF_ALLOWED_HOSTS`, `WEBHOOK_TIMEOUT`, `MESSAGE_RETENTION_DAYS`, `UPDATE_CHECK_ENABLED`, `ENABLE_SWAGGER`, `CSP_UPGRADE_INSECURE_REQUESTS`, `POST /pairing-code`, `/api/health/ready`, uid 997, `docker-entrypoint.sh` identik dengan `0.29.1`, tanda tangan `X-OpenWA-Signature` dan `senderPhone` sama).

`renovate.json` punya aturan untuk `ghcr.io/rmyndharis/openwa` (manager `docker-compose` bawaan `config:recommended`, `minimumReleaseAge` 7 hari, tanpa automerge). Apakah Renovate terpasang di repo dan mendapat tanggal rilis dari GHCR **belum terverifikasi**; prosedur manual tetap berlaku:

1. Pilih tag rilis `X.Y.Z` yang berumur >= 7 hari: tanggal tag git `vX.Y.Z` (`git for-each-ref refs/tags/vX.Y.Z --format '%(creatordate:iso)'` di klon `github.com/rmyndharis/OpenWA`) dan entri `CHANGELOG.md`. Baca bagian "Upgrade notes" semua versi di antaranya.
2. Ambil digest indeks multi-arch tag itu dari GHCR (bukan digest per arsitektur): `docker buildx imagetools inspect ghcr.io/rmyndharis/openwa:X.Y.Z` (baris `Digest:`, platform `linux/arm64` harus ada).
3. Cek ulang di sumber tag: `Dockerfile` (uid 997, `HEALTHCHECK`), `docker-entrypoint.sh` (mode non-root), dan variabel env yang dipatok di `compose.yml`.
4. PR yang mengganti tag dan digest bersamaan di `compose.yml` (komentar versi + tanggal ikut diubah); workflow `openwa-image.yml` memindainya di PR itu. Pasang di VM: runbook-wa "Naik versi OpenWA".

Kontrol lain: digest dipatok (tidak mengambang), container dikurung (`cap_drop: ALL`, user 997, read-only, tanpa port host, hanya network `wa` ke `wa-proxy` dan `wa_egress` ke internet dengan IMDS/VCN/jaringan privat/port host diblokir `firewall.sh`; `docs/ops/runbook-wa.md`). Proyek OpenWA sendiri menjalankan Trivy pada image rilis dan terjadwal (CHANGELOG 0.28.0); hasilnya tidak kita terima, jadi tidak diandalkan.
