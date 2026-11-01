# Runbook S4 sisi VM DB (persiapan)

Sisi kode S4 dikerjakan di sesi repo (branch `claude/m0b-s4-db`). Dokumen ini hanya mencatat langkah VM. Tanpa rahasia.

## Uji migrasi S4 di image produksi (2026-11-01)

`packages/db` dari `origin/claude/m0b-s4-db` (sampai `4c15512`) diterapkan ke Postgres sementara di VM DB:

- Image `dompetku-postgres:17.11-1` (sama dengan produksi), network Docker `internal` sementara, tanpa port host.
- `roles/00_roles.sql` identik dengan `/opt/dompetku/sql/00_roles.sql` yang dipakai produksi (tidak ada role baru di S4).
- `dbmate 2.36.0 --wait up` sebagai `dompetku_owner` (sama dengan deployer): `0001` sampai `0008` lulus, kode 0.
- Container, network, dan berkas sementara dihapus setelahnya; produksi tidak disentuh.

Artinya rilis S4 yang di-merge ke `main` bisa dimigrasikan deployer tanpa langkah superuser tambahan.

## Langkah VM setelah migrasi S4 ada di produksi

1. **[PEMILIK] `app.settings.owner_email`.** Tanpa baris ini pendaftaran tertutup untuk semua orang (`signup_closed`). Email pemilik (huruf kecil) dimasukkan agen setelah pemilik menyebutkannya di sesi; bukan rahasia, tetapi tidak ditebak.
2. **`env/web.env` untuk web yang memakai Postgres.** `DATABASE_URL` untuk `dompetku_web` (password dari `env/db-roles.env`, `sslmode=verify-full`, `sslrootcert` CA DompetKu yang dipasang read-only ke web), plus rahasia Better Auth. Nama variabel menunggu kode S4 sisi server; diisi di VM tanpa dicetak.
3. Setelah itu deploy berikutnya: smoke daftar dua akun, user ketiga ditolak (kriteria keluar S4).
