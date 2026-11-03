-- migrate:up
-- S6 (IPD §4): fungsi api kategori dan kategori awal ruang.
-- - api.create_category disalin persis dari BSD §9.
-- - api.update_category dan api.archive_category ditulis mengikuti pola BSD (§9 menandainya
--   "belum ditulis"); dicatat di BSD §16 "Catatan S6".
-- - Kategori awal = CATEGORIES di packages/demo-data/src/seed.ts per jenis ruang (keputusan pemilik
--   2026-11-01), lahir saat anggota masuk ruang yang belum punya kategori (trigger di
--   app.space_members), plus backfill untuk ruang yang sudah ada.
-- - api.create_entry dan api.update_entry diganti utuh (disalin dari 0103) dengan cek
--   category_archived. Down mengembalikan definisi 0103.

-- ===== Kategori awal =====
-- DEFINER milik dompetku_api (NOBYPASSRLS): insert tetap dipagari policy member_write, jadi hanya
-- berhasil dengan konteks anggota ruang (app.user_id). Mengembalikan jumlah baris baru; 0 bila
-- ruang sudah punya kategori (termasuk yang diarsipkan). Urutan values = urutan seed demo.
create function private.seed_categories(p_space_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_kind app.space_kind;
  v_n    int := 0;
  r      record;
begin
  select s.kind into v_kind from app.spaces s
   where s.id = p_space_id and s.id = any (app.my_space_ids());
  if v_kind is null then
    raise exception using errcode = 'DK404', message = 'space_not_found';
  end if;
  if exists (select 1 from app.categories c where c.space_id = p_space_id) then
    return 0;
  end if;
  -- Induk dulu (parent null), lalu anak; induk dicari lewat nama di ruang yang sama.
  for r in
    select v.ord, v.name, v.type::app.category_type as type, v.icon, v.parent
    from (values
      ('personal',  1, 'Gaji',                'income',  'Briefcase',    null),
      ('personal',  2, 'Makan Siang & Minum', 'expense', 'ForkKnife',    null),
      ('personal',  3, 'Kopi & Camilan',      'expense', 'Coffee',       null),
      ('personal',  4, 'Transportasi',        'expense', 'Motorcycle',   null),
      ('personal',  5, 'Belanja',             'expense', 'ShoppingBag',  null),
      ('personal',  6, 'Hiburan',             'expense', 'FilmSlate',    null),
      ('personal',  7, 'Kesehatan',           'expense', 'Heartbeat',    null),
      ('personal',  8, 'Langganan',           'expense', 'Repeat',       null),
      ('personal',  9, 'Cicilan & Tagihan',   'expense', 'Receipt',      null),
      ('personal', 10, 'Perjalanan Dinas',    'expense', 'Briefcase',    null),
      ('shared',    1, 'Kontribusi Farida',   'income',  'HandCoins',    null),
      ('shared',    2, 'Sewa Rumah',          'expense', 'House',        null),
      ('shared',    3, 'Listrik & Air',       'expense', 'Lightning',    null),
      ('shared',    4, 'Internet',            'expense', 'WifiHigh',     null),
      ('shared',    5, 'Iuran Lingkungan',    'expense', 'UsersThree',   null),
      ('shared',    6, 'Belanja Dapur',       'expense', 'ShoppingCart', null),
      ('shared',    7, 'Sayur & Buah',        'expense', 'Carrot',       'Belanja Dapur'),
      ('shared',    8, 'Makan di Luar',       'expense', 'ForkKnife',    null),
      ('shared',    9, 'Bensin & Parkir',     'expense', 'GasPump',      null)
    ) as v (kind, ord, name, type, icon, parent)
    where v.kind = v_kind::text
    order by v.parent is not null, v.ord
  loop
    insert into app.categories (space_id, parent_id, type, name, icon, is_system, sort_order)
    values (p_space_id,
            (select c.id from app.categories c
              where c.space_id = p_space_id and c.parent_id is null and c.type = r.type
                and c.name = r.parent),
            r.type, r.name, r.icon, true, r.ord);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Anggota pertama masuk ruang (provisioning: api.bootstrap_owner, api.accept_invitation). Di titik
-- ini app.my_space_ids() sudah memuat ruang baru, jadi insert lolos member_write.
create function private.tg_seed_categories() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.seed_categories(new.space_id);
  return null;
end $$;
create trigger seed_categories after insert on app.space_members
  for each row execute function private.tg_seed_categories();

-- ===== Kategori: buat (BSD §9, persis) =====
create function api.create_category(
  p_client_id uuid, p_space_id uuid, p_type app.category_type, p_name text, p_icon text,
  p_parent_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_id  uuid;
  v_r   jsonb;
begin
  v_r := private.idem_begin(v_uid, p_client_id, 'create_category', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'type', p_type, 'name', btrim(p_name), 'icon', p_icon,
           'parent', p_parent_id)));
  if v_r is not null then
    return v_r;
  end if;
  perform app.assert_member(p_space_id);
  insert into app.categories (space_id, parent_id, type, name, icon)
  values (p_space_id, p_parent_id, p_type, btrim(p_name), p_icon)
  returning id into v_id;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object('category_id', v_id));
end $$;

-- ===== Kategori: ubah (ganti penuh; idempoten secara alami) =====
-- Jenis dan ruang tidak bisa diubah. Nama ganda di induk yang sama = 23505 (indeks unik parsial,
-- sama dengan create_category); kedalaman > 2 = DK422 category_depth (trigger 0101).
-- Kategori dan induk barunya dikunci (for update) dalam urutan id, sebelum dibaca ulang dan sebelum
-- trigger kedalaman: dua re-parent konkuren (A di bawah B, B di bawah A) saling menunggu, sehingga
-- yang kedua melihat hasil yang pertama di READ COMMITTED dan ditolak category_depth.
create function api.update_category(p_category_id uuid, p_name text, p_icon text, p_parent_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_name text := nullif(btrim(p_name), '');
  v_c    app.categories%rowtype;
  v_p    app.categories%rowtype;
begin
  select * into v_c from app.categories where id = p_category_id;
  if v_c.id is null or not (v_c.space_id = any (app.my_space_ids())) then
    raise exception using errcode = 'DK404', message = 'category_not_found';
  end if;
  -- Hanya baris ruang yang sama: induk ruang lain tidak pernah dikunci (ditolak DK404 di bawah).
  perform 1 from app.categories
    where space_id = v_c.space_id and id in (p_category_id, p_parent_id)
    order by id
    for update;
  select * into v_c from app.categories where id = p_category_id;
  if v_c.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'category_archived';
  end if;
  if v_name is null or length(v_name) > 40 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'name';
  end if;
  if p_icon is null or p_icon !~ '^[A-Z][A-Za-z0-9]{0,39}$' then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'icon';
  end if;
  if p_parent_id is not null then
    if p_parent_id = v_c.id then
      raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'parent_id';
    end if;
    select * into v_p from app.categories where id = p_parent_id;
    if v_p.id is null or v_p.space_id <> v_c.space_id then
      raise exception using errcode = 'DK404', message = 'category_not_found', detail = 'parent_id';
    end if;
    if v_p.type <> v_c.type then
      raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'parent_id';
    end if;
    if v_p.archived_at is not null then
      raise exception using errcode = 'DK422', message = 'category_archived', detail = 'parent_id';
    end if;
  end if;
  update app.categories
     set name = v_name, icon = p_icon, parent_id = p_parent_id
   where id = v_c.id;
  return jsonb_build_object('category_id', v_c.id);
end $$;

-- ===== Kategori: arsip (idempoten secara alami; anak aktif ikut diarsipkan) =====
-- affected = jumlah baris yang berubah (panggilan kedua = 0). Entri lama tetap memakai kategorinya.
create function api.archive_category(p_category_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_c   app.categories%rowtype;
  v_n   int;
begin
  select * into v_c from app.categories where id = p_category_id for update;
  if v_c.id is null or not (v_c.space_id = any (app.my_space_ids())) then
    raise exception using errcode = 'DK404', message = 'category_not_found';
  end if;
  update app.categories
     set archived_at = app.now()
   where space_id = v_c.space_id and (id = v_c.id or parent_id = v_c.id) and archived_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('category_id', v_c.id, 'archived', true, 'affected', v_n);
end $$;

-- ===== Pemasukan / pengeluaran (0103 + category_archived) =====
create or replace function api.create_entry(
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
end $$;

-- ===== Ubah pemasukan/pengeluaran (0103 + category_archived) =====
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

-- ===== Kepemilikan =====
-- api.*: lewat own_api_functions (template). Fungsi kategori awal di private bukan bagian daftar
-- own_api_functions, jadi dipindah ke dompetku_api di sini (pola yang sama: CREATE sementara).
select private.own_api_functions();
grant create on schema private to dompetku_api;
alter function private.seed_categories(uuid) owner to dompetku_api;
alter function private.tg_seed_categories() owner to dompetku_api;
revoke create on schema private from dompetku_api;

-- ===== Backfill: ruang yang sudah ada tanpa kategori =====
-- Pemilik migrasi (BYPASSRLS) hanya membaca; insert lewat private.seed_categories (DEFINER milik
-- dompetku_api) dengan konteks anggota pertama ruang, sehingga policy member_write tetap berlaku.
do $$
declare r record;
begin
  for r in
    select s.id,
           (select m.user_id from app.space_members m
             where m.space_id = s.id order by m.joined_at, m.user_id limit 1) as uid
    from app.spaces s
    where not exists (select 1 from app.categories c where c.space_id = s.id)
    order by s.created_at, s.id
  loop
    continue when r.uid is null;
    perform pg_catalog.set_config('app.user_id', r.uid::text, true);
    perform private.seed_categories(r.id);
  end loop;
  perform pg_catalog.set_config('app.user_id', '', true);
end $$;

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'
-- (nilai bawaan dari 0001); CI/lokal mengubah env dulu sebelum rollback.
-- Kategori awal yang sudah tersisip tidak dihapus (data).
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;

-- api.create_entry dan api.update_entry kembali ke definisi 0103.
create or replace function api.create_entry(
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

drop function api.archive_category(uuid);
drop function api.update_category(uuid, text, text, uuid);
drop function api.create_category(uuid, uuid, app.category_type, text, text, uuid);
drop trigger seed_categories on app.space_members;
drop function private.tg_seed_categories();
drop function private.seed_categories(uuid);
