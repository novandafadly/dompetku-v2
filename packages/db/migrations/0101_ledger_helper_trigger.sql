-- migrate:up
-- BSD §7, bagian S5: helper fungsi api.* (idempotensi, lock akun, saldo, riwayat, validasi),
-- cek bentuk lines dan pasangan space_transfer (constraint trigger DEFERRABLE INITIALLY DEFERRED),
-- penjaga kedalaman kategori, append-only entry_history. Disalin persis dari BSD kecuali
-- tg_category_depth (lihat komentarnya). Helper private.* milik dompetku_api lewat
-- private.own_api_functions() di akhir file (daftar nama di 0005).

-- ===== Helper untuk fungsi api.* (dimiliki dompetku_api) =====
create function private.req_hash(p jsonb) returns bytea
language sql immutable set search_path = '' as $$
  select pg_catalog.sha256(pg_catalog.convert_to(p::text, 'UTF8'))
$$;

-- NULL = kunci baru (lanjutkan); selain itu = hasil lama untuk diputar ulang.
create function private.idem_begin(p_uid uuid, p_client_id uuid, p_op text, p_hash bytea)
returns jsonb
language plpgsql set search_path = '' as $$
declare v app.idempotency_keys%rowtype;
begin
  if p_client_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'client_id';
  end if;
  insert into app.idempotency_keys (user_id, client_id, op, request_hash)
  values (p_uid, p_client_id, p_op, p_hash)
  on conflict (user_id, client_id) do nothing;
  if found then
    return null;
  end if;
  select * into v from app.idempotency_keys where user_id = p_uid and client_id = p_client_id;
  if v.op <> p_op or v.request_hash <> p_hash or v.result is null then
    raise exception using errcode = 'DK410', message = 'idempotency_key_reused';
  end if;
  return v.result || jsonb_build_object('replayed', true);
end $$;

create function private.idem_finish(p_uid uuid, p_client_id uuid, p_result jsonb) returns jsonb
language plpgsql set search_path = '' as $$
begin
  update app.idempotency_keys set result = p_result
   where user_id = p_uid and client_id = p_client_id;
  return p_result || jsonb_build_object('replayed', false);
end $$;

-- Kunci akun urut id, lalu kembalikan yang terlihat (RLS dompetku_api).
create function private.lock_accounts(p_ids uuid[]) returns void
language sql set search_path = '' as $$
  select null from app.accounts a where a.id = any (p_ids) order by a.id for no key update
$$;

create function private.get_account(p_id uuid, p_detail text) returns app.accounts
language plpgsql stable set search_path = '' as $$
declare v app.accounts%rowtype;
begin
  select * into v from app.accounts where id = p_id;
  if v.id is null or not (v.space_id = any (app.my_space_ids())) then
    raise exception using errcode = 'DK404', message = 'account_not_found', detail = p_detail;
  end if;
  return v;
end $$;

create function private.balance(p_account_id uuid) returns bigint
language sql stable set search_path = '' as $$
  select coalesce(sum(l.amount), 0)::bigint
  from app.entry_lines l join app.entries e on e.id = l.entry_id
  where l.account_id = p_account_id and e.voided_at is null
$$;

-- Tolak saldo negatif hanya bila mutasi ini mengurangi saldo (round2 A10).
create function private.assert_balance(p_account_id uuid, p_delta bigint, p_allow boolean)
returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_delta < 0 and not coalesce(p_allow, false) and private.balance(p_account_id) < 0 then
    raise exception using errcode = 'DK422', message = 'saldo_negatif', detail = 'account_id';
  end if;
end $$;

create function private.entry_snapshot(p_entry_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select to_jsonb(e) || jsonb_build_object('lines', coalesce(
           (select jsonb_agg(to_jsonb(l) order by l.role)
              from app.entry_lines l where l.entry_id = e.id), '[]'::jsonb))
  from app.entries e where e.id = p_entry_id
$$;

create function private.write_history(p_entry_id uuid, p_op app.history_op, p_uid uuid)
returns void
language sql set search_path = '' as $$
  insert into app.entry_history (entry_id, space_id, version, op, snapshot, changed_by)
  select e.id, e.space_id, e.version, p_op, private.entry_snapshot(e.id), p_uid
  from app.entries e where e.id = p_entry_id
$$;

create function private.check_date(p_on date) returns date
language plpgsql stable set search_path = '' as $$
declare v date := coalesce(p_on, app.today());
begin
  if v < date '2000-01-01' or v > app.today() then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'occurred_on';
  end if;
  return v;
end $$;

create function private.check_amount(p_amount bigint, p_detail text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_amount is null or p_amount <= 0 or p_amount > 10000000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = p_detail;
  end if;
end $$;

create function private.clean_text(p text, p_detail text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(p), '');
begin
  if length(v) > 200 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = p_detail;
  end if;
  return v;
end $$;

-- ===== Cek bentuk & pasangan (DEFINER milik owner, melihat kedua kaki) =====
create function private.assert_space_transfer_pair(p_link_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select count(*)                                       as n,
         count(distinct e.space_id)                     as n_space,
         count(*) filter (where e.space_kind = 'shared') as n_shared,
         count(distinct e.occurred_on)                  as n_date,
         count(distinct (e.voided_at is null))          as n_void_state,
         count(*) filter (where e.direction = 'out' and l.amount < 0) as n_out,
         count(*) filter (where e.direction = 'in'  and l.amount > 0) as n_in,
         coalesce(sum(l.amount), 0)                     as net,
         bool_or(a.pocket = 'kantor')                   as any_kantor
    into r
    from app.entries e
    join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
    join app.accounts a    on a.id = l.account_id
   where e.link_id = p_link_id;
  if r.n = 0 then
    return;                                            -- pasangan sudah dipurge
  end if;
  if not (r.n = 2 and r.n_space = 2 and r.n_shared >= 1 and r.n_date = 1
          and r.n_void_state = 1 and r.n_out = 1 and r.n_in = 1 and r.net = 0
          and not r.any_kantor) then
    raise exception using errcode = 'DK500', message = 'space_transfer_pair_invalid';
  end if;
end $$;

-- Matriks bentuk lines per kind (round1/backend R2, rumus fee §9.1).
create function private.assert_entry_shape(p_entry_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e  app.entries%rowtype;
  m  app.entry_lines%rowtype;
  c  app.entry_lines%rowtype;
  f  app.entry_lines%rowtype;
  ok boolean;
begin
  select * into e from app.entries where id = p_entry_id;
  if not found then
    return;
  end if;
  select * into m from app.entry_lines where entry_id = p_entry_id and role = 'main';
  select * into c from app.entry_lines where entry_id = p_entry_id and role = 'counter';
  select * into f from app.entry_lines where entry_id = p_entry_id and role = 'fee';

  ok := m.entry_id is not null
        and (f.entry_id is null or (f.amount < 0 and f.account_id = m.account_id));
  ok := ok and case
    when e.kind = 'income'  then c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'expense' then c.entry_id is null and f.entry_id is null and m.amount < 0
    when e.kind = 'reimbursement' then c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'transfer' then
         c.entry_id is not null and m.amount < 0 and c.amount = -m.amount
         and c.account_id <> m.account_id
    when e.kind = 'space_transfer' then
         c.entry_id is null
         and case e.direction when 'out' then m.amount < 0
                              else m.amount > 0 and f.entry_id is null end
    when e.kind = 'opening_balance' then
         c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'adjustment' then c.entry_id is null and f.entry_id is null
    else false
  end;
  if not ok then
    raise exception using errcode = 'DK500', message = 'entry_shape_invalid';
  end if;
  if e.kind = 'space_transfer' then
    perform private.assert_space_transfer_pair(e.link_id);
  end if;
end $$;

create function private.tg_entry_shape() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'entry_lines' then
    perform private.assert_entry_shape(case when tg_op = 'DELETE' then old.entry_id
                                            else new.entry_id end);
  else
    perform private.assert_entry_shape(new.id);
  end if;
  return null;
end $$;

create constraint trigger entry_lines_shape after insert or update or delete on app.entry_lines
  deferrable initially deferred for each row execute function private.tg_entry_shape();
create constraint trigger entries_shape after insert or update on app.entries
  deferrable initially deferred for each row execute function private.tg_entry_shape();

-- ===== Trigger penjaga kategori =====
-- BSD §7 tanpa cabang category_in_obligation: bills dan budgets belum ada di S5 (plpgsql
-- me-resolve tabel saat dipanggil, jadi cabang itu akan gagal di setiap pindah induk). Versi
-- lengkap BSD dipasang dengan create or replace di migrasi yang membuat bills/budgets (S9).
create function private.tg_category_depth() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_id is not null then
    if exists (select 1 from app.categories p where p.id = new.parent_id and p.parent_id is not null)
       or exists (select 1 from app.categories ch where ch.parent_id = new.id) then
      raise exception using errcode = 'DK422', message = 'category_depth';
    end if;
  end if;
  return new;
end $$;
create trigger category_depth before insert or update of parent_id on app.categories
  for each row execute function private.tg_category_depth();

-- Append-only entry_history (fungsi private.tg_append_only dari 0005): UPDATE dan TRUNCATE
-- selalu ditolak; DELETE hanya di dalam fungsi purge, termasuk cascade dari entries.
create trigger entry_history_append_only before update or delete on app.entry_history
  for each row execute function private.tg_append_only();
create trigger entry_history_no_truncate before truncate on app.entry_history
  for each statement execute function private.tg_append_only();

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
drop trigger entry_history_no_truncate on app.entry_history;
drop trigger entry_history_append_only on app.entry_history;
drop trigger category_depth on app.categories;
drop function private.tg_category_depth();
drop trigger entries_shape on app.entries;
drop trigger entry_lines_shape on app.entry_lines;
drop function private.tg_entry_shape();
drop function private.assert_entry_shape(uuid);
drop function private.assert_space_transfer_pair(uuid);
drop function private.clean_text(text, text);
drop function private.check_amount(bigint, text);
drop function private.check_date(date);
drop function private.write_history(uuid, app.history_op, uuid);
drop function private.entry_snapshot(uuid);
drop function private.assert_balance(uuid, bigint, boolean);
drop function private.balance(uuid);
drop function private.get_account(uuid, text);
drop function private.lock_accounts(uuid[]);
drop function private.idem_finish(uuid, uuid, jsonb);
drop function private.idem_begin(uuid, uuid, text, bytea);
drop function private.req_hash(jsonb);
