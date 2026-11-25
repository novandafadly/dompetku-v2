-- migrate:up
-- S18 (IPD §6 S18, plan S18 K1/K4): penyimpanan lampiran foto struk terenkripsi AES-256-GCM.
-- Expand-only: satu tabel (app.entry_attachments) + 4 fungsi API (2 baca INVOKER, 2 tulis DEFINER).
--
-- - Ciphertext bytea (AES-256-GCM) disimpan di Postgres agar 0 langkah VM baru (container web
--   read_only), otomatis ikut backup WAL-G terenkripsi, dan dilindungi RLS ENABLE + FORCE.
-- - Maks 2 MiB per foto (2.097.152 byte), maks 3 foto per entri (dijaga atomik dengan FOR UPDATE
--   pada baris app.entries), hanya image/jpeg, image/png, image/webp.
-- - FK entry_id ON DELETE CASCADE sehingga saat jobs.purge_voided menghapus entri > 90 hari,
--   seluruh ciphertext struk ikut terhapus permanen. FK uploaded_by ON DELETE RESTRICT (BSD §5).

create table app.entry_attachments (
  id          uuid primary key,
  space_id    uuid not null references app.spaces (id) on delete restrict,
  entry_id    uuid not null references app.entries (id) on delete cascade,
  uploaded_by uuid not null references auth."user" (id) on delete restrict,
  mime_type   text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size   int not null check (byte_size between 1 and 2097152),
  ciphertext  bytea not null check (octet_length(ciphertext) between 1 and 2097152),
  iv          bytea not null check (octet_length(iv) = 12),
  auth_tag    bytea not null check (octet_length(auth_tag) = 16),
  key_version smallint not null default 1 check (key_version >= 1),
  created_at  timestamptz not null default now()
);

-- Setiap FK berindeks (00_katalog.sql #26): space_id, entry_id, uploaded_by.
create index entry_attachments_space_entry
  on app.entry_attachments (space_id, entry_id, created_at);
create index entry_attachments_entry
  on app.entry_attachments (entry_id);
create index entry_attachments_uploaded_by
  on app.entry_attachments (uploaded_by);

alter table app.entry_attachments enable row level security;
alter table app.entry_attachments force row level security;

create policy member_read on app.entry_attachments for select to dompetku_web, dompetku_api
  using (space_id = any(app.my_space_ids()));
create policy member_write on app.entry_attachments for all to dompetku_api
  using (space_id = any(app.my_space_ids()))
  with check (space_id = any(app.my_space_ids()));

grant select on app.entry_attachments to dompetku_web, dompetku_api, dompetku_auditor;
grant insert, delete on app.entry_attachments to dompetku_api;

-- Daftar metadata lampiran satu entri (tanpa ciphertext agar kueri halaman Detail ringan).
create function api.list_entry_attachments(p_space_id uuid, p_entry_id uuid)
returns table (
  id uuid,
  mime_type text,
  byte_size int,
  uploaded_by uuid,
  created_at timestamptz
)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  select a.id, a.mime_type, a.byte_size, a.uploaded_by, a.created_at
    from app.entry_attachments a
   where a.space_id = p_space_id
     and a.entry_id = p_entry_id
   order by a.created_at asc, a.id asc;
end $$;

-- Ambil satu lampiran lengkap beserta ciphertext/iv/auth_tag untuk didekripsi server.
create function api.get_entry_attachment(p_space_id uuid, p_attachment_id uuid)
returns table (
  id uuid,
  entry_id uuid,
  mime_type text,
  byte_size int,
  ciphertext bytea,
  iv bytea,
  auth_tag bytea,
  key_version smallint
)
language plpgsql stable set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);
  return query
  select a.id, a.entry_id, a.mime_type, a.byte_size,
         a.ciphertext, a.iv, a.auth_tag, a.key_version
    from app.entry_attachments a
   where a.space_id = p_space_id
     and a.id = p_attachment_id;
end $$;

-- Tambah lampiran foto struk terenkripsi (atomik, maks 3 per entri hidup ruang ini).
create function api.add_entry_attachment(
  p_space_id uuid,
  p_entry_id uuid,
  p_attachment_id uuid,
  p_mime_type text,
  p_byte_size int,
  p_ciphertext bytea,
  p_iv bytea,
  p_auth_tag bytea,
  p_key_version smallint default 1
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_void  timestamptz;
  v_moved timestamptz;
  v_cnt   int;
  v_now   timestamptz := app.now();
begin
  perform app.assert_member(p_space_id);
  if p_attachment_id is null or p_entry_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument';
  end if;
  if p_mime_type is null or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception using errcode = 'DK400', message = 'invalid_mime_type';
  end if;
  if p_byte_size is null or p_byte_size < 1 or p_byte_size > 2097152 then
    raise exception using errcode = 'DK400', message = 'file_too_large';
  end if;
  if p_ciphertext is null or octet_length(p_ciphertext) < 1 or octet_length(p_ciphertext) > 2097152
     or p_iv is null or octet_length(p_iv) <> 12
     or p_auth_tag is null or octet_length(p_auth_tag) <> 16
     or p_key_version is null or p_key_version < 1 then
    raise exception using errcode = 'DK400', message = 'invalid_ciphertext';
  end if;

  select e.voided_at, e.moved_at
    into v_void, v_moved
    from app.entries e
   where e.id = p_entry_id and e.space_id = p_space_id
     for update;

  if not found then
    raise exception using errcode = 'DK404', message = 'not_found';
  end if;
  if v_void is not null or v_moved is not null then
    raise exception using errcode = 'DK422', message = 'entry_voided';
  end if;

  select count(*)::int
    into v_cnt
    from app.entry_attachments a
   where a.space_id = p_space_id and a.entry_id = p_entry_id;

  if v_cnt >= 3 then
    raise exception using errcode = 'DK422', message = 'attachment_limit';
  end if;

  insert into app.entry_attachments (
    id, space_id, entry_id, uploaded_by, mime_type, byte_size,
    ciphertext, iv, auth_tag, key_version, created_at
  ) values (
    p_attachment_id, p_space_id, p_entry_id, v_uid, p_mime_type, p_byte_size,
    p_ciphertext, p_iv, p_auth_tag, p_key_version, v_now
  );

  return jsonb_build_object(
    'attachment_id', p_attachment_id,
    'entry_id', p_entry_id,
    'mime_type', p_mime_type,
    'byte_size', p_byte_size,
    'created_at', v_now
  );
end $$;

-- Hapus permanen satu lampiran foto struk (byte ciphertext hilang tuntas).
create function api.delete_entry_attachment(p_space_id uuid, p_attachment_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
begin
  perform app.assert_member(p_space_id);
  if p_attachment_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument';
  end if;
  delete from app.entry_attachments a
   where a.space_id = p_space_id
     and a.id = p_attachment_id;
  if not found then
    raise exception using errcode = 'DK404', message = 'not_found';
  end if;
  return jsonb_build_object('deleted', true, 'attachment_id', p_attachment_id, 'by', v_uid);
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

drop function api.delete_entry_attachment(uuid, uuid);
drop function api.add_entry_attachment(uuid, uuid, uuid, text, int, bytea, bytea, bytea, smallint);
drop function api.get_entry_attachment(uuid, uuid);
drop function api.list_entry_attachments(uuid, uuid);
revoke all on app.entry_attachments from dompetku_web, dompetku_api, dompetku_auditor;
drop policy member_write on app.entry_attachments;
drop policy member_read on app.entry_attachments;
drop table app.entry_attachments;

select private.own_api_functions();
