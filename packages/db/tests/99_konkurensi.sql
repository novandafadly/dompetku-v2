-- Konkurensi dua koneksi lewat dblink (BSD §3, §13 catatan konkurensi; IPD S5 "tes konkurensi"):
-- dua pengeluaran paralel tidak bisa membuat saldo negatif, klik ganda paralel = 1 entri,
-- transfer A->B paralel B->A tanpa deadlock, arsip paralel catat melihat data ter-commit.
-- Koneksi a dan b = dompetku_web (READ COMMITTED); adm = superuser untuk fixture ter-commit.
-- Berjalan terakhir (99_) dan membersihkan semua data di awal dan akhir (tests.wipe).
begin;
select plan(11);

select tests.peer_open('adm', 'postgres');
select tests.peer_val('adm', 'select tests.wipe()');
select tests.peer_val('adm', 'select tests.fixture()');
select tests.peer_val('adm', $$select tests.space_id(tests.n(), 'personal')$$) as np \gset
select tests.peer_val('adm', format($$select tests.account(tests.n(), %L, 'A', 'operasional', 100)$$, :'np')) as acc_a \gset
select tests.peer_val('adm', format($$select tests.account(tests.n(), %L, 'B', 'operasional', 100)$$, :'np')) as acc_b \gset
select tests.peer_val('adm', format($$select tests.account(tests.n(), %L, 'C', 'operasional', 0)$$, :'np')) as acc_c \gset

select tests.peer_open('a', 'dompetku_web');
select tests.peer_open('b', 'dompetku_web');
select tests.peer_val(c, format($$select set_config('app.user_id', %L, false)$$, tests.n())) from unnest(array['a', 'b']) c;

-- ===== Dua pengeluaran 80 paralel pada saldo 100 =====
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 80)$$, :'np', :'acc_a'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 80)$$, :'np', :'acc_a'));
select ok(tests.peer_blocked('b'), 'pengeluaran kedua menunggu kunci dompet');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*saldo_negatif', 'pengeluaran kedua = saldo_negatif sesudah yang pertama commit');
select tests.peer_exec('b', 'rollback');
select is(tests.balance(:'acc_a'), 20::bigint, 'saldo akhir 20, tidak pernah negatif');

-- ===== Klik ganda paralel (client_id sama) =====
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.create_entry('cccccccc-0000-0000-0000-000000000001', %L, %L, 'income', 5)$$, :'np', :'acc_b'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.create_entry('cccccccc-0000-0000-0000-000000000001', %L, %L, 'income', 5) ->> 'replayed'$$, :'np', :'acc_b'));
select ok(tests.peer_blocked('b'), 'permintaan kembar menunggu kunci idempotensi');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), 'true', 'permintaan kembar = replay');
select tests.peer_exec('b', 'commit');
select is(tests.balance(:'acc_b'), 105::bigint, 'klik ganda paralel = 1 entri');

-- Kunci sama isi beda, paralel = DK410.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.create_entry('cccccccc-0000-0000-0000-000000000002', %L, %L, 'income', 1)$$, :'np', :'acc_b'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.create_entry('cccccccc-0000-0000-0000-000000000002', %L, %L, 'income', 2)$$, :'np', :'acc_b'));
select tests.peer_blocked('b');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*idempotency_key_reused', 'kunci sama isi beda paralel = DK410');
select tests.peer_exec('b', 'rollback');

-- ===== Transfer A->B paralel B->A: kunci urut id, tanpa deadlock =====
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 10)$$, :'np', :'acc_a', :'acc_b'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 10) ->> 'replayed'$$, :'np', :'acc_b', :'acc_a'));
select ok(tests.peer_blocked('b'), 'transfer berlawanan menunggu');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), 'false', 'transfer berlawanan selesai tanpa deadlock');
select tests.peer_exec('b', 'commit');
select is(tests.balance(:'acc_a') || ' ' || tests.balance(:'acc_b'), '20 106', 'saldo sesudah dua transfer');

-- ===== Arsip paralel catat: arsip melihat pemasukan yang baru commit =====
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.create_entry(gen_random_uuid(), %L, %L, 'income', 7)$$, :'np', :'acc_c'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.archive_account(%L)$$, :'acc_c'));
select tests.peer_blocked('b');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*balance_not_zero', 'arsip paralel catat = balance_not_zero');
select tests.peer_exec('b', 'rollback');

select tests.peer_close('a');
select tests.peer_close('b');
select tests.peer_val('adm', 'select tests.wipe()');
select tests.peer_close('adm');

select * from finish();
rollback;
