-- migrate:up
-- Pra-S10 (utang keamanan rendah S9 dari handoff S9):
-- 1. private.materialize_bill(p_bill_id, p_through, p_from): batasi v_through maksimal
--    app.today() + 400 agar pemanggilan manual/job dengan p_through jauh di masa depan
--    (mis. '2099-12-31') tidak membangkitkan ribuan baris bill_occurrences sekaligus.
-- 2. api.create_bill & api.post_bill_occurrence: periksa keanggotaan ruang (app.assert_member)
--    SEBELUM private.idem_begin, sehingga pemanggil bukan anggota ruang yang memakai ulang
--    client_id miliknya sendiri tetap ditolak DK404 (space_not_found / bill_not_found),
--    bukan DK410 idempotency_key_reused, dan tidak menyentuh app.idempotency_keys sebelum
--    otorisasi ruang lulus.

create or replace function private.materialize_bill(p_bill_id uuid, p_through date default null,
                                                    p_from date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_b       app.bills%rowtype;
  v_first   date;
  v_through date;
  v_n       int;
begin
  select * into v_b from app.bills where id = p_bill_id for share;
  if v_b.id is null or v_b.archived_at is not null then
    return 0;
  end if;
  v_through := coalesce(p_through, (
    select n.ends_on from app.pay_period(v_b.space_id, app.today()) c
    cross join lateral app.pay_period(v_b.space_id, c.ends_on + 1) n));
  v_through := least(v_through, app.today() + 400, coalesce(v_b.ends_on, v_through));
  v_first := greatest(private.bill_first_on(v_b.starts_on, v_b.created_at), coalesce(p_from, '-infinity'::date));
  if v_first > v_through then
    return 0;
  end if;
  insert into app.bill_occurrences (space_id, bill_id, due_on, amount)
  select v_b.space_id, v_b.id, d.due_on, v_b.amount
  from generate_series((v_first - (extract(day from v_first)::int - 1))::timestamp, v_through::timestamp,
                       interval '1 month') g
  cross join lateral (
    select g::date as m,
           least(g::date + (v_b.day_of_month - 1), (g + interval '1 month')::date - 1) as due_on
  ) d
  where d.due_on between v_first and v_through
    and not exists (select 1 from app.bill_occurrences o
                    where o.bill_id = v_b.id and o.due_on >= d.m
                      and o.due_on < (d.m + interval '1 month')::date)
  order by d.due_on
  on conflict (bill_id, due_on) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function api.create_bill(
  p_client_id uuid, p_space_id uuid, p_name text, p_amount bigint, p_category_id uuid,
  p_day_of_month smallint, p_starts_on date, p_ends_on date default null,
  p_account_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_id  uuid;
  v_r   jsonb;
begin
  perform app.assert_member(p_space_id);
  v_r := private.idem_begin(v_uid, p_client_id, 'create_bill', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'name', btrim(p_name), 'amount', p_amount,
           'category', p_category_id, 'day', p_day_of_month, 'starts', p_starts_on,
           'ends', p_ends_on, 'account', p_account_id)));
  if v_r is not null then
    return v_r;
  end if;
  perform private.check_bill(p_space_id, p_name, p_amount, p_category_id, p_day_of_month,
                             p_starts_on, p_ends_on, p_account_id);
  insert into app.bills (space_id, name, amount, category_id, account_id, day_of_month,
                         starts_on, ends_on, created_by, created_at, updated_at)
  values (p_space_id, btrim(p_name), p_amount, p_category_id, p_account_id, p_day_of_month,
          p_starts_on, p_ends_on, v_uid, app.now(), app.now())
  returning id into v_id;
  perform private.materialize_bill(v_id);
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object('bill_id', v_id));
end $$;

create or replace function api.post_bill_occurrence(
  p_client_id uuid, p_occurrence_id uuid, p_account_id uuid default null,
  p_occurred_on date default null, p_allow_negative boolean default false,
  p_amount bigint default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_space uuid;
  v_o     app.bill_occurrences%rowtype;
  v_b     app.bills%rowtype;
  v_acc   app.accounts%rowtype;
  v_res   jsonb;
  v_r     jsonb;
begin
  select o.space_id into v_space from app.bill_occurrences o where o.id = p_occurrence_id;
  if v_space is null then
    raise exception using errcode = 'DK404', message = 'bill_not_found';
  end if;
  perform app.assert_member(v_space);
  -- Hash dari argumen mentah (p_occurred_on sebelum default), tanpa p_allow_negative.
  v_r := private.idem_begin(v_uid, p_client_id, 'post_bill_occurrence', private.req_hash(
           jsonb_build_object('occurrence', p_occurrence_id, 'account', p_account_id,
                              'on', p_occurred_on, 'amount', p_amount)));
  if v_r is not null then
    return v_r;
  end if;
  if p_amount is not null then
    perform private.check_amount(p_amount, 'amount');
  end if;
  perform private.check_date(p_occurred_on);
  v_o := private.lock_occurrence(p_occurrence_id);
  if v_o.skipped_at is not null or private.occurrence_posted(v_o) then
    raise exception using errcode = 'DK422', message = 'already_posted';
  end if;
  select * into v_b from app.bills where id = v_o.bill_id;
  select * into v_acc from app.accounts a
   where a.id = coalesce(p_account_id, v_b.account_id) and a.space_id = v_o.space_id;
  if coalesce(p_account_id, v_b.account_id) is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'account_id';
  elsif v_acc.id is null then
    raise exception using errcode = 'DK404', message = 'account_not_found', detail = 'account_id';
  elsif v_acc.pocket = 'kantor' then
    raise exception using errcode = 'DK422', message = 'bill_account_kantor';
  end if;
  -- client_id turunan acak: kunci entri unik per pembayaran; replay dijaga kunci luar.
  v_res := api.create_entry(
    p_client_id      => gen_random_uuid(),
    p_space_id       => v_o.space_id,
    p_account_id     => v_acc.id,
    p_kind           => 'expense',
    p_amount         => coalesce(p_amount, v_o.amount),
    p_category_id    => v_b.category_id,
    p_occurred_on    => p_occurred_on,
    p_description    => v_b.name,
    p_allow_negative => p_allow_negative);
  update app.bill_occurrences set entry_id = (v_res ->> 'entry_id')::uuid where id = v_o.id;
  return private.idem_finish(v_uid, p_client_id, (v_res - 'replayed')
    || jsonb_build_object('occurrence_id', v_o.id));
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

create or replace function private.materialize_bill(p_bill_id uuid, p_through date default null,
                                                    p_from date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_b       app.bills%rowtype;
  v_first   date;
  v_through date;
  v_n       int;
begin
  select * into v_b from app.bills where id = p_bill_id for share;
  if v_b.id is null or v_b.archived_at is not null then
    return 0;
  end if;
  v_through := coalesce(p_through, (
    select n.ends_on from app.pay_period(v_b.space_id, app.today()) c
    cross join lateral app.pay_period(v_b.space_id, c.ends_on + 1) n));
  v_through := least(v_through, coalesce(v_b.ends_on, v_through));
  v_first := greatest(private.bill_first_on(v_b.starts_on, v_b.created_at), coalesce(p_from, '-infinity'::date));
  if v_first > v_through then
    return 0;
  end if;
  insert into app.bill_occurrences (space_id, bill_id, due_on, amount)
  select v_b.space_id, v_b.id, d.due_on, v_b.amount
  from generate_series((v_first - (extract(day from v_first)::int - 1))::timestamp, v_through::timestamp,
                       interval '1 month') g
  cross join lateral (
    select g::date as m,
           least(g::date + (v_b.day_of_month - 1), (g + interval '1 month')::date - 1) as due_on
  ) d
  where d.due_on between v_first and v_through
    and not exists (select 1 from app.bill_occurrences o
                    where o.bill_id = v_b.id and o.due_on >= d.m
                      and o.due_on < (d.m + interval '1 month')::date)
  order by d.due_on
  on conflict (bill_id, due_on) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function api.create_bill(
  p_client_id uuid, p_space_id uuid, p_name text, p_amount bigint, p_category_id uuid,
  p_day_of_month smallint, p_starts_on date, p_ends_on date default null,
  p_account_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_id  uuid;
  v_r   jsonb;
begin
  v_r := private.idem_begin(v_uid, p_client_id, 'create_bill', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'name', btrim(p_name), 'amount', p_amount,
           'category', p_category_id, 'day', p_day_of_month, 'starts', p_starts_on,
           'ends', p_ends_on, 'account', p_account_id)));
  if v_r is not null then
    return v_r;
  end if;
  perform app.assert_member(p_space_id);
  perform private.check_bill(p_space_id, p_name, p_amount, p_category_id, p_day_of_month,
                             p_starts_on, p_ends_on, p_account_id);
  insert into app.bills (space_id, name, amount, category_id, account_id, day_of_month,
                         starts_on, ends_on, created_by, created_at, updated_at)
  values (p_space_id, btrim(p_name), p_amount, p_category_id, p_account_id, p_day_of_month,
          p_starts_on, p_ends_on, v_uid, app.now(), app.now())
  returning id into v_id;
  perform private.materialize_bill(v_id);
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object('bill_id', v_id));
end $$;

create or replace function api.post_bill_occurrence(
  p_client_id uuid, p_occurrence_id uuid, p_account_id uuid default null,
  p_occurred_on date default null, p_allow_negative boolean default false,
  p_amount bigint default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_o   app.bill_occurrences%rowtype;
  v_b   app.bills%rowtype;
  v_acc app.accounts%rowtype;
  v_res jsonb;
  v_r   jsonb;
begin
  -- Hash dari argumen mentah (p_occurred_on sebelum default), tanpa p_allow_negative.
  v_r := private.idem_begin(v_uid, p_client_id, 'post_bill_occurrence', private.req_hash(
           jsonb_build_object('occurrence', p_occurrence_id, 'account', p_account_id,
                              'on', p_occurred_on, 'amount', p_amount)));
  if v_r is not null then
    return v_r;
  end if;
  if p_amount is not null then
    perform private.check_amount(p_amount, 'amount');
  end if;
  perform private.check_date(p_occurred_on);
  v_o := private.lock_occurrence(p_occurrence_id);
  if v_o.skipped_at is not null or private.occurrence_posted(v_o) then
    raise exception using errcode = 'DK422', message = 'already_posted';
  end if;
  select * into v_b from app.bills where id = v_o.bill_id;
  select * into v_acc from app.accounts a
   where a.id = coalesce(p_account_id, v_b.account_id) and a.space_id = v_o.space_id;
  if coalesce(p_account_id, v_b.account_id) is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'account_id';
  elsif v_acc.id is null then
    raise exception using errcode = 'DK404', message = 'account_not_found', detail = 'account_id';
  elsif v_acc.pocket = 'kantor' then
    raise exception using errcode = 'DK422', message = 'bill_account_kantor';
  end if;
  -- client_id turunan acak: kunci entri unik per pembayaran; replay dijaga kunci luar.
  v_res := api.create_entry(
    p_client_id      => gen_random_uuid(),
    p_space_id       => v_o.space_id,
    p_account_id     => v_acc.id,
    p_kind           => 'expense',
    p_amount         => coalesce(p_amount, v_o.amount),
    p_category_id    => v_b.category_id,
    p_occurred_on    => p_occurred_on,
    p_description    => v_b.name,
    p_allow_negative => p_allow_negative);
  update app.bill_occurrences set entry_id = (v_res ->> 'entry_id')::uuid where id = v_o.id;
  return private.idem_finish(v_uid, p_client_id, (v_res - 'replayed')
    || jsonb_build_object('occurrence_id', v_o.id));
end $$;

select private.own_api_functions();
