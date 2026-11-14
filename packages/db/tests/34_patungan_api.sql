-- Patungan S12 sisi API (0136; plan S12 Task 6, K3, K4; bingkai S12-ADR1, PT1 sampai PT4, CT1, CT2,
-- AK1, AK2): api.create_split (sama rata, sisa ganjil ke pembayar, bagian nominal, idempoten, batas
-- dompet/ruang/bagian), api.void_split/restore_split (hanya pembayar, membalik tepat sekali, jendela 90
-- hari, split_member_left bila pemilik bagian sudah keluar), api.settle_split (payment_exceeds, hanya
-- dompet sendiri), api.receive_settlement/void_receipt (hanya penerima, ke Pribadinya sendiri),
-- api.void_settlement (hanya pelunas, settlement_received), api.shared_balances, api.split_history.
-- Setiap langkah: saldo antar-anggota nol-jumlah, dompet Bersama tidak bergerak, dompet sistem = Σ
-- pelunasan belum diterima, Laporan Bersama memuat tagihan tepat sekali, Kontribusi S8 dan
-- dq_reconcile tidak berubah, ruang Pribadi pasangan tidak terbaca atau tertulis, galat tanpa
-- nama/nominal. Kegagalan di tengah create_split = rollback utuh. Jam dipatok 2026-03-20 WIB.
-- ID: B1, B2, B10, B21, T19
begin;
select plan(94);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 10000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Celengan', 'tabungan', 300000, '2026-01-01') as tab,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 500000, '2026-01-01') as kan,
       tests.account(tests.n(), :'np', 'Saham', 'trading', 500000, '2026-01-01') as tr,
       tests.account(tests.n(), :'np', 'Baru', 'operasional', 500000, '2026-03-15') as baru,
       tests.account(tests.n(), :'np', 'Lama', 'operasional', 0, '2026-01-01') as lama,
       tests.account(tests.f(), :'fp', 'Mandiri', 'operasional', 1000000, '2026-01-01') as mdr,
       tests.account(tests.f(), :'fp', 'Jago', 'tabungan', 1000000, '2026-01-01') as jago,
       tests.account(tests.n(), :'sh', 'Kas Bersama', 'operasional', 500000, '2026-01-01') as kas \gset
select tests.web_val(tests.n(), format($$select api.archive_account(%L)$$, :'lama'));
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja'$q$, :'np'))
  as belanja_np \gset

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
create function pg_temp.split_sql(p_acc uuid, p_amount bigint, p_shares text default null,
  p_on date default '2026-03-10', p_client uuid default null, p_allow boolean default false) returns text
language sql as $$
  select format($q$select api.create_split(%L, %L, %L, %s,
    (select id from app.categories where space_id = %L and name = 'Listrik & Air'), %L::date, 'Listrik Maret',
    %L::jsonb, %L)$q$,
    coalesce(p_client, gen_random_uuid()), tests.space_id(tests.n(), 'shared'), p_acc, p_amount,
    tests.space_id(tests.n(), 'shared'), p_on, p_shares, p_allow)
$$;
create function pg_temp.split(p_uid uuid, p_acc uuid, p_amount bigint, p_shares text default null) returns jsonb
language sql as $$ select pg_temp.call(p_uid, pg_temp.split_sql(p_acc, p_amount, p_shares)) $$;
create function pg_temp.settle(p_uid uuid, p_acc uuid, p_amount bigint) returns jsonb
language sql as $$
  select pg_temp.call(p_uid, format($q$select api.settle_split(gen_random_uuid(), %L, %L, %s)$q$,
    tests.space_id(tests.n(), 'shared'), p_acc, p_amount))
$$;
create function pg_temp.op(p_uid uuid, p_fn text, p_id uuid, p_extra text default '') returns jsonb
language sql as $$
  select pg_temp.call(p_uid, format($q$select api.%s(gen_random_uuid(), %L%s)$q$, p_fn, p_id, p_extra))
$$;
-- Saldo antar-anggota (dari shared_balances) | dompet sistem | BCA | Mandiri | Kas Bersama.
create function pg_temp.st() returns text
language sql as $$
  select (select string_agg(case m ->> 'user_id' when tests.n()::text then 'N' else 'F' end || '=' || (m ->> 'balance'),
                            ',' order by m ->> 'user_id')
            from jsonb_array_elements(pg_temp.call(tests.n(), format('select api.shared_balances(%L)',
                   tests.space_id(tests.n(), 'shared'))) -> 'members') m)
         || '|pat=' || tests.balance(tests.owner_val(null, $q$select id from app.accounts where pocket = 'patungan'$q$)::uuid)
         || '|bca=' || tests.balance(tests.owner_val(null, $q$select id from app.accounts where name = 'BCA'$q$)::uuid)
         || '|mdr=' || tests.balance(tests.owner_val(null, $q$select id from app.accounts where name = 'Mandiri'$q$)::uuid)
         || '|kas=' || tests.balance(tests.owner_val(null, $q$select id from app.accounts where name = 'Kas Bersama'$q$)::uuid)
$$;
-- Laporan Bersama Maret: pengeluaran (outflow/jumlah entri), x_patungan masuk/keluar, Kontribusi S8.
create function pg_temp.lap() returns text
language sql as $$
  select tests.web_val(tests.f(), format($q$select
      (select coalesce(max(outflow || '/' || entry_count) filter (where report_class = 'expense'), '0/0')
         || ' patungan=' || coalesce(max(inflow || '/' || outflow) filter (where report_class = 'x_patungan'), '0/0')
         from api.period_summary(%1$L, '2026-03-01', '2026-03-31'))
      || ' kategori=' || coalesce((select amount::text from api.category_summary(%1$L, '2026-03-01', '2026-03-31')
                                    where name = 'Listrik & Air'), '0')
      || ' kontribusi=' || (select string_agg(setoran || ':' || diambil, ',' order by user_id)
                              from api.member_contributions(%1$L, '2026-03-01', '2026-03-31'))$q$,
    tests.space_id(tests.n(), 'shared')))
$$;
-- Laporan Pribadi pengguna: Σ pemasukan/pengeluaran dan kelas Setor/Ambil Bersama.
create function pg_temp.pribadi(p_uid uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select
      coalesce(sum(inflow) filter (where report_class = 'income'), 0) || '/'
      || coalesce(sum(outflow) filter (where report_class = 'expense'), 0) || ' setor='
      || coalesce(sum(outflow) filter (where report_class = 'x_setor_bersama'), 0) || ' ambil='
      || coalesce(sum(inflow) filter (where report_class = 'x_ambil_bersama'), 0)
    from api.period_summary(%L, '2026-03-01', '2026-03-31')$q$, tests.space_id(p_uid, 'personal')))
$$;
create function pg_temp.dq() returns text
language sql as $$
  select coalesce(tests.worker_val(null, $q$select string_agg(check_id || '=' || violations, ',' order by check_id)
    from jobs.dq_reconcile() where violations > 0$q$), 'bersih')
$$;
-- Jumlah entri dan versi total di ruang Pribadi Farida (dibaca owner).
create function pg_temp.fp_rows() returns text
language sql as $$
  select tests.owner_val(null, format($q$select count(*) || '/' || coalesce(sum(version), 0) from app.entries
    where space_id = %L$q$, tests.space_id(tests.f(), 'personal')))
$$;

select pg_temp.lap() as lap0, pg_temp.pribadi(tests.n()) as pn0, pg_temp.pribadi(tests.f()) as pf0,
       pg_temp.fp_rows() as fp0 \gset

-- ===== Batas: ruang, anggota, dompet, nominal, bagian (nol efek) =====
select throws_ok(format($$select pg_temp.call(%L, $q$select api.create_split(gen_random_uuid(), %L, %L, 1000)$q$)$$,
    tests.n(), :'np', :'bca'), 'DK422', 'split_shared_only', 'patungan di ruang Pribadi ditolak [B10]');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.create_split(gen_random_uuid(), %L, %L, 1000)$q$)$$,
    tests.f(), :'np', :'mdr'), 'DK404', 'space_not_found', 'ruang Pribadi Novanda untuk Farida = DK404 [B1]');
select throws_ok(format($$select pg_temp.call(null, pg_temp.split_sql(%L, 1000))$$, :'bca'),
  'DK401', 'unauthenticated', 'tanpa konteks = DK401');
savepoint solo;
select tests.owner_exec(null, format($$delete from app.space_members where space_id = %L and user_id = %L$$, :'sh', tests.f()));
select throws_ok(format($$select pg_temp.split(%L, %L, 1000)$$, tests.n(), :'bca'),
  'DK422', 'split_needs_partner', 'Bersama satu anggota: patungan ditolak');
rollback to savepoint solo;
select throws_ok(format($$select pg_temp.split(%L, %L, 1000)$$, tests.n(), :'kan'),
  'DK422', 'split_account_invalid', 'dompet Kantor tidak bisa membayar patungan');
select throws_ok(format($$select pg_temp.split(%L, %L, 1000)$$, tests.n(), :'tr'),
  'DK422', 'split_account_invalid', 'dompet Trading tidak bisa membayar patungan');
select throws_ok(format($$select pg_temp.split(%L, %L, 1000)$$, tests.n(), :'kas'),
  'DK422', 'split_account_invalid', 'dompet Bersama bukan dompet pribadi (catat biasa untuk itu)');
select throws_ok(format($$select pg_temp.split(%L, %L, 1000)$$, tests.n(), :'mdr'),
  'DK404', 'account_not_found', 'dompet Pribadi Farida tidak terlihat oleh Novanda: DK404 tanpa nama/nominal [B2, B21]');
select throws_ok(format($$select pg_temp.split(%L, %L, 1000)$$, tests.n(), :'lama'),
  'DK422', 'account_archived', 'dompet terarsip ditolak');
select throws_ok(format($$select pg_temp.split(%L, %L, 1000)$$, tests.n(), :'baru'),
  'DK422', 'before_opening', 'tanggal sebelum dompet dibuka ditolak');
select throws_ok(format($$select pg_temp.split(%L, %L, 0)$$, tests.n(), :'bca'),
  'DK400', 'invalid_argument', 'nominal 0 ditolak');
select throws_ok(format($$select pg_temp.call(%L, pg_temp.split_sql(%L, 1000, null, '2026-03-21'))$$, tests.n(), :'bca'),
  'DK400', 'invalid_argument', 'tanggal masa depan ditolak');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.create_split(gen_random_uuid(), %L, %L, 1000, %L)$q$)$$,
    tests.n(), :'sh', :'bca', :'belanja_np'), 'DK404', 'category_not_found', 'kategori ruang Pribadi ditolak [B9]');
select throws_ok(format($$select pg_temp.split(%L, %L, 1000, %L)$$, tests.n(), :'bca',
    format('[{"user_id": "%s", "amount": 999}]', tests.f())),
  'DK400', 'invalid_argument', 'Σ bagian ≠ nominal ditolak');
select throws_ok(format($$select pg_temp.split(%L, %L, 1000, %L)$$, tests.n(), :'bca',
    format('[{"user_id": "%s", "amount": 1000}]', tests.x())),
  'DK400', 'invalid_argument', 'bagian untuk bukan anggota ditolak');
select throws_ok(format($$select pg_temp.split(%L, %L, 1000, %L)$$, tests.n(), :'bca',
    format('[{"user_id": "%s", "amount": 500}, {"user_id": "%s", "amount": 500}]', tests.f(), tests.f())),
  'DK400', 'invalid_argument', 'anggota dua kali di bagian ditolak');
select throws_ok(format($$select pg_temp.split(%L, %L, 1000, %L)$$, tests.n(), :'bca',
    format('[{"user_id": "%s", "amount": -1}, {"user_id": "%s", "amount": 1001}]', tests.f(), tests.n())),
  'DK400', 'invalid_argument', 'bagian negatif ditolak');
select throws_ok(format($$select pg_temp.split(%L, %L, 1000, %L)$$, tests.n(), :'bca',
    format('[{"user_id": "%s", "amount": 500.5}, {"user_id": "%s", "amount": 499.5}]', tests.f(), tests.n())),
  'DK400', 'invalid_argument', 'bagian pecahan ditolak');
select throws_ok(format($$select pg_temp.split(%L, %L, 1000, '[{"user_id": "bukan-uuid", "amount": 1000}]')$$,
    tests.n(), :'bca'), 'DK400', 'invalid_argument', 'user_id rusak = invalid_argument, bukan galat tipe');
select throws_ok(format($$select pg_temp.split(%L, %L, 1000, '{"a": 1}')$$, tests.n(), :'bca'),
  'DK400', 'invalid_argument', 'bagian bukan larik ditolak');
select throws_ok(format($$select pg_temp.split(%L, %L, 400000)$$, tests.n(), :'tab'),
  'DK422', 'saldo_negatif', 'saldo dompet pembayar kurang = saldo_negatif');
select is(tests.owner_val(null, $$select (select count(*) from app.splits) || '/' || (select count(*) from app.accounts
  where pocket = 'patungan') || '/' || (select count(*) from app.idempotency_keys where op = 'create_split')$$),
  '0/0/0', 'semua penolakan nol efek (tanpa tagihan, dompet sistem, atau kunci idempotensi)');

-- ===== Tagihan sama rata (CT1) =====
select pg_temp.call(tests.n(), pg_temp.split_sql(:'bca', 400000, null, '2026-03-10',
  'aaaaaaaa-0000-0000-0000-000000000001')) as s1 \gset
select :'s1'::jsonb ->> 'split_id' as s1_id, :'s1'::jsonb ->> 'out_entry_id' as s1_out \gset
select is(:'s1'::jsonb -> 'shares', format('[{"amount": 200000, "user_id": "%s"}, {"amount": 200000, "user_id": "%s"}]',
  tests.n(), tests.f())::jsonb, 'sama rata: masing-masing 200.000 (balasan memuat bagian untuk toast)');
select is(pg_temp.st(), 'N=200000,F=-200000|pat=0|bca=9600000|mdr=1000000|kas=500000',
  'Farida berutang 200.000; BCA turun tepat sekali; dompet sistem 0; Kas Bersama tidak bergerak [T19]');
select is(:'lap0' || ' -> ' || pg_temp.lap(),
  '0/0 patungan=0/0 kategori=0 kontribusi=0:0,0:0 -> 400000/1 patungan=400000/0 kategori=400000 kontribusi=0:0,0:0',
  'Laporan Bersama memuat tagihan sekali (pengeluaran, kategori); kaki masuk x_patungan; Kontribusi S8 tetap nol');
select is(:'pn0' || ' -> ' || pg_temp.pribadi(tests.n()), '0/0 setor=0 ambil=0 -> 0/0 setor=400000 ambil=0',
  'Pribadi Novanda: bukan pengeluaran pribadi, tercatat Setor ke Bersama');
select is(pg_temp.pribadi(tests.f()) || ' ' || pg_temp.fp_rows(), :'pf0' || ' ' || :'fp0',
  'ruang Pribadi Farida tidak terbaca atau tertulis (entri, versi, Laporan sama) [B21]');
select is(pg_temp.dq(), 'bersih', 'dq_reconcile nol temuan sesudah tagihan patungan');
select is(pg_temp.call(tests.n(), pg_temp.split_sql(:'bca', 400000, null, '2026-03-10',
    'aaaaaaaa-0000-0000-0000-000000000001')) ->> 'split_id' || '/'
  || tests.owner_val(null, $$select count(*) from app.splits$$), :'s1_id' || '/1', 'klik ganda = replay, satu tagihan');
select throws_ok(format($$select pg_temp.call(%L, pg_temp.split_sql(%L, 1, null, '2026-03-10',
    'aaaaaaaa-0000-0000-0000-000000000001'))$$, tests.n(), :'bca'),
  'DK410', 'idempotency_key_reused', 'client_id sama isi beda = DK410');

-- ===== Sisa ganjil ke pembayar, bagian nominal (CT2) =====
select pg_temp.split(tests.f(), :'mdr', 100001) as s2 \gset
select :'s2'::jsonb ->> 'split_id' as s2_id \gset
select is(:'s2'::jsonb -> 'shares',
  format('[{"amount": 50000, "user_id": "%s"}, {"amount": 50001, "user_id": "%s"}]', tests.n(), tests.f())::jsonb,
  'nominal ganjil: sisa Rp1 ditanggung pembayar (Farida)');
select pg_temp.split(tests.n(), :'bca', 100000, format('[{"user_id": "%s", "amount": 100000}]', tests.f())) as s3 \gset
select :'s3'::jsonb ->> 'split_id' as s3_id \gset
select is(:'s3'::jsonb -> 'shares', format('[{"amount": 0, "user_id": "%s"}, {"amount": 100000, "user_id": "%s"}]',
  tests.n(), tests.f())::jsonb, 'bagian nominal: Farida menanggung semua, anggota yang tidak disebut = 0');
select is(pg_temp.st(), 'N=250000,F=-250000|pat=0|bca=9500000|mdr=899999|kas=500000',
  'saldo dari data: 200.000 − 50.000 + 100.000; nol-jumlah [T19]');
select is(tests.web_val(tests.f(), format($$select api.shared_balances(%L) - 'members' - 'pending'$$, :'sh'))::jsonb,
  format('{"amount": 250000, "debtor_id": "%s", "creditor_id": "%s", "split_count": 3, "settlement_count": 0}',
    tests.f(), tests.n())::jsonb, 'shared_balances (sudut Farida): Farida berutang 250.000 ke Novanda');

-- ===== Hanya pembayar yang menghapus/memulihkan (§9.1) =====
select throws_ok(format($$select pg_temp.op(%L, 'void_split', %L)$$, tests.f(), :'s1_id'),
  'DK404', 'split_not_found', 'Farida tidak bisa menghapus tagihan Novanda');
select throws_ok(format($$select pg_temp.op(%L, 'restore_split', %L)$$, tests.f(), :'s1_id'),
  'DK404', 'split_not_found', 'Farida tidak bisa memulihkan tagihan Novanda');
select throws_ok(format($$select pg_temp.op(%L, 'void_split', %L)$$, tests.n(), :'s2_id'),
  'DK404', 'split_not_found', 'Novanda tidak bisa menghapus tagihan Farida');

-- ===== Pelunasan (K4, PT3) =====
select throws_ok(format($$select pg_temp.settle(%L, %L, 250001)$$, tests.f(), :'mdr'),
  'DK422', 'payment_exceeds', 'lunasi melebihi utang ditolak');
select throws_ok(format($$select pg_temp.settle(%L, %L, 1)$$, tests.n(), :'bca'),
  'DK422', 'payment_exceeds', 'pemberi piutang tidak bisa melunasi (utangnya 0)');
select throws_ok(format($$select pg_temp.settle(%L, %L, 1000)$$, tests.f(), :'bca'),
  'DK404', 'account_not_found', 'Farida tidak bisa melunasi dari dompet Novanda [B2]');
select throws_ok(format($$select pg_temp.call(%L, $q$select api.settle_split(gen_random_uuid(), %L, %L, 1000, null, %L)$q$)$$,
    tests.f(), :'sh', :'mdr', tests.f()), 'DK400', 'invalid_argument', 'melunasi ke diri sendiri ditolak');
select is(pg_temp.st(), 'N=250000,F=-250000|pat=0|bca=9500000|mdr=899999|kas=500000', 'penolakan pelunasan nol efek');
select pg_temp.settle(tests.f(), :'mdr', 100000) as t1 \gset
select :'t1'::jsonb ->> 'settlement_id' as t1_id \gset
select is((:'t1'::jsonb ->> 'remaining') || '/' || (:'t1'::jsonb ->> 'to_user'), '150000/' || tests.n(),
  'pelunasan 100.000: sisa utang 150.000 (dari SQL), penerima = satu-satunya anggota lain');
select is(pg_temp.st(), 'N=150000,F=-150000|pat=100000|bca=9500000|mdr=799999|kas=500000',
  'saldo patungan berkurang sejak dicatat; uang menunggu di dompet sistem [T19]');
select is(tests.web_val(tests.n(), format($$select jsonb_array_length(api.shared_balances(%L) -> 'pending')
    || '/' || (api.shared_balances(%L) -> 'pending' -> 0 ->> 'amount')$$, :'sh', :'sh')), '1/100000',
  'pelunasan menunggu diterima tampil di shared_balances');
select is(pg_temp.dq(), 'bersih', 'dq_reconcile nol temuan dengan pelunasan menunggu');

-- ===== Terima ke dompet (PT4) =====
select throws_ok(format($$select pg_temp.op(%L, 'receive_settlement', %L, format(', %%L', %L::uuid))$$,
    tests.f(), :'t1_id', :'mdr'), 'DK404', 'settlement_not_found', 'pelunas tidak bisa menerima pelunasannya sendiri');
select throws_ok(format($$select pg_temp.op(%L, 'receive_settlement', %L, format(', %%L', %L::uuid))$$,
    tests.n(), :'t1_id', :'mdr'), 'DK404', 'account_not_found', 'penerima tidak bisa memasukkan ke dompet Farida [B21]');
select throws_ok(format($$select pg_temp.op(%L, 'receive_settlement', %L, format(', %%L', %L::uuid))$$,
    tests.n(), :'t1_id', :'kan'), 'DK422', 'split_account_invalid', 'terima ke Kantor ditolak');
select throws_ok(format($$select pg_temp.op(%L, 'receive_settlement', %L, format(', %%L, %%L', %L::uuid, '2026-03-19'))$$,
    tests.n(), :'t1_id', :'bca'), 'DK400', 'invalid_argument', 'terima sebelum tanggal pelunasan ditolak');
select is(pg_temp.op(tests.n(), 'receive_settlement', :'t1_id', format(', %L', :'bca')) ->> 'amount', '100000',
  'Novanda menerima ke BCA');
select is(pg_temp.st(), 'N=150000,F=-150000|pat=0|bca=9600000|mdr=799999|kas=500000',
  'terima: BCA naik, dompet sistem kembali 0, saldo patungan tidak berubah [T19]');
select is(pg_temp.pribadi(tests.n()), '0/0 setor=500000 ambil=100000', 'terima bukan pemasukan: Pribadi Novanda mencatatnya Ambil dari Bersama');
select throws_ok(format($$select pg_temp.op(%L, 'receive_settlement', %L, format(', %%L', %L::uuid))$$,
    tests.n(), :'t1_id', :'bca'), 'DK422', 'settlement_received', 'terima dua kali ditolak');
select throws_ok(format($$select pg_temp.op(%L, 'void_settlement', %L)$$, tests.f(), :'t1_id'),
  'DK422', 'settlement_received', 'pelunasan yang sudah diterima tidak bisa dibatalkan pelunas (AK2)');
select throws_ok(format($$select pg_temp.op(%L, 'void_receipt', %L)$$, tests.f(), :'t1_id'),
  'DK404', 'settlement_not_found', 'pelunas tidak bisa membatalkan penerimaan');
select throws_ok(format($$select pg_temp.op(%L, 'void_settlement', %L)$$, tests.n(), :'t1_id'),
  'DK404', 'settlement_not_found', 'penerima tidak bisa membatalkan pelunasan');
select is(pg_temp.dq(), 'bersih', 'dq_reconcile nol temuan sesudah terima');

-- ===== Batal terima lalu batal pelunasan: membalik tepat sekali =====
select pg_temp.op(tests.n(), 'void_receipt', :'t1_id');
select is(pg_temp.st(), 'N=150000,F=-150000|pat=100000|bca=9500000|mdr=799999|kas=500000',
  'batal terima: uang kembali menunggu di dompet sistem, saldo patungan tetap');
select throws_ok(format($$select pg_temp.op(%L, 'void_receipt', %L)$$, tests.n(), :'t1_id'),
  'DK422', 'settlement_not_received', 'batal terima dua kali ditolak');
select pg_temp.op(tests.f(), 'void_settlement', :'t1_id');
select is(pg_temp.st(), 'N=250000,F=-250000|pat=0|bca=9500000|mdr=899999|kas=500000',
  'batal pelunasan: Mandiri dan utang kembali tepat sekali [T19]');
select throws_ok(format($$select pg_temp.op(%L, 'void_settlement', %L)$$, tests.f(), :'t1_id'),
  'DK422', 'already_voided', 'batal pelunasan dua kali ditolak');
select throws_ok(format($$select pg_temp.op(%L, 'receive_settlement', %L, format(', %%L', %L::uuid))$$,
    tests.n(), :'t1_id', :'bca'), 'DK422', 'settlement_voided', 'pelunasan batal tidak bisa diterima');
select is(pg_temp.dq(), 'bersih', 'dq_reconcile nol temuan sesudah batal terima dan batal pelunasan');

-- ===== Hapus/pulihkan tagihan (AK1): membalik tepat sekali =====
select is(pg_temp.op(tests.n(), 'void_split', :'s1_id') -> 'effects',
  format('[{"amount": 400000, "account_id": "%s", "account_name": "BCA"}]', :'bca')::jsonb,
  'hapus tagihan: efek hanya BCA +400.000 (dompet sistem bersih nol)');
select is(pg_temp.st(), 'N=50000,F=-50000|pat=0|bca=9900000|mdr=899999|kas=500000', 'saldo patungan dan BCA kembali [T19]');
select is(pg_temp.lap(), '200001/2 patungan=200001/0 kategori=200001 kontribusi=0:0,0:0',
  'Laporan Bersama tanpa tagihan yang dihapus; Kontribusi tetap');
select throws_ok(format($$select pg_temp.op(%L, 'void_split', %L)$$, tests.n(), :'s1_id'),
  'DK422', 'already_voided', 'hapus dua kali ditolak');
select is(pg_temp.op(tests.n(), 'restore_split', :'s1_id') -> 'effects',
  format('[{"amount": -400000, "account_id": "%s", "account_name": "BCA"}]', :'bca')::jsonb, 'pulihkan tagihan');
select is(pg_temp.st(), 'N=250000,F=-250000|pat=0|bca=9500000|mdr=899999|kas=500000',
  'pulihkan: saldo patungan dan BCA tepat seperti sebelum dihapus [T19]');
select is(pg_temp.lap(), '600001/3 patungan=600001/0 kategori=600001 kontribusi=0:0,0:0',
  'Laporan Bersama memuat tagihan lagi tepat sekali');
select throws_ok(format($$select pg_temp.op(%L, 'restore_split', %L)$$, tests.n(), :'s1_id'),
  'DK422', 'not_voided', 'pulihkan tagihan hidup ditolak');
select is(pg_temp.dq(), 'bersih', 'dq_reconcile nol temuan sesudah hapus dan pulihkan');

-- ===== Saldo boleh berbalik arah (tanpa logika pelunasan tersembunyi) =====
select pg_temp.settle(tests.f(), :'mdr', 250000) ->> 'remaining' as rem \gset
select is(:'rem' || ' ' || (tests.web_val(tests.n(), format($$select api.shared_balances(%L) ->> 'amount'$$, :'sh')) is null)::text,
  '0 true', 'lunas semua: Patungan impas (amount null, tanpa Rp 0)');
select pg_temp.op(tests.n(), 'void_split', :'s1_id');
select is(tests.web_val(tests.n(), format($$select (api.shared_balances(%L) - 'members' - 'pending')::text$$, :'sh'))::jsonb,
  format('{"amount": 200000, "debtor_id": "%s", "creditor_id": "%s", "split_count": 2, "settlement_count": 1}',
    tests.n(), tests.f())::jsonb, 'tagihan dihapus sesudah dilunasi: Novanda kini berutang 200.000 ke Farida');
select is(pg_temp.settle(tests.n(), :'bca', 200000) ->> 'remaining', '0', 'Novanda bisa melunasi ke Farida');
select is(pg_temp.st(), 'N=0,F=0|pat=450000|bca=9700000|mdr=649999|kas=500000',
  'impas; dua pelunasan menunggu diterima (dompet sistem = Σ belum diterima) [T19]');
select is(pg_temp.dq(), 'bersih', 'dq_reconcile nol temuan');

-- ===== Anggota keluar sesudah impas (S1): saldonya tidak boleh berubah lagi =====
-- Farida menerima pelunasan untuknya lalu keluar (penjaga keluar lolos); hapus tagihan yang memuat
-- bagian Farida atau pulihkan tagihan batal ditolak tanpa efek (saldo macet: pelunasan butuh anggota).
savepoint keluar;
select pg_temp.op(tests.f(), 'receive_settlement', tests.owner_val(null, format($q$select id from app.settlements
  where space_id = %L and to_user = %L and voided_at is null and received_entry_id is null$q$, :'sh', tests.f()))::uuid,
  format(', %L', :'mdr'));
select tests.owner_exec(null, format($$delete from app.space_members where space_id = %L and user_id = %L$$, :'sh', tests.f()));
select pg_temp.st() || ' ' || tests.owner_val(null, $$select count(*) filter (where voided_at is null) || '/' || count(*)
  from app.entries$$) as before_left \gset
select throws_ok(format($$select pg_temp.op(%L, 'void_split', %L)$$, tests.n(), :'s3_id'),
  'DK422', 'split_member_left', 'hapus tagihan dengan bagian anggota yang sudah keluar ditolak [S1]');
select throws_ok(format($$select pg_temp.op(%L, 'restore_split', %L)$$, tests.n(), :'s1_id'),
  'DK422', 'split_member_left', 'pulihkan tagihan dengan bagian anggota yang sudah keluar ditolak [S1]');
select is(pg_temp.st() || ' ' || tests.owner_val(null, $$select count(*) filter (where voided_at is null) || '/' || count(*)
  from app.entries$$), :'before_left', 'penolakan tanpa efek: saldo dan entri tidak berubah [S1]');
rollback to savepoint keluar;

-- ===== Riwayat (PT2) =====
-- Jam dipatok: created_at sama, jadi urutan dalam satu tanggal ditentukan id; bandingkan sebagai himpunan.
select is(tests.web_val(tests.n(), format($$select string_agg(item || ':' || occurred_on || ':' || amount || ':'
    || (voided_at is not null), ',' order by item, amount) from api.split_history(%L)$$, :'sh')),
  'settlement:2026-03-20:200000:false,settlement:2026-03-20:250000:false,split:2026-03-10:100000:false,split:2026-03-10:100001:false,split:2026-03-10:400000:true',
  'riwayat Novanda: pelunasan dan tagihan hidup + tagihan yang ia hapus (bukan pelunasan batal milik Farida)');
select is(tests.web_val(tests.f(), format($$select string_agg(item || ':' || amount, ',' order by item, amount)
    filter (where voided_at is not null) || '/' || count(*) from api.split_history(%L)$$, :'sh')), 'settlement:100000/5',
  'riwayat Farida: pelunasan batal miliknya tampil, tagihan yang dihapus Novanda tidak');
select is(tests.web_val(tests.n(), format($$select string_agg(item, ',' order by occurred_on desc, created_at desc, id desc)
    from api.split_history(%L, 2)$$, :'sh')), 'settlement,settlement', 'halaman pertama: terbaru (tanggal) di atas');
select is(tests.web_val(tests.n(), format($$with p as (select * from api.split_history(%1$L, 2))
    select string_agg(h.item, ',') from api.split_history(%1$L, 2,
      (select occurred_on from p order by occurred_on, created_at, id limit 1),
      (select created_at from p order by occurred_on, created_at, id limit 1),
      (select id from p order by occurred_on, created_at, id limit 1)) h$$, :'sh')),
  'split,split', 'kursor: halaman kedua melanjutkan tanpa tumpang tindih');
select is((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname = 'split_history'),
  'TABLE(item text, id uuid, occurred_on date, created_at timestamp with time zone, actor_id uuid, counterparty_id uuid, amount bigint, description text, category_id uuid, expense_entry_id uuid, shares jsonb, received boolean, voided_at timestamp with time zone, purge_after timestamp with time zone)',
  'kolom riwayat tanpa id/nama dompet Pribadi (kontrak Task 7) [B21]');
select throws_ok(format($$select tests.web_val(%L, $q$select api.shared_balances(%L)$q$)$$, tests.n(), :'np'),
  'DK422', 'split_shared_only', 'shared_balances di Pribadi ditolak');
select throws_ok(format($$select tests.web_val(%L, $q$select count(*) from api.split_history(%L)$q$)$$, tests.x(), :'sh'),
  'DK404', 'space_not_found', 'riwayat untuk orang luar ditolak');

-- ===== Pulihkan: saldo kurang dan jendela 90 hari =====
savepoint jendela;
select tests.web_val(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 9700000)$$, :'np', :'bca'));
select throws_ok(format($$select pg_temp.op(%L, 'restore_split', %L)$$, tests.n(), :'s1_id'),
  'DK422', 'saldo_negatif', 'pulihkan saat saldo pembayar kurang = saldo_negatif');
select tests.clock_at('2026-06-19 10:00+07');
select throws_ok(format($$select pg_temp.op(%L, 'restore_split', %L, ', true')$$, tests.n(), :'s1_id'),
  'DK422', 'restore_window_closed', 'pulihkan sesudah 90 hari ditolak');
rollback to savepoint jendela;

-- ===== Purge 90 hari: baris patungan batal ikut hilang tanpa galat FK =====
savepoint purge;
select tests.clock_at('2026-06-19 10:00+07');
select is(tests.worker_val(null, 'select jobs.purge_voided()'), '7',
  'purge: tagihan dihapus (3 entri), pelunasan batal (2), pasangan terima yang dibatalkan (2)');
select is(tests.owner_val(null, $$select (select count(*) from app.splits) || '/' || (select count(*) from app.split_shares)
    || '/' || (select count(*) from app.settlements) || '/' || (select count(*) from app.entries e
    join app.entry_lines l on l.entry_id = e.id join app.accounts a on a.id = l.account_id
    where a.pocket = 'patungan' and e.voided_at is not null)$$) || ' ' || pg_temp.dq(), '2/4/2/0 bersih',
  'tagihan dan pelunasan hidup tetap; tanpa entri patungan batal tersisa; dq_reconcile nol temuan');
rollback to savepoint purge;

-- ===== Kegagalan di tengah create_split = rollback utuh (INT-12-analog) =====
select tests.owner_val(null, $$select count(*) || '/' || (select count(*) from app.splits) || '/'
  || (select count(*) from app.idempotency_keys) from app.entries$$) as before_fail \gset
select pg_temp.st() as st_before \gset
savepoint gagal;
select tests.owner_exec(null, $q$create function private.tes_fail_after() returns trigger
  language plpgsql set search_path = '' as $f$
  begin
    if pg_catalog.current_setting('tests.fail_after', true) = 'split_expense_line' and new.amount < 0
       and exists (select 1 from app.accounts a where a.id = new.account_id and a.pocket = 'patungan') then
      raise exception using errcode = 'P0001', message = 'fail_after';
    end if;
    return null;
  end $f$$q$);
select tests.owner_exec(null, 'create trigger tes_fail_after after insert on app.entry_lines
  for each row execute function private.tes_fail_after()');
select set_config('tests.fail_after', 'split_expense_line', true);
select throws_ok(format($$select pg_temp.call(%L, pg_temp.split_sql(%L, 1000, null, '2026-03-10',
    'aaaaaaaa-0000-0000-0000-000000000002'))$$, tests.n(), :'bca'), 'P0001', 'fail_after',
  'kegagalan disuntik sesudah kaki Pribadi dan kaki masuk ditulis');
select is(tests.owner_val(null, $$select count(*) || '/' || (select count(*) from app.splits) || '/'
    || (select count(*) from app.idempotency_keys) from app.entries$$) || ' ' || pg_temp.st(),
  :'before_fail' || ' ' || :'st_before', 'rollback utuh: entri, tagihan, kunci idempotensi, saldo tidak berubah');
rollback to savepoint gagal;
select set_config('tests.fail_after', '', true);

select * from finish();
rollback;
