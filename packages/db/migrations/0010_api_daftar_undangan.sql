-- migrate:up
-- S4 sisi server: layar Undangan tertunda (AFD §6) butuh daftar undangan pembuatnya.
-- dompetku_web tidak punya hak baca app.invitations (BSD §11), jadi lewat fungsi DEFINER milik
-- dompetku_api yang tetap dipagari policy creator_or_token (FORCE RLS). Undangan yang diganti
-- lewat kirim ulang ('resent') tidak ditampilkan; penggantinya yang tampil.
create function api.list_invitations()
returns table (id uuid, email text, created_at timestamptz, expires_at timestamptz, status text)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return query
    select i.id, i.email, i.created_at, i.expires_at,
           case when i.used_at is not null then 'accepted'
                when i.revoked_at is not null then i.revoke_reason
                when i.expires_at <= app.now() then 'expired'
                else 'pending' end
      from app.invitations i
     where i.created_by = v_uid
       and i.revoke_reason is distinct from 'resent'
     order by i.created_at desc
     limit 10;
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
drop function api.list_invitations();
