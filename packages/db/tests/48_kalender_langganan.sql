-- Kalender arus kas, deteksi langganan, dan audit ekspor PDF (S16, 0149; plan S16 Task 2, K1 sampai K8).
-- api.cashflow_calendar: saldo operasional hari ini dikurangi tagihan terbuka per tanggal WIB (materialisasi +
-- proyeksi tagihan aktif yang belum punya occurrence, clamp akhir bulan), lewat jatuh tempo dihitung di hari ini,
-- dilewati/dibayar/arsip tidak dihitung, dompet aset tidak masuk saldo, hanya ruang ini (B13).
-- api.detect_subscriptions: pola berulang >= 3 bulan, nominal sama, terakhir <= 45 hari, bukan tagihan aktif,
-- bukan yang diabaikan; api.dismiss_subscription idempoten dan per ruang.
-- api.export_entries p_via: audit event export meta via = csv|pdf, nilai lain DK400.
-- Jam tiruan 2027-03-10 10:00 WIB; semua tanggal dan jumlah dihitung tangan dari kalender 2027.
-- ID: T14, T15, K9, B13
begin;
select plan(39);
select tests.fixture();
select tests.clock_at('2027-03-10 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.n(), 'shared') as sh \gset

create function pg_temp.cat(p_space uuid, p_name text) returns uuid
language sql as $$
  select tests.owner_val(null, format(
    $q$select id from app.categories where space_id = %L and name = %L and archived_at is null$q$,
    p_space, p_name))::uuid
$$;
create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
create function pg_temp.err(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare
  v_state  text;
  v_msg    text;
  v_detail text;
begin
  perform tests.web_val(p_uid, p_sql);
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
  return v_state || ':' || v_msg || ':' || coalesce(v_detail, '');
end $$;
create function pg_temp.bill(p_uid uuid, p_space uuid, p_name text, p_amount bigint, p_cat uuid, p_day int,
  p_starts date, p_acc uuid, p_ends date default null) returns uuid
language sql as $$
  select (pg_temp.call(p_uid, format(
    $q$select api.create_bill(gen_random_uuid(), %L, %L, %s, %L, %s::smallint, %L::date, %L::date, %L::uuid)$q$,
    p_space, p_name, p_amount, p_cat, p_day, p_starts, p_ends, p_acc)) ->> 'bill_id')::uuid
$$;
create function pg_temp.spend(p_uid uuid, p_space uuid, p_acc uuid, p_amount bigint, p_on date, p_desc text,
  p_reimb boolean default false) returns uuid
language sql as $$
  select (pg_temp.call(p_uid, format(
    $q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', %s, null, %L::date, %L, %L)$q$,
    p_space, p_acc, p_amount, p_on, p_desc, p_reimb)) ->> 'entry_id')::uuid
$$;
-- Kalender: hari:pembuka:tagihan:jumlah:terlambat:penutup:kurang, dipisah koma, hanya hari dengan tagihan atau
-- semua bila p_all.
create function pg_temp.cal(p_uid uuid, p_space uuid, p_days int, p_all boolean default false) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select coalesce(string_agg(
      x.day || ':' || x.opening || ':' || x.bills_amount || ':' || x.bills_count || ':' || x.overdue_count
      || ':' || x.closing || ':' || x.short, ',' order by x.day), '-')
    from api.cashflow_calendar(%L, %s) x where %L or x.bills_count > 0$q$, p_space, p_days, p_all))
$$;
create function pg_temp.subs(p_uid uuid, p_space uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select coalesce(string_agg(
      x.name || ':' || x.amount || ':' || x.months || ':' || x.last_on || ':' || x.day_of_month, ',' order by x.name), '-')
    from api.detect_subscriptions(%L) x$q$, p_space))
$$;

select tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 10000000, '2026-01-01') as kas,
       tests.account(tests.n(), :'np', 'BCA', 'operasional', 5000000, '2026-01-01') as bca \gset
select pg_temp.cat(:'sh', 'Sewa Rumah') as sewa, pg_temp.cat(:'np', 'Langganan') as lang \gset

-- ===== Kontrak =====
select is((select string_agg(p.proname || ' ' || p.prosecdef || ' ' || p.provolatile::text || ' ' || p.proowner::regrole,
                              ',' order by p.proname)
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname in ('cashflow_calendar', 'detect_subscriptions', 'dismiss_subscription')),
  'cashflow_calendar false s dompetku_owner,detect_subscriptions false s dompetku_owner,'
  || 'dismiss_subscription true v dompetku_api',
  'kalender dan deteksi INVOKER STABLE milik owner; abaikan DEFINER milik api');
select is((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname = 'cashflow_calendar'),
  'TABLE(day date, opening bigint, bills_amount bigint, bills_count integer, overdue_count integer, '
  || 'closing bigint, short boolean, bills jsonb)', 'kolom kalender: nominal bigint dan rincian tagihan dari SQL');

-- ===== Kalender: tanpa tagihan =====
select is(pg_temp.cal(tests.n(), :'sh', 3, true),
  '2027-03-10:10000000:0:0:0:10000000:false,2027-03-11:10000000:0:0:0:10000000:false,'
  || '2027-03-12:10000000:0:0:0:10000000:false', 'tanpa tagihan: saldo operasional datar, tidak kurang');
select is(pg_temp.err(tests.n(), format($q$select count(*) from api.cashflow_calendar(%L, 0)$q$, :'sh')),
  'DK400:invalid_argument:days', 'hari 0 ditolak');
select is(pg_temp.err(tests.n(), format($q$select count(*) from api.cashflow_calendar(%L, 91)$q$, :'sh')),
  'DK400:invalid_argument:days', 'hari 91 ditolak');

-- ===== Kalender: tagihan materialisasi + proyeksi =====
-- Sewa 300.000 tanggal 12 mulai 1 Mar: kemunculan 12 Mar (terbuka), 12 Apr (materialisasi atau proyeksi).
select pg_temp.bill(tests.n(), :'sh', 'Sewa', 300000, :'sewa', 12, '2027-03-01', :'kas') as sewa_b \gset
-- Listrik 150.000 tanggal 5 mulai 1 Mar: 5 Mar sudah lewat (terbuka) = dihitung di hari ini (10 Mar), terlambat 1.
select pg_temp.bill(tests.n(), :'sh', 'Listrik', 150000, :'sewa', 5, '2027-03-01', :'kas') as listrik_b \gset
select is(pg_temp.cal(tests.n(), :'sh', 30),
  '2027-03-10:10000000:150000:1:1:9850000:false,2027-03-12:9850000:300000:1:0:9550000:false,'
  || '2027-04-05:9550000:150000:1:0:9400000:false',
  'jendela 30 hari (10 Mar..8 Apr): terlambat di hari ini, 12 Mar, 5 Apr; 12 Apr di luar jendela [T14]');
select is(pg_temp.cal(tests.n(), :'sh', 90),
  '2027-03-10:10000000:150000:1:1:9850000:false,2027-03-12:9850000:300000:1:0:9550000:false,'
  || '2027-04-05:9550000:150000:1:0:9400000:false,2027-04-12:9400000:300000:1:0:9100000:false,'
  || '2027-05-05:9100000:150000:1:0:8950000:false,2027-05-12:8950000:300000:1:0:8650000:false,'
  || '2027-06-05:8650000:150000:1:0:8500000:false',
  'jendela 90 hari (10 Mar..7 Jun): tagihan yang belum dimaterialisasi diproyeksikan; tepat satu per bulan [T14]');
select is(tests.web_val(tests.n(), format($q$select (x.bills -> 0 ->> 'name') || ':' || (x.bills -> 0 ->> 'due_on')
    || ':' || (x.bills -> 0 ->> 'overdue') || ':' || (x.bills -> 0 ->> 'projected')
    from api.cashflow_calendar(%L, 90) x where x.day = '2027-03-10'$q$, :'sh')),
  'Listrik:2027-03-05:true:false', 'rincian tagihan hari ini memuat tagihan lewat jatuh tempo dengan due_on asli');
select is(tests.web_val(tests.n(), format($q$select (x.bills -> 0 ->> 'name') || ':' || (x.bills -> 0 ->> 'due_on')
    || ':' || (x.bills -> 0 ->> 'overdue') || ':' || (x.bills -> 0 ->> 'projected')
    from api.cashflow_calendar(%L, 90) x where x.day = '2027-05-05'$q$, :'sh')),
  'Listrik:2027-05-05:false:true', 'rincian tagihan yang belum dimaterialisasi ditandai projected = true');

-- Satu sumber dengan "aman dipakai": saldo operasional pembuka = safe_to_spend.operasional.
select is(tests.web_val(tests.n(), format($q$select x.operasional from api.safe_to_spend(%L) x$q$, :'sh')),
  '10000000', 'pembuka kalender = saldo operasional api.safe_to_spend');

-- Tanggal 31 (clamp akhir bulan): 30 Apr, 31 Mei, 30 Jun; tanpa baris occurrence ganda.
select pg_temp.bill(tests.n(), :'sh', 'Akhir Bulan', 50000, :'sewa', 31, '2027-03-01', :'kas') as akhir_b \gset
select ok(pg_temp.cal(tests.n(), :'sh', 90) ~ '2027-03-31:[0-9]+:50000:1:0:'
          and pg_temp.cal(tests.n(), :'sh', 90) ~ '2027-04-30:[0-9]+:50000:1:0:'
          and pg_temp.cal(tests.n(), :'sh', 90) ~ '2027-05-31:[0-9]+:50000:1:0:'
          and pg_temp.cal(tests.n(), :'sh', 90) !~ '2027-04-31', 'tagihan tanggal 31: 31 Mar, 30 Apr, 31 Mei (clamp) [T14]');
select is(tests.owner_val(null, format($q$select count(*) from (select due_on from app.bill_occurrences
  where bill_id = %L group by due_on having count(*) > 1) x$q$, :'akhir_b')), '0', 'tidak ada occurrence ganda per tanggal [T15]');

-- Dilewati, dibayar, dan arsip tidak dihitung.
select pg_temp.call(tests.n(), format($q$select api.skip_bill_occurrence(%L)$q$,
  tests.owner_val(null, format($i$select id from app.bill_occurrences where bill_id = %L and due_on = '2027-03-12'$i$, :'sewa_b'))));
select is(pg_temp.cal(tests.n(), :'sh', 3), '2027-03-10:10000000:150000:1:1:9850000:false',
  'kemunculan dilewati tidak dihitung (12 Mar hilang)');
select pg_temp.call(tests.n(), format($q$select api.post_bill_occurrence(gen_random_uuid(), %L, %L::uuid)$q$,
  tests.owner_val(null, format($i$select id from app.bill_occurrences where bill_id = %L and due_on = '2027-03-05'$i$, :'listrik_b')),
  :'kas'));
select is(pg_temp.cal(tests.n(), :'sh', 3), '-',
  'kemunculan dibayar tidak dihitung lagi; saldo pembuka turun oleh entri bayar, bukan oleh kalender');
select is(pg_temp.cal(tests.n(), :'sh', 1, true), '2027-03-10:9850000:0:0:0:9850000:false',
  'pembuka sesudah bayar Listrik = 9.850.000');
select pg_temp.call(tests.n(), format($q$select api.archive_bill(%L)$q$, :'akhir_b'));
select is(pg_temp.cal(tests.n(), :'sh', 30), '2027-04-05:9850000:150000:1:0:9700000:false',
  'tagihan arsip tidak dihitung; sisa: Listrik 5 Apr (12 Apr Sewa di luar 30 hari, 12 Mar dilewati)');
-- Mengubah day_of_month Sewa (12 -> 25) pada bulan yang sudah punya occurrence 12 Mar (dilewati)
-- tidak boleh memproyeksikan 25 Mar di bulan yang sama (anti ganda seperti private.materialize_bill).
select pg_temp.call(tests.n(), format(
  $q$select api.update_bill(%L, 'Sewa', 300000, %L, 25::smallint, %L::uuid, null)$q$,
  :'sewa_b', :'sewa', :'kas'));
select ok(pg_temp.cal(tests.n(), :'sh', 30) !~ '2027-03-25',
  'ubah day_of_month di bulan yang sudah punya occurrence tidak memproyeksikan ganda bulan itu [T15]');

-- Kurang: tagihan besar membuat penutup negatif, penanda short mulai hari itu dan seterusnya.
select pg_temp.bill(tests.n(), :'sh', 'Cicilan Besar', 20000000, :'sewa', 20, '2027-03-01', :'kas') as besar_b \gset
select ok(pg_temp.cal(tests.n(), :'sh', 12, true) ~ '2027-03-19:9850000:0:0:0:9850000:false,2027-03-20:9850000:20000000:1:0:-10150000:true,2027-03-21:-10150000:0:0:0:-10150000:true',
  'penutup negatif ditandai short mulai 20 Mar; sebelumnya tidak');
select ok(pg_temp.cal(tests.n(), :'sh', 12, true) !~ '2027-03-1[0-9]:[0-9-]+:[0-9]+:[0-9]+:[0-9]+:-[0-9]+:true',
  'hari sebelum tagihan besar tidak short');

-- Dompet aset dan dompet arsip tidak masuk saldo operasional.
select tests.account(tests.n(), :'sh', 'Reksa', 'aset', 4000000, '2027-01-01') as aset \gset
select is(pg_temp.cal(tests.n(), :'sh', 1, true), '2027-03-10:9850000:0:0:0:9850000:false',
  'dompet aset (4.000.000) tidak menambah saldo operasional kalender');

-- ===== B13: isolasi =====
select pg_temp.bill(tests.n(), :'np', 'KANARI-PRIBADI', 7654321, :'lang', 8, '2027-03-01', :'bca') as kanari_b \gset
select ok(pg_temp.cal(tests.n(), :'sh', 90) !~ '7654321', 'kalender Bersama tanpa tagihan Pribadi (kanari) [B13]');
select ok(pg_temp.cal(tests.n(), :'np', 90) ~ '7654321' and pg_temp.cal(tests.n(), :'np', 90) !~ ':300000:',
  'kalender Pribadi memuat tagihan Pribadi saja, bukan tagihan Bersama [B13]');
select is(pg_temp.err(tests.f(), format($q$select count(*) from api.cashflow_calendar(%L, 30)$q$, :'np')),
  'DK404:space_not_found:', 'F tidak bisa membaca kalender Pribadi N: DK404 seragam [B13]');
select is(pg_temp.err(tests.x(), format($q$select count(*) from api.cashflow_calendar(%L, 30)$q$, :'sh')),
  'DK404:space_not_found:', 'orang luar: DK404');

-- ===== Deteksi langganan (Pribadi N, hari ini 10 Mar 2027) =====
-- Netflix 54.000 tiap bulan (15 Jan, 15 Feb, 2 Mar; variasi huruf besar dan spasi = satu kelompok).
select pg_temp.spend(tests.n(), :'np', :'bca', 54000, '2027-01-15', 'Netflix');
select pg_temp.spend(tests.n(), :'np', :'bca', 54000, '2027-02-15', 'NETFLIX ');
select pg_temp.spend(tests.n(), :'np', :'bca', 54000, '2027-03-02', 'netflix');
-- Gym: hanya 2 bulan = bukan langganan.
select pg_temp.spend(tests.n(), :'np', :'bca', 300000, '2027-02-01', 'Gym');
select pg_temp.spend(tests.n(), :'np', :'bca', 300000, '2027-03-01', 'Gym');
-- Spotify: 3 bulan tetapi terakhir 20 Des 2026 (> 45 hari) = sudah berhenti.
select pg_temp.spend(tests.n(), :'np', :'bca', 55000, '2026-10-20', 'Spotify');
select pg_temp.spend(tests.n(), :'np', :'bca', 55000, '2026-11-20', 'Spotify');
select pg_temp.spend(tests.n(), :'np', :'bca', 55000, '2026-12-20', 'Spotify');
-- Kopi: nominal beda tiap kali = bukan pola.
select pg_temp.spend(tests.n(), :'np', :'bca', 21000, '2027-01-10', 'Kopi');
select pg_temp.spend(tests.n(), :'np', :'bca', 22000, '2027-02-10', 'Kopi');
select pg_temp.spend(tests.n(), :'np', :'bca', 23000, '2027-03-10', 'Kopi');
-- Internet: pola 3 bulan tetapi sudah jadi tagihan aktif (nama sama) = tidak diusulkan dobel.
select pg_temp.spend(tests.n(), :'np', :'bca', 350000, '2027-01-05', 'Internet');
select pg_temp.spend(tests.n(), :'np', :'bca', 350000, '2027-02-05', 'Internet');
select pg_temp.spend(tests.n(), :'np', :'bca', 350000, '2027-03-05', 'Internet');
select pg_temp.bill(tests.n(), :'np', 'internet', 350000, :'lang', 5, '2027-04-01', :'bca');
-- Talangan (reimbursable) berpola = bukan pengeluaran biasa.
select pg_temp.spend(tests.n(), :'np', :'bca', 80000, '2027-01-12', 'Talangan Rutin', true);
select pg_temp.spend(tests.n(), :'np', :'bca', 80000, '2027-02-12', 'Talangan Rutin', true);
select pg_temp.spend(tests.n(), :'np', :'bca', 80000, '2027-03-02', 'Talangan Rutin', true);
select is(pg_temp.subs(tests.n(), :'np'), 'netflix:54000:3:2027-03-02:2',
  'hanya Netflix: 3 bulan, nominal sama, terkini; Gym/Spotify/Kopi/Internet/talangan tidak [T14]');
-- Bersama tidak melihat pola Pribadi (B13).
select is(pg_temp.subs(tests.n(), :'sh'), '-', 'Bersama: tidak ada saran dari entri Pribadi [B13]');
select is(pg_temp.err(tests.f(), format($q$select count(*) from api.detect_subscriptions(%L)$q$, :'np')),
  'DK404:space_not_found:', 'F tidak bisa membaca saran Pribadi N: DK404 [B13]');

-- Abaikan: idempoten, per ruang, hanya anggota.
select is(pg_temp.call(tests.n(), format($q$select api.dismiss_subscription(%L, 'Netflix', 54000)$q$, :'np')),
  '{"dismissed": true}'::jsonb, 'abaikan Netflix');
select is(pg_temp.subs(tests.n(), :'np'), '-', 'Netflix hilang dari saran');
select is(pg_temp.call(tests.n(), format($q$select api.dismiss_subscription(%L, '  NETFLIX ', 54000)$q$, :'np')),
  '{"dismissed": true}'::jsonb, 'abaikan lagi (huruf/spasi lain) = sukses idempoten');
select is(tests.owner_val(null, format($q$select count(*) from app.subscription_dismissals where space_id = %L$q$, :'np')),
  '1', 'satu baris abaikan');
-- Nominal berbeda = kelompok lain: abaikan 54.000 tidak menyembunyikan 59.000.
select pg_temp.spend(tests.n(), :'np', :'bca', 59000, '2027-01-20', 'Netflix');
select pg_temp.spend(tests.n(), :'np', :'bca', 59000, '2027-02-20', 'Netflix');
select pg_temp.spend(tests.n(), :'np', :'bca', 59000, '2027-03-05', 'Netflix');
select is(pg_temp.subs(tests.n(), :'np'), 'Netflix:59000:3:2027-03-05:5', 'abaikan per (nama, nominal): 59.000 tetap muncul');
select is(pg_temp.err(tests.f(), format($q$select api.dismiss_subscription(%L, 'Netflix', 54000)$q$, :'np')),
  'DK404:space_not_found:', 'F tidak bisa mengabaikan di ruang N: DK404 [B13]');
select is(pg_temp.err(tests.n(), format($q$select api.dismiss_subscription(%L, '   ', 54000)$q$, :'np')),
  'DK400:invalid_argument:name', 'nama kosong ditolak');
select is(pg_temp.err(tests.n(), format($q$select api.dismiss_subscription(%L, 'X', 0)$q$, :'np')),
  'DK400:invalid_argument:amount', 'nominal 0 ditolak');

-- ===== Ekspor: audit via =====
select tests.owner_val(null, format($q$select count(*) from audit.events where event = 'export' and space_id = %L$q$, :'sh'))::int as c0 \gset
select pg_temp.err(tests.n(), format($q$select count(*) from api.export_entries(%L, '2027-03-01', '2027-03-31', 'pdf')$q$, :'sh')) is not null as _;
select is(tests.owner_val(null, format($q$select meta ->> 'via' from audit.events where event = 'export' and space_id = %L
  order by id desc limit 1$q$, :'sh')), 'pdf', 'ekspor PDF: audit export via = pdf');
select pg_temp.err(tests.n(), format($q$select count(*) from api.export_entries(%L, '2027-03-01', '2027-03-31')$q$, :'sh')) is not null as _;
select is(tests.owner_val(null, format($q$select meta ->> 'via' from audit.events where event = 'export' and space_id = %L
  order by id desc limit 1$q$, :'sh')), 'csv', 'ekspor tanpa via = csv (pemanggil lama tetap jalan)');
select is(tests.owner_val(null, format($q$select count(*) from audit.events where event = 'export' and space_id = %L$q$, :'sh'))::int,
  :c0 + 2, 'dua ekspor = dua event');
select is(pg_temp.err(tests.n(), format($q$select count(*) from api.export_entries(%L, '2027-03-01', '2027-03-31', 'xls')$q$, :'sh')),
  'DK400:invalid_argument:via', 'via selain csv/pdf ditolak [K9]');

select * from finish();
rollback;
