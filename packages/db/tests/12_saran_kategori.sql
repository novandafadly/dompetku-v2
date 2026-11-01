-- Saran kategori S6 (0107): api.suggest_categories (bobot jam/nominal dari selector demo,
-- jendela 30 hari, kamus kata kunci, urutan nama), hanya ruang aktif, DK404/DK400.
-- Jam dipatok 2026-03-20 10:00 WIB (app.today() = 2026-03-20).
begin;
select plan(23);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

create function pg_temp.cat(p_space uuid, p_name text) returns uuid
language sql as $$
  select tests.owner_val(null, format(
    $q$select id from app.categories where space_id = %L and name = %L$q$, p_space, p_name))::uuid
$$;
-- Entri pengeluaran dengan jam dibuat (WIB) tertentu; created_at diatur owner sesudah dibuat.
create function pg_temp.spend(p_acc uuid, p_cat uuid, p_amount bigint, p_on date, p_at timestamptz,
                              p_kind text default 'expense') returns uuid
language plpgsql as $$
declare v uuid;
begin
  v := tests.web_val(tests.n(), format(
    $q$select api.create_entry(gen_random_uuid(), (select space_id from app.accounts where id = %L),
         %L, %L, %s, %L, %L::date) ->> 'entry_id'$q$, p_acc, p_acc, p_kind, p_amount, p_cat, p_on))::uuid;
  perform tests.owner_exec(null, format($q$update app.entries set created_at = %L where id = %L$q$, p_at, v));
  return v;
end $$;
-- Hasil saran sebagai teks "nama:skor:sumber" berurutan.
create function pg_temp.sugg(p_uid uuid, p_sql text) returns text
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select string_agg(c.name || ':' || s.score || ':' || s.source, ',' order by s.ord)
       from (select t.*, row_number() over () as ord from (%s) t) s
       join app.categories c on c.id = s.category_id$q$, p_sql))
$$;

select tests.account(tests.n(), :'np', 'BCA', 'operasional', 10000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 1000000, '2026-01-01') as kas \gset

-- Fixture riwayat Pribadi N (p_hour 12, p_amount 35.000; rentang nominal 17.500..70.000):
-- Makan 3 x (jam 12, 30.000) = 3 x 4,5 = 13,5; Kopi 2 x (jam 13, 20.000) = 9;
-- Transportasi 2 x (jam 8, 25.000) = 2 x 1,5 + 1 x (jam 11, 200.000) = 3 -> 6;
-- Belanja 1 x (jam 12, 500.000) = 3; Hiburan 1 x (jam 20, 50.000) = 1,5;
-- Kesehatan 1 x (jam 2, 1.000) = 1 + 1 x 40 hari lalu (di luar jendela);
-- Cicilan & Tagihan tepat 30 hari lalu (di luar jendela, > today - 30); Langganan dibatalkan;
-- Gaji = pemasukan (jenis lain). Jam 0 vs 23: jarak melingkar 1.
select pg_temp.spend(:'bca', pg_temp.cat(:'np', 'Makan Siang & Minum'), 30000, d::date, d + interval '12 hours 10 minutes')
  from unnest(array['2026-03-18 00:00+07', '2026-03-19 00:00+07', '2026-03-20 00:00+07']::timestamptz[]) d \g /dev/null
select pg_temp.spend(:'bca', pg_temp.cat(:'np', 'Kopi & Camilan'), 20000, d::date, d + interval '13 hours 30 minutes')
  from unnest(array['2026-03-15 00:00+07', '2026-03-16 00:00+07']::timestamptz[]) d \g /dev/null
select pg_temp.spend(:'bca', pg_temp.cat(:'np', 'Transportasi'), 25000, '2026-03-10', '2026-03-10 08:00+07'),
       pg_temp.spend(:'bca', pg_temp.cat(:'np', 'Transportasi'), 25000, '2026-03-11', '2026-03-11 08:00+07'),
       pg_temp.spend(:'bca', pg_temp.cat(:'np', 'Transportasi'), 200000, '2026-03-12', '2026-03-12 11:00+07') \g /dev/null
select pg_temp.spend(:'bca', pg_temp.cat(:'np', 'Belanja'), 500000, '2026-03-05', '2026-03-05 12:00+07') \g /dev/null
select pg_temp.spend(:'bca', pg_temp.cat(:'np', 'Hiburan'), 50000, '2026-03-06', '2026-03-06 20:00+07') \g /dev/null
select pg_temp.spend(:'bca', pg_temp.cat(:'np', 'Kesehatan'), 1000, '2026-03-07', '2026-03-07 02:00+07'),
       pg_temp.spend(:'bca', pg_temp.cat(:'np', 'Kesehatan'), 30000, '2026-02-08', '2026-03-07 12:00+07') \g /dev/null
select pg_temp.spend(:'bca', pg_temp.cat(:'np', 'Cicilan & Tagihan'), 30000, '2026-02-18', '2026-03-19 12:00+07')
  from generate_series(1, 4) \g /dev/null
select pg_temp.spend(:'bca', pg_temp.cat(:'np', 'Langganan'), 30000, '2026-03-19', '2026-03-19 12:00+07') as lang \gset
select tests.web_val(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'lang')) \g /dev/null
select pg_temp.spend(:'bca', pg_temp.cat(:'np', 'Gaji'), 30000, '2026-03-19', '2026-03-19 12:00+07', 'income') \g /dev/null

select is(pg_temp.sugg(tests.n(), format($$select * from api.suggest_categories(%L, 'expense', 12::smallint, 35000, null)$$, :'np')),
  'Makan Siang & Minum:13.5:riwayat,Kopi & Camilan:9:riwayat,Transportasi:6:riwayat,Belanja:3:riwayat,'
  'Hiburan:1.5:riwayat,Kesehatan:1:riwayat',
  'urutan dan skor sama dengan selector demo untuk fixture yang sama');
select is(tests.web_val(tests.n(), format($$select string_agg(category_id::text, ',')
    from api.suggest_categories(%L, 'expense', 12::smallint, 35000, null)$$, :'np')),
  concat_ws(',', pg_temp.cat(:'np', 'Makan Siang & Minum'), pg_temp.cat(:'np', 'Kopi & Camilan'),
            pg_temp.cat(:'np', 'Transportasi'), pg_temp.cat(:'np', 'Belanja'), pg_temp.cat(:'np', 'Hiburan'),
            pg_temp.cat(:'np', 'Kesehatan')),
  'id kategori berurutan: makan, kopi, transport, belanja, hiburan, kesehatan');
select is(pg_temp.sugg(tests.n(), format($$select * from api.suggest_categories(%L, 'expense', 12::smallint, null, null, 9)$$, :'np')),
  'Makan Siang & Minum:9:riwayat,Kopi & Camilan:6:riwayat,Transportasi:5:riwayat,Belanja:3:riwayat,'
  'Hiburan:1:riwayat,Kesehatan:1:riwayat,Cicilan & Tagihan:0:nama,Langganan:0:nama,Perjalanan Dinas:0:nama',
  'tanpa nominal: bobot jam saja; skor sama diurutkan nama; entri batal dan di luar 30 hari tidak dihitung');
select is(pg_temp.sugg(tests.n(), format($$select * from api.suggest_categories(%L, 'expense', 22::smallint, null, null, 3)$$, :'np')),
  'Hiburan:3:riwayat,Makan Siang & Minum:3:riwayat,Transportasi:3:riwayat',
  'jam 22: Hiburan (jam 20) berbobot 3, sisanya 1 per entri; skor sama diurutkan nama');
select is(tests.web_val(tests.n(), format($$select score::text from api.suggest_categories(%L, 'expense', 0::smallint, null, null, 20)
    where category_id = %L$$, :'np', pg_temp.cat(:'np', 'Kesehatan'))), '3',
  'jarak jam melingkar: jam 0 berjarak 2 dari jam 2');
select is(pg_temp.sugg(tests.n(), format($$select * from api.suggest_categories(%L, 'income', 12::smallint)$$, :'np')),
  'Gaji:3:riwayat', 'jenis pemasukan: hanya kategori pemasukan');
select is(pg_temp.sugg(tests.n(), format($$select * from api.suggest_categories(%L, 'expense', 12::smallint, 35000, 'Ngopi sore', 2)$$, :'np')),
  'Kopi & Camilan:14:riwayat,Makan Siang & Minum:13.5:riwayat',
  'kamus menambah 5 pada skor riwayat (Kopi 9 + 5 melewati Makan)');
select is(tests.web_val(tests.n(), format($$select count(*) from api.suggest_categories(%L, 'expense', 12::smallint, 35000, null, 20)$$, :'np')),
  '9', 'p_limit 20: semua kategori pengeluaran aktif ruang ini');

-- ===== Kamus dan urutan nama di ruang tanpa riwayat =====
select is((select split_part(pg_temp.sugg(tests.n(), format($$select * from api.suggest_categories(%L, 'expense', 9::smallint, null, 'bensin motor')$$, :'sh')), ',', 1)),
  'Bensin & Parkir:5:kamus', 'riwayat kosong: kamus menaruh Bensin & Parkir di depan (Bersama)');
select is((select split_part(pg_temp.sugg(tests.n(), format($$select * from api.suggest_categories(%L, 'expense', 9::smallint, null, 'Isi BENSIN')$$, :'np')), ',', 1)),
  'Transportasi:14:riwayat', 'kamus tanpa beda huruf; Pribadi memetakan bensin ke Transportasi (9 + 5)');
select is(pg_temp.sugg(tests.n(), format($$select * from api.suggest_categories(%L, 'expense', 9::smallint, null, 'bensinnya')$$, :'sh')),
  'Belanja Dapur:0:nama,Bensin & Parkir:0:nama,Internet:0:nama,Iuran Lingkungan:0:nama,Listrik & Air:0:nama,Makan di Luar:0:nama',
  'batas kata: "bensinnya" tidak cocok; riwayat kosong + tanpa kamus = urutan nama');
select is(pg_temp.sugg(tests.n(), format($$select * from api.suggest_categories(%L, 'expense', 9::smallint, null, 'bayar air dan listrik', 2)$$, :'sh')),
  'Listrik & Air:5:kamus,Belanja Dapur:0:nama', 'dua kata kunci ke kategori yang sama dihitung sekali');
select is(tests.owner_val(null, $$select count(*) from app.category_keywords() k where not exists (
    select 1 from app.categories c join app.spaces s on s.id = c.space_id
    where c.is_system and s.kind = k.space_kind and c.name = k.category_name)$$), '0',
  'setiap category_name kamus cocok dengan kategori awal ruangnya');
select is(tests.owner_val(null, $$select count(*) from app.category_keywords() k
    where k.keyword !~ '^[a-z]+$'$$), '0', 'kata kunci kamus huruf kecil tanpa simbol regex');

-- ===== Hanya ruang aktif, tanpa kategori terarsip =====
select is(tests.web_val(tests.n(), format($$select count(*) from api.suggest_categories(%L, 'expense', 12::smallint, null, null, 20) s
    join app.categories c on c.id = s.category_id where c.space_id <> %L$$, :'sh', :'sh')), '0',
  'saran Bersama hanya kategori Bersama walau riwayat Pribadi ramai');
select tests.web_val(tests.n(), format($$select api.archive_category(%L)$$, pg_temp.cat(:'np', 'Makan Siang & Minum'))) \g /dev/null
select is((select split_part(pg_temp.sugg(tests.n(), format($$select * from api.suggest_categories(%L, 'expense', 12::smallint, 35000, null)$$, :'np')), ',', 1)),
  'Kopi & Camilan:9:riwayat', 'kategori terarsip tidak disarankan');
select is(tests.web_val(tests.f(), format($$select count(*) from api.suggest_categories(%L, 'expense', 12::smallint, null, null, 20)$$, :'sh')),
  '8', 'pasangan melihat saran Bersama (anggota)');

-- ===== p_hour null = jam app.now() WIB (10.00) =====
select is(tests.web_val(tests.n(), format($$select string_agg(category_id::text, ',') from api.suggest_categories(%L, 'expense')$$, :'np')),
  tests.web_val(tests.n(), format($$select string_agg(category_id::text, ',') from api.suggest_categories(%L, 'expense', 10::smallint)$$, :'np')),
  'p_hour null = jam app.now() WIB');

-- ===== Galat =====
select throws_ok(format($$select tests.web_val(%L, %L)$$, tests.n(), format(
    $q$select count(*) from api.suggest_categories(%L, 'expense')$q$, :'fp')),
  'DK404', 'space_not_found', 'ruang orang lain = DK404');
select throws_ok(format($$select tests.web_val(null, %L)$$, format(
    $q$select count(*) from api.suggest_categories(%L, 'expense')$q$, :'np')),
  'DK401', 'unauthenticated', 'tanpa konteks = DK401');
select throws_ok(format($$select tests.web_val(%L, %L)$$, tests.n(), format(
    $q$select count(*) from api.suggest_categories(%L, 'expense', null, null, null, 0)$q$, :'np')),
  'DK400', 'invalid_argument', 'p_limit 0 ditolak');
select throws_ok(format($$select tests.web_val(%L, %L)$$, tests.n(), format(
    $q$select count(*) from api.suggest_categories(%L, 'expense', null, null, null, 21)$q$, :'np')),
  'DK400', 'invalid_argument', 'p_limit 21 ditolak');
select throws_ok(format($$select tests.web_val(%L, %L)$$, tests.n(), format(
    $q$select count(*) from api.suggest_categories(%L, 'expense', 24::smallint)$q$, :'np')),
  'DK400', 'invalid_argument', 'p_hour 24 ditolak');

select * from finish();
rollback;
