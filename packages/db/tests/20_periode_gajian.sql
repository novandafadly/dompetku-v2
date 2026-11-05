-- Periode gajian (S9, 0116; plan S9 Task 3, K1, K2, BSD §8.2a, Review Focus #2):
-- households.payday_rule, tabel global app.holidays (libur nasional + cuti bersama, tanpa space_id),
-- app.effective_payday (hari gajian efektif: mundur selama Sabtu/Minggu/libur), app.pay_period dan
-- app.period_of_label (satu sumber periode), api.pay_period (INVOKER, assert_member, days_left).
-- Aturan: periode = [gajian efektif bulan m, gajian efektif bulan m+1 - 1], bernama bulan m+1;
-- aturan kosong = bulan kalender. holidays_known = ada baris app.holidays untuk setiap tahun yang
-- disentuh periode (aturan kosong: selalu true, libur tidak dipakai). Tanggal diambil dari
-- app.today() (WIB). Data libur 2026 (SKB 3 Menteri 2026) dan 2027 (daftar pemilik, SKB 15 Sep 2026)
-- diisi migrasi; asersi 2027 asli ada sebelum baris 2027 dihapus di dalam transaksi untuk menguji
-- "tahun tanpa data" tanpa bergantung pada isi tabel produksi.
-- ID: Z1, Z3, Z9, Z10, T13, B13
begin;
select plan(102);
select tests.fixture();

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

-- ===== Bentuk skema =====
select col_type_is('app', 'households', 'payday_rule', 'smallint', 'households.payday_rule smallint');
select col_is_null('app', 'households', 'payday_rule', 'payday_rule boleh kosong (kosong = bulan kalender)');
select throws_ok($$select tests.owner_exec(null, 'update app.households set payday_rule = 0')$$, '23514', null,
  'payday_rule 0 ditolak CHECK');
select throws_ok($$select tests.owner_exec(null, 'update app.households set payday_rule = 32')$$, '23514', null,
  'payday_rule 32 ditolak CHECK');
select is(tests.owner_val(null, $$select (relrowsecurity and relforcerowsecurity)::text from pg_class
  where oid = 'app.holidays'::regclass$$), 'true', 'app.holidays RLS aktif dan dipaksa');
select is(tests.owner_val(null, $$select string_agg(attname || ':' || format_type(atttypid, atttypmod)
    || ':' || attnotnull, ',' order by attnum) from pg_attribute
  where attrelid = 'app.holidays'::regclass and attnum > 0 and not attisdropped$$),
  'on_date:date:true,name:text:true,kind:text:true', 'kolom app.holidays (tanpa space_id: tabel global)');
select is(tests.owner_val(null, $$select count(*) from pg_attribute
  where attrelid = 'app.holidays'::regclass and attname = 'space_id'$$), '0',
  'app.holidays tanpa space_id (pengecualian global bernama, bukan data pengguna)');
select is(tests.owner_val(null, $$select string_agg(p.oid::regprocedure::text || ' ' || pg_get_function_result(p.oid)
    || ' ' || p.prosecdef::text || ' ' || p.provolatile::text, E'\n' order by p.proname, n.nspname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname = 'app' and p.proname in ('effective_payday', 'pay_period', 'period_of_label'))
     or (n.nspname = 'api' and p.proname = 'pay_period')$$),
  E'app.effective_payday(smallint,date) date false s\n'
  || E'api.pay_period(uuid,date) TABLE(starts_on date, ends_on date, label_month date, holidays_known boolean, days_left integer) false s\n'
  || E'app.pay_period(uuid,date) TABLE(starts_on date, ends_on date, label_month date, holidays_known boolean) false s\n'
  || E'app.period_of_label(uuid,date) TABLE(starts_on date, ends_on date, holidays_known boolean) false s',
  'tanda tangan, INVOKER, STABLE (bukan IMMUTABLE: membaca app.holidays)');

-- ===== Isi libur 2026 (SKB 3 Menteri 2026: 17 libur nasional + 8 cuti bersama) =====
select is(tests.owner_val(null, $$select count(*) filter (where kind = 'libur') || '/'
    || count(*) filter (where kind = 'cuti_bersama') from app.holidays
  where on_date between '2026-01-01' and '2026-12-31'$$), '17/8', '2026: 17 libur nasional, 8 cuti bersama');
select is(tests.owner_val(null, $$select count(*) filter (where kind = 'libur') || '/'
    || count(*) filter (where kind = 'cuti_bersama') from app.holidays
  where on_date between '2027-01-01' and '2027-12-31'$$), '18/8', '2027: 18 libur nasional, 8 cuti bersama');
select is(tests.owner_val(null, $$select string_agg(on_date || ' ' || kind, ', ' order by on_date)
  from app.holidays where on_date in ('2027-01-01', '2027-03-10', '2027-03-26', '2027-12-24', '2027-12-26')$$),
  '2027-01-01 libur, 2027-03-10 libur, 2027-03-26 libur, 2027-12-24 cuti_bersama, 2027-12-26 libur',
  'tanggal kunci 2027: Tahun Baru, Idulfitri, Wafat Yesus Kristus, cuti bersama Natal, Isra Mikraj');
select is(tests.owner_val(null, $$select string_agg(on_date || ' ' || kind, ', ' order by on_date)
  from app.holidays where on_date in ('2026-01-01', '2026-08-17', '2026-12-24', '2026-12-25')$$),
  '2026-01-01 libur, 2026-08-17 libur, 2026-12-24 cuti_bersama, 2026-12-25 libur',
  'tanggal kunci: Tahun Baru, HUT RI, cuti bersama Natal (24 Des), Natal (25 Des)');
select is(tests.owner_val(null, $$select count(*) from app.holidays
  where extract(isodow from on_date) in (6, 7) and kind = 'cuti_bersama'$$), '0',
  'cuti bersama tidak ada di akhir pekan');

-- ===== Hak dan RLS app.holidays =====
select ok(tests.web_val(null, 'select count(*) from app.holidays')::int >= 25, 'web membaca app.holidays (tanpa konteks pun: data global)');
select ok(tests.web_val(tests.n(), 'select count(*) from app.holidays')::int >= 25, 'web (N) membaca app.holidays');
select ok(tests.worker_val(null, 'select count(*) from app.holidays')::int >= 25, 'worker membaca app.holidays');
select throws_ok($$select tests.web_exec(null, $q$insert into app.holidays values ('2030-01-01', 'X', 'libur')$q$)$$, '42501', null,
  'web tidak bisa INSERT');
select throws_ok($$select tests.web_exec(null, $q$update app.holidays set name = 'X'$q$)$$, '42501', null,
  'web tidak bisa UPDATE');
select throws_ok($$select tests.web_exec(null, $q$delete from app.holidays$q$)$$, '42501', null,
  'web tidak bisa DELETE');
select throws_ok($$select tests.api_exec(null, $q$insert into app.holidays values ('2030-01-01', 'X', 'libur')$q$)$$, '42501', null,
  'api tidak bisa INSERT');
select throws_ok($$select tests.api_exec(null, $q$delete from app.holidays$q$)$$, '42501', null,
  'api tidak bisa DELETE');
select throws_ok($$select tests.worker_exec(null, $q$insert into app.holidays values ('2030-01-01', 'X', 'libur')$q$)$$, '42501', null,
  'worker tidak bisa INSERT');
select throws_ok($$select tests.worker_exec(null, $q$update app.holidays set name = 'X'$q$)$$, '42501', null,
  'worker tidak bisa UPDATE');
select throws_ok($$select tests.owner_exec(null, $q$insert into app.holidays values ('2030-01-01', 'X', 'bukan')$q$)$$, '23514', null,
  'kind di luar libur/cuti_bersama ditolak CHECK');
select throws_ok($$select tests.owner_exec(null, $q$insert into app.holidays values ('2030-01-01', '  ', 'libur')$q$)$$, '23514', null,
  'nama kosong ditolak CHECK');
select throws_ok($$select tests.owner_exec(null, $q$insert into app.holidays values ('2026-12-25', 'Ganda', 'libur')$q$)$$, '23505', null,
  'tanggal ganda ditolak (primary key on_date)');

-- ===== Helper =====
create function pg_temp.setrule(p_rule int) returns void language sql as $$
  select tests.owner_exec(null, format('update app.households set payday_rule = %s', coalesce(p_rule::text, 'null')))
$$;
-- api.pay_period sebagai teks: mulai..akhir|label|libur diketahui|sisa hari.
create function pg_temp.pp(p_uid uuid, p_space uuid, p_on date) returns text language sql as $$
  select tests.web_val(p_uid, format(
    $q$select starts_on || '..' || ends_on || '|' || label_month || '|' || holidays_known || '|' || days_left
       from api.pay_period(%L, %L)$q$, p_space, p_on))
$$;
create function pg_temp.ep(p_day int, p_month date) returns text language sql as $$
  select tests.owner_val(null, format($q$select app.effective_payday(%s::smallint, %L::date)$q$, p_day, p_month))
$$;
create function pg_temp.pl(p_label date) returns text language sql as $$
  select tests.owner_val(null, format(
    $q$select starts_on || '..' || ends_on || '|' || holidays_known from app.period_of_label(%L, %L)$q$,
    tests.space_id(tests.n(), 'shared'), p_label))
$$;
-- Pelanggaran invarian periode di [p_from, p_to]: hari tercakup, label = period_of_label, periode
-- berurutan tanpa celah atau tumpang tindih. Hasil '0' bila semuanya benar.
create function pg_temp.inv(p_from date, p_to date) returns text language sql as $$
  select tests.owner_val(null, format($q$
    select count(*) from generate_series(%L::date, %L::date, '1 day') g (d),
    lateral app.pay_period(%L, g.d::date) p
    where not (g.d::date between p.starts_on and p.ends_on)
       or not exists (select 1 from app.period_of_label(%L, p.label_month) l
                      where l.starts_on = p.starts_on and l.ends_on = p.ends_on
                        and l.holidays_known = p.holidays_known)
       or (select q.starts_on from app.pay_period(%L, p.ends_on + 1) q) <> p.ends_on + 1
       or (select q.ends_on from app.pay_period(%L, p.starts_on - 1) q) <> p.starts_on - 1$q$,
    p_from, p_to, tests.space_id(tests.n(), 'shared'), tests.space_id(tests.n(), 'shared'),
    tests.space_id(tests.n(), 'shared'), tests.space_id(tests.n(), 'shared')))
$$;

-- Dengan data 2027 asli: periode yang melewati pergantian tahun diketahui, dan rantai libur Lebaran.
select pg_temp.setrule(25);
select is(pg_temp.pp(tests.n(), :'sh', '2026-12-23'), '2026-12-23..2027-01-24|2027-01-01|true|33',
  'dengan data 2027: periode Jan 2027 holidays_known = true');
select is(pg_temp.ep(5, '2027-01-10'), '2027-01-04', '5 Jan 2027 (Isra Mikraj, Selasa) -> Senin 4 Jan');
select is(pg_temp.ep(10, '2027-03-01'), '2027-03-05',
  '10 Mar 2027 (Idulfitri) mundur melewati cuti bersama 9 Mar, Nyepi 8 Mar, Minggu, Sabtu -> Jumat 5 Mar');
select is(pg_temp.ep(12, '2027-03-01'), '2027-03-05',
  '12 Mar 2027 (cuti bersama) mundur melewati Idulfitri 11 dan 10 Mar, cuti 9 Mar, Nyepi 8 Mar -> Jumat 5 Mar');
select is(pg_temp.ep(25, '2027-03-01'), '2027-03-24', '25 Mar 2027 = cuti bersama Wafat Yesus Kristus -> Rabu 24 Mar');
select is(pg_temp.ep(25, '2027-12-01'), '2027-12-23', '25 Des 2027 Sabtu, 24 Des cuti bersama -> Kamis 23 Des');

-- Data produksi tidak boleh memengaruhi tes "tahun tanpa data": hapus baris 2027 di transaksi ini.
select tests.owner_exec(null, $$delete from app.holidays where on_date >= '2027-01-01'$$);

-- ===== effective_payday =====
select is(pg_temp.ep(25, '2026-10-10'), '2026-10-23', '25 Okt 2026 = Minggu -> Jumat 23 Okt');
select is(pg_temp.ep(25, '2026-09-30'), '2026-09-25', '25 Sep 2026 = Jumat -> tetap');
select is(pg_temp.ep(25, '2026-12-01'), '2026-12-23', '25 Des libur Natal dan 24 Des cuti bersama -> Rabu 23 Des');
select is(pg_temp.ep(25, '2026-11-25'), '2026-11-25', 'tanggal di tengah bulan dipakai apa adanya (p_month = hari mana pun di bulan itu)');
select is(pg_temp.ep(22, '2026-03-10'), '2026-03-17',
  '22 Mar 2026 (Minggu, libur) mundur melewati Sabtu libur, Jumat cuti bersama, Kamis Nyepi, Rabu cuti bersama -> Selasa 17 Mar');
select is(pg_temp.ep(31, '2028-02-10'), '2028-02-29', 'Z3: tanggal 31 di Feb kabisat 2028 = 29 Feb (Selasa)');
select is(pg_temp.ep(31, '2027-02-10'), '2027-02-26', 'Z3: tanggal 31 di Feb 2027 = 28 Feb (Minggu) -> Jumat 26 Feb');
select is(pg_temp.ep(31, '2026-04-10'), '2026-04-30', 'tanggal 31 di bulan 30 hari = 30 Apr (Kamis)');
select is(pg_temp.ep(31, '2026-10-05'), '2026-10-30', '31 Okt 2026 = Sabtu -> Jumat 30 Okt');
select is(pg_temp.ep(1, '2026-11-15'), '2026-10-30', 'tanggal 1 Nov 2026 = Minggu -> mundur ke bulan sebelumnya (Jumat 30 Okt)');
select is(pg_temp.ep(25, '2028-03-10'), '2028-03-24', '2028 tanpa data libur: hanya akhir pekan (25 Mar 2028 Sabtu -> Jumat 24 Mar)');
select throws_ok($$select tests.owner_val(null, $q$select app.effective_payday(0::smallint, '2026-10-10')$q$)$$,
  'DK400', 'invalid_argument', 'hari gajian 0 = DK400');
select throws_ok($$select tests.owner_val(null, $q$select app.effective_payday(32::smallint, '2026-10-10')$q$)$$,
  'DK400', 'invalid_argument', 'hari gajian 32 = DK400');
select throws_ok($$select tests.owner_val(null, $q$select app.effective_payday(null, '2026-10-10')$q$)$$,
  'DK400', 'invalid_argument', 'hari gajian NULL = DK400');

-- ===== pay_period, aturan 25 (K2) =====
select pg_temp.setrule(25);
select is(pg_temp.pp(tests.n(), :'sh', '2026-10-17'), '2026-09-25..2026-10-22|2026-10-01|true|6',
  '17 Okt 2026 -> periode Okt (25 Sep..22 Okt), sisa 6 hari');
select is(pg_temp.pp(tests.n(), :'sh', '2026-10-22'), '2026-09-25..2026-10-22|2026-10-01|true|1',
  'hari terakhir periode: sisa hari = 1 (Z10, tanpa bagi nol)');
select is(pg_temp.pp(tests.n(), :'sh', '2026-10-23'), '2026-10-23..2026-11-24|2026-11-01|true|33',
  '23 Okt 2026 (gajian efektif) -> periode Nov (23 Okt..24 Nov), sisa 33 hari');
select is(pg_temp.pp(tests.n(), :'sh', '2026-10-25'), '2026-10-23..2026-11-24|2026-11-01|true|31',
  '25 Okt (Minggu, sesudah gajian efektif) tetap periode Nov');
select is(pg_temp.pp(tests.n(), :'sh', '2026-11-24'), '2026-10-23..2026-11-24|2026-11-01|true|1',
  '24 Nov = hari terakhir periode Nov');
select is(pg_temp.pp(tests.n(), :'sh', '2026-11-25'), '2026-11-25..2026-12-22|2026-12-01|true|28',
  '25 Nov 2026 (Rabu) -> periode Des berakhir 22 Des (gajian Des 23 Des)');
select is(pg_temp.pp(tests.n(), :'sh', '2026-12-22'), '2026-11-25..2026-12-22|2026-12-01|true|1',
  '22 Des = hari terakhir periode Des');
-- Pergantian tahun: periode 23 Des 2026..24 Jan 2027 menyentuh 2027 yang tidak ada datanya.
select is(pg_temp.pp(tests.n(), :'sh', '2026-12-23'), '2026-12-23..2027-01-24|2027-01-01|false|33',
  '23 Des 2026 (24 cuti bersama, 25 libur) -> periode Jan 2027, holidays_known = false (2027 kosong)');
select tests.owner_exec(null, $$delete from app.holidays where on_date = '2026-12-24'$$);
select is(pg_temp.pp(tests.n(), :'sh', '2026-12-23'), '2026-11-25..2026-12-23|2026-12-01|true|1',
  '24 Des bukan cuti bersama: gajian Des = 24 Des, jadi 23 Des masih periode Des');
select is(pg_temp.pp(tests.n(), :'sh', '2026-12-24'), '2026-12-24..2027-01-24|2027-01-01|false|32',
  '24 Des (hanya 25 Des libur) -> periode Jan mulai 24 Des');
select tests.owner_exec(null, $$insert into app.holidays values ('2026-12-24', 'Cuti Bersama Natal', 'cuti_bersama')$$);
select is(pg_temp.pp(tests.n(), :'sh', '2026-12-24'), '2026-12-23..2027-01-24|2027-01-01|false|32',
  '24 Des ditandai cuti bersama lagi: periode Jan mulai 23 Des');
select is(pg_temp.pp(tests.n(), :'sh', '2027-01-24'), '2026-12-23..2027-01-24|2027-01-01|false|1',
  '24 Jan 2027 = hari terakhir periode Jan');
select is(pg_temp.pp(tests.n(), :'sh', '2028-03-10'), '2028-02-25..2028-03-23|2028-03-01|false|14',
  '2028 tanpa data libur: hanya akhir pekan, holidays_known = false');
select is(pg_temp.pp(tests.n(), :'sh', '2028-03-24'), '2028-03-24..2028-04-24|2028-04-01|false|32',
  '25 Mar 2028 Sabtu -> gajian 24 Mar; periode berikut mulai 24 Mar');
select is(pg_temp.pp(tests.n(), :'np', '2026-10-23'), '2026-10-23..2026-11-24|2026-11-01|true|33',
  'ruang Pribadi memakai aturan rumah tangga yang sama dengan Bersama');
select is(pg_temp.pp(tests.f(), :'sh', '2026-10-23'), pg_temp.pp(tests.n(), :'sh', '2026-10-23'),
  'F dan N melihat periode Bersama yang sama');

-- Z9: pergantian tahun WIB lewat app.today() (jam tiruan), p_on kosong.
select tests.clock_at('2026-12-31 23:59+07');
select is(pg_temp.pp(tests.n(), :'sh', null), '2026-12-23..2027-01-24|2027-01-01|false|25',
  'Z9: 31 Des 23:59 WIB -> periode Jan, sisa 25 hari');
select tests.clock_at('2027-01-01 00:01+07');
select is(pg_temp.pp(tests.n(), :'sh', null), '2026-12-23..2027-01-24|2027-01-01|false|24',
  'Z9: 1 Jan 00:01 WIB -> periode sama, sisa 24 hari');
select tests.clock_at('2026-12-31 17:30+00');
select is(pg_temp.pp(tests.n(), :'sh', null), '2026-12-23..2027-01-24|2027-01-01|false|24',
  'Z9: 31 Des 17:30 UTC = 1 Jan 00:30 WIB -> tanggal WIB 1 Jan, sisa 24 hari');
select tests.clock_at('2026-10-22 23:30+07');
select is(pg_temp.pp(tests.n(), :'sh', null), '2026-09-25..2026-10-22|2026-10-01|true|1',
  'T13: 22 Okt 23:30 WIB = hari terakhir periode Okt');
select tests.clock_at('2026-10-22 17:00+00');
select is(pg_temp.pp(tests.n(), :'sh', null), '2026-10-23..2026-11-24|2026-11-01|true|33',
  'T13: 22 Okt 17:00 UTC = 23 Okt 00:00 WIB -> periode Nov');

-- T13 / Review Focus #2: 31 Okt 23:30 WIB lewat jam tiruan.
select tests.clock_at('2026-10-31 23:30+07');
select is(pg_temp.pp(tests.n(), :'sh', null), '2026-10-23..2026-11-24|2026-11-01|true|25',
  'T13: 31 Okt 23:30 WIB, aturan 25 -> periode Nov, sisa 25 hari');
select tests.clock_at('2026-10-31 17:00+00');
select is(pg_temp.pp(tests.n(), :'sh', null), '2026-10-23..2026-11-24|2026-11-01|true|24',
  'T13: 31 Okt 17:00 UTC = 1 Nov 00:00 WIB, aturan 25 -> periode Nov, sisa 24 hari');

-- ===== Aturan 31 dan 1 =====
select pg_temp.setrule(31);
select is(pg_temp.pp(tests.n(), :'sh', '2028-03-01'), '2028-02-29..2028-03-30|2028-03-01|false|30',
  'Z3: aturan 31, Feb kabisat 2028: periode Mar mulai 29 Feb, berakhir 30 Mar (gajian Mar = 31 Mar Jumat)');
select is(pg_temp.pp(tests.n(), :'sh', '2028-02-28'), '2028-01-31..2028-02-28|2028-02-01|false|1',
  'aturan 31: periode Feb berakhir sehari sebelum 29 Feb');

-- ===== Aturan kosong = bulan kalender (K1, K2) =====
select pg_temp.setrule(null);
select is(pg_temp.pp(tests.n(), :'sh', '2026-10-31'), '2026-10-01..2026-10-31|2026-10-01|true|1',
  'Z10: aturan kosong, 31 Okt: bulan kalender, sisa 1 hari');
select is(pg_temp.pp(tests.n(), :'sh', '2026-11-01'), '2026-11-01..2026-11-30|2026-11-01|true|30',
  'aturan kosong, 1 Nov: Nov penuh, sisa 30 hari');
select is(pg_temp.pp(tests.n(), :'sh', '2028-02-10'), '2028-02-01..2028-02-29|2028-02-01|true|20',
  'Z3: aturan kosong, Feb kabisat 2028 = 29 hari');
select is(pg_temp.pp(tests.n(), :'sh', '2027-02-10'), '2027-02-01..2027-02-28|2027-02-01|true|19',
  'aturan kosong, Feb 2027 = 28 hari; tahun tanpa data libur tetap holidays_known = true (libur tidak dipakai)');
select tests.clock_at('2026-10-31 23:30+07');
select is(pg_temp.pp(tests.n(), :'sh', null), '2026-10-01..2026-10-31|2026-10-01|true|1',
  'T13: aturan kosong, 31 Okt 23:30 WIB -> Okt, sisa 1 hari (Z10)');
select tests.clock_at('2026-10-31 17:00+00');
select is(pg_temp.pp(tests.n(), :'sh', null), '2026-11-01..2026-11-30|2026-11-01|true|30',
  'T13: aturan kosong, 31 Okt 17:00 UTC = 1 Nov WIB -> Nov, sisa 30 hari');
select tests.clock_at('2026-12-31 23:59+07');
select is(pg_temp.pp(tests.n(), :'sh', null), '2026-12-01..2026-12-31|2026-12-01|true|1',
  'Z9: aturan kosong, 31 Des 23:59 WIB -> Des, sisa 1 hari');
select tests.clock_at('2027-01-01 00:01+07');
select is(pg_temp.pp(tests.n(), :'sh', null), '2027-01-01..2027-01-31|2027-01-01|true|31',
  'Z9: aturan kosong, 1 Jan 00:01 WIB -> Jan, sisa 31 hari');
select is(pg_temp.pl('2026-11-17'), '2026-11-01..2026-11-30|true',
  'period_of_label, aturan kosong: label = bulan kalender (hari mana pun di bulan itu)');

-- ===== period_of_label, aturan 25 =====
select pg_temp.setrule(25);
select is(pg_temp.pl('2026-11-01'), '2026-10-23..2026-11-24|true', 'period_of_label Nov 2026 = 23 Okt..24 Nov');
select is(pg_temp.pl('2026-11-17'), '2026-10-23..2026-11-24|true', 'label dinormalkan ke awal bulan');
select is(pg_temp.pl('2026-12-01'), '2026-11-25..2026-12-22|true', 'period_of_label Des 2026 = 25 Nov..22 Des');
select is(pg_temp.pl('2027-01-01'), '2026-12-23..2027-01-24|false', 'period_of_label Jan 2027 menyentuh 2027 tanpa data: false');

-- ===== Invarian: tercakup, label konsisten, berurutan tanpa celah (Review Focus #2) =====
select is(pg_temp.inv('2026-09-01', '2027-03-31'), '0', 'aturan 25: setiap hari tercakup, label sama, tanpa celah/tumpang tindih (Sep 2026..Mar 2027)');
select pg_temp.setrule(1);
select is(pg_temp.inv('2026-09-01', '2027-03-31'), '0', 'aturan 1 (gajian efektif bisa mundur ke bulan sebelumnya): invarian sama');
select pg_temp.setrule(31);
select is(pg_temp.inv('2027-11-01', '2028-04-30'), '0', 'aturan 31 (Feb 2028 kabisat, bulan pendek): invarian sama');
select pg_temp.setrule(15);
select is(pg_temp.inv('2026-01-01', '2026-12-31'), '0', 'aturan 15, seluruh 2026 dengan data libur lengkap: invarian sama');
select pg_temp.setrule(25);

-- ===== api.pay_period: akses dan galat =====
select is(tests.web_val(tests.n(), format($$select count(*) from api.pay_period(%L, '2026-10-23')$$, :'np')), '1',
  'N membaca Pribadi sendiri: 1 baris');
select is(tests.web_val(tests.f(), format($$select count(*) from api.pay_period(%L, '2026-10-23')$$, :'fp')), '1',
  'F membaca Pribadi sendiri: 1 baris');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), format($q$select api.pay_period(%L, '2026-10-23')$q$, :'np')),
  'DK404', 'space_not_found', 'F -> ruang Pribadi N = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format($q$select api.pay_period(%L, '2026-10-23')$q$, :'fp')),
  'DK404', 'space_not_found', 'N -> ruang Pribadi F = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.x(), format($q$select api.pay_period(%L, '2026-10-23')$q$, :'sh')),
  'DK404', 'space_not_found', 'Luar -> Bersama = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format($q$select api.pay_period(%L)$q$, gen_random_uuid())),
  'DK404', 'space_not_found', 'ruang tidak dikenal = DK404');
select throws_ok(format($$select tests.web_exec(null, %L)$$, format($q$select api.pay_period(%L)$q$, :'sh')),
  'DK401', 'unauthenticated', 'tanpa konteks = DK401');
-- Urutan: assert_member sebelum validasi lain. 'infinity' memicu DK400 bagi anggota, DK404 bagi Luar.
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format($q$select api.pay_period(%L, 'infinity')$q$, :'sh')),
  'DK400', null, 'anggota dengan tanggal tak sah = DK400');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.x(), format($q$select api.pay_period(%L, 'infinity')$q$, :'sh')),
  'DK404', 'space_not_found', 'assert_member lebih dulu: Luar dengan tanggal tak sah tetap DK404');
-- Fungsi app.* yang bisa dipanggil web langsung: ruang tak terlihat = DK404 (bukan bulan kalender diam-diam).
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), format($q$select count(*) from app.pay_period(%L, '2026-10-23')$q$, :'np')),
  'DK404', 'space_not_found', 'app.pay_period: F -> Pribadi N = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.x(), format($q$select count(*) from app.period_of_label(%L, '2026-11-01')$q$, :'sh')),
  'DK404', 'space_not_found', 'app.period_of_label: Luar -> Bersama = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format($q$select count(*) from app.pay_period(%L, '2026-10-23')$q$, gen_random_uuid())),
  'DK404', 'space_not_found', 'app.pay_period: ruang tidak ada = DK404 (sama dengan ruang orang lain)');
select throws_ok($$select tests.owner_val(null, $q$select count(*) from app.pay_period(null, null)$q$)$$,
  'DK400', 'invalid_argument', 'app.pay_period tanpa tanggal = DK400');
select is(tests.web_val(tests.n(), format($$select count(*) from api.pay_period(%L)$$, :'sh')), '1',
  'p_on boleh dihilangkan (default app.today())');

select * from finish();
rollback;
