-- Trip S15 sisi tulis entri (0148; plan S15 Task 4, K1, K4, K6, K11, K15, K16; bingkai S15-TR14 sampai TR21):
-- api.create_entry, api.update_entry, api.create_split diganti dengan p_trip_id di AKHIR (default null: bentuk lama
-- tetap jalan), api.set_entries_trip (tandai/lepas banyak entri atomik, idempoten client_id), api.export_entries +
-- kolom akhir `trip`, api.shared_activity + filter K16 (baris update yang hanya mengubah trip_id tidak tampil),
-- api.move_entry_to_space tidak membawa tag (K15). Pra-cek ramah SEBELUM CHECK mentah: trip tidak ada/ruang lain
-- = DK404 trip_not_found, trip terarsip (baru dipilih atau diganti) = DK422 trip_archived, entri tidak layak
-- (bukan expense, talangan, dompet utama Kantor) = DK422 trip_entry_invalid. Kunci trip FOR SHARE sebelum entri
-- dan dompet. Setiap fungsi tulis: sukses, validasi gagal (nol efek), rollback utuh (kegagalan disuntik),
-- idempotensi client_id, bukan anggota (DK404). I6: tag/lepas/arsip tidak mengubah angka uang; total trip =
-- Laporan; Σ nominal ekspor tidak berubah. Paralel di 99_konkurensi. Jam dipatok 2026-03-20 WIB.
-- Tanpa urutan uuid/created_at identik dan tanpa locale (COLLATE "C").
-- ID: B25, I6, B20, B1
begin;
select plan(140);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 20000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 1000000, '2026-01-01') as kan,
       tests.account(tests.n(), :'np', 'Celengan', 'tabungan', 1000000, '2026-01-01') as tab,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 10000000, '2026-01-01') as kas,
       tests.account(tests.f(), :'fp', 'BNI Farida', 'operasional', 5000000, '2026-01-01') as fbni \gset
select tests.raw_exec(format($q$insert into auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
  values (%L, 'U', 'x@example.test', true, now(), now())$q$, tests.x()));
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja'$q$, :'np'))
  as belanja \gset
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Transportasi'$q$, :'np'))
  as transp \gset
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja Dapur'$q$, :'sh'))
  as sbelanja \gset

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
create function pg_temp.err(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v_s text; v_m text; v_d text;
begin
  perform tests.web_val(p_uid, p_sql);
  return 'ok';
exception when others then
  get stacked diagnostics v_s = returned_sqlstate, v_m = message_text, v_d = pg_exception_detail;
  return v_s || ':' || v_m || ':' || coalesce(v_d, '');
end $$;
create function pg_temp.ct(p_uid uuid, p_space uuid, p_name text, p_from date, p_to date) returns uuid
language sql as $$
  select (pg_temp.call(p_uid, format($q$select api.create_trip(gen_random_uuid(), %L, %L, %L::date, %L::date)$q$,
    p_space, p_name, p_from, p_to)) ->> 'trip_id')::uuid
$$;
create function pg_temp.op(p_uid uuid, p_fn text, p_id uuid) returns jsonb
language sql as $$ select pg_temp.call(p_uid, format($q$select api.%s(%L)$q$, p_fn, p_id)) $$;
-- create_entry dengan p_trip_id bernama; p_client null = acak.
create function pg_temp.ce_sql(p_space uuid, p_acc uuid, p_kind text, p_amount bigint, p_cat uuid, p_on date, p_trip uuid,
  p_reimb boolean default false, p_client uuid default null) returns text
language sql as $$
  select format($q$select api.create_entry(%L, %L, %L, %L::app.entry_kind, %s, %L, %L::date, null, %L, false,
      p_trip_id => %L)$q$, coalesce(p_client, gen_random_uuid()), p_space, p_acc, p_kind, p_amount, p_cat, p_on, p_reimb, p_trip)
$$;
create function pg_temp.exp(p_uid uuid, p_space uuid, p_acc uuid, p_amount bigint, p_cat uuid, p_on date, p_trip uuid default null)
returns uuid
language sql as $$ select (pg_temp.call(p_uid, pg_temp.ce_sql(p_space, p_acc, 'expense', p_amount, p_cat, p_on, p_trip)) ->> 'entry_id')::uuid $$;
-- update_entry ganti-penuh dengan p_trip_id (jenis expense: nominal positif).
create function pg_temp.ue_sql(p_entry uuid, p_ver int, p_acc uuid, p_amount bigint, p_cat uuid, p_on date, p_trip uuid,
  p_reimb boolean default false, p_client uuid default null) returns text
language sql as $$
  select format($q$select api.update_entry(%L, %L, %s, %L, %s, %L, %L::date, null, %L, false, p_trip_id => %L)$q$,
    coalesce(p_client, gen_random_uuid()), p_entry, p_ver, p_acc, p_amount, p_cat, p_on, p_reimb, p_trip)
$$;
create function pg_temp.st_sql(p_trip uuid, p_ids uuid[], p_client uuid default null) returns text
language sql as $$
  select format($q$select api.set_entries_trip(%L, %L, %L::uuid[])$q$, coalesce(p_client, gen_random_uuid()), p_trip, p_ids)
$$;
-- Keadaan entri (owner): nama trip|versi.
create function pg_temp.es(p_entry uuid) returns text
language sql as $$
  select tests.owner_val(null, format($q$select coalesce((select t.name from app.trips t where t.id = e.trip_id), '-')
    || '|' || e.version from app.entries e where e.id = %L$q$, p_entry))
$$;
create function pg_temp.esn(p_ids uuid[]) returns text
language sql as $$
  select string_agg(pg_temp.es(x), ',' order by ord) from unnest(p_ids) with ordinality t (x, ord)
$$;
create function pg_temp.n_rows() returns text
language sql as $$
  select tests.owner_val(null, $q$select (select count(*) from app.entries) || '/' || (select count(*) from app.entry_history)
    || '/' || (select count(*) from app.idempotency_keys)$q$)
$$;
create function pg_temp.fn(p_name text, p_args boolean) returns text
language sql as $$
  select case when p_args then pg_get_function_identity_arguments(p.oid) else pg_get_function_result(p.oid) end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname = p_name
$$;
create function pg_temp.ov(p_uid uuid, p_trip uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select spent || '|' || entry_count from api.trip_overview(%L)$q$, p_trip))
$$;
create function pg_temp.i6(p_uid uuid, p_space uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select
      (select coalesce(string_agg(report_class || ':' || inflow || ':' || outflow || ':' || entry_count, ','
                                  order by report_class collate "C"), '')
         from api.period_summary(%1$L, '2026-03-01', '2026-03-31'))
      || '|' || (select m::text from api.month_summary(%1$L, '2026-03-01') m)
      || '|' || (select coalesce(string_agg(kind || ':' || coalesce(name, '-') || ':' || amount, ',' order by kind, name collate "C"), '')
         from api.category_summary(%1$L, '2026-03-01', '2026-03-31'))
      || '|' || (select coalesce(string_agg(category_id || ':' || spent || ':' || remaining, ',' order by category_id), '')
         from api.budget_progress(%1$L, '2026-03-01'))
      || '|' || (select coalesce(string_agg(account_id || ':' || balance, ',' order by account_id), '')
         from app.account_balances where space_id = %1$L)
      || '|' || (select s::text from api.safe_to_spend(%1$L, '2026-03-20') s)
      || '|' || (select w::text from api.net_worth(%1$L) w)
      || '|' || (select w::text from app.net_worth_at(%1$L, '2026-03-20') w)$q$, p_space))
$$;
-- Ekspor ruang sebagai teks: tanggal|jenis|peran|kelas|nominal|trip per baris, urut fungsi.
create function pg_temp.csv(p_uid uuid, p_space uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select string_agg(occurred_on || '|' || kind || '|' || role || '|' || report_class || '|'
      || amount || '|' || coalesce(trip, '-'), ',') from api.export_entries(%L, '2026-03-01', '2026-03-31')$q$, p_space))
$$;
-- Semua pengeluaran biasa hidup (bukan talangan, bukan Kantor) satu ruang sebagai larik uuid literal.
create function pg_temp.eligible(p_space uuid) returns uuid[]
language sql as $$
  select tests.owner_val(null, format($q$select array_agg(e.id order by e.id)::text from app.entries e
    join app.entry_lines l on l.entry_id = e.id and l.role = 'main' join app.accounts a on a.id = l.account_id
    where e.space_id = %L and e.kind = 'expense' and not e.reimbursable and e.voided_at is null and a.pocket <> 'kantor'
      and a.pocket <> 'patungan'$q$, p_space))::uuid[]
$$;

-- ===== Data awal =====
select pg_temp.exp(tests.n(), :'np', :'bca', 100000, :'belanja', '2026-03-05') as e1 \gset
select pg_temp.exp(tests.n(), :'np', :'bca', 50000, :'belanja', '2026-03-13') as e2 \gset
select pg_temp.exp(tests.n(), :'np', :'bca', 25000, :'transp', '2026-03-13') as e3 \gset
select pg_temp.exp(tests.n(), :'np', :'bca', 30000, :'belanja', '2026-03-20') as e4 \gset
select pg_temp.exp(tests.n(), :'np', :'kan', 30000, :'belanja', '2026-03-14') as e_kan \gset
select (pg_temp.call(tests.n(), pg_temp.ce_sql(:'np', :'bca', 'expense', 70000, :'belanja', '2026-03-15', null, true)) ->> 'entry_id')::uuid as e_tal \gset
select (pg_temp.call(tests.n(), pg_temp.ce_sql(:'np', :'bca', 'income', 5000000, null, '2026-03-09', null)) ->> 'entry_id')::uuid as e_inc \gset
select (pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 200000, 2500, '2026-03-14')$$,
  :'np', :'bca', :'tab')) ->> 'entry_id')::uuid as e_xfer \gset
select pg_temp.exp(tests.n(), :'np', :'bca', 7000, :'belanja', '2026-03-16') as e_batal \gset
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'e_batal'));
select pg_temp.exp(tests.n(), :'sh', :'kas', 80000, :'sbelanja', '2026-03-14') as s1 \gset
select pg_temp.exp(tests.f(), :'sh', :'kas', 20000, :'sbelanja', '2026-03-15') as s2 \gset
select pg_temp.exp(tests.n(), :'sh', :'kas', 10000, :'sbelanja', '2026-03-16') as s3 \gset
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja'$q$, :'fp')) as fbelanja \gset
select pg_temp.exp(tests.f(), :'fp', :'fbni', 40000, :'fbelanja', '2026-03-14') as f1 \gset
select pg_temp.ct(tests.n(), :'np', 'Bali', '2026-03-12', '2026-03-19') as tp \gset
select pg_temp.ct(tests.n(), :'np', 'Lombok', '2026-03-01', '2026-03-03') as tp2 \gset
select pg_temp.ct(tests.n(), :'np', 'Lama', '2026-02-01', '2026-02-03') as tarch \gset
select pg_temp.op(tests.n(), 'archive_trip', :'tarch');
select pg_temp.ct(tests.f(), :'sh', 'Akhir Pekan', '2026-03-14', '2026-03-16') as ts \gset
select pg_temp.ct(tests.f(), :'sh', 'Bersama Lama', '2026-01-01', '2026-01-03') as tsarch \gset
select pg_temp.op(tests.f(), 'archive_trip', :'tsarch');
select pg_temp.ct(tests.f(), :'fp', 'Bandung', '2026-03-01', '2026-03-31') as tf \gset
select pg_temp.i6(tests.f(), :'fp') as fp_0 \gset

-- ===== Kontrak fungsi =====
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'
    and p.proname in ('create_entry', 'update_entry', 'create_split', 'export_entries', 'shared_activity', 'set_entries_trip')),
  6, 'tepat satu tanda tangan per fungsi (tanda tangan lama sudah di-drop, tanpa ambiguitas overload)');
select ok(pg_temp.fn('create_entry', true) like '%p_allow_negative boolean, p_trip_id uuid'
  and pg_temp.fn('update_entry', true) like '%p_allow_negative boolean, p_trip_id uuid'
  and pg_temp.fn('create_split', true) like '%p_allow_negative boolean, p_trip_id uuid',
  'p_trip_id = parameter TERAKHIR create_entry, update_entry, create_split');
select is(pg_temp.fn('set_entries_trip', true), 'p_client_id uuid, p_trip_id uuid, p_entry_ids uuid[]', 'tanda tangan api.set_entries_trip');
select ok(pg_temp.fn('export_entries', false) like '%recorded_by text, trip text)', 'api.export_entries: kolom akhir trip (K11)');
select is(tests.owner_val(null, $q$select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname = any (array['create_entry', 'update_entry', 'create_split', 'set_entries_trip'])
    and p.prosecdef and p.proconfig = array['search_path=""'] and p.proowner = 'dompetku_api'::regrole$q$), '4',
  'fungsi tulis: SECURITY DEFINER, search_path kosong, milik dompetku_api');

-- ===== Bentuk lama tetap bekerja (web pra-S15, tagihan SQL, WA, tes lama) =====
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1000, %L, '2026-03-05', null,
  false, false)$$, :'np', :'bca', :'belanja')) ->> 'entry_id' as old1 \gset
select is(pg_temp.es(:'old1'), '-|1', 'create_entry 10 argumen posisional: sukses, tanpa trip');
select pg_temp.call(tests.n(), format($$select api.create_entry(p_client_id => gen_random_uuid(), p_space_id => %L, p_account_id => %L,
  p_kind => 'expense', p_amount => 1100, p_category_id => %L, p_occurred_on => '2026-03-05', p_description => 'x',
  p_reimbursable => false)$$, :'np', :'bca', :'belanja')) ->> 'entry_id' as old2 \gset
select is(pg_temp.es(:'old2'), '-|1', 'create_entry bernama tanpa p_trip_id (seperti post_bill_occurrence): sukses, tanpa trip');
select pg_temp.call(tests.n(), format($$select api.update_entry(gen_random_uuid(), %L, 1, %L, 1200, %L, '2026-03-05', null, false,
  false)$$, :'old1', :'bca', :'belanja'));
select is(pg_temp.es(:'old1'), '-|2', 'update_entry 10 argumen posisional: sukses, tanpa trip');
select pg_temp.call(tests.n(), format($$select api.create_split(gen_random_uuid(), %L, %L, 3000, %L, '2026-03-05', 'lama', null,
  false)$$, :'sh', :'bca', :'sbelanja')) as old_split_r \gset
select is(pg_temp.es((:'old_split_r'::jsonb ->> 'expense_entry_id')::uuid), '-|1', 'create_split 9 argumen posisional: sukses, tanpa trip');
select pg_temp.call(tests.n(), format($$select api.void_split(gen_random_uuid(), %L)$$, :'old_split_r'::jsonb ->> 'split_id'));
select pg_temp.call(tests.n(), pg_temp.st_sql(:'tp', array[:'old1', :'old2']::uuid[]));
select pg_temp.call(tests.n(), format($$select api.update_entry(gen_random_uuid(), %L, 3, %L, 1200, %L, '2026-03-05', null, false,
  false)$$, :'old1', :'bca', :'belanja'));
select is(pg_temp.es(:'old1'), '-|4',
  'update_entry bentuk lama pada entri bertrip = ganti-penuh tanpa trip: tanda dilepas (web pra-S15, dicatat di handoff)');
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 4)$$, :'old1'));
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 2)$$, :'old2'));

-- ===== create_entry dengan trip =====
select pg_temp.n_rows() as r0 \gset
select pg_temp.call(tests.n(), pg_temp.ce_sql(:'np', :'bca', 'expense', 12000, :'belanja', '2026-03-13', :'tp',
  false, 'cccccccc-0000-0000-0000-000000000001')) as c1 \gset
select :'c1'::jsonb ->> 'entry_id' as c1_id \gset
select is(pg_temp.es(:'c1_id'::uuid), 'Bali|1', 'create_entry + trip: pengeluaran bertanda trip, versi 1');
select is(tests.owner_val(null, format($$select snapshot ->> 'trip_id' = %L from app.entry_history where entry_id = %L and version = 1$$,
  :'tp', :'c1_id')), 'true', 'snapshot riwayat memuat trip_id');
select is(pg_temp.call(tests.n(), pg_temp.ce_sql(:'np', :'bca', 'expense', 12000, :'belanja', '2026-03-13', :'tp',
    false, 'cccccccc-0000-0000-0000-000000000001')), :'c1'::jsonb || '{"replayed": true}',
  'client_id sama = putar ulang hasil yang sama (tanpa entri kedua)');
select is(pg_temp.err(tests.n(), pg_temp.ce_sql(:'np', :'bca', 'expense', 12000, :'belanja', '2026-03-13', :'tp2',
    false, 'cccccccc-0000-0000-0000-000000000001')), 'DK410:idempotency_key_reused:',
  'client_id sama dengan trip beda = DK410 (hash memuat trip)');
select is(pg_temp.err(tests.n(), pg_temp.ce_sql(:'np', :'bca', 'expense', 12000, :'belanja', '2026-03-13', null,
    false, 'cccccccc-0000-0000-0000-000000000001')), 'DK410:idempotency_key_reused:', 'client_id sama tanpa trip = DK410');
select is(pg_temp.n_rows(), (select (split_part(:'r0', '/', 1)::int + 1) || '/' || (split_part(:'r0', '/', 2)::int + 1) || '/'
    || (split_part(:'r0', '/', 3)::int + 1)), 'satu entri, satu riwayat, satu kunci idempotensi');
select pg_temp.n_rows() as r1 \gset
select is(pg_temp.err(tests.n(), pg_temp.ce_sql(:'np', :'bca', 'expense', 1, null, null, :'tf')), 'DK404:trip_not_found:',
  'trip Pribadi pasangan = DK404 trip_not_found [B25]');
select is(pg_temp.err(tests.n(), pg_temp.ce_sql(:'np', :'bca', 'expense', 1, null, null, gen_random_uuid())), 'DK404:trip_not_found:',
  'trip tidak ada = jawaban sama persis (tanpa orakel) [B25]');
select is(pg_temp.err(tests.n(), pg_temp.ce_sql(:'sh', :'kas', 'expense', 1, null, null, :'tp')), 'DK404:trip_not_found:',
  'trip Pribadi untuk entri Bersama = DK404 (FK komposit satu ruang, K1)');
select is(pg_temp.err(tests.n(), pg_temp.ce_sql(:'np', :'bca', 'expense', 1, null, null, :'ts')), 'DK404:trip_not_found:',
  'trip Bersama untuk entri Pribadi = DK404');
select is(pg_temp.err(tests.n(), pg_temp.ce_sql(:'np', :'bca', 'expense', 1, null, null, :'tarch')), 'DK422:trip_archived:',
  'trip terarsip tidak bisa dipilih baru (K8)');
select is(pg_temp.err(tests.n(), pg_temp.ce_sql(:'np', :'bca', 'income', 1000, null, null, :'tp')), 'DK422:trip_entry_invalid:',
  'pemasukan tidak bisa bertrip (K4), bukan 23514 mentah');
select is(pg_temp.err(tests.n(), pg_temp.ce_sql(:'np', :'bca', 'expense', 1000, null, null, :'tp', true)), 'DK422:trip_entry_invalid:',
  'talangan tidak bisa bertrip (K4)');
select is(pg_temp.err(tests.n(), pg_temp.ce_sql(:'np', :'kan', 'expense', 1000, null, null, :'tp')), 'DK422:trip_entry_invalid:',
  'dompet Kantor tidak bisa bertrip (K4)');
select is(pg_temp.err(tests.x(), pg_temp.ce_sql(:'np', :'bca', 'expense', 1000, null, null, :'tp')), 'DK404:trip_not_found:',
  'Luar: trip tidak terlihat = DK404 [B25]');
select is(pg_temp.err(tests.f(), pg_temp.ce_sql(:'np', :'bca', 'expense', 1000, null, null, :'tp')), 'DK404:trip_not_found:',
  'pasangan atas ruang Pribadi Novanda = DK404 [B25]');
select is(pg_temp.err(tests.n(), pg_temp.ce_sql(:'np', :'bca', 'expense', 0, null, null, :'tp')), 'DK400:invalid_argument:amount',
  'trip valid tidak menutupi validasi lain (nominal 0 tetap ditolak)');
select is(pg_temp.n_rows(), :'r1', 'semua penolakan nol efek');
-- Bersama: anggota kedua menandai.
select pg_temp.exp(tests.f(), :'sh', :'kas', 15000, :'sbelanja', '2026-03-15', :'ts') as sc1 \gset
select is(pg_temp.es(:'sc1'), 'Akhir Pekan|1', 'Farida mencatat pengeluaran Bersama ke trip Bersama (K1)');
select is(pg_temp.err(tests.f(), pg_temp.ce_sql(:'sh', :'kas', 'expense', 1, null, null, :'tsarch')), 'DK422:trip_archived:',
  'trip Bersama terarsip ditolak');
-- Rollback utuh: kegagalan disuntik sesudah riwayat ditulis.
select tests.owner_exec(null, $q$create function private.tes_fail_after() returns trigger
  language plpgsql set search_path = '' as $f$
  begin
    if pg_catalog.current_setting('tests.fail_after', true) = 'trip_entry' then
      raise exception using errcode = 'P0001', message = 'fail_after';
    end if;
    return null;
  end $f$$q$);
select tests.owner_exec(null, 'create trigger tes_fail_after after insert on app.entry_history
  for each row execute function private.tes_fail_after()');
select pg_temp.n_rows() || ' ' || pg_temp.es(:'e1') as before_fail \gset
savepoint gagal;
select set_config('tests.fail_after', 'trip_entry', true);
select is(pg_temp.err(tests.n(), pg_temp.ce_sql(:'np', :'bca', 'expense', 5000, :'belanja', '2026-03-13', :'tp', false,
      'cccccccc-0000-0000-0000-000000000009'))
  || ' ' || pg_temp.err(tests.n(), pg_temp.ue_sql(:'e1', 1, :'bca', 100000, :'belanja', '2026-03-05', :'tp'))
  || ' ' || pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', array[:'e1']::uuid[]))
  || ' ' || pg_temp.err(tests.n(), format($$select api.create_split(gen_random_uuid(), %L, %L, 3000, %L, '2026-03-05', 'x', null,
      false, p_trip_id => %L)$$, :'sh', :'bca', :'sbelanja', :'ts')),
  'P0001:fail_after: P0001:fail_after: P0001:fail_after: P0001:fail_after:', 'kegagalan disuntik sesudah riwayat ditulis, di setiap fungsi tulis');
select is(pg_temp.n_rows() || ' ' || pg_temp.es(:'e1'), :'before_fail', 'rollback utuh: entri, riwayat, kunci idempotensi, versi, dan tanda tidak berubah');
rollback to savepoint gagal;
select set_config('tests.fail_after', '', true);
select is(pg_temp.call(tests.n(), pg_temp.ce_sql(:'np', :'bca', 'expense', 5000, :'belanja', '2026-03-13', :'tp', false,
      'cccccccc-0000-0000-0000-000000000009')) ->> 'replayed', 'false', 'client_id yang kuncinya batal ikut rollback dapat dipakai lagi');
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'c1_id'));

-- ===== update_entry dengan trip (ganti-penuh) =====
select pg_temp.call(tests.n(), pg_temp.ue_sql(:'e1', 1, :'bca', 100000, :'belanja', '2026-03-05', :'tp')) as u1 \gset
select is(:'u1'::jsonb ->> 'version', '2', 'update_entry + trip: versi naik');
select is(pg_temp.es(:'e1'), 'Bali|2', 'pengeluaran biasa ditandai lewat Ubah');
select is(tests.owner_val(null, format($$select snapshot ->> 'trip_id' = %L from app.entry_history where entry_id = %L and version = 2$$,
  :'tp', :'e1')), 'true', 'snapshot versi 2 memuat trip_id');
select pg_temp.call(tests.n(), pg_temp.ue_sql(:'e1', 2, :'bca', 100000, :'belanja', '2026-03-05', :'tp2'));
select is(pg_temp.es(:'e1'), 'Lombok|3', 'ganti trip');
select pg_temp.call(tests.n(), pg_temp.ue_sql(:'e1', 3, :'bca', 100000, :'belanja', '2026-03-05', null));
select is(pg_temp.es(:'e1'), '-|4', 'p_trip_id null = lepas (ganti-penuh)');
select pg_temp.call(tests.n(), pg_temp.ue_sql(:'e1', 4, :'bca', 100000, :'belanja', '2026-03-05', :'tp'));
select pg_temp.op(tests.n(), 'archive_trip', :'tp');
select is(pg_temp.err(tests.n(), pg_temp.ue_sql(:'e1', 5, :'bca', 100001, :'belanja', '2026-03-05', :'tp')), 'ok',
  'trip yang sama pada entri yang sudah ber-trip boleh meski trip terarsip (sunting nominal)');
select is(pg_temp.err(tests.n(), pg_temp.ue_sql(:'e2', 1, :'bca', 50000, :'belanja', '2026-03-13', :'tp')), 'DK422:trip_archived:',
  'memilih trip terarsip pada entri yang belum bertrip ditolak (baru dipilih)');
select is(pg_temp.err(tests.n(), pg_temp.ue_sql(:'e1', 6, :'bca', 100001, :'belanja', '2026-03-05', :'tp2')), 'ok',
  'pindah dari trip terarsip ke trip aktif boleh');
select pg_temp.op(tests.n(), 'restore_trip', :'tp');
select pg_temp.call(tests.n(), pg_temp.ue_sql(:'e1', 7, :'bca', 100000, :'belanja', '2026-03-05', :'tp'));
select is(pg_temp.es(:'e1'), 'Bali|8', 'dipulihkan dan ditandai kembali (versi 8)');
select pg_temp.n_rows() as r2 \gset
select is(pg_temp.err(tests.n(), pg_temp.ue_sql(:'e1', 8, :'bca', 100000, :'belanja', '2026-03-05', :'tp', true)), 'DK422:trip_entry_invalid:',
  'ubah ke talangan dengan trip = trip_entry_invalid (bukan 23514 mentah; temuan review 0146)');
select is(pg_temp.err(tests.n(), pg_temp.ue_sql(:'e1', 8, :'kan', 100000, :'belanja', '2026-03-05', :'tp')), 'DK422:trip_entry_invalid:',
  'ubah ke dompet Kantor dengan trip = trip_entry_invalid');
select is(pg_temp.err(tests.n(), pg_temp.ue_sql(:'e_inc', 1, :'bca', 5000000, null, '2026-03-09', :'tp')), 'DK422:trip_entry_invalid:',
  'pemasukan dengan trip ditolak');
select is(pg_temp.err(tests.n(), pg_temp.ue_sql(:'e1', 8, :'bca', 100000, :'belanja', '2026-03-05', :'tf')), 'DK404:trip_not_found:',
  'trip Pribadi pasangan = DK404 [B25]');
select is(pg_temp.err(tests.n(), pg_temp.ue_sql(:'e1', 8, :'bca', 100000, :'belanja', '2026-03-05', :'ts')), 'DK404:trip_not_found:',
  'trip Bersama untuk entri Pribadi = DK404');
select is(pg_temp.err(tests.n(), pg_temp.ue_sql(:'e1', 8, :'bca', 100000, :'belanja', '2026-03-05', gen_random_uuid())), 'DK404:trip_not_found:',
  'trip tidak ada = DK404 (jawaban sama)');
select is(pg_temp.err(tests.n(), pg_temp.ue_sql(:'e1', 3, :'bca', 100000, :'belanja', '2026-03-05', :'tp2')), 'DK409:version_conflict:',
  'versi basi dengan trip sah = version_conflict tanpa efek');
select is(pg_temp.err(tests.x(), pg_temp.ue_sql(:'e1', 8, :'bca', 100000, :'belanja', '2026-03-05', :'tp')), 'DK404:entry_not_found:',
  'Luar: entri tidak terlihat = entry_not_found (tanpa orakel trip) [B25]');
select is(pg_temp.err(tests.f(), pg_temp.ue_sql(:'e1', 8, :'bca', 100000, :'belanja', '2026-03-05', null)), 'DK404:entry_not_found:',
  'pasangan atas entri Pribadi Novanda = entry_not_found [B25]');
select is(pg_temp.err(tests.n(), pg_temp.ue_sql(gen_random_uuid(), 1, :'bca', 100000, :'belanja', '2026-03-05', :'tp')), 'DK404:entry_not_found:',
  'entri tidak ada dengan trip sah = entry_not_found');
select is(pg_temp.n_rows() || ' ' || pg_temp.es(:'e1'), :'r2' || ' Bali|8', 'semua penolakan nol efek');
select pg_temp.call(tests.n(), pg_temp.ue_sql(:'e1', 8, :'kan', 100000, :'belanja', '2026-03-05', null));
select is(pg_temp.es(:'e1'), '-|9', 'ubah ke dompet Kantor tanpa trip: tanda dilepas, tanpa 23514');
select pg_temp.call(tests.n(), pg_temp.ue_sql(:'e1', 9, :'bca', 100000, :'belanja', '2026-03-05', :'tp'));
select pg_temp.call(tests.n(), pg_temp.ue_sql(:'e1', 10, :'bca', 100000, :'belanja', '2026-03-05', null, true));
select is(pg_temp.es(:'e1'), '-|11', 'ubah ke talangan tanpa trip: tanda dilepas, tanpa 23514');
select pg_temp.call(tests.n(), pg_temp.ue_sql(:'e1', 11, :'bca', 100000, :'belanja', '2026-03-05', null));
-- Idempotensi update.
select pg_temp.call(tests.n(), pg_temp.ue_sql(:'e2', 1, :'bca', 50000, :'belanja', '2026-03-13', :'tp',
  false, 'dddddddd-0000-0000-0000-000000000001')) as u2 \gset
select is(pg_temp.call(tests.n(), pg_temp.ue_sql(:'e2', 1, :'bca', 50000, :'belanja', '2026-03-13', :'tp',
    false, 'dddddddd-0000-0000-0000-000000000001')), :'u2'::jsonb || '{"replayed": true}', 'client_id sama = putar ulang, versi tidak naik dua kali');
select is(pg_temp.es(:'e2'), 'Bali|2', 'putar ulang tidak menulis lagi');
select is(pg_temp.err(tests.n(), pg_temp.ue_sql(:'e2', 1, :'bca', 50000, :'belanja', '2026-03-13', :'tp2',
    false, 'dddddddd-0000-0000-0000-000000000001')), 'DK410:idempotency_key_reused:', 'client_id sama, trip beda = DK410');
-- Bersama: Farida menandai pengeluaran Bersama yang dicatat Novanda (K1).
select pg_temp.call(tests.f(), pg_temp.ue_sql(:'s1', 1, :'kas', 80000, :'sbelanja', '2026-03-14', :'ts'));
select is(pg_temp.es(:'s1'), 'Akhir Pekan|2', 'anggota kedua menandai entri Bersama yang dicatat anggota lain');
select is(pg_temp.err(tests.f(), pg_temp.ue_sql(:'s1', 2, :'kas', 80000, :'sbelanja', '2026-03-14', :'tp')), 'DK404:trip_not_found:',
  'trip Pribadi Novanda untuk entri Bersama oleh Farida = DK404');
-- Entri saldo awal tidak boleh bertrip.
select tests.owner_val(null, format($q$select e.id from app.entries e join app.entry_lines l on l.entry_id = e.id
  where e.kind = 'opening_balance' and l.account_id = %L$q$, :'bca')) as opening \gset
select is(pg_temp.err(tests.n(), format($$select api.update_entry(gen_random_uuid(), %L, 1, %L, 20000000, null, null, null, false,
  false, p_trip_id => %L)$$, :'opening', :'bca', :'tp')), 'DK422:trip_entry_invalid:', 'saldo awal tidak bisa bertrip');

-- ===== create_split dengan trip (K6) =====
savepoint sp1;
select pg_temp.call(tests.n(), format($$select api.create_split(gen_random_uuid(), %L, %L, 60000, %L, '2026-03-16', 'Makan',
  null, false)$$, :'sh', :'bca', :'sbelanja')) as sp_plain \gset
select pg_temp.i6(tests.n(), :'sh') as sh_plain \gset
rollback to savepoint sp1;
select pg_temp.call(tests.n(), format($$select api.create_split(gen_random_uuid(), %L, %L, 60000, %L, '2026-03-16', 'Makan',
  null, false, p_trip_id => %L)$$, :'sh', :'bca', :'sbelanja', :'ts')) as sp1 \gset
select :'sp1'::jsonb ->> 'expense_entry_id' as sp1_exp \gset
select is(pg_temp.es(:'sp1_exp'::uuid), 'Akhir Pekan|1', 'create_split + trip Bersama: pengeluaran patungan bertanda trip (K6)');
select is(pg_temp.i6(tests.n(), :'sh'), :'sh_plain'::text, 'patungan bertrip: angka uang sama persis dengan patungan tanpa trip [I6]');
select is(pg_temp.ov(tests.n(), :'ts'), '155000|3', 'total trip Bersama memuat patungan: 15.000 (sc1) + 80.000 (s1) + 60.000');
select is(pg_temp.err(tests.n(), format($$select api.create_split(gen_random_uuid(), %L, %L, 60000, %L, '2026-03-16', 'Makan',
    null, false, p_trip_id => %L)$$, :'sh', :'bca', :'sbelanja', :'tp')), 'DK404:trip_not_found:', 'trip Pribadi untuk patungan = DK404');
select is(pg_temp.err(tests.n(), format($$select api.create_split(gen_random_uuid(), %L, %L, 60000, %L, '2026-03-16', 'Makan',
    null, false, p_trip_id => %L)$$, :'sh', :'bca', :'sbelanja', :'tsarch')), 'DK422:trip_archived:', 'trip Bersama terarsip untuk patungan ditolak');
select is(pg_temp.err(tests.n(), format($$select api.create_split(gen_random_uuid(), %L, %L, 60000, %L, '2026-03-16', 'Makan',
    null, false, p_trip_id => %L)$$, :'np', :'bca', :'belanja', :'tp')), 'DK422:split_shared_only:',
  'patungan di ruang Pribadi tetap ditolak split_shared_only (trip Pribadi tidak membukanya)');
select is(pg_temp.err(tests.x(), format($$select api.create_split(gen_random_uuid(), %L, %L, 60000, %L, '2026-03-16', 'Makan',
    null, false, p_trip_id => %L)$$, :'sh', :'bca', :'sbelanja', :'ts')), 'DK404:space_not_found:', 'Luar = DK404');
-- Tanda patungan terkunci (K6): split_locked dari penjaga yang ada.
select tests.owner_val(null, format($q$select id from app.accounts where space_id = %L and pocket = 'patungan'$q$, :'sh')) as pat \gset
select is(pg_temp.err(tests.n(), pg_temp.ue_sql(:'sp1_exp'::uuid, 1, :'pat', 60000, :'sbelanja', '2026-03-16', null)),
  'DK422:split_locked:', 'lepas tanda patungan lewat Ubah = split_locked (K6)');
select is(pg_temp.err(tests.n(), pg_temp.st_sql(null, array[:'sp1_exp']::uuid[])), 'DK422:split_locked:',
  'lepas tanda patungan lewat set_entries_trip = split_locked');
select is(pg_temp.err(tests.n(), pg_temp.st_sql(:'ts', array[:'sp1_exp']::uuid[])), 'ok',
  'menandai ke trip yang sama (tanpa perubahan) idempoten, bukan galat');
select is(pg_temp.es(:'sp1_exp'::uuid), 'Akhir Pekan|1', 'tanda patungan utuh');
-- Idempotensi create_split dengan trip.
select pg_temp.call(tests.n(), format($$select api.create_split('eeeeeeee-0000-0000-0000-000000000001', %L, %L, 1000, %L, '2026-03-16',
  'Kopi', null, false, p_trip_id => %L)$$, :'sh', :'bca', :'sbelanja', :'ts')) as sp2 \gset
select is(pg_temp.call(tests.n(), format($$select api.create_split('eeeeeeee-0000-0000-0000-000000000001', %L, %L, 1000, %L, '2026-03-16',
  'Kopi', null, false, p_trip_id => %L)$$, :'sh', :'bca', :'sbelanja', :'ts')), :'sp2'::jsonb || '{"replayed": true}',
  'create_split: client_id sama = putar ulang');
select is(pg_temp.err(tests.n(), format($$select api.create_split('eeeeeeee-0000-0000-0000-000000000001', %L, %L, 1000, %L, '2026-03-16',
  'Kopi', null, false, p_trip_id => null)$$, :'sh', :'bca', :'sbelanja')), 'DK410:idempotency_key_reused:', 'create_split: trip beda = DK410');
select pg_temp.call(tests.n(), format($$select api.void_split(gen_random_uuid(), %L)$$, :'sp2'::jsonb ->> 'split_id'));

-- ===== set_entries_trip =====
select pg_temp.call(tests.n(), pg_temp.st_sql(:'tp', array[:'e3', :'e4']::uuid[], 'ffffffff-0000-0000-0000-000000000001')) as st1 \gset
select is(:'st1'::jsonb - 'replayed', '{"changed": 2}'::jsonb, 'set_entries_trip: dua entri ditandai');
select is(pg_temp.esn(array[:'e3', :'e4']::uuid[]), 'Bali|2,Bali|2', 'versi naik satu, tanda terpasang');
select is(tests.owner_val(null, format($$select count(*) from app.entry_history where entry_id in (%L, %L) and version = 2 and op = 'update'
  and snapshot ->> 'trip_id' = %L and changed_by = %L$$, :'e3', :'e4', :'tp', tests.n())), '2', 'riwayat versi 2 (update, trip_id, pencatat) untuk tiap entri');
select is(tests.owner_val(null, format($$select count(*) from app.entries where id in (%L, %L) and updated_by = %L and updated_at = app.now()$$,
  :'e3', :'e4', tests.n())), '2', 'updated_by dari sesi, updated_at dari jam DB');
select is(pg_temp.call(tests.n(), pg_temp.st_sql(:'tp', array[:'e3', :'e4']::uuid[], 'ffffffff-0000-0000-0000-000000000001')),
  :'st1'::jsonb || '{"replayed": true}', 'client_id sama = putar ulang');
select is(pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', array[:'e3']::uuid[], 'ffffffff-0000-0000-0000-000000000001')), 'DK410:idempotency_key_reused:',
  'client_id sama, isi beda = DK410');
select is(pg_temp.call(tests.n(), pg_temp.st_sql(:'tp', array[:'e4', :'e3']::uuid[])) ->> 'changed', '0',
  'sudah bertrip yang sama (urutan id beda, client_id baru) = idempoten alami: changed 0, versi tetap');
select is(pg_temp.esn(array[:'e3', :'e4']::uuid[]), 'Bali|2,Bali|2', 'tanpa perubahan: versi tidak naik');
select is(pg_temp.call(tests.n(), pg_temp.st_sql(:'tp', array[:'e2', :'e3', :'e4']::uuid[])) ->> 'changed', '0',
  'e2 sudah di trip Bali dari Ubah: changed 0');
select is(pg_temp.call(tests.n(), pg_temp.st_sql(:'tp2', array[:'e3', :'e1']::uuid[])) ->> 'changed', '2',
  'ganti trip dan tandai baru sekaligus: changed 2');
select is(pg_temp.esn(array[:'e3', :'e1']::uuid[]), 'Lombok|3,Lombok|13', 'ganti trip menaikkan versi');
select is(pg_temp.call(tests.n(), pg_temp.st_sql(null, array[:'e1', :'e2', :'e3', :'e4']::uuid[])) ->> 'changed', '4',
  'null = lepas: keempat entri bertrip dilepas');
select is(pg_temp.call(tests.n(), pg_temp.st_sql(null, array[:'e1', :'e2']::uuid[])) ->> 'changed', '0', 'melepas yang tidak bertrip = changed 0');
select is(pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', array[]::uuid[])) || ' ' || pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', null))
  || ' ' || pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', array[:'e3', :'e3']::uuid[]))
  || ' ' || pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', array[:'e3', null]::uuid[])),
  'DK400:invalid_argument:entry_ids DK400:invalid_argument:entry_ids DK400:invalid_argument:entry_ids DK400:invalid_argument:entry_ids',
  'larik kosong, null, duplikat, elemen null = invalid_argument/entry_ids');
select is(pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', (select array_agg(gen_random_uuid()) from generate_series(1, 101)))),
  'DK400:invalid_argument:entry_ids', '101 id ditolak');
select pg_temp.n_rows() || ' ' || pg_temp.esn(array[:'e3', :'e4']::uuid[]) as r4 \gset
-- Atomik: satu tidak layak = seluruh panggilan gagal, tanpa efek.
select is(pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', array[:'e3', :'e_inc']::uuid[])), 'DK422:trip_entry_invalid:', 'pemasukan di antara yang sah');
select is(pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', array[:'e3', :'e_kan']::uuid[])), 'DK422:trip_entry_invalid:', 'Kantor di antara yang sah');
select is(pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', array[:'e3', :'e_tal']::uuid[])), 'DK422:trip_entry_invalid:', 'talangan di antara yang sah');
select is(pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', array[:'e3', :'e_xfer']::uuid[])), 'DK422:trip_entry_invalid:', 'transfer di antara yang sah');
select is(pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', array[:'e3', :'e_batal']::uuid[])), 'DK422:entry_voided:', 'entri batal di antara yang sah');
select is(pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', array[:'e3', :'s1']::uuid[])), 'DK422:space_mismatch:', 'entri ruang lain (Bersama) untuk trip Pribadi');
select is(pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', array[:'e3', :'f1']::uuid[])), 'DK404:entry_not_found:',
  'entri Pribadi pasangan = entry_not_found [B25]');
select is(pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', array[:'e3', gen_random_uuid()]::uuid[])), 'DK404:entry_not_found:',
  'id tidak ada = jawaban sama persis (tanpa orakel) [B25]');
select is(pg_temp.err(tests.n(), pg_temp.st_sql(:'tarch', array[:'e3']::uuid[])), 'DK422:trip_archived:', 'trip terarsip ditolak');
select is(pg_temp.err(tests.n(), pg_temp.st_sql(:'tf', array[:'e3']::uuid[])) || ' ' || pg_temp.err(tests.n(), pg_temp.st_sql(gen_random_uuid(), array[:'e3']::uuid[]))
  || ' ' || pg_temp.err(tests.n(), pg_temp.st_sql(:'ts', array[:'e3']::uuid[])), 'DK404:trip_not_found: DK404:trip_not_found: DK422:space_mismatch:',
  'trip pasangan dan tidak ada = DK404 seragam; trip Bersama terlihat tapi entri Pribadi = space_mismatch');
select is(pg_temp.err(tests.x(), pg_temp.st_sql(:'tp', array[:'e3']::uuid[])) || ' ' || pg_temp.err(tests.x(), pg_temp.st_sql(null, array[:'e3']::uuid[]))
  || ' ' || pg_temp.err(null, pg_temp.st_sql(:'tp', array[:'e3']::uuid[])), 'DK404:trip_not_found: DK404:entry_not_found: DK401:unauthenticated:',
  'Luar: trip tidak ada, entri tidak ada; tanpa pengguna DK401');
select is(pg_temp.n_rows() || ' ' || pg_temp.esn(array[:'e3', :'e4']::uuid[]), :'r4', 'semua penolakan atomik: nol efek');
-- Lepas dari trip terarsip diperbolehkan.
select pg_temp.call(tests.n(), pg_temp.st_sql(:'tp', array[:'e3']::uuid[]));
select pg_temp.op(tests.n(), 'archive_trip', :'tp');
select is(pg_temp.call(tests.n(), pg_temp.st_sql(null, array[:'e3']::uuid[])) ->> 'changed', '1', 'lepas dari trip terarsip boleh');
select pg_temp.op(tests.n(), 'restore_trip', :'tp');
-- Bersama.
select is(pg_temp.call(tests.f(), pg_temp.st_sql(:'ts', array[:'s2', :'s3']::uuid[])) ->> 'changed', '2', 'Farida menandai dua pengeluaran Bersama (K1)');
select is(pg_temp.call(tests.n(), pg_temp.st_sql(:'ts', array[:'s2']::uuid[])) ->> 'changed', '0', 'Novanda: sudah bertrip yang sama, changed 0');
select is(pg_temp.err(tests.f(), pg_temp.st_sql(:'tp', array[:'s2']::uuid[])), 'DK404:trip_not_found:', 'Farida atas trip Pribadi Novanda = DK404 [B25]');
select is(pg_temp.err(tests.f(), pg_temp.st_sql(:'ts', array[:'e3']::uuid[])), 'DK404:entry_not_found:', 'Farida atas entri Pribadi Novanda = entry_not_found [B25]');
select is(pg_temp.err(tests.f(), pg_temp.st_sql(:'tsarch', array[:'s1']::uuid[])), 'DK422:trip_archived:', 'trip Bersama terarsip ditolak');
-- Kegagalan di tengah: semua entri kembali.
select pg_temp.esn(array[:'e3', :'e4']::uuid[]) || ' ' || pg_temp.n_rows() as before_fail2 \gset
savepoint gagal2;
select set_config('tests.fail_after', 'trip_entry', true);
select is(pg_temp.err(tests.n(), pg_temp.st_sql(:'tp', array[:'e3', :'e4']::uuid[])), 'P0001:fail_after:', 'kegagalan disuntik sesudah entri diubah');
select is(pg_temp.esn(array[:'e3', :'e4']::uuid[]) || ' ' || pg_temp.n_rows(), :'before_fail2', 'rollback utuh: tidak ada entri yang tertandai separuh');
rollback to savepoint gagal2;
select set_config('tests.fail_after', '', true);

-- ===== I6 dan total trip = Laporan =====
select pg_temp.ct(tests.n(), :'np', 'Semua Maret', '2026-03-01', '2026-03-31') as tall \gset
select pg_temp.eligible(:'np') as all_ids \gset
select pg_temp.eligible(:'sh') as all_sh \gset
select pg_temp.i6(tests.n(), :'np') as np_i6 \gset
select pg_temp.i6(tests.n(), :'sh') as sh_i6 \gset
select pg_temp.call(tests.n(), pg_temp.st_sql(:'tall', :'all_ids'::uuid[])) ->> 'changed' as n_all \gset
select ok((:'n_all')::int >= 5, 'semua pengeluaran biasa Maret (Pribadi) ditandai sekaligus');
select pg_temp.call(tests.f(), pg_temp.st_sql(:'ts', :'all_sh'::uuid[]));
select is(pg_temp.i6(tests.n(), :'np'), :'np_i6'::text, 'menandai ke trip: period_summary, month_summary, kategori, anggaran, saldo, aman dipakai, net_worth sama persis [I6]');
select is(pg_temp.i6(tests.n(), :'sh'), :'sh_i6'::text, 'sama untuk ruang Bersama [I6]');
select is(tests.web_val(tests.n(), format($$select (select spent from api.trip_overview(%L)) = (select outflow
    from api.period_summary(%L, '2026-03-01', '2026-03-31') where report_class = 'expense')$$, :'tall', :'np')), 'true',
  'total trip = pengeluaran Laporan untuk pengeluaran yang sama (Kantor, talangan, biaya transfer, entri batal tidak ikut)');
select pg_temp.op(tests.n(), 'archive_trip', :'tall');
select is(pg_temp.i6(tests.n(), :'np'), :'np_i6'::text, 'mengarsipkan trip berisi entri tidak mengubah angka uang [I6]');
select pg_temp.call(tests.n(), pg_temp.st_sql(null, :'all_ids'::uuid[]));
select is(pg_temp.i6(tests.n(), :'np'), :'np_i6'::text, 'melepas semua tanda (dari trip terarsip) tidak mengubah angka uang [I6]');
select is(pg_temp.i6(tests.f(), :'fp'), :'fp_0'::text, 'Pribadi Farida tidak tersentuh [I6] [B25]');
-- 100 entri sekaligus.
select array_agg(pg_temp.exp(tests.n(), :'np', :'bca', 100 + g, :'belanja', '2026-03-10')) as many
  from generate_series(1, 100) g \gset
select pg_temp.i6(tests.n(), :'np') as np_many_0 \gset
select is(pg_temp.call(tests.n(), pg_temp.st_sql(:'tp', :'many'::uuid[])) ->> 'changed', '100', '100 entri ditandai sekaligus (batas atas)');
select is(pg_temp.i6(tests.n(), :'np'), :'np_many_0'::text, '100 entri ditandai: angka uang sama persis [I6]');
select is(pg_temp.call(tests.n(), pg_temp.st_sql(null, :'many'::uuid[])) ->> 'changed', '100', '100 entri dilepas sekaligus');
select is(pg_temp.i6(tests.n(), :'np'), :'np_many_0'::text, '100 entri dilepas: angka uang sama persis [I6]');

-- ===== Ekspor: kolom trip (K11) =====
select pg_temp.csv(tests.n(), :'np') as csv_plain \gset
select pg_temp.call(tests.n(), pg_temp.st_sql(:'tp', array[:'e1', :'e2']::uuid[]));
select is(replace(pg_temp.csv(tests.n(), :'np'), '|Bali', '|-'), :'csv_plain'::text,
  'kolom trip hanya mengisi baris bertrip; jumlah baris, urutan, dan semua kolom lain tidak berubah (Σ nominal = Laporan, I6)');
select is(tests.web_val(tests.n(), format($$select count(*) from api.export_entries(%L, '2026-03-01', '2026-03-31') where trip = 'Bali'$$, :'np')), '2',
  'dua baris bertanda Bali');
select ok(tests.web_val(tests.n(), format($$select count(*) from api.export_entries(%L, '2026-03-01', '2026-03-31') where trip is null$$, :'np'))::int > 0,
  'baris tanpa trip: kolom trip kosong (null)');
select ok(position('Bali' in pg_temp.csv(tests.f(), :'fp')) = 0 and position('Akhir' in pg_temp.csv(tests.f(), :'fp')) = 0,
  'ekspor Pribadi pasangan tidak membocorkan nama trip ruang lain');
select ok(position('Akhir Pekan' in pg_temp.csv(tests.n(), :'sh')) > 0 and position('Bali' in pg_temp.csv(tests.n(), :'sh')) = 0,
  'ekspor Bersama memuat trip Bersama saja');
select is(tests.web_val(tests.n(), format($$select (select sum(amount) from api.export_entries(%L, '2026-03-01', '2026-03-31') where report_class = 'expense')
  = -(select outflow from api.period_summary(%L, '2026-03-01', '2026-03-31') where report_class = 'expense')$$, :'np', :'np')), 'true',
  'Σ nominal ekspor kelas expense = Laporan');
select pg_temp.call(tests.n(), pg_temp.st_sql(null, array[:'e1', :'e2']::uuid[]));

-- ===== Pindah ruang tidak membawa tanda (K15) =====
select pg_temp.call(tests.n(), pg_temp.st_sql(:'tp', array[:'e3']::uuid[]));
select split_part(pg_temp.es(:'e3'), '|', 2) as e3_ver \gset
select pg_temp.call(tests.n(), format($$select api.move_entry_to_space(gen_random_uuid(), %L, %s, %L, %L, %L)$$,
  :'e3', :'e3_ver', :'sh', :'kas', :'sbelanja')) ->> 'entry_id' as moved \gset
select is(pg_temp.es(:'moved'::uuid), '-|1', 'entri baru di ruang tujuan tanpa trip (K15)');
select is(tests.owner_val(null, format($$select (trip_id = %L) and voided_at is not null and moved_at is not null from app.entries where id = %L$$,
  :'tp', :'e3')), 'true', 'baris lama (batal, dipindah) tetap bertag trip asalnya');
select is(pg_temp.ov(tests.n(), :'tp'), '0|0', 'entri yang dipindah tidak lagi dihitung di trip (batal)');

-- ===== Feed Aktivitas Bersama: filter K16 =====
select pg_temp.exp(tests.n(), :'sh', :'kas', 33000, :'sbelanja', '2026-03-17') as fa \gset
select pg_temp.call(tests.n(), pg_temp.ue_sql(:'fa', 1, :'kas', 34000, :'sbelanja', '2026-03-17', null));
select pg_temp.call(tests.f(), pg_temp.st_sql(:'ts', array[:'fa']::uuid[]));
select pg_temp.call(tests.n(), pg_temp.ue_sql(:'fa', 3, :'kas', 34000, :'sbelanja', '2026-03-17', null));
select is(pg_temp.es(:'fa'), '-|4', 'fa: dilepas lewat Ubah (versi 4, hanya trip berubah)');
select pg_temp.call(tests.n(), pg_temp.ue_sql(:'fa', 4, :'kas', 35000, :'sbelanja', '2026-03-17', :'ts'));
select pg_temp.call(tests.n(), pg_temp.st_sql(null, array[:'fa']::uuid[]));
select is(tests.web_val(tests.f(), format($$select string_agg(version::text, ',' order by version) from api.shared_activity(%L, 100)
    where entry_id = %L$$, :'sh', :'fa')), '1,2,5',
  'feed: create (1), ubah nominal (2), ubah nominal + trip sekaligus (5) tampil; ubah yang hanya trip (3, 4, 6) disaring (K16)');
select is(tests.web_val(tests.f(), format($$select before_amount || '>' || amount from api.shared_activity(%L, 100) where entry_id = %L and version = 5$$,
  :'sh', :'fa')), '34000>35000', 'before_amount baris 5 dihitung dari versi sebelumnya (34.000), bukan dari baris yang disaring');
select is(tests.web_val(tests.f(), format($$select count(*) from api.shared_activity(%L, 100) where entry_id in (%L, %L, %L)$$, :'sh', :'s1', :'s2', :'s3')),
  '3', 'entri Bersama yang hanya ditandai (Ubah atau set_entries_trip) hanya menampilkan baris create');
select is(tests.web_val(tests.f(), format($$select count(*) from api.shared_activity(%L, 100) where entry_id = %L$$, :'sh', :'sp1_exp')), '1',
  'pengeluaran patungan bertrip: satu baris create');
select pg_temp.exp(tests.n(), :'sh', :'kas', 1000, null, '2026-03-18') as fb \gset
select pg_temp.call(tests.n(), pg_temp.st_sql(:'ts', array[:'fb']::uuid[]));
-- Kursor tetap benar: filter dikenakan SEBELUM batas halaman, halaman berikutnya tanpa duplikat dan tanpa lubang [B20].
select is(tests.web_val(tests.f(), format($$with p1 as (select * from api.shared_activity(%1$L, 3)),
      last as (select * from p1 order by at, entry_id, version limit 1),
      p2 as (select a.* from last, api.shared_activity(%1$L, 3, last.at, last.entry_id, last.version) a),
      allr as (select * from api.shared_activity(%1$L, 100))
    select (select count(*) from p1) || '/' || (select count(*) from p2) || '/' ||
      ((select count(*) from p1 p join p2 q using (entry_id, version)) = 0) || '/' ||
      ((select string_agg(entry_id || ':' || version, ',' order by at desc, entry_id desc, version desc)
          from (select * from p1 union all select * from p2) u) =
       (select string_agg(entry_id || ':' || version, ',' order by at desc, entry_id desc, version desc)
          from (select * from allr order by at desc, entry_id desc, version desc limit 6) z))$$, :'sh')),
  '3/3/true/true', 'kursor: dua halaman berurutan = enam baris teratas feed, tanpa duplikat dan lubang');
select ok(tests.owner_val(null, $q$select count(*) from app.entry_history where snapshot ->> 'trip_id' is not null$q$)::int > 0,
  'riwayat tetap utuh: baris yang disaring dari feed tetap ada di entry_history');

-- ===== Purge dan akhir =====
select pg_temp.exp(tests.n(), :'np', :'bca', 4000, :'belanja', '2026-03-14', :'tp') as px \gset
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'px'));
select tests.raw_exec(format($$update app.entries set voided_at = now() - interval '91 days' where id = %L$$, :'px'));
select ok(tests.worker_val(null, 'select jobs.purge_voided()')::int >= 1, 'purge_voided menghapus entri batal bertrip > 90 hari');
select is(tests.owner_val(null, format($$select (select count(*) from app.entries where id = %L) || '/' || (select count(*) from app.trips where id = %L)$$,
  :'px', :'tp')), '0/1', 'entri bertrip terhapus (riwayat ikut), trip tidak tersentuh (FK dari entri ke trip)');
select is(tests.owner_val(null, 'select private.own_api_functions()'), '0', 'semua fungsi api DEFINER sudah milik dompetku_api');
select is(tests.worker_val(null, $q$select violations from jobs.dq_reconcile() where check_id = 'DQ20'$q$), '0', 'DQ20 nol di akhir');

select * from finish();
rollback;
