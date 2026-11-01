-- Konkurensi dua koneksi lewat dblink (BSD §3, §13 catatan konkurensi; IPD S5 "tes konkurensi"):
-- dua pengeluaran paralel tidak bisa membuat saldo negatif, klik ganda paralel = 1 entri,
-- transfer A->B paralel B->A tanpa deadlock, arsip paralel catat melihat data ter-commit.
-- Koneksi a dan b = dompetku_web (READ COMMITTED); adm = superuser untuk fixture ter-commit.
-- Berjalan terakhir (99_) dan membersihkan semua data di awal dan akhir (tests.wipe).
begin;
select plan(18);

select tests.peer_open('adm', 'postgres');
select tests.peer_val('adm', 'select tests.wipe()');
select tests.peer_val('adm', $$update app.settings set value = 'prod' where key = 'env' returning value$$);
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

-- ===== Void paralel update entri yang sama: yang kedua = DK409 =====
select (tests.peer_val('a', format($$select api.create_entry(gen_random_uuid(), %L, %L, 'income', 3)$$, :'np', :'acc_b'))::jsonb)
  ->> 'entry_id' as ent \gset
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.update_entry(gen_random_uuid(), %L, 1, %L, 4, null, null, null, false)$$, :'ent', :'acc_b'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'ent'));
select ok(tests.peer_blocked('b'), 'void menunggu kunci entri');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*version_conflict', 'void dengan versi sebelum update = DK409');
select tests.peer_exec('b', 'rollback');
select is(tests.owner_val(null, format($$select version || ' ' || (voided_at is null) from app.entries where id = %L$$, :'ent')),
  '2 true', 'entri tetap hidup dengan versi update');

-- ===== jobs.purge_voided paralel pulihkan: entri yang dipulihkan tidak ditombstone =====
-- Jam tiruan per koneksi (env test di-commit lewat adm, dikembalikan ke prod di akhir).
select tests.peer_val('adm', $$update app.settings set value = 'test' where key = 'env' returning value$$);
select (tests.peer_val('a', format($$select api.create_entry(gen_random_uuid(), %L, %L, 'income', 9)$$, :'np', :'acc_b'))::jsonb)
  ->> 'entry_id' as rv \gset
select tests.peer_val('a', $$select set_config('app.now_override', '2026-01-01 10:00+07', false)$$);
select tests.peer_val('a', format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'rv'));
select tests.peer_val('a', $$select set_config('app.now_override', '2026-03-31 10:00+07', false)$$);
select tests.peer_open('w', 'dompetku_worker');
select tests.peer_val('w', $$select set_config('app.now_override', '2026-04-02 10:00+07', false)$$);
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.restore_entry(gen_random_uuid(), %L, 2)$$, :'rv'));
select tests.peer_send('w', 'select jobs.purge_voided()');
select ok(tests.peer_blocked('w'), 'purge_voided menunggu kunci entri yang sedang dipulihkan');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('w'), '0', 'purge_voided melewati entri yang dipulihkan');
select is(tests.owner_val(null, format($$select (select count(*) from app.entries where id = %1$L and voided_at is null) || ' '
  || (select count(*) from app.entry_tombstones where entry_id = %1$L)$$, :'rv')), '1 0', 'entri hidup, tanpa tombstone');
select is(tests.peer_val('w', 'select jobs.purge_voided()::text'), '0', 'purge berikutnya tetap jalan');
select tests.peer_close('w');
select tests.peer_val('a', $$select set_config('app.now_override', '', false)$$);
select tests.peer_val('adm', $$update app.settings set value = 'prod' where key = 'env' returning value$$);

select tests.peer_close('a');
select tests.peer_close('b');
select tests.peer_val('adm', 'select tests.wipe()');
select tests.peer_close('adm');

select * from finish();
rollback;
