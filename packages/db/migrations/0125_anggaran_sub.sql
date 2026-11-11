-- migrate:up
-- S10 (IPD §5, plan S10 Task 2, K1 sampai K3; BSD §15 butir 1): anggaran subkategori, skema dan
-- fungsi tulis. Expand dalam arti fungsi: tabel app.budgets kehilangan kolom category_is_root (hanya
-- fungsi api.* yang menulisnya, tidak ada pembaca lain); tanda tangan fungsi api tidak berubah.
--
-- - Skema: CHECK category_is_root, FK (space_id, category_id, category_type, category_is_root) dan
--   kolom category_is_root dibuang; FK baru (space_id, category_id, category_type) ke
--   app.categories (space_id, id, type); indeks pengganti (ikut melayani FK). Tipe tetap expense.
-- - Pohon anggaran (K1 sampai K3), dijaga trigger DEFINER milik owner (melihat semua ruang):
--   * rincian (sub) hanya boleh bila induknya punya anggaran di label yang sama
--     (DK422 parent_budget_required);
--   * jumlah anggaran rincian satu induk <= anggaran induk (DK422 sub_exceeds_parent), dinilai dari
--     dua arah: menulis rincian, dan menurunkan anggaran induk di bawah jumlah rinciannya;
--   * rincian tidak boleh wajib (DK422 sub_not_wajib): XOR dengan tagihan tetap dinilai di induk;
--   * kunci baris (space_id, category_id, month) tidak boleh diubah (DK422 budget_key_immutable);
--   * menghapus anggaran induk menghapus anggaran rinciannya di label itu (AFTER DELETE).
--   Semua penulisan satu ruang diserialkan kunci advisory 'dompetku.budget:<ruang>'; di baris yang
--   sama trigger budgets_obligation_xor (kunci 'dompetku.obligation:') jalan lebih dulu (urutan
--   nama trigger), jadi urutan kunci selalu obligation lalu budget (tanpa siklus tunggu). BEFORE
--   DELETE hanya mengambil kunci supaya hapus induk dan tulis rincian paralel tidak meninggalkan
--   rincian yatim; pemotongan rincian dilakukan AFTER DELETE (BEFORE yang mengubah baris lain pada
--   perintah yang sama membuat "tuple already modified" pada DELETE massal).
-- - api.set_budget: cek category_not_root dibuang (aturan pohon ada di trigger). Kategori tetap
--   harus pengeluaran, aktif, dan satu ruang. api.delete_budget tidak berubah (cascade lewat trigger).
-- - api.copy_budgets (tanda tangan sama): baris asal diurut induk dulu lalu rincian; rincian yang
--   tidak bisa disalin karena aturan pohon (induk tidak ikut tersalin atau di tujuan lebih kecil)
--   dihitung skipped_conflict (Task 3 menambah penyesuaian persen dan skipped_parent).
-- - api.budget_progress (dipakai safe_to_spend dan Laporan): hanya anggaran induk (rincian sudah
--   termasuk di realisasi induk lewat root_category_id; tidak boleh dijumlah dua kali).

alter table app.budgets drop constraint budgets_space_id_category_id_category_type_category_is_roo_fkey;
alter table app.budgets drop constraint budgets_category_is_root_check;
drop index app.budgets_space_id_category_id_category_type_category_is_root_idx;
alter table app.budgets drop column category_is_root;
alter table app.budgets add foreign key (space_id, category_id, category_type)
  references app.categories (space_id, id, type) on delete restrict;
create index on app.budgets (space_id, category_id, category_type);

create function private.tg_budget_tree() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_space   uuid := case tg_op when 'DELETE' then old.space_id else new.space_id end;
  v_parent  uuid;
  v_pamount bigint;
  v_sum     bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dompetku.budget:' || v_space));
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.space_id, new.category_id, new.month)
                          is distinct from (old.space_id, old.category_id, old.month) then
    raise exception using errcode = 'DK422', message = 'budget_key_immutable';
  end if;
  select c.parent_id into v_parent
    from app.categories c where c.id = new.category_id and c.space_id = new.space_id;
  if v_parent is null then
    -- Induk (atau kategori yang tidak ada: FK yang menolak): jumlah rincian tidak melebihi induk.
    select coalesce(sum(b.amount), 0) into v_sum
      from app.budgets b join app.categories c on c.id = b.category_id
     where b.space_id = new.space_id and b.month = new.month and c.parent_id = new.category_id;
    if v_sum > new.amount then
      raise exception using errcode = 'DK422', message = 'sub_exceeds_parent';
    end if;
    return new;
  end if;
  if new.wajib then
    raise exception using errcode = 'DK422', message = 'sub_not_wajib';
  end if;
  select b.amount into v_pamount
    from app.budgets b
   where b.space_id = new.space_id and b.category_id = v_parent and b.month = new.month;
  if v_pamount is null then
    raise exception using errcode = 'DK422', message = 'parent_budget_required';
  end if;
  select coalesce(sum(b.amount), 0) into v_sum
    from app.budgets b join app.categories c on c.id = b.category_id
   where b.space_id = new.space_id and b.month = new.month and c.parent_id = v_parent
     and b.category_id <> new.category_id;
  if v_sum + new.amount > v_pamount then
    raise exception using errcode = 'DK422', message = 'sub_exceeds_parent';
  end if;
  return new;
end $$;
create trigger budgets_tree before insert or update or delete on app.budgets
  for each row execute function private.tg_budget_tree();

-- Menghapus anggaran induk menghapus anggaran rinciannya di label yang sama.
create function private.tg_budget_cascade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from app.budgets b
   using app.categories c
   where b.space_id = old.space_id and b.month = old.month
     and c.id = b.category_id and c.parent_id = old.category_id;
  return old;
end $$;
create trigger budgets_tree_cascade after delete on app.budgets
  for each row execute function private.tg_budget_cascade();

-- ===== Anggaran: atur (rincian sah; aturan pohon di trigger) =====
create or replace function api.set_budget(
  p_space_id uuid, p_category_id uuid, p_month date, p_amount bigint, p_wajib boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_c   app.categories%rowtype;
begin
  perform app.assert_member(p_space_id);
  perform private.check_amount(p_amount, 'amount');
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'month';
  end if;
  select * into v_c from app.categories c
   where c.id = p_category_id and c.space_id = p_space_id and c.type = 'expense'
   for share;
  if v_c.id is null then
    raise exception using errcode = 'DK404', message = 'category_not_found', detail = 'category_id';
  end if;
  if v_c.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'category_archived';
  end if;
  insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by, updated_at)
  values (p_space_id, p_category_id, p_month, p_amount, coalesce(p_wajib, false), v_uid, app.now())
  on conflict (space_id, category_id, month) do update
     set amount = excluded.amount, wajib = excluded.wajib,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;

-- ===== Anggaran: salin (induk dulu, lalu rincian) =====
create or replace function api.copy_budgets(p_space_id uuid, p_from_month date, p_to_month date)
returns table (copied int, skipped_existing int, skipped_conflict int, skipped_archived int)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := private.require_user();
  v_b        app.budgets%rowtype;
  v_archived boolean;
  v_copied   int := 0;
  v_exist    int := 0;
  v_conflict int := 0;
  v_arch     int := 0;
begin
  perform app.assert_member(p_space_id);
  if p_from_month is null or extract(day from p_from_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'from_month';
  end if;
  if p_to_month is null or extract(day from p_to_month) <> 1 or p_to_month = p_from_month then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'to_month';
  end if;
  for v_b in
    select b.* from app.budgets b
    join app.categories c on c.id = b.category_id
    where b.space_id = p_space_id and b.month = p_from_month
    order by (c.parent_id is not null), b.category_id
  loop
    if exists (select 1 from app.budgets t
               where t.space_id = p_space_id and t.category_id = v_b.category_id
                 and t.month = p_to_month) then
      v_exist := v_exist + 1;
      continue;
    end if;
    select c.archived_at is not null into v_archived
      from app.categories c where c.id = v_b.category_id and c.space_id = p_space_id
      for share;
    if v_archived then
      v_arch := v_arch + 1;
      continue;
    end if;
    begin
      insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by, updated_at)
      values (p_space_id, v_b.category_id, p_to_month, v_b.amount, v_b.wajib, v_uid, app.now())
      on conflict (space_id, category_id, month) do nothing;
      if found then
        v_copied := v_copied + 1;
      else
        -- Disisipkan transaksi paralel sesudah cek di atas: sama dengan sudah ada.
        v_exist := v_exist + 1;
      end if;
    exception when sqlstate 'DK422' then
      if sqlerrm not in ('obligation_double', 'parent_budget_required', 'sub_exceeds_parent') then
        raise;
      end if;
      v_conflict := v_conflict + 1;
    end;
  end loop;
  return query select v_copied, v_exist, v_conflict, v_arch;
end $$;

-- ===== Realisasi anggaran: hanya anggaran induk =====
create or replace function api.budget_progress(p_space_id uuid, p_month date)
returns table (category_id uuid, amount bigint, wajib boolean, spent bigint, pct int, remaining bigint)
language plpgsql stable set search_path = '' as $$
declare
  v_from date;
  v_to   date;
begin
  perform app.assert_member(p_space_id);
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'month';
  end if;
  select l.starts_on, l.ends_on into v_from, v_to from app.period_of_label(p_space_id, p_month) l;
  return query
  -- amt = realisasi penuh; amt_wajib (untuk anggaran wajib) tanpa entri bayar tagihan yang
  -- kemunculannya jatuh tempo di luar periode ini (review Task 7: bayar tagihan lewat periode lalu
  -- atau bayar di muka tidak boleh memakan cadangan wajib periode ini dan menaikkan aman dipakai).
  with spent as (
    select r.root_category_id, (-sum(r.amount))::bigint as amt,
           (-coalesce(sum(r.amount) filter (where not exists (
              select 1 from app.bill_occurrences o
              where o.space_id = r.space_id and o.entry_id = r.entry_id
                and o.due_on not between v_from and v_to)), 0))::bigint as amt_wajib
    from app.report_lines r
    where r.space_id = p_space_id and r.report_class = 'expense'
      and r.occurred_on between v_from and v_to
    group by r.root_category_id
  )
  select b.category_id, b.amount, b.wajib, x.amt,
         least(floor(x.amt * 100.0 / b.amount), 2147483647)::int,
         (b.amount - x.amt)::bigint
  from app.budgets b
  left join spent s on s.root_category_id = b.category_id
  cross join lateral (select coalesce(case when b.wajib then s.amt_wajib else s.amt end, 0)::bigint as amt) x
  where b.space_id = p_space_id and b.month = p_month
    and not exists (select 1 from app.categories c where c.id = b.category_id and c.parent_id is not null)
  order by b.category_id;
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
drop trigger budgets_tree_cascade on app.budgets;
drop trigger budgets_tree on app.budgets;
drop function private.tg_budget_cascade();
drop function private.tg_budget_tree();
-- Anggaran rincian tidak ada di skema lama.
delete from app.budgets b using app.categories c
 where c.id = b.category_id and c.parent_id is not null;
create or replace function api.set_budget(
  p_space_id uuid, p_category_id uuid, p_month date, p_amount bigint, p_wajib boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_c   app.categories%rowtype;
begin
  perform app.assert_member(p_space_id);
  perform private.check_amount(p_amount, 'amount');
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'month';
  end if;
  select * into v_c from app.categories c
   where c.id = p_category_id and c.space_id = p_space_id and c.type = 'expense'
   for share;
  if v_c.id is null then
    raise exception using errcode = 'DK404', message = 'category_not_found', detail = 'category_id';
  end if;
  if v_c.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'category_archived';
  end if;
  if v_c.parent_id is not null then
    raise exception using errcode = 'DK422', message = 'category_not_root';
  end if;
  insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by, updated_at)
  values (p_space_id, p_category_id, p_month, p_amount, coalesce(p_wajib, false), v_uid, app.now())
  on conflict (space_id, category_id, month) do update
     set amount = excluded.amount, wajib = excluded.wajib,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;
create or replace function api.copy_budgets(p_space_id uuid, p_from_month date, p_to_month date)
returns table (copied int, skipped_existing int, skipped_conflict int, skipped_archived int)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := private.require_user();
  v_b        app.budgets%rowtype;
  v_archived boolean;
  v_copied   int := 0;
  v_exist    int := 0;
  v_conflict int := 0;
  v_arch     int := 0;
begin
  perform app.assert_member(p_space_id);
  if p_from_month is null or extract(day from p_from_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'from_month';
  end if;
  if p_to_month is null or extract(day from p_to_month) <> 1 or p_to_month = p_from_month then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'to_month';
  end if;
  for v_b in
    select * from app.budgets b
    where b.space_id = p_space_id and b.month = p_from_month
    order by b.category_id
  loop
    if exists (select 1 from app.budgets t
               where t.space_id = p_space_id and t.category_id = v_b.category_id
                 and t.month = p_to_month) then
      v_exist := v_exist + 1;
      continue;
    end if;
    select c.archived_at is not null into v_archived
      from app.categories c where c.id = v_b.category_id and c.space_id = p_space_id
      for share;
    if v_archived then
      v_arch := v_arch + 1;
      continue;
    end if;
    begin
      insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by, updated_at)
      values (p_space_id, v_b.category_id, p_to_month, v_b.amount, v_b.wajib, v_uid, app.now())
      on conflict (space_id, category_id, month) do nothing;
      if found then
        v_copied := v_copied + 1;
      else
        -- Disisipkan transaksi paralel sesudah cek di atas: sama dengan sudah ada.
        v_exist := v_exist + 1;
      end if;
    exception when sqlstate 'DK422' then
      if sqlerrm <> 'obligation_double' then
        raise;
      end if;
      v_conflict := v_conflict + 1;
    end;
  end loop;
  return query select v_copied, v_exist, v_conflict, v_arch;
end $$;
create or replace function api.budget_progress(p_space_id uuid, p_month date)
returns table (category_id uuid, amount bigint, wajib boolean, spent bigint, pct int, remaining bigint)
language plpgsql stable set search_path = '' as $$
declare
  v_from date;
  v_to   date;
begin
  perform app.assert_member(p_space_id);
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'month';
  end if;
  select l.starts_on, l.ends_on into v_from, v_to from app.period_of_label(p_space_id, p_month) l;
  return query
  -- amt = realisasi penuh; amt_wajib (untuk anggaran wajib) tanpa entri bayar tagihan yang
  -- kemunculannya jatuh tempo di luar periode ini (review Task 7: bayar tagihan lewat periode lalu
  -- atau bayar di muka tidak boleh memakan cadangan wajib periode ini dan menaikkan aman dipakai).
  with spent as (
    select r.root_category_id, (-sum(r.amount))::bigint as amt,
           (-coalesce(sum(r.amount) filter (where not exists (
              select 1 from app.bill_occurrences o
              where o.space_id = r.space_id and o.entry_id = r.entry_id
                and o.due_on not between v_from and v_to)), 0))::bigint as amt_wajib
    from app.report_lines r
    where r.space_id = p_space_id and r.report_class = 'expense'
      and r.occurred_on between v_from and v_to
    group by r.root_category_id
  )
  select b.category_id, b.amount, b.wajib, x.amt,
         least(floor(x.amt * 100.0 / b.amount), 2147483647)::int,
         (b.amount - x.amt)::bigint
  from app.budgets b
  left join spent s on s.root_category_id = b.category_id
  cross join lateral (select coalesce(case when b.wajib then s.amt_wajib else s.amt end, 0)::bigint as amt) x
  where b.space_id = p_space_id and b.month = p_month
  order by b.category_id;
end $$;
drop index app.budgets_space_id_category_id_category_type_idx;
alter table app.budgets drop constraint budgets_space_id_category_id_category_type_fkey;
alter table app.budgets add column category_is_root boolean not null default true
  constraint budgets_category_is_root_check check (category_is_root);
alter table app.budgets add foreign key (space_id, category_id, category_type, category_is_root)
  references app.categories (space_id, id, type, is_root) on delete restrict;
create index on app.budgets (space_id, category_id, category_type, category_is_root);
