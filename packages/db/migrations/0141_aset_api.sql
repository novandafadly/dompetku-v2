-- migrate:up
-- S14 (IPD §6, plan S14 Task 3, K2, K3, K4; ruling pengendali atas Task 1; bingkai S14-AS2 sampai AS6): API
-- aset non-kas. Expand-only: api.create_account diganti (tanda tangan baru = drop + create, argumen lama
-- tetap di posisi yang sama, p_asset_kind di akhir dengan default NULL, jadi semua pemanggil lama jalan);
-- api.reconcile_balance diganti utuh (create or replace, tanda tangan sama); dua fungsi baru.
--
-- - api.create_account: pocket `aset` wajib p_asset_kind K4 (DK400 asset_kind_invalid/asset_kind), pocket
--   lain wajib NULL (kode sama). Rincian app.asset_details ditulis di transaksi yang sama dengan dompet
--   (DQ19 menghitung dompet aset tanpa rincian). `saham` hanya Pribadi (DK422 pocket_personal_only, sebelum
--   CHECK) dan tanpa saldo awal (DK400 invalid_argument/opening_balance; isi lewat beli/saham berjalan,
--   0143). wallet_type dompet aset selalu 'cash' (argumen diabaikan, boleh NULL; UI tidak menampilkan tipe
--   untuk aset; pola dompet sistem patungan 0136). Hash idempotensi hanya memuat jenis aset bila diisi, jadi
--   kunci dompet bukan aset yang tersimpan sebelum 0141 tetap cocok saat diulang.
-- - api.revalue_asset (DEFINER, idempoten client_id): Perbarui nilai. Menerima nilai sekarang (0..10^13),
--   DB menghitung selisih dari saldo buku sesudah dompet dikunci (private.lock_accounts, pola Cocokkan
--   saldo 0103). Selisih 0 = tidak menulis (unchanged). Selisih lain = satu entri `valuation` (satu line
--   main, kelas x_valuasi) bertanggal p_on (bawaan app.today(), tidak di masa depan, tidak sebelum
--   opened_on dompet). Hanya dompet aset aktif non-saham (dompet saham hanya berubah lewat trade, ruling
--   Task 1: DK422 stock_account_trade_only). Nilai >= 0 sehingga dompet tidak pernah negatif; penjaga
--   private.tg_asset_ledger (0140) tetap lapisan kedua.
-- - api.asset_overview(ruang) (INVOKER milik owner, STABLE): satu baris per dompet aset aktif (terarsip
--   tidak ikut) urut sort_order, created_at, id: jenis, saldo buku, tanggal dan selisih valuasi hidup
--   terakhir (NULL bila belum ada). assert_member lebih dulu (pasangan/Luar DK404). market_value dan
--   missing_price_count dompet saham ditambah 0143 (Task 5).
-- - api.reconcile_balance: pocket aset = DK422 asset_account_invalid (Cocokkan saldo diganti Perbarui
--   nilai, supaya penyesuaian aset selalu x_valuasi); selebihnya = 0103.
-- - Ubah nilai awal (api.update_entry pada opening_balance dompet aset) dan arsip (api.archive_account,
--   saldo harus 0) tidak berubah: penjaga 0140 menolak nilai awal yang membuat aset negatif.
-- Tanggal valuasi tidak boleh sebelum entri hidup terakhir di dompet itu (DK422 before_latest_entry; hasil review
-- independen P1: saldo per tanggal tidak pernah negatif lewat valuasi mundur). Setoran/tarik bertanggal mundur
-- lewat transfer tetap mengikuti dompet biasa (hanya saldo sekarang dijaga; ruling).
-- Urutan kunci revalue_asset: dompet (FOR NO KEY UPDATE) lalu sisipan entri; sama dengan create_transfer,
-- jadi transfer keluar dan Perbarui nilai pada dompet yang sama diserialkan (99_konkurensi).
-- Kode galat baru: DK400 asset_kind_invalid; DK422 stock_account_trade_only (dipakai ulang 0142+), sisanya
-- dipakai ulang (asset_account_invalid 0140, pocket_personal_only, before_opening, account_archived).

drop function api.create_account(uuid, uuid, text, app.pocket, app.wallet_type, date, bigint);
create function api.create_account(
  p_client_id       uuid,
  p_space_id        uuid,
  p_name            text,
  p_pocket          app.pocket,
  p_wallet_type     app.wallet_type,
  p_opened_on       date   default null,
  p_opening_balance bigint default 0,
  p_asset_kind      text   default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_on    date;
  v_name  text := nullif(btrim(p_name), '');
  v_kind  app.space_kind;
  v_type  app.wallet_type := case when p_pocket = 'aset' then 'cash' else p_wallet_type end;
  v_acc   uuid;
  v_entry uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'create_account', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'name', v_name, 'pocket', p_pocket, 'type', p_wallet_type,
           'on', p_opened_on, 'opening', p_opening_balance)
           || case when p_asset_kind is null then '{}'::jsonb else jsonb_build_object('asset', p_asset_kind) end));
  if v_r is not null then
    return v_r;
  end if;
  perform app.assert_member(p_space_id);
  if v_name is null or length(v_name) > 60 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'name';
  end if;
  -- Dompet sistem patungan (S12-ADR1) dibuat fungsi patungan, bukan pilihan pengguna.
  if p_pocket is null or p_pocket = 'patungan' or v_type is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'pocket';
  end if;
  -- 0141: jenis aset K4 (= CHECK app.asset_details) hanya dan wajib untuk pocket aset.
  if (p_pocket = 'aset') is distinct from (p_asset_kind is not null)
     or p_asset_kind not in ('emas', 'properti', 'kendaraan', 'reksa_dana', 'deposito', 'saham', 'lainnya') then
    raise exception using errcode = 'DK400', message = 'asset_kind_invalid', detail = 'asset_kind';
  end if;
  if p_opening_balance is null or p_opening_balance < 0 or p_opening_balance > 10000000000000
     or (p_asset_kind = 'saham' and p_opening_balance <> 0) then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'opening_balance';
  end if;
  v_on := private.check_date(p_opened_on);
  select s.kind into v_kind from app.spaces s where s.id = p_space_id;
  if p_pocket = 'kantor' and v_kind <> 'personal' then
    raise exception using errcode = 'DK422', message = 'kantor_personal_only';
  end if;
  if (p_pocket = 'trading' or p_asset_kind = 'saham') and v_kind is distinct from 'personal' then
    raise exception using errcode = 'DK422', message = 'pocket_personal_only';
  end if;

  insert into app.accounts (space_id, space_kind, name, pocket, wallet_type, opened_on, created_by)
  values (p_space_id, v_kind, v_name, p_pocket, v_type, v_on, v_uid)
  returning id into v_acc;
  if p_pocket = 'aset' then
    insert into app.asset_details (account_id, space_id, space_kind, asset_kind, created_by, created_at)
    values (v_acc, p_space_id, v_kind, p_asset_kind, v_uid, app.now());
  end if;

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

-- ===== Perbarui nilai aset: terima nilai sekarang, DB menghitung selisih (pola Cocokkan saldo) =====
create function api.revalue_asset(p_client_id uuid, p_account_id uuid, p_value bigint, p_on date default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_acc   app.accounts%rowtype;
  v_on    date;
  v_diff  bigint;
  v_entry uuid;
  v_r     jsonb;
begin
  set constraints all deferred;
  v_r := private.idem_begin(v_uid, p_client_id, 'revalue_asset', private.req_hash(
           jsonb_build_object('account', p_account_id, 'value', p_value, 'on', p_on)));
  if v_r is not null then
    return v_r;
  end if;
  if p_value is null or p_value < 0 or p_value > 10000000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'value';
  end if;
  v_on := private.check_date(p_on);
  perform private.lock_accounts(array[p_account_id]);
  v_acc := private.get_account(p_account_id, 'account_id');
  perform app.assert_member(v_acc.space_id);
  if v_acc.pocket <> 'aset' then
    raise exception using errcode = 'DK422', message = 'asset_account_invalid', detail = 'account_id';
  end if;
  if exists (select 1 from app.asset_details d where d.account_id = v_acc.id and d.asset_kind = 'saham') then
    raise exception using errcode = 'DK422', message = 'stock_account_trade_only', detail = 'account_id';
  end if;
  if v_acc.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;
  if v_on < v_acc.opened_on then
    raise exception using errcode = 'DK422', message = 'before_opening';
  end if;
  -- Nilai sekarang vs saldo total: tanggal valuasi tidak boleh mendahului entri hidup lain di dompet ini,
  -- kalau tidak saldo per tanggal itu bisa negatif dan "nilainya X pada tanggal itu" salah makna.
  if exists (select 1 from app.entry_lines l join app.entries e on e.id = l.entry_id
              where l.account_id = v_acc.id and e.voided_at is null and e.occurred_on > v_on) then
    raise exception using errcode = 'DK422', message = 'before_latest_entry', detail = 'occurred_on';
  end if;
  v_diff := p_value - private.balance(v_acc.id);
  if v_diff <> 0 then
    insert into app.entries (space_id, space_kind, kind, occurred_on, created_by, updated_by)
    values (v_acc.space_id, v_acc.space_kind, 'valuation', v_on, v_uid, v_uid)
    returning id into v_entry;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    values (v_entry, v_acc.space_id, 'main', v_acc.id, v_diff);
    perform private.write_history(v_entry, 'create', v_uid);
  end if;
  set constraints all immediate;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object(
    'entry_id', v_entry, 'version', 1, 'delta', v_diff, 'unchanged', v_diff = 0, 'warnings', '[]'::jsonb));
end $$;

-- ===== Ringkasan aset satu ruang (baca, RLS pemanggil) =====
create function api.asset_overview(p_space_id uuid)
returns table (account_id uuid, name text, asset_kind text, balance bigint, last_valued_on date, last_change bigint)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  select a.id, a.name, d.asset_kind, ab.balance, v.occurred_on, v.amount
    from app.accounts a
    join app.asset_details d on d.account_id = a.id
    join app.account_balances ab on ab.account_id = a.id
    left join lateral (
      select e.occurred_on, l.amount
        from app.entries e
        join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id and l.role = 'main'
       where l.account_id = a.id and e.kind = 'valuation' and e.voided_at is null
       order by e.occurred_on desc, e.created_at desc, e.id desc
       limit 1
    ) v on true
   where a.space_id = p_space_id and a.pocket = 'aset' and a.archived_at is null
   order by a.sort_order, a.created_at, a.id;
end $$;

-- ===== Cocokkan saldo (0103 + dompet aset ditolak) =====
create or replace function api.reconcile_balance(p_client_id uuid, p_account_id uuid, p_target_balance bigint)
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
  -- 0141: nilai aset diubah lewat api.revalue_asset (x_valuasi), bukan penyesuaian x_koreksi.
  if v_acc.pocket = 'aset' then
    raise exception using errcode = 'DK422', message = 'asset_account_invalid', detail = 'account_id';
  end if;
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

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
drop function api.asset_overview(uuid);
drop function api.revalue_asset(uuid, uuid, bigint, date);

-- api.reconcile_balance kembali ke badan 0103.
create or replace function api.reconcile_balance(p_client_id uuid, p_account_id uuid, p_target_balance bigint)
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

-- api.create_account kembali ke tanda tangan dan badan 0134.
drop function api.create_account(uuid, uuid, text, app.pocket, app.wallet_type, date, bigint, text);
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
  -- Dompet sistem patungan (S12-ADR1) dibuat fungsi patungan, bukan pilihan pengguna.
  if p_pocket is null or p_pocket = 'patungan' or p_wallet_type is null then
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
  if p_pocket = 'trading' and v_kind is distinct from 'personal' then
    raise exception using errcode = 'DK422', message = 'pocket_personal_only';
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

select private.own_api_functions();
