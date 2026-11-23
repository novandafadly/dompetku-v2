-- migrate:up
-- S15 (IPD §6, plan S15 Task 4, K1, K4, K6, K11, K15, K16; bingkai S15-TR14 sampai TR21): jalur tulis entri bertrip,
-- ekspor, dan feed. Badan fungsi di bawah disalin dari versi HIDUP terakhir (pg_get_functiondef sesudah 0147, bukan dari
-- bagian migrate:down: create_entry 0106:180, update_entry 0143:855, create_split 0136:197, export_entries 0145:15,
-- shared_activity 0114:23); selain baris trip, badan identik (diff pg_get_functiondef sebelum/sesudah di review).
--
-- - Tanda tangan baru = drop + create dengan `p_trip_id uuid default null` di AKHIR (create_entry, update_entry,
--   create_split); pemanggil lama (post_bill_occurrence 0118/0122, WA createEntry, tes lama, web pra-S15) memakai
--   default null dan jalan seperti sebelumnya. Hash idempotensi memuat trip hanya bila terisi (hash bentuk lama
--   tidak berubah). api.export_entries = drop + create (kolom hasil + trip). api.shared_activity = create or replace.
-- - update_entry = ganti-penuh: trip_id = argumen (null melepas tanda). Web pra-S15 yang memanggilnya sesudah ada
--   trip MELEPAS tanda tanpa sadar (jangan rollback image web ke pra-S15 sesudah ada trip; DB maju-saja).
-- - Pra-cek ramah SEBELUM CHECK/DK500 mentah (temuan review 0146): trip tidak ada, ruang lain, atau tidak terlihat =
--   DK404 trip_not_found (seragam, tanpa orakel); trip terarsip yang BARU dipilih atau diganti = DK422 trip_archived
--   (trip yang sama pada entri yang sudah ber-trip lolos); entri bukan expense, talangan, atau dompet utama Kantor =
--   DK422 trip_entry_invalid. Saldo awal dan jenis lain: trip harus null.
-- - Urutan kunci trip -> entri -> dompet: private.lock_trip_share (FOR SHARE) sebelum select ... for update atas entri
--   dan private.lock_accounts. private.lock_trip (0147, FOR NO KEY UPDATE) bentrok dengan FOR SHARE, jadi arsip/ubah
--   trip menunggu penanda yang sedang berjalan (dan sebaliknya) tanpa siklus: jalur trip tidak pernah mengunci entri.
-- - api.create_split + p_trip_id (K6): hanya trip Bersama ruang itu; menandai pengeluaran patungan (expense_entry_id).
--   Tanda terkunci sesudahnya oleh penjaga yang ada (split_locked, 0135).
-- - api.set_entries_trip(client, trip, entri[]) (null = lepas; 1..100 id unik): kunci trip, lalu entri urut id, lalu
--   validasi seluruhnya (atomik: satu tidak layak = seluruh panggilan gagal, nol efek); hanya baris yang benar-benar
--   berubah naik versi + write_history; hasil {changed: n} (0 bila tidak ada yang berubah = idempoten alami).
--   Entri batal = entry_voided; ruang entri beda dengan trip = space_mismatch; entri patungan: menandai ke trip lain atau
--   melepas = split_locked dari penjaga yang ada. Melepas dari trip terarsip boleh.
-- - api.export_entries + kolom akhir `trip` (nama trip, null bila tidak bertrip; K11); jumlah baris, urutan, dan Σ per
--   kelas tidak berubah (join kiri satu baris per entri). api.shared_activity + filter K16 (lihat badan).
-- - api.move_entry_to_space tidak diubah (K15): entri baru tanpa trip_id (kolom eksplisit), baris lama yang batal tetap
--   bertag.
-- Kode galat: memakai DK404 trip_not_found, DK422 trip_archived, DK422 trip_entry_invalid, DK422 space_mismatch,
-- DK422 entry_voided, DK404 entry_not_found, DK400 invalid_argument/entry_ids. Pesan/detail tanpa nama dan nominal.

-- ===== Helper (INVOKER milik owner, EXECUTE dompetku_api; berjalan di bawah RLS pemanggil) =====
-- Trip terlihat (RLS pemanggil) dan, bila p_space_id diberikan, milik ruang itu: dikunci FOR SHARE. Selain itu DK404.
create function private.lock_trip_share(p_trip_id uuid, p_space_id uuid default null) returns app.trips
language plpgsql set search_path = '' as $$
declare v app.trips%rowtype;
begin
  select * into v from app.trips where id = p_trip_id and (p_space_id is null or space_id = p_space_id) for share;
  if not found then
    raise exception using errcode = 'DK404', message = 'trip_not_found';
  end if;
  return v;
end $$;

-- Pra-cek entri bertrip (K4, K8): terarsip hanya bila trip BARU dipilih atau diganti; kenali entri tidak layak sebelum
-- CHECK entries_trip_check dan private.assert_entry_shape (DK500) bersuara.
create function private.assert_trip_taggable(p_trip app.trips, p_kind app.entry_kind, p_reimbursable boolean,
                                             p_pocket text, p_is_new boolean) returns void
language plpgsql set search_path = '' as $$
begin
  if p_is_new and p_trip.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'trip_archived';
  end if;
  if p_kind <> 'expense' or coalesce(p_reimbursable, false) or p_pocket = 'kantor' then
    raise exception using errcode = 'DK422', message = 'trip_entry_invalid';
  end if;
end $$;

drop function api.create_entry(uuid, uuid, uuid, app.entry_kind, bigint, uuid, date, text, boolean, boolean);
drop function api.update_entry(uuid, uuid, integer, uuid, bigint, uuid, date, text, boolean, boolean);
drop function api.create_split(uuid, uuid, uuid, bigint, uuid, date, text, jsonb, boolean);
drop function api.export_entries(uuid, date, date);

CREATE FUNCTION api.create_entry(p_client_id uuid, p_space_id uuid, p_account_id uuid, p_kind app.entry_kind, p_amount bigint, p_category_id uuid DEFAULT NULL::uuid, p_occurred_on date DEFAULT NULL::date, p_description text DEFAULT NULL::text, p_reimbursable boolean DEFAULT false, p_allow_negative boolean DEFAULT false, p_trip_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid   uuid := private.require_user();
  v_desc  text := private.clean_text(p_description, 'description');
  v_on    date;
  v_acc   app.accounts%rowtype;
  v_entry uuid;
  v_r     jsonb;
  v_trip  app.trips%rowtype;
begin
  set constraints all deferred;
  -- Hash dari argumen mentah (p_occurred_on sebelum default), tanpa p_allow_negative.
  v_r := private.idem_begin(v_uid, p_client_id, 'create_entry', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'account', p_account_id, 'kind', p_kind, 'amount', p_amount,
           'category', p_category_id, 'on', p_occurred_on, 'desc', v_desc,
           'reimbursable', coalesce(p_reimbursable, false)) || case when p_trip_id is null then '{}'::jsonb else jsonb_build_object('trip', p_trip_id) end));
  if v_r is not null then
    return v_r;
  end if;
  if p_kind is null or p_kind not in ('income', 'expense') then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'kind';
  end if;
  perform private.check_amount(p_amount, 'amount');
  v_on := private.check_date(p_occurred_on);

  -- 0148: kunci trip (FOR SHARE) SEBELUM dompet (urutan trip -> entri -> dompet); trip ruang lain = DK404.
  if p_trip_id is not null then
    v_trip := private.lock_trip_share(p_trip_id, p_space_id);
  end if;
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
  -- S6: kategori terarsip dibedakan dari tidak ditemukan (0103 menggabungkan keduanya ke DK404).
  if p_category_id is not null and not exists (
       select 1 from app.categories c
       where c.id = p_category_id and c.space_id = v_acc.space_id
         and c.type::text = p_kind::text) then
    raise exception using errcode = 'DK404', message = 'category_not_found';
  end if;
  if p_category_id is not null and exists (
       select 1 from app.categories c where c.id = p_category_id and c.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'category_archived';
  end if;
  if coalesce(p_reimbursable, false) and (p_kind <> 'expense' or v_acc.space_kind <> 'personal') then
    raise exception using errcode = 'DK422', message = 'reimbursable_personal_expense_only';
  end if;
  if p_trip_id is not null then
    perform private.assert_trip_taggable(v_trip, p_kind, p_reimbursable, v_acc.pocket::text, true);
  end if;

  insert into app.entries (space_id, space_kind, kind, occurred_on, description, category_id,
                           reimbursable, created_by, updated_by, trip_id)
  values (v_acc.space_id, v_acc.space_kind, p_kind, v_on, v_desc, p_category_id,
          coalesce(p_reimbursable, false), v_uid, v_uid, p_trip_id)
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
end $function$;

CREATE FUNCTION api.update_entry(p_client_id uuid, p_entry_id uuid, p_expected_version integer, p_account_id uuid, p_amount bigint, p_category_id uuid, p_occurred_on date, p_description text, p_reimbursable boolean, p_allow_negative boolean DEFAULT false, p_trip_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_space uuid;
  v_trip app.trips%rowtype;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'update_entry', private.req_hash(jsonb_build_object(
           'entry', p_entry_id, 'version', p_expected_version, 'account', p_account_id,
           'amount', p_amount, 'category', p_category_id, 'on', p_occurred_on, 'desc', v_desc,
           'reimbursable', coalesce(p_reimbursable, false)) || case when p_trip_id is null then '{}'::jsonb else jsonb_build_object('trip', p_trip_id) end));
  if v_r is not null then
    return v_r;
  end if;
  perform private.check_amount(p_amount, 'amount');
  if p_account_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'account_id';
  end if;

  -- 0143: entri trade saham hanya lewat API saham, ditolak SEBELUM kunci entri (trade mengunci dompet -> entri).
  if exists (select 1 from app.entries e where e.id = p_entry_id and e.stock_trade_id is not null) then
    raise exception using errcode = 'DK422', message = 'stock_account_trade_only', detail = 'account_id';
  end if;
  -- 0148: trip baru dikunci (FOR SHARE) SEBELUM entri dan dompet (trip -> entri -> dompet). Ruang entri dibaca tanpa
  -- kunci (ruang entri tidak pernah berubah); entri tidak terlihat = entry_not_found di bawah, bukan galat trip.
  if p_trip_id is not null then
    select e.space_id into v_space from app.entries e where e.id = p_entry_id;
    if v_space is not null then
      v_trip := private.lock_trip_share(p_trip_id, v_space);
    end if;
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

  -- 0148: ganti-penuh (null = lepas). Pra-cek ramah SEBELUM CHECK entries_trip_check; trip yang sama pada entri yang
  -- sudah ber-trip lolos meski terarsip.
  if p_trip_id is not null then
    perform private.assert_trip_taggable(v_trip, v_e.kind, v_e.kind = 'expense' and coalesce(p_reimbursable, false),
                                         v_acc.pocket::text, p_trip_id is distinct from v_e.trip_id);
  end if;

  update app.entries
     set occurred_on  = v_on,
         description  = case when kind = 'opening_balance' then null else v_desc end,
         category_id  = case when kind = 'opening_balance' then null else p_category_id end,
         reimbursable = case when kind = 'expense' then coalesce(p_reimbursable, false) else false end,
         trip_id      = p_trip_id,
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
end $function$;

CREATE FUNCTION api.create_split(p_client_id uuid, p_space_id uuid, p_account_id uuid, p_amount bigint, p_category_id uuid DEFAULT NULL::uuid, p_occurred_on date DEFAULT NULL::date, p_description text DEFAULT NULL::text, p_shares jsonb DEFAULT NULL::jsonb, p_allow_negative boolean DEFAULT false, p_trip_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid := private.require_user();
  v_desc    text := private.clean_text(p_description, 'description');
  v_on      date;
  v_members uuid[];
  v_shares  jsonb;
  v_bad     boolean;
  v_acc     app.accounts%rowtype;
  v_pat     app.accounts%rowtype;
  v_legs    uuid[];
  v_exp     uuid;
  v_split   uuid;
  v_r       jsonb;
  v_trip    app.trips%rowtype;
begin
  set constraints all deferred;
  -- Hash dari argumen mentah (p_occurred_on sebelum default), tanpa p_allow_negative.
  v_r := private.idem_begin(v_uid, p_client_id, 'create_split', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'account', p_account_id, 'amount', p_amount, 'category', p_category_id,
           'on', p_occurred_on, 'desc', v_desc, 'shares', p_shares) || case when p_trip_id is null then '{}'::jsonb else jsonb_build_object('trip', p_trip_id) end));
  if v_r is not null then
    return v_r;
  end if;
  perform private.assert_split_space(p_space_id);
  -- 0148 (K6): trip Bersama ruang ini menandai pengeluaran patungan; kunci trip sebelum dompet.
  if p_trip_id is not null then
    v_trip := private.lock_trip_share(p_trip_id, p_space_id);
    perform private.assert_trip_taggable(v_trip, 'expense', false, 'patungan', true);
  end if;
  perform private.check_amount(p_amount, 'amount');
  v_on := private.check_date(p_occurred_on);
  if p_category_id is not null and not exists (
       select 1 from app.categories c
       where c.id = p_category_id and c.space_id = p_space_id and c.type = 'expense') then
    raise exception using errcode = 'DK404', message = 'category_not_found';
  end if;
  if p_category_id is not null and exists (
       select 1 from app.categories c where c.id = p_category_id and c.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'category_archived';
  end if;

  -- Bagian per anggota (semua anggota, urut user_id).
  select array_agg(m.user_id order by m.user_id) into v_members
    from app.space_members m where m.space_id = p_space_id;
  if p_shares is null then
    select jsonb_agg(jsonb_build_object('user_id', u, 'amount',
             p_amount / cardinality(v_members)
             + case when u = v_uid then p_amount % cardinality(v_members) else 0 end) order by u)
      into v_shares from unnest(v_members) u;
  else
    begin
      with s as (
        select x ->> 'user_id' as u_txt, x ->> 'amount' as a_txt
          from jsonb_array_elements(p_shares) x
      ), c as (
        select s.u_txt::uuid as u, s.a_txt::numeric as a from s
      )
      select count(*) = 0 or count(*) <> count(distinct c.u)
             or bool_or(c.u is null or c.a is null or c.a < 0 or c.a <> trunc(c.a)
                        or not coalesce(c.u = any (v_members), false))
             or coalesce(sum(c.a), 0) <> p_amount,
             (select jsonb_agg(jsonb_build_object('user_id', m.u, 'amount',
                       coalesce((select sum(c2.a)::bigint from c c2 where c2.u = m.u), 0)) order by m.u)
                from unnest(v_members) m (u))
        into v_bad, v_shares
        from c;
    exception when data_exception then
      v_bad := true;
    end;
    if v_bad then
      raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'shares';
    end if;
  end if;

  insert into private.split_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  v_pat.id := private.patungan_account(p_space_id, v_uid);
  select * into v_pat from app.accounts where id = v_pat.id;
  perform private.lock_accounts(array[v_pat.id, p_account_id]);
  v_acc := private.split_payer_account(p_account_id);
  if v_on < v_acc.opened_on then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;

  v_legs := private.split_pair(v_acc, v_pat, p_amount, v_on, v_desc, v_uid);
  insert into app.entries (space_id, space_kind, kind, occurred_on, description, category_id,
                           created_by, updated_by, trip_id)
  values (p_space_id, 'shared', 'expense', v_on, v_desc, p_category_id, v_uid, v_uid, p_trip_id)
  returning id into v_exp;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_exp, p_space_id, 'main', v_pat.id, -p_amount);
  perform private.write_history(v_exp, 'create', v_uid);

  insert into app.splits (space_id, in_entry_id, expense_entry_id, payer_id, amount, created_at)
  values (p_space_id, v_legs[2], v_exp, v_uid, p_amount, app.now())
  returning id into v_split;
  insert into app.split_shares (space_id, split_id, user_id, amount)
  select p_space_id, v_split, (x ->> 'user_id')::uuid, (x ->> 'amount')::bigint
    from jsonb_array_elements(v_shares) x;
  perform private.assert_balance(v_acc.id, -p_amount, p_allow_negative);

  delete from private.split_ctx where xid = pg_catalog.pg_current_xact_id();
  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'split_id', v_split, 'expense_entry_id', v_exp, 'in_entry_id', v_legs[2], 'out_entry_id', v_legs[1],
    'amount', p_amount, 'shares', v_shares, 'version', 1, 'warnings', '[]'::jsonb));
end $function$;

CREATE FUNCTION api.export_entries(p_space_id uuid, p_from date, p_to date)
 RETURNS TABLE(occurred_on date, kind text, role text, report_class text, account text, category text, subcategory text, amount bigint, note text, recorded_by text, trip text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_n   int;
  v_max int := coalesce((select s.value::int from app.settings s where s.key = 'export_max_rows'), 50000);
begin
  perform app.assert_member(p_space_id);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3660 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'period';
  end if;
  select count(*)::int into v_n
    from app.report_lines r
   where r.space_id = p_space_id and r.occurred_on between p_from and p_to;
  if v_n > v_max then
    raise exception using errcode = 'DK422', message = 'export_too_large';
  end if;
  perform audit.log('export', null, null, p_space_id,
                    jsonb_build_object('count', v_n, 'via', 'csv'));
  return query
  select r.occurred_on, r.entry_kind::text, r.role::text, r.report_class, a.name,
         case when c.parent_id is null then c.name else pc.name end,
         case when c.parent_id is not null then c.name end,
         r.amount,
         coalesce(nullif(e.description, ''),
                  case when e.kind in ('debt_principal', 'debt_payment')
                       then concat_ws(' · ', ct.name, d.title) end,
                  case when st.side = 'opening' then
                         format('%s %s lembar @ %s (sudah dimiliki)', sh.ticker,
                                replace(to_char(st.shares, 'FM999,999,999,999,999'), ',', '.'),
                                replace(to_char(st.price, 'FM999,999,999,999'), ',', '.'))
                       when st.id is not null then
                         format('%s lembar @ %s',
                                case when st.side = 'buy' then 'Beli ' || sh.ticker
                                     when e.kind = 'valuation' then
                                       case when r.amount >= 0 then 'Untung jual ' else 'Rugi jual ' end || sh.ticker
                                     else 'Jual ' || sh.ticker end || ' ' ||
                                  replace(to_char(st.shares, 'FM999,999,999,999,999'), ',', '.'),
                                replace(to_char(st.price, 'FM999,999,999,999'), ',', '.'))
                       when e.kind = 'valuation' then 'Perubahan nilai'
                  end,
                  e.shared_note),
         ro.display_name, tr.name
    from app.report_lines r
    join app.accounts a on a.space_id = r.space_id and a.id = r.account_id
    join app.entries e on e.space_id = r.space_id and e.id = r.entry_id
    left join app.categories c on c.space_id = r.space_id and c.id = r.category_id
    left join app.categories pc on pc.space_id = r.space_id and pc.id = c.parent_id
    left join app.debts d on d.space_id = e.space_id and d.id = e.debt_id
    left join app.contacts ct on ct.space_id = d.space_id and ct.id = d.contact_id
    left join app.stock_trades st on st.space_id = e.space_id and st.id = e.stock_trade_id
    left join app.stock_holdings sh on sh.space_id = st.space_id and sh.id = st.holding_id
    left join app.space_roster(p_space_id) ro on ro.user_id = r.created_by
    left join app.trips tr on tr.space_id = e.space_id and tr.id = e.trip_id
   where r.space_id = p_space_id and r.occurred_on between p_from and p_to
   order by r.occurred_on, r.entry_id, r.role;
end $function$;

CREATE OR REPLACE FUNCTION api.shared_activity(p_space_id uuid, p_limit integer DEFAULT 20, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_entry uuid DEFAULT NULL::uuid, p_before_version integer DEFAULT NULL::integer)
 RETURNS TABLE(entry_id uuid, version integer, op app.history_op, kind app.entry_kind, direction app.entry_direction, actor_id uuid, at timestamp with time zone, occurred_on date, amount bigint, before_amount bigint, category_id uuid, before_category_id uuid, description text, shared_note text, moved boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  perform app.assert_member(p_space_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'limit';
  end if;
  if num_nulls(p_before_at, p_before_entry, p_before_version) not in (0, 3) then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'cursor';
  end if;
  if not exists (select 1 from app.spaces s where s.id = p_space_id and s.kind = 'shared') then
    return;
  end if;
  return query
  with h as (
    select h.entry_id, h.version, h.op, h.snapshot, h.changed_by, h.changed_at
    from app.entry_history h
    where h.space_id = p_space_id
      and h.changed_at <= coalesce(p_before_at, 'infinity'::timestamptz)
      and (p_before_at is null
           or (h.changed_at, h.entry_id, h.version) < (p_before_at, p_before_entry, p_before_version))
      and h.snapshot ->> 'kind' <> 'opening_balance'
      -- 0148 (K16): update yang hanya mengubah trip_id (sisa snapshot sama) tidak tampil; disaring SEBELUM limit supaya
      -- halaman dan kursor tetap penuh dan benar. Perubahan nominal/kategori/tanggal/deskripsi/jenis tetap tampil.
      and not (h.op = 'update' and exists (
            select 1 from app.entry_history pv
             where pv.entry_id = h.entry_id and pv.version = h.version - 1 and pv.space_id = p_space_id
               and pv.snapshot ->> 'trip_id' is distinct from h.snapshot ->> 'trip_id'
               and (h.snapshot - 'trip_id' - 'version' - 'updated_at' - 'updated_by')
                 = (pv.snapshot - 'trip_id' - 'version' - 'updated_at' - 'updated_by')))
    order by h.changed_at desc, h.entry_id desc, h.version desc
    limit p_limit
  )
  select h.entry_id, h.version, h.op, k.kind,
         case when k.kind = 'adjustment'
              then case when m.amount > 0 then 'in' when m.amount < 0 then 'out' end::app.entry_direction
              else (h.snapshot ->> 'direction')::app.entry_direction end,
         h.changed_by, h.changed_at, (h.snapshot ->> 'occurred_on')::date,
         abs(m.amount), abs(pm.amount),
         (h.snapshot ->> 'category_id')::uuid, (p.snapshot ->> 'category_id')::uuid,
         case when k.kind <> 'space_transfer' then h.snapshot ->> 'description' end,
         h.snapshot ->> 'shared_note',
         h.op = 'void' and h.snapshot ->> 'moved_at' is not null
  from h
  cross join lateral (select (h.snapshot ->> 'kind')::app.entry_kind as kind) k
  left join lateral (select (l ->> 'amount')::bigint as amount
                       from jsonb_array_elements(h.snapshot -> 'lines') l
                      where l ->> 'role' = 'main') m on true
  left join app.entry_history p
         on p.entry_id = h.entry_id and p.version = h.version - 1 and p.space_id = p_space_id
  left join lateral (select (l ->> 'amount')::bigint as amount
                       from jsonb_array_elements(p.snapshot -> 'lines') l
                      where l ->> 'role' = 'main') pm on true
  order by h.changed_at desc, h.entry_id desc, h.version desc;
end $function$;

create function api.set_entries_trip(p_client_id uuid, p_trip_id uuid, p_entry_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user();
  v_ids     uuid[] := (select array_agg(x order by x) from unnest(p_entry_ids) x);
  v_trip    app.trips%rowtype;
  v_n       int;
  v_changed uuid[];
  v_id      uuid;
  v_r       jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'set_entries_trip', private.req_hash(jsonb_build_object(
           'trip', p_trip_id, 'entries', to_jsonb(v_ids))));
  if v_r is not null then
    return v_r;
  end if;
  if v_ids is null or cardinality(v_ids) not between 1 and 100 or array_position(v_ids, null) is not null
     or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'entry_ids';
  end if;

  -- Urutan kunci: trip (FOR SHARE) -> entri (urut id) -> (dompet tidak berubah: saldo tidak tersentuh).
  if p_trip_id is not null then
    v_trip := private.lock_trip_share(p_trip_id);
  end if;
  select count(*)::int into v_n
    from (select e.id from app.entries e where e.id = any (v_ids) order by e.id for update) l;
  if v_n <> cardinality(v_ids) then
    raise exception using errcode = 'DK404', message = 'entry_not_found';
  end if;

  if exists (select 1 from app.entries e where e.id = any (v_ids) and e.voided_at is not null) then
    raise exception using errcode = 'DK422', message = 'entry_voided';
  end if;
  if p_trip_id is not null then
    if exists (select 1 from app.entries e where e.id = any (v_ids) and e.space_id <> v_trip.space_id) then
      raise exception using errcode = 'DK422', message = 'space_mismatch';
    end if;
    if v_trip.archived_at is not null
       and exists (select 1 from app.entries e where e.id = any (v_ids) and e.trip_id is distinct from p_trip_id) then
      raise exception using errcode = 'DK422', message = 'trip_archived';
    end if;
    if exists (select 1 from app.entries e
                 left join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
                 left join app.accounts a on a.space_id = l.space_id and a.id = l.account_id
                where e.id = any (v_ids)
                  and (e.kind <> 'expense' or e.reimbursable or a.pocket = 'kantor')) then
      raise exception using errcode = 'DK422', message = 'trip_entry_invalid';
    end if;
  end if;

  with u as (
    update app.entries e
       set trip_id = p_trip_id, version = e.version + 1, updated_by = v_uid, updated_at = app.now()
     where e.id = any (v_ids) and e.trip_id is distinct from p_trip_id
    returning e.id)
  select coalesce(array_agg(u.id order by u.id), '{}') into v_changed from u;
  foreach v_id in array v_changed loop
    perform private.write_history(v_id, 'update', v_uid);
  end loop;

  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object('changed', cardinality(v_changed)));
end $$;

-- ===== Hak =====
grant execute on function private.lock_trip_share(uuid, uuid),
  private.assert_trip_taggable(app.trips, app.entry_kind, boolean, text, boolean) to dompetku_api;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;

drop function api.set_entries_trip(uuid, uuid, uuid[]);
drop function api.create_entry(uuid, uuid, uuid, app.entry_kind, bigint, uuid, date, text, boolean, boolean, uuid);
drop function api.update_entry(uuid, uuid, integer, uuid, bigint, uuid, date, text, boolean, boolean, uuid);
drop function api.create_split(uuid, uuid, uuid, bigint, uuid, date, text, jsonb, boolean, uuid);
drop function api.export_entries(uuid, date, date);
drop function private.assert_trip_taggable(app.trips, app.entry_kind, boolean, text, boolean);
drop function private.lock_trip_share(uuid, uuid);

-- Badan sebelum 0148 (versi hidup sesudah 0147).
CREATE OR REPLACE FUNCTION api.create_entry(p_client_id uuid, p_space_id uuid, p_account_id uuid, p_kind app.entry_kind, p_amount bigint, p_category_id uuid DEFAULT NULL::uuid, p_occurred_on date DEFAULT NULL::date, p_description text DEFAULT NULL::text, p_reimbursable boolean DEFAULT false, p_allow_negative boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- S6: kategori terarsip dibedakan dari tidak ditemukan (0103 menggabungkan keduanya ke DK404).
  if p_category_id is not null and not exists (
       select 1 from app.categories c
       where c.id = p_category_id and c.space_id = v_acc.space_id
         and c.type::text = p_kind::text) then
    raise exception using errcode = 'DK404', message = 'category_not_found';
  end if;
  if p_category_id is not null and exists (
       select 1 from app.categories c where c.id = p_category_id and c.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'category_archived';
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
end $function$;

CREATE OR REPLACE FUNCTION api.update_entry(p_client_id uuid, p_entry_id uuid, p_expected_version integer, p_account_id uuid, p_amount bigint, p_category_id uuid, p_occurred_on date, p_description text, p_reimbursable boolean, p_allow_negative boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- 0143: entri trade saham hanya lewat API saham, ditolak SEBELUM kunci entri (trade mengunci dompet -> entri).
  if exists (select 1 from app.entries e where e.id = p_entry_id and e.stock_trade_id is not null) then
    raise exception using errcode = 'DK422', message = 'stock_account_trade_only', detail = 'account_id';
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
end $function$;

CREATE OR REPLACE FUNCTION api.create_split(p_client_id uuid, p_space_id uuid, p_account_id uuid, p_amount bigint, p_category_id uuid DEFAULT NULL::uuid, p_occurred_on date DEFAULT NULL::date, p_description text DEFAULT NULL::text, p_shares jsonb DEFAULT NULL::jsonb, p_allow_negative boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid := private.require_user();
  v_desc    text := private.clean_text(p_description, 'description');
  v_on      date;
  v_members uuid[];
  v_shares  jsonb;
  v_bad     boolean;
  v_acc     app.accounts%rowtype;
  v_pat     app.accounts%rowtype;
  v_legs    uuid[];
  v_exp     uuid;
  v_split   uuid;
  v_r       jsonb;
begin
  set constraints all deferred;
  -- Hash dari argumen mentah (p_occurred_on sebelum default), tanpa p_allow_negative.
  v_r := private.idem_begin(v_uid, p_client_id, 'create_split', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'account', p_account_id, 'amount', p_amount, 'category', p_category_id,
           'on', p_occurred_on, 'desc', v_desc, 'shares', p_shares)));
  if v_r is not null then
    return v_r;
  end if;
  perform private.assert_split_space(p_space_id);
  perform private.check_amount(p_amount, 'amount');
  v_on := private.check_date(p_occurred_on);
  if p_category_id is not null and not exists (
       select 1 from app.categories c
       where c.id = p_category_id and c.space_id = p_space_id and c.type = 'expense') then
    raise exception using errcode = 'DK404', message = 'category_not_found';
  end if;
  if p_category_id is not null and exists (
       select 1 from app.categories c where c.id = p_category_id and c.archived_at is not null) then
    raise exception using errcode = 'DK422', message = 'category_archived';
  end if;

  -- Bagian per anggota (semua anggota, urut user_id).
  select array_agg(m.user_id order by m.user_id) into v_members
    from app.space_members m where m.space_id = p_space_id;
  if p_shares is null then
    select jsonb_agg(jsonb_build_object('user_id', u, 'amount',
             p_amount / cardinality(v_members)
             + case when u = v_uid then p_amount % cardinality(v_members) else 0 end) order by u)
      into v_shares from unnest(v_members) u;
  else
    begin
      with s as (
        select x ->> 'user_id' as u_txt, x ->> 'amount' as a_txt
          from jsonb_array_elements(p_shares) x
      ), c as (
        select s.u_txt::uuid as u, s.a_txt::numeric as a from s
      )
      select count(*) = 0 or count(*) <> count(distinct c.u)
             or bool_or(c.u is null or c.a is null or c.a < 0 or c.a <> trunc(c.a)
                        or not coalesce(c.u = any (v_members), false))
             or coalesce(sum(c.a), 0) <> p_amount,
             (select jsonb_agg(jsonb_build_object('user_id', m.u, 'amount',
                       coalesce((select sum(c2.a)::bigint from c c2 where c2.u = m.u), 0)) order by m.u)
                from unnest(v_members) m (u))
        into v_bad, v_shares
        from c;
    exception when data_exception then
      v_bad := true;
    end;
    if v_bad then
      raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'shares';
    end if;
  end if;

  insert into private.split_ctx values (pg_catalog.pg_current_xact_id()) on conflict do nothing;
  v_pat.id := private.patungan_account(p_space_id, v_uid);
  select * into v_pat from app.accounts where id = v_pat.id;
  perform private.lock_accounts(array[v_pat.id, p_account_id]);
  v_acc := private.split_payer_account(p_account_id);
  if v_on < v_acc.opened_on then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;

  v_legs := private.split_pair(v_acc, v_pat, p_amount, v_on, v_desc, v_uid);
  insert into app.entries (space_id, space_kind, kind, occurred_on, description, category_id,
                           created_by, updated_by)
  values (p_space_id, 'shared', 'expense', v_on, v_desc, p_category_id, v_uid, v_uid)
  returning id into v_exp;
  insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
  values (v_exp, p_space_id, 'main', v_pat.id, -p_amount);
  perform private.write_history(v_exp, 'create', v_uid);

  insert into app.splits (space_id, in_entry_id, expense_entry_id, payer_id, amount, created_at)
  values (p_space_id, v_legs[2], v_exp, v_uid, p_amount, app.now())
  returning id into v_split;
  insert into app.split_shares (space_id, split_id, user_id, amount)
  select p_space_id, v_split, (x ->> 'user_id')::uuid, (x ->> 'amount')::bigint
    from jsonb_array_elements(v_shares) x;
  perform private.assert_balance(v_acc.id, -p_amount, p_allow_negative);

  delete from private.split_ctx where xid = pg_catalog.pg_current_xact_id();
  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'split_id', v_split, 'expense_entry_id', v_exp, 'in_entry_id', v_legs[2], 'out_entry_id', v_legs[1],
    'amount', p_amount, 'shares', v_shares, 'version', 1, 'warnings', '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION api.export_entries(p_space_id uuid, p_from date, p_to date)
 RETURNS TABLE(occurred_on date, kind text, role text, report_class text, account text, category text, subcategory text, amount bigint, note text, recorded_by text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_n   int;
  v_max int := coalesce((select s.value::int from app.settings s where s.key = 'export_max_rows'), 50000);
begin
  perform app.assert_member(p_space_id);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3660 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'period';
  end if;
  select count(*)::int into v_n
    from app.report_lines r
   where r.space_id = p_space_id and r.occurred_on between p_from and p_to;
  if v_n > v_max then
    raise exception using errcode = 'DK422', message = 'export_too_large';
  end if;
  perform audit.log('export', null, null, p_space_id,
                    jsonb_build_object('count', v_n, 'via', 'csv'));
  return query
  select r.occurred_on, r.entry_kind::text, r.role::text, r.report_class, a.name,
         case when c.parent_id is null then c.name else pc.name end,
         case when c.parent_id is not null then c.name end,
         r.amount,
         coalesce(nullif(e.description, ''),
                  case when e.kind in ('debt_principal', 'debt_payment')
                       then concat_ws(' · ', ct.name, d.title) end,
                  case when st.side = 'opening' then
                         format('%s %s lembar @ %s (sudah dimiliki)', sh.ticker,
                                replace(to_char(st.shares, 'FM999,999,999,999,999'), ',', '.'),
                                replace(to_char(st.price, 'FM999,999,999,999'), ',', '.'))
                       when st.id is not null then
                         format('%s lembar @ %s',
                                case when st.side = 'buy' then 'Beli ' || sh.ticker
                                     when e.kind = 'valuation' then
                                       case when r.amount >= 0 then 'Untung jual ' else 'Rugi jual ' end || sh.ticker
                                     else 'Jual ' || sh.ticker end || ' ' ||
                                  replace(to_char(st.shares, 'FM999,999,999,999,999'), ',', '.'),
                                replace(to_char(st.price, 'FM999,999,999,999'), ',', '.'))
                       when e.kind = 'valuation' then 'Perubahan nilai'
                  end,
                  e.shared_note),
         ro.display_name
    from app.report_lines r
    join app.accounts a on a.space_id = r.space_id and a.id = r.account_id
    join app.entries e on e.space_id = r.space_id and e.id = r.entry_id
    left join app.categories c on c.space_id = r.space_id and c.id = r.category_id
    left join app.categories pc on pc.space_id = r.space_id and pc.id = c.parent_id
    left join app.debts d on d.space_id = e.space_id and d.id = e.debt_id
    left join app.contacts ct on ct.space_id = d.space_id and ct.id = d.contact_id
    left join app.stock_trades st on st.space_id = e.space_id and st.id = e.stock_trade_id
    left join app.stock_holdings sh on sh.space_id = st.space_id and sh.id = st.holding_id
    left join app.space_roster(p_space_id) ro on ro.user_id = r.created_by
   where r.space_id = p_space_id and r.occurred_on between p_from and p_to
   order by r.occurred_on, r.entry_id, r.role;
end $function$;

CREATE OR REPLACE FUNCTION api.shared_activity(p_space_id uuid, p_limit integer DEFAULT 20, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_entry uuid DEFAULT NULL::uuid, p_before_version integer DEFAULT NULL::integer)
 RETURNS TABLE(entry_id uuid, version integer, op app.history_op, kind app.entry_kind, direction app.entry_direction, actor_id uuid, at timestamp with time zone, occurred_on date, amount bigint, before_amount bigint, category_id uuid, before_category_id uuid, description text, shared_note text, moved boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  perform app.assert_member(p_space_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'limit';
  end if;
  if num_nulls(p_before_at, p_before_entry, p_before_version) not in (0, 3) then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'cursor';
  end if;
  if not exists (select 1 from app.spaces s where s.id = p_space_id and s.kind = 'shared') then
    return;
  end if;
  return query
  with h as (
    select h.entry_id, h.version, h.op, h.snapshot, h.changed_by, h.changed_at
    from app.entry_history h
    where h.space_id = p_space_id
      and h.changed_at <= coalesce(p_before_at, 'infinity'::timestamptz)
      and (p_before_at is null
           or (h.changed_at, h.entry_id, h.version) < (p_before_at, p_before_entry, p_before_version))
      and h.snapshot ->> 'kind' <> 'opening_balance'
    order by h.changed_at desc, h.entry_id desc, h.version desc
    limit p_limit
  )
  select h.entry_id, h.version, h.op, k.kind,
         case when k.kind = 'adjustment'
              then case when m.amount > 0 then 'in' when m.amount < 0 then 'out' end::app.entry_direction
              else (h.snapshot ->> 'direction')::app.entry_direction end,
         h.changed_by, h.changed_at, (h.snapshot ->> 'occurred_on')::date,
         abs(m.amount), abs(pm.amount),
         (h.snapshot ->> 'category_id')::uuid, (p.snapshot ->> 'category_id')::uuid,
         case when k.kind <> 'space_transfer' then h.snapshot ->> 'description' end,
         h.snapshot ->> 'shared_note',
         h.op = 'void' and h.snapshot ->> 'moved_at' is not null
  from h
  cross join lateral (select (h.snapshot ->> 'kind')::app.entry_kind as kind) k
  left join lateral (select (l ->> 'amount')::bigint as amount
                       from jsonb_array_elements(h.snapshot -> 'lines') l
                      where l ->> 'role' = 'main') m on true
  left join app.entry_history p
         on p.entry_id = h.entry_id and p.version = h.version - 1 and p.space_id = p_space_id
  left join lateral (select (l ->> 'amount')::bigint as amount
                       from jsonb_array_elements(p.snapshot -> 'lines') l
                      where l ->> 'role' = 'main') pm on true
  order by h.changed_at desc, h.entry_id desc, h.version desc;
end $function$;

select private.own_api_functions();
