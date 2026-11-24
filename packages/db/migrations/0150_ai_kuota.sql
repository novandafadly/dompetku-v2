-- migrate:up
-- S17 (IPD §6 S17/S18, plan S17 Task 2, K3; qa.md M6): kuota harian AI per pengguna per hari WIB.
-- Expand-only: satu tabel (app.ai_usage) dan dua fungsi (api.ai_quota baca INVOKER, api.consume_ai_quota tulis DEFINER).
--
-- - Batas harian (IPD §6 S18, qa.md M6): parse = 15/hari, analysis = 5/hari (total 20/hari per user),
--   reset otomatis saat pergantian hari WIB (app.today()).
-- - app.ai_usage: PK (user_id, day, feature), FK user_id ke auth."user" on delete restrict (berindeks di kolom
--   depan PK); RLS ENABLE + FORCE milik sendiri (user hanya melihat/mengubah kuotanya sendiri); tanpa DELETE.
-- - api.consume_ai_quota(feature): DEFINER milik dompetku_api, atomik (insert on conflict do nothing lalu
--   update bersyarat used < v_limit returning used) sehingga permintaan paralel tidak pernah melewati batas.
--   Saat kuota habis mengembalikan { allowed: false, ... } agar server bisa fallback ke parser aturan (S17)
--   atau mengembalikan 429 pada rute analisis murni AI (S18).

create table app.ai_usage (
  user_id    uuid not null references auth."user" (id) on delete restrict,
  day        date not null,
  feature    text not null check (feature in ('parse', 'analysis')),
  used       int not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day, feature)
);

alter table app.ai_usage enable row level security;
alter table app.ai_usage force row level security;
create policy own_read on app.ai_usage for select to dompetku_web, dompetku_api
  using (user_id = app.current_user_id());
create policy own_write on app.ai_usage for all to dompetku_api
  using (user_id = app.current_user_id())
  with check (user_id = app.current_user_id());

grant select on app.ai_usage to dompetku_web, dompetku_api, dompetku_auditor;
grant insert, update on app.ai_usage to dompetku_api;

create function api.ai_quota(p_feature text default null)
returns table (feature text, used int, daily_limit int, remaining int, day date)
language plpgsql stable set search_path = '' as $$
declare
  v_uid uuid := app.current_user_id();
  v_day date := app.today();
begin
  if v_uid is null then
    raise exception using errcode = 'DK401', message = 'unauthenticated';
  end if;
  if p_feature is not null and p_feature not in ('parse', 'analysis') then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'feature';
  end if;
  return query
  select f.feature,
         coalesce(u.used, 0)::int,
         f.lim,
         greatest(0, f.lim - coalesce(u.used, 0))::int,
         v_day
    from (values ('parse'::text, 15::int), ('analysis'::text, 5::int)) f(feature, lim)
    left join app.ai_usage u
      on u.user_id = v_uid and u.day = v_day and u.feature = f.feature
   where p_feature is null or f.feature = p_feature
   order by f.feature;
end $$;

create function api.consume_ai_quota(p_feature text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_day   date := app.today();
  v_limit int;
  v_used  int;
begin
  if p_feature is null or p_feature not in ('parse', 'analysis') then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'feature';
  end if;
  v_limit := case p_feature when 'parse' then 15 else 5 end;

  insert into app.ai_usage (user_id, day, feature, used, updated_at)
  values (v_uid, v_day, p_feature, 0, app.now())
  on conflict do nothing;

  update app.ai_usage
     set used = used + 1, updated_at = app.now()
   where user_id = v_uid and day = v_day and feature = p_feature and used < v_limit
  returning used into v_used;

  if not found then
    return jsonb_build_object(
      'allowed', false,
      'feature', p_feature,
      'used', v_limit,
      'limit', v_limit,
      'remaining', 0,
      'day', v_day
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'feature', p_feature,
    'used', v_used,
    'limit', v_limit,
    'remaining', v_limit - v_used,
    'day', v_day
  );
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

drop function api.consume_ai_quota(text);
drop function api.ai_quota(text);
revoke all on app.ai_usage from dompetku_web, dompetku_api, dompetku_auditor;
drop policy own_write on app.ai_usage;
drop policy own_read on app.ai_usage;
drop table app.ai_usage;

select private.own_api_functions();
