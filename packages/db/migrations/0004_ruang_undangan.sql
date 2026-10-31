-- migrate:up
-- BSD §6, bagian S4: rumah tangga, ruang, anggota, profil, undangan, kunci idempotensi,
-- metrik produk, audit. Tabel ledger (accounts, categories, entries, ...) dan enum ledger
-- (pocket, wallet_type, category_type, entry_kind, line_role, entry_direction, history_op)
-- ditambah di S5. idempotency_keys ikut sekarang karena jobs.purge_unfinished_users (BSD §10)
-- menghapus barisnya.
create type app.space_kind  as enum ('personal', 'shared');
create type app.member_role as enum ('owner', 'member');

-- ===== Rumah tangga, ruang, anggota =====
create table app.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);
create unique index households_singleton on app.households ((true));

create table app.spaces (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references app.households on delete restrict,
  kind          app.space_kind not null,
  owner_user_id uuid references auth."user" (id) on delete restrict,
  created_at    timestamptz not null default now(),
  unique (id, kind),
  check ((kind = 'personal') = (owner_user_id is not null))
);
create unique index spaces_one_shared   on app.spaces (household_id)  where kind = 'shared';
create unique index spaces_one_personal on app.spaces (owner_user_id) where kind = 'personal';
create index on app.spaces (household_id);
create index on app.spaces (owner_user_id);

create table app.space_members (
  space_id  uuid not null references app.spaces on delete restrict,
  user_id   uuid not null references auth."user" (id) on delete restrict,
  role      app.member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index on app.space_members (user_id);

create table app.profiles (
  user_id      uuid primary key references auth."user" (id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 40),
  initial      text not null check (length(initial) between 1 and 2),
  payday_day   smallint check (payday_day between 1 and 31),
  updated_at   timestamptz not null default now()
);

create table app.idempotency_keys (
  user_id      uuid not null references auth."user" (id) on delete restrict,
  client_id    uuid not null,
  op           text not null check (op ~ '^[a-z_]{1,40}$'),
  request_hash bytea not null check (length(request_hash) = 32),
  result       jsonb,
  created_at   timestamptz not null default now(),
  primary key (user_id, client_id)
);
create index on app.idempotency_keys (created_at);

-- ===== Undangan =====
create table app.invitations (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households on delete restrict,
  email        text not null check (email = lower(btrim(email))
                                    and length(email) between 3 and 254
                                    and position('@' in email) > 1),
  token_hash   bytea not null unique check (length(token_hash) = 32),
  created_by   uuid not null references auth."user" (id) on delete restrict,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  revoke_reason text check (revoke_reason in ('revoked', 'declined', 'resent', 'expired')),
  used_at      timestamptz,
  used_by      uuid references auth."user" (id) on delete restrict,
  check (expires_at = created_at + interval '72 hours'),
  check ((revoked_at is null) = (revoke_reason is null)),
  check ((used_at is null) = (used_by is null)),
  check (used_at is null or revoked_at is null)
);
create unique index invitations_one_open on app.invitations (household_id)
  where used_at is null and revoked_at is null;
create index on app.invitations (household_id);
create index on app.invitations (email) where used_at is null and revoked_at is null;
create index on app.invitations (created_by);
create index on app.invitations (used_by);

-- ===== Metrik produk (tanpa nominal/deskripsi; keputusan pemilik #15) =====
-- Satu sesi Catat = flow_id sama. catat_disimpan/catat_batal membawa jumlah ketukan dan durasi,
-- sehingga median waktu catat dan porsi catatan <= 3 ketukan bisa dihitung tanpa nominal.
create table app.product_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth."user" (id) on delete restrict,
  space_kind  app.space_kind,
  event       text not null check (event in ('catat_dibuka', 'catat_disimpan', 'catat_batal',
                                             'tanpa_pengeluaran')),
  flow_id     uuid,
  taps        smallint check (taps between 0 and 100),
  duration_ms int check (duration_ms between 0 and 3600000),
  at          timestamptz not null default now(),
  check (event not in ('catat_disimpan', 'catat_batal')
         or (flow_id is not null and taps is not null and duration_ms is not null))
);
create index on app.product_events (user_id, at);

-- ===== Audit =====
create table audit.events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  event      text not null check (event in (
               'login_success', 'login_failed', 'logout', 'step_up',
               'password_reset_requested', 'password_reset_done',
               'factor_added', 'factor_removed', 'recovery_code_used', 'recovery_codes_regenerated',
               'session_revoked', 'invitation_created', 'invitation_revoked', 'invitation_declined',
               'invitation_accepted', 'space_member_change', 'unfinished_user_purged',
               'export', 'space_move', 'entry_purged', 'purge_voided', 'db_manual_access', 'deploy')),
  ip         inet,
  user_agent text check (length(user_agent) <= 200),
  space_id   uuid,
  -- Daftar kunci yang diizinkan (bukan daftar larangan), nilai skalar saja, maksimal 1 kB.
  meta       jsonb not null default '{}'::jsonb
             check (jsonb_typeof(meta) = 'object'
                    and meta - array['count', 'reason', 'method', 'op', 'job', 'status', 'via',
                                     'target', 'amr'] = '{}'::jsonb
                    and not jsonb_path_exists(meta, '$.* ? (@.type() == "object" || @.type() == "array")')
                    and length(meta::text) <= 1024)
);
create index on audit.events (user_id, at desc);
create index on audit.events (at);

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi).
drop table audit.events;
drop table app.product_events;
drop table app.invitations;
drop table app.idempotency_keys;
drop table app.profiles;
drop table app.space_members;
drop table app.spaces;
drop table app.households;
drop type app.member_role;
drop type app.space_kind;
