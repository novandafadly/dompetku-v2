-- Tagihan rutin lanjutan (S15 Task 5, K12; TANPA migrasi: hanya tes atas materialisasi S9, 0118/0122).
-- Melengkapi 22_tagihan (clamp 30 Nov / 28 Feb, idempotensi job, bayar di muka 31 Okt 23:30 WIB) dengan:
-- Z4/T14 persis: tagihan tanggal 31 mulai 31 Jan 2027 = 31 Jan, 28 Feb, 31 Mar, 30 Apr; tanggal 29 dan 30
-- di Feb 2027 = 28 Feb; tahun kabisat 2028 = 29 Feb; label periode gajian (aturan 25) tiap kemunculan.
-- Z5: batas hari WIB pada 31 Jan 23:59:59 dan 1 Feb 00:00:00 (= 31 Jan 17:00 UTC): tanggal bayar dan batas
-- materialisasi job mengikuti hari WIB, bukan UTC; cron `5 0 * * *` Asia/Jakarta diuji di worker
-- (apps/worker/src/jobs.test.ts).
-- T15: job dua kali lalu bayar dua kali (client_id sama = replay, client_id lain = already_posted) = tepat
-- satu entri hidup per kemunculan; job_runs dua `ok` diuji di apps/worker/src/__int__/worker.int.test.ts;
-- paralel di 99_konkurensi (bayar paralel = already_posted, materialisasi paralel).
-- B14: dua ruang dengan tagihan serupa: kemunculan hanya di ruang tagihannya; tagihan arsip tidak
-- dimaterialisasi; dompetku_worker tidak bisa select langsung tabel tagihan/entri.
-- Jam tiruan; semua tanggal dihitung tangan dari kalender 2027/2028 dan app.holidays (lihat label aturan 25).
-- ID: Z4, Z5, T14, T15, B14
begin;
select plan(31);
select tests.fixture();
select tests.clock_at('2027-01-05 10:00+07');

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
  v_state text;
  v_msg   text;
begin
  perform tests.web_val(p_uid, p_sql);
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  return v_state || ':' || v_msg;
end $$;
create function pg_temp.bill(p_space uuid, p_name text, p_amount bigint, p_cat uuid, p_day int,
  p_starts date, p_acc uuid) returns uuid
language sql as $$
  select (pg_temp.call(tests.n(), format(
    $q$select api.create_bill(gen_random_uuid(), %L, %L, %s, %L, %s::smallint, %L::date, null, %L::uuid)$q$,
    p_space, p_name, p_amount, p_cat, p_day, p_starts, p_acc)) ->> 'bill_id')::uuid
$$;
create function pg_temp.post(p_occ uuid, p_acc uuid, p_client uuid default gen_random_uuid()) returns jsonb
language sql as $$
  select pg_temp.call(tests.n(), format(
    $q$select api.post_bill_occurrence(p_client_id => %L, p_occurrence_id => %L, p_account_id => %L::uuid)$q$,
    p_client, p_occ, p_acc))
$$;
-- Kemunculan satu tagihan: due:nominal:keadaan (lunas = entri hidup, lewat = dilewati, buka).
create function pg_temp.occ(p_bill uuid) returns text
language sql as $$
  select tests.owner_val(null, format($q$select coalesce(string_agg(s.due_on || ':' || s.amount || ':'
      || case when s.posted then 'lunas' when s.skipped_at is not null then 'lewat' else 'buka' end, ','
      order by s.due_on), '-')
    from app.bill_schedule s where s.bill_id = %L$q$, p_bill))
$$;
create function pg_temp.occ_id(p_bill uuid, p_due date) returns uuid
language sql as $$
  select tests.owner_val(null, format($q$select id from app.bill_occurrences where bill_id = %L and due_on = %L$q$,
    p_bill, p_due))::uuid
$$;

select pg_temp.cat(:'sh', 'Sewa Rumah') as sewa, pg_temp.cat(:'np', 'Langganan') as lang \gset
select tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 10000000, '2026-01-01') as kas,
       tests.account(tests.n(), :'np', 'BCA', 'operasional', 10000000, '2026-01-01') as bca \gset

-- ===== Z5: batas hari WIB (aturan gajian kosong = bulan kalender) =====
select pg_temp.bill(:'sh', 'Batas Hari', 75000, :'sewa', 31, '2027-01-31', :'kas') as z5 \gset
select is(pg_temp.occ(:'z5'), '2027-01-31:75000:buka,2027-02-28:75000:buka',
  'dibuat 5 Jan: kemunculan 31 Jan dan 28 Feb (batas = akhir periode berikutnya)');
-- 31 Jan 23:59:59 WIB = 16:59:59 UTC: hari ini 31 Jan; job tidak menambah (batas tetap 28 Feb).
select tests.clock_at('2027-01-31 23:59:59+07');
select is(tests.owner_val(null, 'select app.today()'), '2027-01-31', '23:59:59 WIB: app.today() = 31 Jan [Z5]');
select is(tests.worker_val(null, 'select jobs.materialize_bills()') || ' ' || pg_temp.occ(:'z5'),
  '0 2027-01-31:75000:buka,2027-02-28:75000:buka', 'job 31 Jan 23:59:59 WIB: batas 28 Feb, tanpa kemunculan baru [Z5]');
select is(pg_temp.post(pg_temp.occ_id(:'z5', '2027-01-31'), :'kas') ->> 'replayed', 'false', 'bayar 31 Jan 23:59:59 WIB');
select is(tests.owner_val(null, format($$select e.occurred_on from app.entries e
  join app.bill_occurrences o on o.entry_id = e.id where o.bill_id = %L and o.due_on = '2027-01-31'$$, :'z5')),
  '2027-01-31', 'entri bayar 23:59:59 WIB bertanggal 31 Jan [Z5]');
-- 00:00:00 WIB 1 Feb = 17:00:00 UTC 31 Jan: sudah 1 Feb menurut WIB (UTC masih 31 Jan).
select tests.clock_at('2027-02-01 00:00:00+07');
select is(tests.owner_val(null, 'select app.today()'), '2027-02-01', '00:00:00 WIB: app.today() = 1 Feb, bukan 31 Jan UTC [Z5]');
select pg_temp.post(pg_temp.occ_id(:'z5', '2027-02-28'), :'kas');
select is(tests.owner_val(null, format($$select e.occurred_on from app.entries e
  join app.bill_occurrences o on o.entry_id = e.id where o.bill_id = %L and o.due_on = '2027-02-28'$$, :'z5')),
  '2027-02-01', 'bayar di muka 00:00:00 WIB bertanggal 1 Feb [Z5]');
-- 00:05 WIB 1 Feb (17:05 UTC 31 Jan, jam cron): batas bergeser ke akhir Maret, 31 Mar baru muncul.
select tests.clock_at('2027-02-01 00:05:00+07');
select is(tests.worker_val(null, 'select jobs.materialize_bills()') || ' ' || pg_temp.occ(:'z5'),
  '1 2027-01-31:75000:lunas,2027-02-28:75000:lunas,2027-03-31:75000:buka',
  'job 1 Feb 00:05 WIB: batas 31 Mar (hari WIB, bukan UTC), 31 Mar muncul [Z5]');

-- ===== Z4/T14: tanggal 29, 30, 31 dan clamp bulan pendek =====
select tests.clock_at('2027-01-05 10:00+07');
select pg_temp.bill(:'sh', 'Tgl 31', 90000, :'sewa', 31, '2027-01-31', :'kas') as d31,
       pg_temp.bill(:'sh', 'Tgl 30', 80000, :'sewa', 30, '2027-01-30', :'kas') as d30,
       pg_temp.bill(:'sh', 'Tgl 29', 70000, :'sewa', 29, '2027-01-29', :'kas') as d29 \gset
select is(pg_temp.occ(:'d31'), '2027-01-31:90000:buka,2027-02-28:90000:buka', 'tgl 31 dibuat 5 Jan: 31 Jan dan 28 Feb [Z4]');
-- Tiga tagihan baru x 2 + Batas Hari (30 Apr) = 7.
select is(tests.worker_val(null, $$select jobs.materialize_bills('2027-04-30')$$), '7',
  'job s.d. 30 Apr 2027: 6 kemunculan tgl 29/30/31 + 30 Apr Batas Hari [Z4]');
select is(pg_temp.occ(:'d31'),
  '2027-01-31:90000:buka,2027-02-28:90000:buka,2027-03-31:90000:buka,2027-04-30:90000:buka',
  'tgl 31 mulai 31 Jan 2027: 31 Jan, 28 Feb, 31 Mar, 30 Apr [T14] [Z4]');
select is(pg_temp.occ(:'d30'),
  '2027-01-30:80000:buka,2027-02-28:80000:buka,2027-03-30:80000:buka,2027-04-30:80000:buka',
  'tgl 30: 30 Jan, 28 Feb (Feb 2027 hanya 28 hari), 30 Mar, 30 Apr [Z4]');
select is(pg_temp.occ(:'d29'),
  '2027-01-29:70000:buka,2027-02-28:70000:buka,2027-03-29:70000:buka,2027-04-29:70000:buka',
  'tgl 29: 29 Jan, 28 Feb, 29 Mar, 29 Apr [Z4]');
select is(tests.worker_val(null, $$select jobs.materialize_bills('2027-04-30')$$), '0', 'job kedua s.d. 30 Apr: 0 baru [T15]');
-- Label periode gajian (aturan 25; libur 2027 app.holidays): periode Feb = 25 Jan..24 Feb, Mar = 25 Feb..23 Mar
-- (gajian 25 Mar = libur, mundur ke 24 Mar), Apr = 24 Mar..22 Apr (25 Apr Minggu = 23 Apr), Mei = 23 Apr..24 Mei.
select tests.owner_exec(null, 'update app.households set payday_rule = 25');
select is(tests.owner_val(null, format($$select string_agg(s.due_on || '>' || p.label_month, ',' order by s.due_on)
  from app.bill_occurrences s cross join lateral app.pay_period(s.space_id, s.due_on) p where s.bill_id = %L$$, :'d31')),
  '2027-01-31>2027-02-01,2027-02-28>2027-03-01,2027-03-31>2027-04-01,2027-04-30>2027-05-01',
  'tgl 31 aturan 25: label periode Feb, Mar, Apr, Mei [Z4]');
select tests.owner_exec(null, 'update app.households set payday_rule = null');

-- Tahun kabisat 2028: Februari 29 hari.
select tests.clock_at('2028-01-05 10:00+07');
select pg_temp.bill(:'sh', 'Kabisat 31', 60000, :'sewa', 31, '2028-01-31', :'kas') as k31,
       pg_temp.bill(:'sh', 'Kabisat 29', 50000, :'sewa', 29, '2028-01-29', :'kas') as k29 \gset
select tests.worker_val(null, $$select jobs.materialize_bills('2028-04-30')$$);
select is(pg_temp.occ(:'k31'),
  '2028-01-31:60000:buka,2028-02-29:60000:buka,2028-03-31:60000:buka,2028-04-30:60000:buka',
  'tgl 31 mulai 31 Jan 2028 (kabisat): 31 Jan, 29 Feb, 31 Mar, 30 Apr [T14] [Z4]');
select is(pg_temp.occ(:'k29'),
  '2028-01-29:50000:buka,2028-02-29:50000:buka,2028-03-29:50000:buka,2028-04-29:50000:buka',
  'tgl 29 di Feb 2028 kabisat = 29 Feb (bukan 28) [Z4]');
select is(tests.worker_val(null, $$select jobs.materialize_bills('2028-04-30')$$), '0', 'job kedua s.d. 30 Apr 2028: 0 baru [T15]');

-- ===== T15: job dua kali lalu bayar dua kali = satu entri hidup =====
select tests.clock_at('2027-01-05 10:00+07');
select pg_temp.bill(:'sh', 'Satu Entri', 45000, :'sewa', 15, '2027-01-05', :'kas') as t15 \gset
select is(pg_temp.occ(:'t15'), '2027-01-15:45000:buka,2027-02-15:45000:buka', 'tagihan tgl 15: 15 Jan dan 15 Feb');
select is(tests.worker_val(null, 'select jobs.materialize_bills()') || ' ' || tests.worker_val(null, 'select jobs.materialize_bills()'),
  '0 0', 'job dua kali berturut-turut: 0 baru [T15]');
select pg_temp.occ_id(:'t15', '2027-01-15') as t15_occ, 'a0000000-0000-4000-8000-0000000000c1' as c1 \gset
select pg_temp.post(:'t15_occ', :'kas', :'c1') ->> 'entry_id' as t15_entry \gset
select is(pg_temp.post(:'t15_occ', :'kas', :'c1') ->> 'entry_id' || ' ' || (pg_temp.post(:'t15_occ', :'kas', :'c1') ->> 'replayed'),
  :'t15_entry' || ' true', 'bayar kedua dengan client_id sama = replay, entri sama [T15]');
select is(pg_temp.err(tests.n(), format($$select api.post_bill_occurrence(gen_random_uuid(), %L)$$, :'t15_occ')),
  'DK422:already_posted', 'bayar kedua dengan client_id lain = already_posted [T15]');
select is(tests.owner_val(null, format($$select count(*) from app.entries
  where space_id = %L and description = 'Satu Entri' and voided_at is null$$, :'sh')), '1',
  'tepat satu entri hidup untuk kemunculan itu [T15]');
select is(tests.worker_val(null, 'select jobs.materialize_bills()') || ' ' || pg_temp.occ(:'t15'),
  '0 2027-01-15:45000:lunas,2027-02-15:45000:buka', 'job sesudah bayar: kemunculan lunas tidak dibuat ulang [T15]');

-- ===== B14: job hanya di ruang tagihan =====
select pg_temp.bill(:'sh', 'Langganan Serupa', 55000, :'sewa', 10, '2027-01-05', :'kas') as b_sh,
       pg_temp.bill(:'np', 'Langganan Serupa', 55000, :'lang', 10, '2027-01-05', :'bca') as b_np \gset
select tests.worker_val(null, $$select jobs.materialize_bills('2027-03-31')$$);
select is(tests.owner_val(null, format($$select count(*) filter (where o.bill_id = %L and o.space_id = %L) || ' '
  || count(*) filter (where o.bill_id = %L and o.space_id = %L) from app.bill_occurrences o$$, :'b_sh', :'sh', :'b_np', :'np')),
  '3 3', 'tagihan serupa di dua ruang: tiap ruang 3 kemunculan (10 Jan, 10 Feb, 10 Mar) di ruangnya sendiri [B14]');
select is(tests.owner_val(null, $$select count(*) from app.bill_occurrences o join app.bills b on b.id = o.bill_id
  where o.space_id <> b.space_id$$), '0', 'tidak ada kemunculan di ruang selain ruang tagihannya [B14]');
-- Tagihan arsip tidak dimaterialisasi.
select pg_temp.bill(:'sh', 'Tagihan Arsip', 33000, :'sewa', 12, '2027-01-05', :'kas') as arsip \gset
select pg_temp.call(tests.n(), format('select api.archive_bill(%L)', :'arsip'));
select pg_temp.occ(:'arsip') as arsip_before \gset
select tests.worker_val(null, $$select jobs.materialize_bills('2027-06-30')$$);
select is(pg_temp.occ(:'arsip'), :'arsip_before', 'tagihan arsip: job s.d. 30 Jun tidak menambah kemunculan [B14]');
select is(tests.owner_val(null, format($$select count(*) from app.bill_occurrences where bill_id = %L and due_on > '2027-02-28'$$, :'arsip')),
  '0', 'tagihan arsip tanpa kemunculan sesudah batas pembuatan [B14]');
-- Worker hanya lewat jobs.*: tanpa select langsung.
select throws_ok(format($$select tests.worker_val(null, %L)$$, 'select count(*) from ' || t), '42501', null,
  'worker SELECT ditolak: ' || t || ' [B14]')
from unnest(array['app.bills', 'app.bill_occurrences', 'app.entries']) t;

select * from finish();
rollback;
