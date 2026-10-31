# packages/db

Skema Postgres DompetKu: role (`roles/`), migrasi dbmate (`migrations/`), dan tes pgTAP (`tests/`). Sumber kebenaran: `docs/product/BSD.md` (disetujui pemilik). Tes juga dijalankan job CI `db` (`.github/workflows/ci.yml`).

## Migrasi

| File                              | Isi (BSD)                                                                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_skema_dasar.sql`            | §4: skema, `app.settings`, `app.now()`/`app.today()`, `private.require_read_committed()` (S2, maju-saja)                                                                |
| `0002_auth_user.sql`              | §5: tabel inti Better Auth `auth."user"` (lihat "Urutan auth")                                                                                                          |
| `0003_auth_pendaftaran.sql`       | §5: `auth.recovery_codes`, trigger `user_admission` (pendaftaran tertutup, batas 2 user), hak skema `auth`                                                              |
| `0004_ruang_undangan.sql`         | §6: `households`, `spaces`, `space_members`, `profiles`, `idempotency_keys`, `invitations`, `product_events`, `audit.events`                                            |
| `0005_helper_trigger.sql`         | §7, §11: `app.my_space_ids()`, `app.space_roster()`, `app.assert_member()`, `private.require_user()`, `private.own_api_functions()`, penjaga anggota, append-only audit |
| `0006_provisioning_audit_job.sql` | §10: `private.provision_user`, `audit.log`, `jobs.purge_unfinished_users`, `jobs.purge_audit`                                                                           |
| `0007_api_undangan.sql`           | §9.3: `api.bootstrap_owner`, `create/revoke/resend/decline/accept_invitation`, `invitation_peek`                                                                        |
| `0008_rls_hak.sql`                | §11: RLS ENABLE + FORCE, policy, hak tabel, EXECUTE                                                                                                                     |

Isi fungsi dan tabel disalin persis dari BSD. Tabel ledger (`accounts`, `categories`, `entries`, ...), enum ledger, view laporan, `jobs.job_runs`, dan fungsi ledger menyusul di S5. `idempotency_keys` masuk S4 karena `jobs.purge_unfinished_users` menghapus barisnya.

Aturan file baru (BSD §12):

- Satu blok `-- migrate:up` dan satu `-- migrate:down`. Down hanya untuk lokal/CI (produksi maju-saja); CI membuktikan rollback + up menghasilkan skema identik. `0001` tidak punya down.
- File yang menyentuh skema `api` diakhiri `select private.own_api_functions();` (pemilik `dompetku_api`, EXECUTE untuk web). Tes katalog gagal bila lupa.
- Tabel baru di `app`/`audit` wajib RLS ENABLE + FORCE, indeks untuk setiap FK, dan masuk matriks hak di `tests/00_katalog.sql`.

## Urutan auth

BSD memasang FK nyata dari tabel domain dan trigger `user_admission` ke `auth."user"`, padahal tabel itu milik Better Auth. Dipilih: **`auth."user"` dibuat di `0002` dengan kolom inti Better Auth** (bentuk stub `bsd-check`, id `uuid`), bukan menunda FK. Alasannya FK dan trigger aktif dan teruji sejak S4 tanpa jendela tanpa pagar.

Akibatnya untuk migrasi Better Auth (S4 sisi server):

- File hasil generator **tidak boleh** `create table "user"`. Kolom plugin ditambah lewat `alter table auth."user" add column ...` (mis. `"twoFactorEnabled"`).
- Tabel `session`, `account`, `verification`, `passkey`, `twoFactor` dibuat di skema `auth` dengan id dan FK `uuid` ke `auth."user" (id) on delete cascade` (dibutuhkan `jobs.purge_unfinished_users`). Hak `dompetku_web` ikut otomatis lewat default privileges dari `0003`.

## Yang perlu diketahui sebelum diterapkan di VM

- Deployer (`infra/db-vm/deploy/deploy`) menjalankan `dbmate up` dari migrasi di image rilis. Migrasi ini ikut rilis berikutnya setelah merge ke `main`.
- `app.settings.owner_email` (email pemilik, huruf kecil, dari `AUTH_OWNER_EMAIL`) diisi runbook, bukan migrasi. Tanpa baris itu tidak ada yang bisa mendaftar (`signup_closed`).
- Fungsi undangan pra-login (`invitation_peek`, `decline_invitation`) dan `accept_invitation` mengisi GUC `app.invite_token_hash` dengan `set_config(..., true)`: nilainya bertahan sampai akhir transaksi, bukan hanya di dalam fungsi. Panggil di transaksi sendiri, jangan digabung dengan operasi lain dalam satu `withUser`.
- Pembanding email di trigger memakai `lower(btrim(email))`, tetapi `unique` di `auth."user".email` peka huruf besar. Better Auth harus menormalkan email ke huruf kecil sebelum insert.
- Role `dompetku_test`, skema `tap`/`tests`, dan ekstensi pgTAP hanya ada di cluster CI/lokal (`tests/support/setup.sql`), tidak pernah di VM.

## Tes pgTAP

`tests/support/setup.sql` (superuser, sekali setelah `dbmate up`) memasang pgTAP di skema `tap`, role `dompetku_test` (login, bukan superuser, tanpa keanggotaan role aplikasi), dan helper `tests.<role>_exec/_val(uid, sql)`: fungsi `SECURITY DEFINER` milik `dompetku_web`, `dompetku_api`, `dompetku_worker`, `dompetku_owner`. Setiap aksi tes berjalan sebagai role aplikasi itu dengan `app.user_id` = `uid`, sehingga RLS, grant, dan trigger diuji seperti di produksi. Jam dimajukan dengan `tests.clock(interval)` (env `test`, di dalam transaksi tes).

| File                      | Cakupan                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00_katalog.sql`          | RLS FORCE, tanpa EXECUTE PUBLIC, `search_path`, daftar tertutup DEFINER, matriks hak tabel dan fungsi, BYPASSRLS, FK berindeks, FK restrict ke auth |
| `01_pendaftaran.sql`      | pendaftaran tertutup, akun pertama, urutan cek provisioning, akun setengah jadi tidak memakan kuota, user ketiga, penjaga ruang Pribadi             |
| `02_undangan.sql`         | buat, intip, tolak, cabut, kirim ulang, kedaluwarsa, terima setelah diamankan, sekali pakai, terikat email                                          |
| `03_isolasi.sql`          | dua user × 8 tabel × SELECT/INSERT/UPDATE/DELETE untuk web, api, worker; tanpa konteks = 0 baris                                                    |
| `04_audit.sql`            | `audit.log` tanpa pemalsuan `user_id`, daftar tertutup event/meta, append-only (juga owner), retensi, `product_events`                              |
| `05_read_committed.sql`   | semua jalan tulis S4 menolak REPEATABLE READ                                                                                                        |
| `06_purge_unfinished.sql` | akun setengah jadi dihapus setelah 72 jam beserta datanya                                                                                           |

Konkurensi (pendaftaran paralel, dua koneksi) bukan wilayah pgTAP; menyusul di Vitest (TRD §4).

Menjalankan lokal (cluster sekali pakai, pgTAP dan `pg_prove` terpasang):

```bash
psql -U postgres -d postgres -f packages/db/roles/00_roles.sql
DATABASE_URL='postgres://dompetku_owner@127.0.0.1:5432/dompetku?sslmode=disable' \
  dbmate --migrations-dir packages/db/migrations --no-dump-schema up
psql -U postgres -d dompetku -f packages/db/tests/support/setup.sql
pg_prove -U dompetku_test -d dompetku packages/db/tests/*.sql
```
