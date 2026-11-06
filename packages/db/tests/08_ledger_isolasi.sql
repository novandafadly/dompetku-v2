-- Isolasi ruang tabel ledger (BSD §13 #10 sampai #14; IPD S5: isolasi penuh semua tabel baru):
-- dua user x tabel/view ledger x SELECT/INSERT/UPDATE/DELETE untuk web, api, worker; fungsi api.*
-- dengan id pasangan = DK404 (termasuk talangan, reimburse, dan pindah ruang S7); tanpa konteks = 0 baris / DK401;
-- Bersama tidak pernah membuka data Pribadi (kaki space_transfer, riwayat, Sampah, feed, tombstone).
-- S8: api.shared_activity dan api.member_contributions ikut daftar DK404/DK401 dan kanari Bersama (BSD §13 #12).
-- S9 (0117): bills, bill_occurrences, budgets, view bill_schedule ikut matriks dua user x operasi;
-- baris ditulis sebagai dompetku_api (fungsi api tagihan/anggaran menyusul Task 5/6).
-- S9 (0118): fungsi tagihan (create/update/archive_bill, post/skip/unskip_bill_occurrence, bill_list,
-- bills_due) ikut daftar DK404/DK401 dan kanari Bersama; api kini boleh DELETE bill_occurrences
-- (api.update_bill), tetap 0 baris untuk Pribadi pasangan.
-- S9 (0119): fungsi anggaran (set/delete/copy_budgets, budget_progress, budget_overview) ikut daftar
-- DK404/DK401 dan kanari Bersama; anggaran Pribadi N tetap utuh sesudah percobaan F.
-- ID: B1, B2, B5, B6, B11, S6
begin;
select plan(263);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

select tests.owner_val(null, format($$insert into app.categories (space_id, type, name, icon)
  values (%L, 'expense', 'Makan', 'ForkKnife') returning id$$, :'np')) as ncat \gset
select tests.owner_val(null, format($$insert into app.categories (space_id, type, name, icon)
  values (%L, 'expense', 'Makan', 'ForkKnife') returning id$$, :'fp')) as fcat \gset

select tests.account(tests.n(), :'np', 'BCA', 'operasional', 1000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 300000, '2026-01-01') as kas,
       tests.account(tests.f(), :'fp', 'BCA Farida', 'operasional', 400000, '2026-01-01') as fbca \gset

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;

-- Data: entri biasa, entri batal (Sampah), entri dipurge (tombstone), setor dan ambil Bersama.
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 10000, %L, null, 'rahasia N')$$,
  :'np', :'bca', :'ncat')) ->> 'entry_id' as ne \gset
select pg_temp.call(tests.f(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 20000, %L, null, 'rahasia F')$$,
  :'fp', :'fbca', :'fcat')) ->> 'entry_id' as fe \gset
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1000, null, null, 'rahasia void N')$$,
  :'np', :'bca')) ->> 'entry_id' as nv \gset
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'nv'));
select pg_temp.call(tests.f(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 2000, null, null, 'rahasia void F')$$,
  :'fp', :'fbca')) ->> 'entry_id' as fv \gset
select pg_temp.call(tests.f(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'fv'));
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 3, null, null, 'purge N')$$,
  :'np', :'bca')) ->> 'entry_id' as np_purge \gset
select pg_temp.call(tests.f(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 4, null, null, 'purge F')$$,
  :'fp', :'fbca')) ->> 'entry_id' as fp_purge \gset
select pg_temp.call(u, format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, e))
  from (values (tests.n(), :'np_purge'), (tests.f(), :'fp_purge')) v (u, e);
select pg_temp.call(u, format($$select api.purge_entry(%L, 2)$$, e))
  from (values (tests.n(), :'np_purge'), (tests.f(), :'fp_purge')) v (u, e);
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 150000, 0, null, 'rahasia setor', 'Setoran')$$,
  :'np', :'bca', :'kas')) as setor \gset
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 50000, 0, null, 'rahasia ambil', 'Diambil')$$,
  :'sh', :'kas', :'bca')) as ambil \gset

-- Talangan (S7): N dan F masing-masing punya talangan Pribadi.
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 5000, null, null, 'talangan N', true)$$,
  :'np', :'bca')) ->> 'entry_id' as nt \gset
select pg_temp.call(tests.f(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 6000, null, null, 'talangan F', true)$$,
  :'fp', :'fbca')) ->> 'entry_id' as ft \gset

-- Hari tanpa pengeluaran (S6): N menandai Pribadi N, F menandai Pribadi F.
select tests.web_exec(u, format('select api.mark_no_spend_day(%L)', sp))
  from (values (tests.n(), :'np'::uuid), (tests.f(), :'fp'::uuid)) v (u, sp) \g /dev/null

-- Tagihan, kemunculan, anggaran (S9, 0117): kanari per orang di Pribadi, ditulis sebagai dompetku_api.
create function pg_temp.bill(p_uid uuid, p_space uuid, p_name text, p_cat uuid, p_acc uuid) returns uuid
language sql as $$
  select tests.api_val(p_uid, format($q$insert into app.bills (space_id, name, amount, category_id, account_id,
      day_of_month, starts_on, created_by)
    values (%L, %L, 485000, %L, %L, 20, '2026-03-01', app.current_user_id()) returning id$q$,
    p_space, p_name, p_cat, p_acc))::uuid
$$;
select pg_temp.bill(tests.n(), :'np', 'KANARI-N-TAGIHAN', :'ncat', :'bca') as bill,
       pg_temp.bill(tests.f(), :'fp', 'KANARI-F-TAGIHAN', :'fcat', :'fbca') as fbill \gset
select tests.api_exec(u, format($q$insert into app.bill_occurrences (space_id, bill_id, due_on, amount)
    select space_id, id, '2026-03-20', amount from app.bills where space_id = %L$q$, sp))
  from (values (tests.n(), :'np'::uuid), (tests.f(), :'fp'::uuid)) v (u, sp) \g /dev/null
select tests.api_exec(u, format($q$insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by)
    values (%L, %L, '2026-04-01', 900000, false, app.current_user_id())$q$, sp, c))
  from (values (tests.n(), :'np'::uuid, :'ncat'::uuid), (tests.f(), :'fp'::uuid, :'fcat'::uuid)) v (u, sp, c) \g /dev/null
select tests.owner_val(null, format('select id from app.bill_occurrences where bill_id = %L', :'bill')) as nocc,
       tests.owner_val(null, format('select id from app.bill_occurrences where bill_id = %L', :'fbill')) as focc \gset

create temp table rel as select unnest(array['app.accounts', 'app.categories', 'app.entries', 'app.entry_lines',
  'app.entry_history', 'app.entry_tombstones', 'app.account_balances', 'app.report_lines',
  'app.no_spend_days', 'app.bills', 'app.bill_occurrences', 'app.budgets', 'app.bill_schedule']) as t;

-- ===== web: SELECT (dua user x 13 relasi) =====
select ok(tests.web_val(tests.n(), format('select count(*) from %s where space_id = %L', t, :'np'))::int > 0,
          'web/N melihat Pribadi sendiri: ' || t) from rel;
select ok(tests.web_val(tests.f(), format('select count(*) from %s where space_id = %L', t, :'fp'))::int > 0,
          'web/F melihat Pribadi sendiri: ' || t) from rel;
select is(tests.web_val(tests.f(), format('select count(*) from %s where space_id = %L', t, :'np')), '0',
          'web/F tidak melihat Pribadi N: ' || t) from rel;
select is(tests.web_val(tests.n(), format('select count(*) from %s where space_id = %L', t, :'fp')), '0',
          'web/N tidak melihat Pribadi F: ' || t) from rel;
select is(tests.web_val(null, format('select count(*) from %s', t)), '0', 'tanpa konteks: ' || t || ' 0 baris') from rel;
select is(tests.web_val(tests.f(), format('select count(*) from %s where space_id = %L', 'app.entries', :'sh')),
          tests.web_val(tests.n(), format('select count(*) from %s where space_id = %L', 'app.entries', :'sh')),
          'Bersama: N dan F melihat entri yang sama');

-- ===== web: INSERT / UPDATE / DELETE ditolak (tanpa hak) =====
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), q), '42501', null, 'web INSERT ditolak: ' || t)
from (values
  ('accounts', format($q$insert into app.accounts (space_id, space_kind, name, pocket, wallet_type, opened_on, created_by)
     values (%L, 'personal', 'X', 'operasional', 'bank', '2026-01-01', app.current_user_id())$q$, :'fp')),
  ('categories', format($q$insert into app.categories (space_id, type, name, icon) values (%L, 'expense', 'X', 'X')$q$, :'fp')),
  ('entries', format($q$insert into app.entries (space_id, space_kind, kind, occurred_on, created_by, updated_by)
     values (%L, 'personal', 'income', '2026-03-01', app.current_user_id(), app.current_user_id())$q$, :'fp')),
  ('entry_lines', format($q$insert into app.entry_lines (entry_id, space_id, role, account_id, amount) values (%L, %L, 'fee', %L, -1)$q$, :'fe', :'fp', :'fbca')),
  ('entry_history', format($q$insert into app.entry_history (entry_id, space_id, version, op, snapshot, changed_by)
     values (%L, %L, 9, 'update', '{}', app.current_user_id())$q$, :'fe', :'fp')),
  ('entry_tombstones', format($q$insert into app.entry_tombstones (entry_id, space_id, kind, occurred_on, voided_at, voided_by)
     values (gen_random_uuid(), %L, 'income', '2026-03-01', now(), app.current_user_id())$q$, :'fp')),
  ('no_spend_days', format($q$insert into app.no_spend_days (space_id, on_date, marked_by)
     values (%L, '2026-03-01', app.current_user_id())$q$, :'fp')),
  ('bills', format($q$insert into app.bills (space_id, name, amount, category_id, day_of_month, starts_on, created_by)
     values (%L, 'X', 1, %L, 1, '2026-03-01', app.current_user_id())$q$, :'fp', :'fcat')),
  ('bill_occurrences', format($q$insert into app.bill_occurrences (space_id, bill_id, due_on, amount)
     values (%L, gen_random_uuid(), '2026-03-01', 1)$q$, :'fp')),
  ('budgets', format($q$insert into app.budgets (space_id, category_id, month, amount, updated_by)
     values (%L, %L, '2026-05-01', 1, app.current_user_id())$q$, :'fp', :'fcat'))
) v (t, q);
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), 'update ' || t || ' set space_id = space_id'), '42501', null,
  'web UPDATE ditolak: ' || t)
from unnest(array['app.accounts', 'app.categories', 'app.entries', 'app.entry_lines', 'app.entry_history',
                  'app.entry_tombstones', 'app.no_spend_days', 'app.bills', 'app.bill_occurrences', 'app.budgets']) t;
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), 'delete from ' || t), '42501', null,
  'web DELETE ditolak: ' || t)
from unnest(array['app.accounts', 'app.categories', 'app.entries', 'app.entry_lines', 'app.entry_history',
                  'app.entry_tombstones', 'app.no_spend_days', 'app.bills', 'app.bill_occurrences', 'app.budgets']) t;

-- ===== api (pemilik fungsi api.*): policy yang sama =====
select is(tests.api_val(tests.f(), format('select count(*) from %s where space_id = %L', t, :'np')), '0',
          'api/F tidak melihat Pribadi N: ' || t)
from unnest(array['app.accounts', 'app.categories', 'app.entries', 'app.entry_lines', 'app.entry_history',
                  'app.entry_tombstones', 'app.account_balances', 'app.report_lines', 'app.no_spend_days',
                  'app.bills', 'app.bill_occurrences', 'app.budgets', 'app.bill_schedule']) t;
select is(tests.api_val(null, format('select count(*) from %s', t)), '0', 'api tanpa konteks: ' || t || ' 0 baris')
from unnest(array['app.accounts', 'app.entries', 'app.entry_lines', 'app.entry_history', 'app.no_spend_days',
                  'app.bills', 'app.bill_occurrences', 'app.budgets']) t;
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.f(), q), '42501', null, 'api/F INSERT ke Pribadi N ditolak: ' || t)
from (values
  ('accounts', format($q$insert into app.accounts (space_id, space_kind, name, pocket, wallet_type, opened_on, created_by)
     values (%L, 'personal', 'X', 'operasional', 'bank', '2026-01-01', app.current_user_id())$q$, :'np')),
  ('categories', format($q$insert into app.categories (space_id, type, name, icon) values (%L, 'expense', 'X', 'X')$q$, :'np')),
  ('entries', format($q$insert into app.entries (space_id, space_kind, kind, occurred_on, created_by, updated_by)
     values (%L, 'personal', 'income', '2026-03-01', app.current_user_id(), app.current_user_id())$q$, :'np')),
  ('entry_lines', format($q$insert into app.entry_lines (entry_id, space_id, role, account_id, amount) values (%L, %L, 'fee', %L, -1)$q$, :'ne', :'np', :'bca')),
  ('entry_history', format($q$insert into app.entry_history (entry_id, space_id, version, op, snapshot, changed_by)
     values (%L, %L, 9, 'update', '{}', app.current_user_id())$q$, :'ne', :'np')),
  ('entry_tombstones', format($q$insert into app.entry_tombstones (entry_id, space_id, kind, occurred_on, voided_at, voided_by)
     values (gen_random_uuid(), %L, 'income', '2026-03-01', now(), app.current_user_id())$q$, :'fp')),
  ('no_spend_days', format($q$insert into app.no_spend_days (space_id, on_date, marked_by)
     values (%L, '2026-03-01', app.current_user_id())$q$, :'np')),
  ('bills', format($q$insert into app.bills (space_id, name, amount, category_id, day_of_month, starts_on, created_by)
     values (%L, 'X', 1, %L, 1, '2026-03-01', app.current_user_id())$q$, :'np', :'ncat')),
  ('bill_occurrences', format($q$insert into app.bill_occurrences (space_id, bill_id, due_on, amount)
     values (%L, %L, '2026-04-20', 1)$q$, :'np', :'bill')),
  ('budgets', format($q$insert into app.budgets (space_id, category_id, month, amount, updated_by)
     values (%L, %L, '2026-05-01', 1, app.current_user_id())$q$, :'np', :'ncat'))
) v (t, q);
select is(tests.api_exec(tests.f(), format('update %s set %s where space_id = %L', t, c, :'np')), 0::bigint,
          'api/F UPDATE Pribadi N: 0 baris: ' || t)
from (values ('app.accounts', 'name = ''X'''), ('app.categories', 'name = ''X'''), ('app.entries', 'version = version'),
             ('app.bills', 'name = ''X'''), ('app.bill_occurrences', 'skipped_at = now()'),
             ('app.budgets', 'amount = 1')) v (t, c);
select is(tests.api_exec(tests.f(), format('delete from app.entry_lines where space_id = %L', :'np')), 0::bigint,
          'api/F DELETE entry_lines Pribadi N: 0 baris');
select is(tests.api_exec(tests.f(), format('delete from app.no_spend_days where space_id = %L', :'np')), 0::bigint,
          'api/F DELETE no_spend_days Pribadi N: 0 baris');
select is(tests.api_exec(tests.f(), format('delete from app.budgets where space_id = %L', :'np')), 0::bigint,
          'api/F DELETE budgets Pribadi N: 0 baris');
select is(tests.api_exec(tests.f(), format('delete from app.bill_occurrences where space_id = %L', :'np')), 0::bigint,
          'api/F DELETE bill_occurrences Pribadi N: 0 baris');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.f(), q), '42501', null, 'api tanpa hak: ' || q)
from unnest(array['update app.entry_lines set amount = amount', 'update app.entry_history set version = version',
                  'update app.entry_tombstones set kind = kind', 'delete from app.accounts',
                  'delete from app.categories', 'delete from app.entries', 'delete from app.entry_history',
                  'delete from app.entry_tombstones', 'update app.no_spend_days set on_date = on_date',
                  'delete from app.bills']) q;

-- ===== worker: tanpa akses tabel ledger =====
select throws_ok(format($$select tests.worker_val(null, %L)$$, 'select count(*) from ' || t), '42501', null,
  'worker SELECT ditolak: ' || t) from rel;

-- ===== Fungsi api.* dengan id milik N, dipanggil F = DK404 (BSD §13 #11, #12) =====
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), q), 'DK404', null, 'F -> id N = DK404: ' || t)
from (values
  ('create_account', format($q$select api.create_account(gen_random_uuid(), %L, 'X', 'operasional', 'bank')$q$, :'np')),
  ('create_entry', format($q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1)$q$, :'np', :'bca')),
  ('create_transfer dari', format($q$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 1)$q$, :'np', :'bca', :'kas')),
  ('create_transfer ke', format($q$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 1)$q$, :'fp', :'fbca', :'bca')),
  ('update_entry', format($q$select api.update_entry(gen_random_uuid(), %L, 1, %L, 1, null, null, null, false)$q$, :'ne', :'fbca')),
  ('void_entry', format($q$select api.void_entry(gen_random_uuid(), %L, 1)$q$, :'ne')),
  ('restore_entry', format($q$select api.restore_entry(gen_random_uuid(), %L, 2)$q$, :'nv')),
  ('purge_entry', format($q$select api.purge_entry(%L, 2)$q$, :'nv')),
  ('reconcile_balance', format($q$select api.reconcile_balance(gen_random_uuid(), %L, 0)$q$, :'bca')),
  ('archive_account', format($q$select api.archive_account(%L)$q$, :'bca')),
  ('create_category', format($q$select api.create_category(gen_random_uuid(), %L, 'expense', 'Y', 'X')$q$, :'np')),
  ('update_category', format($q$select api.update_category(%L, 'Y', 'X', null)$q$, :'ncat')),
  ('archive_category', format($q$select api.archive_category(%L)$q$, :'ncat')),
  ('month_summary', format($q$select api.month_summary(%L, '2026-03-01')$q$, :'np')),
  ('period_summary', format($q$select api.period_summary(%L, '2026-03-01', '2026-03-31')$q$, :'np')),
  ('safe_to_spend', format($q$select api.safe_to_spend(%L)$q$, :'np')),
  ('net_worth', format($q$select api.net_worth(%L)$q$, :'np')),
  ('activity_feed', format($q$select api.activity_feed(%L)$q$, :'np')),
  ('shared_activity', format($q$select api.shared_activity(%L)$q$, :'np')),
  ('member_contributions', format($q$select api.member_contributions(%L, '2026-03-01', '2026-03-31')$q$, :'np')),
  ('pay_period', format($q$select api.pay_period(%L)$q$, :'np')),
  ('trash_list', format($q$select api.trash_list(%L)$q$, :'np')),
  ('suggest_categories', format($q$select count(*) from api.suggest_categories(%L, 'expense')$q$, :'np')),
  ('mark_no_spend_day', format($q$select api.mark_no_spend_day(%L)$q$, :'np')),
  ('create_reimbursement', format($q$select api.create_reimbursement(gen_random_uuid(), %L, %L, 1)$q$, :'nt', :'fbca')),
  ('create_reimbursement ke', format($q$select api.create_reimbursement(gen_random_uuid(), %L, %L, 1)$q$, :'ft', :'bca')),
  ('open_reimbursables', format($q$select count(*) from api.open_reimbursables(%L)$q$, :'np')),
  ('move_entry_to_space', format($q$select api.move_entry_to_space(gen_random_uuid(), %L, 1, %L, %L, null)$q$, :'ne', :'sh', :'kas')),
  ('move_entry_to_space ke', format($q$select api.move_entry_to_space(gen_random_uuid(), %L, 1, %L, %L, null)$q$, :'fe', :'np', :'bca')),
  ('move_entry_to_space dompet', format($q$select api.move_entry_to_space(gen_random_uuid(), %L, 1, %L, %L, null)$q$, :'fe', :'sh', :'bca')),
  ('create_bill', format($q$select api.create_bill(gen_random_uuid(), %L, 'X', 1, %L, 1::smallint, '2026-03-20')$q$, :'np', :'ncat')),
  ('update_bill', format($q$select api.update_bill(%L, 'X', 1, %L, 1::smallint, null, null)$q$, :'bill', :'ncat')),
  ('archive_bill', format($q$select api.archive_bill(%L)$q$, :'bill')),
  ('post_bill_occurrence', format($q$select api.post_bill_occurrence(gen_random_uuid(), %L, %L)$q$, :'nocc', :'fbca')),
  ('post_bill_occurrence dompet', format($q$select api.post_bill_occurrence(gen_random_uuid(), %L, %L)$q$, :'focc', :'bca')),
  ('skip_bill_occurrence', format($q$select api.skip_bill_occurrence(%L)$q$, :'nocc')),
  ('unskip_bill_occurrence', format($q$select api.unskip_bill_occurrence(%L)$q$, :'nocc')),
  ('bill_list', format($q$select count(*) from api.bill_list(%L)$q$, :'np')),
  ('bills_due', format($q$select count(*) from api.bills_due(%L)$q$, :'np')),
  ('set_budget', format($q$select api.set_budget(%L, %L, '2026-04-01', 1, true)$q$, :'np', :'ncat')),
  ('delete_budget', format($q$select api.delete_budget(%L, %L, '2026-04-01')$q$, :'np', :'ncat')),
  ('copy_budgets', format($q$select count(*) from api.copy_budgets(%L, '2026-04-01', '2026-05-01')$q$, :'np')),
  ('budget_progress', format($q$select count(*) from api.budget_progress(%L, '2026-04-01')$q$, :'np')),
  ('budget_overview', format($q$select count(*) from api.budget_overview(%L, '2026-04-01')$q$, :'np'))
) v (t, q);
select is(tests.owner_val(null, format($$select name || ' ' || (archived_at is null) || ' '
    || (select string_agg((entry_id is null and skipped_at is null)::text, ',') from app.bill_occurrences where bill_id = %1$L)
  from app.bills where id = %1$L$$, :'bill')), 'KANARI-N-TAGIHAN true true', 'tagihan dan kemunculan N tidak tersentuh');
select is(tests.owner_val(null, format($$select string_agg(month || ':' || amount || ':' || wajib, ',' order by month)
  from app.budgets where space_id = %L$$, :'np')), '2026-04-01:900000:false', 'anggaran N tidak tersentuh (set/hapus/salin F)');
select is(tests.web_val(tests.n(), format($$select count(*) from app.entries where id = %L and voided_at is null$$, :'ne')), '1',
  'entri N tidak tersentuh');
select is(tests.owner_val(null, format($$select version || ' ' || (voided_at is null) || ' '
  || (select count(*) from app.entries where moved_at is not null) from app.entries where id = %L$$, :'fe')),
  '1 true 0', 'percobaan pindah lintas ruang tanpa efek (entri F hidup, tidak ada entri dipindah)');
select is(tests.web_val(tests.n(), format($$select count(*) from app.categories where id = %L and name = 'Makan' and archived_at is null$$, :'ncat')), '1',
  'kategori N tidak tersentuh');
select is(tests.owner_val(null, format($$select count(*) from app.entries where reimburses_entry_id in (%L, %L)$$, :'nt', :'ft')), '0',
  'talangan N dan F tanpa reimburse sesudah percobaan lintas ruang');

-- Tanpa konteks: fungsi tulis dan baca = DK401.
select throws_ok(format($$select tests.web_exec(null, %L)$$, q), 'DK401', 'unauthenticated', 'tanpa konteks = DK401: ' || t)
from (values
  ('create_account', format($q$select api.create_account(gen_random_uuid(), %L, 'X', 'operasional', 'bank')$q$, :'sh')),
  ('create_entry', format($q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1)$q$, :'sh', :'kas')),
  ('create_transfer', format($q$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 1)$q$, :'np', :'bca', :'kas')),
  ('update_entry', format($q$select api.update_entry(gen_random_uuid(), %L, 1, %L, 1, null, null, null, false)$q$, :'ne', :'bca')),
  ('void_entry', format($q$select api.void_entry(gen_random_uuid(), %L, 1)$q$, :'ne')),
  ('restore_entry', format($q$select api.restore_entry(gen_random_uuid(), %L, 2)$q$, :'nv')),
  ('purge_entry', format($q$select api.purge_entry(%L, 2)$q$, :'nv')),
  ('reconcile_balance', format($q$select api.reconcile_balance(gen_random_uuid(), %L, 0)$q$, :'kas')),
  ('archive_account', format($q$select api.archive_account(%L)$q$, :'kas')),
  ('create_category', format($q$select api.create_category(gen_random_uuid(), %L, 'expense', 'Y', 'X')$q$, :'sh')),
  ('update_category', format($q$select api.update_category(%L, 'Y', 'X', null)$q$, :'ncat')),
  ('archive_category', format($q$select api.archive_category(%L)$q$, :'ncat')),
  ('month_summary', format($q$select api.month_summary(%L, '2026-03-01')$q$, :'sh')),
  ('safe_to_spend', format($q$select api.safe_to_spend(%L)$q$, :'sh')),
  ('net_worth', format($q$select api.net_worth(%L)$q$, :'sh')),
  ('trash_list', format($q$select api.trash_list(%L)$q$, :'sh')),
  ('shared_activity', format($q$select api.shared_activity(%L)$q$, :'sh')),
  ('member_contributions', format($q$select api.member_contributions(%L, '2026-03-01', '2026-03-31')$q$, :'sh')),
  ('pay_period', format($q$select api.pay_period(%L)$q$, :'sh')),
  ('suggest_categories', format($q$select count(*) from api.suggest_categories(%L, 'expense')$q$, :'sh')),
  ('mark_no_spend_day', format($q$select api.mark_no_spend_day(%L)$q$, :'sh')),
  ('create_reimbursement', format($q$select api.create_reimbursement(gen_random_uuid(), %L, %L, 1)$q$, :'nt', :'bca')),
  ('open_reimbursables', format($q$select count(*) from api.open_reimbursables(%L)$q$, :'np')),
  ('move_entry_to_space', format($q$select api.move_entry_to_space(gen_random_uuid(), %L, 1, %L, %L, null)$q$, :'ne', :'sh', :'kas')),
  ('create_bill', format($q$select api.create_bill(gen_random_uuid(), %L, 'X', 1, %L, 1::smallint, '2026-03-20')$q$, :'np', :'ncat')),
  ('update_bill', format($q$select api.update_bill(%L, 'X', 1, %L, 1::smallint, null, null)$q$, :'bill', :'ncat')),
  ('archive_bill', format($q$select api.archive_bill(%L)$q$, :'bill')),
  ('post_bill_occurrence', format($q$select api.post_bill_occurrence(gen_random_uuid(), %L, %L)$q$, :'nocc', :'bca')),
  ('skip_bill_occurrence', format($q$select api.skip_bill_occurrence(%L)$q$, :'nocc')),
  ('unskip_bill_occurrence', format($q$select api.unskip_bill_occurrence(%L)$q$, :'nocc')),
  ('bill_list', format($q$select count(*) from api.bill_list(%L)$q$, :'sh')),
  ('bills_due', format($q$select count(*) from api.bills_due(%L)$q$, :'sh')),
  ('set_budget', format($q$select api.set_budget(%L, %L, '2026-04-01', 1)$q$, :'np', :'ncat')),
  ('delete_budget', format($q$select api.delete_budget(%L, %L, '2026-04-01')$q$, :'np', :'ncat')),
  ('copy_budgets', format($q$select count(*) from api.copy_budgets(%L, '2026-04-01', '2026-05-01')$q$, :'sh')),
  ('budget_progress', format($q$select count(*) from api.budget_progress(%L, '2026-04-01')$q$, :'sh')),
  ('budget_overview', format($q$select count(*) from api.budget_overview(%L, '2026-04-01')$q$, :'sh'))
) v (t, q);

-- ===== Bersama tidak pernah membuka Pribadi (BSD §13 #13, keputusan pemilik #9) =====
select is(tests.web_val(tests.f(), format($$select count(*) || ' ' || string_agg(direction::text, ',') || ' '
    || coalesce(string_agg(description, ','), '-') || ' ' || string_agg(shared_note, ',')
  from app.entries where link_id = %L$$, (:'setor'::jsonb) ->> 'link_id')), '1 in - Setoran',
  'setor N: F melihat tepat satu kaki (in), tanpa deskripsi, dengan catatan');
select is(tests.web_val(tests.f(), format($$select string_agg(account_id::text, ',') from app.entry_lines where entry_id = %L$$,
  (:'setor'::jsonb) ->> 'linked_entry_id')), :'kas', 'kaki in hanya menyentuh dompet Bersama');
select is(tests.web_val(tests.f(), format($$select count(*) from app.accounts where id = %L$$, :'bca')), '0',
  'F tidak melihat dompet sumber');
select is(tests.web_val(tests.f(), format($$select count(*) from app.entry_lines where account_id = %L$$, :'bca')), '0',
  'F tidak melihat line dompet sumber');
select is(tests.web_val(tests.f(), format($$select count(*) || ' ' || string_agg(direction::text, ',') || ' '
    || coalesce(string_agg(description, ','), '-') || ' ' || string_agg(shared_note, ',')
  from app.entries where link_id = %L$$, (:'ambil'::jsonb) ->> 'link_id')), '1 out - Diambil',
  'ambil dari Bersama: F melihat kaki out tanpa deskripsi');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), format(
    $q$select api.void_entry(gen_random_uuid(), %L, 1)$q$, (:'setor'::jsonb) ->> 'linked_entry_id')),
  'DK404', 'entry_not_found', 'void kaki Bersama oleh bukan pencatat = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), format(
    $q$select api.update_entry(gen_random_uuid(), %L, 1, %L, 1, null, null, null, false)$q$,
    (:'setor'::jsonb) ->> 'linked_entry_id', :'kas')),
  'DK422', 'kind_not_editable', 'kaki space_transfer tidak bisa diubah lewat update_entry');

-- N membatalkan setoran: kedua kaki batal, Sampah Bersama tetap tanpa deskripsi.
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, (:'setor'::jsonb) ->> 'entry_id'));
select is(tests.web_val(tests.f(), format($$select count(*) || ' ' || coalesce(string_agg(description, ','), '-') || ' ' || sum(amount)
  from api.trash_list(%L)$$, :'sh')), '1 - 150000', 'Sampah Bersama: kaki in, tanpa deskripsi');
select is(tests.web_val(tests.n(), format($$select string_agg(description, ',' order by description) from api.trash_list(%L)$$, :'np')),
  'rahasia setor,rahasia void N', 'Sampah Pribadi N: deskripsi ada di kaki Pribadi');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), format(
    $q$select api.restore_entry(gen_random_uuid(), %L, 2)$q$, (:'setor'::jsonb) ->> 'linked_entry_id')),
  'DK404', 'entry_not_found', 'pulihkan kaki Bersama oleh bukan pencatat = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), format(
    $q$select api.purge_entry(%L, 2)$q$, (:'setor'::jsonb) ->> 'linked_entry_id')),
  'DK404', 'entry_not_found', 'purge kaki Bersama oleh bukan pencatat = DK404');

-- Tidak ada teks Pribadi atau id dompet Pribadi di semua yang terlihat F.
select is(tests.web_val(tests.f(), format($$select count(*) from (
    select e::text as x from app.entries e
    union all select h::text from app.entry_history h
    union all select l::text from app.entry_lines l
    union all select r::text from app.report_lines r
    union all select t::text from api.trash_list(%L) t
    union all select a::text from api.activity_feed(%L, 100) a
    union all select a::text from api.shared_activity(%L, 100) a
    union all select m::text from api.member_contributions(%L, '2026-01-01', '2026-12-31') m
    union all select b::text from app.bills b
    union all select bu::text from app.budgets bu
    union all select s::text from app.bill_schedule s
    union all select b::text from api.bill_list(%L) b
    union all select d::text from api.bills_due(%L, '2026-12-31') d
    union all select p::text from api.budget_progress(%L, '2026-04-01') p
    union all select o::text from api.budget_overview(%L, '2026-04-01') o
  ) s where x like '%%rahasia setor%%' or x like '%%rahasia ambil%%' or x like '%%rahasia N%%' or x like '%%KANARI-N-%%'
    or x like %L$$,
  :'sh', :'sh', :'sh', :'sh', :'sh', :'sh', :'sh', :'sh', '%' || :'bca' || '%')), '0',
  'F: tidak ada deskripsi Pribadi N, kanari tagihan N, atau id dompet N di entri/riwayat/line/laporan/Sampah/feed/tagihan/anggaran');
select is(tests.web_val(tests.n(), format($$select count(*) from (
    select e::text as x from app.entries e union all select h::text from app.entry_history h
    union all select t::text from app.entry_tombstones t
  ) s where x like '%%rahasia F%%' or x like '%%rahasia void F%%' or x like %L$$, '%' || :'fbca' || '%')), '0',
  'N: tidak ada data Pribadi F');
select is(tests.web_val(tests.f(), format($$select count(*) from app.entry_history where entry_id = %L$$,
  (:'setor'::jsonb) ->> 'entry_id')), '0', 'F tidak melihat riwayat kaki Pribadi');
select is(tests.web_val(tests.f(), format($$select string_agg(op::text || ':' || amount, ',' order by at, version)
  from api.activity_feed(%L, 100) where entry_id = %L$$, :'sh', (:'setor'::jsonb) ->> 'linked_entry_id')),
  'create:150000,void:150000', 'feed Bersama: kaki in dibuat lalu dibatalkan');
select is(tests.web_val(tests.f(), format($$select count(*) from app.entry_tombstones where space_id = %L$$, :'np')), '0',
  'F tidak melihat tombstone N');

select * from finish();
rollback;
