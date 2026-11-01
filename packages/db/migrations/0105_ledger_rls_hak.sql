-- migrate:up
-- BSD §11, bagian S5: RLS (ENABLE + FORCE), policy, hak tabel ledger, EXECUTE fungsi non-api,
-- kepemilikan dq_run/dq_reconcile. Pola sama dengan 0008. api.* sudah lewat
-- private.own_api_functions di 0101 sampai 0103.

-- ===== RLS: aktif dan dipaksa di semua tabel ledger =====
do $$
declare t text;
begin
  foreach t in array array[
    'app.accounts', 'app.categories', 'app.entries', 'app.entry_lines', 'app.entry_history',
    'app.entry_tombstones']
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
    'app.accounts', 'app.categories', 'app.entries', 'app.entry_lines', 'app.entry_history']
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

-- ===== Hak tabel =====
grant select on app.accounts, app.categories, app.entries, app.entry_lines, app.entry_history,
  app.entry_tombstones, app.account_balances, app.report_lines
  to dompetku_web, dompetku_api;

grant insert, update on app.accounts, app.categories, app.entries to dompetku_api;
grant insert, delete on app.entry_lines to dompetku_api;
grant insert         on app.entry_history to dompetku_api;

-- 0008 memberi auditor SELECT pada tabel app yang ada saat itu; tabel dan view S5 ditambah di sini.
grant select on app.accounts, app.categories, app.entries, app.entry_lines, app.entry_history,
  app.entry_tombstones, app.account_balances, app.report_lines
  to dompetku_auditor;
grant select, insert, update on jobs.job_runs to dompetku_worker;
-- dompetku_auditlog: default privileges 0008 sudah mencakup tabel baru di app (tes katalog).

-- ===== Kepemilikan & EXECUTE fungsi =====
grant create on schema private, jobs to dompetku_auditor;
alter function private.dq_run() owner to dompetku_auditor;
alter function jobs.dq_reconcile() owner to dompetku_auditor;
grant usage on schema jobs to dompetku_auditor;
revoke create on schema private, jobs from dompetku_auditor;

grant execute on function app.report_class(app.entry_kind, app.line_role, app.pocket,
  app.space_kind, app.entry_direction, boolean)
  to dompetku_web, dompetku_api, dompetku_auditor;
grant execute on function private.purge_entries(uuid[], text) to dompetku_api;

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

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'
-- (nilai bawaan dari 0001); CI/lokal mengubah env dulu sebelum rollback.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
revoke execute on function jobs.purge_voided(), jobs.purge_idempotency(), jobs.dq_reconcile()
  from dompetku_worker;
revoke execute on function private.purge_entries(uuid[], text) from dompetku_api;
revoke execute on function app.report_class(app.entry_kind, app.line_role, app.pocket,
  app.space_kind, app.entry_direction, boolean)
  from dompetku_web, dompetku_api, dompetku_auditor;

alter function jobs.dq_reconcile() owner to dompetku_owner;
alter function private.dq_run() owner to dompetku_owner;
revoke usage on schema jobs from dompetku_auditor;

revoke all on jobs.job_runs from dompetku_worker;
revoke all on app.accounts, app.categories, app.entries, app.entry_lines, app.entry_history,
  app.entry_tombstones, app.account_balances, app.report_lines
  from dompetku_web, dompetku_api, dompetku_auditor;

drop policy member_read on app.entry_tombstones;
do $$
declare t text;
begin
  foreach t in array array[
    'app.accounts', 'app.categories', 'app.entries', 'app.entry_lines', 'app.entry_history']
  loop
    execute format('drop policy member_write on %s', t);
    execute format('drop policy member_read on %s', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'app.accounts', 'app.categories', 'app.entries', 'app.entry_lines', 'app.entry_history',
    'app.entry_tombstones']
  loop
    execute format('alter table %s no force row level security', t);
    execute format('alter table %s disable row level security', t);
  end loop;
end $$;
