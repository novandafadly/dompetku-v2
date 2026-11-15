-- migrate:up
-- S12 (plan S12 Task 2, K1, K6, K7): perbaikan utang S11 dan angka kartu utang Beranda. Expand-only:
-- satu fungsi baca baru, dua fungsi diganti utuh (create or replace, tanda tangan dan kolom hasil sama).
--
-- - api.export_entries (0127): Catatan baris debt_principal/debt_payment = coalesce(deskripsi entri,
--   "kontak · judul") (tanpa judul = nama kontak, nama kontak terbaru). Entri utang dari API tidak punya
--   deskripsi, jadi sebelumnya Catatan kosong (handoff S11). Baris lain tetap. Jumlah baris dan Σ per
--   kelas tidak berubah (join app.debts/app.contacts kiri, satu baris per utang). Kolom Jenis tetap kunci
--   mesin. Kontak hanya ada di Pribadi; ekspor Bersama tidak berubah.
-- - private.lock_debt (0131, temuan keamanan I1 S11): sesudah FOR NO KEY UPDATE baris bisa sudah hilang
--   (jobs.purge_voided menghapus utang terhapus > 90 hari di antara baca dan kunci; READ COMMITTED
--   mengembalikan nol baris). Dulu fungsi mengembalikan baris kosong dan pemanggil gagal dengan galat
--   tak dikenal (mis. RLS entries); kini DK404 debt_not_found, sama dengan baca pertama. Diuji di
--   99_konkurensi.
-- - api.debt_totals(ruang) (K1, kartu "Utang yang harus dibayar" Beranda Pribadi): satu baris
--   borrowed_remaining (Σ sisa utang), lent_remaining (Σ sisa piutang), active_count (utang hidup
--   bersisa). Sisa dari app.debt_balances (sama dengan list_debts), per utang dijepit >= 0 (data rusak
--   DQ05 tidak mengurangi utang lain). Utang terhapus dan lunas tidak dihitung. INVOKER milik owner, STABLE,
--   assert_member lebih dulu (pasangan/Luar DK404, tanpa konteks DK401), ruang Bersama DK422
--   debt_personal_only (B10; kind dibaca di bawah RLS pemanggil, gagal tertutup bila tak terbaca).
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

-- Kunci utang sesudah keanggotaan terbukti; kembalikan versi terbaru. Tidak terlihat atau hilang
-- sebelum kunci didapat = DK404.
create or replace function private.lock_debt(p_debt_id uuid) returns app.debts
language plpgsql set search_path = '' as $$
declare v app.debts%rowtype;
begin
  select * into v from app.debts where id = p_debt_id;
  if v.id is null then
    raise exception using errcode = 'DK404', message = 'debt_not_found';
  end if;
  perform app.assert_member(v.space_id);
  select * into v from app.debts where id = p_debt_id for no key update;
  if not found then
    raise exception using errcode = 'DK404', message = 'debt_not_found';
  end if;
  return v;
end $$;

create function api.debt_totals(p_space_id uuid)
returns table (borrowed_remaining bigint, lent_remaining bigint, active_count int)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if (select s.kind from app.spaces s where s.id = p_space_id) is distinct from 'personal' then
    raise exception using errcode = 'DK422', message = 'debt_personal_only';
  end if;
  return query
  select coalesce(sum(greatest(b.remaining, 0)) filter (where d.direction = 'borrowed'), 0)::bigint,
         coalesce(sum(greatest(b.remaining, 0)) filter (where d.direction = 'lent'), 0)::bigint,
         (count(*) filter (where b.remaining > 0))::int
    from app.debts d
    join app.debt_balances b on b.space_id = d.space_id and b.debt_id = d.id
   where d.space_id = p_space_id and d.voided_at is null;
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
drop function api.debt_totals(uuid);

create or replace function private.lock_debt(p_debt_id uuid) returns app.debts
language plpgsql set search_path = '' as $$
declare v app.debts%rowtype;
begin
  select * into v from app.debts where id = p_debt_id;
  if v.id is null then
    raise exception using errcode = 'DK404', message = 'debt_not_found';
  end if;
  perform app.assert_member(v.space_id);
  select * into v from app.debts where id = p_debt_id for no key update;
  return v;
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
         r.amount, coalesce(nullif(e.description, ''), e.shared_note), ro.display_name
    from app.report_lines r
    join app.accounts a on a.space_id = r.space_id and a.id = r.account_id
    join app.entries e on e.space_id = r.space_id and e.id = r.entry_id
    left join app.categories c on c.space_id = r.space_id and c.id = r.category_id
    left join app.categories pc on pc.space_id = r.space_id and pc.id = c.parent_id
    left join app.space_roster(p_space_id) ro on ro.user_id = r.created_by
   where r.space_id = p_space_id and r.occurred_on between p_from and p_to
   order by r.occurred_on, r.entry_id, r.role;
end $$;
