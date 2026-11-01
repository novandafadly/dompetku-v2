-- migrate:up
-- BSD §9 dan §10, bagian S5: fungsi tulis ledger (DEFINER milik dompetku_api lewat
-- private.own_api_functions di akhir file) dan purge entri (owner). Disalin persis dari BSD.
-- Kategori, anggaran, tagihan, hari tanpa pengeluaran, dan profil menyusul di sprint fiturnya.
-- Semua fungsi tulis: SECURITY DEFINER milik dompetku_api, search_path = '',
-- dibuka "set constraints all deferred" dan ditutup "set constraints all immediate".

-- ===== Dompet + saldo awal =====
create function api.create_account(
  p_client_id       uuid,
  p_space_id        uuid,
  p_name            text,
  p_pocket          app.pocket,
  p_wallet_type     app.wallet_type,
  p_opened_on       date   default null,
  p_opening_balance bigint default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_on    date;
  v_name  text := nullif(btrim(p_name), '');
  v_kind  app.space_kind;
  v_acc   uuid;
  v_entry uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'create_account', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'name', v_name, 'pocket', p_pocket, 'type', p_wallet_type,
           'on', p_opened_on, 'opening', p_opening_balance)));
  if v_r is not null then
    return v_r;
  end if;
  perform app.assert_member(p_space_id);
  if v_name is null or length(v_name) > 60 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'name';
  end if;
  if p_pocket is null or p_wallet_type is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'pocket';
  end if;
  if p_opening_balance is null or p_opening_balance < 0 or p_opening_balance > 10000000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'opening_balance';
  end if;
  v_on := private.check_date(p_opened_on);
  select s.kind into v_kind from app.spaces s where s.id = p_space_id;
  if p_pocket = 'kantor' and v_kind <> 'personal' then
    raise exception using errcode = 'DK422', message = 'kantor_personal_only';
  end if;

  insert into app.accounts (space_id, space_kind, name, pocket, wallet_type, opened_on, created_by)
  values (p_space_id, v_kind, v_name, p_pocket, p_wallet_type, v_on, v_uid)
  returning id into v_acc;

  if p_opening_balance > 0 then
    insert into app.entries (space_id, space_kind, kind, occurred_on, created_by, updated_by)
    values (p_space_id, v_kind, 'opening_balance', v_on, v_uid, v_uid)
    returning id into v_entry;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    values (v_entry, p_space_id, 'main', v_acc, p_opening_balance);
    perform private.write_history(v_entry, 'create', v_uid);
  end if;

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'account_id', v_acc, 'entry_id', v_entry, 'version', 1, 'warnings', '[]'::jsonb));
end $$;

-- ===== Pemasukan / pengeluaran =====
create function api.create_entry(
  p_client_id      uuid,
  p_space_id       uuid,
  p_account_id     uuid,
  p_kind           app.entry_kind,
  p_amount         bigint,
  p_category_id    uuid    default null,
  p_occurred_on    date    default null,
  p_description    text    default null,
  p_reimbursable   boolean default false,
  p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_desc  text := private.clean_text(p_description, 'description');
  v_on    date;
  v_acc   app.accounts%rowtype;
  v_entry uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  -- Hash dari argumen mentah (p_occurred_on sebelum default), tanpa p_allow_negative.
  v_r := private.idem_begin(v_uid, p_client_id, 'create_entry', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'account', p_account_id, 'kind', p_kind, 'amount', p_amount,
           'category', p_category_id, 'on', p_occurred_on, 'desc', v_desc,
           'reimbursable', coalesce(p_reimbursable, false))));
  if v_r is not null then
    return v_r;
  end if;
  if p_kind is null or p_kind not in ('income', 'expense') then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'kind';
  end if;
  perform private.check_amount(p_amount, 'amount');
  v_on := private.check_date(p_occurred_on);

  perform private.lock_accounts(array[p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if p_space_id is distinct from v_acc.space_id then
    raise exception using errcode = 'DK422', message = 'space_mismatch';
  end if;
  if v_acc.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;
  if v_on < v_acc.opened_on then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;
  if p_category_id is not null and not exists (
       select 1 from app.categories c
       where c.id = p_category_id and c.space_id = v_acc.space_id
         and c.type::text = p_kind::text and c.archived_at is null) then
    raise exception using errcode = 'DK404', message = 'category_not_found';
  end if;
  if coalesce(p_reimbursable, false) and (p_kind <> 'expense' or v_acc.space_kind <> 'personal') then
    raise exception using errcode = 'DK422', message = 'reimbursable_personal_expense_only';
  end if;

  insert into app.entries (space_id, space_kind, kind, occurred_on, description, category_id,
                           reimbursable, created_by, updated_by)
  values (v_acc.space_id, v_acc.space_kind, p_kind, v_on, v_desc, p_category_id,
          coalesce(p_reimbursable, false), v_uid, v_uid)
  returning id into v_entry;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_entry, v_acc.space_id, 'main', v_acc.id,
          case p_kind when 'income' then p_amount else -p_amount end);
  perform private.write_history(v_entry, 'create', v_uid);
  perform private.assert_balance(v_acc.id,
          case p_kind when 'income' then p_amount else -p_amount end, p_allow_negative);

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_entry, 'version', 1, 'warnings', '[]'::jsonb));
end $$;

-- ===== Transfer: satu ruang (1 entri) atau antar ruang (2 entri space_transfer) =====
create function api.create_transfer(
  p_client_id      uuid,
  p_space_id       uuid,
  p_from_account   uuid,
  p_to_account     uuid,
  p_amount         bigint,
  p_fee            bigint  default 0,
  p_occurred_on    date    default null,
  p_description    text    default null,
  p_shared_note    text    default null,
  p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_desc  text := private.clean_text(p_description, 'description');
  v_note  text := private.clean_text(p_shared_note, 'shared_note');
  v_on    date;
  v_from  app.accounts%rowtype;
  v_to    app.accounts%rowtype;
  v_out   uuid;
  v_in    uuid;
  v_link  uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'create_transfer', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'from', p_from_account, 'to', p_to_account, 'amount', p_amount,
           'fee', p_fee, 'on', p_occurred_on, 'desc', v_desc, 'note', v_note)));
  if v_r is not null then
    return v_r;
  end if;
  perform private.check_amount(p_amount, 'amount');
  if p_fee is null or p_fee < 0 or p_fee > 10000000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'fee';
  end if;
  if p_from_account is null or p_to_account is null or p_from_account = p_to_account then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'to_account';
  end if;
  v_on := private.check_date(p_occurred_on);

  perform private.lock_accounts(array[p_from_account, p_to_account]);
  v_from := private.get_account(p_from_account, 'from_account');
  v_to   := private.get_account(p_to_account, 'to_account');
  if p_space_id is distinct from v_from.space_id then
    raise exception using errcode = 'DK422', message = 'space_mismatch';
  end if;
  if v_from.archived_at is not null or v_to.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;
  if v_on < greatest(v_from.opened_on, v_to.opened_on) then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;

  if v_from.space_id = v_to.space_id then
    if v_note is not null then
      raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'shared_note';
    end if;
    insert into app.entries (space_id, space_kind, kind, occurred_on, description, created_by, updated_by)
    values (v_from.space_id, v_from.space_kind, 'transfer', v_on, v_desc, v_uid, v_uid)
    returning id into v_out;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    select v_out, v_from.space_id, r.role, r.account_id, r.amount
      from (values ('main'::app.line_role,    p_from_account, -p_amount),
                   ('counter'::app.line_role, p_to_account,    p_amount),
                   ('fee'::app.line_role,     p_from_account, -p_fee)) as r (role, account_id, amount)
     where r.amount <> 0;
    perform private.write_history(v_out, 'create', v_uid);
  else
    -- Antar ruang: pemanggil sudah terbukti anggota kedua ruang (get_account).
    if 'shared' <> all (array[v_from.space_kind, v_to.space_kind]) then
      raise exception using errcode = 'DK422', message = 'cross_space_not_allowed';
    end if;
    if 'kantor' = any (array[v_from.pocket, v_to.pocket]) then
      raise exception using errcode = 'DK422', message = 'cross_space_kantor';
    end if;
    v_link := gen_random_uuid();
    -- Deskripsi hanya di kaki ruang Pribadi; shared_note hanya di kaki ruang Bersama
    -- (keputusan pemilik #9). Ruang tujuan tidak melihat dompet sumber.
    insert into app.entries (space_id, space_kind, kind, occurred_on, description, shared_note,
                             link_id, direction, created_by, updated_by)
    values (v_from.space_id, v_from.space_kind, 'space_transfer', v_on,
            case when v_from.space_kind = 'personal' then v_desc end,
            case when v_from.space_kind = 'shared' then v_note end,
            v_link, 'out', v_uid, v_uid)
    returning id into v_out;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    select v_out, v_from.space_id, r.role, p_from_account, r.amount
      from (values ('main'::app.line_role, -p_amount),
                   ('fee'::app.line_role,  -p_fee)) as r (role, amount)
     where r.amount <> 0;
    insert into app.entries (space_id, space_kind, kind, occurred_on, description, shared_note,
                             link_id, direction, created_by, updated_by)
    values (v_to.space_id, v_to.space_kind, 'space_transfer', v_on,
            case when v_to.space_kind = 'personal' then v_desc end,
            case when v_to.space_kind = 'shared' then v_note end,
            v_link, 'in', v_uid, v_uid)
    returning id into v_in;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    values (v_in, v_to.space_id, 'main', p_to_account, p_amount);
    perform private.write_history(v_out, 'create', v_uid);
    perform private.write_history(v_in, 'create', v_uid);
  end if;

  perform private.assert_balance(p_from_account, -(p_amount + p_fee), p_allow_negative);
  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_out, 'linked_entry_id', v_in, 'link_id', v_link, 'version', 1,
    'warnings', '[]'::jsonb));
end $$;

-- ===== Ubah pemasukan/pengeluaran (dan saldo awal ≤ 7 hari) =====
create function api.update_entry(
  p_client_id        uuid,
  p_entry_id         uuid,
  p_expected_version int,
  p_account_id       uuid,
  p_amount           bigint,
  p_category_id      uuid,                    -- ganti-penuh: tanpa default (§9.1)
  p_occurred_on      date,                    -- NULL = tanggal lama
  p_description      text,
  p_reimbursable     boolean,
  p_allow_negative   boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_desc text := private.clean_text(p_description, 'description');
  v_e    app.entries%rowtype;
  v_old  app.entry_lines%rowtype;
  v_acc  app.accounts%rowtype;
  v_on   date;
  v_new  bigint;
  v_r    jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'update_entry', private.req_hash(jsonb_build_object(
           'entry', p_entry_id, 'version', p_expected_version, 'account', p_account_id,
           'amount', p_amount, 'category', p_category_id, 'on', p_occurred_on, 'desc', v_desc,
           'reimbursable', coalesce(p_reimbursable, false))));
  if v_r is not null then
    return v_r;
  end if;
  perform private.check_amount(p_amount, 'amount');
  if p_account_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'account_id';
  end if;

  select * into v_e from app.entries where id = p_entry_id for update;
  if v_e.id is null then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  if p_expected_version is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'expected_version';
  elsif v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if v_e.voided_at is not null then
    raise exception using errcode = 'DK422', message = 'entry_voided';
  end if;
  if v_e.kind not in ('income', 'expense', 'opening_balance') then
    raise exception using errcode = 'DK422', message = 'kind_not_editable';
  end if;
  select * into v_old from app.entry_lines where entry_id = v_e.id and role = 'main';
  perform private.lock_accounts(array[v_old.account_id, p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.space_id <> v_e.space_id then
    raise exception using errcode = 'DK422', message = 'space_mismatch';
  end if;
  -- Dompet terarsip bersaldo 0 dan harus tetap 0 (keputusan pemilik #8).
  if exists (select 1 from app.accounts a
             where a.id in (v_old.account_id, p_account_id) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  if v_e.kind = 'opening_balance' then
    -- Saldo awal: hanya nominal, akun tetap, maksimal 7 hari sejak dompet dibuat (spec §9.1).
    if p_account_id <> v_old.account_id or app.today() - (
         select (a.created_at at time zone 'Asia/Jakarta')::date
         from app.accounts a where a.id = v_old.account_id) > 7 then
      raise exception using errcode = 'DK422', message = 'opening_locked';
    end if;
    v_on := v_e.occurred_on;
    v_new := p_amount;
  else
    v_on := private.check_date(coalesce(p_occurred_on, v_e.occurred_on));
    if v_on < v_acc.opened_on then
      raise exception using errcode = 'DK422', message = 'before_opening';
    end if;
    if p_category_id is not null and not exists (
         select 1 from app.categories c
         where c.id = p_category_id and c.space_id = v_e.space_id
           and c.type::text = v_e.kind::text and c.archived_at is null) then
      raise exception using errcode = 'DK404', message = 'category_not_found';
    end if;
    if coalesce(p_reimbursable, false) and (v_e.kind <> 'expense' or v_e.space_kind <> 'personal') then
      raise exception using errcode = 'DK422', message = 'reimbursable_personal_expense_only';
    end if;
    v_new := case v_e.kind when 'income' then p_amount else -p_amount end;
  end if;

  update app.entries
     set occurred_on  = v_on,
         description  = case when kind = 'opening_balance' then null else v_desc end,
         category_id  = case when kind = 'opening_balance' then null else p_category_id end,
         reimbursable = case when kind = 'expense' then coalesce(p_reimbursable, false) else false end,
         version      = version + 1,
         updated_by   = v_uid,
         updated_at   = app.now()
   where id = v_e.id;
  delete from app.entry_lines where entry_id = v_e.id;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_e.id, v_e.space_id, 'main', p_account_id, v_new);
  perform private.write_history(v_e.id, 'update', v_uid);

  if p_account_id = v_old.account_id then
    perform private.assert_balance(p_account_id, v_new - v_old.amount, p_allow_negative);
  else
    perform private.assert_balance(v_old.account_id, -v_old.amount, p_allow_negative);
    perform private.assert_balance(p_account_id, v_new, p_allow_negative);
  end if;

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_e.id, 'version', v_e.version + 1, 'warnings', '[]'::jsonb));
end $$;

-- ===== Batalkan / pulihkan (space_transfer: kedua kaki, hanya pencatat) =====
create function private.set_void_state(
  p_client_id uuid, p_entry_id uuid, p_expected_version int, p_void boolean, p_allow_negative boolean
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_op   text := case when p_void then 'void_entry' else 'restore_entry' end;
  v_e    app.entries%rowtype;
  v_ids  uuid[];
  v_accs uuid[];
  v_acc  record;
  v_r    jsonb;
begin
  v_r := private.idem_begin(v_uid, p_client_id, v_op, private.req_hash(jsonb_build_object(
           'entry', p_entry_id, 'version', p_expected_version)));
  if v_r is not null then
    return v_r;
  end if;

  select * into v_e from app.entries where id = p_entry_id;
  if v_e.id is null then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  if v_e.kind = 'space_transfer' then
    -- Edit/void hanya oleh pencatat; selain pencatat mendapat DK404 (spec §9.1, security A1).
    if v_e.created_by <> v_uid then
      raise exception using errcode = 'DK404', message = 'entry_not_found';
    end if;
    select array_agg(id order by id) into v_ids from app.entries where link_id = v_e.link_id;
  else
    v_ids := array[v_e.id];
  end if;
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select * into v_e from app.entries where id = p_entry_id;
  if p_expected_version is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'expected_version';
  elsif v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if (v_e.voided_at is not null) = p_void then
    raise exception using errcode = 'DK422',
      message = case when p_void then 'already_voided' else 'not_voided' end;
  end if;
  if p_void and v_e.kind = 'opening_balance' then
    raise exception using errcode = 'DK422', message = 'opening_locked';
  end if;
  if p_void and exists (select 1 from app.entries r
                         where r.reimburses_entry_id = any (v_ids) and r.voided_at is null) then
    raise exception using errcode = 'DK422', message = 'has_dependents';
  end if;
  if not p_void and v_e.voided_at < app.now() - interval '90 days' then
    raise exception using errcode = 'DK422', message = 'restore_window_closed';
  end if;

  select array_agg(distinct account_id order by account_id) into v_accs
    from app.entry_lines where entry_id = any (v_ids);
  perform private.lock_accounts(v_accs);
  if exists (select 1 from app.accounts a where a.id = any (v_accs) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  update app.entries
     set voided_at  = case when p_void then app.now() end,
         voided_by  = case when p_void then v_uid end,
         version    = version + 1,
         updated_by = v_uid,
         updated_at = app.now()
   where id = any (v_ids);
  perform private.write_history(id, case when p_void then 'void' else 'restore' end::app.history_op, v_uid)
     from unnest(v_ids) as id;

  for v_acc in
    select l.account_id, sum(l.amount)::bigint as amt
    from app.entry_lines l where l.entry_id = any (v_ids) group by l.account_id
  loop
    perform private.assert_balance(v_acc.account_id,
            case when p_void then -v_acc.amt else v_acc.amt end, p_allow_negative);
  end loop;

  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_e.id, 'version', v_e.version + 1, 'affected', to_jsonb(v_ids),
    'warnings', '[]'::jsonb));
end $$;

create function api.void_entry(
  p_client_id uuid, p_entry_id uuid, p_expected_version int, p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  set constraints all deferred;
  v := private.set_void_state(p_client_id, p_entry_id, p_expected_version, true, p_allow_negative);
  set constraints all immediate;
  return v;
end $$;

create function api.restore_entry(
  p_client_id uuid, p_entry_id uuid, p_expected_version int, p_allow_negative boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  set constraints all deferred;
  v := private.set_void_state(p_client_id, p_entry_id, p_expected_version, false, p_allow_negative);
  set constraints all immediate;
  return v;
end $$;

-- ===== Sampah: hapus permanen entri batal sebelum 90 hari (keputusan pemilik #10) =====
-- Idempoten secara alami: panggilan kedua mendapat DK404 karena entri sudah tidak ada.
create function api.purge_entry(p_entry_id uuid, p_expected_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_e   app.entries%rowtype;
  v_ids uuid[];
  v_n   int;
begin
  set constraints all deferred;
  select * into v_e from app.entries where id = p_entry_id;
  if v_e.id is null or (v_e.kind = 'space_transfer' and v_e.created_by <> v_uid) then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  if v_e.kind = 'space_transfer' then
    select array_agg(id order by id) into v_ids from app.entries where link_id = v_e.link_id;
  else
    v_ids := array[v_e.id];
  end if;
  perform 1 from app.entries where id = any (v_ids) order by id for update;
  select * into v_e from app.entries where id = p_entry_id;
  if p_expected_version is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'expected_version';
  elsif v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if v_e.voided_at is null then
    raise exception using errcode = 'DK422', message = 'not_voided';
  end if;
  if exists (select 1 from app.entries r where r.reimburses_entry_id = any (v_ids)) then
    raise exception using errcode = 'DK422', message = 'has_dependents';
  end if;
  v_n := private.purge_entries(v_ids, 'entry_purged');
  set constraints all immediate;
  return jsonb_build_object('affected', to_jsonb(v_ids), 'purged', v_n);
end $$;

-- ===== Cocokkan saldo: terima saldo nyata, DB menghitung selisih =====
create function api.reconcile_balance(p_client_id uuid, p_account_id uuid, p_target_balance bigint)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_acc   app.accounts%rowtype;
  v_diff  bigint;
  v_entry uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'reconcile_balance', private.req_hash(
           jsonb_build_object('account', p_account_id, 'target', p_target_balance)));
  if v_r is not null then
    return v_r;
  end if;
  if p_target_balance is null or abs(p_target_balance) > 10000000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'target_balance';
  end if;
  perform private.lock_accounts(array[p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;
  v_diff := p_target_balance - private.balance(v_acc.id);
  if v_diff <> 0 then
    insert into app.entries (space_id, space_kind, kind, occurred_on, created_by, updated_by)
    values (v_acc.space_id, v_acc.space_kind, 'adjustment', app.today(), v_uid, v_uid)
    returning id into v_entry;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    values (v_entry, v_acc.space_id, 'main', v_acc.id, v_diff);
    perform private.write_history(v_entry, 'create', v_uid);
  end if;
  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_entry, 'version', 1, 'warnings', '[]'::jsonb));
end $$;

-- ===== Arsip dompet: hanya bila saldo 0 (keputusan pemilik #8); idempoten secara alami =====
create function api.archive_account(p_account_id uuid) returns jsonb
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
-- ===== Purge entri (owner): dipakai jobs.purge_voided dan api.purge_entry =====
create function private.purge_entries(p_ids uuid[], p_event text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform pg_catalog.set_config('dompetku.purge', 'on', true);
  -- Tombstone dari baris yang benar-benar terhapus (DELETE memeriksa ulang voided_at sesudah
  -- menunggu lock), jadi entri yang dipulihkan paralel tidak mendapat tombstone (review S5).
  with d as (
    delete from app.entries e where e.id = any (p_ids) and e.voided_at is not null
    returning e.id, e.link_id, e.space_id, e.kind, e.occurred_on, e.voided_at, e.voided_by
  ), t as (
    insert into app.entry_tombstones (entry_id, link_id, space_id, kind, occurred_on, voided_at, voided_by)
    select * from d
    on conflict (entry_id) do nothing
  )
  select count(*) into v_n from d;
  perform pg_catalog.set_config('dompetku.purge', 'off', true);
  if v_n > 0 then
    insert into audit.events (user_id, event, meta)
    values (app.current_user_id(), p_event, jsonb_build_object('count', v_n));
  end if;
  return v_n;
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
drop function private.purge_entries(uuid[], text);
drop function api.archive_account(uuid);
drop function api.reconcile_balance(uuid, uuid, bigint);
drop function api.purge_entry(uuid, int);
drop function api.restore_entry(uuid, uuid, int, boolean);
drop function api.void_entry(uuid, uuid, int, boolean);
drop function private.set_void_state(uuid, uuid, int, boolean, boolean);
drop function api.update_entry(uuid, uuid, int, uuid, bigint, uuid, date, text, boolean, boolean);
drop function api.create_transfer(uuid, uuid, uuid, uuid, bigint, bigint, date, text, text, boolean);
drop function api.create_entry(uuid, uuid, uuid, app.entry_kind, bigint, uuid, date, text, boolean,
                               boolean);
drop function api.create_account(uuid, uuid, text, app.pocket, app.wallet_type, date, bigint);
