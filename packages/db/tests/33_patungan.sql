-- Patungan S12 sisi skema (0135; plan S12 Task 6, bingkai S12-ADR1): dompet sistem `patungan` hanya
-- Bersama dan satu per ruang (CHECK + indeks), nama tidak menghalangi dompet pengguna, kelas laporan
-- x_patungan, app.member_balances nol-jumlah, RLS tabel patungan (Pribadi pasangan tidak terbaca), jalur
-- generik ditolak (split_locked untuk entri patungan, account_not_found untuk dompet sistem di catat/
-- transfer/Cocokkan saldo/arsip/tagihan rutin/ubah entri), Sampah tanpa entri patungan, anggota tidak bisa
-- keluar dari Bersama selama patungannya belum impas. Data dibuat lewat api.create_split (0136).
-- Jam dipatok 2026-03-20 WIB.
-- ID: B1, B2, B10, B21
begin;
select plan(41);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 10000000, '2026-01-01') as bca,
       tests.account(tests.f(), :'fp', 'Mandiri', 'operasional', 1000000, '2026-01-01') as mdr,
       tests.account(tests.n(), :'sh', 'Kas Bersama', 'operasional', 500000, '2026-01-01') as kas \gset
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Listrik & Air'$q$, :'sh'))
  as listrik \gset

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
create function pg_temp.split(p_uid uuid, p_acc uuid, p_amount bigint) returns jsonb
language sql as $$
  select pg_temp.call(p_uid, format($q$select api.create_split(gen_random_uuid(), %L, %L, %s,
    (select id from app.categories where space_id = %L and name = 'Listrik & Air'), '2026-03-10', 'Listrik Maret')$q$,
    tests.space_id(tests.n(), 'shared'), p_acc, p_amount, tests.space_id(tests.n(), 'shared')))
$$;
create function pg_temp.ver(p_entry uuid) returns int
language sql as $$ select tests.owner_val(null, format('select version from app.entries where id = %L', p_entry))::int $$;

-- ===== Dompet sistem: hanya Bersama, satu per ruang, dibuat malas =====
select throws_ok(format($$select tests.raw_exec($q$insert into app.accounts (space_id, space_kind, name, pocket,
    wallet_type, opened_on, created_by) values (%L, 'personal', 'X', 'patungan', 'cash', '2026-01-01', %L)$q$)$$,
    :'np', tests.n()),
  '23514', null, 'CHECK accounts_patungan_shared: dompet sistem di Pribadi ditolak [B10]');
select throws_ok(format($$select tests.api_exec(%L, $q$insert into app.accounts (space_id, space_kind, name, pocket,
    wallet_type, opened_on, created_by) values (%L, 'shared', 'X', 'patungan', 'cash', '2026-01-01', %L)$q$)$$,
    tests.n(), :'sh', tests.n()),
  'DK404', 'account_not_found', 'dompet sistem tidak bisa dibuat di luar fungsi patungan');
select is(tests.owner_val(null, $$select count(*) from app.accounts where pocket = 'patungan'$$), '0',
  'belum ada tagihan patungan: belum ada dompet sistem');

select pg_temp.split(tests.n(), :'bca', 400000) as s1 \gset
select :'s1'::jsonb ->> 'split_id' as s1_id, :'s1'::jsonb ->> 'expense_entry_id' as s1_exp,
       :'s1'::jsonb ->> 'in_entry_id' as s1_in, :'s1'::jsonb ->> 'out_entry_id' as s1_out \gset
select tests.owner_val(null, $$select id from app.accounts where pocket = 'patungan'$$) as pat \gset
select is(tests.owner_val(null, format($$select space_id || '/' || space_kind || '/' || name || '/' || (archived_at is null)
  from app.accounts where id = %L$$, :'pat')), :'sh' || '/shared/Patungan/true',
  'tagihan pertama membuat satu dompet sistem `Patungan` di ruang Bersama');
select throws_ok(format($$select tests.raw_exec($q$insert into app.accounts (space_id, space_kind, name, pocket,
    wallet_type, opened_on, created_by) values (%L, 'shared', 'Lain', 'patungan', 'cash', '2026-01-01', %L)$q$)$$,
    :'sh', tests.n()),
  '23505', null, 'accounts_patungan_one: dompet sistem kedua di ruang yang sama ditolak');
select pg_temp.split(tests.f(), :'mdr', 10000);
select is(tests.owner_val(null, $$select count(*) from app.accounts where pocket = 'patungan'$$), '1',
  'tagihan berikutnya (anggota lain) memakai dompet sistem yang sama');
select isnt(tests.account(tests.n(), :'sh', 'Patungan', 'operasional'), null,
  'pengguna tetap boleh menamai dompet Bersama `Patungan` (indeks nama tanpa dompet sistem)');

-- ===== Kelas laporan =====
select is(tests.owner_val(null, $$select string_agg(app.report_class(k::app.entry_kind, 'main', p::app.pocket,
    s::app.space_kind, d::app.entry_direction, false), ',' order by ord)
  from (values (1, 'space_transfer', 'patungan', 'shared', 'in'), (2, 'space_transfer', 'patungan', 'shared', 'out'),
               (3, 'expense', 'patungan', 'shared', null), (4, 'space_transfer', 'operasional', 'personal', 'out'),
               (5, 'space_transfer', 'operasional', 'personal', 'in'), (6, 'space_transfer', 'operasional', 'shared', 'in'))
       v (ord, k, p, s, d)$$),
  'x_patungan,x_patungan,expense,x_setor_bersama,x_ambil_bersama,x_setoran_anggota',
  'kaki dompet sistem = x_patungan; pengeluaran dari dompet sistem tetap expense; kelas lain tidak berubah');
select is(tests.web_val(tests.n(), format($$select string_agg(report_class || ':' || amount, ',' order by report_class)
  from app.report_lines where entry_id in (%L, %L, %L)$$, :'s1_out', :'s1_in', :'s1_exp')),
  'expense:-400000,x_patungan:400000,x_setor_bersama:-400000',
  'tiga entri tagihan: Pribadi x_setor_bersama, Bersama x_patungan + expense');

-- ===== Saldo antar-anggota dan RLS =====
select is(tests.web_val(tests.n(), format($$select string_agg(case user_id when %L then 'N' else 'F' end || '=' || balance, ','
    order by user_id) || '|' || sum(balance) from app.member_balances where space_id = %L$$, tests.n(), :'sh')),
  'N=195000,F=-195000|0', 'member_balances: N +200000 −5000, F −200000 +5000, nol-jumlah');
select is(tests.web_val(tests.f(), format($$select count(*) from app.member_balances where space_id = %L$$, :'sh')), '2',
  'Farida membaca saldo Bersama yang sama');
select is(tests.web_val(tests.x(), $$select count(*) || '/' || (select count(*) from app.splits)
    || '/' || (select count(*) from app.split_shares) || '/' || (select count(*) from app.settlements)
  from app.member_balances$$), '0/0/0/0', 'orang luar: 0 baris di tabel dan view patungan [B1]');
select is(tests.web_val(tests.f(), format($$select count(*) from app.splits where id = %L$$, :'s1_id'))
  || '/' || tests.web_val(tests.f(), format($$select count(*) from app.entries where id = %L$$, :'s1_out'))
  || '/' || tests.web_val(tests.f(), format($$select count(*) from app.entry_lines where entry_id = %L$$, :'s1_out'))
  || '/' || tests.web_val(tests.f(), format($$select count(*) from app.accounts where id = %L$$, :'bca')),
  '1/0/0/0', 'Farida melihat tagihan Bersama, tetapi tidak kaki Pribadi Novanda atau dompet BCA [B1, B21]');
select is(tests.web_val(tests.f(), format($$select count(*) from app.entries where id in (%L, %L) and description is null$$,
    :'s1_in', :'s1_exp')) || '/' || tests.web_val(tests.f(), format($$select description from app.entries where id = %L$$, :'s1_exp')),
  '1/Listrik Maret', 'kaki masuk Bersama tanpa deskripsi (CHECK); pengeluaran Bersama membawa deskripsi tagihan [B4]');
select throws_ok(format($$select tests.web_exec(%L, $q$insert into app.splits (space_id, in_entry_id, expense_entry_id,
    payer_id, amount) values (%L, %L, %L, %L, 1)$q$)$$, tests.n(), :'sh', :'s1_in', :'s1_exp', tests.n()),
  '42501', null, 'web tidak bisa menulis tabel patungan langsung');
select throws_ok(format($$select tests.web_exec(%L, $q$insert into private.split_ctx values (pg_current_xact_id())$q$)$$,
    tests.n()), '42501', null, 'web tidak bisa membuka konteks patungan');

-- ===== Jalur generik: dompet sistem bukan pilihan pengguna (account_not_found) =====
select throws_ok(format($$select pg_temp.call(%L, $q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1000)$q$)$$,
    tests.n(), :'sh', :'pat'), 'DK404', 'account_not_found', 'catat pengeluaran dari dompet sistem ditolak');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.create_entry(gen_random_uuid(), %L, %L, 'income', 1000)$q$)$$,
    tests.f(), :'sh', :'pat'), 'DK404', 'account_not_found', 'catat pemasukan ke dompet sistem ditolak');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 1000)$q$)$$,
    tests.n(), :'sh', :'kas', :'pat'), 'DK404', 'account_not_found', 'transfer ke dompet sistem ditolak');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 1000, 0, null, null, null, true)$q$)$$,
    tests.n(), :'sh', :'pat', :'kas'), 'DK404', 'account_not_found', 'transfer dari dompet sistem ditolak');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 1000)$q$)$$,
    tests.n(), :'np', :'bca', :'pat'), 'DK404', 'account_not_found', 'setor Pribadi langsung ke dompet sistem ditolak');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.reconcile_balance(gen_random_uuid(), %L, 5)$q$)$$,
    tests.n(), :'pat'), 'DK404', 'account_not_found', 'Cocokkan saldo dompet sistem ditolak');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.archive_account(%L)$q$)$$, tests.n(), :'pat'),
  'DK404', 'account_not_found', 'arsip dompet sistem ditolak');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.create_bill(gen_random_uuid(), %L, 'Listrik', 1000, %L,
    5::smallint, '2026-03-01', null, %L)$q$)$$, tests.n(), :'sh', :'listrik', :'pat'),
  'DK404', 'account_not_found', 'tagihan rutin dengan dompet sistem ditolak');
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1000, %L)$$,
  :'sh', :'kas', :'listrik')) ->> 'entry_id' as plain \gset
select throws_ok(format($$select pg_temp.call(%L, $q$select api.update_entry(gen_random_uuid(), %L, 1, %L, 1000, null, null, null, false)$q$)$$,
    tests.n(), :'plain', :'pat'), 'DK404', 'account_not_found', 'ubah pengeluaran Bersama biasa ke dompet sistem ditolak');

-- ===== Jalur generik: entri patungan terkunci (split_locked) =====
select throws_ok(format($$select pg_temp.call(%L, $q$select api.update_entry(gen_random_uuid(), %L, %s, %L, 400000,
    null, null, 'Ubah', false)$q$)$$, tests.n(), :'s1_exp', pg_temp.ver(:'s1_exp'), :'pat'),
  'DK422', 'split_locked', 'ubah pengeluaran patungan lewat jalur generik ditolak');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.update_entry(gen_random_uuid(), %L, %s, %L, 400000,
    null, null, 'Ubah', false)$q$)$$, tests.n(), :'s1_exp', pg_temp.ver(:'s1_exp'), :'kas'),
  'DK422', 'split_locked', 'pindah pengeluaran patungan ke dompet Bersama biasa ditolak');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.void_entry(gen_random_uuid(), %L, %s)$q$)$$,
    tests.n(), :'s1_exp', pg_temp.ver(:'s1_exp')), 'DK422', 'split_locked', 'batal pengeluaran patungan lewat jalur generik ditolak');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.void_entry(gen_random_uuid(), %L, %s)$q$)$$,
    tests.f(), :'s1_exp', pg_temp.ver(:'s1_exp')), 'DK422', 'split_locked', 'anggota lain juga tidak bisa membatalkannya');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.void_entry(gen_random_uuid(), %L, %s)$q$)$$,
    tests.n(), :'s1_out', pg_temp.ver(:'s1_out')), 'DK422', 'split_locked',
  'batal kaki Pribadi pembayar lewat jalur generik ditolak (pasangannya kaki dompet sistem)');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.void_entry(gen_random_uuid(), %L, %s)$q$)$$,
    tests.f(), :'s1_in', pg_temp.ver(:'s1_in')), 'DK404', 'entry_not_found',
  'kaki masuk tagihan Novanda: Farida = DK404 seperti transfer antar ruang lain [B5]');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.move_entry_to_space(gen_random_uuid(), %L, %s, %L, %L, null)$q$)$$,
    tests.n(), :'s1_exp', pg_temp.ver(:'s1_exp'), :'np', :'bca'), 'DK422', 'split_locked',
  'pindah ruang pengeluaran patungan ditolak');
select throws_ok(format($$select tests.api_exec(%L, $q$update app.accounts set name = 'Ganti' where id = %L$q$)$$,
    tests.n(), :'pat'), 'DK404', 'account_not_found', 'dompet sistem tidak bisa diubah di luar fungsi patungan');

-- Sesudah Hapus tagihan: Sampah tidak memuatnya, pulihkan/purge generik ditolak.
select pg_temp.call(tests.n(), format($$select api.void_split(gen_random_uuid(), %L)$$, :'s1_id'));
select is(tests.web_val(tests.n(), format($$select count(*) from api.trash_list(%L) where entry_id in (%L, %L)$$,
    :'sh', :'s1_in', :'s1_exp')) || '/' || tests.web_val(tests.n(), format($$select count(*) from api.trash_list(%L)
    where entry_id = %L$$, :'np', :'s1_out')), '0/0', 'Sampah Bersama dan Pribadi tidak memuat entri patungan');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.restore_entry(gen_random_uuid(), %L, %s)$q$)$$,
    tests.n(), :'s1_exp', pg_temp.ver(:'s1_exp')), 'DK422', 'split_locked', 'pulihkan generik entri patungan ditolak');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.restore_entry(gen_random_uuid(), %L, %s)$q$)$$,
    tests.n(), :'s1_out', pg_temp.ver(:'s1_out')), 'DK422', 'split_locked', 'pulihkan generik kaki Pribadi ditolak');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.purge_entry(%L, %s)$q$)$$,
    tests.n(), :'s1_exp', pg_temp.ver(:'s1_exp')), 'DK422', 'split_locked', 'hapus permanen generik entri patungan ditolak');

-- ===== Keluar dari Bersama selama patungan belum impas (keputusan pemilik butir 5) =====
-- Sisa: tagihan Farida 10.000 (bagian Novanda 5.000): Novanda berutang 5.000.
select throws_ok(format($$select tests.owner_exec(null, $q$delete from app.space_members where space_id = %L and user_id = %L$q$)$$,
    :'sh', tests.f()), 'DK422', 'split_unsettled', 'pemberi piutang tidak bisa keluar selama belum impas');
select throws_ok(format($$select tests.owner_exec(null, $q$delete from app.space_members where space_id = %L and user_id = %L$q$)$$,
    :'sh', tests.n()), 'DK422', 'split_unsettled', 'pengutang tidak bisa keluar selama belum impas');
select pg_temp.call(tests.n(), format($$select api.settle_split(gen_random_uuid(), %L, %L, 5000)$$, :'sh', :'bca'));
select throws_ok(format($$select tests.owner_exec(null, $q$delete from app.space_members where space_id = %L and user_id = %L$q$)$$,
    :'sh', tests.f()), 'DK422', 'split_unsettled', 'impas, tetapi pelunasan untuk Farida belum diterima: tetap ditolak');
savepoint keluar;
select is(tests.owner_exec(null, format($$delete from app.space_members where space_id = %L and user_id = %L$$,
  :'sh', tests.n())), 1::bigint, 'impas dan tidak ada pelunasan menunggu untuknya: anggota boleh keluar');
rollback to savepoint keluar;

select * from finish();
rollback;
