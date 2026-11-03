# Laporan Task 8 S7: Server Actions S7

**Status:** DONE_WITH_CONCERNS (gerbang hijau; concern untuk Task 11 dan review keamanan di bawah).

## Berkas

- `apps/web/src/app/[ruang]/_actions/context.ts`: `ActionCtx.ruang` (slug lolos Zod) + `targetSpace(ctx, toRuang)` (tujuan = ruang argumen → `invalid toRuang`; lalu `resolveSpace` konteks user, bukan anggota = `not_found`).
- `_actions/inputs.ts`: `toRuang`, cabang `space_transfer` di `saveCatatInput` (`strictObject`, `toSpaceId: z.never()`), `moveEntryInput` (strict, sama), `moveTargetsInput`.
- `_actions/catat.ts`: `saveCatat` menerima `space_transfer` (`createSpaceTransfer`, `fee` bawaan 0, `allowNegative` bawaan false); talangan di pemasukan atau Bersama = `invalid reimbursable` sebelum DB.
- `_actions/entri.ts`: `moveEntryAction`, `moveTargetsAction`; komentar void/restore untuk `space_transfer`.
- `_actions/dompet.ts`: `reconcileAction`, `archiveAccountAction(ruang, accountId)`.
- `_actions/reimburse.ts` (baru): `createReimbursementAction`, `openReimbursablesAction`.
- Tes: `_actions/actions.test.ts` (unit), `_actions/__int__/s7.int.test.ts` (baru, 12 int).

## Interfaces untuk Task 10–12

- `saveCatat(ruang, { kind: 'space_transfer', clientId, fromAccountId, toRuang, toAccountId, amount, fee?, occurredOn?, description?, sharedNote?, allowNegative? })` → `{ entryId, version, replayed }`. `entryId` = kaki di ruang argumen; `linkedEntryId`/`linkId` tidak pernah dikembalikan (arah apa pun). "Urungkan" = `voidEntryAction(ruang, entryId)`, DB membatalkan pasangannya.
- `saveCatat` expense `reimbursable: true` hanya di Pribadi.
- `moveEntryAction(ruang, { clientId, entryId, expectedVersion, toRuang, accountId, categoryId, keepDescription?, allowNegative? })` → `MoveEntryValue = { toRuang: 'bersama'; entryId; replayed } | { toRuang: 'pribadi'; replayed }`.
- `moveTargetsAction(ruang, toRuang)` → `{ accounts, categories }`: dompet aktif bukan Kantor + kategori aktif (kedua jenis; UI menyaring jenis) ruang tujuan, satu transaksi (`loadRuangShell`). Cocok juga untuk `spaceTransferTargets(toRuang)` Task 10.
- `reconcileAction(ruang, { clientId, accountId, actualBalance })` → `{ entryId | null, difference, replayed }`.
- `archiveAccountAction(ruang, accountId)` → `{ archived }`.
- `createReimbursementAction(ruang, { clientId, entryId, accountId, amount, occurredOn?, description? })` → `{ entryId, remaining, replayed }`; `openReimbursablesAction(ruang)` → `ReimbursableVM[]` (Bersama = `[]` tanpa kueri).

## Bukti RED → GREEN

- RED: unit `actions.test.ts` gagal impor `./reimburse` (aksi belum ada); int `s7.int.test.ts` gagal impor yang sama.
- Satu int gagal sesudah implementasi: F membatalkan kaki Bersama transfer antar ruang milik N menghasilkan `not_found`, bukan `not_creator` yang diharapkan tes. DB memang menyamakan bukan-pencatat dengan DK404 untuk void/pulihkan (0103 baris 397/493, security A1); harapan tes dikoreksi (lihat concern 1).
- GREEN: unit `actions.test.ts` 165, int 141 (129 + 12).

## Gerbang

`pnpm lint` bersih, `pnpm typecheck` bersih, `pnpm test` (web 1770, worker 32, domain 97+28, demo-data 37) hijau, `pnpm format:check` bersih, `pnpm build` sukses, `test:int` 141/141, `e2e:ledger` 18/18, e2e prototipe 280/280.

## Keputusan sendiri

1. Ruang tujuan dibandingkan per slug (`ActionCtx.ruang`), bukan `kind`; uuid ruang tujuan hanya dari `resolveSpace`.
2. Hanya cabang S7 yang strict (`space_transfer`, pindah): kunci asing ditolak. Cabang S6 tetap mengabaikan kunci asing (tes S6 `spaceId` diabaikan dipertahankan).
3. `moveEntryAction` dari `/bersama` (tujuan Pribadi) tidak mengembalikan id entri baru. Akibat untuk Task 11: sesudah pindah Bersama→Pribadi, UI menuju `/pribadi/transaksi` (bukan Detail entri baru seperti bingkai S7-D2 "Fokus"); Pribadi→Bersama tetap ke Detail entri Bersama baru.
4. Talangan di pemasukan atau Bersama ditolak sebagai `invalid reimbursable` di action (DB akan melempar DK422 `reimbursable_personal_expense_only` yang tidak dipetakan = `unknown`).
5. `openReimbursablesAction` di Bersama mengembalikan `[]` tanpa kueri.
6. Label feed Bersama untuk entri yang dipindah Bersama→Pribadi: feed mode nyata belum dirender (S8/S9, `server/ledger/beranda.ts`), jadi tidak ada kode sekarang. Bisa dibedakan **tanpa migrasi**: baris `op = 'void'` dari `api.activity_feed` yang entrinya ber-`app.entries.moved_at` (atau `snapshot ->> 'moved_at'` di `entry_history`). Usulan label: `{Nama} memindahkan transaksi ke ruang lain` (tanpa menyebut Pribadi, tanpa id atau deskripsi apa pun). Dicatat untuk loader feed S8/S9.
7. Toast batal reimburse ("ke", bukan "dari") ada di UI, bukan lapisan aksi: diteruskan ke Task 11/12.
8. Tidak ada aksi baru yang memakai bentuk `Tx`; `moveTargetsAction` memakai `loadRuangShell` (satu `withLedger`).

## Concern

1. **Void/pulihkan `space_transfer` oleh bukan pencatat = `not_found`, bukan `not_creator`** (DB, security A1). Tabel galat bingkai memetakan `not_creator` untuk Batalkan/Pulihkan; di praktik kode itu hanya datang dari Pindahkan. Task 11 tetap menyembunyikan Batalkan untuk bukan pencatat (`voidable`), dan salinan `not_found` di dialog Batalkan perlu masuk akal untuk kasus ini.
2. **Data Pribadi dalam respons action yang dipanggil dari halaman Bersama:** `moveTargetsAction('bersama', 'pribadi')` (dan `catatOptions('pribadi')` S6) mengembalikan nama dompet Pribadi milik pemanggil sendiri ke halaman `/bersama`. Ini respons action atas permintaan eksplisit pemilik Pribadi, bukan payload RSC rute Bersama, dan tidak dapat dihindari untuk Pindahkan/transfer Bersama→Pribadi. Mohon dikonfirmasi di review keamanan.
3. Transfer antar ruang dan pindah memakai tiga transaksi (resolve ruang argumen, resolve ruang tujuan, tulis); tidak dioptimalkan.
4. Audit web untuk "Pindahkan" (R16, opsional) tidak dibuat.
