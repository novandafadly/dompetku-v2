-- migrate:up
-- S14 (plan S14 Task 11, bingkai S14-AS7; ruling pengendali: tanpa tabel baru): api.export_entries diganti utuh dari
-- badan 0132 (create or replace; tanda tangan, kolom hasil, hak, dan urutan sama). Expand-only: satu fungsi baca.
--
-- - Catatan (kolom note) trade saham dan aset, sesudah deskripsi entri dan kontak/judul utang, sebelum catatan
--   bersama: beli `Beli BBCA 200 lembar @ 9.150` (kaki transfer dompet sumber dan dompet saham), jual `Jual BBCA
--   100 lembar @ 9.800` (kaki transfer), jual dengan untung/rugi `Untung jual BBCA 100 lembar @ 9.800` /
--   `Rugi jual ...` (kaki valuasi, menurut tanda baris), saham berjalan `BBCA 200 lembar @ 9.150 (sudah dimiliki)`,
--   perubahan nilai aset non-saham `Perubahan nilai`. Lembar dan harga memakai titik ribuan lewat to_char + replace
--   (tidak bergantung locale). Entri trade tidak punya deskripsi, jadi sebelumnya Catatan kosong.
-- - Data milik pengguna sendiri (bukan pesan galat), jadi kode saham dan harga boleh muncul di ekspor. Join kiri
--   ke app.stock_trades dan app.stock_holdings (hanya Pribadi, RLS pemanggil): jumlah baris, urutan, Σ per kelas,
--   dan batas export_max_rows tidak berubah (satu baris per kaki entri hidup; Σ CSV = Laporan, I6). Ekspor
--   Bersama tidak pernah punya trade. Kolom Jenis tetap kunci mesin (`valuation`, `transfer`, `opening_balance`).
create or replace function api.export_entries(p_space_id uuid, p_from date, p_to date)
returns table (occurred_on date, kind text, role text, report_class text, account text,
               category text, subcategory text, amount bigint, note text, recorded_by text)
language plpgsql set search_path = '' as $$
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
         ro.display_name
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
   where r.space_id = p_space_id and r.occurred_on between p_from and p_to
   order by r.occurred_on, r.entry_id, r.role;
end $$;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;

create or replace function api.export_entries(p_space_id uuid, p_from date, p_to date)
returns table (occurred_on date, kind text, role text, report_class text, account text,
               category text, subcategory text, amount bigint, note text, recorded_by text)
language plpgsql set search_path = '' as $$
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
                  e.shared_note),
         ro.display_name
    from app.report_lines r
    join app.accounts a on a.space_id = r.space_id and a.id = r.account_id
    join app.entries e on e.space_id = r.space_id and e.id = r.entry_id
    left join app.categories c on c.space_id = r.space_id and c.id = r.category_id
    left join app.categories pc on pc.space_id = r.space_id and pc.id = c.parent_id
    left join app.debts d on d.space_id = e.space_id and d.id = e.debt_id
    left join app.contacts ct on ct.space_id = d.space_id and ct.id = d.contact_id
    left join app.space_roster(p_space_id) ro on ro.user_id = r.created_by
   where r.space_id = p_space_id and r.occurred_on between p_from and p_to
   order by r.occurred_on, r.entry_id, r.role;
end $$;

select private.own_api_functions();
