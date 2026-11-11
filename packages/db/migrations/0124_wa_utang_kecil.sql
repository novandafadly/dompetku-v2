-- migrate:up
-- Utang kecil Catat WhatsApp (handoff wa.md, "Data dan DB"):
-- 1. app.wa_messages.created_at tidak boleh diisi web dengan nilai bebas. Grant INSERT/UPDATE
--    web mencakup semua kolom (fungsi wa_claim_message INVOKER menulis sebagai web), jadi
--    pemaksaan dilakukan trigger: untuk role dompetku_web, created_at selalu app.now() saat
--    INSERT, dan saat UPDATE hanya boleh tetap atau disegarkan ke app.now() (ambil alih klaim
--    basi). Role lain (owner/worker untuk purge dan tes) tidak dibatasi.
-- 2. api.wa_finish_message: entri yang dikaitkan harus dibuat user pemanggil
--    (e.created_by = uid). Tanpa ini user bisa menempelkan entri anggota lain di ruang Bersama
--    ke pesannya sendiri lalu membatalkannya lewat `batal`.

create function private.wa_messages_clock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'dompetku_web' then
    if tg_op = 'INSERT' then
      new.created_at := app.now();
    elsif new.created_at is distinct from old.created_at then
      new.created_at := app.now();
    end if;
  end if;
  return new;
end $$;

create trigger wa_messages_clock before insert or update on app.wa_messages
  for each row execute function private.wa_messages_clock();

create or replace function api.wa_finish_message(p_message_id text, p_status text, p_entry_id uuid default null)
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
    select e.version into v_ver from app.entries e
     where e.id = p_entry_id and e.created_by = v_uid;
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

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi).
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;
create or replace function api.wa_finish_message(p_message_id text, p_status text, p_entry_id uuid default null)
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
drop trigger wa_messages_clock on app.wa_messages;
drop function private.wa_messages_clock();
