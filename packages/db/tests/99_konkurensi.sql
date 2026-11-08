-- Konkurensi dua koneksi lewat dblink (BSD §3, §13 catatan konkurensi; IPD S5 "tes konkurensi"):
-- dua pengeluaran paralel tidak bisa membuat saldo negatif, klik ganda paralel = 1 entri,
-- transfer A->B paralel B->A tanpa deadlock, arsip paralel catat melihat data ter-commit,
-- re-parent kategori paralel (silang A/B, atau rantai C di bawah A saat A pindah ke bawah B)
-- ditolak category_depth, arsip induk paralel ubah anak tanpa deadlock (0109), reimburse paralel
-- dan ubah talangan paralel reimburse tanpa deadlock (0110), pindah ruang paralel ubah entri yang
-- sama dan paralel reimburse (0111), satu kewajiban (0117): tagihan aktif paralel anggaran wajib
-- kategori dan bulan sama (kedua urutan) = tepat satu obligation_double; pindah induk kategori
-- paralel tagihan baru pada kategori itu tidak bisa melewati XOR. Tagihan (0118): bayar paralel
-- kemunculan yang sama = tepat satu berhasil (already_posted), bayar saat void entri bayar belum
-- commit = already_posted tanpa menunggu, materialisasi paralel = satu kemunculan per bulan (on
-- conflict do nothing), ubah tagihan paralel bayar dan arsip paralel batalkan lewati = menunggu kunci
-- tagihan, tanpa deadlock.
-- Koneksi a dan b = dompetku_web (READ COMMITTED); ka dan kb = dompetku_test yang memanggil
-- tests.api_exec (menulis sebagai dompetku_api, belum ada api.create_bill/set_budget di 0117);
-- adm = superuser untuk fixture ter-commit.
-- Berjalan terakhir (99_) dan membersihkan semua data di awal dan akhir (tests.wipe).
-- ID: B8, C2, C4, C9, T15
begin;
select plan(73);

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
select is(tests.owner_val(null, format($$select version || ' ' || (voided_at is null) || ' ' || coalesce(moved_at::text, '-')
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
  || (select (moved_at is not null and voided_at is not null)::text from app.entries where id = %1$L) || ' '
  || (select count(*) from app.entries where reimburses_entry_id = %2$L and voided_at is null)$$, :'tal3', :'tal2')),
  '0 true 1', 'talangan dipindah tanpa reimburse; talangan lain tetap dengan reimburse-nya');

-- ===== Satu kewajiban (S9, 0117): advisory lock per ruang menyerialkan tagihan vs anggaran wajib =====
select tests.peer_open('ka', 'dompetku_test');
select tests.peer_open('kb', 'dompetku_test');
create function pg_temp.api(p_uid uuid, p_sql text) returns text
language sql as $$ select format('select tests.api_exec(%L, %L)', p_uid, p_sql) $$;
create function pg_temp.bill_sql(p_space uuid, p_cat uuid, p_starts date) returns text
language sql as $$
  select format($q$insert into app.bills (space_id, name, amount, category_id, day_of_month, starts_on, created_by,
                    created_at)
                  values (%L, 'Listrik PLN', 485000, %L, 20, %L, app.current_user_id(), '2026-01-01 00:00+07')$q$,
                p_space, p_cat, p_starts)
$$;
create function pg_temp.budget_sql(p_space uuid, p_cat uuid, p_month date) returns text
language sql as $$
  select format($q$insert into app.budgets (space_id, category_id, month, amount, wajib, updated_by)
                  values (%L, %L, %L, 1500000, true, app.current_user_id())$q$, p_space, p_cat, p_month)
$$;
-- Pelanggaran XOR yang ter-commit: tagihan aktif dan anggaran wajib pada induk yang sama, dengan
-- kemunculan tagihan di periode berlabel bulan anggaran (aturan 0117, kemunculan pertama = bill_first_on
-- 0118). Harus selalu 0. Fixture tanpa payday_rule = bulan kalender. created_at tagihan dipatok 1 Jan 2026
-- (sebelum semua starts_on) supaya hasilnya tidak bergantung pada jam nyata.
create function pg_temp.xor_violations(p_space uuid) returns text
language sql as $$
  select tests.owner_val(null, format($q$select count(*) from app.bills b
    join app.categories c on c.id = b.category_id
    join app.budgets bu on bu.space_id = b.space_id and bu.wajib and bu.category_id = coalesce(c.parent_id, c.id)
    where b.space_id = %L and b.archived_at is null
      and private.bill_due_in_label(b.space_id, b.day_of_month, private.bill_first_on(b.starts_on, b.created_at),
                                    b.ends_on, bu.month)$q$, p_space))
$$;
select tests.peer_val('adm', format($$select id from app.categories where space_id = %L and name = 'Listrik & Air'$$, :'sh')) as k_listrik \gset
select tests.peer_val('adm', format($$select id from app.categories where space_id = %L and name = 'Internet'$$, :'sh')) as k_net \gset
select tests.peer_val('adm', format($$select id from app.categories where space_id = %L and name = 'Iuran Lingkungan'$$, :'sh')) as k_iuran \gset
select tests.peer_val('adm', format($$select id from app.categories where space_id = %L and name = 'Sayur & Buah'$$, :'sh')) as k_sayur \gset
select tests.peer_val('adm', format($$select id from app.categories where space_id = %L and name = 'Bensin & Parkir'$$, :'sh')) as k_bensin \gset

-- Tagihan dulu (N), anggaran wajib paralel (F): anggaran menunggu kunci kewajiban ruang, lalu melihat
-- tagihan yang sudah commit.
select tests.peer_exec('ka', 'begin');
select tests.peer_val('ka', pg_temp.api(tests.n(), pg_temp.bill_sql(:'sh', :'k_listrik', '2026-11-01')));
select tests.peer_exec('kb', 'begin');
select tests.peer_send('kb', pg_temp.api(tests.f(), pg_temp.budget_sql(:'sh', :'k_listrik', '2026-11-01')));
select ok(tests.peer_blocked('kb'), 'anggaran wajib menunggu kunci kewajiban ruang selama tagihan paralel belum commit');
select tests.peer_exec('ka', 'commit');
select matches(tests.peer_result('kb'), '^ERROR: .*obligation_double', 'anggaran wajib paralel tagihan = obligation_double');
-- Keduanya commit: transaksi yang gagal berakhir ROLLBACK, yang lolos tersimpan.
select tests.peer_exec('kb', 'commit');
select is(tests.owner_val(null, format($$select (select count(*) from app.bills where category_id = %1$L) || ' '
  || (select count(*) from app.budgets where category_id = %1$L)$$, :'k_listrik')), '1 0',
  'tepat satu kewajiban Listrik & Air: tagihan, tanpa anggaran');

-- Urutan sebaliknya: anggaran wajib dulu (F), tagihan paralel (N).
select tests.peer_exec('ka', 'begin');
select tests.peer_val('ka', pg_temp.api(tests.f(), pg_temp.budget_sql(:'sh', :'k_net', '2026-11-01')));
select tests.peer_exec('kb', 'begin');
select tests.peer_send('kb', pg_temp.api(tests.n(), pg_temp.bill_sql(:'sh', :'k_net', '2026-10-15')));
select ok(tests.peer_blocked('kb'), 'tagihan menunggu kunci kewajiban ruang selama anggaran wajib paralel belum commit');
select tests.peer_exec('ka', 'commit');
select matches(tests.peer_result('kb'), '^ERROR: .*obligation_double', 'tagihan paralel anggaran wajib = obligation_double');
-- Keduanya commit: transaksi yang gagal berakhir ROLLBACK, yang lolos tersimpan.
select tests.peer_exec('kb', 'commit');
select is(pg_temp.xor_violations(:'sh'), '0', 'tidak ada pelanggaran satu kewajiban yang ter-commit');

-- Pindah induk paralel tagihan baru (Review Focus #1): Iuran Lingkungan punya anggaran wajib
-- Desember. update_category (a) memindah Sayur & Buah ke bawah Iuran (kategori belum dipakai, lolos);
-- tagihan baru pada Sayur & Buah (kb) harus menunggu pindah itu, lalu membandingkan dengan induk BARU.
-- Tanpa kunci baris kategori di trigger XOR, tagihan membaca induk lama (Belanja Dapur), lolos, dan
-- hanya menunggu cek FK; hasilnya tagihan aktif + anggaran wajib pada induk yang sama.
select tests.peer_val('ka', pg_temp.api(tests.n(), pg_temp.budget_sql(:'sh', :'k_iuran', '2026-12-01')));
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.update_category(%L, 'Sayur & Buah', 'Carrot', %L)$$, :'k_sayur', :'k_iuran'));
select tests.peer_exec('kb', 'begin');
select tests.peer_send('kb', pg_temp.api(tests.n(), pg_temp.bill_sql(:'sh', :'k_sayur', '2026-12-01')));
select ok(tests.peer_blocked('kb'), 'tagihan baru menunggu pindah induk kategorinya');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('kb'), '^ERROR: .*obligation_double', 'tagihan sesudah pindah induk dibandingkan dengan induk baru = obligation_double');
-- Keduanya commit: transaksi yang gagal berakhir ROLLBACK, yang lolos tersimpan.
select tests.peer_exec('kb', 'commit');
select is(pg_temp.xor_violations(:'sh'), '0', 'pindah induk paralel tidak melewati satu kewajiban');

-- Urutan sebaliknya: tagihan dulu (ka) pada Bensin & Parkir, pindah induk paralel (b) menunggu lalu
-- melihat tagihan yang sudah commit.
select tests.peer_exec('ka', 'begin');
select tests.peer_val('ka', pg_temp.api(tests.n(), pg_temp.bill_sql(:'sh', :'k_bensin', '2026-12-01')));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.update_category(%L, 'Bensin & Parkir', 'GasPump', %L)$$, :'k_bensin', :'k_iuran'));
select ok(tests.peer_blocked('b'), 'pindah induk menunggu tagihan paralel pada kategori itu');
select tests.peer_exec('ka', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*category_in_obligation', 'pindah induk sesudah tagihan commit = category_in_obligation');
select tests.peer_exec('b', 'rollback');
select is(tests.owner_val(null, format($$select coalesce(parent_id::text, '-') from app.categories where id = %L$$, :'k_bensin')),
  '-', 'Bensin & Parkir tetap induk');

-- ===== Tagihan (S9, 0118) =====
-- Jam nyata (env prod): tagihan jatuh tempo hari ini (tanggal = hari ini, mulai hari ini).
-- Risiko diketahui: peer memakai jam nyata, jadi tes yang berjalan tepat melewati 00:00 WIB bisa
-- membaca hari berbeda antar-koneksi (gagal palsu; ulangi). tests.clock tidak menular ke koneksi dblink.
select tests.peer_val('adm', format($$select id from app.categories where space_id = %L and name = 'Sewa Rumah'$$, :'sh')) as k_sewa \gset
create function pg_temp.kbill_sql(p_space uuid, p_name text, p_cat uuid, p_acc uuid) returns text
language sql as $$
  select format($q$select api.create_bill(gen_random_uuid(), %L, %L, 5, %L, extract(day from app.today())::smallint,
    app.today(), null, %L) ->> 'bill_id'$q$, p_space, p_name, p_cat, p_acc)
$$;
create function pg_temp.post_sql(p_occ uuid) returns text
language sql as $$
  select format($q$select api.post_bill_occurrence(gen_random_uuid(), %L) ->> 'occurrence_id'$q$, p_occ)
$$;
select tests.peer_val('a', pg_temp.kbill_sql(:'sh', 'Sewa Konkuren', :'k_sewa', :'acc_s')) as kbill \gset
select tests.owner_val(null, format('select id from app.bill_occurrences where bill_id = %L and due_on = app.today()', :'kbill')) as kocc \gset
-- Dua pembayaran paralel kemunculan yang sama: kedua menunggu kunci kemunculan lalu melihat entri hidup.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.post_sql(:'kocc'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', pg_temp.post_sql(:'kocc'));
select ok(tests.peer_blocked('b'), 'bayar kedua menunggu kunci kemunculan');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*already_posted', 'bayar paralel kemunculan sama: kedua = already_posted');
select tests.peer_exec('b', 'rollback');
select is(tests.owner_val(null, format($$select count(*) from app.entries e join app.bill_occurrences o on o.space_id = e.space_id
  where o.id = %L and e.description = 'Sewa Konkuren' and e.voided_at is null$$, :'kocc')), '1', 'tepat satu entri bayar');
-- Void entri bayar belum commit, bayar paralel: tidak menunggu entri (tanpa siklus dengan purge), membaca
-- entri yang masih hidup = already_posted (tidak dobel); sesudah void commit, bayar ulang berhasil.
select tests.owner_val(null, format('select entry_id from app.bill_occurrences where id = %L', :'kocc')) as kentry \gset
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.void_entry(gen_random_uuid(), %L, 1) ->> 'version'$$, :'kentry'));
select tests.peer_exec('b', $$set statement_timeout = '5s'$$);
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', pg_temp.post_sql(:'kocc'));
select matches(tests.peer_result('b'), '^ERROR: .*already_posted', 'bayar saat void entri bayar belum commit = already_posted tanpa menunggu');
select tests.peer_exec('b', 'rollback');
select tests.peer_exec('b', 'reset statement_timeout');
select tests.peer_exec('a', 'commit');
select is(tests.peer_val('b', pg_temp.post_sql(:'kocc')), :'kocc', 'sesudah void commit, bayar ulang berhasil');
select is(tests.owner_val(null, format($$select count(*) || ' ' || bool_and(o.entry_id = e.id) from app.entries e
  join app.bill_occurrences o on o.id = %L where e.description = 'Sewa Konkuren' and e.voided_at is null$$, :'kocc')),
  '1 true', 'satu entri bayar hidup, tertaut ke kemunculan');
-- Ubah tagihan paralel bayar: ubah menunggu kunci tagihan (bayar memegang FOR SHARE), lalu kemunculan
-- yang baru dibayar tidak disentuh dan bulan itu tidak mendapat kemunculan kedua.
select tests.peer_val('a', pg_temp.kbill_sql(:'sh', 'Sewa Konkuren 2', :'k_sewa', :'acc_s')) as kbill2 \gset
select tests.owner_val(null, format('select id from app.bill_occurrences where bill_id = %L and due_on = app.today()', :'kbill2')) as kocc2 \gset
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.post_sql(:'kocc2'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.update_bill(%L, 'Sewa Konkuren 2', 6, %L, extract(day from app.today() + 1)::smallint,
  %L, null) ->> 'bill_id'$$, :'kbill2', :'k_sewa', :'acc_s'));
select ok(tests.peer_blocked('b'), 'ubah tagihan menunggu bayar paralel (kunci tagihan)');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), :'kbill2', 'ubah selesai sesudah bayar commit, tanpa deadlock');
select tests.peer_exec('b', 'commit');
select is(tests.owner_val(null, format($$select (count(*) filter (where id = %L and entry_id is not null and amount = 5) = 1
    and count(*) filter (where entry_id is null and amount <> 6) = 0
    and count(*) = count(distinct date_trunc('month', due_on)))::text
  from app.bill_occurrences where bill_id = %L$$, :'kocc2', :'kbill2')), 'true',
  'kemunculan dibayar tetap (5), yang terbuka bernilai baru (6), satu kemunculan per bulan');
-- Batalkan lewati paralel arsip: batalkan lewati memegang tagihan FOR SHARE, jadi arsip menunggu lalu
-- melewati kemunculan yang baru dibuka. Tanpa kunci tagihan, arsip tidak melihat baris itu (masih
-- dilewati di snapshot-nya) dan tagihan terarsip menyisakan kemunculan terbuka.
select tests.owner_val(null, format('select id from app.bill_occurrences where bill_id = %L and entry_id is null', :'kbill2')) as kocc2b \gset
select tests.peer_val('a', format($$select api.skip_bill_occurrence(%L) ->> 'skipped'$$, :'kocc2b'));
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.unskip_bill_occurrence(%L) ->> 'skipped'$$, :'kocc2b'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.archive_bill(%L) ->> 'skipped'$$, :'kbill2'));
select ok(tests.peer_blocked('b'), 'arsip menunggu batalkan lewati paralel (kunci tagihan)');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), '1', 'arsip sesudah batalkan lewati commit melewati kemunculan yang baru dibuka');
select tests.peer_exec('b', 'commit');
select is(tests.owner_val(null, format($$select count(*) from app.bill_occurrences
  where bill_id = %L and entry_id is null and skipped_at is null$$, :'kbill2')), '0', 'tagihan terarsip tanpa kemunculan terbuka');
-- Materialisasi paralel (dua worker): yang kedua menunggu baris unik yang belum commit, lalu 0.
select tests.peer_open('w1', 'dompetku_worker');
select tests.peer_open('w2', 'dompetku_worker');
select tests.peer_exec('w1', 'begin');
select tests.peer_val('w1', 'select jobs.materialize_bills((app.today() + 400)::date)');
select tests.peer_exec('w2', 'begin');
select tests.peer_send('w2', 'select jobs.materialize_bills((app.today() + 400)::date)');
select ok(tests.peer_blocked('w2'), 'materialisasi kedua menunggu kemunculan yang belum commit');
select tests.peer_exec('w1', 'commit');
select is(tests.peer_result('w2'), '0', 'materialisasi paralel kedua = 0 tanpa galat (on conflict do nothing) [T15]');
select tests.peer_exec('w2', 'commit');
select is(tests.owner_val(null, $$select count(*) - count(distinct (bill_id, date_trunc('month', due_on))) from app.bill_occurrences$$),
  '0', 'satu kemunculan per tagihan per bulan sesudah materialisasi paralel');
select tests.peer_close('w1');
select tests.peer_close('w2');

select tests.peer_close('ka');
select tests.peer_close('kb');
select tests.peer_close('a');
select tests.peer_close('b');
select tests.peer_val('adm', 'select tests.wipe()');
select tests.peer_close('adm');

select * from finish();
rollback;
