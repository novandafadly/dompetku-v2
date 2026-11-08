# Konteks bersama untuk setiap subagent S9

## Lingkungan
- Repo: /home/user/dompetku-v2, branch `claude/bold-pasteur-535stf` (sudah checkout; berisi Task 1–5 S9 dari branch `ccr-cbaaa067-1gjv4p`). Jangan pindah branch, jangan push (controller yang push).
- Deps sudah terpasang (`pnpm install` selesai). Paket baru: `pnpm add` dengan versi persis; `minimumReleaseAge` 7 hari berlaku.
- Postgres lokal PG16 sekali pakai, trust. Reset penuh (roles + dbmate up + setup pgTAP):
  `bash docs/superpowers/handoff/db-reset-lokal.sh` (cluster 5432, `/tmp/pgdata-dk`). Bila brief menyebut cluster kedua: `PGPORT_DK=5433 PGDATA_DK=/tmp/pgdata-dk2 bash docs/superpowers/handoff/db-reset-lokal.sh` dan pakai `-p 5433` / port 5433 di semua perintah. Jangan menyentuh cluster yang bukan milikmu (subagent lain bisa sedang memakainya). Bila container restart: hapus `postmaster.pid` di data dir dulu.
  - pgTAP: `pg_prove -h 127.0.0.1 [-p 5433] -U dompetku_test -d dompetku packages/db/tests/*.sql` (dompetku_test bukan superuser; helper superuser ada di `packages/db/tests/support/setup.sql`). Lokal PG16, CI PG17.11.
  - test:int: `TEST_DATABASE_URL='postgres://dompetku_web@127.0.0.1:5432/dompetku' TEST_DATABASE_ADMIN_URL='postgres://postgres@127.0.0.1:5432/dompetku' pnpm --filter @dompetku/web test:int` (ganti port bila cluster kedua).
  - Worker int: lihat `apps/worker/package.json` dan job CI `auth` di `.github/workflows/ci.yml`.
  - `e2e:auth` / `e2e:ledger` / `e2e:bersama`: lihat skrip di `apps/web/package.json` dan job CI `auth`.
- e2e prototipe: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e` (port 3100 harus bebas: `pgrep -fa server.js`; tidak ada proses Playwright lain: `pgrep -f playwright`).
- Gerbang sebelum melapor DONE (yang relevan dengan task): `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`, `pnpm build`, e2e; task DB: pg_prove seluruh suite + rollback/up (`update app.settings set value='dev' where key='env'`, `dbmate rollback` lalu `up`, lalu **kembalikan** `update app.settings set value='prod' where key='env'`; tanpa langkah terakhir `00_katalog` tes 29 gagal); task server/UI nyata: test:int + e2e:ledger.
- Catatan lingkungan (sesi S9, 2026-11-08): biner `dbmate` asli tidak bisa diunduh di sandbox ini; dipakai pengganti lokal di luar repo yang menjalankan bagian `-- migrate:up`/`-- migrate:down` berkas migrasi lewat `psql` dan mencatat `schema_migrations`. Skripnya sengaja tidak ditaruh di repo. Di CI dan VM tetap dbmate asli (versi di `.github/workflows/ci.yml`).

## Commit
- Conventional Commits berbahasa Indonesia (pesan sesuai brief). Akhiri pesan dengan dua baris trailer persis:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FKKuYrvUnJKvxMN1VCfpRD
- Jangan menulis identitas model di kode/komentar.

## Aturan proyek
- Baca `CLAUDE.md` di root. Komentar/kode/teks UI berbahasa Indonesia mengikuti gaya berkas sekitar.
- Kamu tidak boleh men-dispatch subagent (helper maupun reviewer). Review datang dari controller.
- Plan: `docs/superpowers/plans/2026-11-05-dompetku-v2-s9-anggaran-laporan.md` (bagian Keputusan K1–K13, Global Constraints, Review Focus, task milikmu, dan semua "Catatan dari review Task N" di atas task milikmu).
- Global Constraints S6, S7, S8 tetap mengikat: bagian "Global Constraints" di `docs/superpowers/plans/2026-11-01-dompetku-v2-s6-catat.md`, `2026-11-03-dompetku-v2-s7-transfer-talangan.md`, `2026-11-04-dompetku-v2-s8-bersama.md` (baca bagian itu saja).
- Pola mode nyata yang sudah ada: `docs/superpowers/handoff/s6.md` bagian "Pola mode nyata" dan "Budget JS".
- Mode prototipe (`isPrototype()`) tidak boleh berubah perilaku; Beranda prototipe tidak boleh bertambah satu byte.
- Ruling S7 (`s7-ledger.md`) dan S8 (`s8-ledger.md` R1–R11) tetap berlaku kecuali digantikan.
