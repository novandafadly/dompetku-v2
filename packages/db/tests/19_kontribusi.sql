-- Kontribusi per anggota Bersama (S8, 0115; plan S8 Task 3, bingkai S8-K1, Review Focus #3, #4):
-- api.member_contributions = per pencatat (created_by), per periode occurred_on (tanggal WIB):
-- setoran = Σ line main kelas x_setoran_anggota (kaki Bersama masuk), diambil = Σ |line main| kelas
-- x_diambil_anggota (kaki Bersama keluar). Biaya (expense_fee) tidak ikut (K2); pemasukan
-- berkategori "Kontribusi Farida" tidak dihitung (K4); entri batal tidak dihitung. Satu baris per
-- anggota roster, anggota tanpa transaksi = 0. Hanya user_id dan angka: tanpa dompet, deskripsi,
-- atau id entri. Persona N (pemilik), F (bergabung lewat undangan di tengah tes), Luar (tests.x()).
-- ID: B3, B6, T13, Z1
begin;
select plan(46);
-- Bersama solo dulu (sebelum F bergabung); F bergabung di bawah dengan langkah tests.fixture().
select tests.fixture(false);
select tests.clock_at('2026-10-10 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'KANARI-DOMPET-N', 'operasional', 7777777, '2026-01-01') as bca,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 1000000, '2026-01-01') as kas,
       tests.account(tests.n(), :'sh', 'Tabungan Rumah', 'operasional', 0, '2026-01-01') as tab \gset

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
-- Keluaran fungsi dalam urutan keluaran: pelaku:setoran:diambil:setoran_count:diambil_count.
create function pg_temp.k(p_uid uuid, p_space uuid, p_from date, p_to date) returns text
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select coalesce(string_agg(
         case c.user_id when '11111111-1111-1111-1111-111111111111' then 'N'
                        when '22222222-2222-2222-2222-222222222222' then 'F' else '?' end
         || ':' || c.setoran || ':' || c.diambil || ':' || c.setoran_count || ':' || c.diambil_count,
         ',' order by c.n), '')
       from api.member_contributions(%L, %L, %L) with ordinality c (user_id, setoran, diambil,
         setoran_count, diambil_count, n)$q$, p_space, p_from, p_to))
$$;
-- Oktober dan November 2026 (bulan kalender WIB, K3).
create function pg_temp.okt(p_uid uuid) returns text language sql as $$
  select pg_temp.k(p_uid, tests.space_id(tests.n(), 'shared'), '2026-10-01', '2026-10-31') $$;
create function pg_temp.nov(p_uid uuid) returns text language sql as $$
  select pg_temp.k(p_uid, tests.space_id(tests.n(), 'shared'), '2026-11-01', '2026-11-30') $$;
-- Galat sebagai teks sqlstate:message:detail.
create function pg_temp.err(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v_state text; v_msg text; v_detail text;
begin
  perform tests.web_exec(p_uid, p_sql);
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
  return v_state || ':' || v_msg || ':' || coalesce(v_detail, '-');
end $$;
-- Oracle: period_summary satu kelas sebagai inflow:outflow:entry_count (0:0:0 bila tidak ada).
create function pg_temp.ps(p_uid uuid, p_class text, p_from date, p_to date) returns text
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select coalesce((select inflow || ':' || outflow || ':' || entry_count
       from api.period_summary(%L, %L, %L) where report_class = %L), '0:0:0')$q$,
    tests.space_id(tests.n(), 'shared'), p_from, p_to, p_class))
$$;
-- Jumlah member_contributions semua anggota dalam bentuk yang sama dengan pg_temp.ps.
create function pg_temp.sum(p_uid uuid, p_col text, p_from date, p_to date) returns text
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select case %L when 'setoran' then sum(setoran) || ':0:' || sum(setoran_count)
                       else '0:' || sum(diambil) || ':' || sum(diambil_count) end
       from api.member_contributions(%L, %L, %L)$q$,
    p_col, tests.space_id(tests.n(), 'shared'), p_from, p_to))
$$;

-- ===== Bentuk fungsi (Interfaces Task 3): hanya user_id dan angka =====
select (select coalesce(string_agg(p.oid::text, ','), '0') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'api' and p.proname = 'member_contributions') as fn \gset
select is((select pg_get_function_result(:'fn'::oid)),
  'TABLE(user_id uuid, setoran bigint, diambil bigint, setoran_count integer, diambil_count integer)',
  'kolom hasil persis Interfaces (tanpa dompet, deskripsi, id entri)');
select is((select pg_get_function_arguments(:'fn'::oid)), 'p_space_id uuid, p_from date, p_to date',
  'argumen persis Interfaces');
select is((select p.prosecdef::text || ' ' || p.provolatile::text || ' ' || p.proowner::regrole::text
             || ' ' || array_to_string(p.proconfig, ',')
           from pg_proc p where p.oid = :'fn'::oid),
  'false s dompetku_owner search_path=""', 'SECURITY INVOKER, STABLE, milik owner (pola baca api), search_path kosong');
select is((select string_agg(r, ',' order by r) from unnest(array['dompetku_web', 'dompetku_api',
             'dompetku_worker', 'dompetku_auditor', 'dompetku_test']) r
           where has_function_privilege(r, :'fn'::oid, 'EXECUTE')),
  'dompetku_web', 'EXECUTE hanya dompetku_web (bukan api, worker, auditor)');

-- ===== Bersama solo (sebelum F bergabung) =====
select is(pg_temp.okt(tests.n()), 'N:0:0:0:0', 'Bersama solo tanpa setoran: satu baris N nol (saldo awal dompet tidak dihitung)');
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 500000, 0, null, 'KANARI-N-SETOR-1', 'setoran-oktober')$$,
  :'np', :'bca', :'kas')) as s1 \gset
select is(pg_temp.okt(tests.n()), 'N:500000:0:1:0', 'Bersama solo: satu baris N, setoran 500000');

-- F bergabung (langkah sama dengan tests.fixture()).
select tests.web_exec(tests.n(), $q$select api.create_invitation('farida@example.test', pg_catalog.sha256('tok-farida'))$q$);
select tests.signup(tests.f(), 'farida@example.test', true, true);
select tests.web_exec(tests.f(), $q$select api.accept_invitation(pg_catalog.sha256('tok-farida'), 'Farida')$q$);
select set_config('app.invite_token_hash', '', true);
select tests.space_id(tests.f(), 'personal') as fp \gset
select tests.account(tests.f(), :'fp', 'KANARI-DOMPET-F', 'operasional', 6666666, '2026-01-01') as fbca \gset

select is(pg_temp.okt(tests.n()), 'N:500000:0:1:0,F:0:0:0:0', 'F baru bergabung: baris F tetap ada dengan 0/0, urut user_id');
select is(pg_temp.okt(tests.f()), pg_temp.okt(tests.n()), 'F melihat angka yang sama dengan N');

-- ===== Setor dan ambil per pencatat; biaya tidak ikut (K2) [B3, B6] =====
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 200000, 1000, null, 'KANARI-N-SETOR-2')$$,
  :'np', :'bca', :'kas')) as s2 \gset
select pg_temp.call(tests.f(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 300000, 0, null, 'KANARI-F-SETOR')$$,
  :'fp', :'fbca', :'kas')) as s3 \gset
select pg_temp.call(tests.f(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 100000, 2500, null, 'KANARI-F-AMBIL', 'ambil-belanja')$$,
  :'sh', :'kas', :'fbca')) as a1 \gset
select is(pg_temp.okt(tests.n()), 'N:700000:0:2:0,F:300000:100000:1:1',
  'N setor 500000 + 200000 (biaya di Pribadi), F setor 300000 dan ambil 100000 dengan biaya 2500: biaya tidak dihitung [B3, B6]');
select is(pg_temp.ps(tests.n(), 'expense_fee', '2026-10-01', '2026-10-31'), '0:2500:1',
  'kontrol: biaya ambil F memang ada di Bersama sebagai expense_fee (bukan diambil)');
select is(tests.balance(:'kas'), 1000000 + 500000 + 200000 + 300000 - 100000 - 2500::bigint,
  'kontrol: saldo kas Bersama memuat setoran, ambil, dan biaya');

-- Transaksi Bersama lain tidak mengubah Kontribusi: pengeluaran, transfer dalam Bersama, cocokkan saldo.
select pg_temp.call(tests.f(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 45000, null, null, 'belanja')$$,
  :'sh', :'kas'));
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 60000, 500, null, 'ke tabungan')$$,
  :'sh', :'kas', :'tab'));
select pg_temp.call(tests.n(), format($$select api.reconcile_balance(gen_random_uuid(), %L, %s)$$, :'tab', 70000));
-- Pribadi: pengeluaran N dan F, transfer antar dompet Pribadi tidak menyentuh Bersama.
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 33000, null, null, 'KANARI-N-PRIBADI')$$,
  :'np', :'bca'));
select pg_temp.call(tests.f(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'income', 44000, null, null, 'KANARI-F-PRIBADI')$$,
  :'fp', :'fbca'));
select is(pg_temp.okt(tests.n()), 'N:700000:0:2:0,F:300000:100000:1:1',
  'pengeluaran, transfer dalam Bersama (berbiaya), cocokkan saldo, dan entri Pribadi tidak dihitung');

-- K4: pemasukan Bersama berkategori "Kontribusi Farida" oleh F tidak dihitung.
select tests.owner_val(null, format($$select id from app.categories where space_id = %L and name = 'Kontribusi Farida'$$, :'sh')) as kf \gset
select ok(:'kf' <> '', 'kontrol: kategori awal Bersama "Kontribusi Farida" ada');
select pg_temp.call(tests.f(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'income', 250000, %L, null, 'gaji masuk')$$,
  :'sh', :'kas', :'kf'));
select is(pg_temp.okt(tests.n()), 'N:700000:0:2:0,F:300000:100000:1:1',
  'pemasukan berkategori Kontribusi Farida tidak mengubah angka F (K4)');
select is(pg_temp.ps(tests.n(), 'income', '2026-10-01', '2026-10-31'), '250000:0:1',
  'kontrol: pemasukan itu memang masuk kelas income Bersama');

-- ===== Void dan restore: hanya entri hidup =====
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 40000, 0, null, 'KANARI-N-SETOR-3')$$,
  :'np', :'bca', :'kas')) as s4 \gset
select is(pg_temp.okt(tests.n()), 'N:740000:0:3:0,F:300000:100000:1:1', 'setoran ketiga N dihitung');
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, (:'s4'::jsonb) ->> 'entry_id'));
select is(pg_temp.okt(tests.n()), 'N:700000:0:2:0,F:300000:100000:1:1',
  'setoran N yang dibatalkan (dari kaki Pribadi, pasangan ikut batal) tidak dihitung');
select pg_temp.call(tests.n(), format($$select api.restore_entry(gen_random_uuid(), %L, 2)$$, (:'s4'::jsonb) ->> 'entry_id'));
select is(pg_temp.okt(tests.n()), 'N:740000:0:3:0,F:300000:100000:1:1', 'setoran yang dipulihkan dihitung lagi');
select pg_temp.call(tests.f(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, (:'a1'::jsonb) ->> 'entry_id'));
select is(pg_temp.okt(tests.f()), 'N:740000:0:3:0,F:300000:0:1:0', 'ambil F dibatalkan: diambil F kembali 0');
select pg_temp.call(tests.f(), format($$select api.restore_entry(gen_random_uuid(), %L, 2)$$, (:'a1'::jsonb) ->> 'entry_id'));
select is(pg_temp.okt(tests.f()), 'N:740000:0:3:0,F:300000:100000:1:1', 'ambil F dipulihkan: dihitung lagi');

-- Entri yang dipurge (batal lalu hapus permanen) tidak dihitung.
select pg_temp.call(tests.f(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 9000, 0, null, 'akan dipurge')$$,
  :'fp', :'fbca', :'kas')) as s5 \gset
select pg_temp.call(tests.f(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, (:'s5'::jsonb) ->> 'entry_id'));
select pg_temp.call(tests.f(), format($$select api.purge_entry(%L, 2)$$, (:'s5'::jsonb) ->> 'entry_id'));
select is(pg_temp.okt(tests.f()), 'N:740000:0:3:0,F:300000:100000:1:1', 'setoran yang dipurge tidak dihitung');

-- ===== Batas bulan WIB (T13, Z1): periode menurut occurred_on (tanggal kalender WIB) =====
select tests.clock_at('2026-10-31 23:30+07');
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 10000, 0, null, 'akhir oktober')$$,
  :'np', :'bca', :'kas')) as s6 \gset
select tests.clock_at('2026-11-01 00:30+07');
select pg_temp.call(tests.f(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 20000, 0, null, 'awal november')$$,
  :'fp', :'fbca', :'kas')) as s7 \gset
-- Dicatat 1 Nov tetapi bertanggal 31 Okt (mundur): ikut Oktober, sama dengan period_summary.
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 5000, 0, '2026-10-31', 'mundur')$$,
  :'np', :'bca', :'kas')) as s8 \gset
select is(tests.web_val(tests.n(), format($$select string_agg(occurred_on::text, ',' order by occurred_on) from app.entries where id in (%L, %L)$$,
  (:'s6'::jsonb) ->> 'linked_entry_id', (:'s7'::jsonb) ->> 'linked_entry_id')), '2026-10-31,2026-11-01',
  'kontrol: 23.30 WIB 31 Okt bertanggal 31 Okt, 00.30 WIB 1 Nov bertanggal 1 Nov (UTC keduanya 31 Okt)');
select is(pg_temp.okt(tests.n()), 'N:755000:0:5:0,F:300000:100000:1:1',
  'Oktober: setoran 23.30 WIB 31 Okt dan setoran mundur bertanggal 31 Okt masuk; 00.30 WIB 1 Nov tidak [T13, Z1]');
select is(pg_temp.nov(tests.n()), 'N:0:0:0:0,F:20000:0:1:0',
  'November: hanya setoran 00.30 WIB 1 Nov; N tetap punya baris 0/0');
select is(pg_temp.k(tests.n(), :'sh', '2026-10-31', '2026-10-31'), 'N:15000:0:2:0,F:0:0:0:0', 'periode satu hari (p_from = p_to) inklusif');
select is(pg_temp.k(tests.n(), :'sh', '2026-12-01', '2026-12-31'), 'N:0:0:0:0,F:0:0:0:0', 'periode tanpa transaksi: semua anggota 0');
select is(pg_temp.k(tests.f(), :'sh', '2026-01-01', '2026-12-31'), 'N:755000:0:5:0,F:320000:100000:2:1', 'periode setahun');

-- ===== Oracle: Σ anggota = period_summary kelas x_setoran_anggota / x_diambil_anggota =====
select is(pg_temp.sum(tests.n(), 'setoran', '2026-10-01', '2026-10-31'), pg_temp.ps(tests.n(), 'x_setoran_anggota', '2026-10-01', '2026-10-31'),
  'oracle Oktober: Σ setoran dan jumlah entri = period_summary x_setoran_anggota');
select is(pg_temp.sum(tests.n(), 'diambil', '2026-10-01', '2026-10-31'), pg_temp.ps(tests.n(), 'x_diambil_anggota', '2026-10-01', '2026-10-31'),
  'oracle Oktober: Σ diambil dan jumlah entri = period_summary x_diambil_anggota');
select is(pg_temp.sum(tests.f(), 'setoran', '2026-11-01', '2026-11-30'), pg_temp.ps(tests.f(), 'x_setoran_anggota', '2026-11-01', '2026-11-30'),
  'oracle November: Σ setoran = period_summary x_setoran_anggota');
select is(pg_temp.ps(tests.n(), 'x_setoran_anggota', '2026-10-01', '2026-10-31'), '1055000:0:6',
  'kontrol oracle: period_summary memang tidak kosong');

-- ===== Batas privasi: keluaran hanya user_id anggota dan angka =====
create temp table forbidden (label text, needle text);
insert into forbidden values
  ('KANARI', 'KANARI'), ('Kas Rumah', 'Kas Rumah'), ('setoran-oktober', 'setoran-oktober'), ('ambil-belanja', 'ambil-belanja'),
  ('7777777', '7777777'), ('6666666', '6666666'),
  ('id dompet N', :'bca'), ('id dompet F', :'fbca'), ('id dompet kas', :'kas'), ('id dompet tab', :'tab'),
  ('link_id s1', (:'s1'::jsonb) ->> 'link_id'), ('link_id a1', (:'a1'::jsonb) ->> 'link_id'),
  ('kaki Pribadi s1', (:'s1'::jsonb) ->> 'entry_id'), ('kaki Bersama s1', (:'s1'::jsonb) ->> 'linked_entry_id'),
  ('kaki Bersama a1', (:'a1'::jsonb) ->> 'entry_id'), ('kaki Pribadi a1', (:'a1'::jsonb) ->> 'linked_entry_id'),
  ('ruang Pribadi N', :'np'), ('ruang Pribadi F', :'fp'), ('ruang Bersama', :'sh');
create function pg_temp.dump(p_uid uuid) returns text language sql as $$
  select tests.web_val(p_uid, format($q$select string_agg(c::text, E'\n') from api.member_contributions(%L, '2026-01-01', '2026-12-31') c$q$,
    tests.space_id(tests.n(), 'shared')))
$$;
select is((select string_agg(label, ',') from forbidden where pg_temp.dump(tests.n()) like '%' || needle || '%'), null,
  'keluaran untuk N: tanpa kanari, deskripsi, catatan, id dompet, link_id, id entri, id ruang');
select is((select string_agg(label, ',') from forbidden where pg_temp.dump(tests.f()) like '%' || needle || '%'), null,
  'keluaran untuk F: tanpa kanari, deskripsi, catatan, id dompet, link_id, id entri, id ruang');
select is(tests.web_val(tests.f(), format($$select string_agg(user_id::text, ',' order by user_id)
  from api.member_contributions(%L, '2026-01-01', '2026-12-31')$$, :'sh')),
  tests.n()::text || ',' || tests.f()::text, 'user_id hanya anggota Bersama (roster)');

-- ===== Ruang Pribadi dan akses (Review Focus #4) =====
select is(tests.web_val(tests.n(), format($$select count(*) from api.member_contributions(%L, '2026-01-01', '2026-12-31')$$, :'np')),
  '0', 'Pribadi N oleh N = 0 baris (walau berisi kaki setor x_setor_bersama)');
select is(tests.web_val(tests.f(), format($$select count(*) from api.member_contributions(%L, '2026-01-01', '2026-12-31')$$, :'fp')),
  '0', 'Pribadi F oleh F = 0 baris');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(),
    format($q$select api.member_contributions(%L, '2026-10-01', '2026-10-31')$q$, :'np')),
  'DK404', 'space_not_found', 'Pribadi N oleh F = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.x(),
    format($q$select api.member_contributions(%L, '2026-10-01', '2026-10-31')$q$, :'sh')),
  'DK404', 'space_not_found', 'Bersama oleh Luar = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.x(),
    format($q$select api.member_contributions(%L, '2026-10-31', '2026-10-01')$q$, :'sh')),
  'DK404', 'space_not_found', 'assert_member lebih dulu: Luar dengan periode salah tetap DK404');
select throws_ok(format($$select tests.web_exec(null, %L)$$,
    format($q$select api.member_contributions(%L, '2026-10-01', '2026-10-31')$q$, :'sh')),
  'DK401', 'unauthenticated', 'tanpa konteks = DK401');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format($q$select api.member_contributions(%L, '2026-10-01', '2026-10-31')$q$, gen_random_uuid())),
  'DK404', 'space_not_found', 'ruang tidak dikenal = DK404');

-- ===== Validasi periode (sama dengan period_summary) =====
select is(pg_temp.err(tests.n(), format($q$select api.member_contributions(%L, %s)$q$, :'sh', a)),
  'DK400:invalid_argument:period', 'periode salah = DK400 period: ' || a)
from unnest(array[
  $a$'2026-10-31', '2026-10-01'$a$,
  $a$null, '2026-10-31'$a$,
  $a$'2026-10-01', null$a$,
  $a$'2016-01-01', '2026-01-09'$a$]) a;
select is(pg_temp.err(tests.n(), format($q$select api.member_contributions(%L, '2016-01-01', '2026-01-08')$q$, :'sh')),
  'ok', 'rentang tepat 3660 hari diterima');

select * from finish();
rollback;
