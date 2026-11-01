-- migrate:up
-- BSD §7 (keanggotaan, require_user, penjaga anggota, append-only) dan §11
-- (private.own_api_functions). Helper ledger (idem_*, lock_accounts, balance, cek bentuk,
-- trigger kategori/kewajiban) ditambah di S5. own_api_functions dipasang sebelum migrasi api
-- pertama agar setiap file yang menyentuh skema api bisa diakhiri `select private.own_api_functions();`.

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

-- ===== Kepemilikan & EXECUTE fungsi (BSD §11) =====
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

-- ===== Trigger penjaga =====
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

-- Append-only: UPDATE dan TRUNCATE selalu ditolak; DELETE hanya di dalam fungsi purge
-- (GUC lokal dompetku.purge = 'on'). Trigger app.entry_history ditambah di S5.
create function private.tg_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_catalog.current_setting('dompetku.purge', true) = 'on' then
    return old;
  end if;
  raise exception using errcode = 'DK422', message = 'append_only';
end $$;
create trigger audit_events_append_only before update or delete on audit.events
  for each row execute function private.tg_append_only();
create trigger audit_events_no_truncate before truncate on audit.events
  for each statement execute function private.tg_append_only();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'
-- (nilai bawaan dari 0001); CI/lokal mengubah env dulu sebelum rollback.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
drop trigger audit_events_no_truncate on audit.events;
drop trigger audit_events_append_only on audit.events;
drop function private.tg_append_only();
drop trigger space_member_guard on app.space_members;
drop function private.tg_space_member_guard();
drop function private.own_api_functions();
drop function private.require_user();
drop function app.assert_member(uuid);
drop function app.space_roster(uuid);
drop function app.my_space_ids();
