-- migrate:up
-- S10 (IPD §5, plan S10 Task 3; BSD §15 butir 1): baca anggaran rincian, salin dengan penyesuaian,
-- cek DQ14. Tanda tangan berubah (tipe hasil bertambah kolom), jadi fungsi di-drop lalu dibuat
-- ulang; pemanggil lama yang membaca kolom bernama tidak terpengaruh.
--
-- - api.budget_overview: + parent_id, sub_allocated (induk: Σ anggaran rinciannya di label itu),
--   max_amount (rincian: anggaran induk dikurangi anggaran rincian saudaranya; UI tidak menghitung
--   uang). Baris rincian = anak kategori induk yang beranggaran di label itu, bila beranggaran
--   atau aktif (kandidat "Tambah rincian"); realisasi rincian = kategori itu sendiri, realisasi
--   induk tetap induk + semua rincian. Urutan: induk lalu rinciannya.
-- - api.copy_budgets(ruang, dari, ke, p_adjust_pct default 0): penyesuaian persen -90..100 (DK400
--   adjust_pct di luar itu), dibulatkan ke Rp1.000 hanya bila persen <> 0 (induk ke atas, rincian ke
--   bawah, minimal Rp1.000); kolom hasil baru skipped_parent (rincian yang induknya tidak ada di
--   tujuan); rincian yang melewati induk tujuan = skipped_conflict.
-- - private.dq_run: + DQ14 (error) pohon anggaran.

drop function api.budget_overview(uuid, date);
drop function api.copy_budgets(uuid, date, date);

create function api.budget_overview(p_space_id uuid, p_month date)
returns table (category_id uuid, name text, icon text, budget bigint, wajib boolean, spent bigint,
               pct int, remaining bigint, archived boolean, parent_id uuid, sub_allocated bigint,
               max_amount bigint)
language plpgsql stable set search_path = '' as $$
declare
  v_from date;
  v_to   date;
begin
  perform app.assert_member(p_space_id);
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'month';
  end if;
  select l.starts_on, l.ends_on into v_from, v_to from app.period_of_label(p_space_id, p_month) l;
  return query
  -- byroot (induk): realisasi penuh = induk + semua rincian (amt) dan, untuk anggaran wajib, tanpa
  -- entri bayar tagihan yang kemunculannya di luar periode (amt_wajib; lihat 0119). bycat (rincian):
  -- realisasi kategori itu sendiri.
  with byroot as (
    select r.root_category_id, (-sum(r.amount))::bigint as amt,
           (-coalesce(sum(r.amount) filter (where not exists (
              select 1 from app.bill_occurrences o
              where o.space_id = r.space_id and o.entry_id = r.entry_id
                and o.due_on not between v_from and v_to)), 0))::bigint as amt_wajib
    from app.report_lines r
    where r.space_id = p_space_id and r.report_class = 'expense'
      and r.occurred_on between v_from and v_to
    group by r.root_category_id
  ), bycat as (
    select r.category_id as cid, (-sum(r.amount))::bigint as amt
    from app.report_lines r
    where r.space_id = p_space_id and r.report_class = 'expense'
      and r.occurred_on between v_from and v_to
    group by r.category_id
  )
  select c.id, c.name, c.icon, b.amount, coalesce(b.wajib, false), x.amt,
         case when b.amount is not null
              then least(floor(x.amt * 100.0 / b.amount), 2147483647)::int end,
         (b.amount - x.amt)::bigint,
         c.archived_at is not null,
         c.parent_id,
         -- induk: jumlah anggaran rinciannya; rincian: batas atas yang masih boleh diisi
         -- (anggaran induk dikurangi anggaran rincian saudaranya), keduanya dari SQL (BSD §1.1).
         case when c.parent_id is null then (
           select coalesce(sum(sb.amount), 0)::bigint from app.budgets sb
           join app.categories sc on sc.id = sb.category_id
           where sb.space_id = c.space_id and sb.month = p_month and sc.parent_id = c.id) end,
         case when c.parent_id is not null then (pb.amount - (
           select coalesce(sum(sb.amount), 0) from app.budgets sb
           join app.categories sc on sc.id = sb.category_id
           where sb.space_id = c.space_id and sb.month = p_month and sc.parent_id = c.parent_id
             and sb.category_id <> c.id))::bigint end
  from app.categories c
  join app.categories rc on rc.space_id = c.space_id and rc.id = coalesce(c.parent_id, c.id)
  left join app.budgets b on b.space_id = c.space_id and b.category_id = c.id and b.month = p_month
  left join app.budgets pb on pb.space_id = c.space_id and pb.category_id = c.parent_id and pb.month = p_month
  left join byroot s on s.root_category_id = c.id
  left join bycat sc2 on sc2.cid = c.id
  cross join lateral (select coalesce(case when c.parent_id is not null then sc2.amt
                                           when b.wajib then s.amt_wajib else s.amt end, 0)::bigint as amt) x
  where c.space_id = p_space_id and c.type = 'expense'
    and ((c.parent_id is null and (c.archived_at is null or b.category_id is not null))
      or (c.parent_id is not null and pb.category_id is not null
          and (b.category_id is not null or c.archived_at is null)))
  order by rc.archived_at is not null, rc.sort_order, rc.name, rc.id,
           c.parent_id is not null, c.sort_order, c.name, c.id;
end $$;

create function api.copy_budgets(p_space_id uuid, p_from_month date, p_to_month date,
                                 p_adjust_pct int default 0)
returns table (copied int, skipped_existing int, skipped_conflict int, skipped_archived int,
               skipped_parent int)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := private.require_user();
  v_r        record;
  v_amt      bigint;
  v_archived boolean;
  v_copied   int := 0;
  v_exist    int := 0;
  v_conflict int := 0;
  v_arch     int := 0;
  v_parent   int := 0;
begin
  perform app.assert_member(p_space_id);
  if p_from_month is null or extract(day from p_from_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'from_month';
  end if;
  if p_to_month is null or extract(day from p_to_month) <> 1 or p_to_month = p_from_month then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'to_month';
  end if;
  if p_adjust_pct is null or p_adjust_pct not between -90 and 100 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'adjust_pct';
  end if;
  -- Induk dulu (aturan pohon: rincian butuh anggaran induk di tujuan), lalu rincian; di tiap
  -- kelompok urut category_id (urutan kunci kategori sama dengan update_category).
  for v_r in
    select b.category_id, b.amount, b.wajib, (c.parent_id is not null) as is_sub
    from app.budgets b
    join app.categories c on c.id = b.category_id
    where b.space_id = p_space_id and b.month = p_from_month
    order by (c.parent_id is not null), b.category_id
  loop
    if exists (select 1 from app.budgets t
               where t.space_id = p_space_id and t.category_id = v_r.category_id
                 and t.month = p_to_month) then
      v_exist := v_exist + 1;
      continue;
    end if;
    select c.archived_at is not null into v_archived
      from app.categories c where c.id = v_r.category_id and c.space_id = p_space_id
      for share;
    if v_archived then
      v_arch := v_arch + 1;
      continue;
    end if;
    -- Penyesuaian persen: 0 = nominal persis. Selain itu dibulatkan ke Rp1.000 (minimal Rp1.000,
    -- maksimal batas tabel): induk ke atas, rincian ke bawah, sehingga jumlah rincian tidak
    -- melewati induk akibat pembulatan.
    v_amt := case
      when p_adjust_pct = 0 then v_r.amount
      when v_r.is_sub then greatest(1000, least(10000000000000,
             floor(v_r.amount::numeric * (100 + p_adjust_pct) / 100000)::bigint * 1000))
      else greatest(1000, least(10000000000000,
             ceil(v_r.amount::numeric * (100 + p_adjust_pct) / 100000)::bigint * 1000))
    end;
    begin
      insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by, updated_at)
      values (p_space_id, v_r.category_id, p_to_month, v_amt, v_r.wajib, v_uid, app.now())
      on conflict (space_id, category_id, month) do nothing;
      if found then
        v_copied := v_copied + 1;
      else
        -- Disisipkan transaksi paralel sesudah cek di atas: sama dengan sudah ada.
        v_exist := v_exist + 1;
      end if;
    exception when sqlstate 'DK422' then
      if sqlerrm in ('obligation_double', 'sub_exceeds_parent') then
        v_conflict := v_conflict + 1;
      elsif sqlerrm = 'parent_budget_required' then
        v_parent := v_parent + 1;
      else
        raise;
      end if;
    end;
  end loop;
  return query select v_copied, v_exist, v_conflict, v_arch, v_parent;
end $$;

-- ===== Cek kualitas data: DQ14 pohon anggaran =====
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
  -- DQ03 bentuk line per kind, entri hidup (aturan private.assert_entry_shape, 0101)
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
          else false
        end, false)
  ) x
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

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
drop function api.copy_budgets(uuid, date, date, int);
drop function api.budget_overview(uuid, date);
create function api.budget_overview(p_space_id uuid, p_month date)
returns table (category_id uuid, name text, icon text, budget bigint, wajib boolean, spent bigint,
               pct int, remaining bigint, archived boolean)
language plpgsql stable set search_path = '' as $$
declare
  v_from date;
  v_to   date;
begin
  perform app.assert_member(p_space_id);
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'month';
  end if;
  select l.starts_on, l.ends_on into v_from, v_to from app.period_of_label(p_space_id, p_month) l;
  return query
  -- amt = realisasi penuh; amt_wajib (untuk anggaran wajib) tanpa entri bayar tagihan yang
  -- kemunculannya jatuh tempo di luar periode ini (review Task 7: bayar tagihan lewat periode lalu
  -- atau bayar di muka tidak boleh memakan cadangan wajib periode ini dan menaikkan aman dipakai).
  with spent as (
    select r.root_category_id, (-sum(r.amount))::bigint as amt,
           (-coalesce(sum(r.amount) filter (where not exists (
              select 1 from app.bill_occurrences o
              where o.space_id = r.space_id and o.entry_id = r.entry_id
                and o.due_on not between v_from and v_to)), 0))::bigint as amt_wajib
    from app.report_lines r
    where r.space_id = p_space_id and r.report_class = 'expense'
      and r.occurred_on between v_from and v_to
    group by r.root_category_id
  )
  select c.id, c.name, c.icon, b.amount, coalesce(b.wajib, false), x.amt,
         case when b.amount is not null
              then least(floor(x.amt * 100.0 / b.amount), 2147483647)::int end,
         (b.amount - x.amt)::bigint,
         c.archived_at is not null
  from app.categories c
  left join app.budgets b on b.space_id = c.space_id and b.category_id = c.id and b.month = p_month
  left join spent s on s.root_category_id = c.id
  cross join lateral (select coalesce(case when b.wajib then s.amt_wajib else s.amt end, 0)::bigint as amt) x
  where c.space_id = p_space_id and c.type = 'expense' and c.parent_id is null
    and (c.archived_at is null or b.category_id is not null)
  order by c.archived_at is not null, c.sort_order, c.name, c.id;
end $$;

create function api.copy_budgets(p_space_id uuid, p_from_month date, p_to_month date)
returns table (copied int, skipped_existing int, skipped_conflict int, skipped_archived int)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := private.require_user();
  v_b        app.budgets%rowtype;
  v_archived boolean;
  v_copied   int := 0;
  v_exist    int := 0;
  v_conflict int := 0;
  v_arch     int := 0;
begin
  perform app.assert_member(p_space_id);
  if p_from_month is null or extract(day from p_from_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'from_month';
  end if;
  if p_to_month is null or extract(day from p_to_month) <> 1 or p_to_month = p_from_month then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'to_month';
  end if;
  for v_b in
    select b.* from app.budgets b
    join app.categories c on c.id = b.category_id
    where b.space_id = p_space_id and b.month = p_from_month
    order by (c.parent_id is not null), b.category_id
  loop
    if exists (select 1 from app.budgets t
               where t.space_id = p_space_id and t.category_id = v_b.category_id
                 and t.month = p_to_month) then
      v_exist := v_exist + 1;
      continue;
    end if;
    select c.archived_at is not null into v_archived
      from app.categories c where c.id = v_b.category_id and c.space_id = p_space_id
      for share;
    if v_archived then
      v_arch := v_arch + 1;
      continue;
    end if;
    begin
      insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by, updated_at)
      values (p_space_id, v_b.category_id, p_to_month, v_b.amount, v_b.wajib, v_uid, app.now())
      on conflict (space_id, category_id, month) do nothing;
      if found then
        v_copied := v_copied + 1;
      else
        -- Disisipkan transaksi paralel sesudah cek di atas: sama dengan sudah ada.
        v_exist := v_exist + 1;
      end if;
    exception when sqlstate 'DK422' then
      if sqlerrm not in ('obligation_double', 'parent_budget_required', 'sub_exceeds_parent') then
        raise;
      end if;
      v_conflict := v_conflict + 1;
    end;
  end loop;
  return query select v_copied, v_exist, v_conflict, v_arch;
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
  -- DQ03 bentuk line per kind, entri hidup (aturan private.assert_entry_shape, 0101)
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
          else false
        end, false)
  ) x
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
$$;
select private.own_api_functions();
