-- Tujuan tabungan S13 sisi API (0138; plan S13 Task 3, K1, K4, K6, K7, K9 = bagian T11; bingkai S13-TJ2,
-- TJ6 sampai TJ12): api.create_goal (idempoten client_id, hash dari nilai bersih; 23505 indeks = DK409
-- goal_exists; tanggal target lampau = goal_target_past), api.update_goal (nama, target, tanggal; tanggal
-- lampau ditolak hanya bila tanggal berubah; dompet tidak bisa diganti), api.complete_goal (hanya aktif dan
-- tercapai; belum = goal_not_reached), api.archive_goal, api.restore_goal (goal_exists / account_archived),
-- api.list_goals dan api.goal_for_account (INVOKER, angka = app.goal_progress), api.archive_account pengganti
-- (tujuan aktif = account_has_goal sebelum cek saldo; perilaku lama tetap). Setiap fungsi: sukses, validasi
-- gagal (nol efek), rollback utuh (kegagalan disuntik), idempotensi, bukan anggota. K1: anggota Bersama kedua
-- membuat/mengubah/menyelesaikan/mengarsipkan/memulihkan; Luar dan pasangan (Pribadi) DK404 seragam. Galat
-- tanpa nominal dan nama. I6: angka uang lain tidak berubah oleh tujuan. Paralel di 99_konkurensi.
-- Jam dipatok 2026-03-20 WIB (periode gajian payday_rule 25 berjalan = 25 Feb sampai 24 Mar).
-- ID: T11, B1, B22, I6
begin;
select plan(96);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');
select tests.owner_exec(null, 'update app.households set payday_rule = 25');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 20000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Celengan', 'tabungan', 1000000, '2026-01-01') as tab,
       tests.account(tests.n(), :'np', 'Dana Darurat', 'tabungan', 0, '2026-01-01') as dd,
       tests.account(tests.n(), :'np', 'Kosong', 'tabungan', 0, '2026-01-01') as kos,
       tests.account(tests.n(), :'np', 'Emas', 'tabungan', 0, '2026-01-01') as ems,
       tests.account(tests.n(), :'np', 'Lama', 'tabungan', 0, '2026-01-01') as lama,
       tests.account(tests.n(), :'np', 'Dana', 'operasional', 1000, '2026-01-01') as dana,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 0, '2026-01-01') as kan,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 2000000, '2026-01-01') as kas,
       tests.account(tests.n(), :'sh', 'Liburan', 'tabungan', 0, '2026-01-01') as lib,
       tests.account(tests.n(), :'sh', 'Renovasi', 'tabungan', 0, '2026-01-01') as ren,
       tests.account(tests.n(), :'sh', 'Motor', 'tabungan', 0, '2026-01-01') as mob,
       tests.account(tests.n(), :'sh', 'Rumah', 'tabungan', 0, '2026-01-01') as rum,
       tests.account(tests.n(), :'sh', 'Televisi', 'tabungan', 0, '2026-01-01') as tv,
       tests.account(tests.f(), :'fp', 'Celengan Farida', 'tabungan', 300000, '2026-01-01') as ftab \gset
select tests.web_val(tests.n(), format($$select api.archive_account(%L)$$, :'lama'));
-- Luar = akun terautentikasi tanpa profil dan tanpa ruang (disuntik: batas 2 pengguna berprofil sudah penuh).
select tests.raw_exec(format($q$insert into auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
  values (%L, 'U', 'x@example.test', true, now(), now())$q$, tests.x()));
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja'$q$, :'np'))
  as belanja \gset

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
create function pg_temp.cg_sql(p_space uuid, p_acc uuid, p_name text, p_target bigint, p_on date default null,
  p_client uuid default null) returns text
language sql as $$
  select format($q$select api.create_goal(%L, %L, %L, %L, %L::bigint, %L::date)$q$,
    coalesce(p_client, gen_random_uuid()), p_space, p_acc, p_name, p_target, p_on)
$$;
create function pg_temp.cg(p_uid uuid, p_space uuid, p_acc uuid, p_name text, p_target bigint, p_on date default null)
returns uuid
language sql as $$ select (pg_temp.call(p_uid, pg_temp.cg_sql(p_space, p_acc, p_name, p_target, p_on)) ->> 'goal_id')::uuid $$;
create function pg_temp.upd_sql(p_goal uuid, p_name text, p_target bigint, p_on date) returns text
language sql as $$
  select format($q$select api.update_goal(%L, %L, %L::bigint, %L::date)$q$, p_goal, p_name, p_target, p_on)
$$;
create function pg_temp.op_sql(p_fn text, p_id uuid) returns text
language sql as $$ select format($q$select api.%s(%L)$q$, p_fn, p_id) $$;
create function pg_temp.op(p_uid uuid, p_fn text, p_id uuid) returns jsonb
language sql as $$ select pg_temp.call(p_uid, pg_temp.op_sql(p_fn, p_id)) $$;
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
-- Keadaan tujuan (owner): status|nama|target|tanggal|selesai?|arsip?|pembuat|pengubah.
create function pg_temp.g(p_goal uuid) returns text
language sql as $$
  select tests.owner_val(null, format($q$select status || '|' || name || '|' || target_amount || '|'
      || coalesce(target_on::text, '-') || '|' || (completed_at is not null) || '|' || (archived_at is not null) || '|'
      || case created_by when %1$L then 'N' when %2$L then 'F' end || '|'
      || case updated_by when %1$L then 'N' when %2$L then 'F' end
    from app.goals where id = %3$L$q$, tests.n(), tests.f(), p_goal))
$$;
create function pg_temp.xfer(p_from uuid, p_to uuid, p_amount bigint) returns uuid
language sql as $$
  select (pg_temp.call(tests.n(), format($q$select api.create_transfer(gen_random_uuid(),
      (select space_id from app.accounts where id = %1$L), %1$L, %2$L, %3$s, 0, '2026-03-10')$q$,
    p_from, p_to, p_amount)) ->> 'entry_id')::uuid
$$;
create function pg_temp.n_goals() returns text
language sql as $$
  select tests.owner_val(null, $q$select (select count(*) from app.goals) || '/' || (select count(*) from app.idempotency_keys)$q$)
$$;
-- I6 Pribadi Novanda: period_summary Maret (semua kelas), anggaran, aman dipakai, kekayaan bersih.
create function pg_temp.i6() returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select
      (select coalesce(string_agg(report_class || ':' || inflow || ':' || outflow || ':' || entry_count, ','
                                  order by report_class collate "C"), '')
         from api.period_summary(%1$L, '2026-03-01', '2026-03-31'))
      || '|' || (select coalesce(string_agg(category_id || ':' || spent || ':' || remaining, ',' order by category_id), '')
         from api.budget_progress(%1$L, '2026-03-01'))
      || '|' || (select s::text from api.safe_to_spend(%1$L, '2026-03-20') s)
      || '|' || (select w::text from api.net_worth(%1$L) w)$q$, tests.space_id(tests.n(), 'personal')))
$$;
-- Bagian I6 yang tidak boleh bergeser oleh transfer apa pun: Σ pemasukan/pengeluaran, anggaran, total kekayaan bersih.
create function pg_temp.i6_core() returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select
      (select coalesce(string_agg(report_class || ':' || inflow || ':' || outflow, ',' order by report_class collate "C"), '')
         from api.period_summary(%1$L, '2026-03-01', '2026-03-31') where report_class in ('income', 'expense', 'expense_fee'))
      || '|' || (select coalesce(string_agg(category_id || ':' || spent || ':' || remaining, ',' order by category_id), '')
         from api.budget_progress(%1$L, '2026-03-01'))
      || '|' || (select w.total::text from api.net_worth(%1$L) w)$q$, tests.space_id(tests.n(), 'personal')))
$$;
-- Argumen identitas (p_args) atau kolom hasil fungsi api.* (katalog; dompetku_test tanpa USAGE skema api).
create function pg_temp.fn(p_name text, p_args boolean) returns text
language sql as $$
  select case when p_args then pg_get_function_identity_arguments(p.oid) else pg_get_function_result(p.oid) end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname = p_name
$$;
create function pg_temp.dq17() returns text
language sql as $$ select tests.worker_val(null, $q$select violations from jobs.dq_reconcile() where check_id = 'DQ17'$q$) $$;

-- Pengeluaran berkategori + anggaran sebagai pembanding I6.
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 150000, %L,
  '2026-03-03', null)$$, :'np', :'bca', :'belanja'));
select tests.web_val(tests.n(), format($$select api.set_budget(%L, %L, '2026-03-01', 500000, false)$$, :'np', :'belanja'));

-- ===== Kontrak fungsi (Task 4) =====
select is(pg_temp.fn('create_goal', true),
  'p_client_id uuid, p_space_id uuid, p_account_id uuid, p_name text, p_target_amount bigint, p_target_on date',
  'tanda tangan api.create_goal');
select is(pg_temp.fn('update_goal', true),
  'p_goal_id uuid, p_name text, p_target_amount bigint, p_target_on date',
  'tanda tangan api.update_goal: tanpa dompet (dompet tidak bisa diganti, K7)');
select is(pg_temp.fn('list_goals', false),
  'TABLE(goal_id uuid, name text, account_id uuid, account_name text, account_archived boolean, status text, '
  || 'target_amount bigint, target_on date, completed_at timestamp with time zone, archived_at timestamp with time zone, '
  || 'created_by uuid, created_at timestamp with time zone, balance bigint, saved bigint, remaining bigint, pct integer, '
  || 'reached boolean, periods_left integer, per_period bigint, account_has_other_active boolean)',
  'kolom api.list_goals');
select is(pg_temp.fn('goal_for_account', false),
  pg_temp.fn('list_goals', false), 'api.goal_for_account = kolom list_goals');

-- ===== create_goal =====
select pg_temp.i6() as i6_0, pg_temp.i6_core() as core_0 \gset
select pg_temp.call(tests.n(), pg_temp.cg_sql(:'np', :'dd', '  Laptop  ', 5000000, '2026-06-30',
  'aaaaaaaa-0000-0000-0000-000000000001')) as r1 \gset
select is((:'r1')::jsonb - 'goal_id', '{"status": "active", "replayed": false}'::jsonb, 'create_goal: hasil');
select :'r1'::jsonb ->> 'goal_id' as g1 \gset
select is(pg_temp.g(:'g1'), 'active|Laptop|5000000|2026-06-30|false|false|N|N', 'create_goal: nama di-trim, tanpa cap');
select is(tests.owner_val(null, format($$select (created_at = app.now()) || '/' || (updated_at = app.now()) || '/' || space_kind
    from app.goals where id = %L$$, :'g1')), 'true/true/personal', 'cap waktu dari jam DB (app.now), jenis ruang dari ruang');
select is(pg_temp.call(tests.n(), pg_temp.cg_sql(:'np', :'dd', 'Laptop', 5000000, '2026-06-30',
    'aaaaaaaa-0000-0000-0000-000000000001')), (:'r1')::jsonb || '{"replayed": true}',
  'client_id sama (nama sama sesudah trim) = putar ulang, tujuan sama');
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'np', :'dd', 'Laptop', 6000000, '2026-06-30',
    'aaaaaaaa-0000-0000-0000-000000000001')), 'DK410:idempotency_key_reused:', 'client_id sama, isi beda = DK410');
select is(pg_temp.n_goals(), '1/' || tests.owner_val(null, 'select count(*) from app.idempotency_keys'),
  'satu tujuan, putar ulang tidak menulis');
select pg_temp.n_goals() as n0 \gset
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'np', :'ems', '   ', 1000)), 'DK400:invalid_argument:name', 'nama kosong');
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'np', :'ems', repeat('a', 61), 1000)), 'DK400:invalid_argument:name',
  'nama > 60');
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'np', :'ems', 'X', 0)), 'DK400:invalid_argument:target_amount', 'target 0');
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'np', :'ems', 'X', 10000000000001)), 'DK400:invalid_argument:target_amount',
  'target > 10^13');
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'np', :'ems', 'X', null)), 'DK400:invalid_argument:target_amount',
  'target kosong');
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'np', :'ems', 'X', 1000, '2026-03-19')), 'DK422:goal_target_past:target_on',
  'tanggal target kemarin (WIB) ditolak');
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'np', null, 'X', 1000)), 'DK400:invalid_argument:account_id',
  'dompet kosong');
select is(pg_temp.err(tests.n(), format($$select api.create_goal(null, %L, %L, 'X', 1000)$$, :'np', :'ems')),
  'DK400:invalid_argument:client_id', 'client_id kosong');
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'np', :'dd', 'Motor', 9000000)), 'DK409:goal_exists:',
  'tujuan aktif kedua di dompet sama = goal_exists, tanpa nama/nominal [T11]');
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'np', :'bca', 'X', 1000)), 'DK422:goal_pocket_invalid:',
  'dompet operasional ditolak (K3)');
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'np', :'kan', 'X', 1000)), 'DK422:goal_pocket_invalid:', 'Kas Kantor ditolak');
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'np', :'lama', 'X', 1000)), 'DK422:account_archived:', 'dompet terarsip ditolak');
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'np', :'lib', 'X', 1000)), 'DK404:account_not_found:',
  'dompet ruang lain (Bersama) dengan ruang Pribadi = DK404');
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'np', :'ftab', 'X', 1000)), 'DK404:account_not_found:',
  'dompet Pribadi pasangan = DK404 seragam, tanpa nama/nominal [B22]');
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'fp', :'ftab', 'X', 1000)), 'DK404:space_not_found:',
  'ruang Pribadi pasangan = DK404 [B22]');
select is(pg_temp.err(tests.x(), pg_temp.cg_sql(:'sh', :'lib', 'X', 1000)), 'DK404:space_not_found:', 'Luar = DK404');
select is(pg_temp.err(null, pg_temp.cg_sql(:'np', :'ems', 'X', 1000)), 'DK401:unauthenticated:', 'tanpa pengguna = DK401');
select is(pg_temp.n_goals(), :'n0', 'semua penolakan nol efek (tujuan dan kunci idempotensi)');

-- ===== K1: Bersama, semua anggota menulis =====
select pg_temp.cg(tests.f(), :'sh', :'lib', 'Bali', 2000000, '2026-03-20') as gl \gset
select is(pg_temp.g(:'gl'), 'active|Bali|2000000|2026-03-20|false|false|F|F',
  'Farida (anggota kedua) membuat tujuan Bersama; tanggal hari ini boleh (K1)');
select is(pg_temp.call(tests.n(), pg_temp.upd_sql(:'gl', 'Bali 2026', 1000000, '2026-03-20')) ->> 'goal_id', :'gl',
  'Novanda mengubah tujuan yang dibuat Farida');
select is(pg_temp.g(:'gl'), 'active|Bali 2026|1000000|2026-03-20|false|false|F|N', 'pembuat tetap, pengubah tercatat');
select is(tests.web_val(tests.n(), format($$select count(*) from api.list_goals(%L)$$, :'sh')) || '/'
          || tests.web_val(tests.f(), format($$select count(*) from api.list_goals(%L)$$, :'sh')), '1/1',
  'tujuan Bersama terbaca kedua anggota');
select is(pg_temp.err(tests.x(), pg_temp.upd_sql(:'gl', 'X', 1000, null)) || ' '
          || pg_temp.err(tests.x(), pg_temp.op_sql('complete_goal', :'gl')) || ' '
          || pg_temp.err(tests.x(), pg_temp.op_sql('archive_goal', :'gl')) || ' '
          || pg_temp.err(tests.x(), pg_temp.op_sql('restore_goal', :'gl')),
  'DK404:goal_not_found: DK404:goal_not_found: DK404:goal_not_found: DK404:goal_not_found:', 'Luar tidak bisa menulis');
select is(pg_temp.err(tests.f(), pg_temp.upd_sql(:'g1', 'X', 1000, null)) || ' '
          || pg_temp.err(tests.f(), pg_temp.op_sql('complete_goal', :'g1')) || ' '
          || pg_temp.err(tests.f(), pg_temp.op_sql('archive_goal', :'g1')) || ' '
          || pg_temp.err(tests.f(), pg_temp.op_sql('restore_goal', :'g1')),
  'DK404:goal_not_found: DK404:goal_not_found: DK404:goal_not_found: DK404:goal_not_found:',
  'tujuan Pribadi pasangan tidak bisa ditulis, galat seragam [B22]');
select is(pg_temp.g(:'g1'), 'active|Laptop|5000000|2026-06-30|false|false|N|N', 'tujuan Pribadi tidak berubah [B22]');
select is(pg_temp.err(tests.f(), format($$select count(*) from api.list_goals(%L)$$, :'np')) || ' '
          || pg_temp.err(tests.f(), format($$select count(*) from api.goal_for_account(%L)$$, :'dd')) || ' '
          || pg_temp.err(tests.x(), format($$select count(*) from api.list_goals(%L)$$, :'sh')),
  'DK404:space_not_found: DK404:space_not_found: DK404:space_not_found:',
  'baca tujuan Pribadi pasangan / Bersama oleh Luar = DK404 [B22]');
select is(pg_temp.err(tests.n(), pg_temp.op_sql('complete_goal', gen_random_uuid())), 'DK404:goal_not_found:',
  'tujuan tidak ada = DK404');

-- ===== update_goal =====
select is(pg_temp.call(tests.n(), pg_temp.upd_sql(:'g1', ' Laptop Kerja ', 6000000, '2026-07-31')),
  jsonb_build_object('goal_id', :'g1', 'status', 'active'), 'update_goal: hasil');
select is(pg_temp.g(:'g1'), 'active|Laptop Kerja|6000000|2026-07-31|false|false|N|N', 'nama, target, tanggal berubah');
select is(pg_temp.err(tests.n(), pg_temp.upd_sql(:'g1', 'Laptop Kerja', 6000000, '2026-07-31')) || ' ' || pg_temp.g(:'g1'),
  'ok active|Laptop Kerja|6000000|2026-07-31|false|false|N|N', 'ulang dengan isi sama = idempoten');
select is(pg_temp.err(tests.n(), pg_temp.upd_sql(:'g1', '', 6000000, null)) || ' '
          || pg_temp.err(tests.n(), pg_temp.upd_sql(:'g1', 'X', -1, null)) || ' '
          || pg_temp.err(tests.n(), pg_temp.upd_sql(:'g1', 'X', 1000, '2026-03-01')),
  'DK400:invalid_argument:name DK400:invalid_argument:target_amount DK422:goal_target_past:target_on',
  'validasi update_goal');
select is(pg_temp.g(:'g1'), 'active|Laptop Kerja|6000000|2026-07-31|false|false|N|N', 'validasi gagal = nol efek');
select is(pg_temp.err(tests.n(), pg_temp.upd_sql(:'g1', 'Laptop Kerja', 6000000, null)) || ' ' || pg_temp.g(:'g1'),
  'ok active|Laptop Kerja|6000000|-|false|false|N|N', 'tanggal target boleh dihapus');
select is(pg_temp.i6(), :'i6_0', 'membuat dan mengubah tujuan tidak mengubah angka uang [I6]');
-- Tujuan yang sudah lewat tanggal tetap bisa diganti nama/target (tanggal tidak berubah).
savepoint lewat;
select pg_temp.call(tests.n(), pg_temp.upd_sql(:'g1', 'Laptop Kerja', 6000000, '2026-03-25'));
select tests.clock_at('2026-04-10 10:00+07');
select is(pg_temp.err(tests.n(), pg_temp.upd_sql(:'g1', 'Laptop Murah', 4000000, '2026-03-25')) || ' ' || pg_temp.g(:'g1'),
  'ok active|Laptop Murah|4000000|2026-03-25|false|false|N|N',
  'tanggal lewat yang tidak diubah tidak menghalangi ganti nama/target (bingkai Dampak 2)');
select is(pg_temp.err(tests.n(), pg_temp.upd_sql(:'g1', 'Laptop Murah', 4000000, '2026-04-01')) || ' '
          || pg_temp.err(tests.n(), pg_temp.upd_sql(:'g1', 'Laptop Murah', 4000000, '2026-04-10')),
  'DK422:goal_target_past:target_on ok', 'mengganti ke tanggal lampau lain ditolak; hari ini boleh');
rollback to savepoint lewat;
select tests.clock_at('2026-03-20 10:00+07');

-- ===== complete_goal =====
select is(pg_temp.err(tests.n(), pg_temp.op_sql('complete_goal', :'g1')) || ' ' || pg_temp.g(:'g1'),
  'DK422:goal_not_reached: active|Laptop Kerja|6000000|-|false|false|N|N',
  'belum tercapai = goal_not_reached tanpa nominal, nol efek');
-- I6 + complete pada Celengan (saldo 1.000.000, target 1.300.000).
select pg_temp.cg(tests.n(), :'np', :'tab', 'Kamera', 1300000) as gt \gset
select is(pg_temp.i6(), :'i6_0', 'membuat tujuan kedua: angka uang sama [I6]');
savepoint tanpa_tujuan;
select pg_temp.op(tests.n(), 'archive_goal', :'gt');
select pg_temp.xfer(:'bca', :'tab', 500000);
select pg_temp.xfer(:'tab', :'bca', 200000);
select pg_temp.i6() as i6_cf \gset
rollback to savepoint tanpa_tujuan;
select pg_temp.xfer(:'bca', :'tab', 500000);
select pg_temp.xfer(:'tab', :'bca', 200000);
select is(pg_temp.i6(), :'i6_cf',
  'setor/cairkan dompet bertujuan = angka sama dengan dompet tanpa tujuan (period_summary, anggaran, aman dipakai, kekayaan bersih) [I6]');
select is(pg_temp.i6_core(), :'core_0', 'setor/cairkan tidak mengubah Σ pemasukan/pengeluaran, anggaran, kekayaan bersih [I6]');
select is(pg_temp.call(tests.n(), pg_temp.op_sql('complete_goal', :'gt')), jsonb_build_object('goal_id', :'gt', 'status', 'completed'),
  'saldo tepat sama dengan target = tercapai, bisa diselesaikan (K4)');
select is(pg_temp.g(:'gt'), 'completed|Kamera|1300000|-|true|false|N|N', 'status selesai + cap selesai');
select is(pg_temp.i6(), :'i6_cf', 'menyelesaikan tujuan tidak mengubah angka uang [I6]');
select is(pg_temp.call(tests.n(), pg_temp.op_sql('complete_goal', :'gt')) ->> 'status', 'completed',
  'selesaikan ulang = idempoten');
select is(pg_temp.call(tests.n(), pg_temp.op_sql('restore_goal', :'gt')) ->> 'status', 'active', 'Urungkan selesai = aktif lagi');
select is(pg_temp.g(:'gt'), 'active|Kamera|1300000|-|false|false|N|N', 'aktif lagi tanpa cap');
select pg_temp.op(tests.n(), 'complete_goal', :'gt');
select pg_temp.cg(tests.n(), :'np', :'tab', 'Kamera 2', 9000000) as gt2 \gset
select is(pg_temp.g(:'gt2'), 'active|Kamera 2|9000000|-|false|false|N|N', 'sesudah selesai, dompet boleh punya tujuan baru [T11]');
select is(pg_temp.err(tests.n(), pg_temp.op_sql('restore_goal', :'gt')) || ' ' || pg_temp.g(:'gt'),
  'DK409:goal_exists: completed|Kamera|1300000|-|true|false|N|N',
  'pulihkan saat dompet sudah punya tujuan aktif lain = goal_exists, nol efek [T11]');
select is(pg_temp.call(tests.n(), pg_temp.op_sql('archive_goal', :'gt')) ->> 'status', 'archived', 'tujuan selesai diarsipkan');
select is(pg_temp.g(:'gt'), 'archived|Kamera|1300000|-|true|true|N|N', 'arsip sesudah selesai menyimpan cap selesai');

-- ===== archive_goal / restore_goal =====
select is(pg_temp.call(tests.n(), pg_temp.op_sql('archive_goal', :'g1')), jsonb_build_object('goal_id', :'g1', 'status', 'archived'),
  'archive_goal: hasil');
select is(pg_temp.g(:'g1'), 'archived|Laptop Kerja|6000000|-|false|true|N|N', 'arsip dari aktif');
select is(pg_temp.call(tests.n(), pg_temp.op_sql('archive_goal', :'g1')) ->> 'status' || ' ' || pg_temp.g(:'g1'),
  'archived archived|Laptop Kerja|6000000|-|false|true|N|N', 'arsip ulang = idempoten');
select is(pg_temp.err(tests.n(), pg_temp.upd_sql(:'g1', 'X', 1000, null)) || ' '
          || pg_temp.err(tests.n(), pg_temp.op_sql('complete_goal', :'g1')),
  'DK422:goal_not_active: DK422:goal_not_active:', 'tujuan terarsip tidak bisa diubah atau diselesaikan');
select is(pg_temp.call(tests.n(), pg_temp.op_sql('restore_goal', :'g1')), jsonb_build_object('goal_id', :'g1', 'status', 'active'),
  'restore_goal: hasil');
select is(pg_temp.g(:'g1'), 'active|Laptop Kerja|6000000|-|false|false|N|N', 'pulihkan dari arsip = aktif tanpa cap');
select is(pg_temp.call(tests.n(), pg_temp.op_sql('restore_goal', :'g1')) ->> 'status', 'active', 'pulihkan ulang = idempoten');
select pg_temp.op(tests.n(), 'archive_goal', :'g1');
select pg_temp.cg(tests.n(), :'np', :'dd', 'Darurat', 3000000) as g3 \gset
select is(pg_temp.err(tests.n(), pg_temp.op_sql('restore_goal', :'g1')) || ' ' || pg_temp.g(:'g1'),
  'DK409:goal_exists: archived|Laptop Kerja|6000000|-|false|true|N|N', 'pulihkan arsip saat ada tujuan aktif lain = goal_exists');
-- Bersama: Farida menyelesaikan/mengarsipkan/memulihkan tujuan yang diubah Novanda (K1).
select pg_temp.xfer(:'kas', :'lib', 1000000);
select is(pg_temp.call(tests.f(), pg_temp.op_sql('complete_goal', :'gl')) ->> 'status' || ' '
          || (pg_temp.call(tests.f(), pg_temp.op_sql('restore_goal', :'gl')) ->> 'status') || ' '
          || (pg_temp.call(tests.f(), pg_temp.op_sql('archive_goal', :'gl')) ->> 'status') || ' '
          || (pg_temp.call(tests.f(), pg_temp.op_sql('restore_goal', :'gl')) ->> 'status'),
  'completed active archived active', 'anggota kedua menyelesaikan, memulihkan, mengarsipkan tujuan Bersama (K1)');
select is(pg_temp.g(:'gl'), 'active|Bali 2026|1000000|2026-03-20|false|false|F|F', 'pengubah terakhir Farida');

-- ===== archive_account pengganti (K6) + perilaku lama (07_ledger_uang) =====
select is(pg_temp.err(tests.n(), format($$select api.archive_account(%L)$$, :'dana')), 'DK422:balance_not_zero:',
  'arsip dompet bersaldo bukan 0 ditolak (perilaku lama)');
select tests.web_val(tests.n(), format($$select api.reconcile_balance(gen_random_uuid(), %L, 0)$$, :'dana'));
select is(tests.web_val(tests.n(), format($$select api.archive_account(%L)$$, :'dana'))::jsonb,
  jsonb_build_object('account_id', :'dana', 'archived', true), 'arsip dompet bersaldo 0 (perilaku lama)');
select is(tests.web_val(tests.n(), format($$select api.archive_account(%L) ->> 'archived'$$, :'dana')), 'true',
  'arsip ulang idempoten (perilaku lama)');
select is(pg_temp.err(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'income', 1)$$, :'np', :'dana')),
  'DK422:account_archived:', 'dompet terarsip tidak bisa dicatat (perilaku lama)');
select is(pg_temp.err(tests.f(), format($$select api.archive_account(%L)$$, :'kos')) || ' '
          || pg_temp.err(tests.n(), format($$select api.archive_account(%L)$$, gen_random_uuid())),
  'DK404:account_not_found:account_id DK404:account_not_found:account_id', 'dompet pasangan / tidak ada = DK404 (perilaku lama)');
select pg_temp.cg(tests.n(), :'np', :'kos', 'Kos', 1000) as gk \gset
select is(pg_temp.err(tests.n(), format($$select api.archive_account(%L)$$, :'kos')), 'DK422:account_has_goal:',
  'dompet bersaldo 0 dengan tujuan aktif = account_has_goal [T11]');
select is(pg_temp.err(tests.n(), format($$select api.archive_account(%L)$$, :'tab')), 'DK422:account_has_goal:',
  'tujuan aktif ditolak sebelum cek saldo (dompet bersaldo)');
select is(pg_temp.err(tests.f(), format($$select api.archive_account(%L)$$, :'lib')), 'DK422:account_has_goal:',
  'Bersama: dompet bertujuan aktif ditolak untuk anggota mana pun');
select pg_temp.op(tests.n(), 'archive_goal', :'gk');
select is(tests.web_val(tests.n(), format($$select api.archive_account(%L) ->> 'archived'$$, :'kos')), 'true',
  'tujuan diarsipkan: dompet boleh diarsipkan');
select is(pg_temp.err(tests.n(), pg_temp.op_sql('restore_goal', :'gk')) || ' ' || pg_temp.g(:'gk'),
  'DK422:account_archived: archived|Kos|1000|-|false|true|N|N', 'pulihkan tujuan di dompet terarsip = account_archived, nol efek');
select is(pg_temp.dq17(), '0', 'DQ17 nol: tidak ada tujuan aktif di dompet terarsip');

-- ===== list_goals / goal_for_account =====
-- Bersama: L (Bali, tanggal hari ini), R tercapai tanpa tanggal, M tanggal 31 Mei, Z tanpa tanggal (lebih baru),
-- T1/T2 diarsip (T2 lebih baru), T3 aktif di dompet yang sama.
select tests.clock_at('2026-03-20 10:01+07');
select pg_temp.cg(tests.n(), :'sh', :'ren', 'Renovasi dapur', 500000) as gr \gset
select pg_temp.xfer(:'kas', :'ren', 500000);
select tests.clock_at('2026-03-20 10:02+07');
select pg_temp.cg(tests.f(), :'sh', :'mob', 'Motor baru', 1000000, '2026-05-31') as gm \gset
select tests.clock_at('2026-03-20 10:03+07');
select pg_temp.cg(tests.n(), :'sh', :'rum', 'DP rumah', 50000000) as gz \gset
select tests.clock_at('2026-03-20 10:04+07');
select pg_temp.cg(tests.n(), :'sh', :'tv', 'TV 1', 1000) as gt1 \gset
select pg_temp.op(tests.n(), 'archive_goal', :'gt1');
select tests.clock_at('2026-03-20 10:05+07');
select pg_temp.cg(tests.n(), :'sh', :'tv', 'TV 2', 1000) as gt2b \gset
select pg_temp.op(tests.n(), 'archive_goal', :'gt2b');
select is(tests.web_val(tests.f(), format($$select string_agg(name || ':' || status || ':' || account_has_other_active, ','
    order by o) from api.list_goals(%L) with ordinality t (goal_id, name, account_id, account_name, account_archived, status,
    target_amount, target_on, completed_at, archived_at, created_by, created_at, balance, saved, remaining, pct, reached,
    periods_left, per_period, account_has_other_active, o)$$, :'sh')),
  'Bali 2026:active:false,Renovasi dapur:active:false,Motor baru:active:false,DP rumah:active:false,'
  || 'TV 2:archived:false,TV 1:archived:false',
  'urutan: aktif (tercapai, tanggal terdekat, tanpa tanggal, lebih lama), lalu selesai/arsip terbaru');
select tests.clock_at('2026-03-20 10:06+07');
select pg_temp.cg(tests.n(), :'sh', :'tv', 'TV 3', 1000) as gt3 \gset
select is(tests.web_val(tests.f(), format($$select string_agg(name || ':' || account_has_other_active, ',' order by name collate "C")
    from api.list_goals(%L) where account_id = %L$$, :'sh', :'tv')), 'TV 1:true,TV 2:true,TV 3:false',
  'account_has_other_active untuk baris selesai/arsip (TJ8)');
select is(tests.web_val(tests.f(), format($$select
    (select count(*) from (select goal_id, account_id, status, target_amount, target_on, balance, saved, remaining, pct,
       reached, periods_left, per_period from api.list_goals(%1$L)
     except select goal_id, account_id, status, target_amount, target_on, balance, saved, remaining, pct, reached,
       periods_left, per_period from app.goal_progress where space_id = %1$L) x)
    || '/' || (select count(*) from api.list_goals(%1$L)) || '/' || (select count(*) from app.goal_progress where space_id = %1$L)$$,
    :'sh')), '0/7/7', 'angka list_goals = app.goal_progress, satu rumus (Review Focus 2)');
select is(tests.web_val(tests.n(), format($$select string_agg(name || '=' || balance || '/' || saved || '/' || remaining || '/'
    || pct || '/' || reached || '/' || coalesce(periods_left::text, '-') || '/' || coalesce(per_period::text, '-'), ','
    order by name collate "C") from api.list_goals(%L) where name in ('Renovasi dapur', 'Motor baru')$$, :'sh')),
  'Motor baru=0/0/1000000/0/false/4/250000,Renovasi dapur=500000/500000/0/100/true/-/-',
  'angka progres di list_goals (tercapai; laju 4 periode gajian sampai 31 Mei)');
select is(tests.web_val(tests.n(), format($$select account_name || '/' || account_archived || '/' || status
    from api.list_goals(%L) where goal_id = %L$$, :'np', :'gk')), 'Kosong/true/archived',
  'nama dompet dan dompet terarsip ikut di baris (TJ8)');
select is(tests.web_val(tests.n(), format($$select count(*) || '/' || count(*) filter (where goal_id in (%L, %L, %L, %L, %L))
    from api.list_goals(%L)$$, :'g1', :'gt', :'gt2', :'g3', :'gk', :'np')), '5/5',
  'list_goals Pribadi hanya tujuan Pribadi (tanpa tujuan Bersama)');
select is(tests.web_val(tests.f(), format($$select created_by = %L from api.list_goals(%L) where goal_id = %L$$,
    tests.f(), :'sh', :'gm')), 'true', 'pembuat tersedia untuk bingkai TJ12');
select is(tests.web_val(tests.f(), format($$select string_agg(name, ',') from api.goal_for_account(%L)$$, :'tv')), 'TV 3',
  'goal_for_account: hanya tujuan aktif dompet itu');
select is(tests.web_val(tests.n(), format($$select count(*) from api.goal_for_account(%L)$$, :'kas')) || '/'
          || tests.web_val(tests.n(), format($$select count(*) from api.goal_for_account(%L)$$, :'kos')), '0/0',
  'dompet tanpa tujuan aktif (atau hanya tujuan diarsip) = nol baris');
select is(tests.web_val(tests.n(), format($$select goal_id::text from api.goal_for_account(%L)$$, :'tab')), :'gt2',
  'goal_for_account Pribadi');
select is(pg_temp.err(tests.x(), format($$select count(*) from api.goal_for_account(%L)$$, :'ren')) || ' '
          || pg_temp.err(tests.n(), format($$select count(*) from api.goal_for_account(%L)$$, gen_random_uuid())) || ' '
          || pg_temp.err(null, format($$select count(*) from api.goal_for_account(%L)$$, :'ren')),
  'DK404:space_not_found: DK404:space_not_found: DK401:unauthenticated:', 'goal_for_account: Luar / tidak ada = DK404');

-- ===== Kegagalan di tengah = rollback utuh (pola INT-12) =====
select pg_temp.op(tests.n(), 'archive_goal', :'gm');
select pg_temp.n_goals() || ' ' || pg_temp.g(:'gr') || ' ' || pg_temp.g(:'g3') || ' ' || pg_temp.g(:'gm') as before_fail \gset
savepoint gagal;
select tests.owner_exec(null, $q$create function private.tes_fail_after() returns trigger
  language plpgsql set search_path = '' as $f$
  begin
    if pg_catalog.current_setting('tests.fail_after', true) = 'goal' then
      raise exception using errcode = 'P0001', message = 'fail_after';
    end if;
    return null;
  end $f$$q$);
select tests.owner_exec(null, 'create trigger tes_fail_after after insert or update on app.goals
  for each row execute function private.tes_fail_after()');
select set_config('tests.fail_after', 'goal', true);
select is(pg_temp.err(tests.n(), pg_temp.cg_sql(:'np', :'ems', 'Emas', 1000, null, 'aaaaaaaa-0000-0000-0000-000000000009'))
          || ' ' || pg_temp.err(tests.n(), pg_temp.upd_sql(:'g3', 'Darurat 2', 4000000, null))
          || ' ' || pg_temp.err(tests.f(), pg_temp.op_sql('complete_goal', :'gr'))
          || ' ' || pg_temp.err(tests.n(), pg_temp.op_sql('archive_goal', :'g3'))
          || ' ' || pg_temp.err(tests.f(), pg_temp.op_sql('restore_goal', :'gm')),
  'P0001:fail_after: P0001:fail_after: P0001:fail_after: P0001:fail_after: P0001:fail_after:',
  'kegagalan disuntik sesudah baris tujuan ditulis, di setiap fungsi tulis');
select is(pg_temp.n_goals() || ' ' || pg_temp.g(:'gr') || ' ' || pg_temp.g(:'g3') || ' ' || pg_temp.g(:'gm'), :'before_fail',
  'rollback utuh: tujuan, kunci idempotensi, status tidak berubah');
rollback to savepoint gagal;
select set_config('tests.fail_after', '', true);
select is(pg_temp.call(tests.n(), pg_temp.cg_sql(:'np', :'ems', 'Emas', 1000, null, 'aaaaaaaa-0000-0000-0000-000000000009'))
    ->> 'replayed', 'false', 'client_id yang sama sesudah gagal = tujuan baru (bukan putar ulang)');
select is(pg_temp.dq17(), '0', 'DQ17 nol di akhir');

select * from finish();
rollback;
