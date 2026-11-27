-- Periode tagihan (S20, 0152): mingguan, tiap N minggu, bulanan, tiap N bulan (N = 1..12).
-- Menguji app.bill_dues (satu sumber jatuh tempo), materialisasi (bulanan satu per bulan kalender,
-- mingguan per tanggal), proyeksi api.cashflow_calendar, aturan satu kewajiban (trigger XOR dan DQ13)
-- dengan ritme baru, validasi api.create_bill, bawaan bulanan untuk pemanggil lama (9 argumen), dan
-- api.bill_list. Periode tidak bisa diubah sesudah dibuat: api.update_bill tidak menyentuhnya.
-- Jam dipatok 2027-01-05 10:00 WIB (Selasa); aturan gajian kosong = periode bulan kalender, jadi batas
-- materialisasi = akhir periode berikutnya = 28 Feb 2027. Semua tanggal dihitung tangan dari kalender 2027.
-- Persona N (tests.n()), ruang bersama; kategori bawaan fixture.
begin;
select plan(36);
select tests.fixture();
select tests.clock_at('2027-01-05 10:00+07');

select tests.space_id(tests.n(), 'shared') as sh \gset

create function pg_temp.cat(p_space uuid, p_name text) returns uuid
language sql as $$
  select tests.owner_val(null, format(
    $q$select id from app.categories where space_id = %L and name = %L and archived_at is null$q$,
    p_space, p_name))::uuid
$$;
create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
-- Galat pernyataan sebagai 'SQLSTATE:pesan:detail', atau 'ok'.
create function pg_temp.raw_err(p_stmt text) returns text
language plpgsql as $$
declare
  v_state  text;
  v_msg    text;
  v_detail text;
begin
  execute p_stmt;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
  return v_state || ':' || v_msg || ':' || coalesce(v_detail, '');
end $$;
-- Tagihan dengan periode lewat api.create_bill (argumen bernama); kembalikan id.
create function pg_temp.billx(p_space uuid, p_name text, p_amount bigint, p_cat uuid, p_day int,
  p_starts date, p_acc uuid, p_unit text, p_every int, p_ends date default null) returns uuid
language sql as $$
  select (pg_temp.call(tests.n(), format(
    $q$select api.create_bill(p_client_id => gen_random_uuid(), p_space_id => %L, p_name => %L, p_amount => %s,
         p_category_id => %L, p_day_of_month => %s::smallint, p_starts_on => %L::date, p_ends_on => %L::date,
         p_account_id => %L::uuid, p_repeat_unit => %L, p_repeat_every => %s::smallint)$q$,
    p_space, p_name, p_amount, p_cat, p_day, p_starts, p_ends, p_acc, p_unit, p_every)) ->> 'bill_id')::uuid
$$;
create function pg_temp.post(p_occ uuid, p_acc uuid) returns jsonb
language sql as $$
  select pg_temp.call(tests.n(), format(
    $q$select api.post_bill_occurrence(p_client_id => gen_random_uuid(), p_occurrence_id => %L, p_account_id => %L::uuid)$q$,
    p_occ, p_acc))
$$;
-- Kemunculan satu tagihan: due:nominal:keadaan.
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
-- Item kalender satu tagihan dalam 90 hari dari 5 Jan 2027: 'diproyeksikan/total'.
create function pg_temp.cal(p_space uuid, p_bill uuid) returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select count(*) filter (where (b ->> 'projected')::boolean) || '/' || count(*)
    from api.cashflow_calendar(%L, 90, '2027-01-05') c cross join lateral jsonb_array_elements(c.bills) b
    where b ->> 'bill_id' = %L$q$, p_space, p_bill))
$$;
create function pg_temp.budget(p_space uuid, p_cat uuid, p_month date) returns bigint
language sql as $$
  select tests.api_exec(tests.n(), format($q$insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by)
    values (%L, %L, %L, 1000000, true, app.current_user_id())$q$, p_space, p_cat, p_month))
$$;

select pg_temp.cat(:'sh', 'Sewa Rumah') as sewa, pg_temp.cat(:'sh', 'Listrik & Air') as listrik,
       pg_temp.cat(:'sh', 'Internet') as internet, pg_temp.cat(:'sh', 'Iuran Lingkungan') as iuran,
       pg_temp.cat(:'sh', 'Belanja Dapur') as dapur \gset
select tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 50000000, '2026-01-01') as kas \gset

-- ===== Mingguan tiap 1 minggu: 6, 13, 20, 27 Jan; 3, 10, 17, 24 Feb (3 Mar di luar batas 28 Feb) =====
select pg_temp.billx(:'sh', 'Mingguan', 10000, :'sewa', 1, '2027-01-06', :'kas', 'week', 1) as w1 \gset
select is(pg_temp.occ(:'w1'),
  '2027-01-06:10000:buka,2027-01-13:10000:buka,2027-01-20:10000:buka,2027-01-27:10000:buka,'
  '2027-02-03:10000:buka,2027-02-10:10000:buka,2027-02-17:10000:buka,2027-02-24:10000:buka',
  'mingguan tiap 1 minggu dari Rabu 6 Jan: delapan kemunculan s.d. 28 Feb (8 minggu)');
select is(tests.owner_val(null, format($$select day_of_month || ':' || repeat_unit || ':' || repeat_every
  from app.bills where id = %L$$, :'w1')), '6:week:1',
  'mingguan: day_of_month diisi hari starts_on (6), periode tersimpan');

-- ===== Tiap 2 minggu dari Sabtu 2 Jan (sebelum hari ini): 2, 16, 30 Jan; 13, 27 Feb =====
select pg_temp.billx(:'sh', 'Dua Mingguan', 20000, :'sewa', 1, '2027-01-02', :'kas', 'week', 2) as w2 \gset
select is(pg_temp.occ(:'w2'),
  '2027-01-02:20000:buka,2027-01-16:20000:buka,2027-01-30:20000:buka,2027-02-13:20000:buka,2027-02-27:20000:buka',
  'tiap 2 minggu dari 2 Jan: 2, 16, 30 Jan, 13, 27 Feb (2 Jan = awal bulan dibuat, lewat jatuh tempo)');
select is(tests.worker_val(null, 'select jobs.materialize_bills()'), '0', 'job harian sesudahnya: tidak ada kemunculan baru');

-- ===== Bayar satu kemunculan mingguan: tidak digandakan oleh job =====
select pg_temp.post(pg_temp.occ_id(:'w1', '2027-01-06'), :'kas') ->> 'replayed' as r \gset
select is(left(pg_temp.occ(:'w1'), 22), '2027-01-06:10000:lunas', 'kemunculan 6 Jan dibayar di muka = lunas');
select is(tests.worker_val(null, 'select jobs.materialize_bills()') || ' ' || left(pg_temp.occ(:'w1'), 22),
  '0 2027-01-06:10000:lunas', 'job lagi: 6 Jan tetap lunas, tidak ada duplikat');

-- ===== Tiap N bulan =====
-- Tiap 2 bulan tanggal 15 dari 10 Jan: bulan Jan, Mar, Mei, Jul. Di batas 28 Feb hanya 15 Jan.
select pg_temp.billx(:'sh', 'Dua Bulanan', 30000, :'listrik', 15, '2027-01-10', :'kas', 'month', 2) as m2 \gset
select is(pg_temp.occ(:'m2'), '2027-01-15:30000:buka', 'tiap 2 bulan dari Jan: hanya 15 Jan di batas 28 Feb');
-- Tiap 2 bulan tanggal 31 dari Feb: Feb (28), Apr (30), Jun (30).
select pg_temp.billx(:'sh', 'Dua Bulanan Feb', 40000, :'internet', 31, '2027-02-01', :'kas', 'month', 2) as m2b \gset
select is(pg_temp.occ(:'m2b'), '2027-02-28:40000:buka', 'tiap 2 bulan tanggal 31 dari Feb: 28 Feb (terpotong), Jan tidak');

-- ===== Kalender: proyeksi di luar batas materialisasi (5 Jan + 89 hari = 4 Apr) =====
-- w1: 13 tanggal (6 Jan..31 Mar) - 6 Jan lunas = 12; diproyeksikan 3, 10, 17, 24, 31 Mar = 5.
select is(pg_temp.cal(:'sh', :'w1'), '5/12', 'kalender mingguan: 7 terbuka + 5 proyeksi, yang lunas tidak muncul');
-- w2: 2, 16, 30 Jan, 13, 27 Feb terbuka (2 Jan lewat jatuh tempo) + proyeksi 13, 27 Mar (10 Apr di luar).
select is(pg_temp.cal(:'sh', :'w2'), '2/7', 'kalender tiap 2 minggu: 5 terbuka + 2 proyeksi');
-- m2: 15 Jan terbuka + proyeksi 15 Mar (15 Mei di luar).
select is(pg_temp.cal(:'sh', :'m2'), '1/2', 'kalender tiap 2 bulan: 15 Jan + proyeksi 15 Mar, Feb tidak');
-- m2b: 28 Feb terbuka; 30 Apr di luar rentang.
select is(pg_temp.cal(:'sh', :'m2b'), '0/1', 'kalender tiap 2 bulan dari Feb: hanya 28 Feb');

-- ===== Job dengan batas lebih jauh =====
select tests.worker_val(null, $$select jobs.materialize_bills('2027-03-12')$$);
select is(tests.owner_val(null, format('select count(*) from app.bill_occurrences where bill_id = %L', :'w1')), '10',
  'job s.d. 12 Mar: mingguan bertambah 3 dan 10 Mar (10 kemunculan)');

-- ===== Ubah tagihan mingguan: nominal baru hanya untuk kemunculan terbuka mulai hari ini =====
select pg_temp.call(tests.n(), format($q$select api.update_bill(p_bill_id => %L, p_name => 'Tiap 2 Minggu',
  p_amount => 99000, p_category_id => %L, p_day_of_month => 2::smallint, p_account_id => %L, p_ends_on => null)$q$,
  :'w2', :'sewa', :'kas'));
select is(pg_temp.occ(:'w2'),
  '2027-01-02:20000:buka,2027-01-16:99000:buka,2027-01-30:99000:buka,2027-02-13:99000:buka,2027-02-27:99000:buka',
  'ubah: 2 Jan (lampau) tetap 20000; kemunculan mulai hari ini 99000, jatuh tempo tetap tiap 14 hari');
select is(tests.owner_val(null, format($$select repeat_unit || ':' || repeat_every from app.bills where id = %L$$, :'w2')),
  'week:2', 'ubah tagihan tidak mengubah periode');

-- ===== Berakhir =====
select pg_temp.billx(:'sh', 'Berakhir', 5000, :'iuran', 1, '2027-01-06', :'kas', 'week', 1, '2027-01-20') as wend \gset
select is(pg_temp.occ(:'wend'), '2027-01-06:5000:buka,2027-01-13:5000:buka,2027-01-20:5000:buka',
  'mingguan dengan ends_on 20 Jan: hanya 6, 13, 20 Jan');

-- ===== Batas yang lebih jauh: tiap 2 bulan menjaga ritme, terpotong ke hari terakhir bulan =====
select tests.worker_val(null, $$select jobs.materialize_bills('2027-07-31')$$);
select is(pg_temp.occ(:'m2'),
  '2027-01-15:30000:buka,2027-03-15:30000:buka,2027-05-15:30000:buka,2027-07-15:30000:buka',
  'tiap 2 bulan tanggal 15 dari Jan s.d. 31 Jul: Jan, Mar, Mei, Jul');
select is(pg_temp.occ(:'m2b'), '2027-02-28:40000:buka,2027-04-30:40000:buka,2027-06-30:40000:buka',
  'tiap 2 bulan tanggal 31 dari Feb s.d. 31 Jul: 28 Feb, 30 Apr, 30 Jun (31 Agu di luar)');

-- ===== app.bill_dues langsung =====
select is(tests.owner_val(null, $$select array_to_string(array_agg(d), ',')
  from app.bill_dues('month', 12::smallint, 10::smallint, '2027-03-10', '2027-01-01', '2029-12-31') d$$),
  '2027-03-10,2028-03-10,2029-03-10', 'tiap 12 bulan (tahunan): 10 Mar tiap tahun, tidak sebelum jangkar');
select is(tests.owner_val(null, $$select array_to_string(array_agg(d), ',')
  from app.bill_dues('week', 3::smallint, 1::smallint, '2027-01-01', '2027-02-01', '2027-03-15') d$$),
  '2027-02-12,2027-03-05', 'tiap 3 minggu dari 1 Jan: 22 Jan, 12 Feb, 5 Mar, 26 Mar; dalam 1 Feb..15 Mar = 12 Feb, 5 Mar');
select is(tests.owner_val(null, $$select array_to_string(array_agg(d), ',')
  from app.bill_dues('week', 1::smallint, 1::smallint, '2027-01-06', '2026-12-01', '2027-01-20') d$$),
  '2027-01-06,2027-01-13,2027-01-20', 'rentang mulai sebelum jangkar: tidak ada tanggal sebelum starts_on');

-- ===== Pemanggil lama (9 argumen) tetap bulanan tiap 1 bulan =====
select pg_temp.call(tests.n(), format($q$select api.create_bill(gen_random_uuid(), %L, 'Lama', 5000, %L, 5::smallint,
  '2027-01-05'::date, null, %L::uuid)$q$, :'sh', :'sewa', :'kas')) ->> 'bill_id' as lama \gset
select is(pg_temp.occ(:'lama'), '2027-01-05:5000:buka,2027-02-05:5000:buka',
  'create_bill tanpa argumen periode = bulanan tiap 1 bulan (perilaku lama)');
select is(tests.web_val(tests.n(), format($$select repeat_unit || ':' || repeat_every from api.bill_list(%L) where bill_id = %L$$,
  :'sh', :'lama')), 'month:1', 'bill_list: tagihan lama = month:1');
select is(tests.web_val(tests.n(), format($$select repeat_unit || ':' || repeat_every from api.bill_list(%L) where bill_id = %L$$,
  :'sh', :'w2')), 'week:2', 'bill_list: tagihan tiap 2 minggu = week:2');

-- ===== Validasi =====
select is(pg_temp.raw_err(format($$select pg_temp.billx(%L, 'X', 1000, %L, 1, '2027-01-06', %L, 'year', 1)$$, :'sh', :'sewa', :'kas')),
  'DK400:invalid_argument:repeat_unit', 'satuan year = DK400 repeat_unit');
select is(pg_temp.raw_err(format($$select pg_temp.billx(%L, 'X', 1000, %L, 1, '2027-01-06', %L, null, 1)$$, :'sh', :'sewa', :'kas')),
  'DK400:invalid_argument:repeat_unit', 'satuan null = DK400 repeat_unit');
select is(pg_temp.raw_err(format($$select pg_temp.billx(%L, 'X', 1000, %L, 1, '2027-01-06', %L, 'week', 0)$$, :'sh', :'sewa', :'kas')),
  'DK400:invalid_argument:repeat_every', 'kelipatan 0 = DK400 repeat_every');
select is(pg_temp.raw_err(format($$select pg_temp.billx(%L, 'X', 1000, %L, 1, '2027-01-06', %L, 'month', 13)$$, :'sh', :'sewa', :'kas')),
  'DK400:invalid_argument:repeat_every', 'kelipatan 13 = DK400 repeat_every');

-- ===== Satu kewajiban dengan ritme baru (label = bulan kalender) =====
-- listrik: tiap 2 bulan dari Jan (Jan, Mar, Mei, Jul). Feb tidak punya jatuh tempo: anggaran wajib Feb boleh.
select is(pg_temp.raw_err(format($$select pg_temp.budget(%L, %L, '2027-02-01')$$, :'sh', :'listrik')), 'ok',
  'tiap 2 bulan dari Jan: anggaran wajib Feb pada kategori yang sama boleh (Feb tanpa jatuh tempo)');
select is(pg_temp.raw_err(format($$select pg_temp.budget(%L, %L, '2027-03-01')$$, :'sh', :'listrik')),
  'DK422:obligation_double:', 'tiap 2 bulan dari Jan: anggaran wajib Mar bentrok (jatuh tempo 15 Mar)');
-- internet: tiap 2 bulan dari Feb. Jan tanpa jatuh tempo, Feb bentrok.
select is(pg_temp.raw_err(format($$select pg_temp.budget(%L, %L, '2027-01-01')$$, :'sh', :'internet')), 'ok',
  'tiap 2 bulan dari Feb: anggaran wajib Jan boleh');
select is(pg_temp.raw_err(format($$select pg_temp.budget(%L, %L, '2027-02-01')$$, :'sh', :'internet')),
  'DK422:obligation_double:', 'tiap 2 bulan dari Feb: anggaran wajib Feb bentrok');
-- sewa punya tagihan mingguan: setiap bulan bentrok.
select is(pg_temp.raw_err(format($$select pg_temp.budget(%L, %L, '2027-02-01')$$, :'sh', :'sewa')),
  'DK422:obligation_double:', 'tagihan mingguan: anggaran wajib kategori yang sama bentrok');
-- dapur dianggarkan wajib Feb: tagihan mingguan yang mulai 6 Jan ditolak; yang baru mulai 15 Mar boleh.
select pg_temp.budget(:'sh', :'dapur', '2027-02-01');
select is(pg_temp.raw_err(format($$select pg_temp.billx(%L, 'Belanja', 1000, %L, 1, '2027-01-06', %L, 'week', 1)$$, :'sh', :'dapur', :'kas')),
  'DK422:obligation_double:', 'tagihan mingguan 6 Jan pada kategori beranggaran wajib Feb = obligation_double');
select is(pg_temp.raw_err(format($$select pg_temp.billx(%L, 'Belanja', 1000, %L, 1, '2027-03-15', %L, 'week', 1)$$, :'sh', :'dapur', :'kas')),
  'ok', 'tagihan mingguan yang baru mulai 15 Mar tidak bentrok dengan anggaran wajib Feb');
-- DQ13 (satu kewajiban di dq_run) tetap 0.
select is(tests.worker_val(null, $$select violations from jobs.dq_reconcile() where check_id = 'DQ13'$$), '0',
  'DQ13 = 0 sesudah semua tagihan dan anggaran di atas');

select * from finish();
rollback;
