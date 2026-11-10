-- migrate:up
-- Catat lewat WhatsApp (spec 2026-11-09 §4.3, §4.4, §5.3, §5.5, §6).
-- - app.wa_links: satu nomor E.164 per user, satu user per nomor (PK user_id + unik phone_e164).
-- - app.wa_link_codes: kode hubung sekali pakai 10 menit; hanya hash SHA-256 yang disimpan.
--   Anti tebak-kode ada di web (batas laju `hubung`), bukan di DB (keputusan controller Task 2).
-- - app.wa_messages: dedupe id pesan WhatsApp dan "catatan WhatsApp terakhir" untuk batal. Tanpa
--   teks mentah pesan. entry_version = versi entri saat dicatat (batal hanya bila versi sama).
-- - Fungsi tanpa konteks user (wa_confirm_link, wa_resolve_sender): DEFINER milik dompetku_api
--   (NOBYPASSRLS), EXECUTE hanya dompetku_web. Baris user lain terlihat oleh api hanya lewat GUC
--   lokal transaksi yang diisi fungsi itu sendiri lalu dikosongkan lagi (pola app.invite_token_hash
--   di 0008), jadi web tidak pernah membaca nomor/kode user lain.
-- - wa_claim_message/wa_finish_message INVOKER (tulis di bawah policy `own` web, pola
--   app.product_events); wa_default_account/wa_last_cancellable INVOKER STABLE.
-- - Event audit sistem baru wa_linked/wa_unlinked: ditulis private.wa_audit (owner), masuk CHECK
--   audit.events dan daftar reserved audit.log. Meta hanya {"via": ...}, tanpa nomor.

-- ===== Tabel =====
create table app.wa_links (
  user_id     uuid primary key references auth."user" (id) on delete restrict,
  phone_e164  text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  verified_at timestamptz not null
);

create table app.wa_link_codes (
  user_id    uuid primary key references auth."user" (id) on delete restrict,
  code_hash  text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);

create table app.wa_messages (
  message_id    text primary key check (length(message_id) between 1 and 256),
  user_id       uuid not null references auth."user" (id) on delete restrict,
  entry_id      uuid,
  entry_version int check (entry_version >= 1),
  status        text not null
                check (status in ('pending', 'recorded', 'rejected', 'cancelled', 'ignored')),
  created_at    timestamptz not null default now(),
  check (status <> 'recorded' or (entry_id is not null and entry_version is not null))
);
create index on app.wa_messages (user_id, created_at desc);

-- ===== RLS =====
do $$
declare t text;
begin
  foreach t in array array['app.wa_links', 'app.wa_link_codes', 'app.wa_messages'] loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
  end loop;
end $$;

-- Web: hanya baris sendiri (status "terhubung" di pengaturan). Tulis lewat api.wa_*.
create policy own_read on app.wa_links for select to dompetku_web
  using (user_id = (select app.current_user_id()));
-- Api: baris sendiri, atau baris yang dicari fungsi tanpa konteks user lewat GUC lokal.
-- Invarian (policy ini diperlebar GUC): setiap fungsi api DEFINER baru yang menyentuh
-- app.wa_links atau app.wa_link_codes WAJIB memfilter dengan uid pemanggil
-- (private.require_user()/app.current_user_id()), atau mengisi sendiri GUC app.wa_user_id,
-- app.wa_phone, app.wa_code_hash lalu mengosongkannya lagi sebelum kembali. GUC yang tertinggal
-- dari fungsi lain membuat baris user lain terlihat oleh api.
create policy own_or_lookup on app.wa_links for all to dompetku_api
  using (user_id = (select app.current_user_id())
         or user_id = (select nullif(current_setting('app.wa_user_id', true), '')::uuid)
         or phone_e164 = (select nullif(current_setting('app.wa_phone', true), '')))
  with check (user_id = (select app.current_user_id())
         or user_id = (select nullif(current_setting('app.wa_user_id', true), '')::uuid)
         or phone_e164 = (select nullif(current_setting('app.wa_phone', true), '')));
create policy own_or_lookup on app.wa_link_codes for all to dompetku_api
  using (user_id = (select app.current_user_id())
         or user_id = (select nullif(current_setting('app.wa_user_id', true), '')::uuid)
         or code_hash = (select nullif(current_setting('app.wa_code_hash', true), '')))
  with check (user_id = (select app.current_user_id())
         or user_id = (select nullif(current_setting('app.wa_user_id', true), '')::uuid)
         or code_hash = (select nullif(current_setting('app.wa_code_hash', true), '')));
create policy own on app.wa_messages for all to dompetku_web
  using (user_id = (select app.current_user_id()))
  with check (user_id = (select app.current_user_id()));

grant select on app.wa_links to dompetku_web;
grant select, insert, update on app.wa_messages to dompetku_web;
grant select, insert, update, delete on app.wa_links, app.wa_link_codes to dompetku_api;

-- ===== Audit: event sistem WA =====
alter table audit.events drop constraint events_event_check;
alter table audit.events add constraint events_event_check check (event in (
  'login_success', 'login_failed', 'logout', 'step_up',
  'password_reset_requested', 'password_reset_done',
  'factor_added', 'factor_removed', 'recovery_code_used', 'recovery_codes_regenerated',
  'session_revoked', 'invitation_created', 'invitation_revoked', 'invitation_declined',
  'invitation_accepted', 'space_member_change', 'unfinished_user_purged',
  'export', 'space_move', 'entry_purged', 'purge_voided', 'db_manual_access', 'deploy',
  'wa_linked', 'wa_unlinked'));

create or replace function audit.log(
  p_event text, p_ip inet default null, p_user_agent text default null,
  p_space_id uuid default null, p_meta jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_event in ('space_member_change', 'unfinished_user_purged', 'entry_purged', 'purge_voided',
                 'db_manual_access', 'deploy', 'wa_linked', 'wa_unlinked') then
    raise exception using errcode = 'DK422', message = 'audit_event_reserved';
  end if;
  insert into audit.events (event, user_id, ip, user_agent, space_id, meta)
  values (p_event, app.current_user_id(), p_ip, left(p_user_agent, 200),
          case when p_space_id = any (app.my_space_ids()) then p_space_id end,
          coalesce(p_meta, '{}'::jsonb));
end $$;

-- Owner (BYPASSRLS, satu-satunya penulis audit.events): hanya dua event WA, tanpa nomor.
create function private.wa_audit(p_user_id uuid, p_event text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_event not in ('wa_linked', 'wa_unlinked') then
    raise exception using errcode = 'DK422', message = 'audit_event_reserved';
  end if;
  insert into audit.events (user_id, event, meta)
  values (p_user_id, p_event,
          jsonb_build_object('via', case p_event when 'wa_linked' then 'whatsapp' else 'app' end));
end $$;
grant execute on function private.wa_audit(uuid, text) to dompetku_api;

-- ===== Tautan nomor =====
-- Kode 6 karakter dari 32 simbol tanpa 0/O/1/I (5 bit per karakter, tanpa bias modulo) dari
-- gen_random_uuid() (pg_strong_random; byte 0-5 UUID v4 acak penuh). Kode lama user ditimpa;
-- hash bentrok dengan kode user lain (unik) = buat ulang.
-- Hash = SHA-256 tanpa salt atas ruang 30 bit (32^6): siapa pun yang membaca code_hash bisa
-- membalik kode dengan brute force. Diterima: kode hanya berlaku 10 menit, tabel hanya terbaca
-- owner dan dompetku_api (tanpa grant ke web/worker), dan percobaan `hubung` dibatasi laju di web.
create function api.wa_create_link_code() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_abc  constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_exp  timestamptz := app.now() + interval '10 minutes';
  v_raw  bytea;
  v_code text;
begin
  if not exists (select 1 from app.profiles p where p.user_id = v_uid) then
    raise exception using errcode = 'DK401', message = 'unauthenticated';
  end if;
  for i in 1 .. 5 loop
    v_raw := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
    v_code := '';
    for j in 0 .. 5 loop
      v_code := v_code || pg_catalog.substr(v_abc, (pg_catalog.get_byte(v_raw, j) & 31) + 1, 1);
    end loop;
    begin
      insert into app.wa_link_codes (user_id, code_hash, expires_at)
      values (v_uid, pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_code, 'UTF8')), 'hex'), v_exp)
      on conflict (user_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at;
      return jsonb_build_object('code', v_code, 'expires_at', v_exp);
    exception when unique_violation then
      null;  -- hash sama dengan kode aktif user lain: coba kode lain
    end;
  end loop;
  raise exception using errcode = 'DK500', message = 'link_code_exhausted';
end $$;

-- Webhook (tanpa konteks user): kode cocok + belum kedaluwarsa + nomor E.164 + nomor belum milik
-- user lain -> simpan nomor (mengganti nomor lama user itu), hapus kode, audit wa_linked.
-- Semua kegagalan = NULL tanpa membedakan sebab.
create function api.wa_confirm_link(p_code text, p_phone text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_code text := pg_catalog.upper(pg_catalog.btrim(p_code));
  v_hash text;
  v_uid  uuid;
begin
  perform private.require_read_committed();
  if v_code is null or v_code !~ '^[0-9A-Z]{6}$'
     or p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    return null;
  end if;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_code, 'UTF8')), 'hex');
  perform pg_catalog.set_config('app.wa_code_hash', v_hash, true);
  perform pg_catalog.set_config('app.wa_phone', p_phone, true);
  perform pg_catalog.set_config('app.wa_user_id', '', true);
  select c.user_id into v_uid from app.wa_link_codes c
   where c.code_hash = v_hash and c.expires_at > app.now() for update;
  if v_uid is not null
     and not exists (select 1 from app.wa_links l where l.phone_e164 = p_phone and l.user_id <> v_uid) then
    perform pg_catalog.set_config('app.wa_user_id', v_uid::text, true);
    begin
      insert into app.wa_links (user_id, phone_e164, verified_at)
      values (v_uid, p_phone, app.now())
      on conflict (user_id) do update set phone_e164 = excluded.phone_e164, verified_at = excluded.verified_at;
      delete from app.wa_link_codes c where c.user_id = v_uid;
      perform private.wa_audit(v_uid, 'wa_linked');
    exception when unique_violation then
      v_uid := null;  -- nomor diambil user lain secara bersamaan
    end;
  else
    v_uid := null;
  end if;
  perform pg_catalog.set_config('app.wa_code_hash', '', true);
  perform pg_catalog.set_config('app.wa_phone', '', true);
  perform pg_catalog.set_config('app.wa_user_id', '', true);
  return v_uid;
end $$;

-- Webhook (tanpa konteks user): nomor terhubung -> user_id, selain itu NULL. Hanya membaca.
create function api.wa_resolve_sender(p_phone text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    return null;
  end if;
  perform pg_catalog.set_config('app.wa_user_id', '', true);
  perform pg_catalog.set_config('app.wa_phone', p_phone, true);
  select l.user_id into v_uid from app.wa_links l where l.phone_e164 = p_phone;
  perform pg_catalog.set_config('app.wa_phone', '', true);
  return v_uid;
end $$;

-- Putuskan (user): hapus nomor dan kode tertunda; audit hanya bila ada nomor yang diputus.
create function api.wa_unlink() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_n   int;
begin
  delete from app.wa_link_codes c where c.user_id = v_uid;
  delete from app.wa_links l where l.user_id = v_uid;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform private.wa_audit(v_uid, 'wa_unlinked');
  end if;
end $$;

-- ===== Dompet bawaan (spec 4.4) =====
-- Dompet aktif di ruang ini yang paling baru dipakai user (kaki 'main' entri income/expense hidup
-- buatannya, urut created_at), selain itu dompet aktif pertama dengan kantong operasional lebih
-- dulu, lalu sort_order, created_at, id (sama dengan Catat: "operasional pertama; lalu dompet
-- pertama"). Kantong kantor tidak pernah jadi bawaan di kedua cabang: pengeluaran WA sesudah
-- talangan tidak boleh diam-diam masuk dompet kantor (kantor_keluar, 0102).
-- INVOKER: ruang di luar keanggotaan tidak terlihat (RLS) -> NULL.
create function api.wa_default_account(p_space_id uuid) returns uuid
language sql stable set search_path = '' as $$
  select coalesce(
    (select l.account_id
       from app.entries e
       join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
       join app.accounts a on a.id = l.account_id and a.archived_at is null and a.pocket <> 'kantor'
      where e.space_id = p_space_id
        and e.created_by = app.current_user_id()
        and e.voided_at is null
        and e.kind in ('income', 'expense')
      order by e.created_at desc, e.id desc
      limit 1),
    (select a.id from app.accounts a
      where a.space_id = p_space_id and a.archived_at is null and a.pocket <> 'kantor'
      order by (a.pocket <> 'operasional'), a.sort_order, a.created_at, a.id
      limit 1))
$$;

-- ===== Pesan (dedupe, status, batal) =====
-- true = id pesan baru (baris dibuat dengan status 'pending'), atau klaim 'pending' milik sendiri
-- yang lebih tua dari 30 detik (proses sebelumnya mati sebelum finish; created_at disegarkan agar
-- hanya satu pengambil alih yang menang); selain itu false.
create function api.wa_claim_message(p_message_id text) returns boolean
language plpgsql set search_path = '' as $$
declare
  v_uid uuid := app.current_user_id();
  v_n   int;
begin
  if v_uid is null then
    raise exception using errcode = 'DK401', message = 'unauthenticated';
  end if;
  insert into app.wa_messages (message_id, user_id, status, created_at)
  values (p_message_id, v_uid, 'pending', app.now())
  on conflict (message_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 1 then
    return true;
  end if;
  update app.wa_messages m set created_at = app.now()
   where m.message_id = p_message_id and m.user_id = v_uid and m.status = 'pending'
     and m.created_at < app.now() - interval '30 seconds';
  return found;
end $$;

-- Status akhir pesan sendiri. Entri harus terlihat oleh user (RLS); versinya dicatat agar batal
-- hanya berlaku bila entri belum diubah sejak itu.
create function api.wa_finish_message(p_message_id text, p_status text, p_entry_id uuid default null)
returns void
language plpgsql set search_path = '' as $$
declare
  v_uid uuid := app.current_user_id();
  v_ver int;
begin
  if v_uid is null then
    raise exception using errcode = 'DK401', message = 'unauthenticated';
  end if;
  if p_entry_id is not null then
    select e.version into v_ver from app.entries e where e.id = p_entry_id;
    if v_ver is null then
      raise exception using errcode = 'DK404', message = 'entry_not_found';
    end if;
  end if;
  update app.wa_messages m set status = p_status, entry_id = p_entry_id, entry_version = v_ver
   where m.message_id = p_message_id and m.user_id = v_uid;
  if not found then
    raise exception using errcode = 'DK404', message = 'wa_message_not_found';
  end if;
end $$;

-- Catatan WhatsApp terakhir user = pesan 'pending', 'recorded' atau 'cancelled' terbaru selain
-- pesan `batal` yang sedang diproses (p_current, sudah diklaim 'pending'). Hanya bila yang terbaru
-- itu 'recorded', dicatat <= 10 menit lalu, entri masih hidup dan versinya sama dengan saat
-- dicatat: {entry_id, space_id, version}; selain itu NULL. Pesan 'pending' (catatan yang masih
-- berjalan, atau finish('recorded') gagal sesudah createEntry) menghalangi batal: tanpa ini batal
-- bisa mengenai catatan yang lebih lama. Tanpa mundur ke pesan yang lebih lama: batal kedua
-- sesudah batal pertama tidak menghapus catatan sebelumnya.
create function api.wa_last_cancellable(p_current text) returns jsonb
language sql stable set search_path = '' as $$
  select case when m.status = 'recorded' and m.created_at >= app.now() - interval '10 minutes'
               and e.id is not null and e.voided_at is null and e.version = m.entry_version
              then jsonb_build_object('entry_id', e.id, 'space_id', e.space_id, 'version', e.version)
         end
  from (select w.status, w.entry_id, w.entry_version, w.created_at from app.wa_messages w
         where w.user_id = app.current_user_id()
           and w.status in ('pending', 'recorded', 'cancelled')
           and w.message_id <> p_current
         order by w.created_at desc, w.message_id desc
         limit 1) m
  left join app.entries e on e.id = m.entry_id
$$;

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
drop function api.wa_last_cancellable(text);
drop function api.wa_finish_message(text, text, uuid);
drop function api.wa_claim_message(text);
drop function api.wa_default_account(uuid);
drop function api.wa_unlink();
drop function api.wa_resolve_sender(text);
drop function api.wa_confirm_link(text, text);
drop function api.wa_create_link_code();
drop function private.wa_audit(uuid, text);

create or replace function audit.log(
  p_event text, p_ip inet default null, p_user_agent text default null,
  p_space_id uuid default null, p_meta jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_event in ('space_member_change', 'unfinished_user_purged', 'entry_purged', 'purge_voided',
                 'db_manual_access', 'deploy') then
    raise exception using errcode = 'DK422', message = 'audit_event_reserved';
  end if;
  insert into audit.events (event, user_id, ip, user_agent, space_id, meta)
  values (p_event, app.current_user_id(), p_ip, left(p_user_agent, 200),
          case when p_space_id = any (app.my_space_ids()) then p_space_id end,
          coalesce(p_meta, '{}'::jsonb));
end $$;

alter table audit.events drop constraint events_event_check;
alter table audit.events add constraint events_event_check check (event in (
  'login_success', 'login_failed', 'logout', 'step_up',
  'password_reset_requested', 'password_reset_done',
  'factor_added', 'factor_removed', 'recovery_code_used', 'recovery_codes_regenerated',
  'session_revoked', 'invitation_created', 'invitation_revoked', 'invitation_declined',
  'invitation_accepted', 'space_member_change', 'unfinished_user_purged',
  'export', 'space_move', 'entry_purged', 'purge_voided', 'db_manual_access', 'deploy'));

drop table app.wa_messages;
drop table app.wa_link_codes;
drop table app.wa_links;
