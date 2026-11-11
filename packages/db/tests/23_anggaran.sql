-- API anggaran (S9, 0119; plan S9 Task 6, K1, K5, K13; BSD §2.2 #1, #2, §8 budget_progress, §9
-- set_budget, delete_budget, §13 #11, #12, #27; Review Focus #1, #5). api.set_budget (upsert, kategori
-- induk pengeluaran aktif di ruang sama, category_not_root eksplisit), api.delete_budget (tanpa baris =
-- no-op), api.copy_budgets (K13: tidak menimpa, wajib bentrok dilewati, terarsip dilewati, idempoten),
-- api.budget_progress dan api.budget_overview (realisasi per LABEL periode gajian, hanya kelas expense,
-- per kategori induk). Angka dihitung tangan.
-- Jam dipatok 2026-11-26 10:00 WIB (Kamis); payday_rule = 25 (diubah di dalam transaksi tes):
-- label Okt = 25 Sep..22 Okt, Nov = 23 Okt..24 Nov, Des = 25 Nov..22 Des (25 Des libur, 24 Des cuti
-- bersama). Persona N, F, Luar (tests.x(), tanpa ruang); kanari KANARI-N-TAGIHAN, KANARI-N-KATEGORI.
-- ID: B1, B2, B13, T13, T17
begin;
select plan(71);
select tests.fixture();
select tests.clock_at('2026-11-26 10:00+07');
select tests.owner_exec(null, 'update app.households set payday_rule = 25');
select tests.raw_exec(format($$insert into auth."user" (id, name, email, "emailVerified")
  values (%L, 'Luar', 'luar@example.test', true)$$, tests.x()));

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

create function pg_temp.cat(p_space uuid, p_name text) returns uuid
language sql as $$
  select tests.owner_val(null, format(
    $q$select id from app.categories where space_id = %L and name = %L and archived_at is null$q$,
    p_space, p_name))::uuid
$$;
create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
-- Galat pernyataan sebagai 'SQLSTATE:pesan:detail', atau 'ok'.
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
create function pg_temp.err(p_uid uuid, p_sql text) returns text
language sql as $$ select pg_temp.raw_err(format('select tests.web_val(%L, %L)', p_uid, p_sql)) $$;
create function pg_temp.set_sql(p_space uuid, p_cat uuid, p_month text, p_amount bigint, p_wajib boolean)
returns text
language sql as $$
  select format($q$select api.set_budget(%L, %L, %L::date, %s, %L::boolean)$q$,
    p_space, p_cat, p_month, coalesce(p_amount::text, 'null'), p_wajib)
$$;
create function pg_temp.set(p_uid uuid, p_space uuid, p_cat uuid, p_month text, p_amount bigint,
  p_wajib boolean default false) returns text
language sql as $$ select pg_temp.err(p_uid, pg_temp.set_sql(p_space, p_cat, p_month, p_amount, p_wajib)) $$;
create function pg_temp.ent(p_uid uuid, p_acc uuid, p_amount bigint, p_cat uuid, p_on date,
  p_reimb boolean default false) returns uuid
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.create_entry(gen_random_uuid(), (select space_id from app.accounts where id = %L),
         %L, 'expense', %s, %L, %L::date, null, %L) ->> 'entry_id'$q$,
    p_acc, p_acc, p_amount, p_cat, p_on, p_reimb))::uuid
$$;
create function pg_temp.bill(p_uid uuid, p_space uuid, p_name text, p_cat uuid, p_day int, p_starts date)
returns uuid
language sql as $$
  select (pg_temp.call(p_uid, format(
    $q$select api.create_bill(gen_random_uuid(), %L, %L, 100000, %L, %s::smallint, %L::date)$q$,
    p_space, p_name, p_cat, p_day, p_starts)) ->> 'bill_id')::uuid
$$;
-- Realisasi: nama:amount:wajib:spent:pct:remaining, urut nama.
create function pg_temp.prog(p_uid uuid, p_space uuid, p_month text) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select coalesce(string_agg(c.name || ':' || p.amount || ':' || p.wajib
      || ':' || p.spent || ':' || p.pct || ':' || p.remaining, ',' order by c.name), '-')
    from api.budget_progress(%L, %L::date) p join app.categories c on c.id = p.category_id$q$, p_space, p_month))
$$;
-- Ringkasan Rencana: nama:budget:wajib:spent:pct:remaining:archived ('-' = NULL), urut keluaran.
create function pg_temp.over(p_uid uuid, p_space uuid, p_month text) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select string_agg(o.name || ':' || coalesce(o.budget::text, '-') || ':'
      || o.wajib || ':' || o.spent || ':' || coalesce(o.pct::text, '-') || ':' || coalesce(o.remaining::text, '-')
      || ':' || o.archived, ',' order by o.n)
    from api.budget_overview(%L, %L::date) with ordinality
      as o (category_id, name, icon, budget, wajib, spent, pct, remaining, archived, n)$q$, p_space, p_month))
$$;
-- Anggaran tersimpan: nama:amount:wajib, urut nama (dibaca owner).
create function pg_temp.rows(p_space uuid, p_month text) returns text
language sql as $$
  select tests.owner_val(null, format($q$select coalesce(string_agg(c.name || ':' || b.amount || ':' || b.wajib,
      ',' order by c.name), '-')
    from app.budgets b join app.categories c on c.id = b.category_id
    where b.space_id = %L and b.month = %L::date$q$, p_space, p_month))
$$;
create function pg_temp.copy(p_uid uuid, p_space uuid, p_from text, p_to text) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select copied || ':' || skipped_existing || ':' || skipped_conflict
      || ':' || skipped_archived from api.copy_budgets(%L, %L::date, %L::date)$q$, p_space, p_from, p_to))
$$;

select pg_temp.cat(:'sh', 'Listrik & Air') as listrik, pg_temp.cat(:'sh', 'Internet') as internet,
       pg_temp.cat(:'sh', 'Belanja Dapur') as dapur, pg_temp.cat(:'sh', 'Sayur & Buah') as sayur,
       pg_temp.cat(:'sh', 'Makan di Luar') as makan, pg_temp.cat(:'sh', 'Bensin & Parkir') as bensin,
       pg_temp.cat(:'sh', 'Kontribusi Farida') as kontrib,
       pg_temp.cat(:'np', 'Transportasi') as ntrans, pg_temp.cat(:'np', 'Langganan') as nlangganan,
       pg_temp.cat(:'fp', 'Transportasi') as ftrans \gset
select pg_temp.call(tests.n(), format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Ojek', 'Motorcycle', %L)$$,
  :'np', :'ntrans')) ->> 'category_id' as nojek \gset
select pg_temp.call(tests.n(), format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'KANARI-N-KATEGORI', 'Receipt')$$,
  :'np')) ->> 'category_id' as nkanari \gset
select pg_temp.call(tests.n(), format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Arsip Kosong', 'Receipt')$$,
  :'sh')) ->> 'category_id' as arsipkosong \gset
select pg_temp.call(tests.n(), format($$select api.archive_category(%L)$$, :'arsipkosong'));
select pg_temp.call(tests.n(), format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Arsip Anggaran', 'Receipt')$$,
  :'sh')) ->> 'category_id' as arsipcat \gset
-- Induk yang kemudian dipindah menjadi anak (belum dipakai kewajiban, jadi pindah boleh).
select pg_temp.call(tests.n(), format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Hobi Rumah', 'House')$$,
  :'sh')) ->> 'category_id' as hobi \gset
select pg_temp.call(tests.n(), format($$select api.update_category(%L, 'Hobi Rumah', 'House', %L)$$, :'hobi', :'dapur'));
select tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 5000000, '2026-01-01') as kas,
       tests.account(tests.n(), :'np', 'BCA', 'operasional', 2000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 500000, '2026-01-01') as kantor,
       tests.account(tests.n(), :'np', 'Celengan', 'tabungan', 0, '2026-01-01') as tab \gset
-- Tagihan: Listrik PLN tanggal 20 (kemunculan 20 Nov, label Nov); Internet tanggal 10 mulai 26 Nov
-- (kemunculan pertama 10 Des, label Des; label Nov kosong); kanari tagihan Pribadi N.
select pg_temp.bill(tests.n(), :'sh', 'Listrik PLN', :'listrik', 20, '2026-11-01') as b_listrik,
       pg_temp.bill(tests.n(), :'sh', 'Internet Rumah', :'internet', 10, '2026-11-26') as b_internet,
       pg_temp.bill(tests.n(), :'np', 'KANARI-N-TAGIHAN', :'nlangganan', 20, '2026-11-01') as b_kanari \gset

-- ===== Hak: fungsi tulis DEFINER milik api, baca INVOKER milik owner =====
select is((select string_agg(p.proname || ':' || p.prosecdef || ':' || p.proowner::regrole, ',' order by p.proname)
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname in ('set_budget', 'delete_budget', 'copy_budgets',
                                                     'budget_progress', 'budget_overview')),
  'budget_overview:false:dompetku_owner,budget_progress:false:dompetku_owner,copy_budgets:true:dompetku_api,'
  || 'delete_budget:true:dompetku_api,set_budget:true:dompetku_api',
  'set/delete/copy DEFINER milik dompetku_api; budget_progress/overview INVOKER milik owner');

-- ===== set_budget: upsert, validasi (BSD §9, §13 #27) =====
select is(pg_temp.set(tests.n(), :'sh', :'dapur', '2026-11-01', 900000), 'ok', 'N mengatur anggaran Belanja Dapur Nov');
select tests.clock_at('2026-11-26 11:00+07');
select is(pg_temp.set(tests.f(), :'sh', :'dapur', '2026-11-01', 1000000, null), 'ok', 'F mengubah anggaran yang sama (wajib NULL)');
select is(tests.owner_val(null, format($$select count(*) || ':' || max(amount) || ':' || bool_or(wajib) || ':'
    || (max(updated_by::text) = %L) || ':' || (max(updated_at) = '2026-11-26 11:00+07'::timestamptz)
  from app.budgets where space_id = %L and category_id = %L$$, tests.f(), :'sh', :'dapur')),
  '1:1000000:false:true:true', 'upsert: satu baris, nominal baru, wajib NULL = false, updated_by/updated_at dari pemanggil dan app.now()');
select tests.clock_at('2026-11-26 10:00+07');
select is(pg_temp.set(tests.n(), :'sh', :'dapur', '2026-11-15', 1000), 'DK400:invalid_argument:month', 'bulan bukan tanggal 1 = DK400 month');
select is(pg_temp.set(tests.n(), :'sh', :'dapur', null, 1000), 'DK400:invalid_argument:month', 'bulan NULL = DK400 month');
select is(pg_temp.set(tests.n(), :'sh', :'dapur', '2026-11-01', 0), 'DK400:invalid_argument:amount', 'nominal 0 = DK400 amount');
select is(pg_temp.set(tests.n(), :'sh', :'dapur', '2026-11-01', null), 'DK400:invalid_argument:amount', 'nominal NULL = DK400 amount');
select is(pg_temp.set(tests.n(), :'sh', :'dapur', '2026-11-01', 10000000000001), 'DK400:invalid_argument:amount',
  'nominal di atas batas = DK400 amount');
select is(pg_temp.set(tests.n(), :'sh', :'kontrib', '2026-11-01', 1000), 'DK404:category_not_found:category_id',
  'kategori pemasukan = DK404 category_not_found');
select is(pg_temp.set(tests.n(), :'sh', :'ntrans', '2026-11-01', 1000), 'DK404:category_not_found:category_id',
  'kategori ruang lain (Pribadi N di Bersama) = DK404 category_not_found');
select is(pg_temp.set(tests.n(), :'sh', gen_random_uuid(), '2026-11-01', 1000), 'DK404:category_not_found:category_id',
  'kategori tidak ada = DK404');
-- Subkategori dan 'induk yang dipindah jadi anak' sah sejak S10 (0125): lihat 27_anggaran_sub.sql.
select is(pg_temp.set(tests.n(), :'sh', :'arsipkosong', '2026-11-01', 1000), 'DK422:category_archived:',
  'kategori terarsip = DK422 category_archived');
select is(pg_temp.rows(:'sh', '2026-11-01'), 'Belanja Dapur:1000000:false', 'penolakan tanpa efek');

-- ===== Satu kewajiban lewat set_budget (Review Focus #1) =====
select is(pg_temp.set(tests.n(), :'sh', :'listrik', '2026-11-01', 100000, true), 'DK422:obligation_double:',
  'anggaran wajib Listrik Nov bentrok dengan tagihan Listrik PLN 20 Nov = obligation_double');
select is(pg_temp.set(tests.n(), :'sh', :'listrik', '2026-11-01', 100000, false), 'ok', 'anggaran tidak wajib boleh');
select is(pg_temp.set(tests.f(), :'sh', :'listrik', '2026-11-01', 100000, true), 'DK422:obligation_double:',
  'upsert menjadi wajib = obligation_double');
select is(pg_temp.rows(:'sh', '2026-11-01'), 'Belanja Dapur:1000000:false,Listrik & Air:100000:false',
  'upsert yang ditolak tidak mengubah baris');
select is(pg_temp.set(tests.n(), :'sh', :'internet', '2026-11-01', 150000, true), 'ok',
  'wajib Internet Nov boleh: tagihan Internet tidak punya kemunculan di label Nov');

-- ===== delete_budget (BSD §9) =====
select is(pg_temp.err(tests.n(), format($$select api.delete_budget(%L, %L, '2026-11-01')$$, :'sh', :'listrik')), 'ok',
  'hapus anggaran Listrik Nov');
select is(pg_temp.err(tests.n(), format($$select api.delete_budget(%L, %L, '2026-11-01')$$, :'sh', :'listrik')), 'ok',
  'hapus lagi tanpa baris = no-op, bukan galat');
select is(pg_temp.err(tests.n(), format($$select api.delete_budget(%L, %L, '2026-11-01')$$, :'sh', :'kontrib')), 'ok',
  'hapus kategori tanpa anggaran = no-op');
select is(pg_temp.rows(:'sh', '2026-11-01'), 'Belanja Dapur:1000000:false,Internet:150000:true',
  'Listrik terhapus, baris lain tetap');

-- ===== Realisasi per label periode gajian (K1, BSD §2.2 #1, #2, T13, T17) =====
select pg_temp.ent(tests.n(), :'kas', 100000, :'dapur', '2026-10-23') is not null as x \gset
select pg_temp.ent(tests.n(), :'kas', 40000, :'dapur', '2026-10-22') is not null as x \gset
select pg_temp.ent(tests.f(), :'kas', 25000, :'sayur', '2026-11-02') is not null as x \gset
select pg_temp.ent(tests.n(), :'kas', 60000, :'dapur', '2026-11-24') is not null as x \gset
select pg_temp.ent(tests.n(), :'kas', 999, :'dapur', '2026-11-03') as e_void \gset
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'e_void'));
select pg_temp.ent(tests.n(), :'kas', 50000, :'bensin', '2026-11-25') is not null as x \gset
-- Tanggal entri dari app.today() (WIB), bukan UTC: 31 Okt 23:30 WIB = 31 Okt; 23 Okt 06:00 WIB
-- (22 Okt 23:00 UTC) = 23 Okt (label Nov); 22 Okt 23:30 WIB = 22 Okt (label Okt).
select tests.clock_at('2026-10-31 23:30+07');
select pg_temp.ent(tests.n(), :'kas', 200000, :'makan', null) is not null as x \gset
select tests.clock_at('2026-10-23 06:00+07');
select pg_temp.ent(tests.f(), :'kas', 110000, :'makan', null) is not null as x \gset
select tests.clock_at('2026-10-22 23:30+07');
select pg_temp.ent(tests.n(), :'kas', 45000, :'makan', null) is not null as x \gset
select tests.clock_at('2026-11-26 10:00+07');
select is(tests.owner_val(null, format($$select string_agg(occurred_on::text, ',' order by occurred_on)
  from app.entries where category_id = %L$$, :'makan')), '2026-10-22,2026-10-23,2026-10-31',
  'tanggal entri dari jam WIB (Z1/T13)');

select is(pg_temp.set(tests.f(), :'sh', :'makan', '2026-11-01', 300000, true), 'ok', 'wajib Makan di Luar Nov (tanpa tagihan)');
select is(pg_temp.set(tests.n(), :'sh', :'bensin', '2026-11-01', 200000), 'ok', 'Bensin Nov');
select is(pg_temp.set(tests.n(), :'sh', :'dapur', '2026-10-01', 50000), 'ok', 'Belanja Dapur Okt');
select is(pg_temp.set(tests.n(), :'sh', :'makan', '2026-10-01', 100000), 'ok', 'Makan di Luar Okt');
select is(pg_temp.set(tests.n(), :'sh', :'arsipcat', '2026-11-01', 10000), 'ok', 'anggaran kategori yang lalu diarsipkan');
select pg_temp.call(tests.n(), format($$select api.archive_category(%L)$$, :'arsipcat'));

select is(pg_temp.prog(tests.n(), :'sh', '2026-11-01'),
  'Arsip Anggaran:10000:false:0:0:10000,Belanja Dapur:1000000:false:185000:18:815000,'
  || 'Bensin & Parkir:200000:false:0:0:200000,Internet:150000:true:0:0:150000,'
  || 'Makan di Luar:300000:true:310000:103:-10000',
  'Nov (23 Okt..24 Nov): 23 Okt + sub Sayur & Buah + 24 Nov masuk; 22 Okt, 25 Nov, batal tidak; pct ke bawah; lewat = remaining negatif');
select is(pg_temp.prog(tests.f(), :'sh', '2026-10-01'),
  'Belanja Dapur:50000:false:40000:80:10000,Makan di Luar:100000:false:45000:45:55000',
  'Okt (25 Sep..22 Okt): 22 Okt dan 22 Okt 23:30 WIB masuk Okt; dibaca F sama');
select is(pg_temp.prog(tests.n(), :'sh', '2026-12-01'), '-', 'Des tanpa anggaran = kosong');
select is(tests.web_val(tests.n(), format($$select count(*) from api.budget_progress(%L, '2026-11-01')$$, :'np')), '0',
  'anggaran Bersama tidak muncul di Pribadi N');
savepoint kal;
select tests.owner_exec(null, 'update app.households set payday_rule = null');
select is(pg_temp.prog(tests.n(), :'sh', '2026-11-01'),
  'Arsip Anggaran:10000:false:0:0:10000,Belanja Dapur:1000000:false:85000:8:915000,'
  || 'Bensin & Parkir:200000:false:50000:25:150000,Internet:150000:true:0:0:150000,'
  || 'Makan di Luar:300000:true:0:0:300000',
  'aturan gajian kosong = bulan kalender (1..30 Nov)');
rollback to savepoint kal;
select is(pg_temp.err(tests.n(), format($$select count(*) from api.budget_progress(%L, '2026-11-02')$$, :'sh')),
  'DK400:invalid_argument:month', 'budget_progress bulan bukan tanggal 1 = DK400');

-- Pribadi N: expense_fee, x_talangan, x_kantor tidak dihitung; sub Ojek menambah Transportasi.
select pg_temp.ent(tests.n(), :'bca', 10000, :'ntrans', '2026-11-03') is not null as x \gset
select pg_temp.ent(tests.n(), :'bca', 5000, :'nojek', '2026-11-04') is not null as x \gset
select pg_temp.ent(tests.n(), :'bca', 70000, :'ntrans', '2026-11-04', true) is not null as x \gset
select pg_temp.ent(tests.n(), :'kantor', 30000, :'ntrans', '2026-11-04') is not null as x \gset
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 100000, 2500, '2026-11-04')$$,
  :'np', :'bca', :'tab')) is not null as x \gset
select is(tests.owner_val(null, format($$select string_agg(distinct report_class, ',' order by report_class)
  from app.report_lines where space_id = %L and occurred_on = '2026-11-04'$$, :'np')),
  'expense,expense_fee,x_kantor,x_talangan,x_transfer', 'fixture Pribadi memuat kelima kelas');
select is(pg_temp.set(tests.n(), :'np', :'ntrans', '2026-11-01', 100000), 'ok', 'anggaran Transportasi Pribadi N');
select is(pg_temp.set(tests.n(), :'np', :'nkanari', '2026-11-01', 50000, true), 'ok', 'anggaran KANARI-N-KATEGORI');
select is(pg_temp.prog(tests.n(), :'np', '2026-11-01'),
  'KANARI-N-KATEGORI:50000:true:0:0:50000,Transportasi:100000:false:15000:15:85000',
  'Pribadi N: hanya expense (10000 + sub 5000); talangan, kantor, fee transfer tidak');

-- ===== budget_overview: layar Rencana =====
select is(pg_temp.over(tests.n(), :'sh', '2026-11-01'),
  'Sewa Rumah:-:false:0:-:-:false,Listrik & Air:-:false:0:-:-:false,Internet:150000:true:0:0:150000:false,'
  || 'Iuran Lingkungan:-:false:0:-:-:false,Belanja Dapur:1000000:false:185000:18:815000:false,'
  || 'Makan di Luar:300000:true:310000:103:-10000:false,Bensin & Parkir:200000:false:0:0:200000:false,'
  || 'Arsip Anggaran:10000:false:0:0:10000:true',
  'overview Nov: induk pengeluaran aktif (tanpa anggaran = NULL), terarsip hanya bila beranggaran; tanpa sub, pemasukan, Hobi Rumah');
select is(pg_temp.over(tests.f(), :'sh', '2026-12-01'),
  'Sewa Rumah:-:false:0:-:-:false,Listrik & Air:-:false:0:-:-:false,Internet:-:false:0:-:-:false,'
  || 'Iuran Lingkungan:-:false:0:-:-:false,Belanja Dapur:-:false:0:-:-:false,'
  || 'Makan di Luar:-:false:0:-:-:false,Bensin & Parkir:-:false:50000:-:-:false',
  'overview Des: realisasi 25 Nov tampil walau tanpa anggaran');
select is(pg_temp.err(tests.n(), format($$select count(*) from api.budget_overview(%L, null)$$, :'sh')),
  'DK400:invalid_argument:month', 'budget_overview bulan NULL = DK400');

-- ===== copy_budgets (K13) =====
select is(pg_temp.set(tests.n(), :'sh', :'bensin', '2026-12-01', 250000), 'ok', 'Bensin Des sudah diatur sebelum salin');
select is(pg_temp.copy(tests.f(), :'sh', '2026-11-01', '2026-12-01'), '2:1:1:1',
  'salin Nov ke Des: Belanja Dapur + Makan (wajib) tersalin, Bensin sudah ada, Internet wajib bentrok tagihan 10 Des, arsip dilewati');
select is(pg_temp.rows(:'sh', '2026-12-01'),
  'Belanja Dapur:1000000:false,Bensin & Parkir:250000:false,Makan di Luar:300000:true',
  'nominal dan wajib sama; Bensin Des tidak ditimpa; Internet dan arsip tidak tersalin');
select is(tests.owner_val(null, format($$select bool_and(updated_by = %L and updated_at = app.now())
  from app.budgets where space_id = %L and month = '2026-12-01' and category_id <> %L$$, tests.f(), :'sh', :'bensin')),
  'true', 'baris salinan: updated_by pemanggil, updated_at app.now()');
select is(pg_temp.copy(tests.n(), :'sh', '2026-11-01', '2026-12-01'), '0:3:1:1', 'dijalankan ulang: copied 0 (idempoten)');
select is(pg_temp.rows(:'sh', '2026-11-01'),
  'Arsip Anggaran:10000:false,Belanja Dapur:1000000:false,Bensin & Parkir:200000:false,Internet:150000:true,Makan di Luar:300000:true',
  'bulan asal tidak berubah');
select is(pg_temp.rows(:'np', '2026-12-01'), '-', 'salin Bersama tidak menyentuh Pribadi');
select is(pg_temp.copy(tests.n(), :'np', '2026-11-01', '2026-12-01'), '2:0:0:0', 'salin Pribadi N Nov ke Des');
select is(pg_temp.rows(:'np', '2026-12-01'), 'KANARI-N-KATEGORI:50000:true,Transportasi:100000:false', 'Pribadi tersalin');
select is(tests.owner_val(null, format($$select count(*) from app.budgets where space_id = %L and month = '2026-12-01'$$, :'sh')),
  '3', 'salin Pribadi tidak menyentuh Bersama');
select is(pg_temp.err(tests.n(), format($$select api.copy_budgets(%L, '2026-11-02', '2026-12-01')$$, :'sh')),
  'DK400:invalid_argument:from_month', 'bulan asal bukan tanggal 1 = DK400');
select is(pg_temp.err(tests.n(), format($$select api.copy_budgets(%L, '2026-11-01', '2026-12-15')$$, :'sh')),
  'DK400:invalid_argument:to_month', 'bulan tujuan bukan tanggal 1 = DK400');
select is(pg_temp.err(tests.n(), format($$select api.copy_budgets(%L, '2026-11-01', '2026-11-01')$$, :'sh')),
  'DK400:invalid_argument:to_month', 'asal = tujuan = DK400');
select is(pg_temp.err(tests.n(), format($$select api.copy_budgets(%L, '2026-11-01', null)$$, :'sh')),
  'DK400:invalid_argument:to_month', 'tujuan NULL = DK400');

-- ===== Isolasi: F ke Pribadi N, Luar ke Bersama = DK404 (BSD §13 #11, #12; review Task 4) =====
select is(pg_temp.set(tests.f(), :'np', :'nlangganan', '2026-11-01', 1, true), 'DK404:space_not_found:',
  'F set_budget wajib di Pribadi N (kategori bertagihan KANARI-N-TAGIHAN) = DK404, bukan obligation_double');
select is(pg_temp.set(tests.f(), :'np', :'ntrans', '2026-11-01', 1), 'DK404:space_not_found:', 'F set_budget Pribadi N = DK404');
select is(pg_temp.set(tests.f(), :'fp', :'ntrans', '2026-11-01', 1), 'DK404:category_not_found:category_id',
  'F set_budget di Pribadi F dengan kategori N = DK404 category_not_found');
select is(pg_temp.err(tests.f(), format($$select api.delete_budget(%L, %L, '2026-11-01')$$, :'np', :'ntrans')),
  'DK404:space_not_found:', 'F delete_budget Pribadi N = DK404');
select is(pg_temp.err(tests.f(), format($$select api.copy_budgets(%L, '2026-11-01', '2027-01-01')$$, :'np')),
  'DK404:space_not_found:', 'F copy_budgets Pribadi N = DK404');
select is(pg_temp.err(tests.f(), format($$select count(*) from api.budget_progress(%L, '2026-11-01')$$, :'np')),
  'DK404:space_not_found:', 'F budget_progress Pribadi N = DK404');
select is(pg_temp.err(tests.f(), format($$select count(*) from api.budget_overview(%L, '2026-11-01')$$, :'np')),
  'DK404:space_not_found:', 'F budget_overview Pribadi N = DK404');
select is(pg_temp.rows(:'np', '2026-11-01'), 'KANARI-N-KATEGORI:50000:true,Transportasi:100000:false',
  'anggaran Pribadi N tidak tersentuh F');
select is(pg_temp.rows(:'np', '2027-01-01'), '-', 'percobaan salin F tanpa efek');
select is(pg_temp.set(tests.x(), :'sh', :'dapur', '2026-11-01', 1), 'DK404:space_not_found:', 'Luar set_budget Bersama = DK404');
select is(pg_temp.err(tests.x(), format($$select api.delete_budget(%L, %L, '2026-11-01')$$, :'sh', :'dapur')),
  'DK404:space_not_found:', 'Luar delete_budget = DK404');
select is(pg_temp.err(tests.x(), format($$select api.copy_budgets(%L, '2026-11-01', '2027-01-01')$$, :'sh')),
  'DK404:space_not_found:', 'Luar copy_budgets = DK404');
select is(pg_temp.err(tests.x(), format($$select count(*) from api.budget_progress(%L, '2026-11-01')$$, :'sh')),
  'DK404:space_not_found:', 'Luar budget_progress = DK404');
select is(pg_temp.err(tests.x(), format($$select count(*) from api.budget_overview(%L, '2026-11-01')$$, :'sh')),
  'DK404:space_not_found:', 'Luar budget_overview = DK404');

-- Keluaran Bersama yang dilihat F tanpa kanari atau id Pribadi N (B13).
select is(tests.web_val(tests.f(), format($$select count(*) from (
    select p::text as x from api.budget_progress(%1$L, '2026-11-01') p
    union all select o::text from api.budget_overview(%1$L, '2026-11-01') o
    union all select o::text from api.budget_overview(%1$L, '2026-12-01') o
    union all select c::text from api.copy_budgets(%1$L, '2026-11-01', '2026-12-01') c
  ) s where x like '%%KANARI-N-%%' or x like %2$L or x like %3$L$$,
  :'sh', '%' || :'nkanari' || '%', '%' || :'ntrans' || '%')), '0',
  'F: progress, overview, dan hasil salin Bersama tanpa kanari Pribadi N');

select * from finish();
rollback;
