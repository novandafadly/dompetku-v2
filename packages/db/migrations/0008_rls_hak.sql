-- migrate:up
-- BSD §11, bagian S4: RLS (ENABLE + FORCE), policy, hak tabel, EXECUTE fungsi non-api.
-- Tabel ledger, view laporan, jobs.job_runs, dan kepemilikan dq_run menyusul di S5 dengan pola
-- yang sama. Policy memakai (select ...) agar dievaluasi sekali per query (initplan).

-- ===== RLS: aktif dan dipaksa di semua tabel domain =====
do $$
declare t text;
begin
  foreach t in array array[
    'app.households', 'app.spaces', 'app.space_members', 'app.profiles',
    'app.idempotency_keys', 'app.invitations', 'app.product_events', 'audit.events']
  loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
  end loop;
end $$;

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
grant select on app.households, app.spaces, app.space_members, app.profiles
  to dompetku_web, dompetku_api;
grant select, insert on app.product_events to dompetku_web;
grant select on audit.events to dompetku_web;

grant insert, update on app.invitations, app.idempotency_keys to dompetku_api;
grant select         on app.invitations, app.idempotency_keys to dompetku_api;
grant update         on app.profiles to dompetku_api;

grant select on all tables in schema app to dompetku_auditor;

-- BSD §12: audit objek pgaudit lewat role dompetku_auditlog (nologin) di semua tabel app, audit,
-- auth, termasuk tabel yang dibuat migrasi berikutnya (S5, Better Auth).
grant select, insert, update, delete on all tables in schema app, audit, auth to dompetku_auditlog;
alter default privileges for role dompetku_owner in schema app, audit, auth
  grant select, insert, update, delete on tables to dompetku_auditlog;

-- ===== EXECUTE fungsi (api.* sudah lewat private.own_api_functions di 0007) =====
grant execute on function app.my_space_ids(), app.space_roster(uuid), app.assert_member(uuid)
  to dompetku_web, dompetku_api, dompetku_auditor;
grant execute on function private.provision_user(uuid, text, uuid, text) to dompetku_api;
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

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'
-- (nilai bawaan dari 0001); CI/lokal mengubah env dulu sebelum rollback.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
revoke execute on function jobs.purge_unfinished_users(), jobs.purge_audit() from dompetku_worker;
revoke execute on function audit.log(text, inet, text, uuid, jsonb) from dompetku_web, dompetku_worker;
revoke execute on function private.provision_user(uuid, text, uuid, text) from dompetku_api;
revoke execute on function app.my_space_ids(), app.space_roster(uuid), app.assert_member(uuid)
  from dompetku_web, dompetku_api, dompetku_auditor;
alter default privileges for role dompetku_owner in schema app, audit, auth
  revoke select, insert, update, delete on tables from dompetku_auditlog;
revoke all on all tables in schema app, audit, auth from dompetku_auditlog;
revoke select on all tables in schema app from dompetku_auditor;
grant select on app.settings to dompetku_auditor;  -- dari 0001
revoke all on app.households, app.spaces, app.space_members, app.profiles, app.product_events,
  app.invitations, app.idempotency_keys, audit.events
  from dompetku_web, dompetku_api;

drop policy own_read on audit.events;
drop policy own on app.product_events;
drop policy creator_or_token on app.invitations;
drop policy own on app.idempotency_keys;
drop policy own_update on app.profiles;
drop policy own_read on app.profiles;
drop policy member_read on app.households;
drop policy member_read on app.space_members;
drop policy member_read on app.spaces;

do $$
declare t text;
begin
  foreach t in array array[
    'app.households', 'app.spaces', 'app.space_members', 'app.profiles',
    'app.idempotency_keys', 'app.invitations', 'app.product_events', 'audit.events']
  loop
    execute format('alter table %s no force row level security', t);
    execute format('alter table %s disable row level security', t);
  end loop;
end $$;
