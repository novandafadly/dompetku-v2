-- migrate:up
-- S9 (IPD §5, plan S9 Task 7, K1, K7, K12; BSD §8.2, §8.2a): "aman dipakai" lengkap dan laju belanja.
-- Expand-only: api.safe_to_spend diganti utuh (create or replace, tanda tangan dan kolom hasil sama
-- dengan 0102, kontrak web), satu fungsi baca baru (api.spend_pace).
--
-- - api.safe_to_spend: periode = app.pay_period(ruang, hari ini) (satu sumber dengan budget_progress,
--   bills_due, dan Laporan; aturan gajian kosong = bulan kalender, jadi hasil 0102 untuk rumah tangga
--   tanpa aturan dan ruang tanpa tagihan/anggaran tidak berubah).
--   * until = ends_on periode (sehari sebelum gajian efektif berikutnya); days_left = until - hari ini
--     + 1 (>= 1 selama p_today di dalam periode, termasuk hari terakhir = 1, Z10).
--   * bills_until_eom (nama kolom dipertahankan; batasnya kini akhir periode gajian) = Σ nominal
--     kemunculan (perkiraan, K12) di app.bill_schedule yang belum dibayar (posted: entri tertaut hidup;
--     entri bayar batal = terbuka lagi, review Task 5), belum dilewati, tagihan aktif, due_on <= until,
--     termasuk lewat jatuh tempo dari periode lalu. Kemunculan lewat periode lalu dipotong bersama
--     anggaran wajib periode berjalan: kewajiban periode berbeda, bukan dobel (BSD §16 "Catatan S9").
--     Bayar di muka (kemunculan sesudah until, sudah lunas) tidak dipotong lagi: saldonya sudah turun.
--   * budget_wajib_remaining = Σ max(0, remaining) anggaran wajib berlabel periode yang sama
--     (api.budget_progress(ruang, label_month), realisasi atas rentang periode itu).
--   * Saldo operasional dompet aktif (dompet terarsip selalu bersaldo 0, BSD §2.2 #4).
-- - api.spend_pace (K7, bahan keadaan "Hati-hati" di Beranda; keadaan sendiri disusun fungsi murni TS):
--   * avg_daily = floor((Σ |expense| + Σ |expense_fee|) tanggal [hari ini - 30, hari ini - 1] / 30):
--     30 hari WIB penuh sebelum hari ini (hari ini belum selesai), definisi Pengeluaran BSD §8.1.
--     Pembagi tetap 30 (days) walau ruang lebih muda: rata-rata ruang baru lebih kecil, jadi lebih jarang
--     "Hati-hati" (keputusan agen; biaya bila salah: pembagi = hari sejak entri pertama, satu baris).
--   * overdue_bills = jumlah kemunculan terbuka (definisi sama dengan safe_to_spend) dengan due_on <
--     hari ini.
--   * holidays_known dari app.pay_period (aturan kosong = selalu true: Beranda tidak memberi tanda).
-- - Keduanya INVOKER (RLS pemanggil), STABLE, milik owner, assert_member di awal (Pribadi pasangan dan
--   Luar = DK404), tanggal dari app.today() (WIB) bila p_today kosong. EXECUTE web lewat
--   own_api_functions.
create or replace function api.safe_to_spend(p_space_id uuid, p_today date default null)
returns table (operasional bigint, bills_until_eom bigint, budget_wajib_remaining bigint,
               total bigint, per_day bigint, days_left int, until date)
language plpgsql stable set search_path = '' as $$
declare
  v_today date := coalesce(p_today, app.today());
  v_label date;
  v_until date;
  v_ops   bigint;
  v_bills bigint;
  v_wajib bigint;
  v_days  int;
begin
  perform app.assert_member(p_space_id);
  select p.ends_on, p.label_month into v_until, v_label from app.pay_period(p_space_id, v_today) p;
  select coalesce(sum(ab.balance), 0)::bigint into v_ops
    from app.account_balances ab
    join app.accounts a on a.id = ab.account_id
   where ab.space_id = p_space_id and ab.pocket = 'operasional' and a.archived_at is null;
  select coalesce(sum(bs.amount), 0)::bigint into v_bills
    from app.bill_schedule bs
   where bs.space_id = p_space_id and not bs.posted and bs.skipped_at is null
     and not bs.bill_archived and bs.due_on <= v_until;
  select coalesce(sum(greatest(0, bp.remaining)), 0)::bigint into v_wajib
    from api.budget_progress(p_space_id, v_label) bp
   where bp.wajib;
  v_days := v_until - v_today + 1;
  return query select v_ops, v_bills, v_wajib, v_ops - v_bills - v_wajib,
    case when v_days > 0 then floor((v_ops - v_bills - v_wajib)::numeric / v_days)::bigint
         else v_ops - v_bills - v_wajib end,
    v_days, v_until;
end $$;

create function api.spend_pace(p_space_id uuid, p_today date default null)
returns table (avg_daily bigint, days int, overdue_bills int, holidays_known boolean)
language plpgsql stable set search_path = '' as $$
declare
  v_today date := coalesce(p_today, app.today());
  v_days  constant int := 30;
  v_spent bigint;
  v_over  int;
  v_known boolean;
begin
  perform app.assert_member(p_space_id);
  select coalesce(-sum(r.amount), 0)::bigint into v_spent
    from app.report_lines r
   where r.space_id = p_space_id and r.report_class in ('expense', 'expense_fee')
     and r.occurred_on between v_today - v_days and v_today - 1;
  select count(*)::int into v_over
    from app.bill_schedule bs
   where bs.space_id = p_space_id and not bs.posted and bs.skipped_at is null
     and not bs.bill_archived and bs.due_on < v_today;
  select p.holidays_known into v_known from app.pay_period(p_space_id, v_today) p;
  return query select floor(v_spent::numeric / v_days)::bigint, v_days, v_over, v_known;
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
drop function api.spend_pace(uuid, date);
-- api.safe_to_spend kembali ke badan 0102 persis.
-- "Aman dipakai" sampai akhir bulan (rumus m0a-keputusan T6, selector safeToSpend).
-- Versi S5: tagihan dan anggaran wajib belum punya tabel, jadi bills_until_eom dan
-- budget_wajib_remaining selalu 0. Tanda tangan dan kolom hasil sama dengan BSD §8 agar S9
-- cukup create or replace dengan badan lengkap BSD (lalu periode gajian §8.2a).
create or replace function api.safe_to_spend(p_space_id uuid, p_today date default null)
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
