-- Kekayaan bersih S14 (0144; plan S14 Task 6, K5, K10, K13 (f)(g)(h); bingkai S14-NW1, NW2): satu fungsi SQL
-- app.net_worth_at(ruang, tanggal) (INVOKER STABLE ROWS 1) dipakai api.net_worth (Dompet) dan snapshot. Komponen
-- satu per satu: kas (operasional + tabungan + trading), aset (saldo buku dompet aset bukan saham), saham (nilai
-- pasar dari harga ok terakhir <= tanggal; tanpa harga = biaya perolehan), piutang dan utang (sisa per tanggal,
-- Pribadi); Kas Kantor, dompet sistem patungan, dan talangan menunggu reimburse tidak ikut. Nilai per tanggal dari
-- line/trade hidup bertanggal <= tanggal itu. B16: setoran lintas ruang menggeser per ruang, Σ tetap.
-- Snapshot: app.net_worth_snapshots ditulis hanya jobs.net_worth_snapshot() (H−1 + hari kotor, maks 400 hari,
-- idempoten, kembalikan jumlah baris); hari kotor dari trigger di app.entries, app.stock_prices, app.debts
-- (entri susulan, ubah, batal, koreksi harga, utang berjalan) diperbaiki job; tanggal WIB di batas 23:59/00:00;
-- api.net_worth month_ago_total dari snapshot today − 30 (atau sampai 3 hari sebelumnya). DQ08 (warn). Isolasi:
-- snapshot pasangan tidak terbaca, worker hanya lewat jobs.*. statement_timeout worker 60 s cukup untuk backfill
-- 400 hari dengan 6.000 entri dan harga harian dua kode (data demo `full` = 556 entri; ×10 = 5.560).
-- ID: B16, T11
begin;
select plan(103);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 10000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Celengan', 'tabungan', 1000000, '2026-01-01') as tab,
       tests.account(tests.n(), :'np', 'RDN', 'trading', 0, '2026-01-01') as rdn,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 500000, '2026-01-01') as kan,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 1000000, '2026-01-01') as kas,
       tests.account(tests.f(), :'fp', 'Mandiri', 'operasional', 3000000, '2026-01-01') as mdr \gset
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja'$q$, :'np'))
  as belanja \gset

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
create function pg_temp.asset(p_uid uuid, p_space uuid, p_name text, p_kind text, p_opening bigint default 0) returns uuid
language sql as $$
  select (pg_temp.call(p_uid, format($q$select api.create_account(gen_random_uuid(), %L, %L, 'aset', null,
    '2026-01-01', %s, %L)$q$, p_space, p_name, p_opening, p_kind)) ->> 'account_id')::uuid
$$;
create function pg_temp.spend(p_acc uuid, p_amount bigint, p_on date, p_reimb boolean default false) returns uuid
language sql as $$
  select (pg_temp.call(tests.n(), format($q$select api.create_entry(gen_random_uuid(),
      (select space_id from app.accounts where id = %1$L), %1$L, 'expense', %2$s,
      (select c.id from app.categories c join app.accounts a on a.space_id = c.space_id
        where a.id = %1$L and c.name = 'Belanja'), %3$L::date, null, %4$L)$q$,
    p_acc, p_amount, p_on, p_reimb)) ->> 'entry_id')::uuid
$$;
create function pg_temp.xfer(p_uid uuid, p_from uuid, p_to uuid, p_amount bigint, p_on date) returns jsonb
language sql as $$
  select pg_temp.call(p_uid, format($q$select api.create_transfer(gen_random_uuid(),
      (select space_id from app.accounts where id = %1$L), %1$L, %2$L, %3$s, 0, %4$L::date)$q$,
    p_from, p_to, p_amount, p_on))
$$;
-- Komponen kas/aset/saham/tanpa harga/piutang/utang/total/tanggal harga per tanggal (NULL = hari ini), sebagai p_uid.
create function pg_temp.nw(p_space uuid, p_on date default null, p_uid uuid default null) returns text
language sql as $$
  select tests.web_val(coalesce(p_uid, tests.n()), format($q$select concat_ws('/', n.kas, n.aset, n.saham_pasar,
      n.saham_tanpa_harga, n.piutang, n.utang, n.total, coalesce(n.price_as_of::text, '-'))
      from app.net_worth_at(%L, coalesce(%L::date, app.today())) n$q$, p_space, p_on))
$$;
-- Total hari ini dibaca owner (tanpa RLS), untuk Σ antar ruang.
create function pg_temp.tot(p_space uuid) returns bigint
language sql as $$
  select tests.owner_val(null, format($q$select total from app.net_worth_at(%L, app.today())$q$, p_space))::bigint
$$;
create function pg_temp.job() returns int
language sql as $$ select tests.worker_val(null, 'select jobs.net_worth_snapshot()')::int $$;
-- Tanda hari kotor (np/sh/fp:tanggal), dibaca owner.
create function pg_temp.dirty() returns text
language sql as $$
  select tests.owner_val(null, format($q$select coalesce(string_agg(x, ',' order by x collate "C"), '') from (
      select case d.space_id when %L then 'np' when %L then 'sh' when %L then 'fp' else 'x' end || ':' || d.from_date
        from app.nw_dirty d) t (x)$q$,
    tests.space_id(tests.n(), 'personal'), tests.space_id(tests.n(), 'shared'), tests.space_id(tests.f(), 'personal')))
$$;
-- Jumlah snapshot yang berbeda dari app.net_worth_at dihitung ulang.
create function pg_temp.stale() returns int
language sql as $$
  select tests.owner_val(null, $q$select count(*) from app.net_worth_snapshots s
    cross join lateral app.net_worth_at(s.space_id, s.on_date) n
    where (s.kas, s.aset, s.saham_pasar, s.saham_tanpa_harga, s.piutang, s.utang, s.total, s.price_as_of)
          is distinct from (n.kas, n.aset, n.saham_pasar, n.saham_tanpa_harga, n.piutang, n.utang, n.total,
                            n.price_as_of)$q$)::int
$$;
-- Sidik isi snapshot (tanpa computed_at).
create function pg_temp.fp() returns text
language sql as $$
  select tests.owner_val(null, $q$select md5(string_agg(concat_ws('/', s.space_id, s.on_date, s.kas, s.aset,
      s.saham_pasar, s.saham_tanpa_harga, s.piutang, s.utang, s.total, s.price_as_of), ',' order by s.space_id, s.on_date))
    from app.net_worth_snapshots s$q$)
$$;
create function pg_temp.snap(p_space uuid, p_on date) returns text
language sql as $$
  select tests.owner_val(null, format($q$select concat_ws('/', s.kas, s.aset, s.saham_pasar, s.saham_tanpa_harga,
      s.piutang, s.utang, s.total, coalesce(s.price_as_of::text, '-'))
    from app.net_worth_snapshots s where s.space_id = %L and s.on_date = %L$q$, p_space, p_on))
$$;
create function pg_temp.dq08() returns text
language sql as $$
  select tests.worker_val(null, $q$select severity || '=' || violations from jobs.dq_reconcile() where check_id = 'DQ08'$q$)
$$;

-- ===== Skema =====
select has_table('app', 'net_worth_snapshots', 'tabel app.net_worth_snapshots ada');
select has_table('app', 'nw_dirty', 'tabel app.nw_dirty ada');
select is((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
           from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname = 'net_worth_snapshots' and a.attnum > 0 and not a.attisdropped),
  'space_id:uuid,on_date:date,kas:bigint,aset:bigint,saham_pasar:bigint,saham_tanpa_harga:integer,piutang:bigint,utang:bigint,total:bigint,price_as_of:date,computed_at:timestamp with time zone',
  'kolom snapshot = komponen app.net_worth_at + computed_at');
select ok((select bool_and(c.relrowsecurity and c.relforcerowsecurity) and count(*) = 2
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname in ('net_worth_snapshots', 'nw_dirty')),
  'RLS ENABLE + FORCE di snapshot dan tanda hari kotor');
select is((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.proname = 'net_worth_at'),
  'TABLE(kas bigint, aset bigint, saham_pasar bigint, saham_tanpa_harga integer, piutang bigint, utang bigint, total bigint, price_as_of date)',
  'kolom app.net_worth_at (K5)');
select ok((select not p.prosecdef and p.provolatile = 's' and p.prorows = 1 and p.proowner = 'dompetku_owner'::regrole
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.proname = 'net_worth_at'),
  'app.net_worth_at INVOKER STABLE ROWS 1 milik owner');
select is((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname = 'net_worth'),
  'TABLE(kas bigint, aset bigint, saham_pasar bigint, saham_tanpa_harga integer, piutang bigint, utang bigint, total bigint, price_as_of date, month_ago_total bigint, month_ago_on date)',
  'kolom api.net_worth (bingkai S14-NW1 + tanggal pembanding)');
select ok((select p.prosecdef and p.proowner = 'dompetku_owner'::regrole and pg_get_function_result(p.oid) = 'integer'
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'jobs' and p.proname = 'net_worth_snapshot'),
  'jobs.net_worth_snapshot DEFINER milik owner, kembalikan jumlah baris');
select has_trigger('app', 'entries', 'nw_dirty', 'trigger hari kotor di app.entries');
select has_trigger('app', 'stock_prices', 'nw_dirty', 'trigger hari kotor di app.stock_prices');
select has_trigger('app', 'debts', 'nw_dirty', 'trigger hari kotor di app.debts');

-- ===== Komponen satu per satu (Pribadi Novanda, hari ini 2026-03-20) =====
select pg_temp.asset(tests.n(), :'np', 'Emas Antam', 'emas', 2000000) as emas,
       pg_temp.asset(tests.n(), :'np', 'Sekuritas', 'saham') as sah,
       pg_temp.asset(tests.n(), :'sh', 'Rumah', 'properti') as rumah \gset
select is(pg_temp.nw(:'np'), '11000000/2000000/0/0/0/0/13000000/-',
  'kas = operasional + tabungan + trading, aset = saldo buku emas, Kas Kantor tidak ikut [T11]');
select pg_temp.xfer(tests.n(), :'bca', :'rdn', 5000000, '2026-03-01');
select pg_temp.call(tests.n(), format($$select api.buy_stock(gen_random_uuid(), %L, 'BBCA', 200, 9000, 1000, %L,
  '2026-03-02')$$, :'sah', :'rdn'));
select is(pg_temp.nw(:'np'), '9199000/2000000/1801000/1/0/0/13000000/-',
  'beli saham tanpa harga: saham = biaya perolehan, satu kode tanpa harga, total tetap [T11]');
select pg_temp.call(tests.n(), format($$select api.set_stock_price(gen_random_uuid(), %L, 'BBCA', '2026-03-10', 9500)$$,
  :'np'));
select is(pg_temp.nw(:'np'), '9199000/2000000/1900000/0/0/0/13099000/2026-03-10',
  'harga ok: saham = lembar × harga, tanggal harga dikembalikan [T11]');
select pg_temp.call(tests.n(), format($$select api.open_stock_holding(gen_random_uuid(), %L, 'TLKM', 100, 3000,
  '2026-02-02')$$, :'sah'));
select is(pg_temp.nw(:'np'), '9199000/2000000/2200000/1/0/0/13399000/2026-03-10',
  'saham berjalan tanpa harga dinilai biaya, kas tidak bergeser');
select pg_temp.call(tests.n(), format($$select api.set_stock_price(gen_random_uuid(), %L, 'TLKM', '2026-03-09', 3200)$$,
  :'np'));
select is(pg_temp.nw(:'np'), '9199000/2000000/2220000/0/0/0/13419000/2026-03-09',
  'price_as_of = tanggal harga tertua yang dipakai');
select pg_temp.call(tests.n(), format($$select api.create_debt(gen_random_uuid(), %L, 'lent', 400000, 'baru',
  p_contact_name => 'Andi', p_account_id => %L, p_opened_on => '2026-03-05')$$, :'np', :'bca'));
select is(pg_temp.nw(:'np'), '8799000/2000000/2220000/0/400000/0/13419000/2026-03-09',
  'piutang baru: kas turun, piutang naik, total tetap');
select pg_temp.call(tests.n(), format($$select api.create_debt(gen_random_uuid(), %L, 'borrowed', 1000000, 'berjalan',
  p_contact_name => 'Budi', p_opened_on => '2026-02-15')$$, :'np')) ->> 'debt_id' as budi \gset
select is(pg_temp.nw(:'np'), '8799000/2000000/2220000/0/400000/1000000/12419000/2026-03-09',
  'utang berjalan: utang naik tanpa efek kas, total turun');
select pg_temp.call(tests.n(), format($$select api.pay_debt(gen_random_uuid(), %L, %L, 250000, '2026-03-12')$$,
  :'budi', :'bca'));
select is(pg_temp.nw(:'np'), '8549000/2000000/2220000/0/400000/750000/12419000/2026-03-09',
  'cicilan utang: kas dan utang turun bersama, total tetap');
select pg_temp.spend(:'bca', 50000, '2026-03-18', true);
select is(pg_temp.nw(:'np'), '8499000/2000000/2220000/0/400000/750000/12369000/2026-03-09',
  'talangan menunggu reimburse tidak ikut (bukan piutang)');
select pg_temp.xfer(tests.n(), :'bca', :'kan', 100000, '2026-03-18');
select is(pg_temp.nw(:'np'), '8399000/2000000/2220000/0/400000/750000/12269000/2026-03-09',
  'setor ke Kas Kantor menurunkan kekayaan bersih (Kantor tidak ikut)');
select pg_temp.call(tests.n(), format($$select api.revalue_asset(gen_random_uuid(), %L, 2500000, '2026-03-15')$$, :'emas'));
select is(pg_temp.nw(:'np'), '8399000/2500000/2220000/0/400000/750000/12769000/2026-03-09',
  'perubahan nilai aset hanya menggeser komponen aset [T11]');

-- ===== Per tanggal (line/trade/utang hidup <= tanggal, harga ok terakhir <= tanggal) =====
select is(pg_temp.nw(:'np', '2025-12-31'), '0/0/0/0/0/0/0/-', 'sebelum saldo awal: semua nol');
select is(pg_temp.nw(:'np', '2026-02-01'), '11000000/2000000/0/0/0/0/13000000/-', '1 Feb: saldo awal saja');
select is(pg_temp.nw(:'np', '2026-02-20'), '11000000/2000000/300000/1/0/1000000/12300000/-',
  '20 Feb: saham berjalan (biaya) dan utang berjalan sudah ada');
select is(pg_temp.nw(:'np', '2026-03-09'), '8799000/2000000/2121000/1/400000/1000000/12320000/2026-03-09',
  '9 Mar: BBCA belum berharga (biaya), TLKM berharga 9 Mar, piutang 5 Mar, cicilan 12 Mar belum');
select is(pg_temp.nw(:'np', '2026-03-12'), '8549000/2000000/2220000/0/400000/750000/12419000/2026-03-09',
  '12 Mar: harga BBCA 10 Mar dipakai, cicilan masuk');

-- ===== Bersama: patungan tidak ikut; isolasi fungsi =====
-- Farida membayar tagihan Bersama dari Pribadinya (patungan); dompet sistem patungan Bersama berisi bagian Novanda.
select pg_temp.call(tests.f(), format($$select api.create_split(gen_random_uuid(), %L, %L, 300000, null,
  '2026-03-10', 'Listrik')$$, :'sh', :'mdr'));
-- Novanda melunasi bagiannya; dompet sistem menampung pelunasan yang belum diterima Farida.
select pg_temp.call(tests.n(), format($$select api.settle_split(gen_random_uuid(), %L, %L, 150000, '2026-03-19')$$,
  :'sh', :'bca'));
select tests.owner_val(null, $$select id from app.accounts where pocket = 'patungan'$$) as pat \gset
select ok(tests.balance(:'pat') <> 0, 'dompet sistem patungan berisi (prasyarat)');
select is(pg_temp.nw(:'sh'), concat_ws('/', tests.balance(:'kas'), 0, 0, 0, 0, 0, tests.balance(:'kas'), '-'),
  'Bersama: kas = dompet operasional, dompet sistem patungan tidak ikut');
select is(pg_temp.nw(:'sh', null, tests.f()), pg_temp.nw(:'sh'), 'Farida membaca kekayaan Bersama yang sama');
select is(pg_temp.nw(:'np', null, tests.f()), '0/0/0/0/0/0/0/-',
  'app.net_worth_at ruang Pribadi pasangan = nol (RLS, tanpa orakel nominal)');

-- ===== B16: setoran lintas ruang menggeser per ruang, Σ tetap =====
select pg_temp.tot(:'np') as np0, pg_temp.tot(:'sh') as sh0, pg_temp.tot(:'fp') as fp0 \gset
select pg_temp.xfer(tests.n(), :'bca', :'rumah', 300000, '2026-03-16');
select is(pg_temp.tot(:'np') - :np0, -300000::bigint, 'B16: Pribadi Novanda turun sebesar setoran ke aset Bersama [B16]');
select is(pg_temp.tot(:'sh') - :sh0, 300000::bigint, 'B16: Bersama naik sebesar setoran [B16]');
select pg_temp.xfer(tests.f(), :'rumah', :'mdr', 100000, '2026-03-17');
select is(pg_temp.tot(:'sh') - :sh0, 200000::bigint, 'B16: Farida mencairkan aset Bersama ke Pribadinya [B16]');
select is(pg_temp.tot(:'np') + pg_temp.tot(:'sh') + pg_temp.tot(:'fp'), (:np0 + :sh0 + :fp0)::bigint,
  'B16: Σ kekayaan bersih ketiga ruang tetap [B16]');
select is(pg_temp.nw(:'sh'), concat_ws('/', tests.balance(:'kas'), 200000, 0, 0, 0, 0, tests.balance(:'kas') + 200000, '-'),
  'Bersama: aset Bersama ikut komponen aset (K2)');

-- ===== api.net_worth =====
select is(tests.web_val(tests.n(), format($$select concat_ws('/', w.kas, w.aset, w.saham_pasar, w.saham_tanpa_harga,
    w.piutang, w.utang, w.total, w.price_as_of, coalesce(w.month_ago_total::text, '-'), coalesce(w.month_ago_on::text, '-'))
    from api.net_worth(%L) w$$, :'np')),
  '7949000/2500000/2220000/0/400000/750000/12319000/2026-03-09/-/-',
  'api.net_worth = app.net_worth_at hari ini; tanpa snapshot month_ago NULL');
select throws_ok(format($$select tests.web_val(tests.f(), %L)$$, format('select total from api.net_worth(%L)', :'np')),
  'DK404', 'space_not_found', 'api.net_worth Pribadi pasangan = DK404 seragam');
select throws_ok(format($$select tests.web_val(tests.x(), %L)$$, format('select total from api.net_worth(%L)', :'sh')),
  'DK404', 'space_not_found', 'api.net_worth bukan anggota = DK404');

-- ===== Snapshot: job pertama (backfill dari tanda hari kotor) =====
select is(pg_temp.dirty(), 'fp:2026-01-01,np:2026-01-01,sh:2026-01-01', 'entri bertanggal lampau menandai hari kotor per ruang');
select is(pg_temp.job(), 234, 'job pertama: 1 Jan sampai 19 Mar (78 hari) × 3 ruang');
select is(pg_temp.dirty(), '', 'tanda hari kotor kosong sesudah job');
select is(pg_temp.stale(), 0, 'setiap snapshot = app.net_worth_at dihitung ulang [T11]');
select is(tests.owner_val(null, 'select min(on_date) || ''/'' || max(on_date) from app.net_worth_snapshots'),
  '2026-01-01/2026-03-19', 'snapshot sampai H−1 (19 Mar), bukan hari ini');
select is(pg_temp.snap(:'np', '2026-03-09'), '8799000/2000000/2121000/1/400000/1000000/12320000/2026-03-09',
  'snapshot 9 Mar sama dengan fungsi per tanggal');
select pg_temp.fp() as fp1 \gset
select is(pg_temp.job(), 3, 'job kedua tanpa hari kotor: hanya H−1 per ruang');
select is(pg_temp.fp(), :'fp1', 'job dua kali = isi snapshot sama (idempoten)');
select is(tests.web_val(tests.n(), format($$select w.month_ago_total || '/' || w.month_ago_on from api.net_worth(%L) w$$, :'np')),
  '12300000/2026-02-18', 'month_ago_total = snapshot today − 30 (18 Feb)');

-- ===== Hari kotor: entri susulan, ubah, batal, entri hari ini, koreksi harga, utang berjalan =====
select pg_temp.spend(:'bca', 100000, '2026-03-05') as late \gset
select is(pg_temp.dirty(), 'np:2026-03-05', 'entri susulan menandai ruangnya dari tanggal entri');
select is(pg_temp.stale(), 15, 'snapshot 5..19 Mar Pribadi usang sebelum job');
select is(pg_temp.dq08(), 'warn=0', 'DQ08 tidak menghitung ruang yang masih bertanda hari kotor');
select is(pg_temp.job(), 17, 'job: 15 hari Pribadi + H−1 dua ruang lain');
select is(pg_temp.stale() || '/' || pg_temp.dirty(), '0/', 'entri susulan: snapshot diperbaiki, tanda kosong');
select pg_temp.call(tests.n(), format($$select api.update_entry(gen_random_uuid(), %L,
  (select version from app.entries where id = %L), %L, 120000, %L, '2026-03-07', null, false)$$,
  :'late', :'late', :'bca', :'belanja'));
select is(pg_temp.dirty(), 'np:2026-03-05', 'ubah nominal dan tanggal: tanda dari tanggal lama (yang lebih awal)');
select is(pg_temp.job(), 17, 'job sesudah ubah');
select is(pg_temp.stale(), 0, 'ubah entri: snapshot diperbaiki');
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L,
  (select version from app.entries where id = %L))$$, :'late', :'late'));
select is(pg_temp.dirty(), 'np:2026-03-07', 'batal entri menandai tanggal entri');
select is(pg_temp.job(), 15, 'job sesudah batal: 7..19 Mar + 2');
select is(pg_temp.stale(), 0, 'batal entri: snapshot diperbaiki');
select pg_temp.spend(:'bca', 10000, '2026-03-20');
select is(pg_temp.dirty(), '', 'entri bertanggal hari ini tidak menandai (snapshot hari ini belum ada)');
select pg_temp.call(tests.n(), format($$select api.set_stock_price(gen_random_uuid(), %L, 'BBCA', '2026-03-12', 9800)$$,
  :'np'));
select is(pg_temp.dirty(), 'np:2026-03-12', 'koreksi harga lampau menandai ruang pemegang');
select is(pg_temp.job(), 10, 'job sesudah koreksi harga: 12..19 Mar + 2');
select is(pg_temp.snap(:'np', '2026-03-12'), '8549000/2000000/2280000/0/400000/750000/12479000/2026-03-09',
  'snapshot 12 Mar memakai harga koreksi');
select is(pg_temp.stale(), 0, 'koreksi harga: snapshot diperbaiki');
select pg_temp.call(tests.n(), format($$select api.create_debt(gen_random_uuid(), %L, 'borrowed', 500000, 'berjalan',
  p_contact_name => 'Citra', p_opened_on => '2026-02-01')$$, :'np')) ->> 'debt_id' as citra \gset
select is(pg_temp.dirty(), 'np:2026-02-01', 'utang berjalan bertanggal lampau (tanpa entri) menandai ruang');
select is(pg_temp.job(), 49, 'job sesudah utang berjalan: 1 Feb..19 Mar (47 hari) + 2');
select is(pg_temp.stale(), 0, 'utang berjalan: snapshot diperbaiki');
select pg_temp.call(tests.n(), format($$select api.void_debt(gen_random_uuid(), %L)$$, :'citra'));
select is(pg_temp.dirty(), 'np:2026-02-01', 'batal utang berjalan menandai tanggal mulai');
select is(pg_temp.job(), 49, 'job sesudah batal utang');
select is(pg_temp.stale(), 0, 'batal utang: snapshot diperbaiki');

-- ===== month_ago: terdekat sebelum today − 30, maks 3 hari =====
select tests.owner_exec(null, format($$delete from app.net_worth_snapshots where space_id = %L
  and on_date in ('2026-02-18', '2026-02-17')$$, :'np'));
select is(tests.web_val(tests.n(), format($$select w.month_ago_total || '/' || w.month_ago_on from api.net_worth(%L) w$$, :'np')),
  '12300000/2026-02-16', 'snapshot 18 Feb tidak ada: pakai 16 Feb (dalam 3 hari)');
select tests.owner_exec(null, format($$delete from app.net_worth_snapshots where space_id = %L
  and on_date in ('2026-02-16', '2026-02-15')$$, :'np'));
select is(tests.web_val(tests.n(), format($$select coalesce(w.month_ago_total::text, '-') || '/'
    || coalesce(w.month_ago_on::text, '-') from api.net_worth(%L) w$$, :'np')),
  '-/-', 'tidak ada snapshot 15..18 Feb: month_ago NULL');
select tests.owner_exec(null, format($$insert into app.nw_dirty values (%L, '2026-02-15')$$, :'np'));
select is(pg_temp.job(), 35, 'tanda manual 15 Feb: job mengisi ulang 15 Feb..19 Mar (33 hari) + 2');

-- ===== DQ08 =====
select is(tests.worker_val(null, $$select string_agg(check_id || ':' || severity, ',' order by check_id)
    from jobs.dq_reconcile() where check_id in ('DQ07', 'DQ08', 'DQ09')$$),
  'DQ07:warn,DQ08:warn,DQ09:error', 'DQ08 terdaftar sebagai warn');
select is(pg_temp.dq08(), 'warn=0', 'DQ08 nol sesudah job');
select tests.raw_exec(format($$update app.net_worth_snapshots set total = total + 1 where space_id = %L
  and on_date in ('2026-03-19', '2026-03-10')$$, :'np'));
select is(pg_temp.dq08(), 'warn=1', 'DQ08: snapshot H−1 yang berbeda dari fungsi terhitung (hanya H−1)');
select tests.owner_exec(null, format($$insert into app.nw_dirty values (%L, '2026-03-10')$$, :'np'));
select is(pg_temp.dq08(), 'warn=0', 'DQ08: ruang yang menunggu job tidak dihitung');
select pg_temp.job();
select is(pg_temp.stale() || '/' || pg_temp.dq08(), '0/warn=0', 'job memperbaiki snapshot rusak');

-- ===== Isolasi dan hak =====
select is(tests.web_val(tests.f(), format($$select count(*) from app.net_worth_snapshots where space_id = %L$$, :'np')), '0',
  'snapshot Pribadi pasangan tidak terbaca');
select is(tests.web_val(tests.f(), format($$select count(*) > 0 from app.net_worth_snapshots where space_id = %L$$, :'sh')),
  'true', 'snapshot Bersama terbaca anggota');
select is(tests.web_val(tests.n(), format($$select count(*) from app.net_worth_snapshots where space_id = %L$$, :'fp')), '0',
  'snapshot Pribadi Farida tidak terbaca Novanda');
select throws_ok(format($$select tests.web_exec(tests.n(), %L)$$, format($q$insert into app.net_worth_snapshots
    (space_id, on_date, kas, aset, saham_pasar, saham_tanpa_harga, piutang, utang, total, computed_at)
    values (%L, '2025-01-01', 0, 0, 0, 0, 0, 0, 0, now())$q$, :'np')), '42501', null, 'web tidak bisa menulis snapshot');
select throws_ok($$select tests.web_val(tests.n(), 'select count(*) from app.nw_dirty')$$, '42501', null,
  'web tidak bisa membaca tanda hari kotor');
select throws_ok($$select tests.web_val(tests.n(), 'select jobs.net_worth_snapshot()')$$, '42501', null,
  'web tidak bisa menjalankan job snapshot');
select throws_ok($$select tests.worker_val(null, 'select count(*) from app.net_worth_snapshots')$$, '42501', null,
  'worker tidak bisa membaca snapshot langsung');
select throws_ok($$select tests.worker_val(null, 'select count(*) from app.entries')$$, '42501', null,
  'worker tidak bisa membaca entri');
select throws_ok(format($$select tests.worker_val(null, %L)$$,
  format($q$select total from app.net_worth_at(%L, '2026-03-01')$q$, :'np')), '42501', null, 'worker tidak bisa memanggil app.net_worth_at (hanya lewat jobs.*)');

-- ===== Tanggal WIB di batas 23:59/00:00 =====
select tests.clock_at('2026-03-20 23:59:59+07');
select pg_temp.spend(:'bca', 20000, '2026-03-20');
select is(pg_temp.dirty(), '', '23:59:59 WIB: entri hari ini (20 Mar) tidak menandai');
select is(pg_temp.job(), 3, '23:59:59 WIB: H−1 = 19 Mar');
select is(tests.owner_val(null, 'select max(on_date)::text from app.net_worth_snapshots'), '2026-03-19',
  '23:59:59 WIB: belum ada snapshot 20 Mar');
select tests.clock_at('2026-03-21 00:00:00+07');
select is(pg_temp.job(), 3, '00:00 WIB: H−1 = 20 Mar');
select is(tests.owner_val(null, 'select max(on_date)::text from app.net_worth_snapshots'), '2026-03-20',
  '00:00 WIB: snapshot 20 Mar ditulis (termasuk entri 23:59)');
select is(pg_temp.stale(), 0, 'snapshot 20 Mar = fungsi');
select pg_temp.spend(:'bca', 5000, '2026-03-20');
select is(pg_temp.dirty(), 'np:2026-03-20', '00:00 WIB: entri bertanggal 20 Mar kini lampau dan menandai');

-- ===== Batas 400 hari =====
select tests.clock_at('2027-06-01 10:00+07');
select tests.owner_exec(null, format($$insert into app.nw_dirty values (%L, '2026-01-01')
  on conflict (space_id) do update set from_date = excluded.from_date$$, :'np'));
select is(pg_temp.job(), 1200, 'tanda 1 Jan 2026 dipotong ke 400 hari (27 Apr 2026..31 Mei 2027); ruang lain mengisi malam terlewat, juga 400 hari');
select is(tests.owner_val(null, format($$select min(on_date)::text from app.net_worth_snapshots where space_id = %L
  and computed_at = app.now()$$, :'np')), '2026-04-27', 'tanggal tertua yang dihitung = hari ini − 400');
select is(pg_temp.dirty(), '', 'tanda dikosongkan walau lebih tua dari 400 hari');

-- ===== statement_timeout worker 60 s: backfill 400 hari dengan data besar =====
select tests.raw_exec(format($$with e as (
    insert into app.entries (space_id, space_kind, kind, occurred_on, created_by, updated_by)
    select %1$L, 'personal', 'expense', date '2026-04-27' + (g %% 400), %3$L, %3$L from generate_series(1, 4500) g
    returning id)
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount) select e.id, %1$L, 'main', %2$L, -1000 from e$$,
  :'np', :'bca', tests.n()));
select tests.raw_exec(format($$with e as (
    insert into app.entries (space_id, space_kind, kind, occurred_on, created_by, updated_by)
    select %1$L, 'shared', 'expense', date '2026-04-27' + (g %% 400), %3$L, %3$L from generate_series(1, 1500) g
    returning id)
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount) select e.id, %1$L, 'main', %2$L, -1000 from e$$,
  :'sh', :'kas', tests.n()));
select tests.raw_exec(format($$insert into app.stock_prices (space_id, ticker, on_date, close, source, status)
  select %L, t, date '2026-04-27' + g, 9000 + g, 'provider', 'ok' from generate_series(0, 399) g, unnest(array['BBCA', 'TLKM']) t$$,
  :'np'));
select tests.owner_exec(null, format($$insert into app.nw_dirty select s, '2026-01-01'::date from unnest(array[%L, %L, %L]::uuid[]) s
  on conflict (space_id) do update set from_date = excluded.from_date$$, :'np', :'sh', :'fp'));
-- Statistik segar (di produksi autovacuum/analyze yang melakukannya): tanpa ini perencana menaksir tabel hampir
-- kosong sesudah suite penuh dan memilih rencana lambat (>60 s) yang tidak mewakili produksi.
select tests.raw_exec('analyze app.entries, app.entry_lines, app.stock_prices, app.stock_trades, app.accounts');
select set_config('statement_timeout', '60s', true);
select clock_timestamp() as t0 \gset
select is(pg_temp.job(), 1200, 'backfill 400 hari × 3 ruang selesai di bawah statement_timeout 60 s');
select diag('backfill: ' || (clock_timestamp() - :'t0'::timestamptz)::text);
select set_config('statement_timeout', '0', true);
select is(tests.owner_val(null, format($$select count(*) from app.net_worth_snapshots s
    cross join lateral app.net_worth_at(s.space_id, s.on_date) n
    where s.space_id = %L and s.on_date in ('2026-04-27', '2026-12-31', '2027-05-31') and s.total = n.total$$, :'np')),
  '3', 'snapshot backfill = fungsi (sampel)');

-- ===== Malam yang terlewat diisi ulang (worker mati beberapa malam) =====
select tests.clock_at('2027-06-05 10:00+07');
select is(pg_temp.job(), 12, 'tiga ruang × empat malam terlewat (1..4 Jun 2027) terisi ulang');
select is(tests.owner_val(null, format($$select count(*) from app.net_worth_snapshots where space_id = %L
    and on_date between '2027-06-01' and '2027-06-04'$$, :'np')), '4', 'tidak ada lubang di riwayat snapshot');

-- ===== Nilai pasar dibatasi 10^13 per kode (sama dengan stock_overview/asset_overview, 0143) =====
select pg_temp.call(tests.n(), format($$select api.open_stock_holding(gen_random_uuid(), %L, 'GOTO', 10000000000000, 1,
  '2027-05-01')$$, :'sah'));
select pg_temp.call(tests.n(), format($$select api.set_stock_price(gen_random_uuid(), %L, 'GOTO', '2027-06-03', 1000000000)$$,
  :'np'));
select is(tests.web_val(tests.n(), format($$select (n.saham_pasar >= 10000000000000)::text from api.net_worth(%L) n$$, :'np')),
  'true', 'api.net_worth tidak galat overflow: nilai pasar kode dibatasi 10^13');
select lives_ok($$select pg_temp.job()$$, 'jobs.net_worth_snapshot tidak galat overflow');

select * from finish();
rollback;
