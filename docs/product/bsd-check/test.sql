\set ON_ERROR_STOP 1
-- Harness kecil (pengganti pgTAP yang tidak terpasang lokal).
create schema t;
grant usage on schema t to public;
create function t.expect_error(q text, code text, msg text default null) returns text
language plpgsql as $$
begin
  execute q;
  raise exception 'EXPECTED % but succeeded: %', code, q;
exception when others then
  if sqlstate = 'P0001' and sqlerrm like 'EXPECTED%' then raise; end if;
  if sqlstate <> code or (msg is not null and sqlerrm <> msg) then
    raise exception 'EXPECTED % %, got % %: %', code, coalesce(msg,''), sqlstate, sqlerrm, q;
  end if;
  return 'ok ' || code || ' ' || sqlerrm;
end $$;
create function t.ok(cond boolean, label text) returns text language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FAIL: %', label; end if;
  return 'ok ' || label;
end $$;
grant execute on all functions in schema t to public;
create table t.ids (k text primary key, v uuid);
grant all on t.ids to public;
create table t.nums (k text primary key, v bigint);
grant all on t.nums to public;
create extension dblink schema t;

-- ===== Pendaftaran tertutup + akun pertama (keputusan pemilik #1, #5) =====
set role dompetku_owner;
insert into app.settings (key, value) values ('owner_email', 'novanda@example.test');
reset role;
set role dompetku_web;
select t.expect_error($q$insert into auth."user" (id, name, email) values (gen_random_uuid(), 'Orang', 'orang@example.test')$q$, 'DK422', 'signup_closed');
begin isolation level repeatable read;
select t.expect_error($q$insert into auth."user" (id, name, email) values (gen_random_uuid(), 'Novanda', 'novanda@example.test')$q$, 'DK500', 'isolation_not_read_committed');
rollback;
insert into auth."user" (id, name, email, "emailVerified") values
  ('11111111-1111-1111-1111-111111111111', 'Novanda', 'novanda@example.test', true);
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
select t.expect_error($q$select api.bootstrap_owner('Novanda')$q$, 'DK422', 'not_secured');
insert into auth.recovery_codes (user_id, code_hash)
  values ('11111111-1111-1111-1111-111111111111', '$argon2id$v=19$novanda1');
select t.ok(api.bootstrap_owner('Novanda') ? 'household_id', 'bootstrap owner');
select t.expect_error($q$select api.bootstrap_owner('Novanda')$q$, 'DK422', 'already_provisioned');
reset role;

-- ===== Undangan Farida: tolak, salah email, kirim ulang, akun setengah jadi (keputusan #2, #3) =====
set role dompetku_web;
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
select api.create_invitation('farida@example.tes', sha256('t1'));
select t.expect_error($q$select api.create_invitation('x@example.test', sha256('lain'))$q$, '23505');
select set_config('app.user_id', '', false);
select t.ok((api.invitation_peek(sha256('t1')) ->> 'email') = 'farida@example.tes', 'peek');
select t.expect_error($q$select api.invitation_peek(sha256('salah'))$q$, 'DK404');
select api.decline_invitation(sha256('t1'));
select t.expect_error($q$select api.invitation_peek(sha256('t1'))$q$, 'DK404');
select t.expect_error($q$select api.decline_invitation(sha256('t1'))$q$, 'DK404');
select t.expect_error($q$insert into auth."user" (id, name, email) values (gen_random_uuid(), 'Acak', 'acak@example.test')$q$, 'DK422', 'signup_closed');
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
insert into t.ids select 'inv2', (api.create_invitation('farida@example.tes', sha256('t2')) ->> 'invitation_id')::uuid;
-- Akun setengah jadi dengan email salah ketik.
insert into auth."user" (id, name, email, "emailVerified") values
  ('33333333-3333-3333-3333-333333333333', 'Farida', 'farida@example.tes', true);
select api.resend_invitation((select v from t.ids where k = 'inv2'), 'Farida@Example.test', sha256('token-rahasia'));
select set_config('app.user_id', '33333333-3333-3333-3333-333333333333', false);
insert into auth.recovery_codes (user_id, code_hash)
  values ('33333333-3333-3333-3333-333333333333', '$argon2id$v=19$typo1');
select t.expect_error($q$select api.accept_invitation(sha256('t2'), 'Farida')$q$, 'DK404');
select set_config('app.user_id', '', false);
-- Akun setengah jadi tidak memakan kuota: Farida tetap bisa mendaftar.
insert into auth."user" (id, name, email) values
  ('22222222-2222-2222-2222-222222222222', 'Farida', 'farida@example.test');
select set_config('app.user_id', '22222222-2222-2222-2222-222222222222', false);
select t.expect_error($q$select api.accept_invitation(sha256('token-rahasia'), 'Farida')$q$, 'DK422', 'email_unverified');
update auth."user" set "emailVerified" = true where id = '22222222-2222-2222-2222-222222222222';
select t.expect_error($q$select api.accept_invitation(sha256('token-rahasia'), 'Farida')$q$, 'DK422', 'not_secured');
insert into auth.recovery_codes (user_id, code_hash)
  values ('22222222-2222-2222-2222-222222222222', '$argon2id$v=19$farida1');
select api.accept_invitation(sha256('token-rahasia'), 'Farida');
select t.expect_error($q$select api.accept_invitation(sha256('token-rahasia'), 'Farida')$q$, 'DK404');
select set_config('app.user_id', '', false);
select t.expect_error($q$insert into auth."user" (id, name, email) values (gen_random_uuid(), 'X', 'x@example.test')$q$, 'DK422', 'user_limit');
reset role;
set role dompetku_owner;
select t.ok((select array_agg(revoke_reason order by created_at) from app.invitations)
            = array['declined', 'resent', null], 'invitation reasons');
reset role;

-- ===== Data Novanda =====
set role dompetku_web;
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
insert into t.ids select 'n_personal', id from app.spaces where kind = 'personal';
insert into t.ids select 'shared', id from app.spaces where kind = 'shared';
select t.ok((select count(*) from app.spaces) = 2, 'novanda sees 2 spaces');
select t.ok((select count(*) from app.space_roster((select v from t.ids where k='shared'))) = 2, 'roster 2');

insert into t.ids select 'bca', (api.create_account(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  'BCA', 'operasional', 'bank', null, 500000) ->> 'account_id')::uuid;
insert into t.ids select 'kantor', (api.create_account(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  'Kas Kantor', 'kantor', 'cash', null, 200000) ->> 'account_id')::uuid;
insert into t.ids select 'tab', (api.create_account(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  'Tabungan', 'tabungan', 'bank', null, 1000000) ->> 'account_id')::uuid;
insert into t.ids select 'kasrumah', (api.create_account(gen_random_uuid(), (select v from t.ids where k='shared'),
  'Kas Rumah', 'operasional', 'cash', null, 0) ->> 'account_id')::uuid;
select t.expect_error($q$select api.create_account(gen_random_uuid(), (select v from t.ids where k='shared'), 'K', 'kantor', 'cash')$q$, 'DK422');

insert into t.ids select 'makan', (api.create_category(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  'expense', 'Makan', 'ForkKnife') ->> 'category_id')::uuid;
insert into t.ids select 'kopi', (api.create_category(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  'expense', 'Kopi', 'Coffee', (select v from t.ids where k='makan')) ->> 'category_id')::uuid;
insert into t.ids select 'listrik', (api.create_category(gen_random_uuid(), (select v from t.ids where k='shared'),
  'expense', 'Listrik', 'Lightning') ->> 'category_id')::uuid;
insert into t.ids select 'gaji', (api.create_category(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  'income', 'Gaji', 'Briefcase') ->> 'category_id')::uuid;
select t.expect_error($q$select api.create_category(gen_random_uuid(), (select v from t.ids where k='n_personal'), 'expense', 'Cucu', 'Coffee', (select v from t.ids where k='kopi'))$q$, 'DK422', 'category_depth');
select t.expect_error($q$select api.create_category(gen_random_uuid(), (select v from t.ids where k='n_personal'), 'income', 'Anak', 'Coffee', (select v from t.ids where k='makan'))$q$, '23503');

-- Idempotensi
insert into t.ids values ('ck1', '33333333-0000-0000-0000-000000000001');
select api.create_entry((select v from t.ids where k='ck1'), (select v from t.ids where k='n_personal'),
  (select v from t.ids where k='bca'), 'expense', 35000, (select v from t.ids where k='kopi'),
  null, 'Kopi susu');
select t.ok((api.create_entry((select v from t.ids where k='ck1'), (select v from t.ids where k='n_personal'),
  (select v from t.ids where k='bca'), 'expense', 35000, (select v from t.ids where k='kopi'),
  null, 'Kopi susu') ->> 'replayed')::boolean, 'replay');
select t.ok((select count(*) from app.entries where kind = 'expense') = 1, 'no duplicate');
select t.expect_error($q$select api.create_entry((select v from t.ids where k='ck1'), (select v from t.ids where k='n_personal'), (select v from t.ids where k='bca'), 'expense', 99000)$q$, 'DK410');
select t.expect_error($q$select api.create_entry(gen_random_uuid(), (select v from t.ids where k='shared'), (select v from t.ids where k='bca'), 'expense', 1000)$q$, 'DK422', 'space_mismatch');
select t.expect_error($q$select api.create_entry(gen_random_uuid(), (select v from t.ids where k='n_personal'), (select v from t.ids where k='bca'), 'expense', 0)$q$, 'DK400');
select t.expect_error($q$select api.create_entry(gen_random_uuid(), (select v from t.ids where k='n_personal'), (select v from t.ids where k='bca'), 'expense', 1000, null, app.today() + 1)$q$, 'DK400');
-- Saldo negatif
select t.expect_error($q$select api.create_entry(gen_random_uuid(), (select v from t.ids where k='n_personal'), (select v from t.ids where k='bca'), 'expense', 900000)$q$, 'DK422', 'saldo_negatif');
-- Talangan kantor + kas kantor
select api.create_entry(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  (select v from t.ids where k='bca'), 'expense', 50000, (select v from t.ids where k='makan'), null, 'Makan klien', true);
select api.create_entry(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  (select v from t.ids where k='kantor'), 'expense', 20000, null, null, 'ATK');
select api.create_entry(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  (select v from t.ids where k='bca'), 'income', 100000, (select v from t.ids where k='gaji'));

-- Transfer satu ruang dengan fee: Σ = −fee
select api.create_transfer(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  (select v from t.ids where k='bca'), (select v from t.ids where k='tab'), 100000, 2500);
select t.ok((select sum(amount) from app.entry_lines l join app.entries e on e.id = l.entry_id
             where e.kind = 'transfer') = -2500, 'transfer sum = -fee');

-- Setoran ke Bersama
insert into t.ids select 'st', (api.create_transfer(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  (select v from t.ids where k='bca'), (select v from t.ids where k='kasrumah'), 150000, 0, null,
  'Rahasia pribadi', 'Uang belanja') ->> 'entry_id')::uuid;
select t.ok((select description is null and shared_note = 'Uang belanja' from app.entries
             where kind = 'space_transfer' and direction = 'in'), 'in-leg no description');
select t.expect_error($q$select api.create_transfer(gen_random_uuid(), (select v from t.ids where k='n_personal'), (select v from t.ids where k='kantor'), (select v from t.ids where k='kasrumah'), 1000)$q$, 'DK422', 'cross_space_kantor');

-- Ringkasan bulan & saldo
select t.ok((select balance from app.account_balances where account_id = (select v from t.ids where k='bca'))
            = 500000 - 35000 - 50000 + 100000 - 102500 - 150000, 'bca balance');
select t.ok((select pemasukan = 100000 and pengeluaran = 35000 + 2500 and kantor_masuk = 0
                    and kantor_keluar = 20000 and transfer = 100000 + 150000
             from api.month_summary((select v from t.ids where k='n_personal'),
                                    (app.today() - (extract(day from app.today())::int - 1)))),
            'month_summary (talangan & kantor excluded, fee counted)');
select t.ok((select operasional = 262500 and tabungan = 1100000 and kantor_excluded = 180000
                    and total = 1362500 from api.net_worth((select v from t.ids where k='n_personal'))),
            'net worth excludes kantor');

-- Kas Kantor (review backend, keputusan #7): transfer per entri, fee kantor masuk kantor_keluar.
insert into t.nums select 'trf0', transfer from api.month_summary((select v from t.ids where k='n_personal'), (app.today() - (extract(day from app.today())::int - 1)));
insert into t.nums select 'exp0', pengeluaran from api.month_summary((select v from t.ids where k='n_personal'), (app.today() - (extract(day from app.today())::int - 1)));
select api.create_transfer(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  (select v from t.ids where k='bca'), (select v from t.ids where k='kantor'), 30000);
select api.create_transfer(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  (select v from t.ids where k='kantor'), (select v from t.ids where k='bca'), 5000, 2000);
select t.ok((select transfer = (select v from t.nums where k='trf0') + 35000
                    and pengeluaran = (select v from t.nums where k='exp0')
                    and kantor_keluar = 20000 + 2000 and kantor_masuk = 0
             from api.month_summary((select v from t.ids where k='n_personal'),
                                    (app.today() - (extract(day from app.today())::int - 1)))),
            'month_summary kantor transfer and fee');

-- Isolasi wajib READ COMMITTED.
begin isolation level repeatable read;
select t.expect_error($q$select api.create_entry(gen_random_uuid(), (select v from t.ids where k='n_personal'), (select v from t.ids where k='bca'), 'expense', 1000)$q$, 'DK500', 'isolation_not_read_committed');
rollback;
insert into t.ids select 'conc', (api.create_account(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  'Dompet paralel', 'operasional', 'cash', null, 100) ->> 'account_id')::uuid;

-- Anggaran & kewajiban XOR
select api.set_budget((select v from t.ids where k='n_personal'), (select v from t.ids where k='makan'),
  (app.today() - (extract(day from app.today())::int - 1)), 500000, true);
select t.ok((select spent = 35000 from api.budget_progress((select v from t.ids where k='n_personal'),
  (app.today() - (extract(day from app.today())::int - 1)))), 'budget rolls child to root, talangan excluded');
select t.expect_error($q$select api.set_budget((select v from t.ids where k='n_personal'), (select v from t.ids where k='kopi'), (app.today() - (extract(day from app.today())::int - 1)), 1000)$q$, '23503');
select t.expect_error($q$select api.create_bill(gen_random_uuid(), (select v from t.ids where k='n_personal'), 'Langganan kopi', 50000, (select v from t.ids where k='kopi'), 5::smallint, app.today())$q$, 'DK422', 'obligation_double');
select api.create_bill(gen_random_uuid(), (select v from t.ids where k='shared'), 'Listrik', 300000,
  (select v from t.ids where k='listrik'), 31::smallint, (app.today() - (extract(day from app.today())::int - 1)));
select t.expect_error($q$select api.set_budget((select v from t.ids where k='shared'), (select v from t.ids where k='listrik'), (app.today() - (extract(day from app.today())::int - 1)), 300000, true)$q$, 'DK422', 'obligation_double');
reset role;

-- ===== Worker: materialisasi tagihan =====
set role dompetku_worker;
select t.ok(jobs.materialize_bills() >= 1, 'materialize');
select t.ok(jobs.materialize_bills() = 0, 'materialize idempotent');
reset role;

-- ===== Farida: isolasi =====
set role dompetku_web;
select set_config('app.user_id', '22222222-2222-2222-2222-222222222222', false);
select t.ok((select count(*) from app.spaces) = 2, 'farida 2 spaces (own personal + shared)');
insert into t.ids select 'f_personal', id from app.spaces where kind = 'personal';
select t.ok(not exists (select 1 from app.accounts where space_id = (select v from t.ids where k='n_personal')), 'no N accounts');
select t.ok(not exists (select 1 from app.entries  where space_id = (select v from t.ids where k='n_personal')), 'no N entries');
select t.ok(not exists (select 1 from app.entry_lines where space_id = (select v from t.ids where k='n_personal')), 'no N lines');
select t.ok(not exists (select 1 from app.entry_history where space_id = (select v from t.ids where k='n_personal')), 'no N history');
select t.ok(not exists (select 1 from app.categories where space_id = (select v from t.ids where k='n_personal')), 'no N categories');
select t.ok(not exists (select 1 from app.budgets where space_id = (select v from t.ids where k='n_personal')), 'no N budgets');
select t.ok(not exists (select 1 from app.report_lines where space_id = (select v from t.ids where k='n_personal')), 'no N report lines');
select t.ok(not exists (select 1 from app.account_balances where space_id = (select v from t.ids where k='n_personal')), 'no N balances');
select t.ok((select count(*) from app.profiles) = 1, 'own profile only');
select t.ok(not exists (select 1 from app.entry_history h where h.snapshot::text like '%Rahasia%'), 'no private text in shared history');
select t.ok(not exists (select 1 from app.entries e where e.description = 'Rahasia pribadi'), 'no private description');
select t.ok((select count(*) from app.entries where kind = 'space_transfer') = 1, 'farida sees only in-leg');
select t.expect_error($q$select * from api.month_summary((select v from t.ids where k='n_personal'), date '2026-10-01')$q$, 'DK404');
select t.expect_error($q$select * from api.safe_to_spend((select v from t.ids where k='n_personal'))$q$, 'DK404');
select t.expect_error($q$select api.create_entry(gen_random_uuid(), (select v from t.ids where k='n_personal'), (select v from t.ids where k='bca'), 'expense', 1000)$q$, 'DK404');
select t.expect_error($q$select api.void_entry(gen_random_uuid(), (select id from app.entries where kind='space_transfer'), 1)$q$, 'DK404');
select t.expect_error($q$select api.void_entry(gen_random_uuid(), (select v from t.ids where k='st'), 1)$q$, 'DK404');
select t.expect_error($q$insert into app.entries (space_id, space_kind, kind, occurred_on, created_by, updated_by) values ((select v from t.ids where k='shared'), 'shared', 'expense', app.today(), app.current_user_id(), app.current_user_id())$q$, '42501');
select t.expect_error($q$update app.entries set description = 'x'$q$, '42501');
select t.ok((select count(*) from api.activity_feed((select v from t.ids where k='shared'))) >= 1, 'feed');
select t.ok((select total from api.safe_to_spend((select v from t.ids where k='shared'))) = 150000 - 300000, 'safe_to_spend shared (bill subtracted)');
reset role;

-- ===== Novanda: void/restore pasangan =====
set role dompetku_web;
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
select api.void_entry(gen_random_uuid(), (select v from t.ids where k='st'), 1);
select t.ok((select count(*) from app.entries where kind='space_transfer' and voided_at is not null) = 2, 'void both legs');
select api.restore_entry(gen_random_uuid(), (select v from t.ids where k='st'), 2);
select t.ok((select count(*) from app.entries where kind='space_transfer' and voided_at is null and version = 3) = 2, 'restore both legs');
select t.expect_error($q$select api.void_entry(gen_random_uuid(), (select v from t.ids where k='st'), 1)$q$, 'DK409');
-- Edit
select api.update_entry(gen_random_uuid(), (select e.id from app.entries e where e.description = 'Kopi susu'),
  1, (select v from t.ids where k='bca'), 40000, (select v from t.ids where k='kopi'), null, 'Kopi susu besar', false);
select t.expect_error($q$select api.update_entry(gen_random_uuid(), (select e.id from app.entries e where e.description = 'Kopi susu besar'), 2, (select v from t.ids where k='bca'), 40000)$q$, '42883');
select t.ok((select version = 2 from app.entries where description = 'Kopi susu besar'), 'update version');
-- Cocokkan saldo
select api.reconcile_balance(gen_random_uuid(), (select v from t.ids where k='bca'), 250000);
select t.ok((select balance from app.account_balances where account_id = (select v from t.ids where k='bca')) = 250000, 'reconcile');
-- Di luar withUser: 0 baris
select set_config('app.user_id', '', false);
select t.ok((select count(*) from app.entries) = 0, 'no context = 0 rows');
select t.expect_error($q$select api.create_entry(gen_random_uuid(), null, null, 'expense', 1)$q$, 'DK401');
reset role;

-- ===== Konkurensi: dua pengeluaran 80 paralel pada saldo 100 (dblink, READ COMMITTED) =====
select t.dblink_connect('c1', format('host=%s port=%s dbname=%s user=dompetku_web',
  current_setting('unix_socket_directories'), current_setting('port'), current_database()));
select t.dblink_connect('c2', format('host=%s port=%s dbname=%s user=dompetku_web',
  current_setting('unix_socket_directories'), current_setting('port'), current_database()));
select t.dblink_exec('c1', 'begin');
select t.dblink_exec('c2', 'begin');
select * from t.dblink('c1', $q$select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', true)$q$) as x(v text);
select * from t.dblink('c2', $q$select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', true)$q$) as x(v text);
select * from t.dblink('c1', format($q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 80)::text$q$,
  (select v from t.ids where k='n_personal'), (select v from t.ids where k='conc'))) as x(v text);
select t.dblink_send_query('c2', format($q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 80)::text$q$,
  (select v from t.ids where k='n_personal'), (select v from t.ids where k='conc')));
select pg_sleep(0.5);
select t.ok(t.dblink_is_busy('c2') = 1, 'second spend waits for account lock');
select t.dblink_exec('c1', 'commit');
select * from t.dblink_get_result('c2', false) as x(v text);
select t.ok(t.dblink_error_message('c2') like '%saldo_negatif%', 'parallel spend rejected saldo_negatif');
select * from t.dblink_get_result('c2', false) as x(v text);
select t.dblink_exec('c2', 'rollback');
select t.dblink_disconnect('c1');
select t.dblink_disconnect('c2');
set role dompetku_web;
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
select t.ok((select balance from app.account_balances where account_id = (select v from t.ids where k='conc')) = 20,
            'parallel balance not negative');
reset role;

-- ===== Audit: user_id dari konteks, event dan meta daftar tertutup =====
set role dompetku_web;
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
select audit.log('login_success', '1.2.3.4');
select t.ok((select user_id = '11111111-1111-1111-1111-111111111111' from audit.events
             where event = 'login_success' order by id desc limit 1), 'audit user from context');
select t.expect_error($q$select audit.log('login_success', '22222222-2222-2222-2222-222222222222'::uuid, '1.2.3.4')$q$, '42883');
select t.expect_error($q$select audit.log('login_success', null, null, null, '{"nominal": 999999}')$q$, '23514');
select t.expect_error($q$select audit.log('login_success', null, null, null, '{"reason": {"nominal": 1}}')$q$, '23514');
select t.expect_error($q$select audit.log('apa_saja')$q$, '23514');
select t.expect_error($q$insert into audit.events (event) values ('login_success')$q$, '42501');
select audit.log('export', null, null, (select v from t.ids where k='f_personal'), '{"count": 1}');
select t.ok((select space_id is null from audit.events where event = 'export' order by id desc limit 1),
            'audit ignores foreign space_id');
-- Metrik produk tanpa nominal (keputusan #15).
select t.expect_error($q$insert into app.product_events (user_id, event) values (app.current_user_id(), 'catat_disimpan')$q$, '23514');
select t.expect_error($q$insert into app.product_events (user_id, event) values (app.current_user_id(), 'nominal_35000')$q$, '23514');
insert into app.product_events (user_id, space_kind, event, flow_id, taps, duration_ms)
  values (app.current_user_id(), 'personal', 'catat_disimpan', gen_random_uuid(), 3, 6400);
reset role;

-- ===== Tagihan mulai di masa lalu dan tagihan terarsip (keputusan #6) =====
set role dompetku_web;
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
insert into t.ids select 'internet', (api.create_category(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  'expense', 'Internet', 'WifiHigh') ->> 'category_id')::uuid;
insert into t.ids select 'bill_old', (api.create_bill(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  'Internet', 50000, (select v from t.ids where k='internet'), 1::smallint,
  (date_trunc('month', app.today()) - interval '9 months')::date) ->> 'bill_id')::uuid;
reset role;
set role dompetku_worker;
select jobs.materialize_bills();
reset role;
set role dompetku_web;
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
select t.ok(not exists (select 1 from app.bill_schedule where bill_id = (select v from t.ids where k='bill_old')
                        and due_on < date_trunc('month', app.today())::date), 'past months not materialized');
select t.ok(exists (select 1 from app.bill_schedule where bill_id = (select v from t.ids where k='bill_old')
                    and due_on = date_trunc('month', app.today())::date), 'current month materialized');
insert into t.nums select 'bills0', bills_until_eom from api.safe_to_spend((select v from t.ids where k='n_personal'));
select api.archive_bill((select v from t.ids where k='bill_old'));
select t.ok((select bills_until_eom from api.safe_to_spend((select v from t.ids where k='n_personal')))
            = (select v from t.nums where k='bills0') - 50000, 'archived bill not counted');
reset role;
-- Pindah induk kategori yang dipakai tagihan ditolak (XOR tidak bisa dilewati).
set role dompetku_owner;
select t.expect_error($q$update app.categories set parent_id = (select v from t.ids where k='makan') where id = (select v from t.ids where k='internet')$q$, 'DK422', 'category_in_obligation');
reset role;

-- ===== Arsip dompet hanya saldo 0 (keputusan #8) =====
set role dompetku_web;
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
select t.expect_error($q$select api.archive_account((select v from t.ids where k='bca'))$q$, 'DK422', 'balance_not_zero');
insert into t.ids select 'lama', (api.create_account(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  'Dompet lama', 'operasional', 'cash', null, 0) ->> 'account_id')::uuid;
select api.create_entry(gen_random_uuid(), (select v from t.ids where k='n_personal'), (select v from t.ids where k='lama'), 'income', 1000);
insert into t.ids select 'lama_exp', (api.create_entry(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  (select v from t.ids where k='lama'), 'expense', 1000) ->> 'entry_id')::uuid;
select t.ok((api.archive_account((select v from t.ids where k='lama')) ->> 'archived')::boolean, 'archive at zero');
select t.ok((api.archive_account((select v from t.ids where k='lama')) ->> 'archived')::boolean, 'archive idempotent');
select t.expect_error($q$select api.create_entry(gen_random_uuid(), (select v from t.ids where k='n_personal'), (select v from t.ids where k='lama'), 'income', 1)$q$, 'DK422', 'account_archived');
select t.expect_error($q$select api.void_entry(gen_random_uuid(), (select v from t.ids where k='lama_exp'), 1)$q$, 'DK422', 'account_archived');
reset role;

-- ===== Cek bentuk (DK500) lewat owner =====
set role dompetku_owner;
begin;
insert into app.entries (id, space_id, space_kind, kind, occurred_on, created_by, updated_by)
values ('44444444-0000-0000-0000-000000000001', (select v from t.ids where k='n_personal'), 'personal',
        'expense', app.today(), '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111');
insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
values ('44444444-0000-0000-0000-000000000001', (select v from t.ids where k='n_personal'), 'main',
        (select v from t.ids where k='bca'), 5000);
select t.expect_error('set constraints all immediate', 'DK500', 'entry_shape_invalid');
rollback;
-- Append-only history
select t.expect_error($q$update app.entry_history set via = 'cli'$q$, 'DK422', 'append_only');
select t.expect_error($q$delete from app.entry_history$q$, 'DK422', 'append_only');
select t.expect_error($q$truncate audit.events$q$, 'DK422', 'append_only');
reset role;

-- ===== Purge (jam dimajukan, env test) =====
set role dompetku_owner;
update app.settings set value = 'test' where key = 'env';
reset role;
set role dompetku_web;
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
select api.void_entry(gen_random_uuid(), (select v from t.ids where k='st'), 3);
reset role;
set role dompetku_worker;
select set_config('app.now_override', (now() + interval '91 days')::text, false);
select t.ok(jobs.purge_voided() = 2, 'purge pair');
select t.ok((select count(*) from jobs.dq_reconcile() where violations > 0) = 0, 'dq clean');
select set_config('app.now_override', '', false);
reset role;
select t.ok((select count(*) from app.entry_tombstones) = 2, 'tombstones');
select t.ok(not exists (select 1 from app.entry_history h join app.entry_tombstones x on x.entry_id = h.entry_id), 'history purged');


-- ===== Sampah (keputusan #10) =====
set role dompetku_web;
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
insert into t.ids select 'trash', (api.create_entry(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  (select v from t.ids where k='bca'), 'expense', 1000, null, null, 'Salah catat') ->> 'entry_id')::uuid;
select t.expect_error($q$select api.purge_entry((select v from t.ids where k='trash'), 1)$q$, 'DK422', 'not_voided');
select api.void_entry(gen_random_uuid(), (select v from t.ids where k='trash'), 1);
select t.ok((select amount = 1000 and description = 'Salah catat'
             from api.trash_list((select v from t.ids where k='n_personal'))
             where entry_id = (select v from t.ids where k='trash')), 'trash list');
select t.expect_error($q$select api.purge_entry((select v from t.ids where k='trash'), 1)$q$, 'DK409');
select t.ok((api.purge_entry((select v from t.ids where k='trash'), 2) ->> 'purged')::int = 1, 'purge entry');
select t.expect_error($q$select api.purge_entry((select v from t.ids where k='trash'), 2)$q$, 'DK404');
select t.ok(not exists (select 1 from api.trash_list((select v from t.ids where k='n_personal'))
                        where entry_id = (select v from t.ids where k='trash')), 'purged leaves trash');
select t.ok(exists (select 1 from app.entry_tombstones where entry_id = (select v from t.ids where k='trash')), 'purge tombstone');
select set_config('app.user_id', '22222222-2222-2222-2222-222222222222', false);
select t.expect_error($q$select * from api.trash_list((select v from t.ids where k='n_personal'))$q$, 'DK404');
reset role;

-- ===== Bersama ke Pribadi: deskripsi hanya di kaki Pribadi (keputusan #9) =====
set role dompetku_web;
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
select api.create_transfer(gen_random_uuid(), (select v from t.ids where k='n_personal'),
  (select v from t.ids where k='bca'), (select v from t.ids where k='kasrumah'), 50000);
select api.create_transfer(gen_random_uuid(), (select v from t.ids where k='shared'),
  (select v from t.ids where k='kasrumah'), (select v from t.ids where k='bca'), 40000, 0, null,
  'kado rahasia untuk Farida', 'ambil sebagian');
select t.ok((select description = 'kado rahasia untuk Farida' and shared_note is null from app.entries
             where kind = 'space_transfer' and space_kind = 'personal' and direction = 'in'), 'desc on personal leg');
select set_config('app.user_id', '22222222-2222-2222-2222-222222222222', false);
select t.ok(not exists (select 1 from app.entries where description like '%kado%'), 'farida no desc');
select t.ok(not exists (select 1 from app.entry_history where snapshot::text like '%kado%'), 'farida no desc in history');
select t.ok((select shared_note = 'ambil sebagian' and description is null from app.entries
             where kind = 'space_transfer' and direction = 'out'), 'shared leg note only');
reset role;
set role dompetku_owner;
select t.expect_error($q$update app.entries set description = 'x' where kind = 'space_transfer' and space_kind = 'shared'$q$, '23514');
reset role;

-- ===== Akun setengah jadi dihapus setelah 72 jam =====
set role dompetku_worker;
select set_config('app.now_override', (now() + interval '73 hours')::text, false);
select t.ok(jobs.purge_unfinished_users() = 1, 'purge unfinished user');
select set_config('app.now_override', '', false);
reset role;
select t.ok((select count(*) from auth."user") = 2, 'two real users remain');

-- ===== Katalog =====
select t.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('app', 'audit') and c.relkind = 'r' and c.relname <> 'settings'
    and not (c.relrowsecurity and c.relforcerowsecurity)), 'all tables RLS forced');
select t.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
       aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname in ('app', 'api', 'private', 'jobs', 'audit') and a.grantee = 0), 'no PUBLIC execute');
select t.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app', 'api', 'private', 'jobs', 'audit')
    and (p.proconfig is null or not ('search_path=""' = any (p.proconfig)))), 'search_path pinned');
select t.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app', 'api', 'private', 'jobs') and p.prosrc ~* 'current_date|localtimestamp'), 'no current_date');
select t.ok(not has_table_privilege('dompetku_web', 'app.entries', 'INSERT')
        and not has_table_privilege('dompetku_web', 'app.entry_lines', 'DELETE')
        and not has_table_privilege('dompetku_worker', 'app.entries', 'SELECT'), 'web/worker no ledger DML');
select t.ok((select array_agg(n.nspname || '.' || p.proname order by n.nspname || '.' || p.proname) from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where p.prosecdef and n.nspname = 'app')
            = array['app.my_space_ids', 'app.space_roster'], 'read DEFINER allowlist');
select t.ok(not has_table_privilege('dompetku_web', 'audit.events', 'INSERT'), 'web no audit insert');
-- Setiap FK punya indeks non-parsial dengan kolom terdepan = kolom FK.
select t.ok(not exists (
  select 1 from pg_constraint c join pg_namespace n on n.oid = c.connamespace
  where c.contype = 'f' and n.nspname in ('app', 'audit')
    and not exists (
      select 1 from pg_index i
      where i.indrelid = c.conrelid and i.indpred is null
        and (select array_agg(k order by k)
               from unnest((string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)]) k)
            = (select array_agg(k order by k) from unnest(c.conkey) k))), 'every FK indexed');
select t.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.prosecdef and p.proowner <> 'dompetku_api'::regrole), 'api DEFINER owned by api');
select t.ok(not exists (
  select 1 from pg_proc p where p.prosecdef and p.prosrc ~* 'create\s+temp'), 'no temp tables in DEFINER');
select t.ok((select array_agg(n.nspname || '.' || p.proname order by n.nspname || '.' || p.proname) from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where p.prosecdef and p.proowner = 'dompetku_owner'::regrole)
            = array[
              'app.my_space_ids', 'app.space_roster', 'audit.log',
              'jobs.materialize_bills', 'jobs.purge_audit', 'jobs.purge_idempotency',
              'jobs.purge_unfinished_users', 'jobs.purge_voided',
              'private.assert_entry_shape', 'private.assert_space_transfer_pair',
              'private.provision_user', 'private.purge_entries',
              'private.tg_category_depth', 'private.tg_entry_shape', 'private.tg_obligation_xor',
              'private.tg_space_member_guard', 'private.tg_user_admission'], 'owner DEFINER allowlist');
\echo ALL TESTS PASSED
