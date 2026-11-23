-- migrate:up
-- S15 (IPD §6, plan S15 Task 2, K1 sampai K5, K7, K8): trip = pengelompokan pengeluaran per perjalanan.
-- Expand-only: satu tabel, satu kolom nullable di app.entries, satu fungsi trigger baru; private.assert_entry_shape
-- dan private.dq_run diganti utuh (create or replace, tanda tangan dan kolom hasil sama; badan = versi hidup
-- 0140:168 dan 0144:204, bukan bagian migrate:down). Fungsi api.* trip = 0147; jalur tulis entri
-- (create_entry, update_entry, create_split, set_entries_trip), ekspor, dan feed = 0148.
--
-- - app.trips: ruang Pribadi atau Bersama (K1; di Bersama semua anggota menulis, pola tujuan), nama 1..60
--   sesudah btrim, tanggal mulai dan selesai wajib (2000-01-01..2100-12-31, selesai >= mulai, selisih <= 365
--   hari = rentang <= 366 hari; K5), anggaran opsional 1..1e13 (K7: hanya pembanding, bukan anggaran bulanan).
--   Status = archived_at (K8; fase Berlangsung/Selesai/Akan datang diturunkan dari tanggal, tidak tersimpan).
--   Tanpa kolom turunan (total, hari, persen), tanpa hapus fisik, tanpa purge.
-- - trips_name_unique: indeks unik parsial (space_id, lower(btrim(name))) where archived_at is null = nama
--   unik di antara trip aktif ruang itu (pola accounts_name_unique 0109); api 0147 memetakan 23505 ke name_taken.
-- - private.tg_trip_guard (BEFORE UPDATE, SECURITY INVOKER, pola tg_goal_guard): space_id dan space_kind tetap
--   (DK422 trip_immutable). Nama, tanggal, anggaran, dan arsip boleh berubah.
-- - app.entries.trip_id (pola debt_id 0130, stock_trade_id 0142): FK komposit (space_id, trip_id) -> trips
--   on delete restrict (trip ruang lain tidak bisa dirujuk; MATCH SIMPLE: null = tanpa trip), CHECK
--   entries_trip_check (hanya expense biasa, bukan talangan; K4), indeks non-parsial (BSD §13 #7). Satu entri paling banyak satu
--   trip. Id entri stabil, jadi tag bertahan setelah edit; private.entry_snapshot (to_jsonb) otomatis memuat
--   trip_id di riwayat. Kolom ini tidak masuk app.report_lines atau app.account_balances: trip tidak mengubah
--   saldo, Laporan, anggaran, aman dipakai, atau kekayaan bersih (I6).
-- - private.assert_entry_shape: + pengaman bentuk entri bertrip (kind <> expense, talangan, atau dompet utama
--   Kantor = DK500 entry_shape_invalid). Selebihnya = 0140. DQ03 tidak diubah (itu cek bentuk line);
--   aturan trip dijaga CHECK + assert_entry_shape saat tulis dan DQ20 sesudahnya.
-- - private.dq_run: + DQ20 (error). Selebihnya = 0144 (DQ01..DQ19 tidak berubah).
-- - RLS ENABLE + FORCE pola ruang; web/api/auditor SELECT, tulis hanya dompetku_api (INSERT, UPDATE; tanpa
--   DELETE). updated_at/updated_by dipelihara fungsi api (pola goals).
-- - FK created_by/updated_by ke auth."user" on delete restrict: hanya anggota ruang (sudah berprofil) yang bisa
--   menulis, jadi jobs.purge_unfinished_users (akun tanpa profil) tidak pernah terhalang.

create table app.trips (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null,
  space_kind    app.space_kind not null,
  name          text not null check (length(btrim(name)) between 1 and 60),
  starts_on     date not null check (starts_on between date '2000-01-01' and date '2100-12-31'),
  ends_on       date not null check (ends_on between date '2000-01-01' and date '2100-12-31'),
  budget_amount bigint check (budget_amount > 0 and budget_amount <= 10000000000000),
  archived_at   timestamptz,
  created_by    uuid not null references auth."user" (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_by    uuid not null references auth."user" (id) on delete restrict,
  updated_at    timestamptz not null default now(),
  unique (space_id, id),
  foreign key (space_id, space_kind) references app.spaces (id, kind) on delete restrict,
  constraint trips_range check (ends_on >= starts_on and ends_on - starts_on <= 365)
);
create unique index trips_name_unique on app.trips (space_id, lower(btrim(name))) where archived_at is null;
create index on app.trips (space_id, space_kind);
create index on app.trips (created_by);
create index on app.trips (updated_by);

create function private.tg_trip_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.space_id, new.space_kind) is distinct from (old.space_id, old.space_kind) then
    raise exception using errcode = 'DK422', message = 'trip_immutable';
  end if;
  return new;
end $$;
create trigger trip_guard before update on app.trips
  for each row execute function private.tg_trip_guard();

-- ===== Tanda trip di entri =====
alter table app.entries add column trip_id uuid;
alter table app.entries add constraint entries_trip_fk
  foreign key (space_id, trip_id) references app.trips (space_id, id) on delete restrict;
alter table app.entries add constraint entries_trip_check
  check (trip_id is null or (kind = 'expense' and not reimbursable));
-- Non-parsial: BSD §13 #7 (setiap FK punya indeks non-parsial); null tidak mahal (pola debt_id, stock_trade_id).
create index entries_trip on app.entries (space_id, trip_id);

-- ===== Matriks bentuk lines per kind (0140) + pengaman entri bertrip =====
create or replace function private.assert_entry_shape(p_entry_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e  app.entries%rowtype;
  m  app.entry_lines%rowtype;
  c  app.entry_lines%rowtype;
  f  app.entry_lines%rowtype;
  d  app.debts%rowtype;
  ok boolean;
begin
  select * into e from app.entries where id = p_entry_id;
  if not found then
    return;
  end if;
  select * into m from app.entry_lines where entry_id = p_entry_id and role = 'main';
  select * into c from app.entry_lines where entry_id = p_entry_id and role = 'counter';
  select * into f from app.entry_lines where entry_id = p_entry_id and role = 'fee';
  if e.debt_id is not null then
    select * into d from app.debts where id = e.debt_id;
  end if;

  ok := m.entry_id is not null
        and (f.entry_id is null or (f.amount < 0 and f.account_id = m.account_id));
  ok := ok and case
    when e.kind = 'income'  then c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'expense' then c.entry_id is null and f.entry_id is null and m.amount < 0
    when e.kind = 'reimbursement' then c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'transfer' then
         c.entry_id is not null and m.amount < 0 and c.amount = -m.amount
         and c.account_id <> m.account_id
    when e.kind = 'space_transfer' then
         c.entry_id is null
         and case e.direction when 'out' then m.amount < 0
                              else m.amount > 0 and f.entry_id is null end
    when e.kind = 'opening_balance' then
         c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'adjustment' then c.entry_id is null and f.entry_id is null
    -- 0130: utang/piutang. borrowed: pokok masuk (+), cicilan keluar (-); lent: kebalikannya.
    when e.kind in ('debt_principal', 'debt_payment') then coalesce(
         c.entry_id is null and f.entry_id is null and d.id is not null
         and (e.voided_at is not null or d.voided_at is null)
         and not exists (select 1 from app.accounts a where a.id = m.account_id and a.pocket = 'kantor')
         and case when e.kind = 'debt_principal' then
                   d.mode = 'baru' and abs(m.amount) = d.principal
                   and case d.direction when 'borrowed' then m.amount > 0 when 'lent' then m.amount < 0 end
                  else
                   case d.direction when 'borrowed' then m.amount < 0 when 'lent' then m.amount > 0 end
             end, false)
    -- 0140: perubahan nilai aset. Satu line main (naik/turun, bukan nol: CHECK entry_lines), tanpa
    -- counter/fee, dompet ber-pocket aset (tidak negatif dan jalur lain dijaga private.tg_asset_ledger).
    when e.kind = 'valuation' then
         c.entry_id is null and f.entry_id is null
         and exists (select 1 from app.accounts a where a.id = m.account_id and a.pocket = 'aset')
    else false
  end;
  -- 0146 (K4): entri bertrip = pengeluaran biasa; bukan talangan dan bukan dompet utama Kantor. CHECK
  -- entries_trip_check menutup kind/talangan di tabel; dompet Kantor hanya terlihat dari line main.
  ok := ok and (e.trip_id is null
                or (e.kind = 'expense' and not e.reimbursable
                    and not exists (select 1 from app.accounts a where a.id = m.account_id and a.pocket = 'kantor')));
  if not ok then
    raise exception using errcode = 'DK500', message = 'entry_shape_invalid';
  end if;
  if e.kind = 'space_transfer' then
    perform private.assert_space_transfer_pair(e.link_id);
  end if;
end $$;

-- ===== Cek kualitas data: + DQ20 trip (selebihnya = 0144) =====
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
  union all
  -- DQ20 trip (S15, 0146): entri hidup bertrip yang bukan pengeluaran biasa (bukan expense, talangan, atau
  -- dompet utama Kantor; K4) atau yang trip-nya bukan trip ruang entri itu. entries_trip_check, FK komposit,
  -- private.assert_entry_shape, dan fungsi tulis (0148) menjaga saat tulis; cek ini menangkap baris yang
  -- lolos jalan lain (UPDATE massal/restore manual). Total trip memakai kelas expense, jadi pelanggaran
  -- di sini akan memasukkan Kantor/talangan ke angka trip.
  select 'DQ20', 'error', count(*)::int from app.entries e
  where e.trip_id is not null and e.voided_at is null
    and (e.kind <> 'expense' or e.reimbursable
         or exists (select 1 from app.entry_lines l join app.accounts a on a.id = l.account_id
                     where l.entry_id = e.id and l.role = 'main' and a.pocket = 'kantor')
         or not exists (select 1 from app.trips t where t.id = e.trip_id and t.space_id = e.space_id))
$$;

-- ===== RLS: aktif dan dipaksa; pola ruang (baca web/api, tulis hanya dompetku_api) =====
alter table app.trips enable row level security;
alter table app.trips force row level security;
create policy member_read on app.trips for select to dompetku_web, dompetku_api
  using (space_id = any ((select app.my_space_ids())::uuid[]));
create policy member_write on app.trips for all to dompetku_api
  using (space_id = any ((select app.my_space_ids())::uuid[]))
  with check (space_id = any ((select app.my_space_ids())::uuid[]));

-- ===== Hak tabel =====
grant select on app.trips to dompetku_web, dompetku_api;
grant insert, update on app.trips to dompetku_api;
-- Auditor: tabel baru eksplisit (grant 0008 hanya tabel saat itu).
grant select on app.trips to dompetku_auditor;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
-- Fungsi yang diganti kembali ke badan sebelumnya (0140 assert_entry_shape, 0144 dq_run) sebelum kolom dibuang.
create or replace function private.assert_entry_shape(p_entry_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e  app.entries%rowtype;
  m  app.entry_lines%rowtype;
  c  app.entry_lines%rowtype;
  f  app.entry_lines%rowtype;
  d  app.debts%rowtype;
  ok boolean;
begin
  select * into e from app.entries where id = p_entry_id;
  if not found then
    return;
  end if;
  select * into m from app.entry_lines where entry_id = p_entry_id and role = 'main';
  select * into c from app.entry_lines where entry_id = p_entry_id and role = 'counter';
  select * into f from app.entry_lines where entry_id = p_entry_id and role = 'fee';
  if e.debt_id is not null then
    select * into d from app.debts where id = e.debt_id;
  end if;

  ok := m.entry_id is not null
        and (f.entry_id is null or (f.amount < 0 and f.account_id = m.account_id));
  ok := ok and case
    when e.kind = 'income'  then c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'expense' then c.entry_id is null and f.entry_id is null and m.amount < 0
    when e.kind = 'reimbursement' then c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'transfer' then
         c.entry_id is not null and m.amount < 0 and c.amount = -m.amount
         and c.account_id <> m.account_id
    when e.kind = 'space_transfer' then
         c.entry_id is null
         and case e.direction when 'out' then m.amount < 0
                              else m.amount > 0 and f.entry_id is null end
    when e.kind = 'opening_balance' then
         c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'adjustment' then c.entry_id is null and f.entry_id is null
    -- 0130: utang/piutang. borrowed: pokok masuk (+), cicilan keluar (-); lent: kebalikannya.
    when e.kind in ('debt_principal', 'debt_payment') then coalesce(
         c.entry_id is null and f.entry_id is null and d.id is not null
         and (e.voided_at is not null or d.voided_at is null)
         and not exists (select 1 from app.accounts a where a.id = m.account_id and a.pocket = 'kantor')
         and case when e.kind = 'debt_principal' then
                   d.mode = 'baru' and abs(m.amount) = d.principal
                   and case d.direction when 'borrowed' then m.amount > 0 when 'lent' then m.amount < 0 end
                  else
                   case d.direction when 'borrowed' then m.amount < 0 when 'lent' then m.amount > 0 end
             end, false)
    -- 0140: perubahan nilai aset. Satu line main (naik/turun, bukan nol: CHECK entry_lines), tanpa
    -- counter/fee, dompet ber-pocket aset (tidak negatif dan jalur lain dijaga private.tg_asset_ledger).
    when e.kind = 'valuation' then
         c.entry_id is null and f.entry_id is null
         and exists (select 1 from app.accounts a where a.id = m.account_id and a.pocket = 'aset')
    else false
  end;
  if not ok then
    raise exception using errcode = 'DK500', message = 'entry_shape_invalid';
  end if;
  if e.kind = 'space_transfer' then
    perform private.assert_space_transfer_pair(e.link_id);
  end if;
end $$;

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

revoke all on app.trips from dompetku_web, dompetku_api, dompetku_auditor;
drop index app.entries_trip;
alter table app.entries drop constraint entries_trip_check;
alter table app.entries drop constraint entries_trip_fk;
alter table app.entries drop column trip_id;
drop policy member_write on app.trips;
drop policy member_read on app.trips;
drop trigger trip_guard on app.trips;
drop function private.tg_trip_guard();
drop table app.trips;

select private.own_api_functions();
