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

-- ===== Bootstrap Novanda (CLI, sebagai owner) =====
insert into auth."user" (id, name, email) values
  ('11111111-1111-1111-1111-111111111111', 'Novanda', 'novanda@example.test');
set role dompetku_owner;
select private.provision_user('11111111-1111-1111-1111-111111111111', 'Novanda', null, null);
reset role;

-- ===== Undangan Farida =====
set role dompetku_web;
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
select api.create_invitation('Farida@Example.test', sha256('token-rahasia'));
select t.expect_error($q$select api.create_invitation('x@example.test', sha256('lain'))$q$, '23505');
select set_config('app.user_id', '', false);
select t.ok((api.invitation_peek(sha256('token-rahasia')) ->> 'email') = 'farida@example.test', 'peek');
select t.expect_error($q$select api.invitation_peek(sha256('salah'))$q$, 'DK404');
insert into auth."user" (id, name, email) values
  ('22222222-2222-2222-2222-222222222222', 'Farida', 'farida@example.test');
select api.accept_invitation(sha256('token-rahasia'), '22222222-2222-2222-2222-222222222222', 'Farida');
select t.expect_error($q$select api.accept_invitation(sha256('token-rahasia'), '22222222-2222-2222-2222-222222222222', 'Farida')$q$, 'DK404');
select t.expect_error($q$insert into auth."user" (id, name, email) values (gen_random_uuid(), 'X', 'x@example.test')$q$, 'DK422', 'user_limit');
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
select t.ok((select pemasukan = 100000 and pengeluaran = 35000 + 2500 and kantor = 20000
                    and transfer = 100000 + 150000
             from api.month_summary((select v from t.ids where k='n_personal'),
                                    (app.today() - (extract(day from app.today())::int - 1)))),
            'month_summary (talangan & kantor excluded, fee counted)');
select t.ok((select operasional = 262500 and tabungan = 1100000 and kantor_excluded = 180000
                    and total = 1362500 from api.net_worth((select v from t.ids where k='n_personal'))),
            'net worth excludes kantor');

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
  1, (select v from t.ids where k='bca'), 40000, (select v from t.ids where k='kopi'), null, 'Kopi susu besar');
select t.ok((select version = 2 from app.entries where description = 'Kopi susu besar'), 'update version');
-- Cocokkan saldo
select api.reconcile_balance(gen_random_uuid(), (select v from t.ids where k='bca'), 250000);
select t.ok((select balance from app.account_balances where account_id = (select v from t.ids where k='bca')) = 250000, 'reconcile');
-- Di luar withUser: 0 baris
select set_config('app.user_id', '', false);
select t.ok((select count(*) from app.entries) = 0, 'no context = 0 rows');
select t.expect_error($q$select api.create_entry(gen_random_uuid(), null, null, 'expense', 1)$q$, 'DK401');
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
select t.ok((select array_agg(n.nspname || '.' || p.proname order by 1) from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where p.prosecdef and n.nspname = 'app')
            = array['app.my_space_ids', 'app.space_roster'], 'read DEFINER allowlist');
\echo ALL TESTS PASSED
