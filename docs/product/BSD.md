# BSD: Backend & Schema Design DompetKu v2

Status: **disetujui pemilik 2026-10-31** (putaran 2 + jawaban §15). Perubahan berikutnya lewat migrasi expand di sprint fiturnya. Tanggal: 2026-10-31.

Dokumen ini memformalkan model data yang sekarang hidup di `packages/demo-data` (tipe dan selector `balances`, `safeToSpend`, `budgetProgress`, `monthSummary`, `activityFeed`) menjadi skema Postgres 17. Sumber yang mengikat: spec induk `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` §9.1 dan §9.2, `docs/m0a-keputusan.md`. Riset tim (`docs/team/round1/backend-engineer.md`, `data-engineer.md`, `security.md`, `docs/team/round2/*`) dipakai sebagai bahan; bagian yang belum disahkan ditandai **usulan** atau **Belum diputuskan**. Arsitektur dan NFR ada di `docs/product/TRD.md`.

**Status validasi.** Semua blok SQL di dokumen ini sudah dijalankan berurutan di cluster sekali pakai **PostgreSQL 16** (Postgres 17 tidak tersedia di sandbox), ditambah stub tabel `auth."user"`. Skrip uji perilaku `bsd-check/test.sql` (harness SQL biasa karena pgTAP tidak terpasang; jumlah asersi di `bsd-check/README.md`) lulus: isolasi dua user, idempotensi, pasangan `space_transfer`, saldo negatif termasuk dua koneksi paralel (dblink), kewajiban XOR, undangan dan akun setengah jadi, tagihan, arsip, Sampah, purge, audit, dan tes katalog. DDL tidak memakai fitur yang hanya ada di 17; `ON DELETE SET NULL (kolom)` butuh ≥ 15. Uji ulang di Postgres 17 + pgTAP wajib di CI M0b.

## 1. Keputusan desain

| Topik                | Keputusan                                                                                                                                                                        | Sumber                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Skema                | `app` (tabel domain, view, helper konteks), `api` (fungsi yang dipanggil server), `private` (helper dan trigger), `jobs` (job worker), `audit` (log audit), `auth` (Better Auth) | spec §5.1, §9.1; round1 security R12              |
| Model uang           | Jurnal `entries` (header) + `entry_lines` (nominal bertanda). Saldo = Σ lines, tidak ada kolom saldo                                                                             | spec §5.1; v1 DESIGN §4 D3-B, D4-A                |
| Nominal              | `bigint` rupiah utuh. Input fungsi dan tabel non-ledger: `amount > 0`. Lines bertanda (`<> 0`), batas `                                                                          | amount                                            | ≤ 10^13` | v1 DESIGN D2; round1 backend §2 |
| Ruang                | `spaces.kind` `personal` (satu per user) atau `shared` (satu per rumah tangga). Setiap tabel domain punya `space_id` dengan FK komposit                                          | spec §5.4                                         |
| Transfer antar ruang | Dua entri `space_transfer`, `link_id` sama, `direction` `out`/`in`, void bersama; deskripsi hanya di kaki ruang Pribadi, kaki ruang Bersama hanya membawa `shared_note`          | spec §9.1; m0a-keputusan T6; keputusan pemilik #9 |
| Isolasi transaksi    | READ COMMITTED untuk semua transaksi tulis, dipaksa di role dan diperiksa di setiap fungsi tulis; penjaga saldo, batas user, dan kewajiban memakai lock eksplisit                | review backend 2026-10-31                         |
| Fee transfer         | `main = −amount`, `fee = −fee` (akun sumber), `counter = +amount`; Σ = −fee                                                                                                      | spec §9.1                                         |
| Idempotensi          | `app.idempotency_keys`, PK `(user_id, client_id)`, simpan `op` + `request_hash`; kunci sama isi beda = `DK410`                                                                   | spec §9.1; round2 backend A6                      |
| Edit                 | Optimistic lock `version`; setiap mutasi menaikkan version dan menulis `entry_history` (juga saat create)                                                                        | round1 backend R6                                 |
| Hapus                | Void (`voided_at`); pulihkan ≤ 90 hari; purge permanen setelah 90 hari dengan `entry_tombstones` tanpa nominal/deskripsi                                                         | spec §9.1                                         |
| Tanggal              | `occurred_on date` = tanggal kalender WIB; `app.today()`/`app.now()`; `current_date` dilarang                                                                                    | spec §9.1                                         |
| Kewajiban            | Satu kewajiban = tagihan ATAU anggaran wajib, tidak pernah keduanya; ditegakkan trigger                                                                                          | m0a-keputusan T6                                  |
| Net worth            | operasional + tabungan; Kas Kantor ditampilkan tetapi dikecualikan                                                                                                               | m0a-keputusan T11                                 |
| Migrasi              | dbmate, maju-saja di produksi, expand/contract, uji N-1                                                                                                                          | spec §9.1                                         |

### 1.1 Logika hitung: SQL atau aplikasi

Dipilih **SQL (fungsi `SECURITY INVOKER`) untuk semua angka uang**: saldo, aman dipakai, ringkasan bulan, progres anggaran, net worth, feed.

- Satu sumber aturan klasifikasi (`app.report_class`) untuk laporan, anggaran, ekspor, AI, net worth (spec §9.1). Di v1 setiap layar punya filter sendiri dan hasilnya salah (audit INT-07/08/09).
- INVOKER berarti RLS tetap berlaku; laporan tidak bisa membaca ruang Pribadi pasangan walau ada bug di TypeScript.
- Tanggal dihitung di DB dengan WIB eksplisit; tidak ada konversi `Date` di Node.
- Aplikasi hanya memformat angka dan menyusun teks (misalnya "Setoran dari Farida" dari `kind`, `direction`, `created_by` + `app.space_roster`).

Selector di `packages/demo-data` tetap dipakai prototipe dan menjadi oracle tes: fixture yang sama harus menghasilkan angka yang sama di selector dan di fungsi SQL, kecuali perbedaan yang disengaja di §2.2.

## 2. Pemetaan dari `packages/demo-data`

### 2.1 Nama

| demo-data                                                | DB                                                                                                          | Catatan                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `Ruang` `'pribadi' \| 'bersama'`                         | `app.spaces.kind` `'personal' \| 'shared'` + `space_id`                                                     | URL tetap `/pribadi`, `/bersama`; server me-resolve ke `space_id` |
| `Member {id, name, initial}`                             | `auth."user".id` + `app.profiles (display_name, initial, payday_day)`                                       |                                                                   |
| `Account.ruang`, `ownerId`                               | `accounts.space_id`; pemilik diturunkan dari `spaces.owner_user_id`                                         | `ownerId` dihapus                                                 |
| `Account.walletType`, `openedOn`, `pocket`               | `wallet_type`, `opened_on`, `pocket`                                                                        |                                                                   |
| `Category.parentId`, `type`, `icon`                      | `parent_id`, `type`, `icon` (nama Phosphor)                                                                 | maksimal 2 level                                                  |
| `Entry.amount` (selalu positif) + `kind`                 | `entry_lines.amount` bertanda per `role`                                                                    | input `p_amount > 0`                                              |
| `Entry.accountId`, `counterAccountId`                    | line `main`, line `counter`                                                                                 |                                                                   |
| `Entry.occurredOn`, `createdAt`, `createdBy`, `voidedAt` | `occurred_on`, `created_at`, `created_by`, `voided_at` (+ `voided_by`)                                      |                                                                   |
| `Entry.linkId`, `direction`, `sharedNote`                | `link_id`, `direction`, `shared_note`                                                                       |                                                                   |
| `Entry.clientId`                                         | `app.idempotency_keys.client_id`                                                                            | bukan kolom entri; satu operasi bisa membuat 2 entri              |
| `Entry.reimbursable`                                     | `reimbursable`                                                                                              | hanya pengeluaran ruang Pribadi                                   |
| `Bill {name, amount, dueOn, posted}`                     | `app.bills` (aturan) + `app.bill_occurrences` (jatuh tempo); view `app.bill_schedule` memberi bentuk `Bill` | `posted` diturunkan: entri tertaut ada dan hidup                  |
| `Budget {ruang, categoryId, month, amount, wajib}`       | `app.budgets` dengan nama kolom sama                                                                        | hanya kategori induk                                              |
| `noSpendDays`                                            | `app.no_spend_days`                                                                                         |                                                                   |
| `Activity`                                               | `api.activity_feed` dari `entry_history`                                                                    | teks disusun di aplikasi                                          |
| `kind` baru                                              | `adjustment` (cocokkan saldo), `reimbursement` (penggantian talangan)                                       | belum ada di demo                                                 |

### 2.2 Perbedaan perilaku yang disengaja

1. **Pengeluaran talangan** (`reimbursable`) dan **pengeluaran di dompet kantor** tidak masuk "pengeluaran" maupun realisasi anggaran (kelas `x_talangan`, `x_kantor`). Selector demo menghitung talangan sebagai pengeluaran dan menghitung kantor dalam realisasi anggaran. Mengikuti keputusan pemilik v1 DESIGN §12-5 dan audit INT-08/09. Selector demo perlu diselaraskan. Talangan yang tidak pernah diganti diubah lewat alur "Tidak diganti" (`api.update_entry` dengan `p_reimbursable => false`), sehingga menjadi pengeluaran biasa; daftar talangan terbuka adalah fungsi baca M1 (§9, belum ditulis).
2. **Biaya transfer** masuk pengeluaran (`expense_fee`), kecuali fee yang dibayar dari dompet kantor: fee itu kelas `x_kantor` dan masuk `kantor_keluar` (keputusan pemilik #7). Fee tidak berkategori, sehingga tidak mengurangi anggaran mana pun (`budget_progress` hanya menjumlah kelas `expense`). Demo belum punya fee.
3. **`month_summary`**: `transfer` dihitung per entri (Σ |line `main`| entri `transfer` dan `space_transfer`), tanpa melihat jenis dompet; sama dengan selector `monthSummary`, termasuk transfer dari dan ke dompet kantor. Bedanya hanya di kantor: demo memberi satu angka `kantor` (|masuk| + |keluar|), DB memecahnya menjadi `kantor_masuk` dan `kantor_keluar` agar angkanya bermakna.
4. **Arsip dompet** hanya boleh bila saldo 0 (`api.archive_account`, keputusan pemilik #8). Karena itu "aman dipakai" dan net worth selalu memakai himpunan dompet yang sama: dompet terarsip bersaldo 0 tidak mengubah keduanya. Demo belum punya arsip.
5. **`api.activity_feed`** menampilkan kaki `out` di Bersama (demo melewatinya), peristiwa `update`/`void`/`restore` (demo hanya `create`), dan entri yang sudah dibatalkan tetap terlihat lewat riwayatnya. Ketiganya masuk tes oracle.
6. **Tagihan rutin** dengan `starts_on` sebelum bulan tagihan dibuat: bulan-bulan sebelumnya tidak dimaterialisasi, hanya bulan berjalan dan sesudahnya (keputusan pemilik #6). Tagihan terarsip tidak dihitung di "aman dipakai"; `api.archive_bill` melewati semua kemunculan terbuka.
7. **Transfer antar ruang**: deskripsi hanya disimpan di kaki ruang Pribadi, ke arah mana pun. Saat mengambil uang Bersama ke Pribadi, Bersama hanya melihat "Diambil oleh ..." plus `shared_note` bila diisi (keputusan pemilik #9).

## 3. Role

Spec §9.1 menetapkan lima role. `dompetku_monitor` adalah tambahan usulan (round1 devops §6) untuk `postgres_exporter`.

| Role               | Login | BYPASSRLS | Hak                                                                                     | Dipakai oleh                                                          |
| ------------------ | ----- | --------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `dompetku_owner`   | ya    | ya        | pemilik semua skema dan tabel; DDL                                                      | container `migrate` (dbmate), CLI admin. Tidak di-mount ke web/worker |
| `dompetku_api`     | tidak | tidak     | pemilik fungsi tulis `api.*` (DEFINER); DML ledger dibatasi policy `TO dompetku_api`    | dipakai lewat fungsi saja                                             |
| `dompetku_web`     | ya    | tidak     | `SELECT` tabel domain (RLS), `EXECUTE api.*`, R/W skema `auth`, `INSERT product_events` | web                                                                   |
| `dompetku_worker`  | ya    | tidak     | `EXECUTE jobs.*`, R/W `jobs.job_runs`; tanpa akses tabel domain dan `auth`              | worker                                                                |
| `dompetku_auditor` | tidak | ya        | `SELECT` tabel `app`; pemilik `private.dq_run()`                                        | lewat `jobs.dq_reconcile()`                                           |
| `dompetku_monitor` | ya    | tidak     | `pg_monitor`                                                                            | `postgres_exporter` (usulan)                                          |

`pg_monitor` memuat `pg_read_all_stats`, sehingga `dompetku_monitor` melihat teks query semua sesi. Ini aman selama semua query berparameter: lint `sql.raw` berlaku untuk `apps/**` dan worker, dan `log_parameter_max_length=0` mencegah nilai parameter masuk log.

**Isolasi transaksi.** Semua transaksi tulis berjalan di READ COMMITTED. Penjaga saldo negatif, batas 2 user, dan kewajiban XOR hanya benar di tingkat ini: statement sesudah lock mengambil snapshot baru, sehingga transaksi kedua melihat baris yang sudah di-commit transaksi pertama. Di REPEATABLE READ, dua pengeluaran paralel bisa sama-sama lolos (terbukti di review backend: saldo 100, dua pengeluaran 80, saldo akhir −60). Tiga lapis penegakan:

1. `default_transaction_isolation = 'read committed'` di role `dompetku_web` dan `dompetku_worker` (blok di bawah).
2. `private.require_read_committed()` dipanggil `private.require_user()` (jadi oleh setiap fungsi `api.*` tulis), `private.provision_user`, trigger penerimaan user, dan `api.decline_invitation`. Tingkat lain = `DK500 isolation_not_read_committed`.
3. Lint melarang `SET TRANSACTION ISOLATION` dan opsi `isolationLevel` Kysely di `apps/**`; `withUser` tidak menerima parameter isolasi.

Lock eksplisit yang diandalkan: akun `for no key update` urut id (saldo), advisory lock `dompetku.user_cap` (batas user), advisory lock `dompetku.obligation:<space>` (XOR). Karena itu retry `40001` di Node hanya menangani kasus serialisasi yang tidak diharapkan; `40P01` (deadlock) tetap diulang.

Backup: WAL-G berjalan di container Postgres sebagai superuser lokal lewat socket Unix, bukan role jaringan. Uji restore memakai superuser container sekali pakai, bukan role produksi (round2 backend A3).

Role dan database dibuat sekali oleh superuser lewat runbook M0b (objek tingkat cluster, di luar dbmate):

```sql
-- Dijalankan sekali oleh superuser container (runbook M0b), bukan oleh dbmate.
-- Password diisi lewat \password dari secret file, tidak pernah ditulis di repo.
create role dompetku_owner   login    nosuperuser nocreatedb nocreaterole bypassrls;
create role dompetku_api     nologin  nosuperuser nobypassrls;
create role dompetku_web     login    nosuperuser nobypassrls;
create role dompetku_worker  login    nosuperuser nobypassrls;
create role dompetku_auditor nologin  nosuperuser bypassrls;
create role dompetku_monitor login    nosuperuser nobypassrls in role pg_monitor;

-- owner harus bisa SET ROLE ke api/auditor agar bisa ALTER ... OWNER TO.
grant dompetku_api, dompetku_auditor to dompetku_owner;

create database dompetku owner dompetku_owner;
revoke all on database dompetku from public;
grant connect on database dompetku to dompetku_web, dompetku_worker, dompetku_monitor;
alter database dompetku set timezone = 'UTC';

-- Timeout per role (angka dari round2/backend-engineer §2.4). Worker 60 s untuk purge dan dq_run
-- pada data besar; diukur di job CI kinerja.
alter role dompetku_web    set statement_timeout = '5s';
alter role dompetku_web    set lock_timeout = '3s';
alter role dompetku_web    set idle_in_transaction_session_timeout = '15s';
alter role dompetku_worker set statement_timeout = '60s';
alter role dompetku_worker set lock_timeout = '3s';
alter role dompetku_worker set idle_in_transaction_session_timeout = '15s';

-- Isolasi wajib READ COMMITTED (lihat atas); fungsi tulis juga memeriksanya.
alter role dompetku_web    set default_transaction_isolation = 'read committed';
alter role dompetku_worker set default_transaction_isolation = 'read committed';
```

## 4. Skema, konteks request, dan waktu

`withUser` menjalankan `select set_config('app.user_id', $1, true)` di awal setiap transaksi. `true` = lokal transaksi, sehingga koneksi pool berikutnya kembali kosong dan `app.current_user_id()` = NULL (fail-closed, semua policy false). `SET` sesi dan `set_config(..., false)` dilarang lint (spec §9.1).

Batas kepercayaan: role web bisa mengisi `app.user_id` sembarang. RLS melindungi dari bug aplikasi (lupa `WHERE`, salah id), bukan dari SQL injection. Karena itu `sql.raw` dilarang (round1 backend R4, security R5).

```sql
-- migrate:up
-- Dijalankan dbmate sebagai dompetku_owner. Semua objek milik dompetku_owner kecuali disebut lain.
revoke all on schema public from public;

create schema app;      -- tabel domain, view, helper konteks
create schema api;      -- fungsi yang dipanggil server (tulis = DEFINER, baca = INVOKER)
create schema private;  -- helper dan fungsi trigger; tanpa EXECUTE untuk role login
create schema jobs;     -- fungsi job worker
create schema audit;    -- log audit append-only
create schema auth;     -- tabel Better Auth (dibuat migrasi Better Auth, lihat §5)

alter default privileges for role dompetku_owner revoke execute on functions from public;
alter default privileges for role dompetku_api   revoke execute on functions from public;
alter default privileges for role dompetku_owner revoke all on tables from public;

grant usage on schema app     to dompetku_web, dompetku_worker, dompetku_api, dompetku_auditor;
grant usage on schema api     to dompetku_web, dompetku_api;  -- api: fungsi api.* memanggil api.* lain
grant usage on schema private to dompetku_api, dompetku_auditor;
grant usage on schema jobs    to dompetku_worker;
grant usage on schema audit   to dompetku_web, dompetku_worker;
grant usage on schema auth    to dompetku_web;

-- Penanda lingkungan. Hanya owner yang menulis; tes katalog di prod memastikan env = 'prod'.
create table app.settings (
  key   text primary key check (key ~ '^[a-z_]{1,40}$'),
  value text not null check (length(value) <= 200)
);
insert into app.settings (key, value) values ('env', 'prod');
-- 'owner_email' (email akun pertama, dari env AUTH_OWNER_EMAIL) diisi runbook M0b, bukan migrasi.
grant select on app.settings to dompetku_web, dompetku_worker, dompetku_api, dompetku_auditor;

-- Penjaga isolasi (lihat §3). Dipanggil require_user, provision_user, trigger penerimaan user.
create function private.require_read_committed() returns void
language plpgsql stable set search_path = '' as $$
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = 'DK500', message = 'isolation_not_read_committed';
  end if;
end $$;
grant execute on function private.require_read_committed() to dompetku_api;

create function app.current_user_id() returns uuid
language sql stable parallel safe set search_path = '' as $$
  select nullif(pg_catalog.current_setting('app.user_id', true), '')::uuid
$$;

-- Jam yang bisa diganti hanya di dev/test (spec §9.1, round2 A7).
create function app.now() returns timestamptz
language sql stable set search_path = '' as $$
  select case
    when (select s.value from app.settings s where s.key = 'env') in ('dev', 'test')
         and nullif(pg_catalog.current_setting('app.now_override', true), '') is not null
      then pg_catalog.current_setting('app.now_override', true)::timestamptz
    else pg_catalog.now()
  end
$$;

-- Tanggal kalender WIB. Satu-satunya sumber "hari ini" di SQL.
create function app.today() returns date
language sql stable set search_path = '' as $$
  select (app.now() at time zone 'Asia/Jakarta')::date
$$;

grant execute on function app.current_user_id(), app.now(), app.today()
  to dompetku_web, dompetku_worker, dompetku_api, dompetku_auditor;
```

## 5. Auth (Better Auth)

- Tabel Better Auth (`user`, `session`, `account`, `verification`, plus plugin passkey dan two-factor) dibuat oleh generator migrasi Better Auth, disimpan sebagai file dbmate, di skema `auth`, di luar RLS, hanya bisa diakses `dompetku_web` (spec §9.1).
- Generator Better Auth menulis kolom id bertipe `text`. File migrasi yang disimpan diubah tangan: semua kolom id dan FK user menjadi `uuid`; `generateId` di konfigurasi menghasilkan UUID (round2 backend §2.1). Diff `schema.sql` di CI menangkap bila generator dijalankan ulang tanpa koreksi ini.
- Better Auth memakai pool `pg` tersendiri dengan `options=-c search_path=auth` (role `dompetku_web`), sehingga tabelnya selalu di skema `auth`. Pool domain tidak memakai `search_path` itu; query domain selalu memakai nama berskema.
- Hak `dompetku_web` atas tabel `auth` diberikan lewat `alter default privileges`, jadi berlaku juga untuk tabel plugin yang ditambah migrasi berikutnya.
- Field sesi tambahan `amr` diisi hook dan dibaca `requireUser` dari baris sesi DB (bukan cookie cache). Nilai: `passkey`, `password+totp` (sesi penuh); `password` = keadaan **enrolling** (sesudah `/buat-akun`, sebelum faktor kuat terdaftar) yang hanya boleh membuka `/amankan`; `recovery` = masuk dengan kode pemulihan, hanya boleh membuka `/amankan` untuk mendaftarkan faktor baru, mencabut sesi lain, menulis audit `recovery_code_used`, dan mengirim email pemberitahuan. Detail di TRD §3.4.
- **Kode pemulihan untuk semua akun**, termasuk akun yang hanya memakai passkey (keputusan pemilik #1). Kode cadangan bawaan plugin two-factor Better Auth terikat ke TOTP dan disimpan terenkripsi, jadi tidak dipakai. Tabel sendiri `auth.recovery_codes`: 10 kode per user, hash argon2id dihitung di Node, sekali pakai (`used_at`). Akun belum dianggap aman (dan undangan belum terpakai) sebelum kode pemulihan dibuat.
- FK dari tabel domain ke `auth."user"` memakai `on delete restrict`: menghapus akun auth tidak boleh menghapus ledger. Pengecualian satu-satunya: akun setengah jadi (belum punya profil) dihapus `jobs.purge_unfinished_users` setelah 72 jam.

**Pendaftaran** (keputusan pemilik #2, #3, #5). Trigger `BEFORE INSERT` di `auth."user"` menegakkan aturan pendaftaran tertutup di DB, di bawah advisory lock `dompetku.user_cap`:

- Batas 2 user dihitung dari user yang sudah diprovisikan (punya baris `app.profiles`). Akun setengah jadi tidak memakan kuota.
- Sebelum rumah tangga ada, hanya email `app.settings.owner_email` (dari env `AUTH_OWNER_EMAIL`) yang boleh mendaftar.
- Sesudahnya, email baru wajib cocok dengan undangan terbuka yang belum kedaluwarsa. Undangan dikirim lewat email (Resend) ke alamat itu, sehingga membuka tautan membuktikan kepemilikan kotak masuk; hook Better Auth mengisi `emailVerified = true` saat user dibuat dari tautan undangan yang sah.
- Undangan baru ditandai terpakai di `api.accept_invitation`, setelah akun diamankan (faktor kuat dan kode pemulihan terdaftar), bukan saat user dibuat.

Tabel kode pemulihan, trigger pendaftaran, dan hak skema `auth` (dipasang setelah migrasi Better Auth membuat `auth."user"`):

Untuk validasi, stub berikut dipakai sebagai pengganti tabel Better Auth (tidak masuk migrasi):

```sql
-- HANYA UNTUK VALIDASI: bentuk minimal tabel Better Auth "user" (id uuid).
create table auth."user" (
  id              uuid primary key,
  name            text not null,
  email           text not null unique,
  "emailVerified" boolean not null default false,
  image           text,
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now()
);
```

```sql
-- migrate:up
-- Kode pemulihan untuk semua akun (keputusan pemilik #1). Hash argon2id dari Node.
create table auth.recovery_codes (
  user_id    uuid not null references auth."user" (id) on delete cascade,
  code_hash  text not null check (code_hash like '$argon2id$%' and length(code_hash) <= 200),
  created_at timestamptz not null default now(),
  used_at    timestamptz,
  primary key (user_id, code_hash)
);

-- Pendaftaran tertutup + batas keras 2 user (spec §9.2, keputusan pemilik #2, #3, #5).
-- Batas dihitung dari user yang sudah diprovisikan (punya profil); akun setengah jadi tidak dihitung.
-- app.* belum ada saat blok ini dijalankan; fungsi plpgsql baru di-resolve saat dipanggil.
create function private.tg_user_admission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(new.email));
begin
  perform private.require_read_committed();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dompetku.user_cap'));
  if (select count(*) from app.profiles) >= 2 then
    raise exception using errcode = 'DK422', message = 'user_limit';
  end if;
  if not exists (select 1 from app.households) then
    if not exists (select 1 from app.settings s where s.key = 'owner_email' and s.value = v_email) then
      raise exception using errcode = 'DK422', message = 'signup_closed';
    end if;
  elsif not exists (
      select 1 from app.invitations i
      where i.email = v_email and i.used_at is null and i.revoked_at is null
        and i.expires_at > app.now()) then
    raise exception using errcode = 'DK422', message = 'signup_closed';
  end if;
  return new;
end $$;

create trigger user_admission before insert on auth."user"
  for each row execute function private.tg_user_admission();

grant select, insert, update, delete on all tables in schema auth to dompetku_web;
alter default privileges for role dompetku_owner in schema auth
  grant select, insert, update, delete on tables to dompetku_web;
```

## 6. Tabel

Aturan yang ditegakkan secara deklaratif (tanpa trigger):

- **FK komposit `(space_id, x_id)`**: line, kategori, akun, tagihan, dan anggaran tidak bisa menunjuk baris ruang lain.
- **Kantor hanya di Pribadi**: `accounts.space_kind` + FK `(space_id, space_kind) → spaces(id, kind)` + CHECK.
- **Tipe kategori = jenis entri**: kolom generated `entries.category_type` ikut FK `(space_id, category_id, category_type)`.
- **Anggaran hanya pada kategori induk pengeluaran**: FK ke `(space_id, id, type, is_root)`.
- **Privasi transfer antar ruang**: `CHECK (kind <> 'space_transfer' or space_kind = 'personal' or description is null)`; `shared_note` hanya di kaki ruang Bersama (keputusan pemilik #9).
- **Indeks pendukung FK**: setiap FK punya indeks non-parsial yang kolom terdepannya sama dengan kolom FK (tes katalog #7).
- **Satu rumah tangga, satu ruang Bersama, satu ruang Pribadi per user**: indeks unik parsial.
- **Undangan**: `token_hash` 32 byte (SHA-256), `expires_at = created_at + 72 jam`, satu undangan terbuka per rumah tangga, sekali pakai, alasan pencabutan (`revoked`, `declined`, `resent`, `expired`).
- **Audit dan metrik produk**: nama event daftar tertutup; `audit.events.meta` hanya kunci yang diizinkan, nilai skalar, maksimal 1 kB; `product_events` tanpa kolom nominal atau deskripsi.

```sql
-- migrate:up
create type app.space_kind      as enum ('personal', 'shared');
create type app.member_role     as enum ('owner', 'member');
create type app.pocket          as enum ('operasional', 'tabungan', 'kantor');
create type app.wallet_type     as enum ('cash', 'bank', 'ewallet');
create type app.category_type   as enum ('income', 'expense');
create type app.entry_kind      as enum ('income', 'expense', 'transfer', 'space_transfer',
                                         'opening_balance', 'adjustment', 'reimbursement');
create type app.line_role       as enum ('main', 'counter', 'fee');
create type app.entry_direction as enum ('out', 'in');
create type app.history_op      as enum ('create', 'update', 'void', 'restore');

-- ===== Rumah tangga, ruang, anggota =====
create table app.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);
create unique index households_singleton on app.households ((true));

create table app.spaces (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references app.households on delete restrict,
  kind          app.space_kind not null,
  owner_user_id uuid references auth."user" (id) on delete restrict,
  created_at    timestamptz not null default now(),
  unique (id, kind),
  check ((kind = 'personal') = (owner_user_id is not null))
);
create unique index spaces_one_shared   on app.spaces (household_id)  where kind = 'shared';
create unique index spaces_one_personal on app.spaces (owner_user_id) where kind = 'personal';
create index on app.spaces (household_id);
create index on app.spaces (owner_user_id);

create table app.space_members (
  space_id  uuid not null references app.spaces on delete restrict,
  user_id   uuid not null references auth."user" (id) on delete restrict,
  role      app.member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index on app.space_members (user_id);

create table app.profiles (
  user_id      uuid primary key references auth."user" (id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 40),
  initial      text not null check (length(initial) between 1 and 2),
  payday_day   smallint check (payday_day between 1 and 31),
  updated_at   timestamptz not null default now()
);

-- ===== Dompet =====
create table app.accounts (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null,
  space_kind  app.space_kind not null,
  name        text not null check (length(btrim(name)) between 1 and 60),
  pocket      app.pocket not null,
  wallet_type app.wallet_type not null,
  opened_on   date not null check (opened_on >= date '2000-01-01'),
  archived_at timestamptz,
  sort_order  int not null default 0,
  created_by  uuid not null references auth."user" (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (space_id, id),
  foreign key (space_id, space_kind) references app.spaces (id, kind) on delete restrict,
  check (pocket <> 'kantor' or space_kind = 'personal')
);
create index on app.accounts (space_id, space_kind);
create index on app.accounts (created_by);

-- ===== Kategori (2 level, tipe anak = tipe induk) =====
create table app.categories (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references app.spaces on delete restrict,
  parent_id   uuid,
  type        app.category_type not null,
  is_root     boolean generated always as (parent_id is null) stored,
  name        text not null check (length(btrim(name)) between 1 and 40),
  icon        text not null check (icon ~ '^[A-Z][A-Za-z0-9]{0,39}$'),
  is_system   boolean not null default false,
  archived_at timestamptz,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (space_id, id),
  unique (space_id, id, type),
  unique (space_id, id, type, is_root),
  foreign key (space_id, parent_id, type) references app.categories (space_id, id, type),
  check (parent_id is distinct from id)
);
create unique index categories_name_unique on app.categories
  (space_id, type, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where archived_at is null;
create index on app.categories (space_id, parent_id, type);

-- ===== Jurnal =====
create table app.entries (
  id                  uuid primary key default gen_random_uuid(),
  space_id            uuid not null,
  space_kind          app.space_kind not null,
  kind                app.entry_kind not null,
  occurred_on         date not null check (occurred_on >= date '2000-01-01'),
  description         text check (length(description) between 1 and 200),
  category_id         uuid,
  category_type       app.category_type generated always as (
                        case kind when 'income'  then 'income'::app.category_type
                                  when 'expense' then 'expense'::app.category_type end) stored,
  reimbursable        boolean not null default false,
  reimburses_entry_id uuid,
  link_id             uuid,
  direction           app.entry_direction,
  shared_note         text check (length(shared_note) between 1 and 200),
  version             int not null default 1 check (version >= 1),
  voided_at           timestamptz,
  voided_by           uuid references auth."user" (id) on delete restrict,
  created_by          uuid not null references auth."user" (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_by          uuid not null references auth."user" (id) on delete restrict,
  updated_at          timestamptz not null default now(),
  unique (space_id, id),
  foreign key (space_id, space_kind) references app.spaces (id, kind) on delete restrict,
  foreign key (space_id, category_id, category_type)
    references app.categories (space_id, id, type) on delete restrict,
  foreign key (space_id, reimburses_entry_id) references app.entries (space_id, id) on delete restrict,
  check (category_id is null or kind in ('income', 'expense')),
  check (not reimbursable or (kind = 'expense' and space_kind = 'personal')),
  check ((kind = 'reimbursement') = (reimburses_entry_id is not null)),
  check (kind <> 'reimbursement' or space_kind = 'personal'),
  check ((kind = 'space_transfer') = (link_id is not null)),
  check ((kind = 'space_transfer') = (direction is not null)),
  -- Deskripsi transfer antar ruang hanya di kaki Pribadi; Bersama hanya membawa shared_note.
  check (kind <> 'space_transfer' or space_kind = 'personal' or description is null),
  check (shared_note is null or (kind = 'space_transfer' and space_kind = 'shared')),
  check ((voided_at is null) = (voided_by is null))
);
create unique index entries_link_space on app.entries (link_id, space_id) where link_id is not null;
create index entries_list on app.entries (space_id, occurred_on desc, created_at desc, id desc)
  where voided_at is null;
create index on app.entries (space_id, category_id, category_type);
create index on app.entries (space_id, reimburses_entry_id);
create index on app.entries (space_id, space_kind);
create index on app.entries (voided_at) where voided_at is not null;
create index on app.entries (created_by);
create index on app.entries (updated_by);
create index on app.entries (voided_by);

create table app.entry_lines (
  entry_id   uuid not null,
  space_id   uuid not null,
  role       app.line_role not null,
  account_id uuid not null,
  amount     bigint not null
             check (amount <> 0 and amount between -10000000000000 and 10000000000000),
  primary key (entry_id, role),
  foreign key (space_id, entry_id)   references app.entries  (space_id, id) on delete cascade,
  foreign key (space_id, account_id) references app.accounts (space_id, id) on delete restrict
);
create index entry_lines_balance on app.entry_lines (account_id) include (amount, entry_id);
create index entry_lines_space   on app.entry_lines (space_id, entry_id);
create index on app.entry_lines (space_id, account_id);

create table app.entry_history (
  entry_id   uuid not null,
  space_id   uuid not null,
  version    int not null check (version >= 1),
  op         app.history_op not null,
  snapshot   jsonb not null,                          -- entri + lines SESUDAH op
  changed_by uuid not null references auth."user" (id) on delete restrict,
  via        text not null default 'web' check (via in ('web', 'job', 'cli')),
  changed_at timestamptz not null default now(),
  primary key (entry_id, version),
  foreign key (space_id, entry_id) references app.entries (space_id, id) on delete cascade
);
create index on app.entry_history (space_id, changed_at desc);
create index on app.entry_history (space_id, entry_id);
create index on app.entry_history (changed_by);

-- Jejak entri yang dipurge: tanpa nominal, tanpa deskripsi, tanpa FK (spec §9.1).
create table app.entry_tombstones (
  entry_id    uuid primary key,
  link_id     uuid,
  space_id    uuid not null,
  kind        app.entry_kind not null,
  occurred_on date not null,
  voided_at   timestamptz not null,
  voided_by   uuid not null,
  purged_at   timestamptz not null default now()
);
create index on app.entry_tombstones (space_id, purged_at);

create table app.idempotency_keys (
  user_id      uuid not null references auth."user" (id) on delete restrict,
  client_id    uuid not null,
  op           text not null check (op ~ '^[a-z_]{1,40}$'),
  request_hash bytea not null check (length(request_hash) = 32),
  result       jsonb,
  created_at   timestamptz not null default now(),
  primary key (user_id, client_id)
);
create index on app.idempotency_keys (created_at);

-- ===== Tagihan rutin =====
create table app.bills (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null,
  name          text not null check (length(btrim(name)) between 1 and 60),
  amount        bigint not null check (amount > 0 and amount <= 10000000000000),
  category_id   uuid not null,
  category_type app.category_type not null default 'expense' check (category_type = 'expense'),
  account_id    uuid,                                     -- dompet bayar default
  day_of_month  smallint not null check (day_of_month between 1 and 31),
  starts_on     date not null,
  ends_on       date,
  archived_at   timestamptz,
  created_by    uuid not null references auth."user" (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (space_id, id),
  foreign key (space_id, category_id, category_type)
    references app.categories (space_id, id, type) on delete restrict,
  foreign key (space_id, account_id) references app.accounts (space_id, id) on delete restrict,
  check (ends_on is null or ends_on >= starts_on)
);
create index on app.bills (space_id, category_id, category_type);
create index on app.bills (space_id, account_id);
create index on app.bills (created_by);

create table app.bill_occurrences (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null,
  bill_id    uuid not null,
  due_on     date not null,
  amount     bigint not null check (amount > 0 and amount <= 10000000000000),
  entry_id   uuid,                                       -- terbayar = entri ini hidup
  skipped_at timestamptz,
  unique (bill_id, due_on),
  foreign key (space_id, bill_id)  references app.bills   (space_id, id) on delete restrict,
  foreign key (space_id, entry_id) references app.entries (space_id, id) on delete set null (entry_id),
  check (entry_id is null or skipped_at is null)
);
create index on app.bill_occurrences (space_id, due_on);
create index on app.bill_occurrences (space_id, bill_id);
create index on app.bill_occurrences (space_id, entry_id);

-- ===== Anggaran (hanya kategori induk pengeluaran) =====
create table app.budgets (
  space_id         uuid not null,
  category_id      uuid not null,
  category_type    app.category_type not null default 'expense' check (category_type = 'expense'),
  category_is_root boolean not null default true check (category_is_root),
  month            date not null check (extract(day from month) = 1),
  amount           bigint not null check (amount > 0 and amount <= 10000000000000),
  wajib            boolean not null default false,
  updated_by       uuid not null references auth."user" (id) on delete restrict,
  updated_at       timestamptz not null default now(),
  primary key (space_id, category_id, month),
  foreign key (space_id, category_id, category_type, category_is_root)
    references app.categories (space_id, id, type, is_root) on delete restrict
);
create index on app.budgets (space_id, month) where wajib;
create index on app.budgets (space_id, category_id, category_type, category_is_root);
create index on app.budgets (updated_by);

create table app.no_spend_days (
  space_id  uuid not null references app.spaces on delete restrict,
  on_date   date not null,
  marked_by uuid not null references auth."user" (id) on delete restrict,
  marked_at timestamptz not null default now(),
  primary key (space_id, on_date)
);
create index on app.no_spend_days (marked_by);

-- ===== Undangan =====
create table app.invitations (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households on delete restrict,
  email        text not null check (email = lower(btrim(email))
                                    and length(email) between 3 and 254
                                    and position('@' in email) > 1),
  token_hash   bytea not null unique check (length(token_hash) = 32),
  created_by   uuid not null references auth."user" (id) on delete restrict,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  revoke_reason text check (revoke_reason in ('revoked', 'declined', 'resent', 'expired')),
  used_at      timestamptz,
  used_by      uuid references auth."user" (id) on delete restrict,
  check (expires_at = created_at + interval '72 hours'),
  check ((revoked_at is null) = (revoke_reason is null)),
  check ((used_at is null) = (used_by is null)),
  check (used_at is null or revoked_at is null)
);
create unique index invitations_one_open on app.invitations (household_id)
  where used_at is null and revoked_at is null;
create index on app.invitations (household_id);
create index on app.invitations (email) where used_at is null and revoked_at is null;
create index on app.invitations (created_by);
create index on app.invitations (used_by);

-- ===== Metrik produk (tanpa nominal/deskripsi; keputusan pemilik #15) =====
-- Satu sesi Catat = flow_id sama. catat_disimpan/catat_batal membawa jumlah ketukan dan durasi,
-- sehingga median waktu catat dan porsi catatan <= 3 ketukan bisa dihitung tanpa nominal.
create table app.product_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth."user" (id) on delete restrict,
  space_kind  app.space_kind,
  event       text not null check (event in ('catat_dibuka', 'catat_disimpan', 'catat_batal',
                                             'tanpa_pengeluaran')),
  flow_id     uuid,
  taps        smallint check (taps between 0 and 100),
  duration_ms int check (duration_ms between 0 and 3600000),
  at          timestamptz not null default now(),
  check (event not in ('catat_disimpan', 'catat_batal')
         or (flow_id is not null and taps is not null and duration_ms is not null))
);
create index on app.product_events (user_id, at);

-- ===== Audit & job =====
create table audit.events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  event      text not null check (event in (
               'login_success', 'login_failed', 'logout', 'step_up',
               'password_reset_requested', 'password_reset_done',
               'factor_added', 'factor_removed', 'recovery_code_used', 'recovery_codes_regenerated',
               'session_revoked', 'invitation_created', 'invitation_revoked', 'invitation_declined',
               'invitation_accepted', 'space_member_change', 'unfinished_user_purged',
               'export', 'space_move', 'entry_purged', 'purge_voided', 'db_manual_access', 'deploy')),
  ip         inet,
  user_agent text check (length(user_agent) <= 200),
  space_id   uuid,
  -- Daftar kunci yang diizinkan (bukan daftar larangan), nilai skalar saja, maksimal 1 kB.
  meta       jsonb not null default '{}'::jsonb
             check (jsonb_typeof(meta) = 'object'
                    and meta - array['count', 'reason', 'method', 'op', 'job', 'status', 'via',
                                     'target', 'amr'] = '{}'::jsonb
                    and not jsonb_path_exists(meta, '$.* ? (@.type() == "object" || @.type() == "array")')
                    and length(meta::text) <= 1024)
);
create index on audit.events (user_id, at desc);
create index on audit.events (at);

create table jobs.job_runs (
  id          bigint generated always as identity primary key,
  job         text not null check (job ~ '^[a-z_]{1,40}$'),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'ok', 'failed')),
  error_code  text check (length(error_code) <= 40),
  rows        int
);
create index on jobs.job_runs (job, started_at desc);
```

## 7. Helper, cek bentuk, dan trigger

- `app.my_space_ids()` dan `app.space_roster()` adalah satu-satunya fungsi baca `SECURITY DEFINER` (spec §9.1). Tes katalog mengunci daftar ini.
- Cek bentuk lines dan pasangan `space_transfer` berjalan sebagai constraint trigger `DEFERRABLE INITIALLY DEFERRED`. Setiap fungsi `api.*` membuka dengan `set constraints all deferred` dan menutup dengan `set constraints all immediate`, sehingga pelanggaran muncul sebagai `DK500` di dalam fungsi dan pgTAP (yang selalu rollback) ikut menguji (spec §9.1).
- Fungsi trigger dan cek yang perlu melihat kedua kaki pasangan dimiliki `dompetku_owner` (DEFINER), tanpa `EXECUTE` untuk role login.
- Kewajiban XOR dibandingkan pada kategori induk per bulan, di bawah advisory lock per ruang. Memindah induk kategori yang dipakai tagihan atau anggaran ditolak (`category_in_obligation`), sehingga XOR tidak bisa dilewati lewat `update_category`.
- `entry_history` dan `audit.events` append-only: UPDATE dan TRUNCATE selalu ditolak; DELETE hanya bila GUC lokal `dompetku.purge = 'on'`, yang diisi fungsi purge milik owner (`private.purge_entries`, `jobs.purge_audit`). Hanya owner yang punya hak DELETE, jadi GUC ini pagar terhadap salah ketik di sesi admin, bukan batas keamanan; akses admin dicatat terpisah (TRD §3.4).

```sql
-- migrate:up
-- ===== Keanggotaan (DEFINER, daftar tertutup spec §9.1) =====
create function app.my_space_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.space_id), '{}')
  from app.space_members m
  where m.user_id = app.current_user_id()
$$;

create function app.space_roster(p_space_id uuid)
returns table (user_id uuid, display_name text, initial text)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.display_name, p.initial
  from app.space_members m
  join app.profiles p on p.user_id = m.user_id
  where m.space_id = p_space_id
    and p_space_id = any (app.my_space_ids())
$$;

create function app.assert_member(p_space_id uuid) returns void
language plpgsql stable set search_path = '' as $$
begin
  if app.current_user_id() is null then
    raise exception using errcode = 'DK401', message = 'unauthenticated';
  end if;
  if p_space_id is null or not (p_space_id = any (app.my_space_ids())) then
    raise exception using errcode = 'DK404', message = 'space_not_found';
  end if;
end $$;

-- ===== Helper untuk fungsi api.* (dimiliki dompetku_api) =====
create function private.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid := app.current_user_id();
begin
  perform private.require_read_committed();
  if v is null then
    raise exception using errcode = 'DK401', message = 'unauthenticated';
  end if;
  return v;
end $$;

create function private.req_hash(p jsonb) returns bytea
language sql immutable set search_path = '' as $$
  select pg_catalog.sha256(pg_catalog.convert_to(p::text, 'UTF8'))
$$;

-- NULL = kunci baru (lanjutkan); selain itu = hasil lama untuk diputar ulang.
create function private.idem_begin(p_uid uuid, p_client_id uuid, p_op text, p_hash bytea)
returns jsonb
language plpgsql set search_path = '' as $$
declare v app.idempotency_keys%rowtype;
begin
  if p_client_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'client_id';
  end if;
  insert into app.idempotency_keys (user_id, client_id, op, request_hash)
  values (p_uid, p_client_id, p_op, p_hash)
  on conflict (user_id, client_id) do nothing;
  if found then
    return null;
  end if;
  select * into v from app.idempotency_keys where user_id = p_uid and client_id = p_client_id;
  if v.op <> p_op or v.request_hash <> p_hash or v.result is null then
    raise exception using errcode = 'DK410', message = 'idempotency_key_reused';
  end if;
  return v.result || jsonb_build_object('replayed', true);
end $$;

create function private.idem_finish(p_uid uuid, p_client_id uuid, p_result jsonb) returns jsonb
language plpgsql set search_path = '' as $$
begin
  update app.idempotency_keys set result = p_result
   where user_id = p_uid and client_id = p_client_id;
  return p_result || jsonb_build_object('replayed', false);
end $$;

-- Kunci akun urut id, lalu kembalikan yang terlihat (RLS dompetku_api).
create function private.lock_accounts(p_ids uuid[]) returns void
language sql set search_path = '' as $$
  select null from app.accounts a where a.id = any (p_ids) order by a.id for no key update
$$;

create function private.get_account(p_id uuid, p_detail text) returns app.accounts
language plpgsql stable set search_path = '' as $$
declare v app.accounts%rowtype;
begin
  select * into v from app.accounts where id = p_id;
  if v.id is null or not (v.space_id = any (app.my_space_ids())) then
    raise exception using errcode = 'DK404', message = 'account_not_found', detail = p_detail;
  end if;
  return v;
end $$;

create function private.balance(p_account_id uuid) returns bigint
language sql stable set search_path = '' as $$
  select coalesce(sum(l.amount), 0)::bigint
  from app.entry_lines l join app.entries e on e.id = l.entry_id
  where l.account_id = p_account_id and e.voided_at is null
$$;

-- Tolak saldo negatif hanya bila mutasi ini mengurangi saldo (round2 A10).
create function private.assert_balance(p_account_id uuid, p_delta bigint, p_allow boolean)
returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_delta < 0 and not coalesce(p_allow, false) and private.balance(p_account_id) < 0 then
    raise exception using errcode = 'DK422', message = 'saldo_negatif', detail = 'account_id';
  end if;
end $$;

create function private.entry_snapshot(p_entry_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select to_jsonb(e) || jsonb_build_object('lines', coalesce(
           (select jsonb_agg(to_jsonb(l) order by l.role)
              from app.entry_lines l where l.entry_id = e.id), '[]'::jsonb))
  from app.entries e where e.id = p_entry_id
$$;

create function private.write_history(p_entry_id uuid, p_op app.history_op, p_uid uuid)
returns void
language sql set search_path = '' as $$
  insert into app.entry_history (entry_id, space_id, version, op, snapshot, changed_by)
  select e.id, e.space_id, e.version, p_op, private.entry_snapshot(e.id), p_uid
  from app.entries e where e.id = p_entry_id
$$;

create function private.check_date(p_on date) returns date
language plpgsql stable set search_path = '' as $$
declare v date := coalesce(p_on, app.today());
begin
  if v < date '2000-01-01' or v > app.today() then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'occurred_on';
  end if;
  return v;
end $$;

create function private.check_amount(p_amount bigint, p_detail text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_amount is null or p_amount <= 0 or p_amount > 10000000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = p_detail;
  end if;
end $$;

create function private.clean_text(p text, p_detail text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(p), '');
begin
  if length(v) > 200 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = p_detail;
  end if;
  return v;
end $$;

-- ===== Cek bentuk & pasangan (DEFINER milik owner, melihat kedua kaki) =====
create function private.assert_space_transfer_pair(p_link_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select count(*)                                       as n,
         count(distinct e.space_id)                     as n_space,
         count(*) filter (where e.space_kind = 'shared') as n_shared,
         count(distinct e.occurred_on)                  as n_date,
         count(distinct (e.voided_at is null))          as n_void_state,
         count(*) filter (where e.direction = 'out' and l.amount < 0) as n_out,
         count(*) filter (where e.direction = 'in'  and l.amount > 0) as n_in,
         coalesce(sum(l.amount), 0)                     as net,
         bool_or(a.pocket = 'kantor')                   as any_kantor
    into r
    from app.entries e
    join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
    join app.accounts a    on a.id = l.account_id
   where e.link_id = p_link_id;
  if r.n = 0 then
    return;                                            -- pasangan sudah dipurge
  end if;
  if not (r.n = 2 and r.n_space = 2 and r.n_shared >= 1 and r.n_date = 1
          and r.n_void_state = 1 and r.n_out = 1 and r.n_in = 1 and r.net = 0
          and not r.any_kantor) then
    raise exception using errcode = 'DK500', message = 'space_transfer_pair_invalid';
  end if;
end $$;

-- Matriks bentuk lines per kind (round1/backend R2, rumus fee §9.1).
create function private.assert_entry_shape(p_entry_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e  app.entries%rowtype;
  m  app.entry_lines%rowtype;
  c  app.entry_lines%rowtype;
  f  app.entry_lines%rowtype;
  ok boolean;
begin
  select * into e from app.entries where id = p_entry_id;
  if not found then
    return;
  end if;
  select * into m from app.entry_lines where entry_id = p_entry_id and role = 'main';
  select * into c from app.entry_lines where entry_id = p_entry_id and role = 'counter';
  select * into f from app.entry_lines where entry_id = p_entry_id and role = 'fee';

  ok := m.entry_id is not null
        and (f.entry_id is null or (f.amount < 0 and f.account_id = m.account_id));
  ok := ok and case
    when e.kind = 'income'  then c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'expense' then c.entry_id is null and f.entry_id is null and m.amount < 0
    when e.kind = 'reimbursement' then c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'transfer' then
         c.entry_id is not null and m.amount < 0 and c.amount = -m.amount
         and c.account_id <> m.account_id
    when e.kind = 'space_transfer' then
         c.entry_id is null
         and case e.direction when 'out' then m.amount < 0
                              else m.amount > 0 and f.entry_id is null end
    when e.kind = 'opening_balance' then
         c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'adjustment' then c.entry_id is null and f.entry_id is null
    else false
  end;
  if not ok then
    raise exception using errcode = 'DK500', message = 'entry_shape_invalid';
  end if;
  if e.kind = 'space_transfer' then
    perform private.assert_space_transfer_pair(e.link_id);
  end if;
end $$;

create function private.tg_entry_shape() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'entry_lines' then
    perform private.assert_entry_shape(case when tg_op = 'DELETE' then old.entry_id
                                            else new.entry_id end);
  else
    perform private.assert_entry_shape(new.id);
  end if;
  return null;
end $$;

create constraint trigger entry_lines_shape after insert or update or delete on app.entry_lines
  deferrable initially deferred for each row execute function private.tg_entry_shape();
create constraint trigger entries_shape after insert or update on app.entries
  deferrable initially deferred for each row execute function private.tg_entry_shape();

-- ===== Trigger penjaga lain =====
create function private.tg_space_member_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s app.spaces%rowtype;
begin
  select * into s from app.spaces where id = new.space_id;
  if s.kind = 'personal' and new.user_id <> s.owner_user_id then
    raise exception using errcode = 'DK422', message = 'personal_space_owner_only';
  end if;
  return new;
end $$;
create trigger space_member_guard before insert or update on app.space_members
  for each row execute function private.tg_space_member_guard();

create function private.tg_category_depth() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Pindah induk kategori yang dipakai kewajiban akan mengubah kategori induk pembanding XOR.
  if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id
     and (exists (select 1 from app.bills b where b.category_id = new.id)
          or exists (select 1 from app.budgets bu where bu.category_id = new.id)) then
    raise exception using errcode = 'DK422', message = 'category_in_obligation';
  end if;
  if new.parent_id is not null then
    if exists (select 1 from app.categories p where p.id = new.parent_id and p.parent_id is not null)
       or exists (select 1 from app.categories ch where ch.parent_id = new.id) then
      raise exception using errcode = 'DK422', message = 'category_depth';
    end if;
  end if;
  return new;
end $$;
create trigger category_depth before insert or update of parent_id on app.categories
  for each row execute function private.tg_category_depth();

-- Kewajiban = tagihan ATAU anggaran wajib, tidak pernah keduanya (m0a-keputusan).
-- Dibandingkan pada kategori induk; berlaku per bulan.
create function private.tg_obligation_xor() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_conflict boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dompetku.obligation:' || new.space_id));
  if tg_table_name = 'budgets' then
    if not new.wajib then
      return new;
    end if;
    select exists (
      select 1 from app.bills b
      join app.categories c on c.id = b.category_id
      where b.space_id = new.space_id and b.archived_at is null
        and coalesce(c.parent_id, c.id) = new.category_id
        and b.starts_on < (new.month + interval '1 month')::date
        and (b.ends_on is null or b.ends_on >= new.month)
    ) into v_conflict;
  else
    if new.archived_at is not null then
      return new;
    end if;
    select exists (
      select 1 from app.budgets bu
      join app.categories c on c.id = new.category_id
      where bu.space_id = new.space_id and bu.wajib
        and bu.category_id = coalesce(c.parent_id, c.id)
        and bu.month >= (new.starts_on - (extract(day from new.starts_on)::int - 1))
        and (new.ends_on is null or bu.month <= new.ends_on)
    ) into v_conflict;
  end if;
  if v_conflict then
    raise exception using errcode = 'DK422', message = 'obligation_double';
  end if;
  return new;
end $$;
create trigger budgets_obligation_xor before insert or update on app.budgets
  for each row execute function private.tg_obligation_xor();
create trigger bills_obligation_xor before insert or update on app.bills
  for each row execute function private.tg_obligation_xor();

-- Append-only: UPDATE dan TRUNCATE selalu ditolak; DELETE hanya di dalam fungsi purge
-- (GUC lokal dompetku.purge = 'on'), termasuk cascade dari entries.
create function private.tg_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_catalog.current_setting('dompetku.purge', true) = 'on' then
    return old;
  end if;
  raise exception using errcode = 'DK422', message = 'append_only';
end $$;
create trigger entry_history_append_only before update or delete on app.entry_history
  for each row execute function private.tg_append_only();
create trigger audit_events_append_only before update or delete on audit.events
  for each row execute function private.tg_append_only();
create trigger entry_history_no_truncate before truncate on app.entry_history
  for each statement execute function private.tg_append_only();
create trigger audit_events_no_truncate before truncate on audit.events
  for each statement execute function private.tg_append_only();
```

## 8. Baca: view dan fungsi

### 8.1 Klasifikasi laporan

Aturan pertama yang cocok menang. Turunan: Pemasukan = Σ `income`; Pengeluaran = Σ |`expense`| + Σ |`expense_fee`|; Selisih = Pemasukan − Pengeluaran. Spec §9.1 menyebut 15 kelas; M1 memakai 13 kelas di bawah, sisanya (`x_pokok_utang`, `x_pelunasan_utang`, `x_valuasi`) ditambah bersama `entry_kind` utang dan valuasi di M3 dan M4.

| #   | Kondisi line                                    | Kelas               | Masuk pemasukan/pengeluaran |
| --- | ----------------------------------------------- | ------------------- | --------------------------- |
| 1   | dompet `pocket = 'kantor'`                      | `x_kantor`          | tidak                       |
| 2   | `role = 'fee'` pada `transfer`/`space_transfer` | `expense_fee`       | pengeluaran                 |
| 3   | `income`                                        | `income`            | pemasukan                   |
| 4   | `expense` + `reimbursable`                      | `x_talangan`        | tidak                       |
| 5   | `expense`                                       | `expense`           | pengeluaran                 |
| 6   | `space_transfer`, Pribadi, `out`                | `x_setor_bersama`   | tidak                       |
| 7   | `space_transfer`, Pribadi, `in`                 | `x_ambil_bersama`   | tidak                       |
| 8   | `space_transfer`, Bersama, `in`                 | `x_setoran_anggota` | tidak (Kontribusi)          |
| 9   | `space_transfer`, Bersama, `out`                | `x_diambil_anggota` | tidak                       |
| 10  | `transfer`                                      | `x_transfer`        | tidak                       |
| 11  | `reimbursement`                                 | `x_reimburse`       | tidak                       |
| 12  | `opening_balance`, `adjustment`                 | `x_koreksi`         | tidak                       |

Aturan 1 menang atas aturan 2: fee yang dibayar dari dompet kantor berkelas `x_kantor` dan masuk `month_summary.kantor_keluar`, bukan pengeluaran pribadi (keputusan pemilik #7). `budget_progress` hanya menjumlah kelas `expense`, jadi `expense_fee` (tanpa kategori) tidak mengurangi anggaran mana pun.

### 8.2 Rumus "aman dipakai"

`total = Σ saldo dompet operasional − Σ tagihan belum dibayar jatuh tempo ≤ akhir bulan (termasuk lewat) − Σ max(0, anggaran wajib − realisasi)`; `per_day = floor(total / sisa hari termasuk hari ini)`. Sama dengan `safeToSpend` demo (m0a-keputusan T6). Tagihan terarsip dan kemunculan yang dilewati tidak dihitung; kemunculan sebelum bulan tagihan dibuat tidak pernah ada (§2.2 butir 6). Dompet terarsip bersaldo 0 (§2.2 butir 4). Default sampai akhir bulan; tanggal gajian per orang (`profiles.payday_day`) disimpan, rumusnya diputuskan di §8.2a.

### 8.2a Periode gajian (disetujui pemilik 2026-10-31)

Masalah: gaji tanggal 25 membiayai bulan berikutnya. Dengan bulan kalender, setelah gajian "aman dipakai" hanya menghitung sampai akhir bulan, padahal uang itu harus cukup sampai gajian berikutnya; tagihan dan anggaran wajib awal bulan depan tidak ikut dipotong.

Aturan gajian disimpan per rumah tangga (`app.households.payday_rule`, Novanda dan Farida sama-sama tanggal 25) dan berlaku untuk **Pribadi dan Bersama**; `profiles.payday_day` tetap ada sebagai pengecualian per orang bila kelak berbeda.

- **Hari gajian efektif** = `payday_day` (25); bila jatuh di Sabtu, Minggu, atau tanggal di tabel `app.holidays` (libur nasional dan cuti bersama), mundur ke hari kerja sebelumnya. Contoh: 25 Okt 2026 hari Minggu → Jumat 23 Okt; 25 Des 2026 libur Natal → Kamis 24 Des (atau 23 Des bila 24 Des ditetapkan cuti bersama).
- **Periode anggaran** = dari hari gajian efektif sampai sehari sebelum gajian efektif berikutnya, diberi nama bulan yang dibiayainya. Contoh: periode "November 2026" = 23 Okt sampai 24 Nov 2026. Anggaran (Pribadi dan Bersama), realisasinya, dan review bulanan memakai periode ini.
- **Aman dipakai** (per ruang) = Σ saldo dompet operasional ruang itu − Σ tagihan ruang itu belum dibayar yang jatuh tempo sebelum gajian efektif berikutnya (termasuk lewat) − Σ max(0, anggaran wajib periode berjalan − realisasi periode berjalan); `per_day` dibagi sisa hari sampai sehari sebelum gajian berikutnya.
- **Laporan dan ringkasan** tetap bisa dilihat per bulan kalender (pilihan tampilan); angka uangnya sama, hanya pemotongan tanggalnya yang berbeda.
- **`app.holidays`** diisi dari SKB libur nasional dan cuti bersama, diperbarui sekali setahun (pengingat di job Desember). Bila tabel kosong untuk tahun itu, hanya akhir pekan yang dihitung dan Beranda memberi tanda.
- Bila aturan gajian rumah tangga kosong, semua ruang memakai bulan kalender seperti sekarang.
- Waktu: S9 (anggaran dan "aman dipakai" nyata). Skema: kolom `payday_rule` di `app.households` (override per orang lewat `profiles.payday_day`), tabel `app.holidays`, fungsi `app.pay_period(space, date)` sebagai satu sumber untuk anggaran, aman dipakai, dan review bulanan.

Alternatif yang ditolak: bulan kalender + horizon sampai gajian (anggaran wajib bulan depan diprorata). Lebih sedikit perubahan, tapi kewajiban seperti SPP atau cicilan bukan biaya harian sehingga prorata menyesatkan.

```sql
-- migrate:up
-- ===== Saldo =====
create view app.account_balances with (security_invoker = true) as
select a.space_id, a.id as account_id, a.pocket,
       coalesce(sum(l.amount) filter (where e.voided_at is null), 0)::bigint as balance
from app.accounts a
left join app.entry_lines l on l.account_id = a.id
left join app.entries     e on e.id = l.entry_id
group by a.space_id, a.id, a.pocket;

-- ===== Klasifikasi laporan: satu sumber aturan (spec §9.1, data-engineer §2a) =====
create function app.report_class(
  p_kind app.entry_kind, p_role app.line_role, p_pocket app.pocket,
  p_space_kind app.space_kind, p_direction app.entry_direction, p_reimbursable boolean
) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_pocket = 'kantor'                                         then 'x_kantor'
    when p_role = 'fee' and p_kind in ('transfer', 'space_transfer') then 'expense_fee'
    when p_kind = 'income'                                           then 'income'
    when p_kind = 'expense' and p_reimbursable                       then 'x_talangan'
    when p_kind = 'expense'                                          then 'expense'
    when p_kind = 'space_transfer' then
      case when p_space_kind = 'personal'
           then case p_direction when 'out' then 'x_setor_bersama'   else 'x_ambil_bersama'   end
           else case p_direction when 'in'  then 'x_setoran_anggota' else 'x_diambil_anggota' end
      end
    when p_kind = 'transfer'                                         then 'x_transfer'
    when p_kind = 'reimbursement'                                    then 'x_reimburse'
    when p_kind in ('opening_balance', 'adjustment')                 then 'x_koreksi'
  end
$$;

create view app.report_lines with (security_invoker = true, security_barrier = true) as
select l.space_id, e.space_kind, l.entry_id, l.role, e.kind as entry_kind, e.direction,
       e.occurred_on, l.account_id, a.pocket, l.amount, e.category_id,
       coalesce(c.parent_id, c.id) as root_category_id, e.created_by,
       app.report_class(e.kind, l.role, a.pocket, e.space_kind, e.direction, e.reimbursable)
         as report_class
from app.entry_lines l
join app.entries  e on e.space_id = l.space_id and e.id = l.entry_id
join app.accounts a on a.space_id = l.space_id and a.id = l.account_id
left join app.categories c on c.space_id = e.space_id and c.id = e.category_id
where e.voided_at is null;

-- Tagihan per jatuh tempo, bentuk Bill di packages/demo-data.
create view app.bill_schedule with (security_invoker = true) as
select o.id, o.space_id, o.bill_id, b.name, o.amount, o.due_on, o.skipped_at,
       (o.entry_id is not null and e.voided_at is null) as posted,
       (b.archived_at is not null) as bill_archived
from app.bill_occurrences o
join app.bills b on b.id = o.bill_id
left join app.entries e on e.id = o.entry_id;

-- ===== Fungsi baca (SECURITY INVOKER: RLS tetap berlaku) =====
create function api.period_summary(p_space_id uuid, p_from date, p_to date)
returns table (report_class text, inflow bigint, outflow bigint, entry_count int)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3660 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'period';
  end if;
  return query
  select r.report_class,
         coalesce(sum(r.amount) filter (where r.amount > 0), 0)::bigint,
         coalesce(-sum(r.amount) filter (where r.amount < 0), 0)::bigint,
         count(distinct r.entry_id)::int
  from app.report_lines r
  where r.space_id = p_space_id and r.occurred_on between p_from and p_to
  group by r.report_class
  order by r.report_class;
end $$;

-- Bentuk MonthSummary di demo-data (kantor dipecah, §2.2 butir 3). p_month = hari pertama bulan.
-- kantor_masuk  = Σ pemasukan di dompet kantor.
-- kantor_keluar = Σ pengeluaran + fee transfer di dompet kantor (keputusan pemilik #7).
-- transfer      = Σ |main| per entri transfer/space_transfer, tanpa melihat jenis dompet.
-- Saldo awal, koreksi, dan transfer dari/ke kantor tidak masuk kantor_masuk/keluar.
create function api.month_summary(p_space_id uuid, p_month date)
returns table (pemasukan bigint, pengeluaran bigint, selisih bigint,
               kantor_masuk bigint, kantor_keluar bigint, transfer bigint)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'month';
  end if;
  return query
  with t as (
    select
      coalesce(sum(r.amount) filter (where r.report_class = 'income'), 0)::bigint as inc,
      coalesce(-sum(r.amount) filter (where r.report_class in ('expense', 'expense_fee')), 0)::bigint
        as exp,
      coalesce(sum(r.amount) filter (where r.report_class = 'x_kantor'
                                    and r.entry_kind = 'income'), 0)::bigint as kan_in,
      coalesce(-sum(r.amount) filter (where r.report_class = 'x_kantor'
                                     and (r.entry_kind = 'expense' or r.role = 'fee')), 0)::bigint
        as kan_out,
      coalesce(sum(abs(r.amount)) filter (where r.entry_kind in ('transfer', 'space_transfer')
                                         and r.role = 'main'), 0)::bigint as trf
    from app.report_lines r
    where r.space_id = p_space_id
      and r.occurred_on >= p_month and r.occurred_on < (p_month + interval '1 month')::date
  )
  select inc, exp, inc - exp, kan_in, kan_out, trf from t;
end $$;

create function api.budget_progress(p_space_id uuid, p_month date)
returns table (category_id uuid, amount bigint, wajib boolean, spent bigint, pct int)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'month';
  end if;
  return query
  with spent as (
    select r.root_category_id, (-sum(r.amount))::bigint as amt
    from app.report_lines r
    where r.space_id = p_space_id and r.report_class = 'expense'
      and r.occurred_on >= p_month and r.occurred_on < (p_month + interval '1 month')::date
    group by r.root_category_id
  )
  select b.category_id, b.amount, b.wajib, coalesce(s.amt, 0)::bigint,
         floor(coalesce(s.amt, 0) * 100.0 / b.amount)::int
  from app.budgets b
  left join spent s on s.root_category_id = b.category_id
  where b.space_id = p_space_id and b.month = p_month
  order by b.category_id;
end $$;

-- "Aman dipakai" sampai akhir bulan (rumus m0a-keputusan T6, selector safeToSpend).
create function api.safe_to_spend(p_space_id uuid, p_today date default null)
returns table (operasional bigint, bills_until_eom bigint, budget_wajib_remaining bigint,
               total bigint, per_day bigint, days_left int, until date)
language plpgsql stable set search_path = '' as $$
declare
  v_today date := coalesce(p_today, app.today());
  v_month date := (v_today - (extract(day from v_today)::int - 1));
  v_until date := ((v_month + interval '1 month')::date - 1);
  v_ops   bigint;
  v_bills bigint;
  v_wajib bigint;
  v_days  int;
begin
  perform app.assert_member(p_space_id);
  select coalesce(sum(ab.balance), 0)::bigint into v_ops
    from app.account_balances ab
    join app.accounts a on a.id = ab.account_id
   where ab.space_id = p_space_id and ab.pocket = 'operasional' and a.archived_at is null;
  select coalesce(sum(bs.amount), 0)::bigint into v_bills
    from app.bill_schedule bs
   where bs.space_id = p_space_id and not bs.posted and bs.skipped_at is null
     and not bs.bill_archived and bs.due_on <= v_until;
  select coalesce(sum(greatest(0, bp.amount - bp.spent)), 0)::bigint into v_wajib
    from api.budget_progress(p_space_id, v_month) bp
   where bp.wajib;
  v_days := v_until - v_today + 1;
  return query select v_ops, v_bills, v_wajib, v_ops - v_bills - v_wajib,
    case when v_days > 0 then floor((v_ops - v_bills - v_wajib)::numeric / v_days)::bigint
         else v_ops - v_bills - v_wajib end,
    v_days, v_until;
end $$;

-- Net worth ruang = operasional + tabungan; Kas Kantor dikecualikan (m0a-keputusan T11).
-- Dompet terarsip ikut dijumlah, tetapi saldonya selalu 0 (api.archive_account), jadi sama
-- dengan himpunan dompet di safe_to_spend.
create function api.net_worth(p_space_id uuid)
returns table (operasional bigint, tabungan bigint, kantor_excluded bigint, total bigint)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  with s as (
    select coalesce(sum(ab.balance) filter (where ab.pocket = 'operasional'), 0)::bigint as o,
           coalesce(sum(ab.balance) filter (where ab.pocket = 'tabungan'), 0)::bigint as t,
           coalesce(sum(ab.balance) filter (where ab.pocket = 'kantor'), 0)::bigint as k
    from app.account_balances ab
    where ab.space_id = p_space_id
  )
  select o, t, k, o + t from s;
end $$;

-- Feed Bersama dari entry_history: pelaku, op, nominal sesudah dan sebelum.
create function api.activity_feed(p_space_id uuid, p_limit int default 20)
returns table (entry_id uuid, version int, op app.history_op, kind app.entry_kind,
               direction app.entry_direction, actor_id uuid, at timestamptz,
               amount bigint, before bigint)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'limit';
  end if;
  return query
  with h as (
    select h.entry_id, h.version, h.op, (h.snapshot ->> 'kind')::app.entry_kind as kind,
           (h.snapshot ->> 'direction')::app.entry_direction as direction,
           h.changed_by, h.changed_at,
           (select abs((l ->> 'amount')::bigint)
              from jsonb_array_elements(h.snapshot -> 'lines') l
             where l ->> 'role' = 'main') as amount
    from app.entry_history h
    join app.spaces s on s.id = h.space_id and s.kind = 'shared'
    where h.space_id = p_space_id
  )
  select h.entry_id, h.version, h.op, h.kind, h.direction, h.changed_by, h.changed_at, h.amount,
         lag(h.amount) over (partition by h.entry_id order by h.version)
  from h
  where h.kind <> 'opening_balance'
  order by h.changed_at desc, h.entry_id desc, h.version desc
  limit p_limit;
end $$;

-- Sampah (keputusan pemilik #10): entri batal yang masih bisa dipulihkan (<= 90 hari).
-- Pulihkan = api.restore_entry; hapus permanen = api.purge_entry.
create function api.trash_list(p_space_id uuid, p_limit int default 50)
returns table (entry_id uuid, version int, kind app.entry_kind, direction app.entry_direction,
               occurred_on date, description text, amount bigint, voided_at timestamptz,
               voided_by uuid, purge_after timestamptz)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'limit';
  end if;
  return query
  select e.id, e.version, e.kind, e.direction, e.occurred_on, e.description,
         (select abs(l.amount) from app.entry_lines l where l.entry_id = e.id and l.role = 'main'),
         e.voided_at, e.voided_by, e.voided_at + interval '90 days'
  from app.entries e
  where e.space_id = p_space_id and e.voided_at is not null
    and e.voided_at >= app.now() - interval '90 days'
  order by e.voided_at desc, e.id desc
  limit p_limit;
end $$;
```

## 9. Tulis: fungsi `api.*`

### 9.1 Kontrak

- Parameter bernama berawalan `p_`, dipanggil `select api.f(p_x => $1, ...)`. Wrapper TypeScript ditulis tangan dan memvalidasi hasil dengan Zod (round1 backend R8).
- Semua fungsi tulis menerima `p_client_id uuid`, kecuali operasi yang idempoten secara alami (`set_budget`, `delete_budget`, `mark_no_spend_day`, `update_profile`, undangan). Hash permintaan dihitung dari argumen mentah sebelum default tanggal, tanpa `p_allow_negative`.
- Edit dan void menerima `p_expected_version`. Edit memakai semantik ganti-penuh: parameter yang diganti (`p_category_id`, `p_occurred_on`, `p_description`, `p_reimbursable`) tidak punya default, sehingga pemanggil wajib mengirim nilainya (boleh NULL) dan tidak ada field yang terhapus diam-diam.
- Hasil `jsonb`: `{entry_id, version, replayed, warnings[]}` (+ `linked_entry_id`, `link_id`, `affected` bila relevan).
- Ruang diturunkan dari akun. `p_space_id` hanya pemeriksa: berbeda dari ruang akun = `DK422 space_mismatch` (spec §9.1; round2 backend C2).
- Saldo negatif: hanya dicek bila mutasi mengurangi saldo; tanpa `p_allow_negative` = `DK422 saldo_negatif`, tanpa menulis apa pun. UI menampilkan peringatan inline lalu mengirim `p_allow_negative => true` (spec §9.1). Berlaku untuk semua `pocket`, termasuk `tabungan`: "akun aset tidak boleh negatif" di spec §9.1 merujuk tabel aset M4 (saham, emas), bukan dompet.
- Isolasi: setiap fungsi tulis berjalan di READ COMMITTED (§3); `private.require_user()` menolak tingkat lain.
- `space_transfer`: edit dan void hanya oleh pencatat; selain pencatat mendapat `DK404`. Kedua kaki dikunci urut id dan naik versi bersama.
- Urutan lock: entri, lalu akun urut id (`for no key update`).
- Tanggal masa depan ditolak (`DK400 occurred_on`): diputuskan pemilik 2026-10-31. Tagihan dibayar di muka memakai kemunculan tagihan berikutnya, bukan entri bertanggal depan (§15 butir 2).

### 9.2 Kode error

| Kode    | Arti                                               | Pesan/detail                                                                                                                                                                    |
| ------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DK400` | argumen tidak valid                                | `detail` = nama field, tanpa nilai                                                                                                                                              |
| `DK401` | tanpa konteks user                                 |                                                                                                                                                                                 |
| `DK404` | tidak ditemukan **atau** bukan anggota (disamakan) |                                                                                                                                                                                 |
| `DK409` | konflik versi                                      |                                                                                                                                                                                 |
| `DK410` | kunci idempotensi dipakai ulang dengan isi berbeda |                                                                                                                                                                                 |
| `DK422` | aturan bisnis                                      | `message` = kode mesin: `space_mismatch`, `saldo_negatif`, `account_archived`, `before_opening`, `obligation_double`, `opening_locked`, `cross_space_kantor`, `user_limit`, ... |
| `DK500` | bentuk/invarian rusak (bug)                        | alert                                                                                                                                                                           |

Pesan dan detail tidak pernah memuat nominal atau deskripsi. `40001`/`40P01` diulang maksimal 3× di Node.

### 9.3 Akun pertama dan undangan

Akun pertama (Novanda, keputusan pemilik #5):

1. Email Novanda ada di env `AUTH_OWNER_EMAIL`; runbook M0b menyalinnya ke `app.settings.owner_email`. Trigger `user_admission` hanya menerima email itu selama rumah tangga belum ada.
2. Novanda mendaftar, memverifikasi email lewat Resend, mendaftarkan faktor kuat dan kode pemulihan di `/amankan`, lalu `api.bootstrap_owner` membuat rumah tangga, ruang Bersama, ruang Pribadi, dan profil.

Undangan pasangan (keputusan pemilik #2, #3):

1. Novanda (sesi step-up) membuat token 256-bit di Node, mengirim **hash SHA-256** ke `api.create_invitation`, lalu web mengirim tautan berisi token mentah lewat email (Resend) ke alamat undangan. Token mentah tidak pernah masuk DB atau log.
2. Halaman terima undangan memanggil `api.invitation_peek(hash)` tanpa `app.user_id` (rate limit per IP di rute `/terima-undangan`). Fungsi mengisi GUC lokal `app.invite_token_hash`; policy `invitations` hanya mencocokkan baris itu.
3. Farida menolak: `api.decline_invitation(hash)` mencabut undangan (`revoke_reason = 'declined'`). Novanda bisa mengundang lagi.
4. Farida menerima: Better Auth membuat user dengan email dari undangan dan `emailVerified = true` (tautan yang sampai di kotak masuk adalah buktinya). Trigger `user_admission` menolak email tanpa undangan terbuka. Undangan **belum** terpakai; user ini masih setengah jadi (sesi `amr = 'password'`, hanya `/amankan`).
5. Setelah faktor kuat dan kode pemulihan terdaftar, `api.accept_invitation(hash, nama)` (dalam `withUser` user baru) memeriksa email cocok dan terverifikasi, kode pemulihan ada, batas 2 user, lalu memprovisikan ruang dan menandai undangan terpakai. Bila Farida berhenti sebelum langkah ini, ia masuk lagi dengan kata sandi dan diarahkan ke `/amankan`.
6. Salah email atau tautan hilang: Novanda mencabut (`api.revoke_invitation`) atau mengirim ulang (`api.resend_invitation`, boleh dengan email baru). Undangan lama dicabut dengan alasan `resent`.
7. Akun setengah jadi (tanpa profil) dihapus `jobs.purge_unfinished_users` setelah 72 jam dan tidak memakan kuota 2 user.
8. User ketiga ditolak (`user_limit`), baik di trigger pendaftaran maupun saat provisioning.

`api.invitation_peek` adalah fungsi baca DEFINER di luar daftar tertutup spec §9.1 karena dipanggil sebelum login. Review security merekomendasikan menerimanya di daftar tertutup; tes katalog #5 mengunci daftar fungsi DEFINER baca menjadi `app.my_space_ids`, `app.space_roster`, `api.invitation_peek`.

```sql
-- migrate:up
-- Semua fungsi tulis: SECURITY DEFINER milik dompetku_api, search_path = '',
-- dibuka "set constraints all deferred" dan ditutup "set constraints all immediate".

-- ===== Dompet + saldo awal =====
create function api.create_account(
  p_client_id       uuid,
  p_space_id        uuid,
  p_name            text,
  p_pocket          app.pocket,
  p_wallet_type     app.wallet_type,
  p_opened_on       date   default null,
  p_opening_balance bigint default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_on    date;
  v_name  text := nullif(btrim(p_name), '');
  v_kind  app.space_kind;
  v_acc   uuid;
  v_entry uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'create_account', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'name', v_name, 'pocket', p_pocket, 'type', p_wallet_type,
           'on', p_opened_on, 'opening', p_opening_balance)));
  if v_r is not null then
    return v_r;
  end if;
  perform app.assert_member(p_space_id);
  if v_name is null or length(v_name) > 60 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'name';
  end if;
  if p_pocket is null or p_wallet_type is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'pocket';
  end if;
  if p_opening_balance is null or p_opening_balance < 0 or p_opening_balance > 10000000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'opening_balance';
  end if;
  v_on := private.check_date(p_opened_on);
  select s.kind into v_kind from app.spaces s where s.id = p_space_id;
  if p_pocket = 'kantor' and v_kind <> 'personal' then
    raise exception using errcode = 'DK422', message = 'kantor_personal_only';
  end if;

  insert into app.accounts (space_id, space_kind, name, pocket, wallet_type, opened_on, created_by)
  values (p_space_id, v_kind, v_name, p_pocket, p_wallet_type, v_on, v_uid)
  returning id into v_acc;

  if p_opening_balance > 0 then
    insert into app.entries (space_id, space_kind, kind, occurred_on, created_by, updated_by)
    values (p_space_id, v_kind, 'opening_balance', v_on, v_uid, v_uid)
    returning id into v_entry;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    values (v_entry, p_space_id, 'main', v_acc, p_opening_balance);
    perform private.write_history(v_entry, 'create', v_uid);
  end if;

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'account_id', v_acc, 'entry_id', v_entry, 'version', 1, 'warnings', '[]'::jsonb));
end $$;

-- ===== Pemasukan / pengeluaran =====
create function api.create_entry(
  p_client_id      uuid,
  p_space_id       uuid,
  p_account_id     uuid,
  p_kind           app.entry_kind,
  p_amount         bigint,
  p_category_id    uuid    default null,
  p_occurred_on    date    default null,
  p_description    text    default null,
  p_reimbursable   boolean default false,
  p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_desc  text := private.clean_text(p_description, 'description');
  v_on    date;
  v_acc   app.accounts%rowtype;
  v_entry uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  -- Hash dari argumen mentah (p_occurred_on sebelum default), tanpa p_allow_negative.
  v_r := private.idem_begin(v_uid, p_client_id, 'create_entry', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'account', p_account_id, 'kind', p_kind, 'amount', p_amount,
           'category', p_category_id, 'on', p_occurred_on, 'desc', v_desc,
           'reimbursable', coalesce(p_reimbursable, false))));
  if v_r is not null then
    return v_r;
  end if;
  if p_kind is null or p_kind not in ('income', 'expense') then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'kind';
  end if;
  perform private.check_amount(p_amount, 'amount');
  v_on := private.check_date(p_occurred_on);

  perform private.lock_accounts(array[p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if p_space_id is distinct from v_acc.space_id then
    raise exception using errcode = 'DK422', message = 'space_mismatch';
  end if;
  if v_acc.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;
  if v_on < v_acc.opened_on then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;
  if p_category_id is not null and not exists (
       select 1 from app.categories c
       where c.id = p_category_id and c.space_id = v_acc.space_id
         and c.type::text = p_kind::text and c.archived_at is null) then
    raise exception using errcode = 'DK404', message = 'category_not_found';
  end if;
  if coalesce(p_reimbursable, false) and (p_kind <> 'expense' or v_acc.space_kind <> 'personal') then
    raise exception using errcode = 'DK422', message = 'reimbursable_personal_expense_only';
  end if;

  insert into app.entries (space_id, space_kind, kind, occurred_on, description, category_id,
                           reimbursable, created_by, updated_by)
  values (v_acc.space_id, v_acc.space_kind, p_kind, v_on, v_desc, p_category_id,
          coalesce(p_reimbursable, false), v_uid, v_uid)
  returning id into v_entry;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_entry, v_acc.space_id, 'main', v_acc.id,
          case p_kind when 'income' then p_amount else -p_amount end);
  perform private.write_history(v_entry, 'create', v_uid);
  perform private.assert_balance(v_acc.id,
          case p_kind when 'income' then p_amount else -p_amount end, p_allow_negative);

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_entry, 'version', 1, 'warnings', '[]'::jsonb));
end $$;

-- ===== Transfer: satu ruang (1 entri) atau antar ruang (2 entri space_transfer) =====
create function api.create_transfer(
  p_client_id      uuid,
  p_space_id       uuid,
  p_from_account   uuid,
  p_to_account     uuid,
  p_amount         bigint,
  p_fee            bigint  default 0,
  p_occurred_on    date    default null,
  p_description    text    default null,
  p_shared_note    text    default null,
  p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_desc  text := private.clean_text(p_description, 'description');
  v_note  text := private.clean_text(p_shared_note, 'shared_note');
  v_on    date;
  v_from  app.accounts%rowtype;
  v_to    app.accounts%rowtype;
  v_out   uuid;
  v_in    uuid;
  v_link  uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'create_transfer', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'from', p_from_account, 'to', p_to_account, 'amount', p_amount,
           'fee', p_fee, 'on', p_occurred_on, 'desc', v_desc, 'note', v_note)));
  if v_r is not null then
    return v_r;
  end if;
  perform private.check_amount(p_amount, 'amount');
  if p_fee is null or p_fee < 0 or p_fee > 10000000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'fee';
  end if;
  if p_from_account is null or p_to_account is null or p_from_account = p_to_account then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'to_account';
  end if;
  v_on := private.check_date(p_occurred_on);

  perform private.lock_accounts(array[p_from_account, p_to_account]);
  v_from := private.get_account(p_from_account, 'from_account');
  v_to   := private.get_account(p_to_account, 'to_account');
  if p_space_id is distinct from v_from.space_id then
    raise exception using errcode = 'DK422', message = 'space_mismatch';
  end if;
  if v_from.archived_at is not null or v_to.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;
  if v_on < greatest(v_from.opened_on, v_to.opened_on) then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;

  if v_from.space_id = v_to.space_id then
    if v_note is not null then
      raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'shared_note';
    end if;
    insert into app.entries (space_id, space_kind, kind, occurred_on, description, created_by, updated_by)
    values (v_from.space_id, v_from.space_kind, 'transfer', v_on, v_desc, v_uid, v_uid)
    returning id into v_out;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    select v_out, v_from.space_id, r.role, r.account_id, r.amount
      from (values ('main'::app.line_role,    p_from_account, -p_amount),
                   ('counter'::app.line_role, p_to_account,    p_amount),
                   ('fee'::app.line_role,     p_from_account, -p_fee)) as r (role, account_id, amount)
     where r.amount <> 0;
    perform private.write_history(v_out, 'create', v_uid);
  else
    -- Antar ruang: pemanggil sudah terbukti anggota kedua ruang (get_account).
    if 'shared' <> all (array[v_from.space_kind, v_to.space_kind]) then
      raise exception using errcode = 'DK422', message = 'cross_space_not_allowed';
    end if;
    if 'kantor' = any (array[v_from.pocket, v_to.pocket]) then
      raise exception using errcode = 'DK422', message = 'cross_space_kantor';
    end if;
    v_link := gen_random_uuid();
    -- Deskripsi hanya di kaki ruang Pribadi; shared_note hanya di kaki ruang Bersama
    -- (keputusan pemilik #9). Ruang tujuan tidak melihat dompet sumber.
    insert into app.entries (space_id, space_kind, kind, occurred_on, description, shared_note,
                             link_id, direction, created_by, updated_by)
    values (v_from.space_id, v_from.space_kind, 'space_transfer', v_on,
            case when v_from.space_kind = 'personal' then v_desc end,
            case when v_from.space_kind = 'shared' then v_note end,
            v_link, 'out', v_uid, v_uid)
    returning id into v_out;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    select v_out, v_from.space_id, r.role, p_from_account, r.amount
      from (values ('main'::app.line_role, -p_amount),
                   ('fee'::app.line_role,  -p_fee)) as r (role, amount)
     where r.amount <> 0;
    insert into app.entries (space_id, space_kind, kind, occurred_on, description, shared_note,
                             link_id, direction, created_by, updated_by)
    values (v_to.space_id, v_to.space_kind, 'space_transfer', v_on,
            case when v_to.space_kind = 'personal' then v_desc end,
            case when v_to.space_kind = 'shared' then v_note end,
            v_link, 'in', v_uid, v_uid)
    returning id into v_in;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    values (v_in, v_to.space_id, 'main', p_to_account, p_amount);
    perform private.write_history(v_out, 'create', v_uid);
    perform private.write_history(v_in, 'create', v_uid);
  end if;

  perform private.assert_balance(p_from_account, -(p_amount + p_fee), p_allow_negative);
  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_out, 'linked_entry_id', v_in, 'link_id', v_link, 'version', 1,
    'warnings', '[]'::jsonb));
end $$;

-- ===== Ubah pemasukan/pengeluaran (dan saldo awal ≤ 7 hari) =====
create function api.update_entry(
  p_client_id        uuid,
  p_entry_id         uuid,
  p_expected_version int,
  p_account_id       uuid,
  p_amount           bigint,
  p_category_id      uuid,                    -- ganti-penuh: tanpa default (§9.1)
  p_occurred_on      date,                    -- NULL = tanggal lama
  p_description      text,
  p_reimbursable     boolean,
  p_allow_negative   boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_desc text := private.clean_text(p_description, 'description');
  v_e    app.entries%rowtype;
  v_old  app.entry_lines%rowtype;
  v_acc  app.accounts%rowtype;
  v_on   date;
  v_new  bigint;
  v_r    jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'update_entry', private.req_hash(jsonb_build_object(
           'entry', p_entry_id, 'version', p_expected_version, 'account', p_account_id,
           'amount', p_amount, 'category', p_category_id, 'on', p_occurred_on, 'desc', v_desc,
           'reimbursable', coalesce(p_reimbursable, false))));
  if v_r is not null then
    return v_r;
  end if;
  perform private.check_amount(p_amount, 'amount');

  select * into v_e from app.entries where id = p_entry_id for update;
  if v_e.id is null then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  if v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if v_e.voided_at is not null then
    raise exception using errcode = 'DK422', message = 'entry_voided';
  end if;
  if v_e.kind not in ('income', 'expense', 'opening_balance') then
    raise exception using errcode = 'DK422', message = 'kind_not_editable';
  end if;
  select * into v_old from app.entry_lines where entry_id = v_e.id and role = 'main';
  perform private.lock_accounts(array[v_old.account_id, p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.space_id <> v_e.space_id then
    raise exception using errcode = 'DK422', message = 'space_mismatch';
  end if;
  -- Dompet terarsip bersaldo 0 dan harus tetap 0 (keputusan pemilik #8).
  if exists (select 1 from app.accounts a
             where a.id in (v_old.account_id, p_account_id) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  if v_e.kind = 'opening_balance' then
    -- Saldo awal: hanya nominal, akun tetap, maksimal 7 hari sejak dompet dibuat (spec §9.1).
    if p_account_id <> v_old.account_id or app.today() - (
         select (a.created_at at time zone 'Asia/Jakarta')::date
         from app.accounts a where a.id = v_old.account_id) > 7 then
      raise exception using errcode = 'DK422', message = 'opening_locked';
    end if;
    v_on := v_e.occurred_on;
    v_new := p_amount;
  else
    v_on := private.check_date(coalesce(p_occurred_on, v_e.occurred_on));
    if v_on < v_acc.opened_on then
      raise exception using errcode = 'DK422', message = 'before_opening';
    end if;
    if p_category_id is not null and not exists (
         select 1 from app.categories c
         where c.id = p_category_id and c.space_id = v_e.space_id
           and c.type::text = v_e.kind::text and c.archived_at is null) then
      raise exception using errcode = 'DK404', message = 'category_not_found';
    end if;
    if coalesce(p_reimbursable, false) and (v_e.kind <> 'expense' or v_e.space_kind <> 'personal') then
      raise exception using errcode = 'DK422', message = 'reimbursable_personal_expense_only';
    end if;
    v_new := case v_e.kind when 'income' then p_amount else -p_amount end;
  end if;

  update app.entries
     set occurred_on  = v_on,
         description  = case when kind = 'opening_balance' then null else v_desc end,
         category_id  = case when kind = 'opening_balance' then null else p_category_id end,
         reimbursable = case when kind = 'expense' then coalesce(p_reimbursable, false) else false end,
         version      = version + 1,
         updated_by   = v_uid,
         updated_at   = app.now()
   where id = v_e.id;
  delete from app.entry_lines where entry_id = v_e.id;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_e.id, v_e.space_id, 'main', p_account_id, v_new);
  perform private.write_history(v_e.id, 'update', v_uid);

  if p_account_id = v_old.account_id then
    perform private.assert_balance(p_account_id, v_new - v_old.amount, p_allow_negative);
  else
    perform private.assert_balance(v_old.account_id, -v_old.amount, p_allow_negative);
    perform private.assert_balance(p_account_id, v_new, p_allow_negative);
  end if;

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_e.id, 'version', v_e.version + 1, 'warnings', '[]'::jsonb));
end $$;

-- ===== Batalkan / pulihkan (space_transfer: kedua kaki, hanya pencatat) =====
create function private.set_void_state(
  p_client_id uuid, p_entry_id uuid, p_expected_version int, p_void boolean, p_allow_negative boolean
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_op   text := case when p_void then 'void_entry' else 'restore_entry' end;
  v_e    app.entries%rowtype;
  v_ids  uuid[];
  v_accs uuid[];
  v_acc  record;
  v_r    jsonb;
begin
  v_r := private.idem_begin(v_uid, p_client_id, v_op, private.req_hash(jsonb_build_object(
           'entry', p_entry_id, 'version', p_expected_version)));
  if v_r is not null then
    return v_r;
  end if;

  select * into v_e from app.entries where id = p_entry_id;
  if v_e.id is null then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  if v_e.kind = 'space_transfer' then
    -- Edit/void hanya oleh pencatat; selain pencatat mendapat DK404 (spec §9.1, security A1).
    if v_e.created_by <> v_uid then
      raise exception using errcode = 'DK404', message = 'entry_not_found';
    end if;
    select array_agg(id order by id) into v_ids from app.entries where link_id = v_e.link_id;
  else
    v_ids := array[v_e.id];
  end if;
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select * into v_e from app.entries where id = p_entry_id;
  if v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if (v_e.voided_at is not null) = p_void then
    raise exception using errcode = 'DK422',
      message = case when p_void then 'already_voided' else 'not_voided' end;
  end if;
  if p_void and v_e.kind = 'opening_balance' then
    raise exception using errcode = 'DK422', message = 'opening_locked';
  end if;
  if p_void and exists (select 1 from app.entries r
                         where r.reimburses_entry_id = any (v_ids) and r.voided_at is null) then
    raise exception using errcode = 'DK422', message = 'has_dependents';
  end if;
  if not p_void and v_e.voided_at < app.now() - interval '90 days' then
    raise exception using errcode = 'DK422', message = 'restore_window_closed';
  end if;

  select array_agg(distinct account_id order by account_id) into v_accs
    from app.entry_lines where entry_id = any (v_ids);
  perform private.lock_accounts(v_accs);
  if exists (select 1 from app.accounts a where a.id = any (v_accs) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  update app.entries
     set voided_at  = case when p_void then app.now() end,
         voided_by  = case when p_void then v_uid end,
         version    = version + 1,
         updated_by = v_uid,
         updated_at = app.now()
   where id = any (v_ids);
  perform private.write_history(id, case when p_void then 'void' else 'restore' end::app.history_op, v_uid)
     from unnest(v_ids) as id;

  for v_acc in
    select l.account_id, sum(l.amount)::bigint as amt
    from app.entry_lines l where l.entry_id = any (v_ids) group by l.account_id
  loop
    perform private.assert_balance(v_acc.account_id,
            case when p_void then -v_acc.amt else v_acc.amt end, p_allow_negative);
  end loop;

  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_e.id, 'version', v_e.version + 1, 'affected', to_jsonb(v_ids),
    'warnings', '[]'::jsonb));
end $$;

create function api.void_entry(
  p_client_id uuid, p_entry_id uuid, p_expected_version int, p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  set constraints all deferred;
  v := private.set_void_state(p_client_id, p_entry_id, p_expected_version, true, p_allow_negative);
  set constraints all immediate;
  return v;
end $$;

create function api.restore_entry(
  p_client_id uuid, p_entry_id uuid, p_expected_version int, p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  set constraints all deferred;
  v := private.set_void_state(p_client_id, p_entry_id, p_expected_version, false, p_allow_negative);
  set constraints all immediate;
  return v;
end $$;

-- ===== Sampah: hapus permanen entri batal sebelum 90 hari (keputusan pemilik #10) =====
-- Idempoten secara alami: panggilan kedua mendapat DK404 karena entri sudah tidak ada.
create function api.purge_entry(p_entry_id uuid, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_e   app.entries%rowtype;
  v_ids uuid[];
  v_n   int;
begin
  set constraints all deferred;
  select * into v_e from app.entries where id = p_entry_id;
  if v_e.id is null or (v_e.kind = 'space_transfer' and v_e.created_by <> v_uid) then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  if v_e.kind = 'space_transfer' then
    select array_agg(id order by id) into v_ids from app.entries where link_id = v_e.link_id;
  else
    v_ids := array[v_e.id];
  end if;
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select * into v_e from app.entries where id = p_entry_id;
  if v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if v_e.voided_at is null then
    raise exception using errcode = 'DK422', message = 'not_voided';
  end if;
  if exists (select 1 from app.entries r where r.reimburses_entry_id = any (v_ids)) then
    raise exception using errcode = 'DK422', message = 'has_dependents';
  end if;
  v_n := private.purge_entries(v_ids, 'entry_purged');
  set constraints all immediate;
  return jsonb_build_object('affected', to_jsonb(v_ids), 'purged', v_n);
end $$;

-- ===== Cocokkan saldo: terima saldo nyata, DB menghitung selisih =====
create function api.reconcile_balance(p_client_id uuid, p_account_id uuid, p_target_balance bigint)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_acc   app.accounts%rowtype;
  v_diff  bigint;
  v_entry uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'reconcile_balance', private.req_hash(
           jsonb_build_object('account', p_account_id, 'target', p_target_balance)));
  if v_r is not null then
    return v_r;
  end if;
  if p_target_balance is null or abs(p_target_balance) > 10000000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'target_balance';
  end if;
  perform private.lock_accounts(array[p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;
  v_diff := p_target_balance - private.balance(v_acc.id);
  if v_diff <> 0 then
    insert into app.entries (space_id, space_kind, kind, occurred_on, created_by, updated_by)
    values (v_acc.space_id, v_acc.space_kind, 'adjustment', app.today(), v_uid, v_uid)
    returning id into v_entry;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    values (v_entry, v_acc.space_id, 'main', v_acc.id, v_diff);
    perform private.write_history(v_entry, 'create', v_uid);
  end if;
  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_entry, 'version', 1, 'warnings', '[]'::jsonb));
end $$;

-- ===== Arsip dompet: hanya bila saldo 0 (keputusan pemilik #8); idempoten secara alami =====
create function api.archive_account(p_account_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_acc app.accounts%rowtype;
begin
  perform private.lock_accounts(array[p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.archived_at is null then
    if private.balance(v_acc.id) <> 0 then
      raise exception using errcode = 'DK422', message = 'balance_not_zero';
    end if;
    update app.accounts set archived_at = app.now(), updated_at = app.now() where id = v_acc.id;
  end if;
  return jsonb_build_object('account_id', v_acc.id, 'archived', true);
end $$;

-- ===== Kategori =====
create function api.create_category(
  p_client_id uuid, p_space_id uuid, p_type app.category_type, p_name text, p_icon text,
  p_parent_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_id  uuid;
  v_r   jsonb;
begin
  v_r := private.idem_begin(v_uid, p_client_id, 'create_category', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'type', p_type, 'name', btrim(p_name), 'icon', p_icon,
           'parent', p_parent_id)));
  if v_r is not null then
    return v_r;
  end if;
  perform app.assert_member(p_space_id);
  insert into app.categories (space_id, parent_id, type, name, icon)
  values (p_space_id, p_parent_id, p_type, btrim(p_name), p_icon)
  returning id into v_id;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object('category_id', v_id));
end $$;

-- ===== Anggaran (upsert; idempoten secara alami) =====
create function api.set_budget(
  p_space_id uuid, p_category_id uuid, p_month date, p_amount bigint, p_wajib boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform app.assert_member(p_space_id);
  perform private.check_amount(p_amount, 'amount');
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'month';
  end if;
  insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by)
  values (p_space_id, p_category_id, p_month, p_amount, coalesce(p_wajib, false), v_uid)
  on conflict (space_id, category_id, month) do update
     set amount = excluded.amount, wajib = excluded.wajib,
         updated_by = excluded.updated_by, updated_at = app.now();
end $$;

create function api.delete_budget(p_space_id uuid, p_category_id uuid, p_month date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_user();
  perform app.assert_member(p_space_id);
  delete from app.budgets
   where space_id = p_space_id and category_id = p_category_id and month = p_month;
end $$;

-- ===== Tagihan rutin =====
create function api.create_bill(
  p_client_id uuid, p_space_id uuid, p_name text, p_amount bigint, p_category_id uuid,
  p_day_of_month smallint, p_starts_on date, p_ends_on date default null,
  p_account_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_id  uuid;
  v_r   jsonb;
begin
  v_r := private.idem_begin(v_uid, p_client_id, 'create_bill', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'name', btrim(p_name), 'amount', p_amount,
           'category', p_category_id, 'day', p_day_of_month, 'starts', p_starts_on,
           'ends', p_ends_on, 'account', p_account_id)));
  if v_r is not null then
    return v_r;
  end if;
  perform app.assert_member(p_space_id);
  perform private.check_amount(p_amount, 'amount');
  insert into app.bills (space_id, name, amount, category_id, account_id, day_of_month,
                         starts_on, ends_on, created_by)
  values (p_space_id, btrim(p_name), p_amount, p_category_id, p_account_id, p_day_of_month,
          p_starts_on, p_ends_on, v_uid)
  returning id into v_id;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object('bill_id', v_id));
end $$;

-- Bayar tagihan = pengeluaran berkategori tagihan, ditautkan ke kemunculannya.
create function api.post_bill_occurrence(
  p_client_id uuid, p_occurrence_id uuid, p_account_id uuid default null,
  p_occurred_on date default null, p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_o   app.bill_occurrences%rowtype;
  v_b   app.bills%rowtype;
  v_res jsonb;
  v_r   jsonb;
begin
  v_r := private.idem_begin(v_uid, p_client_id, 'post_bill_occurrence', private.req_hash(
           jsonb_build_object('occurrence', p_occurrence_id, 'account', p_account_id,
                              'on', p_occurred_on)));
  if v_r is not null then
    return v_r;
  end if;
  select * into v_o from app.bill_occurrences where id = p_occurrence_id for update;
  if v_o.id is null then
    raise exception using errcode = 'DK404', message = 'bill_not_found';
  end if;
  if v_o.skipped_at is not null or (v_o.entry_id is not null and exists (
       select 1 from app.entries e where e.id = v_o.entry_id and e.voided_at is null)) then
    raise exception using errcode = 'DK422', message = 'already_posted';
  end if;
  select * into v_b from app.bills where id = v_o.bill_id;
  -- Panggil create_entry dengan client_id turunan agar kunci entri unik per pembayaran.
  v_res := api.create_entry(
    p_client_id      => gen_random_uuid(),
    p_space_id       => v_o.space_id,
    p_account_id     => coalesce(p_account_id, v_b.account_id),
    p_kind           => 'expense',
    p_amount         => v_o.amount,
    p_category_id    => v_b.category_id,
    p_occurred_on    => p_occurred_on,
    p_description    => v_b.name,
    p_allow_negative => p_allow_negative);
  update app.bill_occurrences set entry_id = (v_res ->> 'entry_id')::uuid where id = v_o.id;
  return private.idem_finish(v_uid, p_client_id, (v_res - 'replayed')
    || jsonb_build_object('occurrence_id', v_o.id));
end $$;

-- Arsip tagihan: kemunculan terbuka dilewati, tidak dihitung lagi di aman dipakai.
create function api.archive_bill(p_bill_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_b   app.bills%rowtype;
  v_n   int;
begin
  select * into v_b from app.bills where id = p_bill_id for update;
  if v_b.id is null then
    raise exception using errcode = 'DK404', message = 'bill_not_found';
  end if;
  if v_b.archived_at is null then
    update app.bills set archived_at = app.now(), updated_at = app.now() where id = v_b.id;
  end if;
  update app.bill_occurrences set skipped_at = app.now()
   where bill_id = v_b.id and entry_id is null and skipped_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('bill_id', v_b.id, 'skipped', v_n);
end $$;

-- ===== Hari tanpa pengeluaran =====
create function api.mark_no_spend_day(p_space_id uuid, p_on date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform app.assert_member(p_space_id);
  insert into app.no_spend_days (space_id, on_date, marked_by)
  values (p_space_id, private.check_date(p_on), v_uid)
  on conflict (space_id, on_date) do nothing;
end $$;

-- ===== Profil =====
create function api.update_profile(p_display_name text, p_initial text, p_payday_day smallint)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  update app.profiles
     set display_name = btrim(p_display_name), initial = p_initial,
         payday_day = p_payday_day, updated_at = app.now()
   where user_id = v_uid;
end $$;

-- ===== Akun pertama (keputusan pemilik #5): user sudah ada, email = app.settings.owner_email =====
create function api.bootstrap_owner(p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_hh  uuid;
begin
  v_hh := private.provision_user(v_uid, p_display_name, null, null);
  return jsonb_build_object('household_id', v_hh);
end $$;

-- ===== Undangan (token mentah tidak pernah masuk DB; yang dikirim hash SHA-256) =====
create function api.create_invitation(p_email text, p_token_hash bytea) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_hh  uuid;
  v_id  uuid;
  v_now timestamptz := app.now();
begin
  select s.household_id into v_hh
    from app.spaces s join app.space_members m on m.space_id = s.id
   where s.kind = 'shared' and m.user_id = v_uid and m.role = 'owner';
  if v_hh is null then
    raise exception using errcode = 'DK404', message = 'household_not_found';
  end if;
  if (select count(*) from app.space_members m join app.spaces s on s.id = m.space_id
      where s.kind = 'shared') >= 2 then
    raise exception using errcode = 'DK422', message = 'user_limit';
  end if;
  -- Undangan terbuka yang kedaluwarsa dicabut otomatis; yang masih berlaku menolak undangan baru
  -- (pakai api.resend_invitation untuk mengganti).
  update app.invitations set revoked_at = v_now, revoke_reason = 'expired'
   where household_id = v_hh and used_at is null and revoked_at is null and expires_at <= v_now;
  insert into app.invitations (household_id, email, token_hash, created_by, created_at, expires_at)
  values (v_hh, lower(btrim(p_email)), p_token_hash, v_uid, v_now, v_now + interval '72 hours')
  returning id into v_id;
  return jsonb_build_object('invitation_id', v_id, 'expires_at', v_now + interval '72 hours');
end $$;

create function api.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  update app.invitations set revoked_at = app.now(), revoke_reason = 'revoked'
   where id = p_invitation_id and created_by = v_uid and used_at is null and revoked_at is null;
  if not found then
    raise exception using errcode = 'DK404', message = 'invitation_not_found';
  end if;
end $$;

-- Kirim ulang: cabut undangan terbuka (alasan 'resent'), buat yang baru; email boleh dikoreksi.
create function api.resend_invitation(p_invitation_id uuid, p_email text, p_token_hash bytea)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v     app.invitations%rowtype;
begin
  select * into v from app.invitations
   where id = p_invitation_id and created_by = v_uid and used_at is null and revoked_at is null
   for update;
  if v.id is null then
    raise exception using errcode = 'DK404', message = 'invitation_not_found';
  end if;
  update app.invitations set revoked_at = app.now(), revoke_reason = 'resent' where id = v.id;
  return api.create_invitation(coalesce(nullif(btrim(p_email), ''), v.email), p_token_hash);
end $$;

-- Pra-login: tanpa app.user_id. Policy invitations mencocokkan GUC app.invite_token_hash.
create function api.invitation_peek(p_token_hash bytea) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v app.invitations%rowtype;
begin
  perform pg_catalog.set_config('app.invite_token_hash', pg_catalog.encode(p_token_hash, 'hex'), true);
  select * into v from app.invitations where token_hash = p_token_hash;
  if v.id is null or v.used_at is not null or v.revoked_at is not null or v.expires_at <= app.now() then
    raise exception using errcode = 'DK404', message = 'invitation_not_found';
  end if;
  return jsonb_build_object('email', v.email, 'expires_at', v.expires_at);
end $$;

-- Pra-login: penerima menolak, undangan hangus (keputusan pemilik #3).
create function api.decline_invitation(p_token_hash bytea) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_read_committed();
  perform pg_catalog.set_config('app.invite_token_hash', pg_catalog.encode(p_token_hash, 'hex'), true);
  update app.invitations set revoked_at = app.now(), revoke_reason = 'declined'
   where token_hash = p_token_hash and used_at is null and revoked_at is null
     and expires_at > app.now();
  if not found then
    raise exception using errcode = 'DK404', message = 'invitation_not_found';
  end if;
end $$;

-- Dipanggil di withUser user baru SETELAH akun diamankan (faktor kuat + kode pemulihan).
-- user_id diambil dari konteks, bukan parameter.
create function api.accept_invitation(p_token_hash bytea, p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v     app.invitations%rowtype;
begin
  perform pg_catalog.set_config('app.invite_token_hash', pg_catalog.encode(p_token_hash, 'hex'), true);
  select * into v from app.invitations where token_hash = p_token_hash for update;
  if v.id is null or v.used_at is not null or v.revoked_at is not null or v.expires_at <= app.now() then
    raise exception using errcode = 'DK404', message = 'invitation_not_found';
  end if;
  perform private.provision_user(v_uid, p_display_name, v.household_id, v.email);
  update app.invitations set used_at = app.now(), used_by = v_uid where id = v.id;
  return jsonb_build_object('household_id', v.household_id);
end $$;
```

Belum ditulis di draf ini (pola sama, test-first di M1): `api.update_transfer`, `api.move_entry_to_space` ("Pindahkan ke ruang lain", void + buat ulang atomik), `api.update_category`/`archive_category`, `api.update_bill`, `api.skip_bill_occurrence`, `api.create_reimbursement`, `api.open_reimbursables` (daftar talangan terbuka), `api.suggest_categories`, ekspor CSV (M2). `api.archive_account`, `api.archive_bill`, `api.trash_list`, dan `api.purge_entry` sudah ditulis di putaran 2.

Fungsi yang idempoten secara alami (tanpa `p_client_id`) bertambah: `archive_account`, `archive_bill` (panggilan kedua tidak mengubah apa pun), `purge_entry` (panggilan kedua `DK404`), dan fungsi undangan.

## 10. Job, audit, dan cek kualitas data

- Job dimiliki `dompetku_owner` (DEFINER) dan hanya bisa dieksekusi `dompetku_worker`. Kredensial web yang bocor tidak bisa memurge data (round2 backend A3).
- `purge_voided` dan `api.purge_entry` memakai satu fungsi `private.purge_entries`: tombstone dulu, lalu hapus entri (lines dan history ikut cascade, GUC `dompetku.purge` dinyalakan lokal). Pasangan `space_transfer` dipurge berdua. Entri yang dirujuk `reimburses_entry_id` dilewati. Tanpa tabel sementara, sehingga tidak ada relasi tak berskema di fungsi DEFINER.
- `purge_unfinished_users`: user tanpa profil yang dibuat lebih dari 72 jam lalu dihapus (sesi, akun, faktor, dan kode pemulihan ikut cascade di tabel Better Auth); jumlahnya dicatat di audit.
- `audit.log` mengambil `user_id` dari `app.current_user_id()`, bukan dari parameter, dan hanya menerima `space_id` milik ruang pemanggil. Nama event dan kunci `meta` dibatasi CHECK tabel (§6). Event pra-login (`login_failed`, `password_reset_requested`) tersimpan tanpa `user_id`. Batasnya sama dengan RLS (§4): web yang dikuasai penyerang tetap bisa mengisi `app.user_id` sembarang.
- `dq_run` milik `dompetku_auditor`; keluaran hanya id cek dan jumlah pelanggaran, tanpa nominal. Draf memuat DQ01, DQ04, DQ04b, DQ06, DQ09, DQ10; DQ02 (checkpoint), DQ03, DQ05, DQ07, DQ08 ditambah saat tabelnya ada (data-engineer §3).

```sql
-- migrate:up
-- ===== Provisioning user (owner, BYPASSRLS): bootstrap CLI dan terima undangan =====
-- p_household_id NULL = akun pertama (email harus app.settings.owner_email).
create function private.provision_user(
  p_user_id uuid, p_display_name text, p_household_id uuid, p_expected_email text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_hh       uuid := p_household_id;
  v_shared   uuid;
  v_personal uuid;
  v_role     app.member_role := 'member';
  v_name     text := nullif(btrim(p_display_name), '');
  v_email    text;
  v_verified boolean;
begin
  perform private.require_read_committed();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dompetku.user_cap'));
  select lower(u.email), u."emailVerified" into v_email, v_verified
    from auth."user" u where u.id = p_user_id;
  if v_email is null then
    raise exception using errcode = 'DK404', message = 'user_not_found';
  end if;
  if exists (select 1 from app.profiles p where p.user_id = p_user_id) then
    raise exception using errcode = 'DK422', message = 'already_provisioned';
  end if;
  if (select count(*) from app.profiles) >= 2 then
    raise exception using errcode = 'DK422', message = 'user_limit';
  end if;
  if not v_verified then
    raise exception using errcode = 'DK422', message = 'email_unverified';
  end if;
  -- Akun dianggap aman bila kode pemulihan sudah dibuat (langkah terakhir /amankan).
  if not exists (select 1 from auth.recovery_codes rc
                 where rc.user_id = p_user_id and rc.used_at is null) then
    raise exception using errcode = 'DK422', message = 'not_secured';
  end if;
  if v_name is null or length(v_name) > 40 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'display_name';
  end if;
  if v_hh is null then
    if exists (select 1 from app.households) then
      raise exception using errcode = 'DK422', message = 'household_exists';
    end if;
    if not exists (select 1 from app.settings s where s.key = 'owner_email' and s.value = v_email) then
      raise exception using errcode = 'DK422', message = 'not_owner';
    end if;
    -- Bootstrap pemilik: buat rumah tangga + ruang Bersama (hanya sekali, indeks singleton).
    insert into app.households (name) values ('Rumah') returning id into v_hh;
    insert into app.spaces (household_id, kind) values (v_hh, 'shared') returning id into v_shared;
    v_role := 'owner';
  else
    if v_email is distinct from p_expected_email then
      raise exception using errcode = 'DK422', message = 'invitation_email_mismatch';
    end if;
    select id into v_shared from app.spaces where household_id = v_hh and kind = 'shared';
  end if;
  insert into app.spaces (household_id, kind, owner_user_id)
  values (v_hh, 'personal', p_user_id) returning id into v_personal;
  insert into app.space_members (space_id, user_id, role)
  values (v_personal, p_user_id, 'owner'), (v_shared, p_user_id, v_role);
  insert into app.profiles (user_id, display_name, initial)
  values (p_user_id, v_name, upper(left(v_name, 1)));
  insert into audit.events (user_id, event, space_id)
  values (p_user_id, 'space_member_change', v_shared);
  return v_hh;
end $$;

-- ===== Audit: satu-satunya jalan tulis untuk web/worker =====
-- user_id dari konteks request (tidak bisa dipalsukan lewat parameter); space_id hanya ruang sendiri.
create function audit.log(
  p_event text, p_ip inet default null, p_user_agent text default null,
  p_space_id uuid default null, p_meta jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into audit.events (event, user_id, ip, user_agent, space_id, meta)
  values (p_event, app.current_user_id(), p_ip, left(p_user_agent, 200),
          case when p_space_id = any (app.my_space_ids()) then p_space_id end,
          coalesce(p_meta, '{}'::jsonb))
$$;

-- ===== Purge entri (owner): dipakai jobs.purge_voided dan api.purge_entry =====
create function private.purge_entries(p_ids uuid[], p_event text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform pg_catalog.set_config('dompetku.purge', 'on', true);
  insert into app.entry_tombstones (entry_id, link_id, space_id, kind, occurred_on, voided_at, voided_by)
  select e.id, e.link_id, e.space_id, e.kind, e.occurred_on, e.voided_at, e.voided_by
    from app.entries e where e.id = any (p_ids) and e.voided_at is not null;
  delete from app.entries e where e.id = any (p_ids) and e.voided_at is not null;
  get diagnostics v_n = row_count;
  perform pg_catalog.set_config('dompetku.purge', 'off', true);
  if v_n > 0 then
    insert into audit.events (user_id, event, meta)
    values (app.current_user_id(), p_event, jsonb_build_object('count', v_n));
  end if;
  return v_n;
end $$;

-- ===== Job (EXECUTE hanya dompetku_worker) =====
-- Kemunculan tagihan s.d. p_through; tanggal 29 sampai 31 jatuh ke hari terakhir bulan pendek.
-- Mulai dari bulan tagihan dibuat (WIB) bila starts_on lebih awal: bulan lalu dilewati (keputusan #6).
create function jobs.materialize_bills(p_through date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_through date := coalesce(p_through, (app.today() + interval '1 month')::date);
  v_n int;
begin
  insert into app.bill_occurrences (space_id, bill_id, due_on, amount)
  select b.space_id, b.id,
         least(m + (b.day_of_month - 1), (m + interval '1 month')::date - 1), b.amount
  from app.bills b
  cross join lateral (
    select greatest(b.starts_on,
                    date_trunc('month', b.created_at at time zone 'Asia/Jakarta')::date) as first_on
  ) f
  cross join lateral (
    select g::date as m
    from generate_series(
      date_trunc('month', f.first_on)::timestamp, v_through::timestamp, interval '1 month') g
  ) months
  where b.archived_at is null
    and least(m + (b.day_of_month - 1), (m + interval '1 month')::date - 1)
        between f.first_on and least(coalesce(b.ends_on, v_through), v_through)
  on conflict (bill_id, due_on) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Purge entri batal > 90 hari: tombstone dulu, lalu hapus (lines + history ikut cascade).
create function jobs.purge_voided() returns int
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[];
begin
  select coalesce(array_agg(e.id), '{}') into v_ids
  from app.entries e
  where e.voided_at < app.now() - interval '90 days'
    and not exists (select 1 from app.entries r where r.reimburses_entry_id = e.id)
    and (e.link_id is null or not exists (
          select 1 from app.entries p
          where p.link_id = e.link_id
            and (p.voided_at is null or p.voided_at >= app.now() - interval '90 days')));
  return private.purge_entries(v_ids, 'purge_voided');
end $$;

-- Akun setengah jadi (tanpa profil) > 72 jam (keputusan pemilik #3).
-- Tabel Better Auth (session, account, passkey, twoFactor) memakai FK on delete cascade ke user.
create function jobs.purge_unfinished_users() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_n   int;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dompetku.user_cap'));
  select coalesce(array_agg(u.id), '{}') into v_ids
    from auth."user" u
   where not exists (select 1 from app.profiles p where p.user_id = u.id)
     and u."createdAt" < app.now() - interval '72 hours';
  delete from app.product_events where user_id = any (v_ids);
  delete from app.idempotency_keys where user_id = any (v_ids);
  delete from auth."user" where id = any (v_ids);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into audit.events (event, meta)
    values ('unfinished_user_purged', jsonb_build_object('count', v_n));
  end if;
  return v_n;
end $$;

create function jobs.purge_idempotency() returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  delete from app.idempotency_keys where created_at < app.now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function jobs.purge_audit() returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform pg_catalog.set_config('dompetku.purge', 'on', true);
  delete from audit.events where at < app.now() - interval '1 year';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ===== Cek kualitas data (milik dompetku_auditor, keluaran tanpa nominal) =====
create function private.dq_run()
returns table (check_id text, severity text, violations int)
language sql stable security definer set search_path = '' as $$
  -- DQ01 saldo view = Σ ulang lines (query independen dari view)
  select 'DQ01', 'error', count(*)::int from (
    select a.id from app.accounts a
    left join app.entry_lines l on l.account_id = a.id
    left join app.entries e on e.id = l.entry_id and e.voided_at is null
    group by a.id
    having coalesce(sum(case when e.id is not null then l.amount end), 0)
           <> (select ab.balance from app.account_balances ab where ab.account_id = a.id)
  ) x
  union all
  -- DQ04 transfer satu ruang: Σ = −fee
  select 'DQ04', 'error', count(*)::int from (
    select e.id from app.entries e join app.entry_lines l on l.entry_id = e.id
    where e.kind = 'transfer' group by e.id
    having sum(l.amount) <> coalesce(sum(l.amount) filter (where l.role = 'fee'), 0)
  ) x
  union all
  -- DQ04b pasangan space_transfer: 2 kaki, Σ main = 0, status void seragam
  select 'DQ04b', 'error', count(*)::int from (
    select e.link_id from app.entries e
    join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
    where e.kind = 'space_transfer' group by e.link_id
    having count(*) <> 2 or sum(l.amount) <> 0 or count(distinct (e.voided_at is null)) <> 1
  ) x
  union all
  -- DQ06 version = jumlah history
  select 'DQ06', 'warn', count(*)::int from app.entries e
  where e.version <> (select count(*) from app.entry_history h where h.entry_id = e.id)
  union all
  -- DQ09 line menunjuk akun ruang lain
  select 'DQ09', 'error', count(*)::int from app.entry_lines l
  join app.accounts a on a.id = l.account_id where a.space_id <> l.space_id
  union all
  -- DQ10 purge macet
  select 'DQ10', 'warn', count(*)::int from app.entries e
  where e.voided_at < app.now() - interval '97 days'
$$;

create function jobs.dq_reconcile()
returns table (check_id text, severity text, violations int)
language sql security definer set search_path = '' as $$
  select * from private.dq_run()
$$;
```

## 11. RLS dan hak

| Tabel                                                                                                                        | `dompetku_web`   | `dompetku_api`         | Policy                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------- | ------------------------------------------------------------------------- |
| `accounts`, `categories`, `entries`, `entry_lines`, `entry_history`, `bills`, `bill_occurrences`, `budgets`, `no_spend_days` | SELECT           | SELECT + DML terbatas  | `space_id = any(app.my_space_ids())`                                      |
| `entry_tombstones`                                                                                                           | SELECT           | -                      | anggota ruang                                                             |
| `spaces`, `space_members`, `households`                                                                                      | SELECT           | SELECT                 | anggota ruang                                                             |
| `profiles`                                                                                                                   | SELECT           | SELECT, UPDATE         | `user_id = app.current_user_id()`; nama pasangan lewat `app.space_roster` |
| `idempotency_keys`                                                                                                           | -                | SELECT, INSERT, UPDATE | `user_id = app.current_user_id()`                                         |
| `invitations`                                                                                                                | -                | SELECT, INSERT, UPDATE | pembuat, atau pemegang hash token (GUC lokal)                             |
| `product_events`                                                                                                             | SELECT, INSERT   | -                      | `user_id = app.current_user_id()`                                         |
| `audit.events`                                                                                                               | SELECT           | -                      | `user_id = app.current_user_id()`; tulis lewat `audit.log()`              |
| `app.settings`, `jobs.job_runs`                                                                                              | settings: SELECT | settings: SELECT       | tanpa RLS (tanpa data user)                                               |

Semua tabel `app` dan `audit` (kecuali `app.settings`) `ENABLE` + `FORCE ROW LEVEL SECURITY`. Policy memakai `(select app.my_space_ids())::uuid[]` agar dievaluasi sekali per query (initplan).

FORCE tidak berpengaruh pada `dompetku_owner`: pemilik tabel punya BYPASSRLS. Fungsi DEFINER milik owner (trigger, cek bentuk, provisioning, purge, `audit.log`, `jobs.*`) melewati RLS sepenuhnya. Kontrol yang sebenarnya adalah daftar tertutup fungsi itu (tes katalog #5), yang menjadi penghalang merge di CI. FORCE tetap dipasang agar tabel baru yang lupa diberi policy tertutup untuk role lain.

Fungsi `api.*` DEFINER baru di migrasi berikutnya awalnya dimiliki `dompetku_owner` (BYPASSRLS). Setiap file migrasi yang menyentuh skema `api` diakhiri `select private.own_api_functions();` (template file dbmate), yang memindahkan kepemilikan ke `dompetku_api` dan memberi `EXECUTE` ke web. Tes katalog #5 menangkap yang lupa.

```sql
-- migrate:up
-- ===== RLS: aktif dan dipaksa di semua tabel domain =====
do $$
declare t text;
begin
  foreach t in array array[
    'app.households', 'app.spaces', 'app.space_members', 'app.profiles', 'app.accounts',
    'app.categories', 'app.entries', 'app.entry_lines', 'app.entry_history', 'app.entry_tombstones',
    'app.idempotency_keys', 'app.bills', 'app.bill_occurrences', 'app.budgets',
    'app.no_spend_days', 'app.invitations', 'app.product_events', 'audit.events']
  loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
  end loop;
end $$;

-- Pola ruang: baca untuk web, tulis hanya dompetku_api (lewat fungsi api.*).
do $$
declare t text;
begin
  foreach t in array array[
    'app.accounts', 'app.categories', 'app.entries', 'app.entry_lines', 'app.entry_history',
    'app.bills', 'app.bill_occurrences', 'app.budgets', 'app.no_spend_days']
  loop
    execute format(
      'create policy member_read on %s for select to dompetku_web, dompetku_api
         using (space_id = any ((select app.my_space_ids())::uuid[]))', t);
    execute format(
      'create policy member_write on %s for all to dompetku_api
         using (space_id = any ((select app.my_space_ids())::uuid[]))
         with check (space_id = any ((select app.my_space_ids())::uuid[]))', t);
  end loop;
end $$;

create policy member_read on app.entry_tombstones for select to dompetku_web
  using (space_id = any ((select app.my_space_ids())::uuid[]));

create policy member_read on app.spaces for select to dompetku_web, dompetku_api
  using (id = any ((select app.my_space_ids())::uuid[]));
create policy member_read on app.space_members for select to dompetku_web, dompetku_api
  using (space_id = any ((select app.my_space_ids())::uuid[]));
create policy member_read on app.households for select to dompetku_web, dompetku_api
  using (id in (select s.household_id from app.spaces s));

create policy own_read on app.profiles for select to dompetku_web, dompetku_api
  using (user_id = (select app.current_user_id()));
create policy own_update on app.profiles for update to dompetku_api
  using (user_id = (select app.current_user_id()))
  with check (user_id = (select app.current_user_id()));

create policy own on app.idempotency_keys for all to dompetku_api
  using (user_id = (select app.current_user_id()))
  with check (user_id = (select app.current_user_id()));

-- Undangan: pembuatnya, atau pemegang token (GUC lokal diisi api.invitation_peek/accept).
create policy creator_or_token on app.invitations for all to dompetku_api
  using (created_by = (select app.current_user_id())
         or token_hash = decode(nullif(current_setting('app.invite_token_hash', true), ''), 'hex'))
  with check (created_by = (select app.current_user_id())
         or token_hash = decode(nullif(current_setting('app.invite_token_hash', true), ''), 'hex'));

create policy own on app.product_events for all to dompetku_web
  using (user_id = (select app.current_user_id()))
  with check (user_id = (select app.current_user_id()));

create policy own_read on audit.events for select to dompetku_web
  using (user_id = (select app.current_user_id()));

-- ===== Hak tabel =====
grant select on app.households, app.spaces, app.space_members, app.profiles, app.accounts,
  app.categories, app.entries, app.entry_lines, app.entry_history, app.entry_tombstones,
  app.bills, app.bill_occurrences, app.budgets, app.no_spend_days,
  app.account_balances, app.report_lines, app.bill_schedule
  to dompetku_web, dompetku_api;
grant select, insert on app.product_events to dompetku_web;
grant select on audit.events to dompetku_web;

grant insert, update         on app.accounts, app.categories, app.entries, app.bills,
                                app.bill_occurrences, app.invitations, app.idempotency_keys
                                to dompetku_api;
grant select                 on app.invitations, app.idempotency_keys to dompetku_api;
grant insert, delete         on app.entry_lines, app.no_spend_days to dompetku_api;
grant insert                 on app.entry_history to dompetku_api;
grant insert, update, delete on app.budgets to dompetku_api;
grant update                 on app.profiles to dompetku_api;

grant select on all tables in schema app to dompetku_auditor;
grant select, insert, update on jobs.job_runs to dompetku_worker;

-- ===== Kepemilikan & EXECUTE fungsi =====
-- Fungsi tulis api.* dan helper-nya milik dompetku_api (NOBYPASSRLS: tetap dipagari policy).
-- ALTER OWNER butuh hak CREATE di skema; diberikan sementara lalu dicabut.
-- Dipanggil di akhir setiap file migrasi yang menyentuh skema api (template dbmate).
create function private.own_api_functions() returns int
language plpgsql set search_path = '' as $$
declare
  f   regprocedure;
  v_n int := 0;
begin
  execute 'grant create on schema api, private to dompetku_api';
  for f in
    select p.oid::regprocedure from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.proowner <> 'dompetku_api'::regrole
      and ((n.nspname = 'api' and p.prosecdef)
        or (n.nspname = 'private' and p.proname in (
              'require_user', 'req_hash', 'idem_begin', 'idem_finish', 'lock_accounts',
              'get_account', 'balance', 'assert_balance', 'entry_snapshot', 'write_history',
              'check_date', 'check_amount', 'clean_text', 'set_void_state')))
  loop
    execute pg_catalog.format('alter function %s owner to dompetku_api', f);
    v_n := v_n + 1;
  end loop;
  for f in
    select p.oid::regprocedure from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
  loop
    execute pg_catalog.format('grant execute on function %s to dompetku_web', f);
  end loop;
  execute 'revoke create on schema api, private from dompetku_api';
  return v_n;
end $$;
select private.own_api_functions();

grant create on schema private, jobs to dompetku_auditor;
alter function private.dq_run() owner to dompetku_auditor;
alter function jobs.dq_reconcile() owner to dompetku_auditor;
grant usage on schema jobs to dompetku_auditor;
revoke create on schema private, jobs from dompetku_auditor;

grant execute on function app.my_space_ids(), app.space_roster(uuid), app.assert_member(uuid),
  app.report_class(app.entry_kind, app.line_role, app.pocket, app.space_kind,
                   app.entry_direction, boolean)
  to dompetku_web, dompetku_api, dompetku_auditor;
grant execute on function private.provision_user(uuid, text, uuid, text),
  private.purge_entries(uuid[], text) to dompetku_api;
grant execute on function audit.log(text, inet, text, uuid, jsonb) to dompetku_web, dompetku_worker;

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'jobs'
  loop
    execute format('grant execute on function %s to dompetku_worker', f);
  end loop;
end $$;
```

## 12. Migrasi

- Tool: **dbmate** (biner tunggal multi-arch, SQL murni, satu transaksi per file, dump `schema.sql` untuk review diff) (spec §9.1).
- Lokasi usulan: `packages/db/migrations/NNNN_nama.sql`, satu blok `-- migrate:up` per file. Blok di dokumen ini dipecah menjadi file 0001 sampai 0008 sesuai urutan bagian.
- Maju-saja di produksi; `-- migrate:down` hanya untuk lokal. Expand/contract: kolom baru nullable/ber-default, fungsi `api.*` kompatibel mundur (argumen baru ber-default atau `_v2`), contract setelah ≥ 1 rilis stabil.
- Perubahan fungsi = `create or replace` utuh di file baru. Indeks `concurrently` memakai `-- migrate:up transaction:false`.
- Pembungkus migrasi: `flock` di host + `pg_advisory_lock`, `pg_create_restore_point` sebelum migrasi (round2 backend B1).
- Menambah nilai enum (`entry_kind` untuk utang, valuasi) memakai `alter type ... add value` di file tersendiri.
- CI: `pg_dump` versi 17, `kysely-codegen` (override `int8` → `number`, `date` → `string`), diff `schema.sql`, job `compat-n-1`.

Konfigurasi Postgres yang terkait skema (spec §9.1; round2 backend §2.3):

```
timezone = 'UTC'
password_encryption = scram-sha-256
log_statement = 'ddl'
log_parameter_max_length = 0
log_parameter_max_length_on_error = 0
archive_timeout = 300
default_transaction_isolation = 'read committed'
log_connections = on
log_disconnections = on
shared_preload_libraries = 'pgaudit'
pgaudit.role = 'dompetku_auditlog'
pgaudit.log_parameter = off
```

**Akses DB manual** (spec §9.5, review security): sesi `psql` sebagai superuser atau `dompetku_owner` tidak lewat `audit.log` dan bisa mengubah data. Mekanismenya:

- `log_connections`/`log_disconnections` mencatat setiap sesi; `pgaudit` dengan audit objek lewat role `dompetku_auditlog` (nologin, diberi hak semua tabel `app`, `audit`, `auth`) ditambah `alter role postgres set pgaudit.log = 'all'` dan `alter role dompetku_owner set pgaudit.log = 'write, ddl, role'`. Container `migrate` menimpa `pgaudit.log = 'ddl'` lewat `PGOPTIONS` agar log migrasi tidak membengkak. Image Postgres resmi tidak memuat pgaudit; image dibangun dengan paket `postgresql-17-pgaudit` (M0b).
- Log Postgres dikirim ke luar VM DB (tujuan log di TRD §3.7), sehingga sesi admin tidak bisa menghapus jejaknya sendiri.
- Akses manual hanya lewat skrip host `dompetku-psql`: menulis `audit.events` (`db_manual_access`, `meta.via = 'cli'`) sebelum membuka sesi dan mengirim alert ke email pemilik. Koneksi superuser atau owner yang tidak didahului event itu (dicocokkan dari log koneksi) memicu alert anomali.

## 13. Daftar tes pgTAP

Semua tes isolasi berjalan sebagai `dompetku_web`/`dompetku_api` dengan helper `tests.as_user(uid)`, bukan superuser. Tes memanggil fungsi `api.*`, bukan insert mentah.

**Katalog** (otomatis mencakup objek baru)

1. Semua tabel `app.*`/`audit.*` kecuali `app.settings`: `relrowsecurity` dan `relforcerowsecurity`.
2. Tidak ada fungsi di `app`, `api`, `private`, `jobs`, `audit` yang bisa dieksekusi PUBLIC (`aclexplode`).
3. Semua fungsi punya `search_path=""` di `proconfig`; fungsi DEFINER tanpa `create temp table` (tidak ada relasi tak berskema yang bisa dibajak lewat `pg_temp`).
4. `prosrc` tanpa `current_date`/`localtimestamp`; `raise` tanpa nilai nominal/deskripsi.
5. Fungsi DEFINER baca = tepat `app.my_space_ids`, `app.space_roster`, `api.invitation_peek`. Semua fungsi DEFINER di `api` dimiliki `dompetku_api`. Fungsi DEFINER milik `dompetku_owner` = daftar tertutup (trigger, cek bentuk, `provision_user`, `purge_entries`, `audit.log`, `jobs.*`). Penghalang merge.
6. `dompetku_web` tanpa INSERT/UPDATE/DELETE di tabel ledger dan `audit.events`; `dompetku_worker` tanpa SELECT tabel domain dan skema `auth`.
7. Setiap FK punya indeks non-parsial yang kolom terdepannya sama dengan kolom FK (sebagai himpunan).
8. Di produksi, `app.settings.env = 'prod'`.
9. `app.report_class` tidak NULL untuk setiap kombinasi `entry_kind × line_role × pocket × space_kind × direction × reimbursable` yang lolos cek bentuk.

**Isolasi dua user** (matriks dibangkitkan dari katalog)

10. Farida: `count(*)` setiap tabel dan view (`report_lines`, `account_balances`, `bill_schedule`) untuk ruang Pribadi Novanda = 0.
11. Farida memanggil setiap `api.*` dengan id milik Novanda (akun, kategori, entri, tagihan, ruang) = `DK404`.
12. Fungsi baca (`month_summary`, `period_summary`, `safe_to_spend`, `budget_progress`, `net_worth`, `activity_feed`) untuk ruang Pribadi pasangan = `DK404`.
13. Setoran Novanda ke Bersama: Farida melihat tepat satu kaki (`in`), `description` NULL, tidak ada akun sumber, tidak ada teks deskripsi di `entry_history.snapshot`, dan `void_entry` dari Farida = `DK404`. Pengambilan Bersama ke Pribadi: deskripsi hanya di kaki Pribadi; Farida tidak melihatnya di `entries` maupun `entry_history`.
14. Tanpa `app.user_id` (koneksi pool bekas `withUser`): 0 baris, tanpa error cast; fungsi tulis = `DK401`.
15. `profiles`: hanya baris sendiri; `space_roster` hanya untuk ruang sendiri.
16. Pendaftaran dan undangan: sebelum rumah tangga ada hanya `owner_email` yang bisa mendaftar; sesudahnya email tanpa undangan terbuka = `signup_closed`; `invitation_peek` dengan hash salah = `DK404`; tolak = undangan hangus; kirim ulang mencabut yang lama; `accept_invitation` sebelum kode pemulihan = `not_secured`, email belum terverifikasi = `email_unverified`; pemakaian kedua = `DK404`; akun setengah jadi tidak memakan kuota dan dihapus setelah 72 jam; user ketiga = `user_limit`.
17. `audit.log`: `user_id` selalu dari konteks; nama event di luar daftar dan kunci `meta` di luar daftar (misalnya `nominal`) ditolak; web tidak bisa INSERT langsung.

**Uang dan invarian**

18. Bentuk lines salah (lewat role owner) = `DK500` saat `set constraints all immediate`.
19. Transfer satu ruang Σ = −fee; pasangan `space_transfer` Σ main = 0, satu `out` satu `in`, tanggal sama, status void sama.
20. `space_transfer` dari/ke dompet kantor = `DK422 cross_space_kantor`; dua ruang Pribadi tidak mungkin.
21. Idempotensi: kunci sama isi sama = `replayed: true`, jumlah entri tetap; isi beda = `DK410`.
22. `p_expected_version` lama = `DK409`, data tidak berubah; setiap mutasi menambah tepat 1 baris history.
23. Saldo negatif tanpa flag = `DK422 saldo_negatif` tanpa efek; dengan flag tersimpan; pemasukan ke akun yang sudah negatif tidak ditolak. Fungsi tulis di REPEATABLE READ = `DK500 isolation_not_read_committed`.
24. Saldo awal: hanya bisa diubah ≤ 7 hari; tidak bisa di-void.
25. Cocokkan saldo: saldo akhir = target; selisih 0 tidak membuat entri.
26. Kewajiban XOR: anggaran wajib + tagihan pada kategori induk/anak yang sama di bulan yang sama = `DK422 obligation_double`, dari kedua arah; memindah induk kategori yang dipakai tagihan atau anggaran = `category_in_obligation`.
27. Anggaran pada subkategori = ditolak FK.
28. Kategori 3 level atau tipe anak ≠ induk = ditolak.
29. `month_summary`, `safe_to_spend`, `budget_progress`, `net_worth` pada fixture `golden.json` (dihitung manual) cocok, termasuk transfer dari dan ke dompet kantor dengan fee (`transfer` per entri, fee kantor di `kantor_keluar`).
30. Void/restore pasangan: kedua kaki berubah bersama; restore setelah 90 hari = `DK422`; void atau restore yang menyentuh dompet terarsip = `account_archived`.
31. Purge (jam di-override di env test): tombstone tanpa nominal, entri + lines + history hilang, pasangan berdua, entri yang dirujuk reimbursement dilewati. Sampah: `trash_list` hanya entri batal ≤ 90 hari; `purge_entry` hanya entri batal, pasangan berdua, hanya pencatat untuk `space_transfer`.
32. `entry_history` dan `audit.events`: UPDATE dan TRUNCATE selalu ditolak; DELETE di luar fungsi purge ditolak, juga untuk owner.
33. Tagihan: `starts_on` di masa lalu hanya dimaterialisasi mulai bulan tagihan dibuat; tagihan terarsip tidak dihitung di `safe_to_spend`.
34. Arsip dompet: saldo bukan 0 = `balance_not_zero`; dompet terarsip tidak bisa dicatat.
35. Properti: 1.000 operasi acak (`setseed`), lalu DQ01 sampai DQ10 nol temuan.

Konkurensi (idempotensi paralel, transfer A→B ∥ B→A, arsip ∥ catat, dua pengeluaran paralel pada saldo yang hanya cukup untuk satu) diuji di Vitest dua koneksi, bukan pgTAP. Kasus dua pengeluaran paralel sudah dijalankan di `bsd-check/test.sql` lewat dblink (yang kedua `saldo_negatif`, saldo akhir tidak negatif).

## 14. Di luar cakupan draf ini

Utang/piutang dan modal trading (M3), tujuan tabungan, aset, saham, snapshot net worth, harga (M4), trip dan ekspor PDF (M5), `ai_usage` dan lampiran struk (M6), skema `pgboss`. Polanya sama: `space_id` + FK komposit, tulis lewat `api.*`, baca INVOKER, kelas laporan baru di `app.report_class`.

## 15. Pertanyaan terbuka

Terjawab di putaran 2 (2026-10-31): `api.invitation_peek` masuk daftar tertutup DEFINER (rekomendasi security); pembuatan user dan konsumsi undangan tidak lagi butuh satu transaksi bersama Better Auth (trigger pendaftaran + `accept_invitation` setelah akun diamankan); faktor kuat = passkey ATAU kata sandi + TOTP (keputusan pemilik #1); `statement_timeout` worker 60 s.

Dijawab pemilik 2026-10-31 (butir 1 sampai 10 di bawah). Butir yang mengubah skema dikerjakan di sprint fiturnya dengan migrasi expand, bukan mengubah DDL M1.

1. **Anggaran subkategori: perlu.** Waktu bebas; dijadwalkan di S9 bersama anggaran. Arah: `app.budgets` menerima kategori induk atau sub; realisasi induk = Σ semua subnya; anggaran sub tidak menambah total induk (tidak dobel di "aman dipakai"); aturan kewajiban XOR berlaku per kategori dan leluhurnya. Detail dan tes ditulis di S9.
2. **Tagihan dibayar di muka: perlu, tanpa membuka tanggal masa depan.** Usulan: ledger tetap hanya mencatat yang sudah terjadi (`DK400 occurred_on` tetap). Bayar di muka = entri bertanggal hari bayar yang ditautkan ke kemunculan tagihan berikutnya (`api.post_bill_occurrence` dengan `due_on` di masa depan), sehingga saldo turun saat uang keluar dan tagihan bulan itu tampil lunas. Perlu tambahan: kemunculan berikutnya harus sudah ada (materialisasi sampai satu kemunculan ke depan, atau dibuat saat dibayar). Laporan memakai basis kas: pengeluaran masuk bulan uang keluar. Rencana masa depan lain dibaca dari jadwal tagihan (kalender arus kas S16), bukan entri bertanggal depan. Tes: bayar tagihan bulan depan hari ini, saldo turun hari ini, "aman dipakai" tidak memotong tagihan itu lagi.
3. **Disetujui.** Saldo awal ≥ 0; dompet yang dibuka minus dicatat lewat "Cocokkan saldo".
4. **Setelah penilaian M0a, paling lambat S6.** Angka demo tidak diubah selama N dan F menilai; di S6 selector demo diganti fungsi DB yang sudah mengikuti §2.2.
5. **`entry_tombstones` 1 tahun** (usulan backend).
6. **Disahkan:** `idempotency_keys` 30 hari, `audit.events` 1 tahun.
7. **Angka backend:** web `statement_timeout=5s`, `lock_timeout=3s`, `idle_in_transaction_session_timeout=15s`. Rute berat (ekspor CSV/PDF) boleh menaikkan `statement_timeout` lewat `set_config(..., true)` lokal transaksi sampai 30 s, hanya di fungsi yang terdaftar. Ditinjau ulang dengan data nyata M1.
8. **Disetujui:** `dompetku_monitor` sebagai role keenam.
9. **Tanggal gajian: Novanda tanggal 25, maju ke hari kerja sebelumnya bila 25 jatuh di Sabtu, Minggu, atau libur nasional/cuti bersama.** Farida tanggal yang sama; berlaku untuk Pribadi dan Bersama. Rumus disetujui (§8.2a).
10. **Diverifikasi di S4** saat versi Better Auth dipatok: nama opsi dicek di kode sumber versi itu, dicatat di ADR, dan dikunci dengan tes (cascade hapus user, `emailVerified` dari undangan, `amr` di sesi).

## 16. Catatan review (putaran 2)

Temuan review backend dan security (`docs/product/review/`) diterapkan, kecuali:

- Security Minor (id identity global di `audit.events` dan `product_events` memperlihatkan celah nomor): **diterima sebagai risiko**. Yang bisa diperkirakan hanya jumlah dan waktu kasar aktivitas pasangan, tanpa isi; `product_events` sekarang hanya event Catat. Ditinjau ulang bila tabel lain yang terlihat web memakai identity.
- Security Minor (tes katalog untuk relasi tak berskema di fungsi DEFINER): diganti dengan menghapus satu-satunya tabel sementara (`purge_voided`) dan tes "DEFINER tanpa `create temp table`". Parser relasi penuh dari `prosrc` tidak sepadan.
- Backend Minor (akun aset tidak boleh negatif): tidak mengubah perilaku. `tabungan` boleh negatif dengan konfirmasi seperti dompet lain; aturan spec §9.1 dibaca untuk tabel aset M4 (§9.1).
- Backend Penting (konsumsi undangan lewat trigger `BEFORE INSERT` di `auth."user"`): arah diambil sebagian. Trigger menegakkan pendaftaran tertutup dan batas user, tetapi undangan baru terpakai di `api.accept_invitation` setelah akun diamankan (keputusan pemilik #3). User setengah jadi tidak memakan kuota dan dihapus setelah 72 jam, sehingga kasus salah ketik email tidak lagi mengunci rumah tangga.
- Batas user paralel: dijaga advisory lock `dompetku.user_cap` di READ COMMITTED (trigger dan provisioning). Uji dua koneksi untuk pendaftaran paralel tidak dijalankan di `bsd-check` karena hanya ada satu undangan terbuka per rumah tangga; masuk tes Vitest dua koneksi M0b.
