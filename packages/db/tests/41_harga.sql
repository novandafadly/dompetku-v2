-- Harga saham S14 (0142 bagian skema; plan S14 Task 4, K1, K8, K13 (e)(h)): app.stock_prices PER RUANG
-- (space_id, ticker, on_date; close bulat 1..10^9; source manual/provider; status ok/held, reason 'spike'
-- untuk held; created_by wajib untuk manual), indeks parsial harga ok terakhir, RLS pola ruang (harga Pribadi
-- tidak terbaca pasangan: tabel global akan membocorkan kode yang dipegang), dan validator SQL tunggal
-- private.price_verdict(ruang, kode, tanggal, close) = 'invalid' (null, <= 0, > 10^9) | 'held' (berubah
-- > 35% dari harga ok terakhir SEBELUM tanggal itu di ruang yang sama) | 'ok' (termasuk harga pertama tanpa
-- pembanding dan tepat 35%). Bagian skema menulis baris harga langsung sebagai dompetku_api (jalur fungsi DEFINER).
-- Bagian API (0143, Task 5): api.set_stock_price (harga manual per ruang Pribadi; lonjakan butuh p_confirm_spike;
-- menimpa harga tanggal yang sama termasuk baris held; lima kategori), jobs.price_targets (hanya kode unik yang
-- dipegang, tanpa ruang/lembar; hanya worker), jobs.price_ingest (validasi ulang bentuk dan nilai di SQL, maksimal
-- 100 baris, tulis per ruang pemegang lewat validator yang sama, tidak menimpa harga manual, hasil hanya jumlah;
-- data rusak tidak menulis apa pun), retensi baris held 90 hari di jobs.purge_voided (K11).
-- ID: T11, B24
begin;
select plan(82);
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

-- ===== api.set_stock_price (0143) =====
select tests.raw_exec(format($q$insert into auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
  values (%L, 'U', 'x@example.test', true, now(), now())$q$, tests.x()));
create function pg_temp.err(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v_s text; v_m text; v_d text;
begin
  perform tests.web_val(p_uid, p_sql);
  return 'ok';
exception when others then
  get stacked diagnostics v_s = returned_sqlstate, v_m = message_text, v_d = pg_exception_detail;
  return v_s || ':' || v_m || ':' || coalesce(v_d, '');
end $$;
create function pg_temp.sp_sql(p_space uuid, p_ticker text, p_on date, p_close bigint, p_confirm boolean default false,
  p_client uuid default null) returns text
language sql as $$
  select format($q$select api.set_stock_price(%L, %L, %L, %L::date, %s::bigint, %L)$q$,
    coalesce(p_client, gen_random_uuid()), p_space, p_ticker, p_on, coalesce(p_close::text, 'null'), p_confirm)
$$;
create function pg_temp.row(p_space uuid, p_ticker text, p_on date) returns text
language sql as $$
  select tests.owner_val(null, format($q$select close || ':' || source || ':' || status || ':' || coalesce(reason, '-') || ':'
      || coalesce((created_by = %L)::text, '-') from app.stock_prices where space_id = %L and ticker = %L and on_date = %L$q$,
    tests.n(), p_space, p_ticker, p_on))
$$;
create function pg_temp.cnt() returns text
language sql as $$
  select tests.owner_val(null, $q$select (select count(*) from app.stock_prices) || '/' || (select count(*) from app.idempotency_keys)
    || '/' || (select string_agg(close::text, ',' order by space_id, ticker, on_date) from app.stock_prices)$q$)
$$;
create function pg_temp.ingest(p_on text, p_rows text) returns text
language sql as $$
  select tests.worker_val(null, format($q$select jobs.price_ingest(%L::date, %L::jsonb)$q$, p_on, p_rows))
$$;
select tests.owner_exec(null, $q$create function private.tes_fail_harga() returns trigger
  language plpgsql set search_path = '' as $f$
  begin
    if pg_catalog.current_setting('tests.fail_after', true) = tg_table_name then
      raise exception using errcode = 'P0001', message = 'fail_after';
    end if;
    return null;
  end $f$$q$);
select tests.owner_exec(null, 'create trigger tes_fail_harga after insert or update on app.stock_prices
  for each row execute function private.tes_fail_harga()');

select tests.web_val(tests.n(), pg_temp.sp_sql(:'np', 'TLKM', '2026-03-10', 3200, false,
  'aaaaaaaa-0000-0000-0000-000000000051')) as r_p1 \gset
select is(:'r_p1'::jsonb, '{"on_date": "2026-03-10", "status": "ok", "replaced": false, "replayed": false, "warnings": []}'::jsonb,
  'harga manual tersimpan (hasil tanpa kode dan harga)');
select is(pg_temp.row(:'np', 'TLKM', '2026-03-10'), '3200:manual:ok:-:true', 'baris manual ok dengan pengisi');
select is(tests.web_val(tests.n(), pg_temp.sp_sql(:'np', 'TLKM', '2026-03-10', 3300))::jsonb ->> 'replaced', 'true',
  'harga tanggal yang sama diganti (koreksi)');
select is(pg_temp.row(:'np', 'TLKM', '2026-03-10') || ' ' || tests.owner_val(null, format($q$select count(*) from app.stock_prices
    where space_id = %L and ticker = 'TLKM'$q$, :'np')), '3300:manual:ok:-:true 1', 'tetap satu baris per tanggal');
select pg_temp.cnt() as cnt_before \gset
select is(pg_temp.err(tests.n(), pg_temp.sp_sql(:'np', 'TLKM', '2026-03-11', 5000)), 'DK422:price_spike_unconfirmed:',
  'lonjakan > 35% tanpa konfirmasi ditolak [T11]');
select is(pg_temp.err(tests.n(), pg_temp.sp_sql(:'np', 'TLKM', '2026-03-11', 0)), 'DK400:price_invalid:close', 'harga 0 ditolak [T11]');
select is(pg_temp.err(tests.n(), pg_temp.sp_sql(:'np', 'TLKM', '2026-03-11', null)), 'DK400:price_invalid:close', 'harga kosong ditolak');
select is(pg_temp.err(tests.n(), pg_temp.sp_sql(:'np', 'TLKM', '2026-03-11', 1000000001)), 'DK400:price_invalid:close',
  'harga > 10^9 ditolak');
select is(pg_temp.err(tests.n(), pg_temp.sp_sql(:'np', 'tlkm', '2026-03-11', 3300)), 'DK400:ticker_invalid:ticker', 'kode tidak sah');
select is(pg_temp.err(tests.n(), pg_temp.sp_sql(:'np', 'TLKM', '2026-03-21', 3300)), 'DK400:invalid_argument:occurred_on',
  'tanggal masa depan ditolak');
select is(pg_temp.err(tests.n(), pg_temp.sp_sql(:'sh', 'TLKM', '2026-03-11', 3300)), 'DK422:pocket_personal_only:',
  'harga hanya untuk Pribadi (saham hanya Pribadi)');
select is(pg_temp.err(tests.n(), pg_temp.sp_sql(:'np', 'TLKM', '2026-03-10', 3400, false, 'aaaaaaaa-0000-0000-0000-000000000051')),
  'DK410:idempotency_key_reused:', 'client_id sama dengan harga lain ditolak');
select is(pg_temp.err(tests.f(), pg_temp.sp_sql(:'np', 'TLKM', '2026-03-11', 3300)), 'DK404:space_not_found:',
  'Farida tidak bisa mengisi harga Pribadi Novanda [B24]');
select is(pg_temp.err(tests.x(), pg_temp.sp_sql(:'np', 'TLKM', '2026-03-11', 3300)), 'DK404:space_not_found:', 'Luar ditolak');
select is(pg_temp.cnt(), :'cnt_before', 'semua penolakan nol efek');
savepoint gagal;
select set_config('tests.fail_after', 'stock_prices', true);
select is(pg_temp.err(tests.n(), pg_temp.sp_sql(:'np', 'TLKM', '2026-03-11', 3300)), 'P0001:fail_after:', 'kegagalan disuntik');
select is(pg_temp.cnt(), :'cnt_before', 'rollback utuh: harga dan kunci idempotensi');
rollback to savepoint gagal;
select set_config('tests.fail_after', '', true);
select is(tests.web_val(tests.n(), pg_temp.sp_sql(:'np', 'TLKM', '2026-03-10', 3200, false,
    'aaaaaaaa-0000-0000-0000-000000000051'))::jsonb, :'r_p1'::jsonb - 'replayed' || '{"replayed": true}',
  'replay = hasil pertama, tanpa menulis');
select is(pg_temp.row(:'np', 'TLKM', '2026-03-10'), '3300:manual:ok:-:true', 'replay tidak menimpa koreksi sesudahnya');
select is(tests.web_val(tests.n(), pg_temp.sp_sql(:'np', 'TLKM', '2026-03-11', 5000, true))::jsonb ->> 'status', 'ok',
  'lonjakan dengan konfirmasi tersimpan ok [T11]');
select is(tests.web_val(tests.n(), pg_temp.sp_sql(:'np', 'BBCA', '2026-03-03', 1100))::jsonb ->> 'replaced', 'true',
  'harga manual menimpa baris held tanggal itu');
select is(pg_temp.row(:'np', 'BBCA', '2026-03-03'), '1100:manual:ok:-:true', 'baris held menjadi ok');

-- ===== jobs.price_targets (0143) =====
create function pg_temp.sek(p_uid uuid, p_space uuid) returns uuid
language sql as $$
  select (tests.web_val(p_uid, format($q$select api.create_account(gen_random_uuid(), %L, 'Sekuritas', 'aset', null,
    '2026-01-01', 0, 'saham')$q$, p_space))::jsonb ->> 'account_id')::uuid
$$;
select pg_temp.sek(tests.n(), :'np') as nsek, pg_temp.sek(tests.f(), :'fp') as fsek \gset
create function pg_temp.open(p_uid uuid, p_acc uuid, p_ticker text) returns uuid
language sql as $$
  select (tests.web_val(p_uid, format($q$select api.open_stock_holding(gen_random_uuid(), %L, %L, 100, 1000, '2026-03-01')$q$,
    p_acc, p_ticker))::jsonb ->> 'trade_id')::uuid
$$;
select pg_temp.open(tests.n(), :'nsek', 'BBCA'), pg_temp.open(tests.n(), :'nsek', 'TLKM'),
       pg_temp.open(tests.f(), :'fsek', 'BBCA'), pg_temp.open(tests.f(), :'fsek', 'ASII');
select pg_temp.open(tests.n(), :'nsek', 'UNVR') as unvr \gset
select tests.web_val(tests.n(), format($$select api.void_stock_trade(gen_random_uuid(), %L)$$, :'unvr'));
select is((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'jobs' and p.proname = 'price_targets'), 'TABLE(ticker text)',
  'price_targets hanya mengembalikan kode (tanpa ruang, pemegang, lembar)');
select is(tests.worker_val(null, $$select string_agg(ticker, ',' order by ticker collate "C") from jobs.price_targets()$$),
  'ASII,BBCA,TLKM', 'kode unik yang masih dipegang semua ruang; kode berlembar 0 tidak ikut [B24]');
select throws_ok($$select tests.web_val(tests.n(), 'select count(*) from jobs.price_targets()')$$, '42501', null,
  'web tidak bisa memanggil price_targets');
select throws_ok($$select tests.api_val(tests.n(), 'select count(*) from jobs.price_targets()')$$, '42501', null,
  'api tidak bisa memanggil price_targets');

-- ===== jobs.price_ingest (0143) =====
select is(pg_temp.ingest('2026-03-19', '[{"ticker": "BBCA", "close": 1300}, {"ticker": "TLKM", "close": 3400},
    {"ticker": "ASII", "close": 5000}, {"ticker": "ZZZZ", "close": 100}]')::jsonb,
  '{"ok": 3, "held": 1, "rejected": 1, "skipped": 0}'::jsonb,
  'tulis per ruang pemegang: hasil hanya jumlah (tanpa kode) [T11]');
create function pg_temp.day(p_on date) returns text
language sql as $$
  select tests.owner_val(null, format($q$select coalesce(string_agg(case space_id when %L then 'N' else 'F' end || ':' || ticker
      || ':' || close || ':' || source || ':' || status || ':' || coalesce(reason, '-') || ':' || coalesce(created_by::text, '-'),
      ',' order by case space_id when %L then 'N' else 'F' end collate "C", ticker collate "C"), '')
      from app.stock_prices where on_date = %L$q$, tests.space_id(tests.n(), 'personal'), tests.space_id(tests.n(), 'personal'), p_on))
$$;
select is(pg_temp.day('2026-03-19'),
  'F:ASII:5000:provider:ok:-:-,F:BBCA:1300:provider:held:spike:-,N:BBCA:1300:provider:ok:-:-,N:TLKM:3400:provider:ok:-:-',
  'validator per ruang: BBCA ok di Novanda (pembanding 1.200), held di Farida (pembanding 9.000); kode tanpa pemegang tidak ditulis [T11]');
select is(pg_temp.ingest('2026-03-19', '[{"ticker": "BBCA", "close": 1300}, {"ticker": "TLKM", "close": 3400},
    {"ticker": "ASII", "close": 5000}, {"ticker": "ZZZZ", "close": 100}]')::jsonb ->> 'ok', '3',
  'ulang hari yang sama idempoten');
select is(tests.owner_val(null, $$select count(*) from app.stock_prices where on_date = '2026-03-19'$$), '4',
  'ulang tidak menambah baris');
select tests.web_val(tests.n(), pg_temp.sp_sql(:'np', 'TLKM', '2026-03-19', 3500));
select is(pg_temp.ingest('2026-03-19', '[{"ticker": "TLKM", "close": 3450}]')::jsonb,
  '{"ok": 0, "held": 0, "rejected": 0, "skipped": 1}'::jsonb, 'harga manual tanggal itu tidak ditimpa penyedia');
select is(pg_temp.row(:'np', 'TLKM', '2026-03-19'), '3500:manual:ok:-:true', 'baris manual tetap');
select pg_temp.cnt() as cnt_before \gset
select is(pg_temp.ingest('2026-03-18', '[{"ticker": "bbca", "close": 1000}, {"ticker": "BBCA1", "close": 1000},
    {"ticker": " BBCA", "close": 1000}, {"ticker": 1234, "close": 1000}, {"close": 1000}, {"ticker": "TLKM", "close": "3400"},
    {"ticker": "TLKM", "close": -5}, {"ticker": "TLKM", "close": 0}, {"ticker": "TLKM", "close": 1000000000000},
    {"ticker": "TLKM", "close": 3400.5}, {"ticker": "TLKM"}, {"ticker": "BBCA", "close": 1300}, {"ticker": "BBCA", "close": 1301},
    "BBCA", null, [1]]')::jsonb,
  '{"ok": 0, "held": 0, "rejected": 16, "skipped": 0}'::jsonb,
  'data rusak (kode tidak sah, harga string/negatif/nol/raksasa/pecahan, kode ganda, bukan objek) ditolak semua [T11]');
select is(pg_temp.cnt(), :'cnt_before', 'data rusak tidak menulis baris apa pun');
select is(pg_temp.ingest('2026-03-18', '[{"ticker": "BBCA", "close": 1300}, {"ticker": "BBCA", "close": "9999"}]')::jsonb,
  '{"ok": 0, "held": 0, "rejected": 2, "skipped": 0}'::jsonb,
  'kode ganda ditolak semua walau salah satu kemunculan harganya tidak sah');
select is(pg_temp.cnt(), :'cnt_before', 'kode ganda tidak menulis baris apa pun');
create function pg_temp.ierr(p_on text, p_rows text) returns text
language plpgsql as $$
declare v_s text; v_m text; v_d text;
begin
  perform pg_temp.ingest(p_on, p_rows);
  return 'ok';
exception when others then
  get stacked diagnostics v_s = returned_sqlstate, v_m = message_text, v_d = pg_exception_detail;
  return v_s || ':' || v_m || ':' || coalesce(v_d, '');
end $$;
select is(pg_temp.ierr('2026-03-21', '[{"ticker": "BBCA", "close": 1300}]'), 'DK400:invalid_argument:on',
  'tanggal masa depan ditolak seluruhnya');
select is(pg_temp.ierr(null, '[{"ticker": "BBCA", "close": 1300}]'), 'DK400:invalid_argument:on', 'tanggal kosong ditolak');
select is(pg_temp.ierr('1999-12-31', '[{"ticker": "BBCA", "close": 1300}]'), 'DK400:invalid_argument:on',
  'tanggal sebelum 2000 ditolak');
select is(pg_temp.ierr('2026-03-18', '{"ticker": "BBCA", "close": 1300}'), 'DK400:invalid_argument:rows', 'bukan larik ditolak');
select is(pg_temp.ierr('2026-03-18', null), 'DK400:invalid_argument:rows', 'larik kosong (null) ditolak');
select is(pg_temp.ierr('2026-03-18', (select jsonb_agg(jsonb_build_object('ticker', 'BBCA', 'close', 1300)) from generate_series(1, 101))::text),
  'DK400:invalid_argument:rows', 'lebih dari 100 baris ditolak');
select is(pg_temp.cnt(), :'cnt_before', 'penolakan seluruh run tidak menulis');
select throws_ok($$select tests.web_val(tests.n(), $q$select jobs.price_ingest('2026-03-18', '[]')$q$)$$, '42501', null,
  'web tidak bisa memanggil price_ingest');
select throws_ok($$select tests.api_val(tests.n(), $q$select jobs.price_ingest('2026-03-18', '[]')$q$)$$, '42501', null,
  'api tidak bisa memanggil price_ingest');
select is(tests.owner_val(null, 'select count(*) from private.stock_ctx'), '0', 'tanpa konteks trade tersisa');

-- ===== Retensi baris held 90 hari (K11, jobs.purge_voided) =====
-- Batas: hari ini 2026-03-20, today - 90 = 2025-12-20 (tetap), today - 91 = 2025-12-19 (dihapus).
select pg_temp.price(tests.n(), :'np', 'BBCA', '2025-12-19', 900, 'held');
select pg_temp.price(tests.n(), :'np', 'BBCA', '2025-12-20', 900, 'held');
select is(tests.owner_val(null, $$select count(*) filter (where status = 'held') || '/' || count(*) filter (where status = 'ok')
    from app.stock_prices$$), '3/9', 'sebelum purge: tiga baris held');
select tests.worker_val(null, 'select jobs.purge_voided()');
select is(tests.owner_val(null, $$select string_agg(on_date::text, ',' order by on_date) || '/'
    || (select count(*) filter (where status = 'ok') from app.stock_prices) from app.stock_prices where status = 'held'$$),
  '2025-12-20,2026-03-19/9', 'held > 90 hari dihapus (tepat 91 hari), tepat 90 hari dan held baru tetap; harga ok tetap');

select * from finish();
rollback;
