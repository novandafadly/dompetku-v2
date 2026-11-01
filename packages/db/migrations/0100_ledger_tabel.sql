-- migrate:up
-- BSD §6, bagian S5 (ledger): enum ledger, dompet, kategori, jurnal (entries + entry_lines),
-- riwayat, tombstone, dan jobs.job_runs (worker minimal). Disalin persis dari BSD.
-- Tagihan, anggaran, dan hari tanpa pengeluaran (bills, bill_occurrences, budgets, no_spend_days)
-- menyusul di sprint fiturnya (IPD S6/S9). categories ikut sekarang karena entries punya FK
-- komposit ke kategori; fungsi api kategori menyusul di S6.
-- Nomor 0100+: 0009 sampai 0099 dicadangkan untuk migrasi Better Auth (README).
create type app.pocket          as enum ('operasional', 'tabungan', 'kantor');
create type app.wallet_type     as enum ('cash', 'bank', 'ewallet');
create type app.category_type   as enum ('income', 'expense');
create type app.entry_kind      as enum ('income', 'expense', 'transfer', 'space_transfer',
                                         'opening_balance', 'adjustment', 'reimbursement');
create type app.line_role       as enum ('main', 'counter', 'fee');
create type app.entry_direction as enum ('out', 'in');
create type app.history_op      as enum ('create', 'update', 'void', 'restore');

-- ===== Dompet =====
create table app.accounts (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null,
  space_kind  app.space_kind not null,
  name        text not null check (length(btrim(name)) between 1 and 60),
  pocket      app.pocket not null,
  wallet_type app.wallet_type not null,
  opened_on   date not null check (opened_on >= date '2000-01-01'),
  archived_at timestamptz,
  sort_order  int not null default 0,
  created_by  uuid not null references auth."user" (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (space_id, id),
  foreign key (space_id, space_kind) references app.spaces (id, kind) on delete restrict,
  check (pocket <> 'kantor' or space_kind = 'personal')
);
create index on app.accounts (space_id, space_kind);
create index on app.accounts (created_by);

-- ===== Kategori (2 level, tipe anak = tipe induk) =====
create table app.categories (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references app.spaces on delete restrict,
  parent_id   uuid,
  type        app.category_type not null,
  is_root     boolean generated always as (parent_id is null) stored,
  name        text not null check (length(btrim(name)) between 1 and 40),
  icon        text not null check (icon ~ '^[A-Z][A-Za-z0-9]{0,39}$'),
  is_system   boolean not null default false,
  archived_at timestamptz,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (space_id, id),
  unique (space_id, id, type),
  unique (space_id, id, type, is_root),
  foreign key (space_id, parent_id, type) references app.categories (space_id, id, type),
  check (parent_id is distinct from id)
);
create unique index categories_name_unique on app.categories
  (space_id, type, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where archived_at is null;
create index on app.categories (space_id, parent_id, type);

-- ===== Jurnal =====
create table app.entries (
  id                  uuid primary key default gen_random_uuid(),
  space_id            uuid not null,
  space_kind          app.space_kind not null,
  kind                app.entry_kind not null,
  occurred_on         date not null check (occurred_on >= date '2000-01-01'),
  description         text check (length(description) between 1 and 200),
  category_id         uuid,
  category_type       app.category_type generated always as (
                        case kind when 'income'  then 'income'::app.category_type
                                  when 'expense' then 'expense'::app.category_type end) stored,
  reimbursable        boolean not null default false,
  reimburses_entry_id uuid,
  link_id             uuid,
  direction           app.entry_direction,
  shared_note         text check (length(shared_note) between 1 and 200),
  version             int not null default 1 check (version >= 1),
  voided_at           timestamptz,
  voided_by           uuid references auth."user" (id) on delete restrict,
  created_by          uuid not null references auth."user" (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_by          uuid not null references auth."user" (id) on delete restrict,
  updated_at          timestamptz not null default now(),
  unique (space_id, id),
  foreign key (space_id, space_kind) references app.spaces (id, kind) on delete restrict,
  foreign key (space_id, category_id, category_type)
    references app.categories (space_id, id, type) on delete restrict,
  foreign key (space_id, reimburses_entry_id) references app.entries (space_id, id) on delete restrict,
  check (category_id is null or kind in ('income', 'expense')),
  check (not reimbursable or (kind = 'expense' and space_kind = 'personal')),
  check ((kind = 'reimbursement') = (reimburses_entry_id is not null)),
  check (kind <> 'reimbursement' or space_kind = 'personal'),
  check ((kind = 'space_transfer') = (link_id is not null)),
  check ((kind = 'space_transfer') = (direction is not null)),
  -- Deskripsi transfer antar ruang hanya di kaki Pribadi; Bersama hanya membawa shared_note.
  check (kind <> 'space_transfer' or space_kind = 'personal' or description is null),
  check (shared_note is null or (kind = 'space_transfer' and space_kind = 'shared')),
  check ((voided_at is null) = (voided_by is null))
);
create unique index entries_link_space on app.entries (link_id, space_id) where link_id is not null;
create index entries_list on app.entries (space_id, occurred_on desc, created_at desc, id desc)
  where voided_at is null;
create index on app.entries (space_id, category_id, category_type);
create index on app.entries (space_id, reimburses_entry_id);
create index on app.entries (space_id, space_kind);
create index on app.entries (voided_at) where voided_at is not null;
create index on app.entries (created_by);
create index on app.entries (updated_by);
create index on app.entries (voided_by);

create table app.entry_lines (
  entry_id   uuid not null,
  space_id   uuid not null,
  role       app.line_role not null,
  account_id uuid not null,
  amount     bigint not null
             check (amount <> 0 and amount between -10000000000000 and 10000000000000),
  primary key (entry_id, role),
  foreign key (space_id, entry_id)   references app.entries  (space_id, id) on delete cascade,
  foreign key (space_id, account_id) references app.accounts (space_id, id) on delete restrict
);
create index entry_lines_balance on app.entry_lines (account_id) include (amount, entry_id);
create index entry_lines_space   on app.entry_lines (space_id, entry_id);
create index on app.entry_lines (space_id, account_id);

create table app.entry_history (
  entry_id   uuid not null,
  space_id   uuid not null,
  version    int not null check (version >= 1),
  op         app.history_op not null,
  snapshot   jsonb not null,                          -- entri + lines SESUDAH op
  changed_by uuid not null references auth."user" (id) on delete restrict,
  via        text not null default 'web' check (via in ('web', 'job', 'cli')),
  changed_at timestamptz not null default now(),
  primary key (entry_id, version),
  foreign key (space_id, entry_id) references app.entries (space_id, id) on delete cascade
);
create index on app.entry_history (space_id, changed_at desc);
create index on app.entry_history (space_id, entry_id);
create index on app.entry_history (changed_by);

-- Jejak entri yang dipurge: tanpa nominal, tanpa deskripsi, tanpa FK (spec §9.1).
create table app.entry_tombstones (
  entry_id    uuid primary key,
  link_id     uuid,
  space_id    uuid not null,
  kind        app.entry_kind not null,
  occurred_on date not null,
  voided_at   timestamptz not null,
  voided_by   uuid not null,
  purged_at   timestamptz not null default now()
);
create index on app.entry_tombstones (space_id, purged_at);

-- ===== Job worker (tanpa RLS: tanpa data user, BSD §11) =====
create table jobs.job_runs (
  id          bigint generated always as identity primary key,
  job         text not null check (job ~ '^[a-z_]{1,40}$'),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'ok', 'failed')),
  error_code  text check (length(error_code) <= 40),
  rows        int
);
create index on jobs.job_runs (job, started_at desc);

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'
-- (nilai bawaan dari 0001); CI/lokal mengubah env dulu sebelum rollback.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
drop table jobs.job_runs;
drop table app.entry_tombstones;
drop table app.entry_history;
drop table app.entry_lines;
drop table app.entries;
drop table app.categories;
drop table app.accounts;
drop type app.history_op;
drop type app.entry_direction;
drop type app.line_role;
drop type app.entry_kind;
drop type app.category_type;
drop type app.wallet_type;
drop type app.pocket;
