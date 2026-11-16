-- Saham S14 (0142; plan S14 Task 4, K2, K6, K7, K11, K13 (d)(h); ruling pengendali Task 1): lot saham IDX di
-- dompet aset ber-`asset_kind = 'saham'` (hanya Pribadi). app.stock_holdings (kode 4 huruf, satu per dompet x
-- kode, FK komposit ke rincian aset berjenis saham), app.stock_trades (beli/jual/saham berjalan, lembar, harga
-- per lembar, biaya, pajak, cost_removed wajib untuk jual, seq urutan), tautan app.entries.stock_trade_id
-- (CHECK kind transfer/valuation/opening_balance, Pribadi, satu entri per kind per trade), view
-- app.stock_positions (lembar, biaya perolehan, harga rata-rata floor, untung/rugi terealisasi),
-- private.stock_cost_removed (K6: floor(biaya · jual / pegang), jual habis = seluruh sisa biaya), penutupan
-- jalur generik ke/dari dompet saham (private.tg_stock_guard + private.stock_ctx, DK422
-- stock_account_trade_only), modal trading K7 (transfer dompet trading <-> dompet saham internal, `Kurang` total
-- = Σ sisa modal − Σ saldo trading − Σ biaya perolehan saham), DQ18, isolasi.
-- Fungsi api beli/jual/saham berjalan baru ada di 0143 (Task 5): di sini trade dan entrinya ditulis langsung
-- sebagai dompetku_api di dalam konteks private.stock_ctx, bentuknya sama dengan yang akan ditulis fungsi
-- DEFINER (beli = transfer dompet sumber -> dompet saham sebesar lembar·harga + biaya; jual = valuasi
-- proceeds − cost_removed (tanpa entri bila 0) lalu transfer dompet saham -> tujuan sebesar proceeds;
-- saham berjalan = opening_balance tanpa efek kas). Jam dipatok 2026-03-20 WIB.
-- ID: T11, T10, I6, B24
begin;
select plan(89);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 100000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'RDN', 'trading', 0, '2026-01-01') as rdn,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 1000000, '2026-01-01') as kas \gset

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
create function pg_temp.asset(p_uid uuid, p_space uuid, p_name text, p_kind text) returns uuid
language sql as $$
  select (pg_temp.call(p_uid, format($q$select api.create_account(gen_random_uuid(), %L, %L, 'aset', null,
    '2026-01-01', 0, %L)$q$, p_space, p_name, p_kind)) ->> 'account_id')::uuid
$$;
select pg_temp.asset(tests.n(), :'np', 'Sekuritas', 'saham') as sek,
       pg_temp.asset(tests.n(), :'np', 'Emas', 'emas') as emas,
       pg_temp.asset(tests.f(), :'fp', 'Sekuritas F', 'saham') as fsek \gset
create function pg_temp.xfer(p_from uuid, p_to uuid, p_amount bigint, p_on date default '2026-03-01') returns uuid
language sql as $$
  select (pg_temp.call(tests.n(), format($q$select api.create_transfer(gen_random_uuid(),
      (select space_id from app.accounts where id = %1$L), %1$L, %2$L, %3$s, 0, %4$L::date)$q$,
    p_from, p_to, p_amount, p_on)) ->> 'entry_id')::uuid
$$;
-- Holding ditulis sebagai dompetku_api (jalur fungsi DEFINER 0143).
create function pg_temp.holding(p_uid uuid, p_acc uuid, p_ticker text) returns uuid
language sql as $$
  select tests.api_val(p_uid, format($q$insert into app.stock_holdings (space_id, account_id, ticker, created_by)
      select a.space_id, a.id, %L, %L from app.accounts a where a.id = %L returning id$q$, p_ticker, p_uid, p_acc))::uuid
$$;
-- Trade + entrinya dalam satu transaksi di konteks private.stock_ctx (bentuk fungsi 0143). Kembalikan id trade.
create function pg_temp.trade(p_holding uuid, p_side text, p_shares bigint, p_price bigint, p_fee bigint default 0,
  p_tax bigint default 0, p_cash uuid default null, p_on date default '2026-03-10', p_uid uuid default null)
returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  perform tests.api_exec(coalesce(p_uid, tests.n()), format($q$do $d$
    declare
      v_t uuid := %1$L; v_h uuid := %2$L; v_side text := %3$L; v_sh bigint := %4$s; v_pr bigint := %5$s;
      v_fee bigint := %6$s; v_tax bigint := %7$s; v_cash uuid := %8$L; v_on date := %9$L; v_uid uuid := %10$L;
      v_sp uuid; v_acc uuid; v_cr bigint; v_net bigint; v_e uuid;
    begin
      set constraints all deferred;
      insert into private.stock_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
      select h.space_id, h.account_id into v_sp, v_acc from app.stock_holdings h where h.id = v_h;
      if v_side = 'sell' then
        v_cr := private.stock_cost_removed(v_h, v_sh);
      end if;
      insert into app.stock_trades (id, space_id, holding_id, side, shares, price, fee, tax, cost_removed,
                                    occurred_on, created_by)
      values (v_t, v_sp, v_h, v_side, v_sh, v_pr, v_fee, v_tax, v_cr, v_on, v_uid);
      if v_side = 'opening' then
        v_e := gen_random_uuid();
        insert into app.entries (id, space_id, space_kind, kind, occurred_on, stock_trade_id, created_by, updated_by)
        values (v_e, v_sp, 'personal', 'opening_balance', v_on, v_t, v_uid, v_uid);
        insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
        values (v_e, v_sp, 'main', v_acc, v_sh * v_pr);
        perform private.write_history(v_e, 'create', v_uid);
      elsif v_side = 'buy' then
        v_e := gen_random_uuid();
        insert into app.entries (id, space_id, space_kind, kind, occurred_on, stock_trade_id, created_by, updated_by)
        values (v_e, v_sp, 'personal', 'transfer', v_on, v_t, v_uid, v_uid);
        insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
        values (v_e, v_sp, 'main', v_cash, -(v_sh * v_pr + v_fee)), (v_e, v_sp, 'counter', v_acc, v_sh * v_pr + v_fee);
        perform private.write_history(v_e, 'create', v_uid);
      else
        v_net := v_sh * v_pr - v_fee - v_tax;
        if v_net - v_cr <> 0 then
          v_e := gen_random_uuid();
          insert into app.entries (id, space_id, space_kind, kind, occurred_on, stock_trade_id, created_by, updated_by)
          values (v_e, v_sp, 'personal', 'valuation', v_on, v_t, v_uid, v_uid);
          insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
          values (v_e, v_sp, 'main', v_acc, v_net - v_cr);
          perform private.write_history(v_e, 'create', v_uid);
        end if;
        v_e := gen_random_uuid();
        insert into app.entries (id, space_id, space_kind, kind, occurred_on, stock_trade_id, created_by, updated_by)
        values (v_e, v_sp, 'personal', 'transfer', v_on, v_t, v_uid, v_uid);
        insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
        values (v_e, v_sp, 'main', v_acc, -v_net), (v_e, v_sp, 'counter', v_cash, v_net);
        perform private.write_history(v_e, 'create', v_uid);
      end if;
      delete from private.stock_ctx where xid = pg_catalog.pg_current_xact_id();
      set constraints all immediate;
    end $d$ $q$, v, p_holding, p_side, p_shares, p_price, p_fee, p_tax, p_cash, p_on, coalesce(p_uid, tests.n())));
  return v;
end $$;
-- Posisi satu holding: lembar/biaya/rata-rata/terealisasi (dibaca web, RLS pemanggil).
create function pg_temp.pos(p_holding uuid, p_uid uuid default null) returns text
language sql as $$
  select tests.web_val(coalesce(p_uid, tests.n()), format($q$select shares || '/' || cost_total || '/'
      || coalesce(avg_cost::text, '-') || '/' || realized from app.stock_positions where holding_id = %L$q$, p_holding))
$$;
create function pg_temp.dq(p_check text) returns text
language sql as $$
  select tests.worker_val(null, format($q$select violations::text from jobs.dq_reconcile() where check_id = %L$q$, p_check))
$$;
-- Baris total modal trading: saldo/sisa modal/kurang/biaya saham; dan satu dompet: setor/tarik/kurang.
create function pg_temp.total() returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select balance || '/' || capital_left || '/' || shortfall || '/' || stock_cost
    from api.trading_overview(%L) where account_id is null$q$, tests.space_id(tests.n(), 'personal')))
$$;
create function pg_temp.w(p_acc uuid) returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select capital_in || '/' || capital_out || '/' || shortfall || '/'
      || coalesce(stock_cost::text, 'null') from api.trading_overview(%L) where account_id = %L$q$,
    tests.space_id(tests.n(), 'personal'), p_acc))
$$;
create function pg_temp.i6() returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select coalesce(sum(amount), 0)::text from app.report_lines
    where space_id = %L and report_class in ('income', 'expense', 'expense_fee')$q$, tests.space_id(tests.n(), 'personal')))
$$;

-- ===== Skema =====
select has_table('app', 'stock_holdings', 'tabel app.stock_holdings ada');
select has_table('app', 'stock_trades', 'tabel app.stock_trades ada');
select has_view('app', 'stock_positions', 'view app.stock_positions ada');
select is((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
           from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname = 'stock_holdings' and a.attnum > 0 and not a.attisdropped),
  'id:uuid:true,space_id:uuid:true,account_id:uuid:true,asset_kind:text:true,ticker:text:true,'
  || 'created_by:uuid:true,created_at:timestamp with time zone:true',
  'kolom stock_holdings');
select is((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
           from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname = 'stock_trades' and a.attnum > 0 and not a.attisdropped),
  'id:uuid:true,seq:bigint:true,space_id:uuid:true,holding_id:uuid:true,side:text:true,shares:bigint:true,'
  || 'price:bigint:true,fee:bigint:true,tax:bigint:true,cost_removed:bigint:false,occurred_on:date:true,'
  || 'created_by:uuid:true,created_at:timestamp with time zone:true,voided_at:timestamp with time zone:false,'
  || 'voided_by:uuid:false',
  'kolom stock_trades');
select is((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
           from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname = 'stock_positions' and a.attnum > 0),
  'space_id:uuid,account_id:uuid,holding_id:uuid,ticker:text,shares:bigint,cost_total:bigint,avg_cost:bigint,realized:bigint',
  'kolom stock_positions');
select is((select reloptions::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname = 'stock_positions'), '{security_invoker=true}',
  'stock_positions security_invoker (RLS pemanggil)');
select is((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname = 'trading_overview'),
  'TABLE(account_id uuid, name text, balance bigint, capital_in bigint, capital_out bigint, capital_left bigint, realized bigint, shortfall bigint, has_deposit boolean, stock_cost bigint)',
  'trading_overview + kolom stock_cost di akhir (K7)');

-- Holding: kode 4 huruf kapital, hanya dompet saham, satu per dompet x kode.
select pg_temp.holding(tests.n(), :'sek', 'BBCA') as bbca, pg_temp.holding(tests.n(), :'sek', 'TLKM') as tlkm \gset
select throws_ok(format($$select pg_temp.holding(tests.n(), %L, 'bbca')$$, :'sek'), '23514', null, 'kode huruf kecil ditolak');
select throws_ok(format($$select pg_temp.holding(tests.n(), %L, 'BBC')$$, :'sek'), '23514', null, 'kode 3 huruf ditolak');
select throws_ok(format($$select pg_temp.holding(tests.n(), %L, 'BBCA1')$$, :'sek'), '23514', null, 'kode 5 karakter ditolak');
select throws_ok(format($$select pg_temp.holding(tests.n(), %L, 'BÉCA')$$, :'sek'), '23514', null, 'huruf non-ASCII ditolak');
select throws_ok(format($$select pg_temp.holding(tests.n(), %L, 'BBCA')$$, :'sek'), '23505', null, 'kode sama di dompet sama ditolak');
select throws_ok(format($$select pg_temp.holding(tests.n(), %L, 'ANTM')$$, :'emas'), '23503', null,
  'holding di dompet aset bukan saham ditolak (FK ke rincian berjenis saham)');
select throws_ok(format($$select pg_temp.holding(tests.n(), %L, 'ANTM')$$, :'bca'), '23503', null,
  'holding di dompet biasa ditolak');

-- CHECK trade (ditulis langsung; konteks tidak dibutuhkan untuk tabel trade).
create function pg_temp.raw_trade(p_side text, p_shares bigint, p_price bigint, p_fee bigint, p_tax bigint,
  p_cr bigint) returns bigint
language sql as $$
  select tests.api_exec(tests.n(), format($q$insert into app.stock_trades (space_id, holding_id, side, shares, price,
      fee, tax, cost_removed, occurred_on, created_by) values (%L, %L, %L, %s, %s, %s, %s, %s, '2026-03-10', %L)$q$,
    tests.space_id(tests.n(), 'personal'),
    (select tests.owner_val(null, 'select id from app.stock_holdings where ticker = ''BBCA''')),
    p_side, p_shares, p_price, p_fee, p_tax, coalesce(p_cr::text, 'null'), tests.n()))
$$;
savepoint s;
select throws_ok($$select pg_temp.raw_trade('buy', 0, 1000, 0, 0, null)$$, '23514', null, 'lembar 0 ditolak');
select throws_ok($$select pg_temp.raw_trade('buy', 100, 0, 0, 0, null)$$, '23514', null, 'harga 0 ditolak');
select throws_ok($$select pg_temp.raw_trade('buy', 1, 1000000001, 0, 0, null)$$, '23514', null, 'harga > 10^9 ditolak');
select lives_ok($$select pg_temp.raw_trade('buy', 1, 1000000000, 0, 0, null)$$, 'harga 10^9 tepat diterima');
select throws_ok($$select pg_temp.raw_trade('buy', 100, 1000, -1, 0, null)$$, '23514', null, 'biaya negatif ditolak');
select throws_ok($$select pg_temp.raw_trade('buy', 100, 1000, 0, 100, null)$$, '23514', null, 'pajak hanya untuk jual');
select throws_ok($$select pg_temp.raw_trade('buy', 100, 1000, 0, 0, 5)$$, '23514', null, 'cost_removed hanya untuk jual');
select throws_ok($$select pg_temp.raw_trade('sell', 100, 1000, 0, 0, null)$$, '23514', null, 'jual wajib cost_removed');
select throws_ok($$select pg_temp.raw_trade('opening', 100, 1000, 10, 0, null)$$, '23514', null, 'saham berjalan tanpa biaya');
select throws_ok($$select pg_temp.raw_trade('sell', 1, 1000, 600, 400, 0)$$, '23514', null,
  'jual dengan biaya + pajak >= nilai jual ditolak (hasil harus > 0)');
select throws_ok($$select pg_temp.raw_trade('buy', 10000000, 1000000000, 0, 0, null)$$, '23514', null,
  'lembar x harga > 10^13 ditolak (tanpa overflow)');
select throws_ok($$select pg_temp.raw_trade('rights', 100, 1000, 0, 0, null)$$, '23514', null, 'sisi tidak dikenal ditolak');
rollback to savepoint s;

-- ===== Modal trading sebelum saham (K7) =====
select pg_temp.xfer(:'bca', :'rdn', 50000000) as dep \gset
select pg_temp.i6() as i6_before \gset
select is(pg_temp.total(), '50000000/50000000/0/0', 'setor modal 50 jt, belum ada saham: biaya saham 0');

-- ===== Posisi (K6) =====
select pg_temp.trade(:'bbca', 'buy', 200, 9000, 2700, 0, :'rdn', '2026-03-02') as b1 \gset
select is(pg_temp.pos(:'bbca'), '200/1802700/9013/0', 'beli 200 @ 9.000 + biaya 2.700: biaya masuk harga pokok, rata-rata floor 9.013,5 [T11]');
select is(tests.balance(:'sek'), 1802700::bigint, 'saldo buku dompet saham = biaya perolehan');
select is(tests.balance(:'rdn'), 48197300::bigint, 'dompet sumber berkurang lembar x harga + biaya');
select is(pg_temp.w(:'rdn'), '50000000/0/1802700/null', 'beli dari dompet trading bukan tarik modal (K7); Kurang per dompet tetap rumus lama [T10]');
select is(pg_temp.total(), '48197300/50000000/0/1802700', 'Kurang total memperhitungkan biaya perolehan saham (K7) [T10]');

select pg_temp.trade(:'bbca', 'buy', 100, 9600, 1441, 0, :'bca', '2026-03-03') as b2 \gset
select is(pg_temp.pos(:'bbca'), '300/2764141/9213/0', 'beli kedua beda harga: biaya rata-rata tertimbang, floor [T11]');
select is(pg_temp.total(), '48197300/50000000/0/2764141', 'beli dari dompet non-trading: modal tidak bergerak, biaya saham ikut total');

select pg_temp.trade(:'tlkm', 'opening', 500, 3200, 0, 0, null, '2026-03-01') as o1 \gset
select is(pg_temp.pos(:'tlkm'), '500/1600000/3200/0', 'saham berjalan: posisi dari harga rata-rata, tanpa biaya [T11]');
select is(tests.balance(:'bca'), (100000000 - 50000000 - 961441)::bigint, 'saham berjalan tanpa efek kas (BCA hanya turun oleh beli kedua)');
select is(tests.balance(:'sek'), 4364141::bigint, 'saldo buku dompet saham = Σ biaya kedua kode');

-- K6: cost_removed = floor(biaya · jual / pegang), jual habis = seluruh sisa biaya.
select is(tests.api_val(tests.n(), format($$select private.stock_cost_removed(%L, 100) || '/'
    || private.stock_cost_removed(%L, 300) || '/' || private.stock_cost_removed(%L, 1)$$, :'bbca', :'bbca', :'tlkm')),
  '921380/2764141/3200', 'cost_removed: floor 921.380,33 → 921.380; jual habis = seluruh biaya; 1 lembar TLKM = 3.200');
select throws_ok(format($$select tests.api_val(tests.n(), $q$select private.stock_cost_removed(%L, 301)$q$)$$, :'bbca'),
  'DK422', 'insufficient_shares', 'jual melebihi lembar ditolak [T11]');
select throws_ok(format($$select tests.api_val(tests.n(), $q$select private.stock_cost_removed(%L, 0)$q$)$$, :'bbca'),
  'DK400', 'invalid_argument', 'jual 0 lembar ditolak');
select throws_ok(format($$select tests.api_val(tests.f(), $q$select private.stock_cost_removed(%L, 1)$q$)$$, :'bbca'),
  'DK404', 'holding_not_found', 'holding Pribadi pasangan = DK404 seragam (RLS) [B24]');

select pg_temp.trade(:'bbca', 'sell', 100, 9800, 1470, 980, :'rdn', '2026-03-05') as s1 \gset
select is(pg_temp.pos(:'bbca'), '200/1842761/9213/56170', 'jual sebagian: biaya keluar floor, untung = hasil bersih − biaya keluar [T11]');
select is(tests.balance(:'rdn'), (48197300 + 977550)::bigint, 'hasil jual = lembar x harga − biaya − pajak ke dompet tujuan');
select is(tests.balance(:'sek'), (1842761 + 1600000)::bigint, 'saldo buku dompet saham tetap = Σ biaya posisi terbuka');
select is(pg_temp.w(:'rdn'), '50000000/0/825150/null',
  'jual ke dompet trading bukan setor modal (K7); Kurang per dompet tetap sisa modal − saldo [T10]');

select pg_temp.trade(:'bbca', 'sell', 200, 8500, 1275, 850, :'rdn', '2026-03-06') as s2 \gset
select is(pg_temp.pos(:'bbca'), '0/0/-/-88716', 'jual habis: lembar 0, biaya 0, rata-rata kosong, terealisasi = Σ untung/rugi [T11]');
select is(tests.balance(:'sek'), 1600000::bigint, 'jual habis rugi: saldo buku dompet saham = biaya TLKM saja');
select is(tests.owner_val(null, format($$select count(*) || '/' || sum(l.amount) from app.entries e
    join app.entry_lines l on l.entry_id = e.id where e.stock_trade_id = %L and e.kind = 'valuation'$$, :'s2')),
  '1/-144886', 'rugi terealisasi tercatat sebagai valuasi negatif di dompet saham');

select pg_temp.trade(:'tlkm', 'sell', 100, 3200, 0, 0, :'bca', '2026-03-07') as s3 \gset
select is(pg_temp.pos(:'tlkm'), '400/1280000/3200/0', 'jual impas: biaya keluar 320.000, terealisasi 0');
select is(tests.owner_val(null, format($$select string_agg(kind::text, ',') from app.entries where stock_trade_id = %L$$, :'s3')),
  'transfer', 'jual impas tanpa entri valuasi (nominal line tidak boleh nol)');

select is(pg_temp.i6(), :'i6_before', 'beli/jual/saham berjalan tidak mengubah Σ pemasukan/pengeluaran (K6: biaya dan pajak bukan pengeluaran) [I6]');
select is(tests.web_val(tests.n(), format($$select string_agg(report_class || ':' || direction || ':' || amount, ','
    order by report_class collate "C", direction) from api.excluded_summary(%L, '2026-03-01', '2026-03-31')
    where report_class = 'x_valuasi'$$, :'np')),
  'x_valuasi:in:56170,x_valuasi:out:144886', 'untung/rugi terealisasi hanya di "Tidak termasuk · Valuasi"');

-- ===== Modal trading: Kurang total (K7) =====
select is(pg_temp.total(), '50872725/50000000/0/1280000', 'sesudah semua trade: modal tidak bergeser, Kurang total 0');
select pg_temp.call(tests.n(), format($$select api.reconcile_balance(gen_random_uuid(), %L, 40000000)$$, :'rdn'));
select is(pg_temp.w(:'rdn'), '50000000/0/10000000/null', 'rugi trading 10 jt: Kurang per dompet 10 jt (tanpa saham)');
select is(pg_temp.total(), '40000000/50000000/8720000/1280000',
  'Kurang total = 50 jt − 40 jt − biaya perolehan saham 1,28 jt [T10]');
select is(pg_temp.dq('DQ15'), '0', 'DQ15: transfer dompet trading <-> dompet saham tidak dihitung modal (K7)');

-- ===== Jalur generik ke/dari dompet saham tertutup (ruling Task 1) =====
select throws_ok(format($$select pg_temp.xfer(%L, %L, 1000)$$, :'bca', :'sek'), 'DK422', 'stock_account_trade_only',
  'transfer biasa ke dompet saham ditolak');
select throws_ok(format($$select pg_temp.xfer(%L, %L, 1000)$$, :'sek', :'bca'), 'DK422', 'stock_account_trade_only',
  'transfer biasa dari dompet saham ditolak');
select throws_ok(format($$select pg_temp.xfer(%L, %L, 1000)$$, :'sek', :'kas'), 'DK422', 'stock_account_trade_only',
  'transfer antar ruang dari dompet saham ditolak');
select tests.owner_val(null, format($$select id from app.entries where stock_trade_id = %L$$, :'b1')) as b1e \gset
select throws_ok(format($$select pg_temp.call(tests.n(), $q$select api.void_entry(gen_random_uuid(), %L,
    (select version from app.entries where id = %L), true)$q$)$$, :'b1e', :'b1e'),
  'DK422', 'stock_account_trade_only', 'batal entri trade lewat jalur generik ditolak (hanya lewat batal trade, 0143)');
select throws_ok(format($$select pg_temp.call(tests.n(), $q$select api.revalue_asset(gen_random_uuid(), %L, 1)$q$)$$, :'sek'),
  'DK422', 'stock_account_trade_only', 'Perbarui nilai dompet saham ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), $q$select api.reconcile_balance(gen_random_uuid(), %L, 1)$q$)$$, :'sek'),
  'DK422', 'asset_account_invalid', 'Cocokkan saldo dompet saham ditolak');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$update app.entries set stock_trade_id = %L where id = %L$q$)$$,
    :'b1', :'dep'),
  'DK422', 'stock_account_trade_only', 'menautkan entri biasa ke trade di luar konteks ditolak');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$update app.entries set description = 'x' where id = %L$q$)$$, :'b1e'),
  'DK422', 'stock_account_trade_only', 'mengubah entri trade di luar konteks ditolak');
select throws_ok(format($$select tests.owner_exec(null, $q$do $d$ declare v uuid := gen_random_uuid(); begin
      set constraints all deferred;
      insert into app.entries (id, space_id, space_kind, kind, occurred_on, created_by, updated_by)
        values (v, %1$L, 'personal', 'valuation', '2026-03-10', %3$L, %3$L);
      insert into app.entry_lines (entry_id, space_id, role, account_id, amount) values (v, %1$L, 'main', %2$L, 1000);
      set constraints all immediate;
    end $d$ $q$)$$, :'np', :'sek', tests.n()),
  'DK422', 'stock_account_trade_only', 'baris di dompet saham di luar konteks ditolak, juga sebagai owner');
select throws_ok(format($$select tests.web_exec(%L, $q$insert into private.stock_ctx values (pg_current_xact_id())$q$)$$,
    tests.n()),
  '42501', null, 'web tidak bisa membuka konteks trade');
select throws_ok(format($$select tests.worker_exec(null, $q$insert into private.stock_ctx values (pg_current_xact_id())$q$)$$),
  '42501', null, 'worker tidak bisa membuka konteks trade');
select throws_ok(format($$select tests.raw_exec($q$update app.entries set stock_trade_id = %L
    where kind = 'adjustment'$q$)$$, :'b1'),
  '23514', null, 'CHECK: tautan trade hanya untuk transfer/valuation/opening_balance');
select throws_ok(format($$select tests.raw_exec($q$update app.entries set stock_trade_id = %L where id = %L$q$)$$, :'b1', :'dep'),
  '23505', null, 'satu entri per kind per trade (indeks unik)');
select is(tests.balance(:'sek'), 1280000::bigint, 'semua penolakan nol efek');

-- ===== Isolasi (B24) =====
select pg_temp.holding(tests.f(), :'fsek', 'BBCA') as fbbca \gset
select pg_temp.trade(:'fbbca', 'opening', 100, 9000, 0, 0, null, '2026-03-01', tests.f());
select is(tests.web_val(tests.f(), $$select (select count(*) from app.stock_holdings) || '/' || (select count(*) from app.stock_trades)
    || '/' || (select count(*) from app.stock_positions)$$), '1/1/1', 'pasangan hanya membaca holding/trade/posisi miliknya [B24]');
select is(tests.web_val(tests.n(), $$select (select count(*) from app.stock_holdings) || '/' || (select count(*) from app.stock_trades)
    || '/' || (select count(*) from app.stock_positions)$$), '2/6/2', 'Novanda tidak membaca milik pasangan [B24]');
select is(pg_temp.pos(:'bbca', tests.f()), null, 'posisi Novanda tidak terbaca pasangan [B24]');
select throws_ok(format($$select tests.api_exec(%L, $q$insert into app.stock_holdings (space_id, account_id, ticker, created_by)
    values (%L, %L, 'ASII', %L)$q$)$$, tests.f(), :'np', :'sek', tests.f()), '42501', null,
  'pasangan tidak bisa menulis holding di Pribadi Novanda (RLS) [B24]');
select is(tests.api_exec(tests.f(), format($q$update app.stock_trades set voided_at = now(), voided_by = %L where id = %L$q$,
  tests.f(), :'b1')), 0::bigint, 'pasangan tidak bisa membatalkan trade Novanda (0 baris) [B24]');
select throws_ok(format($$select tests.web_exec(%L, $q$insert into app.stock_holdings (space_id, account_id, ticker, created_by)
    values (%L, %L, 'ASII', %L)$q$)$$, tests.n(), :'np', :'sek', tests.n()), '42501', null, 'web tanpa INSERT holding');
select throws_ok(format($$select tests.api_exec(%L, $q$update app.stock_trades set price = 1 where id = %L$q$)$$, tests.n(), :'b1'),
  '42501', null, 'api hanya boleh mengubah kolom batal trade (harga, lembar tetap)');
select throws_ok(format($$select tests.api_exec(%L, $q$delete from app.stock_trades where id = %L$q$)$$, tests.n(), :'b1'),
  '42501', null, 'api tanpa DELETE trade');
select throws_ok($$select tests.worker_val(null, 'select count(*) from app.stock_holdings')$$, '42501', null,
  'worker tidak membaca holding');
select throws_ok(format($$select pg_temp.call(tests.n(), $q$select api.create_account(gen_random_uuid(), %L, 'Saham B',
    'aset', null, '2026-01-01', 0, 'saham')$q$)$$, :'sh'),
  'DK422', 'pocket_personal_only', 'dompet saham di Bersama tetap ditolak (K2)');

-- ===== DQ18 =====
select is(pg_temp.dq('DQ18'), '0', 'DQ18: skenario saham sah = nol temuan');
select is(pg_temp.dq('DQ19'), '0', 'DQ19: valuasi untung/rugi jual sah untuk dompet aset');
select is(pg_temp.dq('DQ03'), '0', 'DQ03: entri trade lolos cek bentuk ulang');
savepoint s;
select tests.raw_exec(format($$update app.stock_trades set fee = fee + 1 where id = %L$$, :'b1'));
select is(pg_temp.dq('DQ18'), '3',
  'DQ18: biaya trade berubah tanpa entri (saldo buku dompet ≠ Σ biaya, kode berlembar 0 masih berbiaya, nominal entri beli tidak cocok)');
rollback to savepoint s;
savepoint s;
select tests.raw_exec(format($$update app.entries set voided_at = now(), voided_by = %L where id = %L$$, tests.n(), :'b1e'));
select is(pg_temp.dq('DQ18'), '2', 'DQ18: entri beli batal tetapi trade hidup (saldo dan status tidak cocok)');
rollback to savepoint s;
savepoint s;
select tests.raw_exec(format($$
  insert into app.entries (id, space_id, space_kind, kind, occurred_on, created_by, updated_by)
    values ('00000000-0000-0000-0000-0000000000aa', %1$L, 'personal', 'valuation', '2026-03-18', %3$L, %3$L);
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    values ('00000000-0000-0000-0000-0000000000aa', %1$L, 'main', %2$L, 5000);
  insert into app.entry_history (entry_id, space_id, version, op, snapshot, changed_by)
    values ('00000000-0000-0000-0000-0000000000aa', %1$L, 1, 'create', '{}', %3$L)$$, :'np', :'sek', tests.n()));
select is(pg_temp.dq('DQ18'), '2', 'DQ18: entri hidup di dompet saham tanpa trade (dan saldo buku bergeser)');
rollback to savepoint s;
savepoint s;
select tests.raw_exec(format($$insert into app.stock_trades (space_id, holding_id, side, shares, price, cost_removed,
  occurred_on, created_by) values (%L, %L, 'sell', 1, 1000, 0, '2026-03-18', %L)$$, :'np', :'bbca', tests.n()));
select is(pg_temp.dq('DQ18'), '2', 'DQ18: jual tanpa entri membuat lembar negatif dan trade tanpa entri');
rollback to savepoint s;
select is(pg_temp.dq('DQ18'), '0', 'sesudah rollback: nol temuan');

select * from finish();
rollback;
