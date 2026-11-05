-- migrate:up
-- S8 (IPD §5, plan S8 Task 2, bingkai S8-A2/A3): feed aktivitas Bersama api.shared_activity.
-- Fungsi baru (expand-only); api.activity_feed (0102) tidak diubah dan tetap tidak dipanggil web.
--
-- - SECURITY INVOKER + STABLE (RLS FORCE entry_history berlaku), milik owner seperti fungsi baca
--   api lain; EXECUTE hanya dompetku_web (own_api_functions). assert_member di awal, lalu
--   validasi argumen. Ruang Pribadi = 0 baris (pola activity_feed); opening_balance dikeluarkan.
-- - Urut (changed_at, entry_id, version) turun. Kursor = triple baris terakhir halaman
--   sebelumnya; ketiganya NULL atau ketiganya terisi (DK400 cursor). changed_at <= kursor
--   menjadi syarat indeks (space_id, changed_at desc); perbandingan baris (pemecah seri) berjalan
--   sebagai Filter atas hasil indeks, bukan syarat indeks.
-- - before_amount/before_category_id dari versi version - 1 entri yang sama (PK entry_history),
--   bukan lag atas riwayat ruang, agar kursor dan kinerja tidak bergantung halaman. NULL bila
--   versi sebelumnya tidak ada (create).
-- - Batas privasi (K1, R16, R24): tanpa account_id, link_id, lines, atau snapshot. description
--   NULL untuk space_transfer (kaki Bersama memang tanpa deskripsi; pertahanan berlapis), teks
--   bebas kaki antar ruang hanya shared_note. moved = void entri ber-moved_at (R26).
-- - direction: kolom entri untuk space_transfer; untuk adjustment (kolom entri NULL) diturunkan
--   dari tanda line main (in = naik, out = turun, NULL bila line main tidak ada), sama dengan
--   server/ledger/read.ts, agar teks S8-A2 "mencocokkan saldo, naik/turun" tidak butuh nominal
--   bertanda. income/expense/transfer NULL.
-- - amount = |line main| sesudah peristiwa (tanpa biaya).
create function api.shared_activity(
  p_space_id       uuid,
  p_limit          int default 20,
  p_before_at      timestamptz default null,
  p_before_entry   uuid default null,
  p_before_version int default null
) returns table (entry_id uuid, version int, op app.history_op, kind app.entry_kind,
                 direction app.entry_direction, actor_id uuid, at timestamptz, occurred_on date,
                 amount bigint, before_amount bigint, category_id uuid, before_category_id uuid,
                 description text, shared_note text, moved boolean)
language plpgsql stable set search_path = '' as $$
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
drop function api.shared_activity(uuid, int, timestamptz, uuid, int);
