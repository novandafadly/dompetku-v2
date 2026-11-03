-- Konkurensi dua koneksi lewat dblink (BSD §3, §13 catatan konkurensi; IPD S5 "tes konkurensi"):
-- dua pengeluaran paralel tidak bisa membuat saldo negatif, klik ganda paralel = 1 entri,
-- transfer A->B paralel B->A tanpa deadlock, arsip paralel catat melihat data ter-commit,
-- re-parent kategori paralel (silang A/B, atau rantai C di bawah A saat A pindah ke bawah B)
-- ditolak category_depth, arsip induk paralel ubah anak tanpa deadlock (0109), reimburse paralel
-- dan ubah talangan paralel reimburse tanpa deadlock (0110), pindah ruang paralel ubah entri yang
-- sama dan paralel reimburse (0111).
-- Koneksi a dan b = dompetku_web (READ COMMITTED); adm = superuser untuk fixture ter-commit.
-- Berjalan terakhir (99_) dan membersihkan semua data di awal dan akhir (tests.wipe).
begin;
select plan(46);

select tests.peer_open('adm', 'postgres');
select tests.peer_val('adm', 'select tests.wipe()');
select tests.peer_val('adm', $$update app.settings set value = 'prod' where key = 'env' returning value$$);
select tests.peer_val('adm', 'select tests.fixture()');
select tests.peer_val('adm', $$select tests.space_id(tests.n(), 'personal')$$) as np \gset
select tests.peer_val('adm', format($$select tests.account(tests.n(), %L, 'A', 'operasional', 100)$$, :'np')) as acc_a \gset
select tests.peer_val('adm', format($$select tests.account(tests.n(), %L, 'B', 'operasional', 100)$$, :'np')) as acc_b \gset
select tests.peer_val('adm', format($$select tests.account(tests.n(), %L, 'C', 'operasional', 0)$$, :'np')) as acc_c \gset
select tests.peer_val('adm', $$select tests.space_id(tests.n(), 'shared')$$) as sh \gset
select tests.peer_val('adm', format($$select tests.account(tests.n(), %L, 'Kas', 'operasional', 100)$$, :'sh')) as acc_s \gset

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

-- ===== Re-parent kategori silang paralel: induk baru ikut dikunci, urut id =====
select (tests.peer_val('a', format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Konkuren A', 'Car')$$, :'np'))::jsonb)
  ->> 'category_id' as cat_a \gset
select (tests.peer_val('a', format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Konkuren B', 'Car')$$, :'np'))::jsonb)
  ->> 'category_id' as cat_b \gset
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.update_category(%L, 'Konkuren A', 'Car', %L)$$, :'cat_a', :'cat_b'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.update_category(%L, 'Konkuren B', 'Car', %L)$$, :'cat_b', :'cat_a'));
select ok(tests.peer_blocked('b'), 're-parent silang menunggu kunci induk baru');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*category_depth', 're-parent silang kedua = category_depth');
select tests.peer_exec('b', 'rollback');
select is(tests.owner_val(null, format($$select coalesce((select parent_id::text from app.categories where id = %1$L), '-') || ' '
  || coalesce((select parent_id::text from app.categories where id = %2$L), '-')$$, :'cat_a', :'cat_b')),
  :'cat_b' || ' -', 'A di bawah B, B tetap induk (tanpa siklus)');

-- Rantai: A sedang dipindah ke bawah D, C dipindah ke bawah A. Tanpa kunci induk baru, C membaca A
-- yang belum commit (masih akar) dan lolos trigger; hasilnya kedalaman 3.
select (tests.peer_val('a', format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Konkuren C', 'Car')$$, :'np'))::jsonb)
  ->> 'category_id' as cat_c \gset
select (tests.peer_val('a', format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Konkuren D', 'Car')$$, :'np'))::jsonb)
  ->> 'category_id' as cat_d \gset
select tests.peer_val('a', format($$select api.update_category(%L, 'Konkuren A', 'Car', null)$$, :'cat_a'));
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.update_category(%L, 'Konkuren A', 'Car', %L)$$, :'cat_a', :'cat_d'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.update_category(%L, 'Konkuren C', 'Car', %L)$$, :'cat_c', :'cat_a'));
select ok(tests.peer_blocked('b'), 're-parent ke induk yang sedang dipindah menunggu kunci');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*category_depth', 'rantai paralel = category_depth (tanpa kedalaman 3)');
select tests.peer_exec('b', 'rollback');
select is(tests.owner_val(null, format($$select count(*) from app.categories c join app.categories p on p.id = c.parent_id
  where p.parent_id is not null and c.space_id = %L$$, :'np')), '0', 'tidak ada kategori di kedalaman 3');

-- ===== Arsip induk paralel ubah anak (S7, 0109): kunci urut id, tanpa deadlock =====
-- C anak P dengan C.id < P.id. update_category(C, induk P) mengunci {C, P} urut id (C dulu);
-- archive_category(P) versi 0106 mengunci P lalu meng-update anaknya, jadi bisa saling tunggu
-- (40P01). Urutan dipaksa deterministik: adm memegang P, arsip (a) mengantre lebih dulu, lalu ubah
-- (b) mengambil C dan mengantre di P. Saat adm commit, arsip mendapat P duluan dan butuh C.
select (tests.peer_val('a', format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Arsip Konkuren 1', 'Car')$$, :'np'))::jsonb)
  ->> 'category_id' as cat_x \gset
select (tests.peer_val('a', format($$select api.create_category(gen_random_uuid(), %L, 'expense', 'Arsip Konkuren 2', 'Car')$$, :'np'))::jsonb)
  ->> 'category_id' as cat_y \gset
select least(:'cat_x'::uuid, :'cat_y'::uuid) as cat_anak, greatest(:'cat_x'::uuid, :'cat_y'::uuid) as cat_induk \gset
select tests.peer_val('a', format($$select api.update_category(%L, 'Arsip Anak', 'Car', %L)$$, :'cat_anak', :'cat_induk'));
select tests.peer_exec('adm', 'begin');
select tests.peer_val('adm', format($$select id from app.categories where id = %L for update$$, :'cat_induk'));
select tests.peer_exec('a', 'begin');
select tests.peer_send('a', format($$select api.archive_category(%L) ->> 'affected'$$, :'cat_induk'));
select ok(tests.peer_blocked('a'), 'arsip induk menunggu kunci induk');
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.update_category(p_category_id => %L, p_name => 'Arsip Anak 2',
  p_icon => 'Car', p_parent_id => %L) ->> 'category_id'$$, :'cat_anak', :'cat_induk'));
select ok(tests.peer_blocked('b'), 'ubah anak (induk tetap) menunggu kunci');
select tests.peer_exec('adm', 'commit');
select tests.peer_result('a') as arsip_a \gset
select is(:'arsip_a'::text, '2', 'arsip induk selesai tanpa deadlock, induk + anak terarsip');
select tests.peer_exec('a', 'commit');
select tests.peer_result('b') as ubah_b \gset
select matches(:'ubah_b'::text, '^ERROR: .*category_archived', 'ubah anak sesudah arsip = category_archived (bukan deadlock)');
select tests.peer_exec('b', 'rollback');
select is(tests.owner_val(null, format($$select name || ' ' || (archived_at is not null) || ' ' || (parent_id = %L)
  from app.categories where id = %L$$, :'cat_induk', :'cat_anak')), 'Arsip Anak true true',
  'anak terarsip di bawah induk, nama tidak berubah');

-- ===== Talangan (S7, 0110): reimburse paralel dan urutan kunci entri -> akun =====
select (tests.peer_val('a', format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 10, null, null, null, true)$$,
  :'np', :'acc_b'))::jsonb) ->> 'entry_id' as tal \gset
-- Dua reimburse 6 paralel atas talangan 10: yang kedua menunggu kunci talangan lalu membaca Σ baru.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.create_reimbursement(gen_random_uuid(), %L, %L, 6)$$, :'tal', :'acc_b'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.create_reimbursement(gen_random_uuid(), %L, %L, 6)$$, :'tal', :'acc_b'));
select ok(tests.peer_blocked('b'), 'reimburse kedua menunggu kunci talangan');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*reimbursement_exceeds', 'reimburse paralel kedua = reimbursement_exceeds');
select tests.peer_exec('b', 'rollback');
-- Ubah talangan (kunci talangan lalu dompet) paralel reimburse ke dompet yang sama. adm memegang
-- talangan; ubah (a) mengantre lebih dulu, lalu reimburse (b). Bila reimburse mengunci dompet
-- sebelum talangan, b memegang dompet dan a (sesudah mendapat talangan) menunggu dompet = 40P01.
select tests.peer_exec('adm', 'begin');
select tests.peer_val('adm', format($$select id from app.entries where id = %L for update$$, :'tal'));
select tests.peer_exec('a', 'begin');
select tests.peer_send('a', format($$select api.update_entry(gen_random_uuid(), %L, 1, %L, 10, null, null, 'konkuren', true) ->> 'version'$$,
  :'tal', :'acc_b'));
select ok(tests.peer_blocked('a'), 'ubah talangan menunggu kunci talangan');
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.create_reimbursement(gen_random_uuid(), %L, %L, 4) ->> 'remaining'$$, :'tal', :'acc_b'));
select ok(tests.peer_blocked('b'), 'reimburse menunggu kunci talangan');
select tests.peer_exec('adm', 'commit');
select tests.peer_result('a') as ubah_tal \gset
select is(:'ubah_tal'::text, '2', 'ubah talangan selesai tanpa deadlock');
select tests.peer_exec('a', 'commit');
select tests.peer_result('b') as reimb_tal \gset
select is(:'reimb_tal'::text, '0', 'reimburse sesudahnya selesai tanpa deadlock, sisa 0');
select tests.peer_exec('b', 'commit');
select is(tests.owner_val(null, format($$select count(*) || ' ' || sum(l.amount) from app.entries r
  join app.entry_lines l on l.entry_id = r.id where r.reimburses_entry_id = %L and r.voided_at is null$$, :'tal')),
  '2 10', 'Σ reimburse hidup = nominal talangan, tidak lebih');

-- ===== Pindah ruang (S7, 0111): urutan kunci entri -> akun, tanpa deadlock =====
select tests.peer_val('a', format($$select api.create_entry(gen_random_uuid(), %L, %L, 'income', 100)$$, :'np', :'acc_b'));
select (tests.peer_val('a', format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 5)$$, :'np', :'acc_b'))::jsonb)
  ->> 'entry_id' as mv1 \gset
-- adm memegang entri; ubah (a, entri -> dompet B) mengantre lebih dulu, lalu pindah (b). Bila pindah
-- mengunci dompet sebelum entri, b memegang dompet B dan a (sesudah mendapat entri) menunggu = 40P01.
select tests.peer_exec('adm', 'begin');
select tests.peer_val('adm', format($$select id from app.entries where id = %L for update$$, :'mv1'));
select tests.peer_exec('a', 'begin');
select tests.peer_send('a', format($$select api.update_entry(gen_random_uuid(), %L, 1, %L, 6, null, null, null, false) ->> 'version'$$,
  :'mv1', :'acc_b'));
select ok(tests.peer_blocked('a'), 'ubah entri menunggu kunci entri');
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.move_entry_to_space(gen_random_uuid(), %L, 1, %L, %L, null) ->> 'version'$$,
  :'mv1', :'sh', :'acc_s'));
select ok(tests.peer_blocked('b'), 'pindah ruang menunggu kunci entri');
select tests.peer_exec('adm', 'commit');
select tests.peer_result('a') as ubah_mv \gset
select is(:'ubah_mv'::text, '2', 'ubah entri selesai tanpa deadlock');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*version_conflict', 'pindah dengan versi sebelum ubah = DK409 (bukan deadlock)');
select tests.peer_exec('b', 'rollback');
select is(tests.owner_val(null, format($$select version || ' ' || (voided_at is null) || ' ' || coalesce(moved_to_entry_id::text, '-')
  from app.entries where id = %L$$, :'mv1')), '2 true -', 'entri tetap hidup di ruang asal dengan versi ubah');

-- Reimburse (a) lalu pindah (b) atas talangan yang sama: pindah menunggu kunci talangan lalu melihat
-- reimburse yang baru commit. Sebaliknya, reimburse sesudah pindah melihat talangan sudah batal.
select (tests.peer_val('a', format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 10, null, null, null, true)$$,
  :'np', :'acc_b'))::jsonb) ->> 'entry_id' as tal2 \gset
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.create_reimbursement(gen_random_uuid(), %L, %L, 3)$$, :'tal2', :'acc_b'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.move_entry_to_space(gen_random_uuid(), %L, 1, %L, %L, null)$$, :'tal2', :'sh', :'acc_s'));
select ok(tests.peer_blocked('b'), 'pindah talangan menunggu reimburse paralel');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*reimbursement_exists', 'pindah sesudah reimburse commit = reimbursement_exists');
select tests.peer_exec('b', 'rollback');
select (tests.peer_val('a', format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 10, null, null, null, true)$$,
  :'np', :'acc_b'))::jsonb) ->> 'entry_id' as tal3 \gset
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.move_entry_to_space(gen_random_uuid(), %L, 1, %L, %L, null)$$, :'tal3', :'sh', :'acc_s'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.create_reimbursement(gen_random_uuid(), %L, %L, 3)$$, :'tal3', :'acc_b'));
select ok(tests.peer_blocked('b'), 'reimburse menunggu pindah talangan paralel');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*not_reimbursable', 'reimburse sesudah talangan dipindah = not_reimbursable');
select tests.peer_exec('b', 'rollback');
select is(tests.owner_val(null, format($$select (select count(*) from app.entries where reimburses_entry_id = %1$L) || ' '
  || (select (moved_to_entry_id is not null and voided_at is not null)::text from app.entries where id = %1$L) || ' '
  || (select count(*) from app.entries where reimburses_entry_id = %2$L and voided_at is null)$$, :'tal3', :'tal2')),
  '0 true 1', 'talangan dipindah tanpa reimburse; talangan lain tetap dengan reimburse-nya');

select tests.peer_close('a');
select tests.peer_close('b');
select tests.peer_val('adm', 'select tests.wipe()');
select tests.peer_close('adm');

select * from finish();
rollback;
