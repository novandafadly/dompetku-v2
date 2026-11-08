-- migrate:up
-- S9 (IPD §5, plan S9 Task 6, K1, K5, K13): API anggaran (BSD §8 budget_progress, §9 set_budget,
-- delete_budget) + salin anggaran periode lalu + ringkasan Rencana, dan cek DQ13 satu kewajiban.
-- Expand-only: fungsi baru, private.dq_run diganti utuh (create or replace, keluaran sama), dan
-- EXECUTE baru untuk dompetku_auditor.
--
-- - budgets.month = LABEL periode gajian (K1, BSD §8.2a): realisasi dihitung atas rentang
--   app.period_of_label(ruang, month) (label November = 23 Okt..24 Nov bila gajian 25; aturan kosong
--   = bulan kalender), hanya kelas expense (expense_fee, x_talangan, x_kantor, entri batal tidak
--   ikut, BSD §2.2 #1, #2), per root_category_id (sub menambah induk). Anggaran hanya kategori induk
--   (K5: subkategori ditunda S10).
-- - Fungsi tulis (DEFINER milik dompetku_api, NOBYPASSRLS, tunduk member_write): app.assert_member
--   SEBELUM baca kategori, kunci, atau INSERT/UPDATE/DELETE. Trigger BEFORE (tg_obligation_xor)
--   berjalan sebelum RLS WITH CHECK, jadi tanpa itu DML ke ruang orang lain bisa menjawab
--   obligation_double (oracle keberadaan kewajiban pasangan) alih-alih DK404 (review Task 4).
--   updated_at = app.now() diisi fungsi (tanpa trigger).
--   * api.set_budget (BSD §9, upsert, idempoten alami): kategori dicari di ruang yang sama dengan
--     tipe expense (selain itu DK404 category_not_found: kategori pemasukan, ruang lain, tidak ada),
--     dikunci FOR SHARE (menunggu update_category/archive_category yang belum commit lalu membaca
--     versi barunya; tidak pernah FOR UPDATE), terarsip = DK422 category_archived, bukan induk
--     (subkategori, atau induk yang sudah dipindah jadi anak) = DK422 category_not_root (kode baru;
--     tanpa cek ini FK is_root menjawab 23503). Satu kewajiban dijaga trigger (obligation_double).
--   * api.delete_budget (BSD §9): tanpa baris = no-op. Tidak memvalidasi kategori (anggaran pada
--     kategori yang kemudian diarsipkan tetap bisa dihapus).
--   * api.copy_budgets (K13, di luar BSD): salin anggaran label asal ke label tujuan, urut
--     category_id (urutan kunci kategori sama dengan update_category, yang mengunci {kategori,
--     induk} urut id: tanpa siklus tunggu). Per baris: sudah ada di tujuan = skipped_existing (tidak
--     ditimpa), kategori terarsip = skipped_archived, wajib yang bentrok dengan tagihan aktif di
--     label tujuan = skipped_conflict (sub-transaksi per baris wajib; baris lain tetap disalin).
--     Kategori yang punya anggaran tidak bisa dipindah induk (tg_category_depth), jadi baris asal
--     selalu induk. Dijalankan ulang = copied 0 (idempoten alami). Bulan bukan tanggal 1 = DK400
--     from_month/to_month; asal = tujuan = DK400 to_month.
-- - Baca (INVOKER milik owner, EXECUTE web, assert_member di awal, RLS pemanggil):
--   * api.budget_progress (BSD §8 + kolom remaining = amount - spent, negatif bila lewat; pct
--     dibulatkan ke bawah, dibatasi ke batas int). Anggaran wajib: realisasi tanpa entri bayar tagihan
--     yang kemunculannya jatuh tempo di luar periode (review Task 7; tidak wajib = realisasi penuh).
--   * api.budget_overview (layar Rencana): semua kategori induk pengeluaran aktif + kategori induk
--     terarsip yang punya anggaran di label itu (supaya jumlah Rencana = budget_progress = aman
--     dipakai), dengan realisasinya; tanpa anggaran = budget, pct, remaining NULL dan wajib false.
--     Kolom archived ditambahkan atas Interfaces plan (UI menandai dan hanya menawarkan Hapus).
-- - DQ13 (error) satu kewajiban: pasangan (tagihan aktif, anggaran wajib) pada kategori induk yang
--   sama dengan kemunculan tagihan di periode berlabel bulan anggaran. Kueri sama dengan
--   pg_temp.xor_violations (tests/99_konkurensi.sql). XOR hanya dinilai saat tulis; mengubah
--   households.payday_rule atau menambah app.holidays bisa menggeser label kemunculan tanpa
--   penolakan, jadi cek ini menangkapnya pada dq_reconcile berikutnya (01:00 WIB). dq_run milik
--   dompetku_auditor (BYPASSRLS), sehingga butuh EXECUTE pada fungsi periode yang dipakainya.

-- ===== Anggaran: atur (BSD §9; upsert, idempoten alami) =====
create function api.set_budget(
  p_space_id uuid, p_category_id uuid, p_month date, p_amount bigint, p_wajib boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_c   app.categories%rowtype;
begin
  perform app.assert_member(p_space_id);
  perform private.check_amount(p_amount, 'amount');
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'month';
  end if;
  select * into v_c from app.categories c
   where c.id = p_category_id and c.space_id = p_space_id and c.type = 'expense'
   for share;
  if v_c.id is null then
    raise exception using errcode = 'DK404', message = 'category_not_found', detail = 'category_id';
  end if;
  if v_c.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'category_archived';
  end if;
  if v_c.parent_id is not null then
    raise exception using errcode = 'DK422', message = 'category_not_root';
  end if;
  insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by, updated_at)
  values (p_space_id, p_category_id, p_month, p_amount, coalesce(p_wajib, false), v_uid, app.now())
  on conflict (space_id, category_id, month) do update
     set amount = excluded.amount, wajib = excluded.wajib,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;

-- ===== Anggaran: hapus (BSD §9; tanpa baris = no-op) =====
create function api.delete_budget(p_space_id uuid, p_category_id uuid, p_month date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_user();
  perform app.assert_member(p_space_id);
  delete from app.budgets
   where space_id = p_space_id and category_id = p_category_id and month = p_month;
end $$;

-- ===== Anggaran: salin label asal ke label tujuan (K13; idempoten alami) =====
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
    select * from app.budgets b
    where b.space_id = p_space_id and b.month = p_from_month
    order by b.category_id
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
      if sqlerrm <> 'obligation_double' then
        raise;
      end if;
      v_conflict := v_conflict + 1;
    end;
  end loop;
  return query select v_copied, v_exist, v_conflict, v_arch;
end $$;

-- ===== Realisasi anggaran per label periode gajian (BSD §8 + remaining, K1) =====
create function api.budget_progress(p_space_id uuid, p_month date)
returns table (category_id uuid, amount bigint, wajib boolean, spent bigint, pct int, remaining bigint)
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
  select b.category_id, b.amount, b.wajib, x.amt,
         least(floor(x.amt * 100.0 / b.amount), 2147483647)::int,
         (b.amount - x.amt)::bigint
  from app.budgets b
  left join spent s on s.root_category_id = b.category_id
  cross join lateral (select coalesce(case when b.wajib then s.amt_wajib else s.amt end, 0)::bigint as amt) x
  where b.space_id = p_space_id and b.month = p_month
  order by b.category_id;
end $$;

-- ===== Ringkasan Rencana: kategori induk pengeluaran + anggaran + realisasi =====
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

-- ===== Cek kualitas data: 0112 + DQ13 satu kewajiban (milik dompetku_auditor) =====
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

-- ===== Hak =====
-- dq_run (DQ13) berjalan sebagai dompetku_auditor: fungsi periode yang dipanggilnya (INVOKER).
grant execute on function private.bill_due_in_label(uuid, smallint, date, date, date),
  private.bill_first_on(date, timestamptz), app.period_of_label(uuid, date),
  app.effective_payday(smallint, date), app.pay_period(uuid, date) to dompetku_auditor;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'
-- (nilai bawaan dari 0001); CI/lokal mengubah env dulu sebelum rollback.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
revoke execute on function private.bill_due_in_label(uuid, smallint, date, date, date),
  private.bill_first_on(date, timestamptz), app.period_of_label(uuid, date),
  app.effective_payday(smallint, date), app.pay_period(uuid, date) from dompetku_auditor;
drop function api.budget_overview(uuid, date);
drop function api.budget_progress(uuid, date);
drop function api.copy_budgets(uuid, date, date);
drop function api.delete_budget(uuid, uuid, date);
drop function api.set_budget(uuid, uuid, date, bigint, boolean);

-- private.dq_run kembali ke definisi 0112 (pemilik tetap dompetku_auditor).
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
$$;
