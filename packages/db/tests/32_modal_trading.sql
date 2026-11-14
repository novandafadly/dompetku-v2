-- Modal trading S12 (0133, 0134; plan S12 Task 4, K2, K9 = T10): pocket `trading` hanya Pribadi
-- (B10: create_account DK422 pocket_personal_only, CHECK accounts_trading_personal), setor/tarik =
-- transfer satu ruang non-trading <-> trading, app.trading_capital dan api.trading_overview (sisa
-- modal, hasil ditarik, `Kurang` per dompet dan total), void/restore menggeser modal tepat sekali,
-- transfer antar dua dompet trading dan Cocokkan saldo tidak mengubah modal, I6 (Σ pemasukan/
-- pengeluaran, Laporan, anggaran tidak berubah oleh setor/tarik), "aman dipakai" tetap hanya
-- operasional, net_worth menghitung trading, wa_default_account tidak pernah trading, DQ15 nol.
-- Jam dipatok 2026-03-20 WIB.
-- ID: T10, B10, I6
begin;
select plan(40);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 10000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Celengan', 'tabungan', 1000000, '2026-01-01') as tab,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 700000, '2026-01-01') as kan,
       tests.account(tests.n(), :'np', 'Saham', 'trading', 0, '2026-01-01') as tr1,
       tests.account(tests.n(), :'np', 'Kripto', 'trading', 0, '2026-01-01') as tr2 \gset
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja'$q$, :'np'))
  as belanja \gset

create function pg_temp.call(p_sql text) returns jsonb
language sql as $$ select tests.web_val(tests.n(), p_sql)::jsonb $$;
create function pg_temp.xfer(p_from uuid, p_to uuid, p_amount bigint, p_fee bigint default 0,
  p_on date default '2026-03-05') returns uuid
language sql as $$
  select (pg_temp.call(format($q$select api.create_transfer(gen_random_uuid(), %L, %L, %L, %s, %s, %L::date)$q$,
    tests.space_id(tests.n(), 'personal'), p_from, p_to, p_amount, p_fee, p_on)) ->> 'entry_id')::uuid
$$;
create function pg_temp.reconcile(p_acc uuid, p_target bigint) returns jsonb
language sql as $$
  select pg_temp.call(format($q$select api.reconcile_balance(gen_random_uuid(), %L, %s)$q$, p_acc, p_target))
$$;
create function pg_temp.void(p_entry uuid) returns jsonb
language sql as $$
  select pg_temp.call(format($q$select api.void_entry(gen_random_uuid(), %L,
    (select version from app.entries where id = %L), true)$q$, p_entry, p_entry))
$$;
create function pg_temp.restore(p_entry uuid) returns jsonb
language sql as $$
  select pg_temp.call(format($q$select api.restore_entry(gen_random_uuid(), %L,
    (select version from app.entries where id = %L), true)$q$, p_entry, p_entry))
$$;
-- Satu dompet: saldo/setor/tarik/sisa/hasil/kurang/pernah setor.
create function pg_temp.w(p_acc uuid) returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select balance || '/' || capital_in || '/' || capital_out || '/'
      || capital_left || '/' || realized || '/' || shortfall || '/' || has_deposit
    from api.trading_overview(%L) where account_id = %L$q$, tests.space_id(tests.n(), 'personal'), p_acc))
$$;
-- Baris total (account_id NULL).
create function pg_temp.total(p_uid uuid, p_space uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select balance || '/' || capital_in || '/' || capital_out || '/'
      || capital_left || '/' || realized || '/' || shortfall || '/' || has_deposit
    from api.trading_overview(%L) where account_id is null$q$, p_space))
$$;
-- I6: Σ pemasukan/pengeluaran (Laporan), kategori, dan anggaran Maret (dibaca lewat api.*).
create function pg_temp.i6() returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select
      (select coalesce(string_agg(kind || ':' || coalesce(name, '-') || ':' || amount, ',' order by kind, name), '')
         from api.category_summary(%1$L, '2026-03-01', '2026-03-31'))
      || '|' || (select coalesce(string_agg(category_id || ':' || spent || ':' || remaining, ','), '')
         from api.budget_progress(%1$L, '2026-03-01'))
      || '|' || (select coalesce(sum(amount), 0) from app.report_lines
                  where space_id = %1$L and report_class in ('income', 'expense', 'expense_fee'))$q$,
    tests.space_id(tests.n(), 'personal')))
$$;
create function pg_temp.ops() returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select operasional::text from api.safe_to_spend(%L, '2026-03-20')$q$,
    tests.space_id(tests.n(), 'personal')))
$$;

-- ===== B10: dompet trading hanya di Pribadi =====
select throws_ok(format($$select tests.account(tests.n(), %L, 'Saham Bersama', 'trading')$$, :'sh'),
  'DK422', 'pocket_personal_only', 'create_account trading di Bersama ditolak [B10]');
select throws_ok(format($$select tests.raw_exec($q$insert into app.accounts (space_id, space_kind, name, pocket,
    wallet_type, opened_on, created_by) values (%L, 'shared', 'X', 'trading', 'bank', '2026-01-01', %L)$q$)$$,
    :'sh', tests.n()),
  '23514', null, 'CHECK accounts_trading_personal menolak dompet trading Bersama di luar api [B10]');
select throws_ok(format($$select tests.account(tests.n(), %L, 'Sistem', 'patungan')$$, :'np'),
  'DK400', 'invalid_argument', 'pocket patungan (dompet sistem) bukan pilihan create_account');
select throws_ok(format($$select pg_temp.total(tests.n(), %L)$$, :'sh'), 'DK422', 'pocket_personal_only',
  'trading_overview ruang Bersama ditolak [B10]');
select throws_ok(format($$select pg_temp.total(tests.f(), %L)$$, :'np'), 'DK404', 'space_not_found',
  'trading_overview Pribadi orang lain = DK404');
select throws_ok(format($$select pg_temp.total(null, %L)$$, :'np'), 'DK401', 'unauthenticated',
  'trading_overview tanpa konteks = DK401');
select is((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname = 'trading_overview'),
  'TABLE(account_id uuid, name text, balance bigint, capital_in bigint, capital_out bigint, capital_left bigint, realized bigint, shortfall bigint, has_deposit boolean)',
  'kolom hasil trading_overview (dipakai server Task 5)');

-- ===== Keadaan awal =====
select is(pg_temp.total(tests.f(), :'fp'), '0/0/0/0/0/0/false', 'tanpa dompet trading: satu baris total nol');
select is(pg_temp.w(:'tr1'), '0/0/0/0/0/0/false', 'dompet trading baru: belum ada setoran');
select is(tests.web_val(tests.n(), format($$select string_agg(coalesce(name, 'TOTAL'), ',' order by coalesce(name, '~'))
    || ':' || ((array_agg(account_id))[count(*)] is null) from api.trading_overview(%L)$$, :'np')),
  'Kripto,Saham,TOTAL:true', 'satu baris per dompet trading + total (baris terakhir); non-trading tidak ikut');

-- Pengeluaran berkategori + anggaran sebagai pembanding I6.
select pg_temp.call(format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 150000, %L,
  '2026-03-03', null)$$, :'np', :'bca', :'belanja'));
select pg_temp.call(format($$select api.create_entry(gen_random_uuid(), %L, %L, 'income', 9000000, null,
  '2026-03-01', null)$$, :'np', :'bca'));
select tests.web_val(tests.n(), format($$select api.set_budget(%L, %L, '2026-03-01', 500000, false)$$, :'np', :'belanja'));
select pg_temp.i6() as i6_before \gset

-- ===== Setor modal =====
select pg_temp.xfer(:'bca', :'tr1', 5000000) as dep1 \gset
select is(pg_temp.w(:'tr1'), '5000000/5000000/0/5000000/0/0/true', 'setor 5 jt: sisa modal 5 jt, saldo 5 jt, tidak kurang [T10]');
select is(tests.balance(:'bca'), (10000000 - 150000 + 9000000 - 5000000)::bigint, 'saldo BCA turun tepat sekali [T10]');
select is(pg_temp.ops(), tests.balance(:'bca')::text, 'aman dipakai: operasional = saldo BCA saja (trading, tabungan, kantor tidak)');

-- ===== Tarik sebagian =====
select pg_temp.xfer(:'tr1', :'bca', 1000000, 0, '2026-03-08') as wd1 \gset
select is(pg_temp.w(:'tr1'), '4000000/5000000/1000000/4000000/0/0/true', 'tarik 1 jt: sisa = setor − tarik [T10]');

-- ===== `Kurang` tepat di batas (Cocokkan saldo = untung/rugi, tidak mengubah modal) =====
select pg_temp.reconcile(:'tr1', 4000000);
select is(pg_temp.w(:'tr1'), '4000000/5000000/1000000/4000000/0/0/true', 'saldo = sisa modal: tidak kurang');
select pg_temp.reconcile(:'tr1', 3999999);
select is(pg_temp.w(:'tr1'), '3999999/5000000/1000000/4000000/0/1/true', 'saldo 1 rupiah di bawah sisa modal: Kurang 1 [T10]');
select pg_temp.reconcile(:'tr1', 4000000);
select is(pg_temp.w(:'tr1'), '4000000/5000000/1000000/4000000/0/0/true', 'saldo kembali = sisa modal: Kurang hilang [T10]');

-- ===== Tarik lebih dari sisa modal (hasil ditarik) =====
select pg_temp.reconcile(:'tr1', 6000000);
select pg_temp.xfer(:'tr1', :'bca', 4500000, 0, '2026-03-10') as wd2 \gset
select is(pg_temp.w(:'tr1'), '1500000/5000000/5500000/0/500000/0/true', 'tarik 4,5 jt dari sisa 4 jt: sisa 0, hasil ditarik 500 rb [T10]');

-- ===== Void/restore menggeser modal tepat sekali =====
select pg_temp.void(:'wd2');
select is(pg_temp.w(:'tr1'), '6000000/5000000/1000000/4000000/0/0/true', 'tarik dibatalkan: modal dan saldo kembali [T10]');
select pg_temp.void(:'wd1');
select is(pg_temp.w(:'tr1'), '7000000/5000000/0/5000000/0/0/true', 'tarik pertama dibatalkan: sisa = setor');
select pg_temp.restore(:'wd2');
select is(pg_temp.w(:'tr1'), '2500000/5000000/4500000/500000/0/0/true', 'tarik 4,5 jt dipulihkan: dihitung tepat sekali');
select pg_temp.restore(:'wd1');
select is(pg_temp.w(:'tr1'), '1500000/5000000/5500000/0/500000/0/true', 'kedua tarik dipulihkan: kembali ke keadaan semula [T10]');
select pg_temp.void(:'dep1');
select is(pg_temp.w(:'tr1'), '-3500000/0/5500000/0/5500000/3500000/false',
  'setor dibatalkan: tanpa setoran, semua tarik = hasil, sisa tidak negatif; saldo negatif = Kurang (rumus max(0, sisa − saldo))');
select pg_temp.restore(:'dep1');
select is(pg_temp.w(:'tr1'), '1500000/5000000/5500000/0/500000/0/true', 'setor dipulihkan');

-- ===== Transfer antar dua dompet trading tidak dihitung (keputusan pemilik butir 4) =====
select pg_temp.xfer(:'tr1', :'tr2', 1000000, 0, '2026-03-12') as tt \gset
select is(pg_temp.w(:'tr1'), '500000/5000000/5500000/0/500000/0/true', 'trading → trading: modal sumber tetap, saldo turun');
select is(pg_temp.w(:'tr2'), '1000000/0/0/0/0/0/false', 'trading → trading: tujuan tanpa setoran');

-- ===== I6: setor/tarik/void/restore tidak mengubah Laporan, kategori, anggaran =====
select is(pg_temp.i6(), :'i6_before', 'Σ pemasukan/pengeluaran, kategori, dan anggaran Maret tidak berubah [I6]');
select is(tests.web_val(tests.n(), format($$select string_agg(report_class || ':' || direction || ':' || amount, ','
    order by report_class, direction) from api.excluded_summary(%L, '2026-03-01', '2026-03-31')
    where report_class = 'x_transfer'$$, :'np')),
  'x_transfer:in:11500000,x_transfer:out:11500000',
  'setor/tarik di Laporan hanya "Tidak termasuk · Transfer" (5 jt + 1 jt + 4,5 jt + 1 jt antar trading, Σ masuk = keluar)');

-- ===== Total: shortfall = max(0, Σ sisa − Σ saldo), bukan Σ kurang per dompet =====
select pg_temp.xfer(:'bca', :'tr2', 2000000, 2500, '2026-03-14') as dep2 \gset
select is(pg_temp.w(:'tr2'), '3000000/2000000/0/2000000/0/0/true', 'setor dengan biaya: modal = nominal, biaya bukan modal');
select pg_temp.xfer(:'bca', :'tr1', 2000000, 0, '2026-03-15');
select pg_temp.reconcile(:'tr1', 1000000);
select is(pg_temp.w(:'tr1'), '1000000/7000000/5500000/1500000/0/500000/true', 'tr1: sisa 1,5 jt, saldo 1 jt, Kurang 500 rb');
select is(pg_temp.total(tests.n(), :'np'), '4000000/9000000/5500000/3500000/0/0/true',
  'total: Σ sisa 3,5 jt ≤ Σ saldo 4 jt → tidak kurang walau tr1 kurang; realized dari Σ per dompet');
select pg_temp.reconcile(:'tr2', 2499999);
select is(pg_temp.total(tests.n(), :'np'), '3499999/9000000/5500000/3500000/0/1/true',
  'total: Σ saldo 1 rupiah di bawah Σ sisa → Kurang 1 [T10]');

-- Dompet terarsip tidak ikut (saldo 0; modal yang hilang tidak menjadi Kurang selamanya).
select tests.account(tests.n(), :'np', 'Lama', 'trading', 0, '2026-01-01') as tr3 \gset
select pg_temp.xfer(:'bca', :'tr3', 100000, 0, '2026-03-16');
select pg_temp.reconcile(:'tr3', 0);
select pg_temp.call(format($$select api.archive_account(%L)$$, :'tr3'));
select is(pg_temp.total(tests.n(), :'np'), '3499999/9000000/5500000/3500000/0/1/true',
  'dompet trading terarsip (modal hilang, saldo 0) tidak ikut total');
select is(tests.owner_val(null, format($$select capital_left from app.trading_capital where account_id = %L$$, :'tr3')),
  '100000', 'view tetap memuat dompet terarsip (DQ15 memeriksanya)');

-- ===== Aman dipakai, kekayaan bersih, WA bawaan =====
select is(pg_temp.ops(), tests.balance(:'bca')::text, 'aman dipakai tetap hanya operasional sesudah semua gerak trading');
select is(tests.web_val(tests.n(), format($$select total from api.net_worth(%L)$$, :'np')),
  (tests.balance(:'bca') + tests.balance(:'tab') + tests.balance(:'tr1') + tests.balance(:'tr2'))::text,
  'net_worth total = operasional + tabungan + trading (keputusan pemilik), kantor tidak');
-- Pemasukan terakhir N di dompet trading: bawaan WA tetap dompet operasional terakhir dipakai.
select pg_temp.call(format($$select api.create_entry(gen_random_uuid(), %L, %L, 'income', 1000, null,
  '2026-03-18', null)$$, :'np', :'tr1'));
select is(tests.web_val(tests.n(), format($$select api.wa_default_account(%L)$$, :'np')), :'bca',
  'wa_default_account: entri terakhir di dompet trading tidak membuatnya bawaan');
select tests.account(tests.f(), :'fp', 'Saham F', 'trading', 500000, '2026-01-01') as ftr \gset
select is(tests.web_val(tests.f(), format($$select api.wa_default_account(%L)$$, :'fp')), null,
  'wa_default_account: Pribadi hanya berisi dompet trading = tanpa bawaan');
select tests.account(tests.f(), :'fp', 'Celengan F', 'tabungan', 0, '2026-01-01') as ftab \gset
select is(tests.web_val(tests.f(), format($$select api.wa_default_account(%L)$$, :'fp')), :'ftab',
  'wa_default_account: tabungan dipilih, trading dilewati');

-- ===== DQ15 =====
select is(tests.worker_val(null, $$select violations::text from jobs.dq_reconcile() where check_id = 'DQ15'$$),
  '0', 'DQ15: skenario modal trading sah = nol temuan');

select * from finish();
rollback;
