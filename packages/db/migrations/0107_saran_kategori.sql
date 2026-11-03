-- migrate:up
-- S6 (IPD §4): saran kategori Catat. BSD §9 menandai api.suggest_categories "belum ditulis";
-- angka dan urutan disalin dari selector demo suggestCategories (packages/demo-data/src/selectors.ts)
-- dan dicatat di BSD §16 "Catatan S6".
-- - Riwayat 30 hari (occurred_on > app.today() - 30 dan <= app.today()), entri hidup ruang ini,
--   jenis = p_type, berkategori. Bobot per entri: jam dibuat (WIB) berjarak melingkar <= 2 dari
--   p_hour = 3, selain itu 1; dikali 1,5 bila |nominal| di antara p_amount/2 dan p_amount*2.
-- - Kamus: kata kunci di p_description (tanpa beda huruf, batas kata) menambah 5 pada kategori
--   sistem padanannya di ruang ini.
-- - Urutan: skor turun, lalu lower(name) naik (urutan kode, sama dengan compareNames demo).
-- Hanya kategori ruang aktif, jenis ini, belum diarsipkan (QA M1: saran hanya dari ruang aktif).

-- ===== Kamus kata kunci =====
-- Di skema app (bukan private seperti draf rencana): api.suggest_categories INVOKER dipanggil
-- dompetku_web, yang tidak punya USAGE di skema private. Pola sama dengan app.report_class:
-- fungsi murni tanpa data user, EXECUTE untuk web/api/auditor. Setiap category_name harus ada di
-- kategori awal ruang dengan jenis yang sama (0106; dijaga tes 12_saran_kategori).
create function app.category_keywords()
returns table (keyword text, category_name text, space_kind app.space_kind)
language sql immutable set search_path = '' as $$
  select v.keyword, v.category_name, v.space_kind::app.space_kind
  from (values
    ('makan',    'Makan Siang & Minum', 'personal'),
    ('nasi',     'Makan Siang & Minum', 'personal'),
    ('warteg',   'Makan Siang & Minum', 'personal'),
    ('siang',    'Makan Siang & Minum', 'personal'),
    ('kopi',     'Kopi & Camilan',      'personal'),
    ('ngopi',    'Kopi & Camilan',      'personal'),
    ('camilan',  'Kopi & Camilan',      'personal'),
    ('jajan',    'Kopi & Camilan',      'personal'),
    ('bensin',   'Transportasi',        'personal'),
    ('parkir',   'Transportasi',        'personal'),
    ('ojek',     'Transportasi',        'personal'),
    ('gojek',    'Transportasi',        'personal'),
    ('grab',     'Transportasi',        'personal'),
    ('tol',      'Transportasi',        'personal'),
    ('krl',      'Transportasi',        'personal'),
    ('mrt',      'Transportasi',        'personal'),
    ('listrik',  'Cicilan & Tagihan',   'personal'),
    ('pln',      'Cicilan & Tagihan',   'personal'),
    ('air',      'Cicilan & Tagihan',   'personal'),
    ('pdam',     'Cicilan & Tagihan',   'personal'),
    ('internet', 'Cicilan & Tagihan',   'personal'),
    ('pulsa',    'Cicilan & Tagihan',   'personal'),
    ('gaji',     'Gaji',                'personal'),
    ('makan',    'Makan di Luar',       'shared'),
    ('nasi',     'Makan di Luar',       'shared'),
    ('warteg',   'Makan di Luar',       'shared'),
    ('bensin',   'Bensin & Parkir',     'shared'),
    ('parkir',   'Bensin & Parkir',     'shared'),
    ('tol',      'Bensin & Parkir',     'shared'),
    ('listrik',  'Listrik & Air',       'shared'),
    ('pln',      'Listrik & Air',       'shared'),
    ('air',      'Listrik & Air',       'shared'),
    ('pdam',     'Listrik & Air',       'shared'),
    ('internet', 'Internet',            'shared'),
    ('pulsa',    'Internet',            'shared'),
    ('sewa',     'Sewa Rumah',          'shared'),
    ('kontrakan', 'Sewa Rumah',         'shared'),
    ('iuran',    'Iuran Lingkungan',    'shared'),
    ('sayur',    'Sayur & Buah',        'shared'),
    ('buah',     'Sayur & Buah',        'shared')
  ) as v (keyword, category_name, space_kind)
$$;
grant execute on function app.category_keywords() to dompetku_web, dompetku_api, dompetku_auditor;

-- ===== Saran kategori (baca, INVOKER: RLS berlaku) =====
create function api.suggest_categories(
  p_space_id    uuid,
  p_type        app.category_type,
  p_hour        smallint default null,   -- jam WIB 0..23; null = jam app.now() WIB
  p_amount      bigint   default null,
  p_description text     default null,
  p_limit       int      default 6       -- 1..20
) returns table (category_id uuid, score numeric, source text)
language plpgsql stable set search_path = '' as $$
declare
  v_hour int;
  v_kind app.space_kind;
begin
  perform app.assert_member(p_space_id);
  if p_type is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'type';
  end if;
  if p_hour is not null and (p_hour < 0 or p_hour > 23) then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'hour';
  end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 10000000000000) then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'amount';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'limit';
  end if;
  v_hour := coalesce(p_hour, extract(hour from app.now() at time zone 'Asia/Jakarta')::int);
  select s.kind into v_kind from app.spaces s where s.id = p_space_id;

  return query
  with hist as (
    select e.category_id as cid,
           sum((case when least(abs(x.h - v_hour), 24 - abs(x.h - v_hour)) <= 2 then 3 else 1 end)
               * (case when nullif(p_amount, 0) is not null
                        and abs(l.amount) between p_amount / 2.0 and p_amount * 2.0
                       then 1.5 else 1 end))::numeric as pts
    from app.entries e
    join app.entry_lines l on l.entry_id = e.id and l.role = 'main'
    cross join lateral (
      select extract(hour from e.created_at at time zone 'Asia/Jakarta')::int as h) x
    where e.space_id = p_space_id
      and e.voided_at is null
      and e.kind::text = p_type::text
      and e.category_id is not null
      and e.occurred_on > app.today() - 30
      and e.occurred_on <= app.today()
    group by e.category_id
  ), dict as (
    select distinct c.id as cid
    from app.category_keywords() k
    join app.categories c on c.name = k.category_name
    where k.space_kind = v_kind
      and c.space_id = p_space_id and c.type = p_type and c.is_system
      and p_description ~* ('\m' || k.keyword || '\M')
  )
  select c.id,
         pg_catalog.trim_scale(coalesce(h.pts, 0) + case when d.cid is not null then 5 else 0 end),
         case when coalesce(h.pts, 0) > 0 then 'riwayat'
              when d.cid is not null then 'kamus'
              else 'nama' end
  from app.categories c
  left join hist h on h.cid = c.id
  left join dict d on d.cid = c.id
  where c.space_id = p_space_id and c.type = p_type and c.archived_at is null
  order by 2 desc, lower(c.name) collate "C", c.id
  limit p_limit;
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
drop function api.suggest_categories(uuid, app.category_type, smallint, bigint, text, int);
drop function app.category_keywords();
