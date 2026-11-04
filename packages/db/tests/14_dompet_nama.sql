-- Nama dompet unik per ruang (S7, 0109): indeks unik parsial app.accounts_name_unique pada
-- (space_id, lower(btrim(name))) untuk dompet aktif. Nama sama dalam variasi huruf besar/spasi di
-- ruang yang sama = 23505 (dipetakan server ke name_taken); ruang lain dan dompet terarsip boleh.
-- Semua lewat api.* sebagai role web; jam dipatok 2026-03-20 WIB.
begin;
select plan(13);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

-- ===== Bentuk indeks =====
select has_index('app', 'accounts', 'accounts_name_unique', 'indeks nama dompet ada');
select index_is_unique('app', 'accounts', 'accounts_name_unique');
select is((select indexdef from pg_indexes where schemaname = 'app' and indexname = 'accounts_name_unique'),
  'CREATE UNIQUE INDEX accounts_name_unique ON app.accounts USING btree (space_id, lower(btrim(name))) WHERE (archived_at IS NULL)',
  'indeks per ruang, tanpa beda huruf besar/spasi, hanya dompet aktif');

-- ===== Ruang yang sama =====
select tests.account(tests.n(), :'np', 'BCA', 'operasional') as bca \gset
select throws_ok(format($$select tests.account(tests.n(), %L, ' bca ', 'operasional')$$, :'np'),
  '23505', null, '"BCA" lalu " bca " di ruang yang sama ditolak');
select throws_ok(format($$select tests.account(tests.n(), %L, 'Bca', 'tabungan')$$, :'np'),
  '23505', null, 'kantong lain tidak membuat nama boleh ganda');
-- Spasi di tengah tetap bagian nama.
select lives_ok(format($$select tests.account(tests.n(), %L, 'BC A', 'operasional')$$, :'np'),
  'nama berbeda di tengah tetap boleh');

-- Kirim ulang (client_id sama) = replay, bukan 23505.
select tests.web_val(tests.n(), format(
  $$select api.create_account('dddddddd-0000-0000-0000-000000000001', %L, 'Mandiri', 'operasional', 'bank') ->> 'account_id'$$,
  :'np')) as mandiri \gset
select is(tests.web_val(tests.n(), format(
  $$select api.create_account('dddddddd-0000-0000-0000-000000000001', %L, 'Mandiri', 'operasional', 'bank') ->> 'replayed'$$,
  :'np')), 'true', 'kirim ulang dompet yang sama = replay');

-- ===== Ruang lain =====
select lives_ok(format($$select tests.account(tests.n(), %L, 'BCA', 'operasional')$$, :'sh'),
  'nama sama di ruang Bersama boleh');
select lives_ok(format($$select tests.account(tests.f(), %L, 'bca', 'operasional')$$, :'fp'),
  'nama sama di Pribadi pasangan boleh');
select throws_ok(format($$select tests.account(tests.f(), %L, 'BCA ', 'operasional')$$, :'sh'),
  '23505', null, 'Bersama: anggota lain juga ditolak bila nama sudah dipakai');

-- ===== Dompet terarsip =====
select is(tests.web_val(tests.n(), format($$select api.archive_account(%L) ->> 'archived'$$, :'bca')), 'true',
  'arsipkan BCA bersaldo 0');
select lives_ok(format($$select tests.account(tests.n(), %L, 'BCA', 'operasional')$$, :'np'),
  'sesudah BCA diarsipkan, "BCA" boleh dibuat lagi');
select is(tests.web_val(tests.n(), format(
  $$select count(*) || '/' || count(*) filter (where archived_at is null) from app.accounts
    where space_id = %L and lower(btrim(name)) = 'bca'$$, :'np')), '2/1',
  'satu BCA terarsip dan satu BCA aktif di ruang yang sama');

select * from finish();
rollback;
