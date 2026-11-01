-- migrate:up
-- BSD §8, bagian S5: view saldo, klasifikasi laporan, report_lines, fungsi baca INVOKER
-- (period_summary, month_summary, safe_to_spend, net_worth, activity_feed, trash_list).
-- Disalin persis dari BSD kecuali safe_to_spend (lihat komentarnya). bill_schedule dan
-- budget_progress menyusul bersama tabel tagihan/anggaran (S9).
-- ===== Saldo =====
create view app.account_balances with (security_invoker = true) as
select a.space_id, a.id as account_id, a.pocket,
       coalesce(sum(l.amount) filter (where e.voided_at is null), 0)::bigint as balance
from app.accounts a
left join app.entry_lines l on l.account_id = a.id
left join app.entries     e on e.id = l.entry_id
group by a.space_id, a.id, a.pocket;

-- ===== Klasifikasi laporan: satu sumber aturan (spec §9.1, data-engineer §2a) =====
create function app.report_class(
  p_kind app.entry_kind, p_role app.line_role, p_pocket app.pocket,
  p_space_kind app.space_kind, p_direction app.entry_direction, p_reimbursable boolean
) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_pocket = 'kantor'                                         then 'x_kantor'
    when p_role = 'fee' and p_kind in ('transfer', 'space_transfer') then 'expense_fee'
    when p_kind = 'income'                                           then 'income'
    when p_kind = 'expense' and p_reimbursable                       then 'x_talangan'
    when p_kind = 'expense'                                          then 'expense'
    when p_kind = 'space_transfer' then
      case when p_space_kind = 'personal'
           then case p_direction when 'out' then 'x_setor_bersama'   else 'x_ambil_bersama'   end
           else case p_direction when 'in'  then 'x_setoran_anggota' else 'x_diambil_anggota' end
      end
    when p_kind = 'transfer'                                         then 'x_transfer'
    when p_kind = 'reimbursement'                                    then 'x_reimburse'
    when p_kind in ('opening_balance', 'adjustment')                 then 'x_koreksi'
  end
$$;

create view app.report_lines with (security_invoker = true, security_barrier = true) as
select l.space_id, e.space_kind, l.entry_id, l.role, e.kind as entry_kind, e.direction,
       e.occurred_on, l.account_id, a.pocket, l.amount, e.category_id,
       coalesce(c.parent_id, c.id) as root_category_id, e.created_by,
       app.report_class(e.kind, l.role, a.pocket, e.space_kind, e.direction, e.reimbursable)
         as report_class
from app.entry_lines l
join app.entries  e on e.space_id = l.space_id and e.id = l.entry_id
join app.accounts a on a.space_id = l.space_id and a.id = l.account_id
left join app.categories c on c.space_id = e.space_id and c.id = e.category_id
where e.voided_at is null;

-- ===== Fungsi baca (SECURITY INVOKER: RLS tetap berlaku) =====
create function api.period_summary(p_space_id uuid, p_from date, p_to date)
returns table (report_class text, inflow bigint, outflow bigint, entry_count int)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3660 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'period';
  end if;
  return query
  select r.report_class,
         coalesce(sum(r.amount) filter (where r.amount > 0), 0)::bigint,
         coalesce(-sum(r.amount) filter (where r.amount < 0), 0)::bigint,
         count(distinct r.entry_id)::int
  from app.report_lines r
  where r.space_id = p_space_id and r.occurred_on between p_from and p_to
  group by r.report_class
  order by r.report_class;
end $$;

-- Bentuk MonthSummary di demo-data (kantor dipecah, §2.2 butir 3). p_month = hari pertama bulan.
-- kantor_masuk  = Σ pemasukan di dompet kantor.
-- kantor_keluar = Σ pengeluaran + fee transfer di dompet kantor (keputusan pemilik #7).
-- transfer      = Σ |main| per entri transfer/space_transfer, tanpa melihat jenis dompet.
-- Saldo awal, koreksi, dan transfer dari/ke kantor tidak masuk kantor_masuk/keluar.
create function api.month_summary(p_space_id uuid, p_month date)
returns table (pemasukan bigint, pengeluaran bigint, selisih bigint,
               kantor_masuk bigint, kantor_keluar bigint, transfer bigint)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'month';
  end if;
  return query
  with t as (
    select
      coalesce(sum(r.amount) filter (where r.report_class = 'income'), 0)::bigint as inc,
      coalesce(-sum(r.amount) filter (where r.report_class in ('expense', 'expense_fee')), 0)::bigint
        as exp,
      coalesce(sum(r.amount) filter (where r.report_class = 'x_kantor'
                                    and r.entry_kind = 'income'), 0)::bigint as kan_in,
      coalesce(-sum(r.amount) filter (where r.report_class = 'x_kantor'
                                     and (r.entry_kind = 'expense' or r.role = 'fee')), 0)::bigint
        as kan_out,
      coalesce(sum(abs(r.amount)) filter (where r.entry_kind in ('transfer', 'space_transfer')
                                         and r.role = 'main'), 0)::bigint as trf
    from app.report_lines r
    where r.space_id = p_space_id
      and r.occurred_on >= p_month and r.occurred_on < (p_month + interval '1 month')::date
  )
  select inc, exp, inc - exp, kan_in, kan_out, trf from t;
end $$;


-- "Aman dipakai" sampai akhir bulan (rumus m0a-keputusan T6, selector safeToSpend).
-- Versi S5: tagihan dan anggaran wajib belum punya tabel, jadi bills_until_eom dan
-- budget_wajib_remaining selalu 0. Tanda tangan dan kolom hasil sama dengan BSD §8 agar S9
-- cukup create or replace dengan badan lengkap BSD (lalu periode gajian §8.2a).
create function api.safe_to_spend(p_space_id uuid, p_today date default null)
returns table (operasional bigint, bills_until_eom bigint, budget_wajib_remaining bigint,
               total bigint, per_day bigint, days_left int, until date)
language plpgsql stable set search_path = '' as $$
declare
  v_today date := coalesce(p_today, app.today());
  v_month date := (v_today - (extract(day from v_today)::int - 1));
  v_until date := ((v_month + interval '1 month')::date - 1);
  v_ops   bigint;
  v_bills bigint := 0;
  v_wajib bigint := 0;
  v_days  int;
begin
  perform app.assert_member(p_space_id);
  select coalesce(sum(ab.balance), 0)::bigint into v_ops
    from app.account_balances ab
    join app.accounts a on a.id = ab.account_id
   where ab.space_id = p_space_id and ab.pocket = 'operasional' and a.archived_at is null;
  v_days := v_until - v_today + 1;
  return query select v_ops, v_bills, v_wajib, v_ops - v_bills - v_wajib,
    case when v_days > 0 then floor((v_ops - v_bills - v_wajib)::numeric / v_days)::bigint
         else v_ops - v_bills - v_wajib end,
    v_days, v_until;
end $$;


-- Net worth ruang = operasional + tabungan; Kas Kantor dikecualikan (m0a-keputusan T11).
-- Dompet terarsip ikut dijumlah, tetapi saldonya selalu 0 (api.archive_account), jadi sama
-- dengan himpunan dompet di safe_to_spend.
create function api.net_worth(p_space_id uuid)
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

-- Feed Bersama dari entry_history: pelaku, op, nominal sesudah dan sebelum.
create function api.activity_feed(p_space_id uuid, p_limit int default 20)
returns table (entry_id uuid, version int, op app.history_op, kind app.entry_kind,
               direction app.entry_direction, actor_id uuid, at timestamptz,
               amount bigint, before bigint)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'limit';
  end if;
  return query
  with h as (
    select h.entry_id, h.version, h.op, (h.snapshot ->> 'kind')::app.entry_kind as kind,
           (h.snapshot ->> 'direction')::app.entry_direction as direction,
           h.changed_by, h.changed_at,
           (select abs((l ->> 'amount')::bigint)
              from jsonb_array_elements(h.snapshot -> 'lines') l
             where l ->> 'role' = 'main') as amount
    from app.entry_history h
    join app.spaces s on s.id = h.space_id and s.kind = 'shared'
    where h.space_id = p_space_id
  )
  select h.entry_id, h.version, h.op, h.kind, h.direction, h.changed_by, h.changed_at, h.amount,
         lag(h.amount) over (partition by h.entry_id order by h.version)
  from h
  where h.kind <> 'opening_balance'
  order by h.changed_at desc, h.entry_id desc, h.version desc
  limit p_limit;
end $$;

-- Sampah (keputusan pemilik #10): entri batal yang masih bisa dipulihkan (<= 90 hari).
-- Pulihkan = api.restore_entry; hapus permanen = api.purge_entry.
create function api.trash_list(p_space_id uuid, p_limit int default 50)
returns table (entry_id uuid, version int, kind app.entry_kind, direction app.entry_direction,
               occurred_on date, description text, amount bigint, voided_at timestamptz,
               voided_by uuid, purge_after timestamptz)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'limit';
  end if;
  return query
  select e.id, e.version, e.kind, e.direction, e.occurred_on, e.description,
         (select abs(l.amount) from app.entry_lines l where l.entry_id = e.id and l.role = 'main'),
         e.voided_at, e.voided_by, e.voided_at + interval '90 days'
  from app.entries e
  where e.space_id = p_space_id and e.voided_at is not null
    and e.voided_at >= app.now() - interval '90 days'
  order by e.voided_at desc, e.id desc
  limit p_limit;
end $$;

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
drop function api.trash_list(uuid, int);
drop function api.activity_feed(uuid, int);
drop function api.net_worth(uuid);
drop function api.safe_to_spend(uuid, date);
drop function api.month_summary(uuid, date);
drop function api.period_summary(uuid, date, date);
drop view app.report_lines;
drop function app.report_class(app.entry_kind, app.line_role, app.pocket, app.space_kind,
                               app.entry_direction, boolean);
drop view app.account_balances;
