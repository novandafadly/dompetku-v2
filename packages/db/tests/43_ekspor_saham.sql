-- Ekspor + saham/aset S14 (0145; plan S14 Task 11, K6, K11; bingkai S14-AS7): api.export_entries memuat Catatan
-- trade saham (kode, lembar, harga per lembar; jual dua kaki: transfer + valuasi untung/rugi), saham berjalan, dan
-- perubahan nilai aset, tanpa mengubah jumlah baris, Σ kelas, atau urutan (satu baris per kaki entri hidup).
-- Σ pemasukan/pengeluaran CSV = Laporan (month_summary) dan Σ kelas x_* per arah = excluded_summary dengan aset
-- dan saham [I6]; trade batal tidak ikut dan kembali sesudah dipulihkan; Bersama tidak pernah memuat trade [B13].
-- Jam dipatok 2026-03-20 WIB (Jumat, cuti bersama).
-- ID: T11, I6, B13
begin;
select plan(11);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 100000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 1000000, '2026-01-01') as kas \gset
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja'$q$, :'np'))
  as belanja \gset

create function pg_temp.call(p_sql text) returns jsonb
language sql as $$ select tests.web_val(tests.n(), p_sql)::jsonb $$;
create function pg_temp.asset(p_space uuid, p_name text, p_kind text) returns uuid
language sql as $$
  select (pg_temp.call(format($q$select api.create_account(gen_random_uuid(), %L, %L, 'aset', null,
    '2026-01-01', 0, %L)$q$, p_space, p_name, p_kind)) ->> 'account_id')::uuid
$$;
-- Ekspresi agregat atas api.export_entries (alias x) rentang Maret 2026.
create function pg_temp.exp(p_space uuid, p_expr text) returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select %s from api.export_entries(%L, '2026-03-01', '2026-03-31') x$q$, p_expr, p_space))
$$;
-- Baris ekspor (tanggal:kind:kelas:dompet:nominal:catatan) yang memenuhi syarat.
create function pg_temp.rows(p_space uuid, p_where text) returns text
language sql as $$
  select pg_temp.exp(p_space, format($q$string_agg(x.occurred_on || ':' || x.kind || ':' || x.report_class || ':' || x.account || ':'
      || x.amount || ':' || coalesce(x.note, '-'), ' | ' order by x.occurred_on, x.amount, x.kind) filter (where %s)$q$, p_where))
$$;
-- Σ kelas x_*: kelas:arah:jumlah mutlak dari ekspor (harus sama dengan excluded_summary).
create function pg_temp.x_export(p_space uuid) returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select string_agg(q.c || ':' || q.d || ':' || q.s, ',' order by q.c, q.d) from (
      select y.report_class as c, case when y.amount > 0 then 'in' else 'out' end as d, sum(abs(y.amount)) as s
        from api.export_entries(%L, '2026-03-01', '2026-03-31') y where y.report_class like 'x\_%%' group by 1, 2) q$q$, p_space))
$$;
create function pg_temp.x_laporan(p_space uuid) returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select string_agg(e.report_class || ':' || e.direction || ':' || e.amount, ',' order by e.report_class, e.direction)
    from api.excluded_summary(%L, '2026-03-01', '2026-03-31') e$q$, p_space))
$$;

select pg_temp.asset(:'np', 'Sekuritas', 'saham') as sek, pg_temp.asset(:'np', 'Emas', 'emas') as emas \gset
select pg_temp.call(format($q$select api.buy_stock(gen_random_uuid(), %L, 'BBCA', 200, 9150, 0, %L, '2026-03-02')$q$, :'sek', :'bca'))
  ->> 'trade_id' as b1 \gset
select pg_temp.call(format($q$select api.sell_stock(gen_random_uuid(), %L, 'BBCA', 100, 9800, 0, 0, %L, '2026-03-05')$q$, :'sek', :'bca'))
  ->> 'trade_id' as s1 \gset
select pg_temp.call(format($q$select api.sell_stock(gen_random_uuid(), %L, 'BBCA', 50, 8000, 0, 0, %L, '2026-03-06')$q$, :'sek', :'bca'))
  ->> 'trade_id' as s2 \gset
select pg_temp.call(format($q$select api.open_stock_holding(gen_random_uuid(), %L, 'TLKM', 300, 1500, '2026-03-04')$q$, :'sek'))
  ->> 'trade_id' as o1 \gset
select pg_temp.call(format($q$select api.revalue_asset(gen_random_uuid(), %L, 5000000, '2026-03-07')$q$, :'emas')) is not null as x \gset
select pg_temp.call(format($q$select api.revalue_asset(gen_random_uuid(), %L, 4000000, '2026-03-08')$q$, :'emas')) is not null as x \gset
select pg_temp.call(format($q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 45000, %L, '2026-03-09', 'Belanja')$q$,
  :'np', :'bca', :'belanja')) is not null as x \gset

-- ===== Catatan trade (kode, lembar, harga per lembar dengan titik ribuan) =====
select is(pg_temp.rows(:'np', $$x.account = 'BCA' and x.kind = 'transfer'$$),
  '2026-03-02:transfer:x_transfer:BCA:-1830000:Beli BBCA 200 lembar @ 9.150'
  || ' | 2026-03-05:transfer:x_transfer:BCA:980000:Jual BBCA 100 lembar @ 9.800'
  || ' | 2026-03-06:transfer:x_transfer:BCA:400000:Jual BBCA 50 lembar @ 8.000',
  'beli dan jual: Catatan memuat kode, lembar, harga per lembar (kaki dompet kas)');
select is(pg_temp.rows(:'np', $$x.kind = 'valuation' and x.account = 'Sekuritas'$$),
  '2026-03-05:valuation:x_valuasi:Sekuritas:65000:Untung jual BBCA 100 lembar @ 9.800'
  || ' | 2026-03-06:valuation:x_valuasi:Sekuritas:-57500:Rugi jual BBCA 50 lembar @ 8.000',
  'jual: kaki valuasi berkelas x_valuasi, Untung/Rugi menurut tanda, nominal bertanda minus');
select is(pg_temp.rows(:'np', $$x.kind = 'opening_balance' and x.account = 'Sekuritas'$$),
  '2026-03-04:opening_balance:x_koreksi:Sekuritas:450000:TLKM 300 lembar @ 1.500 (sudah dimiliki)',
  'saham berjalan: kode, lembar, harga, penanda sudah dimiliki');
select is(pg_temp.rows(:'np', $$x.account = 'Emas'$$),
  '2026-03-07:valuation:x_valuasi:Emas:5000000:Perubahan nilai | 2026-03-08:valuation:x_valuasi:Emas:-1000000:Perubahan nilai',
  'aset non-saham: kind valuation, kelas x_valuasi, Catatan Perubahan nilai');
select is(pg_temp.exp(:'np', $$count(*) filter (where x.account = 'Sekuritas' and x.kind = 'transfer')$$), '3',
  'kaki dompet saham pada beli dan dua jual tetap satu baris per kaki (jumlah baris tidak berubah)');

-- ===== Σ CSV = Laporan dengan aset dan saham (I6) =====
select is(pg_temp.exp(:'np', $$-coalesce(sum(x.amount) filter (where x.report_class in ('expense', 'expense_fee')), 0)$$),
  tests.web_val(tests.n(), format($q$select pengeluaran from api.month_summary(%L, '2026-03-01')$q$, :'np')),
  'Σ pengeluaran ekspor = Laporan bulan ini; trade dan valuasi bukan pengeluaran [I6]');
select is(pg_temp.exp(:'np', $$coalesce(sum(x.amount) filter (where x.report_class = 'income'), 0)$$),
  tests.web_val(tests.n(), format($q$select pemasukan from api.month_summary(%L, '2026-03-01')$q$, :'np')),
  'Σ pemasukan ekspor = Laporan bulan ini [I6]');
select is(pg_temp.x_export(:'np'), pg_temp.x_laporan(:'np'),
  'Σ kelas x_* per arah (x_valuasi, x_transfer, x_koreksi) = Tidak termasuk Laporan, dengan aset dan saham [I6]');

-- ===== Trade batal tidak ikut dan kembali sesudah dipulihkan =====
select pg_temp.call(format($q$select api.void_stock_trade(gen_random_uuid(), %L)$q$, :'s2')) is not null as x \gset
select is(pg_temp.exp(:'np', $$count(*) filter (where x.note like '%8.000%')$$), '0', 'trade batal tidak ikut ekspor');
select pg_temp.call(format($q$select api.restore_stock_trade(gen_random_uuid(), %L)$q$, :'s2')) is not null as x \gset
select is(pg_temp.exp(:'np', $$count(*) filter (where x.note like '%8.000%')$$), '3', 'trade dipulihkan: kaki transfer (dua dompet) dan valuasi kembali');

-- ===== Bersama tanpa trade =====
select is(pg_temp.exp(:'sh', $$count(*) filter (where x.note ~ 'BBCA|TLKM|lembar' or x.account in ('Sekuritas', 'Emas', 'BCA'))$$), '0',
  'ekspor Bersama tanpa trade dan dompet Pribadi [B13]');

select * from finish();
rollback;
