-- migrate:up
-- S10 (IPD §5, plan S10 Task 7, K5; BSD §15 butir 7): ekspor transaksi untuk CSV. Expand-only:
-- satu fungsi baca baru.
--
-- api.export_entries(ruang, dari, sampai): satu baris per KAKI entri (line) hidup di rentang,
-- dari app.report_lines + app.report_class() (satu sumber dengan Laporan, Beranda, Rencana), sehingga
-- jumlah nominal per kelas laporan = angka Laporan periode itu (Pemasukan = Σ kelas income,
-- Pengeluaran = Σ kelas expense + expense_fee, tanda minus). Per kaki, bukan per entri: transfer
-- dengan biaya berkelas ganda (x_transfer + expense_fee) tidak bisa dicocokkan bila digabung.
-- Entri batal, dipindah, dan dipurge tidak ada (report_lines hanya entri hidup).
--
-- - INVOKER (RLS pemanggil), VOLATILE (menulis audit); search_path kosong; assert_member lebih
--   dulu (Pribadi pasangan dan Luar = DK404, tanpa konteks = DK401); hanya ruang ini, jadi ekspor
--   Bersama tidak pernah memuat entri Pribadi (B13).
-- - Rentang: dari <= sampai, paling lama 3660 hari (DK400 invalid_argument detail period).
-- - Batas baris (DK422 export_too_large), dihitung sebelum membaca isi (tanpa LIMIT: pemotongan
--   diam-diam bila ada commit di antara hitungan dan pembacaan lebih buruk daripada selisih kecil): app.settings
--   'export_max_rows' (bawaan 50.000; tes menurunkannya supaya tidak perlu menyisipkan 50.000 baris).
-- - Nama pencatat dari app.space_roster (DEFINER, hanya anggota ruang ini): profil pasangan tidak
--   terbaca langsung oleh RLS profil.
-- - Audit event 'export' (bukan reserved: web boleh memanggil audit.log) dengan meta
--   {count, via: 'csv'} saja (daftar kunci meta audit.events tertutup, 0006): tanpa isi, nama,
--   nominal, atau rentang.
-- - statement_timeout 5 s role web dinaikkan sampai 30 s oleh pemanggil (BSD §15 butir 7,
--   set_config lokal transaksi sebelum memanggil fungsi ini), karena timer pernyataan tidak bisa
--   diubah dari dalam fungsi yang sedang berjalan.
insert into app.settings (key, value) values ('export_max_rows', '50000');

create function api.export_entries(p_space_id uuid, p_from date, p_to date)
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

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
drop function api.export_entries(uuid, date, date);
delete from app.settings where key = 'export_max_rows';
