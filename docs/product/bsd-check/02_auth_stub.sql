-- HANYA UNTUK VALIDASI: bentuk minimal tabel Better Auth "user" (id uuid).
create table auth."user" (
  id              uuid primary key,
  name            text not null,
  email           text not null unique,
  "emailVerified" boolean not null default false,
  image           text,
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now()
);
