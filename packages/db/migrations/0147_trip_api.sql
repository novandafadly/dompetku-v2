-- migrate:up
-- S15 (IPD §6, plan S15 Task 3, K1, K5, K7, K8; bingkai S15-TR2 sampai TR13): API trip.
-- Expand-only: fungsi baru saja. Jalur tulis entri (create_entry, update_entry, create_split,
-- set_entries_trip), ekspor, dan feed = 0148 (Task 4); sampai itu entri belum bisa ditandai lewat api.
--
-- - Tulis (DEFINER milik dompetku_api, berjalan di bawah RLS app.trips; di Bersama semua anggota menulis, K1):
--   api.create_trip (idempoten client_id, hash dari argumen bersih), api.update_trip (ganti-penuh: nama,
--   tanggal, anggaran; trip terarsip = DK422 trip_archived), api.archive_trip, api.restore_trip (K8). Selain
--   create_trip, idempoten secara alami: ulang dengan isi sama = sukses tanpa perubahan (updated_at tidak
--   bergeser), arsipkan yang sudah diarsip, pulihkan yang sudah aktif.
-- - Nama aktif bentrok = 23505 dari trips_name_unique (create_trip, update_trip, restore_trip), diteruskan apa
--   adanya: server memetakan nama indeks ke name_taken (pola accounts_name_unique 0109). Transaksi
--   dibatalkan, jadi kunci idempotensi create_trip ikut batal dan percobaan ulang aman.
-- - Validasi (DK400 invalid_argument dengan detail kolom, sebelum menyentuh data): name (1..60 sesudah trim),
--   starts_on, ends_on (wajib, 2000-01-01..2100-12-31, >= mulai, <= mulai + 365 hari), budget_amount (null
--   atau 1..10^13; K7: hanya pembanding, bukan anggaran bulanan).
-- - Trip tidak terlihat (RLS pemanggil: Pribadi pasangan, Luar, tidak ada) = DK404 trip_not_found seragam,
--   tanpa orakel nama. Tanpa pengguna = DK401.
-- - Urutan kunci: baris trip (FOR NO KEY UPDATE) saja; jalur entri (0148) memakai trip (FOR SHARE) -> entri ->
--   dompet, jadi arsip/ubah trip tidak pernah menunggu entri. update_trip paralel archive_trip diserialkan
--   kunci baris: yang kedua membaca keadaan terbaru (trip_archived / sukses).
-- - Baca (INVOKER milik owner, STABLE, di bawah RLS pemanggil): api.list_trips(ruang) (aktif dulu urut mulai
--   turun, lalu arsip, maks 200), api.trip_overview(trip) (satu baris, ROWS 1), api.trip_breakdown(trip)
--   (dim category|day|member), api.trip_candidates(trip, limit) (pengeluaran tanpa trip dalam rentang).
-- - Total trip = Σ -amount baris main kelas 'expense' dari app.report_lines (satu sumber, R2) digabung
--   app.entries.trip_id: Kantor, talangan, biaya transfer, pemasukan, transfer, dan entri batal tidak pernah
--   masuk. Angka dihitung numeric, dibatasi 9e18 sebelum cast ke bigint (10^13 x baris tidak overflow).
-- - Fase dari app.today() (WIB): upcoming | ongoing | ended. elapsed_days = hari berjalan (0 bila belum mulai,
--   sampai ends_on bila sudah lewat); per_day = floor(total / elapsed_days), NULL bila elapsed_days = 0 atau
--   total = 0 (bingkai S15 Kendala 2: rata-rata atas hari berjalan, bukan panjang trip). budget_left =
--   anggaran - total (negatif = kelebihan); pct = floor(total x 100 / anggaran), tidak dibatasi 100. Keduanya
--   NULL tanpa anggaran. UI tidak menjumlah atau membagi uang.
-- - dim=member: label dari app.space_roster (NULL bila pencatat bukan anggota lagi); dim=category: kategori
--   induk, entri tanpa kategori = key 'none', label 'Tanpa kategori'; dim=day: key = tanggal ISO, hanya hari
--   berpengeluaran. Urutan: jumlah turun, lalu kunci (COLLATE "C").
-- - trip_candidates: pengeluaran biasa hidup (kind expense, bukan talangan, tidak batal) tanpa trip, bertanggal
--   dalam rentang, bukan dompet Kantor/patungan (K4, bingkai TR9); trip terarsip = nol baris. Baris tampilan:
--   entry_id, occurred_on, description, category_name, account_name, amount (positif). p_limit 1..500
--   (UI memakai 101 sebagai penanda "masih ada"). Urut tanggal turun, lalu id.
-- Kode galat baru dipakai di sini: DK404 trip_not_found, DK422 trip_archived. Pesan/detail tanpa nama dan nominal.

-- Trip terlihat (RLS pemanggil), dikunci. Tidak terlihat atau hilang sebelum kunci didapat = DK404.
create function private.lock_trip(p_trip_id uuid) returns app.trips
language plpgsql set search_path = '' as $$
declare v app.trips%rowtype;
begin
  select * into v from app.trips where id = p_trip_id for no key update;
  if not found then
    raise exception using errcode = 'DK404', message = 'trip_not_found';
  end if;
  return v;
end $$;

-- Nama 1..60 sesudah trim; tanggal wajib dan dalam rentang; anggaran null atau 1..10^13 (DK400 dengan detail).
create function private.check_trip(p_name text, p_starts_on date, p_ends_on date, p_budget bigint) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(p_name), '');
begin
  if v is null or length(v) > 60 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'name';
  end if;
  if p_starts_on is null or p_starts_on not between date '2000-01-01' and date '2100-12-31' then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'starts_on';
  end if;
  if p_ends_on is null or p_ends_on not between date '2000-01-01' and date '2100-12-31'
     or p_ends_on < p_starts_on or p_ends_on - p_starts_on > 365 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'ends_on';
  end if;
  if p_budget is not null then
    perform private.check_amount(p_budget, 'budget_amount');
  end if;
  return v;
end $$;

create function api.create_trip(
  p_client_id     uuid,
  p_space_id      uuid,
  p_name          text,
  p_starts_on     date,
  p_ends_on       date,
  p_budget_amount bigint default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_name text := nullif(btrim(p_name), '');
  v_id   uuid;
  v_r    jsonb;
begin
  v_r := private.idem_begin(v_uid, p_client_id, 'create_trip', private.req_hash(jsonb_build_object(
           'space', p_space_id, 'name', v_name, 'from', p_starts_on, 'to', p_ends_on, 'budget', p_budget_amount)));
  if v_r is not null then
    return v_r;
  end if;
  perform app.assert_member(p_space_id);
  v_name := private.check_trip(v_name, p_starts_on, p_ends_on, p_budget_amount);
  insert into app.trips (space_id, space_kind, name, starts_on, ends_on, budget_amount,
                         created_by, created_at, updated_by, updated_at)
  select p_space_id, s.kind, v_name, p_starts_on, p_ends_on, p_budget_amount, v_uid, app.now(), v_uid, app.now()
    from app.spaces s where s.id = p_space_id
  returning id into v_id;
  return private.idem_finish(v_uid, p_client_id, jsonb_build_object('trip_id', v_id, 'status', 'active'));
end $$;

create function api.update_trip(p_trip_id uuid, p_name text, p_starts_on date, p_ends_on date, p_budget_amount bigint)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_name text := private.check_trip(p_name, p_starts_on, p_ends_on, p_budget_amount);
  v_t    app.trips%rowtype;
begin
  v_t := private.lock_trip(p_trip_id);
  if v_t.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'trip_archived';
  end if;
  update app.trips set name = v_name, starts_on = p_starts_on, ends_on = p_ends_on, budget_amount = p_budget_amount,
                       updated_by = v_uid, updated_at = app.now()
   where id = v_t.id
     and (name, starts_on, ends_on, budget_amount) is distinct from (v_name, p_starts_on, p_ends_on, p_budget_amount);
  return jsonb_build_object('trip_id', v_t.id, 'status', 'active');
end $$;

create function api.archive_trip(p_trip_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_t   app.trips%rowtype;
begin
  v_t := private.lock_trip(p_trip_id);
  if v_t.archived_at is null then
    update app.trips set archived_at = app.now(), updated_by = v_uid, updated_at = app.now() where id = v_t.id;
  end if;
  return jsonb_build_object('trip_id', v_t.id, 'status', 'archived');
end $$;

create function api.restore_trip(p_trip_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_t   app.trips%rowtype;
begin
  v_t := private.lock_trip(p_trip_id);
  if v_t.archived_at is not null then
    -- 23505 (trips_name_unique) diteruskan: server memetakannya ke name_taken.
    update app.trips set archived_at = null, updated_by = v_uid, updated_at = app.now() where id = v_t.id;
  end if;
  return jsonb_build_object('trip_id', v_t.id, 'status', 'active');
end $$;

create function api.list_trips(p_space_id uuid)
returns table (trip_id uuid, name text, starts_on date, ends_on date, budget_amount bigint,
               archived_at timestamptz, day_count int, spent bigint, entry_count int, budget_left bigint,
               phase text)
language plpgsql stable set search_path = '' as $$
declare v_today date := app.today();
begin
  perform app.assert_member(p_space_id);
  return query
  select t.id, t.name, t.starts_on, t.ends_on, t.budget_amount, t.archived_at,
         (t.ends_on - t.starts_on + 1)::int, s.spent, s.n,
         case when t.budget_amount is not null then t.budget_amount - s.spent end,
         case when v_today < t.starts_on then 'upcoming'
              when v_today > t.ends_on then 'ended' else 'ongoing' end
    from app.trips t
    cross join lateral (
      select coalesce(least(sum(-r.amount), 9000000000000000000::numeric), 0)::bigint as spent,
             count(distinct r.entry_id)::int as n
        from app.entries e
        join app.report_lines r on r.space_id = e.space_id and r.entry_id = e.id
       where e.space_id = t.space_id and e.trip_id = t.id and r.report_class = 'expense'
    ) s
   where t.space_id = p_space_id
   order by t.archived_at is not null, t.starts_on desc, t.name collate "C", t.id
   limit 200;
end $$;

create function api.trip_overview(p_trip_id uuid)
returns table (trip_id uuid, space_id uuid, name text, starts_on date, ends_on date, budget_amount bigint,
               archived_at timestamptz, phase text, day_count int, elapsed_days int, spent bigint,
               entry_count int, per_day bigint, budget_left bigint, pct bigint,
               first_entry_on date, last_entry_on date)
language plpgsql stable rows 1 set search_path = '' as $$
declare
  v_today date := app.today();
  v_t     app.trips%rowtype;
begin
  if app.current_user_id() is null then
    raise exception using errcode = 'DK401', message = 'unauthenticated';
  end if;
  select * into v_t from app.trips t where t.id = p_trip_id;
  if not found then
    raise exception using errcode = 'DK404', message = 'trip_not_found';
  end if;
  return query
  select v_t.id, v_t.space_id, v_t.name, v_t.starts_on, v_t.ends_on, v_t.budget_amount, v_t.archived_at,
         case when v_today < v_t.starts_on then 'upcoming'
              when v_today > v_t.ends_on then 'ended' else 'ongoing' end,
         (v_t.ends_on - v_t.starts_on + 1)::int, d.elapsed, s.spent, s.n,
         case when d.elapsed > 0 and s.spent > 0 then s.spent / d.elapsed end,
         case when v_t.budget_amount is not null then v_t.budget_amount - s.spent end,
         case when v_t.budget_amount is not null
              then least(floor(s.spent::numeric * 100 / v_t.budget_amount), 9000000000000000000::numeric)::bigint end,
         s.first_on, s.last_on
    from (select case when v_today < v_t.starts_on then 0
                      else (least(v_today, v_t.ends_on) - v_t.starts_on + 1)::int end as elapsed) d
    cross join lateral (
      select coalesce(least(sum(-r.amount), 9000000000000000000::numeric), 0)::bigint as spent,
             count(distinct r.entry_id)::int as n, min(r.occurred_on) as first_on, max(r.occurred_on) as last_on
        from app.entries e
        join app.report_lines r on r.space_id = e.space_id and r.entry_id = e.id
       where e.space_id = v_t.space_id and e.trip_id = v_t.id and r.report_class = 'expense'
    ) s;
end $$;

create function api.trip_breakdown(p_trip_id uuid)
returns table (dim text, key text, label text, amount bigint, entry_count int)
language plpgsql stable set search_path = '' as $$
declare v_t app.trips%rowtype;
begin
  if app.current_user_id() is null then
    raise exception using errcode = 'DK401', message = 'unauthenticated';
  end if;
  select * into v_t from app.trips t where t.id = p_trip_id;
  if not found then
    raise exception using errcode = 'DK404', message = 'trip_not_found';
  end if;
  return query
  with b as (
    select r.entry_id, -r.amount as amt, r.occurred_on, r.root_category_id, r.created_by
      from app.entries e
      join app.report_lines r on r.space_id = e.space_id and r.entry_id = e.id
     where e.space_id = v_t.space_id and e.trip_id = v_t.id and r.report_class = 'expense'
  ), x as (
    select 'category'::text as dim, coalesce(g.root_category_id::text, 'none') as key,
           coalesce(c.name, 'Tanpa kategori') as label, g.amount, g.n
      from (select b.root_category_id, least(sum(b.amt), 9000000000000000000::numeric)::bigint as amount,
                   count(distinct b.entry_id)::int as n from b group by b.root_category_id) g
      left join app.categories c on c.space_id = v_t.space_id and c.id = g.root_category_id
    union all
    select 'day', g.occurred_on::text, g.occurred_on::text, g.amount, g.n
      from (select b.occurred_on, least(sum(b.amt), 9000000000000000000::numeric)::bigint as amount,
                   count(distinct b.entry_id)::int as n from b group by b.occurred_on) g
    union all
    select 'member', g.created_by::text, p.display_name, g.amount, g.n
      from (select b.created_by, least(sum(b.amt), 9000000000000000000::numeric)::bigint as amount,
                   count(distinct b.entry_id)::int as n from b group by b.created_by) g
      left join app.space_roster(v_t.space_id) p on p.user_id = g.created_by
  )
  select x.dim, x.key, x.label, x.amount, x.n from x
   order by x.dim collate "C", x.amount desc, x.key collate "C";
end $$;

create function api.trip_candidates(p_trip_id uuid, p_limit int default 100)
returns table (entry_id uuid, occurred_on date, description text, category_name text, account_name text,
               amount bigint)
language plpgsql stable set search_path = '' as $$
declare v_t app.trips%rowtype;
begin
  if app.current_user_id() is null then
    raise exception using errcode = 'DK401', message = 'unauthenticated';
  end if;
  select * into v_t from app.trips t where t.id = p_trip_id;
  if not found then
    raise exception using errcode = 'DK404', message = 'trip_not_found';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'limit';
  end if;
  if v_t.archived_at is not null then
    return;
  end if;
  return query
  select e.id, e.occurred_on, e.description, c.name, a.name, (-l.amount)::bigint
    from app.entries e
    join app.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id and l.role = 'main'
    join app.accounts a on a.space_id = l.space_id and a.id = l.account_id
    left join app.categories c on c.space_id = e.space_id and c.id = e.category_id
   where e.space_id = v_t.space_id and e.kind = 'expense' and not e.reimbursable and e.voided_at is null
     and e.trip_id is null and e.occurred_on between v_t.starts_on and v_t.ends_on
     and a.pocket not in ('kantor', 'patungan')
   order by e.occurred_on desc, e.id
   limit p_limit;
end $$;

-- ===== Hak =====
grant execute on function private.lock_trip(uuid), private.check_trip(text, date, date, bigint) to dompetku_api;

select private.own_api_functions();

-- migrate:down
-- Hanya lokal/CI (BSD §12: maju-saja di produksi). Ditolak bila app.settings env = 'prod'.
do $$
begin
  if (select s.value from app.settings s where s.key = 'env') = 'prod' then
    raise exception using errcode = 'DK500', message = 'migrate_down_blocked_prod';
  end if;
end $$;

drop function api.trip_candidates(uuid, int);
drop function api.trip_breakdown(uuid);
drop function api.trip_overview(uuid);
drop function api.list_trips(uuid);
drop function api.restore_trip(uuid);
drop function api.archive_trip(uuid);
drop function api.update_trip(uuid, text, date, date, bigint);
drop function api.create_trip(uuid, uuid, text, date, date, bigint);
drop function private.check_trip(text, date, date, bigint);
drop function private.lock_trip(uuid);

select private.own_api_functions();
