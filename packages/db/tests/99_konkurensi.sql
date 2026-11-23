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
-- tagihan, tanpa deadlock. Pohon anggaran (0125): dua rincian paralel melewati induk = tepat satu
-- sub_exceeds_parent; hapus induk paralel rincian baru = parent_budget_required tanpa rincian yatim.
-- Utang (0131): dua pembayaran paralel melebihi sisa = satu payment_exceeds (C3), klik ganda bayar =
-- satu cicilan (C6), kegagalan di tengah pay_debt (trigger tests.fail_after sesudah line ditulis, hanya
-- aktif bila GUC tests.fail_after diset di sesi itu) = rollback utuh termasuk kunci idempotensi
-- (INT-12), arsip kontak paralel utang baru (kedua urutan), hapus utang paralel bayar (kedua urutan),
-- batal cicilan paralel hapus utang tanpa deadlock (kunci utang -> entri -> akun). S12 (0132): purge
-- menghapus utang di antara baca dan kunci = debt_not_found. Patungan (0136): dua pelunasan paralel melebihi
-- utang = satu payment_exceeds (kunci dompet sistem), hapus tagihan paralel pelunasan tanpa deadlock,
-- purge menghapus tagihan/pelunasan di antara baca dan kunci = split_not_found/settlement_not_found.
-- Tujuan (0138): dua create_goal paralel pada dompet sama = satu goal_exists, restore_goal paralel
-- create_goal (kedua urutan) = goal_exists, archive_account paralel create_goal (kedua urutan) =
-- account_archived / account_has_goal; tidak pernah dua tujuan aktif atau tujuan aktif di dompet terarsip.
-- Trip (0147): dua update_trip paralel, arsip paralel update (kedua urutan), arsip paralel pulihkan, create_trip kembar
-- (client_id sama = putar ulang; nama sama beda client_id = 23505 trips_name_unique), pulihkan paralel create_trip
-- bernama sama (kedua urutan): tidak pernah dua trip aktif bernama sama.
-- Penanda trip (0148): arsip trip paralel update_entry/set_entries_trip (kedua urutan, kunci trip FOR SHARE vs FOR NO KEY
-- UPDATE), dua set_entries_trip paralel entri yang sama dengan urutan larik terbalik, batal paralel penanda (kedua urutan),
-- update_entry paralel set_entries_trip pada trip yang sama: tanpa deadlock, tanpa tanda ke trip terarsip.
-- Koneksi a dan b = dompetku_web (READ COMMITTED); ka dan kb = dompetku_test yang memanggil
-- tests.api_exec (menulis sebagai dompetku_api, belum ada api.create_bill/set_budget di 0117);
-- adm = superuser untuk fixture ter-commit.
-- Berjalan terakhir (99_) dan membersihkan semua data di awal dan akhir (tests.wipe).
-- Aset (0141): dua revalue_asset paralel, transfer keluar paralel valuasi turun (asset_negative), valuasi paralel transfer.
-- Saham (0143): dua jual paralel melebihi lembar = satu insufficient_shares, batal paralel beli baru (kedua urutan) =
-- trade_not_latest atau beli menunggu, dua beli paralel dari dompet sumber yang sama = saldo_negatif (kunci dompet);
-- jalur generik (void/restore/update/pindah/purge) atas entri trade ditolak stock_account_trade_only tanpa menunggu kunci
-- entri, sehingga void generik paralel void_stock_trade tidak deadlock; archive_account paralel buy_stock (kedua urutan).
-- ID: B8, C2, C3, C4, C6, C9, T11, T15
begin;
select plan(215);

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

-- ===== Pohon anggaran (S10, 0125): penulisan satu ruang diserialkan kunci advisory 'dompetku.budget:' =====
-- Iuran Lingkungan (induk) punya anggaran Maret 2027 1.000.000; Sayur & Buah (sudah pindah ke bawah
-- Iuran di atas) dan Sub Konkuren adalah rinciannya.
select tests.peer_val('adm', format($$insert into app.categories (space_id, parent_id, type, name, icon)
  values (%L, %L, 'expense', 'Sub Konkuren', 'Receipt') returning id$$, :'sh', :'k_iuran')) as k_sub2 \gset
create function pg_temp.sb(p_uid uuid, p_space uuid, p_cat uuid, p_amount bigint) returns text
language sql as $$
  select pg_temp.api(p_uid, format($q$select api.set_budget(%L, %L, '2027-03-01'::date, %s)$q$, p_space, p_cat, p_amount))
$$;
select tests.peer_val('adm', pg_temp.sb(tests.n(), :'sh', :'k_iuran', 1000000));
-- Dua rincian paralel (600.000 + 600.000 > 1.000.000): yang kedua menunggu kunci, lalu melihat yang pertama.
select tests.peer_exec('ka', 'begin');
select tests.peer_val('ka', pg_temp.sb(tests.n(), :'sh', :'k_sayur', 600000));
select tests.peer_exec('kb', 'begin');
select tests.peer_send('kb', pg_temp.sb(tests.f(), :'sh', :'k_sub2', 600000));
select ok(tests.peer_blocked('kb'), 'rincian kedua menunggu kunci anggaran ruang selama rincian pertama belum commit');
select tests.peer_exec('ka', 'commit');
select matches(tests.peer_result('kb'), '^ERROR: .*sub_exceeds_parent', 'dua rincian paralel melewati induk = tepat satu sub_exceeds_parent');
select tests.peer_exec('kb', 'rollback');
select is(tests.owner_val(null, format($$select coalesce(sum(b.amount), 0) from app.budgets b
  join app.categories c on c.id = b.category_id
  where b.space_id = %L and b.month = '2027-03-01' and c.parent_id = %L$$, :'sh', :'k_iuran')), '600000',
  'jumlah rincian tidak melewati induk');
-- Hapus induk (belum commit) paralel rincian baru: rincian menunggu, lalu induk sudah tiada.
select tests.peer_exec('ka', 'begin');
select tests.peer_val('ka', pg_temp.api(tests.n(), format($$select api.delete_budget(%L, %L, '2027-03-01')$$, :'sh', :'k_iuran')));
select tests.peer_exec('kb', 'begin');
select tests.peer_send('kb', pg_temp.sb(tests.f(), :'sh', :'k_sub2', 100000));
select ok(tests.peer_blocked('kb'), 'rincian baru menunggu hapus anggaran induk yang belum commit');
select tests.peer_exec('ka', 'commit');
select matches(tests.peer_result('kb'), '^ERROR: .*parent_budget_required', 'rincian sesudah induk dihapus = parent_budget_required');
select tests.peer_exec('kb', 'rollback');
select is(tests.owner_val(null, format($$select count(*) from app.budgets where space_id = %L and month = '2027-03-01'$$, :'sh')),
  '0', 'tanpa rincian yatim: hapus induk menghapus rinciannya');

-- Turunkan induk paralel naikkan rincian (April 2027: induk 1.000.000, rincian 500.000): yang kedua
-- menunggu kunci lalu dinilai atas induk baru (600.000): 500.000 + 200.000 > 600.000.
create function pg_temp.sbm(p_uid uuid, p_space uuid, p_cat uuid, p_month text, p_amount bigint) returns text
language sql as $$
  select pg_temp.api(p_uid, format($q$select api.set_budget(%L, %L, %L::date, %s)$q$, p_space, p_cat, p_month, p_amount))
$$;
select tests.peer_val('adm', pg_temp.sbm(tests.n(), :'sh', :'k_iuran', '2027-04-01', 1000000));
select tests.peer_val('adm', pg_temp.sbm(tests.n(), :'sh', :'k_sayur', '2027-04-01', 500000));
select tests.peer_exec('ka', 'begin');
select tests.peer_val('ka', pg_temp.sbm(tests.n(), :'sh', :'k_iuran', '2027-04-01', 600000));
select tests.peer_exec('kb', 'begin');
select tests.peer_send('kb', pg_temp.sbm(tests.f(), :'sh', :'k_sub2', '2027-04-01', 200000));
select ok(tests.peer_blocked('kb'), 'naikkan rincian menunggu penurunan induk yang belum commit');
select tests.peer_exec('ka', 'commit');
select matches(tests.peer_result('kb'), '^ERROR: .*sub_exceeds_parent', 'rincian dinilai atas induk yang baru diturunkan = sub_exceeds_parent');
select tests.peer_exec('kb', 'rollback');
select is(tests.owner_val(null, format($$select string_agg(c.name || ':' || b.amount, ',' order by c.name) from app.budgets b
  join app.categories c on c.id = b.category_id where b.space_id = %L and b.month = '2027-04-01'$$, :'sh')),
  'Iuran Lingkungan:600000,Sayur & Buah:500000', 'induk 600.000 dan rincian 500.000 tersimpan, rincian kedua ditolak');

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

-- ===== Utang (0131) =====
create function pg_temp.adm_api(p_sql text) returns jsonb
language sql as $$ select tests.peer_val('adm', format('select tests.web_val(tests.n(), %L)', p_sql))::jsonb $$;
create function pg_temp.utang(p_contact uuid, p_principal int, p_acc uuid) returns uuid
language sql as $$
  select (pg_temp.adm_api(format($q$select api.create_debt(gen_random_uuid(), %L, 'borrowed', %s, 'baru', %L,
    null, %L)$q$, tests.space_id(tests.n(), 'personal'), p_principal, p_contact, p_acc)) ->> 'debt_id')::uuid
$$;
create function pg_temp.bayar_sql(p_debt uuid, p_acc uuid, p_amount int, p_client uuid default null) returns text
language sql as $$
  select format($q$select api.pay_debt(%L, %L, %L, %s)$q$, coalesce(p_client, gen_random_uuid()), p_debt, p_acc, p_amount)
$$;
create function pg_temp.sisa(p_debt uuid) returns text
language sql as $$
  select tests.owner_val(null, format($q$select paid || '/' || remaining from app.debt_balances where debt_id = %L$q$, p_debt))
$$;
select tests.peer_val('adm', format($$select tests.account(tests.n(), %L, 'U', 'operasional', 0)$$, :'np')) as acc_u \gset
select tests.peer_val('adm', format($$select tests.account(tests.n(), %L, 'V', 'operasional', 100)$$, :'np')) as acc_v \gset
select pg_temp.adm_api(format($$select api.create_contact(gen_random_uuid(), %L, 'Konkuren')$$, :'np')) ->> 'contact_id' as kk \gset
select pg_temp.utang(:'kk', 100, :'acc_u') as kd \gset
-- C3: dua pembayaran 60 paralel pada sisa 100 dari dua dompet berbeda (kunci dompet tidak menyerialkan;
-- hanya kunci utang yang membuat yang kedua membaca Σ sesudah yang pertama commit).
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.bayar_sql(:'kd', :'acc_u', 60) || $$ ->> 'entry_id'$$) as kp60 \gset
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', pg_temp.bayar_sql(:'kd', :'acc_v', 60) || $$ ->> 'remaining'$$);
select ok(tests.peer_blocked('b'), 'bayar kedua (dompet lain) menunggu kunci utang [C3]');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*payment_exceeds', 'bayar paralel melebihi sisa: yang kedua payment_exceeds [C3]');
select tests.peer_exec('b', 'rollback');
select is(pg_temp.sisa(:'kd') || ' ' || tests.balance(:'acc_v'), '60/40 100', 'sisa 40, tidak pernah negatif; dompet kedua utuh [C3]');
-- C6: klik ganda Bayar (client_id sama) paralel = satu cicilan.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.bayar_sql(:'kd', :'acc_u', 10, 'cccccccc-0000-0000-0000-000000000031') || $$ ->> 'remaining'$$);
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', pg_temp.bayar_sql(:'kd', :'acc_u', 10, 'cccccccc-0000-0000-0000-000000000031') || $$ ->> 'replayed'$$);
select ok(tests.peer_blocked('b'), 'bayar kembar menunggu kunci idempotensi [C6]');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), 'true', 'bayar kembar = replay [C6]');
select tests.peer_exec('b', 'commit');
select is(pg_temp.sisa(:'kd') || ' ' || tests.balance(:'acc_u'), '70/30 30', 'klik ganda paralel = satu cicilan [C6]');
-- INT-12: gagal sesudah entri dan line cicilan ditulis = rollback utuh. Trigger dibuat owner di dalam
-- savepoint sesi ini (bukan lewat peer: DDL lintas sesi menunggu kunci tabel sesi tes) dan aktif hanya bila
-- GUC tests.fail_after diset; rollback to savepoint membuang trigger beserta kuncinya.
savepoint int12;
select tests.owner_exec(null, $q$create function private.tes_fail_after() returns trigger
  language plpgsql set search_path = '' as $f$
  begin
    if pg_catalog.current_setting('tests.fail_after', true) = 'debt_payment_line' then
      raise exception using errcode = 'P0001', message = 'fail_after';
    end if;
    return null;
  end $f$$q$);
select tests.owner_exec(null, 'create trigger tes_fail_after after insert on app.entry_lines
  for each row execute function private.tes_fail_after()');
select set_config('tests.fail_after', 'debt_payment_line', true);
select throws_ok(format('select tests.web_val(tests.n(), %L)',
  pg_temp.bayar_sql(:'kd', :'acc_u', 5, 'cccccccc-0000-0000-0000-000000000032')), 'P0001', 'fail_after',
  'kegagalan disuntik di tengah pay_debt (sesudah entri dan line ditulis)');
select is(concat_ws(' ', pg_temp.sisa(:'kd'), tests.balance(:'acc_u'),
    tests.owner_val(null, format($$select count(*) from app.entries where debt_id = %L$$, :'kd')),
    tests.owner_val(null, $$select count(*) from app.idempotency_keys where client_id = 'cccccccc-0000-0000-0000-000000000032'$$)),
  '70/30 30 3 0', 'rollback utuh: sisa, saldo, entri, kunci idempotensi tidak berubah [INT-12]');
rollback to savepoint int12;
select set_config('tests.fail_after', '', true);
select is(tests.peer_val('a', pg_temp.bayar_sql(:'kd', :'acc_u', 5, 'cccccccc-0000-0000-0000-000000000032') || $$ ->> 'remaining'$$),
  '25', 'client_id yang sama diulang sesudah gagal = cicilan baru');
-- Batal cicilan paralel hapus utang: keduanya mengunci utang dulu, tanpa deadlock; cicilan yang batal
-- lebih dulu tidak ikut ditandai Hapus utang.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.void_entry(gen_random_uuid(), %L, 1) ->> 'version'$$, :'kp60'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select jsonb_array_length(api.void_debt(gen_random_uuid(), %L) -> 'affected')$$, :'kd'));
select ok(tests.peer_blocked('b'), 'hapus utang menunggu batal cicilan paralel (kunci utang)');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), '3', 'hapus utang sesudah batal commit: pokok + dua cicilan hidup, tanpa deadlock');
select tests.peer_exec('b', 'commit');
select is(tests.owner_val(null, format($$select string_agg(voided_with_debt::text, ',' order by voided_with_debt)
  from app.entries where debt_id = %L$$, :'kd')), 'false,true,true,true', 'cicilan yang batal lebih dulu tidak ditandai ikut terhapus');
-- Arsip kontak lebih dulu, utang baru menunggu lalu contact_archived.
select pg_temp.adm_api(format($$select api.create_contact(gen_random_uuid(), %L, 'Konkuren 2')$$, :'np')) ->> 'contact_id' as kk2 \gset
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.archive_contact(%L) ->> 'archived'$$, :'kk2'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.create_debt(gen_random_uuid(), %L, 'borrowed', 10, 'berjalan', %L) ->> 'debt_id'$$, :'np', :'kk2'));
select ok(tests.peer_blocked('b'), 'utang baru menunggu arsip kontak paralel');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*contact_archived', 'utang baru sesudah arsip commit = contact_archived');
select tests.peer_exec('b', 'rollback');
-- Utang baru lebih dulu, arsip menunggu lalu berhasil; utang tetap tercatat.
select pg_temp.adm_api(format($$select api.create_contact(gen_random_uuid(), %L, 'Konkuren 3')$$, :'np')) ->> 'contact_id' as kk3 \gset
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.create_debt(gen_random_uuid(), %L, 'borrowed', 10, 'berjalan', %L) ->> 'debt_id'$$, :'np', :'kk3'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.archive_contact(%L) ->> 'archived'$$, :'kk3'));
select ok(tests.peer_blocked('b'), 'arsip kontak menunggu utang baru paralel');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), 'true', 'arsip berhasil sesudah utang baru commit');
select tests.peer_exec('b', 'commit');
select is(tests.owner_val(null, format($$select count(*) || ' ' || bool_and(c.archived_at is not null) from app.debts d
  join app.contacts c on c.id = d.contact_id where d.contact_id = %L and d.voided_at is null$$, :'kk3')), '1 true',
  'utang tetap tercatat pada kontak yang diarsipkan');
-- Hapus utang lebih dulu, bayar menunggu lalu debt_deleted.
select pg_temp.utang(:'kk', 50, :'acc_u') as kd2 \gset
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.void_debt(gen_random_uuid(), %L) ->> 'debt_id'$$, :'kd2'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', pg_temp.bayar_sql(:'kd2', :'acc_u', 10) || $$ ->> 'remaining'$$);
select ok(tests.peer_blocked('b'), 'bayar menunggu hapus utang paralel');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*debt_deleted', 'bayar sesudah hapus commit = debt_deleted');
select tests.peer_exec('b', 'rollback');
-- Bayar lebih dulu, hapus menunggu lalu ikut membatalkan cicilan baru.
select pg_temp.utang(:'kk', 50, :'acc_u') as kd3 \gset
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.bayar_sql(:'kd3', :'acc_u', 20) || $$ ->> 'remaining'$$);
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select jsonb_array_length(api.void_debt(gen_random_uuid(), %L) -> 'affected')$$, :'kd3'));
select ok(tests.peer_blocked('b'), 'hapus utang menunggu bayar paralel');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), '2', 'hapus sesudah bayar commit ikut membatalkan cicilan baru');
select tests.peer_exec('b', 'commit');
select is(tests.owner_val(null, format($$select count(*) from app.entries where debt_id = %L and voided_at is null$$, :'kd3'))
  || ' ' || tests.balance(:'acc_u'), '0 0', 'tanpa entri hidup, saldo dompet kembali ke nol');
-- K7 S12 (0132): purge menghapus utang di antara baca dan kunci private.lock_debt. Utang berjalan
-- (tanpa entri) dihapus, voided_at dimundurkan 100 hari; purge_voided (belum commit) memegang baris,
-- bayar membaca baris lama lalu menunggu kunci, dan sesudah purge commit mendapat debt_not_found.
select (pg_temp.adm_api(format($$select api.create_debt(gen_random_uuid(), %L, 'borrowed', 10, 'berjalan', %L)$$,
  :'np', :'kk')) ->> 'debt_id') as kd4 \gset
select pg_temp.adm_api(format($$select api.void_debt(gen_random_uuid(), %L)$$, :'kd4'));
select tests.peer_val('adm', format($$update app.debts set voided_at = voided_at - interval '100 days' where id = %L
  returning 1$$, :'kd4'));
select tests.peer_exec('adm', 'begin');
select tests.peer_val('adm', 'select jobs.purge_voided()');
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', pg_temp.bayar_sql(:'kd4', :'acc_u', 1) || $$ ->> 'remaining'$$);
select ok(tests.peer_blocked('b'), 'bayar menunggu purge yang menghapus utang [K7]');
select tests.peer_exec('adm', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*debt_not_found', 'utang hilang sesudah kunci = debt_not_found [K7]');
select tests.peer_exec('b', 'rollback');
select is(tests.owner_val(null, format($$select count(*) from app.debts where id = %L$$, :'kd4')), '0',
  'utang terhapus purge, tanpa cicilan yatim');

-- ===== Patungan (0136): dua pelunasan paralel melebihi utang (C3-analog) =====
-- Farida melunasi dari dua dompet berbeda (kunci dompet Pribadi tidak menyerialkan); kunci dompet sistem
-- Bersama membuat yang kedua membaca saldo patungan sesudah yang pertama commit.
create function pg_temp.adm_f(p_sql text) returns jsonb
language sql as $$ select tests.peer_val('adm', format('select tests.web_val(tests.f(), %L)', p_sql))::jsonb $$;
select tests.peer_val('adm', $$select tests.space_id(tests.f(), 'personal')$$) as fp \gset
select tests.peer_val('adm', format($$select tests.account(tests.f(), %L, 'F1', 'operasional', 1000)$$, :'fp')) as acc_f1 \gset
select tests.peer_val('adm', format($$select tests.account(tests.f(), %L, 'F2', 'operasional', 1000)$$, :'fp')) as acc_f2 \gset
select tests.peer_val('adm', format($$select tests.account(tests.n(), %L, 'P', 'operasional', 1000)$$, :'np')) as acc_p \gset
select pg_temp.adm_api(format($$select api.create_split(gen_random_uuid(), %L, %L, 400)$$, :'sh', :'acc_p'));
select tests.peer_open('pa', 'dompetku_web');
select tests.peer_open('pb', 'dompetku_web');
select tests.peer_val(c, format($$select set_config('app.user_id', %L, false)$$, tests.f())) from unnest(array['pa', 'pb']) c;
select tests.peer_exec('pa', 'begin');
select tests.peer_val('pa', format($$select api.settle_split(gen_random_uuid(), %L, %L, 150) ->> 'remaining'$$, :'sh', :'acc_f1'));
select tests.peer_exec('pb', 'begin');
select tests.peer_send('pb', format($$select api.settle_split(gen_random_uuid(), %L, %L, 150) ->> 'remaining'$$, :'sh', :'acc_f2'));
select ok(tests.peer_blocked('pb'), 'pelunasan kedua (dompet lain) menunggu kunci dompet sistem [C3]');
select tests.peer_exec('pa', 'commit');
select matches(tests.peer_result('pb'), '^ERROR: .*payment_exceeds', 'pelunasan paralel melebihi utang: yang kedua payment_exceeds [C3]');
select tests.peer_exec('pb', 'rollback');
select is(tests.owner_val(null, format($$select balance from app.member_balances where space_id = %L and user_id = %L$$,
    :'sh', tests.f())) || ' ' || tests.balance(:'acc_f1') || ' ' || tests.balance(:'acc_f2'), '-50 850 1000',
  'utang Farida 50, tidak pernah lewat; dompet kedua utuh [C3]');
-- Pelunasan paralel hapus tagihan: hapus menunggu kunci dompet sistem, tanpa deadlock; sesudahnya saldo
-- berbalik (Novanda berutang 150) tanpa logika tersembunyi.
select tests.peer_exec('pb', 'begin');
select tests.peer_val('pb', format($$select api.settle_split(gen_random_uuid(), %L, %L, 50) ->> 'remaining'$$, :'sh', :'acc_f2'));
select tests.peer_exec('a', 'begin');
select tests.peer_send('a', format($$select jsonb_array_length(api.void_split(gen_random_uuid(),
  (select id from app.splits where space_id = %L)) -> 'affected')$$, :'sh'));
select ok(tests.peer_blocked('a'), 'hapus tagihan menunggu pelunasan paralel (kunci dompet sistem)');
select tests.peer_exec('pb', 'commit');
select is(tests.peer_result('a'), '3', 'hapus tagihan sesudah pelunasan commit: tiga entri, tanpa deadlock');
select tests.peer_exec('a', 'commit');
select is(tests.owner_val(null, format($$select string_agg(balance::text, ',' order by user_id) from app.member_balances
    where space_id = %L$$, :'sh')) || ' ' || tests.worker_val(null, $$select violations from jobs.dq_reconcile()
    where check_id = 'DQ16'$$), '-200,200 0', 'saldo berbalik nol-jumlah; DQ16 nol');
-- R1 S12 (0136): purge menghapus tagihan/pelunasan batal di antara baca dan kunci private.lock_split /
-- lock_settlement (pola K7): aksi menunggu kunci, lalu split_not_found / settlement_not_found (bukan
-- sukses palsu yang ikut disimpan idempotensi).
select tests.owner_val(null, format($$select id from app.splits where space_id = %L$$, :'sh')) as sp1,
       tests.owner_val(null, format($$select id from app.settlements where space_id = %L and amount = 50$$, :'sh')) as t50 \gset
select tests.peer_val('pa', format($$select api.void_settlement(gen_random_uuid(), %L) ->> 'settlement_id'$$, :'t50'));
select tests.peer_val('adm', format($$with a as (update app.splits set voided_at = voided_at - interval '100 days'
  where id = %L returning 1), b as (update app.settlements set voided_at = voided_at - interval '100 days'
  where id = %L returning 1) select (select count(*) from a) + (select count(*) from b)$$, :'sp1', :'t50'));
select tests.peer_exec('adm', 'begin');
select tests.peer_val('adm', 'select jobs.purge_voided()');
select tests.peer_exec('a', 'begin');
select tests.peer_send('a', format($$select api.restore_split(gen_random_uuid(), %L) ->> 'split_id'$$, :'sp1'));
select tests.peer_exec('pa', 'begin');
select tests.peer_send('pa', format($$select api.void_settlement(gen_random_uuid(), %L) ->> 'settlement_id'$$, :'t50'));
select ok(tests.peer_blocked('a'), 'pulihkan tagihan menunggu purge yang menghapusnya [R1]');
select ok(tests.peer_blocked('pa'), 'batal pelunasan menunggu purge yang menghapusnya [R1]');
select tests.peer_exec('adm', 'commit');
select matches(tests.peer_result('a'), '^ERROR: .*split_not_found', 'tagihan hilang sesudah kunci = split_not_found [R1]');
select matches(tests.peer_result('pa'), '^ERROR: .*settlement_not_found',
  'pelunasan hilang sesudah kunci = settlement_not_found [R1]');
select tests.peer_exec('a', 'rollback');
select tests.peer_exec('pa', 'rollback');
select is(tests.owner_val(null, format($$select (select count(*) from app.splits where id = %L)
    + (select count(*) from app.settlements where id = %L)$$, :'sp1', :'t50')), '0', 'keduanya terhapus purge [R1]');
select tests.peer_close('pa');
select tests.peer_close('pb');

-- ===== Tujuan (0138): 1 dompet = 1 tujuan aktif di bawah paralel (kunci dompet -> tujuan) =====
select tests.peer_val('adm', format($$select tests.account(tests.n(), %L, %L, 'tabungan', 0)$$, :'np', 'G' || i))
  from generate_series(1, 5) i;
select tests.owner_val(null, format($$select string_agg(id::text, ',' order by name collate "C") from app.accounts
  where space_id = %L and name in ('G1', 'G2', 'G3', 'G4', 'G5')$$, :'np')) as gacc \gset
select split_part(:'gacc', ',', 1) as g1, split_part(:'gacc', ',', 2) as g2, split_part(:'gacc', ',', 3) as g3,
       split_part(:'gacc', ',', 4) as g4, split_part(:'gacc', ',', 5) as g5 \gset
create function pg_temp.cg_sql(p_acc uuid, p_name text) returns text
language sql as $$
  select format($q$select api.create_goal(gen_random_uuid(), %L, %L, %L, 1000) ->> 'goal_id'$q$,
    tests.space_id(tests.n(), 'personal'), p_acc, p_name)
$$;
create function pg_temp.aktif(p_acc uuid) returns text
language sql as $$
  select tests.owner_val(null, format($q$select count(*) from app.goals where account_id = %L and status = 'active'$q$, p_acc))
$$;
-- Dua create_goal paralel pada dompet yang sama: yang kedua menunggu kunci dompet, lalu goal_exists.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.cg_sql(:'g1', 'A'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', pg_temp.cg_sql(:'g1', 'B'));
select ok(tests.peer_blocked('b'), 'tujuan kedua pada dompet sama menunggu kunci dompet [T11]');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*goal_exists', 'dua create_goal paralel: yang kedua goal_exists [T11]');
select tests.peer_exec('b', 'rollback');
select is(pg_temp.aktif(:'g1'), '1', 'tepat satu tujuan aktif [T11]');
-- restore_goal paralel create_goal (kedua urutan): tujuan lama diarsip lebih dulu (ter-commit).
select pg_temp.adm_api(format($$select api.create_goal(gen_random_uuid(), %L, %L, 'Lama 2', 1000)$$, :'np', :'g2'))
  ->> 'goal_id' as gold2 \gset
select pg_temp.adm_api(format($$select api.create_goal(gen_random_uuid(), %L, %L, 'Lama 3', 1000)$$, :'np', :'g3'))
  ->> 'goal_id' as gold3 \gset
select pg_temp.adm_api(format($$select api.archive_goal(%L)$$, :'gold2'));
select pg_temp.adm_api(format($$select api.archive_goal(%L)$$, :'gold3'));
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.cg_sql(:'g2', 'Baru 2'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.restore_goal(%L) ->> 'status'$$, :'gold2'));
select ok(tests.peer_blocked('b'), 'pulihkan menunggu tujuan baru paralel (kunci dompet) [T11]');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*goal_exists', 'pulihkan sesudah tujuan baru commit = goal_exists [T11]');
select tests.peer_exec('b', 'rollback');
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.restore_goal(%L) ->> 'status'$$, :'gold3'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', pg_temp.cg_sql(:'g3', 'Baru 3'));
select ok(tests.peer_blocked('b'), 'tujuan baru menunggu pulihkan paralel (kunci dompet) [T11]');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*goal_exists', 'tujuan baru sesudah pulihkan commit = goal_exists [T11]');
select tests.peer_exec('b', 'rollback');
select is(pg_temp.aktif(:'g2') || ',' || pg_temp.aktif(:'g3'), '1,1', 'tepat satu tujuan aktif per dompet [T11]');
-- archive_account paralel create_goal (kedua urutan): tidak pernah ada tujuan aktif di dompet terarsip.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.archive_account(%L) ->> 'archived'$$, :'g4'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', pg_temp.cg_sql(:'g4', 'Telat'));
select ok(tests.peer_blocked('b'), 'tujuan baru menunggu arsip dompet paralel');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*account_archived', 'tujuan baru sesudah arsip dompet commit = account_archived');
select tests.peer_exec('b', 'rollback');
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.cg_sql(:'g5', 'Duluan'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.archive_account(%L) ->> 'archived'$$, :'g5'));
select ok(tests.peer_blocked('b'), 'arsip dompet menunggu tujuan baru paralel');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*account_has_goal', 'arsip dompet sesudah tujuan baru commit = account_has_goal');
select tests.peer_exec('b', 'rollback');
select is(tests.owner_val(null, $$select count(*) from app.goals g join app.accounts a on a.id = g.account_id
    where g.status = 'active' and a.archived_at is not null$$) || ' '
    || tests.worker_val(null, $$select violations from jobs.dq_reconcile() where check_id = 'DQ17'$$), '0 0',
  'tanpa tujuan aktif di dompet terarsip; DQ17 nol');

-- ===== Trip (0147): kunci baris trip, nama aktif unik, idempotensi client_id di bawah paralel =====
create function pg_temp.trip_sql(p_name text, p_client uuid default null) returns text
language sql as $$
  select format($q$select api.create_trip(%L, %L, %L, '2026-03-01', '2026-03-07') ->> 'trip_id'$q$,
    coalesce(p_client, gen_random_uuid()), tests.space_id(tests.n(), 'personal'), p_name)
$$;
create function pg_temp.upd_sql(p_trip uuid, p_name text) returns text
language sql as $$
  select format($q$select api.update_trip(%L, %L, '2026-03-01', '2026-03-07', null) ->> 'status'$q$, p_trip, p_name)
$$;
create function pg_temp.tstate(p_trip uuid) returns text
language sql as $$
  select tests.owner_val(null, format($q$select name || '/' || (archived_at is not null) from app.trips where id = %L$q$, p_trip))
$$;
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.trip_sql('T Satu'))) as tr1 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.trip_sql('T Dua'))) as tr2 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.trip_sql('T Tiga'))) as tr3 \gset
-- Dua update_trip paralel: yang kedua menunggu kunci baris, lalu menulis sesudahnya (nilai akhir = yang terakhir).
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.upd_sql(:'tr1', 'T Satu A'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', pg_temp.upd_sql(:'tr1', 'T Satu B'));
select ok(tests.peer_blocked('b'), 'update_trip kedua menunggu kunci baris trip');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), 'active', 'update_trip kedua selesai sesudah yang pertama commit');
select tests.peer_exec('b', 'commit');
select is(pg_temp.tstate(:'tr1'), 'T Satu B/false', 'dua update_trip paralel: nilai akhir = yang terakhir, tanpa kehilangan baris');
-- archive_trip paralel update_trip (kedua urutan): update sesudah arsip = trip_archived; arsip sesudah update = sukses.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.archive_trip(%L) ->> 'status'$$, :'tr1'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', pg_temp.upd_sql(:'tr1', 'T Telat'));
select ok(tests.peer_blocked('b'), 'update_trip menunggu arsip paralel');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*trip_archived', 'update_trip sesudah arsip commit = trip_archived');
select tests.peer_exec('b', 'rollback');
select is(pg_temp.tstate(:'tr1'), 'T Satu B/true', 'trip terarsip, nama tidak berubah');
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, format($q$select api.restore_trip(%L) ->> 'status'$q$, :'tr1')));
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.upd_sql(:'tr1', 'T Satu C'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.archive_trip(%L) ->> 'status'$$, :'tr1'));
select ok(tests.peer_blocked('b'), 'arsip menunggu update_trip paralel');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), 'archived', 'arsip sesudah update commit = sukses');
select tests.peer_exec('b', 'commit');
select is(pg_temp.tstate(:'tr1'), 'T Satu C/true', 'perubahan nama tetap, trip terarsip');
-- archive_trip paralel restore_trip: diserialkan kunci baris; hasil akhir = urutan commit (aktif).
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.restore_trip(%L) ->> 'status'$$, :'tr1'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.archive_trip(%L) ->> 'status'$$, :'tr1'));
select ok(tests.peer_blocked('b'), 'arsip menunggu pulihkan paralel pada trip yang sama');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), 'archived', 'arsip sesudah pulihkan commit = sukses (tanpa deadlock)');
select tests.peer_exec('b', 'commit');
select is(pg_temp.tstate(:'tr1'), 'T Satu C/true', 'urutan pulihkan lalu arsip = terarsip');
-- Dua create_trip paralel dengan client_id sama: yang kedua menunggu kunci idempotensi, lalu memutar ulang hasil yang sama.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.trip_sql('Kembar', 'bbbbbbbb-0000-0000-0000-000000000001')) as kembar \gset
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.create_trip('bbbbbbbb-0000-0000-0000-000000000001', %L, 'Kembar', '2026-03-01',
  '2026-03-07') ->> 'trip_id'$$, tests.space_id(tests.n(), 'personal')));
select ok(tests.peer_blocked('b'), 'create_trip kembar (client_id sama) menunggu kunci idempotensi');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), :'kembar', 'client_id sama paralel = putar ulang, trip_id sama');
select tests.peer_exec('b', 'commit');
select is(tests.owner_val(null, $$select count(*) from app.trips where name = 'Kembar'$$), '1', 'tepat satu trip Kembar');
-- Nama sama, client_id beda: yang kedua menunggu indeks unik, lalu 23505 (name_taken).
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.trip_sql('Nama Sama'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', pg_temp.trip_sql('nama sama'));
select ok(tests.peer_blocked('b'), 'create_trip nama sama (client_id beda) menunggu indeks nama');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*trips_name_unique', 'nama sama beda client_id = 23505 trips_name_unique (name_taken)');
select tests.peer_exec('b', 'rollback');
select is(tests.owner_val(null, $$select count(*) from app.trips where lower(name) = 'nama sama'$$), '1', 'tepat satu trip bernama itu');
-- restore_trip paralel create_trip nama sama (kedua urutan): tidak pernah dua trip aktif bernama sama.
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, format($q$select api.archive_trip(%L) ->> 'status'$q$, :'tr2')));
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.trip_sql('T Dua'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.restore_trip(%L) ->> 'status'$$, :'tr2'));
select ok(tests.peer_blocked('b'), 'pulihkan menunggu create_trip paralel bernama sama');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*trips_name_unique', 'pulihkan sesudah trip baru commit = 23505 (name_taken)');
select tests.peer_exec('b', 'rollback');
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, format($q$select api.archive_trip(%L) ->> 'status'$q$,
  (select tests.owner_val(null, $$select id from app.trips where name = 'T Dua' and archived_at is null$$)))));
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.restore_trip(%L) ->> 'status'$$, :'tr2'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', pg_temp.trip_sql('T Dua'));
select ok(tests.peer_blocked('b'), 'create_trip menunggu pulihkan paralel bernama sama');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*trips_name_unique', 'trip baru sesudah pulihkan commit = 23505 (name_taken)');
select tests.peer_exec('b', 'rollback');
select is(tests.owner_val(null, $$select count(*) from app.trips where name = 'T Dua' and archived_at is null$$), '1',
  'tidak pernah dua trip aktif bernama sama');

-- ===== Trip (0148): penanda entri di bawah kunci trip (FOR SHARE) -> entri -> dompet =====
-- archive_trip memakai FOR NO KEY UPDATE yang bentrok dengan FOR SHARE: arsip dan penanda saling menunggu (kedua urutan),
-- tanpa siklus karena jalur trip tidak pernah mengunci entri. Dua penanda paralel atas entri yang sama (urutan id berbeda),
-- batal paralel penanda (kedua urutan), update_entry paralel set_entries_trip pada trip yang sama: tanpa deadlock.
create function pg_temp.k_entry_sql(p_space uuid, p_acc uuid) returns text
language sql as $$
  select format($q$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1000, null, null) ->> 'entry_id'$q$, p_space, p_acc)
$$;
create function pg_temp.k_tag_sql(p_trip uuid, p_ids uuid[]) returns text
language sql as $$
  select format($q$select api.set_entries_trip(gen_random_uuid(), %L, %L::uuid[]) ->> 'changed'$q$, p_trip, p_ids)
$$;
create function pg_temp.k_upd_sql(p_entry uuid, p_ver int, p_acc uuid, p_trip uuid) returns text
language sql as $$
  select format($q$select api.update_entry(gen_random_uuid(), %L, %s, %L, 1000, null, null, null, false, false,
    p_trip_id => %L) ->> 'version'$q$, p_entry, p_ver, p_acc, p_trip)
$$;
create function pg_temp.k_state(p_ids uuid[]) returns text
language sql as $$
  select tests.owner_val(null, format($q$select string_agg(coalesce((select t.name from app.trips t where t.id = e.trip_id), '-')
      || '|' || e.version || '|' || (e.voided_at is not null), ',' order by x.ord)
    from unnest(%L::uuid[]) with ordinality x (id, ord) join app.entries e on e.id = x.id$q$, p_ids))
$$;
select tests.peer_val('adm', format($$select tests.account(tests.n(), %L, 'Kas Trip', 'operasional', 1000000)$$, :'np')) as acc_k \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.trip_sql('K Satu'))) as k1 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.trip_sql('K Dua'))) as k2 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.trip_sql('K Tiga'))) as k3 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.trip_sql('K Empat'))) as k4 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.trip_sql('K Lima'))) as k5 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.trip_sql('K Enam'))) as k6 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.k_entry_sql(:'np', :'acc_k'))) as ke1 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.k_entry_sql(:'np', :'acc_k'))) as ke2 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.k_entry_sql(:'np', :'acc_k'))) as ke3 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.k_entry_sql(:'np', :'acc_k'))) as ke4 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.k_entry_sql(:'np', :'acc_k'))) as ke5 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.k_entry_sql(:'np', :'acc_k'))) as ke6 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.k_entry_sql(:'np', :'acc_k'))) as ke7 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.k_entry_sql(:'np', :'acc_k'))) as ke8 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.k_entry_sql(:'np', :'acc_k'))) as ke9 \gset
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.k_entry_sql(:'np', :'acc_k'))) as ke10 \gset
-- archive_trip (a, belum commit) lalu update_entry menandai trip itu (b): b menunggu, lalu trip_archived.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.archive_trip(%L) ->> 'status'$$, :'k1'));
select tests.peer_exec('b', 'begin');
select tests.peer_exec('b', $$set local lock_timeout = '10s'$$);
select tests.peer_send('b', pg_temp.k_upd_sql(:'ke1', 1, :'acc_k', :'k1'));
select ok(tests.peer_blocked('b'), 'update_entry + trip menunggu arsip trip paralel (FOR SHARE vs FOR NO KEY UPDATE)');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*trip_archived', 'penanda sesudah arsip commit = trip_archived');
select tests.peer_exec('b', 'rollback');
select is(pg_temp.k_state(array[:'ke1']::uuid[]), '-|1|false', 'entri tidak ditandai ke trip yang terarsip duluan');
-- update_entry menandai (a, belum commit) lalu archive_trip (b): arsip menunggu, lalu sukses; entri tetap bertanda.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.k_upd_sql(:'ke2', 1, :'acc_k', :'k2'));
select tests.peer_exec('b', 'begin');
select tests.peer_exec('b', $$set local lock_timeout = '10s'$$);
select tests.peer_send('b', format($$select api.archive_trip(%L) ->> 'status'$$, :'k2'));
select ok(tests.peer_blocked('b'), 'archive_trip menunggu penanda update_entry paralel pada trip yang sama');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), 'archived', 'arsip sesudah penanda commit = sukses');
select tests.peer_exec('b', 'commit');
select is(pg_temp.k_state(array[:'ke2']::uuid[]) || ' ' || pg_temp.tstate(:'k2'), 'K Dua|2|false K Dua/true',
  'entri bertanda trip yang terarsip sesudahnya (diperbolehkan), tanpa deadlock');
-- set_entries_trip (a, belum commit) lalu archive_trip (b).
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.k_tag_sql(:'k3', array[:'ke3']::uuid[]));
select tests.peer_exec('b', 'begin');
select tests.peer_exec('b', $$set local lock_timeout = '10s'$$);
select tests.peer_send('b', format($$select api.archive_trip(%L) ->> 'status'$$, :'k3'));
select ok(tests.peer_blocked('b'), 'archive_trip menunggu set_entries_trip paralel');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), 'archived', 'arsip sesudah set_entries_trip commit = sukses');
select tests.peer_exec('b', 'commit');
select is(pg_temp.k_state(array[:'ke3']::uuid[]) || ' ' || pg_temp.tstate(:'k3'), 'K Tiga|2|false K Tiga/true', 'entri bertanda, trip terarsip');
-- archive_trip (a, belum commit) lalu set_entries_trip (b).
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.archive_trip(%L) ->> 'status'$$, :'k4'));
select tests.peer_exec('b', 'begin');
select tests.peer_exec('b', $$set local lock_timeout = '10s'$$);
select tests.peer_send('b', pg_temp.k_tag_sql(:'k4', array[:'ke4']::uuid[]));
select ok(tests.peer_blocked('b'), 'set_entries_trip menunggu arsip trip paralel');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*trip_archived', 'set_entries_trip sesudah arsip commit = trip_archived');
select tests.peer_exec('b', 'rollback');
select is(pg_temp.k_state(array[:'ke4']::uuid[]), '-|1|false', 'entri tidak ditandai ke trip terarsip');
-- Dua set_entries_trip paralel atas entri yang sama dengan urutan larik terbalik (urut id di dalam fungsi): tanpa deadlock.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.k_tag_sql(:'k5', array[:'ke5', :'ke6']::uuid[]));
select tests.peer_exec('b', 'begin');
select tests.peer_exec('b', $$set local lock_timeout = '10s'$$);
select tests.peer_send('b', pg_temp.k_tag_sql(:'k6', array[:'ke6', :'ke5']::uuid[]));
select ok(tests.peer_blocked('b'), 'dua set_entries_trip paralel pada entri yang sama: yang kedua menunggu kunci entri');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), '2', 'yang kedua membaca keadaan terbaru: mengganti kedua entri dari K Lima ke K Enam');
select tests.peer_exec('b', 'commit');
select is(pg_temp.k_state(array[:'ke5', :'ke6']::uuid[]), 'K Enam|3|false,K Enam|3|false', 'tanda akhir = yang terakhir, versi naik dua kali, tanpa deadlock');
-- set_entries_trip (a) lalu void_entry (b): batal menunggu lalu sukses (entri tetap bertanda, tidak dihitung lagi).
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.k_tag_sql(:'k5', array[:'ke7']::uuid[]));
select tests.peer_exec('b', 'begin');
select tests.peer_exec('b', $$set local lock_timeout = '10s'$$);
select tests.peer_send('b', format($$select api.void_entry(gen_random_uuid(), %L, 2) ->> 'version'$$, :'ke7'));
select ok(tests.peer_blocked('b'), 'void_entry menunggu set_entries_trip paralel pada entri yang sama');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), '3', 'batal sesudah penanda commit = sukses');
select tests.peer_exec('b', 'commit');
select is(pg_temp.k_state(array[:'ke7']::uuid[]), 'K Lima|3|true', 'entri batal tetap bertanda trip');
-- void_entry (a) lalu set_entries_trip (b): penanda menunggu lalu entry_voided.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.void_entry(gen_random_uuid(), %L, 1) ->> 'version'$$, :'ke8'));
select tests.peer_exec('b', 'begin');
select tests.peer_exec('b', $$set local lock_timeout = '10s'$$);
select tests.peer_send('b', pg_temp.k_tag_sql(:'k5', array[:'ke8']::uuid[]));
select ok(tests.peer_blocked('b'), 'set_entries_trip menunggu void_entry paralel pada entri yang sama');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*entry_voided', 'penanda sesudah batal commit = entry_voided');
select tests.peer_exec('b', 'rollback');
select is(pg_temp.k_state(array[:'ke8']::uuid[]), '-|2|true', 'entri batal tidak ditandai');
-- update_entry (a) lalu set_entries_trip (b) pada trip yang sama: b mengunci trip bersama (FOR SHARE kompatibel) lalu menunggu entri.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', pg_temp.k_upd_sql(:'ke9', 1, :'acc_k', :'k5'));
select tests.peer_exec('b', 'begin');
select tests.peer_exec('b', $$set local lock_timeout = '10s'$$);
select tests.peer_send('b', pg_temp.k_tag_sql(:'k5', array[:'ke9', :'ke10']::uuid[]));
select ok(tests.peer_blocked('b'), 'set_entries_trip menunggu kunci entri update_entry paralel (trip yang sama tidak saling menghalangi)');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), '1', 'hanya entri yang belum bertanda berubah (changed 1)');
select tests.peer_exec('b', 'commit');
select is(pg_temp.k_state(array[:'ke9', :'ke10']::uuid[]), 'K Lima|2|false,K Lima|2|false', 'kedua entri bertanda K Lima, tanpa deadlock');
-- create_entry + trip (b) menunggu arsip trip (a, belum commit): kunci FOR SHARE, lalu archived_at dibaca ulang = trip_archived.
select tests.peer_val('adm', format($$select tests.web_val(tests.n(), %L)$$, pg_temp.trip_sql('K Tujuh'))) as k7 \gset
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.archive_trip(%L) ->> 'status'$$, :'k7'));
select tests.peer_exec('b', 'begin');
select tests.peer_exec('b', $$set local lock_timeout = '10s'$$);
select tests.peer_send('b', format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1000, null, null, null, false, false,
  p_trip_id => %L) ->> 'entry_id'$$, :'np', :'acc_k', :'k7'));
select ok(tests.peer_blocked('b'), 'create_entry + trip menunggu arsip trip paralel');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*trip_archived', 'create_entry sesudah arsip commit membaca ulang archived_at = trip_archived');
select tests.peer_exec('b', 'rollback');
select is(tests.worker_val(null, $q$select violations from jobs.dq_reconcile() where check_id = 'DQ20'$q$), '0', 'DQ20 nol sesudah semua skenario paralel');

-- ===== Aset (0141): Perbarui nilai paralel dan transfer keluar paralel di bawah kunci dompet =====
select tests.peer_val('a', format($$select api.create_account(gen_random_uuid(), %L, 'Emas Konkuren', 'aset', 'cash', null, 1000, 'emas')
  ->> 'account_id'$$, :'np')) as emas \gset
-- Dua revalue_asset paralel: yang kedua menunggu kunci dompet, lalu menghitung selisih dari saldo yang baru commit.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.revalue_asset(gen_random_uuid(), %L, 5000)$$, :'emas'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.revalue_asset(gen_random_uuid(), %L, 7000)$$, :'emas'));
select ok(tests.peer_blocked('b'), 'Perbarui nilai kedua menunggu kunci dompet [T11]');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '"delta": 2000', 'selisih dihitung sesudah kunci: 7000 - 5000 [T11]');
select tests.peer_exec('b', 'commit');
select is(tests.balance(:'emas'), 7000::bigint, 'dua Perbarui nilai paralel: nilai akhir = yang terakhir, bukan jumlah selisih [T11]');
-- Valuasi turun paralel transfer keluar: transfer menunggu, lalu asset_negative; saldo aset tidak pernah negatif.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.revalue_asset(gen_random_uuid(), %L, 3000)$$, :'emas'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 6000)$$, :'np', :'emas', :'acc_a'));
select ok(tests.peer_blocked('b'), 'transfer keluar aset menunggu valuasi turun paralel [T11]');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*asset_negative', 'transfer keluar sesudah valuasi turun commit = asset_negative [T11]');
select tests.peer_exec('b', 'rollback');
select is(tests.balance(:'emas'), 3000::bigint, 'saldo aset tetap 3000, tidak pernah negatif [T11]');
-- Transfer keluar lebih dulu, valuasi sesudahnya: selisih dihitung dari saldo sesudah transfer (3000 - 2000 = 1000).
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 2000)$$, :'np', :'emas', :'acc_a'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.revalue_asset(gen_random_uuid(), %L, 4000)$$, :'emas'));
select ok(tests.peer_blocked('b'), 'Perbarui nilai menunggu transfer keluar paralel [T11]');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '"delta": 3000', 'selisih valuasi dihitung dari saldo sesudah transfer [T11]');
select tests.peer_exec('b', 'commit');
select is(tests.balance(:'emas'), 4000::bigint, 'nilai akhir = nilai yang diminta [T11]');

-- ===== Saham (0143): kunci dompet saham menyerialkan semua trade satu dompet =====
select tests.peer_val('a', format($$select api.create_account(gen_random_uuid(), %L, 'Sekuritas Konkuren', 'aset', null, null,
  0, 'saham') ->> 'account_id'$$, :'np')) as sek \gset
select tests.peer_val('a', format($$select api.create_account(gen_random_uuid(), %L, 'Sumber Saham', 'operasional', 'bank',
  null, 1000) ->> 'account_id'$$, :'np')) as src \gset
select tests.peer_val('a', format($$select api.open_stock_holding(gen_random_uuid(), %L, 'BBCA', 100, 1000)$$, :'sek'));
-- Dua jual paralel 60 dari 100 lembar: yang kedua menunggu, lalu insufficient_shares.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.sell_stock(gen_random_uuid(), %L, 'BBCA', 60, 1000, 0, 0, %L)$$, :'sek', :'src'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.sell_stock(gen_random_uuid(), %L, 'BBCA', 60, 1000, 0, 0, %L)$$, :'sek', :'src'));
select ok(tests.peer_blocked('b'), 'jual kedua menunggu kunci dompet saham [T11]');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*insufficient_shares', 'jual kedua = insufficient_shares sesudah yang pertama commit [T11]');
select tests.peer_exec('b', 'rollback');
select is(tests.peer_val('adm', format($$select shares || '/' || cost_total from app.stock_positions where account_id = %L$$, :'sek')),
  '40/40000', 'lembar tidak pernah negatif: 40 lembar, biaya 40.000 [T11]');
select tests.peer_val('adm', format($$select id from app.stock_trades t where t.voided_at is null and t.side = 'sell'
  and t.holding_id = (select id from app.stock_holdings where account_id = %L)$$, :'sek')) as sell1 \gset
-- Batal jual terakhir paralel beli baru: batal menunggu beli, lalu trade_not_latest.
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.buy_stock(gen_random_uuid(), %L, 'BBCA', 1, 100, 0, %L)$$, :'sek', :'src'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.void_stock_trade(gen_random_uuid(), %L)$$, :'sell1'));
select ok(tests.peer_blocked('b'), 'batal trade menunggu beli paralel pada dompet saham yang sama [T11]');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*trade_not_latest', 'batal sesudah beli baru commit = trade_not_latest [T11]');
select tests.peer_exec('b', 'rollback');
-- Urutan sebaliknya: batal beli terakhir lebih dulu, beli baru menunggu lalu berhasil.
select tests.peer_val('adm', format($$select id from app.stock_trades t where t.voided_at is null and t.side = 'buy'
  and t.holding_id = (select id from app.stock_holdings where account_id = %L)$$, :'sek')) as buy1 \gset
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.void_stock_trade(gen_random_uuid(), %L)$$, :'buy1'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.buy_stock(gen_random_uuid(), %L, 'BBCA', 2, 100, 0, %L) ->> 'amount'$$, :'sek', :'src'));
select ok(tests.peer_blocked('b'), 'beli menunggu batal paralel [T11]');
select tests.peer_exec('a', 'commit');
select is(tests.peer_result('b'), '200', 'beli sesudah batal commit berhasil [T11]');
select tests.peer_exec('b', 'commit');
select is(tests.peer_val('adm', format($$select shares || '/' || cost_total from app.stock_positions where account_id = %L$$, :'sek'))
  || ' ' || tests.peer_val('adm', 'select violations from jobs.dq_reconcile() where check_id = ''DQ18'''),
  '42/40200 0', 'posisi akhir konsisten, DQ18 nol [T11]');
-- Dua beli paralel dari dompet sumber yang sama (saldo cukup untuk satu): yang kedua menunggu, lalu saldo_negatif.
select tests.peer_val('adm', format($$select balance from app.account_balances where account_id = %L$$, :'src')) as src_bal \gset
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.buy_stock(gen_random_uuid(), %L, 'TLKM', 1, %s, 0, %L)$$, :'sek',
  :'src_bal'::bigint - 100, :'src'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.buy_stock(gen_random_uuid(), %L, 'TLKM', 1, %s, 0, %L)$$, :'sek',
  :'src_bal'::bigint - 100, :'src'));
select ok(tests.peer_blocked('b'), 'beli kedua menunggu kunci dompet sumber [T11]');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*saldo_negatif', 'beli kedua = saldo_negatif (saldo dibaca sesudah kunci) [T11]');
select tests.peer_exec('b', 'rollback');
select is(tests.peer_val('adm', format($$select balance from app.account_balances where account_id = %L$$, :'src')), '100',
  'dompet sumber tidak pernah minus [T11]');
-- Jalur generik atas entri trade ditolak SEBELUM kunci entri (trade mengunci dompet -> entri; generik entri -> dompet).
-- adm memegang entri trade; tiap fungsi generik (lock_timeout 2 detik) harus langsung stock_account_trade_only.
select tests.peer_val('adm', format($$select e.id from app.entries e join app.stock_trades t on t.id = e.stock_trade_id
  join app.stock_holdings h on h.id = t.holding_id where h.account_id = %L and h.ticker = 'TLKM' and t.voided_at is null$$,
  :'sek')) as tlkm_e \gset
select tests.peer_val('adm', format($$select stock_trade_id from app.entries where id = %L$$, :'tlkm_e')) as tlkm_t \gset
select tests.peer_val('adm', format($$select e.id from app.entries e join app.stock_trades t on t.id = e.stock_trade_id
  where t.side = 'opening' and t.holding_id = (select id from app.stock_holdings where account_id = %L and ticker = 'BBCA')$$,
  :'sek')) as open_e \gset
select tests.peer_val('adm', format($$select id from app.entries where stock_trade_id = %L$$, :'buy1')) as buy1_e \gset
create function pg_temp.generik(p_sql text) returns text
language plpgsql as $$
declare v text;
begin
  perform tests.peer_exec('a', 'begin');
  perform tests.peer_exec('a', 'set local lock_timeout = ''2s''');
  perform tests.peer_send('a', p_sql);
  v := tests.peer_result('a');
  perform tests.peer_exec('a', 'rollback');
  return v;
end $$;
select tests.peer_exec('adm', 'begin');
select tests.peer_val('adm', format($$select string_agg(id::text, ',') from (select id from app.entries
  where id in (%L, %L, %L) for update) x$$, :'tlkm_e', :'open_e', :'buy1_e'));
select matches(pg_temp.generik(format($$select api.void_entry(gen_random_uuid(), %1$L, (select version from app.entries
  where id = %1$L))$$, :'tlkm_e')), '^ERROR: .*stock_account_trade_only',
  'batal generik entri trade ditolak tanpa menunggu kunci [T11]');
select matches(pg_temp.generik(format($$select api.update_entry(gen_random_uuid(), %1$L, (select version from app.entries
  where id = %1$L), %2$L, 5, null, null, null, false)$$, :'open_e', :'sek')), '^ERROR: .*stock_account_trade_only',
  'ubah generik saldo awal saham ditolak tanpa menunggu kunci [T11]');
select matches(pg_temp.generik(format($$select api.move_entry_to_space(gen_random_uuid(), %1$L, (select version from app.entries
  where id = %1$L), %2$L, %3$L, null)$$, :'tlkm_e', :'sh', :'acc_s')), '^ERROR: .*stock_account_trade_only',
  'pindah ruang generik entri trade ditolak tanpa menunggu kunci [T11]');
select matches(pg_temp.generik(format($$select api.restore_entry(gen_random_uuid(), %1$L, (select version from app.entries
  where id = %1$L))$$, :'buy1_e')), '^ERROR: .*stock_account_trade_only',
  'pulihkan generik entri trade ditolak tanpa menunggu kunci [T11]');
select matches(pg_temp.generik(format($$select api.purge_entry(%1$L, (select version from app.entries where id = %1$L))$$,
  :'buy1_e')), '^ERROR: .*stock_account_trade_only', 'hapus permanen generik entri trade ditolak tanpa menunggu kunci [T11]');
select tests.peer_exec('adm', 'commit');
-- Reproduksi review: adm memegang entri E, a = void_entry(E), b = void_stock_trade(trade E). Dulu a menunggu E lalu
-- dompet sementara b memegang dompet dan menunggu E (40P01, korban bisa batal trade yang sah). Kini a ditolak dulu.
select tests.peer_exec('adm', 'begin');
select tests.peer_val('adm', format($$select id from app.entries where id = %L for update$$, :'tlkm_e'));
select tests.peer_exec('a', 'begin');
select tests.peer_exec('a', 'set local lock_timeout = ''2s''');
select tests.peer_send('a', format($$select api.void_entry(gen_random_uuid(), %1$L, (select version from app.entries
  where id = %1$L))$$, :'tlkm_e'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.void_stock_trade(gen_random_uuid(), %L) ->> 'trade_id'$$, :'tlkm_t'));
select ok(tests.peer_blocked('b'), 'batal trade menunggu kunci entri yang dipegang adm [T11]');
select matches(tests.peer_result('a'), '^ERROR: .*stock_account_trade_only', 'batal generik paralel ditolak tanpa menunggu [T11]');
select tests.peer_exec('a', 'rollback');
select tests.peer_exec('adm', 'commit');
select is(tests.peer_result('b'), :'tlkm_t', 'batal trade yang sah selesai tanpa deadlock [T11]');
select tests.peer_exec('b', 'commit');
select is(tests.peer_val('adm', format($$select (voided_at is not null)::text from app.stock_trades where id = %L$$, :'tlkm_t')),
  'true', 'trade batal tepat sekali [T11]');
-- archive_account paralel buy_stock pada dompet saham (kedua urutan; kunci dompet saham).
select tests.peer_val('a', format($$select api.create_account(gen_random_uuid(), %L, 'Sekuritas Arsip A', 'aset', null, null,
  0, 'saham') ->> 'account_id'$$, :'np')) as sek_a \gset
select tests.peer_val('a', format($$select api.create_account(gen_random_uuid(), %L, 'Sekuritas Arsip B', 'aset', null, null,
  0, 'saham') ->> 'account_id'$$, :'np')) as sek_b \gset
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.buy_stock(gen_random_uuid(), %L, 'ASII', 1, 10, 0, %L)$$, :'sek_a', :'src'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.archive_account(%L)$$, :'sek_a'));
select ok(tests.peer_blocked('b'), 'arsip menunggu beli paralel pada dompet saham [T11]');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*account_has_holdings', 'arsip sesudah beli commit = account_has_holdings [T11]');
select tests.peer_exec('b', 'rollback');
select tests.peer_exec('a', 'begin');
select tests.peer_val('a', format($$select api.archive_account(%L)$$, :'sek_b'));
select tests.peer_exec('b', 'begin');
select tests.peer_send('b', format($$select api.buy_stock(gen_random_uuid(), %L, 'ASII', 1, 10, 0, %L)$$, :'sek_b', :'src'));
select ok(tests.peer_blocked('b'), 'beli menunggu arsip paralel dompet saham [T11]');
select tests.peer_exec('a', 'commit');
select matches(tests.peer_result('b'), '^ERROR: .*account_archived', 'beli sesudah arsip commit = account_archived [T11]');
select tests.peer_exec('b', 'rollback');
select is(tests.peer_val('adm', format($$select (select archived_at is null from app.accounts where id = %L) || '/'
  || (select archived_at is not null from app.accounts where id = %L) || '/'
  || (select count(*) from app.stock_holdings h join app.accounts a on a.id = h.account_id
       where a.archived_at is not null and h.account_id in (%L, %L))$$, :'sek_a', :'sek_b', :'sek_a', :'sek_b')),
  'true/true/0', 'tidak pernah lembar di dompet saham terarsip [T11]');

select tests.peer_close('ka');
select tests.peer_close('kb');
select tests.peer_close('a');
select tests.peer_close('b');
select tests.peer_val('adm', 'select tests.wipe()');
select tests.peer_close('adm');

select * from finish();
rollback;
