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
