-- Kategori S6 (0106): kategori awal ruang, api.create_category (BSD §9), api.update_category,
-- api.archive_category, cek category_archived di create_entry/update_entry, B9 (kategori ruang
-- lain ditolak). Semua lewat fungsi api.* sebagai role web; jam dipatok 2026-03-20 WIB.
-- ID: B9
begin;
select plan(41);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

create function pg_temp.cat(p_space uuid, p_name text) returns uuid
language sql as $$
  select tests.owner_val(null, format(
    $q$select id from app.categories where space_id = %L and name = %L and archived_at is null$q$,
    p_space, p_name))::uuid
$$;
create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;

-- ===== Kategori awal (seed demo per ruang, keputusan pemilik 2026-11-01) =====
select is(tests.web_val(tests.n(), format($$select count(*) from app.categories where space_id = %L$$, :'np'))::int,
          10, 'ruang Pribadi baru punya kategori awal');
select is(tests.web_val(tests.n(), $$select count(*) from app.categories c join app.spaces s on s.id = c.space_id
          where s.kind = 'shared'$$)::int, 9, 'ruang Bersama baru punya kategori awal');
select is(tests.web_val(tests.f(), format($$select count(*) from app.categories where space_id = %L$$, :'fp'))::int,
          10, 'Pribadi pasangan (terima undangan) juga punya kategori awal');
select is(tests.web_val(tests.n(), $$select bool_and(is_system)::text from app.categories$$), 'true',
          'kategori awal is_system');
select is(tests.web_val(tests.n(), format($$select string_agg(name || ':' || type || ':' || icon, ',' order by sort_order)
          from app.categories where space_id = %L$$, :'np')),
  'Gaji:income:Briefcase,Makan Siang & Minum:expense:ForkKnife,Kopi & Camilan:expense:Coffee,'
  'Transportasi:expense:Motorcycle,Belanja:expense:ShoppingBag,Hiburan:expense:FilmSlate,'
  'Kesehatan:expense:Heartbeat,Langganan:expense:Repeat,Cicilan & Tagihan:expense:Receipt,'
  'Perjalanan Dinas:expense:Briefcase',
  'Pribadi: nama, jenis, ikon, urutan = seed demo');
select is(tests.web_val(tests.n(), format($$select string_agg(c.name || coalesce('<' || p.name, ''), ',' order by c.sort_order)
          from app.categories c left join app.categories p on p.id = c.parent_id where c.space_id = %L$$, :'sh')),
  'Kontribusi Farida,Sewa Rumah,Listrik & Air,Internet,Iuran Lingkungan,Belanja Dapur,'
  'Sayur & Buah<Belanja Dapur,Makan di Luar,Bensin & Parkir',
  'Bersama: urutan seed, Sayur & Buah anak Belanja Dapur');
select is(tests.web_val(tests.n(), format($$select type::text from app.categories where space_id = %L and name = 'Kontribusi Farida'$$, :'sh')),
          'income', 'Bersama: Kontribusi Farida = pemasukan');
select throws_ok($$select tests.api_val(null, 'select private.seed_categories(gen_random_uuid())')$$,
  'DK404', 'space_not_found', 'seed tanpa konteks anggota ditolak');
select is(tests.api_val(tests.n(), format($$select private.seed_categories(%L)$$, :'np')), '0',
  'seed kedua kali pada ruang yang sudah punya kategori = 0');

-- ===== create_category: idempotensi (nama di-btrim sebelum hash) =====
select pg_temp.call(tests.n(), format($$select api.create_category(p_client_id => '00000000-0000-4000-8000-0000000000c1',
  p_space_id => %L, p_type => 'expense', p_name => ' Parkir ', p_icon => 'Car')$$, :'np')) as k1 \gset
select is((:'k1'::jsonb) ->> 'category_id',
          pg_temp.call(tests.n(), format($$select api.create_category(p_client_id => '00000000-0000-4000-8000-0000000000c1',
            p_space_id => %L, p_type => 'expense', p_name => 'Parkir', p_icon => 'Car')$$, :'np')) ->> 'category_id',
          'clientId sama + isi sama = kategori sama (nama di-btrim sebelum hash)');
select is(pg_temp.call(tests.n(), format($$select api.create_category(p_client_id => '00000000-0000-4000-8000-0000000000c1',
            p_space_id => %L, p_type => 'expense', p_name => 'Parkir', p_icon => 'Car')$$, :'np')) ->> 'replayed',
          'true', 'panggilan ulang ditandai replayed');
select is(tests.web_val(tests.n(), format($$select name || ':' || icon || ':' || is_system || ':' || (parent_id is null)
          from app.categories where id = %L$$, (:'k1'::jsonb) ->> 'category_id')), 'Parkir:Car:false:true',
          'kategori baru: nama di-btrim, bukan kategori sistem');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.create_category(p_client_id => '00000000-0000-4000-8000-0000000000c1', p_space_id => %L,
       p_type => 'expense', p_name => 'Tol', p_icon => 'Car')$q$, :'np')),
  'DK410', null, 'isi beda = DK410');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.create_category(p_client_id => gen_random_uuid(), p_space_id => %L,
       p_type => 'expense', p_name => 'Parkir', p_icon => 'Car')$q$, :'fp')),
  'DK404', null, 'ruang orang lain = DK404');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.create_category(p_client_id => gen_random_uuid(), p_space_id => %L,
       p_type => 'expense', p_name => 'parkir', p_icon => 'Car')$q$, :'np')),
  '23505', null, 'nama ganda (beda huruf) ditolak');
select lives_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.create_category(p_client_id => gen_random_uuid(), p_space_id => %L,
       p_type => 'income', p_name => 'Parkir', p_icon => 'Car')$q$, :'np')),
  'nama sama di jenis lain boleh');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.create_category(p_client_id => gen_random_uuid(), p_space_id => %L,
       p_type => 'expense', p_name => 'Sayur', p_icon => 'Carrot', p_parent_id => %L)$q$, :'np', pg_temp.cat(:'sh', 'Belanja Dapur'))),
  '23503', null, 'induk dari ruang lain ditolak (FK komposit)');

-- Induk + anak untuk tes ubah dan arsip.
select pg_temp.call(tests.n(), format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Rumah', 'House')$$,
  :'np')) ->> 'category_id' as induk \gset
select pg_temp.call(tests.n(), format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Perabot', 'Couch', %L)$$,
  :'np', :'induk')) ->> 'category_id' as anak \gset
select is(tests.web_val(tests.n(), format($$select parent_id::text from app.categories where id = %L$$, :'anak')), :'induk',
  'kategori anak tersimpan dengan induk');

-- ===== update_category =====
select lives_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.update_category(p_category_id => %L, p_name => 'Parkir & Tol', p_icon => 'Car', p_parent_id => null)$q$,
    (:'k1'::jsonb) ->> 'category_id')), 'ubah nama kategori');
select is(tests.web_val(tests.n(), format($$select name from app.categories where id = %L$$, (:'k1'::jsonb) ->> 'category_id')),
  'Parkir & Tol', 'nama baru tersimpan');
select is(pg_temp.call(tests.n(), format(
    $q$select api.update_category(p_category_id => %L, p_name => 'Parkir & Tol', p_icon => 'Car', p_parent_id => null)$q$,
    (:'k1'::jsonb) ->> 'category_id')) ->> 'category_id', (:'k1'::jsonb) ->> 'category_id',
  'panggilan ulang dengan isi sama tidak galat (idempoten alami)');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.update_category(p_category_id => %L, p_name => 'Parkir & Tol', p_icon => 'Car', p_parent_id => %L)$q$,
    (:'k1'::jsonb) ->> 'category_id', :'anak')),
  'DK422', 'category_depth', 'kedalaman > 2 ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.update_category(%L, 'Rumah', 'House', %L)$q$, :'induk', (:'k1'::jsonb) ->> 'category_id')),
  'DK422', 'category_depth', 'induk yang punya anak tidak bisa dijadikan anak');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.update_category(%L, 'Makan', 'ForkKnife', null)$q$, pg_temp.cat(:'fp', 'Makan Siang & Minum'))),
  'DK404', 'category_not_found', 'bukan anggota = DK404');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.update_category(%L, '  ', 'Car', null)$q$, (:'k1'::jsonb) ->> 'category_id')),
  'DK400', 'invalid_argument', 'nama kosong ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.update_category(%L, 'Parkir', 'car', null)$q$, (:'k1'::jsonb) ->> 'category_id')),
  'DK400', 'invalid_argument', 'ikon tidak sah ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.update_category(%L, 'Parkir', 'Car', %L)$q$, (:'k1'::jsonb) ->> 'category_id', pg_temp.cat(:'np', 'Gaji'))),
  'DK400', 'invalid_argument', 'induk beda jenis ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.update_category(%L, 'Parkir', 'Car', %L)$q$, (:'k1'::jsonb) ->> 'category_id', pg_temp.cat(:'sh', 'Internet'))),
  'DK404', 'category_not_found', 'induk ruang lain ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.update_category(%L, 'Langganan', 'Car', null)$q$, (:'k1'::jsonb) ->> 'category_id')),
  '23505', null, 'ganti ke nama yang sudah dipakai ditolak');

-- Entri dengan kategori induk (dipakai tes arsip di bawah).
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 1000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 300000, '2026-01-01') as kas \gset
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 5000, %L)$$,
  :'np', :'bca', :'induk')) ->> 'entry_id' as e_induk \gset

-- ===== archive_category =====
select is(pg_temp.call(tests.n(), format($$select api.archive_category(p_category_id => %L)$$, :'induk')) ->> 'affected',
  '2', 'induk + 1 anak diarsipkan');
select is(pg_temp.call(tests.n(), format($$select api.archive_category(p_category_id => %L)$$, :'induk')) ->> 'affected',
  '0', 'panggilan kedua tidak mengubah apa pun');
select is(tests.web_val(tests.n(), format($$select count(*) from app.categories where id in (%L, %L) and archived_at is not null$$,
  :'induk', :'anak')), '2', 'induk dan anak bertanda arsip');
select throws_ok(format($$select pg_temp.call(tests.f(), %L)$$, format($q$select api.archive_category(%L)$q$, pg_temp.cat(:'np', 'Hiburan'))),
  'DK404', 'category_not_found', 'arsip kategori Pribadi pasangan = DK404');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.update_category(%L, 'Rumah', 'House', null)$q$, :'induk')),
  'DK422', 'category_archived', 'kategori terarsip tidak bisa diubah');
select lives_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.create_category(gen_random_uuid(), %L, 'expense', 'Rumah', 'House')$q$, :'np')),
  'nama boleh dipakai lagi sesudah arsip (indeks unik parsial)');

-- ===== category_archived di create_entry / update_entry =====
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1000, %L)$q$, :'np', :'bca', :'anak')),
  'DK422', 'category_archived', 'entri baru tidak boleh memakai kategori terarsip');
select is(pg_temp.call(tests.n(), format(
    $q$select api.update_entry(gen_random_uuid(), %L, 1, %L, 6000, %L, null, null, false)$q$, :'e_induk', :'bca', :'induk')) ->> 'version',
  '2', 'entri lama boleh disimpan ulang dengan kategorinya yang sudah diarsipkan');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.update_entry(gen_random_uuid(), %L, 2, %L, 6000, %L, null, null, false)$q$, :'e_induk', :'bca', :'anak')),
  'DK422', 'category_archived', 'ubah entri ke kategori terarsip lain ditolak');
select is(pg_temp.call(tests.n(), format(
    $q$select api.update_entry(gen_random_uuid(), %L, 2, %L, 6000, %L, null, null, false)$q$, :'e_induk', :'bca', pg_temp.cat(:'np', 'Belanja'))) ->> 'version',
  '3', 'ubah entri ke kategori aktif boleh');

-- ===== B9: kategori ruang lain ditolak =====
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1000, %L)$q$, :'sh', :'kas', pg_temp.cat(:'np', 'Belanja'))),
  'DK404', 'category_not_found', 'B9: entri Bersama dengan kategori Pribadi ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1000, %L)$q$, :'np', :'bca', pg_temp.cat(:'sh', 'Internet'))),
  'DK404', 'category_not_found', 'B9: entri Pribadi dengan kategori Bersama ditolak');

select * from finish();
rollback;
