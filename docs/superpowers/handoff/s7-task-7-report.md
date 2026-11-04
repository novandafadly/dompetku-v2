# Task 7: laporan (Tekanan pool Beranda: satu transaksi baca per page)

**Status:** DONE. Commit `b2a5ead perf(web): Beranda membaca dalam satu transaksi` (belum di-push).

## Apa yang dibuat

- `server/ledger/read.ts`: setiap fungsi baca kini punya bentuk `fooTx(c: pg.PoolClient, ctx, …)` (jalan di transaksi pemanggil) dan bentuk lama `foo(ctx, …)` sebagai pembungkus satu `withLedger`: `listEntries`, `accountEntries`, `recentEntries`, `getEntry`, `trashList`, `listAccounts`, `listCategories`, `suggestCategories`, `monthSummary`, `safeToSpend`, `todayStatus`, `hasExpense`. Baru: `loadRuangShell(ctx)` → `{ accounts, categories }` dalam satu `withLedger` (tipe `RuangShellData`).
- `reimburse.ts`: `openReimbursablesTx(c, ctx)` + pembungkus `openReimbursables(ctx)` (Task 6 dipertahankan; `createReimbursement` tidak berubah). `listEntries`/`getEntry` dengan `reimbursement`/`reimbursable` tidak berubah isinya.
- `beranda.ts`: `loadBeranda` menjalankan safe → today → (accounts bila tidak diberikan) → hasExpense → recent → invite **berurutan di satu `withLedger`**. Bila `opts.accounts` diberikan (dari layout), promise itu ditunggu **di luar** transaksi lewat `Promise.all([withLedger(...), given])`, jadi koneksi tidak pernah ditahan sambil menunggu koneksi lain (tidak saling kunci saat pool habis). `inviteOpen` menjadi `inviteOpenTx(c)` di transaksi yang sama (konteks `app.user_id` sama; sebelumnya `withUser` tanpa retry, kini ikut retry).
- `transaksi.ts` (`loadTransaksi`: listEntries → monthSummary → spaceMarks), `detail.ts` (`loadDetail`: cek uuid sebelum pool, lalu getEntry → [null = selesai] → accounts → categories → windowClosed), `sampah.ts` (`loadSampah`: trashList → accounts): masing-masing satu `withLedger`.
- `app/[ruang]/_real/context.ts`: satu `React.cache` `shellOnce` → `loadRuangShell`; `ruangShell(ctx)` baru, `ruangAccounts`/`ruangCategories` tetap ada (diturunkan dari promise shell yang sama). `layout.tsx` memakai `ruangShell(ctx)` (satu transaksi untuk opsi Catat).
- Pola halaman tidak diubah (page tetap `ruangContext` di luar try, loader di dalam try + `unstable_rethrow`; Beranda tetap tanpa try seperti sebelumnya). Mode prototipe tidak tersentuh.
- Retry `40001`/`40P01`: setiap loader memanggil `withLedger` sekali dengan seluruh blok di dalamnya, jadi pengulangan mencakup seluruh blok (koneksi + `begin` baru), bukan per kueri. Tidak ada efek samping di luar DB di dalam blok.
- `dompet.ts` tidak perlu diubah: `loadDompetRiwayat` sudah satu transaksi (`accountEntries`) dan page memanggilnya sesudah `ruangAccounts` selesai (berurutan, bukan paralel). `accountEntriesTx` tersedia bila nanti ingin digabung.

## TDD

**RED** (tes baru di `apps/web/src/server/ledger/__int__/pool.int.test.ts`, describe "satu transaksi baca per page": instrumentasi `pool.on('acquire'/'release')` di pool domain `createPools` `max: 5`):

```
TEST_DATABASE_URL=… TEST_DATABASE_ADMIN_URL=… npx vitest run --config vitest.integration.config.ts src/server/ledger/__int__/pool.int.test.ts
FAIL … loadBeranda memakai paling banyak 1 koneksi …  AssertionError: expected 5 to be 1
FAIL … Beranda + layout = paling banyak 2 koneksi      TypeError: loadRuangShell is not a function
FAIL … tiga muat Beranda paralel …                     AssertionError: expected 5 to be less than or equal to 3
FAIL … Transaksi, Detail, Sampah …                     AssertionError: expected 3 to be 1
Tests  4 failed | 2 passed (6)
```

Isi tes:
1. `loadBeranda` Pribadi dan Bersama: puncak = 1, hasil `toEqual` bentuk lama (komposisi `Promise.all` dari pembungkus lama `safeToSpend`/`todayStatus`/`listAccounts`/`hasExpense`/`recentEntries` + kueri invite lama) atas data harness (dompet operasional + tabungan, pengeluaran, transfer, entri batal, dompet Bersama); plus asersi isi (urutan `recent`, saldo, `invite: true` karena F `diundang`).
2. Layout + Beranda (`loadRuangShell` + `loadBeranda({accounts})` paralel): puncak ≤ 2; hasil sama dengan tanpa opsi; shell = `listAccounts` + `listCategories`.
3. Tiga `loadBeranda` paralel di pool `max: 5`: semua fulfilled (tanpa galat `network`), puncak ≤ 3.
4. `loadTransaksi`, `loadDetail` (ada dan tidak ada), `loadSampah`, `loadRuangShell`: puncak = 1 masing-masing, hasil sama dengan pembungkus lama.

Catatan: "snapshot VM" diwujudkan sebagai perbandingan `toEqual` terhadap komposisi bentuk lama di atas data harness yang sama (id/tanggal acak membuat snapshot berkas tidak stabil); ini persis "hasil sama dengan versi lama".

**GREEN:** tes yang sama `Tests 6 passed (6)`.

## Gerbang

- `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`: exit 0 (web 1706 tes, domain 97+28+28, demo-data 37, worker 32).
- `test:int` penuh: `Test Files 12 passed (12)`, `Tests 129 passed (129)`.
- `pnpm build`: exit 0.
- `e2e:ledger` lokal (`CI=true PW_CHROMIUM_PATH=/opt/pw-browsers/chromium AUTH_E2E_DATABASE_URL=postgres://dompetku_web@… AUTH_E2E_ADMIN_URL=postgres://postgres@… pnpm --filter @dompetku/web e2e:ledger`): 18 passed (dua kali).
- e2e prototipe `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e`: 280 passed.
- Budget JS mode nyata (anotasi `js-route-kB` e2e:ledger): Beranda 160,8 kB, Transaksi 160,0, Detail 156,9, Sampah 158,0, Dompet 156,4 (semua ≤ 162; perubahan server saja, JS klien tidak berubah).

## Waktu muat (kasar, tes int sementara, tidak di-commit)

Ruang Pribadi 30 entri, DB lokal 127.0.0.1, 200 muat per angka, 3 run:

| | lama | baru |
| --- | --- | --- |
| `loadBeranda` seri (ms/muat) | 7,6 / 8,1 / 7,7 | 11,3 / 12,0 / 13,5 |
| 4 `loadBeranda` paralel (ms/batch) | 20,6 / 23,5 / 21,2 | 15,4 / 18,5 / 19,7 |
| `loadTransaksi` seri (ms/muat) | 6,1 / 6,4 / 6,0 | 8,1 / 7,8 / 9,1 |

Satu muat tunggal +3–5 ms (round-trip berurutan: begin, set_config, assert_member, 6 kueri, commit di satu koneksi, sebelumnya paralel di 6 koneksi); di bawah beban (4 paralel) lebih cepat karena tidak antre pool. Tidak memburuk berarti untuk UX; DB produksi di VM yang sama (latensi serupa).

## Keputusan sendiri

- Nama bentuk transaksi: sufiks `Tx` (`listAccountsTx(c, ctx)`), karena TS tidak bisa overload nama yang sama secara bersih dengan argumen pertama berbeda jenis.
- Validasi Zod ada di bentuk `Tx` (aman dipakai siapa pun); pembungkus lama tetap memvalidasi lebih dulu supaya input tak sah tidak meminjam koneksi ("Zod sebelum pool"); `getEntry` dan `loadDetail` tetap mengembalikan `null` untuk non-uuid tanpa koneksi.
- `ruangAccounts`/`ruangCategories` kini berbagi satu transaksi shell. Akibat kecil: page Dompet/Kategori yang dirender tanpa layout (navigasi RSC klien) juga memuat kategori/dompet yang tidak dipakai (satu kueri ekstra di koneksi yang sama), sebagai ganti satu transaksi saja per request.
- `opts.accounts` Beranda ditunggu di luar transaksi (lihat atas) agar tidak menahan koneksi sambil menunggu koneksi lain.

## Self-review

- Semua kueri tetap dibatasi `space_id = ctx.spaceId`; tidak ada SQL yang berubah isinya (hanya indentasi string dua kueri di `listEntriesTx`/`recentEntriesTx`). Privasi Bersama tidak berubah (tes kanari beranda/sampah/detail int tetap hijau).
- Tidak ada `SET TRANSACTION ISOLATION`; isolasi bawaan role. Tidak ada log baru.
- Pemanggil tunggal (actions `catat.ts`, `entri.ts`) tetap memakai bentuk lama; `actions.test.ts` (mock modul `read`) tidak berubah.

## Concern

- Satu muat tunggal sedikit lebih lambat (+3–5 ms lokal) karena kueri berurutan; dibalas oleh tidak antre pool saat beban. Bila ingin dipangkas lagi: gabungkan `set_config` + `assert_member` jadi satu round-trip di `withUser` (di luar cakupan task ini).
- Retry 40001/40P01 untuk loader tidak dites di level int (sulit memicu 40001 di baca READ COMMITTED); dijamin struktural karena setiap loader = satu `withLedger` (diuji `retry.test.ts`).
- `e2e:ledger` dijalankan dengan Postgres 16 lokal (CI memakai 17.11).
