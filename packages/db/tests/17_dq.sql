-- Cek kualitas data S7 (0112; data-engineer §3, BSD §10) dan skema pgboss untuk worker.
-- jobs.dq_reconcile = tepat 11 baris (check_id, severity, violations), tanpa nominal: DQ01, DQ03,
-- DQ04, DQ04b, DQ06, DQ07, DQ09, DQ10, DQ11, DQ12, dan DQ13 (S9, 0119: satu kewajiban per label
-- periode gajian, menangkap pergeseran label sesudah payday_rule atau app.holidays berubah). DB bersih dan skenario S7 (transfer, transfer
-- antar ruang, talangan + reimburse sebagian, pindah ruang, batal) = nol temuan. Tiap cek baru
-- diuji positif: data dirusak lewat tests.raw_exec (superuser, session_replication_role = replica,
-- di dalam savepoint yang di-rollback) atau lewat api.* bila keadaannya sah (DQ07, saldo negatif
-- diizinkan). Jam dipatok 2026-03-20 WIB, jadi tiga hari terakhir = 17, 18, 19 Maret.
-- DQ05 (S11, 0131): Σ cicilan hidup per utang <= pokok. DQ15 (S12, 0134): modal trading = Σ transfer.
-- DQ16 (S12, 0136): patungan (dompet sistem = Σ pelunasan belum diterima, Σ bagian = nominal, status entri =
-- status tagihan/pelunasan, entri dompet sistem dirujuk, saldo anggota nol-jumlah).
-- ID: S7, T18
begin;
select plan(63);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

create function pg_temp.dq() returns text
language sql as $$
  select tests.worker_val(null, $q$select string_agg(check_id || '=' || violations, ',' order by check_id)
                                   from jobs.dq_reconcile()$q$)
$$;
-- String hasil yang diharapkan: semua 0 kecuali pasangan 'DQxx=n' yang diberikan.
create function pg_temp.expect(variadic p text[] default '{}') returns text
language sql as $$
  select string_agg(coalesce((select x from unnest(p) x where split_part(x, '=', 1) = c), c || '=0'),
                    ',' order by c)
  from unnest(array['DQ01', 'DQ03', 'DQ04', 'DQ04b', 'DQ05', 'DQ06', 'DQ07', 'DQ09', 'DQ10', 'DQ11',
                    'DQ12', 'DQ13', 'DQ14', 'DQ15', 'DQ16']) c
$$;
create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
create function pg_temp.entry(p_uid uuid, p_acc uuid, p_kind text, p_amount bigint, p_on date,
  p_reimb boolean default false, p_allow boolean default false) returns uuid
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.create_entry(gen_random_uuid(), (select space_id from app.accounts where id = %L),
         %L, %L, %s, null, %L::date, null, %L, %L) ->> 'entry_id'$q$,
    p_acc, p_acc, p_kind, p_amount, p_on, p_reimb, p_allow))::uuid
$$;
create function pg_temp.reimb(p_uid uuid, p_entry uuid, p_acc uuid, p_amount bigint, p_on date)
returns uuid
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.create_reimbursement(gen_random_uuid(), %L, %L, %s, %L::date) ->> 'entry_id'$q$,
    p_entry, p_acc, p_amount, p_on))::uuid
$$;
create function pg_temp.void(p_uid uuid, p_entry uuid) returns jsonb
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.void_entry(gen_random_uuid(), %L, (select version from app.entries where id = %L))$q$,
    p_entry, p_entry))::jsonb
$$;

-- ===== Bentuk keluaran dan hak =====
select is((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'jobs' and p.proname = 'dq_reconcile'),
  'TABLE(check_id text, severity text, violations integer)', 'dq_reconcile: hanya check_id, severity, violations');
select is((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname = 'dq_run'),
  'TABLE(check_id text, severity text, violations integer)', 'dq_run: hanya check_id, severity, violations');
select is(tests.worker_val(null, $$select string_agg(check_id || ':' || severity, ',' order by check_id)
                                  from jobs.dq_reconcile()$$),
  'DQ01:error,DQ03:error,DQ04:error,DQ04b:error,DQ05:error,DQ06:warn,DQ07:warn,DQ09:error,DQ10:warn,DQ11:error,DQ12:error,DQ13:error,DQ14:error,DQ15:error,DQ16:error',
  'tepat 15 cek dengan severity masing-masing');
select is(pg_temp.dq(), pg_temp.expect(), 'DB bersih (fixture, tanpa dompet): nol temuan');
select throws_ok($$select tests.web_val(tests.n(), 'select count(*) from jobs.dq_reconcile()')$$, '42501', null,
  'web tidak bisa menjalankan dq_reconcile');
select throws_ok($$select tests.worker_val(null, 'select count(*) from private.dq_run()')$$, '42501', null,
  'worker tidak bisa memanggil dq_run langsung');
select is((select p.proowner::regrole::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname = 'dq_run'),
  'dompetku_auditor', 'dq_run tetap milik dompetku_auditor');

-- ===== Skenario S7: semua sah, nol temuan =====
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 2000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Celengan', 'tabungan', 500000, '2026-01-01') as tab,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 1000000, '2026-01-01') as kan,
       tests.account(tests.n(), :'np', 'Tipis', 'operasional', 0, '2026-03-01') as tipis,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 300000, '2026-01-01') as kas,
       tests.account(tests.f(), :'fp', 'BCA Farida', 'operasional', 400000, '2026-01-01') as fbca \gset
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and type = 'expense'
  and parent_id is null and archived_at is null order by sort_order, name limit 1$q$, :'sh')) as cat_sh \gset

select pg_temp.entry(tests.n(), :'bca', 'income', 1000000, '2026-03-01') as e_in \gset
select pg_temp.entry(tests.n(), :'bca', 'expense', 50000, '2026-03-10') as e_ex \gset
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 200000, 2500, '2026-03-11')$$,
  :'np', :'bca', :'tab')) ->> 'entry_id' as tr \gset
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 70000, 0, '2026-03-12', 'setor')$$,
  :'np', :'bca', :'kas')) ->> 'entry_id' as st \gset
select pg_temp.entry(tests.n(), :'bca', 'expense', 500000, '2026-03-12', true) as t1 \gset
select pg_temp.reimb(tests.n(), :'t1', :'bca', 300000, '2026-03-15') as r1 \gset
select pg_temp.reimb(tests.n(), :'t1', :'bca', 200000, '2026-03-16') as r2 \gset
select pg_temp.entry(tests.n(), :'kan', 'expense', 80000, '2026-03-13', true) as t2 \gset
select pg_temp.reimb(tests.n(), :'t2', :'kan', 30000, '2026-03-14') as r3 \gset
select pg_temp.entry(tests.f(), :'fbca', 'expense', 100000, '2026-03-10', true) as ft \gset
select pg_temp.entry(tests.n(), :'bca', 'expense', 40000, '2026-03-14') as mv \gset
select pg_temp.call(tests.n(), format($$select api.move_entry_to_space(p_client_id => gen_random_uuid(),
  p_entry_id => %L, p_expected_version => 1, p_to_space_id => %L, p_account_id => %L, p_category_id => %L)$$,
  :'mv', :'sh', :'kas', :'cat_sh')) is not null as moved \gset
select pg_temp.entry(tests.n(), :'bca', 'expense', 10000, '2026-03-18') as vd \gset
select pg_temp.void(tests.n(), :'vd') is not null as voided \gset
select is(pg_temp.dq(), pg_temp.expect(), 'skenario S7 (transfer, antar ruang, talangan, reimburse, pindah, batal): nol temuan');

-- ===== DQ03: bentuk line per kind, hanya entri hidup =====
savepoint s;
select tests.raw_exec(format($$update app.entry_lines set amount = -amount where entry_id = %L and role = 'main'$$, :'e_ex'));
select is(pg_temp.dq(), pg_temp.expect('DQ03=1'), 'DQ03: pengeluaran bernominal positif');
rollback to savepoint s;
select tests.raw_exec(format($$update app.entry_lines set amount = -amount where entry_id = %L and role = 'main'$$, :'vd'));
select is(pg_temp.dq(), pg_temp.expect(), 'DQ03: entri batal yang rusak tidak dihitung');
rollback to savepoint s;
select tests.raw_exec(format($$delete from app.entry_lines where entry_id = %L$$, :'e_in'));
select is(pg_temp.dq(), pg_temp.expect('DQ03=1'), 'DQ03: entri hidup tanpa line');
rollback to savepoint s;
select tests.raw_exec(format($$update app.entry_lines set account_id = %L where entry_id = %L and role = 'counter'$$,
  :'bca', :'tr'));
select is(pg_temp.dq(), pg_temp.expect('DQ03=1'), 'DQ03: transfer ke dompet yang sama (DQ04 tetap 0)');
rollback to savepoint s;
select tests.raw_exec(format($$insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (%L, %L, 'fee', %L, -1000)$$, :'e_ex', :'np', :'bca'));
select is(pg_temp.dq(), pg_temp.expect('DQ03=1'), 'DQ03: pengeluaran ber-line fee');
rollback to savepoint s;
select tests.raw_exec(format($$update app.entry_lines set account_id = %L where entry_id = %L and role = 'fee'$$,
  :'tab', :'tr'));
select is(pg_temp.dq(), pg_temp.expect('DQ03=1'), 'DQ03: fee dari dompet selain dompet asal');
rollback to savepoint s;
select tests.raw_exec(format($$update app.entry_lines set amount = 1 where entry_id = %L and role = 'counter'$$, :'tr'));
select is(pg_temp.dq(), pg_temp.expect('DQ03=1', 'DQ04=1'), 'DQ03: counter transfer bukan −main (DQ04 ikut)');
rollback to savepoint s;
select tests.raw_exec(format($$update app.entry_lines set amount = -amount where entry_id = %L and role = 'main'$$, :'r1'));
select is(pg_temp.dq(), pg_temp.expect('DQ03=1'), 'DQ03: reimburse bernominal negatif');
rollback to savepoint s;
select tests.raw_exec(format($$update app.entry_lines set amount = -amount
  where entry_id = (select id from app.entries where link_id = (select link_id from app.entries where id = %L)
                      and direction = 'in') and role = 'main'$$, :'st'));
select is(pg_temp.dq(), pg_temp.expect('DQ03=1', 'DQ04b=1'), 'DQ03: kaki masuk antar ruang bernominal negatif (DQ04b ikut)');
rollback to savepoint s;
select tests.raw_exec(format($$insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (%L, %L, 'counter', %L, 50000)$$, :'e_ex', :'np', :'tab'));
select is(pg_temp.dq(), pg_temp.expect('DQ03=1'), 'DQ03: pengeluaran ber-line counter');
rollback to savepoint s;

-- ===== DQ07: tabungan negatif sekarang, atau dompet negatif 3 hari WIB terakhir (warn) =====
select pg_temp.entry(tests.n(), :'tab', 'expense', 800000, '2026-03-20', false, true) is not null as x \gset
select is(pg_temp.dq(), pg_temp.expect('DQ07=1'), 'DQ07: tabungan negatif hari ini (api, saldo negatif diizinkan)');
rollback to savepoint s;
select pg_temp.entry(tests.n(), :'tipis', 'expense', 10000, '2026-03-18', false, true) is not null as x \gset
select is(pg_temp.dq(), pg_temp.expect(), 'DQ07: operasional negatif baru 2 hari (18, 19) belum dihitung');
rollback to savepoint s;
select pg_temp.entry(tests.n(), :'tipis', 'expense', 10000, '2026-03-17', false, true) is not null as x \gset
select is(pg_temp.dq(), pg_temp.expect('DQ07=1'), 'DQ07: operasional negatif 17, 18, 19 Maret');
select pg_temp.entry(tests.n(), :'tipis', 'income', 10000, '2026-03-20') is not null as x \gset
select is(pg_temp.dq(), pg_temp.expect('DQ07=1'), 'DQ07: tetap dihitung walau hari ini sudah ditutup');
rollback to savepoint s;
select pg_temp.entry(tests.n(), :'tipis', 'expense', 10000, '2026-03-17', false, true) is not null as x \gset
select pg_temp.entry(tests.n(), :'tipis', 'income', 10000, '2026-03-18') is not null as x \gset
select pg_temp.entry(tests.n(), :'tipis', 'expense', 10000, '2026-03-19', false, true) is not null as x \gset
select is(pg_temp.dq(), pg_temp.expect(), 'DQ07: negatif 17 dan 19 tetapi nol pada 18 = tidak berturut');
rollback to savepoint s;
select pg_temp.entry(tests.n(), :'tab', 'expense', 800000, '2026-03-17', false, true) is not null as x \gset
select pg_temp.entry(tests.n(), :'tipis', 'expense', 10000, '2026-03-17', false, true) is not null as x \gset
select is(pg_temp.dq(), pg_temp.expect('DQ07=2'), 'DQ07: dihitung per dompet (tabungan memenuhi dua syarat = 1)');
rollback to savepoint s;
select pg_temp.entry(tests.n(), :'tipis', 'expense', 10000, '2026-03-17', false, true) as neg \gset
select pg_temp.void(tests.n(), :'neg') is not null as x \gset
select is(pg_temp.dq(), pg_temp.expect(), 'DQ07: entri batal tidak ikut saldo');
rollback to savepoint s;

-- ===== DQ11: reimburse hidup menunjuk talangan hidup reimbursable di ruang yang sama =====
select tests.raw_exec(format($$update app.entries set voided_at = app.now(), voided_by = %L where id = %L$$,
  tests.n(), :'t2'));
select is(pg_temp.dq(), pg_temp.expect('DQ11=1'), 'DQ11: talangan batal dengan reimburse hidup');
rollback to savepoint s;
select tests.raw_exec(format($$update app.entries set reimbursable = false where id = %L$$, :'t1'));
select is(pg_temp.dq(), pg_temp.expect('DQ11=2'), 'DQ11: talangan "Tidak diganti" dengan dua reimburse hidup');
rollback to savepoint s;
select tests.raw_exec(format($$update app.entries set reimburses_entry_id = %L where id = %L$$, :'ft', :'r3'));
select is(pg_temp.dq(), pg_temp.expect('DQ11=1'), 'DQ11: reimburse menunjuk talangan ruang lain (FK dimatikan)');
rollback to savepoint s;
select tests.raw_exec(format($$update app.entries set reimburses_entry_id = %L where id = %L$$, :'e_ex', :'r3'));
select is(pg_temp.dq(), pg_temp.expect('DQ11=1'), 'DQ11: reimburse menunjuk pengeluaran biasa');
rollback to savepoint s;
select tests.raw_exec(format($$update app.entries set reimburses_entry_id = gen_random_uuid() where id = %L$$, :'r3'));
select is(pg_temp.dq(), pg_temp.expect('DQ11=1'), 'DQ11: reimburse menunjuk entri yang tidak ada');
rollback to savepoint s;
select pg_temp.void(tests.n(), :'r3') is not null as x \gset
select pg_temp.void(tests.n(), :'t2') is not null as x \gset
select tests.raw_exec(format($$update app.entries set reimbursable = false where id = %L$$, :'t2'));
select is(pg_temp.dq(), pg_temp.expect(), 'DQ11: reimburse batal tidak dihitung');
rollback to savepoint s;

-- ===== DQ12: Σ reimburse hidup per talangan ≤ nominal talangan =====
select tests.raw_exec(format($$update app.entry_lines set amount = -20000 where entry_id = %L and role = 'main'$$, :'t2'));
select is(pg_temp.dq(), pg_temp.expect('DQ12=1'), 'DQ12: reimburse 30000 melebihi talangan 20000');
rollback to savepoint s;
select tests.raw_exec(format($$update app.entry_lines set amount = -30000 where entry_id = %L and role = 'main'$$, :'t2'));
select is(pg_temp.dq(), pg_temp.expect(), 'DQ12: Σ reimburse = nominal talangan sah');
rollback to savepoint s;
select pg_temp.void(tests.n(), :'r2') is not null as x \gset
select tests.raw_exec(format($$update app.entry_lines set amount = -300000 where entry_id = %L and role = 'main'$$, :'t1'));
select is(pg_temp.dq(), pg_temp.expect(), 'DQ12: reimburse batal tidak ikut Σ');
rollback to savepoint s;
select tests.raw_exec(format($$update app.entry_lines set amount = -250000 where entry_id = %L and role = 'main'$$, :'t1'));
select tests.raw_exec(format($$update app.entry_lines set amount = -10000 where entry_id = %L and role = 'main'$$, :'t2'));
select is(pg_temp.dq(), pg_temp.expect('DQ12=2'), 'DQ12: dihitung per talangan');
rollback to savepoint s;

-- ===== DQ13: satu kewajiban (tagihan aktif + anggaran wajib, label periode gajian; S9, 0119) =====
-- Gajian 25: label Maret = 25 Feb..24 Mar, April = 25 Mar..24 Apr. Tagihan Bersama tanggal 28 mulai
-- 1 Mar (dibuat 20 Mar): kemunculan 28 Mar = label April, jadi anggaran wajib label Maret sah.
select tests.owner_exec(null, 'update app.households set payday_rule = 25');
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Internet'$q$, :'sh')) as k_net,
       tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Listrik & Air'$q$, :'sh')) as k_listrik \gset
select pg_temp.call(tests.n(), format($$select api.create_bill(gen_random_uuid(), %L, 'Internet', 300000, %L, 28::smallint, '2026-03-01')$$,
  :'sh', :'k_net')) is not null as x \gset
select tests.web_val(tests.f(), format($$select api.set_budget(%L, %L, '2026-03-01', 400000, true)$$, :'sh', :'k_net')) is null as x \gset
select tests.web_val(tests.n(), format($$select api.set_budget(%L, %L, '2026-04-01', 400000, false)$$, :'sh', :'k_net')) is null as x \gset
select is(pg_temp.dq(), pg_temp.expect(), 'DQ13: tagihan + anggaran wajib label lain + anggaran tidak wajib label sama = nol temuan');
select tests.owner_exec(null, 'update app.households set payday_rule = null');
select is(pg_temp.dq(), pg_temp.expect('DQ13=1'), 'DQ13: aturan gajian dikosongkan, 28 Mar pindah ke label Maret = bentrok');
select tests.owner_exec(null, 'update app.households set payday_rule = 25');
select is(pg_temp.dq(), pg_temp.expect(), 'DQ13: aturan dikembalikan = nol temuan');
rollback to savepoint s;
select pg_temp.call(tests.n(), format($$select api.create_bill(gen_random_uuid(), %L, 'Listrik', 300000, %L, 10::smallint, '2026-03-01')$$,
  :'sh', :'k_listrik')) is not null as x \gset
select tests.raw_exec(format($$insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by)
  values (%L, %L, '2026-03-01', 1, true, %L), (%L, %L, '2026-04-01', 1, true, %L)$$,
  :'sh', :'k_listrik', tests.n(), :'sh', :'k_listrik', tests.n()));
select is(pg_temp.dq(), pg_temp.expect('DQ13=2'), 'DQ13: trigger dilewati, dua label wajib bentrok tagihan = dihitung per pasangan');
select tests.raw_exec(format($$update app.bills set archived_at = now() where category_id = %L$$, :'k_listrik'));
select is(pg_temp.dq(), pg_temp.expect(), 'DQ13: tagihan terarsip tidak dihitung');
rollback to savepoint s;
-- Label lampau (Februari; hari ini 20 Mar = label Maret) yang bentrok tidak dihitung.
select pg_temp.call(tests.n(), format($$select api.create_bill(gen_random_uuid(), %L, 'Listrik', 300000, %L, 10::smallint, '2026-02-01')$$,
  :'sh', :'k_listrik')) is not null as x \gset
select tests.raw_exec(format($$update app.bills set created_at = '2026-02-01 10:00+07' where category_id = %L$$, :'k_listrik'));
select tests.raw_exec(format($$insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by)
  values (%L, %L, '2026-02-01', 1, true, %L)$$, :'sh', :'k_listrik', tests.n()));
select is(pg_temp.dq(), pg_temp.expect(), 'DQ13: bentrok di label lampau tidak dihitung (hanya label berjalan ke depan)');
rollback to savepoint s;

-- ===== DQ14: pohon anggaran (S10, 0126): rincian tanpa induk, atau Σ rincian > induk =====
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja Dapur'$q$, :'sh')) as k_dapur,
       tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Sayur & Buah'$q$, :'sh')) as k_sayur \gset
select tests.raw_exec(format($$insert into app.budgets (space_id, category_id, month, amount, updated_by)
  values (%L, %L, '2026-03-01', 1000, %L)$$, :'sh', :'k_sayur', tests.n()));
select is(pg_temp.dq(), pg_temp.expect('DQ14=1'), 'DQ14: rincian tanpa anggaran induk di label itu');
select tests.raw_exec(format($$insert into app.budgets (space_id, category_id, month, amount, updated_by)
  values (%L, %L, '2026-03-01', 1000, %L)$$, :'sh', :'k_dapur', tests.n()));
select is(pg_temp.dq(), pg_temp.expect(), 'DQ14: Σ rincian = induk = nol temuan');
select tests.raw_exec(format($$update app.budgets set amount = 999 where category_id = %L$$, :'k_dapur'));
select is(pg_temp.dq(), pg_temp.expect('DQ14=1'), 'DQ14: induk diturunkan di bawah Σ rincian (trigger dilewati)');
select tests.raw_exec(format($$insert into app.budgets (space_id, category_id, month, amount, updated_by)
  values (%L, %L, '2026-04-01', 1000, %L)$$, :'sh', :'k_sayur', tests.n()));
select is(pg_temp.dq(), pg_temp.expect('DQ14=2'), 'DQ14: dihitung per (induk, label)');
rollback to savepoint s;

-- ===== DQ05: sisa utang tidak negatif (S11, 0131): Σ cicilan hidup per utang <= pokok =====
select pg_temp.call(tests.n(), format($$select api.create_debt(gen_random_uuid(), %L, 'borrowed', 100000, 'baru',
  null, 'Budi', %L, '2026-03-02')$$, :'np', :'bca')) ->> 'debt_id' as dq_debt \gset
select pg_temp.call(tests.n(), format($$select api.pay_debt(gen_random_uuid(), %L, %L, 40000, '2026-03-05')$$,
  :'dq_debt', :'bca')) ->> 'entry_id' as dq_pay \gset
select is(pg_temp.dq(), pg_temp.expect(), 'DQ05: utang + cicilan sah = nol temuan');
savepoint s;
select tests.raw_exec(format($$update app.entry_lines set amount = -150000 where entry_id = %L$$, :'dq_pay'));
select is(pg_temp.dq(), pg_temp.expect('DQ05=1'), 'DQ05: Σ cicilan hidup melebihi pokok (sisa negatif)');
select tests.raw_exec(format($$update app.entries set voided_at = now(), voided_by = created_by where id = %L$$, :'dq_pay'));
select is(pg_temp.dq(), pg_temp.expect(), 'DQ05: cicilan batal tidak dihitung');
rollback to savepoint s;

-- ===== DQ15: modal trading = Σ transfer hidup non-trading <-> trading (S12, 0134) =====
select tests.account(tests.n(), :'np', 'Saham', 'trading', 0, '2026-01-01') as dq_tr \gset
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 300000, 0, '2026-03-05')$$,
  :'np', :'bca', :'dq_tr')) ->> 'entry_id' as dq_dep \gset
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 200000, 0, '2026-03-06')$$,
  :'np', :'dq_tr', :'bca'));
select is(pg_temp.dq(), pg_temp.expect(), 'DQ15: setor + tarik sebagian sah = nol temuan');
savepoint s;
select tests.raw_exec(format($$update app.entry_lines set amount = 1 where entry_id = %L and role = 'counter'$$, :'dq_dep'));
select is(pg_temp.dq(), pg_temp.expect('DQ03=1', 'DQ04=1', 'DQ07=1', 'DQ15=1'),
  'DQ15: setoran rusak (counter ≠ −main) = modal tidak konsisten dengan Σ transfer (DQ07: dompet trading jadi negatif)');
rollback to savepoint s;

-- ===== DQ16: patungan (S12, 0136) =====
select pg_temp.call(tests.n(), format($$select api.create_split(gen_random_uuid(), %L, %L, 100000, null, '2026-03-17')$$,
  :'sh', :'bca')) as dq_s \gset
select :'dq_s'::jsonb ->> 'split_id' as dq_split, :'dq_s'::jsonb ->> 'expense_entry_id' as dq_exp \gset
select pg_temp.call(tests.f(), format($$select api.settle_split(gen_random_uuid(), %L, %L, 20000, '2026-03-17')$$,
  :'sh', :'fbca')) ->> 'settlement_id' as dq_t \gset
select is(pg_temp.dq(), pg_temp.expect(), 'DQ16: tagihan patungan + pelunasan menunggu diterima = nol temuan (DQ07 tidak membaca dompet sistem)');
savepoint s;
select tests.raw_exec(format($$update app.split_shares set amount = amount + 1 where split_id = %L and user_id = %L$$,
  :'dq_split', tests.f()));
select is(pg_temp.dq(), pg_temp.expect('DQ16=2'), 'DQ16: Σ bagian ≠ nominal (dan saldo anggota tidak lagi nol-jumlah)');
rollback to savepoint s;
savepoint s;
select tests.raw_exec(format($$update app.entries set voided_at = now(), voided_by = created_by where id = %L$$, :'dq_exp'));
select is(pg_temp.dq(), pg_temp.expect('DQ16=2'), 'DQ16: pengeluaran batal sendiri (status ≠ tagihan; dompet sistem tidak lagi = Σ menunggu)');
rollback to savepoint s;
savepoint s;
select tests.raw_exec(format($$update app.settlements set voided_at = now(), voided_by = from_user where id = %L$$, :'dq_t'));
select is(pg_temp.dq(), pg_temp.expect('DQ16=3'), 'DQ16: pelunasan batal tanpa entri (status, saldo dompet sistem, entri tak dirujuk)');
rollback to savepoint s;

-- Sesudah semua rollback: kembali nol temuan.
select is(pg_temp.dq(), pg_temp.expect(), 'sesudah rollback savepoint: nol temuan');

-- ===== Skema pgboss untuk worker (pg-boss membuat tabelnya sendiri) =====
select has_schema('pgboss', 'skema pgboss ada');
select is((select nspowner::regrole::text from pg_namespace where nspname = 'pgboss'), 'dompetku_owner',
  'pgboss milik dompetku_owner');
select ok(has_schema_privilege('dompetku_worker', 'pgboss', 'USAGE')
          and has_schema_privilege('dompetku_worker', 'pgboss', 'CREATE'), 'worker punya USAGE dan CREATE di pgboss');
select ok(not has_database_privilege('dompetku_worker', current_database(), 'CREATE'),
  'worker tidak punya CREATE di database');
select is_empty($$
  select r from unnest(array['dompetku_web', 'dompetku_api', 'dompetku_auditor', 'dompetku_monitor']) r,
                unnest(array['USAGE', 'CREATE']) p
  where has_schema_privilege(r, 'pgboss', p) $$,
  'web, api, auditor, monitor tanpa hak di pgboss');
select lives_ok($$select tests.worker_exec(null, 'create table pgboss.coba (id int)')$$,
  'worker bisa membuat tabel di pgboss');
select is((select c.relowner::regrole::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'pgboss' and c.relname = 'coba'), 'dompetku_worker',
  'tabel pgboss milik worker');
select throws_ok($$select tests.worker_exec(null, 'create schema pgboss_lain')$$, '42501', null,
  'worker tidak bisa membuat skema');

select * from finish();
rollback;
