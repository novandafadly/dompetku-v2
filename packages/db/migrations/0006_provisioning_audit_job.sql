-- migrate:up
-- BSD §10, bagian S4: provisioning user, audit.log, job akun setengah jadi dan retensi audit.
-- Semua milik dompetku_owner (DEFINER, BYPASSRLS). purge_entries, materialize_bills,
-- purge_voided, purge_idempotency, dq_run, dq_reconcile ditambah di S5.

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
    if not exists (select 1 from app.settings s where s.key = 'owner_email'
                   and lower(btrim(s.value)) = v_email) then
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
-- Review S4: event sistem hanya ditulis langsung oleh fungsi DEFINER/owner (provisioning, job,
-- purge, skrip host), tidak pernah lewat audit.log. Di fungsi DEFINER current_user = pemilik,
-- jadi penolakan berlaku untuk semua pemanggil (web dan worker).
create function audit.log(
  p_event text, p_ip inet default null, p_user_agent text default null,
  p_space_id uuid default null, p_meta jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_event in ('space_member_change', 'unfinished_user_purged', 'entry_purged', 'purge_voided',
                 'db_manual_access', 'deploy') then
    raise exception using errcode = 'DK422', message = 'audit_event_reserved';
  end if;
  insert into audit.events (event, user_id, ip, user_agent, space_id, meta)
  values (p_event, app.current_user_id(), p_ip, left(p_user_agent, 200),
          case when p_space_id = any (app.my_space_ids()) then p_space_id end,
          coalesce(p_meta, '{}'::jsonb));
end $$;

-- ===== Job (EXECUTE hanya dompetku_worker) =====
-- Akun setengah jadi (tanpa profil) > 72 jam (keputusan pemilik #3).
-- Tabel Better Auth (session, account, passkey, twoFactor) memakai FK on delete cascade ke user.
create function jobs.purge_unfinished_users() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_n   int;
begin
  perform private.require_read_committed();  -- review S4: kunci user_cap hanya benar di RC
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

create function jobs.purge_audit() returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform pg_catalog.set_config('dompetku.purge', 'on', true);
  delete from audit.events where at < app.now() - interval '1 year';
  get diagnostics v_n = row_count;
  return v_n;
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
drop function jobs.purge_audit();
drop function jobs.purge_unfinished_users();
drop function audit.log(text, inet, text, uuid, jsonb);
drop function private.provision_user(uuid, text, uuid, text);
