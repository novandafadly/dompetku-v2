-- Tujuan tabungan S13 (0137; plan S13 Task 2, K1 sampai K7, K9 = bagian T11): app.goals dengan indeks
-- unik parsial goals_one_active_per_account (1 dompet = 1 tujuan aktif, PRD:111), penjaga
-- private.tg_goal_guard (hanya pocket tabungan, ruang sama, dompet aktif saat tujuan aktif, dompet dan
-- ruang tetap), view app.goal_progress (progres = saldo dompet saat ini, K2; laju tabung per periode
-- gajian, K5; jam dari app.today()), RLS (Pribadi pasangan dan Luar tidak terbaca/tertulis; Bersama
-- semua anggota, K1), tulis hanya dompetku_api, I6 (tujuan tidak mengubah angka uang lain), dan
-- jobs.purge_unfinished_users tidak terhalang FK created_by. Fungsi api.* tujuan = 0138 (Task 3); di sini
-- baris ditulis langsung sebagai dompetku_api (jalur yang sama dengan fungsi DEFINER).
-- Jam dipatok 2026-03-20 WIB: periode gajian (payday_rule 25) berjalan = 25 Feb sampai 24 Mar (label Maret);
-- gajian efektif April = Jumat 24 Apr (25 Apr Sabtu).
-- ID: T11, B1, B22, I6
begin;
select plan(86);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');
select tests.owner_exec(null, 'update app.households set payday_rule = 25');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 20000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Celengan', 'tabungan', 1000000, '2026-01-01') as tab,
       tests.account(tests.n(), :'np', 'Dana Darurat', 'tabungan', 1000000, '2026-01-01') as dd,
       tests.account(tests.n(), :'np', 'Kosong', 'tabungan', 0, '2026-01-01') as kos,
       tests.account(tests.n(), :'np', 'Minus', 'tabungan', 0, '2026-01-01') as mns,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 0, '2026-01-01') as kan,
       tests.account(tests.n(), :'np', 'Saham', 'trading', 0, '2026-01-01') as tr,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 0, '2026-01-01') as kas,
       tests.account(tests.n(), :'sh', 'Liburan', 'tabungan', 0, '2026-01-01') as lib,
       tests.account(tests.n(), :'sh', 'Renovasi', 'tabungan', 0, '2026-01-01') as ren,
       tests.account(tests.f(), :'fp', 'Celengan Farida', 'tabungan', 300000, '2026-01-01') as ftab \gset
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja'$q$, :'np'))
  as belanja \gset
-- Dompet sistem patungan Bersama (0135; biasanya dibuat malas oleh fungsi patungan).
select tests.raw_exec(format($q$insert into app.accounts (space_id, space_kind, name, pocket, wallet_type, opened_on,
  created_by) values (%L, 'shared', 'Patungan', 'patungan', 'cash', '2000-01-01', %L)$q$, :'sh', tests.n()));
select tests.owner_val(null, format($q$select id from app.accounts where space_id = %L and pocket = 'patungan'$q$, :'sh'))
  as pat \gset

-- Tulis baris tujuan sebagai dompetku_api (jalur fungsi DEFINER 0138), kembalikan id.
create function pg_temp.goal(p_uid uuid, p_space uuid, p_kind text, p_acc uuid, p_name text, p_target bigint,
  p_on date default null) returns uuid
language sql as $$
  select tests.api_val(p_uid, format($q$insert into app.goals (space_id, space_kind, account_id, name, target_amount,
      target_on, created_by, updated_by) values (%L, %L, %L, %L, %s, %L::date, %L, %L) returning id$q$,
    p_space, p_kind, p_acc, p_name, p_target, p_on, p_uid, p_uid))::uuid
$$;
-- Ganti status (cap waktu ikut CHECK status <-> cap waktu); kembalikan jumlah baris.
create function pg_temp.status(p_uid uuid, p_goal uuid, p_status text) returns bigint
language sql as $$
  select tests.api_exec(p_uid, format($q$update app.goals set status = %1$L,
      completed_at = case %1$L when 'active' then null when 'completed' then app.now() else completed_at end,
      archived_at = case %1$L when 'archived' then app.now() end,
      updated_by = %2$L, updated_at = app.now() where id = %3$L$q$, p_status, p_uid, p_goal))
$$;
create function pg_temp.set_on(p_goal uuid, p_on date) returns bigint
language sql as $$
  select tests.api_exec(tests.n(), format($q$update app.goals set target_on = %L::date where id = %L$q$, p_on, p_goal))
$$;
-- Progres: saldo/terkumpul/sisa/persen/tercapai/periode/per periode ('-' = NULL).
create function pg_temp.p(p_uid uuid, p_goal uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select balance || '/' || saved || '/' || remaining || '/' || pct || '/'
      || reached || '/' || coalesce(periods_left::text, '-') || '/' || coalesce(per_period::text, '-')
    from app.goal_progress where goal_id = %L$q$, p_goal))
$$;
create function pg_temp.call(p_sql text) returns jsonb
language sql as $$ select tests.web_val(tests.n(), p_sql)::jsonb $$;
create function pg_temp.xfer(p_from uuid, p_to uuid, p_amount bigint, p_on date default '2026-03-05') returns uuid
language sql as $$
  select (pg_temp.call(format($q$select api.create_transfer(gen_random_uuid(),
      (select space_id from app.accounts where id = %1$L), %1$L, %2$L, %3$s, 0, %4$L::date)$q$,
    p_from, p_to, p_amount, p_on)) ->> 'entry_id')::uuid
$$;
create function pg_temp.void(p_entry uuid) returns jsonb
language sql as $$
  select pg_temp.call(format($q$select api.void_entry(gen_random_uuid(), %L,
    (select version from app.entries where id = %L), true)$q$, p_entry, p_entry))
$$;
create function pg_temp.restore(p_entry uuid) returns jsonb
language sql as $$
  select pg_temp.call(format($q$select api.restore_entry(gen_random_uuid(), %L,
    (select version from app.entries where id = %L), true)$q$, p_entry, p_entry))
$$;
-- I6: kategori, anggaran, Σ pemasukan/pengeluaran (Pribadi Novanda); p_all menambah aman dipakai dan
-- kekayaan bersih (keduanya memang bergeser saat uang pindah dari operasional ke tabungan).
create function pg_temp.i6(p_all boolean default false) returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select
      (select coalesce(string_agg(kind || ':' || coalesce(name, '-') || ':' || amount, ',' order by kind, name collate "C"), '')
         from api.category_summary(%1$L, '2026-03-01', '2026-03-31'))
      || '|' || (select coalesce(string_agg(category_id || ':' || spent || ':' || remaining, ',' order by category_id), '')
         from api.budget_progress(%1$L, '2026-03-01'))
      || '|' || (select coalesce(sum(amount), 0) from app.report_lines
                  where space_id = %1$L and report_class in ('income', 'expense', 'expense_fee'))
      || case when %2$L then '|' || (select s::text from api.safe_to_spend(%1$L, '2026-03-20') s)
                         || '|' || (select w::text from api.net_worth(%1$L) w) else '' end$q$,
    tests.space_id(tests.n(), 'personal'), p_all))
$$;

-- ===== Skema =====
select has_table('app', 'goals', 'tabel app.goals ada');
select is((select indexdef from pg_indexes where schemaname = 'app' and indexname = 'goals_one_active_per_account'),
  'CREATE UNIQUE INDEX goals_one_active_per_account ON app.goals USING btree (account_id) WHERE (status = ''active''::text)',
  'indeks unik parsial: satu tujuan aktif per dompet [T11]');
select ok((select 'security_invoker=true' = any (c.reloptions) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname = 'goal_progress'), 'app.goal_progress security_invoker');
select is((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
           from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname = 'goal_progress' and a.attnum > 0),
  'space_id:uuid,goal_id:uuid,account_id:uuid,status:text,target_amount:bigint,target_on:date,balance:bigint,saved:bigint,remaining:bigint,pct:integer,reached:boolean,periods_left:integer,per_period:bigint',
  'kolom app.goal_progress (kontrak Task 3/4)');
select ok((select not p.prosecdef and p.proowner = 'dompetku_owner'::regrole
           from pg_trigger g join pg_proc p on p.oid = g.tgfoid
           join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname = 'goals' and g.tgname = 'goal_guard'),
  'trigger goal_guard memakai private.tg_goal_guard INVOKER milik owner');

-- Pengeluaran berkategori + anggaran sebagai pembanding I6.
select pg_temp.call(format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 150000, %L,
  '2026-03-03', null)$$, :'np', :'bca', :'belanja'));
select tests.web_val(tests.n(), format($$select api.set_budget(%L, %L, '2026-03-01', 500000, false)$$, :'np', :'belanja'));

-- ===== Satu tujuan aktif per dompet (K9a) =====
select pg_temp.goal(tests.n(), :'np', 'personal', :'tab', 'Laptop', 5000000) as g1 \gset
select is(tests.web_val(tests.n(), format($$select status || '/' || (completed_at is null) || '/' || (archived_at is null)
    || '/' || (created_by = %L) from app.goals where id = %L$$, tests.n(), :'g1')),
  'active/true/true/true', 'tujuan baru aktif, tanpa cap selesai/arsip');
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'personal', %L, 'Motor', 9000000)$$, :'np', :'tab'),
  '23505', null, 'tujuan aktif kedua pada dompet sama ditolak indeks unik [T11]');
select is(pg_temp.status(tests.n(), :'g1', 'completed'), 1::bigint, 'tujuan diselesaikan');
select lives_ok(format($$select pg_temp.goal(tests.n(), %L, 'personal', %L, 'Motor', 9000000)$$, :'np', :'tab'),
  'sesudah selesai, dompet boleh punya tujuan aktif baru');
select tests.web_val(tests.n(), format($$select id from app.goals where account_id = %L and status = 'active'$$, :'tab'))
  as g2 \gset
select throws_ok(format($$select pg_temp.status(tests.n(), %L, 'active')$$, :'g1'), '23505', null,
  'mengaktifkan lagi tujuan lama saat dompet punya tujuan aktif lain ditolak [T11]');
select is(pg_temp.status(tests.n(), :'g2', 'archived'), 1::bigint, 'tujuan aktif diarsipkan');
select is(pg_temp.status(tests.n(), :'g1', 'active'), 1::bigint, 'sesudah arsip, tujuan lama boleh aktif lagi');
select is(pg_temp.status(tests.n(), :'g1', 'completed') + pg_temp.status(tests.n(), :'g1', 'archived'), 2::bigint,
  'tujuan selesai lalu diarsipkan');
select is(tests.web_val(tests.n(), format($$select (completed_at is not null) || '/' || (archived_at is not null)
    from app.goals where id = %L$$, :'g1')), 'true/true', 'arsip sesudah selesai menyimpan cap selesai');
select is(tests.web_val(tests.n(), format($$select count(*) from app.goals where account_id = %L$$, :'tab')), '2',
  'riwayat tujuan dompet tetap tersimpan (tanpa hapus fisik)');

-- ===== CHECK =====
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'personal', %L, '   ', 1000)$$, :'np', :'kos'),
  '23514', null, 'nama kosong sesudah btrim ditolak');
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'personal', %L, repeat('a', 61), 1000)$$, :'np', :'kos'),
  '23514', null, 'nama > 60 karakter ditolak');
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'personal', %L, 'X', 0)$$, :'np', :'kos'),
  '23514', null, 'target 0 ditolak');
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'personal', %L, 'X', 10000000000001)$$, :'np', :'kos'),
  '23514', null, 'target > 10^13 ditolak');
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'personal', %L, 'X', 1000, '1999-12-31')$$, :'np', :'kos'),
  '23514', null, 'tanggal target sebelum 2000 ditolak');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$update app.goals set status = 'selesai' where id = %L$q$)$$,
  :'g1'), '23514', null, 'status di luar active/completed/archived ditolak');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$update app.goals set status = 'completed', completed_at = null,
  archived_at = null where id = %L$q$)$$, :'g1'), '23514', null, 'completed tanpa completed_at ditolak');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$update app.goals set status = 'active', completed_at = null
  where id = %L$q$)$$, :'g1'), '23514', null, 'active dengan archived_at ditolak');
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'shared', %L, 'X', 1000)$$, :'np', :'dd'),
  '23503', null, 'space_kind wajib cocok dengan ruang (FK)');

-- ===== Penjaga: hanya pocket tabungan, ruang sama, dompet aktif (K3) =====
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'personal', %L, 'X', 1000)$$, :'np', :'bca'),
  'DK422', 'goal_pocket_invalid', 'dompet operasional Pribadi ditolak');
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'personal', %L, 'X', 1000)$$, :'np', :'kan'),
  'DK422', 'goal_pocket_invalid', 'dompet Kantor ditolak');
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'personal', %L, 'X', 1000)$$, :'np', :'tr'),
  'DK422', 'goal_pocket_invalid', 'dompet trading ditolak');
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'shared', %L, 'X', 1000)$$, :'sh', :'kas'),
  'DK422', 'goal_pocket_invalid', 'dompet operasional Bersama ditolak');
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'shared', %L, 'X', 1000)$$, :'sh', :'pat'),
  'DK422', 'goal_pocket_invalid', 'dompet sistem patungan ditolak');
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'personal', %L, 'X', 1000)$$, :'np', :'lib'),
  'DK404', 'account_not_found', 'dompet ruang lain (Bersama untuk tujuan Pribadi) = DK404');
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'personal', %L, 'X', 1000)$$, :'np', :'ftab'),
  'DK404', 'account_not_found', 'dompet Pribadi pasangan = DK404 seragam [B22]');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$update app.goals set account_id = %L where id = %L$q$)$$,
  :'kos', :'g1'), 'DK422', 'goal_immutable', 'dompet tujuan tidak bisa diganti');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$update app.goals set space_id = %L, space_kind = 'shared'
  where id = %L$q$)$$, :'sh', :'g1'), 'DK422', 'goal_immutable', 'ruang tujuan tidak bisa diganti');
-- Dompet terarsip (saldo 0): tujuan aktif baru dan pengaktifan ulang ditolak; tujuan selesai boleh tetap ada.
select pg_temp.goal(tests.n(), :'np', 'personal', :'kos', 'Lama', 1000) as g_kos \gset
select pg_temp.status(tests.n(), :'g_kos', 'completed');
select pg_temp.call(format($$select api.archive_account(%L)$$, :'kos'));
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'personal', %L, 'Baru', 1000)$$, :'np', :'kos'),
  'DK422', 'account_archived', 'tujuan aktif baru di dompet terarsip ditolak');
select throws_ok(format($$select pg_temp.status(tests.n(), %L, 'active')$$, :'g_kos'),
  'DK422', 'account_archived', 'tujuan selesai di dompet terarsip tidak bisa diaktifkan lagi');
select is(pg_temp.status(tests.n(), :'g_kos', 'archived'), 1::bigint,
  'tujuan selesai di dompet terarsip tetap bisa diarsipkan');
select is(tests.api_exec(tests.n(), format($$update app.goals set name = 'Laptop baru', target_amount = 6000000
  where id = %L$$, :'g1')), 1::bigint, 'nama dan target boleh diubah');

-- ===== Progres = saldo dompet saat ini (K2, K9b) =====
select pg_temp.goal(tests.n(), :'np', 'personal', :'tab', 'Kamera', 5000000) as g \gset
select is(pg_temp.p(tests.n(), :'g'), '1000000/1000000/4000000/20/false/-/-',
  'saldo awal ikut progres; tanpa tanggal target = tanpa laju [T11]');
select pg_temp.xfer(:'bca', :'tab', 1500000) as dep \gset
select is(pg_temp.p(tests.n(), :'g'), '2500000/2500000/2500000/50/false/-/-', 'setor (transfer masuk) menambah progres');
select pg_temp.void(:'dep');
select is(pg_temp.p(tests.n(), :'g'), '1000000/1000000/4000000/20/false/-/-', 'batal setor: progres kembali tepat sekali');
select pg_temp.restore(:'dep');
select is(pg_temp.p(tests.n(), :'g'), '2500000/2500000/2500000/50/false/-/-', 'pulihkan setor: progres naik tepat sekali');
select (pg_temp.call(format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 500000, %L, '2026-03-06', null)$$,
  :'np', :'tab', :'belanja')) ->> 'entry_id') as ex \gset
select is(pg_temp.p(tests.n(), :'g'), '2000000/2000000/3000000/40/false/-/-', 'pengeluaran dari dompet tabungan mengurangi progres');
select pg_temp.call(format($$select api.update_entry(gen_random_uuid(), %L, 1, %L, 200000, %L, null, null, false)$$,
  :'ex', :'tab', :'belanja'));
select is(pg_temp.p(tests.n(), :'g'), '2300000/2300000/2700000/46/false/-/-', 'ubah nominal pengeluaran menggeser progres tepat sekali');
select pg_temp.xfer(:'tab', :'bca', 300000, '2026-03-07');
select is(pg_temp.p(tests.n(), :'g'), '2000000/2000000/3000000/40/false/-/-', 'cairkan (transfer keluar) mengurangi progres');
select pg_temp.xfer(:'bca', :'tab', 3500000, '2026-03-08');
select is(pg_temp.p(tests.n(), :'g'), '5500000/5500000/0/100/true/-/-', 'saldo melebihi target: 100%, sisa 0, tercapai');
select is(tests.web_val(tests.n(), format($$select status from app.goals where id = %L$$, :'g')), 'active',
  'tercapai tidak mengubah status sendiri (K4)');
select pg_temp.xfer(:'tab', :'bca', 600000, '2026-03-09');
select is(pg_temp.p(tests.n(), :'g'), '4900000/4900000/100000/98/false/-/-',
  'saldo turun di bawah target: kembali belum tercapai, persen dibulatkan ke bawah');
-- Saldo negatif = progres 0; sisa tetap jarak ke target.
select pg_temp.goal(tests.n(), :'np', 'personal', :'mns', 'Minus', 1000000) as gm \gset
select pg_temp.call(format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 100000, %L, '2026-03-06',
  null, false, true)$$, :'np', :'mns', :'belanja'));
select is(pg_temp.p(tests.n(), :'gm'), '-100000/0/1100000/0/false/-/-', 'saldo negatif: terkumpul 0, 0%');
-- Cocokkan saldo (adjustment) ikut progres.
select pg_temp.call(format($$select api.reconcile_balance(gen_random_uuid(), %L, 250000)$$, :'mns'));
select is(pg_temp.p(tests.n(), :'gm'), '250000/250000/750000/25/false/-/-', 'Cocokkan saldo menggeser progres');

-- ===== Bersama (K1): setor dari Pribadi lewat space_transfer, semua anggota menulis =====
select pg_temp.goal(tests.f(), :'sh', 'shared', :'lib', 'Bali', 2000000) as gs \gset
select is(pg_temp.p(tests.n(), :'gs'), '0/0/2000000/0/false/-/-', 'tujuan Bersama yang dibuat Farida terbaca Novanda');
select pg_temp.xfer(:'bca', :'lib', 500000, '2026-03-10') as st \gset
select is(pg_temp.p(tests.f(), :'gs'), '500000/500000/1500000/25/false/-/-',
  'setor dari Pribadi ke dompet tabungan Bersama (space_transfer) menambah progres');
select pg_temp.void(:'st');
select is(pg_temp.p(tests.f(), :'gs'), '0/0/2000000/0/false/-/-', 'batal setor antar ruang: progres kembali');
select is(tests.api_exec(tests.n(), format($$update app.goals set name = 'Bali 2027', updated_by = %L where id = %L$$,
  tests.n(), :'gs')), 1::bigint, 'anggota lain boleh mengubah tujuan Bersama (K1)');

-- ===== Laju tabung per periode gajian (K5, K9d); sisa 4.000.000 =====
select pg_temp.i6(true) as i6_before \gset
select pg_temp.goal(tests.n(), :'np', 'personal', :'dd', 'Darurat', 5000000, '2026-03-24') as gd \gset
select is(pg_temp.i6(true), :'i6_before',
  'membuat tujuan tidak mengubah kategori, anggaran, Σ pemasukan/pengeluaran, aman dipakai, kekayaan bersih [I6]');
select is(pg_temp.p(tests.n(), :'gd'), '1000000/1000000/4000000/20/false/1/4000000',
  'hari terakhir periode berjalan: 1 periode, sisa penuh');
select pg_temp.set_on(:'gd', '2026-03-20');
select is(pg_temp.p(tests.n(), :'gd'), '1000000/1000000/4000000/20/false/1/4000000', 'tanggal target hari ini: 1 periode');
select pg_temp.set_on(:'gd', '2026-03-25');
select is(pg_temp.p(tests.n(), :'gd'), '1000000/1000000/4000000/20/false/2/2000000', 'hari pertama periode berikut: 2 periode');
select pg_temp.set_on(:'gd', '2026-04-23');
select is(pg_temp.p(tests.n(), :'gd'), '1000000/1000000/4000000/20/false/2/2000000',
  '23 Apr masih periode April (gajian 25 Apr Sabtu mundur ke 24 Apr)');
select pg_temp.set_on(:'gd', '2026-04-24');
select is(pg_temp.p(tests.n(), :'gd'), '1000000/1000000/4000000/20/false/3/1333334',
  '24 Apr = periode Mei: 3 periode, sisa tidak habis dibagi dibulatkan ke atas');
select pg_temp.set_on(:'gd', '2026-06-24');
select is(pg_temp.p(tests.n(), :'gd'), '1000000/1000000/4000000/20/false/4/1000000', 'sisa habis dibagi 4 periode');
select pg_temp.set_on(:'gd', '2026-03-19');
select is(pg_temp.p(tests.n(), :'gd'), '1000000/1000000/4000000/20/false/-/-',
  'tanggal target lewat: tanpa periode dan laju (UI: Lewat tanggal target)');
select tests.owner_exec(null, 'update app.households set payday_rule = null');
select pg_temp.set_on(:'gd', '2026-04-01');
select is(pg_temp.p(tests.n(), :'gd'), '1000000/1000000/4000000/20/false/2/2000000',
  'tanpa aturan gajian = bulan kalender: 1 Apr = periode kedua');
select tests.owner_exec(null, 'update app.households set payday_rule = 25');
select pg_temp.set_on(:'gd', null);
select is(pg_temp.p(tests.n(), :'gd'), '1000000/1000000/4000000/20/false/-/-', 'tanggal target dihapus: tanpa laju');
select pg_temp.set_on(:'gd', '2026-06-24');
select pg_temp.xfer(:'bca', :'dd', 4000000, '2026-03-11');
select is(pg_temp.p(tests.n(), :'gd'), '5000000/5000000/0/100/true/4/-', 'tercapai: tanpa laju');
select is(pg_temp.i6(), split_part(:'i6_before', '|', 1) || '|' || split_part(:'i6_before', '|', 2) || '|'
          || split_part(:'i6_before', '|', 3),
  'setor ke tujuan tidak mengubah kategori, anggaran, Σ pemasukan/pengeluaran [I6]');
select pg_temp.xfer(:'dd', :'bca', 4000000, '2026-03-12');
-- Batas hari WIB: 24 Mar 23:59 WIB masih periode Maret; 25 Mar 00:30 WIB (= 24 Mar 17:30 UTC) periode April.
select pg_temp.set_on(:'gd', '2026-03-24');
select tests.clock_at('2026-03-24 23:59+07');
select is(pg_temp.p(tests.n(), :'gd'), '1000000/1000000/4000000/20/false/1/4000000', '24 Mar 23:59 WIB: 1 periode');
select tests.clock_at('2026-03-24 17:30+00');
select is(pg_temp.p(tests.n(), :'gd'), '1000000/1000000/4000000/20/false/-/-',
  '25 Mar 00:30 WIB (17:30 UTC tanggal 24): tanggal target sudah lewat (jam app.now(), zona WIB)');
select pg_temp.set_on(:'gd', '2026-04-23');
select is(pg_temp.p(tests.n(), :'gd'), '1000000/1000000/4000000/20/false/1/4000000',
  'periode berjalan ikut jam tiruan: 23 Apr = 1 periode dari 25 Mar');
select tests.clock_at('2026-03-20 10:00+07');

select is(pg_temp.i6(true), :'i6_before',
  'setor lalu cairkan tujuan: semua angka uang kembali sama, termasuk aman dipakai dan kekayaan bersih [I6]');

-- ===== Isolasi dan hak (B1, B22) =====
select is(tests.web_val(tests.f(), format($$select count(*) from app.goals where space_id = %L$$, :'np')), '0',
  'Farida tidak melihat tujuan Pribadi Novanda [B1] [B22]');
select is(tests.web_val(tests.f(), format($$select count(*) from app.goal_progress where space_id = %L$$, :'np')), '0',
  'Farida tidak melihat progres tujuan Pribadi Novanda [B22]');
select is(tests.web_val(tests.x(), 'select count(*) from app.goals') || '/'
          || tests.web_val(tests.x(), 'select count(*) from app.goal_progress'), '0/0',
  'Luar tidak melihat tujuan apa pun [B22]');
select is(tests.api_exec(tests.f(), format($$update app.goals set name = 'Diretas' where id = %L$$, :'g')), 0::bigint,
  'dompetku_api atas nama Farida tidak bisa mengubah tujuan Pribadi Novanda [B22]');
select throws_ok(format($$select tests.api_val(tests.f(), $q$insert into app.goals (space_id, space_kind, account_id, name,
    target_amount, created_by, updated_by) values (%L, 'personal', %L, 'X', 1000, %L, %L) returning id$q$)$$,
    :'np', :'dd', tests.f(), tests.f()),
  'DK404', 'account_not_found', 'Farida tidak bisa menulis tujuan di Pribadi Novanda (DK404 seragam) [B22]');
select throws_ok(format($$select tests.api_val(tests.f(), $q$insert into app.goals (space_id, space_kind, account_id, name,
    target_amount, created_by, updated_by) values (%L, 'personal', %L, 'X', 1000, %L, %L) returning id$q$)$$,
    :'np', :'ftab', tests.f(), tests.f()),
  'DK404', 'account_not_found', 'dompet sendiri dengan ruang orang lain juga DK404 (bukan bocoran) [B22]');
select throws_ok(format($$select tests.web_exec(tests.n(), $q$insert into app.goals (space_id, space_kind, account_id, name,
    target_amount, created_by, updated_by) values (%L, 'personal', %L, 'X', 1000, %L, %L)$q$)$$,
    :'np', :'dd', tests.n(), tests.n()),
  '42501', null, 'dompetku_web tidak bisa INSERT langsung');
select throws_ok(format($$select tests.web_exec(tests.n(), $q$update app.goals set name = 'X' where id = %L$q$)$$, :'g'),
  '42501', null, 'dompetku_web tidak bisa UPDATE langsung');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$delete from app.goals where id = %L$q$)$$, :'g'),
  '42501', null, 'tanpa DELETE (tujuan tidak pernah dihapus fisik)');
select throws_ok($$select tests.worker_val(null, 'select count(*) from app.goals')$$, '42501', null,
  'worker tidak membaca tujuan');
select is(tests.web_val(tests.n(), format($$select pct from app.goal_progress where goal_id = %L$$, :'gs'))
          || '/' || tests.web_val(tests.f(), format($$select pct from app.goal_progress where goal_id = %L$$, :'gs')),
  '0/0', 'progres tujuan Bersama sama untuk kedua anggota');

-- ===== Tanggal target sangat jauh (review DB S13) dan perkiraan baris fungsi periode =====
-- pay_period menghitung date + interval: tanggal di luar rentang timestamp merusak seluruh daftar ruang.
savepoint jauh;
select tests.account(tests.n(), :'np', 'Jauh 1', 'tabungan', 0, '2026-01-01') as j1,
       tests.account(tests.n(), :'np', 'Jauh 2', 'tabungan', 0, '2026-01-01') as j2 \gset
select pg_temp.goal(tests.n(), :'np', 'personal', :'j1', 'Pensiun', 1000, '2100-12-31') as gj \gset
select ok(tests.web_val(tests.n(), format($$select periods_left > 0 from app.goal_progress where goal_id = %L$$, :'gj'))::boolean,
  'tanggal target 2100-12-31 diterima tabel dan progresnya terbaca');
select throws_ok(format($$select pg_temp.goal(tests.n(), %L, 'personal', %L, 'X', 1000, '2101-01-01')$$, :'np', :'j2'),
  '23514', null, 'tanggal target > 2100-12-31 ditolak CHECK');
rollback to savepoint jauh;
-- Fungsi periode selalu satu baris; perkiraan bawaan 1000 baris membuat kueri app.goal_progress melewati
-- ambang JIT (ratusan ms per kueri).
select is((select string_agg(n.nspname || '.' || p.proname || ':' || p.prorows, ',' order by n.nspname, p.proname collate "C")
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where (n.nspname, p.proname) in (('app', 'pay_period'), ('app', 'period_of_label'), ('api', 'pay_period'))),
  'api.pay_period:1,app.pay_period:1,app.period_of_label:1', 'fungsi periode diperkirakan satu baris (ROWS 1)');

-- ===== purge_unfinished_users tidak terhalang FK created_by/updated_by =====
-- Akun setengah jadi (tanpa profil) disuntik langsung: batas 2 pengguna berprofil sudah penuh.
select tests.raw_exec(format($q$insert into auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
  values (%L, 'U', 'x@example.test', true, '2026-03-10 10:00+07', '2026-03-10 10:00+07')$q$, tests.x()));
select throws_ok(format($$select pg_temp.goal(tests.x(), %L, 'shared', %L, 'X', 1000)$$, :'sh', :'ren'),
  'DK404', 'account_not_found', 'akun tanpa profil (bukan anggota) tidak bisa menjadi pembuat tujuan');
select is(tests.worker_val(null, 'select jobs.purge_unfinished_users()'), '1',
  'akun setengah jadi dihapus walau tabel tujuan berisi baris');
select is(tests.owner_val(null, $q$select count(*) || '/' || count(*) filter (where
    exists (select 1 from app.profiles p where p.user_id = g.created_by)
    and exists (select 1 from app.profiles p where p.user_id = g.updated_by)) from app.goals g$q$),
  '7/7', 'semua tujuan dibuat dan diubah pengguna berprofil (tidak pernah dipurge)');

select * from finish();
rollback;
