-- migrate:up
-- S14 (IPD §6, plan S14 Task 2, K2, K3, K4; keputusan pemilik 2026-11-15): aset non-kas sebagai dompet
-- ber-pocket `aset` di ledger. Expand-only: satu tabel, dua fungsi trigger baru, empat trigger;
-- assert_entry_shape, report_class, assert_balance, dan dq_run diganti utuh (create or replace, tanda
-- tangan dan kolom hasil sama). Nilai enum `aset`/`valuation` dari 0139 (file sendiri). Fungsi api.*
-- aset (create_account dengan jenis aset, revalue_asset, asset_overview) = 0141.
--
-- - app.asset_details (K3, K4): satu baris per dompet aset (PK account_id), ruang Pribadi atau Bersama
--   (K2), FK komposit (space_id, account_id) -> accounts ruang yang sama ON DELETE CASCADE (rincian tidak
--   bermakna tanpa dompetnya; dompet tidak pernah dihapus di produksi, reset tes tidak terhalang),
--   (space_id, space_kind) -> spaces. asset_kind text + CHECK: emas, properti, kendaraan, reksa_dana,
--   deposito, saham, lainnya (hanya saham berperilaku khusus, 0142+); CHECK asset_details_saham_personal
--   (saham hanya Pribadi, K2). note opsional 1..200 sesudah btrim. Tanpa kolom nilai tersimpan: nilai
--   aset = saldo buku dompet (app.account_balances).
-- - private.tg_asset_guard (BEFORE, SECURITY INVOKER, pola tg_goal_guard: sebagai pemanggil, dompet ruang
--   lain tidak terlihat = DK404 seragam tanpa oracle):
--   * asset_details INSERT: dompet harus terlihat di ruang rincian (DK404 account_not_found), pocket aset
--     (DK422 asset_account_invalid), saham hanya Pribadi (DK422 pocket_personal_only, sebelum CHECK).
--     UPDATE: dompet, ruang, jenis, pembuat tetap (DK422 asset_immutable); catatan boleh.
--   * bills INSERT/UPDATE OF account_id: tagihan rutin tidak boleh menunjuk dompet aset (DK422
--     asset_account_invalid; bayar tagihan = pengeluaran, ditolak juga oleh penjaga ledger).
-- - private.tg_asset_ledger (constraint trigger DEFERRABLE INITIALLY DEFERRED di entry_lines insert/
--   update/delete dan entries update of voided_at; DEFINER milik owner seperti tg_entry_shape, karena
--   saldo harus dihitung dari semua line dompet): untuk setiap dompet aset yang tersentuh (akun baris
--   baru dan lama, dan semua baris entri) saat pemeriksaan:
--   * entri hidup yang menyentuh dompet aset hanya boleh transfer, space_transfer, opening_balance,
--     adjustment (Cocokkan saldo, tidak bisa negatif), atau valuation; pemasukan, pengeluaran/talangan,
--     reimburse, pokok/cicilan utang, dan kaki antar ruang yang pasangannya dompet sistem patungan =
--     DK422 asset_account_invalid. Jalur patungan dan WA bawaan sudah menyaring pocket di API (0136
--     split_payer_account, 0134 wa_default_account); penjaga ini lapisan kedua.
--   * saldo dompet aset < 0 = DK422 asset_negative, di semua jalur (catat, ubah, batal, pulihkan, pindah,
--     baris yang ditulis langsung), terlepas dari p_allow_negative.
-- - private.assert_balance (0101, dipakai semua fungsi api tulis): dompet aset yang menjadi negatif =
--   DK422 asset_negative walau p_allow = true (galat langsung, sebelum pemeriksaan tertunda); dompet lain
--   tetap saldo_negatif bila tidak diizinkan.
-- - private.assert_entry_shape (+ cabang valuation): satu line main, tanpa counter/fee, dompet aset.
-- - app.report_class (+ x_valuasi; spec §9.1, BSD:1008): valuasi = kelas sendiri di "Tidak termasuk".
--   period_summary, excluded_summary, dan export_entries membaca report_lines, jadi kelas baru ikut tanpa
--   perubahan (Σ Ekspor = Laporan); Pemasukan/Pengeluaran, anggaran, laju belanja, Kontribusi, dan aman
--   dipakai (hanya operasional) tidak berubah (I6). Isi/tarik aset = transfer (x_transfer), nilai awal =
--   opening_balance (x_koreksi).
-- - private.dq_run: DQ03 mengenal valuation; + DQ19 (error). Selebihnya = 0137.
-- - RLS ENABLE + FORCE pola ruang; web/api/auditor SELECT, tulis hanya dompetku_api (INSERT, UPDATE;
--   tanpa DELETE).
-- - FK created_by ke auth."user" on delete restrict: hanya anggota ruang (berprofil) yang bisa menulis,
--   jadi jobs.purge_unfinished_users tidak pernah terhalang.
-- Kode galat baru: DK422 asset_account_invalid, asset_negative, asset_immutable (pocket_personal_only dan
-- account_not_found dipakai ulang).

create table app.asset_details (
  account_id uuid primary key,
  space_id   uuid not null,
  space_kind app.space_kind not null,
  asset_kind text not null check (asset_kind in ('emas', 'properti', 'kendaraan', 'reksa_dana', 'deposito',
                                                 'saham', 'lainnya')),
  note       text check (length(btrim(note)) between 1 and 200),
  created_by uuid not null references auth."user" (id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (space_id, space_kind) references app.spaces (id, kind) on delete restrict,
  foreign key (space_id, account_id) references app.accounts (space_id, id) on delete cascade,
  constraint asset_details_saham_personal check (asset_kind <> 'saham' or space_kind = 'personal')
);
create index on app.asset_details (space_id, account_id);
create index on app.asset_details (space_id, space_kind);
create index on app.asset_details (created_by);

create function private.tg_asset_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_acc app.accounts%rowtype;
begin
  if tg_table_name = 'bills' then
    if exists (select 1 from app.accounts a
                where a.id = new.account_id and a.space_id = new.space_id and a.pocket = 'aset') then
      raise exception using errcode = 'DK422', message = 'asset_account_invalid', detail = 'account_id';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if (new.account_id, new.space_id, new.space_kind, new.asset_kind, new.created_by)
       is distinct from (old.account_id, old.space_id, old.space_kind, old.asset_kind, old.created_by) then
      raise exception using errcode = 'DK422', message = 'asset_immutable';
    end if;
    return new;
  end if;
  select * into v_acc from app.accounts a where a.id = new.account_id and a.space_id = new.space_id;
  if not found then
    raise exception using errcode = 'DK404', message = 'account_not_found', detail = 'account_id';
  end if;
  if v_acc.pocket <> 'aset' then
    raise exception using errcode = 'DK422', message = 'asset_account_invalid', detail = 'account_id';
  end if;
  if new.asset_kind = 'saham' and v_acc.space_kind <> 'personal' then
    raise exception using errcode = 'DK422', message = 'pocket_personal_only';
  end if;
  return new;
end $$;
create trigger asset_guard before insert or update on app.asset_details
  for each row execute function private.tg_asset_guard();
create trigger asset_guard before insert or update of account_id on app.bills
  for each row when (new.account_id is not null) execute function private.tg_asset_guard();

-- ===== Penjaga ledger dompet aset (tertunda sampai akhir transaksi / set constraints immediate) =====
create function private.tg_asset_ledger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_entry uuid;
  v_accs  uuid[];
begin
  if tg_table_name = 'entry_lines' then
    v_entry := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;
    v_accs := array[case when tg_op <> 'INSERT' then old.account_id end,
                    case when tg_op <> 'DELETE' then new.account_id end];
  else
    v_entry := new.id;
    v_accs := '{}';
  end if;
  -- Dompet aset yang tersentuh: akun baris ini (termasuk akun lama saat baris diubah/dihapus) dan semua
  -- baris entri saat ini.
  select coalesce(array_agg(a.id order by a.id), '{}') into v_accs
    from app.accounts a
   where a.pocket = 'aset'
     and (a.id = any (v_accs)
          or a.id in (select l.account_id from app.entry_lines l where l.entry_id = v_entry));
  if cardinality(v_accs) = 0 then
    return null;
  end if;
  if exists (
       select 1 from app.entries e
        where e.id = v_entry and e.voided_at is null
          and exists (select 1 from app.entry_lines l where l.entry_id = e.id and l.account_id = any (v_accs))
          and (e.kind not in ('transfer', 'space_transfer', 'opening_balance', 'adjustment', 'valuation')
               or (e.kind = 'space_transfer' and exists (
                     select 1 from app.entries p
                     join app.entry_lines pl on pl.entry_id = p.id and pl.role = 'main'
                     join app.accounts pa on pa.id = pl.account_id
                    where p.link_id = e.link_id and p.id <> e.id and pa.pocket = 'patungan')))) then
    raise exception using errcode = 'DK422', message = 'asset_account_invalid', detail = 'account_id';
  end if;
  if exists (
       select 1 from unnest(v_accs) x (id)
        where (select coalesce(sum(l.amount), 0) from app.entry_lines l join app.entries e on e.id = l.entry_id
                where l.account_id = x.id and e.voided_at is null) < 0) then
    raise exception using errcode = 'DK422', message = 'asset_negative', detail = 'account_id';
  end if;
  return null;
end $$;
create constraint trigger entry_lines_asset_guard after insert or update or delete on app.entry_lines
  deferrable initially deferred for each row execute function private.tg_asset_ledger();
create constraint trigger entries_asset_guard after update of voided_at on app.entries
  deferrable initially deferred for each row execute function private.tg_asset_ledger();

-- ===== Saldo negatif (0101 + dompet aset) =====
create or replace function private.assert_balance(p_account_id uuid, p_delta bigint, p_allow boolean)
returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_delta < 0 and private.balance(p_account_id) < 0 then
    -- 0140: dompet aset tidak pernah negatif; izin saldo negatif (p_allow) tidak berlaku untuknya.
    if exists (select 1 from app.accounts a where a.id = p_account_id and a.pocket = 'aset') then
      raise exception using errcode = 'DK422', message = 'asset_negative', detail = 'account_id';
    elsif not coalesce(p_allow, false) then
      raise exception using errcode = 'DK422', message = 'saldo_negatif', detail = 'account_id';
    end if;
  end if;
end $$;

-- ===== Matriks bentuk lines per kind (0130 + cabang valuation 0140) =====
create or replace function private.assert_entry_shape(p_entry_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e  app.entries%rowtype;
  m  app.entry_lines%rowtype;
  c  app.entry_lines%rowtype;
  f  app.entry_lines%rowtype;
  d  app.debts%rowtype;
  ok boolean;
begin
  select * into e from app.entries where id = p_entry_id;
  if not found then
    return;
  end if;
  select * into m from app.entry_lines where entry_id = p_entry_id and role = 'main';
  select * into c from app.entry_lines where entry_id = p_entry_id and role = 'counter';
  select * into f from app.entry_lines where entry_id = p_entry_id and role = 'fee';
  if e.debt_id is not null then
    select * into d from app.debts where id = e.debt_id;
  end if;

  ok := m.entry_id is not null
        and (f.entry_id is null or (f.amount < 0 and f.account_id = m.account_id));
  ok := ok and case
    when e.kind = 'income'  then c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'expense' then c.entry_id is null and f.entry_id is null and m.amount < 0
    when e.kind = 'reimbursement' then c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'transfer' then
         c.entry_id is not null and m.amount < 0 and c.amount = -m.amount
         and c.account_id <> m.account_id
    when e.kind = 'space_transfer' then
         c.entry_id is null
         and case e.direction when 'out' then m.amount < 0
                              else m.amount > 0 and f.entry_id is null end
    when e.kind = 'opening_balance' then
         c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'adjustment' then c.entry_id is null and f.entry_id is null
    -- 0130: utang/piutang. borrowed: pokok masuk (+), cicilan keluar (-); lent: kebalikannya.
    when e.kind in ('debt_principal', 'debt_payment') then coalesce(
         c.entry_id is null and f.entry_id is null and d.id is not null
         and (e.voided_at is not null or d.voided_at is null)
         and not exists (select 1 from app.accounts a where a.id = m.account_id and a.pocket = 'kantor')
         and case when e.kind = 'debt_principal' then
                   d.mode = 'baru' and abs(m.amount) = d.principal
                   and case d.direction when 'borrowed' then m.amount > 0 when 'lent' then m.amount < 0 end
                  else
                   case d.direction when 'borrowed' then m.amount < 0 when 'lent' then m.amount > 0 end
             end, false)
    -- 0140: perubahan nilai aset. Satu line main (naik/turun, bukan nol: CHECK entry_lines), tanpa
    -- counter/fee, dompet ber-pocket aset (tidak negatif dan jalur lain dijaga private.tg_asset_ledger).
    when e.kind = 'valuation' then
         c.entry_id is null and f.entry_id is null
         and exists (select 1 from app.accounts a where a.id = m.account_id and a.pocket = 'aset')
    else false
  end;
  if not ok then
    raise exception using errcode = 'DK500', message = 'entry_shape_invalid';
  end if;
  if e.kind = 'space_transfer' then
    perform private.assert_space_transfer_pair(e.link_id);
  end if;
end $$;

-- ===== Kelas laporan (0135 + x_valuasi) =====
create or replace function app.report_class(
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
    -- 0135: kaki masuk/keluar dompet sistem patungan (S12-ADR1), bukan setoran anggota.
    when p_kind = 'space_transfer' and p_pocket = 'patungan'         then 'x_patungan'
    when p_kind = 'space_transfer' then
      case when p_space_kind = 'personal'
           then case p_direction when 'out' then 'x_setor_bersama'   else 'x_ambil_bersama'   end
           else case p_direction when 'in'  then 'x_setoran_anggota' else 'x_diambil_anggota' end
      end
    -- 0140: perubahan nilai aset (S-44): bukan pemasukan/pengeluaran, bagian "Tidak termasuk".
    when p_kind = 'valuation'                                        then 'x_valuasi'
    when p_kind = 'transfer'                                         then 'x_transfer'
    when p_kind = 'reimbursement'                                    then 'x_reimburse'
    when p_kind in ('opening_balance', 'adjustment')                 then 'x_koreksi'
    when p_kind = 'debt_principal'                                   then 'x_pokok_utang'
    when p_kind = 'debt_payment'                                     then 'x_pelunasan_utang'
  end
$$;

-- ===== Cek kualitas data: DQ03 valuasi, DQ19 aset (selebihnya = 0137) =====
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
  -- DQ03 bentuk line per kind, entri hidup (aturan private.assert_entry_shape, 0101; utang 0130; valuasi 0140)
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
    left join app.debts d on d.id = e.debt_id
    left join app.accounts ma on ma.id = s.m_acc
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
          -- Paritas dengan assert_entry_shape 0130 (entri hidup saja, jadi utang harus hidup).
          when e.kind = 'debt_principal' then
               s.n_counter = 0 and s.n_fee = 0 and d.voided_at is null and ma.pocket <> 'kantor'
               and d.mode = 'baru' and abs(s.m_amt) = d.principal
               and case d.direction when 'borrowed' then s.m_amt > 0 when 'lent' then s.m_amt < 0 end
          when e.kind = 'debt_payment' then
               s.n_counter = 0 and s.n_fee = 0 and d.voided_at is null and ma.pocket <> 'kantor'
               and case d.direction when 'borrowed' then s.m_amt < 0 when 'lent' then s.m_amt > 0 end
          -- 0140: paritas dengan assert_entry_shape cabang valuation (satu line main di dompet aset).
          when e.kind = 'valuation' then s.n_counter = 0 and s.n_fee = 0 and ma.pocket = 'aset'
          else false
        end, false)
  ) x
  union all
  -- DQ05 (0131) sisa utang tidak negatif: Σ |main| cicilan hidup per utang <= principal. Kueri
  -- independen dari app.debt_balances; api.pay_debt dan pulihkan cicilan menjaga saat tulis.
  select 'DQ05', 'error', count(*)::int from app.debts d
  where d.principal < (select coalesce(sum(abs(l.amount)), 0) from app.entries e
                       join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                       where e.debt_id = d.id and e.kind = 'debt_payment' and e.voided_at is null)
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
    where a.pocket <> 'patungan'  -- 0136: dompet sistem dijaga DQ16
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
  union all
  -- DQ15 modal trading (S12, 0134): app.trading_capital = Σ ulang transfer hidup antara dompet
  -- trading dan dompet non-trading satu ruang (kueri independen membaca −main, view membaca
  -- counter) ditambah kaki space_transfer hidup di dompet trading (kueri independen membaca kaki
  -- pasangan di Bersama, view membaca kaki trading), capital_left/realized tidak negatif dan
  -- capital_left - realized = setor - tarik; dompet trading wajib di Pribadi (B10, CHECK) dan wajib
  -- ada di view.
  select 'DQ15', 'error', count(*)::int from (
    select a.id
    from app.accounts a
    left join app.trading_capital tc on tc.account_id = a.id
    left join lateral (
      select coalesce(sum(-m.amount) filter (where c.account_id = a.id), 0) as cin,
             coalesce(sum(-m.amount) filter (where m.account_id = a.id), 0) as cout
      from app.entries e
      join app.entry_lines m on m.entry_id = e.id and m.role = 'main'
      join app.entry_lines c on c.entry_id = e.id and c.role = 'counter'
      join app.accounts ma on ma.id = m.account_id
      join app.accounts ca on ca.id = c.account_id
      where e.kind = 'transfer' and e.voided_at is null
        and a.id in (m.account_id, c.account_id)
        and (ma.pocket = 'trading') <> (ca.pocket = 'trading')
    ) s on true
    left join lateral (
      select coalesce(sum(-p.amount) filter (where e.direction = 'in'), 0) as cin,
             coalesce(sum(p.amount) filter (where e.direction = 'out'), 0) as cout
      from app.entries e
      join app.entry_lines l on l.entry_id = e.id and l.role = 'main' and l.account_id = a.id
      join app.entries pe on pe.link_id = e.link_id and pe.id <> e.id
      join app.entry_lines p on p.entry_id = pe.id and p.role = 'main'
      where e.kind = 'space_transfer' and e.voided_at is null
    ) st on true
    where a.pocket = 'trading'
      and (a.space_kind <> 'personal' or tc.account_id is null
           or tc.capital_in <> s.cin + st.cin or tc.capital_out <> s.cout + st.cout
           or tc.capital_left < 0 or tc.realized < 0
           or tc.capital_left - tc.realized <> s.cin + st.cin - s.cout - st.cout)
  ) x
  union all
  -- DQ16 patungan (S12, 0136): (a) saldo dompet sistem = Σ pelunasan hidup belum diterima; (b) per
  -- tagihan Σ bagian = nominal, kaki masuk dan pengeluaran ada di dompet sistem ruang itu senominal
  -- dengan status batal sama; (c) per pelunasan kaki masuk cocok, kaki terima (bila ada) hidup dan
  -- cocok; (d) entri hidup di dompet sistem wajib dirujuk baris patungan hidup; (e) Σ saldo anggota per
  -- ruang = 0. Kueri independen dari fungsi tulis 0136.
  select 'DQ16', 'error', count(*)::int from (
    select a.id from app.accounts a
    where a.pocket = 'patungan'
      and (select coalesce(sum(l.amount), 0) from app.entry_lines l join app.entries e on e.id = l.entry_id
            where l.account_id = a.id and e.voided_at is null)
          <> (select coalesce(sum(t.amount), 0) from app.settlements t
               where t.space_id = a.space_id and t.voided_at is null and t.received_entry_id is null)
    union all
    select s.id from app.splits s
    where s.amount <> (select coalesce(sum(sh.amount), 0) from app.split_shares sh
                        where sh.space_id = s.space_id and sh.split_id = s.id)
       or not exists (select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = s.in_entry_id and e.kind = 'space_transfer' and e.direction = 'in'
                        and a.pocket = 'patungan' and a.space_id = s.space_id and l.amount = s.amount
                        and (e.voided_at is null) = (s.voided_at is null))
       or not exists (select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = s.expense_entry_id and e.kind = 'expense'
                        and a.pocket = 'patungan' and a.space_id = s.space_id and l.amount = -s.amount
                        and (e.voided_at is null) = (s.voided_at is null))
    union all
    select t.id from app.settlements t
    where not exists (select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = t.in_entry_id and e.kind = 'space_transfer' and e.direction = 'in'
                        and a.pocket = 'patungan' and a.space_id = t.space_id and l.amount = t.amount
                        and (e.voided_at is null) = (t.voided_at is null))
       or (t.received_entry_id is not null and not exists (
                      select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = t.received_entry_id and e.kind = 'space_transfer' and e.direction = 'out'
                        and a.pocket = 'patungan' and a.space_id = t.space_id and l.amount = -t.amount
                        and e.voided_at is null))
    union all
    select e.id from app.entries e
    join app.entry_lines l on l.entry_id = e.id
    join app.accounts a on a.id = l.account_id
    where a.pocket = 'patungan' and e.voided_at is null
      and not exists (select 1 from app.splits s
                      where s.voided_at is null and e.id in (s.in_entry_id, s.expense_entry_id))
      and not exists (select 1 from app.settlements t where t.voided_at is null and t.in_entry_id = e.id)
      and not exists (select 1 from app.settlements t where t.received_entry_id = e.id)
    union all
    select b.space_id from app.member_balances b group by b.space_id having sum(b.balance) <> 0
  ) x
  union all
  -- DQ17 tujuan (S13, 0137): tujuan aktif pada dompet terarsip, bukan tabungan, atau di ruang lain.
  -- private.tg_goal_guard dan api.archive_account (0138) menjaga saat tulis; cek ini menangkap baris yang
  -- lolos jalan lain (UPDATE massal/restore manual).
  select 'DQ17', 'error', count(*)::int from app.goals g
  join app.accounts a on a.id = g.account_id
  where g.status = 'active'
    and (a.archived_at is not null or a.pocket <> 'tabungan' or a.space_id <> g.space_id)
  union all
  -- DQ19 aset (S14, 0140): (a) dompet aset bersaldo negatif; (b) entri hidup di dompet aset selain transfer,
  -- transfer antar ruang, saldo awal, Cocokkan saldo, dan valuasi (pemasukan, pengeluaran/talangan,
  -- reimburse, utang), atau kaki antar ruang yang pasangannya dompet sistem patungan; (c) tagihan rutin
  -- menunjuk dompet aset; (d) rincian 1:1: dompet aset tanpa app.asset_details, rincian pada dompet bukan
  -- aset atau ruang lain, saham di Bersama. Penjaga private.tg_asset_ledger/tg_asset_guard dan
  -- private.assert_balance menjaga saat tulis; cek ini menangkap baris yang lolos jalan lain.
  select 'DQ19', 'error', count(*)::int from (
    select a.id from app.accounts a
    where a.pocket = 'aset'
      and (select coalesce(sum(l.amount), 0) from app.entry_lines l join app.entries e on e.id = l.entry_id
            where l.account_id = a.id and e.voided_at is null) < 0
    union all
    select e.id from app.entries e
    join app.entry_lines l on l.entry_id = e.id
    join app.accounts a on a.id = l.account_id and a.pocket = 'aset'
    where e.voided_at is null
      and (e.kind not in ('transfer', 'space_transfer', 'opening_balance', 'adjustment', 'valuation')
           or (e.kind = 'space_transfer' and exists (
                 select 1 from app.entries p
                 join app.entry_lines pl on pl.entry_id = p.id and pl.role = 'main'
                 join app.accounts pa on pa.id = pl.account_id
                 where p.link_id = e.link_id and p.id <> e.id and pa.pocket = 'patungan')))
    union all
    select b.id from app.bills b join app.accounts a on a.id = b.account_id where a.pocket = 'aset'
    union all
    select a.id from app.accounts a
    where a.pocket = 'aset' and not exists (select 1 from app.asset_details d where d.account_id = a.id)
    union all
    select d.account_id from app.asset_details d join app.accounts a on a.id = d.account_id
    where a.pocket <> 'aset' or a.space_id <> d.space_id or (d.asset_kind = 'saham' and a.space_kind <> 'personal')
  ) x
$$;

-- ===== RLS: aktif dan dipaksa; pola ruang (baca web/api, tulis hanya dompetku_api) =====
alter table app.asset_details enable row level security;
alter table app.asset_details force row level security;
create policy member_read on app.asset_details for select to dompetku_web, dompetku_api
  using (space_id = any ((select app.my_space_ids())::uuid[]));
create policy member_write on app.asset_details for all to dompetku_api
  using (space_id = any ((select app.my_space_ids())::uuid[]))
  with check (space_id = any ((select app.my_space_ids())::uuid[]));

-- ===== Hak tabel =====
grant select on app.asset_details to dompetku_web, dompetku_api;
grant insert, update on app.asset_details to dompetku_api;
-- Auditor: tabel baru eksplisit (grant 0008 hanya tabel saat itu); DQ19 membaca app.asset_details.
grant select on app.asset_details to dompetku_auditor;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
revoke all on app.asset_details from dompetku_web, dompetku_api, dompetku_auditor;
drop policy member_write on app.asset_details;
drop policy member_read on app.asset_details;
drop trigger entries_asset_guard on app.entries;
drop trigger entry_lines_asset_guard on app.entry_lines;
drop function private.tg_asset_ledger();
drop trigger asset_guard on app.bills;
drop trigger asset_guard on app.asset_details;
drop function private.tg_asset_guard();
drop table app.asset_details;
-- Entri valuasi dihapus (beserta riwayatnya; GUC purge 0005 mengizinkan cascade ke entry_history yang
-- append-only), supaya cek bentuk dan DQ03 versi lama tidak menemukan kind yang tidak dikenalnya.
select pg_catalog.set_config('dompetku.purge', 'on', true);
delete from app.entries where kind = 'valuation';
select pg_catalog.set_config('dompetku.purge', 'off', true);

-- Fungsi yang diganti kembali ke badan sebelumnya (0137, 0135, 0130, 0101).
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
  -- DQ03 bentuk line per kind, entri hidup (aturan private.assert_entry_shape, 0101; utang 0130)
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
    left join app.debts d on d.id = e.debt_id
    left join app.accounts ma on ma.id = s.m_acc
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
          -- Paritas dengan assert_entry_shape 0130 (entri hidup saja, jadi utang harus hidup).
          when e.kind = 'debt_principal' then
               s.n_counter = 0 and s.n_fee = 0 and d.voided_at is null and ma.pocket <> 'kantor'
               and d.mode = 'baru' and abs(s.m_amt) = d.principal
               and case d.direction when 'borrowed' then s.m_amt > 0 when 'lent' then s.m_amt < 0 end
          when e.kind = 'debt_payment' then
               s.n_counter = 0 and s.n_fee = 0 and d.voided_at is null and ma.pocket <> 'kantor'
               and case d.direction when 'borrowed' then s.m_amt < 0 when 'lent' then s.m_amt > 0 end
          else false
        end, false)
  ) x
  union all
  -- DQ05 (0131) sisa utang tidak negatif: Σ |main| cicilan hidup per utang <= principal. Kueri
  -- independen dari app.debt_balances; api.pay_debt dan pulihkan cicilan menjaga saat tulis.
  select 'DQ05', 'error', count(*)::int from app.debts d
  where d.principal < (select coalesce(sum(abs(l.amount)), 0) from app.entries e
                       join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                       where e.debt_id = d.id and e.kind = 'debt_payment' and e.voided_at is null)
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
    where a.pocket <> 'patungan'  -- 0136: dompet sistem dijaga DQ16
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
  union all
  -- DQ15 modal trading (S12, 0134): app.trading_capital = Σ ulang transfer hidup antara dompet
  -- trading dan dompet non-trading satu ruang (kueri independen membaca −main, view membaca
  -- counter) ditambah kaki space_transfer hidup di dompet trading (kueri independen membaca kaki
  -- pasangan di Bersama, view membaca kaki trading), capital_left/realized tidak negatif dan
  -- capital_left - realized = setor - tarik; dompet trading wajib di Pribadi (B10, CHECK) dan wajib
  -- ada di view.
  select 'DQ15', 'error', count(*)::int from (
    select a.id
    from app.accounts a
    left join app.trading_capital tc on tc.account_id = a.id
    left join lateral (
      select coalesce(sum(-m.amount) filter (where c.account_id = a.id), 0) as cin,
             coalesce(sum(-m.amount) filter (where m.account_id = a.id), 0) as cout
      from app.entries e
      join app.entry_lines m on m.entry_id = e.id and m.role = 'main'
      join app.entry_lines c on c.entry_id = e.id and c.role = 'counter'
      join app.accounts ma on ma.id = m.account_id
      join app.accounts ca on ca.id = c.account_id
      where e.kind = 'transfer' and e.voided_at is null
        and a.id in (m.account_id, c.account_id)
        and (ma.pocket = 'trading') <> (ca.pocket = 'trading')
    ) s on true
    left join lateral (
      select coalesce(sum(-p.amount) filter (where e.direction = 'in'), 0) as cin,
             coalesce(sum(p.amount) filter (where e.direction = 'out'), 0) as cout
      from app.entries e
      join app.entry_lines l on l.entry_id = e.id and l.role = 'main' and l.account_id = a.id
      join app.entries pe on pe.link_id = e.link_id and pe.id <> e.id
      join app.entry_lines p on p.entry_id = pe.id and p.role = 'main'
      where e.kind = 'space_transfer' and e.voided_at is null
    ) st on true
    where a.pocket = 'trading'
      and (a.space_kind <> 'personal' or tc.account_id is null
           or tc.capital_in <> s.cin + st.cin or tc.capital_out <> s.cout + st.cout
           or tc.capital_left < 0 or tc.realized < 0
           or tc.capital_left - tc.realized <> s.cin + st.cin - s.cout - st.cout)
  ) x
  union all
  -- DQ16 patungan (S12, 0136): (a) saldo dompet sistem = Σ pelunasan hidup belum diterima; (b) per
  -- tagihan Σ bagian = nominal, kaki masuk dan pengeluaran ada di dompet sistem ruang itu senominal
  -- dengan status batal sama; (c) per pelunasan kaki masuk cocok, kaki terima (bila ada) hidup dan
  -- cocok; (d) entri hidup di dompet sistem wajib dirujuk baris patungan hidup; (e) Σ saldo anggota per
  -- ruang = 0. Kueri independen dari fungsi tulis 0136.
  select 'DQ16', 'error', count(*)::int from (
    select a.id from app.accounts a
    where a.pocket = 'patungan'
      and (select coalesce(sum(l.amount), 0) from app.entry_lines l join app.entries e on e.id = l.entry_id
            where l.account_id = a.id and e.voided_at is null)
          <> (select coalesce(sum(t.amount), 0) from app.settlements t
               where t.space_id = a.space_id and t.voided_at is null and t.received_entry_id is null)
    union all
    select s.id from app.splits s
    where s.amount <> (select coalesce(sum(sh.amount), 0) from app.split_shares sh
                        where sh.space_id = s.space_id and sh.split_id = s.id)
       or not exists (select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = s.in_entry_id and e.kind = 'space_transfer' and e.direction = 'in'
                        and a.pocket = 'patungan' and a.space_id = s.space_id and l.amount = s.amount
                        and (e.voided_at is null) = (s.voided_at is null))
       or not exists (select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = s.expense_entry_id and e.kind = 'expense'
                        and a.pocket = 'patungan' and a.space_id = s.space_id and l.amount = -s.amount
                        and (e.voided_at is null) = (s.voided_at is null))
    union all
    select t.id from app.settlements t
    where not exists (select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = t.in_entry_id and e.kind = 'space_transfer' and e.direction = 'in'
                        and a.pocket = 'patungan' and a.space_id = t.space_id and l.amount = t.amount
                        and (e.voided_at is null) = (t.voided_at is null))
       or (t.received_entry_id is not null and not exists (
                      select 1 from app.entries e
                      join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                      join app.accounts a on a.id = l.account_id
                      where e.id = t.received_entry_id and e.kind = 'space_transfer' and e.direction = 'out'
                        and a.pocket = 'patungan' and a.space_id = t.space_id and l.amount = -t.amount
                        and e.voided_at is null))
    union all
    select e.id from app.entries e
    join app.entry_lines l on l.entry_id = e.id
    join app.accounts a on a.id = l.account_id
    where a.pocket = 'patungan' and e.voided_at is null
      and not exists (select 1 from app.splits s
                      where s.voided_at is null and e.id in (s.in_entry_id, s.expense_entry_id))
      and not exists (select 1 from app.settlements t where t.voided_at is null and t.in_entry_id = e.id)
      and not exists (select 1 from app.settlements t where t.received_entry_id = e.id)
    union all
    select b.space_id from app.member_balances b group by b.space_id having sum(b.balance) <> 0
  ) x
  union all
  -- DQ17 tujuan (S13, 0137): tujuan aktif pada dompet terarsip, bukan tabungan, atau di ruang lain.
  -- private.tg_goal_guard dan api.archive_account (0138) menjaga saat tulis; cek ini menangkap baris yang
  -- lolos jalan lain (UPDATE massal/restore manual).
  select 'DQ17', 'error', count(*)::int from app.goals g
  join app.accounts a on a.id = g.account_id
  where g.status = 'active'
    and (a.archived_at is not null or a.pocket <> 'tabungan' or a.space_id <> g.space_id)
$$;

create or replace function app.report_class(
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
    -- 0135: kaki masuk/keluar dompet sistem patungan (S12-ADR1), bukan setoran anggota.
    when p_kind = 'space_transfer' and p_pocket = 'patungan'         then 'x_patungan'
    when p_kind = 'space_transfer' then
      case when p_space_kind = 'personal'
           then case p_direction when 'out' then 'x_setor_bersama'   else 'x_ambil_bersama'   end
           else case p_direction when 'in'  then 'x_setoran_anggota' else 'x_diambil_anggota' end
      end
    when p_kind = 'transfer'                                         then 'x_transfer'
    when p_kind = 'reimbursement'                                    then 'x_reimburse'
    when p_kind in ('opening_balance', 'adjustment')                 then 'x_koreksi'
    when p_kind = 'debt_principal'                                   then 'x_pokok_utang'
    when p_kind = 'debt_payment'                                     then 'x_pelunasan_utang'
  end
$$;

create or replace function private.assert_entry_shape(p_entry_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e  app.entries%rowtype;
  m  app.entry_lines%rowtype;
  c  app.entry_lines%rowtype;
  f  app.entry_lines%rowtype;
  d  app.debts%rowtype;
  ok boolean;
begin
  select * into e from app.entries where id = p_entry_id;
  if not found then
    return;
  end if;
  select * into m from app.entry_lines where entry_id = p_entry_id and role = 'main';
  select * into c from app.entry_lines where entry_id = p_entry_id and role = 'counter';
  select * into f from app.entry_lines where entry_id = p_entry_id and role = 'fee';
  if e.debt_id is not null then
    select * into d from app.debts where id = e.debt_id;
  end if;

  ok := m.entry_id is not null
        and (f.entry_id is null or (f.amount < 0 and f.account_id = m.account_id));
  ok := ok and case
    when e.kind = 'income'  then c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'expense' then c.entry_id is null and f.entry_id is null and m.amount < 0
    when e.kind = 'reimbursement' then c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'transfer' then
         c.entry_id is not null and m.amount < 0 and c.amount = -m.amount
         and c.account_id <> m.account_id
    when e.kind = 'space_transfer' then
         c.entry_id is null
         and case e.direction when 'out' then m.amount < 0
                              else m.amount > 0 and f.entry_id is null end
    when e.kind = 'opening_balance' then
         c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'adjustment' then c.entry_id is null and f.entry_id is null
    -- 0130: utang/piutang. borrowed: pokok masuk (+), cicilan keluar (-); lent: kebalikannya.
    when e.kind in ('debt_principal', 'debt_payment') then coalesce(
         c.entry_id is null and f.entry_id is null and d.id is not null
         and (e.voided_at is not null or d.voided_at is null)
         and not exists (select 1 from app.accounts a where a.id = m.account_id and a.pocket = 'kantor')
         and case when e.kind = 'debt_principal' then
                   d.mode = 'baru' and abs(m.amount) = d.principal
                   and case d.direction when 'borrowed' then m.amount > 0 when 'lent' then m.amount < 0 end
                  else
                   case d.direction when 'borrowed' then m.amount < 0 when 'lent' then m.amount > 0 end
             end, false)
    else false
  end;
  if not ok then
    raise exception using errcode = 'DK500', message = 'entry_shape_invalid';
  end if;
  if e.kind = 'space_transfer' then
    perform private.assert_space_transfer_pair(e.link_id);
  end if;
end $$;

create or replace function private.assert_balance(p_account_id uuid, p_delta bigint, p_allow boolean)
returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_delta < 0 and not coalesce(p_allow, false) and private.balance(p_account_id) < 0 then
    raise exception using errcode = 'DK422', message = 'saldo_negatif', detail = 'account_id';
  end if;
end $$;

select private.own_api_functions();
