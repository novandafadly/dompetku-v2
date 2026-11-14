-- migrate:up
-- S12 (plan S12 Task 4, K2, K9; bingkai S12-TR1 sampai TR4): modal trading. Expand-only, tanpa
-- entry_kind dan tanpa kolom tersimpan: setor modal = transfer satu ruang dari dompet non-trading ke
-- dompet ber-pocket `trading`, tarik modal = sebaliknya (kind transfer, kelas laporan x_transfer: Σ
-- pemasukan/pengeluaran, Laporan, anggaran tidak berubah, I6). Biaya transfer tetap pengeluaran.
--
-- - app.accounts CHECK accounts_trading_personal: `trading` hanya di ruang Pribadi (B10, pola kantor
--   0100). Pocket `patungan` dijaga di 0135 (S12-ADR1).
-- - api.create_account (0103, diganti utuh, tanda tangan sama): `trading` di Bersama = DK422
--   pocket_personal_only (sebelum CHECK, supaya UI dapat kode mesin); `patungan` = DK400
--   invalid_argument/pocket (dompet sistem dibuat fungsi patungan 0136, bukan pilihan pengguna).
-- - app.trading_capital (security_invoker): per dompet trading (termasuk terarsip) capital_in = Σ
--   transfer hidup masuk dari dompet non-trading, capital_out = Σ transfer hidup keluar ke dompet
--   non-trading (nominal transfer, tanpa biaya), capital_left = max(0, in − out), realized =
--   max(0, out − in). Transfer antar dua dompet trading tidak dihitung (keputusan pemilik
--   2026-11-14, butir 4); transfer antar ruang (space_transfer), pemasukan/pengeluaran, dan Cocokkan
--   saldo di dompet trading juga tidak (untung/rugi = saldo, bukan modal). Void/restore transfer
--   menggeser modal tepat sekali karena view membaca voided_at.
-- - api.trading_overview(ruang) (INVOKER milik owner, STABLE): satu baris per dompet trading aktif
--   (account_id, name, balance, capital_in, capital_out, capital_left, realized, shortfall =
--   max(0, capital_left − balance), has_deposit = capital_in > 0) urut sort_order, lalu satu baris
--   total (account_id dan name NULL, selalu ada) dengan Σ kolom dan shortfall = max(0, Σ capital_left
--   − Σ balance). Dompet terarsip tidak ikut (saldo 0; modal yang hilang tidak menjadi `Kurang`
--   selamanya). assert_member lebih dulu (pasangan/Luar DK404, tanpa konteks DK401), ruang Bersama
--   DK422 pocket_personal_only.
-- - api.net_worth (0102, tidak dipakai web, kolom sama): total = operasional + tabungan + trading
--   (keputusan pemilik 2026-11-14 butir 3: saldo trading ikut kekayaan bersih). Kas Kantor tetap
--   di luar; patungan (0135) tidak pernah ikut.
-- - api.wa_default_account (0123): bawaan hanya operasional/tabungan (bukan kantor, trading, atau
--   dompet sistem patungan). `@nama` eksplisit tetap boleh menunjuk dompet trading (server WA).
-- - private.dq_run: DQ15 (error) modal trading konsisten dengan Σ transfer. Sisanya sama dengan 0131.
-- "Aman dipakai" (0120) dan saldo Beranda tetap hanya pocket operasional: tidak diubah.
alter table app.accounts
  add constraint accounts_trading_personal check (pocket <> 'trading' or space_kind = 'personal');

-- ===== Dompet (0103 + B10 trading, patungan bukan pilihan pengguna) =====
create or replace function api.create_account(
  p_client_id       uuid,
  p_space_id        uuid,
  p_name            text,
  p_pocket          app.pocket,
  p_wallet_type     app.wallet_type,
  p_opened_on       date   default null,
  p_opening_balance bigint default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_on    date;
  v_name  text := nullif(btrim(p_name), '');
  v_kind  app.space_kind;
  v_acc   uuid;
  v_entry uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'create_account', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'name', v_name, 'pocket', p_pocket, 'type', p_wallet_type,
           'on', p_opened_on, 'opening', p_opening_balance)));
  if v_r is not null then
    return v_r;
  end if;
  perform app.assert_member(p_space_id);
  if v_name is null or length(v_name) > 60 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'name';
  end if;
  -- Dompet sistem patungan (S12-ADR1) dibuat fungsi patungan, bukan pilihan pengguna.
  if p_pocket is null or p_pocket = 'patungan' or p_wallet_type is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'pocket';
  end if;
  if p_opening_balance is null or p_opening_balance < 0 or p_opening_balance > 10000000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'opening_balance';
  end if;
  v_on := private.check_date(p_opened_on);
  select s.kind into v_kind from app.spaces s where s.id = p_space_id;
  if p_pocket = 'kantor' and v_kind <> 'personal' then
    raise exception using errcode = 'DK422', message = 'kantor_personal_only';
  end if;
  if p_pocket = 'trading' and v_kind is distinct from 'personal' then
    raise exception using errcode = 'DK422', message = 'pocket_personal_only';
  end if;

  insert into app.accounts (space_id, space_kind, name, pocket, wallet_type, opened_on, created_by)
  values (p_space_id, v_kind, v_name, p_pocket, p_wallet_type, v_on, v_uid)
  returning id into v_acc;

  if p_opening_balance > 0 then
    insert into app.entries (space_id, space_kind, kind, occurred_on, created_by, updated_by)
    values (p_space_id, v_kind, 'opening_balance', v_on, v_uid, v_uid)
    returning id into v_entry;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    values (v_entry, p_space_id, 'main', v_acc, p_opening_balance);
    perform private.write_history(v_entry, 'create', v_uid);
  end if;

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'account_id', v_acc, 'entry_id', v_entry, 'version', 1, 'warnings', '[]'::jsonb));
end $$;

-- ===== Modal trading (tanpa kolom tersimpan) =====
create view app.trading_capital with (security_invoker = true) as
with moves as (
  select e.space_id, m.account_id as from_acc, ma.pocket as from_pocket,
         c.account_id as to_acc, ca.pocket as to_pocket, c.amount
    from app.entries e
    join app.entry_lines m on m.space_id = e.space_id and m.entry_id = e.id and m.role = 'main'
    join app.entry_lines c on c.space_id = e.space_id and c.entry_id = e.id and c.role = 'counter'
    join app.accounts ma on ma.id = m.account_id
    join app.accounts ca on ca.id = c.account_id
   where e.kind = 'transfer' and e.voided_at is null
), t as (
  select a.space_id, a.id as account_id,
         coalesce(sum(mv.amount) filter (where mv.to_acc = a.id), 0)::bigint   as capital_in,
         coalesce(sum(mv.amount) filter (where mv.from_acc = a.id), 0)::bigint as capital_out
    from app.accounts a
    left join moves mv
      on mv.space_id = a.space_id
     and ((mv.to_acc = a.id and mv.from_pocket <> 'trading')
          or (mv.from_acc = a.id and mv.to_pocket <> 'trading'))
   where a.pocket = 'trading'
   group by a.space_id, a.id
)
select space_id, account_id, capital_in, capital_out,
       greatest(capital_in - capital_out, 0)::bigint as capital_left,
       greatest(capital_out - capital_in, 0)::bigint as realized
  from t;

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

-- Net worth ruang = operasional + tabungan + trading; Kas Kantor dikecualikan (m0a-keputusan T11),
-- trading ikut (keputusan pemilik S12). Kolom hasil sama dengan 0102 (fungsi tidak dipakai web).
create or replace function api.net_worth(p_space_id uuid)
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

-- Dompet bawaan WA (0123): hanya kantong operasional/tabungan di kedua cabang. Kantor, trading, dan
-- dompet sistem patungan tidak pernah jadi bawaan; `@nama` eksplisit diputuskan server WA.
create or replace function api.wa_default_account(p_space_id uuid) returns uuid
language sql stable set search_path = '' as $$
  select coalesce(
    (select l.account_id
       from app.entries e
       join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
       join app.accounts a on a.id = l.account_id and a.archived_at is null
                          and a.pocket in ('operasional', 'tabungan')
      where e.space_id = p_space_id
        and e.created_by = app.current_user_id()
        and e.voided_at is null
        and e.kind in ('income', 'expense')
      order by e.created_at desc, e.id desc
      limit 1),
    (select a.id from app.accounts a
      where a.space_id = p_space_id and a.archived_at is null
        and a.pocket in ('operasional', 'tabungan')
      order by (a.pocket <> 'operasional'), a.sort_order, a.created_at, a.id
      limit 1))
$$;

-- ===== Cek kualitas data: DQ15 modal trading (selebihnya = 0131) =====
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
  -- DQ03 bentuk line per kind, entri hidup (aturan private.assert_entry_shape, 0101; utang 0130)
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
  -- counter), capital_left/realized tidak negatif dan capital_left - realized = setor - tarik; dompet
  -- trading wajib di Pribadi (B10, CHECK) dan wajib ada di view.
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
    where a.pocket = 'trading'
      and (a.space_kind <> 'personal' or tc.account_id is null
           or tc.capital_in <> s.cin or tc.capital_out <> s.cout
           or tc.capital_left < 0 or tc.realized < 0
           or tc.capital_left - tc.realized <> s.cin - s.cout)
  ) x
$$;

-- ===== Hak =====
-- View baru eksplisit (pola debt_balances 0130); auditor untuk DQ15 di private.dq_run.
grant select on app.trading_capital to dompetku_web, dompetku_api, dompetku_auditor;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
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
  -- DQ03 bentuk line per kind, entri hidup (aturan private.assert_entry_shape, 0101; utang 0130)
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
$$;

create or replace function api.wa_default_account(p_space_id uuid) returns uuid
language sql stable set search_path = '' as $$
  select coalesce(
    (select l.account_id
       from app.entries e
       join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
       join app.accounts a on a.id = l.account_id and a.archived_at is null and a.pocket <> 'kantor'
      where e.space_id = p_space_id
        and e.created_by = app.current_user_id()
        and e.voided_at is null
        and e.kind in ('income', 'expense')
      order by e.created_at desc, e.id desc
      limit 1),
    (select a.id from app.accounts a
      where a.space_id = p_space_id and a.archived_at is null and a.pocket <> 'kantor'
      order by (a.pocket <> 'operasional'), a.sort_order, a.created_at, a.id
      limit 1))
$$;

create or replace function api.net_worth(p_space_id uuid)
returns table (operasional bigint, tabungan bigint, kantor_excluded bigint, total bigint)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  with s as (
    select coalesce(sum(ab.balance) filter (where ab.pocket = 'operasional'), 0)::bigint as o,
           coalesce(sum(ab.balance) filter (where ab.pocket = 'tabungan'), 0)::bigint as t,
           coalesce(sum(ab.balance) filter (where ab.pocket = 'kantor'), 0)::bigint as k
    from app.account_balances ab
    where ab.space_id = p_space_id
  )
  select o, t, k, o + t from s;
end $$;

create or replace function api.create_account(
  p_client_id       uuid,
  p_space_id        uuid,
  p_name            text,
  p_pocket          app.pocket,
  p_wallet_type     app.wallet_type,
  p_opened_on       date   default null,
  p_opening_balance bigint default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_on    date;
  v_name  text := nullif(btrim(p_name), '');
  v_kind  app.space_kind;
  v_acc   uuid;
  v_entry uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'create_account', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'name', v_name, 'pocket', p_pocket, 'type', p_wallet_type,
           'on', p_opened_on, 'opening', p_opening_balance)));
  if v_r is not null then
    return v_r;
  end if;
  perform app.assert_member(p_space_id);
  if v_name is null or length(v_name) > 60 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'name';
  end if;
  if p_pocket is null or p_wallet_type is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'pocket';
  end if;
  if p_opening_balance is null or p_opening_balance < 0 or p_opening_balance > 10000000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'opening_balance';
  end if;
  v_on := private.check_date(p_opened_on);
  select s.kind into v_kind from app.spaces s where s.id = p_space_id;
  if p_pocket = 'kantor' and v_kind <> 'personal' then
    raise exception using errcode = 'DK422', message = 'kantor_personal_only';
  end if;

  insert into app.accounts (space_id, space_kind, name, pocket, wallet_type, opened_on, created_by)
  values (p_space_id, v_kind, v_name, p_pocket, p_wallet_type, v_on, v_uid)
  returning id into v_acc;

  if p_opening_balance > 0 then
    insert into app.entries (space_id, space_kind, kind, occurred_on, created_by, updated_by)
    values (p_space_id, v_kind, 'opening_balance', v_on, v_uid, v_uid)
    returning id into v_entry;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    values (v_entry, p_space_id, 'main', v_acc, p_opening_balance);
    perform private.write_history(v_entry, 'create', v_uid);
  end if;

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'account_id', v_acc, 'entry_id', v_entry, 'version', 1, 'warnings', '[]'::jsonb));
end $$;

drop function api.trading_overview(uuid);
drop view app.trading_capital;
alter table app.accounts drop constraint accounts_trading_personal;

select private.own_api_functions();
