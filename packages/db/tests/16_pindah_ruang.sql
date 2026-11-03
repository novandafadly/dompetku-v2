-- Pindahkan ke ruang lain (S7, 0111; AFD §8, bingkai S7-D2): api.move_entry_to_space membatalkan
-- entri asal dan membuat ulang di ruang tujuan dalam satu transaksi (moved_to_entry_id di asal),
-- deskripsi ke Bersama hanya bila p_keep_description, hanya pencatat, validasi dompet/kategori
-- ruang tujuan, saldo kedua dompet, talangan (reimbursable dilepas / reimbursement_exists),
-- api.restore_entry menolak entry_moved, api.trash_list menyembunyikan asal, purge 90 hari normal,
-- idempotensi, isolasi. Semua lewat api.* sebagai role web; jam dipatok 2026-03-20 WIB.
begin;
select plan(72);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

select tests.account(tests.n(), :'np', 'BCA', 'operasional', 1000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Dana', 'operasional', 0, '2026-01-01') as dana,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 300000, '2026-01-01') as kas,
       tests.account(tests.n(), :'sh', 'Kosong', 'operasional', 0, '2026-01-01') as kosong,
       tests.account(tests.n(), :'sh', 'Baru', 'operasional', 0, '2026-03-19') as baru,
       tests.account(tests.n(), :'sh', 'Lama', 'operasional', 0, '2026-01-01') as lama,
       tests.account(tests.f(), :'fp', 'BCA Farida', 'operasional', 400000, '2026-01-01') as fbca \gset
select tests.web_val(tests.n(), format($$select api.archive_account(%L)$$, :'lama'));

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
-- Kategori akar pertama (kategori awal ruang) menurut jenis.
create function pg_temp.cat(p_space uuid, p_type text) returns uuid
language sql as $$
  select tests.owner_val(null, format(
    $q$select id from app.categories where space_id = %L and type = %L and parent_id is null
         and archived_at is null order by sort_order, name limit 1$q$, p_space, p_type))::uuid
$$;
create function pg_temp.entry(p_uid uuid, p_acc uuid, p_kind text, p_amount bigint, p_on date,
  p_desc text default null, p_reimb boolean default false) returns uuid
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.create_entry(gen_random_uuid(), (select space_id from app.accounts where id = %L),
         %L, %L, %s, null, %L::date, %L, %L) ->> 'entry_id'$q$,
    p_acc, p_acc, p_kind, p_amount, p_on, p_desc, p_reimb))::uuid
$$;
create function pg_temp.move(p_uid uuid, p_entry uuid, p_version int, p_to uuid, p_acc uuid, p_cat uuid,
  p_keep boolean default false, p_allow boolean default false, p_client uuid default null) returns jsonb
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.move_entry_to_space(p_client_id => %L, p_entry_id => %L, p_expected_version => %L,
         p_to_space_id => %L, p_account_id => %L, p_category_id => %L, p_keep_description => %L,
         p_allow_negative => %L)$q$,
    coalesce(p_client, gen_random_uuid()), p_entry, p_version, p_to, p_acc, p_cat, p_keep, p_allow))::jsonb
$$;
create function pg_temp.row(p_entry uuid) returns text
language sql as $$
  select tests.owner_val(null, format(
    $q$select e.space_kind || ' ' || e.kind || ' ' || e.occurred_on || ' ' || coalesce(e.description, '-') || ' '
         || coalesce(e.category_id::text, '-') || ' ' || e.reimbursable || ' v' || e.version || ' '
         || (e.voided_at is null) || ' ' || coalesce(e.moved_to_entry_id::text, '-')
       from app.entries e where e.id = %L$q$, p_entry))
$$;
create function pg_temp.lines(p_entry uuid) returns text
language sql as $$
  select tests.owner_val(null, format(
    $q$select string_agg(role || '=' || amount || '@' || account_id, ',' order by role)
       from app.entry_lines where entry_id = %L$q$, p_entry))
$$;
create function pg_temp.version(p_entry uuid) returns int
language sql as $$
  select tests.owner_val(null, format($q$select version from app.entries where id = %L$q$, p_entry))::int
$$;

select pg_temp.cat(:'sh', 'expense') as cat_sh, pg_temp.cat(:'sh', 'income') as cat_sh_in,
       pg_temp.cat(:'np', 'expense') as cat_np, pg_temp.cat(:'np', 'income') as cat_np_in,
       pg_temp.cat(:'fp', 'expense') as cat_fp \gset

-- ===== Pribadi -> Bersama: void asal + buat ulang, deskripsi tidak ikut (bawaan) =====
select pg_temp.entry(tests.n(), :'bca', 'expense', 100000, '2026-03-15', 'makan rahasia N') as e1 \gset
select pg_temp.move(tests.n(), :'e1', 1, :'sh', :'kas', :'cat_sh') as m1 \gset
select is((:'m1'::jsonb) - 'entry_id', jsonb_build_object('moved_from_entry_id', :'e1', 'version', 1,
  'replayed', false, 'warnings', '[]'::jsonb), 'hasil: moved_from_entry_id = asal, version 1, replayed false');
select isnt((:'m1'::jsonb) ->> 'entry_id', :'e1', 'entry_id = entri baru');
select is(pg_temp.row(:'e1'), 'personal expense 2026-03-15 makan rahasia N - false v2 false ' || ((:'m1'::jsonb) ->> 'entry_id'),
  'asal: dibatalkan, versi naik, moved_to_entry_id = entri baru');
select is(tests.owner_val(null, format($$select (voided_at = app.now() and voided_by = %L)::text from app.entries where id = %L$$,
  tests.n(), :'e1')), 'true', 'asal: voided_at = app.now(), voided_by = pemindah');
select is(pg_temp.row(((:'m1'::jsonb) ->> 'entry_id')::uuid), 'shared expense 2026-03-15 - ' || :'cat_sh' || ' false v1 true -',
  'baru: Bersama, tanggal sama, tanpa deskripsi, kategori Bersama, versi 1, hidup');
select is(pg_temp.lines(((:'m1'::jsonb) ->> 'entry_id')::uuid), 'main=-100000@' || :'kas', 'baru: satu line main nominal sama di dompet tujuan');
select is(pg_temp.lines(:'e1'), 'main=-100000@' || :'bca', 'asal: line tetap (jejak), tidak ikut saldo karena batal');
select is(tests.balance(:'bca') || ' ' || tests.balance(:'kas'), '1000000 200000', 'saldo: BCA kembali, Kas Rumah berkurang');
select is(tests.owner_val(null, format($$select string_agg(op || ':' || version || ':' || coalesce(snapshot ->> 'moved_to_entry_id', '-'), ','
  order by version) from app.entry_history where entry_id = %L$$, :'e1')),
  'create:1:-,void:2:' || ((:'m1'::jsonb) ->> 'entry_id'), 'riwayat asal: create lalu void (snapshot memuat moved_to_entry_id)');
select is(tests.owner_val(null, format($$select string_agg(op || ':' || version || ':' || space_id, ',') from app.entry_history where entry_id = %L$$,
  (:'m1'::jsonb) ->> 'entry_id')), 'create:1:' || :'sh', 'riwayat baru: create di Bersama');
select is(tests.owner_val(null, format($$select created_by || ' ' || updated_by from app.entries where id = %L$$, (:'m1'::jsonb) ->> 'entry_id')),
  tests.n() || ' ' || tests.n(), 'baru: pencatat = pemindah');

-- Asal tidak bisa dipulihkan, dibatalkan lagi, atau diubah; tidak tampil di Sampah.
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.restore_entry(gen_random_uuid(), %L, 2)$q$, :'e1')),
  'DK422', 'entry_moved', 'pulihkan entri yang sudah dipindah = entry_moved');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.void_entry(gen_random_uuid(), %L, 2)$q$, :'e1')),
  'DK422', 'already_voided', 'batalkan lagi = already_voided');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 2, %L, %L, %L)$$, :'e1', :'sh', :'kas', :'cat_sh'),
  'DK422', 'entry_voided', 'pindahkan lagi = entry_voided');
select is(tests.web_val(tests.n(), format($$select count(*) from api.trash_list(%L) where entry_id = %L$$, :'np', :'e1')), '0',
  'Sampah Pribadi tidak memuat entri yang dipindah');
select is(tests.web_val(tests.n(), format($$select count(*) from api.trash_list(%L)$$, :'sh')), '0',
  'Sampah Bersama kosong (entri baru hidup)');

-- Bersama tidak menerima deskripsi Pribadi atau id entri/dompet Pribadi.
select is(tests.web_val(tests.f(), format($$select count(*) from (
    select e::text as x from app.entries e
    union all select h::text from app.entry_history h
    union all select l::text from app.entry_lines l
    union all select r::text from app.report_lines r
    union all select t::text from api.trash_list(%L) t
    union all select a::text from api.activity_feed(%L, 100) a
  ) s where x like '%%rahasia N%%' or x like %L or x like %L$$,
  :'sh', :'sh', '%' || :'e1' || '%', '%' || :'bca' || '%')), '0',
  'F: tanpa deskripsi Pribadi, id entri asal, atau id dompet Pribadi di semua yang terlihat');
select is(tests.web_val(tests.f(), format($$select count(*) from app.entries where id = %L$$, (:'m1'::jsonb) ->> 'entry_id')), '1',
  'F melihat entri baru di Bersama');

-- ===== Deskripsi ikut bila dipilih; Bersama -> Pribadi selalu membawa deskripsi =====
select pg_temp.entry(tests.n(), :'bca', 'expense', 50000, '2026-03-16', 'belanja bulanan') as e2 \gset
select pg_temp.move(tests.n(), :'e2', 1, :'sh', :'kas', :'cat_sh', true) ->> 'entry_id' as n2 \gset
select is(pg_temp.row(:'n2'), 'shared expense 2026-03-16 belanja bulanan ' || :'cat_sh' || ' false v1 true -',
  'p_keep_description true: deskripsi ikut ke Bersama');

select pg_temp.entry(tests.n(), :'kas', 'income', 70000, '2026-03-17', 'arisan') as e3 \gset
select pg_temp.move(tests.n(), :'e3', 1, :'np', :'bca', :'cat_np_in') ->> 'entry_id' as n3 \gset
select is(pg_temp.row(:'n3'), 'personal income 2026-03-17 arisan ' || :'cat_np_in' || ' false v1 true -',
  'pemasukan Bersama -> Pribadi: deskripsi selalu ikut');
select is(pg_temp.lines(:'n3'), 'main=70000@' || :'bca', 'pemasukan pindah: line +nominal di dompet Pribadi');
select is(pg_temp.row(:'e3'), 'shared income 2026-03-17 arisan - false v2 false ' || :'n3', 'asal Bersama dibatalkan dan menunjuk entri baru');
select is(tests.balance(:'bca') || ' ' || tests.balance(:'kas'), '1070000 150000',
  'saldo sesudah tiga pindah (BCA kembali + pemasukan 70000; Kas 300000 - 100000 - 50000)');

-- Tanpa kategori boleh (pola create_entry); entri yang sudah dipindah bisa dipindah lagi (rantai).
select pg_temp.move(tests.n(), :'n2'::uuid, 1, :'np', :'bca', null) ->> 'entry_id' as n2b \gset
select is(pg_temp.row(:'n2b'), 'personal expense 2026-03-16 belanja bulanan - false v1 true -',
  'pindah balik ke Pribadi tanpa kategori: deskripsi Bersama ikut');
select is(pg_temp.row(:'n2'), 'shared expense 2026-03-16 belanja bulanan ' || :'cat_sh' || ' false v2 false ' || :'n2b',
  'rantai: entri hasil pindah ikut ditandai moved_to_entry_id');

-- ===== Hanya pencatat; ruang lain milik orang lain = DK404 =====
select pg_temp.entry(tests.n(), :'kas', 'expense', 1000, '2026-03-18', 'galon') as e4 \gset
select throws_ok(format($$select pg_temp.move(tests.f(), %L, 1, %L, %L, %L)$$, :'e4', :'fp', :'fbca', :'cat_fp'),
  'DK422', 'not_creator', 'F memindahkan entri Bersama catatan N = not_creator');
select pg_temp.entry(tests.f(), :'kas', 'expense', 2000, '2026-03-18', 'sabun') as ef \gset
select is(pg_temp.row(((pg_temp.move(tests.f(), :'ef', 1, :'fp', :'fbca', :'cat_fp')) ->> 'entry_id')::uuid),
  'personal expense 2026-03-18 sabun ' || :'cat_fp' || ' false v1 true -', 'F memindahkan catatannya sendiri ke Pribadi F');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L)$$, :'e4', :'sh', :'kas', :'cat_sh'),
  'DK400', 'invalid_argument', 'ruang tujuan = ruang asal (Bersama) = DK400');
select pg_temp.entry(tests.n(), :'bca', 'expense', 3000, '2026-03-18', 'rahasia lain') as e5 \gset
select throws_ok(format($$select pg_temp.move(tests.f(), %L, 1, %L, %L, %L)$$, :'e5', :'sh', :'kas', :'cat_sh'),
  'DK404', 'entry_not_found', 'F memindahkan entri Pribadi N = DK404');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L)$$, :'e5', :'fp', :'fbca', :'cat_fp'),
  'DK404', 'space_not_found', 'N memindahkan ke Pribadi F = DK404');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L)$$, gen_random_uuid(), :'sh', :'kas', :'cat_sh'),
  'DK404', 'entry_not_found', 'entri tidak ada = DK404');

-- ===== Validasi argumen, jenis, versi =====
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L)$$, :'e5', :'np', :'bca', :'cat_np'),
  'DK400', 'invalid_argument', 'ruang tujuan = ruang asal (Pribadi) = DK400');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, null, %L, %L)$$, :'e5', :'kas', :'cat_sh'),
  'DK400', 'invalid_argument', 'ruang tujuan NULL = DK400');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, null, %L)$$, :'e5', :'sh', :'cat_sh'),
  'DK400', 'invalid_argument', 'dompet NULL = DK400');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, null, %L, %L, %L)$$, :'e5', :'sh', :'kas', :'cat_sh'),
  'DK400', 'invalid_argument', 'expected_version NULL = DK400');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.move_entry_to_space(null, %L, 1, %L, %L, %L)$q$, :'e5', :'sh', :'kas', :'cat_sh')),
  'DK400', 'invalid_argument', 'client_id NULL = DK400');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 2, %L, %L, %L)$$, :'e5', :'sh', :'kas', :'cat_sh'),
  'DK409', 'version_conflict', 'versi usang = DK409');

select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 1000)$$,
  :'np', :'bca', :'dana')) ->> 'entry_id' as tr \gset
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 1000)$$,
  :'np', :'bca', :'kas')) ->> 'entry_id' as st \gset
select tests.owner_val(null, format($$select e.id from app.entries e join app.entry_lines l on l.entry_id = e.id
  where l.account_id = %L and e.kind = 'opening_balance'$$, :'bca')) as ob \gset
select pg_temp.call(tests.n(), format($$select api.reconcile_balance(gen_random_uuid(), %L, 5)$$, :'dana')) ->> 'entry_id' as adj \gset
select pg_temp.entry(tests.n(), :'bca', 'expense', 9000, '2026-03-18', null, true) as tal_r \gset
select pg_temp.call(tests.n(), format($$select api.create_reimbursement(gen_random_uuid(), %L, %L, 1000)$$,
  :'tal_r', :'bca')) ->> 'entry_id' as reimb \gset
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L)$$, id, :'sh', :'kas', :'cat_sh'),
  'DK422', 'kind_not_movable', 'jenis ' || k || ' = kind_not_movable')
from (values ('transfer', :'tr'::uuid), ('space_transfer', :'st'::uuid), ('opening_balance', :'ob'::uuid),
             ('adjustment', :'adj'::uuid), ('reimbursement', :'reimb'::uuid)) v (k, id);

-- ===== Dompet dan kategori ruang tujuan =====
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L)$$, :'e5', :'sh', :'dana', :'cat_sh'),
  'DK422', 'space_mismatch', 'dompet di ruang lain (Pribadi) = space_mismatch');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L)$$, :'e5', :'sh', :'fbca', :'cat_sh'),
  'DK404', 'account_not_found', 'dompet Pribadi F = DK404');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L)$$, :'e5', :'sh', :'lama', :'cat_sh'),
  'DK422', 'account_archived', 'dompet tujuan terarsip = account_archived');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L)$$, :'e5', :'sh', :'baru', :'cat_sh'),
  'DK422', 'before_opening', 'tanggal entri sebelum dompet tujuan dibuka = before_opening');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L)$$, :'e5', :'sh', :'kas', :'cat_np'),
  'DK404', 'category_not_found', 'kategori ruang asal = DK404');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L)$$, :'e5', :'sh', :'kas', :'cat_sh_in'),
  'DK404', 'category_not_found', 'kategori beda jenis = DK404');
select pg_temp.call(tests.n(), format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Arsip Pindah', 'Car')$$,
  :'sh')) ->> 'category_id' as cat_arsip \gset
select pg_temp.call(tests.n(), format($$select api.archive_category(%L)$$, :'cat_arsip'));
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L)$$, :'e5', :'sh', :'kas', :'cat_arsip'),
  'DK404', 'category_not_found', 'kategori terarsip = DK404 (pola create_entry)');
select is(pg_temp.row(:'e5'), 'personal expense 2026-03-18 rahasia lain - false v1 true -', 'semua penolakan tanpa efek pada asal');

-- ===== Saldo negatif (kedua sisi), p_allow_negative =====
select pg_temp.entry(tests.n(), :'dana', 'income', 10000, '2026-03-18') as inc \gset
select pg_temp.entry(tests.n(), :'dana', 'expense', 8000, '2026-03-18') as exp_d \gset
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L)$$, :'inc', :'sh', :'kas', :'cat_sh_in'),
  'DK422', 'saldo_negatif', 'pindah pemasukan yang membuat dompet asal negatif ditolak');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L)$$, :'e5', :'sh', :'kosong', :'cat_sh'),
  'DK422', 'saldo_negatif', 'pindah pengeluaran ke dompet tujuan bersaldo 0 ditolak');
select is(tests.balance(:'dana') || ' ' || tests.balance(:'kosong'), '2005 0', 'penolakan saldo tanpa efek');
select is(pg_temp.move(tests.n(), :'inc', 1, :'sh', :'kas', :'cat_sh_in', false, true) ->> 'version', '1',
  'p_allow_negative: pindah tetap boleh sesudah konfirmasi');
select is(tests.balance(:'dana'), -7995::bigint, 'dompet asal negatif sesudah konfirmasi');

-- ===== Talangan =====
select pg_temp.entry(tests.n(), :'bca', 'expense', 40000, '2026-03-18', 'hotel', true) as t1 \gset
select pg_temp.move(tests.n(), :'t1', 1, :'sh', :'kas', :'cat_sh') ->> 'entry_id' as nt1 \gset
select is(pg_temp.row(:'nt1'), 'shared expense 2026-03-18 - ' || :'cat_sh' || ' false v1 true -',
  'talangan tanpa reimburse ke Bersama: reimbursable dilepas');
select is(tests.web_val(tests.n(), format($$select count(*) from api.open_reimbursables(%L) where entry_id = %L$$, :'np', :'t1')), '0',
  'talangan yang dipindah hilang dari daftar Menunggu reimburse');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L)$$, :'tal_r', :'sh', :'kas', :'cat_sh'),
  'DK422', 'reimbursement_exists', 'talangan dengan reimburse hidup = reimbursement_exists');
-- Reimburse yang sudah batal tetap menunjuk asal (FK); asal boleh dipindah, reimburse lama tidak bisa dipulihkan.
select pg_temp.entry(tests.n(), :'bca', 'expense', 30000, '2026-03-18', 'taksi', true) as t3 \gset
select pg_temp.call(tests.n(), format($$select api.create_reimbursement(gen_random_uuid(), %L, %L, 5000)$$,
  :'t3', :'bca')) ->> 'entry_id' as r3 \gset
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'r3'));
select is(pg_temp.move(tests.n(), :'t3', 1, :'sh', :'kas', :'cat_sh') ->> 'version', '1',
  'talangan dengan reimburse batal saja boleh dipindah');
select is(tests.owner_val(null, format($$select reimburses_entry_id from app.entries where id = %L$$, :'r3')), :'t3',
  'reimburse batal tetap menunjuk talangan asal');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.restore_entry(gen_random_uuid(), %L, 2)$q$, :'r3')),
  'DK422', 'not_reimbursable', 'pulihkan reimburse atas talangan yang dipindah = not_reimbursable');

-- ===== Idempotensi =====
select pg_temp.entry(tests.n(), :'bca', 'expense', 4000, '2026-03-19', 'parkir') as e6 \gset
select pg_temp.move(tests.n(), :'e6', 1, :'sh', :'kas', :'cat_sh', false, false, 'dddddddd-0000-0000-0000-000000000001') as idem \gset
select is(pg_temp.move(tests.n(), :'e6', 1, :'sh', :'kas', :'cat_sh', false, false, 'dddddddd-0000-0000-0000-000000000001'),
  (:'idem'::jsonb) - 'replayed' || '{"replayed": true}', 'klik ganda: hasil sama, replayed true, tanpa DK409');
select is(pg_temp.move(tests.n(), :'e6', 1, :'sh', :'kas', :'cat_sh', false, true, 'dddddddd-0000-0000-0000-000000000001') ->> 'entry_id',
  (:'idem'::jsonb) ->> 'entry_id', 'p_allow_negative tidak masuk hash: kirim ulang sesudah konfirmasi = replay');
select is(tests.owner_val(null, format($$select count(*) from app.entries where space_id = %L and kind = 'expense'
  and occurred_on = '2026-03-19' and voided_at is null$$, :'sh')), '1', 'klik ganda = 1 entri baru');
select throws_ok(format($$select pg_temp.move(tests.n(), %L, 1, %L, %L, %L, true, false, %L)$$, :'e6', :'sh', :'kas', :'cat_sh',
  'dddddddd-0000-0000-0000-000000000001'),
  'DK410', 'idempotency_key_reused', 'client_id sama, p_keep_description beda = DK410');

-- ===== Purge: asal yang dipindah dipurge normal sesudah 90 hari =====
select tests.clock_at('2026-06-19 10:00+07');  -- +91 hari
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.restore_entry(gen_random_uuid(), %L, 2)$q$, :'e1')),
  'DK422', 'entry_moved', 'sesudah 90 hari tetap entry_moved (bukan restore_window_closed)');
select ok(tests.worker_val(null, 'select jobs.purge_voided()')::int > 0, 'purge_voided berjalan');
select is(tests.owner_val(null, format($$select (select count(*) from app.entries where id = %1$L) || ' '
  || (select count(*) from app.entry_tombstones where entry_id = %1$L) || ' '
  || (select count(*) from app.entries where id = %2$L and voided_at is null)$$, :'e1', (:'m1'::jsonb) ->> 'entry_id')),
  '0 1 1', 'asal dipurge (tombstone), entri baru tetap hidup');
select is(tests.owner_val(null, format($$select (select count(*) from app.entries where id = %L) || ' '
  || (select count(*) from app.entries where id = %L)$$, :'r3', :'t3')), '0 1',
  'talangan asal menunggu reimburse batalnya dipurge lebih dulu');
select is(tests.worker_val(null, 'select jobs.purge_voided()'), '1', 'putaran berikutnya memurge talangan asal');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.restore_entry(gen_random_uuid(), %L, 2)$q$, :'e1')),
  'DK404', 'entry_not_found', 'pulihkan asal yang sudah dipurge = DK404');

-- ===== Cek kualitas data: nol temuan sesudah semua pindah =====
select is(tests.worker_val(null, $$select string_agg(check_id || '=' || violations, ',' order by check_id) from jobs.dq_reconcile()$$),
  'DQ01=0,DQ04=0,DQ04b=0,DQ06=0,DQ09=0,DQ10=0', 'dq_reconcile: nol temuan');

select * from finish();
rollback;
