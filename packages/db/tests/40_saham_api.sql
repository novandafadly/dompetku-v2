-- Saham S14 sisi API (0143; plan S14 Task 5, K2, K6, K7, K11, K13 (b)(d)(h); ruling pengendali Task 1; bingkai
-- S14-SH1 sampai SH8): api.buy_stock (transfer dompet sumber -> dompet saham sebesar lembar·harga + biaya, holding
-- dibuat otomatis), api.sell_stock (valuasi untung/rugi + transfer hasil dalam satu transaksi; insufficient_shares),
-- api.open_stock_holding (saham berjalan, opening_balance tanpa efek kas), api.preview_sell (INVOKER, satu rumus
-- dengan jual), api.void_stock_trade / api.restore_stock_trade (hanya trade hidup terakhir per holding;
-- trade_not_latest), api.stock_overview (posisi + harga ok terakhir + stale hari bursa + held_pending), perluasan
-- api.asset_overview (market_value, missing_price_count), api.archive_account (account_has_holdings), jalur generik
-- tetap tertutup, jobs.purge_voided membuang trade batal > 90 hari (K11). Setiap fungsi tulis: sukses, validasi
-- gagal (nol efek), rollback utuh (kegagalan disuntik), idempotensi, bukan anggota (DK404 seragam). Galat
-- dibandingkan persis (tanpa nominal, kode saham, nama). I6 lewat dompet trading. Paralel di 99_konkurensi.
-- Jam dipatok 2026-03-20 WIB (Jumat, cuti bersama; 18-20 Mar bukan hari bursa).
-- ID: T11, T10, I6, B24
begin;
select plan(137);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 100000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'RDN', 'trading', 0, '2026-01-01') as rdn,
       tests.account(tests.n(), :'np', 'Celengan', 'tabungan', 50000, '2026-01-01') as tab,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 1000000, '2026-01-01') as kan,
       tests.account(tests.n(), :'np', 'Dompet Tutup', 'operasional', 0, '2026-01-01') as tutup,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 1000000, '2026-01-01') as kas,
       tests.account(tests.f(), :'fp', 'Mandiri', 'operasional', 10000000, '2026-01-01') as fbca \gset
select tests.raw_exec(format($q$insert into auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
  values (%L, 'U', 'x@example.test', true, now(), now())$q$, tests.x()));
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja'$q$, :'np'))
  as belanja \gset

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
-- Galat persis: sqlstate:pesan:detail; 'ok' bila berhasil.
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
create function pg_temp.asset(p_uid uuid, p_space uuid, p_name text, p_kind text, p_opening bigint default 0) returns uuid
language sql as $$
  select (pg_temp.call(p_uid, format($q$select api.create_account(gen_random_uuid(), %L, %L, 'aset', null,
    '2026-01-01', %s, %L)$q$, p_space, p_name, p_opening, p_kind)) ->> 'account_id')::uuid
$$;
create function pg_temp.buy_sql(p_acc uuid, p_ticker text, p_shares bigint, p_price bigint, p_fee bigint, p_from uuid,
  p_on date default null, p_client uuid default null, p_allow boolean default false) returns text
language sql as $$
  select format($q$select api.buy_stock(p_client_id => %L, p_account_id => %L, p_ticker => %L, p_shares => %s::bigint,
      p_price => %s::bigint, p_fee => %s::bigint, p_from_account_id => %L, p_on => %L::date, p_allow_negative => %L)$q$,
    coalesce(p_client, gen_random_uuid()), p_acc, p_ticker, coalesce(p_shares::text, 'null'),
    coalesce(p_price::text, 'null'), coalesce(p_fee::text, 'null'), p_from, p_on, p_allow)
$$;
create function pg_temp.sell_sql(p_acc uuid, p_ticker text, p_shares bigint, p_price bigint, p_fee bigint, p_tax bigint,
  p_to uuid, p_on date default null, p_client uuid default null) returns text
language sql as $$
  select format($q$select api.sell_stock(p_client_id => %L, p_account_id => %L, p_ticker => %L, p_shares => %s::bigint,
      p_price => %s::bigint, p_fee => %s::bigint, p_tax => %s::bigint, p_to_account_id => %L, p_on => %L::date)$q$,
    coalesce(p_client, gen_random_uuid()), p_acc, p_ticker, coalesce(p_shares::text, 'null'),
    coalesce(p_price::text, 'null'), coalesce(p_fee::text, 'null'), coalesce(p_tax::text, 'null'), p_to, p_on)
$$;
create function pg_temp.open_sql(p_acc uuid, p_ticker text, p_shares bigint, p_price bigint, p_on date default null,
  p_client uuid default null) returns text
language sql as $$
  select format($q$select api.open_stock_holding(p_client_id => %L, p_account_id => %L, p_ticker => %L,
      p_shares => %s::bigint, p_price => %s::bigint, p_on => %L::date)$q$,
    coalesce(p_client, gen_random_uuid()), p_acc, p_ticker, coalesce(p_shares::text, 'null'),
    coalesce(p_price::text, 'null'), p_on)
$$;
create function pg_temp.void_sql(p_trade uuid, p_client uuid default null, p_allow boolean default false) returns text
language sql as $$
  select format($q$select api.void_stock_trade(%L, %L, %L)$q$, coalesce(p_client, gen_random_uuid()), p_trade, p_allow)
$$;
create function pg_temp.restore_sql(p_trade uuid, p_client uuid default null, p_allow boolean default false) returns text
language sql as $$
  select format($q$select api.restore_stock_trade(%L, %L, %L)$q$, coalesce(p_client, gen_random_uuid()), p_trade, p_allow)
$$;
create function pg_temp.preview(p_uid uuid, p_acc uuid, p_ticker text, p_shares bigint, p_price bigint,
  p_fee bigint default 0, p_tax bigint default 0) returns text
language sql as $$
  select pg_temp.err(p_uid, format($q$select cost_removed || '/' || proceeds || '/' || realized
      from api.preview_sell(%L, %L, %s::bigint, %s::bigint, %s::bigint, %s::bigint)$q$,
    p_acc, p_ticker, coalesce(p_shares::text, 'null'), coalesce(p_price::text, 'null'), p_fee, p_tax))
$$;
-- Hasil preview_sell bila sukses (pg_temp.err hanya melaporkan 'ok').
create function pg_temp.pv(p_acc uuid, p_ticker text, p_shares bigint, p_price bigint, p_fee bigint default 0,
  p_tax bigint default 0) returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select cost_removed || '/' || proceeds || '/' || realized
      from api.preview_sell(%L, %L, %s::bigint, %s::bigint, %s::bigint, %s::bigint)$q$,
    p_acc, p_ticker, p_shares, p_price, p_fee, p_tax))
$$;
-- Posisi satu kode: lembar/biaya/rata-rata/terealisasi.
create function pg_temp.pos(p_acc uuid, p_ticker text) returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select shares || '/' || cost_total || '/' || coalesce(avg_cost::text, '-')
      || '/' || realized from app.stock_positions where account_id = %L and ticker = %L$q$, p_acc, p_ticker))
$$;
-- Jumlah baris (nol efek): trade/holding/entri/kunci idempotensi/harga/konteks.
create function pg_temp.cnt() returns text
language sql as $$
  select tests.owner_val(null, $q$select (select count(*) from app.stock_trades) || '/' || (select count(*) from app.stock_holdings)
    || '/' || (select count(*) from app.entries) || '/' || (select count(*) from app.entries where voided_at is not null)
    || '/' || (select count(*) from app.idempotency_keys) || '/' || (select count(*) from app.stock_prices)
    || '/' || (select count(*) from private.stock_ctx)$q$)
$$;
-- Entri satu trade: kind:versi:riwayat:batal, urut kind.
create function pg_temp.tent(p_trade uuid) returns text
language sql as $$
  select tests.owner_val(null, format($q$select string_agg(e.kind || ':' || e.version || ':'
      || (select count(*) from app.entry_history h where h.entry_id = e.id) || ':' || (e.voided_at is not null), ','
      order by e.kind::text collate "C") from app.entries e where e.stock_trade_id = %L$q$, p_trade))
$$;
create function pg_temp.dq() returns text
language sql as $$
  select tests.worker_val(null, $q$select string_agg(check_id || '=' || violations, ',' order by check_id collate "C")
    from jobs.dq_reconcile() where check_id in ('DQ01', 'DQ03', 'DQ15', 'DQ18', 'DQ19')$q$)
$$;
-- I6 Pribadi Novanda Maret (pola 38_aset_api).
create function pg_temp.i6() returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select
      (select coalesce(string_agg(kind || ':' || coalesce(name, '-') || ':' || amount, ',' order by kind, name collate "C"), '')
         from api.category_summary(%1$L, '2026-03-01', '2026-03-31'))
      || '|' || (select coalesce(string_agg(category_id || ':' || spent || ':' || remaining, ',' order by category_id), '')
         from api.budget_progress(%1$L, '2026-03-01'))
      || '|' || (select coalesce(sum(amount), 0) from app.report_lines
                  where space_id = %1$L and report_class in ('income', 'expense', 'expense_fee'))
      || '|' || (select coalesce(string_agg(report_class || '=' || inflow || '/' || outflow, ',' order by report_class collate "C"), '')
         from api.period_summary(%1$L, '2026-03-01', '2026-03-31') where report_class in ('income', 'expense', 'expense_fee'))
      || '|' || (select s::text from api.safe_to_spend(%1$L, '2026-03-20') s)
      || '|' || (select coalesce(string_agg(report_class || '=' || s, ',' order by report_class collate "C"), '')
         from (select report_class, sum(amount) as s from api.export_entries(%1$L, '2026-03-01', '2026-03-31')
                where report_class in ('income', 'expense', 'expense_fee') group by report_class) x)$q$,
    tests.space_id(tests.n(), 'personal')))
$$;
-- Kegagalan disuntik (owner; aktif hanya bila GUC tests.fail_after diset): 'stock_trades' sesudah trade ditulis
-- atau diubah (batal/pulihkan), 'stock_line' sesudah line transfer/saldo awal milik trade ditulis (langkah
-- terakhir beli/jual/saham berjalan).
select tests.owner_exec(null, $q$create function private.tes_fail_saham() returns trigger
  language plpgsql set search_path = '' as $f$
  begin
    if pg_catalog.current_setting('tests.fail_after', true) = tg_table_name
       or (pg_catalog.current_setting('tests.fail_after', true) = 'stock_line' and tg_table_name = 'entry_lines'
           and exists (select 1 from app.entries e where e.id = (pg_catalog.to_jsonb(new) ->> 'entry_id')::uuid
                        and e.stock_trade_id is not null and e.kind in ('transfer', 'opening_balance'))) then
      raise exception using errcode = 'P0001', message = 'fail_after';
    end if;
    return null;
  end $f$$q$);
select tests.owner_exec(null, 'create trigger tes_fail_saham after insert or update on app.stock_trades
  for each row execute function private.tes_fail_saham()');
select tests.owner_exec(null, 'create trigger tes_fail_saham after insert on app.entry_lines
  for each row execute function private.tes_fail_saham()');

select pg_temp.asset(tests.n(), :'np', 'Emas', 'emas', 1000000) as emas,
       pg_temp.asset(tests.n(), :'np', 'Sekuritas', 'saham') as sek,
       pg_temp.asset(tests.n(), :'np', 'Sekuritas Dua', 'saham') as sek2,
       pg_temp.asset(tests.n(), :'np', 'Sekuritas Tutup', 'saham') as sek3,
       pg_temp.asset(tests.f(), :'fp', 'Sekuritas F', 'saham') as fsek \gset
select tests.owner_exec(null, format($q$update app.accounts set sort_order = case id when %L then 1 when %L then 2
  when %L then 3 else 4 end where id in (%L, %L, %L)$q$, :'emas', :'sek', :'sek2', :'emas', :'sek', :'sek2'));
select tests.web_val(tests.n(), format($$select api.archive_account(%L)$$, :'sek3'));
select tests.web_val(tests.n(), format($$select api.archive_account(%L)$$, :'tutup'));
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 50000000, 0,
  '2026-03-01')$$, :'np', :'bca', :'rdn'));
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 75000, %L,
  '2026-03-16')$$, :'np', :'bca', :'belanja'));
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'income', 300000, null,
  '2026-03-16')$$, :'np', :'bca'));
select tests.web_exec(tests.n(), format($$select api.set_budget(%L, %L, '2026-03-01', 300000)$$, :'np', :'belanja'));

-- ===== api.buy_stock =====
select pg_temp.call(tests.n(), pg_temp.buy_sql(:'sek', 'BBCA', 200, 9000, 2700, :'rdn', '2026-03-02',
  'aaaaaaaa-0000-0000-0000-000000000001')) as r_b1 \gset
select (:'r_b1'::jsonb ->> 'trade_id') as b1 \gset
select is(:'r_b1'::jsonb - 'trade_id' - 'holding_id' - 'entry_id',
  '{"amount": 1802700, "version": 1, "replayed": false, "warnings": []}'::jsonb,
  'beli: hasil = nominal keluar (lembar x harga + biaya), bukan replay');
select is(tests.owner_val(null, format($q$select t.side || ':' || t.shares || ':' || t.price || ':' || t.fee || ':' || t.tax
    || ':' || coalesce(t.cost_removed::text, '-') || ':' || t.occurred_on || ':' || (t.created_by = %L) || ':'
    || (t.holding_id = %L) || ':' || h.ticker || ':' || (h.account_id = %L)
    from app.stock_trades t join app.stock_holdings h on h.id = t.holding_id where t.id = %L$q$,
    tests.n(), :'r_b1'::jsonb ->> 'holding_id', :'sek', :'b1')),
  'buy:200:9000:2700:0:-:2026-03-02:true:true:BBCA:true', 'baris trade beli dan holding baru di dompet saham');
select is(tests.owner_val(null, format($q$select e.kind || ':' || e.occurred_on || ':' || (e.id = %L) || ':' || e.version || ':'
    || (select string_agg(l.role || '=' || l.amount || '@' || case l.account_id when %L then 'rdn' when %L then 'sek' end, ','
          order by l.role::text collate "C") from app.entry_lines l where l.entry_id = e.id)
    || ':' || (select count(*) from app.entry_history h where h.entry_id = e.id)
    from app.entries e where e.stock_trade_id = %L$q$, :'r_b1'::jsonb ->> 'entry_id', :'rdn', :'sek', :'b1')),
  'transfer:2026-03-02:true:1:counter=1802700@sek,main=-1802700@rdn:1',
  'satu entri transfer tertaut trade: sumber −, dompet saham +, riwayat');
select is(pg_temp.pos(:'sek', 'BBCA') || ' ' || tests.balance(:'rdn') || ' ' || tests.balance(:'sek'),
  '200/1802700/9013/0 48197300 1802700', 'posisi, dompet sumber, saldo buku dompet saham = biaya perolehan [T11]');
select pg_temp.call(tests.n(), pg_temp.buy_sql(:'sek', 'BBCA', 100, 9600, 1441, :'bca', '2026-03-03')) ->> 'trade_id' as b2 \gset
select is(pg_temp.pos(:'sek', 'BBCA') || ' ' || tests.owner_val(null, format($q$select count(*) from app.stock_holdings
    where account_id = %L$q$, :'sek')), '300/2764141/9213/0 1', 'beli kedua kode sama memakai holding yang sama [T11]');
select pg_temp.call(tests.n(), pg_temp.buy_sql(:'sek', 'UNVR', 100, 2000, null, :'bca', '2026-03-04')) as r_u1 \gset
select (:'r_u1'::jsonb ->> 'trade_id') as u1 \gset
select is((:'r_u1'::jsonb ->> 'amount') || ' ' || pg_temp.pos(:'sek', 'UNVR'), '200000 100/200000/2000/0',
  'biaya kosong = 0');
select is(tests.owner_val(null, 'select count(*) from private.stock_ctx'), '0', 'konteks trade ditutup sesudah fungsi');

-- Validasi (nol efek).
select pg_temp.cnt() as cnt_before \gset
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'bbca', 100, 1000, 0, :'bca')), 'DK400:ticker_invalid:ticker',
  'kode huruf kecil ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', null, 100, 1000, 0, :'bca')), 'DK400:ticker_invalid:ticker',
  'kode kosong ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'BBCA', 0, 1000, 0, :'bca')), 'DK400:invalid_argument:shares',
  'lembar 0 ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'BBCA', 100, 0, 0, :'bca')), 'DK400:invalid_argument:price',
  'harga 0 ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'BBCA', 1, 1000000001, 0, :'bca')), 'DK400:invalid_argument:price',
  'harga > 10^9 ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'BBCA', 100, 1000, -1, :'bca')), 'DK400:invalid_argument:fee',
  'biaya negatif ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'BBCA', 10000000, 1000000000, 0, :'bca')),
  'DK400:invalid_argument:amount', 'lembar x harga > 10^13 ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'ASII', 100, 1000, 0, :'bca', '2026-03-21')),
  'DK400:invalid_argument:occurred_on', 'tanggal masa depan ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'emas', 'ASII', 100, 1000, 0, :'bca')),
  'DK422:asset_account_invalid:account_id', 'dompet aset bukan saham ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'bca', 'ASII', 100, 1000, 0, :'tab')),
  'DK422:asset_account_invalid:account_id', 'dompet biasa sebagai dompet saham ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'ASII', 100, 1000, 0, :'emas')),
  'DK422:asset_account_invalid:from_account_id', 'sumber dompet aset ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'ASII', 100, 1000, 0, :'sek2')),
  'DK422:asset_account_invalid:from_account_id', 'sumber dompet saham lain ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'ASII', 100, 1000, 0, :'kan')),
  'DK422:asset_account_invalid:from_account_id', 'sumber Kas Kantor ditolak (K7)');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'ASII', 100, 1000, 0, :'kas')),
  'DK422:asset_account_invalid:from_account_id', 'sumber dompet Bersama ditolak (saham hanya Pribadi)');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'ASII', 100, 1000, 0, :'sek')),
  'DK422:asset_account_invalid:from_account_id', 'sumber = dompet saham itu sendiri ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'ASII', 100, 1000, 0, :'tutup')), 'DK422:account_archived:',
  'sumber terarsip ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek3', 'ASII', 100, 1000, 0, :'bca')), 'DK422:account_archived:',
  'dompet saham terarsip ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'ASII', 100, 1000, 0, :'bca', '2025-12-31')),
  'DK422:before_opening:', 'tanggal sebelum dompet dimulai ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'BBCA', 100, 1000, 0, :'bca', '2026-03-02')),
  'DK422:before_latest_entry:occurred_on', 'beli bertanggal sebelum trade hidup terakhir kode itu ditolak');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'ASII', 100, 5000, 0, :'tab')), 'DK422:saldo_negatif:account_id',
  'dompet sumber jadi minus ditolak tanpa izin');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'BBCA', 1, 1000, 0, :'bca', null,
    'aaaaaaaa-0000-0000-0000-000000000001')), 'DK410:idempotency_key_reused:', 'client_id sama dengan isi lain ditolak');
select is(pg_temp.cnt(), :'cnt_before', 'semua penolakan nol efek (trade, holding, entri, kunci, konteks)');
savepoint s;
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'ASII', 100, 5000, 0, :'tab', null, null, true)) || ' '
    || tests.balance(:'tab'), 'ok -450000', 'dengan izin saldo negatif dompet sumber boleh minus (pola pengeluaran)');
rollback to savepoint s;

-- Rollback utuh.
savepoint gagal;
select set_config('tests.fail_after', 'stock_line', true);
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek', 'ASII', 100, 1000, 0, :'bca', null,
    'aaaaaaaa-0000-0000-0000-000000000002')), 'P0001:fail_after:', 'kegagalan disuntik sesudah line beli ditulis');
select is(pg_temp.cnt(), :'cnt_before', 'rollback utuh: holding, trade, entri, kunci idempotensi tidak tersisa');
select set_config('tests.fail_after', '', true);
rollback to savepoint gagal;
select set_config('tests.fail_after', '', true);

-- Idempotensi.
select is(pg_temp.call(tests.n(), pg_temp.buy_sql(:'sek', 'BBCA', 200, 9000, 2700, :'rdn', '2026-03-02',
    'aaaaaaaa-0000-0000-0000-000000000001')), :'r_b1'::jsonb - 'replayed' || '{"replayed": true}',
  'client_id sama dan isi sama = hasil pertama (replay)');
select is(pg_temp.cnt(), :'cnt_before', 'replay tidak menulis trade kedua');

-- Bukan anggota.
select is(pg_temp.err(tests.f(), pg_temp.buy_sql(:'sek', 'ASII', 100, 1000, 0, :'fbca')), 'DK404:account_not_found:account_id',
  'Farida tidak bisa membeli ke dompet saham Novanda [B24]');
select is(pg_temp.err(tests.f(), pg_temp.buy_sql(:'fsek', 'ASII', 100, 1000, 0, :'bca')),
  'DK404:account_not_found:from_account_id', 'Farida tidak bisa memakai dompet Novanda sebagai sumber [B24]');
select is(pg_temp.err(tests.x(), pg_temp.buy_sql(:'sek', 'ASII', 100, 1000, 0, :'bca')), 'DK404:account_not_found:account_id',
  'Luar ditolak dengan galat yang sama');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(gen_random_uuid(), 'ASII', 100, 1000, 0, :'bca')),
  'DK404:account_not_found:account_id', 'dompet yang tidak ada = galat yang sama (tanpa oracle)');
select is(pg_temp.cnt(), :'cnt_before', 'percobaan bukan anggota nol efek');

-- ===== api.open_stock_holding =====
select pg_temp.call(tests.n(), pg_temp.open_sql(:'sek', 'TLKM', 500, 3200, '2026-03-01',
  'aaaaaaaa-0000-0000-0000-000000000011')) as r_o1 \gset
select (:'r_o1'::jsonb ->> 'trade_id') as o1 \gset
select is(:'r_o1'::jsonb - 'trade_id' - 'holding_id' - 'entry_id',
  '{"amount": 1600000, "version": 1, "replayed": false, "warnings": []}'::jsonb, 'saham berjalan: hasil = biaya perolehan');
select is(tests.owner_val(null, format($q$select e.kind || ':' || e.occurred_on || ':' || (select string_agg(l.role || '='
    || l.amount || '@' || (l.account_id = %L), ',') from app.entry_lines l where l.entry_id = e.id)
    || ':' || (select string_agg(r.report_class, ',') from app.report_lines r where r.entry_id = e.id)
    from app.entries e where e.stock_trade_id = %L$q$, :'sek', :'o1')),
  'opening_balance:2026-03-01:main=1600000@true:x_koreksi', 'saldo awal tertaut trade di dompet saham, kelas x_koreksi');
select is(pg_temp.pos(:'sek', 'TLKM') || ' ' || tests.balance(:'bca'), '500/1600000/3200/0 49063559',
  'saham berjalan tanpa efek kas [T11]');
select pg_temp.cnt() as cnt_before \gset
select is(pg_temp.err(tests.n(), pg_temp.open_sql(:'sek', 'TLKM', 0, 3200)), 'DK400:invalid_argument:shares', 'lembar 0 ditolak');
select is(pg_temp.err(tests.n(), pg_temp.open_sql(:'sek', 'TLKM', 10, null)), 'DK400:invalid_argument:price', 'harga kosong ditolak');
select is(pg_temp.err(tests.n(), pg_temp.open_sql(:'sek', 'TLK', 10, 1000)), 'DK400:ticker_invalid:ticker', 'kode 3 huruf ditolak');
select is(pg_temp.err(tests.n(), pg_temp.open_sql(:'emas', 'TLKM', 10, 1000)), 'DK422:asset_account_invalid:account_id',
  'dompet aset bukan saham ditolak');
select is(pg_temp.err(tests.n(), pg_temp.open_sql(:'sek', 'ANTM', 10, 1000, '2025-12-31')), 'DK422:before_opening:',
  'tanggal sebelum dompet dimulai ditolak');
select is(pg_temp.err(tests.n(), pg_temp.open_sql(:'sek', 'BBCA', 10, 1000, '2026-03-01')),
  'DK422:before_latest_entry:occurred_on', 'saham berjalan bertanggal sebelum trade hidup terakhir ditolak');
select is(pg_temp.err(tests.f(), pg_temp.open_sql(:'sek', 'ANTM', 10, 1000)), 'DK404:account_not_found:account_id',
  'Farida tidak bisa menambah saham ke Pribadi Novanda [B24]');
savepoint gagal;
select set_config('tests.fail_after', 'stock_line', true);
select is(pg_temp.err(tests.n(), pg_temp.open_sql(:'sek', 'ANTM', 10, 1000)), 'P0001:fail_after:',
  'kegagalan disuntik sesudah line saldo awal ditulis');
select is(pg_temp.cnt(), :'cnt_before', 'rollback utuh');
rollback to savepoint gagal;
select set_config('tests.fail_after', '', true);
select is(pg_temp.call(tests.n(), pg_temp.open_sql(:'sek', 'TLKM', 500, 3200, '2026-03-01',
    'aaaaaaaa-0000-0000-0000-000000000011')), :'r_o1'::jsonb - 'replayed' || '{"replayed": true}', 'replay saham berjalan');
select is(pg_temp.cnt(), :'cnt_before', 'penolakan dan replay nol efek');

-- ===== api.preview_sell (INVOKER, satu rumus dengan jual) =====
select is(pg_temp.pv(:'sek', 'BBCA', 100, 9800, 1470, 980), '921380/977550/56170',
  'pratinjau: biaya keluar floor, hasil bersih, untung [T11]');
select is(pg_temp.pv(:'sek', 'BBCA', 300, 8500), '2764141/2550000/-214141', 'pratinjau jual habis: seluruh biaya keluar');
select is(pg_temp.preview(tests.n(), :'sek', 'BBCA', 301, 9800), 'DK422:insufficient_shares:', 'melebihi lembar ditolak');
select is(pg_temp.preview(tests.n(), :'sek', 'BBCA', 0, 9800), 'DK400:invalid_argument:shares', 'lembar 0 ditolak');
select is(pg_temp.preview(tests.n(), :'sek', 'BBCA', 1, 0), 'DK400:invalid_argument:price', 'harga 0 ditolak');
select is(pg_temp.preview(tests.n(), :'sek', 'BBCA', 1, 1000, 600, 400), 'DK400:invalid_argument:amount',
  'biaya + pajak >= nilai jual ditolak');
select is(pg_temp.preview(tests.n(), :'sek', 'ASII', 1, 1000), 'DK404:holding_not_found:', 'kode yang tidak dipegang');
select is(pg_temp.preview(tests.n(), :'sek', 'bbca', 1, 1000), 'DK400:ticker_invalid:ticker', 'kode tidak sah');
select is(pg_temp.preview(tests.f(), :'sek', 'BBCA', 1, 1000), 'DK404:holding_not_found:',
  'Farida tidak membaca holding Novanda (DK404 seragam) [B24]');
select is(pg_temp.cnt(), :'cnt_before', 'pratinjau tidak menulis');

-- ===== api.sell_stock =====
select pg_temp.call(tests.n(), pg_temp.sell_sql(:'sek', 'BBCA', 100, 9800, 1470, 980, :'rdn', '2026-03-05',
  'aaaaaaaa-0000-0000-0000-000000000021')) as r_s1 \gset
select (:'r_s1'::jsonb ->> 'trade_id') as s1 \gset
select is(:'r_s1'::jsonb - 'trade_id' - 'holding_id' - 'entry_id' - 'valuation_entry_id',
  '{"proceeds": 977550, "cost_removed": 921380, "realized": 56170, "version": 1, "replayed": false, "warnings": []}'::jsonb,
  'jual: hasil sama dengan pratinjau');
select is(tests.owner_val(null, format($q$select string_agg(e.kind || ':' || (select string_agg(l.role || '=' || l.amount || '@'
    || case l.account_id when %L then 'sek' when %L then 'rdn' end, ',' order by l.role::text collate "C") from app.entry_lines l
    where l.entry_id = e.id) || ':' || (e.id = case e.kind when 'transfer' then %L::uuid else %L::uuid end), '|'
    order by e.kind::text collate "C") from app.entries e where e.stock_trade_id = %L$q$,
    :'sek', :'rdn', :'r_s1'::jsonb ->> 'entry_id', :'r_s1'::jsonb ->> 'valuation_entry_id', :'s1')),
  'transfer:counter=977550@rdn,main=-977550@sek:true|valuation:main=56170@sek:true',
  'dua entri satu transaksi: valuasi untung di dompet saham + transfer hasil ke tujuan');
select is(tests.owner_val(null, format($q$select side || ':' || cost_removed || ':' || tax from app.stock_trades where id = %L$q$,
  :'s1')), 'sell:921380:980', 'cost_removed tersimpan di trade');
select is(pg_temp.pos(:'sek', 'BBCA') || ' ' || tests.balance(:'rdn') || ' ' || tests.balance(:'sek'),
  '200/1842761/9213/56170 49174850 3642761', 'posisi sesudah jual sebagian; saldo buku = Σ biaya posisi terbuka [T11]');
select pg_temp.call(tests.n(), pg_temp.sell_sql(:'sek', 'TLKM', 100, 3200, 0, 0, :'bca', '2026-03-07')) as r_s3 \gset
select is((:'r_s3'::jsonb ->> 'realized') || ':' || coalesce(:'r_s3'::jsonb ->> 'valuation_entry_id', '-') || ':'
    || pg_temp.tent((:'r_s3'::jsonb ->> 'trade_id')::uuid), '0:-:transfer:1:1:false', 'jual impas tanpa entri valuasi');
select pg_temp.cnt() as cnt_before \gset
select is(pg_temp.err(tests.n(), pg_temp.sell_sql(:'sek', 'BBCA', 201, 9800, 0, 0, :'rdn')), 'DK422:insufficient_shares:',
  'jual melebihi lembar ditolak [T11]');
select is(pg_temp.err(tests.n(), pg_temp.sell_sql(:'sek', 'ASII', 1, 9800, 0, 0, :'rdn')), 'DK404:holding_not_found:',
  'kode yang tidak dipegang ditolak');
select is(pg_temp.err(tests.n(), pg_temp.sell_sql(:'sek', 'BBC1', 1, 9800, 0, 0, :'rdn')), 'DK400:ticker_invalid:ticker',
  'kode tidak sah ditolak');
select is(pg_temp.err(tests.n(), pg_temp.sell_sql(:'sek', 'BBCA', 0, 9800, 0, 0, :'rdn')), 'DK400:invalid_argument:shares',
  'lembar 0 ditolak');
select is(pg_temp.err(tests.n(), pg_temp.sell_sql(:'sek', 'BBCA', 1, 9800, 0, -1, :'rdn')), 'DK400:invalid_argument:tax',
  'pajak negatif ditolak');
select is(pg_temp.err(tests.n(), pg_temp.sell_sql(:'sek', 'BBCA', 1, 1000, 600, 400, :'rdn')), 'DK400:invalid_argument:amount',
  'hasil jual harus > 0');
select is(pg_temp.err(tests.n(), pg_temp.sell_sql(:'sek', 'BBCA', 1, 9800, 0, 0, :'emas')),
  'DK422:asset_account_invalid:to_account_id', 'tujuan dompet aset ditolak');
select is(pg_temp.err(tests.n(), pg_temp.sell_sql(:'sek', 'BBCA', 1, 9800, 0, 0, :'kan')),
  'DK422:asset_account_invalid:to_account_id', 'tujuan Kas Kantor ditolak');
select is(pg_temp.err(tests.n(), pg_temp.sell_sql(:'sek', 'BBCA', 1, 9800, 0, 0, :'kas')),
  'DK422:asset_account_invalid:to_account_id', 'tujuan dompet Bersama ditolak');
select is(pg_temp.err(tests.n(), pg_temp.sell_sql(:'bca', 'BBCA', 1, 9800, 0, 0, :'rdn')),
  'DK422:asset_account_invalid:account_id', 'dompet biasa sebagai dompet saham ditolak');
select is(pg_temp.err(tests.n(), pg_temp.sell_sql(:'sek', 'BBCA', 1, 9800, 0, 0, :'rdn', '2026-03-04')),
  'DK422:before_latest_entry:occurred_on', 'jual bertanggal sebelum trade hidup terakhir ditolak');
select is(pg_temp.err(tests.n(), pg_temp.sell_sql(:'sek', 'BBCA', 1, 9800, 0, 0, :'rdn', '2026-03-21')),
  'DK400:invalid_argument:occurred_on', 'tanggal masa depan ditolak');
select is(pg_temp.err(tests.f(), pg_temp.sell_sql(:'sek', 'BBCA', 1, 9800, 0, 0, :'fbca')),
  'DK404:account_not_found:account_id', 'Farida tidak bisa menjual saham Novanda [B24]');
select is(pg_temp.err(tests.f(), pg_temp.sell_sql(:'fsek', 'BBCA', 1, 9800, 0, 0, :'rdn')),
  'DK404:account_not_found:to_account_id', 'Farida tidak bisa mengirim hasil ke dompet Novanda [B24]');
select is(pg_temp.cnt(), :'cnt_before', 'semua penolakan nol efek');
savepoint gagal;
select set_config('tests.fail_after', 'stock_line', true);
select is(pg_temp.err(tests.n(), pg_temp.sell_sql(:'sek', 'BBCA', 50, 9800, 0, 0, :'rdn')), 'P0001:fail_after:',
  'kegagalan disuntik sesudah valuasi dan line transfer jual ditulis');
select is(pg_temp.cnt() || ' ' || pg_temp.pos(:'sek', 'BBCA'), :'cnt_before' || ' 200/1842761/9213/56170',
  'rollback utuh: valuasi, transfer, trade, kunci');
rollback to savepoint gagal;
select set_config('tests.fail_after', '', true);
select is(pg_temp.call(tests.n(), pg_temp.sell_sql(:'sek', 'BBCA', 100, 9800, 1470, 980, :'rdn', '2026-03-05',
    'aaaaaaaa-0000-0000-0000-000000000021')), :'r_s1'::jsonb - 'replayed' || '{"replayed": true}', 'replay jual');
select is(pg_temp.cnt(), :'cnt_before', 'replay jual tidak menulis');

-- ===== api.void_stock_trade / api.restore_stock_trade =====
select is(pg_temp.err(tests.n(), pg_temp.void_sql(:'b2')), 'DK422:trade_not_latest:', 'batal beli yang bukan terakhir ditolak');
select is(pg_temp.err(tests.n(), pg_temp.void_sql(:'b1')), 'DK422:trade_not_latest:', 'batal trade pertama ditolak');
select pg_temp.call(tests.n(), pg_temp.void_sql(:'s1', 'aaaaaaaa-0000-0000-0000-000000000031')) as r_v1 \gset
select is((select string_agg((x ->> 'account_name') || ':' || (x ->> 'amount'), ',') from jsonb_array_elements(:'r_v1'::jsonb -> 'effects') x)
    || ' ' || jsonb_array_length(:'r_v1'::jsonb -> 'affected') || ' ' || (:'r_v1'::jsonb ->> 'trade_id' = :'s1'),
  'RDN:-977550,Sekuritas:921380 2 true', 'batal jual: efek per dompet, dua entri');
select is(pg_temp.pos(:'sek', 'BBCA') || ' ' || tests.balance(:'rdn') || ' ' || pg_temp.tent(:'s1'),
  '300/2764141/9213/0 48197300 transfer:2:2:true,valuation:2:2:true', 'batal jual membalik tepat sekali [T11]');
select is(tests.owner_val(null, format($q$select (voided_by = %L) || ':' || (voided_at = app.now()) from app.stock_trades
    where id = %L$q$, tests.n(), :'s1')), 'true:true', 'trade batal bertanda');
select is(pg_temp.call(tests.n(), pg_temp.void_sql(:'s1', 'aaaaaaaa-0000-0000-0000-000000000031')),
  :'r_v1'::jsonb - 'replayed' || '{"replayed": true}', 'replay batal');
select is(pg_temp.err(tests.n(), pg_temp.void_sql(:'s1')), 'DK422:already_voided:', 'batal kedua ditolak');
select tests.owner_val(null, format($q$select id from app.entries where stock_trade_id = %L and kind = 'transfer'$q$, :'s1'))
  as s1e \gset
select is(pg_temp.err(tests.n(), format($$select api.restore_entry(gen_random_uuid(), %L, (select version from app.entries
    where id = %L))$$, :'s1e', :'s1e')), 'DK422:stock_account_trade_only:account_id', 'pulihkan generik entri trade ditolak');
select is(pg_temp.err(tests.n(), format($$select api.purge_entry(%L, (select version from app.entries where id = %L))$$,
    :'s1e', :'s1e')), 'DK422:stock_account_trade_only:account_id', 'hapus permanen generik entri trade ditolak');
-- Jalur generik ditolak sebelum kunci entri (urutan kunci trade: dompet -> entri; tanpa menunggu: 99_konkurensi).
select tests.owner_val(null, format($q$select id from app.entries where stock_trade_id = %L$q$, :'b1')) as b1e,
       tests.owner_val(null, format($q$select id from app.entries where stock_trade_id = %L$q$, :'o1')) as o1e \gset
select is(pg_temp.err(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'b1e')),
  'DK422:stock_account_trade_only:account_id', 'batal generik entri trade hidup ditolak');
select is(pg_temp.err(tests.n(), format($$select api.update_entry(gen_random_uuid(), %L, 1, %L, 1700000, null, null, null,
    false)$$, :'o1e', :'sek')), 'DK422:stock_account_trade_only:account_id', 'ubah generik saldo awal saham berjalan ditolak');
select is(pg_temp.err(tests.n(), format($$select api.move_entry_to_space(gen_random_uuid(), %L, 1, %L, %L, null)$$,
    :'b1e', :'sh', :'kas')), 'DK422:stock_account_trade_only:account_id', 'pindah ruang generik entri trade ditolak');
select is(pg_temp.err(tests.f(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'b1e')),
  'DK404:entry_not_found:', 'cek trade di jalur generik tidak membocorkan entri ke pasangan (DK404 seragam) [B24]');
select pg_temp.call(tests.n(), pg_temp.void_sql(:'b2'));
select is(pg_temp.pos(:'sek', 'BBCA') || ' ' || tests.balance(:'bca'), '200/1802700/9013/0 50345000',
  'beli terakhir yang hidup boleh dibatalkan; dompet sumber kembali');
select is(pg_temp.err(tests.n(), pg_temp.restore_sql(:'s1')), 'DK422:trade_not_latest:',
  'pulihkan jual yang biaya keluarnya tidak cocok lagi dengan posisi ditolak');
select is(pg_temp.err(tests.n(), pg_temp.restore_sql(:'b1')), 'DK422:not_voided:', 'pulihkan trade hidup ditolak');
select pg_temp.call(tests.n(), pg_temp.restore_sql(:'b2', 'aaaaaaaa-0000-0000-0000-000000000041')) as r_r2 \gset
select is(pg_temp.pos(:'sek', 'BBCA') || ' ' || tests.balance(:'bca') || ' ' || pg_temp.tent(:'b2'),
  '300/2764141/9213/0 49383559 transfer:3:3:false', 'pulihkan beli: posisi dan dompet sumber kembali, riwayat bertambah');
select is(pg_temp.call(tests.n(), pg_temp.restore_sql(:'b2', 'aaaaaaaa-0000-0000-0000-000000000041')),
  :'r_r2'::jsonb - 'replayed' || '{"replayed": true}', 'replay pulihkan');
select is(pg_temp.err(tests.n(), pg_temp.restore_sql(:'s1')), 'ok', 'jual dipulihkan sesudah posisinya sama lagi');
select is(pg_temp.pos(:'sek', 'BBCA') || ' ' || tests.balance(:'rdn') || ' ' || pg_temp.tent(:'s1'),
  '200/1842761/9213/56170 49174850 transfer:3:3:false,valuation:3:3:false', 'pulihkan jual tepat sekali [T11]');
select pg_temp.cnt() as cnt_before \gset
savepoint gagal;
select set_config('tests.fail_after', 'stock_trades', true);
select is(pg_temp.err(tests.n(), pg_temp.void_sql(:'s1')), 'P0001:fail_after:', 'kegagalan disuntik sesudah trade ditandai batal');
select is(pg_temp.cnt() || ' ' || pg_temp.pos(:'sek', 'BBCA'), :'cnt_before' || ' 200/1842761/9213/56170',
  'rollback utuh batal');
rollback to savepoint gagal;
select set_config('tests.fail_after', '', true);
savepoint gagal;
select pg_temp.call(tests.n(), pg_temp.void_sql(:'s1'));
select pg_temp.cnt() as cnt_v \gset
select set_config('tests.fail_after', 'stock_trades', true);
select is(pg_temp.err(tests.n(), pg_temp.restore_sql(:'s1')), 'P0001:fail_after:', 'kegagalan disuntik sesudah trade dipulihkan');
select is(pg_temp.cnt() || ' ' || pg_temp.pos(:'sek', 'BBCA'), :'cnt_v' || ' 300/2764141/9213/0', 'rollback utuh pulihkan');
rollback to savepoint gagal;
select set_config('tests.fail_after', '', true);
select is(pg_temp.err(tests.f(), pg_temp.void_sql(:'s1')), 'DK404:trade_not_found:', 'Farida tidak bisa membatalkan trade Novanda [B24]');
select is(pg_temp.err(tests.x(), pg_temp.void_sql(:'s1')), 'DK404:trade_not_found:', 'Luar ditolak');
select is(pg_temp.err(tests.n(), pg_temp.void_sql(gen_random_uuid())), 'DK404:trade_not_found:', 'trade tidak ada = galat sama');
select is(pg_temp.err(tests.f(), pg_temp.restore_sql(:'s1')), 'DK404:trade_not_found:', 'Farida tidak bisa memulihkan trade Novanda');
select is(pg_temp.cnt(), :'cnt_before', 'percobaan bukan anggota nol efek');
-- Batal jual membuat dompet tujuan minus: saldo_negatif kecuali diizinkan.
savepoint s;
select pg_temp.call(tests.n(), pg_temp.sell_sql(:'sek', 'UNVR', 100, 2000, 0, 0, :'tab', '2026-03-08')) ->> 'trade_id' as su \gset
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 240000, %L,
  '2026-03-09')$$, :'np', :'tab', :'belanja'));
select is(pg_temp.err(tests.n(), pg_temp.void_sql(:'su')), 'DK422:saldo_negatif:account_id',
  'batal jual yang membuat dompet tujuan minus ditolak tanpa izin');
select is(pg_temp.err(tests.n(), pg_temp.void_sql(:'su', null, true)) || ' ' || tests.balance(:'tab'), 'ok -190000',
  'dengan izin batal jual boleh membuat dompet tujuan minus');
rollback to savepoint s;
-- Jendela pulihkan 90 hari.
savepoint s;
select pg_temp.call(tests.n(), pg_temp.void_sql(:'s1'));
select tests.clock_at('2026-06-19 10:00+07');
select is(pg_temp.err(tests.n(), pg_temp.restore_sql(:'s1')), 'DK422:restore_window_closed:', 'pulihkan sesudah 90 hari ditolak');
rollback to savepoint s;
-- Pulihkan jual yang dompet tujuannya sudah diarsip (saldo kembali 0 sesudah batal).
savepoint s;
select tests.account(tests.n(), :'np', 'Tujuan Jual', 'operasional', 0, '2026-01-01') as tj \gset
select pg_temp.call(tests.n(), pg_temp.sell_sql(:'sek', 'UNVR', 100, 2000, 0, 0, :'tj', '2026-03-08')) ->> 'trade_id' as stj \gset
select pg_temp.call(tests.n(), pg_temp.void_sql(:'stj'));
select tests.web_val(tests.n(), format($$select api.archive_account(%L)$$, :'tj'));
select is(pg_temp.err(tests.n(), pg_temp.restore_sql(:'stj')) || ' ' || pg_temp.tent(:'stj'),
  'DK422:account_archived: transfer:2:2:true', 'pulihkan jual ke dompet tujuan terarsip ditolak, nol efek');
rollback to savepoint s;

-- ===== api.stock_overview + api.asset_overview (nilai pasar) =====
select tests.web_exec(tests.n(), format($$select api.set_stock_price(gen_random_uuid(), %L, 'BBCA', '2026-03-12', 9500)$$, :'np'));
select tests.web_exec(tests.n(), format($$select api.set_stock_price(gen_random_uuid(), %L, 'TLKM', '2026-03-11', 3000)$$, :'np'));
select is(tests.worker_val(null, $$select jobs.price_ingest('2026-03-17', '[{"ticker": "BBCA", "close": 20000}]')$$)::jsonb,
  '{"ok": 0, "held": 1, "rejected": 0, "skipped": 0}'::jsonb, 'harga penyedia melonjak ditahan (held)');
create function pg_temp.so(p_uid uuid, p_acc uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select string_agg(coalesce(ticker, 'TOTAL') || ':' || coalesce(shares::text, '-')
      || ':' || cost_total || ':' || coalesce(avg_cost::text, '-') || ':' || coalesce(close::text, '-') || ':'
      || coalesce(close_on::text, '-') || ':' || coalesce(stale::text, '-') || ':' || held_pending || ':'
      || coalesce(held_on::text, '-') || ':' || market_value || ':' || coalesce(unrealized::text, '-') || ':' || realized
      || ':' || coalesce(last_trade_side || '/' || last_trade_shares || '/' || last_trade_price || '/' || last_trade_on, '-')
      || ':' || missing_price_count, ' ' order by o) from api.stock_overview(%L) with ordinality t (holding_id, ticker,
      shares, cost_total, avg_cost, close, close_on, stale, held_pending, held_on, market_value, unrealized, realized,
      last_trade_id, last_trade_side, last_trade_shares, last_trade_price, last_trade_on, missing_price_count, o)$q$, p_acc))
$$;
select is(pg_temp.so(tests.n(), :'sek'),
  'BBCA:200:1842761:9213:9500:2026-03-12:false:true:2026-03-17:1900000:57239:56170:sell/100/9800/2026-03-05:0 '
  || 'TLKM:400:1280000:3200:3000:2026-03-11:true:false:-:1200000:-80000:0:sell/100/3200/2026-03-07:0 '
  || 'UNVR:100:200000:2000:-:-:-:false:-:200000:-:0:buy/100/2000/2026-03-04:1 '
  || 'TOTAL:-:3322761:-:-:-:true:true:-:3300000:-22761:56170:-:1',
  'stock_overview: nilai pasar dari harga ok terakhir, held tidak dipakai, usang dihitung hari bursa (libur 18-20 Mar), tanpa harga = biaya, baris total [T11]');
select is(tests.web_val(tests.n(), format($$select (last_trade_id = %L)::text from api.stock_overview(%L) where ticker = 'BBCA'$$,
  :'s1', :'sek')), 'true', 'trade terakhir yang bisa dibatalkan = trade hidup terakhir');
select is(pg_temp.err(tests.f(), format($$select count(*) from api.stock_overview(%L)$$, :'sek')),
  'DK404:account_not_found:account_id', 'Farida tidak membaca posisi Novanda [B24]');
select is(pg_temp.err(tests.n(), format($$select count(*) from api.stock_overview(%L)$$, :'emas')),
  'DK422:asset_account_invalid:account_id', 'ringkasan saham hanya untuk dompet saham');
select is(tests.web_val(tests.n(), format($q$select string_agg(name || ':' || asset_kind || ':' || balance || ':'
    || coalesce(market_value::text, '-') || ':' || coalesce(missing_price_count::text, '-'), ',' order by o)
    from api.asset_overview(%L) with ordinality t (account_id, name, asset_kind, balance, last_valued_on, last_change,
    market_value, missing_price_count, o)$q$, :'np')),
  'Emas:emas:1000000:-:-,Sekuritas:saham:3322761:3300000:1,Sekuritas Dua:saham:0:0:0',
  'asset_overview: dompet saham membawa nilai pasar dan jumlah kode tanpa harga (ruling Task 1)');
-- Kode yang sudah dijual habis tidak membuat label "Ada harga lama" atau "harga tertahan" (price_targets tidak lagi
-- memperbarui harganya): stale/held_pending hanya untuk lembar > 0.
savepoint s;
select pg_temp.asset(tests.n(), :'np', 'Sekuritas Empat', 'saham') as sek4 \gset
select pg_temp.call(tests.n(), pg_temp.buy_sql(:'sek4', 'ASII', 10, 1000, 0, :'rdn', '2026-03-02'));
select tests.web_exec(tests.n(), format($$select api.set_stock_price(gen_random_uuid(), %L, 'ASII', '2026-03-02', 1000)$$, :'np'));
select tests.worker_val(null, $$select jobs.price_ingest('2026-03-03', '[{"ticker": "ASII", "close": 5000}]')$$);
select pg_temp.call(tests.n(), pg_temp.sell_sql(:'sek4', 'ASII', 10, 1000, 0, 0, :'rdn', '2026-03-03'));
select pg_temp.call(tests.n(), pg_temp.buy_sql(:'sek4', 'BMRI', 10, 6000, 0, :'rdn', '2026-03-17'));
select tests.web_exec(tests.n(), format($$select api.set_stock_price(gen_random_uuid(), %L, 'BMRI', '2026-03-17', 6000)$$, :'np'));
select is(tests.web_val(tests.n(), format($q$select string_agg(coalesce(ticker, 'TOTAL') || ':' || coalesce(shares::text, '-') || ':' || stale || ':'
    || held_pending, ' ' order by o) from api.stock_overview(%L) with ordinality t (holding_id, ticker, shares, cost_total,
    avg_cost, close, close_on, stale, held_pending, held_on, market_value, unrealized, realized, last_trade_id,
    last_trade_side, last_trade_shares, last_trade_price, last_trade_on, missing_price_count, o)$q$, :'sek4')),
  'BMRI:10:false:false ASII:0:false:false TOTAL:-:false:false',
  'kode berlembar 0 berharga lama dan held: stale/held_pending false, total ikut false');
rollback to savepoint s;
-- Nilai pasar ekstrem (10^13 lembar x 10^6) tidak overflow bigint: dibatasi 10^13 (batas nominal proyek).
savepoint s;
select pg_temp.asset(tests.n(), :'np', 'Sekuritas Raksasa', 'saham') as sekx \gset
select pg_temp.call(tests.n(), pg_temp.open_sql(:'sekx', 'GOTO', 10000000000000, 1, '2026-03-02'));
select tests.web_exec(tests.n(), format($$select api.set_stock_price(gen_random_uuid(), %L, 'GOTO', '2026-03-17', 1000000,
  true)$$, :'np'));
select is(tests.web_val(tests.n(), format($q$select string_agg(coalesce(ticker, 'TOTAL') || ':' || market_value || ':'
    || unrealized, ' ' order by o) from api.stock_overview(%L) with ordinality t (holding_id, ticker, shares, cost_total,
    avg_cost, close, close_on, stale, held_pending, held_on, market_value, unrealized, realized, last_trade_id,
    last_trade_side, last_trade_shares, last_trade_price, last_trade_on, missing_price_count, o)$q$, :'sekx'))
    || ' ' || tests.web_val(tests.n(), format($q$select market_value from api.asset_overview(%L) where account_id = %L$q$,
    :'np', :'sekx')),
  'GOTO:10000000000000:0 TOTAL:10000000000000:0 10000000000000',
  'nilai pasar ekstrem dibatasi 10^13 di stock_overview dan asset_overview (tanpa bigint out of range)');
rollback to savepoint s;

-- ===== api.archive_account (K11) =====
select is(pg_temp.err(tests.n(), format($$select api.archive_account(%L)$$, :'sek')), 'DK422:account_has_holdings:',
  'dompet saham berlembar tidak bisa diarsip');
select pg_temp.call(tests.n(), pg_temp.buy_sql(:'sek2', 'ASII', 100, 5000, 0, :'rdn', '2026-03-16'));
select is(pg_temp.err(tests.n(), format($$select api.archive_account(%L)$$, :'sek2')), 'DK422:account_has_holdings:',
  'lembar dicek sebelum saldo');
select pg_temp.call(tests.n(), pg_temp.sell_sql(:'sek2', 'ASII', 100, 5000, 0, 0, :'rdn', '2026-03-16'));
select is(pg_temp.call(tests.n(), format($$select api.archive_account(%L)$$, :'sek2')) ->> 'archived', 'true',
  'sesudah dijual habis dompet saham bisa diarsip');
select is(pg_temp.err(tests.n(), pg_temp.buy_sql(:'sek2', 'ASII', 1, 5000, 0, :'rdn')), 'DK422:account_archived:',
  'beli ke dompet saham terarsip ditolak');

-- ===== I6: beli/jual/saham berjalan/batal/pulihkan dari dompet trading =====
select pg_temp.i6() as i6_before \gset
select pg_temp.call(tests.n(), pg_temp.buy_sql(:'sek', 'BBCA', 10, 9000, 50, :'rdn', '2026-03-16')) ->> 'trade_id' as bi \gset
select pg_temp.call(tests.n(), pg_temp.sell_sql(:'sek', 'BBCA', 10, 9400, 40, 10, :'rdn', '2026-03-16')) ->> 'trade_id' as si \gset
select pg_temp.call(tests.n(), pg_temp.open_sql(:'sek', 'ANTM', 100, 1500, '2026-03-16')) ->> 'trade_id' as oi \gset
select pg_temp.call(tests.n(), pg_temp.void_sql(:'oi'));
select pg_temp.call(tests.n(), pg_temp.restore_sql(:'oi'));
select is(pg_temp.i6(), :'i6_before',
  'beli/jual/saham berjalan/batal/pulihkan tidak mengubah kategori, anggaran, Σ pemasukan/pengeluaran, period_summary, aman dipakai, Ekspor [I6]');
select is(pg_temp.dq(), 'DQ01=0,DQ03=0,DQ15=0,DQ18=0,DQ19=0', 'DQ nol sesudah semua trade lewat API');

-- ===== jobs.purge_voided: trade batal > 90 hari (K11) =====
select pg_temp.call(tests.n(), pg_temp.void_sql(:'si'));
select tests.clock_at('2026-06-20 10:00+07');
select is(tests.worker_val(null, 'select jobs.purge_voided()'), '2', 'purge menghapus tepat dua entri trade batal (valuasi + transfer jual)');
select is(tests.owner_val(null, format($q$select (select count(*) from app.stock_trades where id = %L) || '/'
    || (select count(*) from app.entries where stock_trade_id = %L) || '/' || (select count(*) from app.stock_trades where id = %L)
    || '/' || (select count(*) from private.stock_ctx)$q$, :'si', :'si', :'bi')),
  '0/0/1/0', 'trade batal dan entrinya terhapus; trade hidup tetap; konteks ditutup');
select is(pg_temp.dq(), 'DQ01=0,DQ03=0,DQ15=0,DQ18=0,DQ19=0', 'DQ nol sesudah purge');

select * from finish();
rollback;
