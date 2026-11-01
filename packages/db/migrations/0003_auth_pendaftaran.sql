-- migrate:up
-- BSD §5: kode pemulihan, pendaftaran tertutup + batas keras 2 user, hak skema auth.
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
    if not exists (select 1 from app.settings s where s.key = 'owner_email'
                   and lower(btrim(s.value)) = v_email) then
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

-- Review S4: email terikat undangan dan owner_email, jadi tidak boleh berubah setelah daftar
-- (trigger pendaftaran hanya berjalan saat INSERT). changeEmail Better Auth tetap mati.
create function private.tg_user_email_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    raise exception using errcode = 'DK422', message = 'email_immutable';
  end if;
  return new;
end $$;
create trigger user_email_immutable before update of email on auth."user"
  for each row execute function private.tg_user_email_immutable();

grant select, insert, update, delete on all tables in schema auth to dompetku_web;
alter default privileges for role dompetku_owner in schema auth
  grant select, insert, update, delete on tables to dompetku_web;

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'
-- (nilai bawaan dari 0001); CI/lokal mengubah env dulu sebelum rollback.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
alter default privileges for role dompetku_owner in schema auth
  revoke select, insert, update, delete on tables from dompetku_web;
revoke select, insert, update, delete on all tables in schema auth from dompetku_web;
drop trigger user_email_immutable on auth."user";
drop function private.tg_user_email_immutable();
drop trigger user_admission on auth."user";
drop function private.tg_user_admission();
drop table auth.recovery_codes;
