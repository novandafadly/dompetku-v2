-- migrate:up
-- S13 (IPD §6, plan S13 Task 3, K1, K4, K6, K7; bingkai S13-TJ2 sampai TJ12): API tujuan tabungan.
-- Expand-only: fungsi baru; api.archive_account diganti utuh (create or replace, tanda tangan dan hasil sama).
--
-- - Tulis (DEFINER milik dompetku_api, berjalan di bawah RLS app.goals; di Bersama semua anggota menulis,
--   K1): api.create_goal (idempoten client_id, hash dari argumen bersih), api.update_goal (nama, target,
--   tanggal; dompet tidak bisa diganti, K7), api.complete_goal (aktif dan tercapai; K4), api.archive_goal,
--   api.restore_goal (K7). Selain create_goal, idempoten secara alami: ulang dengan isi sama, selesaikan
--   yang sudah selesai, arsipkan yang sudah diarsip, pulihkan yang sudah aktif = sukses tanpa perubahan.
-- - Penjaga dompet tetap private.tg_goal_guard (0137): pocket tabungan (goal_pocket_invalid), dompet ruang
--   yang sama dan terlihat (account_not_found), tidak terarsip saat aktif (account_archived). 23505 dari
--   goals_one_active_per_account (create_goal, restore_goal) = DK409 goal_exists.
-- - Tanggal target lampau (< app.today(), WIB) = DK422 goal_target_past; di update_goal hanya bila tanggal
--   berubah, jadi tujuan yang sudah lewat tanggal tetap bisa diganti nama/target (bingkai Dampak 2).
-- - Urutan kunci: dompet (private.lock_accounts, FOR NO KEY UPDATE) -> baris tujuan (FOR NO KEY UPDATE) ->
--   FOR SHARE dompet yang sama di trigger. api.archive_account: dompet -> baca tujuan aktif. Jalur entri
--   (entri -> dompet) tidak menyentuh tujuan; tanpa siklus. Kunci dompet menyerialkan create_goal,
--   restore_goal, complete_goal (saldo dibaca sesudah kunci), dan archive_account pada dompet yang sama
--   (99_konkurensi).
-- - api.archive_account: tujuan aktif = DK422 account_has_goal sebelum cek saldo (K6); selebihnya = 0103.
-- - Baca (INVOKER milik owner, STABLE): api.list_goals(ruang) = baris tujuan + angka app.goal_progress
--   (satu rumus) + nama dompet, dompet terarsip, pembuat, account_has_other_active (baris selesai/arsip,
--   TJ8); urutan aktif (tercapai, tanggal target terdekat, tanpa tanggal, lebih lama), lalu selesai/arsip
--   terbaru. api.goal_for_account(dompet) = tujuan aktif dompet itu (0 atau 1 baris), dompet tak terlihat =
--   DK404 space_not_found.
-- Kode galat baru: DK409 goal_exists; DK422 goal_target_past, goal_not_active, goal_not_reached,
-- account_has_goal; DK404 goal_not_found. Pesan/detail tanpa nominal dan nama.

-- Tujuan terlihat (RLS pemanggil) sesudah keanggotaan terbukti; dompetnya dikunci lebih dulu, lalu baris
-- tujuan. Tidak terlihat atau hilang sebelum kunci didapat = DK404.
create function private.lock_goal(p_goal_id uuid) returns app.goals
language plpgsql set search_path = '' as $$
declare v app.goals%rowtype;
begin
  select * into v from app.goals where id = p_goal_id;
  if v.id is null then
    raise exception using errcode = 'DK404', message = 'goal_not_found';
  end if;
  perform app.assert_member(v.space_id);
  perform private.lock_accounts(array[v.account_id]);
  select * into v from app.goals where id = p_goal_id for no key update;
  if not found then
    raise exception using errcode = 'DK404', message = 'goal_not_found';
  end if;
  return v;
end $$;

-- Nama 1..60 sesudah trim, target 1..10^13 (DK400 dengan detail kolom).
create function private.check_goal(p_name text, p_target bigint) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(p_name), '');
begin
  if v is null or length(v) > 60 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'name';
  end if;
  perform private.check_amount(p_target, 'target_amount');
  return v;
end $$;

create function api.create_goal(
  p_client_id     uuid,
  p_space_id      uuid,
  p_account_id    uuid,
  p_name          text,
  p_target_amount bigint,
  p_target_on     date default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_name text := nullif(btrim(p_name), '');
  v_id   uuid;
  v_r    jsonb;
begin
  v_r := private.idem_begin(v_uid, p_client_id, 'create_goal', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'account', p_account_id, 'name', v_name, 'target', p_target_amount,
           'on', p_target_on)));
  if v_r is not null then
    return v_r;
  end if;
  perform app.assert_member(p_space_id);
  v_name := private.check_goal(v_name, p_target_amount);
  if p_target_on < app.today() then
    raise exception using errcode = 'DK422', message = 'goal_target_past', detail = 'target_on';
  end if;
  if p_account_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'account_id';
  end if;
  perform private.lock_accounts(array[p_account_id]);
  begin
    insert into app.goals (space_id, space_kind, account_id, name, target_amount, target_on,
                           created_by, created_at, updated_by, updated_at)
    select p_space_id, s.kind, p_account_id, v_name, p_target_amount, p_target_on,
           v_uid, app.now(), v_uid, app.now()
      from app.spaces s where s.id = p_space_id
    returning id into v_id;
  exception when unique_violation then
    raise exception using errcode = 'DK409', message = 'goal_exists';
  end;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object('goal_id', v_id, 'status', 'active'));
end $$;

create function api.update_goal(p_goal_id uuid, p_name text, p_target_amount bigint, p_target_on date)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_name text := private.check_goal(p_name, p_target_amount);
  v_g    app.goals%rowtype;
begin
  v_g := private.lock_goal(p_goal_id);
  if v_g.status <> 'active' then
    raise exception using errcode = 'DK422', message = 'goal_not_active';
  end if;
  if p_target_on is distinct from v_g.target_on and p_target_on < app.today() then
    raise exception using errcode = 'DK422', message = 'goal_target_past', detail = 'target_on';
  end if;
  update app.goals set name = v_name, target_amount = p_target_amount, target_on = p_target_on,
                       updated_by = v_uid, updated_at = app.now()
   where id = v_g.id;
  return jsonb_build_object('goal_id', v_g.id, 'status', 'active');
end $$;

create function api.complete_goal(p_goal_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_g   app.goals%rowtype;
begin
  v_g := private.lock_goal(p_goal_id);
  if v_g.status = 'archived' then
    raise exception using errcode = 'DK422', message = 'goal_not_active';
  end if;
  if v_g.status = 'active' then
    -- Saldo dibaca sesudah kunci dompet (READ COMMITTED: snapshot baru per pernyataan).
    if not coalesce((select p.reached from app.goal_progress p where p.goal_id = v_g.id), false) then
      raise exception using errcode = 'DK422', message = 'goal_not_reached';
    end if;
    update app.goals set status = 'completed', completed_at = app.now(), updated_by = v_uid, updated_at = app.now()
     where id = v_g.id;
  end if;
  return jsonb_build_object('goal_id', v_g.id, 'status', 'completed');
end $$;

create function api.archive_goal(p_goal_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_g   app.goals%rowtype;
begin
  v_g := private.lock_goal(p_goal_id);
  if v_g.status <> 'archived' then
    update app.goals set status = 'archived', archived_at = app.now(), updated_by = v_uid, updated_at = app.now()
     where id = v_g.id;
  end if;
  return jsonb_build_object('goal_id', v_g.id, 'status', 'archived');
end $$;

create function api.restore_goal(p_goal_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_g   app.goals%rowtype;
begin
  v_g := private.lock_goal(p_goal_id);
  if v_g.status <> 'active' then
    begin
      update app.goals set status = 'active', completed_at = null, archived_at = null,
                           updated_by = v_uid, updated_at = app.now()
       where id = v_g.id;
    exception when unique_violation then
      raise exception using errcode = 'DK409', message = 'goal_exists';
    end;
  end if;
  return jsonb_build_object('goal_id', v_g.id, 'status', 'active');
end $$;

create function api.list_goals(p_space_id uuid)
returns table (goal_id uuid, name text, account_id uuid, account_name text, account_archived boolean,
               status text, target_amount bigint, target_on date, completed_at timestamptz,
               archived_at timestamptz, created_by uuid, created_at timestamptz, balance bigint, saved bigint,
               remaining bigint, pct int, reached boolean, periods_left int, per_period bigint,
               account_has_other_active boolean)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  select g.id, g.name, g.account_id, a.name, a.archived_at is not null, g.status, g.target_amount, g.target_on,
         g.completed_at, g.archived_at, g.created_by, g.created_at, p.balance, p.saved, p.remaining, p.pct,
         p.reached, p.periods_left, p.per_period,
         g.status <> 'active' and exists (select 1 from app.goals o
                                           where o.account_id = g.account_id and o.status = 'active')
    from app.goals g
    join app.goal_progress p on p.goal_id = g.id
    join app.accounts a on a.id = g.account_id
   where g.space_id = p_space_id
   order by g.status <> 'active',
            case when g.status = 'active' then not p.reached end,
            case when g.status = 'active' then g.target_on end nulls last,
            case when g.status <> 'active' then coalesce(g.archived_at, g.completed_at) end desc,
            g.created_at, g.id;
end $$;

create function api.goal_for_account(p_account_id uuid)
returns table (goal_id uuid, name text, account_id uuid, account_name text, account_archived boolean,
               status text, target_amount bigint, target_on date, completed_at timestamptz,
               archived_at timestamptz, created_by uuid, created_at timestamptz, balance bigint, saved bigint,
               remaining bigint, pct int, reached boolean, periods_left int, per_period bigint,
               account_has_other_active boolean)
language plpgsql stable set search_path = '' as $$
begin
  -- Dompet tidak terlihat (RLS pemanggil) = ruang NULL = DK404 space_not_found; tanpa pengguna = DK401.
  perform app.assert_member((select a.space_id from app.accounts a where a.id = p_account_id));
  return query
  select l.* from api.list_goals((select a.space_id from app.accounts a where a.id = p_account_id)) l
   where l.account_id = p_account_id and l.status = 'active';
end $$;

-- ===== Arsip dompet (0103 + K6): tujuan aktif ditolak lebih dulu, lalu saldo harus 0 =====
create or replace function api.archive_account(p_account_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_acc app.accounts%rowtype;
begin
  perform private.lock_accounts(array[p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.archived_at is null then
    if exists (select 1 from app.goals g where g.account_id = v_acc.id and g.status = 'active') then
      raise exception using errcode = 'DK422', message = 'account_has_goal';
    end if;
    if private.balance(v_acc.id) <> 0 then
      raise exception using errcode = 'DK422', message = 'balance_not_zero';
    end if;
    update app.accounts set archived_at = app.now(), updated_at = app.now() where id = v_acc.id;
  end if;
  return jsonb_build_object('account_id', v_acc.id, 'archived', true);
end $$;

-- ===== Hak =====
grant execute on function private.lock_goal(uuid), private.check_goal(text, bigint) to dompetku_api;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;

-- api.archive_account kembali ke badan 0103.
create or replace function api.archive_account(p_account_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_acc app.accounts%rowtype;
begin
  perform private.lock_accounts(array[p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.archived_at is null then
    if private.balance(v_acc.id) <> 0 then
      raise exception using errcode = 'DK422', message = 'balance_not_zero';
    end if;
    update app.accounts set archived_at = app.now(), updated_at = app.now() where id = v_acc.id;
  end if;
  return jsonb_build_object('account_id', v_acc.id, 'archived', true);
end $$;

drop function api.goal_for_account(uuid);
drop function api.list_goals(uuid);
drop function api.restore_goal(uuid);
drop function api.archive_goal(uuid);
drop function api.complete_goal(uuid);
drop function api.update_goal(uuid, text, bigint, date);
drop function api.create_goal(uuid, uuid, uuid, text, bigint, date);
drop function private.check_goal(text, bigint);
drop function private.lock_goal(uuid);

select private.own_api_functions();
