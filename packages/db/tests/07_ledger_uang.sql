-- Uang dan invarian ledger (BSD §8, §9, §13 #18 sampai #25, #29, #34; keputusan pemilik #7, #8):
-- dompet + saldo awal, pemasukan/pengeluaran, transfer Σ = −fee, space_transfer, kantor,
-- idempotensi, versi, saldo negatif, saldo awal 7 hari, cocokkan saldo, arsip, angka ringkasan.
-- Semua lewat fungsi api.* sebagai role web; jam dipatok 2026-03-20 WIB.
-- ID: B2, B3, B7, S1, S2, S3
begin;
select plan(103);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

-- Kategori dibuat owner; Gaji = kategori awal ruang Pribadi (0106).
select tests.owner_val(null, format($$insert into app.categories (space_id, type, name, icon)
  values (%L, 'expense', 'Makan', 'ForkKnife') returning id$$, :'np')) as makan \gset
select tests.owner_val(null, format($$select id from app.categories
  where space_id = %L and type = 'income' and name = 'Gaji'$$, :'np')) as gaji \gset
select tests.owner_val(null, format($$insert into app.categories (space_id, type, name, icon)
  values (%L, 'expense', 'Belanja', 'Basket') returning id$$, :'sh')) as belanja \gset

create function pg_temp.entry(p_uid uuid, p_acc uuid, p_kind text, p_amount bigint,
  p_on date default null, p_cat uuid default null, p_desc text default null,
  p_reimb boolean default false, p_allow boolean default false) returns uuid
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.create_entry(gen_random_uuid(), (select space_id from app.accounts where id = %L),
         %L, %L, %s, %L, %L::date, %L, %L, %L) ->> 'entry_id'$q$,
    p_acc, p_acc, p_kind, p_amount, p_cat, p_on, p_desc, p_reimb, p_allow))::uuid
$$;
create function pg_temp.trf(p_uid uuid, p_from uuid, p_to uuid, p_amount bigint, p_fee bigint,
  p_desc text default null, p_note text default null) returns jsonb
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.create_transfer(gen_random_uuid(), (select space_id from app.accounts where id = %L),
         %L, %L, %s, %s, null, %L, %L)$q$,
    p_from, p_from, p_to, p_amount, p_fee, p_desc, p_note))::jsonb
$$;

-- ===== Dompet + saldo awal =====
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 1000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Tabungan', 'tabungan', 500000, '2026-01-01') as tab,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 2000000, '2026-01-01') as kan,
       tests.account(tests.n(), :'np', 'Dana', 'operasional', 0, '2026-01-01') as dana,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 300000, '2026-01-01') as kas,
       tests.account(tests.f(), :'fp', 'BCA Farida', 'operasional', 400000, '2026-01-01') as fbca \gset

select is(tests.balance(:'bca'), 1000000::bigint, 'saldo awal tercatat');
select is(tests.owner_val(null, format($$select e.kind || ' ' || e.occurred_on || ' ' || e.version
  from app.entries e join app.entry_lines l on l.entry_id = e.id where l.account_id = %L$$, :'bca')),
  'opening_balance 2026-01-01 1', 'saldo awal = entri opening_balance pada opened_on');
select is(tests.owner_val(null, format($$select count(*) from app.entry_lines where account_id = %L$$, :'dana')),
  '0', 'saldo awal 0 tidak membuat entri');
select is(tests.owner_val(null, format($$select string_agg(h.op || ':' || h.version, ',') from app.entry_history h
  join app.entry_lines l on l.entry_id = h.entry_id where l.account_id = %L$$, :'bca')), 'create:1',
  'saldo awal menulis riwayat create');
select is(tests.owner_val(null, format($$select space_kind from app.accounts where id = %L$$, :'kas')), 'shared',
  'space_kind dompet diturunkan dari ruang');
select throws_ok(format($$select tests.account(tests.n(), %L, 'Kantor Bersama', 'kantor')$$, :'sh'),
  'DK422', 'kantor_personal_only', 'dompet kantor di Bersama ditolak');
select throws_ok(format($$select tests.account(tests.n(), %L, 'X', 'operasional', -1)$$, :'np'),
  'DK400', 'invalid_argument', 'saldo awal negatif ditolak');
select throws_ok(format($$select tests.account(tests.n(), %L, 'X', 'operasional', 0, '2026-03-21')$$, :'np'),
  'DK400', 'invalid_argument', 'opened_on masa depan ditolak');
select throws_ok(format($$select tests.account(tests.n(), %L, '  ', 'operasional')$$, :'np'),
  'DK400', 'invalid_argument', 'nama kosong ditolak');

-- ===== Fixture bulan Maret 2026 =====
select pg_temp.entry(tests.n(), :'bca', 'expense', 50000, null, :'makan', 'makan siang') as e1 \gset
select pg_temp.entry(tests.n(), :'bca', 'income', 200000, '2026-03-05', :'gaji') as e2 \gset
select pg_temp.entry(tests.n(), :'kan', 'expense', 75000) as e3 \gset
select pg_temp.entry(tests.n(), :'kan', 'income', 10000) as e4 \gset
select pg_temp.trf(tests.n(), :'bca', :'dana', 100000, 2500) ->> 'entry_id' as e5 \gset
select pg_temp.trf(tests.n(), :'kan', :'bca', 300000, 5000) ->> 'entry_id' as e6 \gset
select pg_temp.entry(tests.n(), :'bca', 'expense', 40000, null, null, 'talangan', true) as e7 \gset
select pg_temp.trf(tests.n(), :'bca', :'kas', 150000, 1000, 'rahasia setor', 'Setoran') as e8 \gset
select pg_temp.trf(tests.n(), :'kas', :'bca', 50000, 0, 'rahasia ambil', 'Diambil') as e9 \gset
select pg_temp.entry(tests.n(), :'bca', 'expense', 30000, '2026-02-10') as e10 \gset
select pg_temp.entry(tests.f(), :'kas', 'expense', 25000, null, :'belanja') as e11 \gset

select is(tests.balance(:'bca'), 1176500::bigint, 'saldo BCA sesudah fixture');
select is(tests.balance(:'dana'), 100000::bigint, 'saldo Dana');
select is(tests.balance(:'kan'), 1630000::bigint, 'saldo Kas Kantor');
select is(tests.balance(:'kas'), 375000::bigint, 'saldo Kas Rumah (Bersama)');

-- Transfer satu ruang: Σ lines = −fee, tiga line (main, counter, fee) di dompet yang benar.
select is(tests.owner_val(null, format($$select sum(amount) || ' ' || count(*) from app.entry_lines where entry_id = %L$$, :'e5')),
  '-2500 3', 'transfer: Σ = −fee, 3 line');
select is(tests.owner_val(null, format($$select string_agg(role || '=' || amount, ',' order by role)
  from app.entry_lines where entry_id = %L and account_id = %L$$, :'e5', :'bca')), 'main=-100000,fee=-2500',
  'transfer: main dan fee di dompet sumber');
select is(pg_temp.trf(tests.n(), :'bca', :'dana', 1000, 0) ->> 'link_id', null, 'transfer satu ruang tanpa link_id');
select is(tests.owner_val(null, format($$select count(*) from app.entry_lines l join app.entries e on e.id = l.entry_id
  where e.kind = 'transfer' and l.role = 'fee' and l.account_id = %L and e.occurred_on = '2026-03-20'$$, :'bca')),
  '1', 'fee 0 tidak membuat line fee');
select throws_ok(format($$select pg_temp.trf(tests.n(), %L, %L, 1000, 0)$$, :'bca', :'bca'),
  'DK400', 'invalid_argument', 'transfer ke dompet yang sama ditolak');
select throws_ok(format($$select pg_temp.trf(tests.n(), %L, %L, 1000, -1)$$, :'bca', :'dana'),
  'DK400', 'invalid_argument', 'fee negatif ditolak');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 1000, 0, null, null, 'catatan')$q$, :'np', :'bca', :'dana')),
  'DK400', 'invalid_argument', 'shared_note pada transfer satu ruang ditolak');

-- space_transfer: dua kaki bertaut, Σ main = 0, deskripsi hanya di kaki Pribadi (keputusan #9).
select is(tests.owner_val(null, format($$select count(*) || ' ' || count(distinct e.space_id) || ' ' || sum(l.amount)
  from app.entries e join app.entry_lines l on l.entry_id = e.id and l.role = 'main' where e.link_id = %L$$,
  (:'e8'::jsonb) ->> 'link_id')), '2 2 0', 'space_transfer: 2 kaki, 2 ruang, Σ main = 0');
select is(tests.owner_val(null, format($$select string_agg(e.space_kind || ':' || e.direction || ':'
    || coalesce(e.description, '-') || ':' || coalesce(e.shared_note, '-'), ',' order by e.direction)
  from app.entries e where e.link_id = %L$$, (:'e8'::jsonb) ->> 'link_id')),
  'personal:out:rahasia setor:-,shared:in:-:Setoran', 'setor ke Bersama: deskripsi di Pribadi, catatan di Bersama');
select is(tests.owner_val(null, format($$select string_agg(e.space_kind || ':' || e.direction || ':'
    || coalesce(e.description, '-') || ':' || coalesce(e.shared_note, '-'), ',' order by e.direction)
  from app.entries e where e.link_id = %L$$, (:'e9'::jsonb) ->> 'link_id')),
  'shared:out:-:Diambil,personal:in:rahasia ambil:-', 'ambil dari Bersama: deskripsi hanya di kaki Pribadi');
select is(tests.owner_val(null, format($$select string_agg(l.role || '=' || l.amount, ',' order by l.role)
  from app.entry_lines l where l.entry_id = %L$$, (:'e8'::jsonb) ->> 'entry_id')), 'main=-150000,fee=-1000',
  'fee space_transfer di kaki out');
select throws_ok(format($$select pg_temp.trf(tests.n(), %L, %L, 1000, 0)$$, :'kan', :'kas'),
  'DK422', 'cross_space_kantor', 'space_transfer dari dompet kantor ditolak');
select throws_ok(format($$select pg_temp.trf(tests.n(), %L, %L, 1000, 0)$$, :'kas', :'kan'),
  'DK422', 'cross_space_kantor', 'space_transfer ke dompet kantor ditolak');
select throws_ok(format($$select pg_temp.trf(tests.n(), %L, %L, 1000, 0)$$, :'bca', :'fbca'),
  'DK404', 'account_not_found', 'dua ruang Pribadi tidak mungkin (dompet pasangan tidak terlihat)');

-- ===== Angka ringkasan (golden, dihitung manual) =====
select is(tests.web_val(tests.n(), format($$select row(m.*)::text from api.month_summary(%L, '2026-03-01') m$$, :'np')),
  '(200000,53500,146500,10000,80000,601000)',
  'month_summary Pribadi: fee kantor di kantor_keluar, talangan dan kantor bukan pengeluaran');
select is(tests.web_val(tests.n(), format($$select row(m.*)::text from api.month_summary(%L, '2026-03-01') m$$, :'sh')),
  '(0,25000,-25000,0,0,200000)', 'month_summary Bersama: setoran/ambil bukan pemasukan/pengeluaran');
select is(tests.web_val(tests.n(), format($$select row(m.*)::text from api.month_summary(%L, '2026-02-01') m$$, :'np')),
  '(0,30000,-30000,0,0,0)', 'month_summary Februari');
select is(tests.web_val(tests.n(), format($$select row(w.*)::text from api.net_worth(%L) w$$, :'np')),
  '(1276500,500000,1630000,1776500)', 'net_worth: operasional + tabungan, kantor dikecualikan');
select is(tests.web_val(tests.n(), format($$select row(s.*)::text from api.safe_to_spend(%L) s$$, :'np')),
  '(1276500,0,0,1276500,106375,12,2026-03-31)', 'safe_to_spend: operasional / sisa hari (12)');
select is(tests.web_val(tests.n(), format($$select row(s.*)::text from api.safe_to_spend(%L, '2026-03-31') s$$, :'np')),
  '(1276500,0,0,1276500,1276500,1,2026-03-31)', 'safe_to_spend hari terakhir bulan');
select is(tests.web_val(tests.n(), format($$select outflow || ' ' || entry_count from api.period_summary(%L, '2026-03-01', '2026-03-31')
  where report_class = 'x_talangan'$$, :'np')), '40000 1', 'period_summary: talangan kelas sendiri');
select is(tests.web_val(tests.n(), format($$select string_agg(report_class, ',' order by report_class)
  from api.period_summary(%L, '2026-03-01', '2026-03-31')$$, :'np')),
  'expense,expense_fee,income,x_ambil_bersama,x_kantor,x_setor_bersama,x_talangan,x_transfer',
  'period_summary: kelas laporan Pribadi Maret');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select count(*) from api.month_summary(%L, '2026-03-02')$q$, :'np')),
  'DK400', 'invalid_argument', 'month_summary: bulan harus tanggal 1');

-- ===== Validasi create_entry =====
select throws_ok(format($$select pg_temp.entry(tests.n(), %L, 'expense', 1, '2026-03-21')$$, :'bca'),
  'DK400', 'invalid_argument', 'tanggal masa depan ditolak');
select throws_ok(format($$select pg_temp.entry(tests.n(), %L, 'expense', 1, '2025-12-31')$$, :'bca'),
  'DK422', 'before_opening', 'tanggal sebelum dompet dibuka ditolak');
select throws_ok(format($$select pg_temp.entry(tests.n(), %L, 'expense', 0)$$, :'bca'),
  'DK400', 'invalid_argument', 'nominal 0 ditolak');
select throws_ok(format($$select pg_temp.entry(tests.n(), %L, 'expense', 10000000000001)$$, :'bca'),
  'DK400', 'invalid_argument', 'nominal > 10^13 ditolak');
select throws_ok(format($$select pg_temp.entry(tests.n(), %L, 'transfer', 1)$$, :'bca'),
  'DK400', 'invalid_argument', 'create_entry hanya income/expense');
select throws_ok(format($$select pg_temp.entry(tests.n(), %L, 'expense', 1, null, %L)$$, :'bca', :'gaji'),
  'DK404', 'category_not_found', 'kategori pemasukan pada pengeluaran ditolak');
select throws_ok(format($$select pg_temp.entry(tests.n(), %L, 'expense', 1, null, %L)$$, :'bca', :'belanja'),
  'DK404', 'category_not_found', 'kategori ruang lain ditolak');
select throws_ok(format($$select pg_temp.entry(tests.n(), %L, 'expense', 1, null, null, null, true)$$, :'kas'),
  'DK422', 'reimbursable_personal_expense_only', 'talangan di Bersama ditolak');
select throws_ok(format($$select pg_temp.entry(tests.n(), %L, 'income', 1, null, null, null, true)$$, :'bca'),
  'DK422', 'reimbursable_personal_expense_only', 'talangan pada pemasukan ditolak');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1)$q$, :'sh', :'bca')),
  'DK422', 'space_mismatch', 'p_space_id berbeda dari ruang dompet ditolak');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1, null, null, %L)$q$, :'np', :'bca', repeat('a', 201))),
  'DK400', 'invalid_argument', 'deskripsi > 200 ditolak');

-- ===== Idempotensi (BSD §13 #21) =====
select tests.web_val(tests.n(), format($$select api.create_entry('aaaaaaaa-0000-0000-0000-000000000001', %L, %L, 'expense', 1000)$$,
  :'np', :'dana'))::jsonb as idem1 \gset
select is((:'idem1'::jsonb) ->> 'replayed', 'false', 'kunci baru: replayed false');
select is(tests.web_val(tests.n(), format($$select api.create_entry('aaaaaaaa-0000-0000-0000-000000000001', %L, %L, 'expense', 1000)$$,
  :'np', :'dana'))::jsonb, (:'idem1'::jsonb) - 'replayed' || '{"replayed": true}', 'klik ganda: hasil sama, replayed true');
select is(tests.owner_val(null, format($$select count(*) from app.entry_lines where account_id = %L and amount = -1000$$, :'dana')),
  '1', 'klik ganda = 1 entri');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.create_entry('aaaaaaaa-0000-0000-0000-000000000001', %L, %L, 'expense', 2000)$q$, :'np', :'dana')),
  'DK410', 'idempotency_key_reused', 'kunci sama isi beda = DK410');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.create_transfer('aaaaaaaa-0000-0000-0000-000000000001', %L, %L, %L, 1000)$q$, :'np', :'dana', :'bca')),
  'DK410', 'idempotency_key_reused', 'kunci sama operasi lain = DK410');
select lives_ok(format($$select tests.web_val(tests.f(), %L)$$, format(
    $q$select api.create_entry('aaaaaaaa-0000-0000-0000-000000000001', %L, %L, 'expense', 1000)$q$, :'fp', :'fbca')),
  'kunci per user: user lain boleh memakai client_id yang sama');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.create_entry(null, %L, %L, 'expense', 1000)$q$, :'np', :'dana')),
  'DK400', 'invalid_argument', 'tanpa client_id ditolak');
select is(tests.web_val(tests.n(), format($$select api.create_entry('aaaaaaaa-0000-0000-0000-000000000002', %L, %L, 'expense', 500, null, null, null, false, true) ->> 'replayed'$$,
  :'np', :'dana')), 'false', 'kunci kedua');
select is(tests.web_val(tests.n(), format($$select api.create_entry('aaaaaaaa-0000-0000-0000-000000000002', %L, %L, 'expense', 500, null, null, null, false, false) ->> 'replayed'$$,
  :'np', :'dana')), 'true', 'hash tanpa p_allow_negative: ulang dengan flag beda tetap replay');

-- ===== Saldo negatif (BSD §13 #23) =====
select tests.account(tests.n(), :'np', 'Nol', 'operasional', 0, '2026-01-01') as nol \gset
select throws_ok(format($$select pg_temp.entry(tests.n(), %L, 'expense', 10)$$, :'nol'),
  'DK422', 'saldo_negatif', 'pengeluaran melebihi saldo tanpa flag ditolak');
select is(tests.owner_val(null, format($$select count(*) from app.entry_lines where account_id = %L$$, :'nol')),
  '0', 'penolakan saldo_negatif tanpa efek');
select throws_ok(format($$select pg_temp.trf(tests.n(), %L, %L, 10, 0)$$, :'nol', :'bca'),
  'DK422', 'saldo_negatif', 'transfer melebihi saldo ditolak');
select lives_ok(format($$select pg_temp.entry(tests.n(), %L, 'expense', 10, null, null, null, false, true)$$, :'nol'),
  'dengan p_allow_negative tersimpan');
select is(tests.balance(:'nol'), -10::bigint, 'saldo boleh negatif dengan konfirmasi');
select lives_ok(format($$select pg_temp.entry(tests.n(), %L, 'income', 4)$$, :'nol'),
  'pemasukan ke dompet negatif tidak ditolak');
select is(tests.balance(:'nol'), -6::bigint, 'saldo -6');
select throws_ok(format($$select pg_temp.entry(tests.n(), %L, 'expense', 1000000)$$, :'tab'),
  'DK422', 'saldo_negatif', 'tabungan juga dijaga saldo_negatif');

-- ===== Versi dan riwayat (BSD §13 #22) =====
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.update_entry(gen_random_uuid(), %L, 2, %L, 60000, %L, null, 'x', false)$q$, :'e1', :'bca', :'makan')),
  'DK409', 'version_conflict', 'versi lama = DK409');
select is(tests.owner_val(null, format($$select version || ' ' || description from app.entries where id = %L$$, :'e1')),
  '1 makan siang', 'DK409 tanpa perubahan data');
select is(tests.web_val(tests.n(), format($$select api.update_entry(gen_random_uuid(), %L, 1, %L, 60000, %L, null, 'makan malam', false) ->> 'version'$$,
  :'e1', :'bca', :'makan')), '2', 'update menaikkan versi');
select is(tests.owner_val(null, format($$select string_agg(op || ':' || version, ',' order by version) from app.entry_history where entry_id = %L$$, :'e1')),
  'create:1,update:2', 'setiap mutasi menambah tepat 1 riwayat');
select is(tests.balance(:'bca'), 1165500::bigint, 'update nominal mengubah saldo (-10000)');
select is(tests.web_val(tests.n(), format($$select api.update_entry(gen_random_uuid(), %L, 2, %L, 60000, null, '2026-03-01', null, false) ->> 'version'$$,
  :'e1', :'dana')), '3', 'update pindah dompet dan tanggal');
select is(tests.owner_val(null, format($$select coalesce(e.description, '-') || ' ' || coalesce(e.category_id::text, '-') || ' ' || e.occurred_on
  || ' ' || l.account_id from app.entries e join app.entry_lines l on l.entry_id = e.id where e.id = %L$$, :'e1')),
  '- - 2026-03-01 ' || :'dana', 'ganti-penuh: kategori dan deskripsi NULL tersimpan NULL');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.update_entry(gen_random_uuid(), %L, 1, %L, 1, null, null, null, false)$q$, :'e5', :'bca')),
  'DK422', 'kind_not_editable', 'transfer tidak diubah lewat update_entry');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.update_entry(gen_random_uuid(), %L, 3, null, 1, null, null, null, false)$q$, :'e1')),
  'DK400', 'invalid_argument', 'update tanpa dompet = DK400 (bukan DK404)');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.update_entry(gen_random_uuid(), %L, null, %L, 1, null, null, null, false)$q$, :'e1', :'bca')),
  'DK400', 'invalid_argument', 'update tanpa expected_version = DK400 (bukan lolos)');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.update_entry(gen_random_uuid(), %L, 1, %L, 1, null, null, null, false)$q$, :'e2', :'kas')),
  'DK422', 'space_mismatch', 'update ke dompet ruang lain ditolak');

-- ===== Saldo awal (BSD §13 #24) =====
select tests.owner_val(null, format($$select e.id from app.entries e join app.entry_lines l on l.entry_id = e.id
  where e.kind = 'opening_balance' and l.account_id = %L$$, :'tab')) as ob \gset
select is(tests.web_val(tests.n(), format($$select api.update_entry(gen_random_uuid(), %L, 1, %L, 600000, null, null, null, false) ->> 'version'$$,
  :'ob', :'tab')), '2', 'saldo awal bisa diubah dalam 7 hari');
select is(tests.balance(:'tab'), 600000::bigint, 'saldo awal baru');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.void_entry(gen_random_uuid(), %L, 2)$q$, :'ob')),
  'DK422', 'opening_locked', 'saldo awal tidak bisa dibatalkan');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.update_entry(gen_random_uuid(), %L, 2, %L, 1, null, null, null, false)$q$, :'ob', :'bca')),
  'DK422', 'opening_locked', 'saldo awal tidak bisa pindah dompet');
select tests.clock('9 days');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.update_entry(gen_random_uuid(), %L, 2, %L, 700000, null, null, null, false)$q$, :'ob', :'tab')),
  'DK422', 'opening_locked', 'saldo awal terkunci setelah 7 hari');
select tests.clock_at('2026-03-20 10:00+07');

-- ===== Cocokkan saldo (BSD §13 #25) =====
select is(tests.web_val(tests.n(), format($$select api.reconcile_balance(gen_random_uuid(), %L, 123456) ->> 'entry_id' is not null$$, :'dana')),
  'true', 'cocokkan saldo membuat entri adjustment');
select is(tests.balance(:'dana'), 123456::bigint, 'saldo akhir = target');
select is(tests.web_val(tests.n(), format($$select coalesce(api.reconcile_balance(gen_random_uuid(), %L, 123456) ->> 'entry_id', 'null')$$, :'dana')),
  'null', 'selisih 0 tidak membuat entri');
select is(tests.owner_val(null, format($$select count(*) from app.entries e join app.entry_lines l on l.entry_id = e.id
  where e.kind = 'adjustment' and l.account_id = %L$$, :'dana')), '1', 'tepat satu adjustment');
select is(tests.web_val(tests.n(), format($$select api.reconcile_balance(gen_random_uuid(), %L, -5) ->> 'version'$$, :'nol')),
  '1', 'cocokkan saldo ke angka negatif (dompet dibuka minus, §15 butir 3)');

-- ===== Arsip dompet (keputusan pemilik #8, BSD §13 #34) =====
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format($q$select api.archive_account(%L)$q$, :'dana')),
  'DK422', 'balance_not_zero', 'arsip dompet bersaldo bukan 0 ditolak');
select tests.web_val(tests.n(), format($$select api.reconcile_balance(gen_random_uuid(), %L, 0)$$, :'dana'));
select is(tests.web_val(tests.n(), format($$select api.archive_account(%L) ->> 'archived'$$, :'dana')), 'true',
  'arsip dompet bersaldo 0');
select is(tests.web_val(tests.n(), format($$select api.archive_account(%L) ->> 'archived'$$, :'dana')), 'true',
  'arsip ulang idempoten');
select throws_ok(format($$select pg_temp.entry(tests.n(), %L, 'income', 1)$$, :'dana'),
  'DK422', 'account_archived', 'dompet terarsip tidak bisa dicatat');
select throws_ok(format($$select pg_temp.trf(tests.n(), %L, %L, 1, 0)$$, :'bca', :'dana'),
  'DK422', 'account_archived', 'transfer ke dompet terarsip ditolak');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.reconcile_balance(gen_random_uuid(), %L, 5)$q$, :'dana')),
  'DK422', 'account_archived', 'cocokkan saldo dompet terarsip ditolak');
select throws_ok(format($$select tests.web_val(tests.n(), %L)$$, format(
    $q$select api.update_entry(gen_random_uuid(), %L, 3, %L, 1, null, null, null, false)$q$, :'e1', :'bca')),
  'DK422', 'account_archived', 'update entri di dompet terarsip ditolak (saldo harus tetap 0)');
select is(tests.web_val(tests.n(), format($$select (s.operasional = w.operasional)::text
  from api.safe_to_spend(%L) s, api.net_worth(%L) w$$, :'np', :'np')), 'true',
  'safe_to_spend dan net_worth memakai himpunan dompet operasional yang sama');

-- ===== Bersama: setoran dan pengambilan dengan fee dari dompet Bersama (Februari) =====
select tests.web_val(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 70000, 0, '2026-02-15', 'setor feb')$$,
  :'np', :'bca', :'kas'));
select tests.web_val(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 20000, 2000, '2026-02-15', 'ambil feb', 'Ambil')$$,
  :'sh', :'kas', :'bca'));
select is(tests.web_val(tests.n(), format($$select row(m.*)::text from api.month_summary(%L, '2026-02-01') m$$, :'sh')),
  '(0,2000,-2000,0,0,90000)', 'month_summary Bersama: fee dari dompet Bersama = pengeluaran, setoran bukan pemasukan');
select is(tests.web_val(tests.f(), format($$select string_agg(report_class || '=' || inflow || '/' || outflow, ',' order by report_class)
  from api.period_summary(%L, '2026-02-01', '2026-02-28')$$, :'sh')),
  'expense_fee=0/2000,x_diambil_anggota=0/20000,x_setoran_anggota=70000/0', 'period_summary Bersama: x_setoran_anggota, x_diambil_anggota, expense_fee');
select is(tests.web_val(tests.n(), format($$select row(m.*)::text from api.month_summary(%L, '2026-02-01') m$$, :'np')),
  '(0,30000,-30000,0,0,90000)', 'month_summary Pribadi Februari: setor/ambil hanya transfer, fee Bersama tidak dobel');
select is(tests.web_val(tests.n(), format($$select string_agg(report_class, ',' order by report_class)
  from api.period_summary(%L, '2026-02-01', '2026-02-28')$$, :'np')), 'expense,x_ambil_bersama,x_setor_bersama',
  'period_summary Pribadi Februari');

-- ===== Bentuk lines rusak (lewat owner) = DK500 saat set constraints all immediate (BSD §13 #18) =====
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format($q$do $d$
  declare v uuid;
  begin
    insert into app.entries (space_id, space_kind, kind, occurred_on, created_by, updated_by)
    values (%L, 'personal', 'expense', '2026-03-20', %L, %L) returning id into v;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount) values (v, %L, 'main', %L, 10);
    set constraints all immediate;
  end $d$$q$, :'np', tests.n(), tests.n(), :'np', :'bca')),
  'DK500', 'entry_shape_invalid', 'pengeluaran bernilai positif = DK500');
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format($q$do $d$
  declare v uuid;
  begin
    insert into app.entries (space_id, space_kind, kind, occurred_on, created_by, updated_by)
    values (%L, 'personal', 'transfer', '2026-03-20', %L, %L) returning id into v;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    values (v, %L, 'main', %L, -10), (v, %L, 'counter', %L, 9);
    set constraints all immediate;
  end $d$$q$, :'np', tests.n(), tests.n(), :'np', :'bca', :'np', :'tab')),
  'DK500', 'entry_shape_invalid', 'transfer dengan Σ ≠ −fee = DK500');
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format($q$do $d$
  begin
    delete from app.entry_lines where entry_id = %L and role = 'main';
    set constraints all immediate;
  end $d$$q$, (:'e8'::jsonb) ->> 'linked_entry_id')),
  'DK500', 'entry_shape_invalid', 'kaki space_transfer tanpa line main = DK500');
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format($q$do $d$
  begin
    update app.entries set occurred_on = '2026-03-19' where id = %L;
    set constraints all immediate;
  end $d$$q$, (:'e8'::jsonb) ->> 'linked_entry_id')),
  'DK500', 'space_transfer_pair_invalid', 'pasangan beda tanggal = DK500');

-- ===== BSD §13 #9 (S9, Task 8): kelengkapan kelas laporan untuk kombinasi yang lolos cek bentuk =====
-- Kombinasi enum yang bisa ada di entri hidup: CHECK app.entries (direction hanya space_transfer,
-- reimbursable hanya expense Pribadi, reimbursement hanya Pribadi), CHECK app.accounts (kantor hanya
-- Pribadi), private.assert_entry_shape (counter hanya transfer; fee hanya transfer dan space_transfer
-- keluar) dan pasangan space_transfer (tanpa Kas Kantor). Semua kombinasi enum (termasuk yang ditolak)
-- sudah dijaga 00_katalog (#9); di sini: tidak ada yang NULL dan tepat 12 kelas berbeda di S9 (BSD §8.1).
-- Tiga kelas sisa spec §9.1 (x_pokok_utang, x_pelunasan_utang, x_valuasi) milik M3/M4.
-- Sementara (S11 Task 2): kind utang dikecualikan; Task 3 (0130) menambah bentuk + kelasnya di sini.
\set valid_combo 'select app.report_class(k, r, p, s, d, x) as c from unnest(enum_range(null::app.entry_kind)) k, unnest(enum_range(null::app.line_role)) r, unnest(enum_range(null::app.pocket)) p, unnest(enum_range(null::app.space_kind)) s, (select unnest(enum_range(null::app.entry_direction)) union all select null) dd (d), unnest(array[true, false]) x where k not in (''debt_principal'', ''debt_payment'') and (k = ''space_transfer'') = (d is not null) and (not x or (k = ''expense'' and s = ''personal'')) and (k <> ''reimbursement'' or s = ''personal'') and (p <> ''kantor'' or s = ''personal'') and (r <> ''counter'' or k = ''transfer'') and (r <> ''fee'' or k = ''transfer'' or (k = ''space_transfer'' and d = ''out'')) and (k <> ''space_transfer'' or p <> ''kantor'')'
select is(tests.owner_val(null, format($$select count(*) filter (where c is null) || '/' || count(*) || ' '
    || count(distinct c) from (%s) t$$, :'valid_combo')),
  '0/53 12', 'report_class tidak NULL untuk 53 kombinasi yang lolos cek bentuk; tepat 12 kelas [BSD §13 #9]');
select is(tests.owner_val(null, format($$select string_agg(distinct c collate "C", ',' order by c collate "C") from (%s) t$$, :'valid_combo')),
  'expense,expense_fee,income,x_ambil_bersama,x_diambil_anggota,x_kantor,x_koreksi,x_reimburse,'
  || 'x_setor_bersama,x_setoran_anggota,x_talangan,x_transfer',
  '12 kelas BSD §8.1 tercapai dari kombinasi yang sah (tidak ada kelas mati, tidak ada kelas baru)');

select * from finish();
rollback;
