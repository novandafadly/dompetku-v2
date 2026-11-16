-- Harga saham S14 (0142 bagian skema; plan S14 Task 4, K1, K8, K13 (e)(h)): app.stock_prices PER RUANG
-- (space_id, ticker, on_date; close bulat 1..10^9; source manual/provider; status ok/held, reason 'spike'
-- untuk held; created_by wajib untuk manual), indeks parsial harga ok terakhir, RLS pola ruang (harga Pribadi
-- tidak terbaca pasangan: tabel global akan membocorkan kode yang dipegang), dan validator SQL tunggal
-- private.price_verdict(ruang, kode, tanggal, close) = 'invalid' (null, <= 0, > 10^9) | 'held' (berubah
-- > 35% dari harga ok terakhir SEBELUM tanggal itu di ruang yang sama) | 'ok' (termasuk harga pertama tanpa
-- pembanding dan tepat 35%). Fungsi api.set_stock_price dan jobs.price_ingest = 0143 (Task 5, sisa berkas ini);
-- di sini baris harga ditulis langsung sebagai dompetku_api (jalur fungsi DEFINER).
-- ID: T11, B24
begin;
select plan(34);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

create function pg_temp.price(p_uid uuid, p_space uuid, p_ticker text, p_on date, p_close bigint,
  p_status text default 'ok', p_source text default 'manual') returns bigint
language sql as $$
  select tests.api_exec(p_uid, format($q$insert into app.stock_prices (space_id, ticker, on_date, close, source, status,
      reason, created_by) values (%L, %L, %L, %s, %L, %L, %L, %L)$q$,
    p_space, p_ticker, p_on, p_close, p_source, p_status, case when p_status = 'held' then 'spike' end,
    case when p_source = 'manual' then p_uid end))
$$;
create function pg_temp.verdict(p_uid uuid, p_space uuid, p_ticker text, p_on date, p_close bigint) returns text
language sql as $$
  select tests.api_val(p_uid, format($q$select private.price_verdict(%L, %L, %L, %s)$q$,
    p_space, p_ticker, p_on, coalesce(p_close::text, 'null')))
$$;

-- ===== Skema =====
select has_table('app', 'stock_prices', 'tabel app.stock_prices ada');
select is((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
           from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname = 'stock_prices' and a.attnum > 0 and not a.attisdropped),
  'space_id:uuid:true,ticker:text:true,on_date:date:true,close:bigint:true,source:text:true,status:text:true,'
  || 'reason:text:false,created_by:uuid:false,created_at:timestamp with time zone:true',
  'kolom stock_prices (per ruang, tanpa kolom pemegang/lembar)');
select col_is_pk('app', 'stock_prices', array['space_id', 'ticker', 'on_date'], 'satu harga per ruang x kode x tanggal');
select is((select indexdef from pg_indexes where schemaname = 'app' and indexname = 'stock_prices_ok'),
  'CREATE INDEX stock_prices_ok ON app.stock_prices USING btree (space_id, ticker, on_date DESC) WHERE (status = ''ok''::text)',
  'indeks harga ok terakhir per ruang x kode');
select is((select p.provolatile::text || ':' || p.prosecdef || ':' || p.proowner::regrole::text from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'price_verdict'),
  's:false:dompetku_owner', 'price_verdict STABLE INVOKER milik owner (RLS pemanggil)');

select lives_ok(format($$select pg_temp.price(tests.n(), %L, 'BBCA', '2026-03-02', 1000)$$, :'np'), 'harga manual sah tersimpan');
select throws_ok(format($$select pg_temp.price(tests.n(), %L, 'BBCA', '2026-03-03', 0)$$, :'np'), '23514', null, 'close 0 ditolak');
select throws_ok(format($$select pg_temp.price(tests.n(), %L, 'BBCA', '2026-03-03', 1000000001)$$, :'np'), '23514', null,
  'close > 10^9 ditolak');
select throws_ok(format($$select pg_temp.price(tests.n(), %L, 'bbca', '2026-03-03', 1000)$$, :'np'), '23514', null,
  'kode bukan 4 huruf kapital ditolak');
select throws_ok(format($$select pg_temp.price(tests.n(), %L, 'BBCA', '2026-03-02', 1100)$$, :'np'), '23505', null,
  'harga kedua untuk tanggal yang sama ditolak (diperbarui lewat fungsi 0143)');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$insert into app.stock_prices (space_id, ticker, on_date, close,
    source, status, created_by) values (%L, 'BBCA', '2026-03-04', 1000, 'manual', 'held', %L)$q$)$$, :'np', tests.n()),
  '23514', null, 'held wajib beralasan');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$insert into app.stock_prices (space_id, ticker, on_date, close,
    source, status, reason, created_by) values (%L, 'BBCA', '2026-03-04', 1000, 'manual', 'ok', 'spike', %L)$q$)$$, :'np', tests.n()),
  '23514', null, 'ok tanpa alasan');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$insert into app.stock_prices (space_id, ticker, on_date, close,
    source, status) values (%L, 'BBCA', '2026-03-04', 1000, 'manual', 'ok')$q$)$$, :'np'),
  '23514', null, 'harga manual wajib pengisi');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$insert into app.stock_prices (space_id, ticker, on_date, close,
    source, status, created_by) values (%L, 'BBCA', '2026-03-04', 1000, 'provider', 'ok', %L)$q$)$$, :'np', tests.n()),
  '23514', null, 'harga penyedia tanpa pengisi');

-- ===== Validator (K8) =====
select is(pg_temp.verdict(tests.n(), :'np', 'TLKM', '2026-03-05', 3200), 'ok', 'harga pertama tanpa pembanding = ok [T11]');
select is(pg_temp.verdict(tests.n(), :'np', 'TLKM', '2026-03-05', null), 'invalid', 'harga kosong = invalid [T11]');
select is(pg_temp.verdict(tests.n(), :'np', 'TLKM', '2026-03-05', 0), 'invalid', 'harga 0 = invalid [T11]');
select is(pg_temp.verdict(tests.n(), :'np', 'TLKM', '2026-03-05', -5), 'invalid', 'harga negatif = invalid [T11]');
select is(pg_temp.verdict(tests.n(), :'np', 'TLKM', '2026-03-05', 1000000001), 'invalid', 'harga > 10^9 = invalid [T11]');
select is(pg_temp.verdict(tests.n(), :'np', 'TLKM', '2026-03-05', 1000000000), 'ok', 'harga 10^9 tepat = ok');
select is(pg_temp.verdict(tests.n(), :'np', 'BBCA', '2026-03-05', 1350) || ',' || pg_temp.verdict(tests.n(), :'np', 'BBCA', '2026-03-05', 650),
  'ok,ok', 'naik/turun tepat 35% dari harga ok terakhir = ok (batas inklusif) [T11]');
select is(pg_temp.verdict(tests.n(), :'np', 'BBCA', '2026-03-05', 1351) || ',' || pg_temp.verdict(tests.n(), :'np', 'BBCA', '2026-03-05', 649),
  'held,held', 'lebih dari 35% = held [T11]');
select is(pg_temp.verdict(tests.n(), :'np', 'BBCA', '2026-03-02', 5000), 'ok',
  'harga di tanggal pembanding sendiri tidak membandingkan dirinya (hanya tanggal sebelumnya)');
select pg_temp.price(tests.n(), :'np', 'BBCA', '2026-03-03', 2000, 'held');
select is(pg_temp.verdict(tests.n(), :'np', 'BBCA', '2026-03-05', 1300), 'ok', 'harga held tidak dipakai sebagai pembanding');
select pg_temp.price(tests.n(), :'np', 'BBCA', '2026-03-04', 1200);
select is(pg_temp.verdict(tests.n(), :'np', 'BBCA', '2026-03-05', 1620) || ',' || pg_temp.verdict(tests.n(), :'np', 'BBCA', '2026-03-05', 1621),
  'ok,held', 'pembanding = harga ok terbaru sebelum tanggal (1.200, bukan 1.000)');
select is(pg_temp.verdict(tests.n(), :'np', 'BBCA', '2026-03-03', 1350), 'ok',
  'harga susulan untuk tanggal lampau dibandingkan dengan harga ok sebelum tanggal itu (1.000)');

-- ===== Per ruang (K8, B24) =====
select pg_temp.price(tests.f(), :'fp', 'BBCA', '2026-03-04', 9000);
select is(pg_temp.verdict(tests.n(), :'np', 'BBCA', '2026-03-05', 1300), 'ok',
  'harga BBCA di Pribadi pasangan tidak menjadi pembanding Novanda [B24]');
select is(pg_temp.verdict(tests.f(), :'fp', 'BBCA', '2026-03-05', 1300), 'held', 'pembanding pasangan dari ruangnya sendiri');
select is(pg_temp.verdict(tests.f(), :'np', 'BBCA', '2026-03-05', 1621), 'ok',
  'verdict atas ruang orang lain tidak membaca harganya (RLS pemanggil; api memeriksa anggota lebih dulu) [B24]');
select is(tests.web_val(tests.f(), $$select string_agg(ticker || ':' || close, ',' order by on_date) from app.stock_prices$$),
  'BBCA:9000', 'pasangan hanya membaca harga ruangnya [B24]');
select is(tests.web_val(tests.n(), $$select count(*) from app.stock_prices$$), '3', 'Novanda tidak membaca harga pasangan [B24]');
select throws_ok(format($$select pg_temp.price(tests.f(), %L, 'ASII', '2026-03-04', 5000)$$, :'np'), '42501', null,
  'pasangan tidak bisa menulis harga ke Pribadi Novanda (RLS) [B24]');
select throws_ok(format($$select tests.web_exec(%L, $q$insert into app.stock_prices (space_id, ticker, on_date, close, source,
    status, created_by) values (%L, 'ASII', '2026-03-04', 5000, 'manual', 'ok', %L)$q$)$$, tests.n(), :'np', tests.n()),
  '42501', null, 'web tanpa INSERT harga (hanya lewat fungsi)');
select throws_ok($$select tests.worker_val(null, 'select count(*) from app.stock_prices')$$, '42501', null,
  'worker tidak membaca harga langsung (hanya lewat jobs.* 0143)');

select * from finish();
rollback;
