# Brief Task 17 (S7): E2E mode nyata S7 + CI

Repo /home/user/dompetku-v2, branch `ccr-8504abb0-by0ewc` (sudah checkout). Kamu IMPLEMENTER satu task. Jangan push, jangan dispatch subagent.

## Baca dulu
- `docs/superpowers/handoff/s7-konteks-subagent.md` — wajib (cara menjalankan test:int, e2e:ledger, e2e prototipe; Postgres lokal sudah siap).
- Plan `docs/superpowers/plans/2026-11-03-dompetku-v2-s7-transfer-talangan.md`: Global Constraints, Review Focus (#1–#3), "Task 17", "Kriteria keluar S7".
- Ledger `docs/superpowers/handoff/s7-ledger.md`: semua ruling (R24 navigasi sesudah pindah ke `/{tujuan}/transaksi`, R25, R27, R28) dan butir "minor (deferred)" yang menyebut Task 17.
- Spec e2e:ledger yang ada: `apps/web/tests/e2e-ledger/*`, config `apps/web/playwright.ledger.config.ts`, job CI `auth` dan `db` di `.github/workflows/ci.yml`; budget prototipe `apps/web/tests/e2e/budget.spec.ts`.

## Lingkup (plan Task 17 Step 1–2) + utang yang diarahkan ke T17
1. `e2e:ledger` baru (mode nyata) — pakai helper/seed yang ada:
   - Setor Pribadi → Bersama via Catat (keterangan Pribadi kanari, mis. "bayar kos adik", dompet "BCA Pribadi" atau kanari `PRIBADI_KANARI` yang sudah ada) lalu kanari: semua rute Bersama (Beranda, Transaksi, Detail kaki masuk, Sampah, Dompet), navigasi klien DAN reload, periksa HTML + payload RSC (respons `?_rsc`/flight) tidak memuat nama dompet Pribadi, keterangan Pribadi, id kaki Pribadi. Batalkan satu kaki → kedua ruang kembali.
   - Talangan → reimburse sebagian → sisa tampil di Dompet Pribadi (Menunggu reimburse) dan Detail.
   - Pindahkan Pribadi→Bersama → navigasi ke `/bersama/transaksi` (R24), fokus wajar (cek fokus ke judul, utang T11), entri asal tidak di Sampah, URL lama menampilkan banner tanpa Pulihkan.
   - Cocokkan saldo (+ Urungkan), arsip dompet saldo 0.
   - Bersama solo (persona N tanpa F): kartu B1 dan, bila murah, B2 kosong.
   - Keyboard-only untuk Cocokkan saldo dan Pindahkan.
   - axe 0 serious/critical terang/gelap 320/390/1280 di layar baru (Detail antar ruang/talangan, sheet Pindahkan, sheet Cocokkan, Dompet dengan Menunggu reimburse, Beranda B1).
   - Anotasi `js-route-kB` semua rute ≤ 162 kB, termasuk `dompet/[id]` (utang T12).
2. Tes int yang dialihkan ke T17: `createReimbursementAction` lintas ruang (talangan Pribadi dari /bersama, dompet penerima Bersama → not_found) (T8 minor); `voidEntryAction` atas entri `adjustment` (T12 minor).
3. CI: pastikan int worker (Task 15) dan `deploy-test.sh` jalan di CI (sudah ada? verifikasi saja), e2e:ledger baru ikut job yang ada. Jangan melemahkan job/tes yang ada.
4. Temuan nyata di kode produk: perbaiki seperlunya bila kecil dan jelas (sebut di laporan, commit terpisah `fix(web): …`); bila besar, berhenti dan laporkan (perbaikan masuk task pemilik kodenya).

## Gerbang
`pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`, `pnpm build`, e2e prototipe (perhatikan build ulang `.next` per mode), `test:int`, `e2e:auth`, `e2e:ledger`, int worker (`pnpm --filter @dompetku/worker test:int`, lihat env di ci.yml), `bash infra/db-vm/deploy/test/deploy-test.sh`, `pg_prove` seluruh suite. Pastikan tak ada proses Playwright lain dan port bebas.

## Commit
`test(e2e): kriteria keluar S7 di mode nyata` (+ commit fix terpisah bila ada), trailer sesuai konteks subagent. Jangan push.

## Laporan akhir
Tulis ke /tmp/claude-0/sdd/task-17-report.md; ringkasan: status, commit, semua angka gerbang, budget semua rute kedua mode, temuan produk, concern.
