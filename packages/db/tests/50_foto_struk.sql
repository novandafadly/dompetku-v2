-- pgTAP S18 (0151_foto_struk): kontrak tabel app.entry_attachments, RLS FORCE, batas 3 foto/entri,
-- validasi mime/ukuran/iv/auth_tag, tolak entri batal, isolasi antar ruang/pengguna (B13), dan hapus permanen.
-- ID: B13
\set ON_ERROR_STOP 1
begin;
select plan(17);

select tests.fixture();
select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.n(), 'shared') as sh \gset

-- Seed 1 dompet + 1 entri Pribadi N, 1 dompet + 1 entri Bersama N.
select tests.web_exec(tests.n(), format(
  $q$select api.create_account('11111111-1111-4111-8111-111111111101', %L, 'BCA N', 'operasional', 'bank', app.today(), 1000000)$q$,
  :'np'));
select tests.web_exec(tests.n(), format(
  $q$select api.create_account('11111111-1111-4111-8111-111111111102', %L, 'Kas Bersama', 'operasional', 'bank', app.today(), 1000000)$q$,
  :'sh'));

select tests.web_exec(tests.n(), format(
  $q$select api.create_entry('22222222-2222-4222-8222-222222222201', %L,
     (select id from app.accounts where space_id = %L and name = 'BCA N'),
     'expense', 50000,
     (select id from app.categories where space_id = %L and type = 'expense' and parent_id is null limit 1),
     app.today(), 'Struk Pribadi N')$q$,
  :'np', :'np', :'np'));

select tests.web_exec(tests.n(), format(
  $q$select api.create_entry('22222222-2222-4222-8222-222222222202', %L,
     (select id from app.accounts where space_id = %L and name = 'Kas Bersama'),
     'expense', 75000,
     (select id from app.categories where space_id = %L and type = 'expense' and parent_id is null limit 1),
     app.today(), 'Struk Bersama')$q$,
  :'sh', :'sh', :'sh'));

select tests.owner_val(null, $e$select id::text from app.entries where description = 'Struk Pribadi N'$e$) as enp,
       tests.owner_val(null, $e$select id::text from app.entries where description = 'Struk Bersama'$e$) as esh \gset

-- 1-2: Unauthenticated ditolak DK401.
select throws_ok(
  format($q$select tests.web_exec(null, $$select * from api.list_entry_attachments(%L, %L)$$)$q$, :'np', :'enp'),
  'DK401', null, 'list_entry_attachments tanpa user ditolak DK401');

select throws_ok(
  format($q$select tests.web_exec(null, $$select api.delete_entry_attachment(%L, '33333333-3333-4333-8333-333333333301')$$)$q$, :'np'),
  'DK401', null, 'delete_entry_attachment tanpa user ditolak DK401');

-- 3-5: Validasi mime, ukuran, dan panjang iv/auth_tag ditolak DK400.
select throws_ok(
  format($q$select tests.web_exec(%L, $$select api.add_entry_attachment(%L, %L, '33333333-3333-4333-8333-333333333301', 'image/svg+xml', 10, '\x0102'::bytea, decode('000102030405060708090a0b','hex'), decode('000102030405060708090a0b0c0d0e0f','hex'))$$)$q$,
    tests.n(), :'np', :'enp'),
  'DK400', null, 'SVG ditolak DK400');

select throws_ok(
  format($q$select tests.web_exec(%L, $$select api.add_entry_attachment(%L, %L, '33333333-3333-4333-8333-333333333301', 'image/jpeg', 2097153, '\x0102'::bytea, decode('000102030405060708090a0b','hex'), decode('000102030405060708090a0b0c0d0e0f','hex'))$$)$q$,
    tests.n(), :'np', :'enp'),
  'DK400', null, 'ukuran > 2 MiB ditolak DK400');

select throws_ok(
  format($q$select tests.web_exec(%L, $$select api.add_entry_attachment(%L, %L, '33333333-3333-4333-8333-333333333301', 'image/jpeg', 10, '\x0102'::bytea, '\x0102'::bytea, decode('000102030405060708090a0b0c0d0e0f','hex'))$$)$q$,
    tests.n(), :'np', :'enp'),
  'DK400', null, 'IV bukan 12 byte ditolak DK400');

-- 6-9: Tambah 3 foto berhasil; foto ke-4 ditolak DK422 attachment_limit.
select is(
  (tests.web_val(tests.n(), format(
    $$select api.add_entry_attachment(%L, %L, '33333333-3333-4333-8333-333333333301', 'image/jpeg', 4, '\xdeadbeef'::bytea, decode('000102030405060708090a0b','hex'), decode('000102030405060708090a0b0c0d0e0f','hex'))::text$$,
    :'np', :'enp')))::jsonb ->> 'mime_type',
  'image/jpeg', 'unggah foto #1 berhasil');

select lives_ok(
  format($q$select tests.web_exec(%L, $$select api.add_entry_attachment(%L, %L, '33333333-3333-4333-8333-333333333302', 'image/png', 4, '\x01020304'::bytea, decode('100102030405060708090a0b','hex'), decode('100102030405060708090a0b0c0d0e0f','hex'))$$)$q$,
    tests.n(), :'np', :'enp'),
  'unggah foto #2 berhasil');

select lives_ok(
  format($q$select tests.web_exec(%L, $$select api.add_entry_attachment(%L, %L, '33333333-3333-4333-8333-333333333303', 'image/webp', 4, '\x05060708'::bytea, decode('200102030405060708090a0b','hex'), decode('200102030405060708090a0b0c0d0e0f','hex'))$$)$q$,
    tests.n(), :'np', :'enp'),
  'unggah foto #3 berhasil');

select throws_ok(
  format($q$select tests.web_exec(%L, $$select api.add_entry_attachment(%L, %L, '33333333-3333-4333-8333-333333333304', 'image/jpeg', 4, '\x090a0b0c'::bytea, decode('300102030405060708090a0b','hex'), decode('300102030405060708090a0b0c0d0e0f','hex'))$$)$q$,
    tests.n(), :'np', :'enp'),
  'DK422', null, 'unggah foto #4 ditolak DK422 attachment_limit');

-- 10-11: list & get mengembalikan data yang tepat untuk pemilik.
select is(
  tests.web_val(tests.n(), format(
    $$select count(*)::text from api.list_entry_attachments(%L, %L)$$,
    :'np', :'enp')),
  '3', 'list_entry_attachments menampilkan 3 lampiran');

select is(
  tests.web_val(tests.n(), format(
    $$select encode(ciphertext, 'hex') from api.get_entry_attachment(%L, '33333333-3333-4333-8333-333333333301')$$,
    :'np')),
  'deadbeef', 'get_entry_attachment mengembalikan ciphertext tepat');

-- 12-15: Isolasi ruang (B13): Farida tidak bisa membaca atau melihat lampiran Pribadi N;
-- namun di Bersama Farida bisa membaca lampiran Bersama.
select throws_ok(
  format($q$select tests.web_exec(%L, $$select * from api.get_entry_attachment(%L, '33333333-3333-4333-8333-333333333301')$$)$q$,
    tests.f(), :'np'),
  'DK404', null, 'B13: Farida ditolak membaca lampiran Pribadi N');

select is(
  tests.web_val(tests.f(), $$select count(*)::text from app.entry_attachments$$),
  '0', 'B13: RLS FORCE membuat Farida melihat 0 baris lampiran Pribadi N');

select lives_ok(
  format($q$select tests.web_exec(%L, $$select api.add_entry_attachment(%L, %L, '33333333-3333-4333-8333-333333333310', 'image/jpeg', 4, '\xcafebabe'::bytea, decode('400102030405060708090a0b','hex'), decode('400102030405060708090a0b0c0d0e0f','hex'))$$)$q$,
    tests.n(), :'sh', :'esh'),
  'unggah foto di ruang Bersama berhasil');

select is(
  tests.web_val(tests.f(), format(
    $$select encode(ciphertext, 'hex') from api.get_entry_attachment(%L, '33333333-3333-4333-8333-333333333310')$$,
    :'sh')),
  'cafebabe', 'anggota Bersama (Farida) bisa membaca lampiran ruang Bersama');

-- 16: Hapus permanen lampiran berhasil.
select is(
  (tests.web_val(tests.n(), format(
    $$select api.delete_entry_attachment(%L, '33333333-3333-4333-8333-333333333303')::text$$,
    :'np')))::jsonb ->> 'deleted',
  'true', 'delete_entry_attachment menghapus permanen');

-- 17: Unggah pada entri yang sudah dibatalkan ditolak DK422.
select tests.web_exec(tests.n(), format(
  $$select api.void_entry('44444444-4444-4444-8444-444444444401', %L, 1)$$,
  :'enp'));

select throws_ok(
  format($q$select tests.web_exec(%L, $$select api.add_entry_attachment(%L, %L, '33333333-3333-4333-8333-333333333309', 'image/jpeg', 4, '\x01020304'::bytea, decode('500102030405060708090a0b','hex'), decode('500102030405060708090a0b0c0d0e0f','hex'))$$)$q$,
    tests.n(), :'np', :'enp'),
  'DK422', null, 'unggah foto pada entri batal ditolak DK422');

select * from finish();
rollback;
