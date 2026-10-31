-- Siklus undangan (BSD §9.3, §13 #16): buat, intip, tolak, cabut, kirim ulang, kedaluwarsa,
-- terima hanya setelah akun diamankan, sekali pakai, terikat email.
begin;
select plan(44);
select tests.fixture(false);

-- Membuat undangan.
select throws_ok($$select tests.web_exec(null, $q$select api.create_invitation('farida@example.test', pg_catalog.sha256('t1'))$q$)$$,
  'DK401', 'unauthenticated', 'buat undangan tanpa konteks user');
select throws_ok($$select tests.web_exec(tests.n(), $q$select api.create_invitation('bukan-email', pg_catalog.sha256('t1'))$q$)$$,
  '23514', null, 'email tidak valid ditolak CHECK');
select throws_ok($$select tests.web_exec(tests.n(), $q$select api.create_invitation('farida@example.test', '\x00'::bytea)$q$)$$,
  '23514', null, 'hash token bukan 32 byte ditolak');
select ok(tests.web_val(tests.n(), $$select (api.create_invitation(' Farida@Example.TEST ', pg_catalog.sha256('t1')) ->> 'expires_at')::timestamptz
  = now() + interval '72 hours'$$)::boolean, 'undangan berlaku 72 jam');
select is(tests.owner_val(null, $$select email from app.invitations$$), 'farida@example.test', 'email dinormalisasi');
select is(tests.owner_val(null, $$select count(*) from app.invitations where token_hash = pg_catalog.sha256('t1')$$), '1',
  'yang disimpan hanya hash token');
select throws_ok($$select tests.web_exec(tests.n(), $q$select api.create_invitation('lain@example.test', pg_catalog.sha256('t9'))$q$)$$,
  '23505', null, 'satu undangan terbuka per rumah tangga');
select throws_ok($$select tests.web_val(null, $q$select count(*) from app.invitations$q$)$$,
  '42501', null, 'web tidak bisa membaca tabel undangan langsung');

-- Intip pra-login.
select is(tests.web_val(null, $$select api.invitation_peek(pg_catalog.sha256('t1')) ->> 'email'$$), 'farida@example.test',
  'intip dengan hash benar');
-- Perilaku yang wajib diketahui pemanggil: GUC token bertahan sampai akhir transaksi, jadi
-- fungsi undangan pra-login dipanggil di transaksi sendiri (bukan di dalam withUser lain).
select is(current_setting('app.invite_token_hash', true), encode(pg_catalog.sha256('t1'), 'hex'),
  'app.invite_token_hash bertahan sampai akhir transaksi');
select set_config('app.invite_token_hash', '', true);
select throws_ok($$select tests.web_val(null, $q$select api.invitation_peek(pg_catalog.sha256('salah'))$q$)$$,
  'DK404', 'invitation_not_found', 'intip dengan hash salah');

-- Tolak.
select throws_ok($$select tests.web_exec(null, $q$select api.decline_invitation(pg_catalog.sha256('salah'))$q$)$$,
  'DK404', 'invitation_not_found', 'tolak dengan hash salah');
select lives_ok($$select tests.web_exec(null, $q$select api.decline_invitation(pg_catalog.sha256('t1'))$q$)$$,
  'penerima menolak');
select throws_ok($$select tests.web_val(null, $q$select api.invitation_peek(pg_catalog.sha256('t1'))$q$)$$,
  'DK404', 'invitation_not_found', 'undangan yang ditolak hangus');
select throws_ok($$select tests.web_exec(null, $q$select api.decline_invitation(pg_catalog.sha256('t1'))$q$)$$,
  'DK404', 'invitation_not_found', 'tolak dua kali');
select throws_ok($$select tests.signup(tests.f(), 'farida@example.test', true, true)$$,
  'DK422', 'signup_closed', 'daftar dengan undangan yang ditolak');

-- Cabut (hanya pembuat).
select tests.web_exec(tests.n(), $$select api.create_invitation('farida@example.test', pg_catalog.sha256('t2'))$$);
-- A = akun Farida yang dibuat dari undangan ini, belum diamankan.
select tests.signup('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'farida@example.test', false, false);
select throws_ok(format($$select tests.web_exec('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', $q$select api.revoke_invitation(%L)$q$)$$,
    tests.owner_val(null, $$select id from app.invitations where token_hash = pg_catalog.sha256('t2')$$)),
  'DK404', 'invitation_not_found', 'bukan pembuat tidak bisa mencabut');
select throws_ok($$select tests.web_exec('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', $q$select api.create_invitation('x@example.test', pg_catalog.sha256('t8'))$q$)$$,
  'DK404', 'household_not_found', 'user tanpa rumah tangga tidak bisa mengundang');
select lives_ok(format($$select tests.web_exec(tests.n(), $q$select api.revoke_invitation(%L)$q$)$$,
    tests.owner_val(null, $$select id from app.invitations where token_hash = pg_catalog.sha256('t2')$$)),
  'pembuat mencabut');
select throws_ok($$select tests.web_exec('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', $q$select api.accept_invitation(pg_catalog.sha256('t2'), 'Farida')$q$)$$,
  'DK404', 'invitation_not_found', 'undangan yang dicabut tidak bisa diterima');
select throws_ok(format($$select tests.web_exec(tests.n(), $q$select api.revoke_invitation(%L)$q$)$$,
    tests.owner_val(null, $$select id from app.invitations where token_hash = pg_catalog.sha256('t2')$$)),
  'DK404', 'invitation_not_found', 'cabut dua kali');

-- Kirim ulang: yang lama dicabut 'resent', email boleh dikoreksi, kosong = email lama.
select tests.web_exec(tests.n(), $$select api.create_invitation('farida@example.tes', pg_catalog.sha256('t3'))$$);
select tests.signup('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'farida@example.tes', true, true);
select lives_ok(format($$select tests.web_exec(tests.n(), $q$select api.resend_invitation(%L, 'Farida@Example.test', pg_catalog.sha256('t4'))$q$)$$,
    tests.owner_val(null, $$select id from app.invitations where token_hash = pg_catalog.sha256('t3')$$)),
  'kirim ulang dengan email terkoreksi');
select is(tests.owner_val(null, $$select revoke_reason from app.invitations where token_hash = pg_catalog.sha256('t3')$$),
  'resent', 'undangan lama dicabut dengan alasan resent');
select is(tests.owner_val(null, $$select email from app.invitations where token_hash = pg_catalog.sha256('t4')$$),
  'farida@example.test', 'undangan baru ke email terkoreksi');
select throws_ok($$select tests.web_val(null, $q$select api.invitation_peek(pg_catalog.sha256('t3'))$q$)$$,
  'DK404', 'invitation_not_found', 'token lama mati');
select throws_ok($$select tests.web_exec('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', $q$select api.accept_invitation(pg_catalog.sha256('t3'), 'Typo')$q$)$$,
  'DK404', 'invitation_not_found', 'akun salah ketik tidak bisa memakai token lama');
select throws_ok($$select tests.web_exec('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', $q$select api.accept_invitation(pg_catalog.sha256('t4'), 'Typo')$q$)$$,
  'DK422', 'invitation_email_mismatch', 'token baru terikat email undangan');
select lives_ok(format($$select tests.web_exec(tests.n(), $q$select api.resend_invitation(%L, '  ', pg_catalog.sha256('t5'))$q$)$$,
    tests.owner_val(null, $$select id from app.invitations where token_hash = pg_catalog.sha256('t4')$$)),
  'kirim ulang tanpa email');
select is(tests.owner_val(null, $$select email from app.invitations where token_hash = pg_catalog.sha256('t5')$$),
  'farida@example.test', 'email kosong = email lama');

-- Kedaluwarsa (jam dimajukan 73 jam, env test).
select tests.clock(interval '73 hours');
select throws_ok($$select tests.web_val(null, $q$select api.invitation_peek(pg_catalog.sha256('t5'))$q$)$$,
  'DK404', 'invitation_not_found', 'intip undangan kedaluwarsa');
select throws_ok($$select tests.web_exec(null, $q$select api.decline_invitation(pg_catalog.sha256('t5'))$q$)$$,
  'DK404', 'invitation_not_found', 'tolak undangan kedaluwarsa');
select throws_ok($$select tests.web_exec('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', $q$select api.accept_invitation(pg_catalog.sha256('t5'), 'Farida')$q$)$$,
  'DK404', 'invitation_not_found', 'terima undangan kedaluwarsa');
select throws_ok($$select tests.signup(tests.f(), 'farida@example.test', true, true)$$,
  'DK422', 'signup_closed', 'daftar dengan undangan kedaluwarsa');
select lives_ok($$select tests.web_exec(tests.n(), $q$select api.create_invitation('farida@example.test', pg_catalog.sha256('t6'))$q$)$$,
  'undangan baru boleh dibuat setelah yang lama kedaluwarsa');
select is(tests.owner_val(null, $$select revoke_reason from app.invitations where token_hash = pg_catalog.sha256('t5')$$),
  'expired', 'yang kedaluwarsa dicabut otomatis (expired)');

-- Terima: hanya setelah email terverifikasi dan kode pemulihan ada; sekali pakai.
-- A (akun Farida yang belum diamankan) menerima undangan baru.
select throws_ok($$select tests.web_exec('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', $q$select api.accept_invitation(pg_catalog.sha256('t6'), 'Farida')$q$)$$,
  'DK422', 'email_unverified', 'terima sebelum email terverifikasi');
select tests.web_exec('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', $$update auth."user" set "emailVerified" = true where id = app.current_user_id()$$);
select throws_ok($$select tests.web_exec('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', $q$select api.accept_invitation(pg_catalog.sha256('t6'), 'Farida')$q$)$$,
  'DK422', 'not_secured', 'terima sebelum kode pemulihan');
select tests.web_exec('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', $$insert into auth.recovery_codes (user_id, code_hash) values (app.current_user_id(), '$argon2id$v=19$f')$$);
select throws_ok($$select tests.web_exec(null, $q$select api.accept_invitation(pg_catalog.sha256('t6'), 'Farida')$q$)$$,
  'DK401', 'unauthenticated', 'terima tanpa konteks user');
select lives_ok($$select tests.web_exec('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', $q$select api.accept_invitation(pg_catalog.sha256('t6'), 'Farida')$q$)$$,
  'terima setelah akun diamankan');
select is(tests.owner_val(null, $$select used_by::text from app.invitations where token_hash = pg_catalog.sha256('t6')$$),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'undangan ditandai terpakai oleh penerima');
select throws_ok($$select tests.web_exec('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', $q$select api.accept_invitation(pg_catalog.sha256('t6'), 'Farida')$q$)$$,
  'DK404', 'invitation_not_found', 'undangan tidak bisa dipakai ulang');
select is(tests.web_val('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', $$select string_agg(m.role::text || ':' || s.kind::text, ',' order by s.kind)
  from app.space_members m join app.spaces s on s.id = m.space_id where m.user_id = app.current_user_id()$$),
  'owner:personal,member:shared', 'Farida pemilik Pribadi, anggota Bersama');
select throws_ok($$select tests.web_exec('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', $q$select api.create_invitation('x@example.test', pg_catalog.sha256('t7'))$q$)$$,
  'DK404', 'household_not_found', 'hanya owner rumah tangga yang bisa mengundang');

select is(tests.owner_val(null, $$select string_agg(coalesce(revoke_reason, case when used_at is not null then 'used' end), ','
  order by array_position(array['t1', 't2', 't3', 't4', 't5', 't6'],
    (select t from unnest(array['t1', 't2', 't3', 't4', 't5', 't6']) t where pg_catalog.sha256(t::bytea) = token_hash)))
  from app.invitations$$),
  'declined,revoked,resent,resent,expired,used', 'riwayat alasan undangan');

select * from finish();
rollback;
