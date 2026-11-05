-- migrate:up
-- S8 (IPD §5, plan S8 Task 3, bingkai S8-K1, keputusan pemilik K2-K4): kontribusi per anggota
-- Bersama api.member_contributions. Fungsi baru (expand-only).
--
-- - SECURITY INVOKER + STABLE atas app.report_lines (RLS FORCE berlaku, entri hidup saja: batal,
--   dipindah, dan dipurge tidak dihitung), milik owner seperti fungsi baca api lain; EXECUTE hanya
--   dompetku_web (own_api_functions). assert_member di awal, lalu validasi periode yang sama
--   dengan period_summary (DK400 period, rentang <= 3660 hari). Ruang Pribadi = 0 baris.
-- - Periode = occurred_on (tanggal kalender WIB) di [p_from, p_to] inklusif, sama dengan
--   period_summary; pemanggil S8 memberi bulan kalender WIB berjalan (K3), S9 boleh memberi
--   periode gajian tanpa mengubah fungsi.
-- - Per pencatat (created_by kaki Bersama): setoran = Σ line main kelas x_setoran_anggota (kaki
--   Bersama masuk), diambil = Σ |line main| kelas x_diambil_anggota (kaki Bersama keluar);
--   *_count = jumlah entri. Line fee (kelas expense_fee) tidak dihitung (K2); pemasukan biasa,
--   termasuk kategori awal "Kontribusi Farida", tidak dihitung (K4). Tanpa angka bersih.
-- - Satu baris per anggota app.space_roster (left join): anggota tanpa transaksi = 0. Urut user_id.
-- - Batas privasi: keluaran hanya user_id anggota dan angka (tanpa dompet, deskripsi, catatan,
--   link_id, atau id entri).
create function api.member_contributions(p_space_id uuid, p_from date, p_to date)
returns table (user_id uuid, setoran bigint, diambil bigint, setoran_count int, diambil_count int)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3660 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'period';
  end if;
  if not exists (select 1 from app.spaces s where s.id = p_space_id and s.kind = 'shared') then
    return;
  end if;
  return query
  with c as (
    select r.created_by,
           sum(r.amount) filter (where r.report_class = 'x_setoran_anggota') as setoran,
           sum(abs(r.amount)) filter (where r.report_class = 'x_diambil_anggota') as diambil,
           count(distinct r.entry_id) filter (where r.report_class = 'x_setoran_anggota') as setoran_count,
           count(distinct r.entry_id) filter (where r.report_class = 'x_diambil_anggota') as diambil_count
    from app.report_lines r
    where r.space_id = p_space_id
      and r.occurred_on between p_from and p_to
      and r.role = 'main'
      and r.report_class in ('x_setoran_anggota', 'x_diambil_anggota')
    group by r.created_by
  )
  select m.user_id,
         coalesce(c.setoran, 0)::bigint, coalesce(c.diambil, 0)::bigint,
         coalesce(c.setoran_count, 0)::int, coalesce(c.diambil_count, 0)::int
  from app.space_roster(p_space_id) m
  left join c on c.created_by = m.user_id
  order by m.user_id;
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
drop function api.member_contributions(uuid, date, date);
