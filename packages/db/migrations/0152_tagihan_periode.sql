-- migrate:up
-- S20: periode tagihan. Tagihan rutin tidak lagi hanya bulanan tiap tanggal X: mingguan, tiap N
-- minggu, bulanan, atau tiap N bulan (N = 1..12; 12 bulan = tahunan). Expand-only terhadap data:
-- tagihan yang ada otomatis bulanan tiap 1 bulan (bawaan kolom), perilakunya tidak berubah.
--
-- - app.bills.repeat_unit ('week' | 'month') dan repeat_every (1..12). Tidak bisa diubah sesudah
--   dibuat (api.update_bill tidak menyentuhnya; sama seperti starts_on): ganti periode = arsipkan
--   lalu buat baru. Itu menghindari ritme ganda di tengah bulan dan menjaga kemunculan lama.
--   Mingguan: jatuh tempo = starts_on + k × (7 × N) hari; day_of_month tidak dipakai (diisi hari
--   starts_on). Bulanan tiap N bulan: bulan jatuh tempo = bulan starts_on + k × N, tanggal =
--   least(day_of_month, hari terakhir bulan) seperti sebelumnya.
-- - app.bill_dues(...): SATU sumber tanggal jatuh tempo dalam rentang, dipakai materialisasi,
--   aturan satu kewajiban (private.bill_due_in_label, trigger XOR, DQ13), dan proyeksi Kalender.
--   Di skema app (bukan private) karena api.cashflow_calendar berjalan sebagai dompetku_web.
-- - private.bill_due_in_label: tanda tangan baru (+ unit, kelipatan, jangkar starts_on); yang lama
--   dihapus bersama pemanggilnya (tg_obligation_xor dan private.dq_run dibuat ulang di sini).
-- - private.materialize_bill: bulanan tetap satu kemunculan per bulan kalender (ubah tanggal tidak
--   menggandakan bulan itu); mingguan per tanggal (satu bulan boleh beberapa kemunculan).
-- - api.create_bill: + p_repeat_unit/p_repeat_every (bawaan 'month'/1, jadi pemanggil lama tetap
--   jalan; hash idempotensi hanya memuatnya bila bukan bawaan). Argumen salah = DK400
--   invalid_argument (detail repeat_unit / repeat_every).
-- - api.bill_list: + repeat_unit, repeat_every di belakang. Pemanggil lama yang memakai
--   `with ordinality` dengan daftar alias kolom tetap menjalankan, tetapi urutannya salah sampai
--   image web baru terpasang (hanya jendela deploy).
-- - api.cashflow_calendar: proyeksi memakai app.bill_dues. Fungsi lain (aman dipakai, anggaran,
--   Laporan, Ekspor) membaca baris kemunculan dan tidak berubah.
-- - private.dq_run: hanya DQ13 yang berubah (pemanggilan bill_due_in_label); selebihnya salinan 0146.

-- ===== Kolom periode =====
alter table app.bills
  add column repeat_unit  text     not null default 'month' check (repeat_unit in ('week', 'month')),
  add column repeat_every smallint not null default 1 check (repeat_every between 1 and 12);

-- ===== Tanggal jatuh tempo dalam rentang [p_from, p_to] (>= p_anchor = starts_on) =====
create function app.bill_dues(p_unit text, p_every smallint, p_day smallint, p_anchor date,
                              p_from date, p_to date) returns setof date
language sql immutable set search_path = '' as $$
  select d from (
    -- Bulanan tiap N bulan: bulan ke-k sejak bulan p_anchor, tanggal terpotong ke hari terakhir bulan.
    select least(m::date + (p_day - 1), (m + interval '1 month')::date - 1) as d
      from generate_series(
             (greatest(p_from, p_anchor) - (extract(day from greatest(p_from, p_anchor))::int - 1))::timestamp,
             p_to::timestamp, interval '1 month') m
     where p_unit = 'month'
       and ((extract(year from m)::int - extract(year from p_anchor)::int) * 12
            + extract(month from m)::int - extract(month from p_anchor)::int) % p_every = 0
    union all
    -- Mingguan tiap N minggu: p_anchor + k × 7N hari, mulai dari k pertama yang >= p_from.
    select (p_anchor + k * 7 * p_every)::date
      from generate_series(
             (greatest(p_from, p_anchor) - p_anchor + 7 * p_every - 1) / (7 * p_every),
             (p_to - p_anchor) / (7 * p_every)) k
     where p_unit = 'week'
  ) x
  where d between greatest(p_from, p_anchor) and p_to
  order by d
$$;

-- ===== Satu kewajiban: true bila tagihan punya jatuh tempo di periode berlabel p_label_month =====
-- p_first_on = private.bill_first_on(starts_on, created_at); p_anchor = starts_on mentah (jangkar
-- ritme). INVOKER, milik owner; dipanggil trigger DEFINER dan dq_run (auditor).
create function private.bill_due_in_label(p_space_id uuid, p_day smallint, p_first_on date,
                                          p_ends_on date, p_label_month date, p_unit text,
                                          p_every smallint, p_anchor date) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_from date;
  v_to   date;
begin
  select greatest(l.starts_on, p_first_on), least(l.ends_on, coalesce(p_ends_on, l.ends_on))
    into v_from, v_to
  from app.period_of_label(p_space_id, p_label_month) l;
  if v_from is null or v_from > v_to then
    return false;
  end if;
  return exists (select 1 from app.bill_dues(p_unit, p_every, p_day, p_anchor, v_from, v_to));
end $$;

-- ===== Aturan satu kewajiban: pemanggil dipindah ke tanda tangan baru =====
create or replace function private.tg_obligation_xor() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_conflict boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dompetku.obligation:' || new.space_id));
  if tg_table_name = 'budgets' then
    if not new.wajib then
      return new;
    end if;
    select exists (
      select 1 from app.bills b
      join app.categories c on c.id = b.category_id
      where b.space_id = new.space_id and b.archived_at is null
        and coalesce(c.parent_id, c.id) = new.category_id
        and private.bill_due_in_label(b.space_id, b.day_of_month,
              private.bill_first_on(b.starts_on, b.created_at), b.ends_on, new.month,
              b.repeat_unit, b.repeat_every, b.starts_on)
    ) into v_conflict;
  else
    if new.archived_at is not null then
      return new;
    end if;
    -- Kunci baris kategori tagihan FOR SHARE sebelum membaca induknya (lihat 0117).
    perform 1 from app.categories c where c.id = new.category_id and c.space_id = new.space_id for share;
    select exists (
      select 1 from app.budgets bu
      join app.categories c on c.id = new.category_id
      where bu.space_id = new.space_id and bu.wajib
        and bu.category_id = coalesce(c.parent_id, c.id)
        and private.bill_due_in_label(new.space_id, new.day_of_month,
              private.bill_first_on(new.starts_on, new.created_at), new.ends_on, bu.month,
              new.repeat_unit, new.repeat_every, new.starts_on)
    ) into v_conflict;
  end if;
  if v_conflict then
    raise exception using errcode = 'DK422', message = 'obligation_double';
  end if;
  return new;
end $$;

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
  -- DQ08 (S14, 0144) snapshot H−1 = app.net_worth_at dihitung ulang; ruang bertanda kotor <= H−1 menunggu job
  select 'DQ08', 'warn', count(*)::int from app.net_worth_snapshots s
  cross join lateral app.net_worth_at(s.space_id, s.on_date) n
  where s.on_date = app.today() - 1
    and not exists (select 1 from app.nw_dirty d where d.space_id = s.space_id and d.from_date <= s.on_date)
    and (s.kas, s.aset, s.saham_pasar, s.saham_tanpa_harga, s.piutang, s.utang, s.total, s.price_as_of)
        is distinct from (n.kas, n.aset, n.saham_pasar, n.saham_tanpa_harga, n.piutang, n.utang, n.total, n.price_as_of)
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
  -- (mulai bill_first_on; periode tagihan 0152: mingguan/tiap N bulan) di periode berlabel bulan
  -- anggaran. Dihitung per pasangan. Hanya label
  -- periode berjalan ke depan: label lampau yang bergeser karena payday_rule/app.holidays berubah
  -- tidak lagi memengaruhi aman dipakai, jadi tidak membuat alert merah selamanya.
  select 'DQ13', 'error', count(*)::int from app.bills b
  join app.categories c on c.id = b.category_id
  join app.budgets bu on bu.space_id = b.space_id and bu.wajib
                     and bu.category_id = coalesce(c.parent_id, c.id)
  where b.archived_at is null
    and bu.month >= (select pp.label_month from app.pay_period(b.space_id, app.today()) pp)
    and private.bill_due_in_label(b.space_id, b.day_of_month,
          private.bill_first_on(b.starts_on, b.created_at), b.ends_on, bu.month,
          b.repeat_unit, b.repeat_every, b.starts_on)
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
  -- DQ15 modal trading (S12, 0134; K7 S14 0142: tanpa transfer dompet trading <-> dompet saham): app.trading_capital = Σ ulang transfer hidup antara dompet
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
        -- 0142 (K7): transfer dompet trading <-> dompet saham internal, bukan modal.
        and not exists (select 1 from app.asset_details d
                         where d.account_id in (m.account_id, c.account_id) and d.asset_kind = 'saham')
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
  union all
  -- DQ18 saham (S14, 0142; kueri independen dari app.stock_positions untuk (a)): (a) saldo buku dompet saham =
  -- Σ biaya perolehan trade hidup (beli lembar·harga + biaya, saham berjalan lembar·harga, jual −cost_removed);
  -- (b) per kode lembar dan biaya tidak negatif, lembar 0 = biaya 0; (c) tiap trade punya tepat entri yang
  -- diharapkan (beli/jual = satu transfer, saham berjalan = satu opening_balance, jual dengan untung/rugi ≠ 0 =
  -- + satu valuasi) dengan status batal sama dan nominal di dompet saham holding-nya; (d) entri hidup di dompet
  -- saham wajib tertaut trade dompet itu. private.tg_stock_guard menutup jalur generik saat tulis.
  select 'DQ18', 'error', count(*)::int from (
    select d.account_id from app.asset_details d
    where d.asset_kind = 'saham'
      and (select coalesce(sum(l.amount), 0) from app.entry_lines l join app.entries e on e.id = l.entry_id
            where l.account_id = d.account_id and e.voided_at is null)
          <> (select coalesce(sum(case t.side when 'buy' then t.shares * t.price + t.fee
                                              when 'opening' then t.shares * t.price
                                              else -t.cost_removed end), 0)
                from app.stock_trades t join app.stock_holdings h on h.id = t.holding_id
               where h.account_id = d.account_id and t.voided_at is null)
    union all
    select p.holding_id from app.stock_positions p
    where p.shares < 0 or p.cost_total < 0 or (p.shares = 0 and p.cost_total <> 0)
    union all
    select t.id from app.stock_trades t join app.stock_holdings h on h.id = t.holding_id
    cross join lateral (
      select t.shares * t.price - t.fee - t.tax as net,
             t.shares * t.price - t.fee - t.tax - t.cost_removed as pl
    ) v
    where (select count(*) from app.entries e where e.stock_trade_id = t.id)
            <> 1 + (t.side = 'sell' and v.pl <> 0)::int
       or not exists (
            select 1 from app.entries e join app.entry_lines l on l.entry_id = e.id and l.account_id = h.account_id
             where e.stock_trade_id = t.id and (e.voided_at is null) = (t.voided_at is null)
               and e.kind = case t.side when 'opening' then 'opening_balance' else 'transfer' end::app.entry_kind
               and l.amount = case t.side when 'buy' then t.shares * t.price + t.fee
                                          when 'opening' then t.shares * t.price else -v.net end)
       or (t.side = 'sell' and v.pl <> 0 and not exists (
            select 1 from app.entries e join app.entry_lines l on l.entry_id = e.id and l.account_id = h.account_id
             where e.stock_trade_id = t.id and e.kind = 'valuation' and (e.voided_at is null) = (t.voided_at is null)
               and l.amount = v.pl))
    union all
    select e.id from app.entries e
    join app.entry_lines l on l.entry_id = e.id
    join app.asset_details d on d.account_id = l.account_id and d.asset_kind = 'saham'
    where e.voided_at is null
      and not exists (select 1 from app.stock_trades t join app.stock_holdings h on h.id = t.holding_id
                       where t.id = e.stock_trade_id and h.account_id = l.account_id)
  ) x
  union all
  -- DQ20 trip (S15, 0146): entri hidup bertrip yang bukan pengeluaran biasa (bukan expense, talangan, atau
  -- dompet utama Kantor; K4) atau yang trip-nya bukan trip ruang entri itu. entries_trip_check, FK komposit,
  -- private.assert_entry_shape, dan fungsi tulis (0148) menjaga saat tulis; cek ini menangkap baris yang
  -- lolos jalan lain (UPDATE massal/restore manual). Total trip memakai kelas expense, jadi pelanggaran
  -- di sini akan memasukkan Kantor/talangan ke angka trip.
  select 'DQ20', 'error', count(*)::int from app.entries e
  where e.trip_id is not null and e.voided_at is null
    and (e.kind <> 'expense' or e.reimbursable
         or exists (select 1 from app.entry_lines l join app.accounts a on a.id = l.account_id
                     where l.entry_id = e.id and l.role = 'main' and a.pocket = 'kantor')
         or not exists (select 1 from app.trips t where t.id = e.trip_id and t.space_id = e.space_id))
$$;

drop function private.bill_due_in_label(uuid, smallint, date, date, date);

-- ===== Materialisasi =====
create or replace function private.materialize_bill(p_bill_id uuid, p_through date default null,
                                                    p_from date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_b       app.bills%rowtype;
  v_first   date;
  v_through date;
  v_n       int;
begin
  select * into v_b from app.bills where id = p_bill_id for share;
  if v_b.id is null or v_b.archived_at is not null then
    return 0;
  end if;
  v_through := coalesce(p_through, (
    select n.ends_on from app.pay_period(v_b.space_id, app.today()) c
    cross join lateral app.pay_period(v_b.space_id, c.ends_on + 1) n));
  v_through := least(v_through, app.today() + 400, coalesce(v_b.ends_on, v_through));
  v_first := greatest(private.bill_first_on(v_b.starts_on, v_b.created_at), coalesce(p_from, '-infinity'::date));
  if v_first > v_through then
    return 0;
  end if;
  -- Jatuh tempo dari app.bill_dues (satu sumber dengan aturan satu kewajiban dan Kalender). Bulanan:
  -- satu kemunculan per bulan kalender (ubah tanggal tidak menggandakan bulan itu). Mingguan: tanggal
  -- pasti, sehingga satu bulan boleh punya beberapa kemunculan; on conflict menyerap yang sudah ada.
  insert into app.bill_occurrences (space_id, bill_id, due_on, amount)
  select v_b.space_id, v_b.id, d.due_on, v_b.amount
  from app.bill_dues(v_b.repeat_unit, v_b.repeat_every, v_b.day_of_month, v_b.starts_on,
                     v_first, v_through) as d (due_on)
  where v_b.repeat_unit = 'week'
     or not exists (select 1 from app.bill_occurrences o
                    where o.bill_id = v_b.id
                      and o.due_on >= d.due_on - (extract(day from d.due_on)::int - 1)
                      and o.due_on < (d.due_on - (extract(day from d.due_on)::int - 1) + interval '1 month')::date)
  order by d.due_on
  on conflict (bill_id, due_on) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ===== create_bill: + periode (bawaan = bulanan, pemanggil lama tetap jalan) =====
drop function api.create_bill(uuid, uuid, text, bigint, uuid, smallint, date, date, uuid);
create function api.create_bill(
  p_client_id uuid, p_space_id uuid, p_name text, p_amount bigint, p_category_id uuid,
  p_day_of_month smallint, p_starts_on date, p_ends_on date default null,
  p_account_id uuid default null, p_repeat_unit text default 'month',
  p_repeat_every smallint default 1
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_id  uuid;
  v_r   jsonb;
  v_day smallint := p_day_of_month;
begin
  perform app.assert_member(p_space_id);
  v_r := private.idem_begin(v_uid, p_client_id, 'create_bill', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'name', btrim(p_name), 'amount', p_amount,
           'category', p_category_id, 'day', p_day_of_month, 'starts', p_starts_on,
           'ends', p_ends_on, 'account', p_account_id)
         -- Hash hanya memuat periode bila bukan bawaan: permintaan lama (bulanan) tetap berhash sama.
         || case when p_repeat_unit is distinct from 'month' or p_repeat_every is distinct from 1
                 then jsonb_build_object('unit', p_repeat_unit, 'every', p_repeat_every)
                 else '{}'::jsonb end));
  if v_r is not null then
    return v_r;
  end if;
  if p_repeat_unit is null or p_repeat_unit not in ('week', 'month') then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'repeat_unit';
  end if;
  if p_repeat_every is null or p_repeat_every not between 1 and 12 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'repeat_every';
  end if;
  -- Mingguan: hari dalam bulan tidak dipakai; kolom diisi hari starts_on agar tetap bermakna.
  if p_repeat_unit = 'week' and p_starts_on is not null then
    v_day := extract(day from p_starts_on)::smallint;
  end if;
  perform private.check_bill(p_space_id, p_name, p_amount, p_category_id, v_day,
                             p_starts_on, p_ends_on, p_account_id);
  insert into app.bills (space_id, name, amount, category_id, account_id, day_of_month,
                         starts_on, ends_on, created_by, created_at, updated_at,
                         repeat_unit, repeat_every)
  values (p_space_id, btrim(p_name), p_amount, p_category_id, p_account_id, v_day,
          p_starts_on, p_ends_on, v_uid, app.now(), app.now(), p_repeat_unit, p_repeat_every)
  returning id into v_id;
  perform private.materialize_bill(v_id);
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object('bill_id', v_id));
end $$;

-- ===== bill_list: + periode (kolom di belakang) =====
drop function api.bill_list(uuid);
create function api.bill_list(p_space_id uuid)
returns table (bill_id uuid, name text, amount bigint, category_id uuid, account_id uuid,
               day_of_month smallint, starts_on date, ends_on date, archived boolean,
               next_due_on date, next_occurrence_id uuid,
               repeat_unit text, repeat_every smallint)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  select b.id, b.name, b.amount, b.category_id, b.account_id, b.day_of_month, b.starts_on, b.ends_on,
         b.archived_at is not null, n.due_on, n.id, b.repeat_unit, b.repeat_every
  from app.bills b
  left join lateral (
    select s.id, s.due_on from app.bill_schedule s
    where s.bill_id = b.id and not s.posted and s.skipped_at is null
    order by s.due_on limit 1
  ) n on b.archived_at is null
  where b.space_id = p_space_id
  order by b.archived_at is not null, n.due_on nulls last, b.name, b.id;
end $$;

-- ===== Kalender: proyeksi memakai app.bill_dues =====
create or replace function api.cashflow_calendar(p_space_id uuid, p_days int default 30, p_today date default null)
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
    -- (aturan sama dengan private.materialize_bill: bulanan satu per bulan kalender, mingguan per tanggal).
    select x.due_on, b.id, b.name, b.amount, x.due_on, false, true
      from app.bills b
      cross join lateral app.bill_dues(b.repeat_unit, b.repeat_every, b.day_of_month, b.starts_on,
             greatest(v_today, b.starts_on), least(v_end, coalesce(b.ends_on, v_end))) as x (due_on)
     where b.space_id = p_space_id and b.archived_at is null
       and not exists (select 1 from app.bill_occurrences o
                        where o.bill_id = b.id
                          and case when b.repeat_unit = 'week'
                                   then o.due_on = x.due_on
                                   else o.due_on >= x.due_on - (extract(day from x.due_on)::int - 1)
                                    and o.due_on < (x.due_on - (extract(day from x.due_on)::int - 1)
                                                    + interval '1 month')::date end)
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


-- ===== Hak =====
-- Kalender (INVOKER, dompetku_web) dan dq_run (dompetku_auditor) memanggil fungsi periode ini.
grant execute on function app.bill_dues(text, smallint, smallint, date, date, date)
  to dompetku_web, dompetku_auditor;
grant execute on function private.bill_due_in_label(uuid, smallint, date, date, date, text, smallint, date)
  to dompetku_auditor;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
-- Tagihan non-bulanan kembali menjadi bulanan (kolom periode dibuang).
create function private.bill_due_in_label(p_space_id uuid, p_day smallint, p_starts_on date,
                                          p_ends_on date, p_label_month date) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_from date;
  v_to   date;
  v_m    date;
begin
  select greatest(l.starts_on, p_starts_on), least(l.ends_on, coalesce(p_ends_on, l.ends_on))
    into v_from, v_to
  from app.period_of_label(p_space_id, p_label_month) l;
  if v_from > v_to then
    return false;
  end if;
  v_m := v_from - (extract(day from v_from)::int - 1);
  while v_m <= v_to loop
    if least(v_m + (p_day - 1), (v_m + interval '1 month')::date - 1) between v_from and v_to then
      return true;
    end if;
    v_m := (v_m + interval '1 month')::date;
  end loop;
  return false;
end $$;

grant execute on function private.bill_due_in_label(uuid, smallint, date, date, date) to dompetku_auditor;

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
  -- DQ08 (S14, 0144) snapshot H−1 = app.net_worth_at dihitung ulang; ruang bertanda kotor <= H−1 menunggu job
  select 'DQ08', 'warn', count(*)::int from app.net_worth_snapshots s
  cross join lateral app.net_worth_at(s.space_id, s.on_date) n
  where s.on_date = app.today() - 1
    and not exists (select 1 from app.nw_dirty d where d.space_id = s.space_id and d.from_date <= s.on_date)
    and (s.kas, s.aset, s.saham_pasar, s.saham_tanpa_harga, s.piutang, s.utang, s.total, s.price_as_of)
        is distinct from (n.kas, n.aset, n.saham_pasar, n.saham_tanpa_harga, n.piutang, n.utang, n.total, n.price_as_of)
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
  -- DQ15 modal trading (S12, 0134; K7 S14 0142: tanpa transfer dompet trading <-> dompet saham): app.trading_capital = Σ ulang transfer hidup antara dompet
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
        -- 0142 (K7): transfer dompet trading <-> dompet saham internal, bukan modal.
        and not exists (select 1 from app.asset_details d
                         where d.account_id in (m.account_id, c.account_id) and d.asset_kind = 'saham')
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
  union all
  -- DQ18 saham (S14, 0142; kueri independen dari app.stock_positions untuk (a)): (a) saldo buku dompet saham =
  -- Σ biaya perolehan trade hidup (beli lembar·harga + biaya, saham berjalan lembar·harga, jual −cost_removed);
  -- (b) per kode lembar dan biaya tidak negatif, lembar 0 = biaya 0; (c) tiap trade punya tepat entri yang
  -- diharapkan (beli/jual = satu transfer, saham berjalan = satu opening_balance, jual dengan untung/rugi ≠ 0 =
  -- + satu valuasi) dengan status batal sama dan nominal di dompet saham holding-nya; (d) entri hidup di dompet
  -- saham wajib tertaut trade dompet itu. private.tg_stock_guard menutup jalur generik saat tulis.
  select 'DQ18', 'error', count(*)::int from (
    select d.account_id from app.asset_details d
    where d.asset_kind = 'saham'
      and (select coalesce(sum(l.amount), 0) from app.entry_lines l join app.entries e on e.id = l.entry_id
            where l.account_id = d.account_id and e.voided_at is null)
          <> (select coalesce(sum(case t.side when 'buy' then t.shares * t.price + t.fee
                                              when 'opening' then t.shares * t.price
                                              else -t.cost_removed end), 0)
                from app.stock_trades t join app.stock_holdings h on h.id = t.holding_id
               where h.account_id = d.account_id and t.voided_at is null)
    union all
    select p.holding_id from app.stock_positions p
    where p.shares < 0 or p.cost_total < 0 or (p.shares = 0 and p.cost_total <> 0)
    union all
    select t.id from app.stock_trades t join app.stock_holdings h on h.id = t.holding_id
    cross join lateral (
      select t.shares * t.price - t.fee - t.tax as net,
             t.shares * t.price - t.fee - t.tax - t.cost_removed as pl
    ) v
    where (select count(*) from app.entries e where e.stock_trade_id = t.id)
            <> 1 + (t.side = 'sell' and v.pl <> 0)::int
       or not exists (
            select 1 from app.entries e join app.entry_lines l on l.entry_id = e.id and l.account_id = h.account_id
             where e.stock_trade_id = t.id and (e.voided_at is null) = (t.voided_at is null)
               and e.kind = case t.side when 'opening' then 'opening_balance' else 'transfer' end::app.entry_kind
               and l.amount = case t.side when 'buy' then t.shares * t.price + t.fee
                                          when 'opening' then t.shares * t.price else -v.net end)
       or (t.side = 'sell' and v.pl <> 0 and not exists (
            select 1 from app.entries e join app.entry_lines l on l.entry_id = e.id and l.account_id = h.account_id
             where e.stock_trade_id = t.id and e.kind = 'valuation' and (e.voided_at is null) = (t.voided_at is null)
               and l.amount = v.pl))
    union all
    select e.id from app.entries e
    join app.entry_lines l on l.entry_id = e.id
    join app.asset_details d on d.account_id = l.account_id and d.asset_kind = 'saham'
    where e.voided_at is null
      and not exists (select 1 from app.stock_trades t join app.stock_holdings h on h.id = t.holding_id
                       where t.id = e.stock_trade_id and h.account_id = l.account_id)
  ) x
  union all
  -- DQ20 trip (S15, 0146): entri hidup bertrip yang bukan pengeluaran biasa (bukan expense, talangan, atau
  -- dompet utama Kantor; K4) atau yang trip-nya bukan trip ruang entri itu. entries_trip_check, FK komposit,
  -- private.assert_entry_shape, dan fungsi tulis (0148) menjaga saat tulis; cek ini menangkap baris yang
  -- lolos jalan lain (UPDATE massal/restore manual). Total trip memakai kelas expense, jadi pelanggaran
  -- di sini akan memasukkan Kantor/talangan ke angka trip.
  select 'DQ20', 'error', count(*)::int from app.entries e
  where e.trip_id is not null and e.voided_at is null
    and (e.kind <> 'expense' or e.reimbursable
         or exists (select 1 from app.entry_lines l join app.accounts a on a.id = l.account_id
                     where l.entry_id = e.id and l.role = 'main' and a.pocket = 'kantor')
         or not exists (select 1 from app.trips t where t.id = e.trip_id and t.space_id = e.space_id))
$$;

create or replace function private.tg_obligation_xor() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_conflict boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dompetku.obligation:' || new.space_id));
  if tg_table_name = 'budgets' then
    if not new.wajib then
      return new;
    end if;
    select exists (
      select 1 from app.bills b
      join app.categories c on c.id = b.category_id
      where b.space_id = new.space_id and b.archived_at is null
        and coalesce(c.parent_id, c.id) = new.category_id
        and private.bill_due_in_label(b.space_id, b.day_of_month,
              private.bill_first_on(b.starts_on, b.created_at), b.ends_on, new.month)
    ) into v_conflict;
  else
    if new.archived_at is not null then
      return new;
    end if;
    -- Kunci baris kategori tagihan FOR SHARE sebelum membaca induknya (lihat 0117).
    perform 1 from app.categories c where c.id = new.category_id and c.space_id = new.space_id for share;
    select exists (
      select 1 from app.budgets bu
      join app.categories c on c.id = new.category_id
      where bu.space_id = new.space_id and bu.wajib
        and bu.category_id = coalesce(c.parent_id, c.id)
        and private.bill_due_in_label(new.space_id, new.day_of_month,
              private.bill_first_on(new.starts_on, new.created_at), new.ends_on, bu.month)
    ) into v_conflict;
  end if;
  if v_conflict then
    raise exception using errcode = 'DK422', message = 'obligation_double';
  end if;
  return new;
end $$;

drop function private.bill_due_in_label(uuid, smallint, date, date, date, text, smallint, date);

create or replace function api.cashflow_calendar(p_space_id uuid, p_days int default 30, p_today date default null)
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

drop function api.bill_list(uuid);
create function api.bill_list(p_space_id uuid)
returns table (bill_id uuid, name text, amount bigint, category_id uuid, account_id uuid,
               day_of_month smallint, starts_on date, ends_on date, archived boolean,
               next_due_on date, next_occurrence_id uuid)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  select b.id, b.name, b.amount, b.category_id, b.account_id, b.day_of_month, b.starts_on, b.ends_on,
         b.archived_at is not null, n.due_on, n.id
  from app.bills b
  left join lateral (
    select s.id, s.due_on from app.bill_schedule s
    where s.bill_id = b.id and not s.posted and s.skipped_at is null
    order by s.due_on limit 1
  ) n on b.archived_at is null
  where b.space_id = p_space_id
  order by b.archived_at is not null, n.due_on nulls last, b.name, b.id;
end $$;

drop function api.create_bill(uuid, uuid, text, bigint, uuid, smallint, date, date, uuid, text, smallint);
create or replace function api.create_bill(
  p_client_id uuid, p_space_id uuid, p_name text, p_amount bigint, p_category_id uuid,
  p_day_of_month smallint, p_starts_on date, p_ends_on date default null,
  p_account_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_id  uuid;
  v_r   jsonb;
begin
  perform app.assert_member(p_space_id);
  v_r := private.idem_begin(v_uid, p_client_id, 'create_bill', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'name', btrim(p_name), 'amount', p_amount,
           'category', p_category_id, 'day', p_day_of_month, 'starts', p_starts_on,
           'ends', p_ends_on, 'account', p_account_id)));
  if v_r is not null then
    return v_r;
  end if;
  perform private.check_bill(p_space_id, p_name, p_amount, p_category_id, p_day_of_month,
                             p_starts_on, p_ends_on, p_account_id);
  insert into app.bills (space_id, name, amount, category_id, account_id, day_of_month,
                         starts_on, ends_on, created_by, created_at, updated_at)
  values (p_space_id, btrim(p_name), p_amount, p_category_id, p_account_id, p_day_of_month,
          p_starts_on, p_ends_on, v_uid, app.now(), app.now())
  returning id into v_id;
  perform private.materialize_bill(v_id);
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object('bill_id', v_id));
end $$;

create or replace function private.materialize_bill(p_bill_id uuid, p_through date default null,
                                                    p_from date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_b       app.bills%rowtype;
  v_first   date;
  v_through date;
  v_n       int;
begin
  select * into v_b from app.bills where id = p_bill_id for share;
  if v_b.id is null or v_b.archived_at is not null then
    return 0;
  end if;
  v_through := coalesce(p_through, (
    select n.ends_on from app.pay_period(v_b.space_id, app.today()) c
    cross join lateral app.pay_period(v_b.space_id, c.ends_on + 1) n));
  v_through := least(v_through, app.today() + 400, coalesce(v_b.ends_on, v_through));
  v_first := greatest(private.bill_first_on(v_b.starts_on, v_b.created_at), coalesce(p_from, '-infinity'::date));
  if v_first > v_through then
    return 0;
  end if;
  insert into app.bill_occurrences (space_id, bill_id, due_on, amount)
  select v_b.space_id, v_b.id, d.due_on, v_b.amount
  from generate_series((v_first - (extract(day from v_first)::int - 1))::timestamp, v_through::timestamp,
                       interval '1 month') g
  cross join lateral (
    select g::date as m,
           least(g::date + (v_b.day_of_month - 1), (g + interval '1 month')::date - 1) as due_on
  ) d
  where d.due_on between v_first and v_through
    and not exists (select 1 from app.bill_occurrences o
                    where o.bill_id = v_b.id and o.due_on >= d.m
                      and o.due_on < (d.m + interval '1 month')::date)
  order by d.due_on
  on conflict (bill_id, due_on) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

drop function app.bill_dues(text, smallint, smallint, date, date, date);
alter table app.bills drop column repeat_every, drop column repeat_unit;

select private.own_api_functions();
