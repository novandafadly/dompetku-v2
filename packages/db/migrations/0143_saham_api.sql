-- migrate:up
-- S14 (IPD §6, plan S14 Task 5, K1, K6, K7, K8, K11; ruling pengendali atas Task 1; bingkai S14-SH1 sampai SH8):
-- API saham, harga manual, dan fungsi job harga. Expand-only: fungsi baru; api.asset_overview diganti (drop +
-- create: + market_value, missing_price_count), api.archive_account dan jobs.purge_voided diganti utuh (create or
-- replace, tanda tangan dan hasil sama).
--
-- - Tulis (DEFINER milik dompetku_api, idempoten client_id, hash tanpa p_allow_negative/p_confirm_spike):
--   api.buy_stock (transfer dompet sumber -> dompet saham sebesar lembar·harga + biaya, K6; holding dibuat bila
--   belum ada), api.sell_stock (dua entri satu transaksi: valuasi hasil − cost_removed di dompet saham bila ≠ 0,
--   lalu transfer hasil ke tujuan; cost_removed dari private.stock_cost_removed, jual > lembar = DK422
--   insufficient_shares), api.open_stock_holding (saham berjalan: opening_balance tanpa efek kas),
--   api.void_stock_trade / api.restore_stock_trade (semua entri trade + baris trade; hanya trade hidup terakhir
--   per holding menurut seq, selain itu DK422 trade_not_latest; pulihkan jual juga menuntut cost_removed sama
--   dengan rumus pada posisi sekarang, jadi biaya rata-rata tidak pernah dihitung ulang berantai; pulihkan <= 90
--   hari), api.set_stock_price (harga manual per ruang Pribadi; validator SQL tunggal private.price_verdict;
--   lonjakan > 35% = DK422 price_spike_unconfirmed kecuali p_confirm_spike; menimpa baris tanggal yang sama,
--   termasuk held).
-- - Dompet: dompet saham = dompet aset berjenis saham, aktif (selain itu DK422 asset_account_invalid
--   account_id / account_archived); dompet sumber/tujuan = dompet ruang yang sama berpocket operasional, tabungan,
--   atau trading (K7: bukan Kantor, aset, patungan; DK422 asset_account_invalid from_account_id/to_account_id).
--   Dompet tak terlihat = DK404 account_not_found (detail = argumen), trade tak terlihat = DK404 trade_not_found,
--   kode tak dipegang = DK404 holding_not_found: seragam untuk pasangan, Luar, dan id yang tidak ada.
-- - Tanggal trade tidak boleh sebelum trade hidup terakhir kode yang sama (DK422 before_latest_entry, pola
--   revalue_asset 0141) dan tidak sebelum opened_on kedua dompet (before_opening).
-- - Urutan kunci: dompet (private.lock_accounts, urut id; dompet saham selalu ikut) -> baris trade (FOR NO KEY
--   UPDATE) -> entri (urut id). Kunci dompet saham menyerialkan semua trade satu dompet: posisi dibaca sesudah
--   kunci (READ COMMITTED), jadi dua jual paralel tidak melewati lembar dan batal paralel beli baru = satu
--   trade_not_latest (99_konkurensi). Jalur generik mengunci kebalikannya (entri -> dompet), jadi siklus dicegah
--   dengan menolak entri trade di jalur generik SEBELUM kunci apa pun (review 0143 K1, lihat di bawah).
-- - Semua tulis entri trade di dalam konteks private.stock_ctx (0142); fungsi menghapus barisnya sebelum selesai.
--   Jalur generik (api.void_entry/restore_entry/update_entry/move_entry_to_space/purge_entry, diganti utuh dari
--   badan terakhirnya 0103/0110/0111/0131) menolak entri bertautan stock_trade_id dengan DK422
--   stock_account_trade_only SEBELUM mengunci entri (pola debt_principal_locked 0131), sehingga void generik paralel
--   void_stock_trade tidak deadlock (99_konkurensi); tg_stock_guard tetap lapisan kedua. stock_trade_id tidak pernah
--   berubah sesudah insert (tg_stock_guard), jadi baca tanpa kunci aman. api.trash_list tidak berubah: entri trade
--   batal tampil per entri (baris bertautan stock_trade_id terbaca web), pulihkan lewat restore_stock_trade (UI
--   Task 11).
-- - api.preview_sell (DEFINER milik dompetku_api, STABLE, tanpa tulis; RLS pemanggil tetap berlaku): rumus yang
--   sama dengan jual (private.stock_check + private.stock_cost_removed), UI tidak menghitung. DEFINER, bukan INVOKER
--   seperti plan: web tidak punya USAGE skema private (0001) dan rumus biaya keluar ada di private (0142); pola
--   baca DEFINER sudah ada (invitation_peek, list_invitations).
-- - Baca (INVOKER milik owner, STABLE): api.stock_overview(dompet saham) (per holding: posisi, harga ok terakhir <= hari ini + tanggal, stale = lebih
--   dari 3 hari bursa (Senin-Jumat di luar app.holidays) sejak tanggal harga, held_pending/held_on = baris held
--   sesudah harga ok terakhir, nilai pasar (tanpa harga = biaya perolehan), belum/sudah terealisasi, trade hidup
--   terakhir; baris total holding_id NULL), api.asset_overview + market_value dan missing_price_count untuk
--   dompet saham (NULL untuk aset lain). app.stock_last_close = satu sumber harga ok terakhir (ROWS 1; di app
--   karena dipanggil fungsi baca INVOKER milik web, pola app.pay_period).
-- - Job (DEFINER milik owner, EXECUTE hanya dompetku_worker): jobs.price_targets() = kode unik berlembar > 0 di
--   dompet aktif semua ruang, tanpa ruang/lembar/pemegang; jobs.price_ingest(p_on, p_rows) memvalidasi ulang di
--   SQL (tanggal 2000-01-01..hari ini, larik <= 100 elemen, objek {ticker ^[A-Z]{4}$ string, close angka bulat
--   1..10^9}, kode yang muncul > 1 kali ditolak semua kemunculannya apa pun harganya), menulis per ruang pemegang
--   lewat price_verdict (ok/held), tidak menimpa harga manual tanggal itu (skipped), dan hanya mengembalikan jumlah
--   {ok, held, rejected, skipped}.
-- - api.archive_account: dompet dengan lembar > 0 = DK422 account_has_holdings (sebelum tujuan dan saldo).
-- - jobs.purge_voided (K11): dalam konteks stock_ctx, entri trade batal > 90 hari ikut lintasan entri, lalu trade
--   batal tanpa entri dihapus; baris harga held bertanggal > 90 hari dihapus.
-- Kode galat baru: DK400 ticker_invalid, price_invalid; DK422 trade_not_latest, price_spike_unconfirmed,
-- account_has_holdings; DK404 trade_not_found. Pesan/detail tanpa nominal, kode saham, harga, dan nama.

-- ===== Helper (INVOKER milik owner; EXECUTE dompetku_api) =====
-- Validasi skalar trade (sama untuk tulis dan pratinjau). p_sell: hasil jual bersih harus > 0.
create function private.stock_check(p_ticker text, p_shares bigint, p_price bigint, p_fee bigint, p_tax bigint,
                                    p_sell boolean) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_ticker is null or not ((p_ticker collate "C") ~ '^[A-Z]{4}$') then
    raise exception using errcode = 'DK400', message = 'ticker_invalid', detail = 'ticker';
  end if;
  if p_shares is null or p_shares <= 0 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'shares';
  end if;
  if p_price is null or p_price < 1 or p_price > 1000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'price';
  end if;
  if p_fee is null or p_fee < 0 or p_fee > 10000000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'fee';
  end if;
  if p_tax is null or p_tax < 0 or p_tax > 10000000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'tax';
  end if;
  -- numeric: perkalian bigint bisa overflow sebelum dibandingkan (CHECK 0142 sama).
  if p_shares::numeric * p_price + p_fee > 10000000000000
     or (p_sell and p_shares::numeric * p_price - p_fee - p_tax <= 0) then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'amount';
  end if;
end $$;

-- Dompet saham (sudah dikunci): terlihat, aset berjenis saham, aktif.
create function private.stock_account(p_account_id uuid) returns app.accounts
language plpgsql stable set search_path = '' as $$
declare v app.accounts%rowtype;
begin
  v := private.get_account(p_account_id, 'account_id');
  if not exists (select 1 from app.asset_details d where d.account_id = v.id and d.asset_kind = 'saham') then
    raise exception using errcode = 'DK422', message = 'asset_account_invalid', detail = 'account_id';
  end if;
  if v.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;
  return v;
end $$;

-- Dompet sumber/tujuan (sudah dikunci): ruang dompet saham, operasional/tabungan/trading (K7), aktif.
create function private.stock_cash_account(p_account_id uuid, p_detail text, p_space_id uuid) returns app.accounts
language plpgsql stable set search_path = '' as $$
declare v app.accounts%rowtype;
begin
  if p_account_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = p_detail;
  end if;
  v := private.get_account(p_account_id, p_detail);
  if v.space_id <> p_space_id or v.pocket not in ('operasional', 'tabungan', 'trading') then
    raise exception using errcode = 'DK422', message = 'asset_account_invalid', detail = p_detail;
  end if;
  if v.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;
  return v;
end $$;

-- Holding dompet x kode (dibuat bila belum ada; pemanggil sudah mengunci dompet saham).
create function private.stock_holding(p_account app.accounts, p_ticker text, p_uid uuid) returns uuid
language plpgsql set search_path = '' as $$
declare v uuid;
begin
  insert into app.stock_holdings (space_id, account_id, ticker, created_by)
  values (p_account.space_id, p_account.id, p_ticker, p_uid)
  on conflict (account_id, ticker) do nothing;
  select h.id into v from app.stock_holdings h where h.account_id = p_account.id and h.ticker = p_ticker;
  return v;
end $$;

-- Tanggal trade tidak mendahului trade hidup terakhir kode itu (urutan seq = urutan tanggal).
create function private.stock_assert_after(p_holding_id uuid, p_on date) returns void
language plpgsql stable set search_path = '' as $$
begin
  if exists (select 1 from app.stock_trades t
              where t.holding_id = p_holding_id and t.voided_at is null and t.occurred_on > p_on) then
    raise exception using errcode = 'DK422', message = 'before_latest_entry', detail = 'occurred_on';
  end if;
end $$;

-- Satu entri trade (konteks stock_ctx sudah terbuka): tanpa p_counter = satu line main sebesar p_amount;
-- dengan p_counter = transfer main −p_amount, counter +p_amount.
create function private.stock_entry(p_trade app.stock_trades, p_kind app.entry_kind, p_main uuid, p_counter uuid,
                                    p_amount bigint, p_uid uuid) returns uuid
language plpgsql set search_path = '' as $$
declare v uuid;
begin
  insert into app.entries (space_id, space_kind, kind, occurred_on, stock_trade_id, created_by, updated_by)
  values (p_trade.space_id, 'personal', p_kind, p_trade.occurred_on, p_trade.id, p_uid, p_uid)
  returning id into v;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v, p_trade.space_id, 'main', p_main, case when p_counter is null then p_amount else -p_amount end);
  if p_counter is not null then
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    values (v, p_trade.space_id, 'counter', p_counter, p_amount);
  end if;
  perform private.write_history(v, 'create', p_uid);
  return v;
end $$;

-- Trade terlihat, dompet entrinya dikunci, lalu barisnya. Tidak terlihat atau hilang sebelum kunci didapat
-- (purge paralel) = DK404.
create function private.lock_stock_trade(p_trade_id uuid) returns app.stock_trades
language plpgsql set search_path = '' as $$
declare
  v      app.stock_trades%rowtype;
  v_accs uuid[];
begin
  select * into v from app.stock_trades where id = p_trade_id;
  if v.id is null then
    raise exception using errcode = 'DK404', message = 'trade_not_found';
  end if;
  select coalesce(array_agg(distinct l.account_id), '{}') into v_accs
    from app.entries e join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id
   where e.stock_trade_id = v.id;
  perform private.lock_accounts(v_accs);
  select * into v from app.stock_trades where id = p_trade_id for no key update;
  if not found then
    raise exception using errcode = 'DK404', message = 'trade_not_found';
  end if;
  return v;
end $$;

-- Harga ok terakhir <= tanggal satu ruang x kode (0 atau 1 baris).
create function app.stock_last_close(p_space_id uuid, p_ticker text, p_on date)
returns table (close bigint, on_date date)
language sql stable rows 1 set search_path = '' as $$
  select p.close, p.on_date from app.stock_prices p
   where p.space_id = p_space_id and p.ticker = p_ticker and p.status = 'ok' and p.on_date <= p_on
   order by p.on_date desc limit 1
$$;

-- ===== Beli =====
create function api.buy_stock(
  p_client_id       uuid,
  p_account_id      uuid,
  p_ticker          text,
  p_shares          bigint,
  p_price           bigint,
  p_fee             bigint,
  p_from_account_id uuid,
  p_on              date    default null,
  p_allow_negative  boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_fee bigint := coalesce(p_fee, 0);
  v_on  date;
  v_acc app.accounts%rowtype;
  v_src app.accounts%rowtype;
  v_h   uuid;
  v_t   app.stock_trades%rowtype;
  v_amt bigint;
  v_e   uuid;
  v_r   jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'buy_stock', private.req_hash(jsonb_build_object(
           'account', p_account_id, 'ticker', p_ticker, 'shares', p_shares, 'price', p_price, 'fee', p_fee,
           'from', p_from_account_id, 'on', p_on)));
  if v_r is not null then
    return v_r;
  end if;
  perform private.stock_check(p_ticker, p_shares, p_price, v_fee, 0, false);
  v_on := private.check_date(p_on);
  perform private.lock_accounts(array[p_account_id, p_from_account_id]);
  v_acc := private.stock_account(p_account_id);
  v_src := private.stock_cash_account(p_from_account_id, 'from_account_id', v_acc.space_id);
  if v_on < greatest(v_acc.opened_on, v_src.opened_on) then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;
  v_h := private.stock_holding(v_acc, p_ticker, v_uid);
  perform private.stock_assert_after(v_h, v_on);
  v_amt := p_shares * p_price + v_fee;

  insert into private.stock_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  insert into app.stock_trades (space_id, holding_id, side, shares, price, fee, occurred_on, created_by)
  values (v_acc.space_id, v_h, 'buy', p_shares, p_price, v_fee, v_on, v_uid)
  returning * into v_t;
  v_e := private.stock_entry(v_t, 'transfer', v_src.id, v_acc.id, v_amt, v_uid);
  perform private.assert_balance(v_src.id, -v_amt, p_allow_negative);
  delete from private.stock_ctx where xid = pg_catalog.pg_current_xact_id();

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'trade_id', v_t.id, 'holding_id', v_h, 'entry_id', v_e, 'amount', v_amt, 'version', 1,
    'warnings', '[]'::jsonb));
end $$;

-- ===== Jual =====
create function api.sell_stock(
  p_client_id     uuid,
  p_account_id    uuid,
  p_ticker        text,
  p_shares        bigint,
  p_price         bigint,
  p_fee           bigint,
  p_tax           bigint,
  p_to_account_id uuid,
  p_on            date default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_fee bigint := coalesce(p_fee, 0);
  v_tax bigint := coalesce(p_tax, 0);
  v_on  date;
  v_acc app.accounts%rowtype;
  v_dst app.accounts%rowtype;
  v_h   uuid;
  v_cr  bigint;
  v_net bigint;
  v_t   app.stock_trades%rowtype;
  v_val uuid;
  v_e   uuid;
  v_r   jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'sell_stock', private.req_hash(jsonb_build_object(
           'account', p_account_id, 'ticker', p_ticker, 'shares', p_shares, 'price', p_price, 'fee', p_fee,
           'tax', p_tax, 'to', p_to_account_id, 'on', p_on)));
  if v_r is not null then
    return v_r;
  end if;
  perform private.stock_check(p_ticker, p_shares, p_price, v_fee, v_tax, true);
  v_on := private.check_date(p_on);
  perform private.lock_accounts(array[p_account_id, p_to_account_id]);
  v_acc := private.stock_account(p_account_id);
  v_dst := private.stock_cash_account(p_to_account_id, 'to_account_id', v_acc.space_id);
  select h.id into v_h from app.stock_holdings h where h.account_id = v_acc.id and h.ticker = p_ticker;
  if v_h is null then
    raise exception using errcode = 'DK404', message = 'holding_not_found';
  end if;
  if v_on < greatest(v_acc.opened_on, v_dst.opened_on) then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;
  perform private.stock_assert_after(v_h, v_on);
  -- Dibaca sesudah kunci dompet saham (lihat urutan kunci di kepala berkas).
  v_cr := private.stock_cost_removed(v_h, p_shares);
  v_net := p_shares * p_price - v_fee - v_tax;

  insert into private.stock_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  insert into app.stock_trades (space_id, holding_id, side, shares, price, fee, tax, cost_removed, occurred_on,
                                created_by)
  values (v_acc.space_id, v_h, 'sell', p_shares, p_price, v_fee, v_tax, v_cr, v_on, v_uid)
  returning * into v_t;
  if v_net <> v_cr then
    v_val := private.stock_entry(v_t, 'valuation', v_acc.id, null, v_net - v_cr, v_uid);
  end if;
  v_e := private.stock_entry(v_t, 'transfer', v_acc.id, v_dst.id, v_net, v_uid);
  -- Pertahanan berlapis: saldo buku dompet saham = Σ biaya posisi, tidak pernah negatif.
  perform private.assert_balance(v_acc.id, -v_net, false);
  delete from private.stock_ctx where xid = pg_catalog.pg_current_xact_id();

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'trade_id', v_t.id, 'holding_id', v_h, 'entry_id', v_e, 'valuation_entry_id', v_val, 'proceeds', v_net,
    'cost_removed', v_cr, 'realized', v_net - v_cr, 'version', 1, 'warnings', '[]'::jsonb));
end $$;

-- ===== Saham yang sudah dimiliki (tanpa efek kas) =====
create function api.open_stock_holding(
  p_client_id  uuid,
  p_account_id uuid,
  p_ticker     text,
  p_shares     bigint,
  p_price      bigint,
  p_on         date default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_on  date;
  v_acc app.accounts%rowtype;
  v_h   uuid;
  v_t   app.stock_trades%rowtype;
  v_e   uuid;
  v_r   jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'open_stock_holding', private.req_hash(jsonb_build_object(
           'account', p_account_id, 'ticker', p_ticker, 'shares', p_shares, 'price', p_price, 'on', p_on)));
  if v_r is not null then
    return v_r;
  end if;
  perform private.stock_check(p_ticker, p_shares, p_price, 0, 0, false);
  v_on := private.check_date(p_on);
  perform private.lock_accounts(array[p_account_id]);
  v_acc := private.stock_account(p_account_id);
  if v_on < v_acc.opened_on then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;
  v_h := private.stock_holding(v_acc, p_ticker, v_uid);
  perform private.stock_assert_after(v_h, v_on);

  insert into private.stock_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  insert into app.stock_trades (space_id, holding_id, side, shares, price, occurred_on, created_by)
  values (v_acc.space_id, v_h, 'opening', p_shares, p_price, v_on, v_uid)
  returning * into v_t;
  v_e := private.stock_entry(v_t, 'opening_balance', v_acc.id, null, p_shares * p_price, v_uid);
  delete from private.stock_ctx where xid = pg_catalog.pg_current_xact_id();

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'trade_id', v_t.id, 'holding_id', v_h, 'entry_id', v_e, 'amount', p_shares * p_price, 'version', 1,
    'warnings', '[]'::jsonb));
end $$;

-- ===== Batal / pulihkan trade hidup terakhir per holding =====
create function api.void_stock_trade(p_client_id uuid, p_trade_id uuid, p_allow_negative boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_t   app.stock_trades%rowtype;
  v_ids uuid[];
  v_acc record;
  v_r   jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'void_stock_trade', private.req_hash(
           jsonb_build_object('trade', p_trade_id)));
  if v_r is not null then
    return v_r;
  end if;
  v_t := private.lock_stock_trade(p_trade_id);
  if v_t.voided_at is not null then
    raise exception using errcode = 'DK422', message = 'already_voided';
  end if;
  if exists (select 1 from app.stock_trades t
              where t.holding_id = v_t.holding_id and t.voided_at is null and t.seq > v_t.seq) then
    raise exception using errcode = 'DK422', message = 'trade_not_latest';
  end if;
  select array_agg(e.id order by e.id) into v_ids from app.entries e where e.stock_trade_id = v_t.id;
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  if exists (select 1 from app.entry_lines l join app.accounts a on a.id = l.account_id
              where l.entry_id = any (v_ids) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  insert into private.stock_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  perform private.split_set_void(v_ids, true, v_uid);
  update app.stock_trades set voided_at = app.now(), voided_by = v_uid where id = v_t.id;
  for v_acc in
    select l.account_id, sum(l.amount)::bigint as amt
    from app.entry_lines l where l.entry_id = any (v_ids) group by l.account_id order by l.account_id
  loop
    perform private.assert_balance(v_acc.account_id, -v_acc.amt, p_allow_negative);
  end loop;
  delete from private.stock_ctx where xid = pg_catalog.pg_current_xact_id();

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'trade_id', v_t.id, 'affected', to_jsonb(v_ids), 'effects', private.debt_effects(v_ids, -1),
    'warnings', '[]'::jsonb));
end $$;

create function api.restore_stock_trade(p_client_id uuid, p_trade_id uuid, p_allow_negative boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_t   app.stock_trades%rowtype;
  v_p   app.stock_positions%rowtype;
  v_ids uuid[];
  v_acc record;
  v_r   jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'restore_stock_trade', private.req_hash(
           jsonb_build_object('trade', p_trade_id)));
  if v_r is not null then
    return v_r;
  end if;
  v_t := private.lock_stock_trade(p_trade_id);
  if v_t.voided_at is null then
    raise exception using errcode = 'DK422', message = 'not_voided';
  end if;
  if v_t.voided_at < app.now() - interval '90 days' then
    raise exception using errcode = 'DK422', message = 'restore_window_closed';
  end if;
  if exists (select 1 from app.stock_trades t
              where t.holding_id = v_t.holding_id and t.voided_at is null and t.seq > v_t.seq) then
    raise exception using errcode = 'DK422', message = 'trade_not_latest';
  end if;
  perform private.stock_assert_after(v_t.holding_id, v_t.occurred_on);
  -- Jual hanya pulih bila posisi sekarang memberi biaya keluar yang sama (trade lain di bawahnya bisa sudah batal).
  if v_t.side = 'sell' then
    select * into v_p from app.stock_positions where holding_id = v_t.holding_id;
    if v_p.shares < v_t.shares then
      raise exception using errcode = 'DK422', message = 'trade_not_latest';
    end if;
    if private.stock_cost_removed(v_t.holding_id, v_t.shares) <> v_t.cost_removed then
      raise exception using errcode = 'DK422', message = 'trade_not_latest';
    end if;
  end if;
  select array_agg(e.id order by e.id) into v_ids from app.entries e where e.stock_trade_id = v_t.id;
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  if exists (select 1 from app.entry_lines l join app.accounts a on a.id = l.account_id
              where l.entry_id = any (v_ids) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  insert into private.stock_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  perform private.split_set_void(v_ids, false, v_uid);
  update app.stock_trades set voided_at = null, voided_by = null where id = v_t.id;
  for v_acc in
    select l.account_id, sum(l.amount)::bigint as amt
    from app.entry_lines l where l.entry_id = any (v_ids) group by l.account_id order by l.account_id
  loop
    perform private.assert_balance(v_acc.account_id, v_acc.amt, p_allow_negative);
  end loop;
  delete from private.stock_ctx where xid = pg_catalog.pg_current_xact_id();

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'trade_id', v_t.id, 'affected', to_jsonb(v_ids), 'effects', private.debt_effects(v_ids, 1),
    'warnings', '[]'::jsonb));
end $$;

-- ===== Harga manual (K1, K8) =====
create function api.set_stock_price(
  p_client_id     uuid,
  p_space_id      uuid,
  p_ticker        text,
  p_on            date,
  p_close         bigint,
  p_confirm_spike boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := private.require_user();
  v_on       date;
  v_replaced boolean;
  v_r        jsonb;
begin
  v_r := private.idem_begin(v_uid, p_client_id, 'set_stock_price', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'ticker', p_ticker, 'on', p_on, 'close', p_close)));
  if v_r is not null then
    return v_r;
  end if;
  perform app.assert_member(p_space_id);
  if (select s.kind from app.spaces s where s.id = p_space_id) <> 'personal' then
    raise exception using errcode = 'DK422', message = 'pocket_personal_only';
  end if;
  if p_ticker is null or not ((p_ticker collate "C") ~ '^[A-Z]{4}$') then
    raise exception using errcode = 'DK400', message = 'ticker_invalid', detail = 'ticker';
  end if;
  v_on := private.check_date(p_on);
  if private.price_verdict(p_space_id, p_ticker, v_on, p_close) = 'invalid' then
    raise exception using errcode = 'DK400', message = 'price_invalid', detail = 'close';
  end if;
  if private.price_verdict(p_space_id, p_ticker, v_on, p_close) = 'held' and not coalesce(p_confirm_spike, false) then
    raise exception using errcode = 'DK422', message = 'price_spike_unconfirmed';
  end if;
  insert into app.stock_prices (space_id, ticker, on_date, close, source, status, created_by)
  values (p_space_id, p_ticker, v_on, p_close, 'manual', 'ok', v_uid)
  on conflict (space_id, ticker, on_date) do update
    set close = excluded.close, source = 'manual', status = 'ok', reason = null,
        created_by = excluded.created_by, created_at = excluded.created_at
  returning xmax <> 0 into v_replaced;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'on_date', v_on, 'status', 'ok', 'replaced', v_replaced, 'warnings', '[]'::jsonb));
end $$;

-- ===== Baca (SECURITY INVOKER: RLS tetap berlaku) =====
create function api.preview_sell(
  p_account_id uuid,
  p_ticker     text,
  p_shares     bigint,
  p_price      bigint,
  p_fee        bigint default 0,
  p_tax        bigint default 0
) returns table (cost_removed bigint, proceeds bigint, realized bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_h   uuid;
  v_cr  bigint;
  v_net bigint;
begin
  perform private.stock_check(p_ticker, p_shares, p_price, coalesce(p_fee, 0), coalesce(p_tax, 0), true);
  select h.id into v_h from app.stock_holdings h where h.account_id = p_account_id and h.ticker = p_ticker;
  if v_h is null then
    raise exception using errcode = 'DK404', message = 'holding_not_found';
  end if;
  v_cr := private.stock_cost_removed(v_h, p_shares);
  v_net := p_shares * p_price - coalesce(p_fee, 0) - coalesce(p_tax, 0);
  return query select v_cr, v_net, v_net - v_cr;
end $$;

create function api.stock_overview(p_account_id uuid)
returns table (holding_id uuid, ticker text, shares bigint, cost_total bigint, avg_cost bigint, close bigint,
               close_on date, stale boolean, held_pending boolean, held_on date, market_value bigint,
               unrealized bigint, realized bigint, last_trade_id uuid, last_trade_side text,
               last_trade_shares bigint, last_trade_price bigint, last_trade_on date, missing_price_count int)
language plpgsql stable set search_path = '' as $$
#variable_conflict use_column
declare v_space uuid;
begin
  select a.space_id into v_space from app.accounts a where a.id = p_account_id;
  if v_space is null then
    raise exception using errcode = 'DK404', message = 'account_not_found', detail = 'account_id';
  end if;
  if not exists (select 1 from app.asset_details d where d.account_id = p_account_id and d.asset_kind = 'saham') then
    raise exception using errcode = 'DK422', message = 'asset_account_invalid', detail = 'account_id';
  end if;
  return query
  with h as (
    select p.holding_id, p.ticker, p.shares, p.cost_total, p.avg_cost, p.realized, pr.close, pr.on_date as close_on,
           hd.held_on, lt.id as lt_id, lt.side as lt_side, lt.shares as lt_shares, lt.price as lt_price,
           lt.occurred_on as lt_on
      from app.stock_positions p
      left join lateral app.stock_last_close(p.space_id, p.ticker, app.today()) pr on true
      left join lateral (
        select max(sp.on_date) as held_on from app.stock_prices sp
         where sp.space_id = p.space_id and sp.ticker = p.ticker and sp.status = 'held'
           and (pr.on_date is null or sp.on_date > pr.on_date)
      ) hd on true
      left join lateral (
        select t.id, t.side, t.shares, t.price, t.occurred_on from app.stock_trades t
         where t.holding_id = p.holding_id and t.voided_at is null order by t.seq desc limit 1
      ) lt on true
     where p.account_id = p_account_id
  ), v as (
    select h.*,
           case when h.shares > 0 then coalesce(h.px, h.cost_total) else 0 end::bigint as mv,
           case when h.close is not null then
             (case when h.shares > 0 then h.px else 0 end - h.cost_total) end::bigint as unr,
           -- Lebih dari 3 hari bursa (Senin-Jumat di luar app.holidays) sesudah tanggal harga. Kode berlembar 0 tidak
           -- usang dan tidak tertahan: price_targets tidak lagi memperbarui harganya (review 0143 P1).
           case when h.shares = 0 then false when h.close is not null then
             (select count(*) from pg_catalog.generate_series((h.close_on + 1)::timestamp, app.today()::timestamp,
                                                               interval '1 day') d
               where extract(isodow from d) < 6
                 and not exists (select 1 from app.holidays x where x.on_date = d::date)) > 3 end as stl,
           (h.shares > 0 and h.held_on is not null) as hp,
           (h.shares > 0 and h.close is null)::int as miss
      -- Nilai pasar dihitung numeric lalu dibatasi 10^13 (batas nominal proyek, check_amount): lembar x harga bisa
      -- melewati bigint (10^13 lembar x 10^6). Angka sebesar itu tidak realistis; batas menjaga Dompet tetap
      -- termuat. api.net_worth (Task 6) wajib memakai pola yang sama.
      -- least() mengabaikan NULL, jadi tanpa harga dijaga eksplisit.
      from (select h.*, case when h.close is not null then least(h.shares::numeric * h.close, 10000000000000) end as px
              from h) h
  )
  select x.holding_id, x.ticker, x.shares, x.cost_total, x.avg_cost, x.close, x.close_on, x.stale, x.held_pending,
         x.held_on, x.market_value, x.unrealized, x.realized, x.lt_id, x.lt_side, x.lt_shares, x.lt_price, x.lt_on,
         x.miss
    from (
      select v.holding_id, v.ticker, v.shares, v.cost_total, v.avg_cost, v.close, v.close_on, v.stl as stale,
             v.hp as held_pending, v.held_on, v.mv as market_value, v.unr as unrealized, v.realized,
             v.lt_id, v.lt_side, v.lt_shares, v.lt_price, v.lt_on, v.miss, 0 as grp
        from v
      union all
      select null, null, null, coalesce(sum(v.cost_total), 0)::bigint, null, null, null,
             coalesce(bool_or(v.stl), false), coalesce(bool_or(v.hp), false), null,
             coalesce(sum(v.mv), 0)::bigint, sum(v.unr)::bigint, coalesce(sum(v.realized), 0)::bigint,
             null, null, null, null, null, coalesce(sum(v.miss), 0)::int, 1
        from v
    ) x
   order by x.grp, x.market_value desc, x.ticker collate "C";
end $$;

-- ===== Ringkasan aset (0141 + nilai pasar dompet saham, ruling Task 1) =====
drop function api.asset_overview(uuid);
create function api.asset_overview(p_space_id uuid)
returns table (account_id uuid, name text, asset_kind text, balance bigint, last_valued_on date, last_change bigint,
               market_value bigint, missing_price_count int)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  select a.id, a.name, d.asset_kind, ab.balance, v.occurred_on, v.amount, s.mv, s.miss
    from app.accounts a
    join app.asset_details d on d.account_id = a.id
    join app.account_balances ab on ab.account_id = a.id
    left join lateral (
      select e.occurred_on, l.amount
        from app.entries e
        join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id and l.role = 'main'
       where l.account_id = a.id and e.kind = 'valuation' and e.voided_at is null
       order by e.occurred_on desc, e.created_at desc, e.id desc
       limit 1
    ) v on true
    -- Dompet saham: Σ nilai pasar posisi terbuka (tanpa harga = biaya perolehan) dan jumlah kode tanpa harga.
    -- Per kode numeric dibatasi 10^13 seperti api.stock_overview (tanpa bigint out of range).
    left join lateral (
      select coalesce(sum(case when p.shares > 0 then coalesce(
                 case when pr.close is not null then least(p.shares::numeric * pr.close, 10000000000000) end,
                 p.cost_total) else 0 end), 0)::bigint as mv,
             count(*) filter (where p.shares > 0 and pr.close is null)::int as miss
        from app.stock_positions p
        left join lateral app.stock_last_close(p.space_id, p.ticker, app.today()) pr on true
       where p.account_id = a.id
    ) s on d.asset_kind = 'saham'
   where a.space_id = p_space_id and a.pocket = 'aset' and a.archived_at is null
   order by a.sort_order, a.created_at, a.id;
end $$;

-- ===== Arsip dompet (0138 + K11): lembar > 0 ditolak lebih dulu, lalu tujuan aktif, lalu saldo harus 0 =====
create or replace function api.archive_account(p_account_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_acc app.accounts%rowtype;
begin
  perform private.lock_accounts(array[p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.archived_at is null then
    if exists (select 1 from app.stock_positions p where p.account_id = v_acc.id and p.shares > 0) then
      raise exception using errcode = 'DK422', message = 'account_has_holdings';
    end if;
    if exists (select 1 from app.goals g where g.account_id = v_acc.id and g.status = 'active') then
      raise exception using errcode = 'DK422', message = 'account_has_goal';
    end if;
    if private.balance(v_acc.id) <> 0 then
      raise exception using errcode = 'DK422', message = 'balance_not_zero';
    end if;
    update app.accounts set archived_at = app.now(), updated_at = app.now() where id = v_acc.id;
  end if;
  return jsonb_build_object('account_id', v_acc.id, 'archived', true);
end $$;

-- ===== Job harga (K1, K9): hanya worker =====
-- Kode unik yang masih dipegang (lembar > 0, dompet aktif) semua ruang; tanpa ruang, pemegang, atau lembar.
create function jobs.price_targets() returns table (ticker text)
language sql stable security definer set search_path = '' as $$
  select x.t from (
    select distinct p.ticker as t
      from app.stock_positions p join app.accounts a on a.id = p.account_id
     where p.shares > 0 and a.archived_at is null
  ) x
  order by x.t collate "C"
$$;

-- Validasi ulang bentuk dan nilai di SQL (worker sudah memvalidasi, ini lapisan kedua), tulis per ruang pemegang.
create function jobs.price_ingest(p_on date, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ok   int := 0;
  v_held int := 0;
  v_skip int := 0;
  v_acc  int := 0;
  v_last text;
  v_st   text;
  r      record;
begin
  if p_on is null or p_on < date '2000-01-01' or p_on > app.today() then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'on';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 100 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'rows';
  end if;
  for r in
    with parsed as (
      select case when jsonb_typeof(x.v -> 'ticker') = 'string'
                   and ((x.v ->> 'ticker') collate "C") ~ '^[A-Z]{4}$' then x.v ->> 'ticker' end as ticker,
             case when jsonb_typeof(x.v -> 'close') = 'number' then (x.v ->> 'close')::numeric end as close
        from jsonb_array_elements(p_rows) x (v)
       where jsonb_typeof(x.v) = 'object'
    ), uniq as (
      -- Kode ganda dalam satu run ambigu: semua kemunculannya ditolak, apa pun harganya (dihitung sebelum validasi
      -- harga, review 0143 K3).
      select p.ticker, min(p.close)::bigint as close
        from parsed p
       where p.ticker is not null
       group by p.ticker
      having count(*) = 1 and bool_and(p.close = trunc(p.close) and p.close between 1 and 1000000000)
    )
    select u.ticker, u.close, s.space_id
      from uniq u
      join lateral (
        select distinct p.space_id from app.stock_positions p join app.accounts a on a.id = p.account_id
         where p.ticker = u.ticker and p.shares > 0 and a.archived_at is null
      ) s on true
     order by u.ticker collate "C", s.space_id
  loop
    if v_last is distinct from r.ticker then
      v_acc := v_acc + 1;
      v_last := r.ticker;
    end if;
    v_st := private.price_verdict(r.space_id, r.ticker, p_on, r.close);
    -- Harga manual tanggal itu tidak ditimpa (pengguna yang terakhir memutuskan).
    insert into app.stock_prices (space_id, ticker, on_date, close, source, status, reason)
    values (r.space_id, r.ticker, p_on, r.close, 'provider', v_st, case when v_st = 'held' then 'spike' end)
    on conflict (space_id, ticker, on_date) do update
      set close = excluded.close, status = excluded.status, reason = excluded.reason, created_at = excluded.created_at
      where app.stock_prices.source = 'provider';
    if not found then
      v_skip := v_skip + 1;
    elsif v_st = 'held' then
      v_held := v_held + 1;
    else
      v_ok := v_ok + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', v_ok, 'held', v_held, 'rejected', jsonb_array_length(p_rows) - v_acc,
                            'skipped', v_skip);
end $$;

-- ===== Purge 90 hari (0136 + trade saham dan harga held, K11) =====
create or replace function jobs.purge_voided() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_n int := 0;
begin
  -- 0136: konteks patungan (tg_split_guard) dan baris patungan batal > 90 hari lebih dulu (FK dari entri;
  -- pemulihan ditolak sesudah 90 hari, entrinya batal di waktu yang sama). Pelunasan batal selalu belum
  -- diterima (CHECK), jadi tidak merujuk kaki terima.
  insert into private.split_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  -- 0143: konteks saham (tg_stock_guard): entri trade batal ikut lintasan di bawah, trade sesudahnya (FK dari entri).
  insert into private.stock_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  delete from app.settlements t where t.voided_at < app.now() - interval '90 days';
  delete from app.splits s where s.voided_at < app.now() - interval '90 days';
  for i in 1..2 loop
    -- Kunci urut id (sama dengan void/restore); baris yang dipulihkan paralel diperiksa ulang
    -- sesudah lock (READ COMMITTED) dan tidak ikut (review S5).
    select coalesce(array_agg(x.id), '{}') into v_ids
    from (
      select e.id
      from app.entries e
      where e.voided_at < app.now() - interval '90 days'
        and not exists (select 1 from app.entries r where r.reimburses_entry_id = e.id)
        and (e.link_id is null or not exists (
              select 1 from app.entries p
              where p.link_id = e.link_id
                and (p.voided_at is null or p.voided_at >= app.now() - interval '90 days')))
        and not (e.voided_with_debt and exists (
              select 1 from app.debts d
              where d.space_id = e.space_id and d.id = e.debt_id
                and d.voided_at >= app.now() - interval '90 days'))
        -- 0136: entri (atau pasangannya) yang masih dirujuk baris patungan tidak ikut.
        and not exists (
              select 1 from app.entries p
              where (p.id = e.id or (e.link_id is not null and p.link_id = e.link_id))
                and (exists (select 1 from app.splits s where p.id in (s.in_entry_id, s.expense_entry_id))
                     or exists (select 1 from app.settlements t
                                 where p.id in (t.in_entry_id, t.received_entry_id))))
      order by e.id
      for update of e
    ) x;
    exit when cardinality(v_ids) = 0;
    v_n := v_n + private.purge_entries(v_ids, 'purge_voided');
  end loop;
  delete from app.debts d
   where d.voided_at < app.now() - interval '90 days'
     and not exists (select 1 from app.entries e where e.space_id = d.space_id and e.debt_id = d.id);
  delete from app.stock_trades t
   where t.voided_at < app.now() - interval '90 days'
     and not exists (select 1 from app.entries e where e.space_id = t.space_id and e.stock_trade_id = t.id);
  delete from app.stock_prices p where p.status = 'held' and p.on_date < app.today() - 90;
  delete from private.stock_ctx where xid = pg_catalog.pg_current_xact_id();
  delete from private.split_ctx where xid = pg_catalog.pg_current_xact_id();
  return v_n;
end $$;

-- ===== Jalur generik (review 0143 K1): entri trade ditolak sebelum kunci =====
-- Badan terakhir: api.void_entry/restore_entry 0103 (private.set_void_state 0131 tidak berubah), api.update_entry 0110,
-- api.move_entry_to_space 0111, api.purge_entry 0131; hanya cek stock_trade_id di depan yang baru.
create or replace function api.void_entry(
  p_client_id uuid, p_entry_id uuid, p_expected_version int, p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  -- 0143: entri trade saham hanya lewat API saham, ditolak SEBELUM kunci entri (trade mengunci dompet -> entri).
  if exists (select 1 from app.entries e where e.id = p_entry_id and e.stock_trade_id is not null) then
    raise exception using errcode = 'DK422', message = 'stock_account_trade_only', detail = 'account_id';
  end if;
  set constraints all deferred;
  v := private.set_void_state(p_client_id, p_entry_id, p_expected_version, true, p_allow_negative);
  set constraints all immediate;
  return v;
end $$;

create or replace function api.restore_entry(
  p_client_id uuid, p_entry_id uuid, p_expected_version int, p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  -- 0143: entri trade saham hanya lewat API saham, ditolak SEBELUM kunci entri (trade mengunci dompet -> entri).
  if exists (select 1 from app.entries e where e.id = p_entry_id and e.stock_trade_id is not null) then
    raise exception using errcode = 'DK422', message = 'stock_account_trade_only', detail = 'account_id';
  end if;
  set constraints all deferred;
  v := private.set_void_state(p_client_id, p_entry_id, p_expected_version, false, p_allow_negative);
  set constraints all immediate;
  return v;
end $$;

create or replace function api.update_entry(
  p_client_id        uuid,
  p_entry_id         uuid,
  p_expected_version int,
  p_account_id       uuid,
  p_amount           bigint,
  p_category_id      uuid,                    -- ganti-penuh: tanpa default (§9.1)
  p_occurred_on      date,                    -- NULL = tanggal lama
  p_description      text,
  p_reimbursable     boolean,
  p_allow_negative   boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_desc text := private.clean_text(p_description, 'description');
  v_e    app.entries%rowtype;
  v_old  app.entry_lines%rowtype;
  v_acc  app.accounts%rowtype;
  v_on   date;
  v_new  bigint;
  v_done bigint;
  v_r    jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'update_entry', private.req_hash(jsonb_build_object(
           'entry', p_entry_id, 'version', p_expected_version, 'account', p_account_id,
           'amount', p_amount, 'category', p_category_id, 'on', p_occurred_on, 'desc', v_desc,
           'reimbursable', coalesce(p_reimbursable, false))));
  if v_r is not null then
    return v_r;
  end if;
  perform private.check_amount(p_amount, 'amount');
  if p_account_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'account_id';
  end if;

  -- 0143: entri trade saham hanya lewat API saham, ditolak SEBELUM kunci entri (trade mengunci dompet -> entri).
  if exists (select 1 from app.entries e where e.id = p_entry_id and e.stock_trade_id is not null) then
    raise exception using errcode = 'DK422', message = 'stock_account_trade_only', detail = 'account_id';
  end if;
  select * into v_e from app.entries where id = p_entry_id for update;
  if v_e.id is null then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  if p_expected_version is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'expected_version';
  elsif v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if v_e.voided_at is not null then
    raise exception using errcode = 'DK422', message = 'entry_voided';
  end if;
  if v_e.kind not in ('income', 'expense', 'opening_balance') then
    raise exception using errcode = 'DK422', message = 'kind_not_editable';
  end if;
  select * into v_old from app.entry_lines where entry_id = v_e.id and role = 'main';
  perform private.lock_accounts(array[v_old.account_id, p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.space_id <> v_e.space_id then
    raise exception using errcode = 'DK422', message = 'space_mismatch';
  end if;
  -- Dompet terarsip bersaldo 0 dan harus tetap 0 (keputusan pemilik #8).
  if exists (select 1 from app.accounts a
             where a.id in (v_old.account_id, p_account_id) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  if v_e.kind = 'opening_balance' then
    -- Saldo awal: hanya nominal, akun tetap, maksimal 7 hari sejak dompet dibuat (spec §9.1).
    if p_account_id <> v_old.account_id or app.today() - (
         select (a.created_at at time zone 'Asia/Jakarta')::date
         from app.accounts a where a.id = v_old.account_id) > 7 then
      raise exception using errcode = 'DK422', message = 'opening_locked';
    end if;
    v_on := v_e.occurred_on;
    v_new := p_amount;
  else
    v_on := private.check_date(coalesce(p_occurred_on, v_e.occurred_on));
    if v_on < v_acc.opened_on then
      raise exception using errcode = 'DK422', message = 'before_opening';
    end if;
    if p_category_id is not null and not exists (
         select 1 from app.categories c
         where c.id = p_category_id and c.space_id = v_e.space_id
           and c.type::text = v_e.kind::text) then
      raise exception using errcode = 'DK404', message = 'category_not_found';
    end if;
    if p_category_id is distinct from v_e.category_id and exists (
         select 1 from app.categories c where c.id = p_category_id and c.archived_at is not null) then
      raise exception using errcode = 'DK422', message = 'category_archived';
    end if;
    if coalesce(p_reimbursable, false) and (v_e.kind <> 'expense' or v_e.space_kind <> 'personal') then
      raise exception using errcode = 'DK422', message = 'reimbursable_personal_expense_only';
    end if;
    -- 0110: talangan dengan reimburse hidup (entri sudah dikunci FOR UPDATE di atas, sehingga
    -- reimburse dan pulihkan reimburse paralel menunggu). "Tidak diganti" ditolak, dan nominal
    -- tidak boleh di bawah Σ reimburse hidup.
    if v_e.kind = 'expense' then
      select coalesce(sum(l.amount), 0)::bigint into v_done
        from app.entries r join app.entry_lines l on l.entry_id = r.id and l.role = 'main'
       where r.space_id = v_e.space_id and r.reimburses_entry_id = v_e.id and r.voided_at is null;
      if v_done > 0 and not coalesce(p_reimbursable, false) then
        raise exception using errcode = 'DK422', message = 'reimbursement_exists';
      end if;
      if p_amount < v_done then
        raise exception using errcode = 'DK422', message = 'reimbursement_exceeds';
      end if;
    end if;
    v_new := case v_e.kind when 'income' then p_amount else -p_amount end;
  end if;

  update app.entries
     set occurred_on  = v_on,
         description  = case when kind = 'opening_balance' then null else v_desc end,
         category_id  = case when kind = 'opening_balance' then null else p_category_id end,
         reimbursable = case when kind = 'expense' then coalesce(p_reimbursable, false) else false end,
         version      = version + 1,
         updated_by   = v_uid,
         updated_at   = app.now()
   where id = v_e.id;
  delete from app.entry_lines where entry_id = v_e.id;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_e.id, v_e.space_id, 'main', p_account_id, v_new);
  perform private.write_history(v_e.id, 'update', v_uid);

  if p_account_id = v_old.account_id then
    perform private.assert_balance(p_account_id, v_new - v_old.amount, p_allow_negative);
  else
    perform private.assert_balance(v_old.account_id, -v_old.amount, p_allow_negative);
    perform private.assert_balance(p_account_id, v_new, p_allow_negative);
  end if;

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_e.id, 'version', v_e.version + 1, 'warnings', '[]'::jsonb));
end $$;

create or replace function api.move_entry_to_space(
  p_client_id        uuid,
  p_entry_id         uuid,
  p_expected_version int,
  p_to_space_id      uuid,
  p_account_id       uuid,
  p_category_id      uuid,
  p_keep_description boolean default false,
  p_allow_negative   boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_e     app.entries%rowtype;
  v_old   app.entry_lines%rowtype;
  v_acc   app.accounts%rowtype;
  v_entry uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'move_entry_to_space', private.req_hash(
           jsonb_build_object('entry', p_entry_id, 'version', p_expected_version,
                              'to_space', p_to_space_id, 'account', p_account_id,
                              'category', p_category_id,
                              'keep_desc', coalesce(p_keep_description, false))));
  if v_r is not null then
    return v_r;
  end if;
  if p_to_space_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'to_space_id';
  end if;
  if p_account_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'account_id';
  end if;

  -- 0143: entri trade saham hanya lewat API saham, ditolak SEBELUM kunci entri (trade mengunci dompet -> entri).
  if exists (select 1 from app.entries e where e.id = p_entry_id and e.stock_trade_id is not null) then
    raise exception using errcode = 'DK422', message = 'stock_account_trade_only', detail = 'account_id';
  end if;
  -- Entri dulu, lalu akun (lihat komentar urutan kunci di atas). RLS: bukan anggota = tidak ada.
  select * into v_e from app.entries where id = p_entry_id for update;
  if v_e.id is null then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  -- Jenis sebelum pencatat: kaki space_transfer Bersama catatan orang lain = kind_not_movable.
  if v_e.kind not in ('income', 'expense') then
    raise exception using errcode = 'DK422', message = 'kind_not_movable';
  end if;
  if v_e.created_by <> v_uid then
    raise exception using errcode = 'DK422', message = 'not_creator';
  end if;
  if p_expected_version is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'expected_version';
  elsif v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if v_e.voided_at is not null then
    raise exception using errcode = 'DK422', message = 'entry_voided';
  end if;
  if p_to_space_id = v_e.space_id then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'to_space_id';
  end if;
  perform app.assert_member(p_to_space_id);
  -- Reimburse hidup dibaca sesudah kunci entri: reimburse dan pulihkan reimburse paralel
  -- mengunci entri ini lebih dulu, jadi yang di-commit sebelumnya terlihat di sini.
  if exists (select 1 from app.entries r
             where r.space_id = v_e.space_id and r.reimburses_entry_id = v_e.id
               and r.voided_at is null) then
    raise exception using errcode = 'DK422', message = 'reimbursement_exists';
  end if;

  select * into v_old from app.entry_lines where entry_id = v_e.id and role = 'main';
  perform private.lock_accounts(array[v_old.account_id, p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.space_id <> p_to_space_id then
    raise exception using errcode = 'DK422', message = 'space_mismatch';
  end if;
  if exists (select 1 from app.accounts a
             where a.id in (v_old.account_id, p_account_id) and a.pocket = 'kantor') then
    raise exception using errcode = 'DK422', message = 'cross_space_kantor';
  end if;
  -- Dompet terarsip bersaldo 0 dan harus tetap 0 (keputusan pemilik #8), termasuk dompet asal.
  if exists (select 1 from app.accounts a
             where a.id in (v_old.account_id, p_account_id) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;
  if v_e.occurred_on < v_acc.opened_on then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;
  if p_category_id is not null and not exists (
       select 1 from app.categories c
       where c.id = p_category_id and c.space_id = v_acc.space_id
         and c.type::text = v_e.kind::text) then
    raise exception using errcode = 'DK404', message = 'category_not_found';
  end if;
  -- Pola create_entry 0106: terarsip dibedakan dari tidak ada / ruang lain / jenis salah.
  if p_category_id is not null and exists (
       select 1 from app.categories c where c.id = p_category_id and c.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'category_archived';
  end if;

  insert into app.entries (space_id, space_kind, kind, occurred_on, description, category_id,
                           reimbursable, created_by, updated_by)
  values (v_acc.space_id, v_acc.space_kind, v_e.kind, v_e.occurred_on,
          case when v_acc.space_kind = 'personal' or coalesce(p_keep_description, false)
               then v_e.description end,
          p_category_id, v_e.reimbursable and v_acc.space_kind = 'personal', v_uid, v_uid)
  returning id into v_entry;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_entry, v_acc.space_id, 'main', v_acc.id, v_old.amount);

  update app.entries
     set voided_at         = app.now(),
         voided_by         = v_uid,
         moved_at          = app.now(),
         version           = version + 1,
         updated_by        = v_uid,
         updated_at        = app.now()
   where id = v_e.id;
  perform private.write_history(v_e.id, 'void', v_uid);
  perform private.write_history(v_entry, 'create', v_uid);

  perform private.assert_balance(v_old.account_id, -v_old.amount, p_allow_negative);
  perform private.assert_balance(v_acc.id, v_old.amount, p_allow_negative);

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_entry, 'moved_from_entry_id', v_e.id, 'version', 1, 'warnings', '[]'::jsonb));
end $$;

create or replace function api.purge_entry(p_entry_id uuid, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_e   app.entries%rowtype;
  v_ids uuid[];
  v_n   int;
begin
  set constraints all deferred;
  -- 0143: entri trade saham hanya lewat API saham, ditolak SEBELUM kunci entri (trade mengunci dompet -> entri).
  if exists (select 1 from app.entries e where e.id = p_entry_id and e.stock_trade_id is not null) then
    raise exception using errcode = 'DK422', message = 'stock_account_trade_only', detail = 'account_id';
  end if;
  select * into v_e from app.entries where id = p_entry_id;
  if v_e.id is null or (v_e.kind = 'space_transfer' and v_e.created_by <> v_uid) then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  if v_e.kind = 'space_transfer' then
    select array_agg(id order by id) into v_ids from app.entries where link_id = v_e.link_id;
  else
    v_ids := array[v_e.id];
  end if;
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select * into v_e from app.entries where id = p_entry_id;
  if p_expected_version is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'expected_version';
  elsif v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if v_e.voided_at is null then
    raise exception using errcode = 'DK422', message = 'not_voided';
  end if;
  if exists (select 1 from app.entries r where r.reimburses_entry_id = any (v_ids)) then
    raise exception using errcode = 'DK422', message = 'has_dependents';
  end if;
  -- 0131: entri yang ikut Hapus utang hanya hilang bersama utangnya (restore_debt butuh entri itu).
  if v_e.voided_with_debt then
    raise exception using errcode = 'DK422', message = 'debt_deleted';
  end if;
  v_n := private.purge_entries(v_ids, 'entry_purged');
  set constraints all immediate;
  return jsonb_build_object('affected', to_jsonb(v_ids), 'purged', v_n);
end $$;

-- ===== Hak =====
grant execute on function
  private.stock_check(text, bigint, bigint, bigint, bigint, boolean), private.stock_account(uuid),
  private.stock_cash_account(uuid, text, uuid), private.stock_holding(app.accounts, text, uuid),
  private.stock_assert_after(uuid, date), private.stock_entry(app.stock_trades, app.entry_kind, uuid, uuid, bigint, uuid),
  private.lock_stock_trade(uuid)
  to dompetku_api;
grant execute on function app.stock_last_close(uuid, text, date) to dompetku_web, dompetku_api;
grant execute on function jobs.price_targets(), jobs.price_ingest(date, jsonb) to dompetku_worker;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;

-- Jalur generik kembali ke badan 0103/0110/0111/0131.
create or replace function api.void_entry(
  p_client_id uuid, p_entry_id uuid, p_expected_version int, p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  set constraints all deferred;
  v := private.set_void_state(p_client_id, p_entry_id, p_expected_version, true, p_allow_negative);
  set constraints all immediate;
  return v;
end $$;

create or replace function api.restore_entry(
  p_client_id uuid, p_entry_id uuid, p_expected_version int, p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  set constraints all deferred;
  v := private.set_void_state(p_client_id, p_entry_id, p_expected_version, false, p_allow_negative);
  set constraints all immediate;
  return v;
end $$;

create or replace function api.update_entry(
  p_client_id        uuid,
  p_entry_id         uuid,
  p_expected_version int,
  p_account_id       uuid,
  p_amount           bigint,
  p_category_id      uuid,                    -- ganti-penuh: tanpa default (§9.1)
  p_occurred_on      date,                    -- NULL = tanggal lama
  p_description      text,
  p_reimbursable     boolean,
  p_allow_negative   boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_desc text := private.clean_text(p_description, 'description');
  v_e    app.entries%rowtype;
  v_old  app.entry_lines%rowtype;
  v_acc  app.accounts%rowtype;
  v_on   date;
  v_new  bigint;
  v_done bigint;
  v_r    jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'update_entry', private.req_hash(jsonb_build_object(
           'entry', p_entry_id, 'version', p_expected_version, 'account', p_account_id,
           'amount', p_amount, 'category', p_category_id, 'on', p_occurred_on, 'desc', v_desc,
           'reimbursable', coalesce(p_reimbursable, false))));
  if v_r is not null then
    return v_r;
  end if;
  perform private.check_amount(p_amount, 'amount');
  if p_account_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'account_id';
  end if;

  select * into v_e from app.entries where id = p_entry_id for update;
  if v_e.id is null then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  if p_expected_version is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'expected_version';
  elsif v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if v_e.voided_at is not null then
    raise exception using errcode = 'DK422', message = 'entry_voided';
  end if;
  if v_e.kind not in ('income', 'expense', 'opening_balance') then
    raise exception using errcode = 'DK422', message = 'kind_not_editable';
  end if;
  select * into v_old from app.entry_lines where entry_id = v_e.id and role = 'main';
  perform private.lock_accounts(array[v_old.account_id, p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.space_id <> v_e.space_id then
    raise exception using errcode = 'DK422', message = 'space_mismatch';
  end if;
  -- Dompet terarsip bersaldo 0 dan harus tetap 0 (keputusan pemilik #8).
  if exists (select 1 from app.accounts a
             where a.id in (v_old.account_id, p_account_id) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  if v_e.kind = 'opening_balance' then
    -- Saldo awal: hanya nominal, akun tetap, maksimal 7 hari sejak dompet dibuat (spec §9.1).
    if p_account_id <> v_old.account_id or app.today() - (
         select (a.created_at at time zone 'Asia/Jakarta')::date
         from app.accounts a where a.id = v_old.account_id) > 7 then
      raise exception using errcode = 'DK422', message = 'opening_locked';
    end if;
    v_on := v_e.occurred_on;
    v_new := p_amount;
  else
    v_on := private.check_date(coalesce(p_occurred_on, v_e.occurred_on));
    if v_on < v_acc.opened_on then
      raise exception using errcode = 'DK422', message = 'before_opening';
    end if;
    if p_category_id is not null and not exists (
         select 1 from app.categories c
         where c.id = p_category_id and c.space_id = v_e.space_id
           and c.type::text = v_e.kind::text) then
      raise exception using errcode = 'DK404', message = 'category_not_found';
    end if;
    if p_category_id is distinct from v_e.category_id and exists (
         select 1 from app.categories c where c.id = p_category_id and c.archived_at is not null) then
      raise exception using errcode = 'DK422', message = 'category_archived';
    end if;
    if coalesce(p_reimbursable, false) and (v_e.kind <> 'expense' or v_e.space_kind <> 'personal') then
      raise exception using errcode = 'DK422', message = 'reimbursable_personal_expense_only';
    end if;
    -- 0110: talangan dengan reimburse hidup (entri sudah dikunci FOR UPDATE di atas, sehingga
    -- reimburse dan pulihkan reimburse paralel menunggu). "Tidak diganti" ditolak, dan nominal
    -- tidak boleh di bawah Σ reimburse hidup.
    if v_e.kind = 'expense' then
      select coalesce(sum(l.amount), 0)::bigint into v_done
        from app.entries r join app.entry_lines l on l.entry_id = r.id and l.role = 'main'
       where r.space_id = v_e.space_id and r.reimburses_entry_id = v_e.id and r.voided_at is null;
      if v_done > 0 and not coalesce(p_reimbursable, false) then
        raise exception using errcode = 'DK422', message = 'reimbursement_exists';
      end if;
      if p_amount < v_done then
        raise exception using errcode = 'DK422', message = 'reimbursement_exceeds';
      end if;
    end if;
    v_new := case v_e.kind when 'income' then p_amount else -p_amount end;
  end if;

  update app.entries
     set occurred_on  = v_on,
         description  = case when kind = 'opening_balance' then null else v_desc end,
         category_id  = case when kind = 'opening_balance' then null else p_category_id end,
         reimbursable = case when kind = 'expense' then coalesce(p_reimbursable, false) else false end,
         version      = version + 1,
         updated_by   = v_uid,
         updated_at   = app.now()
   where id = v_e.id;
  delete from app.entry_lines where entry_id = v_e.id;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_e.id, v_e.space_id, 'main', p_account_id, v_new);
  perform private.write_history(v_e.id, 'update', v_uid);

  if p_account_id = v_old.account_id then
    perform private.assert_balance(p_account_id, v_new - v_old.amount, p_allow_negative);
  else
    perform private.assert_balance(v_old.account_id, -v_old.amount, p_allow_negative);
    perform private.assert_balance(p_account_id, v_new, p_allow_negative);
  end if;

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_e.id, 'version', v_e.version + 1, 'warnings', '[]'::jsonb));
end $$;

create or replace function api.move_entry_to_space(
  p_client_id        uuid,
  p_entry_id         uuid,
  p_expected_version int,
  p_to_space_id      uuid,
  p_account_id       uuid,
  p_category_id      uuid,
  p_keep_description boolean default false,
  p_allow_negative   boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_e     app.entries%rowtype;
  v_old   app.entry_lines%rowtype;
  v_acc   app.accounts%rowtype;
  v_entry uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'move_entry_to_space', private.req_hash(
           jsonb_build_object('entry', p_entry_id, 'version', p_expected_version,
                              'to_space', p_to_space_id, 'account', p_account_id,
                              'category', p_category_id,
                              'keep_desc', coalesce(p_keep_description, false))));
  if v_r is not null then
    return v_r;
  end if;
  if p_to_space_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'to_space_id';
  end if;
  if p_account_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'account_id';
  end if;

  -- Entri dulu, lalu akun (lihat komentar urutan kunci di atas). RLS: bukan anggota = tidak ada.
  select * into v_e from app.entries where id = p_entry_id for update;
  if v_e.id is null then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  -- Jenis sebelum pencatat: kaki space_transfer Bersama catatan orang lain = kind_not_movable.
  if v_e.kind not in ('income', 'expense') then
    raise exception using errcode = 'DK422', message = 'kind_not_movable';
  end if;
  if v_e.created_by <> v_uid then
    raise exception using errcode = 'DK422', message = 'not_creator';
  end if;
  if p_expected_version is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'expected_version';
  elsif v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if v_e.voided_at is not null then
    raise exception using errcode = 'DK422', message = 'entry_voided';
  end if;
  if p_to_space_id = v_e.space_id then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'to_space_id';
  end if;
  perform app.assert_member(p_to_space_id);
  -- Reimburse hidup dibaca sesudah kunci entri: reimburse dan pulihkan reimburse paralel
  -- mengunci entri ini lebih dulu, jadi yang di-commit sebelumnya terlihat di sini.
  if exists (select 1 from app.entries r
             where r.space_id = v_e.space_id and r.reimburses_entry_id = v_e.id
               and r.voided_at is null) then
    raise exception using errcode = 'DK422', message = 'reimbursement_exists';
  end if;

  select * into v_old from app.entry_lines where entry_id = v_e.id and role = 'main';
  perform private.lock_accounts(array[v_old.account_id, p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.space_id <> p_to_space_id then
    raise exception using errcode = 'DK422', message = 'space_mismatch';
  end if;
  if exists (select 1 from app.accounts a
             where a.id in (v_old.account_id, p_account_id) and a.pocket = 'kantor') then
    raise exception using errcode = 'DK422', message = 'cross_space_kantor';
  end if;
  -- Dompet terarsip bersaldo 0 dan harus tetap 0 (keputusan pemilik #8), termasuk dompet asal.
  if exists (select 1 from app.accounts a
             where a.id in (v_old.account_id, p_account_id) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;
  if v_e.occurred_on < v_acc.opened_on then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;
  if p_category_id is not null and not exists (
       select 1 from app.categories c
       where c.id = p_category_id and c.space_id = v_acc.space_id
         and c.type::text = v_e.kind::text) then
    raise exception using errcode = 'DK404', message = 'category_not_found';
  end if;
  -- Pola create_entry 0106: terarsip dibedakan dari tidak ada / ruang lain / jenis salah.
  if p_category_id is not null and exists (
       select 1 from app.categories c where c.id = p_category_id and c.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'category_archived';
  end if;

  insert into app.entries (space_id, space_kind, kind, occurred_on, description, category_id,
                           reimbursable, created_by, updated_by)
  values (v_acc.space_id, v_acc.space_kind, v_e.kind, v_e.occurred_on,
          case when v_acc.space_kind = 'personal' or coalesce(p_keep_description, false)
               then v_e.description end,
          p_category_id, v_e.reimbursable and v_acc.space_kind = 'personal', v_uid, v_uid)
  returning id into v_entry;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_entry, v_acc.space_id, 'main', v_acc.id, v_old.amount);

  update app.entries
     set voided_at         = app.now(),
         voided_by         = v_uid,
         moved_at          = app.now(),
         version           = version + 1,
         updated_by        = v_uid,
         updated_at        = app.now()
   where id = v_e.id;
  perform private.write_history(v_e.id, 'void', v_uid);
  perform private.write_history(v_entry, 'create', v_uid);

  perform private.assert_balance(v_old.account_id, -v_old.amount, p_allow_negative);
  perform private.assert_balance(v_acc.id, v_old.amount, p_allow_negative);

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_entry, 'moved_from_entry_id', v_e.id, 'version', 1, 'warnings', '[]'::jsonb));
end $$;

create or replace function api.purge_entry(p_entry_id uuid, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_e   app.entries%rowtype;
  v_ids uuid[];
  v_n   int;
begin
  set constraints all deferred;
  select * into v_e from app.entries where id = p_entry_id;
  if v_e.id is null or (v_e.kind = 'space_transfer' and v_e.created_by <> v_uid) then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  if v_e.kind = 'space_transfer' then
    select array_agg(id order by id) into v_ids from app.entries where link_id = v_e.link_id;
  else
    v_ids := array[v_e.id];
  end if;
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select * into v_e from app.entries where id = p_entry_id;
  if p_expected_version is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'expected_version';
  elsif v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if v_e.voided_at is null then
    raise exception using errcode = 'DK422', message = 'not_voided';
  end if;
  if exists (select 1 from app.entries r where r.reimburses_entry_id = any (v_ids)) then
    raise exception using errcode = 'DK422', message = 'has_dependents';
  end if;
  -- 0131: entri yang ikut Hapus utang hanya hilang bersama utangnya (restore_debt butuh entri itu).
  if v_e.voided_with_debt then
    raise exception using errcode = 'DK422', message = 'debt_deleted';
  end if;
  v_n := private.purge_entries(v_ids, 'entry_purged');
  set constraints all immediate;
  return jsonb_build_object('affected', to_jsonb(v_ids), 'purged', v_n);
end $$;

-- jobs.purge_voided kembali ke badan 0136.
create or replace function jobs.purge_voided() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_n int := 0;
begin
  -- 0136: konteks patungan (tg_split_guard) dan baris patungan batal > 90 hari lebih dulu (FK dari entri;
  -- pemulihan ditolak sesudah 90 hari, entrinya batal di waktu yang sama). Pelunasan batal selalu belum
  -- diterima (CHECK), jadi tidak merujuk kaki terima.
  insert into private.split_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  delete from app.settlements t where t.voided_at < app.now() - interval '90 days';
  delete from app.splits s where s.voided_at < app.now() - interval '90 days';
  for i in 1..2 loop
    -- Kunci urut id (sama dengan void/restore); baris yang dipulihkan paralel diperiksa ulang
    -- sesudah lock (READ COMMITTED) dan tidak ikut (review S5).
    select coalesce(array_agg(x.id), '{}') into v_ids
    from (
      select e.id
      from app.entries e
      where e.voided_at < app.now() - interval '90 days'
        and not exists (select 1 from app.entries r where r.reimburses_entry_id = e.id)
        and (e.link_id is null or not exists (
              select 1 from app.entries p
              where p.link_id = e.link_id
                and (p.voided_at is null or p.voided_at >= app.now() - interval '90 days')))
        and not (e.voided_with_debt and exists (
              select 1 from app.debts d
              where d.space_id = e.space_id and d.id = e.debt_id
                and d.voided_at >= app.now() - interval '90 days'))
        -- 0136: entri (atau pasangannya) yang masih dirujuk baris patungan tidak ikut.
        and not exists (
              select 1 from app.entries p
              where (p.id = e.id or (e.link_id is not null and p.link_id = e.link_id))
                and (exists (select 1 from app.splits s where p.id in (s.in_entry_id, s.expense_entry_id))
                     or exists (select 1 from app.settlements t
                                 where p.id in (t.in_entry_id, t.received_entry_id))))
      order by e.id
      for update of e
    ) x;
    exit when cardinality(v_ids) = 0;
    v_n := v_n + private.purge_entries(v_ids, 'purge_voided');
  end loop;
  delete from app.debts d
   where d.voided_at < app.now() - interval '90 days'
     and not exists (select 1 from app.entries e where e.space_id = d.space_id and e.debt_id = d.id);
  delete from private.split_ctx where xid = pg_catalog.pg_current_xact_id();
  return v_n;
end $$;

-- api.archive_account kembali ke badan 0138.
create or replace function api.archive_account(p_account_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_acc app.accounts%rowtype;
begin
  perform private.lock_accounts(array[p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.archived_at is null then
    if exists (select 1 from app.goals g where g.account_id = v_acc.id and g.status = 'active') then
      raise exception using errcode = 'DK422', message = 'account_has_goal';
    end if;
    if private.balance(v_acc.id) <> 0 then
      raise exception using errcode = 'DK422', message = 'balance_not_zero';
    end if;
    update app.accounts set archived_at = app.now(), updated_at = app.now() where id = v_acc.id;
  end if;
  return jsonb_build_object('account_id', v_acc.id, 'archived', true);
end $$;

-- api.asset_overview kembali ke tanda tangan dan badan 0141.
drop function api.asset_overview(uuid);
create function api.asset_overview(p_space_id uuid)
returns table (account_id uuid, name text, asset_kind text, balance bigint, last_valued_on date, last_change bigint)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  select a.id, a.name, d.asset_kind, ab.balance, v.occurred_on, v.amount
    from app.accounts a
    join app.asset_details d on d.account_id = a.id
    join app.account_balances ab on ab.account_id = a.id
    left join lateral (
      select e.occurred_on, l.amount
        from app.entries e
        join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id and l.role = 'main'
       where l.account_id = a.id and e.kind = 'valuation' and e.voided_at is null
       order by e.occurred_on desc, e.created_at desc, e.id desc
       limit 1
    ) v on true
   where a.space_id = p_space_id and a.pocket = 'aset' and a.archived_at is null
   order by a.sort_order, a.created_at, a.id;
end $$;

drop function jobs.price_ingest(date, jsonb);
drop function jobs.price_targets();
drop function api.stock_overview(uuid);
drop function api.preview_sell(uuid, text, bigint, bigint, bigint, bigint);
drop function api.set_stock_price(uuid, uuid, text, date, bigint, boolean);
drop function api.restore_stock_trade(uuid, uuid, boolean);
drop function api.void_stock_trade(uuid, uuid, boolean);
drop function api.open_stock_holding(uuid, uuid, text, bigint, bigint, date);
drop function api.sell_stock(uuid, uuid, text, bigint, bigint, bigint, bigint, uuid, date);
drop function api.buy_stock(uuid, uuid, text, bigint, bigint, bigint, uuid, date, boolean);
drop function app.stock_last_close(uuid, text, date);
drop function private.lock_stock_trade(uuid);
drop function private.stock_entry(app.stock_trades, app.entry_kind, uuid, uuid, bigint, uuid);
drop function private.stock_assert_after(uuid, date);
drop function private.stock_holding(app.accounts, text, uuid);
drop function private.stock_cash_account(uuid, text, uuid);
drop function private.stock_account(uuid);
drop function private.stock_check(text, bigint, bigint, bigint, bigint, boolean);

select private.own_api_functions();
