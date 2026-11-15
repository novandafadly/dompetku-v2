-- migrate:up
-- S12 (plan S12 Task 6, K3, K4; bingkai docs/design/s12-bingkai.md S12-ADR1 opsi C): tabel bagi
-- tagihan Bersama (patungan). Expand-only: dua constraint dan satu indeks parsial di app.accounts,
-- accounts_name_unique dibuat ulang tanpa dompet sistem, tiga tabel, satu view, satu tabel konteks di
-- private, dua fungsi trigger baru; app.report_class diganti utuh (tanda tangan sama).
--
-- - Dompet sistem: satu app.accounts ber-pocket `patungan` per ruang Bersama (CHECK
--   accounts_patungan_shared, indeks unik parsial accounts_patungan_one), nama `Patungan`, dibuat malas
--   oleh fungsi tulis patungan (0136, insert ... on conflict do nothing). accounts_name_unique tidak lagi
--   menghitung dompet sistem, jadi pengguna tetap boleh menamai dompet Bersama `Patungan`. Saldonya =
--   Σ pelunasan hidup yang belum diterima (selalu >= 0; DQ16 di 0136).
-- - app.splits (ruang shared): satu baris per tagihan patungan. in_entry_id = kaki space_transfer `in`
--   ke dompet sistem, expense_entry_id = pengeluaran Bersama dari dompet sistem (FK komposit ruang yang
--   sama). Kaki Pribadi pembayar (space_transfer `out`) dikenali lewat link_id kaki masuk, tanpa FK
--   lintas ruang (ruang Bersama tidak pernah menyimpan id dompet atau entri Pribadi). amount =
--   nominal tagihan (= |main| ketiga entri, dijaga fungsi + DQ16). payer_id = pencatat.
-- - app.split_shares: bagian per anggota (amount >= 0); Σ bagian = splits.amount (fungsi + DQ16).
-- - app.settlements (ruang shared): pelunasan satu sisi oleh from_user ke to_user. in_entry_id = kaki
--   masuk ke dompet sistem (kaki Pribadi pelunas lewat link_id); received_entry_id = kaki keluar dari
--   dompet sistem saat penerima menekan `Terima ke dompet` (null sampai diterima; batal terima
--   mengosongkannya lagi, pasangan lama tinggal sebagai entri batal yatim).
-- - app.member_balances (security_invoker): saldo per anggota = Σ bayar − Σ bagian + Σ pelunasan
--   dibayar − Σ pelunasan diterima, hanya baris hidup, tanpa pembulatan. Positif = anggota lain
--   berutang kepadanya. Nol-jumlah per ruang karena Σ bagian = nominal.
-- - Penutupan jalur generik (private.tg_split_guard, DEFINER milik owner): perubahan apa pun pada
--   entri/baris yang menyentuh dompet sistem, dan INSERT/UPDATE dompet sistem atau tagihan rutin yang
--   menunjuknya, hanya boleh di dalam transaksi yang sedang menjalankan fungsi patungan (baris
--   pg_current_xact_id() di private.split_ctx; hanya dompetku_api lewat fungsi 0136 dan jobs.purge_voided
--   yang bisa menulisnya, web tidak punya hak). Di luar itu: ubah/batal/pulihkan/pindah/purge entri
--   patungan = DK422 split_locked; memakai dompet sistem sebagai dompet biasa (catat, transfer, Cocokkan
--   saldo, arsip, tagihan rutin) = DK404 account_not_found (dompet sistem bukan pilihan pengguna). Kaki
--   Pribadi tertutup karena semua jalur generik membatalkan/purge kedua kaki space_transfer bersama.
-- - private.tg_member_leave_guard (DEFINER milik owner, BEFORE DELETE app.space_members): anggota tidak
--   bisa keluar dari Bersama selama saldo patungannya bukan nol atau masih ada pelunasan untuknya yang
--   belum diterima (keputusan pemilik 2026-11-14 butir 5) = DK422 split_unsettled.
-- - app.report_class (+ x_patungan): kaki space_transfer di dompet sistem = `x_patungan` (bagian "Tidak
--   termasuk"), bukan x_setoran_anggota/x_diambil_anggota, jadi Kontribusi S8 (0115) tidak berubah.
--   Pengeluaran dari dompet sistem tetap `expense` (Laporan, kategori, anggaran Bersama memuatnya tepat
--   sekali). Kaki Pribadi tetap x_setor_bersama/x_ambil_bersama.
-- - RLS ENABLE + FORCE pola ruang; web/api/auditor SELECT, tulis hanya dompetku_api (splits dan
--   settlements INSERT/UPDATE, split_shares INSERT; DELETE hanya purge milik owner).
-- Kode galat baru: DK422 split_locked, split_unsettled.

-- ===== Dompet sistem =====
alter table app.accounts
  add constraint accounts_patungan_shared check (pocket <> 'patungan' or space_kind = 'shared');
create unique index accounts_patungan_one on app.accounts (space_id) where pocket = 'patungan';
drop index app.accounts_name_unique;
create unique index accounts_name_unique on app.accounts (space_id, lower(btrim(name)))
  where archived_at is null and pocket <> 'patungan';

-- ===== Tagihan patungan =====
create table app.splits (
  id               uuid primary key default gen_random_uuid(),
  space_id         uuid not null,
  space_kind       app.space_kind not null default 'shared' check (space_kind = 'shared'),
  in_entry_id      uuid not null,
  expense_entry_id uuid not null,
  payer_id         uuid not null references auth."user" (id) on delete restrict,
  amount           bigint not null check (amount > 0 and amount <= 10000000000000),
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid references auth."user" (id) on delete restrict,
  unique (space_id, id),
  unique (space_id, in_entry_id),
  unique (space_id, expense_entry_id),
  foreign key (space_id, space_kind) references app.spaces (id, kind) on delete restrict,
  foreign key (space_id, in_entry_id) references app.entries (space_id, id) on delete restrict,
  foreign key (space_id, expense_entry_id) references app.entries (space_id, id) on delete restrict,
  check (in_entry_id <> expense_entry_id),
  check ((voided_at is null) = (voided_by is null))
);
create index on app.splits (space_id, space_kind);
create index on app.splits (payer_id);
create index on app.splits (voided_by);

create table app.split_shares (
  space_id uuid not null,
  split_id uuid not null,
  user_id  uuid not null references auth."user" (id) on delete restrict,
  amount   bigint not null check (amount >= 0 and amount <= 10000000000000),
  primary key (space_id, split_id, user_id),
  foreign key (space_id, split_id) references app.splits (space_id, id) on delete cascade
);
create index on app.split_shares (user_id);

-- ===== Pelunasan =====
create table app.settlements (
  id                uuid primary key default gen_random_uuid(),
  space_id          uuid not null,
  space_kind        app.space_kind not null default 'shared' check (space_kind = 'shared'),
  from_user         uuid not null references auth."user" (id) on delete restrict,
  to_user           uuid not null references auth."user" (id) on delete restrict,
  amount            bigint not null check (amount > 0 and amount <= 10000000000000),
  occurred_on       date not null check (occurred_on >= date '2000-01-01'),
  in_entry_id       uuid not null,
  received_entry_id uuid,
  received_at       timestamptz,
  created_at        timestamptz not null default now(),
  voided_at         timestamptz,
  voided_by         uuid references auth."user" (id) on delete restrict,
  unique (space_id, id),
  unique (space_id, in_entry_id),
  unique (space_id, received_entry_id),
  foreign key (space_id, space_kind) references app.spaces (id, kind) on delete restrict,
  foreign key (space_id, in_entry_id) references app.entries (space_id, id) on delete restrict,
  foreign key (space_id, received_entry_id) references app.entries (space_id, id) on delete restrict,
  check (from_user <> to_user),
  check ((received_entry_id is null) = (received_at is null)),
  check (voided_at is null or received_entry_id is null),
  check ((voided_at is null) = (voided_by is null))
);
create index on app.settlements (space_id, space_kind);
create index on app.settlements (from_user);
create index on app.settlements (to_user);
create index on app.settlements (voided_by);

-- ===== Saldo antar-anggota (tanpa kolom tersimpan) =====
create view app.member_balances with (security_invoker = true) as
select x.space_id, x.user_id, sum(x.amount)::bigint as balance
from (
  select s.space_id, s.payer_id as user_id, s.amount from app.splits s where s.voided_at is null
  union all
  select sh.space_id, sh.user_id, -sh.amount
    from app.split_shares sh
    join app.splits s on s.space_id = sh.space_id and s.id = sh.split_id
   where s.voided_at is null
  union all
  select t.space_id, t.from_user, t.amount from app.settlements t where t.voided_at is null
  union all
  select t.space_id, t.to_user, -t.amount from app.settlements t where t.voided_at is null
) x
group by x.space_id, x.user_id;

-- ===== Konteks fungsi patungan (lokal transaksi) =====
-- Baris = transaksi yang sedang menjalankan fungsi patungan (0136) atau purge. Fungsi menghapus barisnya
-- sebelum selesai; rollback membuangnya. Tanpa hak untuk web/worker, jadi tidak bisa dipalsukan.
create table private.split_ctx (xid xid8 primary key);

create function private.tg_split_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_acc uuid;
begin
  if exists (select 1 from private.split_ctx c where c.xid = pg_catalog.pg_current_xact_id()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_table_name = 'entry_lines' then
    v_acc := case when tg_op = 'DELETE' then old.account_id else new.account_id end;
    if exists (select 1 from app.accounts a where a.id = v_acc and a.pocket = 'patungan') then
      if tg_op = 'INSERT' then
        raise exception using errcode = 'DK404', message = 'account_not_found', detail = 'account_id';
      end if;
      raise exception using errcode = 'DK422', message = 'split_locked';
    end if;
  elsif tg_table_name = 'entries' then
    if exists (select 1 from app.entry_lines l join app.accounts a on a.id = l.account_id
                where l.entry_id = old.id and a.pocket = 'patungan') then
      raise exception using errcode = 'DK422', message = 'split_locked';
    end if;
  elsif tg_table_name = 'accounts' then
    if new.pocket = 'patungan' or (tg_op = 'UPDATE' and old.pocket = 'patungan') then
      raise exception using errcode = 'DK404', message = 'account_not_found', detail = 'account_id';
    end if;
  elsif tg_table_name = 'bills' then
    if exists (select 1 from app.accounts a where a.id = new.account_id and a.pocket = 'patungan') then
      raise exception using errcode = 'DK404', message = 'account_not_found', detail = 'account_id';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger split_guard before insert or delete on app.entry_lines
  for each row execute function private.tg_split_guard();
create trigger split_guard before update or delete on app.entries
  for each row when (old.space_kind = 'shared') execute function private.tg_split_guard();
create trigger split_guard before insert or update on app.accounts
  for each row execute function private.tg_split_guard();
create trigger split_guard before insert or update of account_id on app.bills
  for each row when (new.account_id is not null) execute function private.tg_split_guard();

-- Keluar dari Bersama (hapus baris anggota) ditolak selama patungan anggota itu belum impas.
create function private.tg_member_leave_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from app.spaces s where s.id = old.space_id and s.kind = 'shared')
     and (coalesce((select b.balance from app.member_balances b
                     where b.space_id = old.space_id and b.user_id = old.user_id), 0) <> 0
          or exists (select 1 from app.settlements t
                      where t.space_id = old.space_id and t.to_user = old.user_id
                        and t.voided_at is null and t.received_entry_id is null)) then
    raise exception using errcode = 'DK422', message = 'split_unsettled';
  end if;
  return old;
end $$;
create trigger member_leave_guard before delete on app.space_members
  for each row execute function private.tg_member_leave_guard();

-- ===== Kelas laporan (0130 + x_patungan) =====
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

-- ===== RLS: aktif dan dipaksa; pola ruang (baca web/api, tulis hanya dompetku_api) =====
do $$
declare t text;
begin
  foreach t in array array['app.splits', 'app.split_shares', 'app.settlements'] loop
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

-- ===== Hak =====
grant select on app.splits, app.split_shares, app.settlements, app.member_balances
  to dompetku_web, dompetku_api, dompetku_auditor;
grant insert, update on app.splits, app.settlements to dompetku_api;
grant insert on app.split_shares to dompetku_api;
grant select, insert, delete on private.split_ctx to dompetku_api;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
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
drop trigger member_leave_guard on app.space_members;
drop function private.tg_member_leave_guard();
drop trigger split_guard on app.bills;
drop trigger split_guard on app.accounts;
drop trigger split_guard on app.entries;
drop trigger split_guard on app.entry_lines;
drop function private.tg_split_guard();
drop table private.split_ctx;
drop view app.member_balances;
drop table app.settlements;
drop table app.split_shares;
drop table app.splits;
-- Dompet sistem dan entrinya (beserta kaki Pribadi pasangannya) dihapus sesudah split_guard dibuang,
-- supaya indeks lama tidak bentrok dengan dompet pengguna bernama `Patungan` dan tidak ada baris yatim.
-- GUC purge (0005) mengizinkan cascade ke entry_history yang append-only.
select pg_catalog.set_config('dompetku.purge', 'on', true);
delete from app.entries e
 where e.id in (select l.entry_id from app.entry_lines l join app.accounts a on a.id = l.account_id
                 where a.pocket = 'patungan')
    or e.link_id in (select p.link_id from app.entries p join app.entry_lines l on l.entry_id = p.id
                      join app.accounts a on a.id = l.account_id where a.pocket = 'patungan');
delete from app.accounts where pocket = 'patungan';
select pg_catalog.set_config('dompetku.purge', 'off', true);
drop index app.accounts_name_unique;
create unique index accounts_name_unique on app.accounts (space_id, lower(btrim(name)))
  where archived_at is null;
drop index app.accounts_patungan_one;
alter table app.accounts drop constraint accounts_patungan_shared;

select private.own_api_functions();
