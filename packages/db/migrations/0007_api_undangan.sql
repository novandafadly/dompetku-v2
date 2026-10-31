-- migrate:up
-- BSD §9.3: akun pertama dan undangan. Semua fungsi SECURITY DEFINER, search_path = '';
-- kepemilikan dipindah ke dompetku_api dan EXECUTE diberikan ke dompetku_web oleh
-- private.own_api_functions() di akhir file (template dbmate, BSD §11).
-- Tanpa "set constraints": fungsi ini tidak menyentuh tabel ber-constraint trigger (ledger, S5).

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

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi).
drop function api.accept_invitation(bytea, text);
drop function api.decline_invitation(bytea);
drop function api.invitation_peek(bytea);
drop function api.resend_invitation(uuid, text, bytea);
drop function api.revoke_invitation(uuid);
drop function api.create_invitation(text, bytea);
drop function api.bootstrap_owner(text);
