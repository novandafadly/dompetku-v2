-- API tagihan rutin dasar (S9, 0118; plan S9 Task 5, K3, K4, K12; BSD §2.2 #6, §9 create_bill,
-- post_bill_occurrence, archive_bill, §10 materialize_bills, §13 #11, #33, §15 #2; Review Focus #3, #5).
-- api.create_bill (+ materialisasi langsung sampai akhir periode gajian BERIKUTNYA), api.update_bill
-- (kemunculan terbuka mulai hari ini diganti, yang lampau/dibayar/dilewati tetap), api.archive_bill,
-- api.post_bill_occurrence (+ p_amount, K12; bayar di muka), api.skip/unskip_bill_occurrence (K4),
-- api.bill_list, api.bills_due, jobs.materialize_bills (hanya worker). Kode galat baru:
-- bill_account_kantor, bill_archived, already_posted. Satu kewajiban: starts_on lampau dihitung dari
-- bulan tagihan dibuat (private.bill_first_on, sama dengan materialisasi). Angka dihitung tangan.
-- Jam dipatok 2026-11-05 10:00 WIB (Kamis); payday_rule = 25 (diubah di dalam transaksi tes):
-- periode Nov = 23 Okt..24 Nov, Des = 25 Nov..22 Des, Jan 2027 = 23 Des..24 Jan (lihat 21_kewajiban).
-- Batas materialisasi = akhir periode berikutnya = 22 Des 2026 (aturan kosong: 31 Des 2026).
-- Persona N, F, Luar (tests.x(), tanpa ruang); kanari KANARI-N-TAGIHAN dan KANARI-F-TAGIHAN.
-- ID: B1, B2, B13, T13, T14, T15, Z4
begin;
select plan(137);
select tests.fixture();
select tests.clock_at('2026-11-05 10:00+07');
select tests.owner_exec(null, 'update app.households set payday_rule = 25');
-- Luar: pengguna terdaftar tanpa ruang mana pun (dibuat superuser, melewati penjaga pendaftaran).
select tests.raw_exec(format($$insert into auth."user" (id, name, email, "emailVerified")
  values (%L, 'Luar', 'luar@example.test', true)$$, tests.x()));

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

create function pg_temp.cat(p_space uuid, p_name text) returns uuid
language sql as $$
  select tests.owner_val(null, format(
    $q$select id from app.categories where space_id = %L and name = %L and archived_at is null$q$,
    p_space, p_name))::uuid
$$;
create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
-- Galat pernyataan sebagai 'SQLSTATE:pesan:detail', atau 'ok' (efek pernyataan yang berhasil tetap ada;
-- yang gagal dibatalkan bersama subtransaksinya).
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
create function pg_temp.err(p_uid uuid, p_sql text) returns text
language sql as $$ select pg_temp.raw_err(format('select tests.web_val(%L, %L)', p_uid, p_sql)) $$;
-- Tagihan baru lewat api.create_bill (client_id baru); kembalikan id.
create function pg_temp.bill(p_uid uuid, p_space uuid, p_name text, p_amount bigint, p_cat uuid, p_day int,
  p_starts date, p_ends date default null, p_acc uuid default null) returns uuid
language sql as $$
  select (pg_temp.call(p_uid, format(
    $q$select api.create_bill(gen_random_uuid(), %L, %L, %s, %L, %s::smallint, %L::date, %L::date, %L::uuid)$q$,
    p_space, p_name, p_amount, p_cat, p_day, p_starts, p_ends, p_acc)) ->> 'bill_id')::uuid
$$;
create function pg_temp.bill_sql(p_space uuid, p_name text, p_amount bigint, p_cat uuid, p_day int,
  p_starts date, p_ends date default null, p_acc uuid default null) returns text
language sql as $$
  select format($q$select api.create_bill(gen_random_uuid(), %L, %L, %s, %L, %s::smallint, %L::date, %L::date, %L::uuid)$q$,
    p_space, p_name, p_amount, p_cat, p_day, p_starts, p_ends, p_acc)
$$;
create function pg_temp.update_sql(p_bill uuid, p_name text, p_amount bigint, p_cat uuid, p_day int,
  p_acc uuid, p_ends date) returns text
language sql as $$
  select format($q$select api.update_bill(%L, %L, %s, %L, %s::smallint, %L::uuid, %L::date)$q$,
    p_bill, p_name, p_amount, p_cat, p_day, p_acc, p_ends)
$$;
create function pg_temp.post_sql(p_occ uuid, p_acc uuid default null, p_amount bigint default null,
  p_on date default null, p_client uuid default null) returns text
language sql as $$
  select format($q$select api.post_bill_occurrence(p_client_id => %L, p_occurrence_id => %L,
    p_account_id => %L::uuid, p_occurred_on => %L::date, p_amount => %L::bigint)$q$,
    coalesce(p_client, gen_random_uuid()), p_occ, p_acc, p_on, p_amount)
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
-- Σ kemunculan terbuka (belum dibayar, belum dilewati) s.d. p_through menurut api.bills_due.
create function pg_temp.open_sum(p_uid uuid, p_space uuid, p_through date, p_bill uuid default null) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select coalesce(sum(amount), 0) from api.bills_due(%L, %L::date)
    where not posted and not skipped and (%L::uuid is null or bill_id = %L::uuid)$q$, p_space, p_through, p_bill, p_bill))
$$;
create function pg_temp.entry_row(p_entry uuid) returns text
language sql as $$
  select tests.owner_val(null, format($q$select e.kind || '|' || l.amount || '|' || l.account_id || '|' || e.category_id
      || '|' || e.description || '|' || e.occurred_on || '|' || e.created_by
    from app.entries e join app.entry_lines l on l.entry_id = e.id and l.role = 'main' where e.id = %L$q$, p_entry))
$$;
create function pg_temp.budget(p_uid uuid, p_space uuid, p_cat uuid, p_month date) returns bigint
language sql as $$
  select tests.api_exec(p_uid, format($q$insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by)
    values (%L, %L, %L, 1000000, true, app.current_user_id())$q$, p_space, p_cat, p_month))
$$;

select pg_temp.cat(:'sh', 'Listrik & Air') as listrik, pg_temp.cat(:'sh', 'Internet') as internet,
       pg_temp.cat(:'sh', 'Iuran Lingkungan') as iuran, pg_temp.cat(:'sh', 'Bensin & Parkir') as bensin,
       pg_temp.cat(:'sh', 'Belanja Dapur') as dapur, pg_temp.cat(:'sh', 'Sayur & Buah') as sayur,
       pg_temp.cat(:'sh', 'Makan di Luar') as makan, pg_temp.cat(:'sh', 'Sewa Rumah') as sewa,
       pg_temp.cat(:'sh', 'Kontribusi Farida') as kontrib,
       pg_temp.cat(:'np', 'Langganan') as nlangganan, pg_temp.cat(:'np', 'Cicilan & Tagihan') as ncicilan,
       pg_temp.cat(:'fp', 'Langganan') as flangganan \gset
select pg_temp.call(tests.n(), format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Arsip Tagihan', 'Receipt')$$,
  :'sh')) ->> 'category_id' as arsipcat \gset
select pg_temp.call(tests.n(), format($$select api.archive_category(%L)$$, :'arsipcat'));
select tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 2000000, '2026-01-01') as kas,
       tests.account(tests.n(), :'sh', 'Kas Lama', 'operasional', 0, '2026-01-01') as lama,
       tests.account(tests.n(), :'np', 'BCA', 'operasional', 1000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 500000, '2026-01-01') as kantor,
       tests.account(tests.f(), :'fp', 'BCA Farida', 'operasional', 1000000, '2026-01-01') as fbca \gset
select pg_temp.call(tests.n(), format($$select api.archive_account(%L)$$, :'lama'));

-- ===== Hak: materialisasi hanya lewat worker (jobs.*) atau fungsi api =====
select throws_ok($$select tests.web_val(tests.n(), 'select jobs.materialize_bills()')$$, '42501', null,
  'web tidak bisa menjalankan jobs.materialize_bills');
select throws_ok($$select tests.api_val(tests.n(), 'select jobs.materialize_bills()')$$, '42501', null,
  'api tidak bisa menjalankan jobs.materialize_bills');
select throws_ok(format('select tests.web_val(tests.n(), %L)', format('select private.materialize_bill(%L)', gen_random_uuid())),
  '42501', null, 'web tidak bisa memanggil private.materialize_bill');
select throws_ok(format('select tests.worker_val(null, %L)', format('select private.materialize_bill(%L)', gen_random_uuid())),
  '42501', null, 'worker tidak bisa memanggil private.materialize_bill langsung');

-- ===== create_bill + materialisasi (BSD §9, §10, §13 #33, K3) =====
select pg_temp.call(tests.n(), format($$select api.create_bill('a0000000-0000-4000-8000-000000000001', %L, 'Listrik PLN',
  485000, %L, 20::smallint, '2026-08-05', null, %L)$$, :'sh', :'listrik', :'kas')) as res_a \gset
select (:'res_a'::jsonb) ->> 'bill_id' as bill_a \gset
select is(pg_temp.occ(:'bill_a'), '2026-11-20:485000:buka,2026-12-20:485000:buka',
  'starts_on 5 Agu (3 bulan lalu): kemunculan mulai bulan dibuat (Nov) s.d. akhir periode gajian berikutnya (22 Des) [BSD §13 #33]');
select is(tests.owner_val(null, format($$select name || '|' || amount || '|' || day_of_month || '|' || starts_on || '|'
    || coalesce(ends_on::text, '-') || '|' || account_id || '|' || created_by || '|'
    || (created_at = '2026-11-05 10:00+07' and updated_at = created_at) || '|' || (archived_at is null)
  from app.bills where id = %L$$, :'bill_a')),
  'Listrik PLN|485000|20|2026-08-05|-|' || :'kas' || '|' || tests.n() || '|true|true',
  'baris tagihan: starts_on asli disimpan, created_at/updated_at = app.now() (jam WIB tiruan)');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(:'res_a'::jsonb) k), 'bill_id,replayed',
  'hasil create_bill: bill_id + replayed, tanpa nominal');
select is(pg_temp.call(tests.n(), format($$select api.create_bill('a0000000-0000-4000-8000-000000000001', %L, 'Listrik PLN',
    485000, %L, 20::smallint, '2026-08-05', null, %L)$$, :'sh', :'listrik', :'kas')) ->> 'replayed'
  || ' ' || tests.owner_val(null, format($$select count(*) from app.bills where space_id = %L and name = 'Listrik PLN'$$, :'sh')),
  'true 1', 'client_id sama + isi sama = replay, satu tagihan');
select is(pg_temp.err(tests.n(), format($$select api.create_bill('a0000000-0000-4000-8000-000000000001', %L, 'Listrik PLN',
    490000, %L, 20::smallint, '2026-08-05', null, %L)$$, :'sh', :'listrik', :'kas')),
  'DK410:idempotency_key_reused:', 'client_id sama + nominal beda = DK410');

-- Aturan gajian kosong: batas = akhir bulan kalender berikutnya (31 Des).
select tests.owner_exec(null, 'update app.households set payday_rule = null');
select pg_temp.bill(tests.n(), :'sh', 'Sewa Rumah', 3000000, :'sewa', 25, '2026-11-05') as bill_d25 \gset
select tests.owner_exec(null, 'update app.households set payday_rule = 25');
select is(pg_temp.occ(:'bill_d25'), '2026-11-25:3000000:buka,2026-12-25:3000000:buka',
  'aturan gajian kosong: kemunculan s.d. akhir bulan kalender berikutnya (25 Des ikut)');
select pg_temp.bill(tests.n(), :'sh', 'Kebersihan', 50000, :'sewa', 25, '2026-11-05') as bill_e \gset
select is(pg_temp.occ(:'bill_e'), '2026-11-25:50000:buka',
  'aturan 25: 25 Des di luar periode berikutnya (25 Nov..22 Des), belum dimaterialisasi');
select pg_temp.bill(tests.n(), :'sh', 'Cicilan Kulkas', 750000, :'sewa', 31, '2026-11-01', null, :'kas') as bill_d31 \gset
select is(pg_temp.occ(:'bill_d31'), '2026-11-30:750000:buka', 'tanggal 31 di November jatuh 30 Nov [T14]');
select pg_temp.bill(tests.n(), :'sh', 'Cicilan HP', 200000, :'sewa', 15, '2026-11-05', '2027-01-31', :'kas') as bill_g \gset
select is(pg_temp.occ(:'bill_g'), '2026-11-15:200000:buka,2026-12-15:200000:buka', 'tagihan berakhir 31 Jan: Nov dan Des');

-- Validasi create_bill: galat tanpa nominal (detail = nama field).
select is(pg_temp.err(u, q), e, 'create_bill: ' || t)
from (values
  ('nama kosong', tests.n(), pg_temp.bill_sql(:'sh', '  ', 1000, :'sewa', 1, '2026-11-05'), 'DK400:invalid_argument:name'),
  ('nama 61 huruf', tests.n(), pg_temp.bill_sql(:'sh', repeat('x', 61), 1000, :'sewa', 1, '2026-11-05'), 'DK400:invalid_argument:name'),
  ('nominal 0', tests.n(), pg_temp.bill_sql(:'sh', 'X', 0, :'sewa', 1, '2026-11-05'), 'DK400:invalid_argument:amount'),
  ('nominal > 10 triliun', tests.n(), pg_temp.bill_sql(:'sh', 'X', 10000000000001, :'sewa', 1, '2026-11-05'), 'DK400:invalid_argument:amount'),
  ('tanggal 0', tests.n(), pg_temp.bill_sql(:'sh', 'X', 1000, :'sewa', 0, '2026-11-05'), 'DK400:invalid_argument:day_of_month'),
  ('tanggal 32', tests.n(), pg_temp.bill_sql(:'sh', 'X', 1000, :'sewa', 32, '2026-11-05'), 'DK400:invalid_argument:day_of_month'),
  ('mulai kosong', tests.n(), pg_temp.bill_sql(:'sh', 'X', 1000, :'sewa', 1, null), 'DK400:invalid_argument:starts_on'),
  ('berakhir sebelum mulai', tests.n(), pg_temp.bill_sql(:'sh', 'X', 1000, :'sewa', 1, '2026-11-05', '2026-11-04'), 'DK400:invalid_argument:ends_on'),
  ('kategori pemasukan', tests.n(), pg_temp.bill_sql(:'sh', 'X', 1000, :'kontrib', 1, '2026-11-05'), 'DK404:category_not_found:category_id'),
  ('kategori Pribadi N di Bersama', tests.n(), pg_temp.bill_sql(:'sh', 'X', 1000, :'nlangganan', 1, '2026-11-05'), 'DK404:category_not_found:category_id'),
  ('F memakai kategori Pribadi N', tests.f(), pg_temp.bill_sql(:'fp', 'X', 1000, :'nlangganan', 1, '2026-11-05'), 'DK404:category_not_found:category_id'),
  ('kategori terarsip', tests.n(), pg_temp.bill_sql(:'sh', 'X', 1000, :'arsipcat', 1, '2026-11-05'), 'DK422:category_archived:'),
  ('dompet Pribadi N untuk tagihan Bersama', tests.n(), pg_temp.bill_sql(:'sh', 'X', 1000, :'sewa', 1, '2026-11-05', null, :'bca'), 'DK404:account_not_found:account_id'),
  ('F memakai dompet Pribadi N', tests.f(), pg_temp.bill_sql(:'fp', 'X', 1000, :'flangganan', 1, '2026-11-05', null, :'bca'), 'DK404:account_not_found:account_id'),
  ('dompet terarsip', tests.n(), pg_temp.bill_sql(:'sh', 'X', 1000, :'sewa', 1, '2026-11-05', null, :'lama'), 'DK422:account_archived:'),
  ('Kas Kantor', tests.n(), pg_temp.bill_sql(:'np', 'X', 1000, :'nlangganan', 1, '2026-11-05', null, :'kantor'), 'DK422:bill_account_kantor:'),
  ('Luar ke Bersama', tests.x(), pg_temp.bill_sql(:'sh', 'X', 1000, :'sewa', 1, '2026-11-05'), 'DK404:space_not_found:'),
  ('tanpa konteks', null, pg_temp.bill_sql(:'sh', 'X', 1000, :'sewa', 1, '2026-11-05'), 'DK401:unauthenticated:')
) v (t, u, q, e);
select is(tests.owner_val(null, $$select count(*) from app.bills where name = 'X'$$), '0', 'validasi gagal tanpa efek');

-- ===== Satu kewajiban dan starts_on lampau (0118: dari bulan tagihan dibuat, sama dengan materialisasi) =====
select pg_temp.budget(tests.n(), :'sh', :'bensin', '2026-10-01');
select is(pg_temp.err(tests.n(), pg_temp.bill_sql(:'sh', 'Parkir Bulanan', 150000, :'bensin', 20, '2026-08-01', null, :'kas')), 'ok',
  'starts_on 1 Agu vs anggaran wajib label Okt: tidak bentrok, kemunculan pertama 20 Nov (0117 menolaknya)');
select tests.owner_val(null, $$select id from app.bills where name = 'Parkir Bulanan'$$) as bill_park \gset
select is(pg_temp.occ(:'bill_park'), '2026-11-20:150000:buka,2026-12-20:150000:buka', 'Parkir: kemunculan mulai bulan dibuat');
select is(pg_temp.raw_err(format($$select pg_temp.budget(%L, %L, %L, '2026-11-01')$$, tests.n(), :'sh', :'bensin')),
  'DK422:obligation_double:', 'anggaran wajib label Nov vs tagihan (kemunculan 20 Nov) = obligation_double');
select pg_temp.budget(tests.n(), :'sh', :'makan', '2026-11-01');
select is(pg_temp.err(tests.f(), pg_temp.bill_sql(:'sh', 'Katering', 400000, :'makan', 20, '2026-11-05')),
  'DK422:obligation_double:', 'create_bill pada kategori beranggaran wajib label Nov = obligation_double');
-- F ke ruang Pribadi N: DK404 sebelum trigger XOR (bukan obligation_double, bukan 42501).
select pg_temp.budget(tests.n(), :'np', :'ncicilan', '2026-11-01');
select is(pg_temp.err(tests.n(), pg_temp.bill_sql(:'np', 'Cicilan Motor', 900000, :'ncicilan', 20, '2026-11-05')),
  'DK422:obligation_double:', 'pembanding: N sendiri di Pribadi N = obligation_double');
select is(pg_temp.err(tests.f(), pg_temp.bill_sql(:'np', 'Cicilan Motor', 900000, :'ncicilan', 20, '2026-11-05')),
  'DK404:space_not_found:', 'F ke Pribadi N = DK404 space_not_found, bukan obligation_double (assert_member sebelum INSERT)');

-- ===== Bayar (BSD §9, K12, §15 #2) =====
select pg_temp.occ_id(:'bill_a', '2026-11-20') as a_nov, pg_temp.occ_id(:'bill_a', '2026-12-20') as a_des \gset
select is(pg_temp.err(u, q), e, 'post_bill_occurrence: ' || t)
from (values
  ('F dari dompet Pribadinya', tests.f(), pg_temp.post_sql(:'a_nov', :'fbca'), 'DK404:account_not_found:account_id'),
  ('N dari dompet Pribadinya', tests.n(), pg_temp.post_sql(:'a_nov', :'bca'), 'DK404:account_not_found:account_id'),
  ('nominal 0', tests.n(), pg_temp.post_sql(:'a_nov', null, 0), 'DK400:invalid_argument:amount'),
  ('nominal negatif', tests.n(), pg_temp.post_sql(:'a_nov', null, -5), 'DK400:invalid_argument:amount'),
  ('tanggal besok', tests.n(), pg_temp.post_sql(:'a_nov', null, null, '2026-11-06'), 'DK400:invalid_argument:occurred_on'),
  ('kemunculan tidak ada', tests.n(), pg_temp.post_sql(gen_random_uuid()), 'DK404:bill_not_found:'),
  ('dompet terarsip', tests.n(), pg_temp.post_sql(:'a_nov', :'lama'), 'DK422:account_archived:')
) v (t, u, q, e);
-- F membayar tagihan Bersama dari dompet Bersama dengan nominal aktual 512.000 (perkiraan 485.000).
select pg_temp.call(tests.f(), pg_temp.post_sql(:'a_nov', :'kas', 512000, null, 'a0000000-0000-4000-8000-000000000002')) as pay1 \gset
select (:'pay1'::jsonb) ->> 'entry_id' as pay1_entry \gset
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(:'pay1'::jsonb) k),
  'entry_id,occurrence_id,replayed,version,warnings', 'hasil bayar: entri, kemunculan, versi; tanpa nominal');
select is((:'pay1'::jsonb) ->> 'occurrence_id' || ' ' || ((:'pay1'::jsonb) ->> 'replayed'), :'a_nov' || ' false',
  'hasil bayar menyebut kemunculan yang dibayar');
select is(pg_temp.entry_row(:'pay1_entry'),
  'expense|-512000|' || :'kas' || '|' || :'listrik' || '|Listrik PLN|2026-11-05|' || tests.f(),
  'bayar = pengeluaran 512.000 (p_amount) dari Kas Rumah, kategori tagihan, deskripsi = nama, hari ini [K12]');
select is(tests.owner_val(null, format($$select (entry_id = %L) || ' ' || amount from app.bill_occurrences where id = %L$$,
  :'pay1_entry', :'a_nov')), 'true 485000', 'kemunculan tertaut ke entri; nominal kemunculan tetap perkiraan');
select is(pg_temp.occ(:'bill_a'), '2026-11-20:485000:lunas,2026-12-20:485000:buka', 'Nov lunas, Des terbuka');
select is(tests.balance(:'kas'), 1488000::bigint, 'Kas Rumah 2.000.000 - 512.000 = 1.488.000');
select is((pg_temp.call(tests.f(), pg_temp.post_sql(:'a_nov', :'kas', 512000, null, 'a0000000-0000-4000-8000-000000000002')) ->> 'replayed')
  || ' ' || tests.balance(:'kas'), 'true 1488000', 'client_id sama + isi sama = replay, saldo tidak berubah');
select is(pg_temp.err(tests.f(), pg_temp.post_sql(:'a_nov', :'kas', 485000, null, 'a0000000-0000-4000-8000-000000000002')),
  'DK410:idempotency_key_reused:', 'client_id sama + p_amount beda = DK410 (p_amount ikut hash)');
select is(pg_temp.err(tests.n(), pg_temp.post_sql(:'a_nov')), 'DK422:already_posted:', 'bayar lagi = already_posted');
select is(pg_temp.open_sum(tests.f(), :'sh', '2026-11-24', :'bill_a') || '/' || pg_temp.open_sum(tests.f(), :'sh', '2026-12-22', :'bill_a'),
  '0/485000', 'sesudah dibayar, kemunculan Nov tidak dipotong lagi; Des tetap 485.000 [K12]');
-- Batalkan entri bayar = kemunculan terbuka lagi; pulihkan = lunas lagi.
select pg_temp.call(tests.f(), format('select api.void_entry(gen_random_uuid(), %L, 1)', :'pay1_entry'));
select is(pg_temp.occ(:'bill_a') || ' ' || pg_temp.open_sum(tests.f(), :'sh', '2026-11-24', :'bill_a'),
  '2026-11-20:485000:buka,2026-12-20:485000:buka 485000', 'entri bayar dibatalkan: kemunculan terbuka dan dihitung lagi');
select is(pg_temp.err(tests.n(), pg_temp.post_sql(:'a_nov', :'lama')), 'DK422:account_archived:',
  'selama entri bayar batal, kemunculan bisa dibayar lagi (sampai cek dompet), bukan already_posted');
select pg_temp.call(tests.f(), format('select api.restore_entry(gen_random_uuid(), %L, 2)', :'pay1_entry'));
select is(pg_temp.occ(:'bill_a'), '2026-11-20:485000:lunas,2026-12-20:485000:buka', 'entri dipulihkan: lunas lagi');
-- Bayar di muka (kemunculan Des, hari ini; dompet bawaan tagihan).
select pg_temp.call(tests.n(), pg_temp.post_sql(:'a_des')) ->> 'entry_id' as pay2_entry \gset
select is(pg_temp.entry_row(:'pay2_entry'),
  'expense|-485000|' || :'kas' || '|' || :'listrik' || '|Listrik PLN|2026-11-05|' || tests.n(),
  'bayar di muka: entri bertanggal hari ini dari dompet bawaan tagihan [BSD §15 #2]');
select is(tests.balance(:'kas') || ' ' || pg_temp.open_sum(tests.f(), :'sh', '2026-12-22', :'bill_a'), '1003000 0',
  'bayar di muka: saldo turun hari ini (1.488.000 - 485.000), kemunculan Des tidak dipotong lagi');
select is(pg_temp.err(tests.n(), pg_temp.post_sql(pg_temp.occ_id(:'bill_e', '2026-11-25'))), 'DK400:invalid_argument:account_id',
  'tagihan tanpa dompet bawaan dan tanpa p_account_id = DK400 account_id');

-- ===== Pribadi: kanari dan Kas Kantor =====
select pg_temp.bill(tests.n(), :'np', 'KANARI-N-TAGIHAN', 99000, :'nlangganan', 20, '2026-11-05', null, :'bca') as bill_k \gset
select pg_temp.bill(tests.f(), :'fp', 'KANARI-F-TAGIHAN', 88000, :'flangganan', 20, '2026-11-05', null, :'fbca') as bill_fk \gset
select is(pg_temp.err(tests.n(), pg_temp.post_sql(pg_temp.occ_id(:'bill_k', '2026-11-20'), :'kantor')), 'DK422:bill_account_kantor:',
  'bayar tagihan dari Kas Kantor = bill_account_kantor');
select is(pg_temp.err(tests.n(), pg_temp.update_sql(:'bill_k', 'KANARI-N-TAGIHAN', 99000, :'nlangganan', 20, :'kantor', null)),
  'DK422:bill_account_kantor:', 'ubah dompet tagihan ke Kas Kantor = bill_account_kantor');

-- ===== Lewati / batalkan lewati (K4) =====
select pg_temp.bill(tests.n(), :'sh', 'Internet Rumah', 350000, :'internet', 10, '2026-11-05', null, :'kas') as bill_b \gset
select pg_temp.occ_id(:'bill_b', '2026-11-10') as b_nov \gset
select is(pg_temp.occ(:'bill_b'), '2026-11-10:350000:buka,2026-12-10:350000:buka', 'Internet: 10 Nov dan 10 Des');
select is(pg_temp.call(tests.f(), format('select api.skip_bill_occurrence(%L)', :'b_nov'))::text,
  format('{"skipped": true, "occurrence_id": "%s"}', :'b_nov'), 'F melewati kemunculan Bersama');
select is(pg_temp.call(tests.f(), format('select api.skip_bill_occurrence(%L)', :'b_nov')) ->> 'skipped', 'true',
  'lewati dua kali = idempoten');
select is(pg_temp.occ(:'bill_b') || ' ' || pg_temp.open_sum(tests.f(), :'sh', '2026-12-22', :'bill_b'),
  '2026-11-10:350000:lewat,2026-12-10:350000:buka 350000', 'yang dilewati tidak dihitung');
select is(pg_temp.err(tests.n(), pg_temp.post_sql(:'b_nov')), 'DK422:already_posted:', 'bayar kemunculan yang dilewati = already_posted');
select is((pg_temp.call(tests.n(), format('select api.unskip_bill_occurrence(%L)', :'b_nov')) ->> 'skipped')
  || ' ' || pg_temp.open_sum(tests.f(), :'sh', '2026-12-22', :'bill_b'), 'false 700000', 'batalkan lewati: dihitung lagi');
select is(pg_temp.call(tests.n(), format('select api.unskip_bill_occurrence(%L)', :'b_nov')) ->> 'skipped', 'false',
  'batalkan lewati dua kali = idempoten');
select pg_temp.call(tests.n(), pg_temp.post_sql(:'b_nov'));
select is(pg_temp.err(tests.n(), format('select api.skip_bill_occurrence(%L)', :'b_nov')), 'DK422:already_posted:',
  'lewati kemunculan yang sudah dibayar = already_posted');
select is(pg_temp.err(tests.n(), format('select api.unskip_bill_occurrence(%L)', :'b_nov')), 'DK422:already_posted:',
  'batalkan lewati kemunculan yang sudah dibayar = already_posted');
-- Ubah nominal: yang dibayar tetap, yang terbuka mulai hari ini berganti.
select pg_temp.call(tests.n(), pg_temp.update_sql(:'bill_b', 'Internet Rumah', 400000, :'internet', 10, :'kas', null));
select is(pg_temp.occ(:'bill_b'), '2026-11-10:350000:lunas,2026-12-10:400000:buka', 'ubah nominal: dibayar tetap, terbuka berganti');
select pg_temp.occ_id(:'bill_b', '2026-12-10') as b_des \gset

-- ===== Arsip (BSD §2.2 #6, §9) =====
select is(pg_temp.call(tests.n(), format('select api.archive_bill(%L)', :'bill_b'))::text,
  format('{"bill_id": "%s", "skipped": 1}', :'bill_b'), 'arsip: satu kemunculan terbuka dilewati');
select is(pg_temp.occ(:'bill_b') || ' ' || (pg_temp.call(tests.n(), format('select api.archive_bill(%L)', :'bill_b')) ->> 'skipped'),
  '2026-11-10:350000:lunas,2026-12-10:400000:lewat 0', 'arsip dua kali = idempoten (0 dilewati)');
select is(tests.web_val(tests.f(), format($$select count(*) from api.bills_due(%L, '2027-12-31') where bill_id = %L$$, :'sh', :'bill_b')),
  '0', 'bills_due tidak memuat tagihan terarsip');
select is(tests.web_val(tests.n(), format($$select archived || ' ' || coalesce(next_due_on::text, '-') || ' '
  || coalesce(next_occurrence_id::text, '-') from api.bill_list(%L) where bill_id = %L$$, :'sh', :'bill_b')),
  'true - -', 'bill_list: terarsip tanpa jatuh tempo berikutnya');
select is(pg_temp.err(tests.n(), q), 'DK422:bill_archived:', 'tagihan terarsip: ' || t)
from (values
  ('bayar', pg_temp.post_sql(:'b_des')),
  ('lewati', format('select api.skip_bill_occurrence(%L)', :'b_des')),
  ('batalkan lewati', format('select api.unskip_bill_occurrence(%L)', :'b_des')),
  ('ubah', pg_temp.update_sql(:'bill_b', 'Internet Rumah', 400000, :'internet', 10, :'kas', null))
) v (t, q);

-- ===== Kemunculan tertaut entri bayar yang dibatalkan = terbuka (review Task 5 Minor 1, 2, 3, 5) =====
-- Di dalam savepoint: tagihan ini tidak ikut daftar dan jumlah di bagian sesudahnya.
savepoint tertaut_batal;
select pg_temp.bill(tests.n(), :'sh', 'Air PDAM', 100000, :'internet', 20, '2026-11-01', null, :'kas') as bill_d \gset
select pg_temp.call(tests.n(), pg_temp.post_sql(pg_temp.occ_id(:'bill_d', '2026-11-20'))) ->> 'entry_id' as d_entry \gset
select pg_temp.call(tests.n(), format('select api.void_entry(gen_random_uuid(), %L, 1)', :'d_entry'));
select pg_temp.call(tests.n(), pg_temp.update_sql(:'bill_d', 'Air PDAM', 200000, :'internet', 20, :'kas', null));
select is(pg_temp.occ(:'bill_d'), '2026-11-20:200000:buka,2026-12-20:200000:buka',
  'ubah nominal: kemunculan yang entri bayarnya batal ikut diganti (terbuka), bukan tertinggal nominal lama');
select pg_temp.call(tests.n(), format('select api.restore_entry(gen_random_uuid(), %L, 2)', :'d_entry'));
select is(pg_temp.occ(:'bill_d'), '2026-11-20:200000:buka,2026-12-20:200000:buka',
  'entri lama dipulihkan sesudah ubah: tidak lagi tertaut (perilaku diterima, BSD §16 Catatan S9)');
select pg_temp.call(tests.n(), format('select api.void_entry(gen_random_uuid(), %L, 3)', :'d_entry'));
-- Tanggal dimajukan sebelum hari ini (5 Nov, sesudah starts_on 1 Nov): 20 Nov terbuka diganti 3 Nov,
-- langsung lewat jatuh tempo (perilaku diterima; UI menampilkannya di Lewat jatuh tempo).
select pg_temp.call(tests.n(), pg_temp.update_sql(:'bill_d', 'Air PDAM', 200000, :'internet', 3, :'kas', null));
select is(pg_temp.occ(:'bill_d'), '2026-11-03:200000:buka,2026-12-03:200000:buka',
  'tanggal 20 -> 3 pada 5 Nov: kemunculan Nov jadi 3 Nov (lewat jatuh tempo), Des 3 Des');
select pg_temp.occ_id(:'bill_d', '2026-11-03') as d_nov \gset
select pg_temp.call(tests.n(), pg_temp.post_sql(:'d_nov')) ->> 'entry_id' as d_entry2 \gset
select pg_temp.call(tests.n(), format('select api.void_entry(gen_random_uuid(), %L, 1)', :'d_entry2'));
select is(pg_temp.call(tests.n(), format('select api.archive_bill(%L)', :'bill_d')) ->> 'skipped', '2',
  'arsip: kemunculan yang entri bayarnya batal ikut dilewati');
select is(pg_temp.occ(:'bill_d'), '2026-11-03:200000:lewat,2026-12-03:200000:lewat', 'arsip: tidak ada kemunculan terbuka');
select is(tests.owner_val(null, format('select entry_id is null from app.bill_occurrences where id = %L', :'d_nov')),
  'true', 'arsip melepas tautan ke entri batal (CHECK entry_id XOR skipped_at)');
rollback to savepoint tertaut_batal;

-- ===== Ubah tagihan (kemunculan lampau, dibayar, dilewati tidak disentuh) =====
select pg_temp.bill(tests.n(), :'sh', 'Iuran RT', 100000, :'iuran', 3, '2026-09-01', null, :'kas') as bill_c \gset
select pg_temp.occ_id(:'bill_c', '2026-11-03') as c_nov \gset
select is(pg_temp.occ(:'bill_c'), '2026-11-03:100000:buka,2026-12-03:100000:buka', 'Iuran: 3 Nov (lewat jatuh tempo) dan 3 Des');
select is(tests.web_val(tests.f(), format($$select next_due_on || ' ' || (next_occurrence_id = %L) from api.bill_list(%L)
  where bill_id = %L$$, :'c_nov', :'sh', :'bill_c')), '2026-11-03 true', 'bill_list: berikutnya = kemunculan terbuka paling awal (lewat)');
select is(tests.web_val(tests.f(), format($$select string_agg(due_on || ':' || days_until || ':' || overdue || ':' || posted
    || ':' || skipped, ',' order by due_on) from api.bills_due(%L, '2026-12-22') where bill_id = %L$$, :'sh', :'bill_c')),
  '2026-11-03:-2:true:false:false,2026-12-03:28:false:false:false', 'bills_due: lewat 2 hari, Des 28 hari lagi');
select tests.clock_at('2026-11-05 11:00+07');
select is(pg_temp.call(tests.f(), pg_temp.update_sql(:'bill_c', 'Iuran RT 05', 120000, :'iuran', 18, :'kas', null))::text,
  format('{"bill_id": "%s"}', :'bill_c'), 'F mengubah tagihan Bersama');
select is(pg_temp.occ(:'bill_c'), '2026-11-03:100000:buka,2026-12-18:120000:buka',
  'ubah nominal + tanggal: 3 Nov (lampau) tetap; 3 Des diganti 18 Des 120.000 (tanpa 18 Nov: Nov sudah punya kemunculan)');
select is(tests.owner_val(null, format($$select name || '|' || amount || '|' || day_of_month || '|'
    || (updated_at = '2026-11-05 11:00+07') || '|' || (created_at = '2026-11-05 10:00+07') from app.bills where id = %L$$, :'bill_c')),
  'Iuran RT 05|120000|18|true|true', 'baris tagihan diganti, updated_at = app.now()');
select pg_temp.call(tests.n(), format('select api.skip_bill_occurrence(%L)', pg_temp.occ_id(:'bill_c', '2026-12-18')));
select pg_temp.call(tests.n(), pg_temp.update_sql(:'bill_c', 'Iuran RT 05', 130000, :'iuran', 18, :'kas', null));
select is(pg_temp.occ(:'bill_c'), '2026-11-03:100000:buka,2026-12-18:120000:lewat', 'ubah: kemunculan yang dilewati tidak disentuh');
select pg_temp.call(tests.n(), format('select api.unskip_bill_occurrence(%L)', pg_temp.occ_id(:'bill_c', '2026-12-18')));
select pg_temp.call(tests.n(), pg_temp.update_sql(:'bill_c', 'Iuran RT 05', 130000, :'iuran', 18, :'kas', '2026-11-30'));
select is(pg_temp.occ(:'bill_c'), '2026-11-03:100000:buka', 'berakhir 30 Nov: kemunculan terbuka sesudahnya dihapus');
select pg_temp.call(tests.n(), pg_temp.update_sql(:'bill_c', 'Iuran RT 05', 130000, :'iuran', 18, :'kas', null));
select is(pg_temp.occ(:'bill_c'), '2026-11-03:100000:buka,2026-12-18:130000:buka', 'tanpa akhir lagi: 18 Des dimaterialisasi ulang');
select pg_temp.call(tests.n(), pg_temp.update_sql(:'bill_c', 'Iuran RT 05', 130000, :'iuran', 18, :'kas', null));
select is(pg_temp.occ(:'bill_c'), '2026-11-03:100000:buka,2026-12-18:130000:buka', 'ubah dengan isi sama = idempoten');
select pg_temp.budget(tests.n(), :'sh', :'dapur', '2026-12-01');
select is(pg_temp.err(tests.n(), pg_temp.update_sql(:'bill_c', 'Iuran RT 05', 130000, :'sayur', 18, :'kas', null)),
  'DK422:obligation_double:', 'pindah ke Sayur & Buah (induk Belanja Dapur, wajib label Des) = obligation_double');
select is(pg_temp.occ(:'bill_c') || ' ' || tests.owner_val(null, format('select category_id from app.bills where id = %L', :'bill_c')),
  '2026-11-03:100000:buka,2026-12-18:130000:buka ' || :'iuran', 'penolakan tanpa efek');
select is(pg_temp.err(u, q), e, 'update_bill: ' || t)
from (values
  ('nama kosong', tests.n(), pg_temp.update_sql(:'bill_c', '', 1000, :'iuran', 18, :'kas', null), 'DK400:invalid_argument:name'),
  ('nominal 0', tests.n(), pg_temp.update_sql(:'bill_c', 'X', 0, :'iuran', 18, :'kas', null), 'DK400:invalid_argument:amount'),
  ('tanggal 32', tests.n(), pg_temp.update_sql(:'bill_c', 'X', 1000, :'iuran', 32, :'kas', null), 'DK400:invalid_argument:day_of_month'),
  ('berakhir sebelum mulai (1 Sep)', tests.n(), pg_temp.update_sql(:'bill_c', 'X', 1000, :'iuran', 18, :'kas', '2026-08-31'), 'DK400:invalid_argument:ends_on'),
  ('kategori Pribadi N', tests.n(), pg_temp.update_sql(:'bill_c', 'X', 1000, :'nlangganan', 18, :'kas', null), 'DK404:category_not_found:category_id'),
  ('kategori pemasukan', tests.n(), pg_temp.update_sql(:'bill_c', 'X', 1000, :'kontrib', 18, :'kas', null), 'DK404:category_not_found:category_id'),
  ('dompet Pribadi F', tests.f(), pg_temp.update_sql(:'bill_c', 'X', 1000, :'iuran', 18, :'fbca', null), 'DK404:account_not_found:account_id'),
  ('tagihan tidak ada', tests.n(), pg_temp.update_sql(gen_random_uuid(), 'X', 1000, :'iuran', 18, :'kas', null), 'DK404:bill_not_found:')
) v (t, u, q, e);
-- Kemunculan yang sudah dibayar (termasuk di muka) tidak berubah oleh ubah nominal.
select pg_temp.call(tests.n(), pg_temp.update_sql(:'bill_a', 'Listrik PLN', 500000, :'listrik', 20, :'kas', null));
select is(pg_temp.occ(:'bill_a'), '2026-11-20:485000:lunas,2026-12-20:485000:lunas', 'ubah nominal: kemunculan lunas tidak disentuh');
-- F membayar tagihan Bersama yang lewat jatuh tempo dari dompet Bersama.
select is(pg_temp.err(tests.f(), pg_temp.post_sql(:'c_nov', :'kas')), 'ok', 'F bayar tagihan Bersama dari dompet Bersama = boleh');

-- ===== bill_list dan bills_due Bersama (golden, dihitung tangan) =====
select is(tests.web_val(tests.f(), format($$select string_agg(name || ':' || amount || ':' || day_of_month || ':'
    || coalesce(next_due_on::text, '-'), ',') from api.bill_list(%L)$$, :'sh')),
  'Cicilan HP:200000:15:2026-11-15,Parkir Bulanan:150000:20:2026-11-20,Kebersihan:50000:25:2026-11-25,'
  'Sewa Rumah:3000000:25:2026-11-25,Cicilan Kulkas:750000:31:2026-11-30,Iuran RT 05:130000:18:2026-12-18,'
  'Listrik PLN:500000:20:-,Internet Rumah:400000:10:-',
  'bill_list Bersama: aktif urut jatuh tempo berikutnya lalu nama, terarsip terakhir');
select is(tests.web_val(tests.f(), format($$select string_agg(name || ':' || amount || ':' || due_on || ':' || days_until || ':'
    || overdue || ':' || posted || ':' || skipped || ':' || (entry_id is not null), ',') from api.bills_due(%L, '2026-11-24')$$, :'sh')),
  'Iuran RT 05:100000:2026-11-03:-2:false:true:false:true,Cicilan HP:200000:2026-11-15:10:false:false:false:false,'
  'Listrik PLN:512000:2026-11-20:15:false:true:false:true,Parkir Bulanan:150000:2026-11-20:15:false:false:false:false',
  'bills_due s.d. 24 Nov: terbuka + lunas periode berjalan (lunas = nominal entri), tanpa terarsip');
select is(tests.web_val(tests.f(), format($$select count(*) from api.bills_due(%L)$$, :'sh')), '4',
  'bills_due tanpa batas = akhir periode berjalan (24 Nov)');
select is(pg_temp.open_sum(tests.f(), :'sh', '2026-11-24'), '350000', 'Σ terbuka s.d. 24 Nov = 200.000 + 150.000');

-- ===== Isolasi dan kanari (BSD §13 #11, B13) =====
select is(tests.web_val(u, format($$select count(*) from (
    select b::text as x from api.bill_list(%L) b union all select d::text from api.bills_due(%L, '2027-12-31') d
  ) s where x like '%%KANARI-%%' or x like %L or x like %L$$, :'sh', :'sh', '%' || :'bill_k' || '%', '%' || :'bill_fk' || '%')), '0',
  'keluaran Bersama tanpa kanari Pribadi: ' || n)
from (values ('N', tests.n()), ('F', tests.f())) v (n, u);
select is(tests.web_val(tests.n(), format('select string_agg(name, $q$,$q$) from api.bill_list(%L)', :'np')), 'KANARI-N-TAGIHAN',
  'N melihat tagihan Pribadinya sendiri');
select is(pg_temp.err(tests.x(), q), e, 'Luar = DK404: ' || t)
from (values
  ('update_bill', pg_temp.update_sql(:'bill_a', 'X', 1000, :'listrik', 20, :'kas', null), 'DK404:bill_not_found:'),
  ('archive_bill', format('select api.archive_bill(%L)', :'bill_a'), 'DK404:bill_not_found:'),
  ('post_bill_occurrence', pg_temp.post_sql(:'a_nov', :'kas'), 'DK404:bill_not_found:'),
  ('skip_bill_occurrence', format('select api.skip_bill_occurrence(%L)', :'a_nov'), 'DK404:bill_not_found:'),
  ('unskip_bill_occurrence', format('select api.unskip_bill_occurrence(%L)', :'a_nov'), 'DK404:bill_not_found:'),
  ('bill_list', format('select count(*) from api.bill_list(%L)', :'sh'), 'DK404:space_not_found:'),
  ('bills_due', format('select count(*) from api.bills_due(%L)', :'sh'), 'DK404:space_not_found:')
) v (t, q, e);
-- 0122: assert_member sebelum idem_begin: client_id bekas milik sendiri ke ruang/kemunculan orang lain tetap DK404 (bukan DK410).
select is(pg_temp.err(tests.n(), format($$select api.create_bill('a0000000-0000-4000-8000-000000000001', %L, 'Sadar',
    10000, %L, 10::smallint, '2026-11-05')$$, :'fp', :'flangganan')),
  'DK404:space_not_found:', 'create_bill ke ruang orang lain dengan client_id bekas = DK404 (assert_member sebelum idem_begin)');
select is(pg_temp.err(tests.f(), pg_temp.post_sql(pg_temp.occ_id(:'bill_k', '2026-11-20'), :'fbca', 99000, null,
    'a0000000-0000-4000-8000-000000000002')),
  'DK404:bill_not_found:', 'post_bill_occurrence ke kemunculan orang lain dengan client_id bekas = DK404 (assert_member sebelum idem_begin)');
select is(tests.owner_val(null, format('select count(*) from app.idempotency_keys where user_id = %L', tests.x())), '0',
  'pemanggil bukan anggota (Luar) tidak meninggalkan baris idempotency_keys');

-- ===== Waktu WIB =====
-- 31 Okt 23:30 WIB (16:30 UTC): bayar di muka bertanggal 31 Okt [T13].
select tests.clock_at('2026-10-31 23:30+07');
select pg_temp.call(tests.n(), pg_temp.post_sql(pg_temp.occ_id(:'bill_g', '2026-11-15'))) ->> 'entry_id' as pay_g \gset
select is(tests.owner_val(null, format('select occurred_on from app.entries where id = %L', :'pay_g')), '2026-10-31',
  'bayar 31 Okt 23:30 WIB bertanggal 31 Okt [T13]');
-- 1 Nov 00:30 WIB (31 Okt 17:30 UTC): bulan dibuat = November (WIB), Oktober tidak dimaterialisasi.
select tests.clock_at('2026-11-01 00:30+07');
select pg_temp.bill(tests.n(), :'sh', 'Langganan TV', 120000, :'sewa', 31, '2026-10-01', null, :'kas') as bill_h \gset
select is(pg_temp.occ(:'bill_h'), '2026-11-30:120000:buka',
  'dibuat 1 Nov 00:30 WIB (masih 31 Okt UTC), starts_on 1 Okt: kemunculan pertama 30 Nov, tanpa 31 Okt');

-- ===== jobs.materialize_bills (BSD §10, K3) =====
select tests.clock_at('2026-11-05 10:00+07');
select tests.owner_val(null, 'select count(*) from app.bill_occurrences') as n_occ \gset
select is(tests.worker_val(null, 'select jobs.materialize_bills()') || ' '
  || tests.owner_val(null, 'select count(*) from app.bill_occurrences'), '0 ' || :'n_occ',
  'job sesudah create/update: batas sama (22 Des), tanpa kemunculan baru [T15]');
-- 25 Nov: periode Des (25 Nov..22 Des), batas = akhir periode Jan 2027 (24 Jan). Baru (hitung tangan):
-- Listrik 20 Jan, Kebersihan 25 Des, Kulkas 31 Des, Parkir 20 Jan, Iuran 18 Jan, Cicilan HP 15 Jan,
-- Langganan TV 31 Des, KANARI-N 20 Jan, KANARI-F 20 Jan = 9. Sewa Rumah (25 Jan > 24 Jan) dan
-- Internet (terarsip) tidak bertambah.
select tests.clock_at('2026-11-25 10:00+07');
select is(tests.worker_val(null, 'select jobs.materialize_bills()'), '9', 'job 25 Nov: 9 kemunculan baru s.d. 24 Jan 2027');
select tests.owner_val(null, 'select count(*) from app.bill_occurrences') as n_occ2 \gset
select is(tests.worker_val(null, 'select jobs.materialize_bills()') || ' '
  || tests.owner_val(null, 'select count(*) from app.bill_occurrences'), '0 ' || :'n_occ2',
  'job dijalankan dua kali = jumlah kemunculan sama [T15]');
select is(tests.web_val(tests.f(), format($$select string_agg(name || ':' || amount || ':' || due_on || ':' || days_until || ':'
    || overdue || ':' || posted || ':' || skipped, ',') from api.bills_due(%L, '2026-12-22') where bill_id in (%L, %L, %L)$$,
    :'sh', :'bill_a', :'bill_c', :'bill_park')),
  'Parkir Bulanan:150000:2026-11-20:-5:true:false:false,Iuran RT 05:130000:2026-12-18:23:false:false:false,'
  'Listrik PLN:485000:2026-12-20:25:false:true:false,Parkir Bulanan:150000:2026-12-20:25:false:false:false',
  'bills_due 25 Nov (periode Des): lunas periode lalu tidak tampil, yang terbuka lewat tetap tampil');
select is(pg_temp.occ(:'bill_d25') || ' ' || pg_temp.occ(:'bill_b'),
  '2026-11-25:3000000:buka,2026-12-25:3000000:buka 2026-11-10:350000:lunas,2026-12-10:400000:lewat',
  'Sewa Rumah tidak bertambah (25 Jan di luar batas); tagihan terarsip tidak dimaterialisasi');
select tests.worker_val(null, $$select jobs.materialize_bills('2027-03-31')$$);
select is(tests.worker_val(null, $$select jobs.materialize_bills('2027-03-31')$$), '0',
  'batas eksplisit 31 Mar 2027, dijalankan dua kali: kedua = 0');
select is(pg_temp.occ(:'bill_d31'),
  '2026-11-30:750000:buka,2026-12-31:750000:buka,2027-01-31:750000:buka,2027-02-28:750000:buka,2027-03-31:750000:buka',
  'tanggal 31: 30 Nov, 31 Des, 31 Jan, 28 Feb 2027, 31 Mar [T14] [Z4]');
select is(pg_temp.occ(:'bill_g'), '2026-11-15:200000:lunas,2026-12-15:200000:buka,2027-01-15:200000:buka',
  'berakhir 31 Jan: berhenti di 15 Jan; 15 Nov sudah dibayar di muka');
-- 0122: batas atas p_through = app.today() + 400 (25 Nov 2026 + 400 = 30 Des 2027).
select tests.worker_val(null, $$select jobs.materialize_bills('2099-12-31')$$);
select is(tests.owner_val(null, $$select max(due_on) || ' ' || count(*) filter (where due_on > '2027-12-30') from app.bill_occurrences$$),
  '2027-12-25 0', 'p_through 2099-12-31 dibatasi app.today() + 400 (30 Des 2027; tanggal 31 Des 2027 tidak ikut)');

select * from finish();
rollback;
