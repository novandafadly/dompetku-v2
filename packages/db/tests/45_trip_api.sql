-- Trip S15 sisi API (0147; plan S15 Task 3, K1, K5, K7, K8; bingkai S15-TR2 sampai TR13): api.create_trip
-- (idempoten client_id, validasi per kolom, 23505 trips_name_unique diteruskan untuk name_taken), api.update_trip
-- (ganti-penuh; trip terarsip = trip_archived; isi sama = tanpa efek), api.archive_trip, api.restore_trip (nama
-- aktif bentrok = 23505), api.list_trips, api.trip_overview (elapsed_days, per_day atas hari berjalan, budget_left,
-- pct, fase WIB), api.trip_breakdown (category/day/member), api.trip_candidates (pengeluaran tanpa trip dalam
-- rentang). Setiap fungsi: sukses, validasi gagal (nol efek), rollback utuh (kegagalan disuntik), idempotensi,
-- bukan anggota (DK404 seragam tanpa orakel nama). K1: anggota Bersama kedua menulis; Luar dan pasangan tidak.
-- Total trip = Laporan untuk pengeluaran yang sama (Kantor, talangan, biaya transfer, pemasukan, entri batal
-- tidak ikut), numeric dibatasi sebelum cast bigint, I6: angka uang tidak berubah oleh trip. Penanda entri lewat
-- SQL langsung sebagai dompetku_api (api penanda = 0148). Paralel di 99_konkurensi. Jam dipatok 2026-03-20 WIB.
-- Tanpa urutan uuid/created_at identik dan tanpa locale (COLLATE "C").
-- ID: B25, I6, B1
begin;
select plan(171);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 20000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Celengan', 'tabungan', 1000000, '2026-01-01') as tab,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 1000000, '2026-01-01') as kan,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 10000000, '2026-01-01') as kas,
       tests.account(tests.f(), :'fp', 'BNI Farida', 'operasional', 5000000, '2026-01-01') as fbni \gset
-- Luar = akun terautentikasi tanpa profil dan tanpa ruang (disuntik: batas 2 pengguna berprofil sudah penuh).
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
-- Galat persis: sqlstate:pesan:detail (membuktikan tanpa nominal dan nama); 'ok' bila berhasil.
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
create function pg_temp.ct_sql(p_space uuid, p_name text, p_from date, p_to date, p_budget bigint default null,
  p_client uuid default null) returns text
language sql as $$
  select format($q$select api.create_trip(%L, %L, %L, %L::date, %L::date, %L::bigint)$q$,
    coalesce(p_client, gen_random_uuid()), p_space, p_name, p_from, p_to, p_budget)
$$;
create function pg_temp.ct(p_uid uuid, p_space uuid, p_name text, p_from date, p_to date, p_budget bigint default null)
returns uuid
language sql as $$ select (pg_temp.call(p_uid, pg_temp.ct_sql(p_space, p_name, p_from, p_to, p_budget)) ->> 'trip_id')::uuid $$;
create function pg_temp.ut_sql(p_trip uuid, p_name text, p_from date, p_to date, p_budget bigint default null) returns text
language sql as $$
  select format($q$select api.update_trip(%L, %L, %L::date, %L::date, %L::bigint)$q$, p_trip, p_name, p_from, p_to, p_budget)
$$;
create function pg_temp.op_sql(p_fn text, p_id uuid) returns text
language sql as $$ select format($q$select api.%s(%L)$q$, p_fn, p_id) $$;
create function pg_temp.op(p_uid uuid, p_fn text, p_id uuid) returns jsonb
language sql as $$ select pg_temp.call(p_uid, pg_temp.op_sql(p_fn, p_id)) $$;
-- Keadaan trip (owner): nama|mulai|selesai|anggaran|arsip?|pembuat|pengubah|ruang.
create function pg_temp.t(p_trip uuid) returns text
language sql as $$
  select tests.owner_val(null, format($q$select name || '|' || starts_on || '|' || ends_on || '|'
      || coalesce(budget_amount::text, '-') || '|' || (archived_at is not null) || '|'
      || case created_by when %1$L then 'N' when %2$L then 'F' end || '|'
      || case updated_by when %1$L then 'N' when %2$L then 'F' end || '|' || space_kind
    from app.trips where id = %3$L$q$, tests.n(), tests.f(), p_trip))
$$;
create function pg_temp.n_trips() returns text
language sql as $$
  select tests.owner_val(null, $q$select (select count(*) from app.trips) || '/' || (select count(*) from app.idempotency_keys)$q$)
$$;
-- Penanda entri ke trip sebagai dompetku_api (RLS + FK + CHECK); api penanda = 0148.
create function pg_temp.tag(p_uid uuid, p_entry uuid, p_trip uuid) returns bigint
language sql as $$
  select tests.api_exec(p_uid, format($q$update app.entries set trip_id = %L::uuid where id = %L$q$, p_trip, p_entry))
$$;
create function pg_temp.exp(p_uid uuid, p_space uuid, p_acc uuid, p_amount bigint, p_cat uuid, p_on date,
  p_reimb boolean default false) returns uuid
language sql as $$
  select (pg_temp.call(p_uid, format($q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', %s, %L,
      %L::date, null, %L)$q$, p_space, p_acc, p_amount, p_cat, p_on, p_reimb)) ->> 'entry_id')::uuid
$$;
-- Argumen identitas (p_args) atau kolom hasil fungsi api.* (katalog; dompetku_test tanpa USAGE skema api).
create function pg_temp.fn(p_name text, p_args boolean) returns text
language sql as $$
  select case when p_args then pg_get_function_identity_arguments(p.oid) else pg_get_function_result(p.oid) end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname = p_name
$$;
-- Ringkasan satu baris trip_overview sebagai teks (dibaca p_uid).
create function pg_temp.ov(p_uid uuid, p_trip uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select phase || '|' || day_count || '|' || elapsed_days || '|' || spent || '|'
      || entry_count || '|' || coalesce(per_day::text, '-') || '|' || coalesce(budget_left::text, '-') || '|'
      || coalesce(pct::text, '-') || '|' || coalesce(first_entry_on::text, '-') || '|'
      || coalesce(last_entry_on::text, '-') from api.trip_overview(%L)$q$, p_trip))
$$;
-- Rincian trip sebagai teks per dimensi: dim:kunci:label:jumlah:banyak (urutan fungsi).
create function pg_temp.bd(p_uid uuid, p_trip uuid, p_dim text) returns text
language sql as $$
  select coalesce(tests.web_val(p_uid, format($q$select string_agg(key || ':' || coalesce(label, '-') || ':' || amount || ':'
      || entry_count, ',') from api.trip_breakdown(%L) where dim = %L$q$, p_trip, p_dim)), '')
$$;
-- Sidik jari angka uang ruang (I6): period_summary Maret semua kelas, month_summary, ringkasan kategori, anggaran,
-- saldo dompet, aman dipakai, kekayaan bersih (net_worth dan app.net_worth_at).
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

-- ===== Data awal: entri sebelum ada trip =====
select tests.web_val(tests.n(), format($$select api.set_budget(%L, %L, '2026-03-01', 500000, false)$$, :'np', :'belanja'));
select pg_temp.call(tests.n(), format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Belanja Bulanan', null, %L)$$,
  :'np', :'belanja')) ->> 'category_id' as belanja_sub \gset
select pg_temp.exp(tests.n(), :'np', :'bca', 100000, :'belanja', '2026-03-05') as e1 \gset
select pg_temp.exp(tests.n(), :'np', :'bca', 50000, :'belanja_sub', '2026-03-13') as e2 \gset
select pg_temp.exp(tests.n(), :'np', :'bca', 25000, :'transp', '2026-03-13') as e3 \gset
select pg_temp.exp(tests.n(), :'np', :'bca', 30000, :'belanja', '2026-03-20') as e4 \gset
select pg_temp.exp(tests.n(), :'np', :'kan', 30000, :'belanja', '2026-03-14') as e_kan \gset
select pg_temp.exp(tests.n(), :'np', :'bca', 70000, :'belanja', '2026-03-15', true) as e_tal \gset
select (pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'income', 5000000, null,
  '2026-03-09', null)$$, :'np', :'bca')) ->> 'entry_id')::uuid as e_inc \gset
select (pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 200000, 2500,
  '2026-03-14')$$, :'np', :'bca', :'tab')) ->> 'entry_id')::uuid as e_xfer \gset
select pg_temp.exp(tests.n(), :'np', :'bca', 7000, :'belanja', '2026-03-16') as e_batal \gset
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'e_batal'));
select pg_temp.exp(tests.n(), :'sh', :'kas', 80000, :'sbelanja', '2026-03-14') as s1 \gset
select pg_temp.exp(tests.f(), :'sh', :'kas', 20000, :'sbelanja', '2026-03-15') as s2 \gset
select pg_temp.exp(tests.f(), :'fp', :'fbni', 40000, (select id from app.categories where space_id = :'fp' and name = 'Belanja'),
  '2026-03-14') as f1 \gset
select pg_temp.i6(tests.n(), :'np') as np_0, pg_temp.i6(tests.n(), :'sh') as sh_0, pg_temp.i6(tests.f(), :'fp') as fp_0 \gset

-- ===== Kontrak fungsi =====
select is(pg_temp.fn('create_trip', true),
  'p_client_id uuid, p_space_id uuid, p_name text, p_starts_on date, p_ends_on date, p_budget_amount bigint DEFAULT NULL::bigint',
  'tanda tangan api.create_trip');
select is(pg_temp.fn('update_trip', true),
  'p_trip_id uuid, p_name text, p_starts_on date, p_ends_on date, p_budget_amount bigint',
  'tanda tangan api.update_trip: ganti-penuh, tanpa ruang');
select is(pg_temp.fn('list_trips', false),
  'TABLE(trip_id uuid, name text, starts_on date, ends_on date, budget_amount bigint, archived_at timestamp with time zone, '
  || 'day_count integer, spent bigint, entry_count integer, budget_left bigint, phase text)', 'kolom api.list_trips');
select is(pg_temp.fn('trip_overview', false),
  'TABLE(trip_id uuid, space_id uuid, name text, starts_on date, ends_on date, budget_amount bigint, '
  || 'archived_at timestamp with time zone, phase text, day_count integer, elapsed_days integer, spent bigint, '
  || 'entry_count integer, per_day bigint, budget_left bigint, pct bigint, first_entry_on date, last_entry_on date)',
  'kolom api.trip_overview');
select is(pg_temp.fn('trip_breakdown', false),
  'TABLE(dim text, key text, label text, amount bigint, entry_count integer)', 'kolom api.trip_breakdown');
select is(pg_temp.fn('trip_candidates', true), 'p_trip_id uuid, p_limit integer DEFAULT 100', 'tanda tangan api.trip_candidates');
select is(pg_temp.fn('trip_candidates', false),
  'TABLE(entry_id uuid, occurred_on date, description text, category_name text, account_name text, amount bigint)',
  'kolom api.trip_candidates');
select is(tests.owner_val(null, $q$select prorows::text from pg_proc where oid = 'api.trip_overview(uuid)'::regprocedure$q$), '1',
  'trip_overview ROWS 1 (fungsi satu baris yang bisa di-join)');

-- ===== create_trip =====
select pg_temp.n_trips() as n_0 \gset
select pg_temp.call(tests.n(), pg_temp.ct_sql(:'np', '  Bali  ', '2026-03-12', '2026-03-19', 1000000,
  'aaaaaaaa-0000-0000-0000-000000000001')) as r1 \gset
select is((:'r1')::jsonb - 'trip_id', '{"status": "active", "replayed": false}'::jsonb, 'create_trip: hasil');
select :'r1'::jsonb ->> 'trip_id' as t1 \gset
select is(pg_temp.t(:'t1'), 'Bali|2026-03-12|2026-03-19|1000000|false|N|N|personal', 'create_trip: nama di-trim, pembuat tercatat');
select is(tests.owner_val(null, format($$select (created_at = app.now()) || '/' || (updated_at = app.now()) from app.trips where id = %L$$, :'t1')),
  'true/true', 'cap waktu dari jam DB (app.now)');
select is(pg_temp.call(tests.n(), pg_temp.ct_sql(:'np', 'Bali', '2026-03-12', '2026-03-19', 1000000,
    'aaaaaaaa-0000-0000-0000-000000000001')), (:'r1')::jsonb || '{"replayed": true}',
  'client_id sama (nama sama sesudah trim) = putar ulang, trip sama [B25]');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', 'Bali', '2026-03-12', '2026-03-19', 2000000,
    'aaaaaaaa-0000-0000-0000-000000000001')), 'DK410:idempotency_key_reused:', 'client_id sama, isi beda = DK410');
select is(pg_temp.n_trips(), (select (split_part(:'n_0', '/', 1)::int + 1) || '/' || (split_part(:'n_0', '/', 2)::int + 1)),
  'satu trip dan satu kunci; putar ulang tidak menulis');
select pg_temp.n_trips() as n1 \gset
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', '   ', '2026-03-01', '2026-03-02')), 'DK400:invalid_argument:name', 'nama kosong');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', repeat('a', 61), '2026-03-01', '2026-03-02')), 'DK400:invalid_argument:name',
  'nama > 60');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', 'X', null, '2026-03-02')), 'DK400:invalid_argument:starts_on', 'mulai kosong');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', 'X', '1999-12-31', '2000-01-02')), 'DK400:invalid_argument:starts_on',
  'mulai sebelum 2000-01-01');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', 'X', '2026-03-01', null)), 'DK400:invalid_argument:ends_on', 'selesai kosong');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', 'X', '2026-03-05', '2026-03-04')), 'DK400:invalid_argument:ends_on',
  'selesai sebelum mulai');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', 'X', '2026-01-01', '2027-01-02')), 'DK400:invalid_argument:ends_on',
  'rentang 367 hari ditolak (K5)');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', 'X', '2100-12-31', '2101-01-01')), 'DK400:invalid_argument:ends_on',
  'selesai sesudah 2100-12-31');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', 'X', '2026-03-01', '2026-03-02', 0)), 'DK400:invalid_argument:budget_amount',
  'anggaran 0');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', 'X', '2026-03-01', '2026-03-02', -5)), 'DK400:invalid_argument:budget_amount',
  'anggaran negatif');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', 'X', '2026-03-01', '2026-03-02', 10000000000001)),
  'DK400:invalid_argument:budget_amount', 'anggaran > 10^13');
select is(pg_temp.err(tests.n(), format($$select api.create_trip(null, %L, 'X', '2026-03-01', '2026-03-02')$$, :'np')),
  'DK400:invalid_argument:client_id', 'client_id kosong');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'fp', 'X', '2026-03-01', '2026-03-02')), 'DK404:space_not_found:',
  'ruang Pribadi pasangan = DK404 [B25]');
select is(pg_temp.err(tests.x(), pg_temp.ct_sql(:'sh', 'X', '2026-03-01', '2026-03-02')), 'DK404:space_not_found:', 'Luar = DK404');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(null, 'X', '2026-03-01', '2026-03-02')), 'DK404:space_not_found:', 'ruang kosong = DK404');
select is(pg_temp.err(null, pg_temp.ct_sql(:'np', 'X', '2026-03-01', '2026-03-02')), 'DK401:unauthenticated:', 'tanpa pengguna = DK401');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', 'bali', '2026-04-01', '2026-04-03')),
  '23505:duplicate key value violates unique constraint "trips_name_unique":'
  || (select 'Key (space_id, lower(btrim(name::text)))=(' || :'np' || ', bali) already exists.'),
  'nama aktif sama (beda huruf) = 23505 trips_name_unique, dipetakan server ke name_taken');
select is(pg_temp.n_trips(), :'n1', 'semua penolakan nol efek (trip dan kunci idempotensi, termasuk 23505)');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', 'Bali 2', '2026-04-01', '2026-04-03', null,
    'aaaaaaaa-0000-0000-0000-000000000002')), 'ok', 'client_id yang kuncinya batal ikut rollback dapat dipakai lagi');
select pg_temp.ct(tests.n(), :'np', repeat('b', 60), '2026-03-01', '2026-03-01') as t60 \gset
select is(pg_temp.t(:'t60'), repeat('b', 60) || '|2026-03-01|2026-03-01|-|false|N|N|personal',
  'nama 60 huruf dan rentang satu hari diterima, anggaran opsional (null)');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', 'Setahun', '2026-01-01', '2027-01-01', 10000000000000)), 'ok',
  'rentang 366 hari dan anggaran 10^13 diterima');
select pg_temp.ct(tests.n(), :'np', 'Batas', '2100-12-30', '2100-12-31') as tb \gset
select is(pg_temp.t(:'tb'), 'Batas|2100-12-30|2100-12-31|-|false|N|N|personal', 'tanggal di batas 2100-12-31 diterima');
-- K1: Bersama, semua anggota menulis.
select pg_temp.ct(tests.f(), :'sh', 'Akhir Pekan', '2026-03-14', '2026-03-16', 300000) as ts \gset
select is(pg_temp.t(:'ts'), 'Akhir Pekan|2026-03-14|2026-03-16|300000|false|F|F|shared',
  'Farida (anggota kedua) membuat trip Bersama (K1)');
select is(pg_temp.err(tests.f(), pg_temp.ct_sql(:'sh', 'akhir pekan', '2026-04-01', '2026-04-02')) like '23505:%', 'true',
  'nama unik per ruang juga di Bersama; Pribadi dan Bersama boleh sama (di bawah)');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'sh', 'Bali', '2026-03-12', '2026-03-19')), 'ok',
  'nama sama di ruang lain (Bersama) diterima');

-- ===== update_trip =====
select is(pg_temp.call(tests.n(), pg_temp.ut_sql(:'t1', ' Bali 2026 ', '2026-03-12', '2026-03-19', 900000)),
  jsonb_build_object('trip_id', :'t1', 'status', 'active'), 'update_trip: hasil');
select is(pg_temp.t(:'t1'), 'Bali 2026|2026-03-12|2026-03-19|900000|false|N|N|personal', 'nama, anggaran berubah');
select tests.clock_at('2026-03-20 10:30+07');
select pg_temp.call(tests.n(), pg_temp.ut_sql(:'t1', 'Bali 2026', '2026-03-12', '2026-03-19', 900000));
select is(tests.owner_val(null, format($$select updated_at = '2026-03-20 10:00+07' from app.trips where id = %L$$, :'t1')), 'false',
  'ganti nama tadi mengubah updated_at ke 10:00 (jam tiruan awal)');
select tests.clock_at('2026-03-20 10:45+07');
select pg_temp.call(tests.f(), pg_temp.ut_sql(:'ts', 'Akhir Pekan', '2026-03-14', '2026-03-16', 300000));
select is(tests.owner_val(null, format($$select (updated_at = '2026-03-20 10:00+07') || '/' || (updated_by = %L)
    from app.trips where id = %L$$, tests.f(), :'ts')), 'true/true',
  'ulang dengan isi sama = idempoten, tanpa mengubah updated_at/updated_by');
select pg_temp.call(tests.n(), pg_temp.ut_sql(:'ts', 'Akhir Pekan', '2026-03-14', '2026-03-17', null));
select is(pg_temp.t(:'ts'), 'Akhir Pekan|2026-03-14|2026-03-17|-|false|F|N|shared',
  'Novanda mengubah trip yang dibuat Farida: pembuat tetap, pengubah tercatat, anggaran dikosongkan (ganti-penuh)');
select is(tests.owner_val(null, format($$select updated_at = app.now() from app.trips where id = %L$$, :'ts')), 'true',
  'updated_at dari jam DB');
select tests.clock_at('2026-03-20 10:00+07');
select is(pg_temp.err(tests.n(), pg_temp.ut_sql(:'t1', '', '2026-03-12', '2026-03-19')) || ' '
          || pg_temp.err(tests.n(), pg_temp.ut_sql(:'t1', 'X', null, '2026-03-19')) || ' '
          || pg_temp.err(tests.n(), pg_temp.ut_sql(:'t1', 'X', '2026-03-12', '2026-03-11')) || ' '
          || pg_temp.err(tests.n(), pg_temp.ut_sql(:'t1', 'X', '2026-03-12', '2026-03-19', 0)),
  'DK400:invalid_argument:name DK400:invalid_argument:starts_on DK400:invalid_argument:ends_on '
  || 'DK400:invalid_argument:budget_amount', 'validasi update_trip per kolom');
select is(pg_temp.t(:'t1'), 'Bali 2026|2026-03-12|2026-03-19|900000|false|N|N|personal', 'validasi gagal = nol efek');
select is(pg_temp.err(tests.n(), pg_temp.ut_sql(:'t1', 'Bali Lama', '2026-03-12', '2026-03-19', 900000)), 'ok',
  'ganti nama ke nama baru');
select is(pg_temp.err(tests.n(), pg_temp.ut_sql(:'t1', ' BALI 2 ', '2026-03-12', '2026-03-19', 900000)), 'ok', 'nama bebas dipakai');
select is(pg_temp.err(tests.n(), pg_temp.ut_sql(:'t60', 'bali 2', '2026-03-12', '2026-03-19', 900000)) like '23505:%trips_name_unique%',
  'true', 'ganti nama menjadi nama trip aktif lain = 23505 (name_taken)');
select pg_temp.call(tests.n(), pg_temp.ut_sql(:'t1', 'Bali 2026', '2026-03-12', '2026-03-19', 900000));
select is(pg_temp.err(tests.x(), pg_temp.ut_sql(:'ts', 'X', '2026-03-01', '2026-03-02')) || ' '
          || pg_temp.err(tests.x(), pg_temp.op_sql('archive_trip', :'ts')) || ' '
          || pg_temp.err(tests.x(), pg_temp.op_sql('restore_trip', :'ts')),
  'DK404:trip_not_found: DK404:trip_not_found: DK404:trip_not_found:', 'Luar tidak bisa menulis trip Bersama (K1)');
select is(pg_temp.err(tests.f(), pg_temp.ut_sql(:'t1', 'X', '2026-03-01', '2026-03-02')) || ' '
          || pg_temp.err(tests.f(), pg_temp.op_sql('archive_trip', :'t1')) || ' '
          || pg_temp.err(tests.f(), pg_temp.op_sql('restore_trip', :'t1')),
  'DK404:trip_not_found: DK404:trip_not_found: DK404:trip_not_found:', 'trip Pribadi pasangan tidak bisa ditulis [B25]');
select is(pg_temp.t(:'t1'), 'Bali 2026|2026-03-12|2026-03-19|900000|false|N|N|personal', 'trip Pribadi tidak berubah [B25]');
select is(pg_temp.err(tests.n(), pg_temp.ut_sql(gen_random_uuid(), 'X', '2026-03-01', '2026-03-02')),
  pg_temp.err(tests.f(), pg_temp.ut_sql(:'t1', 'X', '2026-03-01', '2026-03-02')),
  'trip tidak ada dan trip ruang lain menjawab sama persis, tanpa orakel nama [B25]');
select is(pg_temp.err(null, pg_temp.ut_sql(:'t1', 'X', '2026-03-01', '2026-03-02')), 'DK401:unauthenticated:',
  'update_trip tanpa pengguna = DK401');

-- ===== archive_trip / restore_trip =====
select pg_temp.ct(tests.n(), :'np', 'Jogja', '2026-02-01', '2026-02-03') as t2 \gset
select is(pg_temp.op(tests.n(), 'archive_trip', :'t2'), jsonb_build_object('trip_id', :'t2', 'status', 'archived'), 'archive_trip: hasil');
select is(pg_temp.t(:'t2'), 'Jogja|2026-02-01|2026-02-03|-|true|N|N|personal', 'arsip dari aktif');
select is(pg_temp.err(tests.n(), pg_temp.op_sql('archive_trip', :'t2')) || ' ' || pg_temp.t(:'t2'),
  'ok Jogja|2026-02-01|2026-02-03|-|true|N|N|personal', 'arsip ulang = idempoten');
select is(pg_temp.err(tests.n(), pg_temp.ut_sql(:'t2', 'Jogja', '2026-02-01', '2026-02-03')), 'DK422:trip_archived:',
  'trip terarsip tidak bisa diubah (K8), tanpa nama');
select is(pg_temp.err(tests.n(), pg_temp.ct_sql(:'np', 'jogja', '2026-05-01', '2026-05-03')), 'ok',
  'nama trip terarsip dipakai ulang oleh trip aktif baru');
select is(pg_temp.err(tests.n(), pg_temp.op_sql('restore_trip', :'t2')) like '23505:%trips_name_unique%', 'true',
  'pulihkan saat nama aktif sama sudah ada = 23505 (name_taken)');
select is(pg_temp.t(:'t2'), 'Jogja|2026-02-01|2026-02-03|-|true|N|N|personal', 'pulihkan gagal = nol efek, tetap terarsip');
select pg_temp.op(tests.n(), 'archive_trip', (select (pg_temp.call(tests.n(), pg_temp.ct_sql(:'np', 'JOGJA', '2026-05-01', '2026-05-03'))
  ->> 'trip_id')::uuid)) ->> 'status' as arch_new \gset
select is(:'arch_new', 'archived', 'trip aktif bernama sama diarsipkan');
select is(pg_temp.op(tests.n(), 'restore_trip', :'t2'), jsonb_build_object('trip_id', :'t2', 'status', 'active'), 'restore_trip: hasil');
select is(pg_temp.t(:'t2'), 'Jogja|2026-02-01|2026-02-03|-|false|N|N|personal', 'pulihkan dari arsip = aktif');
select is(pg_temp.err(tests.n(), pg_temp.op_sql('restore_trip', :'t2')), 'ok', 'pulihkan ulang = idempoten');
select is(pg_temp.err(tests.n(), pg_temp.ut_sql(:'t2', 'Jogja Lagi', '2026-02-01', '2026-02-04')), 'ok', 'trip yang dipulihkan bisa diubah');
select pg_temp.op(tests.n(), 'archive_trip', :'t2');
-- Bersama: Farida mengarsipkan dan memulihkan trip yang dibuat dan diubah Novanda (K1).
select is(pg_temp.op(tests.f(), 'archive_trip', :'ts') ->> 'status' || ' ' || (pg_temp.op(tests.f(), 'restore_trip', :'ts') ->> 'status'),
  'archived active', 'anggota kedua mengarsipkan dan memulihkan trip Bersama (K1)');
select is(pg_temp.err(tests.n(), pg_temp.op_sql('archive_trip', gen_random_uuid())) || ' '
          || pg_temp.err(tests.n(), pg_temp.op_sql('restore_trip', gen_random_uuid())),
  'DK404:trip_not_found: DK404:trip_not_found:', 'trip tidak ada = DK404');
select is(pg_temp.err(null, pg_temp.op_sql('archive_trip', :'t1')) || ' ' || pg_temp.err(null, pg_temp.op_sql('restore_trip', :'t1')),
  'DK401:unauthenticated: DK401:unauthenticated:', 'arsip/pulihkan tanpa pengguna = DK401');

-- ===== Penanda entri (SQL langsung, api penanda = 0148) =====
select pg_temp.tag(tests.n(), :'e1', :'t1') + pg_temp.tag(tests.n(), :'e2', :'t1') + pg_temp.tag(tests.n(), :'e3', :'t1') as tagged \gset
select is(:'tagged', '3', 'tiga pengeluaran Pribadi (100.000, 50.000 di sub-kategori, 25.000) ditandai ke trip');
select pg_temp.tag(tests.n(), :'e4', :'t2');  -- e4 (03-20) ke trip Jogja terarsip: dipindah di bawah

-- ===== trip_overview: angka, fase WIB, per_day atas hari berjalan =====
-- Trip Bali 2026: 03-12..03-19, anggaran 900.000, total 175.000 (e1 di luar rentang tetap ikut: K5).
select is(pg_temp.ov(tests.n(), :'t1'), 'ended|8|8|175000|3|21875|725000|19|2026-03-05|2026-03-13',
  'selesai: total, 3 pengeluaran, per_day = total/8 hari (elapsed = panjang), Sisa 725000, 19% (19,4 dibulatkan ke bawah)');
select tests.clock_at('2026-03-10 09:00+07');
select is(pg_temp.ov(tests.n(), :'t1'), 'upcoming|8|0|175000|3|-|725000|19|2026-03-05|2026-03-13',
  'akan datang: elapsed 0, per_day kosong (bukan 0), fase upcoming');
select tests.clock_at('2026-03-11 23:59+07');
select is(split_part(pg_temp.ov(tests.n(), :'t1'), '|', 1) || split_part(pg_temp.ov(tests.n(), :'t1'), '|', 3), 'upcoming0',
  'sehari sebelum mulai, 23:59 WIB masih akan datang');
select tests.clock_at('2026-03-12 00:00+07');
select is(split_part(pg_temp.ov(tests.n(), :'t1'), '|', 1) || '/' || split_part(pg_temp.ov(tests.n(), :'t1'), '|', 3)
          || '/' || split_part(pg_temp.ov(tests.n(), :'t1'), '|', 6),
  'ongoing/1/175000', 'hari mulai 00:00 WIB: berlangsung, hari ke-1, per_day = seluruh total');
select tests.clock_at('2026-03-14 12:00+07');
select is(pg_temp.ov(tests.n(), :'t1'), 'ongoing|8|3|175000|3|58333|725000|19|2026-03-05|2026-03-13',
  'berlangsung hari ke-3: per_day = floor(175000/3) = 58333 (pecahan terakhir dibuang)');
select tests.clock_at('2026-03-19 23:59+07');
select is(split_part(pg_temp.ov(tests.n(), :'t1'), '|', 1) || '/' || split_part(pg_temp.ov(tests.n(), :'t1'), '|', 3),
  'ongoing/8', 'hari terakhir 23:59 WIB: masih berlangsung, hari ke-8');
select tests.clock_at('2026-03-20 00:00+07');
select is(split_part(pg_temp.ov(tests.n(), :'t1'), '|', 1) || '/' || split_part(pg_temp.ov(tests.n(), :'t1'), '|', 3),
  'ended/8', 'hari sesudah selesai 00:00 WIB: selesai, elapsed dibatasi panjang trip');
select tests.clock_at('2026-03-20 10:00+07');
select is(tests.web_val(tests.n(), format($$select trip_id = %L and space_id = %L and name = 'Bali 2026' and budget_amount = 900000
    and starts_on = '2026-03-12' and ends_on = '2026-03-19' and archived_at is null from api.trip_overview(%L)$$,
    :'t1', :'np', :'t1')), 'true', 'identitas trip di trip_overview');
-- Batas: total 0, anggaran 1, satu hari (hari ini).
select pg_temp.ct(tests.n(), :'np', 'Sehari', '2026-03-20', '2026-03-20', 1) as t3 \gset
select is(pg_temp.ov(tests.n(), :'t3'), 'ongoing|1|1|0|0|-|1|0|-|-', 'total 0, anggaran 1, satu hari: per_day kosong, Sisa 1, 0%');
select pg_temp.tag(tests.n(), :'e4', :'t3');
select is(pg_temp.ov(tests.n(), :'t3'), 'ongoing|1|1|30000|1|30000|-29999|3000000|2026-03-20|2026-03-20',
  'melebihi anggaran: budget_left negatif (Lebih), pct tidak dibatasi 100');
select pg_temp.ct(tests.n(), :'np', 'Tanpa Anggaran', '2026-03-10', '2026-03-31') as t4 \gset
select pg_temp.tag(tests.n(), :'e4', :'t4');
select is(pg_temp.ov(tests.n(), :'t4'), 'ongoing|22|11|30000|1|2727|-|-|2026-03-20|2026-03-20',
  'tanpa anggaran: budget_left dan pct kosong; per_day = floor(30000/11) = 2727');
select pg_temp.tag(tests.n(), :'e4', null);
select is(pg_temp.ov(tests.n(), :'t4'), 'ongoing|22|11|0|0|-|-|-|-|-', 'trip tanpa pengeluaran: nol, per_day kosong, tanpa tanggal');
select is(pg_temp.err(tests.x(), format($$select * from api.trip_overview(%L)$$, :'t1')) || ' '
          || pg_temp.err(tests.f(), format($$select * from api.trip_overview(%L)$$, :'t1')) || ' '
          || pg_temp.err(tests.n(), format($$select * from api.trip_overview(%L)$$, gen_random_uuid())) || ' '
          || pg_temp.err(null, format($$select * from api.trip_overview(%L)$$, :'t1')),
  'DK404:trip_not_found: DK404:trip_not_found: DK404:trip_not_found: DK401:unauthenticated:',
  'trip_overview: Luar, pasangan, tidak ada = DK404 seragam; tanpa pengguna DK401 [B25]');
select is(tests.web_val(tests.f(), format($$select count(*) from api.trip_overview(%L)$$, :'ts')) || '/'
          || tests.web_val(tests.n(), format($$select count(*) from api.trip_overview(%L)$$, :'ts')), '1/1',
  'trip Bersama terbaca kedua anggota (K1)');
-- Terarsip tetap terbaca lengkap.
select is(split_part(pg_temp.ov(tests.n(), :'t2'), '|', 1) || '/' || split_part(pg_temp.ov(tests.n(), :'t2'), '|', 4),
  'ended/30000', 'trip terarsip tetap terbaca (e4 ditandai ke Jogja terarsip)');
select pg_temp.tag(tests.n(), :'e4', null);

-- ===== Total trip = Laporan; yang bukan "Pengeluaran" tidak ikut =====
select is(tests.web_val(tests.n(), format($$select (select spent from api.trip_overview(%L)) = (select outflow
    from api.period_summary(%L, '2026-03-05', '2026-03-13') where report_class = 'expense')$$, :'t1', :'np')),
  'true', 'total trip = Σ pengeluaran kelas expense period_summary untuk pengeluaran yang sama (100.000 + 50.000 + 25.000)');
select tests.web_val(tests.n(), format($$select 1$$)) as _ \gset
savepoint kelas;
select tests.raw_exec($$alter table app.entries drop constraint entries_trip_check$$);
select tests.raw_exec(format($$update app.entries set trip_id = %L where id in (%L, %L, %L, %L, %L)$$,
  :'t1', :'e_kan', :'e_tal', :'e_inc', :'e_xfer', :'e_batal'));
select is(pg_temp.ov(tests.n(), :'t1'), 'ended|8|8|175000|3|21875|725000|19|2026-03-05|2026-03-13',
  'Kantor, talangan, pemasukan, transfer (+ biaya), dan entri batal bertrip tidak masuk total (kelas laporan, bukan filter jenis) [I6]');
select is(pg_temp.bd(tests.n(), :'t1', 'category') || '#' || pg_temp.bd(tests.n(), :'t1', 'member'),
  'x',  'placeholder');
rollback to savepoint kelas;

select * from finish();
rollback;
