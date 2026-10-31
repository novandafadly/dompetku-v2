-- migrate:up
-- Tabel inti Better Auth auth."user", dibuat di sini lebih dulu (S4, keputusan urutan).
--
-- Alasan: BSD §5 dan §6 memasang FK nyata dari tabel domain (spaces, space_members, profiles,
-- invitations, product_events, idempotency_keys) dan trigger pendaftaran `user_admission` ke
-- auth."user". Postgres tidak punya FK yang ditunda sampai tabel tujuannya ada, jadi pilihannya:
--   (a) buat auth."user" sekarang dengan bentuk yang diasumsikan BSD (stub validasi bsd-check),
--   (b) tunda semua FK dan trigger ke migrasi sesudah migrasi Better Auth.
-- Dipilih (a): FK dan trigger langsung aktif dan diuji pgTAP sejak S4, tanpa jendela tanpa pagar.
--
-- Akibat untuk migrasi Better Auth (S4 sisi server): file hasil generator TIDAK BOLEH membuat
-- ulang tabel "user". Bagian "user" diganti `alter table auth."user" add column ...` untuk kolom
-- plugin (mis. "twoFactorEnabled"); tabel session, account, verification, passkey, twoFactor dibuat
-- seperti biasa dengan FK uuid ke auth."user" (id) on delete cascade (BSD §5, §10).
-- Kolom di bawah = field inti Better Auth, nama camelCase persis, id uuid (BSD §5: generateId UUID).
create table auth."user" (
  id              uuid primary key,
  name            text not null,
  email           text not null unique,
  "emailVerified" boolean not null default false,
  image           text,
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now()
);

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi).
drop table auth."user";
