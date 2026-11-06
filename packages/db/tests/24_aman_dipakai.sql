-- Aman dipakai lengkap dan laju belanja (S9, 0120; plan S9 Task 7, K1, K7, K12; BSD §8.2, §8.2a,
-- §2.2 #1, #2, #4, #6; Review Focus #2, #3, #4). api.safe_to_spend (create or replace, tanda tangan dan
-- kolom 0102): saldo operasional - tagihan terbuka jatuh tempo <= akhir periode gajian berjalan (termasuk
-- lewat) - sisa anggaran wajib periode berjalan; api.spend_pace (rata-rata harian 30 hari, tagihan lewat
-- jatuh tempo, holidays_known). Semua angka dibandingkan dengan support/golden-s9.json (fixture
-- support/golden-s9.sql, dihitung tangan); tes tidak menghitung ulang rumus.
-- Hari ini 2026-11-10 10:00 WIB, payday_rule 25 (label Nov = 23 Okt..24 Nov), lalu NULL (bulan kalender).
-- Persona N, F, Luar (tests.x(), tanpa ruang).
-- ID: T17, Z10
begin;
select plan(41);
\ir support/golden-s9.sql

create function pg_temp.g(p_path text[]) returns jsonb
language sql as $$ select (current_setting('golden.json')::jsonb) #> p_path $$;
select set_config('golden.json', :'golden', true) is not null as x \gset
-- Keluaran fungsi sebagai jsonb (kolom = kunci), dijalankan sebagai role web untuk user p_uid.
create function pg_temp.sts(p_uid uuid, p_space uuid, p_today text) returns jsonb
language sql as $$
  select tests.web_val(p_uid, format($q$select to_jsonb(s)::text from api.safe_to_spend(%L, %L::date) s$q$,
    p_space, p_today))::jsonb
$$;
create function pg_temp.pace(p_uid uuid, p_space uuid, p_today text) returns jsonb
language sql as $$
  select tests.web_val(p_uid, format($q$select to_jsonb(s)::text from api.spend_pace(%L, %L::date) s$q$,
    p_space, p_today))::jsonb
$$;
create function pg_temp.prog(p_uid uuid, p_space uuid, p_month text) returns jsonb
language sql as $$
  select tests.web_val(p_uid, format($q$select jsonb_agg((to_jsonb(p) - 'category_id')
      || jsonb_build_object('category', c.name) order by c.name)::text
    from api.budget_progress(%L, %L::date) p join app.categories c on c.id = p.category_id$q$,
    p_space, p_month))::jsonb
$$;
create function pg_temp.psum(p_uid uuid, p_space uuid, p_from text, p_to text) returns jsonb
language sql as $$
  select tests.web_val(p_uid, format($q$select jsonb_agg(to_jsonb(p) order by p.report_class)::text
    from api.period_summary(%L, %L::date, %L::date) p$q$, p_space, p_from, p_to))::jsonb
$$;

select ok(pg_temp.g('{hari_ini}') = '"2026-11-10"'::jsonb
     and tests.web_val(tests.n(), 'select app.today()') = '2026-11-10',
  'golden-s9.json termuat; jam fixture = hari ini golden');

-- ===== Kontrak: tanda tangan dan kolom safe_to_spend sama dengan 0102 (dipakai web) =====
select is((select pg_get_function_identity_arguments(p.oid) || ' -> ' || pg_get_function_result(p.oid)
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname = 'safe_to_spend'),
  'p_space_id uuid, p_today date -> TABLE(operasional bigint, bills_until_eom bigint, '
  || 'budget_wajib_remaining bigint, total bigint, per_day bigint, days_left integer, until date)',
  'safe_to_spend: tanda tangan dan kolom hasil tetap (create or replace)');
select is((select pg_get_function_identity_arguments(p.oid) || ' -> ' || pg_get_function_result(p.oid)
             || ' ' || p.prosecdef || ' ' || p.provolatile::text || ' ' || p.proowner::regrole
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname = 'spend_pace'),
  'p_space_id uuid, p_today date -> TABLE(avg_daily bigint, days integer, overdue_bills integer, '
  || 'holidays_known boolean) false s dompetku_owner',
  'spend_pace: INVOKER, STABLE, milik owner');

-- ===== Fixture: keadaan kemunculan tagihan N (lunas, terbuka, dilewati, arsip) =====
select is(tests.owner_val(null, format($$select jsonb_agg(b.name || '|' || s.due_on || '|' ||
      case when s.bill_archived then 'arsip' when s.posted then 'lunas'
           when s.skipped_at is not null then 'dilewati' else 'terbuka' end order by b.name, s.due_on)::text
    from app.bill_schedule s join app.bills b on b.id = s.bill_id where s.space_id = %L$$, :'np'))::jsonb,
  pg_temp.g('{kemunculan_n}'),
  'kemunculan N: bayar batal = terbuka, bayar di muka 20 Des lunas, lewati, arsip, materialisasi s.d. 22 Des');

-- ===== safe_to_spend periode gajian (golden) =====
select is(tests.web_val(tests.n(), format($$select to_jsonb(s)::text from api.safe_to_spend(%L) s$$, :'np'))::jsonb,
  pg_temp.g('{safe_to_spend,n_pribadi}'),
  'N Pribadi hari ini (p_today bawaan = app.today()): tagihan lewat + jatuh tempo <= 24 Nov, wajib Nov [T17]');
select is(pg_temp.sts(tests.n(), :'np', '2026-11-10'), pg_temp.g('{safe_to_spend,n_pribadi}'),
  'p_today eksplisit 10 Nov = bawaan');
select is(pg_temp.sts(tests.n(), :'np', '2026-11-24'), pg_temp.g('{safe_to_spend,n_pribadi_hari_terakhir}'),
  'hari terakhir periode (24 Nov): days_left = 1, per_day = total, tanpa bagi nol [Z10]');
select is(pg_temp.sts(tests.n(), :'np', '2026-11-25'), pg_temp.g('{safe_to_spend,n_pribadi_periode_berikut}'),
  'hari gajian 25 Nov: periode Des s.d. 22 Des, tagihan Des ikut, wajib Des menggantikan wajib Nov');
select is(pg_temp.sts(tests.f(), :'fp', '2026-11-10'), pg_temp.g('{safe_to_spend,f_pribadi}'),
  'F Pribadi: total negatif tetap negatif, per_day dibulatkan ke bawah (-27.334)');
select is(pg_temp.sts(tests.n(), :'sh', '2026-11-10'), pg_temp.g('{safe_to_spend,bersama}'),
  'Bersama oleh N: tanpa tagihan/anggaran = saldo operasional / sisa hari periode');
select is(pg_temp.sts(tests.f(), :'sh', '2026-11-10'), pg_temp.g('{safe_to_spend,bersama}'),
  'Bersama oleh F: angka sama');
select is(pg_temp.sts(tests.n(), :'np', '2026-11-10') ->> 'operasional', '9961000',
  'dompet terarsip bersaldo 0, Kas Kantor, dan tabungan tidak masuk operasional');

-- ===== spend_pace (golden; K7) =====
select is(pg_temp.pace(tests.n(), :'np', null), pg_temp.g('{spend_pace,n_pribadi}'),
  'laju N: Σ expense + expense_fee 11 Okt..9 Nov / 30, tagihan lewat jatuh tempo 3, libur diketahui [T17]');
select is(pg_temp.pace(tests.n(), :'np', '2026-11-10'), pg_temp.g('{spend_pace,n_pribadi}'), 'p_today eksplisit = bawaan');
select is(pg_temp.pace(tests.f(), :'fp', null), pg_temp.g('{spend_pace,f_pribadi}'), 'laju F Pribadi');
select is(pg_temp.pace(tests.f(), :'sh', null), pg_temp.g('{spend_pace,bersama}'), 'laju Bersama');
select is(pg_temp.pace(tests.n(), :'np', '2028-03-15'), pg_temp.g('{spend_pace,n_pribadi_2028}'),
  'tahun tanpa data libur (2028): holidays_known false; semua kemunculan terbuka < hari itu = lewat');

-- ===== Satu sumber: budget_progress dan period_summary pada fixture yang sama (golden) =====
select is(pg_temp.prog(tests.n(), :'np', '2026-11-01'), pg_temp.g('{budget_progress,n_pribadi_2026-11}'),
  'budget_progress label Nov (23 Okt..24 Nov): talangan, kantor, fee, batal tidak; anak Ojek menambah induk [T17]');
select is(pg_temp.prog(tests.n(), :'np', '2026-10-01'), pg_temp.g('{budget_progress,n_pribadi_2026-10}'),
  'budget_progress label Okt (25 Sep..22 Okt)');
select is(pg_temp.prog(tests.n(), :'np', '2026-12-01'), pg_temp.g('{budget_progress,n_pribadi_2026-12}'),
  'budget_progress label Des (25 Nov..22 Des)');
select is(pg_temp.psum(tests.n(), :'np', '2026-10-23', '2026-11-24'), pg_temp.g('{period_summary,n_pribadi_nov}'),
  'period_summary N periode Nov: semua kelas [T17]');
select is(pg_temp.psum(tests.f(), :'sh', '2026-10-23', '2026-11-24'), pg_temp.g('{period_summary,bersama_nov}'),
  'period_summary Bersama periode Nov');

-- ===== Ruang orang lain dan Luar = DK404 =====
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(),
    format($q$select api.safe_to_spend(%L)$q$, :'np')), 'DK404', 'space_not_found', 'F -> safe_to_spend Pribadi N = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(),
    format($q$select api.spend_pace(%L)$q$, :'np')), 'DK404', 'space_not_found', 'F -> spend_pace Pribadi N = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.x(),
    format($q$select api.safe_to_spend(%L)$q$, :'sh')), 'DK404', 'space_not_found', 'Luar -> safe_to_spend Bersama = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.x(),
    format($q$select api.spend_pace(%L)$q$, :'sh')), 'DK404', 'space_not_found', 'Luar -> spend_pace Bersama = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.x(),
    format($q$select api.spend_pace(%L)$q$, :'np')), 'DK404', 'space_not_found', 'Luar -> spend_pace Pribadi N = DK404');

-- ===== Bayar tagihan periode lain tidak memakan anggaran wajib periode ini (review Task 7) =====
-- Angka dihitung tangan dari golden N 10 Nov (total 7.696.000): tagihan TV 300.000 tgl 20, 1..31 Okt
-- (kemunculan 20 Okt terbuka, lewat), anggaran wajib Hiburan Nov 500.000 (sah: TV tanpa kemunculan
-- berlabel Nov). Sebelum bayar: 7.696.000 - 300.000 - 500.000 = 6.896.000. Bayar hari ini dari BCA:
-- operasional -300.000, tagihan -300.000, wajib Hiburan tetap 500.000 -> total tetap 6.896.000.
savepoint tagihan_lampau;
select tests.clock_at('2026-10-01 11:00+07');
select tests.web_val(tests.n(), format($$select api.create_bill(gen_random_uuid(), %L, 'TV', 300000, %L, 20::smallint,
  '2026-10-01', '2026-10-31') ->> 'bill_id'$$, :'np', :'c_hiburan')) as g_tv \gset
select tests.clock_at('2026-11-10 10:00+07');
select tests.web_val(tests.n(), format($$select api.set_budget(%L, %L, '2026-11-01', 500000, true)$$, :'np', :'c_hiburan'))
  is null as x \gset
select is(pg_temp.sts(tests.n(), :'np', null) ->> 'total', '6896000', 'sebelum bayar TV (lewat, label Okt): total 6.896.000');
select tests.web_val(tests.n(), format($$select api.post_bill_occurrence(gen_random_uuid(), %L, %L)$$,
  pg_temp.g_occ(:'g_tv', '2026-10-20'), :'g_bca')) is not null as x \gset
select is(pg_temp.sts(tests.n(), :'np', null) ->> 'total', '6896000',
  'sesudah bayar TV hari ini: total tetap 6.896.000 (bukan 7.196.000)');
select is(tests.web_val(tests.n(), format($$select p.spent || ' ' || p.remaining from api.budget_progress(%L, '2026-11-01') p
    where p.category_id = %L$$, :'np', :'c_hiburan')) || ' ' || tests.web_val(tests.n(), format($$select o.spent || ' '
    || o.remaining from api.budget_overview(%L, '2026-11-01') o where o.category_id = %L$$, :'np', :'c_hiburan')),
  '0 500000 0 500000', 'anggaran wajib: entri bayar tagihan label Okt tidak dihitung (budget_progress = budget_overview)');
select tests.web_val(tests.n(), format($$select api.set_budget(%L, %L, '2026-11-01', 500000, false)$$, :'np', :'c_hiburan'))
  is null as x \gset
select is(tests.web_val(tests.n(), format($$select p.spent || ' ' || p.remaining from api.budget_progress(%L, '2026-11-01') p
    where p.category_id = %L$$, :'np', :'c_hiburan')), '300000 200000',
  'anggaran tidak wajib: realisasi penuh (entri bayar TV ikut)');
rollback to savepoint tagihan_lampau;

-- ===== Batas tanggal (review Task 7): jatuh tempo tepat akhir periode masuk, tepat hari ini belum lewat =====
-- Dua tagihan Hiburan baru (tanpa anggaran wajib Hiburan): 70.000 tgl 24 (= ends_on 24 Nov) dan 30.000
-- tgl 10 (= hari ini). Tagihan 1.400.000 + 70.000 + 30.000 = 1.500.000; tagihan lewat tetap 3.
savepoint batas;
select tests.web_val(tests.n(), format($$select api.create_bill(gen_random_uuid(), %L, 'Batas 24', 70000, %L, 24::smallint,
  '2026-11-10') ->> 'bill_id'$$, :'np', :'c_hiburan')) is not null as x \gset
select tests.web_val(tests.n(), format($$select api.create_bill(gen_random_uuid(), %L, 'Batas 10', 30000, %L, 10::smallint,
  '2026-11-10') ->> 'bill_id'$$, :'np', :'c_hiburan')) is not null as x \gset
select is(pg_temp.sts(tests.n(), :'np', null) ->> 'bills_until_eom', '1500000',
  'kemunculan jatuh tempo tepat 24 Nov (akhir periode) dan hari ini ikut dipotong');
select is(pg_temp.pace(tests.n(), :'np', null) ->> 'overdue_bills', '3', 'jatuh tempo hari ini belum lewat jatuh tempo');
rollback to savepoint batas;

-- ===== Aturan gajian kosong = bulan kalender (BSD §8.2a; regresi 0102) =====
select tests.owner_exec(null, 'update app.households set payday_rule = null');
select is(pg_temp.sts(tests.n(), :'np', null), pg_temp.g('{safe_to_spend,n_pribadi_kalender}'),
  'aturan NULL: sampai 30 Nov, tagihan 28 Nov ikut, wajib atas 1..30 Nov');
select is(pg_temp.sts(tests.n(), :'sh', null), pg_temp.g('{safe_to_spend,bersama_kalender}'),
  'aturan NULL, ruang tanpa tagihan/anggaran: sama dengan rumus bulan kalender 0102');
select is(pg_temp.sts(tests.f(), :'sh', '2026-10-31'), pg_temp.g('{safe_to_spend,bersama_kalender_31okt}'),
  'aturan NULL, 31 Okt: days_left 1, until 31 Okt [Z10]');
select is(pg_temp.prog(tests.n(), :'np', '2026-11-01'), pg_temp.g('{budget_progress,n_pribadi_2026-11_kalender}'),
  'aturan NULL: budget_progress Nov = 1..30 Nov');
select is(pg_temp.pace(tests.n(), :'np', null), pg_temp.g('{spend_pace,n_pribadi_kalender}'),
  'aturan NULL: laju sama, holidays_known true (libur tidak dipakai)');
select is((pg_temp.sts(tests.n(), :'np', null) ->> 'total')::bigint
            - (pg_temp.sts(tests.n(), :'np', null) ->> 'operasional')::bigint
            + (pg_temp.sts(tests.n(), :'np', null) ->> 'bills_until_eom')::bigint
            + (pg_temp.sts(tests.n(), :'np', null) ->> 'budget_wajib_remaining')::bigint,
  0::bigint, 'total = operasional - tagihan - wajib (identitas kolom)');

-- ===== B13: keluaran Bersama tanpa kanari Pribadi =====
select is(tests.web_val(tests.f(), format($$select count(*) from (
    select s::text as x from api.safe_to_spend(%L) s union all select p::text from api.spend_pace(%L) p
  ) t where x like '%%KANARI%%' or x like %L$$, :'sh', :'sh', '%' || :'g_bca' || '%')), '0',
  'safe_to_spend/spend_pace Bersama tanpa kanari atau id dompet Pribadi');
select is(pg_temp.sts(tests.n(), :'np', null) ->> 'until', '2026-11-30', 'sanity: aturan NULL aktif sampai akhir tes');

select * from finish();
rollback;
