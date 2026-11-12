-- migrate:up
-- S11 (IPD §6, plan S11 Task 3, K1, K2, K6; BSD:1008): tabel utang/piutang, bentuk entri, kelas
-- laporan. Expand-only: dua tabel, satu view, satu kolom nullable + tiga constraint di app.entries,
-- satu fungsi trigger baru; assert_entry_shape, report_class, dan dq_run diganti utuh (create or
-- replace, tanda tangan sama). Nilai enum debt_principal/debt_payment dari 0129 (file sendiri).
--
-- - app.contacts (K1): pihak lawan, hanya Pribadi (CHECK space_kind + FK (space_id, space_kind)).
--   Nama 1..60 sesudah btrim; unik tanpa beda huruf besar/spasi tepi di antara kontak aktif
--   (contacts_name_unique, pola accounts_name_unique 0109: server memetakan 23505 ke name_taken).
--   Arsip (archived_at), tidak pernah dihapus: utang lama tetap menunjuknya (FK restrict).
-- - app.debts: direction borrowed (saya berutang) | lent (piutang); title opsional 1..80 ("Untuk
--   apa"); principal 1..1e13; mode baru (ada entri pokok) | berjalan (K2: tanpa entri pokok, saldo dan
--   Laporan nol efek). Kontak lewat FK komposit (space_id, contact_id): ruang yang sama.
--   private.tg_debt_contact (BEFORE INSERT / UPDATE OF contact_id): kontak harus ada di ruang yang
--   sama (DK404 contact_not_found, sama untuk kontak ruang lain: tanpa membocorkan keberadaannya)
--   dan aktif (DK422 contact_archived). Baris kontak dikunci FOR SHARE, jadi arsip kontak yang
--   belum commit dan utang baru untuk kontak itu saling menunggu (READ COMMITTED membaca ulang).
--   Arsip kontak sesudahnya tidak mengubah utang lama (trigger hanya saat contact_id ditulis).
--   Hapus utang = voided_at/voided_by (K5, api di 0131); tanpa kolom sisa tersimpan.
-- - app.entries.debt_id: FK komposit (space_id, debt_id) -> debts; CHECK kind utang <=> debt_id,
--   CHECK kind utang hanya Pribadi (B10, pertahanan berlapis di atas FK ke debts yang Pribadi).
-- - private.assert_entry_shape (+ cabang utang): satu line main, tanpa counter/fee, dompet bukan
--   Kantor (K6); pokok: borrowed main > 0, lent main < 0, hanya mode baru, |main| = principal;
--   cicilan: borrowed main < 0, lent main > 0; entri hidup hanya untuk utang hidup. Σ cicilan <=
--   principal dijaga api.pay_debt di bawah kunci baris utang dan DQ05 (0131), bukan di sini
--   (trigger per entri tidak melihat transaksi paralel).
-- - app.report_class (+ x_pokok_utang, x_pelunasan_utang; BSD:1008): tidak NULL untuk kombinasi apa
--   pun (00_katalog #9). period_summary, excluded_summary ("Tidak termasuk": kelas x_*), dan
--   export_entries membaca report_lines, jadi kelas baru ikut tanpa perubahan; Pemasukan/
--   Pengeluaran, anggaran, laju belanja, dan Kontribusi menyaring kelas income/expense/expense_fee/
--   x_setoran..., jadi tidak berubah (I6).
-- - app.debt_balances (security_invoker): paid = Σ |main| cicilan hidup, remaining = principal -
--   paid, untuk semua utang (termasuk terhapus; pemanggil menyaring debts.voided_at).
-- - private.dq_run: DQ03 mengenal kind utang (tanpa itu setiap entri utang = pelanggaran lewat
--   cabang else). Sisanya sama dengan 0126.
-- - RLS ENABLE + FORCE pola ruang; web/api/auditor SELECT, tulis hanya dompetku_api (INSERT,
--   UPDATE; tanpa DELETE). updated_at/updated_by dipelihara fungsi api (pola bills).

-- ===== Kontak =====
create table app.contacts (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null,
  space_kind  app.space_kind not null default 'personal' check (space_kind = 'personal'),
  name        text not null check (length(btrim(name)) between 1 and 60),
  archived_at timestamptz,
  created_by  uuid not null references auth."user" (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_by  uuid not null references auth."user" (id) on delete restrict,
  updated_at  timestamptz not null default now(),
  unique (space_id, id),
  foreign key (space_id, space_kind) references app.spaces (id, kind) on delete restrict
);
create unique index contacts_name_unique on app.contacts (space_id, lower(btrim(name)))
  where archived_at is null;
create index on app.contacts (space_id, space_kind);
create index on app.contacts (created_by);
create index on app.contacts (updated_by);

-- ===== Utang/piutang =====
create table app.debts (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null,
  space_kind  app.space_kind not null default 'personal' check (space_kind = 'personal'),
  contact_id  uuid not null,
  direction   text not null check (direction in ('borrowed', 'lent')),
  title       text check (length(btrim(title)) between 1 and 80),
  principal   bigint not null check (principal > 0 and principal <= 10000000000000),
  mode        text not null check (mode in ('baru', 'berjalan')),
  opened_on   date not null check (opened_on >= date '2000-01-01'),
  note        text check (length(btrim(note)) between 1 and 200),
  created_by  uuid not null references auth."user" (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_by  uuid not null references auth."user" (id) on delete restrict,
  updated_at  timestamptz not null default now(),
  voided_at   timestamptz,
  voided_by   uuid references auth."user" (id) on delete restrict,
  unique (space_id, id),
  foreign key (space_id, space_kind) references app.spaces (id, kind) on delete restrict,
  foreign key (space_id, contact_id) references app.contacts (space_id, id) on delete restrict,
  check ((voided_at is null) = (voided_by is null))
);
create index on app.debts (space_id, space_kind);
create index on app.debts (space_id, contact_id);
create index on app.debts (created_by);
create index on app.debts (updated_by);
create index on app.debts (voided_by);

create function private.tg_debt_contact() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_archived timestamptz;
begin
  select c.archived_at into v_archived from app.contacts c
   where c.id = new.contact_id and c.space_id = new.space_id for share;
  if not found then
    raise exception using errcode = 'DK404', message = 'contact_not_found';
  end if;
  if v_archived is not null then
    raise exception using errcode = 'DK422', message = 'contact_archived';
  end if;
  return new;
end $$;
create trigger debt_contact before insert or update of contact_id on app.debts
  for each row execute function private.tg_debt_contact();

-- ===== Entri utang =====
alter table app.entries add column debt_id uuid;
alter table app.entries add constraint entries_debt_fk
  foreign key (space_id, debt_id) references app.debts (space_id, id) on delete restrict;
alter table app.entries add constraint entries_debt_check
  check ((kind in ('debt_principal', 'debt_payment')) = (debt_id is not null));
alter table app.entries add constraint entries_debt_personal_check
  check (kind not in ('debt_principal', 'debt_payment') or space_kind = 'personal');
create index on app.entries (space_id, debt_id);

-- Matriks bentuk lines per kind (0101 + cabang utang 0130).
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

-- ===== Kelas laporan (0102 + x_pokok_utang, x_pelunasan_utang) =====
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

-- ===== Sisa utang (tanpa kolom tersimpan) =====
create view app.debt_balances with (security_invoker = true) as
select d.space_id, d.id as debt_id, d.principal,
       coalesce(sum(abs(l.amount)), 0)::bigint as paid,
       (d.principal - coalesce(sum(abs(l.amount)), 0))::bigint as remaining
from app.debts d
left join app.entries e on e.space_id = d.space_id and e.debt_id = d.id
                       and e.kind = 'debt_payment' and e.voided_at is null
left join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id and l.role = 'main'
group by d.space_id, d.id;

-- ===== Cek kualitas data: DQ03 mengenal kind utang (selebihnya = 0126) =====
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
          when e.kind = 'debt_principal' then
               s.n_counter = 0 and s.n_fee = 0
               and case d.direction when 'borrowed' then s.m_amt > 0 when 'lent' then s.m_amt < 0 end
          when e.kind = 'debt_payment' then
               s.n_counter = 0 and s.n_fee = 0
               and case d.direction when 'borrowed' then s.m_amt < 0 when 'lent' then s.m_amt > 0 end
          else false
        end, false)
  ) x
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
$$;

-- ===== RLS: aktif dan dipaksa; pola ruang (baca web/api, tulis hanya dompetku_api) =====
do $$
declare t text;
begin
  foreach t in array array['app.contacts', 'app.debts'] loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
    execute format(
      'create policy member_read on %s for select to dompetku_web, dompetku_api
         using (space_id = any ((select app.my_space_ids())::uuid[]))', t);
    execute format(
      'create policy member_write on %s for all to dompetku_api
         using (space_id = any ((select app.my_space_ids())::uuid[]))
         with check (space_id = any ((select app.my_space_ids())::uuid[]))', t);
  end loop;
end $$;

-- ===== Hak tabel =====
grant select on app.contacts, app.debts, app.debt_balances to dompetku_web, dompetku_api;
grant insert, update on app.contacts, app.debts to dompetku_api;
-- Auditor: tabel dan view baru eksplisit (grant 0008 hanya tabel saat itu); DQ03 membaca app.debts.
grant select on app.contacts, app.debts, app.debt_balances to dompetku_auditor;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
revoke all on app.contacts, app.debts, app.debt_balances
  from dompetku_web, dompetku_api, dompetku_auditor;
do $$
declare t text;
begin
  foreach t in array array['app.debts', 'app.contacts'] loop
    execute format('drop policy member_write on %s', t);
    execute format('drop policy member_read on %s', t);
  end loop;
end $$;
drop view app.debt_balances;
alter table app.entries drop constraint entries_debt_personal_check;
alter table app.entries drop constraint entries_debt_check;
alter table app.entries drop constraint entries_debt_fk;
alter table app.entries drop column debt_id;
drop trigger debt_contact on app.debts;
drop function private.tg_debt_contact();
drop table app.debts;
drop table app.contacts;

-- Fungsi yang diganti kembali ke badan sebelumnya (0126, 0102, 0101).
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
  -- DQ03 bentuk line per kind, entri hidup (aturan private.assert_entry_shape, 0101)
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
          else false
        end, false)
  ) x
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

create or replace function private.assert_entry_shape(p_entry_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e  app.entries%rowtype;
  m  app.entry_lines%rowtype;
  c  app.entry_lines%rowtype;
  f  app.entry_lines%rowtype;
  ok boolean;
begin
  select * into e from app.entries where id = p_entry_id;
  if not found then
    return;
  end if;
  select * into m from app.entry_lines where entry_id = p_entry_id and role = 'main';
  select * into c from app.entry_lines where entry_id = p_entry_id and role = 'counter';
  select * into f from app.entry_lines where entry_id = p_entry_id and role = 'fee';

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
    else false
  end;
  if not ok then
    raise exception using errcode = 'DK500', message = 'entry_shape_invalid';
  end if;
  if e.kind = 'space_transfer' then
    perform private.assert_space_transfer_pair(e.link_id);
  end if;
end $$;
