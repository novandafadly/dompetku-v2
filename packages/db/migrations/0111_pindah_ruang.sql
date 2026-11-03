-- migrate:up
-- S7 (AFD §8, bingkai S7-D2): "Pindahkan ke ruang lain". BSD §9 menandai api.move_entry_to_space
-- "belum ditulis"; mengikuti pola create_entry/update_entry (dicatat di BSD §16 "Catatan S7").
-- Expand-only: satu kolom nullable baru, fungsi baru, dua fungsi diganti utuh.
-- - app.entries.moved_at: di entri ASAL, waktu dipindah (= voided_at). Sengaja tanpa penunjuk ke
--   entri baru dan entri baru tanpa penunjuk ke asal: tidak ada id entri ruang lain di baris maupun
--   snapshot entry_history (to_jsonb baris) ke arah mana pun, jadi anggota Bersama tidak pernah
--   menerima id entri Pribadi (Global Constraint S7). Id entri baru hanya dikembalikan ke pemanggil
--   (pencatat, anggota kedua ruang).
-- - api.move_entry_to_space: dalam satu transaksi membatalkan entri asal (versi diperiksa,
--   moved_at diisi) dan membuat ulang entri income/expense di ruang tujuan dengan nominal
--   dan tanggal yang sama, dompet dan kategori ruang tujuan. Hanya pencatat entri (not_creator).
--   Dompet asal atau tujuan ber-pocket kantor ditolak cross_space_kantor (sama dengan transfer
--   antar ruang); talangan dari dompet operasional tetap boleh.
--   Deskripsi: tujuan Pribadi selalu ikut; tujuan Bersama hanya bila p_keep_description (bawaan
--   tidak ikut, keputusan pemilik #9). shared_note tidak dipakai income/expense (CHECK 0100).
--   Talangan: reimburse hidup = reimbursement_exists; tanpa reimburse hidup, reimbursable dilepas
--   bila tujuan bukan Pribadi (CHECK reimbursable hanya expense Pribadi). Reimburse batal tetap
--   menunjuk asal (FK); memulihkannya ditolak not_reimbursable karena asal sudah batal, dan purge
--   asal menunggu reimburse itu dipurge lebih dulu (jobs.purge_voided).
--   Urutan kunci: entri asal FOR UPDATE, lalu akun asal + tujuan urut id (private.lock_accounts),
--   sama dengan update_entry, set_void_state, dan create_reimbursement (BSD §9.1). Diuji di
--   tests/99_konkurensi.sql (pindah paralel ubah entri yang sama, pindah paralel reimburse).
--   p_allow_negative tidak masuk hash, sama dengan create_entry/update_entry/create_transfer:
--   kirim ulang sesudah konfirmasi saldo = replay, bukan DK410.
-- - private.set_void_state (diganti utuh dari 0110): pulihkan entri ber-moved_at ditolak
--   DK422 entry_moved (sesudah kunci entri, sebelum jendela 90 hari). Dicek di sini, bukan di
--   pembungkus api.restore_entry, agar pemeriksaan terjadi sesudah FOR UPDATE: pulihkan yang
--   mengantre di belakang pindah membaca baris yang sudah dipindah.
-- - api.trash_list (diganti utuh dari 0102): entri yang dipindah tidak tampil di Sampah. Purge
--   90 hari tetap normal (jobs.purge_voided tidak berubah).

alter table app.entries add column moved_at timestamptz;
alter table app.entries add constraint entries_moved_check
  check (moved_at is null or (voided_at is not null and kind in ('income', 'expense')));

-- ===== Pindahkan ke ruang lain =====
create function api.move_entry_to_space(
  p_client_id        uuid,
  p_entry_id         uuid,
  p_expected_version int,
  p_to_space_id      uuid,
  p_account_id       uuid,
  p_category_id      uuid,
  p_keep_description boolean default false,
  p_allow_negative   boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_e     app.entries%rowtype;
  v_old   app.entry_lines%rowtype;
  v_acc   app.accounts%rowtype;
  v_entry uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'move_entry_to_space', private.req_hash(
           jsonb_build_object('entry', p_entry_id, 'version', p_expected_version,
                              'to_space', p_to_space_id, 'account', p_account_id,
                              'category', p_category_id,
                              'keep_desc', coalesce(p_keep_description, false))));
  if v_r is not null then
    return v_r;
  end if;
  if p_to_space_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'to_space_id';
  end if;
  if p_account_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'account_id';
  end if;

  -- Entri dulu, lalu akun (lihat komentar urutan kunci di atas). RLS: bukan anggota = tidak ada.
  select * into v_e from app.entries where id = p_entry_id for update;
  if v_e.id is null then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  if v_e.created_by <> v_uid then
    raise exception using errcode = 'DK422', message = 'not_creator';
  end if;
  if p_expected_version is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'expected_version';
  elsif v_e.version <> p_expected_version then
    raise exception using errcode = 'DK409', message = 'version_conflict';
  end if;
  if v_e.voided_at is not null then
    raise exception using errcode = 'DK422', message = 'entry_voided';
  end if;
  if v_e.kind not in ('income', 'expense') then
    raise exception using errcode = 'DK422', message = 'kind_not_movable';
  end if;
  if p_to_space_id = v_e.space_id then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'to_space_id';
  end if;
  perform app.assert_member(p_to_space_id);
  -- Reimburse hidup dibaca sesudah kunci entri: reimburse dan pulihkan reimburse paralel
  -- mengunci entri ini lebih dulu, jadi yang di-commit sebelumnya terlihat di sini.
  if exists (select 1 from app.entries r
             where r.space_id = v_e.space_id and r.reimburses_entry_id = v_e.id
               and r.voided_at is null) then
    raise exception using errcode = 'DK422', message = 'reimbursement_exists';
  end if;

  select * into v_old from app.entry_lines where entry_id = v_e.id and role = 'main';
  perform private.lock_accounts(array[v_old.account_id, p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.space_id <> p_to_space_id then
    raise exception using errcode = 'DK422', message = 'space_mismatch';
  end if;
  if exists (select 1 from app.accounts a
             where a.id in (v_old.account_id, p_account_id) and a.pocket = 'kantor') then
    raise exception using errcode = 'DK422', message = 'cross_space_kantor';
  end if;
  -- Dompet terarsip bersaldo 0 dan harus tetap 0 (keputusan pemilik #8), termasuk dompet asal.
  if exists (select 1 from app.accounts a
             where a.id in (v_old.account_id, p_account_id) and a.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;
  if v_e.occurred_on < v_acc.opened_on then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;
  if p_category_id is not null and not exists (
       select 1 from app.categories c
       where c.id = p_category_id and c.space_id = v_acc.space_id
         and c.type::text = v_e.kind::text and c.archived_at is null) then
    raise exception using errcode = 'DK404', message = 'category_not_found';
  end if;

  insert into app.entries (space_id, space_kind, kind, occurred_on, description, category_id,
                           reimbursable, created_by, updated_by)
  values (v_acc.space_id, v_acc.space_kind, v_e.kind, v_e.occurred_on,
          case when v_acc.space_kind = 'personal' or coalesce(p_keep_description, false)
               then v_e.description end,
          p_category_id, v_e.reimbursable and v_acc.space_kind = 'personal', v_uid, v_uid)
  returning id into v_entry;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_entry, v_acc.space_id, 'main', v_acc.id, v_old.amount);

  update app.entries
     set voided_at         = app.now(),
         voided_by         = v_uid,
         moved_at          = app.now(),
         version           = version + 1,
         updated_by        = v_uid,
         updated_at        = app.now()
   where id = v_e.id;
  perform private.write_history(v_e.id, 'void', v_uid);
  perform private.write_history(v_entry, 'create', v_uid);

  perform private.assert_balance(v_old.account_id, -v_old.amount, p_allow_negative);
  perform private.assert_balance(v_acc.id, v_old.amount, p_allow_negative);

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_entry, 'moved_from_entry_id', v_e.id, 'version', 1, 'warnings', '[]'::jsonb));
end $$;

-- ===== Batalkan / pulihkan (0110 + tolak pulihkan entri yang dipindah) =====
create or replace function private.set_void_state(
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
  v_t    app.entries%rowtype;
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
  -- 0111: entri yang sudah dipindah ke ruang lain tidak bisa dipulihkan (dibaca sesudah kunci).
  if not p_void and v_e.moved_at is not null then
    raise exception using errcode = 'DK422', message = 'entry_moved';
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
  -- 0110: reimburse yang dipulihkan harus tetap sah: talangan hidup dan reimbursable, Σ reimburse
  -- hidup (termasuk yang ini) tidak melebihi nominal. Kunci reimburse (di atas) lalu talangan.
  if not p_void and v_e.kind = 'reimbursement' then
    select * into v_t from app.entries where id = v_e.reimburses_entry_id for update;
    if v_t.id is null or v_t.kind <> 'expense' or not v_t.reimbursable or v_t.voided_at is not null then
      raise exception using errcode = 'DK422', message = 'not_reimbursable';
    end if;
    if (select coalesce(sum(l.amount), 0)
          from app.entries r join app.entry_lines l on l.entry_id = r.id and l.role = 'main'
         where r.space_id = v_t.space_id and r.reimburses_entry_id = v_t.id
           and (r.voided_at is null or r.id = v_e.id))
       > (select -l.amount from app.entry_lines l where l.entry_id = v_t.id and l.role = 'main') then
      raise exception using errcode = 'DK422', message = 'reimbursement_exceeds';
    end if;
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

-- ===== Sampah (0102 + tanpa entri yang dipindah) =====
-- Sampah (keputusan pemilik #10): entri batal yang masih bisa dipulihkan (<= 90 hari).
-- Pulihkan = api.restore_entry; hapus permanen = api.purge_entry.
create or replace function api.trash_list(p_space_id uuid, p_limit int default 50)
returns table (entry_id uuid, version int, kind app.entry_kind, direction app.entry_direction,
               occurred_on date, description text, amount bigint, voided_at timestamptz,
               voided_by uuid, purge_after timestamptz)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'limit';
  end if;
  return query
  select e.id, e.version, e.kind, e.direction, e.occurred_on, e.description,
         (select abs(l.amount) from app.entry_lines l where l.entry_id = e.id and l.role = 'main'),
         e.voided_at, e.voided_by, e.voided_at + interval '90 days'
  from app.entries e
  where e.space_id = p_space_id and e.voided_at is not null
    and e.voided_at >= app.now() - interval '90 days'
    and e.moved_at is null
  order by e.voided_at desc, e.id desc
  limit p_limit;
end $$;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'
-- (nilai bawaan dari 0001); CI/lokal mengubah env dulu sebelum rollback.
-- Entri yang sudah dipindah tetap batal (data); sesudah rollback penanda pindahnya hilang.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;

-- private.set_void_state kembali ke definisi 0110, api.trash_list ke definisi 0102.
create or replace function private.set_void_state(
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
  v_t    app.entries%rowtype;
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
  -- 0110: reimburse yang dipulihkan harus tetap sah: talangan hidup dan reimbursable, Σ reimburse
  -- hidup (termasuk yang ini) tidak melebihi nominal. Kunci reimburse (di atas) lalu talangan.
  if not p_void and v_e.kind = 'reimbursement' then
    select * into v_t from app.entries where id = v_e.reimburses_entry_id for update;
    if v_t.id is null or v_t.kind <> 'expense' or not v_t.reimbursable or v_t.voided_at is not null then
      raise exception using errcode = 'DK422', message = 'not_reimbursable';
    end if;
    if (select coalesce(sum(l.amount), 0)
          from app.entries r join app.entry_lines l on l.entry_id = r.id and l.role = 'main'
         where r.space_id = v_t.space_id and r.reimburses_entry_id = v_t.id
           and (r.voided_at is null or r.id = v_e.id))
       > (select -l.amount from app.entry_lines l where l.entry_id = v_t.id and l.role = 'main') then
      raise exception using errcode = 'DK422', message = 'reimbursement_exceeds';
    end if;
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

create or replace function api.trash_list(p_space_id uuid, p_limit int default 50)
returns table (entry_id uuid, version int, kind app.entry_kind, direction app.entry_direction,
               occurred_on date, description text, amount bigint, voided_at timestamptz,
               voided_by uuid, purge_after timestamptz)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'limit';
  end if;
  return query
  select e.id, e.version, e.kind, e.direction, e.occurred_on, e.description,
         (select abs(l.amount) from app.entry_lines l where l.entry_id = e.id and l.role = 'main'),
         e.voided_at, e.voided_by, e.voided_at + interval '90 days'
  from app.entries e
  where e.space_id = p_space_id and e.voided_at is not null
    and e.voided_at >= app.now() - interval '90 days'
  order by e.voided_at desc, e.id desc
  limit p_limit;
end $$;

drop function api.move_entry_to_space(uuid, uuid, int, uuid, uuid, uuid, boolean, boolean);
alter table app.entries drop constraint entries_moved_check;
alter table app.entries drop column moved_at;
