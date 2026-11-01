-- Pendaftaran tertutup, akun pertama, batas keras 2 user (BSD §5, §9.3, §13 #16).
begin;
select plan(28);

-- Nilai owner_email dari env bisa berhuruf besar/berspasi; pembanding menormalkannya (review S4).
select tests.owner_exec(null, $$insert into app.settings (key, value) values ('owner_email', ' Novanda@Example.TEST ')$$);

-- Sebelum rumah tangga ada hanya owner_email yang boleh mendaftar.
select throws_ok($$select tests.signup(tests.x(), 'orang@example.test', true, true)$$,
  'DK422', 'signup_closed', 'email selain owner_email ditolak sebelum rumah tangga ada');
select lives_ok($$select tests.signup(tests.n(), 'novanda@example.test', false, false)$$,
  'owner_email (beda huruf besar/spasi) boleh mendaftar');

-- Provisioning akun pertama: urutan pemeriksaan.
select throws_ok($$select tests.web_exec(null, $q$select api.bootstrap_owner('Novanda')$q$)$$,
  'DK401', 'unauthenticated', 'bootstrap tanpa konteks user');
select throws_ok($$select tests.web_exec(tests.n(), $q$select api.bootstrap_owner('Novanda')$q$)$$,
  'DK422', 'email_unverified', 'bootstrap sebelum email terverifikasi');
select tests.web_exec(tests.n(), $$update auth."user" set "emailVerified" = true where id = app.current_user_id()$$);
select throws_ok($$select tests.web_exec(tests.n(), $q$select api.bootstrap_owner('Novanda')$q$)$$,
  'DK422', 'not_secured', 'bootstrap sebelum kode pemulihan');
select tests.web_exec(tests.n(), $$insert into auth.recovery_codes (user_id, code_hash, used_at)
  values (app.current_user_id(), '$argon2id$v=19$terpakai', now())$$);
select throws_ok($$select tests.web_exec(tests.n(), $q$select api.bootstrap_owner('Novanda')$q$)$$,
  'DK422', 'not_secured', 'kode pemulihan yang sudah dipakai tidak dihitung');
select tests.web_exec(tests.n(), $$insert into auth.recovery_codes (user_id, code_hash)
  values (app.current_user_id(), '$argon2id$v=19$baru')$$);
select throws_ok($$select tests.web_exec(tests.n(), $q$select api.bootstrap_owner('   ')$q$)$$,
  'DK400', 'invalid_argument', 'nama tampilan kosong ditolak');

-- owner_email diganti sesudah daftar: bukan pemilik lagi.
select tests.owner_exec(null, $$update app.settings set value = 'lain@example.test' where key = 'owner_email'$$);
select throws_ok($$select tests.web_exec(tests.n(), $q$select api.bootstrap_owner('Novanda')$q$)$$,
  'DK422', 'not_owner', 'bootstrap hanya untuk owner_email');
select tests.owner_exec(null, $$update app.settings set value = 'NOVANDA@example.test' where key = 'owner_email'$$);

select ok(tests.web_val(tests.n(), $$select api.bootstrap_owner('Novanda') ? 'household_id'$$)::boolean,
  'bootstrap pemilik berhasil (owner_email berhuruf besar)');

-- Email tidak bisa diganti setelah daftar (review S4; changeEmail Better Auth tetap mati).
select throws_ok($$select tests.web_exec(tests.n(), $q$update auth."user" set email = 'baru@example.test' where id = app.current_user_id()$q$)$$,
  'DK422', 'email_immutable', 'ganti email ditolak');
select is(tests.web_exec(tests.n(), $$update auth."user" set email = email, name = 'Novanda F' where id = app.current_user_id()$$),
  1::bigint, 'update lain tanpa mengubah email tetap boleh');
select throws_ok($$select tests.web_exec(tests.n(), $q$select api.bootstrap_owner('Novanda')$q$)$$,
  'DK422', 'already_provisioned', 'bootstrap kedua ditolak');
select is(tests.web_val(tests.n(), $$select count(*) from app.spaces$$), '2', 'Novanda: ruang Pribadi + Bersama');
select is(tests.web_val(tests.n(), $$select string_agg(m.role::text || ':' || s.kind::text, ',' order by s.kind)
  from app.space_members m join app.spaces s on s.id = m.space_id$$), 'owner:personal,owner:shared',
  'Novanda owner di kedua ruang');
select is(tests.web_val(tests.n(), $$select display_name || '/' || initial from app.profiles$$), 'Novanda/N',
  'profil dan inisial');
select is(tests.owner_val(null, $$select count(*) from audit.events
  where event = 'space_member_change' and user_id = '11111111-1111-1111-1111-111111111111'$$), '1',
  'provisioning dicatat di audit');

-- Sesudah rumah tangga ada: email tanpa undangan terbuka ditolak, termasuk owner_email lain.
select throws_ok($$select tests.signup(tests.x(), 'orang@example.test', true, true)$$,
  'DK422', 'signup_closed', 'tanpa undangan terbuka = signup_closed');

-- Akun setengah jadi tidak memakan kuota (A = salah ketik, punya undangan lalu dikirim ulang).
select tests.web_exec(tests.n(), $$select api.create_invitation('farida@example.tes', pg_catalog.sha256('t-a'))$$);
select lives_ok($$select tests.signup('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'farida@example.tes', true, true)$$,
  'akun setengah jadi bisa dibuat selama undangan terbuka');
select tests.web_exec(tests.n(), format($$select api.resend_invitation(%L, 'farida@example.test', pg_catalog.sha256('t-f'))$$,
  tests.owner_val(null, $$select id from app.invitations where email = 'farida@example.tes'$$)));
select tests.signup(tests.f(), 'farida@example.test', true, true);
select lives_ok($$select tests.web_exec(tests.f(), $q$select api.accept_invitation(pg_catalog.sha256('t-f'), 'Farida')$q$)$$,
  'Farida diprovisikan walau ada akun setengah jadi (kuota dari profil)');
select is(tests.owner_val(null, $$select count(*) from app.profiles$$), '2', 'dua profil');
select is(tests.owner_val(null, $$select count(*) from auth."user"$$), '3', 'tiga user auth (satu setengah jadi)');

-- Penjaga ruang Pribadi: hanya pemiliknya yang boleh jadi anggota (juga untuk owner DB).
select throws_ok(format($$select tests.owner_exec(null, $q$insert into app.space_members (space_id, user_id) values (%L, %L)$q$)$$,
  tests.space_id(tests.n(), 'personal'), tests.f()),
  'DK422', 'personal_space_owner_only', 'pasangan tidak bisa masuk ruang Pribadi');

-- User ketiga: ditolak di trigger pendaftaran dan di pembuatan undangan.
select throws_ok($$select tests.signup(tests.x(), 'orang@example.test', true, true)$$,
  'DK422', 'user_limit', 'user ketiga ditolak saat daftar');
select throws_ok($$select tests.web_exec(tests.n(), $q$select api.create_invitation('orang@example.test', pg_catalog.sha256('t-x'))$q$)$$,
  'DK422', 'user_limit', 'undangan ketiga ditolak');

-- Lapis kedua: undangan terbuka yang lolos (mis. dibuat manual) tetap ditolak saat provisioning.
select tests.owner_exec(null, format($$insert into app.invitations (household_id, email, token_hash, created_by, created_at, expires_at)
  select household_id, 'farida@example.tes', pg_catalog.sha256('t-a2'), %L, now(), now() + interval '72 hours'
  from app.spaces where kind = 'shared'$$, tests.n()));
select throws_ok($$select tests.web_exec('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', $q$select api.accept_invitation(pg_catalog.sha256('t-a2'), 'A')$q$)$$,
  'DK422', 'user_limit', 'provisioning user ketiga ditolak (user_limit)');
select is(tests.owner_val(null, $$select count(*) from app.profiles$$), '2', 'tetap dua profil');

-- Satu rumah tangga, satu ruang Bersama (indeks singleton).
select throws_ok($$select tests.owner_exec(null, $q$insert into app.households (name) values ('Kedua')$q$)$$,
  '23505', null, 'hanya satu rumah tangga');
select throws_ok($$select tests.owner_exec(null, $q$insert into app.spaces (household_id, kind) select household_id, 'shared' from app.spaces limit 1$q$)$$,
  '23505', null, 'hanya satu ruang Bersama');

select * from finish();
rollback;
