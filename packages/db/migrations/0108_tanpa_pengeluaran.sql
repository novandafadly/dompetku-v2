-- migrate:up
-- S6 (IPD §4): hari tanpa pengeluaran. Tabel (BSD §6), RLS dan hak (BSD §11), dan
-- api.mark_no_spend_day (BSD §9), disalin persis. Tanggal = app.today() (WIB server) bila p_on
-- kosong; tanggal masa depan ditolak private.check_date (DK400 occurred_on).

-- ===== Tabel =====
create table app.no_spend_days (
  space_id  uuid not null references app.spaces on delete restrict,
  on_date   date not null,
  marked_by uuid not null references auth."user" (id) on delete restrict,
  marked_at timestamptz not null default now(),
  primary key (space_id, on_date)
);
create index on app.no_spend_days (marked_by);

-- ===== RLS: aktif dan dipaksa; pola ruang (baca web/api, tulis hanya dompetku_api) =====
alter table app.no_spend_days enable row level security;
alter table app.no_spend_days force row level security;
create policy member_read on app.no_spend_days for select to dompetku_web, dompetku_api
  using (space_id = any ((select app.my_space_ids())::uuid[]));
create policy member_write on app.no_spend_days for all to dompetku_api
  using (space_id = any ((select app.my_space_ids())::uuid[]))
  with check (space_id = any ((select app.my_space_ids())::uuid[]));

-- ===== Hak tabel =====
grant select on app.no_spend_days to dompetku_web, dompetku_api;
grant insert, delete on app.no_spend_days to dompetku_api;
-- 0008 memberi auditor SELECT pada tabel app yang ada saat itu; tabel baru ditambah eksplisit.
grant select on app.no_spend_days to dompetku_auditor;
-- dompetku_auditlog: default privileges 0008 sudah mencakup tabel baru di app (tes katalog).

-- ===== Hari tanpa pengeluaran (BSD §9; idempoten secara alami) =====
create function api.mark_no_spend_day(p_space_id uuid, p_on date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform app.assert_member(p_space_id);
  insert into app.no_spend_days (space_id, on_date, marked_by)
  values (p_space_id, private.check_date(p_on), v_uid)
  on conflict (space_id, on_date) do nothing;
end $$;

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
drop function api.mark_no_spend_day(uuid, date);
revoke all on app.no_spend_days from dompetku_web, dompetku_api, dompetku_auditor;
drop policy member_write on app.no_spend_days;
drop policy member_read on app.no_spend_days;
drop table app.no_spend_days;
