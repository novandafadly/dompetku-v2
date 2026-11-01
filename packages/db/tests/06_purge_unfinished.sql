-- Akun setengah jadi (tanpa profil) dihapus jobs.purge_unfinished_users setelah 72 jam
-- (keputusan pemilik #3, BSD §10), beserta kode pemulihan, metrik, dan kunci idempotensinya.
begin;
select plan(13);
select tests.fixture(false);

select tests.web_exec(tests.n(), $$select api.create_invitation('farida@example.test', pg_catalog.sha256('t1'))$$);
select tests.signup(tests.f(), 'farida@example.test', true, true);
select tests.web_exec(tests.f(), $$insert into app.product_events (user_id, event) values (app.current_user_id(), 'catat_dibuka')$$);
select tests.api_exec(tests.f(), $$insert into app.idempotency_keys (user_id, client_id, op, request_hash)
  values (app.current_user_id(), gen_random_uuid(), 'tes', pg_catalog.sha256('x'))$$);

select throws_ok($$select tests.web_val(null, $q$select jobs.purge_unfinished_users()$q$)$$, '42501', null,
  'web tidak bisa menjalankan purge_unfinished_users');
select is(tests.worker_val(null, $$select jobs.purge_unfinished_users()$$), '0', 'akun baru tidak dihapus');
select tests.clock(interval '71 hours');
select is(tests.worker_val(null, $$select jobs.purge_unfinished_users()$$), '0', '71 jam: belum dihapus');
select tests.clock(interval '73 hours');
select is(tests.worker_val(null, $$select jobs.purge_unfinished_users()$$), '1', '73 jam: akun setengah jadi dihapus');
select is(tests.owner_val(null, format($$select count(*) from auth."user" where id = %L$$, tests.f())), '0', 'user auth hilang');
select is(tests.owner_val(null, format($$select count(*) from auth.recovery_codes where user_id = %L$$, tests.f())), '0',
  'kode pemulihan ikut terhapus (cascade)');
select is(tests.owner_val(null, format($$select count(*) from app.product_events where user_id = %L$$, tests.f())), '0',
  'product_events ikut terhapus');
select is(tests.owner_val(null, format($$select count(*) from app.idempotency_keys where user_id = %L$$, tests.f())), '0',
  'kunci idempotensi ikut terhapus');
select is(tests.owner_val(null, format($$select count(*) from auth."user" where id = %L$$, tests.n())), '1',
  'user yang sudah diprovisikan tetap ada');
select is(tests.owner_val(null, $$select coalesce(user_id::text, 'null') || ' ' || (meta ->> 'count')
  from audit.events where event = 'unfinished_user_purged'$$), 'null 1', 'jumlah dicatat di audit tanpa user_id');
select is(tests.worker_val(null, $$select jobs.purge_unfinished_users()$$), '0', 'job idempoten');
-- Undangannya sudah kedaluwarsa, jadi email yang sama tidak bisa mendaftar lagi tanpa undangan baru.
select throws_ok($$select tests.signup(tests.f(), 'farida@example.test', true, true)$$,
  'DK422', 'signup_closed', 'daftar ulang butuh undangan baru');
select lives_ok($$select tests.web_exec(tests.n(), $q$select api.create_invitation('farida@example.test', pg_catalog.sha256('t2'))$q$)$$,
  'pemilik bisa mengundang lagi');

select * from finish();
rollback;
