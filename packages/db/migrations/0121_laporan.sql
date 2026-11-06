-- migrate:up
-- S9 (IPD §5, plan S9 Task 8, K1, K6, K10; BSD §8.1, §8.2a): fungsi baca Laporan. Expand-only: tiga
-- fungsi baca baru; api.period_summary (ringkasan per kelas, dipakai web) dan api.member_contributions
-- (Kontribusi, K10: dipanggil dengan batas periode) tidak diubah.
--
-- Semua fungsi: SECURITY INVOKER (RLS pemanggil), STABLE, search_path kosong, milik owner, EXECUTE web
-- lewat own_api_functions; assert_member di awal (Pribadi pasangan dan Luar = DK404, tanpa konteks =
-- DK401), lalu validasi argumen. Semua angka dari app.report_lines + app.report_class() (satu sumber
-- dengan Beranda: safe_to_spend, budget_progress, spend_pace); aplikasi hanya memformat. Entri batal,
-- dipindah, dan dipurge tidak dihitung (report_lines hanya entri hidup). Tanggal = occurred_on (WIB).
--
-- - api.category_summary(ruang, dari, sampai): rincian per kategori untuk kartu "Pengeluaran per
--   kategori" dan "Pemasukan per kategori". Nominal selalu positif (nilai mutlak line).
--   * kind 'category': satu baris per kategori kelas expense/income, amount = jumlah LANGSUNG kategori
--     itu. Baris induk = pengeluaran langsung induk saja (0 bila hanya anaknya yang terpakai; baris
--     induk tetap ada selama root_total > 0), root_total = induk + semua anak (= realisasi
--     budget_progress tidak wajib bila rentangnya periode yang sama; realisasi wajib bisa lebih kecil:
--     bayar tagihan periode lain tidak dihitung di sana, 0119/df4d4cc).
--   * kind 'uncategorized': pengeluaran/pemasukan tanpa kategori (satu baris per type bila > 0).
--   * kind 'fee': kelas expense_fee (biaya transfer, tanpa kategori), type 'expense', hanya bila > 0.
--   * type_total: expense = Pengeluaran penuh (expense + expense_fee, sama dengan angka besar Laporan
--     dan period_trend.pengeluaran); income = Pemasukan. Jadi Σ amount per type = type_total.
--   * pct10 = floor(1000 x amount / type_total) (permil, UI menampilkan 1 desimal), root_pct10 =
--     floor(1000 x root_total / type_total), pct10_in_root = floor(1000 x amount / root_total).
--     Baris uncategorized dan fee adalah kelompoknya sendiri: root_total = amount, root_pct10 =
--     pct10, pct10_in_root NULL, root_category_id/category_id NULL.
--   * Kolom tambahan di luar plan (Task 13 butuh tanpa kueri kedua): name, icon kategori (NULL untuk
--     uncategorized/fee), archived (kategori terarsip yang masih punya transaksi di rentang).
--   * Urutan = urutan tampil: expense dulu, fee terakhir per type; kelompok root_total terbesar dulu
--     (seri: nama induk, id); di dalam kelompok baris induk dulu lalu anak amount terbesar.
-- - api.period_trend(ruang, label, jumlah, dasar): arus kas per periode untuk kartu Tren dan pemilih
--   periode. Jendela p_count periode (1..12) yang berakhir di p_label_month (tanggal 1), urut lama ke
--   baru. Dasar 'gajian' = app.period_of_label (aturan kosong = bulan kalender), 'kalender' = bulan
--   kalender label. Pemasukan/Pengeluaran/Selisih = BSD §8.1 turunan (sama dengan month_summary:
--   Pengeluaran termasuk expense_fee).
--   * complete = ends_on < hari ini; is_current = hari ini di [starts_on, ends_on]; days_left =
--     ends_on - hari ini + 1 hanya bila is_current (>= 1, Z10), selain itu NULL. Hari ini =
--     app.today() (WIB), bukan jam Node.
--   * delta_pengeluaran = pengeluaran baris ini - periode sebelumnya, juga untuk baris pertama
--     jendela (periode sebelumnya di luar jendela tetap dihitung). NULL bila baris ini belum complete,
--     periode sebelumnya tanpa transaksi (tanpa line hidup), atau periode sebelumnya memuat tanggal
--     entri hidup tertua ruang (data awal bisa parsial).
--   * Kolom tambahan di luar plan: holidays_known (dari period_of_label; dasar kalender selalu true)
--     untuk petunjuk libur LP13 per periode yang dilihat.
-- - api.excluded_summary(ruang, dari, sampai): bagian "Tidak termasuk": satu baris per kelas x_* dan
--   arah ('in' = line masuk, 'out' = line keluar) yang bernilai > 0, amount positif, entry_count =
--   jumlah entri. Σ per kelas dan arah = period_summary.inflow/outflow kelas itu.
-- - Validasi rentang category_summary dan excluded_summary sama dengan period_summary (DK400 period);
--   period_trend: DK400 label_month (kosong/bukan tanggal 1), count (bukan 1..12), basis.
create function api.category_summary(p_space_id uuid, p_from date, p_to date)
returns table (kind text, root_category_id uuid, category_id uuid, type app.category_type, amount bigint,
               entry_count int, type_total bigint, pct10 int, root_total bigint, root_pct10 int,
               pct10_in_root int, name text, icon text, archived boolean)
language plpgsql stable set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.assert_member(p_space_id);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3660 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'period';
  end if;
  return query
  with l as (
    select r.entry_id, r.category_id, r.root_category_id, abs(r.amount)::bigint as amt,
           case when r.report_class = 'income' then 'income' else 'expense' end::app.category_type as t,
           case when r.report_class = 'expense_fee' then 'fee'
                when r.category_id is null then 'uncategorized' else 'category' end as k
    from app.report_lines r
    where r.space_id = p_space_id and r.occurred_on between p_from and p_to
      and r.report_class in ('expense', 'expense_fee', 'income')
  ), tot as (
    select l.t, sum(l.amt)::bigint as total from l group by l.t
  ), cat as (
    select l.root_category_id as root_id, l.category_id as cat_id, l.t,
           sum(l.amt)::bigint as amt, count(distinct l.entry_id)::int as n
    from l where l.k = 'category' group by l.root_category_id, l.category_id, l.t
  ), grp as (
    select cat.root_id, cat.t, sum(cat.amt)::bigint as rtot from cat group by cat.root_id, cat.t
  ), rows as (
    -- Kategori dengan transaksi, plus baris induk yang hanya terpakai lewat anaknya (amount 0).
    select 'category' as k, c.root_id, c.cat_id, c.t, c.amt, c.n, g.rtot
    from cat c
    join grp g on g.root_id = c.root_id and g.t = c.t
    union all
    select 'category', g.root_id, g.root_id, g.t, 0, 0, g.rtot
    from grp g
    where not exists (select 1 from cat c where c.root_id = g.root_id and c.t = g.t and c.cat_id = g.root_id)
    union all
    select l.k, null::uuid, null::uuid, l.t, sum(l.amt)::bigint, count(distinct l.entry_id)::int,
           sum(l.amt)::bigint
    from l where l.k <> 'category' group by l.k, l.t
  )
  select x.k, x.root_id, x.cat_id, x.t, x.amt, x.n, tot.total,
         floor(x.amt * 1000.0 / tot.total)::int,
         x.rtot,
         floor(x.rtot * 1000.0 / tot.total)::int,
         case when x.k = 'category' then floor(x.amt * 1000.0 / x.rtot)::int end,
         c.name, c.icon, case when c.id is not null then c.archived_at is not null end
  from rows x
  join tot on tot.t = x.t
  left join app.categories c on c.space_id = p_space_id and c.id = x.cat_id
  left join app.categories rc on rc.space_id = p_space_id and rc.id = x.root_id
  order by (x.t = 'expense') desc, (x.k = 'fee'), x.rtot desc, rc.name nulls last, x.root_id nulls last,
           x.k, (x.cat_id = x.root_id) desc, x.amt desc, c.name, x.cat_id;
end $$;

create function api.period_trend(p_space_id uuid, p_label_month date, p_count int default 6,
                                 p_basis text default 'gajian')
returns table (label_month date, starts_on date, ends_on date, pemasukan bigint, pengeluaran bigint,
               selisih bigint, complete boolean, is_current boolean, days_left int,
               delta_pengeluaran bigint, holidays_known boolean)
language plpgsql stable set search_path = '' as $$
#variable_conflict use_column
declare
  v_today  date := app.today();
  v_oldest date;
begin
  perform app.assert_member(p_space_id);
  if p_label_month is null or extract(day from p_label_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'label_month';
  end if;
  if p_count is null or p_count not between 1 and 12 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'count';
  end if;
  if p_basis is null or p_basis not in ('gajian', 'kalender') then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'basis';
  end if;
  select min(r.occurred_on) into v_oldest from app.report_lines r where r.space_id = p_space_id;
  return query
  with lab as (
    -- p_count periode jendela + satu periode sebelumnya (pembanding baris pertama).
    select g.i, (p_label_month - make_interval(months => g.i))::date as m
    from generate_series(0, p_count) g (i)
  ), per as (
    select lab.i, lab.m, b.s, b.e, b.hk
    from lab
    cross join lateral (
      select p.starts_on as s, p.ends_on as e, p.holidays_known as hk
      from app.period_of_label(p_space_id, lab.m) p
      where p_basis = 'gajian'
      union all
      select lab.m, ((lab.m + interval '1 month')::date - 1), true
      where p_basis = 'kalender'
    ) b
  ), sums as (
    select per.i, per.m, per.s, per.e, per.hk, a.inc, a.exp, a.n
    from per
    cross join lateral (
      select coalesce(sum(r.amount) filter (where r.report_class = 'income'), 0)::bigint as inc,
             coalesce(-sum(r.amount) filter (where r.report_class in ('expense', 'expense_fee')), 0)::bigint
               as exp,
             count(*) as n
      from app.report_lines r
      where r.space_id = p_space_id and r.occurred_on between per.s and per.e
    ) a
  )
  select c.m, c.s, c.e, c.inc, c.exp, c.inc - c.exp,
         c.e < v_today,
         v_today between c.s and c.e,
         case when v_today between c.s and c.e then (c.e - v_today + 1)::int end,
         case when c.e < v_today and p.n > 0 and not (v_oldest between p.s and p.e)
              then c.exp - p.exp end,
         c.hk
  from sums c
  join sums p on p.i = c.i + 1
  where c.i < p_count
  order by c.m;
end $$;

create function api.excluded_summary(p_space_id uuid, p_from date, p_to date)
returns table (report_class text, direction text, amount bigint, entry_count int)
language plpgsql stable set search_path = '' as $$
#variable_conflict use_column
begin
  perform app.assert_member(p_space_id);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3660 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'period';
  end if;
  return query
  select r.report_class, case when r.amount > 0 then 'in' else 'out' end,
         sum(abs(r.amount))::bigint, count(distinct r.entry_id)::int
  from app.report_lines r
  where r.space_id = p_space_id and r.occurred_on between p_from and p_to
    and r.report_class like 'x\_%' and r.amount <> 0
  group by r.report_class, (r.amount > 0)
  order by r.report_class collate "C", (r.amount > 0) desc;
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
drop function api.excluded_summary(uuid, date, date);
drop function api.period_trend(uuid, date, int, text);
drop function api.category_summary(uuid, date, date);
