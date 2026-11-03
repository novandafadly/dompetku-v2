# Konteks bersama untuk setiap subagent S7

## Lingkungan
- Repo: /home/user/dompetku-v2, branch `ccr-9793f2cb-vij139` (sudah checkout). Jangan pindah branch, jangan push (controller yang push).
- Deps sudah terpasang (`pnpm install` selesai). Paket baru: `pnpm add` dengan versi persis; `minimumReleaseAge` 7 hari berlaku.
- Postgres lokal PG16 sekali pakai di 127.0.0.1:5432 (trust). Reset penuh (roles + dbmate up + setup pgTAP):
  `bash docs/superpowers/handoff/db-reset-lokal.sh` (bila container restart: `rm -f /tmp/pgdata-dk/postmaster.pid` dulu)
  - pgTAP: `pg_prove -h 127.0.0.1 -U dompetku_test -d dompetku packages/db/tests/*.sql` (dompetku_test bukan superuser; helper superuser ada di `packages/db/tests/support/setup.sql`)
  - test:int: `TEST_DATABASE_URL='postgres://dompetku_web@127.0.0.1:5432/dompetku' TEST_DATABASE_ADMIN_URL='postgres://postgres@127.0.0.1:5432/dompetku' pnpm --filter @dompetku/web test:int`
  - `e2e:auth` / `e2e:ledger`: lihat skrip di `apps/web/package.json` dan job CI `auth` di `.github/workflows/ci.yml`.
- e2e prototipe: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e` (port 3100 harus bebas: `pgrep -fa server.js`; tidak ada proses Playwright lain: `pgrep -f playwright`).
- Gerbang sebelum melapor DONE (yang relevan dengan task): `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`, `pnpm build`, e2e; task DB: pg_prove seluruh suite; task server/UI nyata: test:int + e2e:ledger.

## Commit
- Conventional Commits berbahasa Indonesia (pesan sesuai brief). Akhiri pesan dengan dua baris trailer persis:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017LUztPw5Vk5pHnsXdChnos
- Jangan menulis identitas model di kode/komentar.

## Aturan proyek
- Baca `CLAUDE.md` di root. Komentar/kode/teks UI berbahasa Indonesia mengikuti gaya berkas sekitar.
- Kamu tidak boleh men-dispatch subagent (helper maupun reviewer). Review datang dari controller.
- Global Constraints mengikat: bagian "Global Constraints" rencana S6 (`docs/superpowers/plans/2026-11-01-dompetku-v2-s6-catat.md`) **ditambah** bagian "Global Constraints" rencana S7 (`docs/superpowers/plans/2026-11-03-dompetku-v2-s7-transfer-talangan.md`). Baca kedua bagian itu saja, bukan seluruh rencana.
- Pola mode nyata yang sudah ada (pakai ulang): `docs/superpowers/handoff/s6.md` bagian "Pola mode nyata" dan "Budget JS".
- Mode prototipe (`isPrototype()`) tidak boleh berubah perilaku: e2e prototipe (280) tetap hijau tanpa mengubah tes lama, kecuali brief menyebut sebaliknya (Task 9).
