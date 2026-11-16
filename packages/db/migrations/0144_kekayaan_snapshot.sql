-- migrate:up
-- S14 (IPD §6, plan S14 Task 6, K5, K10, K13 (f)(g)(h); bingkai S14-NW1, NW2): kekayaan bersih satu fungsi SQL,
-- snapshot harian, dan hari kotor. Expand-only: dua tabel, satu fungsi app, satu trigger function (tiga trigger),
-- satu fungsi job; api.net_worth diganti (drop + create, kolom baru; tidak dipakai web sampai Task 9) dan
-- private.dq_run diganti utuh (+ DQ08).
--
-- - app.net_worth_at(ruang, tanggal) (INVOKER STABLE ROWS 1, milik owner; RLS pemanggil berlaku, jadi ruang
--   pasangan = semua nol tanpa orakel): kas = Σ line hidup bertanggal <= tanggal di dompet operasional + tabungan +
--   trading; aset = sama untuk dompet aset bukan saham; saham_pasar = per kode Σ lembar dan biaya dari trade hidup
--   bertanggal <= tanggal, dinilai lembar × harga ok terakhir <= tanggal (app.stock_last_close) atau biaya perolehan
--   bila belum ada harga; saham_tanpa_harga = jumlah kode berlembar tanpa harga; piutang/utang = sisa per tanggal
--   (pokok − Σ cicilan hidup <= tanggal, tidak negatif) dari utang hidup yang dibuka <= tanggal; total = kas + aset +
--   saham_pasar + piutang − utang; price_as_of = tanggal harga tertua yang dipakai. Tidak ikut: Kas Kantor, dompet
--   sistem patungan, saldo buku dompet saham (diganti nilai pasar), talangan menunggu reimburse (K5). Saldo
--   historis dipakai apa adanya (ruling review 0141: setoran mundur ke aset hanya dijaga pada saldo sekarang).
-- - api.net_worth(ruang) (INVOKER, assert_member = DK404 seragam): net_worth_at hari ini + month_ago_total dan
--   month_ago_on = snapshot terbaru di [today − 33, today − 30] (bingkai S14 Dampak 4; selain itu NULL). Kolom
--   lama (operasional, tabungan, kantor_excluded) tidak dipertahankan: tidak ada pemanggil di apps/web.
-- - app.net_worth_snapshots (PK ruang × tanggal; kolom = keluaran net_worth_at + computed_at): RLS ENABLE + FORCE,
--   web hanya SELECT anggota; ditulis hanya jobs.net_worth_snapshot (owner). FK ke ruang ON DELETE CASCADE: data
--   turunan, ruang tidak pernah dihapus aplikasi (hanya reset tes).
-- - app.nw_dirty (satu baris per ruang: tanggal kotor tertua): RLS ENABLE + FORCE tanpa policy, tanpa hak web/api/
--   worker; diisi trigger private.tg_nw_dirty (DEFINER milik owner) AFTER INSERT OR UPDATE di app.entries
--   (occurred_on lama dan baru; ubah nominal, batal, pulihkan, pindah ruang), app.stock_prices (on_date; koreksi
--   harga) dan app.debts (opened_on; utang berjalan tanpa entri, batal utang), hanya untuk tanggal < app.today()
--   (snapshot hari ini belum ada). Hapus fisik (purge) hanya entri batal, tidak mengubah angka.
-- - jobs.net_worth_snapshot() (DEFINER milik owner, EXECUTE hanya dompetku_worker; 00:10 WIB, Task 7): per ruang
--   menghitung ulang dari tanggal kotor (atau hanya H−1) sampai H−1, paling jauh today − 400 (K10), upsert
--   (idempoten), mengembalikan jumlah baris. Tanda dihapus hanya bila versi barisnya (xmin) masih yang dibaca di
--   awal: tanda yang diperbarui transaksi lain selama job tetap tinggal untuk run berikutnya.
-- - Backfill sekali (K10): nw_dirty diisi tanggal entri hidup/utang hidup tertua per ruang; job pertama memotongnya
--   ke 400 hari.
-- - private.dq_run: + DQ08 (warn): snapshot H−1 berbeda dari net_worth_at dihitung ulang, kecuali ruang yang masih
--   bertanda kotor <= H−1 (menunggu job). Selebihnya = 0142.
-- Hak: app.net_worth_at untuk web dan auditor (DQ08); app.stock_last_close + auditor; snapshot SELECT web dan
-- auditor; nw_dirty SELECT auditor.

-- ===== Kekayaan bersih per tanggal (satu sumber untuk Dompet, snapshot, DQ08) =====
create function app.net_worth_at(p_space_id uuid, p_on date)
returns table (kas bigint, aset bigint, saham_pasar bigint, saham_tanpa_harga int, piutang bigint, utang bigint,
               total bigint, price_as_of date)
language sql stable rows 1 set search_path = '' as $$
  with bal as (
    select coalesce(sum(l.amount) filter (where a.pocket in ('operasional', 'tabungan', 'trading')), 0)::bigint as kas,
           coalesce(sum(l.amount) filter (where a.pocket = 'aset' and sd.account_id is null), 0)::bigint as aset
      from app.entry_lines l
      join app.entries e on e.space_id = l.space_id and e.id = l.entry_id
      join app.accounts a on a.id = l.account_id
      left join app.asset_details sd on sd.account_id = a.id and sd.asset_kind = 'saham'
     where l.space_id = p_space_id and e.voided_at is null and e.occurred_on <= p_on
  ), pos as (
    -- Rumus posisi = app.stock_positions (0142), dibatasi trade bertanggal <= p_on.
    select h.space_id, h.ticker,
           sum(case when t.side = 'sell' then -t.shares else t.shares end) as shares,
           sum(case t.side when 'buy' then t.shares * t.price + t.fee
                           when 'opening' then t.shares * t.price
                           else -t.cost_removed end) as cost
      from app.stock_holdings h
      join app.stock_trades t on t.space_id = h.space_id and t.holding_id = h.id
     where h.space_id = p_space_id and t.voided_at is null and t.occurred_on <= p_on
     group by h.space_id, h.id, h.ticker
  ), sh as (
    select coalesce(sum(coalesce(p.shares * c.close, p.cost)), 0)::bigint as pasar,
           (count(*) filter (where c.close is null))::int as tanpa,
           min(c.on_date) as price_as_of
      from pos p
      left join lateral app.stock_last_close(p.space_id, p.ticker, p_on) c on true
     where p.shares > 0
  ), debt as (
    select coalesce(sum(r.rem) filter (where r.direction = 'lent'), 0)::bigint as piutang,
           coalesce(sum(r.rem) filter (where r.direction = 'borrowed'), 0)::bigint as utang
      from (
        select d.direction,
               greatest(d.principal - coalesce((
                 select sum(abs(l.amount)) from app.entries e
                   join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id and l.role = 'main'
                  where e.space_id = d.space_id and e.debt_id = d.id and e.kind = 'debt_payment'
                    and e.voided_at is null and e.occurred_on <= p_on), 0), 0) as rem
          from app.debts d
         where d.space_id = p_space_id and d.voided_at is null and d.opened_on <= p_on
      ) r
  )
  select bal.kas, bal.aset, sh.pasar, sh.tanpa, debt.piutang, debt.utang,
         bal.kas + bal.aset + sh.pasar + debt.piutang - debt.utang, sh.price_as_of
    from bal, sh, debt
$$;

-- ===== Snapshot harian dan tanda hari kotor =====
create table app.net_worth_snapshots (
  space_id          uuid not null references app.spaces (id) on delete cascade,
  on_date           date not null check (on_date >= date '2000-01-01'),
  kas               bigint not null,
  aset              bigint not null,
  saham_pasar       bigint not null,
  saham_tanpa_harga int not null,
  piutang           bigint not null,
  utang             bigint not null,
  total             bigint not null,
  price_as_of       date,
  computed_at       timestamptz not null,
  primary key (space_id, on_date)
);

create table app.nw_dirty (
  space_id  uuid primary key references app.spaces (id) on delete cascade,
  from_date date not null
);

alter table app.net_worth_snapshots enable row level security;
alter table app.net_worth_snapshots force row level security;
create policy member_read on app.net_worth_snapshots for select to dompetku_web
  using (space_id = any ((select app.my_space_ids())::uuid[]));
alter table app.nw_dirty enable row level security;
alter table app.nw_dirty force row level security;

-- Tanggal kotor tertua per ruang; tg_argv[0] = kolom tanggal. Baris lama (UPDATE) ikut: tanggal/ruang yang
-- ditinggalkan juga berubah angkanya.
create function private.tg_nw_dirty() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  insert into app.nw_dirty as d (space_id, from_date)
  select x.s, min(x.d)
    from (values ((v_new ->> 'space_id')::uuid, (v_new ->> tg_argv[0])::date),
                 ((v_old ->> 'space_id')::uuid, (v_old ->> tg_argv[0])::date)) x (s, d)
   where x.d < app.today()
   group by x.s
  on conflict (space_id) do update set from_date = least(d.from_date, excluded.from_date);
  return null;
end $$;
create trigger nw_dirty after insert or update on app.entries
  for each row execute function private.tg_nw_dirty('occurred_on');
create trigger nw_dirty after insert or update on app.stock_prices
  for each row execute function private.tg_nw_dirty('on_date');
create trigger nw_dirty after insert or update on app.debts
  for each row execute function private.tg_nw_dirty('opened_on');

-- ===== Job snapshot (00:10 WIB untuk H−1 + hari kotor, K10) =====
create function jobs.net_worth_snapshot() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_y    date := app.today() - 1;
  v_min  date := app.today() - 400;
  v_sp   uuid[];
  v_xmin xid[];
  v_n    int;
begin
  select coalesce(array_agg(d.space_id), '{}'), coalesce(array_agg(d.xmin), '{}') into v_sp, v_xmin
    from app.nw_dirty d;
  insert into app.net_worth_snapshots as s (space_id, on_date, kas, aset, saham_pasar, saham_tanpa_harga, piutang,
                                            utang, total, price_as_of, computed_at)
  select r.id, g.d::date, n.kas, n.aset, n.saham_pasar, n.saham_tanpa_harga, n.piutang, n.utang, n.total,
         n.price_as_of, app.now()
    from (select sp.id, greatest(least(coalesce(d.from_date, v_y), v_y), v_min) as f
            from app.spaces sp left join app.nw_dirty d on d.space_id = sp.id) r
   cross join lateral pg_catalog.generate_series(r.f::timestamp, v_y::timestamp, interval '1 day') g (d)
   cross join lateral app.net_worth_at(r.id, g.d::date) n
  on conflict (space_id, on_date) do update
    set kas = excluded.kas, aset = excluded.aset, saham_pasar = excluded.saham_pasar,
        saham_tanpa_harga = excluded.saham_tanpa_harga, piutang = excluded.piutang, utang = excluded.utang,
        total = excluded.total, price_as_of = excluded.price_as_of, computed_at = excluded.computed_at;
  get diagnostics v_n = row_count;
  -- Hanya versi tanda yang dibaca di atas (xmin sama); tanda yang diperbarui sesudahnya menunggu run berikutnya.
  delete from app.nw_dirty d using unnest(v_sp, v_xmin) x (s, xm) where d.space_id = x.s and d.xmin = x.xm;
  return v_n;
end $$;

-- ===== api.net_worth (0134 → kolom komponen K5 + pembanding 30 hari) =====
drop function api.net_worth(uuid);
create function api.net_worth(p_space_id uuid)
returns table (kas bigint, aset bigint, saham_pasar bigint, saham_tanpa_harga int, piutang bigint, utang bigint,
               total bigint, price_as_of date, month_ago_total bigint, month_ago_on date)
language plpgsql stable rows 1 set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  select n.kas, n.aset, n.saham_pasar, n.saham_tanpa_harga, n.piutang, n.utang, n.total, n.price_as_of,
         m.total, m.on_date
    from app.net_worth_at(p_space_id, app.today()) n
    left join lateral (
      select s.total, s.on_date from app.net_worth_snapshots s
       where s.space_id = p_space_id and s.on_date between app.today() - 33 and app.today() - 30
       order by s.on_date desc
       limit 1
    ) m on true;
end $$;

-- ===== Backfill sekali (K10): tanggal hidup tertua per ruang; job memotong ke 400 hari =====
insert into app.nw_dirty (space_id, from_date)
select x.space_id, min(x.d)
  from (select e.space_id, e.occurred_on as d from app.entries e where e.voided_at is null
        union all
        select d.space_id, d.opened_on from app.debts d where d.voided_at is null) x
 where x.d < app.today()
 group by x.space_id;

-- ===== Cek kualitas data: + DQ08 snapshot (selebihnya = 0142) =====
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
  -- DQ08 (S14, 0144) snapshot H−1 = app.net_worth_at dihitung ulang; ruang bertanda kotor <= H−1 menunggu job
  select 'DQ08', 'warn', count(*)::int from app.net_worth_snapshots s
  cross join lateral app.net_worth_at(s.space_id, s.on_date) n
  where s.on_date = app.today() - 1
    and not exists (select 1 from app.nw_dirty d where d.space_id = s.space_id and d.from_date <= s.on_date)
    and (s.kas, s.aset, s.saham_pasar, s.saham_tanpa_harga, s.piutang, s.utang, s.total, s.price_as_of)
        is distinct from (n.kas, n.aset, n.saham_pasar, n.saham_tanpa_harga, n.piutang, n.utang, n.total, n.price_as_of)
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


-- ===== Hak =====
grant select on app.net_worth_snapshots to dompetku_web;
-- Auditor: tabel baru eksplisit (grant 0008 hanya tabel saat itu); DQ08 membaca snapshot, tanda, dan fungsi.
grant select on app.net_worth_snapshots, app.nw_dirty to dompetku_auditor;
grant execute on function app.net_worth_at(uuid, date) to dompetku_web, dompetku_auditor;
grant execute on function app.stock_last_close(uuid, text, date) to dompetku_auditor;
grant execute on function jobs.net_worth_snapshot() to dompetku_worker;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
-- Fungsi yang diganti kembali ke badan sebelumnya (0142 dq_run, 0134 api.net_worth).
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


drop function api.net_worth(uuid);
create function api.net_worth(p_space_id uuid)
returns table (operasional bigint, tabungan bigint, kantor_excluded bigint, total bigint)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  with s as (
    select coalesce(sum(ab.balance) filter (where ab.pocket = 'operasional'), 0)::bigint as o,
           coalesce(sum(ab.balance) filter (where ab.pocket = 'tabungan'), 0)::bigint as t,
           coalesce(sum(ab.balance) filter (where ab.pocket = 'trading'), 0)::bigint as tr,
           coalesce(sum(ab.balance) filter (where ab.pocket = 'kantor'), 0)::bigint as k
    from app.account_balances ab
    where ab.space_id = p_space_id
  )
  select o, t, k, o + t + tr from s;
end $$;

revoke execute on function app.stock_last_close(uuid, text, date) from dompetku_auditor;
drop function jobs.net_worth_snapshot();
drop trigger nw_dirty on app.debts;
drop trigger nw_dirty on app.stock_prices;
drop trigger nw_dirty on app.entries;
drop function private.tg_nw_dirty();
drop table app.nw_dirty;
drop table app.net_worth_snapshots;
drop function app.net_worth_at(uuid, date);

select private.own_api_functions();
