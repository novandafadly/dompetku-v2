-- migrate:up
-- BSD §5, S4 sisi server: tabel Better Auth 1.7.12 (ADR 0007) di skema auth.
--
-- Sumber kolom: `getMigrations().compileMigrations()` Better Auth dengan konfigurasi
-- apps/web/src/server/auth/config.ts (emailAndPassword, twoFactor, passkey, field sesi `amr`,
-- generateId 'uuid'), lalu dikoreksi tangan sesuai packages/db/README.md "Urutan auth":
--   - auth."user" sudah dibuat 0002: hanya ditambah kolom plugin two-factor, bukan dibuat ulang.
--   - id dan FK user bertipe uuid; FK ke auth."user" on delete cascade (jobs.purge_unfinished_users).
--   - nama tabel tetap camelCase bawaan ("twoFactor"); Better Auth memakai pool dengan
--     search_path=auth, jadi nama tidak berskema di query-nya jatuh ke skema ini.
-- Hak dompetku_web datang dari default privileges 0003; tidak ada grant untuk role lain.

alter table auth."user"
  add column "twoFactorEnabled" boolean not null default false,
  -- Better Auth sudah menormalkan email ke huruf kecil; CHECK menjaga unique dan trigger
  -- user_admission tetap sepakat bila ada jalur tulis lain.
  add constraint user_email_normalized check (email = lower(btrim(email)));

create table auth.session (
  id          uuid primary key default gen_random_uuid(),
  "expiresAt" timestamptz not null,
  token       text not null unique,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId"    uuid not null references auth."user" (id) on delete cascade,
  -- Cara masuk sesi ini (BSD §5, TRD §3.4); diisi hook databaseHooks.session.create.
  amr         text check (amr in ('passkey', 'password+totp', 'password', 'recovery'))
);
create index session_user_id_idx on auth.session ("userId");

create table auth.account (
  id                      uuid primary key default gen_random_uuid(),
  "accountId"             text not null,
  "providerId"            text not null,
  "userId"                uuid not null references auth."user" (id) on delete cascade,
  "accessToken"           text,
  "refreshToken"          text,
  "idToken"               text,
  "accessTokenExpiresAt"  timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope                   text,
  password                text,
  "createdAt"             timestamptz not null default now(),
  "updatedAt"             timestamptz not null
);
create index account_user_id_idx on auth.account ("userId");

create table auth.verification (
  id          uuid primary key default gen_random_uuid(),
  identifier  text not null,
  value       text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index verification_identifier_idx on auth.verification (identifier);

-- Rahasia TOTP terenkripsi dengan BETTER_AUTH_SECRET (TRD §3.4). backupCodes bawaan plugin
-- tidak dipakai (kode pemulihan = auth.recovery_codes), tetapi kolomnya wajib ada.
create table auth."twoFactor" (
  id                        uuid primary key default gen_random_uuid(),
  secret                    text not null,
  "backupCodes"             text not null,
  "userId"                  uuid not null references auth."user" (id) on delete cascade,
  verified                  boolean default true,
  "failedVerificationCount" integer default 0,
  "lockedUntil"             timestamptz
);
create unique index two_factor_user_id_idx on auth."twoFactor" ("userId");

create table auth.passkey (
  id             uuid primary key default gen_random_uuid(),
  name           text,
  "publicKey"    text not null,
  "userId"       uuid not null references auth."user" (id) on delete cascade,
  "credentialID" text not null unique,
  counter        integer not null,
  "deviceType"   text not null,
  "backedUp"     boolean not null,
  transports     text,
  "createdAt"    timestamptz,
  aaguid         text
);
create index passkey_user_id_idx on auth.passkey ("userId");

-- Jeda bertahap gagal login (keputusan pemilik #4, TRD §3.4): per IP dan per akun, tanpa kunci
-- permanen. Kunci = SHA-256 dari jenis + nilai (email/IP tidak disimpan mentah).
create table auth.login_throttle (
  key           bytea primary key check (length(key) = 32),
  failures      integer not null default 0 check (failures >= 0),
  blocked_until timestamptz,
  updated_at    timestamptz not null default now()
);
create index login_throttle_updated_at_idx on auth.login_throttle (updated_at);

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi).
drop table auth.login_throttle;
drop table auth.passkey;
drop table auth."twoFactor";
drop table auth.verification;
drop table auth.account;
drop table auth.session;
alter table auth."user"
  drop constraint user_email_normalized,
  drop column "twoFactorEnabled";
