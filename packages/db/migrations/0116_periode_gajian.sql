-- migrate:up
-- S9 (IPD §5, plan S9 Task 3, K1, K2, BSD §8.2a, disetujui pemilik 2026-10-31): periode gajian
-- sebagai satu sumber untuk anggaran, "aman dipakai", Kontribusi, dan Laporan. Expand-only:
-- kolom, tabel, dan fungsi baru.
--
-- - app.households.payday_rule (1..31, boleh kosong). Kosong = bulan kalender (BSD §8.2a). Migrasi
--   mengisi 25 untuk rumah tangga yang sudah ada (K2, P5: tanggal gajian Novanda dan Farida).
--   Instalasi baru (bootstrap_owner) membuat rumah tangga tanpa aturan sampai diisi pemilik.
-- - app.holidays: tabel GLOBAL (tanpa space_id; data publik SKB 3 Menteri, bukan data pengguna;
--   pengecualian bernama di tes katalog). RLS ENABLE + FORCE, baca untuk web/api/worker, tulis
--   hanya owner (migrasi atau dompetku-psql). Diisi libur nasional + cuti bersama 2026. Tahun
--   2027 sengaja belum diisi (SKB 2027 terbit 15 Sep 2026 tetapi belum diperiksa terhadap teks
--   resmi): sampai diisi, periode yang menyentuh 2027 memberi holidays_known = false.
-- - app.effective_payday(p_day, p_month): least(p_day, hari terakhir bulan), mundur selama Sabtu,
--   Minggu, atau tanggal di app.holidays. Bisa mundur ke bulan sebelumnya (mis. tanggal 1).
-- - app.period_of_label(p_space_id, p_label_month): periode bernama bulan label = [gajian efektif
--   bulan sebelum label, gajian efektif bulan label - 1]; aturan kosong = bulan kalender label.
-- - app.pay_period(p_space_id, p_on): periode yang memuat p_on = periode berlabel k+1 dengan k
--   bulan terbesar (m+1, m, m-1) yang gajian efektifnya <= p_on. Memakai period_of_label supaya
--   batas periode hanya dihitung di satu tempat.
-- - holidays_known: setiap tahun dari tahun batas awal sampai tahun batas akhir berikutnya punya
--   baris di app.holidays. Aturan kosong: selalu true (libur tidak dipakai).
-- - Semua STABLE (bukan IMMUTABLE: membaca tabel), SECURITY INVOKER, search_path kosong. Tanggal
--   hanya dari parameter; api.pay_period mengisi default dari app.today() (WIB, bukan jam Node).
-- - api.pay_period: assert_member di awal (Luar atau Pribadi pasangan = DK404), menambah days_left
--   (= ends_on - p_on + 1, selalu >= 1 sehingga aman sebagai pembagi).
alter table app.households
  add column payday_rule smallint check (payday_rule between 1 and 31);

update app.households set payday_rule = 25 where payday_rule is null;

create table app.holidays (
  on_date date primary key,
  name    text not null check (length(btrim(name)) between 1 and 80),
  kind    text not null check (kind in ('libur', 'cuti_bersama'))
);
alter table app.holidays enable row level security;
alter table app.holidays force row level security;
create policy read_all on app.holidays for select to dompetku_web, dompetku_api, dompetku_worker
  using (true);
grant select on app.holidays to dompetku_web, dompetku_api, dompetku_worker, dompetku_auditor;
-- dompetku_auditlog: default privileges 0008 sudah mencakup tabel baru di app (tes katalog).

-- SKB 3 Menteri 2026 (17 libur nasional + 8 cuti bersama, ditandatangani 19 Sep 2025).
insert into app.holidays (on_date, name, kind) values
  ('2026-01-01', 'Tahun Baru 2026 Masehi', 'libur'),
  ('2026-01-16', 'Isra Mikraj Nabi Muhammad SAW', 'libur'),
  ('2026-02-16', 'Cuti Bersama Tahun Baru Imlek 2577 Kongzili', 'cuti_bersama'),
  ('2026-02-17', 'Tahun Baru Imlek 2577 Kongzili', 'libur'),
  ('2026-03-18', 'Cuti Bersama Hari Suci Nyepi', 'cuti_bersama'),
  ('2026-03-19', 'Hari Suci Nyepi Tahun Baru Saka 1948', 'libur'),
  ('2026-03-20', 'Cuti Bersama Idulfitri 1447 H', 'cuti_bersama'),
  ('2026-03-21', 'Idulfitri 1447 H', 'libur'),
  ('2026-03-22', 'Idulfitri 1447 H', 'libur'),
  ('2026-03-23', 'Cuti Bersama Idulfitri 1447 H', 'cuti_bersama'),
  ('2026-03-24', 'Cuti Bersama Idulfitri 1447 H', 'cuti_bersama'),
  ('2026-04-03', 'Wafat Yesus Kristus', 'libur'),
  ('2026-04-05', 'Kebangkitan Yesus Kristus (Paskah)', 'libur'),
  ('2026-05-01', 'Hari Buruh Internasional', 'libur'),
  ('2026-05-14', 'Kenaikan Yesus Kristus', 'libur'),
  ('2026-05-15', 'Cuti Bersama Kenaikan Yesus Kristus', 'cuti_bersama'),
  ('2026-05-27', 'Iduladha 1447 H', 'libur'),
  ('2026-05-28', 'Cuti Bersama Iduladha 1447 H', 'cuti_bersama'),
  ('2026-05-31', 'Hari Raya Waisak 2570 BE', 'libur'),
  ('2026-06-01', 'Hari Lahir Pancasila', 'libur'),
  ('2026-06-16', 'Tahun Baru Islam 1448 H', 'libur'),
  ('2026-08-17', 'Proklamasi Kemerdekaan RI', 'libur'),
  ('2026-08-25', 'Maulid Nabi Muhammad SAW', 'libur'),
  ('2026-12-24', 'Cuti Bersama Kelahiran Yesus Kristus (Natal)', 'cuti_bersama'),
  ('2026-12-25', 'Kelahiran Yesus Kristus (Natal)', 'libur');

create function app.effective_payday(p_day smallint, p_month date) returns date
language plpgsql stable set search_path = '' as $$
declare
  v_first date;
  v_last  int;
  v_day   date;
begin
  if p_day is null or p_day not between 1 and 31 or p_month is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'payday_day';
  end if;
  v_first := p_month - (extract(day from p_month)::int - 1);
  v_last  := extract(day from (v_first + interval '1 month')::date - 1)::int;
  v_day   := v_first + (least(p_day::int, v_last) - 1);
  while extract(isodow from v_day) in (6, 7)
        or exists (select 1 from app.holidays h where h.on_date = v_day) loop
    v_day := v_day - 1;
  end loop;
  return v_day;
end $$;

create function app.period_of_label(p_space_id uuid, p_label_month date)
returns table (starts_on date, ends_on date, holidays_known boolean)
language plpgsql stable set search_path = '' as $$
declare
  v_rule  smallint;
  v_label date;
  v_start date;
  v_end   date;
begin
  if p_label_month is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'label_month';
  end if;
  select h.payday_rule into v_rule
  from app.spaces s join app.households h on h.id = s.household_id
  where s.id = p_space_id;
  v_label := p_label_month - (extract(day from p_label_month)::int - 1);
  if v_rule is null then
    return query select v_label, ((v_label + interval '1 month')::date - 1), true;
    return;
  end if;
  v_start := app.effective_payday(v_rule, (v_label - interval '1 month')::date);
  v_end   := app.effective_payday(v_rule, v_label) - 1;
  return query select v_start, v_end,
    not exists (
      select 1 from generate_series(extract(year from v_start)::int, extract(year from v_end + 1)::int) y
      where not exists (select 1 from app.holidays h
                        where h.on_date between make_date(y, 1, 1) and make_date(y, 12, 31)));
end $$;

create function app.pay_period(p_space_id uuid, p_on date)
returns table (starts_on date, ends_on date, label_month date, holidays_known boolean)
language plpgsql stable set search_path = '' as $$
declare
  v_rule  smallint;
  v_m     date;
  v_k     date;
  v_label date;
begin
  if p_on is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'on';
  end if;
  select h.payday_rule into v_rule
  from app.spaces s join app.households h on h.id = s.household_id
  where s.id = p_space_id;
  v_m := p_on - (extract(day from p_on)::int - 1);
  if v_rule is null then
    v_label := v_m;
  else
    -- Bulan gajian terbesar (m+1, m, m-1) yang hari gajian efektifnya <= p_on; periodenya diberi
    -- nama bulan sesudahnya. m+1 hanya mungkin bila gajian efektif mundur ke bulan sebelumnya.
    foreach v_k in array array[(v_m + interval '1 month')::date, v_m, (v_m - interval '1 month')::date] loop
      exit when app.effective_payday(v_rule, v_k) <= p_on;
    end loop;
    v_label := (v_k + interval '1 month')::date;
  end if;
  return query
  select l.starts_on, l.ends_on, v_label, l.holidays_known
  from app.period_of_label(p_space_id, v_label) l;
end $$;

create function api.pay_period(p_space_id uuid, p_on date default null)
returns table (starts_on date, ends_on date, label_month date, holidays_known boolean, days_left int)
language plpgsql stable set search_path = '' as $$
declare
  v_on date;
begin
  perform app.assert_member(p_space_id);
  v_on := coalesce(p_on, app.today());
  return query
  select p.starts_on, p.ends_on, p.label_month, p.holidays_known, (p.ends_on - v_on + 1)::int
  from app.pay_period(p_space_id, v_on) p;
end $$;

grant execute on function app.effective_payday(smallint, date), app.pay_period(uuid, date),
  app.period_of_label(uuid, date) to dompetku_web, dompetku_api;

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
drop function api.pay_period(uuid, date);
drop function app.pay_period(uuid, date);
drop function app.period_of_label(uuid, date);
drop function app.effective_payday(smallint, date);
drop table app.holidays;
alter table app.households drop column payday_rule;
