# Pengecualian pemindai keamanan CI

Setiap pengecualian punya alasan, cakupan sesempit mungkin, dan (bila alatnya mendukung) tanggal kedaluwarsa. Tinjau berkas ini saat tanggal lewat atau saat dependensi terkait naik versi.

## osv-scanner (`osv-scanner.toml`)

| ID                    | Paket                                | Kedaluwarsa | Alasan                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GHSA-g3hv-75wg-m249` | `minimatch` 3.1.5, 10.2.6 (dev saja) | 2026-11-30  | Hanya lewat `eslint`, `@eslint/*`, dan `@typescript-eslint/typescript-estree` (tidak ada di dependensi produksi, `pnpm why -r minimatch --prod` kosong; tidak masuk image). Perbaikan hanya di 11.0.1, rilis 2026-10-27: belum lolos `minimumReleaseAge` 7 hari dan versi mayor (belum diuji dengan konsumen 3.x/10.x); tidak ada backport 3.x/10.x. Pola glob berasal dari konfigurasi repo, bukan masukan pengguna. |

Saat kedaluwarsa: cek apakah ESLint/typescript-eslint sudah memakai minimatch yang diperbaiki; bila belum, uji `overrides` ke 11.x (`pnpm lint`) atau perpanjang paling lama 30 hari dengan alasan baru.

`handlebars` 4.7.8 (dev, lewat `eslint-plugin-boundaries`) diperbaiki dengan `overrides: handlebars: ^4.7.10` di `pnpm-workspace.yaml`, bukan dikecualikan.

## Semgrep (`.semgrepignore`)

- `docs/design/panel-malam/designs/support.js`: runtime pratinjau dari handoff Claude Design (kode pihak ketiga), hanya dimuat berkas `*.dc.html` di folder yang sama saat dibuka lokal. Tidak diimpor `apps/web`, tidak dibundel, tidak dideploy. Temuannya (`postMessage` ke `*`, `console.log` dengan string gabungan, prototype pollution loop) relevan untuk aplikasi web yang berjalan, bukan berkas referensi desain.
- Sisa isi `.semgrepignore` adalah salinan bawaan Semgrep (berkas ini menggantikan bawaan), termasuk `test/` dan `tests/`.

Tidak ada komentar `nosemgrep` di kode. Temuan `react-dangerouslysetinnerhtml` di `apps/web/src/components/ui/icon.tsx` diperbaiki dengan merender `<path d>` langsung.

## gitleaks: kredensial tiruan di tes auth

`.gitleaks.toml` memakai aturan bawaan dan hanya mengecualikan `apps/web/src/server/auth/__int__/` dan `apps/web/tests/e2e-auth/`. Berkas itu memuat kata sandi dan secret contoh untuk Postgres sekali pakai di tes integrasi dan e2e auth; nilai produksi selalu dari env di VM. Pengecualian berbasis path (bukan komentar inline) karena gitleaks memindai seluruh commit PR, termasuk commit lama.
