-- Isolasi dua user (BSD §13 #10, #14, #15; IPD S4: dua user x tabel x operasi) untuk tabel S4:
-- households, spaces, space_members, profiles, invitations, idempotency_keys, product_events,
-- audit.events. Semua lewat role aplikasi (web, api, worker), tidak pernah superuser.
-- ID: B1
begin;
select plan(94);
select tests.fixture();

-- Data per user di tabel yang bisa ditulis langsung.
select tests.web_exec(u, $$insert into app.product_events (user_id, event) values (app.current_user_id(), 'catat_dibuka')$$)
  from unnest(array[tests.n(), tests.f()]) u;
select tests.web_exec(u, $$select audit.log('login_success')$$) from unnest(array[tests.n(), tests.f()]) u;
select tests.api_exec(u, $$insert into app.idempotency_keys (user_id, client_id, op, request_hash)
  values (app.current_user_id(), gen_random_uuid(), 'tes', pg_catalog.sha256('x'))$$)
  from unnest(array[tests.n(), tests.f()]) u;

create temp table ids as
  select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
         tests.space_id(tests.n(), 'shared') as sh;
grant select on ids to public;

-- ===== web: SELECT =====
select is(tests.web_val(tests.n(), $$select count(*) from app.households$$), '1', 'N: households 1');
select is(tests.web_val(tests.f(), $$select count(*) from app.households$$), '1', 'F: households 1 (Bersama)');
select is(tests.web_val(tests.n(), $$select count(*) from app.spaces$$), '2', 'N: spaces 2');
select is(tests.web_val(tests.f(), $$select count(*) from app.spaces$$), '2', 'F: spaces 2');
select is(tests.web_val(tests.f(), format($$select count(*) from app.spaces where id = %L$$, (select np from ids))), '0',
  'F tidak melihat ruang Pribadi N');
select is(tests.web_val(tests.n(), format($$select count(*) from app.spaces where id = %L$$, (select fp from ids))), '0',
  'N tidak melihat ruang Pribadi F');
select is(tests.web_val(tests.n(), $$select count(*) from app.space_members$$), '3', 'N: space_members 3');
select is(tests.web_val(tests.f(), $$select count(*) from app.space_members$$), '3', 'F: space_members 3');
select is(tests.web_val(tests.f(), format($$select count(*) from app.space_members where space_id = %L$$, (select np from ids))), '0',
  'F tidak melihat anggota ruang Pribadi N');
select is(tests.web_val(tests.n(), $$select string_agg(display_name, ',') from app.profiles$$), 'Novanda', 'N: hanya profil sendiri');
select is(tests.web_val(tests.f(), $$select string_agg(display_name, ',') from app.profiles$$), 'Farida', 'F: hanya profil sendiri');
select is(tests.web_val(tests.f(), format($$select string_agg(display_name, ',' order by display_name) from app.space_roster(%L)$$,
  (select sh from ids))), 'Farida,Novanda', 'roster Bersama memuat nama pasangan');
select is(tests.web_val(tests.f(), format($$select count(*) from app.space_roster(%L)$$, (select np from ids))), '0',
  'roster ruang Pribadi pasangan kosong');
select is(tests.web_val(tests.n(), $$select count(*) from app.product_events$$), '1', 'N: product_events sendiri');
select is(tests.web_val(tests.f(), format($$select count(*) from app.product_events where user_id = %L$$, tests.n())), '0',
  'F tidak melihat product_events N');
select is(tests.web_val(tests.f(), format($$select count(*) from audit.events where user_id is distinct from %L$$, tests.f())), '0',
  'F hanya melihat audit sendiri');
select ok(tests.web_val(tests.n(), $$select count(*) from audit.events$$)::int >= 2, 'N melihat audit sendiri');
select throws_ok($$select tests.web_val(tests.n(), $q$select count(*) from app.invitations$q$)$$, '42501', null,
  'web: invitations tanpa SELECT');
select throws_ok($$select tests.web_val(tests.f(), $q$select count(*) from app.idempotency_keys$q$)$$, '42501', null,
  'web: idempotency_keys tanpa SELECT');

-- Tanpa app.user_id (koneksi pool bekas withUser): 0 baris, tanpa error cast.
select is(tests.web_val(null, $$select count(*) from app.households$$), '0', 'tanpa konteks: households 0');
select is(tests.web_val(null, $$select count(*) from app.spaces$$), '0', 'tanpa konteks: spaces 0');
select is(tests.web_val(null, $$select count(*) from app.space_members$$), '0', 'tanpa konteks: space_members 0');
select is(tests.web_val(null, $$select count(*) from app.profiles$$), '0', 'tanpa konteks: profiles 0');
select is(tests.web_val(null, $$select count(*) from app.product_events$$), '0', 'tanpa konteks: product_events 0');
select is(tests.web_val(null, $$select count(*) from audit.events$$), '0', 'tanpa konteks: audit 0');
select is(tests.web_val(null, $$select app.my_space_ids()::text$$), '{}', 'tanpa konteks: my_space_ids kosong');

-- ===== web: INSERT / UPDATE / DELETE (F terhadap baris N) =====
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), q), '42501', null, 'web INSERT ditolak: ' || t)
from (values
  ('households', $q$insert into app.households (name) values ('X')$q$),
  ('spaces', $q$insert into app.spaces (household_id, kind) select household_id, 'shared' from app.spaces limit 1$q$),
  ('space_members', format($q$insert into app.space_members (space_id, user_id) values (%L, app.current_user_id())$q$, (select np from ids))),
  ('profiles', $q$insert into app.profiles (user_id, display_name, initial) values (app.current_user_id(), 'X', 'X')$q$),
  ('invitations', $q$insert into app.invitations (household_id, email, token_hash, created_by, expires_at) values (gen_random_uuid(), 'a@b.c', pg_catalog.sha256('z'), app.current_user_id(), now())$q$),
  ('idempotency_keys', $q$insert into app.idempotency_keys (user_id, client_id, op, request_hash) values (app.current_user_id(), gen_random_uuid(), 'x', pg_catalog.sha256('x'))$q$),
  ('audit.events', $q$insert into audit.events (event) values ('login_success')$q$),
  ('product_events milik N', format($q$insert into app.product_events (user_id, event) values (%L, 'catat_dibuka')$q$, tests.n()))
) v (t, q);
select lives_ok($$select tests.web_exec(tests.f(), $q$insert into app.product_events (user_id, event) values (app.current_user_id(), 'tanpa_pengeluaran')$q$)$$,
  'web INSERT product_events sendiri');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), q), '42501', null, 'web UPDATE ditolak: ' || t)
from (values
  ('households', $q$update app.households set name = 'X'$q$),
  ('spaces', $q$update app.spaces set created_at = now()$q$),
  ('space_members', $q$update app.space_members set role = 'owner'$q$),
  ('profiles', $q$update app.profiles set display_name = 'X'$q$),
  ('invitations', $q$update app.invitations set used_at = now()$q$),
  ('idempotency_keys', $q$update app.idempotency_keys set result = '{}'$q$),
  ('product_events', $q$update app.product_events set taps = 1$q$),
  ('audit.events', $q$update audit.events set ip = null$q$)
) v (t, q);
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), q), '42501', null, 'web DELETE ditolak: ' || t)
from (values
  ('households', $q$delete from app.households$q$),
  ('spaces', $q$delete from app.spaces$q$),
  ('space_members', $q$delete from app.space_members$q$),
  ('profiles', $q$delete from app.profiles$q$),
  ('invitations', $q$delete from app.invitations$q$),
  ('idempotency_keys', $q$delete from app.idempotency_keys$q$),
  ('product_events', $q$delete from app.product_events$q$),
  ('audit.events', $q$delete from audit.events$q$)
) v (t, q);

-- ===== api (pemilik fungsi api.*): SELECT dipagari policy yang sama =====
select is(tests.api_val(tests.f(), format($$select count(*) from app.spaces where id = %L$$, (select np from ids))), '0',
  'api/F tidak melihat ruang Pribadi N');
select is(tests.api_val(tests.f(), format($$select count(*) from app.space_members where space_id = %L$$, (select np from ids))), '0',
  'api/F tidak melihat anggota ruang Pribadi N');
select is(tests.api_val(tests.f(), $$select count(*) from app.households$$), '1', 'api/F households 1');
select is(tests.api_val(tests.f(), $$select string_agg(display_name, ',') from app.profiles$$), 'Farida', 'api/F profil sendiri');
select is(tests.api_val(tests.n(), $$select count(*) from app.invitations$$), '1', 'api/N melihat undangan buatannya');
select is(tests.api_val(tests.f(), $$select count(*) from app.invitations$$), '0', 'api/F tidak melihat undangan N');
select is(tests.api_val(tests.f(), $$select count(*) from app.idempotency_keys$$), '1', 'api/F hanya kunci idempotensi sendiri');
select is(tests.api_val(null, $$select count(*) from app.idempotency_keys$$), '0', 'api tanpa konteks: kunci 0');
select is(tests.api_val(null, $$select count(*) from app.invitations$$), '0', 'api tanpa konteks/token: undangan 0');

-- api: INSERT
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.f(), q), '42501', null, 'api INSERT ditolak: ' || t)
from (values
  ('households', $q$insert into app.households (name) values ('X')$q$),
  ('spaces', $q$insert into app.spaces (household_id, kind) select household_id, 'shared' from app.spaces limit 1$q$),
  ('space_members', format($q$insert into app.space_members (space_id, user_id) values (%L, app.current_user_id())$q$, (select np from ids))),
  ('profiles', $q$insert into app.profiles (user_id, display_name, initial) values (app.current_user_id(), 'X', 'X')$q$),
  ('invitations atas nama N', format($q$insert into app.invitations (household_id, email, token_hash, created_by, created_at, expires_at)
     select household_id, 'a@b.c', pg_catalog.sha256('z'), %L, now(), now() + interval '72 hours' from app.spaces where kind = 'shared'$q$, tests.n())),
  ('idempotency_keys milik N', format($q$insert into app.idempotency_keys (user_id, client_id, op, request_hash)
     values (%L, gen_random_uuid(), 'x', pg_catalog.sha256('x'))$q$, tests.n())),
  ('product_events', $q$insert into app.product_events (user_id, event) values (app.current_user_id(), 'catat_dibuka')$q$),
  ('audit.events', $q$insert into audit.events (event) values ('login_success')$q$)
) v (t, q);

-- api: UPDATE baris pasangan = 0 baris; baris sendiri bisa (profiles).
select is(tests.api_exec(tests.f(), format($$update app.profiles set display_name = 'X' where user_id = %L$$, tests.n())), 0::bigint,
  'api/F UPDATE profil N: 0 baris');
select is(tests.api_exec(tests.f(), $$update app.profiles set payday_day = 25 where user_id = app.current_user_id()$$), 1::bigint,
  'api/F UPDATE profil sendiri');
select is(tests.api_exec(tests.f(), $$update app.invitations set revoked_at = now(), revoke_reason = 'revoked'$$), 0::bigint,
  'api/F UPDATE undangan N: 0 baris');
select is(tests.api_exec(tests.f(), format($$update app.idempotency_keys set result = '{}' where user_id = %L$$, tests.n())), 0::bigint,
  'api/F UPDATE kunci N: 0 baris');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.f(), q), '42501', null, 'api UPDATE ditolak: ' || t)
from (values
  ('households', $q$update app.households set name = 'X'$q$),
  ('spaces', $q$update app.spaces set created_at = now()$q$),
  ('space_members', $q$update app.space_members set role = 'owner'$q$)
) v (t, q);
-- api: DELETE tanpa hak di semua tabel S4.
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.f(), q), '42501', null, 'api DELETE ditolak: ' || t)
from (values
  ('households', $q$delete from app.households$q$),
  ('spaces', $q$delete from app.spaces$q$),
  ('space_members', $q$delete from app.space_members$q$),
  ('profiles', $q$delete from app.profiles$q$),
  ('invitations', $q$delete from app.invitations$q$),
  ('idempotency_keys', $q$delete from app.idempotency_keys$q$)
) v (t, q);

-- ===== worker: tanpa akses tabel domain dan auth =====
select throws_ok(format($$select tests.worker_val(null, %L)$$, 'select count(*) from ' || t), '42501', null,
  'worker SELECT ditolak: ' || t)
from unnest(array['app.households', 'app.spaces', 'app.space_members', 'app.profiles', 'app.invitations',
                  'app.idempotency_keys', 'app.product_events', 'audit.events', 'auth."user"',
                  'auth.recovery_codes']) t;

-- ===== app.assert_member =====
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), format('select app.assert_member(%L)', (select np from ids))),
  'DK404', 'space_not_found', 'assert_member ruang Pribadi pasangan = DK404');
select throws_ok(format($$select tests.web_exec(null, %L)$$, format('select app.assert_member(%L)', (select sh from ids))),
  'DK401', 'unauthenticated', 'assert_member tanpa konteks = DK401');
select lives_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), format('select app.assert_member(%L)', (select sh from ids))),
  'assert_member ruang Bersama sendiri');

select * from finish();
rollback;
