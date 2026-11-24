-- migrate:up
-- S16 (IPD §6, plan S16 Task 2, K1 sampai K8; BSD §8, §15 butir 7): kalender arus kas, deteksi langganan, ekspor PDF.
-- Expand-only: satu tabel (app.subscription_dismissals), tiga fungsi baca/tulis baru, satu fungsi pembantu murni,
-- dan api.export_entries diganti (drop + create; parameter keempat p_via bawaan 'csv', kolom hasil sama dengan 0148,
-- jadi pemanggil 3 argumen tetap jalan).
--
-- - api.cashflow_calendar(ruang, hari = 30, hari ini = null): proyeksi saldo operasional per tanggal WIB, hanya dari
--   data yang sudah ada: saldo operasional dompet aktif hari ini (app.account_balances, satu sumber dengan
--   api.safe_to_spend) dikurangi tagihan terbuka. Kemunculan terbuka = app.bill_schedule yang belum dibayar
--   (entri tertaut hidup), belum dilewati, tagihan aktif (K12 perkiraan: nominal tagihan); yang sudah lewat jatuh
--   tempo (due_on < hari ini) dihitung di hari ini dan ditandai overdue_count. Tagihan aktif yang belum dimaterialisasi
--   (job harian) diproyeksikan dari hari_dalam_bulan: least(tanggal, hari terakhir bulan) dalam starts_on..ends_on,
--   rumus yang sama dengan private.bill_due_in_label dan materialisasi, tanpa baris occurrence (bukan duplikat bila
--   baris ada, termasuk yang dilewati/dibayar). Pemasukan tidak diproyeksikan (tidak ada jadwal gaji); UI menyebutnya.
--   Tiap hari: opening, bills_amount, bills_count, closing = opening - tagihan hari itu, short = closing < 0
--   (nominal bigint dihitung di SQL; UI hanya memformat). Batas hari 1..90. INVOKER STABLE, assert_member.
-- - api.detect_subscriptions(ruang, hari ini = null): saran tagihan rutin dari pola berulang. Pengeluaran biasa
--   (kelas laporan expense, kaki main; Kantor, talangan, transfer tidak ikut) 180 hari terakhir, dikelompokkan per
--   (deskripsi ternormalisasi app.subscription_key, nominal sama persis); kelompok >= 3 bulan kalender berbeda dan
--   transaksi terakhir <= 45 hari lalu. Dibuang bila namanya sama dengan tagihan aktif ruang itu (tidak mengusulkan
--   dobel, satu kewajiban satu sumber) atau sudah diabaikan (app.subscription_dismissals). Hasil maks 20 baris:
--   nama (deskripsi terakhir), amount, months, last_on, day_of_month (hari transaksi terakhir), category_id dan
--   account_id transaksi terakhir (bahan isi awal Tagihan baru). Entri tanpa deskripsi tidak dikelompokkan.
-- - app.subscription_dismissals (space_id, desc_key, amount) PK; RLS ENABLE + FORCE pola ruang (anggota membaca,
--   dompetku_api menulis, tanpa DELETE/UPDATE). api.dismiss_subscription(ruang, nama, nominal): DEFINER, idempoten
--   (ulang = sukses tanpa baris baru), assert_member, nominal 1..1e13, nama 1..200 sesudah btrim.
-- - api.export_entries(ruang, dari, sampai, via = 'csv'): audit 'export' meta {count, via}; via hanya 'csv' atau 'pdf'
--   (DK400 detail via). Badan lain = 0148.
-- Kode galat baru: tidak ada (DK400/DK404 yang sudah ada). Pesan/detail tanpa nama dan nominal.

create function app.subscription_key(p_text text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(p_text), '\s+', ' ', 'g'))
$$;
revoke all on function app.subscription_key(text) from public;
grant execute on function app.subscription_key(text) to dompetku_web, dompetku_api, dompetku_auditor;

create table app.subscription_dismissals (
  space_id     uuid not null,
  desc_key     text not null check (length(desc_key) between 1 and 200),
  amount       bigint not null check (amount > 0 and amount <= 10000000000000),
  dismissed_by uuid not null references auth."user" (id) on delete restrict,
  dismissed_at timestamptz not null default now(),
  primary key (space_id, desc_key, amount),
  foreign key (space_id) references app.spaces (id) on delete restrict
);
create index on app.subscription_dismissals (dismissed_by);

alter table app.subscription_dismissals enable row level security;
alter table app.subscription_dismissals force row level security;
create policy member_read on app.subscription_dismissals for select to dompetku_web, dompetku_api
  using (space_id = any ((select app.my_space_ids())::uuid[]));
create policy member_write on app.subscription_dismissals for insert to dompetku_api
  with check (space_id = any ((select app.my_space_ids())::uuid[]));
grant select on app.subscription_dismissals to dompetku_web, dompetku_api, dompetku_auditor;
grant insert on app.subscription_dismissals to dompetku_api;

create function api.cashflow_calendar(p_space_id uuid, p_days int default 30, p_today date default null)
returns table (day date, opening bigint, bills_amount bigint, bills_count int, overdue_count int,
               closing bigint, short boolean, bills jsonb)
language plpgsql stable set search_path = '' as $$
declare
  v_today date := coalesce(p_today, app.today());
  v_end   date;
  v_ops   bigint;
begin
  perform app.assert_member(p_space_id);
  if p_days is null or p_days not between 1 and 90 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'days';
  end if;
  v_end := v_today + (p_days - 1);
  select coalesce(sum(ab.balance), 0)::bigint into v_ops
    from app.account_balances ab
    join app.accounts a on a.id = ab.account_id
   where ab.space_id = p_space_id and ab.pocket = 'operasional' and a.archived_at is null;
  return query
  with due as (
    -- Kemunculan terbuka (materialisasi): lewat jatuh tempo dihitung di hari ini.
    select greatest(bs.due_on, v_today) as d, bs.bill_id, bs.name, bs.amount, bs.due_on,
           (bs.due_on < v_today) as late, false as projected
      from app.bill_schedule bs
     where bs.space_id = p_space_id and not bs.posted and bs.skipped_at is null
       and not bs.bill_archived and bs.due_on <= v_end
    union all
    -- Proyeksi tagihan aktif yang belum punya baris occurrence pada bulan kalender itu
    -- (aturan sama dengan private.materialize_bill: perubahan day_of_month tidak menggandakan bulan).
    select x.due_on, b.id, b.name, b.amount, x.due_on, false, true
      from app.bills b
      cross join lateral (
        select q.mm,
               least(q.mm + (b.day_of_month - 1), (q.mm + interval '1 month')::date - 1) as due_on
          from (select (date_trunc('month', v_today)::date + make_interval(months => k))::date as mm
                  from generate_series(0, 4) k) q
      ) x
     where b.space_id = p_space_id and b.archived_at is null
       and x.due_on between greatest(v_today, b.starts_on) and least(v_end, coalesce(b.ends_on, v_end))
       and not exists (select 1 from app.bill_occurrences o
                        where o.bill_id = b.id
                          and o.due_on >= x.mm
                          and o.due_on < (x.mm + interval '1 month')::date)
  ), per_day as (
    select (v_today + g.k) as d,
           coalesce(sum(due.amount), 0)::bigint as amt,
           count(due.d)::int as n,
           count(due.d) filter (where due.late)::int as late_n,
           coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'bill_id', due.bill_id,
                 'name', due.name,
                 'amount', due.amount,
                 'due_on', due.due_on,
                 'overdue', due.late,
                 'projected', due.projected
               )
               order by due.due_on, due.name, due.bill_id
             ) filter (where due.d is not null),
             '[]'::jsonb
           ) as items
      from generate_series(0, p_days - 1) g(k)
      left join due on due.d = v_today + g.k
     group by g.k
  )
  select p.d, v_ops - coalesce(sum(p.amt) over (order by p.d rows between unbounded preceding and 1 preceding), 0)::bigint,
         p.amt, p.n, p.late_n,
         v_ops - sum(p.amt) over (order by p.d rows between unbounded preceding and current row)::bigint,
         v_ops - sum(p.amt) over (order by p.d rows between unbounded preceding and current row) < 0,
         p.items
    from per_day p
   order by p.d;
end $$;

create function api.detect_subscriptions(p_space_id uuid, p_today date default null)
returns table (name text, amount bigint, months int, last_on date, day_of_month int,
               category_id uuid, account_id uuid)
language plpgsql stable set search_path = '' as $$
declare
  v_today date := coalesce(p_today, app.today());
begin
  perform app.assert_member(p_space_id);
  return query
  with lines as (
    select e.id as entry_id, e.occurred_on, e.description, e.category_id as cat, r.account_id as acc,
           (-r.amount)::bigint as amt, app.subscription_key(e.description) as k
      from app.report_lines r
      join app.entries e on e.space_id = r.space_id and e.id = r.entry_id
     where r.space_id = p_space_id and r.role = 'main' and r.report_class = 'expense'
       and r.occurred_on between v_today - 180 and v_today
       and nullif(btrim(e.description), '') is not null and r.amount < 0
  ), grp as (
    select l.k, l.amt,
           count(distinct date_trunc('month', l.occurred_on))::int as n_months,
           max(l.occurred_on) as last_on
      from lines l
     group by l.k, l.amt
    having count(distinct date_trunc('month', l.occurred_on)) >= 3
       and max(l.occurred_on) >= v_today - 45
  ), latest as (
    select distinct on (l.k, l.amt) l.k, l.amt, l.description, l.occurred_on, l.cat, l.acc
      from lines l
      join grp g on g.k = l.k and g.amt = l.amt
     order by l.k, l.amt, l.occurred_on desc, l.entry_id desc
  )
  select btrim(t.description), g.amt, g.n_months, g.last_on,
         extract(day from t.occurred_on)::int,
         case when c.id is not null and c.archived_at is null and c.type = 'expense' then c.id end,
         case when a.id is not null and a.archived_at is null and a.pocket = 'operasional' then a.id end
    from grp g
    join latest t on t.k = g.k and t.amt = g.amt
    left join app.categories c on c.space_id = p_space_id and c.id = t.cat
    left join app.accounts a on a.space_id = p_space_id and a.id = t.acc
   where not exists (select 1 from app.bills b
                      where b.space_id = p_space_id and b.archived_at is null
                        and app.subscription_key(b.name) = g.k)
     and not exists (select 1 from app.subscription_dismissals d
                      where d.space_id = p_space_id and d.desc_key = g.k and d.amount = g.amt)
   order by g.n_months desc, g.last_on desc, g.k, g.amt
   limit 20;
end $$;

create function api.dismiss_subscription(p_space_id uuid, p_name text, p_amount bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_key text := app.subscription_key(p_name);
begin
  perform app.assert_member(p_space_id);
  if v_key is null or length(v_key) not between 1 and 200 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'name';
  end if;
  perform private.check_amount(p_amount, 'amount');
  insert into app.subscription_dismissals (space_id, desc_key, amount, dismissed_by, dismissed_at)
  values (p_space_id, v_key, p_amount, v_uid, app.now())
  on conflict do nothing;
  return jsonb_build_object('dismissed', true);
end $$;

drop function api.export_entries(uuid, date, date);

CREATE FUNCTION api.export_entries(p_space_id uuid, p_from date, p_to date, p_via text DEFAULT 'csv')
 RETURNS TABLE(occurred_on date, kind text, role text, report_class text, account text, category text, subcategory text, amount bigint, note text, recorded_by text, trip text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_n   int;
  v_max int := coalesce((select s.value::int from app.settings s where s.key = 'export_max_rows'), 50000);
begin
  perform app.assert_member(p_space_id);
  if p_via is null or p_via not in ('csv', 'pdf') then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'via';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3660 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'period';
  end if;
  select count(*)::int into v_n
    from app.report_lines r
   where r.space_id = p_space_id and r.occurred_on between p_from and p_to;
  if v_n > v_max then
    raise exception using errcode = 'DK422', message = 'export_too_large';
  end if;
  perform audit.log('export', null, null, p_space_id,
                    jsonb_build_object('count', v_n, 'via', p_via));
  return query
  select r.occurred_on, r.entry_kind::text, r.role::text, r.report_class, a.name,
         case when c.parent_id is null then c.name else pc.name end,
         case when c.parent_id is not null then c.name end,
         r.amount,
         coalesce(nullif(e.description, ''),
                  case when e.kind in ('debt_principal', 'debt_payment')
                       then concat_ws(' · ', ct.name, d.title) end,
                  case when st.side = 'opening' then
                         format('%s %s lembar @ %s (sudah dimiliki)', sh.ticker,
                                replace(to_char(st.shares, 'FM999,999,999,999,999'), ',', '.'),
                                replace(to_char(st.price, 'FM999,999,999,999'), ',', '.'))
                       when st.id is not null then
                         format('%s lembar @ %s',
                                case when st.side = 'buy' then 'Beli ' || sh.ticker
                                     when e.kind = 'valuation' then
                                       case when r.amount >= 0 then 'Untung jual ' else 'Rugi jual ' end || sh.ticker
                                     else 'Jual ' || sh.ticker end || ' ' ||
                                  replace(to_char(st.shares, 'FM999,999,999,999,999'), ',', '.'),
                                replace(to_char(st.price, 'FM999,999,999,999'), ',', '.'))
                       when e.kind = 'valuation' then 'Perubahan nilai'
                  end,
                  e.shared_note),
         ro.display_name, tr.name
    from app.report_lines r
    join app.accounts a on a.space_id = r.space_id and a.id = r.account_id
    join app.entries e on e.space_id = r.space_id and e.id = r.entry_id
    left join app.categories c on c.space_id = r.space_id and c.id = r.category_id
    left join app.categories pc on pc.space_id = r.space_id and pc.id = c.parent_id
    left join app.debts d on d.space_id = e.space_id and d.id = e.debt_id
    left join app.contacts ct on ct.space_id = d.space_id and ct.id = d.contact_id
    left join app.stock_trades st on st.space_id = e.space_id and st.id = e.stock_trade_id
    left join app.stock_holdings sh on sh.space_id = st.space_id and sh.id = st.holding_id
    left join app.space_roster(p_space_id) ro on ro.user_id = r.created_by
    left join app.trips tr on tr.space_id = e.space_id and tr.id = e.trip_id
   where r.space_id = p_space_id and r.occurred_on between p_from and p_to
   order by r.occurred_on, r.entry_id, r.role;
end $function$;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
drop function api.export_entries(uuid, date, date, text);
CREATE OR REPLACE FUNCTION api.export_entries(p_space_id uuid, p_from date, p_to date)
 RETURNS TABLE(occurred_on date, kind text, role text, report_class text, account text, category text, subcategory text, amount bigint, note text, recorded_by text, trip text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_n   int;
  v_max int := coalesce((select s.value::int from app.settings s where s.key = 'export_max_rows'), 50000);
begin
  perform app.assert_member(p_space_id);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3660 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'period';
  end if;
  select count(*)::int into v_n
    from app.report_lines r
   where r.space_id = p_space_id and r.occurred_on between p_from and p_to;
  if v_n > v_max then
    raise exception using errcode = 'DK422', message = 'export_too_large';
  end if;
  perform audit.log('export', null, null, p_space_id,
                    jsonb_build_object('count', v_n, 'via', 'csv'));
  return query
  select r.occurred_on, r.entry_kind::text, r.role::text, r.report_class, a.name,
         case when c.parent_id is null then c.name else pc.name end,
         case when c.parent_id is not null then c.name end,
         r.amount,
         coalesce(nullif(e.description, ''),
                  case when e.kind in ('debt_principal', 'debt_payment')
                       then concat_ws(' · ', ct.name, d.title) end,
                  case when st.side = 'opening' then
                         format('%s %s lembar @ %s (sudah dimiliki)', sh.ticker,
                                replace(to_char(st.shares, 'FM999,999,999,999,999'), ',', '.'),
                                replace(to_char(st.price, 'FM999,999,999,999'), ',', '.'))
                       when st.id is not null then
                         format('%s lembar @ %s',
                                case when st.side = 'buy' then 'Beli ' || sh.ticker
                                     when e.kind = 'valuation' then
                                       case when r.amount >= 0 then 'Untung jual ' else 'Rugi jual ' end || sh.ticker
                                     else 'Jual ' || sh.ticker end || ' ' ||
                                  replace(to_char(st.shares, 'FM999,999,999,999,999'), ',', '.'),
                                replace(to_char(st.price, 'FM999,999,999,999'), ',', '.'))
                       when e.kind = 'valuation' then 'Perubahan nilai'
                  end,
                  e.shared_note),
         ro.display_name, tr.name
    from app.report_lines r
    join app.accounts a on a.space_id = r.space_id and a.id = r.account_id
    join app.entries e on e.space_id = r.space_id and e.id = r.entry_id
    left join app.categories c on c.space_id = r.space_id and c.id = r.category_id
    left join app.categories pc on pc.space_id = r.space_id and pc.id = c.parent_id
    left join app.debts d on d.space_id = e.space_id and d.id = e.debt_id
    left join app.contacts ct on ct.space_id = d.space_id and ct.id = d.contact_id
    left join app.stock_trades st on st.space_id = e.space_id and st.id = e.stock_trade_id
    left join app.stock_holdings sh on sh.space_id = st.space_id and sh.id = st.holding_id
    left join app.space_roster(p_space_id) ro on ro.user_id = r.created_by
    left join app.trips tr on tr.space_id = e.space_id and tr.id = e.trip_id
   where r.space_id = p_space_id and r.occurred_on between p_from and p_to
   order by r.occurred_on, r.entry_id, r.role;
end $function$;
drop function api.dismiss_subscription(uuid, text, bigint);
drop function api.detect_subscriptions(uuid, date);
drop function api.cashflow_calendar(uuid, int, date);
revoke all on app.subscription_dismissals from dompetku_web, dompetku_api, dompetku_auditor;
drop policy member_write on app.subscription_dismissals;
drop policy member_read on app.subscription_dismissals;
drop table app.subscription_dismissals;
drop function app.subscription_key(text);

select private.own_api_functions();
