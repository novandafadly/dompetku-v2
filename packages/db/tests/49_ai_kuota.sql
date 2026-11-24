-- Kuota harian AI (S17, 0150; plan S17 Task 2, K3; qa.md M6).
-- app.ai_usage: RLS ENABLE + FORCE milik sendiri; parse 15/hari, analysis 5/hari (total 20/hari);
-- reset otomatis saat pergantian hari WIB (app.today()); user terisolasi; tanpa user = DK401.
-- ID: B13
begin;
select plan(18);
select tests.fixture();
select tests.clock_at('2027-04-10 23:55+07');

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
create function pg_temp.err(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare
  v_state  text;
  v_msg    text;
  v_detail text;
begin
  perform tests.web_val(p_uid, p_sql);
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
  return v_state || ':' || v_msg || ':' || coalesce(v_detail, '');
end $$;

-- ===== Kontrak fungsi =====
select is((select string_agg(p.proname || ' ' || p.prosecdef || ' ' || p.provolatile::text || ' ' || p.proowner::regrole,
                              ',' order by p.proname)
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname in ('ai_quota', 'consume_ai_quota')),
  'ai_quota false s dompetku_owner,consume_ai_quota true v dompetku_api',
  'ai_quota INVOKER STABLE milik owner; consume_ai_quota DEFINER milik api');

-- ===== Tanpa sesi / argumen salah =====
select is(pg_temp.err(null, $$select count(*) from api.ai_quota()$$),
  'DK401:unauthenticated:', 'ai_quota tanpa pengguna = DK401');
select is(pg_temp.err(null, $$select api.consume_ai_quota('parse')$$),
  'DK401:unauthenticated:', 'consume_ai_quota tanpa pengguna = DK401');
select is(pg_temp.err(tests.n(), $$select count(*) from api.ai_quota('other')$$),
  'DK400:invalid_argument:feature', 'ai_quota fitur asing = DK400');
select is(pg_temp.err(tests.n(), $$select api.consume_ai_quota('other')$$),
  'DK400:invalid_argument:feature', 'consume_ai_quota fitur asing = DK400');

-- ===== Awal hari: parse 0/15, analysis 0/5 =====
select is(tests.web_val(tests.n(), $$select string_agg(feature || ':' || used || '/' || daily_limit || ':' || remaining, ',' order by feature)
  from api.ai_quota()$$),
  'analysis:0/5:5,parse:0/15:15', 'kuota awal: analysis 0/5, parse 0/15');

-- ===== Konsumsi parse sampai batas 15, ke-16 ditolak =====
select is(pg_temp.call(tests.n(), $$select api.consume_ai_quota('parse')$$) ->> 'allowed', 'true', 'parse ke-1 diizinkan');
select is(pg_temp.call(tests.n(), $$select api.consume_ai_quota('parse')$$) ->> 'used', '2', 'parse ke-2 -> used = 2');
select is((select count(*) from generate_series(1, 13) g
           where (pg_temp.call(tests.n(), $$select api.consume_ai_quota('parse')$$) ->> 'allowed') = 'true'),
  13::bigint, 'parse ke-3 sampai ke-15 semua diizinkan');
select is(pg_temp.call(tests.n(), $$select api.consume_ai_quota('parse')$$),
  '{"allowed": false, "day": "2027-04-10", "feature": "parse", "limit": 15, "remaining": 0, "used": 15}'::jsonb,
  'parse ke-16 ditolak dengan remaining = 0');

-- ===== Fitur lain dan pengguna lain tidak terpengaruh (isolasi) =====
select is(pg_temp.call(tests.n(), $$select api.consume_ai_quota('analysis')$$) ->> 'allowed', 'true',
  'kuota analysis N tetap jalan meski parse N habis');
select is((select count(*) from generate_series(1, 4) g
           where (pg_temp.call(tests.n(), $$select api.consume_ai_quota('analysis')$$) ->> 'allowed') = 'true'),
  4::bigint, 'analysis ke-2 sampai ke-5 diizinkan');
select is(pg_temp.call(tests.n(), $$select api.consume_ai_quota('analysis')$$) ->> 'allowed', 'false',
  'analysis ke-6 ditolak');
select is(pg_temp.call(tests.f(), $$select api.consume_ai_quota('parse')$$) ->> 'used', '1',
  'F punya kuota parse sendiri (1/15), tidak tercampur N [B13]');
select is(tests.web_val(tests.f(), $$select count(*) from app.ai_usage$$), '1',
  'RLS app.ai_usage: F hanya melihat baris miliknya sendiri [B13]');

-- ===== Pergantian hari WIB (00:00+07 = 17:00 UTC hari sebelumnya): kuota reset =====
select tests.clock_at('2027-04-11 00:00:01+07');
select is(tests.web_val(tests.n(), $$select used || ':' || remaining || ':' || day from api.ai_quota('parse')$$),
  '0:15:2027-04-11', 'hari WIB baru: kuota parse N reset jadi 0/15');
select is(pg_temp.call(tests.n(), $$select api.consume_ai_quota('parse')$$) ->> 'allowed', 'true',
  'parse N di hari baru kembali diizinkan');
select is(tests.owner_val(null, format($$select count(*) from app.ai_usage where user_id = %L and feature = 'parse'$$, tests.n())),
  '2', 'riwayat hari lama tetap tersimpan, hari baru membuat baris baru');

select * from finish();
rollback;
