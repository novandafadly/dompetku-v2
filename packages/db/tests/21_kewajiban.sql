-- Tabel kewajiban (S9, 0117; plan S9 Task 4, BSD §6 bills/bill_occurrences/budgets, §7
-- tg_category_depth lengkap + tg_obligation_xor, §8 bill_schedule, §11 hak, §13 #10, #26, #27;
-- Review Focus #1 dan #5). Fungsi api tagihan/anggaran belum ada (Task 5, 6): baris ditulis
-- langsung sebagai dompetku_api (role pemilik fungsi api.*, tunduk RLS member_write), web hanya
-- membaca. Satu kewajiban: tagihan aktif ATAU anggaran wajib pada kategori induk yang sama di label
-- periode gajian yang sama (budgets.month = label, K1/BSD §8.2a; aturan kosong = bulan kalender;
-- DK422 obligation_double, dari kedua arah); memindah induk kategori yang dipakai
-- tagihan/anggaran = DK422 category_in_obligation. Persona N, F, Luar (tests.x(), tanpa ruang);
-- kanari Pribadi KANARI-N-TAGIHAN + anggaran pada KANARI-N-KATEGORI (dan padanannya milik F).
-- 0118: kemunculan pertama = greatest(starts_on, awal bulan created_at WIB) (private.bill_first_on), juga
-- di XOR. Baris tagihan di tes ini ditulis langsung dengan created_at 1 Jan 2026 (sebelum semua starts_on),
-- jadi aturan XOR yang diuji di sini tetap berbasis starts_on; starts_on lampau terhadap bulan dibuat
-- diuji di 22_tagihan. 0118 juga memberi dompetku_api DELETE pada bill_occurrences (api.update_bill).
-- ID: T17, B1, B13
begin;
select plan(128);
select tests.fixture();
select tests.clock_at('2026-11-05 10:00+07');

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
-- Tagihan baru (sebagai dompetku_api, user p_uid); kembalikan id.
create function pg_temp.bill(p_uid uuid, p_space uuid, p_name text, p_cat uuid, p_starts date,
                             p_ends date default null, p_acc uuid default null) returns uuid
language sql as $$
  select tests.api_val(p_uid, format(
    $q$insert into app.bills (space_id, name, amount, category_id, account_id, day_of_month, starts_on,
         ends_on, created_by, created_at)
       values (%L, %L, 485000, %L, %L, 20, %L, %L, app.current_user_id(), '2026-01-01 00:00+07') returning id$q$,
    p_space, p_name, p_cat, p_acc, p_starts, p_ends))::uuid
$$;
-- SQL insert anggaran (untuk throws_ok/lives_ok).
create function pg_temp.budget_sql(p_space uuid, p_cat uuid, p_month date, p_wajib boolean) returns text
language sql as $$
  select format($q$insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by)
                  values (%L, %L, %L, 1500000, %L, app.current_user_id())$q$, p_space, p_cat, p_month, p_wajib)
$$;
create function pg_temp.bill_sql(p_space uuid, p_cat uuid, p_starts date, p_ends date default null) returns text
language sql as $$
  select format($q$insert into app.bills (space_id, name, amount, category_id, day_of_month, starts_on,
                    ends_on, created_by, created_at)
                  values (%L, 'Listrik PLN', 485000, %L, 20, %L, %L, app.current_user_id(), '2026-01-01 00:00+07')$q$,
                p_space, p_cat, p_starts, p_ends)
$$;

-- Kategori Bersama (seed): Listrik & Air (induk), anak baru Token Listrik; Internet; Iuran
-- Lingkungan; Sayur & Buah (anak Belanja Dapur); Kontribusi Farida (pemasukan).
select pg_temp.cat(:'sh', 'Listrik & Air') as listrik, pg_temp.cat(:'sh', 'Internet') as internet,
       pg_temp.cat(:'sh', 'Iuran Lingkungan') as iuran, pg_temp.cat(:'sh', 'Sayur & Buah') as sayur,
       pg_temp.cat(:'sh', 'Kontribusi Farida') as kontrib, pg_temp.cat(:'np', 'Langganan') as nlangganan \gset
select pg_temp.call(tests.n(), format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Token Listrik', 'Lightning', %L)$$,
  :'sh', :'listrik')) ->> 'category_id' as token \gset
select pg_temp.call(tests.n(), format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'KANARI-N-KATEGORI', 'Receipt')$$,
  :'np')) ->> 'category_id' as ncanary \gset
select pg_temp.call(tests.f(), format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'KANARI-F-KATEGORI', 'Receipt')$$,
  :'fp')) ->> 'category_id' as fcanary \gset
select tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 1000000, '2026-01-01') as kas,
       tests.account(tests.n(), :'np', 'BCA', 'operasional', 1000000, '2026-01-01') as bca,
       tests.account(tests.f(), :'fp', 'BCA Farida', 'operasional', 1000000, '2026-01-01') as fbca \gset

-- ===== Bentuk dan katalog tabel baru =====
select is(tests.owner_val(null, $$select string_agg(relname || ':' || relrowsecurity || ':' || relforcerowsecurity
    || ':' || relowner::regrole::text, ',' order by relname) from pg_class
  where relnamespace = 'app'::regnamespace and relname in ('bills', 'bill_occurrences', 'budgets', 'bill_schedule')$$),
  'bill_occurrences:true:true:dompetku_owner,bill_schedule:false:false:dompetku_owner,'
  'bills:true:true:dompetku_owner,budgets:true:true:dompetku_owner',
  'tabel kewajiban RLS ENABLE + FORCE, milik dompetku_owner; bill_schedule = view milik owner');
select is(tests.owner_val(null, $$select array_to_string(reloptions, ',') from pg_class where oid = 'app.bill_schedule'::regclass$$),
  'security_invoker=true', 'bill_schedule security_invoker (RLS pemanggil berlaku)');
select set_eq($$
  select r.rolname, c.relname, p.priv
  from pg_class c
  cross join (values ('dompetku_web'), ('dompetku_api'), ('dompetku_worker'), ('dompetku_auditor')) r (rolname)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p (priv)
  where c.relnamespace = 'app'::regnamespace and c.relname in ('bills', 'bill_occurrences', 'budgets', 'bill_schedule')
    and has_table_privilege(r.rolname, c.oid, p.priv) $$,
  $$ values ('dompetku_web', 'bills', 'SELECT'), ('dompetku_web', 'bill_occurrences', 'SELECT'),
            ('dompetku_web', 'budgets', 'SELECT'), ('dompetku_web', 'bill_schedule', 'SELECT'),
            ('dompetku_api', 'bills', 'SELECT'), ('dompetku_api', 'bills', 'INSERT'), ('dompetku_api', 'bills', 'UPDATE'),
            ('dompetku_api', 'bill_occurrences', 'SELECT'), ('dompetku_api', 'bill_occurrences', 'INSERT'),
            ('dompetku_api', 'bill_occurrences', 'UPDATE'), ('dompetku_api', 'bill_occurrences', 'DELETE'),
            ('dompetku_api', 'budgets', 'SELECT'), ('dompetku_api', 'budgets', 'INSERT'),
            ('dompetku_api', 'budgets', 'UPDATE'), ('dompetku_api', 'budgets', 'DELETE'),
            ('dompetku_api', 'bill_schedule', 'SELECT'),
            ('dompetku_auditor', 'bills', 'SELECT'), ('dompetku_auditor', 'bill_occurrences', 'SELECT'),
            ('dompetku_auditor', 'budgets', 'SELECT'), ('dompetku_auditor', 'bill_schedule', 'SELECT') $$,
  'hak persis BSD §11 + 0118: web SELECT, api DML terbatas (DELETE budgets, bill_occurrences), worker tanpa hak, auditor SELECT');
select is(tests.owner_val(null, $$select string_agg(c.relname || ':' || p.polname || ':' || p.polcmd::text || ':'
    || (select string_agg(r::regrole::text, '+' order by r::regrole::text) from unnest(p.polroles) r), ','
    order by c.relname, p.polname)
  from pg_policy p join pg_class c on c.oid = p.polrelid
  where c.relnamespace = 'app'::regnamespace and c.relname in ('bills', 'bill_occurrences', 'budgets')$$),
  'bill_occurrences:member_read:r:dompetku_api+dompetku_web,bill_occurrences:member_write:*:dompetku_api,'
  'bills:member_read:r:dompetku_api+dompetku_web,bills:member_write:*:dompetku_api,'
  'budgets:member_read:r:dompetku_api+dompetku_web,budgets:member_write:*:dompetku_api',
  'policy pola ruang: baca web/api, tulis hanya dompetku_api');
select is(tests.owner_val(null, $$select string_agg(c.relname || '.' || g.tgname || ':' || g.tgtype || ':'
    || g.tgfoid::regproc::text, ',' order by c.relname)
  from pg_trigger g join pg_class c on c.oid = g.tgrelid
  where c.relnamespace = 'app'::regnamespace and g.tgname like '%obligation_xor'$$),
  'bills.bills_obligation_xor:23:private.tg_obligation_xor,budgets.budgets_obligation_xor:23:private.tg_obligation_xor',
  'trigger XOR: BEFORE INSERT OR UPDATE, per baris (tgtype 23), di bills dan budgets');
select is(tests.owner_val(null, $$select string_agg(p.proname || ':' || p.prosecdef || ':' || p.proowner::regrole::text
    || ':' || array_to_string(p.proconfig, ','), ',' order by p.proname)
  from pg_proc p where p.pronamespace = 'private'::regnamespace
    and p.proname in ('tg_obligation_xor', 'tg_category_depth', 'bill_due_in_label')$$),
  'bill_due_in_label:false:dompetku_owner:search_path="",'
  'tg_category_depth:true:dompetku_owner:search_path="",tg_obligation_xor:true:dompetku_owner:search_path=""',
  'fungsi trigger DEFINER milik owner (melihat semua ruang), helper label INVOKER, search_path kosong');
select is(tests.owner_val(null, $$select string_agg(i.indexrelid::regclass::text, ',' order by i.indexrelid::regclass::text)
  from pg_index i where i.indrelid in ('app.bills'::regclass, 'app.bill_occurrences'::regclass, 'app.budgets'::regclass)$$),
  'app.bill_occurrences_bill_id_due_on_key,app.bill_occurrences_pkey,app.bill_occurrences_space_id_bill_id_idx,'
  'app.bill_occurrences_space_id_due_on_idx,app.bill_occurrences_space_id_entry_id_idx,app.bills_created_by_idx,'
  'app.bills_pkey,app.bills_space_id_account_id_idx,app.bills_space_id_category_id_category_type_idx,'
  'app.bills_space_id_id_key,app.budgets_pkey,app.budgets_space_id_category_id_category_type_idx,'
  'app.budgets_space_id_month_idx,app.budgets_updated_by_idx',
  'indeks BSD §6 (setiap FK berindeks; tes katalog #7 menjaga kelengkapan)');

-- ===== Web tidak bisa menulis langsung (hanya api.*) =====
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), q), '42501', null, 'web INSERT ditolak: ' || t)
from (values
  ('bills', pg_temp.bill_sql(:'sh', :'internet', '2026-11-01')),
  ('bill_occurrences', format($q$insert into app.bill_occurrences (space_id, bill_id, due_on, amount)
     values (%L, gen_random_uuid(), '2026-11-20', 1)$q$, :'sh')),
  ('budgets', pg_temp.budget_sql(:'sh', :'internet', '2026-11-01', false))
) v (t, q);

-- ===== FK komposit dan CHECK (BSD §6, §13 #27) =====
-- N anggota Pribadi N dan Bersama: RLS lolos, FK komposit yang menolak.
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), pg_temp.bill_sql(:'sh', :'nlangganan', '2026-11-01')),
  '23503', null, 'tagihan Bersama dengan kategori Pribadi N ditolak FK komposit');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
    $q$insert into app.bills (space_id, name, amount, category_id, account_id, day_of_month, starts_on, created_by)
       values (%L, 'X', 1, %L, %L, 1, '2026-11-01', app.current_user_id())$q$, :'sh', :'internet', :'bca')),
  '23503', null, 'tagihan Bersama dengan dompet Pribadi N ditolak FK komposit');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), pg_temp.bill_sql(:'sh', :'kontrib', '2026-11-01')),
  '23503', null, 'tagihan pada kategori pemasukan ditolak FK (category_type expense)');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
    $q$insert into app.bills (space_id, name, amount, category_id, category_type, day_of_month, starts_on, created_by)
       values (%L, 'X', 1, %L, 'income', 1, '2026-11-01', app.current_user_id())$q$, :'sh', :'kontrib')),
  '23514', null, 'tagihan category_type income ditolak CHECK');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), q), '23514', null, 'CHECK tagihan: ' || t)
from (values
  ('nominal 0', format($q$insert into app.bills (space_id, name, amount, category_id, day_of_month, starts_on, created_by)
     values (%L, 'X', 0, %L, 1, '2026-11-01', app.current_user_id())$q$, :'sh', :'internet')),
  ('nominal > 10 triliun', format($q$insert into app.bills (space_id, name, amount, category_id, day_of_month, starts_on, created_by)
     values (%L, 'X', 10000000000001, %L, 1, '2026-11-01', app.current_user_id())$q$, :'sh', :'internet')),
  ('tanggal 32', format($q$insert into app.bills (space_id, name, amount, category_id, day_of_month, starts_on, created_by)
     values (%L, 'X', 1, %L, 32, '2026-11-01', app.current_user_id())$q$, :'sh', :'internet')),
  ('nama kosong', format($q$insert into app.bills (space_id, name, amount, category_id, day_of_month, starts_on, created_by)
     values (%L, '  ', 1, %L, 1, '2026-11-01', app.current_user_id())$q$, :'sh', :'internet')),
  ('berakhir sebelum mulai', pg_temp.bill_sql(:'sh', :'internet', '2026-11-01', '2026-10-31'))
) v (t, q);
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), pg_temp.budget_sql(:'sh', :'sayur', '2026-11-01', false)),
  'DK422', 'parent_budget_required', 'anggaran pada subkategori tanpa anggaran induk ditolak (S10, menggantikan FK is_root BSD §13 #27)');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), pg_temp.budget_sql(:'sh', :'kontrib', '2026-11-01', false)),
  '23503', null, 'anggaran pada kategori pemasukan ditolak FK');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), pg_temp.budget_sql(:'sh', :'nlangganan', '2026-11-01', false)),
  '23503', null, 'anggaran Bersama dengan kategori Pribadi N ditolak FK komposit');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), pg_temp.budget_sql(:'sh', :'internet', '2026-11-02', false)),
  '23514', null, 'anggaran month bukan tanggal 1 ditolak CHECK');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
    $q$insert into app.budgets (space_id, category_id, month, amount, updated_by)
       values (%L, %L, '2026-11-01', 0, app.current_user_id())$q$, :'sh', :'internet')),
  '23514', null, 'anggaran nominal 0 ditolak CHECK');
-- F bukan anggota Pribadi N: policy member_write menolak (with check).
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.f(), pg_temp.bill_sql(:'np', :'nlangganan', '2026-11-01')),
  '42501', null, 'api/F menulis tagihan di Pribadi N ditolak RLS');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.f(), pg_temp.budget_sql(:'np', :'nlangganan', '2026-11-01', false)),
  '42501', null, 'api/F menulis anggaran di Pribadi N ditolak RLS');

-- ===== Kanari Pribadi (N dan F) dan data Bersama dasar =====
-- Tagihan kanari pada Langganan, anggaran wajib pada KANARI-N-KATEGORI (keduanya kewajiban sah: induk beda).
select pg_temp.bill(tests.n(), :'np', 'KANARI-N-TAGIHAN', :'nlangganan', '2026-11-01', null, :'bca') as nbill \gset
select tests.api_exec(tests.n(), pg_temp.budget_sql(:'np', :'ncanary', '2026-11-01', true));
select pg_temp.bill(tests.f(), :'fp', 'KANARI-F-TAGIHAN', :'fcanary', '2026-11-01', null, :'fbca') as fbill \gset
select tests.api_exec(tests.f(), pg_temp.budget_sql(:'fp', :'fcanary', '2026-12-01', false));
select tests.api_exec(u, format($q$insert into app.bill_occurrences (space_id, bill_id, due_on, amount)
  values (%L, %L, '2026-11-20', 485000)$q$, s, b))
  from (values (tests.n(), :'np'::uuid, :'nbill'::uuid), (tests.f(), :'fp'::uuid, :'fbill'::uuid)) v (u, s, b);

-- bill_occurrences: FK komposit, unik per jatuh tempo, terbayar XOR dilewati.
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
    $q$insert into app.bill_occurrences (space_id, bill_id, due_on, amount) values (%L, %L, '2026-12-20', 1)$q$, :'sh', :'nbill')),
  '23503', null, 'kemunculan Bersama untuk tagihan Pribadi N ditolak FK komposit');
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 485000, %L, '2026-11-01', 'bayar N')$$,
  :'np', :'bca', :'ncanary')) ->> 'entry_id' as nentry \gset
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
    $q$insert into app.bill_occurrences (space_id, bill_id, due_on, amount, entry_id)
       values (%L, %L, '2026-12-20', 1, %L)$q$, :'sh', :'listrik', :'nentry')),
  '23503', null, 'kemunculan Bersama dengan entri Pribadi N ditolak FK komposit');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
    $q$insert into app.bill_occurrences (space_id, bill_id, due_on, amount) values (%L, %L, '2026-11-20', 1)$q$, :'np', :'nbill')),
  '23505', null, 'satu kemunculan per tagihan per jatuh tempo (unique bill_id, due_on)');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
    $q$insert into app.bill_occurrences (space_id, bill_id, due_on, amount, entry_id, skipped_at)
       values (%L, %L, '2026-12-20', 1, %L, now())$q$, :'np', :'nbill', :'nentry')),
  '23514', null, 'kemunculan tidak bisa terbayar sekaligus dilewati');

-- ===== Satu kewajiban: XOR dari kedua arah (BSD §13 #26, Review Focus #1) [T17 bagian kewajiban] =====
-- Anggaran wajib induk Listrik & Air November.
select lives_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), pg_temp.budget_sql(:'sh', :'listrik', '2026-11-01', true)),
  'anggaran wajib Listrik & Air November');
-- Arah tagihan -> anggaran.
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.f(), pg_temp.bill_sql(:'sh', :'token', '2026-11-05')),
  'DK422', 'obligation_double', 'tagihan pada anak (Token Listrik) bulan sama = obligation_double');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), pg_temp.bill_sql(:'sh', :'listrik', '2026-10-01')),
  'DK422', 'obligation_double', 'tagihan pada induk mulai Oktober tanpa akhir (mencakup November) = obligation_double');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), pg_temp.bill_sql(:'sh', :'token', '2026-11-20', '2026-11-20')),
  'DK422', 'obligation_double', 'tagihan mulai dan berakhir 20 November (satu kemunculan) = obligation_double');
-- Rentang 30..30 Nov dengan tanggal 20 tidak memuat satu kemunculan pun: bukan kewajiban, tidak bentrok.
select lives_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), pg_temp.bill_sql(:'sh', :'listrik', '2026-11-30', '2026-11-30')),
  'tagihan tanpa kemunculan (30..30 Nov, tanggal 20) tidak bentrok');
select lives_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), pg_temp.bill_sql(:'sh', :'token', '2026-06-01', '2026-10-31')),
  'tagihan Jun..31 Okt (berakhir sebelum bulan anggaran) tidak bentrok');
select pg_temp.bill(tests.n(), :'sh', 'Token Desember', :'token', '2026-12-01', null, :'kas') as bill_des \gset
select is(tests.owner_val(null, format($$select count(*) from app.bills where space_id = %L and category_id = %L$$, :'sh', :'token')),
  '2', 'tagihan mulai 1 Desember (sesudah bulan anggaran) tidak bentrok');
select lives_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), pg_temp.bill_sql(:'sh', :'internet', '2026-11-01')),
  'tagihan kategori lain (Internet) bulan sama tidak bentrok');
-- Arah anggaran -> tagihan.
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.f(), pg_temp.budget_sql(:'sh', :'listrik', '2026-12-01', true)),
  'DK422', 'obligation_double', 'anggaran wajib induk Desember vs tagihan aktif anak = obligation_double');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), pg_temp.budget_sql(:'sh', :'listrik', '2026-10-01', true)),
  'DK422', 'obligation_double', 'anggaran wajib Oktober vs tagihan berakhir 31 Okt = obligation_double');
select lives_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), pg_temp.budget_sql(:'sh', :'listrik', '2026-05-01', true)),
  'anggaran wajib Mei (sebelum tagihan mulai 1 Jun) tidak bentrok');
select lives_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), pg_temp.budget_sql(:'sh', :'listrik', '2026-12-01', false)),
  'anggaran TIDAK wajib Desember boleh walau ada tagihan aktif');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
    $q$update app.budgets set wajib = true where space_id = %L and category_id = %L and month = '2026-12-01'$q$, :'sh', :'listrik')),
  'DK422', 'obligation_double', 'mengubah anggaran Desember menjadi wajib = obligation_double');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
    $q$update app.bills set category_id = %L where space_id = %L and category_id = %L$q$, :'token', :'sh', :'internet')),
  'DK422', 'obligation_double', 'memindah tagihan Internet ke Token Listrik (November wajib) = obligation_double');
-- Tagihan diarsipkan tidak lagi bentrok (BSD §13 #26 butir arsip).
select is(tests.api_exec(tests.n(), format($$update app.bills set archived_at = now() where id = %L$$, :'bill_des')), 1::bigint,
  'arsipkan tagihan Desember');
select lives_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
    $q$update app.budgets set wajib = true where space_id = %L and category_id = %L and month = '2026-12-01'$q$, :'sh', :'listrik')),
  'sesudah tagihan diarsipkan, anggaran Desember boleh wajib');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.f(), pg_temp.bill_sql(:'sh', :'token', '2026-12-10', '2027-01-31')),
  'DK422', 'obligation_double', 'tagihan aktif baru Desember sesudahnya = obligation_double');
select is(tests.owner_val(null, format($$select string_agg(to_char(month, 'YYYY-MM') || ':' || wajib, ',' order by month)
  from app.budgets where space_id = %L and category_id = %L$$, :'sh', :'listrik')),
  '2026-05:true,2026-11:true,2026-12:true', 'anggaran Listrik & Air tersimpan: Mei, Nov, Des wajib (penolakan tanpa efek)');
select is(tests.owner_val(null, format($$select string_agg(to_char(starts_on, 'YYYY-MM-DD') || '/' || coalesce(to_char(ends_on, 'YYYY-MM-DD'), '-')
    || '/' || (archived_at is not null), ',' order by starts_on)
  from app.bills where space_id = %L and category_id in (%L, %L)$$, :'sh', :'listrik', :'token')),
  '2026-06-01/2026-10-31/false,2026-11-30/2026-11-30/false,2026-12-01/-/true',
  'tagihan Listrik: hanya tiga yang lolos (satu tanpa kemunculan), Desember terarsip');

-- ===== Memindah induk kategori yang dipakai = category_in_obligation (BSD §7, §13 #26) =====
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format(
    $q$select api.update_category(%L, 'Token Listrik', 'Lightning', null)$q$, :'token')),
  'DK422', 'category_in_obligation', 'anak bertagihan dijadikan induk = category_in_obligation');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format(
    $q$select api.update_category(%L, 'Token Listrik', 'Lightning', %L)$q$, :'token', :'iuran')),
  'DK422', 'category_in_obligation', 'anak bertagihan dipindah ke induk lain = category_in_obligation');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format(
    $q$select api.update_category(%L, 'Internet', 'WifiHigh', %L)$q$, :'internet', :'iuran')),
  'DK422', 'category_in_obligation', 'induk bertagihan (Internet) dijadikan anak = category_in_obligation');
select tests.api_exec(tests.n(), pg_temp.budget_sql(:'sh', :'iuran', '2026-11-01', false));
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format(
    $q$select api.update_category(%L, 'Iuran Lingkungan', 'UsersThree', %L)$q$, :'iuran', :'internet')),
  'DK422', 'category_in_obligation', 'induk beranggaran (tidak wajib pun) dijadikan anak = category_in_obligation');
select lives_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format(
    $q$select api.update_category(%L, 'Token PLN', 'Lightning', %L)$q$, :'token', :'listrik')),
  'ganti nama tanpa pindah induk tetap boleh');
select lives_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format(
    $q$select api.update_category(%L, 'Sayur & Buah', 'Carrot', null)$q$, :'sayur')),
  'kategori tanpa kewajiban boleh pindah induk');
select is(tests.owner_val(null, format($$select string_agg(name || ':' || coalesce(parent_id::text, '-'), ',' order by name)
  from app.categories where id in (%L, %L, %L)$$, :'token', :'internet', :'iuran')),
  'Internet:-,Iuran Lingkungan:-,Token PLN:' || :'listrik', 'pindah induk yang ditolak tanpa efek');
-- Langsung (bukan lewat api.update_category) juga ditolak: penjaga ada di trigger.
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format(
    $q$update app.categories set parent_id = null where id = %L$q$, :'token')),
  'DK422', 'category_in_obligation', 'UPDATE parent_id langsung (owner) juga ditolak trigger');
-- Kedalaman tetap dijaga (cabang lama 0101).
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format(
    $q$select api.create_category(gen_random_uuid(), %L, 'expense', 'Cucu', 'Car', %L)$q$, :'sh', :'token')),
  'DK422', 'category_depth', 'kategori level 3 tetap category_depth');

-- ===== Satu kewajiban per LABEL periode gajian (K1, BSD §8.2a), payday_rule = 25 =====
-- budgets.month = label periode; tagihan bentrok dengan anggaran wajib label M bila ada kemunculan
-- (due = least(tanggal, hari terakhir bulan), di dalam starts_on..ends_on; BSD §10) yang jatuh di
-- periode berlabel M. Gajian efektif, dihitung tangan dari kalender + app.holidays (2028 tanpa data
-- libur = akhir pekan saja): 24 Agu 2026 (25 Agu Maulid), 25 Sep (Jum), 23 Okt (25 Okt Minggu),
-- 25 Nov (Rab), 23 Des (25 Des Natal, 24 Des cuti bersama), 25 Jan 2027 (Sen), 25 Feb 2027 (Kam),
-- 24 Mar 2027 (25 Mar cuti bersama); 25 Feb 2028 (Jum), 24 Mar 2028 (25 Mar Sabtu).
-- Label L = [gajian L-1, gajian L - 1]: Sep [24 Agu, 24 Sep], Okt [25 Sep, 22 Okt], Nov [23 Okt, 24 Nov],
-- Des [25 Nov, 22 Des], Jan 2027 [23 Des, 24 Jan], Feb 2027 [25 Jan, 24 Feb], Mar 2027 [25 Feb, 23 Mar],
-- Feb 2028 [25 Jan, 24 Feb], Mar 2028 [25 Feb, 23 Mar]. Aturan diubah di dalam transaksi tes (rollback).
select tests.owner_exec(null, 'update app.households set payday_rule = 25');
select is(tests.owner_val(null, format($$select string_agg(to_char(l, 'YYYY-MM') || '=' || p.starts_on || '..' || p.ends_on, ',' order by l)
  from unnest(array['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-03-01', '2028-03-01']::date[]) l,
       app.period_of_label(%L, l) p$$, :'sh')),
  '2026-09=2026-08-24..2026-09-24,2026-10=2026-09-25..2026-10-22,2026-11=2026-10-23..2026-11-24,'
  '2026-12=2026-11-25..2026-12-22,2027-01=2026-12-23..2027-01-24,2027-03=2027-02-25..2027-03-23,'
  '2028-03=2028-02-25..2028-03-23',
  'periode gajian acuan (hitung tangan) untuk tes label');

create function pg_temp.kat(p_space uuid, p_name text) returns uuid
language sql as $$
  select (tests.web_val(tests.n(), format($q$select api.create_category(gen_random_uuid(), %L, 'expense', %L, 'Receipt')$q$,
    p_space, p_name))::jsonb ->> 'category_id')::uuid
$$;
create function pg_temp.tg(p_space uuid, p_cat uuid, p_day int, p_starts date, p_ends date default null) returns text
language sql as $$
  select format($q$select tests.api_exec(%L, %L)$q$, tests.n(), format(
    $i$insert into app.bills (space_id, name, amount, category_id, day_of_month, starts_on, ends_on, created_by, created_at)
       values (%L, 'Cicilan', 750000, %L, %s, %L, %L, app.current_user_id(), '2026-01-01 00:00+07')$i$, p_space, p_cat, p_day, p_starts, p_ends))
$$;
create function pg_temp.ag(p_space uuid, p_cat uuid, p_month date, p_wajib boolean default true) returns text
language sql as $$
  select format($q$select tests.api_exec(%L, %L)$q$, tests.n(), pg_temp.budget_sql(p_space, p_cat, p_month, p_wajib))
$$;
select pg_temp.kat(:'sh', 'Label A') as ka, pg_temp.kat(:'sh', 'Label B') as kb, pg_temp.kat(:'sh', 'Label C') as kc,
       pg_temp.kat(:'sh', 'Label D') as kd, pg_temp.kat(:'sh', 'Label E') as ke, pg_temp.kat(:'sh', 'Label F') as kf,
       pg_temp.kat(:'sh', 'Label G') as kg, pg_temp.kat(:'sh', 'Label G2') as kg2, pg_temp.kat(:'sh', 'Label H') as kh,
       pg_temp.kat(:'sh', 'Label H2') as kh2, pg_temp.kat(:'sh', 'Label I') as ki, pg_temp.kat(:'sh', 'Label K') as kk \gset

-- (a) Satu-satunya kemunculan 25 Okt jatuh di periode berlabel November.
select lives_ok(pg_temp.ag(:'sh', :'ka', '2026-11-01'), '(a) anggaran wajib November');
select throws_ok(pg_temp.tg(:'sh', :'ka', 25, '2026-10-25', '2026-10-31'), 'DK422', 'obligation_double',
  '(a) tagihan 25..31 Okt tanggal 25 vs anggaran wajib November = obligation_double (bulan kalender meloloskannya)');
select lives_ok(pg_temp.tg(:'sh', :'kb', 25, '2026-10-25', '2026-10-31'), '(a) arah sebaliknya: tagihan 25..31 Okt dulu');
select lives_ok(pg_temp.ag(:'sh', :'kb', '2026-10-01'), '(a) kemunculan 25 Okt bukan label Oktober: anggaran wajib Okt lolos');
select throws_ok(pg_temp.ag(:'sh', :'kb', '2026-11-01'), 'DK422', 'obligation_double',
  '(a) anggaran wajib November vs kemunculan 25 Okt = obligation_double');
-- (b) Kemunculan pertama 25 Nov berlabel Desember.
select lives_ok(pg_temp.tg(:'sh', :'kc', 25, '2026-11-25'), '(b) tagihan mulai 25 Nov tanggal 25');
select lives_ok(pg_temp.ag(:'sh', :'kc', '2026-11-01'), '(b) anggaran wajib November lolos (bulan kalender menolaknya)');
select throws_ok(pg_temp.ag(:'sh', :'kc', '2026-12-01'), 'DK422', 'obligation_double', '(b) anggaran wajib Desember = obligation_double');
-- ends_on memotong kemunculan: 1 Okt..24 Nov tanggal 25 hanya punya 25 Okt (label Nov); 25 Nov terpotong.
select lives_ok(pg_temp.tg(:'sh', :'kd', 25, '2026-10-01', '2026-11-24'), 'tagihan 1 Okt..24 Nov tanggal 25');
select lives_ok(pg_temp.ag(:'sh', :'kd', '2026-10-01'), 'ends_on: anggaran wajib Oktober lolos');
select lives_ok(pg_temp.ag(:'sh', :'kd', '2026-12-01'), 'ends_on: 25 Nov terpotong, anggaran wajib Desember lolos');
select throws_ok(pg_temp.ag(:'sh', :'kd', '2026-11-01'), 'DK422', 'obligation_double', 'ends_on: anggaran wajib November = obligation_double');
-- starts_on 10 Okt tanggal 25: kemunculan pertama 25 Okt (label Nov), arah tagihan sesudah anggaran Okt.
select lives_ok(pg_temp.ag(:'sh', :'ke', '2026-10-01'), 'anggaran wajib Oktober dulu');
select lives_ok(pg_temp.tg(:'sh', :'ke', 25, '2026-10-10'), 'tagihan mulai 10 Okt tanggal 25 lolos terhadap anggaran Oktober');
select throws_ok(pg_temp.ag(:'sh', :'ke', '2026-11-01'), 'DK422', 'obligation_double', 'mulai 10 Okt: anggaran wajib November = obligation_double');
-- Tanggal 31 di bulan pendek: 28 Feb 2027 masuk periode Maret 2027 [25 Feb, 23 Mar].
select lives_ok(pg_temp.tg(:'sh', :'kf', 31, '2027-02-01', '2027-02-28'), 'tagihan Feb 2027 tanggal 31 (jatuh 28 Feb)');
select lives_ok(pg_temp.ag(:'sh', :'kf', '2027-02-01'), 'tanggal 31 Feb 2027: anggaran wajib Februari lolos');
select throws_ok(pg_temp.ag(:'sh', :'kf', '2027-03-01'), 'DK422', 'obligation_double', 'tanggal 31 Feb 2027: anggaran wajib Maret = obligation_double');
-- Kabisat 2028: 29 Feb masuk periode Maret 2028 [25 Feb, 23 Mar]; ends_on 28 Feb memotong satu-satunya kemunculan.
select lives_ok(pg_temp.tg(:'sh', :'kg', 31, '2028-02-01', '2028-02-29'), 'tagihan Feb 2028 tanggal 31 (jatuh 29 Feb)');
select lives_ok(pg_temp.ag(:'sh', :'kg', '2028-02-01'), 'kabisat: anggaran wajib Februari 2028 lolos');
select throws_ok(pg_temp.ag(:'sh', :'kg', '2028-03-01'), 'DK422', 'obligation_double', 'kabisat: anggaran wajib Maret 2028 = obligation_double');
select lives_ok(pg_temp.tg(:'sh', :'kg2', 31, '2028-02-01', '2028-02-28'), 'tagihan 1..28 Feb 2028 tanggal 31 (tanpa kemunculan)');
select lives_ok(pg_temp.ag(:'sh', :'kg2', '2028-03-01'), 'kabisat: tagihan tanpa kemunculan tidak bentrok dengan Maret 2028');
-- Pergantian tahun: gajian Des = 23 Des (24 Des cuti bersama, 25 Des Natal). 22 Des = label Des, 23 Des = label Jan 2027.
select lives_ok(pg_temp.ag(:'sh', :'kh', '2027-01-01'), 'anggaran wajib Januari 2027');
select lives_ok(pg_temp.tg(:'sh', :'kh', 22, '2026-12-01', '2026-12-31'), 'tagihan Des tanggal 22 (label Des) lolos terhadap Januari');
select throws_ok(pg_temp.ag(:'sh', :'kh', '2026-12-01'), 'DK422', 'obligation_double', 'tanggal 22 Des: anggaran wajib Desember = obligation_double');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
    $q$update app.bills set day_of_month = 23 where category_id = %L$q$, :'kh')), 'DK422', 'obligation_double',
  'ubah tanggal ke 23 (23 Des = label Jan 2027) vs anggaran wajib Januari = obligation_double');
select lives_ok(pg_temp.ag(:'sh', :'kh2', '2026-12-01'), 'anggaran wajib Desember 2026');
select lives_ok(pg_temp.tg(:'sh', :'kh2', 23, '2026-12-01', '2026-12-31'), 'tagihan 23 Des (label Jan 2027) lolos terhadap Desember');
-- Hari gajian bergeser: tanggal 24 jatuh 24 Sep (label Sep), 24 Okt dan 24 Nov (keduanya label Nov), 24 Des (label Jan).
-- Label Okt dan Des tidak punya kemunculan sama sekali: anggaran wajib di sana tidak dihitung dua kali.
select lives_ok(pg_temp.tg(:'sh', :'ki', 24, '2026-09-01', '2026-12-31'), 'tagihan Sep..Des tanggal 24');
select lives_ok(pg_temp.ag(:'sh', :'ki', '2026-10-01'), 'tanggal 24: label Oktober tanpa kemunculan, anggaran wajib lolos');
select lives_ok(pg_temp.ag(:'sh', :'ki', '2026-12-01'), 'tanggal 24: label Desember tanpa kemunculan, anggaran wajib lolos');
select throws_ok(pg_temp.ag(:'sh', :'ki', '2026-09-01'), 'DK422', 'obligation_double', 'tanggal 24: label September = obligation_double');
select throws_ok(pg_temp.ag(:'sh', :'ki', '2026-11-01'), 'DK422', 'obligation_double', 'tanggal 24: label November (dua kemunculan) = obligation_double');
select throws_ok(pg_temp.ag(:'sh', :'ki', '2027-01-01'), 'DK422', 'obligation_double', 'tanggal 24: label Januari 2027 = obligation_double');
-- wajib false -> true, arsip lalu buka arsip (tagihan (b): label Des).
select lives_ok(pg_temp.ag(:'sh', :'kc', '2026-12-01', false), 'anggaran Desember tidak wajib boleh');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
    $q$update app.budgets set wajib = true where category_id = %L and month = '2026-12-01'$q$, :'kc')), 'DK422', 'obligation_double',
  'Desember menjadi wajib = obligation_double');
select is(tests.api_exec(tests.n(), format($$update app.bills set archived_at = now() where category_id = %L$$, :'kc')), 1::bigint,
  'arsipkan tagihan (b)');
select lives_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
    $q$update app.budgets set wajib = true where category_id = %L and month = '2026-12-01'$q$, :'kc')),
  'sesudah arsip, Desember boleh wajib');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
    $q$update app.bills set archived_at = null where category_id = %L$q$, :'kc')), 'DK422', 'obligation_double',
  'buka arsip tagihan yang kini bentrok = obligation_double');
-- Aturan kosong = bulan kalender (perilaku lama): 25 Okt berlabel Oktober.
select tests.owner_exec(null, 'update app.households set payday_rule = null');
select lives_ok(pg_temp.tg(:'sh', :'kk', 25, '2026-10-25', '2026-10-31'), 'aturan kosong: tagihan 25..31 Okt tanggal 25');
select lives_ok(pg_temp.ag(:'sh', :'kk', '2026-11-01'), 'aturan kosong: anggaran wajib November lolos (bulan kalender)');
select throws_ok(pg_temp.ag(:'sh', :'kk', '2026-10-01'), 'DK422', 'obligation_double', 'aturan kosong: anggaran wajib Oktober = obligation_double');

-- ===== bill_schedule (BSD §8): posted dari entri hidup, bill_archived =====
select pg_temp.bill(tests.n(), :'sh', 'Internet Rumah', :'internet', '2026-01-01') as bill_net \gset
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 350000, %L, '2026-11-02', 'Internet')$$,
  :'sh', :'kas', :'internet')) ->> 'entry_id' as netentry \gset
select tests.api_exec(tests.n(), format($q$insert into app.bill_occurrences (space_id, bill_id, due_on, amount, entry_id)
  values (%L, %L, '2026-11-20', 350000, %L), (%L, %L, '2026-12-20', 350000, null)$q$,
  :'sh', :'bill_net', :'netentry', :'sh', :'bill_net'));
select tests.api_exec(tests.n(), format($q$insert into app.bill_occurrences (space_id, bill_id, due_on, amount, skipped_at)
  values (%L, %L, '2026-12-20', 485000, now())$q$, :'sh', :'bill_des'));
select is(tests.web_val(tests.f(), format($$select string_agg(name || ':' || due_on || ':' || amount || ':' || posted || ':'
    || bill_archived || ':' || (skipped_at is not null), ',' order by due_on, name) from app.bill_schedule where space_id = %L$$, :'sh')),
  'Internet Rumah:2026-11-20:350000:true:false:false,Internet Rumah:2026-12-20:350000:false:false:false,'
  'Token Desember:2026-12-20:485000:false:true:true',
  'F melihat jadwal Bersama: terbayar dari entri hidup, terarsip, dilewati');
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'netentry'));
select is(tests.web_val(tests.n(), format($$select posted::text from app.bill_schedule where bill_id = %L and due_on = '2026-11-20'$$, :'bill_net')),
  'false', 'entri bayar dibatalkan: posted = false lagi');
select pg_temp.call(tests.n(), format($$select api.restore_entry(gen_random_uuid(), %L, 2)$$, :'netentry'));
select is(tests.web_val(tests.n(), format($$select posted::text from app.bill_schedule where bill_id = %L and due_on = '2026-11-20'$$, :'bill_net')),
  'true', 'entri dipulihkan: posted = true');

-- ===== Isolasi (BSD §13 #10): F/Luar tidak melihat apa pun dari Pribadi N, termasuk kanari =====
create temp table krel as select unnest(array['app.bills', 'app.bill_occurrences', 'app.budgets', 'app.bill_schedule']) as t;
select ok(tests.web_val(tests.n(), format('select count(*) from %s where space_id = %L', t, :'np'))::int > 0,
          'N melihat Pribadi sendiri: ' || t) from krel;
select is(tests.web_val(tests.f(), format('select count(*) from %s where space_id = %L', t, :'np')), '0',
          'F tidak melihat Pribadi N: ' || t) from krel;
select is(tests.web_val(tests.n(), format('select count(*) from %s where space_id = %L', t, :'fp')), '0',
          'N tidak melihat Pribadi F: ' || t) from krel;
select is(tests.web_val(tests.x(), format('select count(*) from %s', t)), '0',
          'Luar tidak melihat apa pun: ' || t) from krel;
select is(tests.web_val(tests.f(), format($$select count(*) from (
    select b::text as x from app.bills b
    union all select o::text from app.bill_occurrences o
    union all select bu::text from app.budgets bu
    union all select s::text from app.bill_schedule s
    union all select c::text from app.categories c
  ) s where x like '%%KANARI-N-%%' or x like %L or x like %L or x like %L$$,
  '%' || :'nbill' || '%', '%' || :'ncanary' || '%', '%' || :'bca' || '%')), '0',
  'F: tidak ada KANARI-N-TAGIHAN, KANARI-N-KATEGORI, id tagihan/kategori/dompet N di tagihan, kemunculan, anggaran, jadwal');
select is(tests.web_val(tests.n(), format($$select count(*) from (
    select b::text as x from app.bills b
    union all select o::text from app.bill_occurrences o
    union all select bu::text from app.budgets bu
    union all select s::text from app.bill_schedule s
    union all select c::text from app.categories c
  ) s where x like '%%KANARI-F-%%' or x like %L or x like %L$$, '%' || :'fbill' || '%', '%' || :'fcanary' || '%')), '0',
  'N: tidak ada kanari Pribadi F');
select is(tests.web_val(tests.n(), format($$select (select string_agg(name, ',') from app.bills where space_id = %1$L)
  || '/' || (select string_agg(c.name || ':' || bu.wajib, ',') from app.budgets bu
             join app.categories c on c.id = bu.category_id where bu.space_id = %1$L)$$, :'np')),
  'KANARI-N-TAGIHAN/KANARI-N-KATEGORI:true',
  'N melihat kanari sendiri (tagihan + anggaran wajib pada KANARI-N-KATEGORI)');
select is(tests.api_val(tests.f(), format($$select count(*) from app.bills where id = %L$$, :'nbill')), '0',
  'api/F tidak melihat tagihan N lewat id');
select is(tests.api_exec(tests.f(), format($$update app.bills set name = 'X' where id = %L$$, :'nbill')), 0::bigint,
  'api/F UPDATE tagihan N: 0 baris');
select is(tests.api_exec(tests.f(), format($$delete from app.budgets where space_id = %L$$, :'np')), 0::bigint,
  'api/F DELETE anggaran N: 0 baris');
select is(tests.owner_val(null, format($$select name || ' ' || (select count(*) from app.budgets where space_id = %L)
  from app.bills where id = %L$$, :'np', :'nbill')), 'KANARI-N-TAGIHAN 1', 'tagihan dan anggaran N tidak tersentuh');

select * from finish();
rollback;
