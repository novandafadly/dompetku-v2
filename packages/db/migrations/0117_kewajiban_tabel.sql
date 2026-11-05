-- migrate:up
-- S9 (IPD §5, plan S9 Task 4): tabel kewajiban. Tagihan rutin (app.bills, app.bill_occurrences),
-- anggaran (app.budgets), view app.bill_schedule, dan aturan satu kewajiban. Expand-only: tabel,
-- view, dan fungsi trigger baru; tg_category_depth diganti utuh (create or replace, tanda tangan sama).
--
-- - DDL disalin persis dari BSD §6 (bagian "Tagihan rutin" dan "Anggaran"), termasuk indeks untuk
--   setiap FK. Anggaran hanya kategori induk pengeluaran (FK ke categories (space_id, id, type,
--   is_root)); anggaran subkategori ditunda ke S10 (K5).
-- - bill_schedule disalin persis dari BSD §8 (security_invoker: RLS pemanggil berlaku).
-- - private.tg_category_depth: versi lengkap BSD §7 (cabang category_in_obligation) menggantikan
--   versi 0101 yang sengaja tanpa cabang itu (tabel belum ada di S5, BSD §16 "Catatan S5").
-- - private.tg_obligation_xor + trigger budgets_obligation_xor, bills_obligation_xor: BSD §7, dengan
--   SATU tambahan (lihat komentar di fungsi): cabang tagihan mengunci baris kategori tagihan
--   FOR SHARE sebelum membaca induknya. Tanpa itu, pindah induk kategori (update_category) yang
--   belum commit dan tagihan baru pada kategori itu bisa sama-sama lolos: trigger tagihan membaca
--   induk lama, lalu hanya menunggu cek FK; hasilnya tagihan aktif + anggaran wajib pada induk yang
--   sama (dibuktikan tests/99_konkurensi.sql). Aturan tetap per bulan kalender `month`; dengan K1
--   periode gajian bernama bulan yang sama, jadi perbandingan per `month` tetap benar.
-- - RLS ENABLE + FORCE, policy dan hak persis BSD §11: web SELECT; dompetku_api SELECT + INSERT,
--   UPDATE (bills, bill_occurrences) dan + DELETE (budgets); worker tanpa hak (lewat jobs.*);
--   auditor SELECT eksplisit (grant 0008 hanya untuk tabel saat itu); auditlog lewat default
--   privileges 0008. tg_append_only tidak dipasang (tabel diubah lewat api); updated_at dipelihara
--   fungsi api (Task 5, 6).
-- - Fungsi trigger milik dompetku_owner (DEFINER, BYPASSRLS: melihat semua ruang), tanpa EXECUTE
--   untuk role login (default privileges 0001). own_api_functions di akhir hanya penjaga template
--   (tidak ada fungsi api di file ini).

-- ===== Tagihan rutin (BSD §6) =====
create table app.bills (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null,
  name          text not null check (length(btrim(name)) between 1 and 60),
  amount        bigint not null check (amount > 0 and amount <= 10000000000000),
  category_id   uuid not null,
  category_type app.category_type not null default 'expense' check (category_type = 'expense'),
  account_id    uuid,                                     -- dompet bayar default
  day_of_month  smallint not null check (day_of_month between 1 and 31),
  starts_on     date not null,
  ends_on       date,
  archived_at   timestamptz,
  created_by    uuid not null references auth."user" (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (space_id, id),
  foreign key (space_id, category_id, category_type)
    references app.categories (space_id, id, type) on delete restrict,
  foreign key (space_id, account_id) references app.accounts (space_id, id) on delete restrict,
  check (ends_on is null or ends_on >= starts_on)
);
create index on app.bills (space_id, category_id, category_type);
create index on app.bills (space_id, account_id);
create index on app.bills (created_by);

create table app.bill_occurrences (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null,
  bill_id    uuid not null,
  due_on     date not null,
  amount     bigint not null check (amount > 0 and amount <= 10000000000000),
  entry_id   uuid,                                       -- terbayar = entri ini hidup
  skipped_at timestamptz,
  unique (bill_id, due_on),
  foreign key (space_id, bill_id)  references app.bills   (space_id, id) on delete restrict,
  foreign key (space_id, entry_id) references app.entries (space_id, id) on delete set null (entry_id),
  check (entry_id is null or skipped_at is null)
);
create index on app.bill_occurrences (space_id, due_on);
create index on app.bill_occurrences (space_id, bill_id);
create index on app.bill_occurrences (space_id, entry_id);

-- ===== Anggaran (hanya kategori induk pengeluaran; BSD §6) =====
create table app.budgets (
  space_id         uuid not null,
  category_id      uuid not null,
  category_type    app.category_type not null default 'expense' check (category_type = 'expense'),
  category_is_root boolean not null default true check (category_is_root),
  month            date not null check (extract(day from month) = 1),
  amount           bigint not null check (amount > 0 and amount <= 10000000000000),
  wajib            boolean not null default false,
  updated_by       uuid not null references auth."user" (id) on delete restrict,
  updated_at       timestamptz not null default now(),
  primary key (space_id, category_id, month),
  foreign key (space_id, category_id, category_type, category_is_root)
    references app.categories (space_id, id, type, is_root) on delete restrict
);
create index on app.budgets (space_id, month) where wajib;
create index on app.budgets (space_id, category_id, category_type, category_is_root);
create index on app.budgets (updated_by);

-- ===== Tagihan per jatuh tempo, bentuk Bill di packages/demo-data (BSD §8) =====
create view app.bill_schedule with (security_invoker = true) as
select o.id, o.space_id, o.bill_id, b.name, o.amount, o.due_on, o.skipped_at,
       (o.entry_id is not null and e.voided_at is null) as posted,
       (b.archived_at is not null) as bill_archived
from app.bill_occurrences o
join app.bills b on b.id = o.bill_id
left join app.entries e on e.id = o.entry_id;

-- ===== Penjaga kategori, versi lengkap BSD §7 =====
create or replace function private.tg_category_depth() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Pindah induk kategori yang dipakai kewajiban akan mengubah kategori induk pembanding XOR.
  if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id
     and (exists (select 1 from app.bills b where b.category_id = new.id)
          or exists (select 1 from app.budgets bu where bu.category_id = new.id)) then
    raise exception using errcode = 'DK422', message = 'category_in_obligation';
  end if;
  if new.parent_id is not null then
    if exists (select 1 from app.categories p where p.id = new.parent_id and p.parent_id is not null)
       or exists (select 1 from app.categories ch where ch.parent_id = new.id) then
      raise exception using errcode = 'DK422', message = 'category_depth';
    end if;
  end if;
  return new;
end $$;

-- ===== Satu kewajiban (BSD §7) =====
-- Kewajiban = tagihan ATAU anggaran wajib, tidak pernah keduanya (m0a-keputusan).
-- Dibandingkan pada kategori induk; berlaku per bulan.
create function private.tg_obligation_xor() returns trigger
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
        and b.starts_on < (new.month + interval '1 month')::date
        and (b.ends_on is null or b.ends_on >= new.month)
    ) into v_conflict;
  else
    if new.archived_at is not null then
      return new;
    end if;
    -- Tambahan atas BSD §7: kunci baris kategori tagihan sebelum membaca induknya. Pindah induk
    -- (update_category mengunci FOR UPDATE; UPDATE langsung mengunci baris sebelum trigger) yang
    -- belum commit membuat tagihan ini menunggu, lalu kueri di bawah (snapshot baru, READ
    -- COMMITTED) membandingkan dengan induk BARU. Sebaliknya, tagihan yang belum commit menahan
    -- pindah induk sampai tg_category_depth bisa melihatnya (category_in_obligation). FOR SHARE,
    -- bukan FOR KEY SHARE: pindah anak ke induk lain tidak mengubah kolom kunci (NO KEY UPDATE).
    -- Pemindah kategori tidak mengambil kunci kewajiban, jadi urutan ini tanpa deadlock.
    perform 1 from app.categories c where c.id = new.category_id for share;
    select exists (
      select 1 from app.budgets bu
      join app.categories c on c.id = new.category_id
      where bu.space_id = new.space_id and bu.wajib
        and bu.category_id = coalesce(c.parent_id, c.id)
        and bu.month >= (new.starts_on - (extract(day from new.starts_on)::int - 1))
        and (new.ends_on is null or bu.month <= new.ends_on)
    ) into v_conflict;
  end if;
  if v_conflict then
    raise exception using errcode = 'DK422', message = 'obligation_double';
  end if;
  return new;
end $$;
create trigger budgets_obligation_xor before insert or update on app.budgets
  for each row execute function private.tg_obligation_xor();
create trigger bills_obligation_xor before insert or update on app.bills
  for each row execute function private.tg_obligation_xor();

-- ===== RLS: aktif dan dipaksa; pola ruang (baca web/api, tulis hanya dompetku_api) (BSD §11) =====
do $$
declare t text;
begin
  foreach t in array array['app.bills', 'app.bill_occurrences', 'app.budgets'] loop
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

-- ===== Hak tabel (BSD §11) =====
grant select on app.bills, app.bill_occurrences, app.budgets, app.bill_schedule
  to dompetku_web, dompetku_api;
grant insert, update         on app.bills, app.bill_occurrences to dompetku_api;
grant insert, update, delete on app.budgets to dompetku_api;
-- 0008 memberi auditor SELECT pada tabel app yang ada saat itu; tabel dan view baru ditambah eksplisit.
grant select on app.bills, app.bill_occurrences, app.budgets, app.bill_schedule to dompetku_auditor;
-- dompetku_auditlog: default privileges 0008 sudah mencakup tabel baru di app (tes katalog).

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
revoke all on app.bills, app.bill_occurrences, app.budgets, app.bill_schedule
  from dompetku_web, dompetku_api, dompetku_auditor;
do $$
declare t text;
begin
  foreach t in array array['app.budgets', 'app.bill_occurrences', 'app.bills'] loop
    execute format('drop policy member_write on %s', t);
    execute format('drop policy member_read on %s', t);
  end loop;
end $$;
drop trigger bills_obligation_xor on app.bills;
drop trigger budgets_obligation_xor on app.budgets;
drop function private.tg_obligation_xor();
drop view app.bill_schedule;
drop table app.budgets;
drop table app.bill_occurrences;
drop table app.bills;

-- tg_category_depth kembali ke versi 0101 (tanpa cabang category_in_obligation).
create or replace function private.tg_category_depth() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_id is not null then
    if exists (select 1 from app.categories p where p.id = new.parent_id and p.parent_id is not null)
       or exists (select 1 from app.categories ch where ch.parent_id = new.id) then
      raise exception using errcode = 'DK422', message = 'category_depth';
    end if;
  end if;
  return new;
end $$;
