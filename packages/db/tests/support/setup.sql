-- Persiapan tes pgTAP. HANYA CI/lokal, tidak pernah di VM produksi.
-- Dijalankan superuser di database dompetku setelah `dbmate up`, sebelum `pg_prove`.
--
-- Pola: pg_prove masuk sebagai dompetku_test (login, bukan superuser, tanpa keanggotaan role
-- aplikasi). Asersi pgTAP berjalan sebagai dompetku_test; setiap aksi terhadap skema berjalan
-- lewat helper tests.<role>_exec / tests.<role>_val, yaitu fungsi SECURITY DEFINER milik role
-- aplikasi itu (dompetku_web, dompetku_api, dompetku_worker, dompetku_owner). Jadi RLS, grant,
-- dan trigger diuji sebagai role aplikasi sungguhan (TRD §4: bukan superuser), sementara tabel
-- sementara pgTAP tetap milik sesi dompetku_test (role aplikasi tidak punya hak TEMPORARY).
--
-- app.user_id diisi helper (lokal transaksi, dikembalikan saat helper selesai karena helper punya
-- klausa SET). app.now_override diisi langsung oleh tes dengan set_config(..., true) dan butuh
-- app.settings env = 'test' (diubah lewat tests.owner_exec di dalam transaksi tes).
\set ON_ERROR_STOP 1

create schema tap;
create extension pgtap schema tap;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dompetku_test') then
    create role dompetku_test login nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
  end if;
end $$;
grant connect, temporary on database dompetku to dompetku_test;
alter role dompetku_test in database dompetku set search_path = tap, tests;
grant usage on schema tap to dompetku_test;

create schema tests;
grant usage on schema tests to dompetku_test;

-- tests.<role>_exec(uid, sql): jalankan sebagai role, kembalikan jumlah baris terdampak.
-- tests.<role>_val(uid, sql):  jalankan sebagai role, kembalikan kolom pertama baris pertama.
do $$
declare r text;
begin
  foreach r in array array['web', 'api', 'worker', 'owner'] loop
    execute format($f$
      create function tests.%1$s_exec(p_uid uuid, p_sql text) returns bigint
      language plpgsql security definer set search_path = '' as $b$
      declare v_n bigint;
      begin
        perform pg_catalog.set_config('app.user_id', coalesce(p_uid::text, ''), true);
        execute p_sql;
        get diagnostics v_n = row_count;
        return v_n;
      end $b$;
      create function tests.%1$s_val(p_uid uuid, p_sql text) returns text
      language plpgsql security definer set search_path = '' as $b$
      declare v text;
      begin
        perform pg_catalog.set_config('app.user_id', coalesce(p_uid::text, ''), true);
        execute p_sql into v;
        return v;
      end $b$;
      alter function tests.%1$s_exec(uuid, text) owner to dompetku_%1$s;
      alter function tests.%1$s_val(uuid, text) owner to dompetku_%1$s;
      revoke all on function tests.%1$s_exec(uuid, text), tests.%1$s_val(uuid, text) from public;
      grant execute on function tests.%1$s_exec(uuid, text), tests.%1$s_val(uuid, text)
        to dompetku_test;
    $f$, r);
  end loop;
end $$;

-- Pengguna tetap: N = Novanda (pemilik), F = Farida (pasangan), X = orang ketiga.
create function tests.n() returns uuid language sql immutable as
  $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
create function tests.f() returns uuid language sql immutable as
  $$ select '22222222-2222-2222-2222-222222222222'::uuid $$;
create function tests.x() returns uuid language sql immutable as
  $$ select '33333333-3333-3333-3333-333333333333'::uuid $$;

-- Daftarkan user lewat role web (trigger user_admission berlaku), opsional dengan kode pemulihan.
create function tests.signup(p_id uuid, p_email text, p_verified boolean, p_secured boolean)
returns void language plpgsql as $$
begin
  perform tests.web_exec(null, format(
    $q$insert into auth."user" (id, name, email, "emailVerified") values (%L, 'U', %L, %L)$q$,
    p_id, p_email, p_verified));
  if p_secured then
    perform tests.web_exec(p_id, format(
      $q$insert into auth.recovery_codes (user_id, code_hash) values (%L, '$argon2id$v=19$tes')$q$,
      p_id));
  end if;
end $$;

-- Fixture: Novanda terdaftar dan diprovisikan; opsional Farida diundang dan menerima.
create function tests.fixture(p_with_farida boolean default true) returns void
language plpgsql as $$
begin
  perform tests.owner_exec(null, $q$
    insert into app.settings (key, value) values ('owner_email', 'novanda@example.test')
    on conflict (key) do update set value = excluded.value$q$);
  perform tests.signup(tests.n(), 'novanda@example.test', true, true);
  perform tests.web_exec(tests.n(), $q$select api.bootstrap_owner('Novanda')$q$);
  if p_with_farida then
    perform tests.web_exec(tests.n(),
      $q$select api.create_invitation('farida@example.test', pg_catalog.sha256('tok-farida'))$q$);
    perform tests.signup(tests.f(), 'farida@example.test', true, true);
    perform tests.web_exec(tests.f(),
      $q$select api.accept_invitation(pg_catalog.sha256('tok-farida'), 'Farida')$q$);
  end if;
  -- set_config(..., true) di dalam fungsi undangan bertahan sampai akhir transaksi (hanya
  -- variabel di klausa SET fungsi yang dipulihkan); kosongkan agar tes berikutnya bersih.
  perform set_config('app.invite_token_hash', '', true);
end $$;

-- Id ruang (dibaca sebagai owner, untuk dipakai lewat format() di tes isolasi).
create function tests.space_id(p_uid uuid, p_kind text) returns uuid
language sql as $$
  select tests.owner_val(null, format(
    $q$select s.id from app.spaces s
       where s.kind = %L and (s.kind = 'shared' or s.owner_user_id = %L)$q$, p_kind, p_uid))::uuid
$$;

-- Nyalakan jam tiruan (env = test) dan majukan app.now() sebanyak p_shift, lokal transaksi.
create function tests.clock(p_shift interval) returns void
language plpgsql as $$
begin
  perform tests.owner_exec(null, $q$update app.settings set value = 'test' where key = 'env'$q$);
  perform set_config('app.now_override', (now() + p_shift)::text, true);
end $$;

-- Jam tiruan pada waktu tetap (tes angka per bulan), lokal transaksi.
create function tests.clock_at(p_at timestamptz) returns void
language plpgsql as $$
begin
  perform tests.owner_exec(null, $q$update app.settings set value = 'test' where key = 'env'$q$);
  perform set_config('app.now_override', p_at::text, true);
end $$;

-- Dompet baru lewat api.create_account (role web, user p_uid); kembalikan id dompet.
create function tests.account(p_uid uuid, p_space uuid, p_name text, p_pocket text,
                              p_opening bigint default 0, p_opened_on date default null)
returns uuid language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.create_account(gen_random_uuid(), %L, %L, %L, 'bank', %L::date, %s) ->> 'account_id'$q$,
    p_space, p_name, p_pocket, p_opened_on, p_opening))::uuid
$$;

-- Saldo dompet (dibaca owner, langsung dari lines, tanpa view).
create function tests.balance(p_account uuid) returns bigint
language sql as $$
  select tests.owner_val(null, format(
    $q$select coalesce(sum(l.amount), 0) from app.entry_lines l join app.entries e on e.id = l.entry_id
       where l.account_id = %L and e.voided_at is null$q$, p_account))::bigint
$$;

-- ===== Koneksi kedua lewat dblink (tes konkurensi, 99_konkurensi.sql) =====
-- Helper milik superuser (SECURITY DEFINER): dblink tanpa password hanya untuk superuser.
-- Koneksi lewat socket lokal cluster ini sebagai role aplikasi (atau postgres untuk fixture
-- yang harus di-commit). HANYA cluster tes; skema tests tidak pernah ada di VM.
create extension if not exists dblink schema tests;

create function tests.peer_open(p_name text, p_role text) returns text
language sql security definer set search_path = tests, pg_catalog as $$
  select tests.dblink_connect(p_name, format('dbname=%s port=%s host=%s user=%s application_name=%s',
    current_database(), current_setting('port'),
    split_part(current_setting('unix_socket_directories'), ',', 1), p_role, 'peer_' || p_name))
$$;
create function tests.peer_close(p_name text) returns text
language sql security definer set search_path = tests, pg_catalog as $$
  select tests.dblink_disconnect(p_name)
$$;
create function tests.peer_exec(p_name text, p_sql text) returns text
language sql security definer set search_path = tests, pg_catalog as $$
  select tests.dblink_exec(p_name, p_sql)
$$;
create function tests.peer_val(p_name text, p_sql text) returns text
language sql security definer set search_path = tests, pg_catalog as $$
  select v from tests.dblink(p_name, p_sql) as t (v text)
$$;
create function tests.peer_send(p_name text, p_sql text) returns int
language sql security definer set search_path = tests, pg_catalog as $$
  select tests.dblink_send_query(p_name, p_sql)
$$;
-- true bila koneksi p_name menunggu lock (maksimal 5 detik).
create function tests.peer_blocked(p_name text) returns boolean
language plpgsql security definer set search_path = tests, pg_catalog as $$
begin
  for i in 1..500 loop
    perform pg_stat_clear_snapshot();  -- pg_stat_activity di-cache per transaksi
    if exists (select 1 from pg_stat_activity a
               where a.application_name = 'peer_' || p_name and a.wait_event_type = 'Lock') then
      return true;
    end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end $$;
-- Hasil query yang dikirim peer_send: nilai kolom pertama, atau 'ERROR: <pesan>'.
create function tests.peer_result(p_name text) returns text
language plpgsql security definer set search_path = tests, pg_catalog as $$
declare
  v text;
  e text;
begin
  select string_agg(t.v, ',') into v from tests.dblink_get_result(p_name, false) as t (v text);
  e := tests.dblink_error_message(p_name);
  perform 1 from tests.dblink_get_result(p_name, false) as t (v text);
  return case when e is not null and e <> 'OK' then 'ERROR: ' || e else v end;
end $$;

-- Kosongkan semua data aplikasi (hanya lewat koneksi peer superuser, di-commit). Dipakai tes
-- konkurensi yang butuh fixture ter-commit; tes lain selalu rollback.
create function tests.wipe() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.set_config('dompetku.purge', 'on', true);
  delete from app.entries;
  delete from app.entry_tombstones;
  delete from app.accounts;
  delete from app.categories;
  delete from app.no_spend_days;
  delete from app.idempotency_keys;
  delete from app.product_events;
  delete from audit.events;
  delete from app.invitations;
  delete from app.profiles;
  delete from app.space_members;
  delete from app.spaces;
  delete from app.households;
  delete from auth."user";
  delete from app.settings where key = 'owner_email';
end $$;

revoke all on all functions in schema tests from public;
grant execute on function tests.n(), tests.f(), tests.x(),
  tests.signup(uuid, text, boolean, boolean), tests.fixture(boolean),
  tests.space_id(uuid, text), tests.clock(interval), tests.clock_at(timestamptz),
  tests.account(uuid, uuid, text, text, bigint, date), tests.balance(uuid),
  tests.peer_open(text, text), tests.peer_close(text), tests.peer_exec(text, text),
  tests.peer_val(text, text), tests.peer_send(text, text), tests.peer_blocked(text),
  tests.peer_result(text), tests.wipe()
  to dompetku_test;
