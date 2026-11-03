-- migrate:up
-- S7 (IPD §4): talangan kantor dan reimburse (BSD §2.2 butir 1, §7 bentuk reimbursement, §8.1).
-- BSD §9 menandai api.create_reimbursement dan api.open_reimbursables "belum ditulis"; keduanya
-- mengikuti pola create_entry dan fungsi baca INVOKER (dicatat di BSD §16 "Catatan S7").
-- Expand-only.
-- - api.create_reimbursement: satu entri kind reimbursement (satu line main +nominal) di dompet
--   aktif mana pun di ruang talangan; boleh sebagian; Σ reimburse hidup tidak melebihi nominal
--   talangan. Hasil menambah remaining = sisa sesudah reimburse ini.
-- - api.open_reimbursables: talangan hidup dengan sisa > 0 (INVOKER, RLS).
-- - api.update_entry (diganti utuh dari 0106): talangan dengan reimburse hidup tidak bisa
--   "Tidak diganti" (reimbursement_exists) dan nominalnya tidak boleh di bawah Σ reimburse hidup
--   (reimbursement_exceeds).
-- - private.set_void_state (diganti utuh dari 0103): pulihkan reimburse hanya bila talangannya
--   masih hidup dan reimbursable (not_reimbursable) dan Σ tetap dalam nominal
--   (reimbursement_exceeds). Tanpa ini Sampah bisa memulihkan reimburse yang melanggar invarian.
--
-- Urutan kunci: entri dulu, lalu akun urut id (BSD §9.1 "Urutan lock: entri, lalu akun"), sama
-- dengan update_entry dan set_void_state. Talangan dikunci FOR UPDATE sebelum akun tujuan: bila
-- akun dikunci lebih dulu, create_reimbursement (akun -> talangan) dan update_entry/void talangan
-- (talangan -> akun) pada dompet yang sama bisa saling tunggu (40P01). Antar entri: pulihkan
-- reimburse mengunci reimburse lalu talangan; tidak ada jalur yang mengunci talangan lalu
-- reimburse yang sudah ada (void/purge talangan hanya membaca reimburse, tanpa kunci).
-- Kunci talangan juga menyerialkan dua reimburse paralel, sehingga Σ dibaca sesudah yang lain
-- commit (READ COMMITTED: pernyataan sesudah kunci memakai snapshot baru). Diuji di
-- tests/99_konkurensi.sql (urutan akun -> talangan terbukti 40P01 di skenario itu).

-- ===== Reimburse talangan =====
create function api.create_reimbursement(
  p_client_id   uuid,
  p_entry_id    uuid,
  p_account_id  uuid,
  p_amount      bigint,
  p_occurred_on date default null,
  p_description text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_desc  text := private.clean_text(p_description, 'description');
  v_on    date;
  v_t     app.entries%rowtype;
  v_acc   app.accounts%rowtype;
  v_total bigint;
  v_done  bigint;
  v_entry uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  -- Hash dari argumen mentah (p_occurred_on sebelum default).
  v_r := private.idem_begin(v_uid, p_client_id, 'create_reimbursement', private.req_hash(
           jsonb_build_object('entry', p_entry_id, 'account', p_account_id, 'amount', p_amount,
                              'on', p_occurred_on, 'desc', v_desc)));
  if v_r is not null then
    return v_r;
  end if;
  perform private.check_amount(p_amount, 'amount');
  v_on := private.check_date(p_occurred_on);
  if p_account_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'account_id';
  end if;

  -- Entri dulu (talangan), lalu akun: lihat komentar urutan kunci di atas.
  select * into v_t from app.entries where id = p_entry_id for update;
  if v_t.id is null then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;
  if v_t.kind <> 'expense' or not v_t.reimbursable or v_t.voided_at is not null then
    raise exception using errcode = 'DK422', message = 'not_reimbursable';
  end if;

  perform private.lock_accounts(array[p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  if v_acc.space_id <> v_t.space_id then
    raise exception using errcode = 'DK422', message = 'space_mismatch';
  end if;
  if v_acc.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;
  if v_on < v_acc.opened_on then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;

  select -l.amount into v_total from app.entry_lines l where l.entry_id = v_t.id and l.role = 'main';
  select coalesce(sum(l.amount), 0)::bigint into v_done
    from app.entries r join app.entry_lines l on l.entry_id = r.id and l.role = 'main'
   where r.space_id = v_t.space_id and r.reimburses_entry_id = v_t.id and r.voided_at is null;
  if v_done + p_amount > v_total then
    raise exception using errcode = 'DK422', message = 'reimbursement_exceeds';
  end if;

  insert into app.entries (space_id, space_kind, kind, occurred_on, description,
                           reimburses_entry_id, created_by, updated_by)
  values (v_t.space_id, v_t.space_kind, 'reimbursement', v_on, v_desc, v_t.id, v_uid, v_uid)
  returning id into v_entry;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_entry, v_t.space_id, 'main', v_acc.id, p_amount);
  perform private.write_history(v_entry, 'create', v_uid);

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_entry, 'version', 1, 'warnings', '[]'::jsonb,
    'remaining', v_total - v_done - p_amount));
end $$;

-- ===== Daftar talangan terbuka (SECURITY INVOKER: RLS tetap berlaku) =====
-- amount = nominal talangan, reimbursed = Σ reimburse hidup, remaining = amount − reimbursed (> 0).
create function api.open_reimbursables(p_space_id uuid)
returns table (entry_id uuid, occurred_on date, description text, account_id uuid,
               amount bigint, reimbursed bigint, remaining bigint)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  select x.id, x.occurred_on, x.description, x.account_id, x.amount, x.reimbursed,
         x.amount - x.reimbursed
  from (
    select t.id, t.occurred_on, t.description, l.account_id, (-l.amount)::bigint as amount,
           coalesce((select sum(rl.amount)
                       from app.entries r
                       join app.entry_lines rl on rl.entry_id = r.id and rl.role = 'main'
                      where r.space_id = t.space_id and r.reimburses_entry_id = t.id
                        and r.voided_at is null), 0)::bigint as reimbursed
    from app.entries t
    join app.entry_lines l on l.entry_id = t.id and l.role = 'main'
    where t.space_id = p_space_id and t.kind = 'expense' and t.reimbursable and t.voided_at is null
  ) x
  where x.amount - x.reimbursed > 0
  order by x.occurred_on, x.id;
end $$;

-- ===== Batalkan / pulihkan (0103 + cek pulihkan reimburse) =====
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

-- ===== Ubah pemasukan/pengeluaran (0106 + cek reimburse hidup) =====
-- Kategori terarsip hanya ditolak bila p_category_id berubah ke kategori itu; entri lama boleh
-- disimpan ulang dengan kategorinya.
create or replace function api.update_entry(
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
  v_done bigint;
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
           and c.type::text = v_e.kind::text) then
      raise exception using errcode = 'DK404', message = 'category_not_found';
    end if;
    if p_category_id is distinct from v_e.category_id and exists (
         select 1 from app.categories c where c.id = p_category_id and c.archived_at is not null) then
      raise exception using errcode = 'DK422', message = 'category_archived';
    end if;
    if coalesce(p_reimbursable, false) and (v_e.kind <> 'expense' or v_e.space_kind <> 'personal') then
      raise exception using errcode = 'DK422', message = 'reimbursable_personal_expense_only';
    end if;
    -- 0110: talangan dengan reimburse hidup (entri sudah dikunci FOR UPDATE di atas, sehingga
    -- reimburse dan pulihkan reimburse paralel menunggu). "Tidak diganti" ditolak, dan nominal
    -- tidak boleh di bawah Σ reimburse hidup.
    if v_e.kind = 'expense' then
      select coalesce(sum(l.amount), 0)::bigint into v_done
        from app.entries r join app.entry_lines l on l.entry_id = r.id and l.role = 'main'
       where r.space_id = v_e.space_id and r.reimburses_entry_id = v_e.id and r.voided_at is null;
      if v_done > 0 and not coalesce(p_reimbursable, false) then
        raise exception using errcode = 'DK422', message = 'reimbursement_exists';
      end if;
      if p_amount < v_done then
        raise exception using errcode = 'DK422', message = 'reimbursement_exceeds';
      end if;
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

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'
-- (nilai bawaan dari 0001); CI/lokal mengubah env dulu sebelum rollback.
-- Entri reimbursement yang sudah ada tidak dihapus (data).
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;

-- private.set_void_state kembali ke definisi 0103, api.update_entry ke definisi 0106.
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

create or replace function api.update_entry(
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
           and c.type::text = v_e.kind::text) then
      raise exception using errcode = 'DK404', message = 'category_not_found';
    end if;
    if p_category_id is distinct from v_e.category_id and exists (
         select 1 from app.categories c where c.id = p_category_id and c.archived_at is not null) then
      raise exception using errcode = 'DK422', message = 'category_archived';
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

drop function api.open_reimbursables(uuid);
drop function api.create_reimbursement(uuid, uuid, uuid, bigint, date, text);
