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

-- migrate:down
-- Maju-saja di produksi (BSD §12); dbmate mewajibkan penanda ini.
