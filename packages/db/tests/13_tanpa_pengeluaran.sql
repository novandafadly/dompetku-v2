-- Hari tanpa pengeluaran S6 (0108): api.mark_no_spend_day memakai app.today() (WIB server),
-- idempoten alami, tanggal depan ditolak, isolasi ruang, batas hari WIB (review focus #3).
begin;
select plan(17);
select tests.fixture();
select tests.clock_at('2026-10-31 23:30+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

select lives_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format('select api.mark_no_spend_day(p_space_id => %L)', :'np')),
  'tandai hari ini di Pribadi');
select is(tests.web_val(tests.n(), $$select on_date::text from app.no_spend_days$$),
  tests.owner_val(null, 'select app.today()::text'), 'mark_no_spend_day memakai app.today()');
select is(tests.web_val(tests.n(), $$select on_date::text from app.no_spend_days$$), '2026-10-31',
  '31 Okt 23:30 WIB = 31 Okt (bukan tanggal UTC)');
select is(tests.web_val(tests.n(), $$select marked_by::text from app.no_spend_days$$), tests.n()::text,
  'marked_by = pemanggil');
select lives_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format('select api.mark_no_spend_day(p_space_id => %L)', :'np')),
  'kedua kali tidak galat (on conflict do nothing)');
select is(tests.web_val(tests.n(), $$select count(*) from app.no_spend_days$$)::int, 1, 'tetap satu baris');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format('select api.mark_no_spend_day(p_space_id => %L, p_on => app.today() + 1)', :'np')),
  'DK400', 'invalid_argument', 'tanggal depan ditolak');
select lives_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format($q$select api.mark_no_spend_day(p_space_id => %L, p_on => '2026-10-29')$q$, :'np')),
  'tanggal lampau eksplisit boleh');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format('select api.mark_no_spend_day(p_space_id => %L)', :'fp')),
  'DK404', 'space_not_found', 'bukan anggota = DK404');
select throws_ok(format($$select tests.web_exec(null, %L)$$,
    format('select api.mark_no_spend_day(p_space_id => %L)', :'np')),
  'DK401', 'unauthenticated', 'tanpa konteks = DK401');
select is(tests.web_val(tests.f(), $$select count(*) from app.no_spend_days$$)::int, 0, 'F tidak melihat baris Pribadi N');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format(
    $q$insert into app.no_spend_days (space_id, on_date, marked_by) values (%L, '2026-10-01', app.current_user_id())$q$, :'np')),
  '42501', null, 'web tidak bisa insert langsung');

-- Bersama: ditandai satu anggota, terlihat anggota lain.
select lives_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(),
    format('select api.mark_no_spend_day(p_space_id => %L)', :'sh')),
  'F menandai hari ini di Bersama');
select is(tests.web_val(tests.n(), format($$select marked_by::text from app.no_spend_days where space_id = %L$$, :'sh')),
  tests.f()::text, 'N melihat tanda Bersama dari F');

-- Batas hari: jam dimajukan ke 00:05 WIB hari berikutnya.
select tests.clock_at('2026-11-01 00:05+07');
select lives_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format('select api.mark_no_spend_day(p_space_id => %L)', :'np')),
  'tandai lagi sesudah tengah malam WIB');
select is(tests.web_val(tests.n(), format($$select max(on_date)::text from app.no_spend_days where space_id = %L$$, :'np')),
  '2026-11-01', '00:05 WIB = hari baru');
select is(tests.web_val(tests.n(), format($$select string_agg(on_date::text, ',' order by on_date) from app.no_spend_days
    where space_id = %L$$, :'np')), '2026-10-29,2026-10-31,2026-11-01', 'tiga hari tercatat di Pribadi N');

select * from finish();
rollback;
