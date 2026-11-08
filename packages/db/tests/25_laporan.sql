-- Fungsi baca Laporan (S9, 0121; plan S9 Task 8, K1, K6, K10; BSD §8.1, §8.2a; Review Focus #2, #4,
-- #5). api.category_summary (per kategori: langsung, induk + anak, tanpa kategori, biaya transfer,
-- permil terhadap Pengeluaran penuh), api.period_trend (arus kas per periode gajian/kalender, lengkap,
-- berjalan, sisa hari, delta pengeluaran), api.excluded_summary (bagian "Tidak termasuk" per kelas x_*
-- dan arah). Angka fixture golden dibandingkan dengan support/golden-s9.json (kunci "laporan"), bukan
-- dihitung ulang; oracle silang ke period_summary, month_summary, dan budget_progress. Catatan review Task 7:
-- realisasi anggaran wajib tidak menghitung bayar tagihan yang kemunculannya di periode lain, jadi oracle
-- budget_progress = root_total hanya berlaku pada golden (tanpa kasus itu); oracle utama = Pengeluaran total.
-- Sesudah golden, tes menambah entri sendiri (tanpa kategori, kanari, Z1, Z9) dengan angka yang dihitung di komentar.
-- Persona N, F, Luar (tests.x(), tanpa ruang).
-- ID: T17, B13, Z1, Z3, Z9, Z10
begin;
select plan(54);
\ir support/golden-s9.sql

create function pg_temp.g(p_path text[]) returns jsonb
language sql as $$ select (current_setting('golden.json')::jsonb) #> p_path $$;
select set_config('golden.json', :'golden', true) is not null as x \gset
-- category_summary sebagai jsonb urut keluaran: id diganti nama induk (root), ikon dibuang.
create function pg_temp.cats(p_uid uuid, p_space uuid, p_from text, p_to text) returns jsonb
language sql as $$
  select tests.web_val(p_uid, format($q$select coalesce(jsonb_agg((to_jsonb(c) - 'o' - 'root_category_id'
        - 'category_id' - 'icon') || jsonb_build_object('root', rc.name) order by c.o), '[]')::text
    from (select s.*, row_number() over () as o from api.category_summary(%L, %L::date, %L::date) s) c
    left join app.categories rc on rc.id = c.root_category_id$q$, p_space, p_from, p_to))::jsonb
$$;
create function pg_temp.trend(p_uid uuid, p_space uuid, p_label text, p_count int, p_basis text)
returns jsonb
language sql as $$
  select tests.web_val(p_uid, format($q$select coalesce(jsonb_agg(to_jsonb(t) order by t.label_month), '[]')::text
    from api.period_trend(%L, %L::date, %s, %L) t$q$, p_space, p_label, p_count, p_basis))::jsonb
$$;
create function pg_temp.excl(p_uid uuid, p_space uuid, p_from text, p_to text) returns jsonb
language sql as $$
  select tests.web_val(p_uid, format($q$select coalesce(jsonb_agg(to_jsonb(x) - 'o' order by x.o), '[]')::text
    from (select e.*, row_number() over () as o from api.excluded_summary(%L, %L::date, %L::date) e) x$q$,
    p_space, p_from, p_to))::jsonb
$$;
-- Ringkas category_summary satu ruang/rentang: kind:nama:amount:pct10 urut keluaran.
create function pg_temp.cats_line(p_uid uuid, p_space uuid, p_from text, p_to text) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select string_agg(s.type || '/' || s.kind || ':' || coalesce(s.name, '-')
      || ':' || s.amount || ':' || s.pct10 || ':' || coalesce(s.archived::text, '-'), ',' order by s.o)
    from (select c.*, row_number() over () as o from api.category_summary(%L, %L::date, %L::date) c) s$q$,
    p_space, p_from, p_to))
$$;

select ok(pg_temp.g('{hari_ini}') = '"2026-11-10"'::jsonb and pg_temp.g('{laporan}') is not null
     and tests.web_val(tests.n(), 'select app.today()') = '2026-11-10',
  'golden-s9.json (kunci laporan) termuat; jam fixture = hari ini golden');

-- ===== Kontrak fungsi =====
select is((select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> '
             || pg_get_function_result(p.oid) || ' ' || p.prosecdef || ' ' || p.provolatile::text || ' '
             || p.proowner::regrole, E'\n' order by p.proname)
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname in ('category_summary', 'period_trend', 'excluded_summary')),
  'category_summary(p_space_id uuid, p_from date, p_to date) -> TABLE(kind text, root_category_id uuid, '
  || 'category_id uuid, type app.category_type, amount bigint, entry_count integer, type_total bigint, '
  || 'pct10 integer, root_total bigint, root_pct10 integer, pct10_in_root integer, name text, icon text, '
  || 'archived boolean) false s dompetku_owner' || E'\n'
  || 'excluded_summary(p_space_id uuid, p_from date, p_to date) -> TABLE(report_class text, direction text, '
  || 'amount bigint, entry_count integer) false s dompetku_owner' || E'\n'
  || 'period_trend(p_space_id uuid, p_label_month date, p_count integer, p_basis text) -> TABLE(label_month '
  || 'date, starts_on date, ends_on date, pemasukan bigint, pengeluaran bigint, selisih bigint, complete '
  || 'boolean, is_current boolean, days_left integer, delta_pengeluaran bigint, holidays_known boolean) '
  || 'false s dompetku_owner',
  'fungsi Laporan: INVOKER, STABLE, milik owner, kolom hasil tetap');

-- ===== Golden: periode gajian Nov (23 Okt..24 Nov), hari ini 10 Nov =====
select is(pg_temp.cats(tests.n(), :'np', '2026-10-23', '2026-11-24'),
  pg_temp.g('{laporan,category_summary,n_pribadi_nov}'),
  'category_summary N Nov: langsung per kategori, induk = langsung + root_total anak, fee tanpa kategori, '
  || 'penyebut = Pengeluaran penuh; talangan/kantor/transfer/setor/batal tidak [T17]');
select is(pg_temp.cats(tests.f(), :'sh', '2026-10-23', '2026-11-24'),
  pg_temp.g('{laporan,category_summary,bersama_nov}'), 'category_summary Bersama Nov (F)');
select is(pg_temp.cats(tests.n(), :'sh', '2026-10-23', '2026-11-24'),
  pg_temp.g('{laporan,category_summary,bersama_nov}'), 'category_summary Bersama Nov (N) = sama');
select is(pg_temp.excl(tests.n(), :'np', '2026-10-23', '2026-11-24'),
  pg_temp.g('{laporan,excluded_summary,n_pribadi_nov}'),
  'excluded_summary N Nov: per kelas x_* dan arah, hanya yang > 0 [T17]');
select is(pg_temp.excl(tests.f(), :'sh', '2026-10-23', '2026-11-24'),
  pg_temp.g('{laporan,excluded_summary,bersama_nov}'), 'excluded_summary Bersama Nov');
select is(pg_temp.trend(tests.n(), :'np', '2026-11-01', 3, 'gajian'),
  pg_temp.g('{laporan,period_trend,n_pribadi_gajian_nov_3}'),
  'period_trend N gajian Sep..Nov: Sep mulai 24 Agu (libur), Nov berjalan 15 hari, delta NULL '
  || '(belum lengkap / Sep memuat entri tertua / Agu kosong) [T17]');
select is(pg_temp.trend(tests.n(), :'np', '2026-11-01', 3, 'kalender'),
  pg_temp.g('{laporan,period_trend,n_pribadi_kalender_nov_3}'),
  'period_trend N kalender Sep..Nov: gaji 23 Okt masuk Okt, Nov berjalan 21 hari');
select is(pg_temp.trend(tests.f(), :'sh', '2026-11-01', 2, 'gajian'),
  pg_temp.g('{laporan,period_trend,bersama_gajian_nov_2}'), 'period_trend Bersama gajian Okt..Nov');
select is(tests.web_val(tests.n(), format($$select count(*) || ' ' || min(label_month) || ' ' || max(label_month)
    from api.period_trend(%L, '2026-11-01')$$, :'np')), '6 2026-06-01 2026-11-01',
  'period_trend bawaan: 6 periode gajian berakhir di label yang diminta');

-- ===== Oracle silang (fungsi lain, bukan rumus ulang) =====
select is(tests.web_val(tests.n(), format($$select
    (select sum(amount) from api.category_summary(%1$L, '2026-10-23', '2026-11-24') where type = 'expense')
    || ' ' || (select max(type_total) from api.category_summary(%1$L, '2026-10-23', '2026-11-24') where type = 'expense')
    || ' ' || (select pengeluaran from api.period_trend(%1$L, '2026-11-01', 1) t)
    || ' ' || (select sum(outflow) from api.period_summary(%1$L, '2026-10-23', '2026-11-24')
               where report_class in ('expense', 'expense_fee'))$$, :'np')),
  '1136500 1136500 1136500 1136500',
  'Σ amount expense = type_total = Pengeluaran period_trend = expense + expense_fee period_summary [T17]');
select is(tests.web_val(tests.n(), format($$select
    (select sum(amount) from api.category_summary(%1$L, '2026-10-23', '2026-11-24') where type = 'income')
    || ' ' || (select pemasukan from api.period_trend(%1$L, '2026-11-01', 1) t)
    || ' ' || (select inflow from api.period_summary(%1$L, '2026-10-23', '2026-11-24') where report_class = 'income')$$,
  :'np')), '8000000 8000000 8000000', 'Σ amount income = Pemasukan period_trend = income period_summary');
select is(tests.web_val(tests.n(), format($$select (sum(pct10) <= 1000 and 1000 - sum(pct10) < count(*))::text
    || ' ' || sum(pct10) from api.category_summary(%L, '2026-10-23', '2026-11-24') where type = 'expense'$$, :'np')),
  'true 997', 'Σ pct10 expense <= 1000, kekurangan < jumlah baris (floor)');
select is(tests.web_val(tests.n(), format($$select count(*) from (
    select root_category_id, max(root_total) as rt, sum(amount) as s
    from api.category_summary(%L, '2026-10-23', '2026-11-24') where kind = 'category'
    group by root_category_id) g where rt <> s$$, :'np')), '0',
  'root_total = Σ amount langsung per kelompok induk');
select is(tests.web_val(tests.n(), format($$select count(*) || ' ' || count(*) filter (where b.spent <> coalesce(c.root_total, 0))
    || ' ' || sum(b.spent)
    from api.budget_progress(%1$L, '2026-11-01') b
    left join (select distinct root_category_id, root_total from api.category_summary(%1$L, '2026-10-23', '2026-11-24')
               where kind = 'category' and type = 'expense') c on c.root_category_id = b.category_id$$, :'np')), '4 0 720000',
  'golden (tanpa bayar tagihan lintas periode): realisasi budget_progress Nov = root_total category_summary [T17]');
select is(tests.web_val(tests.n(), format($$select count(*) || ' ' || count(*) filter (where t.inflow <> t.i or t.outflow <> t.o)
  from (
    select p.report_class, p.inflow, p.outflow,
      coalesce((select amount from api.excluded_summary(%1$L, '2026-10-23', '2026-11-24') e
                where e.report_class = p.report_class and e.direction = 'in'), 0) as i,
      coalesce((select amount from api.excluded_summary(%1$L, '2026-10-23', '2026-11-24') e
                where e.report_class = p.report_class and e.direction = 'out'), 0) as o
    from api.period_summary(%1$L, '2026-10-23', '2026-11-24') p where p.report_class like 'x\_%%') t$$, :'np')), '6 0',
  'excluded_summary: Σ per kelas dan arah = period_summary inflow/outflow');
select is(tests.web_val(tests.n(), format($$select (select t.pemasukan || ' ' || t.pengeluaran || ' ' || t.selisih
    from api.period_trend(%1$L, '2026-11-01', 1, 'kalender') t)
    = (select m.pemasukan || ' ' || m.pengeluaran || ' ' || m.selisih from api.month_summary(%1$L, '2026-11-01') m)$$,
  :'np')), 'true', 'period_trend kalender = month_summary (definisi Pemasukan/Pengeluaran sama)');

-- ===== Jam 26 Nov: periode Nov lengkap, delta (golden) =====
select tests.clock_at('2026-11-26 09:00+07');
select is(pg_temp.trend(tests.n(), :'np', '2026-12-01', 3, 'gajian'),
  pg_temp.g('{laporan,period_trend,n_pribadi_gajian_des_3_pada_26nov}'),
  'jam 26 Nov: Nov lengkap, delta 384.000; Des berjalan sisa 27 hari');
select is(pg_temp.trend(tests.n(), :'np', '2026-11-01', 1, 'gajian'),
  pg_temp.g('{laporan,period_trend,n_pribadi_gajian_nov_1_pada_26nov}'),
  'delta_pengeluaran memakai periode sebelumnya di luar jendela p_count');
select is(pg_temp.trend(tests.f(), :'fp', '2026-11-01', 2, 'gajian'),
  pg_temp.g('{laporan,period_trend,f_pribadi_gajian_nov_2_pada_26nov}'),
  'F: periode sebelumnya tanpa transaksi -> delta NULL');
select tests.clock_at('2026-12-01 09:00+07');
select is(pg_temp.trend(tests.n(), :'np', '2026-11-01', 2, 'kalender'),
  pg_temp.g('{laporan,period_trend,n_pribadi_kalender_nov_2_pada_1des}'),
  'jam 1 Des: kalender Nov lengkap, delta 24.000');

-- ===== Tambahan di luar golden (jam 1 Des, tanggal 26 Nov = periode gajian Des 25 Nov..22 Des) =====
-- N: tanpa kategori pengeluaran 20.000 dan pemasukan 100.000, Makan 30.000, transfer BCA->GoPay 50.000
-- fee 1.500, KANARI-N-KATEGORI 5.000. Pengeluaran = 20.000 + 30.000 + 5.000 + 1.500 = 56.500:
-- Makan floor(530,97) = 530; tanpa kategori floor(353,98) = 353; kanari floor(88,49) = 88; fee
-- floor(26,54) = 26 (Σ 997). Pemasukan tanpa kategori 100.000 = 1000.
select tests.web_val(tests.n(), format(
  $$select api.create_category(gen_random_uuid(), %L, 'expense', 'KANARI-N-KATEGORI', 'Tag') ->> 'category_id'$$,
  :'np')) as c_kanari \gset
select pg_temp.g_entry(tests.n(), :'g_bca', 'expense', 20000, null, '2026-11-26') is not null as x \gset
select pg_temp.g_entry(tests.n(), :'g_bca', 'income', 100000, null, '2026-11-26') is not null as x \gset
select pg_temp.g_entry(tests.n(), :'g_bca', 'expense', 30000, :'c_makan', '2026-11-26') is not null as x \gset
select pg_temp.g_trf(tests.n(), :'g_bca', :'g_gopay', 50000, 1500, '2026-11-26') is not null as x \gset
select pg_temp.g_entry(tests.n(), :'g_bca', 'expense', 5000, :'c_kanari', '2026-11-26') is not null as x \gset
select is(pg_temp.cats_line(tests.n(), :'np', '2026-11-25', '2026-12-22'),
  'expense/category:Makan Siang & Minum:30000:530:false,expense/uncategorized:-:20000:353:-,'
  || 'expense/category:KANARI-N-KATEGORI:5000:88:false,expense/fee:-:1500:26:-,'
  || 'income/uncategorized:-:100000:1000:-',
  'tanpa kategori = baris uncategorized per type (ikut urut besar), fee terakhir, pemasukan sesudah pengeluaran');
select is(tests.web_val(tests.n(), format($$select string_agg(coalesce(root_category_id::text, '-') || ' '
    || coalesce(category_id::text, '-') || ' ' || root_total || ' ' || root_pct10 || ' '
    || coalesce(pct10_in_root::text, '-') || ' ' || coalesce(icon, '-'), ',')
    from api.category_summary(%L, '2026-11-25', '2026-12-22') where kind <> 'category'$$, :'np')),
  '- - 20000 353 - -,- - 1500 26 - -,- - 100000 1000 - -',
  'uncategorized/fee: tanpa id dan ikon, kelompok sendiri (root_total = amount), pct10_in_root NULL');
select is(tests.web_val(tests.n(), format($$select (select sum(amount) from api.category_summary(%1$L, '2026-11-25',
    '2026-12-22') where type = 'expense') || ' ' || pengeluaran || ' ' || pemasukan from api.period_trend(%1$L, '2026-12-01', 1) t$$,
  :'np')), '56500 56500 100000', 'oracle: Σ expense (termasuk tanpa kategori dan fee) = Pengeluaran period_trend');
select tests.web_val(tests.n(), format($$select api.archive_category(%L)$$, :'c_kanari')) is not null as x \gset
select is(pg_temp.cats_line(tests.n(), :'np', '2026-11-25', '2026-12-22'),
  'expense/category:Makan Siang & Minum:30000:530:false,expense/uncategorized:-:20000:353:-,'
  || 'expense/category:KANARI-N-KATEGORI:5000:88:true,expense/fee:-:1500:26:-,'
  || 'income/uncategorized:-:100000:1000:-',
  'kategori terarsip yang punya transaksi tetap dihitung, archived = true');
select is(tests.web_val(tests.n(), format($$select count(*) from api.category_summary(%L, '2027-02-01', '2027-02-28')$$,
  :'np')), '0', 'rentang tanpa transaksi = 0 baris');
select is(pg_temp.excl(tests.n(), :'np', '2027-02-01', '2027-02-28'), '[]'::jsonb, 'excluded_summary kosong = 0 baris');

-- ===== Z1: 31 Okt 23:30 WIB, tanggal bawaan = 31 Okt (periode gajian Nov, kalender Okt) =====
-- Bersama (F) Belanja Dapur 7.000 tanpa tanggal: kalender Okt 0 + 7.000; gajian Nov 120.000 + 7.000.
select tests.clock_at('2026-10-31 23:30+07');
select pg_temp.g_entry(tests.f(), :'g_kas', 'expense', 7000, :'c_dapur', null) as g_z1 \gset
select is(tests.owner_val(null, format($$select occurred_on from app.entries where id = %L$$, :'g_z1')), '2026-10-31',
  'Z1: entri 31 Okt 23:30 WIB bertanggal 31 Okt');
select is(tests.web_val(tests.f(), format($$select pengeluaran || ' ' || is_current || ' ' || days_left || ' ' || complete
    from api.period_trend(%L, '2026-10-01', 1, 'kalender')$$, :'sh')), '7000 true 1 false',
  'Z1/Z10: kalender Okt berjalan, sisa 1 hari pada 31 Okt, entri masuk Okt');
select is(tests.web_val(tests.f(), format($$select pengeluaran || ' ' || is_current || ' ' || days_left
    from api.period_trend(%L, '2026-11-01', 1, 'gajian')$$, :'sh')), '127000 true 25',
  'Z1: gajian Nov (23 Okt..24 Nov) memuat entri 31 Okt, sisa 25 hari');
select is(tests.web_val(tests.f(), format($$select amount from api.category_summary(%L, '2026-10-23', '2026-11-24')$$,
  :'sh')), '127000', 'Z1: category_summary periode Nov memuat entri 31 Okt');

-- ===== Z9: pergantian tahun (31 Des 23:59 -> 1 Jan 00:01 WIB) =====
-- Bersama (F) 11.000 (31 Des) dan 13.000 (1 Jan). Gajian Jan 2027 = 23 Des 2026 (25 Des libur, 24 Des cuti
-- bersama) .. 24 Jan 2027 (25 Jan Senin): keduanya satu periode, 24.000. Gajian Des (25 Nov..22 Des) 0,
-- lengkap; Nov memuat entri tertua Bersama (Z1 31 Okt) -> delta NULL. Kalender: Des 11.000, Jan 13.000;
-- delta Des = 11.000 - Nov kalender (e22 120.000) = -109.000 (Nov tidak memuat 31 Okt).
select tests.clock_at('2026-12-31 23:59+07');
select pg_temp.g_entry(tests.f(), :'g_kas', 'expense', 11000, :'c_dapur', null) is not null as x \gset
select tests.clock_at('2027-01-01 00:01+07');
select pg_temp.g_entry(tests.f(), :'g_kas', 'expense', 13000, :'c_dapur', null) is not null as x \gset
select is(tests.web_val(tests.f(), format($$select string_agg(label_month || ' ' || starts_on || '..' || ends_on || ' '
    || pengeluaran || ' ' || complete || ' ' || is_current || ' ' || coalesce(days_left::text, '-') || ' '
    || coalesce(delta_pengeluaran::text, '-') || ' ' || holidays_known, ',' order by label_month)
    from api.period_trend(%L, '2027-01-01', 2, 'gajian')$$, :'sh')),
  '2026-12-01 2026-11-25..2026-12-22 0 true false - - true,2027-01-01 2026-12-23..2027-01-24 24000 false true 24 - true',
  'Z9 gajian: 31 Des dan 1 Jan satu periode (label Jan 2027, mulai 23 Des)');
select is(tests.web_val(tests.f(), format($$select string_agg(label_month || ' ' || pengeluaran || ' ' || complete || ' '
    || is_current || ' ' || coalesce(days_left::text, '-') || ' ' || coalesce(delta_pengeluaran::text, '-'), ','
    order by label_month) from api.period_trend(%L, '2027-01-01', 2, 'kalender')$$, :'sh')),
  '2026-12-01 11000 true false - -109000,2027-01-01 13000 false true 31 -',
  'Z9 kalender: Des dan Jan terpisah, delta negatif (lebih sedikit dari Nov)');

-- ===== Z3 dan tahun tanpa libur (LP13) =====
select is(tests.web_val(tests.n(), format($$select string_agg(starts_on || '..' || ends_on || ' ' || holidays_known, ','
    order by label_month) from (select * from api.period_trend(%1$L, '2027-02-01', 1, 'kalender')
    union all select * from api.period_trend(%1$L, '2028-02-01', 1, 'kalender')) t$$, :'np')),
  '2027-02-01..2027-02-28 true,2028-02-01..2028-02-29 true', 'Z3: kalender Feb 2027 = 1..28, Feb 2028 (kabisat) = 1..29');
select is(tests.web_val(tests.n(), format($$select string_agg(label_month || ' ' || starts_on || '..' || ends_on || ' '
    || holidays_known || ' ' || complete || ' ' || is_current || ' ' || coalesce(days_left::text, '-'), ','
    order by label_month) from api.period_trend(%L, '2028-02-01', 2, 'gajian')$$, :'np')),
  '2028-01-01 2027-12-23..2028-01-24 false false false -,2028-02-01 2028-01-25..2028-02-24 false false false -',
  'gajian Jan 2028 mulai 23 Des 2027 (25 Sab, 24 cuti bersama), 2028 tanpa data libur = holidays_known false; '
  || 'periode masa depan tidak lengkap dan bukan berjalan');

-- ===== Pembulatan dan urutan (review Task 8) =====
-- Rentang tanpa pengeluaran di golden (5 Sep 2026, sesudah saldo awal 1 Sep). Transportasi langsung 10.000 + Ojek 20.000 = 30.000; biaya
-- transfer 40.000 (lebih besar dari kelompok kategori mana pun). Pengeluaran penuh = 70.000.
-- pct10: Transportasi floor(142,85) = 142, Ojek floor(285,71) = 285, biaya floor(571,42) = 571.
-- root_pct10 Transportasi floor(428,57) = 428 (round 429). pct10_in_root: induk floor(333,3) = 333,
-- Ojek floor(666,6) = 666 (round 667). Biaya tetap terakhir walau nominalnya terbesar.
savepoint bulat;
select pg_temp.g_entry(tests.n(), :'g_bca', 'expense', 10000, :'c_trans', '2026-09-05') is not null as x \gset
select pg_temp.g_entry(tests.n(), :'g_bca', 'expense', 20000, :'c_ojek', '2026-09-05') is not null as x \gset
select pg_temp.g_trf(tests.n(), :'g_bca', :'g_gopay', 1000, 40000, '2026-09-05') is not null as x \gset
select is(pg_temp.cats_line(tests.n(), :'np', '2026-09-05', '2026-09-05'),
  'expense/category:Transportasi:10000:142:false,expense/category:Ojek:20000:285:false,expense/fee:-:40000:571:-',
  'pct10 floor; biaya terakhir per jenis walau nominal terbesar');
select is(tests.web_val(tests.n(), format($$select string_agg(coalesce(name, '-') || ':' || root_pct10 || ':'
    || coalesce(pct10_in_root::text, '-'), ',' order by o) from (select c.*, row_number() over () as o
    from api.category_summary(%L, '2026-09-05', '2026-09-05') c) s$$, :'np')),
  'Transportasi:428:333,Ojek:428:666,-:571:-', 'root_pct10 dan pct10_in_root dibulatkan ke bawah (bukan round)');
rollback to savepoint bulat;

-- ===== Validasi argumen =====
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format($q$select count(*) from api.period_trend(%L, '2026-11-02')$q$, :'np')),
  'DK400', 'invalid_argument', 'period_trend: label bukan tanggal 1 = DK400');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format($q$select count(*) from api.period_trend(%L, '2026-11-01', 13)$q$, :'np')),
  'DK400', 'invalid_argument', 'period_trend: count 13 = DK400');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format($q$select count(*) from api.period_trend(%L, '2026-11-01', 0)$q$, :'np')),
  'DK400', 'invalid_argument', 'period_trend: count 0 = DK400');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format($q$select count(*) from api.period_trend(%L, '2026-11-01', 6, 'minggu')$q$, :'np')),
  'DK400', 'invalid_argument', 'period_trend: basis tidak dikenal = DK400');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format($q$select count(*) from api.category_summary(%L, '2026-11-24', '2026-10-23')$q$, :'np')),
  'DK400', 'invalid_argument', 'category_summary: dari > sampai = DK400');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format($q$select count(*) from api.excluded_summary(%L, null, '2026-10-23')$q$, :'np')),
  'DK400', 'invalid_argument', 'excluded_summary: rentang kosong = DK400');

select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format($q$select count(*) from api.category_summary(%L, '2016-01-01', '2026-01-09')$q$, :'np')),
  'DK400', 'invalid_argument', 'category_summary: selisih 3661 hari = DK400');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format($q$select count(*) from api.excluded_summary(%L, '2016-01-01', '2026-01-09')$q$, :'np')),
  'DK400', 'invalid_argument', 'excluded_summary: selisih 3661 hari = DK400');

-- ===== Ruang orang lain dan Luar = DK404 (B13) =====
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), q), 'DK404', 'space_not_found', t)
from (values
  ('F -> category_summary Pribadi N = DK404', format($q$select count(*) from api.category_summary(%L, '2026-10-23', '2026-11-24')$q$, :'np')),
  ('F -> period_trend Pribadi N = DK404', format($q$select count(*) from api.period_trend(%L, '2026-11-01')$q$, :'np')),
  ('F -> excluded_summary Pribadi N = DK404', format($q$select count(*) from api.excluded_summary(%L, '2026-10-23', '2026-11-24')$q$, :'np'))
) v (t, q);
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.x(), q), 'DK404', 'space_not_found', t)
from (values
  ('Luar -> category_summary Bersama = DK404', format($q$select count(*) from api.category_summary(%L, '2026-10-23', '2026-11-24')$q$, :'sh')),
  ('Luar -> period_trend Bersama = DK404', format($q$select count(*) from api.period_trend(%L, '2026-11-01')$q$, :'sh')),
  ('Luar -> excluded_summary Pribadi N = DK404', format($q$select count(*) from api.excluded_summary(%L, '2026-10-23', '2026-11-24')$q$, :'np'))
) v (t, q);

-- ===== B13: keluaran Laporan Bersama (N dan F) tanpa kanari atau id Pribadi =====
select is(tests.web_val(u.uid, format($$select count(*) from (
    select c::text as x from api.category_summary(%1$L, '2026-01-01', '2027-12-31') c
    union all select t::text from api.period_trend(%1$L, '2027-01-01', 12, 'gajian') t
    union all select t::text from api.period_trend(%1$L, '2027-01-01', 12, 'kalender') t
    union all select e::text from api.excluded_summary(%1$L, '2026-01-01', '2027-12-31') e
  ) s where x like '%%KANARI%%' or x like %2$L or x like %3$L or x like %4$L or x like %5$L$$,
  :'sh', '%' || :'g_bca' || '%', '%' || :'c_makan' || '%', '%' || :'c_kanari' || '%', '%' || :'g_dana' || '%')), '0',
  'B13: Laporan Bersama oleh ' || u.who || ' tanpa kanari, dompet, atau kategori Pribadi')
from (values (tests.n(), 'N'), (tests.f(), 'F')) u (uid, who);

select * from finish();
rollback;
