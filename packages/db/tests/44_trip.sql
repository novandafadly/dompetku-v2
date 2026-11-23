-- Trip S15 (0146; plan S15 Task 2, K1 sampai K5, K7, K8): app.trips (satu ruang Pribadi atau Bersama, nama
-- 1..60 unik di antara trip aktif tanpa beda huruf, rentang tanggal wajib <= 366 hari, anggaran opsional),
-- app.entries.trip_id (FK komposit (space_id, trip_id), CHECK hanya pengeluaran biasa, indeks non-parsial),
-- penjaga private.tg_trip_guard (ruang tetap), pengaman bentuk entri bertrip di private.assert_entry_shape,
-- RLS (Pribadi pasangan dan Luar tidak terbaca/tertulis; Bersama semua anggota, K1), tulis hanya
-- dompetku_api, snapshot riwayat memuat trip_id, dan I6 (trip hanya pengelompokan: saldo, Laporan, anggaran,
-- aman dipakai, kekayaan bersih tidak berubah). DQ20 diuji di 17_dq. Fungsi api.* trip = 0147 (Task 3),
-- jalur tulis entri = 0148 (Task 4); di sini baris ditulis langsung sebagai dompetku_api (jalur yang sama
-- dengan fungsi DEFINER, pola 35_tujuan).
-- Jam dipatok 2026-03-20 WIB. Tanpa urutan uuid/created_at dan tanpa locale (COLLATE "C").
-- ID: B25, I6, B1
begin;
select plan(86);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 20000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Celengan', 'tabungan', 1000000, '2026-01-01') as tab,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 1000000, '2026-01-01') as kan,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 10000000, '2026-01-01') as kas,
       tests.account(tests.f(), :'fp', 'BNI Farida', 'operasional', 5000000, '2026-01-01') as fbni \gset
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja'$q$, :'np'))
  as belanja \gset
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja Dapur'$q$, :'sh'))
  as sbelanja \gset
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja'$q$, :'fp'))
  as fbelanja \gset

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
-- Baris trip sebagai dompetku_api (jalur fungsi DEFINER 0147), kembalikan id.
create function pg_temp.trip(p_uid uuid, p_space uuid, p_kind text, p_name text, p_from date, p_to date,
  p_budget bigint default null) returns uuid
language sql as $$
  select tests.api_val(p_uid, format($q$insert into app.trips (space_id, space_kind, name, starts_on, ends_on,
      budget_amount, created_by, updated_by) values (%L, %L, %L, %L::date, %L::date, %L::bigint, %L, %L)
      returning id$q$, p_space, p_kind, p_name, p_from, p_to, p_budget, p_uid, p_uid))::uuid
$$;
-- Pengeluaran lewat API (p_reimb = talangan).
create function pg_temp.exp(p_uid uuid, p_space uuid, p_acc uuid, p_amount bigint, p_cat uuid, p_on date,
  p_reimb boolean default false) returns uuid
language sql as $$
  select (pg_temp.call(p_uid, format($q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', %s, %L,
      %L::date, null, %L)$q$, p_space, p_acc, p_amount, p_cat, p_on, p_reimb)) ->> 'entry_id')::uuid
$$;
create function pg_temp.inc(p_uid uuid, p_space uuid, p_acc uuid, p_amount bigint, p_on date) returns uuid
language sql as $$
  select (pg_temp.call(p_uid, format($q$select api.create_entry(gen_random_uuid(), %L, %L, 'income', %s, null,
      %L::date, null)$q$, p_space, p_acc, p_amount, p_on)) ->> 'entry_id')::uuid
$$;
-- Tandai/lepas sebagai dompetku_api (RLS + FK + CHECK); kembalikan jumlah baris.
create function pg_temp.tag(p_uid uuid, p_entry uuid, p_trip uuid) returns bigint
language sql as $$
  select tests.api_exec(p_uid, format($q$update app.entries set trip_id = %L::uuid where id = %L$q$, p_trip, p_entry))
$$;
-- Sama, tetapi cek bentuk (constraint trigger deferred) dijalankan segera sebagai owner; kembali deferred.
create function pg_temp.tag_strict(p_entry uuid, p_trip uuid) returns bigint
language sql as $f$
  select tests.owner_exec(null, format($q$do $d$ begin
      set constraints all deferred;
      update app.entries set trip_id = %L::uuid where id = %L;
      set constraints all immediate;
      set constraints all deferred;
    end $d$$q$, p_trip, p_entry))
$f$;
create function pg_temp.tag_of(p_entry uuid) returns text
language sql as $$
  select tests.owner_val(null, format($q$select coalesce(trip_id::text, '-') from app.entries where id = %L$q$, p_entry))
$$;
-- Sidik jari angka uang ruang (I6): ringkasan kategori, saldo tiap dompet, Σ report_lines per kelas,
-- aman dipakai, kekayaan bersih.
create function pg_temp.i6(p_uid uuid, p_space uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select
      (select coalesce(string_agg(kind || ':' || coalesce(name, '-') || ':' || amount, ',' order by kind, name collate "C"), '')
         from api.category_summary(%1$L, '2026-03-01', '2026-03-31'))
      || '|' || (select coalesce(string_agg(account_id || ':' || balance, ',' order by account_id), '')
                   from app.account_balances where space_id = %1$L)
      || '|' || (select coalesce(string_agg(report_class || ':' || s, ',' order by report_class collate "C"), '')
                   from (select report_class, sum(amount) as s from app.report_lines where space_id = %1$L group by 1) x)
      || '|' || (select s::text from api.safe_to_spend(%1$L, '2026-03-20') s)
      || '|' || (select w::text from api.net_worth(%1$L) w)$q$, p_space))
$$;

-- ===== Data awal: entri sebelum ada trip =====
select pg_temp.exp(tests.n(), :'np', :'bca', 100000, :'belanja', '2026-03-05') as e1 \gset
select pg_temp.exp(tests.n(), :'np', :'bca', 50000, :'belanja', '2026-03-06') as e2 \gset
select pg_temp.exp(tests.n(), :'np', :'kan', 30000, :'belanja', '2026-03-07') as e_kan \gset
select pg_temp.exp(tests.n(), :'np', :'bca', 70000, :'belanja', '2026-03-08', true) as e_tal \gset
select pg_temp.inc(tests.n(), :'np', :'bca', 5000000, '2026-03-09') as e_inc \gset
select (pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 200000, 0,
  '2026-03-10')$$, :'np', :'bca', :'tab')) ->> 'entry_id')::uuid as e_xfer \gset
select pg_temp.exp(tests.n(), :'np', :'bca', 25000, :'belanja', '2026-03-11') as e3 \gset
select pg_temp.exp(tests.n(), :'sh', :'kas', 80000, :'sbelanja', '2026-03-05') as s1 \gset
select pg_temp.exp(tests.f(), :'fp', :'fbni', 40000, :'fbelanja', '2026-03-05') as f1 \gset
select pg_temp.i6(tests.n(), :'np') as np_before, pg_temp.i6(tests.n(), :'sh') as sh_before \gset

-- ===== Skema =====
select has_table('app', 'trips', 'tabel app.trips ada');
select is((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
           from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname = 'trips' and a.attnum > 0 and not a.attisdropped),
  'id:uuid:true,space_id:uuid:true,space_kind:app.space_kind:true,name:text:true,starts_on:date:true,ends_on:date:true,budget_amount:bigint:false,archived_at:timestamp with time zone:false,created_by:uuid:true,created_at:timestamp with time zone:true,updated_by:uuid:true,updated_at:timestamp with time zone:true',
  'kolom app.trips (kontrak Task 3: tanggal wajib, anggaran opsional, tanpa kolom turunan)');
select is((select indexdef from pg_indexes where schemaname = 'app' and indexname = 'trips_name_unique'),
  'CREATE UNIQUE INDEX trips_name_unique ON app.trips USING btree (space_id, lower(btrim(name))) WHERE (archived_at IS NULL)',
  'indeks unik nama trip aktif per ruang (api 0147 memetakan 23505 ke name_taken)');
select is((select relrowsecurity::text || '/' || relforcerowsecurity::text from pg_class c
           join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relname = 'trips'),
  'true/true', 'RLS ENABLE + FORCE di app.trips');
select is(tests.owner_val(null, $q$select format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull from pg_attribute a
           where a.attrelid = 'app.entries'::regclass and a.attname = 'trip_id'$q$), 'uuid:false', 'kolom app.entries.trip_id uuid null');
select is(tests.owner_val(null, $q$select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'app.entries'::regclass and conname = 'entries_trip_fk'$q$),
  'FOREIGN KEY (space_id, trip_id) REFERENCES app.trips(space_id, id) ON DELETE RESTRICT',
  'FK komposit (space_id, trip_id) on delete restrict');
select is(tests.owner_val(null, $q$select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'app.entries'::regclass and conname = 'entries_trip_check'$q$),
  'CHECK (((trip_id IS NULL) OR ((kind = ''expense''::app.entry_kind) AND (NOT reimbursable))))',
  'CHECK entri bertrip = pengeluaran biasa (K4)');
select is((select indexdef from pg_indexes where schemaname = 'app' and indexname = 'entries_trip'),
  'CREATE INDEX entries_trip ON app.entries USING btree (space_id, trip_id)',
  'indeks entri per trip (non-parsial, syarat BSD §13 #7 untuk FK)');
select ok((select not p.prosecdef and p.proowner = 'dompetku_owner'::regrole
           from pg_trigger g join pg_proc p on p.oid = g.tgfoid
           join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname = 'trips' and g.tgname = 'trip_guard'),
  'trigger trip_guard memakai private.tg_trip_guard INVOKER milik owner');
select is(tests.owner_val(null, $q$select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum
           where enumtypid = 'app.entry_kind'::regtype$q$),
  'income,expense,transfer,space_transfer,opening_balance,adjustment,reimbursement,debt_principal,debt_payment,valuation',
  'tanpa nilai enum entry_kind baru (trip bukan jenis entri)');
select is(tests.web_val(tests.n(), format($$select count(*) from app.entries where space_id = %L and trip_id is not null$$, :'np')),
  '0', 'entri yang sudah ada tidak bertrip (kolom null)');

-- ===== CHECK tabel =====
select throws_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', '   ', '2026-03-01', '2026-03-05')$$, :'np'),
  '23514', null, 'nama kosong sesudah btrim ditolak');
select throws_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', repeat('a', 61), '2026-03-01', '2026-03-05')$$, :'np'),
  '23514', null, 'nama 61 karakter ditolak');
select lives_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', repeat('b', 60), '2026-03-01', '2026-03-05')$$, :'np'),
  'nama 60 karakter diterima');
select throws_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', 'Terbalik', '2026-03-05', '2026-03-04')$$, :'np'),
  '23514', null, 'tanggal selesai sebelum mulai ditolak');
select lives_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', 'Sehari', '2026-03-05', '2026-03-05')$$, :'np'),
  'rentang satu hari diterima');
select lives_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', 'Setahun', '2026-01-01', '2027-01-01')$$, :'np'),
  'rentang 366 hari (selisih 365) diterima');
select throws_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', 'Terlalu Panjang', '2026-01-01', '2027-01-02')$$, :'np'),
  '23514', null, 'rentang 367 hari ditolak (K5)');
select throws_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', 'Kuno', '1999-12-31', '2000-01-02')$$, :'np'),
  '23514', null, 'tanggal mulai sebelum 2000-01-01 ditolak');
select throws_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', 'Jauh', '2100-12-31', '2101-01-01')$$, :'np'),
  '23514', null, 'tanggal selesai sesudah 2100-12-31 ditolak');
select lives_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', 'Batas', '2100-12-30', '2100-12-31')$$, :'np'),
  'tanggal di batas 2100-12-31 diterima');
select throws_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', 'Nol', '2026-03-01', '2026-03-05', 0)$$, :'np'),
  '23514', null, 'anggaran 0 ditolak');
select throws_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', 'Minus', '2026-03-01', '2026-03-05', -1)$$, :'np'),
  '23514', null, 'anggaran negatif ditolak');
select throws_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', 'Raksasa', '2026-03-01', '2026-03-05', 10000000000001)$$, :'np'),
  '23514', null, 'anggaran > 10^13 ditolak');
select lives_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', 'Plafon', '2026-03-01', '2026-03-05', 10000000000000)$$, :'np'),
  'anggaran 10^13 diterima');
select throws_ok(format($$select pg_temp.trip(tests.n(), %L, 'shared', 'Salah Ruang', '2026-03-01', '2026-03-05')$$, :'np'),
  '23503', null, 'space_kind wajib cocok dengan ruang (FK)');
select is(tests.web_val(tests.n(), format($$select count(*) from app.trips where space_id = %L and budget_amount is null$$, :'np')),
  '4', 'anggaran opsional: empat trip tanpa anggaran tersimpan null (Plafon beranggaran)');

-- ===== Nama unik di antara trip aktif ruang itu (tanpa beda huruf/spasi pinggir) =====
select pg_temp.trip(tests.n(), :'np', 'personal', 'Bali', '2026-03-12', '2026-03-19') as bali \gset
select throws_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', 'bali', '2026-04-01', '2026-04-03')$$, :'np'),
  '23505', null, 'nama sama beda huruf kecil ditolak');
select throws_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', '  BALI  ', '2026-04-01', '2026-04-03')$$, :'np'),
  '23505', null, 'nama sama dengan spasi pinggir dan huruf besar ditolak');
select lives_ok(format($$select pg_temp.trip(tests.n(), %L, 'shared', 'Bali', '2026-03-12', '2026-03-19')$$, :'sh'),
  'nama sama di ruang lain (Bersama) diterima');
select lives_ok(format($$select pg_temp.trip(tests.f(), %L, 'personal', 'Bali', '2026-03-12', '2026-03-19')$$, :'fp'),
  'nama sama di Pribadi pasangan diterima');
select is(tests.api_exec(tests.n(), format($$update app.trips set archived_at = app.now() where id = %L$$, :'bali')), 1::bigint,
  'trip diarsipkan');
select lives_ok(format($$select pg_temp.trip(tests.n(), %L, 'personal', 'Bali', '2026-04-01', '2026-04-03')$$, :'np'),
  'nama trip terarsip dipakai ulang oleh trip aktif baru');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$update app.trips set archived_at = null where id = %L$q$)$$, :'bali'),
  '23505', null, 'memulihkan trip arsip saat nama aktif sama sudah ada ditolak');
select is(tests.api_exec(tests.n(), format($$update app.trips set name = 'Bali lama' where id = %L$$, :'bali')), 1::bigint,
  'trip arsip boleh diganti nama');
select is(tests.api_exec(tests.n(), format($$update app.trips set archived_at = null where id = %L$$, :'bali')), 1::bigint,
  'pulihkan diterima sesudah nama diganti');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$update app.trips set name = ' BALI ' where id = %L$q$)$$, :'bali'),
  '23505', null, 'ganti nama menjadi nama trip aktif lain ditolak');

-- ===== Entri bertrip: CHECK, FK komposit lintas ruang, penjaga bentuk (K4) =====
select pg_temp.trip(tests.n(), :'np', 'personal', 'Tagging', '2026-03-01', '2026-03-31') as tp \gset
select pg_temp.trip(tests.n(), :'sh', 'shared', 'Akhir Pekan', '2026-03-01', '2026-03-31') as stp \gset
select pg_temp.trip(tests.f(), :'fp', 'personal', 'Solo', '2026-03-01', '2026-03-31') as ftp \gset
select is(pg_temp.tag(tests.n(), :'e1', :'tp'), 1::bigint, 'pengeluaran biasa ditandai ke trip ruangnya');
select is(pg_temp.tag_of(:'e1'), :'tp', 'trip_id tersimpan di entri');
select throws_ok(format($$select pg_temp.tag(tests.n(), %L, %L)$$, :'e_inc', :'tp'), '23514', null,
  'pemasukan bertrip ditolak CHECK (K4)');
select throws_ok(format($$select pg_temp.tag(tests.n(), %L, %L)$$, :'e_xfer', :'tp'), '23514', null,
  'transfer bertrip ditolak CHECK');
select throws_ok(format($$select pg_temp.tag(tests.n(), %L, %L)$$, :'e_tal', :'tp'), '23514', null,
  'talangan bertrip ditolak CHECK (K4)');
select throws_ok(format($$select pg_temp.tag(tests.n(), %L, %L)$$, :'s1', :'tp'), '23503', null,
  'pengeluaran Bersama ke trip Pribadi ditolak FK komposit (K1)');
select throws_ok(format($$select pg_temp.tag(tests.n(), %L, %L)$$, :'e2', :'stp'), '23503', null,
  'pengeluaran Pribadi ke trip Bersama ditolak FK komposit (K1)');
select throws_ok(format($$select pg_temp.tag(tests.f(), %L, %L)$$, :'f1', :'tp'), '23503', null,
  'pengeluaran Pribadi Farida ke trip Pribadi Novanda ditolak FK komposit [B25]');
select throws_ok(format($$select pg_temp.tag(tests.n(), %L, gen_random_uuid())$$, :'e2'), '23503', null,
  'trip yang tidak ada ditolak FK');
select is(pg_temp.tag(tests.f(), :'f1', :'ftp'), 1::bigint, 'Farida menandai pengeluaran Pribadinya ke trip Pribadinya');
select is(pg_temp.tag(tests.n(), :'f1', :'ftp'), 0::bigint, 'Novanda tidak melihat (tidak bisa menandai) entri Pribadi Farida [B25]');
select is(pg_temp.tag(tests.f(), :'s1', :'stp'), 1::bigint, 'anggota Bersama mana pun menandai pengeluaran Bersama (K1)');
select is(pg_temp.tag(tests.n(), :'s1', null), 1::bigint, 'anggota lain melepas tanda trip Bersama');
select is(pg_temp.tag_of(:'s1'), '-', 'lepas = trip_id null');
select throws_ok(format($$select pg_temp.tag_strict(%L, %L)$$, :'e_kan', :'tp'), 'DK500', 'entry_shape_invalid',
  'pengeluaran dompet Kantor bertrip lolos CHECK tetapi ditolak cek bentuk (K4, S-47)');
select lives_ok(format($$select pg_temp.tag_strict(%L, %L)$$, :'e1', :'tp'),
  'pengeluaran biasa bertrip lolos cek bentuk');
select throws_ok(format($$select tests.owner_exec(null, $q$delete from app.trips where id = %L$q$)$$, :'tp'), '23503', null,
  'trip yang masih dipakai entri tidak bisa dihapus (on delete restrict)');
-- Lapis kedua (cek bentuk) berdiri sendiri: CHECK dilepas di savepoint, pelanggaran disuntik, cek bentuk menolak.
savepoint s;
select tests.raw_exec($$alter table app.entries drop constraint entries_trip_check$$);
select tests.raw_exec(format($$update app.entries set trip_id = %L where id in (%L, %L, %L)$$, :'tp', :'e_inc', :'e_tal', :'e_xfer'));
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format($q$select private.assert_entry_shape(%L)$q$, :'e_inc')),
  'DK500', 'entry_shape_invalid', 'assert_entry_shape: pemasukan bertrip = DK500');
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format($q$select private.assert_entry_shape(%L)$q$, :'e_tal')),
  'DK500', 'entry_shape_invalid', 'assert_entry_shape: talangan bertrip = DK500');
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format($q$select private.assert_entry_shape(%L)$q$, :'e_xfer')),
  'DK500', 'entry_shape_invalid', 'assert_entry_shape: transfer bertrip = DK500');
select lives_ok(format($$select tests.owner_exec(null, %L)$$, format($q$select private.assert_entry_shape(%L)$q$, :'e1')),
  'assert_entry_shape: pengeluaran biasa bertrip lolos');
rollback to savepoint s;

-- ===== Penjaga trip: ruang tetap; kolom lain boleh diubah =====
select throws_ok(format($$select tests.api_exec(tests.n(), $q$update app.trips set space_id = %L where id = %L$q$)$$, :'sh', :'tp'),
  'DK422', 'trip_immutable', 'ruang trip tidak bisa diganti');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$update app.trips set space_kind = 'shared' where id = %L$q$)$$, :'tp'),
  'DK422', 'trip_immutable', 'jenis ruang trip tidak bisa diganti');
select is(tests.api_exec(tests.n(), format($$update app.trips set name = 'Tagging 2', starts_on = '2026-02-28', ends_on = '2026-04-02',
  budget_amount = 900000, updated_by = %L, updated_at = app.now() where id = %L$$, tests.n(), :'tp')), 1::bigint,
  'nama, tanggal, dan anggaran boleh diubah');
select is(tests.api_exec(tests.n(), format($$update app.trips set budget_amount = null where id = %L$$, :'tp')), 1::bigint,
  'anggaran boleh dikosongkan');

-- ===== Snapshot riwayat memuat trip_id =====
select tests.api_exec(tests.n(), format($$update app.entries set trip_id = %L, version = version + 1 where id = %L$$, :'tp', :'e3'));
select tests.api_exec(tests.n(), format($$select private.write_history(%L, 'update', %L)$$, :'e3', tests.n()));
select is(tests.owner_val(null, format($$select snapshot ->> 'trip_id' from app.entry_history where entry_id = %L and version = 2$$, :'e3')),
  :'tp', 'snapshot riwayat sesudah ditandai memuat trip_id');
select is(tests.owner_val(null, format($$select (snapshot ? 'trip_id')::text || '/' || (snapshot ->> 'trip_id' is null)
  from app.entry_history where entry_id = %L and version = 1$$, :'e3')),
  'true/true', 'snapshot versi lama memuat kunci trip_id bernilai null (kolom ikut to_jsonb)');

-- ===== I6: trip hanya pengelompokan =====
select pg_temp.tag(tests.n(), :'e2', :'tp');
select pg_temp.tag(tests.f(), :'s1', :'stp');
select is(tests.web_val(tests.n(), format($$select count(*) from app.entries where space_id = %L and trip_id is not null$$, :'np')),
  '3', 'tiga pengeluaran Pribadi bertrip (e1, e2, e3) sebelum cek I6');
select is(pg_temp.i6(tests.n(), :'np'), :'np_before',
  'menandai pengeluaran ke trip tidak mengubah ringkasan kategori, saldo dompet, Σ per kelas laporan, aman dipakai, kekayaan bersih [I6]');
select is(pg_temp.i6(tests.n(), :'sh'), :'sh_before', 'sama untuk ruang Bersama [I6]');
select tests.api_exec(tests.n(), format($$update app.trips set archived_at = app.now() where id = %L$$, :'tp'));
select is(pg_temp.i6(tests.n(), :'np'), :'np_before', 'mengarsipkan trip tidak mengubah angka uang [I6]');
select pg_temp.tag(tests.n(), :'e1', null);
select pg_temp.tag(tests.n(), :'e2', null);
select pg_temp.tag(tests.n(), :'e3', null);
select is(pg_temp.i6(tests.n(), :'np'), :'np_before', 'melepas semua tanda trip tidak mengubah angka uang [I6]');

-- ===== Isolasi dan hak [B25, B1] =====
select is(tests.web_val(tests.f(), format($$select count(*) from app.trips where space_id = %L$$, :'np')), '0',
  'Farida tidak melihat trip Pribadi Novanda [B25] [B1]');
select is(tests.web_val(tests.n(), format($$select count(*) from app.trips where space_id = %L$$, :'fp')), '0',
  'Novanda tidak melihat trip Pribadi Farida [B25]');
select is(tests.web_val(tests.x(), 'select count(*) from app.trips'), '0', 'Luar tidak melihat trip apa pun [B25]');
select is(tests.web_val(tests.n(), format($$select count(*) from app.trips where space_id = %L$$, :'sh')),
  tests.web_val(tests.f(), format($$select count(*) from app.trips where space_id = %L$$, :'sh')),
  'trip Bersama sama untuk kedua anggota');
select is(tests.web_val(tests.f(), format($$select trip_id::text from app.entries where id = %L$$, :'e1')), null,
  'Farida tidak membaca entri (dan tanda trip) Pribadi Novanda [B25]');
select is(tests.api_exec(tests.f(), format($$update app.trips set name = 'Diretas' where id = %L$$, :'tp')), 0::bigint,
  'dompetku_api atas nama Farida tidak bisa mengubah trip Pribadi Novanda [B25]');
select throws_ok(format($$select tests.api_val(tests.f(), $q$insert into app.trips (space_id, space_kind, name, starts_on, ends_on,
    created_by, updated_by) values (%L, 'personal', 'X', '2026-03-01', '2026-03-02', %L, %L) returning id$q$)$$,
    :'np', tests.f(), tests.f()),
  '42501', null, 'Farida tidak bisa membuat trip di Pribadi Novanda (RLS WITH CHECK) [B25]');
select is(tests.api_exec(tests.f(), format($$update app.trips set name = 'Akhir Pekan 2' where id = %L$$, :'stp')), 1::bigint,
  'anggota Bersama mengubah trip Bersama (K1)');
select throws_ok(format($$select tests.api_val(tests.x(), $q$insert into app.trips (space_id, space_kind, name, starts_on, ends_on,
    created_by, updated_by) values (%L, 'shared', 'X', '2026-03-01', '2026-03-02', %L, %L) returning id$q$)$$,
    :'sh', tests.x(), tests.x()),
  '42501', null, 'Luar tidak bisa membuat trip di Bersama [B25]');
select throws_ok(format($$select tests.web_exec(tests.n(), $q$insert into app.trips (space_id, space_kind, name, starts_on, ends_on,
    created_by, updated_by) values (%L, 'personal', 'X', '2026-03-01', '2026-03-02', %L, %L)$q$)$$, :'np', tests.n(), tests.n()),
  '42501', null, 'dompetku_web tidak bisa INSERT langsung');
select throws_ok(format($$select tests.web_exec(tests.n(), $q$update app.trips set name = 'X' where id = %L$q$)$$, :'tp'),
  '42501', null, 'dompetku_web tidak bisa UPDATE langsung');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$delete from app.trips where id = %L$q$)$$, :'tp'),
  '42501', null, 'tanpa DELETE (trip tidak pernah dihapus fisik, K8)');
select throws_ok($$select tests.worker_val(null, 'select count(*) from app.trips')$$, '42501', null,
  'worker tidak membaca trip');
select is(tests.owner_val(null, $q$select has_table_privilege('dompetku_auditor', 'app.trips', 'SELECT')
          and not has_table_privilege('dompetku_auditor', 'app.trips', 'INSERT')
          and not has_table_privilege('dompetku_web', 'app.trips', 'UPDATE')
          and not has_table_privilege('dompetku_web', 'app.trips', 'DELETE')
          and not has_table_privilege('dompetku_api', 'app.trips', 'DELETE')$q$), 'true',
  'hak tabel trip: auditor baca saja, web baca saja, api tanpa DELETE');
select is(tests.api_exec(tests.f(), format($$update app.entries set trip_id = %L where id = %L$$, :'tp', :'e1')), 0::bigint,
  'Farida tidak bisa menandai entri Pribadi Novanda ke trip apa pun (RLS entri) [B25]');

-- ===== purge_unfinished_users tidak terhalang FK created_by/updated_by =====
-- Akun setengah jadi (tanpa profil) disuntik langsung: batas 2 pengguna berprofil sudah penuh.
select tests.raw_exec(format($q$insert into auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
  values (%L, 'U', 'x@example.test', true, '2026-03-10 10:00+07', '2026-03-10 10:00+07')$q$, tests.x()));
select is(tests.worker_val(null, 'select jobs.purge_unfinished_users()'), '1',
  'akun setengah jadi dihapus walau tabel trip berisi baris');
select is(tests.owner_val(null, $q$select count(*) from app.trips t where not exists
    (select 1 from app.profiles p where p.user_id = t.created_by)
    or not exists (select 1 from app.profiles p where p.user_id = t.updated_by)$q$), '0',
  'semua trip dibuat dan diubah pengguna berprofil (tidak pernah dipurge)');

select * from finish();
rollback;
