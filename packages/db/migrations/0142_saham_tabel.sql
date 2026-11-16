-- migrate:up
-- S14 (IPD §6, plan S14 Task 4, K2, K6, K7, K8, K11; ruling pengendali atas Task 1; bingkai S14-SH1 sampai SH9):
-- tabel saham, harga per ruang, modal trading sesudah saham. Expand-only: empat tabel (satu di private), satu
-- view, satu kolom nullable + dua constraint di app.entries, satu unique di app.asset_details, tiga fungsi
-- baru; app.trading_capital (create or replace, kolom sama), api.trading_overview (drop + create: + kolom
-- stock_cost), dan private.dq_run diganti utuh. Fungsi api.* beli/jual/harga = 0143 (Task 5).
--
-- - app.stock_holdings (K2): satu baris per dompet saham x kode (ticker CHECK ^[A-Z]{4}$ COLLATE "C", unik
--   per dompet). FK komposit (space_id, account_id, asset_kind = 'saham') -> app.asset_details (unique baru
--   asset_details_kind_key): holding hanya di dompet aset berjenis saham di ruang yang sama, dan saham hanya
--   Pribadi lewat CHECK asset_details_saham_personal (0140). Tanpa UPDATE (kode dan dompet tetap).
-- - app.stock_trades (K6): side buy | sell | opening (saham berjalan, tanpa efek kas), shares lembar >= 1,
--   price Rupiah bulat per lembar 1..10^9, fee >= 0 (opening tanpa biaya), tax >= 0 hanya jual, cost_removed
--   wajib dan hanya untuk jual, lembar·harga (+ biaya untuk beli) <= 10^13, hasil jual (lembar·harga − biaya −
--   pajak) > 0. seq (identity) = urutan trade untuk "trade hidup terakhir per holding" (0143), tidak bergantung
--   pada created_at/gen_random_uuid() yang sama dalam satu transaksi. Batal = voided_at/voided_by (hak UPDATE
--   dompetku_api hanya untuk dua kolom itu: lembar, harga, biaya tidak bisa diubah).
-- - app.entries.stock_trade_id (pola debt_id 0130): FK komposit (space_id, stock_trade_id) -> stock_trades;
--   CHECK hanya transfer/valuation/opening_balance di Pribadi; indeks unik (stock_trade_id, kind): beli = satu
--   transfer sumber -> dompet saham (lembar·harga + biaya, K6: biaya masuk harga pokok), jual = valuasi
--   (hasil − cost_removed, tanpa entri bila 0) + transfer dompet saham -> tujuan (hasil), saham berjalan = satu
--   opening_balance. Saldo buku dompet saham = Σ biaya perolehan posisi terbuka (DQ18).
-- - Penutupan jalur generik (ruling Task 1; pola private.tg_split_guard 0135): private.tg_stock_guard (DEFINER
--   milik owner) menolak baris entri yang menyentuh dompet saham (insert/update/delete, akun lama dan baru) dan
--   perubahan entri bertautan trade (insert/update/delete) di luar transaksi yang sedang menjalankan fungsi
--   trade (baris pg_current_xact_id() di private.stock_ctx; hanya dompetku_api yang bisa menulisnya). Akibat:
--   transfer, transfer antar ruang, pindah ruang, ubah/batal/pulihkan/purge generik ke/dari dompet saham =
--   DK422 stock_account_trade_only (saldo awal ditolak create_account 0141, Cocokkan saldo dan Perbarui nilai
--   ditolak 0141). jobs.purge_voided dan fungsi batal trade membuka konteks ini di 0143.
-- - app.stock_positions (security_invoker): per holding shares, cost_total (Σ biaya beli + saham berjalan −
--   Σ cost_removed), avg_cost = floor(cost_total / shares) (NULL bila 0 lembar), realized = Σ (hasil −
--   cost_removed) jual hidup.
-- - private.stock_cost_removed(holding, lembar) (INVOKER, K6): floor(cost_total · lembar / shares), jual habis
--   = seluruh sisa biaya; satu sumber untuk api.sell_stock dan api.preview_sell (0143). Holding tidak terlihat
--   = DK404 holding_not_found, lembar <= 0 = DK400 invalid_argument/shares, melebihi = DK422
--   insufficient_shares. Pemanggil mengunci holding lebih dulu (0143).
-- - app.stock_prices (K1, K8): harga PER RUANG (tabel global membocorkan kode saham Pribadi pasangan). PK
--   (space_id, ticker, on_date), close 1..10^9, source manual (created_by wajib) | provider (tanpa pengisi),
--   status ok | held (reason 'spike'); indeks parsial stock_prices_ok untuk harga ok terakhir. Retensi held
--   90 hari = 0143.
-- - private.price_verdict(ruang, kode, tanggal, close) (INVOKER STABLE, satu sumber untuk manual dan penyedia):
--   'invalid' bila close NULL/<= 0/> 10^9; 'held' bila |close − ok terakhir sebelum tanggal| · 100 > 35 · ok
--   terakhir (35% tepat = ok); selain itu 'ok' (harga pertama tanpa pembanding = ok). Harga held tidak pernah
--   menjadi pembanding.
-- - Modal trading (K7): app.trading_capital tidak menghitung transfer antara dompet trading dan dompet saham
--   (internal ke trading); api.trading_overview + kolom stock_cost (baris total: Σ biaya perolehan saham
--   dompet saham aktif ruang itu; baris per dompet NULL) dan shortfall total = max(0, Σ sisa modal − Σ saldo
--   trading − stock_cost). shortfall per dompet tidak berubah (S12S13-C9: `Kurang` hanya di total).
-- - private.dq_run: DQ15 mengecualikan transfer trading <-> saham (paritas K7); + DQ18 (error). Selebihnya = 0140.
-- - RLS ENABLE + FORCE pola ruang di tiga tabel app; web/api/auditor SELECT, tulis hanya dompetku_api
--   (holding INSERT, trade INSERT + UPDATE kolom batal, harga INSERT + UPDATE; tanpa DELETE).
-- - FK created_by ke auth."user" on delete restrict: hanya anggota ruang yang menulis, jadi
--   jobs.purge_unfinished_users tidak terhalang. Holding dan harga tanpa CASCADE: dompet saham berisi tidak
--   pernah dihapus (arsip butuh 0 lembar, 0143).
-- Kode galat baru: DK422 stock_account_trade_only (0141 sudah memakai), insufficient_shares; DK404
-- holding_not_found. Pesan/detail tanpa nominal, kode saham, dan harga.

-- ===== Holding =====
alter table app.asset_details add constraint asset_details_kind_key unique (space_id, account_id, asset_kind);

create table app.stock_holdings (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null,
  account_id uuid not null,
  asset_kind text not null default 'saham' check (asset_kind = 'saham'),
  ticker     text not null check ((ticker collate "C") ~ '^[A-Z]{4}$'),
  created_by uuid not null references auth."user" (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (space_id, id),
  unique (account_id, ticker),
  foreign key (space_id, account_id, asset_kind)
    references app.asset_details (space_id, account_id, asset_kind) on delete restrict
);
create index on app.stock_holdings (space_id, account_id, asset_kind);
create index on app.stock_holdings (created_by);

-- ===== Trade =====
create table app.stock_trades (
  id           uuid primary key default gen_random_uuid(),
  seq          bigint generated always as identity,
  space_id     uuid not null,
  holding_id   uuid not null,
  side         text not null check (side in ('buy', 'sell', 'opening')),
  shares       bigint not null check (shares > 0),
  price        bigint not null check (price between 1 and 1000000000),
  fee          bigint not null default 0 check (fee >= 0),
  tax          bigint not null default 0 check (tax >= 0),
  cost_removed bigint check (cost_removed >= 0),
  occurred_on  date not null check (occurred_on >= date '2000-01-01'),
  created_by   uuid not null references auth."user" (id) on delete restrict,
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  voided_by    uuid references auth."user" (id) on delete restrict,
  unique (space_id, id),
  foreign key (space_id, holding_id) references app.stock_holdings (space_id, id) on delete restrict,
  check ((side = 'sell') = (cost_removed is not null)),
  check (side = 'sell' or tax = 0),
  check (side <> 'opening' or fee = 0),
  -- numeric: perkalian bigint bisa overflow sebelum dibandingkan.
  check (shares::numeric * price + fee <= 10000000000000 and tax <= 10000000000000),
  check (side <> 'sell' or shares::numeric * price - fee - tax > 0),
  check ((voided_at is null) = (voided_by is null))
);
create index on app.stock_trades (space_id, holding_id);
create index on app.stock_trades (created_by);
create index on app.stock_trades (voided_by);

-- ===== Tautan entri -> trade =====
alter table app.entries add column stock_trade_id uuid;
alter table app.entries add constraint entries_stock_trade_fk
  foreign key (space_id, stock_trade_id) references app.stock_trades (space_id, id) on delete restrict;
alter table app.entries add constraint entries_stock_trade_check
  check (stock_trade_id is null or (kind in ('transfer', 'valuation', 'opening_balance') and space_kind = 'personal'));
create index on app.entries (space_id, stock_trade_id);
create unique index entries_stock_trade_kind on app.entries (stock_trade_id, kind) where stock_trade_id is not null;

-- ===== Konteks fungsi trade (lokal transaksi) + penjaga jalur generik =====
-- Baris = transaksi yang sedang menjalankan fungsi trade (0143) atau purge. Fungsi menghapus barisnya sebelum
-- selesai; rollback membuangnya. Tanpa hak untuk web/worker, jadi tidak bisa dipalsukan.
create table private.stock_ctx (xid xid8 primary key);

create function private.tg_stock_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.stock_ctx c where c.xid = pg_catalog.pg_current_xact_id()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- entries: trigger hanya terpasang untuk baris bertautan trade (WHEN), jadi selalu ditolak di sini.
  if tg_table_name = 'entries' then
    raise exception using errcode = 'DK422', message = 'stock_account_trade_only', detail = 'account_id';
  end if;
  if exists (select 1 from app.asset_details d
              where d.asset_kind = 'saham'
                and d.account_id in (case when tg_op <> 'INSERT' then old.account_id end,
                                     case when tg_op <> 'DELETE' then new.account_id end)) then
    raise exception using errcode = 'DK422', message = 'stock_account_trade_only', detail = 'account_id';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger stock_guard before insert or update or delete on app.entry_lines
  for each row execute function private.tg_stock_guard();
create trigger stock_guard_ins before insert on app.entries
  for each row when (new.stock_trade_id is not null) execute function private.tg_stock_guard();
create trigger stock_guard_upd before update on app.entries
  for each row when (old.stock_trade_id is not null or new.stock_trade_id is not null)
  execute function private.tg_stock_guard();
create trigger stock_guard_del before delete on app.entries
  for each row when (old.stock_trade_id is not null) execute function private.tg_stock_guard();

-- ===== Posisi (tanpa kolom tersimpan) =====
create view app.stock_positions with (security_invoker = true) as
select x.space_id, x.account_id, x.holding_id, x.ticker, x.shares, x.cost_total,
       case when x.shares > 0 then x.cost_total / x.shares end as avg_cost,
       x.realized
  from (
    select h.space_id, h.account_id, h.id as holding_id, h.ticker,
           coalesce(sum(case when t.side = 'sell' then -t.shares else t.shares end), 0)::bigint as shares,
           coalesce(sum(case t.side when 'buy' then t.shares * t.price + t.fee
                                    when 'opening' then t.shares * t.price
                                    else -t.cost_removed end), 0)::bigint as cost_total,
           coalesce(sum(t.shares * t.price - t.fee - t.tax - t.cost_removed) filter (where t.side = 'sell'), 0)::bigint
             as realized
      from app.stock_holdings h
      left join app.stock_trades t on t.space_id = h.space_id and t.holding_id = h.id and t.voided_at is null
     group by h.space_id, h.account_id, h.id, h.ticker
  ) x;

-- K6: biaya perolehan yang keluar saat jual (floor; jual habis = seluruh sisa).
create function private.stock_cost_removed(p_holding_id uuid, p_shares bigint) returns bigint
language plpgsql stable set search_path = '' as $$
declare p app.stock_positions%rowtype;
begin
  select * into p from app.stock_positions where holding_id = p_holding_id;
  if not found then
    raise exception using errcode = 'DK404', message = 'holding_not_found';
  end if;
  if p_shares is null or p_shares <= 0 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'shares';
  end if;
  if p_shares > p.shares then
    raise exception using errcode = 'DK422', message = 'insufficient_shares';
  end if;
  if p_shares = p.shares then
    return p.cost_total;
  end if;
  return floor(p.cost_total::numeric * p_shares / p.shares)::bigint;
end $$;

-- ===== Harga per ruang =====
create table app.stock_prices (
  space_id   uuid not null references app.spaces (id) on delete restrict,
  ticker     text not null check ((ticker collate "C") ~ '^[A-Z]{4}$'),
  on_date    date not null check (on_date >= date '2000-01-01'),
  close      bigint not null check (close between 1 and 1000000000),
  source     text not null check (source in ('manual', 'provider')),
  status     text not null check (status in ('ok', 'held')),
  reason     text check (reason in ('spike')),
  created_by uuid references auth."user" (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (space_id, ticker, on_date),
  check ((status = 'held') = (reason is not null)),
  check ((source = 'manual') = (created_by is not null))
);
create index stock_prices_ok on app.stock_prices (space_id, ticker, on_date desc) where status = 'ok';
create index on app.stock_prices (created_by);

create function private.price_verdict(p_space_id uuid, p_ticker text, p_on date, p_close bigint) returns text
language sql stable set search_path = '' as $$
  select case
    when p_close is null or p_close < 1 or p_close > 1000000000 then 'invalid'
    when abs(p_close - prev.close)::numeric * 100 > 35::numeric * prev.close then 'held'
    else 'ok'
  end
  from (select (select p.close from app.stock_prices p
                 where p.space_id = p_space_id and p.ticker = p_ticker and p.status = 'ok' and p.on_date < p_on
                 order by p.on_date desc limit 1) as close) prev
$$;

-- ===== Modal trading (0134 + K7: transfer trading <-> saham internal) =====
create or replace view app.trading_capital with (security_invoker = true) as
with flows as (
  -- transfer satu ruang: nominal = counter (tanpa biaya); sisi lain bukan trading dan bukan dompet saham.
  select c.account_id, c.amount as cin, 0::bigint as cout
    from app.entries e
    join app.entry_lines m on m.space_id = e.space_id and m.entry_id = e.id and m.role = 'main'
    join app.entry_lines c on c.space_id = e.space_id and c.entry_id = e.id and c.role = 'counter'
    join app.accounts ma on ma.id = m.account_id
   where e.kind = 'transfer' and e.voided_at is null and ma.pocket <> 'trading'
     and not exists (select 1 from app.asset_details d where d.account_id = ma.id and d.asset_kind = 'saham')
  union all
  select m.account_id, 0::bigint, c.amount
    from app.entries e
    join app.entry_lines m on m.space_id = e.space_id and m.entry_id = e.id and m.role = 'main'
    join app.entry_lines c on c.space_id = e.space_id and c.entry_id = e.id and c.role = 'counter'
    join app.accounts ca on ca.id = c.account_id
   where e.kind = 'transfer' and e.voided_at is null and ca.pocket <> 'trading'
     and not exists (select 1 from app.asset_details d where d.account_id = ca.id and d.asset_kind = 'saham')
  union all
  -- space_transfer (temuan S2): kaki main di dompet trading, lawan selalu dompet Bersama (B10).
  -- Biaya ada di line fee, jadi main = nominal.
  select l.account_id,
         case when e.direction = 'in' then l.amount else 0 end::bigint,
         case when e.direction = 'out' then -l.amount else 0 end::bigint
    from app.entries e
    join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id and l.role = 'main'
   where e.kind = 'space_transfer' and e.voided_at is null
), t as (
  select a.space_id, a.id as account_id,
         coalesce(sum(f.cin), 0)::bigint as capital_in, coalesce(sum(f.cout), 0)::bigint as capital_out
    from app.accounts a
    left join flows f on f.account_id = a.id
   where a.pocket = 'trading'
   group by a.space_id, a.id
)
select space_id, account_id, capital_in, capital_out,
       greatest(capital_in - capital_out, 0)::bigint as capital_left,
       greatest(capital_out - capital_in, 0)::bigint as realized
  from t;

drop function api.trading_overview(uuid);
create function api.trading_overview(p_space_id uuid)
returns table (account_id uuid, name text, balance bigint, capital_in bigint, capital_out bigint,
               capital_left bigint, realized bigint, shortfall bigint, has_deposit boolean, stock_cost bigint)
language plpgsql stable set search_path = '' as $$
declare v_cost bigint;
begin
  perform app.assert_member(p_space_id);
  if (select s.kind from app.spaces s where s.id = p_space_id) is distinct from 'personal' then
    raise exception using errcode = 'DK422', message = 'pocket_personal_only';
  end if;
  -- K7: biaya perolehan saham (bukan nilai pasar, supaya modal bebas harga) di dompet saham aktif.
  select coalesce(sum(p.cost_total), 0)::bigint into v_cost
    from app.stock_positions p join app.accounts a on a.id = p.account_id
   where p.space_id = p_space_id and a.archived_at is null;
  return query
  with w as (
    select a.id, a.name, a.sort_order, a.created_at, ab.balance,
           tc.capital_in, tc.capital_out, tc.capital_left, tc.realized
      from app.accounts a
      join app.account_balances ab on ab.account_id = a.id
      join app.trading_capital tc on tc.account_id = a.id
     where a.space_id = p_space_id and a.pocket = 'trading' and a.archived_at is null
  )
  select x.id, x.name, x.balance, x.capital_in, x.capital_out, x.capital_left, x.realized,
         x.shortfall, x.has_deposit, x.stock_cost
    from (
      select w.id, w.name, w.balance, w.capital_in, w.capital_out, w.capital_left, w.realized,
             greatest(w.capital_left - w.balance, 0)::bigint as shortfall,
             w.capital_in > 0 as has_deposit, null::bigint as stock_cost, 0 as grp, w.sort_order, w.created_at
        from w
      union all
      select null, null, coalesce(sum(w.balance), 0)::bigint, coalesce(sum(w.capital_in), 0)::bigint,
             coalesce(sum(w.capital_out), 0)::bigint, coalesce(sum(w.capital_left), 0)::bigint,
             coalesce(sum(w.realized), 0)::bigint,
             greatest(coalesce(sum(w.capital_left), 0) - coalesce(sum(w.balance), 0) - v_cost, 0)::bigint,
             coalesce(bool_or(w.capital_in > 0), false), v_cost, 1, null, null
        from w
    ) x
   order by x.grp, x.sort_order, x.created_at, x.id;
end $$;

-- ===== Cek kualitas data: DQ15 (K7), DQ18 saham (selebihnya = 0140) =====
create or replace function private.dq_run()
returns table (check_id text, severity text, violations int)
language sql stable security definer set search_path = '' as $$
  -- DQ01 saldo view = Σ ulang lines (query independen dari view)
  select 'DQ01', 'error', count(*)::int from (
    select a.id from app.accounts a
    left join app.entry_lines l on l.account_id = a.id
    left join app.entries e on e.id = l.entry_id and e.voided_at is null
    group by a.id
    having coalesce(sum(case when e.id is not null then l.amount end), 0)
           <> (select ab.balance from app.account_balances ab where ab.account_id = a.id)
  ) x
  union all
  -- DQ03 bentuk line per kind, entri hidup (aturan private.assert_entry_shape, 0101; utang 0130; valuasi 0140)
  select 'DQ03', 'error', count(*)::int from (
    select e.id
    from app.entries e
    left join lateral (
      select count(*) filter (where l.role = 'main')    as n_main,
             count(*) filter (where l.role = 'counter') as n_counter,
             count(*) filter (where l.role = 'fee')     as n_fee,
             sum(l.amount) filter (where l.role = 'main')    as m_amt,
             sum(l.amount) filter (where l.role = 'counter') as c_amt,
             sum(l.amount) filter (where l.role = 'fee')     as f_amt,
             (array_agg(l.account_id) filter (where l.role = 'main'))[1]    as m_acc,
             (array_agg(l.account_id) filter (where l.role = 'counter'))[1] as c_acc,
             (array_agg(l.account_id) filter (where l.role = 'fee'))[1]     as f_acc
      from app.entry_lines l where l.entry_id = e.id
    ) s on true
    left join app.debts d on d.id = e.debt_id
    left join app.accounts ma on ma.id = s.m_acc
    where e.voided_at is null
      and not coalesce(
        s.n_main = 1
        and (s.n_fee = 0 or (s.f_amt < 0 and s.f_acc = s.m_acc))
        and case
          when e.kind in ('income', 'reimbursement', 'opening_balance') then
               s.n_counter = 0 and s.n_fee = 0 and s.m_amt > 0
          when e.kind = 'expense' then s.n_counter = 0 and s.n_fee = 0 and s.m_amt < 0
          when e.kind = 'transfer' then
               s.n_counter = 1 and s.m_amt < 0 and s.c_amt = -s.m_amt and s.c_acc <> s.m_acc
          when e.kind = 'space_transfer' then
               s.n_counter = 0
               and case e.direction when 'out' then s.m_amt < 0
                                    else s.m_amt > 0 and s.n_fee = 0 end
          when e.kind = 'adjustment' then s.n_counter = 0 and s.n_fee = 0
          -- Paritas dengan assert_entry_shape 0130 (entri hidup saja, jadi utang harus hidup).
          when e.kind = 'debt_principal' then
               s.n_counter = 0 and s.n_fee = 0 and d.voided_at is null and ma.pocket <> 'kantor'
               and d.mode = 'baru' and abs(s.m_amt) = d.principal
               and case d.direction when 'borrowed' then s.m_amt > 0 when 'lent' then s.m_amt < 0 end
          when e.kind = 'debt_payment' then
               s.n_counter = 0 and s.n_fee = 0 and d.voided_at is null and ma.pocket <> 'kantor'
               and case d.direction when 'borrowed' then s.m_amt < 0 when 'lent' then s.m_amt > 0 end
          -- 0140: paritas dengan assert_entry_shape cabang valuation (satu line main di dompet aset).
          when e.kind = 'valuation' then s.n_counter = 0 and s.n_fee = 0 and ma.pocket = 'aset'
          else false
        end, false)
  ) x
  union all
  -- DQ05 (0131) sisa utang tidak negatif: Σ |main| cicilan hidup per utang <= principal. Kueri
  -- independen dari app.debt_balances; api.pay_debt dan pulihkan cicilan menjaga saat tulis.
  select 'DQ05', 'error', count(*)::int from app.debts d
  where d.principal < (select coalesce(sum(abs(l.amount)), 0) from app.entries e
                       join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                       where e.debt_id = d.id and e.kind = 'debt_payment' and e.voided_at is null)
  union all
  -- DQ04 transfer satu ruang: Σ = −fee
  select 'DQ04', 'error', count(*)::int from (
    select e.id from app.entries e join app.entry_lines l on l.entry_id = e.id
    where e.kind = 'transfer' group by e.id
    having sum(l.amount) <> coalesce(sum(l.amount) filter (where l.role = 'fee'), 0)
  ) x
  union all
  -- DQ04b pasangan space_transfer: 2 kaki, Σ main = 0, status void seragam
  select 'DQ04b', 'error', count(*)::int from (
    select e.link_id from app.entries e
    join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
    where e.kind = 'space_transfer' group by e.link_id
    having count(*) <> 2 or sum(l.amount) <> 0 or count(distinct (e.voided_at is null)) <> 1
  ) x
  union all
  -- DQ06 version = jumlah history
  select 'DQ06', 'warn', count(*)::int from app.entries e
  where e.version <> (select count(*) from app.entry_history h where h.entry_id = e.id)
  union all
  -- DQ07 tabungan negatif sekarang, atau negatif di akhir 3 hari WIB terakhir berturut-turut
  select 'DQ07', 'warn', count(*)::int from (
    select a.id
    from app.accounts a
    left join (
      select l.account_id, l.amount, e.occurred_on
      from app.entry_lines l join app.entries e on e.id = l.entry_id
      where e.voided_at is null
    ) v on v.account_id = a.id
    where a.pocket <> 'patungan'  -- 0136: dompet sistem dijaga DQ16
    group by a.id, a.pocket
    having (a.pocket = 'tabungan' and coalesce(sum(v.amount), 0) < 0)
        or (coalesce(sum(v.amount) filter (where v.occurred_on <= app.today() - 1), 0) < 0
            and coalesce(sum(v.amount) filter (where v.occurred_on <= app.today() - 2), 0) < 0
            and coalesce(sum(v.amount) filter (where v.occurred_on <= app.today() - 3), 0) < 0)
  ) x
  union all
  -- DQ09 line menunjuk akun ruang lain
  select 'DQ09', 'error', count(*)::int from app.entry_lines l
  join app.accounts a on a.id = l.account_id where a.space_id <> l.space_id
  union all
  -- DQ10 purge macet
  select 'DQ10', 'warn', count(*)::int from app.entries e
  where e.voided_at < app.now() - interval '97 days'
  union all
  -- DQ11 reimburse hidup menunjuk talangan hidup reimbursable di ruang yang sama
  select 'DQ11', 'error', count(*)::int from app.entries r
  where r.kind = 'reimbursement' and r.voided_at is null
    and not exists (
      select 1 from app.entries t
      where t.id = r.reimburses_entry_id and t.space_id = r.space_id and t.kind = 'expense'
        and t.reimbursable and t.voided_at is null)
  union all
  -- DQ12 Σ nominal reimburse hidup per talangan <= nominal talangan
  select 'DQ12', 'error', count(*)::int from (
    select r.reimburses_entry_id
    from app.entries r join app.entry_lines l on l.entry_id = r.id and l.role = 'main'
    where r.kind = 'reimbursement' and r.voided_at is null
    group by r.reimburses_entry_id
    having sum(l.amount) > (select -tl.amount from app.entry_lines tl
                            where tl.entry_id = r.reimburses_entry_id and tl.role = 'main')
  ) x
  union all
  -- DQ13 satu kewajiban: tagihan aktif + anggaran wajib, kategori induk sama, kemunculan tagihan
  -- (mulai bill_first_on) di periode berlabel bulan anggaran. Dihitung per pasangan. Hanya label
  -- periode berjalan ke depan: label lampau yang bergeser karena payday_rule/app.holidays berubah
  -- tidak lagi memengaruhi aman dipakai, jadi tidak membuat alert merah selamanya.
  select 'DQ13', 'error', count(*)::int from app.bills b
  join app.categories c on c.id = b.category_id
  join app.budgets bu on bu.space_id = b.space_id and bu.wajib
                     and bu.category_id = coalesce(c.parent_id, c.id)
  where b.archived_at is null
    and bu.month >= (select pp.label_month from app.pay_period(b.space_id, app.today()) pp)
    and private.bill_due_in_label(b.space_id, b.day_of_month,
          private.bill_first_on(b.starts_on, b.created_at), b.ends_on, bu.month)
  union all
  -- DQ14 pohon anggaran (S10): rincian tanpa anggaran induk di label yang sama, atau jumlah rincian
  -- satu induk melewati anggaran induknya. Trigger private.tg_budget_tree menjaga saat tulis; cek ini
  -- menangkap baris yang lolos jalan lain (UPDATE massal/restore manual). Dihitung per (ruang, induk, label).
  select 'DQ14', 'error', count(*)::int from (
    select bu.space_id, c.parent_id, bu.month
    from app.budgets bu join app.categories c on c.id = bu.category_id
    where c.parent_id is not null
    group by bu.space_id, c.parent_id, bu.month
    having sum(bu.amount) > coalesce((select p.amount from app.budgets p
             where p.space_id = bu.space_id and p.category_id = c.parent_id and p.month = bu.month), 0)
  ) x
  union all
  -- DQ15 modal trading (S12, 0134; K7 S14 0142: tanpa transfer dompet trading <-> dompet saham): app.trading_capital = Σ ulang transfer hidup antara dompet
  -- trading dan dompet non-trading satu ruang (kueri independen membaca −main, view membaca
  -- counter) ditambah kaki space_transfer hidup di dompet trading (kueri independen membaca kaki
  -- pasangan di Bersama, view membaca kaki trading), capital_left/realized tidak negatif dan
  -- capital_left - realized = setor - tarik; dompet trading wajib di Pribadi (B10, CHECK) dan wajib
  -- ada di view.
  select 'DQ15', 'error', count(*)::int from (
    select a.id
    from app.accounts a
    left join app.trading_capital tc on tc.account_id = a.id
    left join lateral (
      select coalesce(sum(-m.amount) filter (where c.account_id = a.id), 0) as cin,
             coalesce(sum(-m.amount) filter (where m.account_id = a.id), 0) as cout
      from app.entries e
      join app.entry_lines m on m.entry_id = e.id and m.role = 'main'
      join app.entry_lines c on c.entry_id = e.id and c.role = 'counter'
      join app.accounts ma on ma.id = m.account_id
      join app.accounts ca on ca.id = c.account_id
      where e.kind = 'transfer' and e.voided_at is null
        and a.id in (m.account_id, c.account_id)
        and (ma.pocket = 'trading') <> (ca.pocket = 'trading')
        -- 0142 (K7): transfer dompet trading <-> dompet saham internal, bukan modal.
        and not exists (select 1 from app.asset_details d
                         where d.account_id in (m.account_id, c.account_id) and d.asset_kind = 'saham')
    ) s on true
    left join lateral (
      select coalesce(sum(-p.amount) filter (where e.direction = 'in'), 0) as cin,
             coalesce(sum(p.amount) filter (where e.direction = 'out'), 0) as cout
      from app.entries e
      join app.entry_lines l on l.entry_id = e.id and l.role = 'main' and l.account_id = a.id
      join app.entries pe on pe.link_id = e.link_id and pe.id <> e.id
      join app.entry_lines p on p.entry_id = pe.id and p.role = 'main'
      where e.kind = 'space_transfer' and e.voided_at is null
    ) st on true
    where a.pocket = 'trading'
      and (a.space_kind <> 'personal' or tc.account_id is null
           or tc.capital_in <> s.cin + st.cin or tc.capital_out <> s.cout + st.cout
           or tc.capital_left < 0 or tc.realized < 0
           or tc.capital_left - tc.realized <> s.cin + st.cin - s.cout - st.cout)
  ) x
  union all
  -- DQ16 patungan (S12, 0136): (a) saldo dompet sistem = Σ pelunasan hidup belum diterima; (b) per
  -- tagihan Σ bagian = nominal, kaki masuk dan pengeluaran ada di dompet sistem ruang itu senominal
  -- dengan status batal sama; (c) per pelunasan kaki masuk cocok, kaki terima (bila ada) hidup dan
  -- cocok; (d) entri hidup di dompet sistem wajib dirujuk baris patungan hidup; (e) Σ saldo anggota per
  -- ruang = 0. Kueri independen dari fungsi tulis 0136.
  select 'DQ16', 'error', count(*)::int from (
    select a.id from app.accounts a
    where a.pocket = 'patungan'
      and (select coalesce(sum(l.amount), 0) from app.entry_lines l join app.entries e on e.id = l.entry_id
            where l.account_id = a.id and e.voided_at is null)
          <> (select coalesce(sum(t.amount), 0) from app.settlements t
               where t.space_id = a.space_id and t.voided_at is null and t.received_entry_id is null)
    union all
    select s.id from app.splits s
    where s.amount <> (select coalesce(sum(sh.amount), 0) from app.split_shares sh
                        where sh.space_id = s.space_id and sh.split_id = s.id)
       or not exists (select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = s.in_entry_id and e.kind = 'space_transfer' and e.direction = 'in'
                        and a.pocket = 'patungan' and a.space_id = s.space_id and l.amount = s.amount
                        and (e.voided_at is null) = (s.voided_at is null))
       or not exists (select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = s.expense_entry_id and e.kind = 'expense'
                        and a.pocket = 'patungan' and a.space_id = s.space_id and l.amount = -s.amount
                        and (e.voided_at is null) = (s.voided_at is null))
    union all
    select t.id from app.settlements t
    where not exists (select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = t.in_entry_id and e.kind = 'space_transfer' and e.direction = 'in'
                        and a.pocket = 'patungan' and a.space_id = t.space_id and l.amount = t.amount
                        and (e.voided_at is null) = (t.voided_at is null))
       or (t.received_entry_id is not null and not exists (
                      select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = t.received_entry_id and e.kind = 'space_transfer' and e.direction = 'out'
                        and a.pocket = 'patungan' and a.space_id = t.space_id and l.amount = -t.amount
                        and e.voided_at is null))
    union all
    select e.id from app.entries e
    join app.entry_lines l on l.entry_id = e.id
    join app.accounts a on a.id = l.account_id
    where a.pocket = 'patungan' and e.voided_at is null
      and not exists (select 1 from app.splits s
                      where s.voided_at is null and e.id in (s.in_entry_id, s.expense_entry_id))
      and not exists (select 1 from app.settlements t where t.voided_at is null and t.in_entry_id = e.id)
      and not exists (select 1 from app.settlements t where t.received_entry_id = e.id)
    union all
    select b.space_id from app.member_balances b group by b.space_id having sum(b.balance) <> 0
  ) x
  union all
  -- DQ17 tujuan (S13, 0137): tujuan aktif pada dompet terarsip, bukan tabungan, atau di ruang lain.
  -- private.tg_goal_guard dan api.archive_account (0138) menjaga saat tulis; cek ini menangkap baris yang
  -- lolos jalan lain (UPDATE massal/restore manual).
  select 'DQ17', 'error', count(*)::int from app.goals g
  join app.accounts a on a.id = g.account_id
  where g.status = 'active'
    and (a.archived_at is not null or a.pocket <> 'tabungan' or a.space_id <> g.space_id)
  union all
  -- DQ19 aset (S14, 0140): (a) dompet aset bersaldo negatif; (b) entri hidup di dompet aset selain transfer,
  -- transfer antar ruang, saldo awal, Cocokkan saldo, dan valuasi (pemasukan, pengeluaran/talangan,
  -- reimburse, utang), atau kaki antar ruang yang pasangannya dompet sistem patungan; (c) tagihan rutin
  -- menunjuk dompet aset; (d) rincian 1:1: dompet aset tanpa app.asset_details, rincian pada dompet bukan
  -- aset atau ruang lain, saham di Bersama. Penjaga private.tg_asset_ledger/tg_asset_guard dan
  -- private.assert_balance menjaga saat tulis; cek ini menangkap baris yang lolos jalan lain.
  select 'DQ19', 'error', count(*)::int from (
    select a.id from app.accounts a
    where a.pocket = 'aset'
      and (select coalesce(sum(l.amount), 0) from app.entry_lines l join app.entries e on e.id = l.entry_id
            where l.account_id = a.id and e.voided_at is null) < 0
    union all
    select e.id from app.entries e
    join app.entry_lines l on l.entry_id = e.id
    join app.accounts a on a.id = l.account_id and a.pocket = 'aset'
    where e.voided_at is null
      and (e.kind not in ('transfer', 'space_transfer', 'opening_balance', 'adjustment', 'valuation')
           or (e.kind = 'space_transfer' and exists (
                 select 1 from app.entries p
                 join app.entry_lines pl on pl.entry_id = p.id and pl.role = 'main'
                 join app.accounts pa on pa.id = pl.account_id
                 where p.link_id = e.link_id and p.id <> e.id and pa.pocket = 'patungan')))
    union all
    select b.id from app.bills b join app.accounts a on a.id = b.account_id where a.pocket = 'aset'
    union all
    select a.id from app.accounts a
    where a.pocket = 'aset' and not exists (select 1 from app.asset_details d where d.account_id = a.id)
    union all
    select d.account_id from app.asset_details d join app.accounts a on a.id = d.account_id
    where a.pocket <> 'aset' or a.space_id <> d.space_id or (d.asset_kind = 'saham' and a.space_kind <> 'personal')
  ) x
  union all
  -- DQ18 saham (S14, 0142; kueri independen dari app.stock_positions untuk (a)): (a) saldo buku dompet saham =
  -- Σ biaya perolehan trade hidup (beli lembar·harga + biaya, saham berjalan lembar·harga, jual −cost_removed);
  -- (b) per kode lembar dan biaya tidak negatif, lembar 0 = biaya 0; (c) tiap trade punya tepat entri yang
  -- diharapkan (beli/jual = satu transfer, saham berjalan = satu opening_balance, jual dengan untung/rugi ≠ 0 =
  -- + satu valuasi) dengan status batal sama dan nominal di dompet saham holding-nya; (d) entri hidup di dompet
  -- saham wajib tertaut trade dompet itu. private.tg_stock_guard menutup jalur generik saat tulis.
  select 'DQ18', 'error', count(*)::int from (
    select d.account_id from app.asset_details d
    where d.asset_kind = 'saham'
      and (select coalesce(sum(l.amount), 0) from app.entry_lines l join app.entries e on e.id = l.entry_id
            where l.account_id = d.account_id and e.voided_at is null)
          <> (select coalesce(sum(case t.side when 'buy' then t.shares * t.price + t.fee
                                              when 'opening' then t.shares * t.price
                                              else -t.cost_removed end), 0)
                from app.stock_trades t join app.stock_holdings h on h.id = t.holding_id
               where h.account_id = d.account_id and t.voided_at is null)
    union all
    select p.holding_id from app.stock_positions p
    where p.shares < 0 or p.cost_total < 0 or (p.shares = 0 and p.cost_total <> 0)
    union all
    select t.id from app.stock_trades t join app.stock_holdings h on h.id = t.holding_id
    cross join lateral (
      select t.shares * t.price - t.fee - t.tax as net,
             t.shares * t.price - t.fee - t.tax - t.cost_removed as pl
    ) v
    where (select count(*) from app.entries e where e.stock_trade_id = t.id)
            <> 1 + (t.side = 'sell' and v.pl <> 0)::int
       or not exists (
            select 1 from app.entries e join app.entry_lines l on l.entry_id = e.id and l.account_id = h.account_id
             where e.stock_trade_id = t.id and (e.voided_at is null) = (t.voided_at is null)
               and e.kind = case t.side when 'opening' then 'opening_balance' else 'transfer' end::app.entry_kind
               and l.amount = case t.side when 'buy' then t.shares * t.price + t.fee
                                          when 'opening' then t.shares * t.price else -v.net end)
       or (t.side = 'sell' and v.pl <> 0 and not exists (
            select 1 from app.entries e join app.entry_lines l on l.entry_id = e.id and l.account_id = h.account_id
             where e.stock_trade_id = t.id and e.kind = 'valuation' and (e.voided_at is null) = (t.voided_at is null)
               and l.amount = v.pl))
    union all
    select e.id from app.entries e
    join app.entry_lines l on l.entry_id = e.id
    join app.asset_details d on d.account_id = l.account_id and d.asset_kind = 'saham'
    where e.voided_at is null
      and not exists (select 1 from app.stock_trades t join app.stock_holdings h on h.id = t.holding_id
                       where t.id = e.stock_trade_id and h.account_id = l.account_id)
  ) x
$$;

-- ===== RLS: aktif dan dipaksa; pola ruang (baca web/api, tulis hanya dompetku_api) =====
do $$
declare t text;
begin
  foreach t in array array['app.stock_holdings', 'app.stock_trades', 'app.stock_prices'] loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
    execute format(
      'create policy member_read on %s for select to dompetku_web, dompetku_api
         using (space_id = any ((select app.my_space_ids())::uuid[]))', t);
    execute format(
      'create policy member_write on %s for all to dompetku_api
         using (space_id = any ((select app.my_space_ids())::uuid[]))
         with check (space_id = any ((select app.my_space_ids())::uuid[]))', t);
  end loop;
end $$;

-- ===== Hak =====
grant select on app.stock_holdings, app.stock_trades, app.stock_prices, app.stock_positions
  to dompetku_web, dompetku_api, dompetku_auditor;
grant insert on app.stock_holdings, app.stock_trades to dompetku_api;
grant update (voided_at, voided_by) on app.stock_trades to dompetku_api;
grant insert, update on app.stock_prices to dompetku_api;
grant select, insert, delete on private.stock_ctx to dompetku_api;
grant execute on function private.stock_cost_removed(uuid, bigint), private.price_verdict(uuid, text, date, bigint)
  to dompetku_api;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
-- Fungsi yang diganti kembali ke badan sebelumnya (0140 dq_run, 0134 modal trading).
create or replace function private.dq_run()
returns table (check_id text, severity text, violations int)
language sql stable security definer set search_path = '' as $$
  -- DQ01 saldo view = Σ ulang lines (query independen dari view)
  select 'DQ01', 'error', count(*)::int from (
    select a.id from app.accounts a
    left join app.entry_lines l on l.account_id = a.id
    left join app.entries e on e.id = l.entry_id and e.voided_at is null
    group by a.id
    having coalesce(sum(case when e.id is not null then l.amount end), 0)
           <> (select ab.balance from app.account_balances ab where ab.account_id = a.id)
  ) x
  union all
  -- DQ03 bentuk line per kind, entri hidup (aturan private.assert_entry_shape, 0101; utang 0130; valuasi 0140)
  select 'DQ03', 'error', count(*)::int from (
    select e.id
    from app.entries e
    left join lateral (
      select count(*) filter (where l.role = 'main')    as n_main,
             count(*) filter (where l.role = 'counter') as n_counter,
             count(*) filter (where l.role = 'fee')     as n_fee,
             sum(l.amount) filter (where l.role = 'main')    as m_amt,
             sum(l.amount) filter (where l.role = 'counter') as c_amt,
             sum(l.amount) filter (where l.role = 'fee')     as f_amt,
             (array_agg(l.account_id) filter (where l.role = 'main'))[1]    as m_acc,
             (array_agg(l.account_id) filter (where l.role = 'counter'))[1] as c_acc,
             (array_agg(l.account_id) filter (where l.role = 'fee'))[1]     as f_acc
      from app.entry_lines l where l.entry_id = e.id
    ) s on true
    left join app.debts d on d.id = e.debt_id
    left join app.accounts ma on ma.id = s.m_acc
    where e.voided_at is null
      and not coalesce(
        s.n_main = 1
        and (s.n_fee = 0 or (s.f_amt < 0 and s.f_acc = s.m_acc))
        and case
          when e.kind in ('income', 'reimbursement', 'opening_balance') then
               s.n_counter = 0 and s.n_fee = 0 and s.m_amt > 0
          when e.kind = 'expense' then s.n_counter = 0 and s.n_fee = 0 and s.m_amt < 0
          when e.kind = 'transfer' then
               s.n_counter = 1 and s.m_amt < 0 and s.c_amt = -s.m_amt and s.c_acc <> s.m_acc
          when e.kind = 'space_transfer' then
               s.n_counter = 0
               and case e.direction when 'out' then s.m_amt < 0
                                    else s.m_amt > 0 and s.n_fee = 0 end
          when e.kind = 'adjustment' then s.n_counter = 0 and s.n_fee = 0
          -- Paritas dengan assert_entry_shape 0130 (entri hidup saja, jadi utang harus hidup).
          when e.kind = 'debt_principal' then
               s.n_counter = 0 and s.n_fee = 0 and d.voided_at is null and ma.pocket <> 'kantor'
               and d.mode = 'baru' and abs(s.m_amt) = d.principal
               and case d.direction when 'borrowed' then s.m_amt > 0 when 'lent' then s.m_amt < 0 end
          when e.kind = 'debt_payment' then
               s.n_counter = 0 and s.n_fee = 0 and d.voided_at is null and ma.pocket <> 'kantor'
               and case d.direction when 'borrowed' then s.m_amt < 0 when 'lent' then s.m_amt > 0 end
          -- 0140: paritas dengan assert_entry_shape cabang valuation (satu line main di dompet aset).
          when e.kind = 'valuation' then s.n_counter = 0 and s.n_fee = 0 and ma.pocket = 'aset'
          else false
        end, false)
  ) x
  union all
  -- DQ05 (0131) sisa utang tidak negatif: Σ |main| cicilan hidup per utang <= principal. Kueri
  -- independen dari app.debt_balances; api.pay_debt dan pulihkan cicilan menjaga saat tulis.
  select 'DQ05', 'error', count(*)::int from app.debts d
  where d.principal < (select coalesce(sum(abs(l.amount)), 0) from app.entries e
                       join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                       where e.debt_id = d.id and e.kind = 'debt_payment' and e.voided_at is null)
  union all
  -- DQ04 transfer satu ruang: Σ = −fee
  select 'DQ04', 'error', count(*)::int from (
    select e.id from app.entries e join app.entry_lines l on l.entry_id = e.id
    where e.kind = 'transfer' group by e.id
    having sum(l.amount) <> coalesce(sum(l.amount) filter (where l.role = 'fee'), 0)
  ) x
  union all
  -- DQ04b pasangan space_transfer: 2 kaki, Σ main = 0, status void seragam
  select 'DQ04b', 'error', count(*)::int from (
    select e.link_id from app.entries e
    join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
    where e.kind = 'space_transfer' group by e.link_id
    having count(*) <> 2 or sum(l.amount) <> 0 or count(distinct (e.voided_at is null)) <> 1
  ) x
  union all
  -- DQ06 version = jumlah history
  select 'DQ06', 'warn', count(*)::int from app.entries e
  where e.version <> (select count(*) from app.entry_history h where h.entry_id = e.id)
  union all
  -- DQ07 tabungan negatif sekarang, atau negatif di akhir 3 hari WIB terakhir berturut-turut
  select 'DQ07', 'warn', count(*)::int from (
    select a.id
    from app.accounts a
    left join (
      select l.account_id, l.amount, e.occurred_on
      from app.entry_lines l join app.entries e on e.id = l.entry_id
      where e.voided_at is null
    ) v on v.account_id = a.id
    where a.pocket <> 'patungan'  -- 0136: dompet sistem dijaga DQ16
    group by a.id, a.pocket
    having (a.pocket = 'tabungan' and coalesce(sum(v.amount), 0) < 0)
        or (coalesce(sum(v.amount) filter (where v.occurred_on <= app.today() - 1), 0) < 0
            and coalesce(sum(v.amount) filter (where v.occurred_on <= app.today() - 2), 0) < 0
            and coalesce(sum(v.amount) filter (where v.occurred_on <= app.today() - 3), 0) < 0)
  ) x
  union all
  -- DQ09 line menunjuk akun ruang lain
  select 'DQ09', 'error', count(*)::int from app.entry_lines l
  join app.accounts a on a.id = l.account_id where a.space_id <> l.space_id
  union all
  -- DQ10 purge macet
  select 'DQ10', 'warn', count(*)::int from app.entries e
  where e.voided_at < app.now() - interval '97 days'
  union all
  -- DQ11 reimburse hidup menunjuk talangan hidup reimbursable di ruang yang sama
  select 'DQ11', 'error', count(*)::int from app.entries r
  where r.kind = 'reimbursement' and r.voided_at is null
    and not exists (
      select 1 from app.entries t
      where t.id = r.reimburses_entry_id and t.space_id = r.space_id and t.kind = 'expense'
        and t.reimbursable and t.voided_at is null)
  union all
  -- DQ12 Σ nominal reimburse hidup per talangan <= nominal talangan
  select 'DQ12', 'error', count(*)::int from (
    select r.reimburses_entry_id
    from app.entries r join app.entry_lines l on l.entry_id = r.id and l.role = 'main'
    where r.kind = 'reimbursement' and r.voided_at is null
    group by r.reimburses_entry_id
    having sum(l.amount) > (select -tl.amount from app.entry_lines tl
                            where tl.entry_id = r.reimburses_entry_id and tl.role = 'main')
  ) x
  union all
  -- DQ13 satu kewajiban: tagihan aktif + anggaran wajib, kategori induk sama, kemunculan tagihan
  -- (mulai bill_first_on) di periode berlabel bulan anggaran. Dihitung per pasangan. Hanya label
  -- periode berjalan ke depan: label lampau yang bergeser karena payday_rule/app.holidays berubah
  -- tidak lagi memengaruhi aman dipakai, jadi tidak membuat alert merah selamanya.
  select 'DQ13', 'error', count(*)::int from app.bills b
  join app.categories c on c.id = b.category_id
  join app.budgets bu on bu.space_id = b.space_id and bu.wajib
                     and bu.category_id = coalesce(c.parent_id, c.id)
  where b.archived_at is null
    and bu.month >= (select pp.label_month from app.pay_period(b.space_id, app.today()) pp)
    and private.bill_due_in_label(b.space_id, b.day_of_month,
          private.bill_first_on(b.starts_on, b.created_at), b.ends_on, bu.month)
  union all
  -- DQ14 pohon anggaran (S10): rincian tanpa anggaran induk di label yang sama, atau jumlah rincian
  -- satu induk melewati anggaran induknya. Trigger private.tg_budget_tree menjaga saat tulis; cek ini
  -- menangkap baris yang lolos jalan lain (UPDATE massal/restore manual). Dihitung per (ruang, induk, label).
  select 'DQ14', 'error', count(*)::int from (
    select bu.space_id, c.parent_id, bu.month
    from app.budgets bu join app.categories c on c.id = bu.category_id
    where c.parent_id is not null
    group by bu.space_id, c.parent_id, bu.month
    having sum(bu.amount) > coalesce((select p.amount from app.budgets p
             where p.space_id = bu.space_id and p.category_id = c.parent_id and p.month = bu.month), 0)
  ) x
  union all
  -- DQ15 modal trading (S12, 0134): app.trading_capital = Σ ulang transfer hidup antara dompet
  -- trading dan dompet non-trading satu ruang (kueri independen membaca −main, view membaca
  -- counter) ditambah kaki space_transfer hidup di dompet trading (kueri independen membaca kaki
  -- pasangan di Bersama, view membaca kaki trading), capital_left/realized tidak negatif dan
  -- capital_left - realized = setor - tarik; dompet trading wajib di Pribadi (B10, CHECK) dan wajib
  -- ada di view.
  select 'DQ15', 'error', count(*)::int from (
    select a.id
    from app.accounts a
    left join app.trading_capital tc on tc.account_id = a.id
    left join lateral (
      select coalesce(sum(-m.amount) filter (where c.account_id = a.id), 0) as cin,
             coalesce(sum(-m.amount) filter (where m.account_id = a.id), 0) as cout
      from app.entries e
      join app.entry_lines m on m.entry_id = e.id and m.role = 'main'
      join app.entry_lines c on c.entry_id = e.id and c.role = 'counter'
      join app.accounts ma on ma.id = m.account_id
      join app.accounts ca on ca.id = c.account_id
      where e.kind = 'transfer' and e.voided_at is null
        and a.id in (m.account_id, c.account_id)
        and (ma.pocket = 'trading') <> (ca.pocket = 'trading')
    ) s on true
    left join lateral (
      select coalesce(sum(-p.amount) filter (where e.direction = 'in'), 0) as cin,
             coalesce(sum(p.amount) filter (where e.direction = 'out'), 0) as cout
      from app.entries e
      join app.entry_lines l on l.entry_id = e.id and l.role = 'main' and l.account_id = a.id
      join app.entries pe on pe.link_id = e.link_id and pe.id <> e.id
      join app.entry_lines p on p.entry_id = pe.id and p.role = 'main'
      where e.kind = 'space_transfer' and e.voided_at is null
    ) st on true
    where a.pocket = 'trading'
      and (a.space_kind <> 'personal' or tc.account_id is null
           or tc.capital_in <> s.cin + st.cin or tc.capital_out <> s.cout + st.cout
           or tc.capital_left < 0 or tc.realized < 0
           or tc.capital_left - tc.realized <> s.cin + st.cin - s.cout - st.cout)
  ) x
  union all
  -- DQ16 patungan (S12, 0136): (a) saldo dompet sistem = Σ pelunasan hidup belum diterima; (b) per
  -- tagihan Σ bagian = nominal, kaki masuk dan pengeluaran ada di dompet sistem ruang itu senominal
  -- dengan status batal sama; (c) per pelunasan kaki masuk cocok, kaki terima (bila ada) hidup dan
  -- cocok; (d) entri hidup di dompet sistem wajib dirujuk baris patungan hidup; (e) Σ saldo anggota per
  -- ruang = 0. Kueri independen dari fungsi tulis 0136.
  select 'DQ16', 'error', count(*)::int from (
    select a.id from app.accounts a
    where a.pocket = 'patungan'
      and (select coalesce(sum(l.amount), 0) from app.entry_lines l join app.entries e on e.id = l.entry_id
            where l.account_id = a.id and e.voided_at is null)
          <> (select coalesce(sum(t.amount), 0) from app.settlements t
               where t.space_id = a.space_id and t.voided_at is null and t.received_entry_id is null)
    union all
    select s.id from app.splits s
    where s.amount <> (select coalesce(sum(sh.amount), 0) from app.split_shares sh
                        where sh.space_id = s.space_id and sh.split_id = s.id)
       or not exists (select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = s.in_entry_id and e.kind = 'space_transfer' and e.direction = 'in'
                        and a.pocket = 'patungan' and a.space_id = s.space_id and l.amount = s.amount
                        and (e.voided_at is null) = (s.voided_at is null))
       or not exists (select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = s.expense_entry_id and e.kind = 'expense'
                        and a.pocket = 'patungan' and a.space_id = s.space_id and l.amount = -s.amount
                        and (e.voided_at is null) = (s.voided_at is null))
    union all
    select t.id from app.settlements t
    where not exists (select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = t.in_entry_id and e.kind = 'space_transfer' and e.direction = 'in'
                        and a.pocket = 'patungan' and a.space_id = t.space_id and l.amount = t.amount
                        and (e.voided_at is null) = (t.voided_at is null))
       or (t.received_entry_id is not null and not exists (
                      select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = t.received_entry_id and e.kind = 'space_transfer' and e.direction = 'out'
                        and a.pocket = 'patungan' and a.space_id = t.space_id and l.amount = -t.amount
                        and e.voided_at is null))
    union all
    select e.id from app.entries e
    join app.entry_lines l on l.entry_id = e.id
    join app.accounts a on a.id = l.account_id
    where a.pocket = 'patungan' and e.voided_at is null
      and not exists (select 1 from app.splits s
                      where s.voided_at is null and e.id in (s.in_entry_id, s.expense_entry_id))
      and not exists (select 1 from app.settlements t where t.voided_at is null and t.in_entry_id = e.id)
      and not exists (select 1 from app.settlements t where t.received_entry_id = e.id)
    union all
    select b.space_id from app.member_balances b group by b.space_id having sum(b.balance) <> 0
  ) x
  union all
  -- DQ17 tujuan (S13, 0137): tujuan aktif pada dompet terarsip, bukan tabungan, atau di ruang lain.
  -- private.tg_goal_guard dan api.archive_account (0138) menjaga saat tulis; cek ini menangkap baris yang
  -- lolos jalan lain (UPDATE massal/restore manual).
  select 'DQ17', 'error', count(*)::int from app.goals g
  join app.accounts a on a.id = g.account_id
  where g.status = 'active'
    and (a.archived_at is not null or a.pocket <> 'tabungan' or a.space_id <> g.space_id)
  union all
  -- DQ19 aset (S14, 0140): (a) dompet aset bersaldo negatif; (b) entri hidup di dompet aset selain transfer,
  -- transfer antar ruang, saldo awal, Cocokkan saldo, dan valuasi (pemasukan, pengeluaran/talangan,
  -- reimburse, utang), atau kaki antar ruang yang pasangannya dompet sistem patungan; (c) tagihan rutin
  -- menunjuk dompet aset; (d) rincian 1:1: dompet aset tanpa app.asset_details, rincian pada dompet bukan
  -- aset atau ruang lain, saham di Bersama. Penjaga private.tg_asset_ledger/tg_asset_guard dan
  -- private.assert_balance menjaga saat tulis; cek ini menangkap baris yang lolos jalan lain.
  select 'DQ19', 'error', count(*)::int from (
    select a.id from app.accounts a
    where a.pocket = 'aset'
      and (select coalesce(sum(l.amount), 0) from app.entry_lines l join app.entries e on e.id = l.entry_id
            where l.account_id = a.id and e.voided_at is null) < 0
    union all
    select e.id from app.entries e
    join app.entry_lines l on l.entry_id = e.id
    join app.accounts a on a.id = l.account_id and a.pocket = 'aset'
    where e.voided_at is null
      and (e.kind not in ('transfer', 'space_transfer', 'opening_balance', 'adjustment', 'valuation')
           or (e.kind = 'space_transfer' and exists (
                 select 1 from app.entries p
                 join app.entry_lines pl on pl.entry_id = p.id and pl.role = 'main'
                 join app.accounts pa on pa.id = pl.account_id
                 where p.link_id = e.link_id and p.id <> e.id and pa.pocket = 'patungan')))
    union all
    select b.id from app.bills b join app.accounts a on a.id = b.account_id where a.pocket = 'aset'
    union all
    select a.id from app.accounts a
    where a.pocket = 'aset' and not exists (select 1 from app.asset_details d where d.account_id = a.id)
    union all
    select d.account_id from app.asset_details d join app.accounts a on a.id = d.account_id
    where a.pocket <> 'aset' or a.space_id <> d.space_id or (d.asset_kind = 'saham' and a.space_kind <> 'personal')
  ) x
$$;

drop function api.trading_overview(uuid);

create function api.trading_overview(p_space_id uuid)
returns table (account_id uuid, name text, balance bigint, capital_in bigint, capital_out bigint,
               capital_left bigint, realized bigint, shortfall bigint, has_deposit boolean)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if (select s.kind from app.spaces s where s.id = p_space_id) is distinct from 'personal' then
    raise exception using errcode = 'DK422', message = 'pocket_personal_only';
  end if;
  return query
  with w as (
    select a.id, a.name, a.sort_order, a.created_at, ab.balance,
           tc.capital_in, tc.capital_out, tc.capital_left, tc.realized
      from app.accounts a
      join app.account_balances ab on ab.account_id = a.id
      join app.trading_capital tc on tc.account_id = a.id
     where a.space_id = p_space_id and a.pocket = 'trading' and a.archived_at is null
  )
  select x.id, x.name, x.balance, x.capital_in, x.capital_out, x.capital_left, x.realized,
         x.shortfall, x.has_deposit
    from (
      select w.id, w.name, w.balance, w.capital_in, w.capital_out, w.capital_left, w.realized,
             greatest(w.capital_left - w.balance, 0)::bigint as shortfall,
             w.capital_in > 0 as has_deposit, 0 as grp, w.sort_order, w.created_at
        from w
      union all
      select null, null, coalesce(sum(w.balance), 0)::bigint, coalesce(sum(w.capital_in), 0)::bigint,
             coalesce(sum(w.capital_out), 0)::bigint, coalesce(sum(w.capital_left), 0)::bigint,
             coalesce(sum(w.realized), 0)::bigint,
             greatest(coalesce(sum(w.capital_left), 0) - coalesce(sum(w.balance), 0), 0)::bigint,
             coalesce(bool_or(w.capital_in > 0), false), 1, null, null
        from w
    ) x
   order by x.grp, x.sort_order, x.created_at, x.id;
end $$;

create or replace view app.trading_capital with (security_invoker = true) as
with flows as (
  -- transfer satu ruang: nominal = counter (tanpa biaya); sisi lain dipastikan bukan trading.
  select c.account_id, c.amount as cin, 0::bigint as cout
    from app.entries e
    join app.entry_lines m on m.space_id = e.space_id and m.entry_id = e.id and m.role = 'main'
    join app.entry_lines c on c.space_id = e.space_id and c.entry_id = e.id and c.role = 'counter'
    join app.accounts ma on ma.id = m.account_id
   where e.kind = 'transfer' and e.voided_at is null and ma.pocket <> 'trading'
  union all
  select m.account_id, 0::bigint, c.amount
    from app.entries e
    join app.entry_lines m on m.space_id = e.space_id and m.entry_id = e.id and m.role = 'main'
    join app.entry_lines c on c.space_id = e.space_id and c.entry_id = e.id and c.role = 'counter'
    join app.accounts ca on ca.id = c.account_id
   where e.kind = 'transfer' and e.voided_at is null and ca.pocket <> 'trading'
  union all
  -- space_transfer (temuan S2): kaki main di dompet trading, lawan selalu dompet Bersama (B10).
  -- Biaya ada di line fee, jadi main = nominal.
  select l.account_id,
         case when e.direction = 'in' then l.amount else 0 end::bigint,
         case when e.direction = 'out' then -l.amount else 0 end::bigint
    from app.entries e
    join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id and l.role = 'main'
   where e.kind = 'space_transfer' and e.voided_at is null
), t as (
  select a.space_id, a.id as account_id,
         coalesce(sum(f.cin), 0)::bigint as capital_in, coalesce(sum(f.cout), 0)::bigint as capital_out
    from app.accounts a
    left join flows f on f.account_id = a.id
   where a.pocket = 'trading'
   group by a.space_id, a.id
)
select space_id, account_id, capital_in, capital_out,
       greatest(capital_in - capital_out, 0)::bigint as capital_left,
       greatest(capital_out - capital_in, 0)::bigint as realized
  from t;

revoke all on app.stock_holdings, app.stock_trades, app.stock_prices, app.stock_positions
  from dompetku_web, dompetku_api, dompetku_auditor;
drop function private.price_verdict(uuid, text, date, bigint);
drop table app.stock_prices;
drop function private.stock_cost_removed(uuid, bigint);
drop view app.stock_positions;
drop trigger stock_guard_del on app.entries;
drop trigger stock_guard_upd on app.entries;
drop trigger stock_guard_ins on app.entries;
drop trigger stock_guard on app.entry_lines;
drop function private.tg_stock_guard();
drop table private.stock_ctx;
-- Entri trade tetap ada sebagai transfer/valuasi/saldo awal biasa (bentuk sah untuk 0140).
alter table app.entries drop column stock_trade_id;
drop table app.stock_trades;
drop table app.stock_holdings;
alter table app.asset_details drop constraint asset_details_kind_key;

select private.own_api_functions();
