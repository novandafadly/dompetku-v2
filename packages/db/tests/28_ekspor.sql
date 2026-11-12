-- Ekspor transaksi (S10, 0127; plan S10 Task 7, K5; BSD §15 butir 7). api.export_entries: satu baris
-- per kaki entri hidup dari report_lines, jadi Σ per kelas = angka Laporan (period_trend,
-- excluded_summary) pada fixture golden S9; Bersama tanpa data Pribadi (kanari); otorisasi tanpa
-- oracle; batas rentang dan 50.000 baris; audit event `export` tanpa isi.
-- Fixture golden-s9: hari ini 2026-11-10, periode Nov = 2026-10-23..2026-11-24 (gajian 25).
-- ID: T17, B13
begin;
select plan(30);
\ir support/golden-s9.sql

-- Kueri atas api.export_entries(ruang, dari, sampai) sebagai x, dijalankan sebagai pengguna.
create function pg_temp.q(p_uid uuid, p_space uuid, p_from text, p_to text, p_expr text) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select %s from api.export_entries(%L, %L::date, %L::date) x$q$,
    p_expr, p_space, p_from, p_to))
$$;
create function pg_temp.raw_err(p_stmt text) returns text
language plpgsql as $$
declare
  v_state  text;
  v_msg    text;
  v_detail text;
begin
  execute p_stmt;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
  return v_state || ':' || v_msg || ':' || coalesce(v_detail, '');
end $$;
create function pg_temp.err(p_uid uuid, p_space uuid, p_from text, p_to text) returns text
language sql as $$
  select pg_temp.raw_err(format($q$select tests.web_val(%L, %L)$q$, p_uid,
    format($i$select count(*) from api.export_entries(%L, %L::date, %L::date)$i$, p_space, p_from, p_to)))
$$;
-- Kueri bebas: EXP diganti api.export_entries(ruang, dari, sampai).
create function pg_temp.qs(p_uid uuid, p_space uuid, p_from text, p_to text, p_sql text) returns text
language sql as $$
  select tests.web_val(p_uid, replace(p_sql, 'EXP',
    format('api.export_entries(%L, %L::date, %L::date)', p_space, p_from, p_to)))
$$;
-- Σ kelas x_*: kelas:arah:jumlah mutlak dari ekspor (harus sama dengan excluded_summary).
create function pg_temp.x_export(p_uid uuid, p_space uuid) returns text
language sql as $$
  select pg_temp.qs(p_uid, p_space, '2026-10-23', '2026-11-24',
    $e$select string_agg(q.c || ':' || q.d || ':' || q.s, ',' order by q.c, q.d) from (
         select y.report_class as c, case when y.amount > 0 then 'in' else 'out' end as d, sum(abs(y.amount)) as s
           from EXP y where y.report_class like 'x\_%' group by 1, 2) q$e$)
$$;

-- ===== Kontrak =====
select is((select pg_get_function_result(p.oid) || ' ' || p.prosecdef || ' ' || p.provolatile::text || ' ' || p.proowner::regrole
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname = 'export_entries'),
  'TABLE(occurred_on date, kind text, role text, report_class text, account text, category text, '
  || 'subcategory text, amount bigint, note text, recorded_by text) false v dompetku_owner',
  'INVOKER, VOLATILE (menulis audit), milik owner; kolom ekspor tanpa id internal');
select is(tests.owner_val(null, $$select count(*) from audit.events where event = 'export'$$), '0', 'belum ada event export');

-- ===== Σ per kelas = Laporan (Pribadi N, periode Nov gajian) =====
select tests.web_val(tests.n(), format($q$select to_jsonb(t)::text from api.period_trend(%L, '2026-11-01', 1, 'gajian') t$q$, :'np'))::jsonb as trend \gset
select is(pg_temp.q(tests.n(), :'np', '2026-10-23', '2026-11-24',
    $e$coalesce(sum(x.amount) filter (where x.report_class = 'income'), 0)$e$),
  :'trend'::jsonb ->> 'pemasukan', 'Pribadi N: Σ kelas income = Pemasukan Laporan');
select is(pg_temp.q(tests.n(), :'np', '2026-10-23', '2026-11-24',
    $e$-coalesce(sum(x.amount) filter (where x.report_class in ('expense', 'expense_fee')), 0)$e$),
  :'trend'::jsonb ->> 'pengeluaran', 'Pribadi N: Σ kelas expense + expense_fee (tanda minus) = Pengeluaran Laporan');
select is(pg_temp.x_export(tests.n(), :'np'),
  tests.web_val(tests.n(), format($q$select string_agg(e.report_class || ':' || e.direction || ':' || e.amount, ',' order by e.report_class, e.direction)
    from api.excluded_summary(%L, '2026-10-23', '2026-11-24') e$q$, :'np')),
  'Pribadi N: Σ kelas x_* per arah = Tidak termasuk Laporan');
select is(pg_temp.q(tests.n(), :'np', '2026-10-23', '2026-11-24', 'count(*) filter (where x.report_class = ''expense_fee'')'), '1',
  'biaya transfer = baris sendiri berkelas expense_fee, bukan digabung ke kaki transfer');

-- Bersama: dua anggota melihat angka yang sama dengan Laporan Bersama.
select tests.web_val(tests.n(), format($q$select to_jsonb(t)::text from api.period_trend(%L, '2026-11-01', 1, 'gajian') t$q$, :'sh'))::jsonb as btrend \gset
select is(pg_temp.q(tests.n(), :'sh', '2026-10-23', '2026-11-24',
    $e$-coalesce(sum(x.amount) filter (where x.report_class in ('expense', 'expense_fee')), 0)$e$),
  :'btrend'::jsonb ->> 'pengeluaran', 'Bersama N: Σ pengeluaran = Laporan Bersama');
select is(pg_temp.q(tests.f(), :'sh', '2026-10-23', '2026-11-24', 'count(*)'),
  pg_temp.q(tests.n(), :'sh', '2026-10-23', '2026-11-24', 'count(*)'), 'F dan N melihat ekspor Bersama yang sama');
select is(pg_temp.x_export(tests.n(), :'sh'),
  tests.web_val(tests.n(), format($q$select string_agg(e.report_class || ':' || e.direction || ':' || e.amount, ',' order by e.report_class, e.direction)
    from api.excluded_summary(%L, '2026-10-23', '2026-11-24') e$q$, :'sh')),
  'Bersama: Σ kelas x_* per arah = Tidak termasuk Laporan Bersama');

-- ===== Isi baris =====
select is(pg_temp.q(tests.n(), :'np', '2026-10-23', '2026-11-24',
    $e$string_agg(x.occurred_on || ':' || x.kind || ':' || x.role || ':' || x.report_class || ':' || x.account || ':' || coalesce(x.category, '-')
        || ':' || coalesce(x.subcategory, '-') || ':' || x.amount, ',') filter (where x.subcategory = 'Ojek')$e$),
  '2026-11-03:expense:main:expense:GoPay:Transportasi:Ojek:-45000', 'rincian: kategori induk dan subkategori terpisah, dompet, tanda minus');
select is(pg_temp.q(tests.n(), :'np', '2026-10-23', '2026-11-24',
    $e$string_agg(x.occurred_on || ':' || x.account || ':' || x.amount, ',') filter (where x.report_class = 'expense_fee')$e$),
  '2026-11-01:BCA:-6500', 'baris biaya transfer: dompet asal, nominal minus (biaya antar ruang 1 Nov)');
select is(pg_temp.q(tests.n(), :'np', '2026-10-23', '2026-11-24', 'count(*) filter (where x.recorded_by is null)'), '0',
  'pencatat terisi di setiap baris Pribadi');
select is(pg_temp.q(tests.n(), :'np', '2026-10-23', '2026-11-24', 'min(x.occurred_on)::text || ''..'' || max(x.occurred_on)::text'),
  '2026-10-23..2026-11-10', 'rentang inklusif: 23 Okt (gaji) termasuk, 22 Okt tidak; tidak ada tanggal setelah hari ini');
-- Entri batal tidak ikut; catatan terbawa apa adanya (escape CSV urusan lapisan CSV).
select tests.web_val(tests.n(), format($q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 7777, %L, '2026-11-06', 'KANARI-N-CATATAN =cmd') ->> 'entry_id'$q$,
  :'np', :'g_bca', :'c_makan')) as e_void \gset
select tests.web_val(tests.n(), format($q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 8888, %L, '2026-11-07', 'KANARI-N-CATATAN =cmd') ->> 'entry_id'$q$,
  :'np', :'g_bca', :'c_makan')) as e_ok \gset
select tests.web_val(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'e_void')) is not null as x \gset
select is(pg_temp.q(tests.n(), :'np', '2026-10-23', '2026-11-24', 'string_agg(x.amount || '':'' || x.note, '','') filter (where x.note like ''KANARI%'')'),
  '-8888:KANARI-N-CATATAN =cmd', 'entri batal tidak ikut; catatan apa adanya');

-- ===== B13: Bersama tanpa data Pribadi =====
select is(pg_temp.q(tests.n(), :'sh', '2026-10-23', '2026-11-24',
    $e$count(*) filter (where x.account like 'KANARI%' or x.category like 'KANARI%' or x.note like 'KANARI%'
                         or x.account in ('BCA', 'GoPay', 'Kas Kantor', 'Celengan'))$e$), '0',
  'ekspor Bersama tanpa kanari dan dompet Pribadi N [B13]');
select is(pg_temp.q(tests.f(), :'sh', '2026-10-23', '2026-11-24',
    $e$count(*) filter (where x.account like 'KANARI%' or x.note like 'KANARI%')$e$), '0',
  'ekspor Bersama oleh F tanpa kanari Pribadi N [B13]');

-- ===== Otorisasi tanpa oracle =====
select is(pg_temp.err(tests.f(), :'np', '2026-10-23', '2026-11-24'), 'DK404:space_not_found:', 'F mengekspor Pribadi N = DK404');
select is(pg_temp.err(tests.x(), :'sh', '2026-10-23', '2026-11-24'), 'DK404:space_not_found:', 'Luar mengekspor Bersama = DK404');
select is(pg_temp.err(tests.x(), :'sh', '2026-11-24', '2026-10-23'), 'DK404:space_not_found:',
  'bukan anggota dengan rentang salah tetap DK404 (keanggotaan dicek lebih dulu)');

-- ===== Rentang =====
select is(pg_temp.err(tests.n(), :'np', '2026-11-24', '2026-10-23'), 'DK400:invalid_argument:period', 'dari > sampai = DK400 period');
select is(pg_temp.err(tests.n(), :'np', null, '2026-10-23'), 'DK400:invalid_argument:period', 'dari NULL = DK400 period');
select is(pg_temp.err(tests.n(), :'np', '2026-10-23', null), 'DK400:invalid_argument:period', 'sampai NULL = DK400 period');
select is(pg_temp.err(tests.n(), :'np', '2016-01-01', '2026-11-24'), 'DK400:invalid_argument:period', 'rentang > 3660 hari = DK400 period');
select is(pg_temp.err(tests.n(), :'np', '2016-11-24', '2026-11-24'), 'ok', 'tepat 3660 hari boleh');

-- ===== Audit event export =====
select tests.owner_val(null, format($$select count(*) from audit.events where event = 'export' and space_id = %L$$, :'np'))::int as c0 \gset
select pg_temp.q(tests.n(), :'np', '2026-10-23', '2026-11-24', 'count(*)') as n_rows \gset
select is(tests.owner_val(null, format($$select count(*) from audit.events where event = 'export' and space_id = %L$$, :'np'))::int, :c0 + 1,
  'satu ekspor yang berhasil = satu event');
select is(tests.owner_val(null, format($$select (select string_agg(k, ',' order by k) from jsonb_object_keys(meta) k) || ' ' || (meta ->> 'count')
    || ' ' || (meta ->> 'via') || ' ' || (user_id = %L)
    from audit.events where event = 'export' and space_id = %L order by id desc limit 1$$, tests.n(), :'np')),
  'count,via ' || :'n_rows' || ' csv true', 'meta hanya {count, via}, atas nama pemanggil: tanpa isi, nama, nominal, atau rentang');
select pg_temp.err(tests.f(), :'np', '2026-10-23', '2026-11-24') as x \gset
select pg_temp.err(tests.n(), :'np', '2026-11-24', '2026-10-23') as x \gset
select is(tests.owner_val(null, format($$select count(*) from audit.events where event = 'export' and space_id = %L$$, :'np'))::int, :c0 + 1,
  'ekspor yang ditolak (bukan anggota, rentang salah) tidak mencatat event');

-- ===== Batas baris (app.settings export_max_rows; bawaan 50.000) =====
select tests.owner_val(null, $$select value from app.settings where key = 'export_max_rows'$$) as max_default \gset
select is(:'max_default'::text, '50000', 'batas bawaan 50.000 baris');
select pg_temp.q(tests.n(), :'np', '2026-10-23', '2026-11-24', 'count(*)') as n_all \gset
select tests.owner_exec(null, format($$update app.settings set value = %L where key = 'export_max_rows'$$, :'n_all'::int - 1));
select is(pg_temp.err(tests.n(), :'np', '2026-10-23', '2026-11-24'), 'DK422:export_too_large:', 'satu baris di atas batas = export_too_large');
select tests.owner_exec(null, format($$update app.settings set value = %L where key = 'export_max_rows'$$, :'n_all'::int));
select is(pg_temp.err(tests.n(), :'np', '2026-10-23', '2026-11-24'), 'ok', 'tepat di batas boleh');
select * from finish();
rollback;
