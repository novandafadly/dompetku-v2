-- Batal, pulihkan, Sampah, purge (BSD §9, §10, §13 #30 sampai #32; keputusan pemilik #8, #10):
-- void/restore termasuk kedua kaki space_transfer, jendela 90 hari, dompet terarsip, purge_entry
-- dan jobs.purge_voided (tombstone tanpa nominal), entri yang dipindah ke ruang lain (S7, 0111),
-- purge_idempotency, append-only entry_history,
-- dq_reconcile nol temuan. Jam dipatok 2026-03-20 WIB lalu dimajukan.
begin;
select plan(64);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 1000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 300000, '2026-01-01') as kas \gset

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
create function pg_temp.spend(p_acc uuid, p_kind text, p_amount bigint) returns uuid
language sql as $$
  select (pg_temp.call(tests.n(), format(
    $q$select api.create_entry(gen_random_uuid(), (select space_id from app.accounts where id = %L), %L, %L, %s)$q$,
    p_acc, p_acc, p_kind, p_amount)) ->> 'entry_id')::uuid
$$;
create function pg_temp.void(p_entry uuid, p_version int, p_allow boolean default false) returns jsonb
language sql as $$
  select pg_temp.call(tests.n(), format($q$select api.void_entry(gen_random_uuid(), %L, %s, %L)$q$,
    p_entry, p_version, p_allow))
$$;
create function pg_temp.restore(p_entry uuid, p_version int) returns jsonb
language sql as $$
  select pg_temp.call(tests.n(), format($q$select api.restore_entry(gen_random_uuid(), %L, %s)$q$, p_entry, p_version))
$$;

-- ===== Batal dan pulihkan entri biasa =====
select pg_temp.spend(:'bca', 'expense', 100000) as e \gset
select is(pg_temp.void(:'e', 1) ->> 'version', '2', 'void menaikkan versi');
select is(tests.balance(:'bca'), 1000000::bigint, 'void mengembalikan saldo');
select is(tests.owner_val(null, format($$select string_agg(op || ':' || version, ',' order by version) from app.entry_history where entry_id = %L$$, :'e')),
  'create:1,void:2', 'void menulis riwayat');
select is(tests.owner_val(null, format($$select (voided_at = app.now() and voided_by = %L)::text from app.entries where id = %L$$, tests.n(), :'e')),
  'true', 'voided_at = app.now(), voided_by = pemanggil');
select throws_ok(format($$select pg_temp.void(%L, 2)$$, :'e'), 'DK422', 'already_voided', 'void dua kali ditolak');
select throws_ok(format($$select pg_temp.void(%L, 1)$$, :'e'), 'DK409', 'version_conflict', 'void versi lama = DK409');
select is(tests.web_val(tests.n(), format($$select count(*) || ' ' || min(amount) || ' ' || (min(purge_after) = min(voided_at) + interval '90 days')
  from api.trash_list(%L)$$, :'np')), '1 100000 true', 'Sampah: entri batal, nominal, batas purge 90 hari');
select is(pg_temp.restore(:'e', 2) ->> 'version', '3', 'pulihkan menaikkan versi');
select is(tests.balance(:'bca'), 900000::bigint, 'pulihkan mengembalikan efek saldo');
select throws_ok(format($$select pg_temp.restore(%L, 3)$$, :'e'), 'DK422', 'not_voided', 'pulihkan entri hidup ditolak');
select is(tests.web_val(tests.n(), format($$select count(*) from api.trash_list(%L)$$, :'np')), '0', 'Sampah kosong setelah dipulihkan');
select is(tests.web_val(tests.n(), format($$select api.void_entry('bbbbbbbb-0000-0000-0000-000000000001', %L, 3) ->> 'version'$$, :'e')),
  '4', 'void dengan client_id');
select is(tests.web_val(tests.n(), format($$select api.void_entry('bbbbbbbb-0000-0000-0000-000000000001', %L, 3) ->> 'replayed'$$, :'e')),
  'true', 'void diulang (klik ganda) = replay, tanpa DK409');

-- Void yang menurunkan saldo dijaga saldo_negatif.
select tests.account(tests.n(), :'np', 'X', 'operasional', 0, '2026-01-01') as x \gset
select pg_temp.spend(:'x', 'income', 500000) as inc \gset
select pg_temp.spend(:'x', 'expense', 400000) as exp_x \gset
select throws_ok(format($$select pg_temp.void(%L, 1)$$, :'inc'), 'DK422', 'saldo_negatif', 'void pemasukan yang membuat saldo negatif ditolak');
select is(tests.balance(:'x'), 100000::bigint, 'penolakan tanpa efek');
select is(pg_temp.void(:'inc', 1, true) ->> 'version', '2', 'void dengan p_allow_negative');
select is(tests.balance(:'x'), -400000::bigint, 'saldo negatif sesudah konfirmasi');

-- ===== Pasangan space_transfer: void dan pulihkan bersama =====
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 50000, 1000)$$,
  :'np', :'bca', :'kas')) as st \gset
select is(jsonb_array_length(pg_temp.void(((:'st')::jsonb ->> 'entry_id')::uuid, 1) -> 'affected'), 2, 'void satu kaki membatalkan dua kaki');
select is(tests.owner_val(null, format($$select string_agg(version || ':' || (voided_at is not null), ',') from app.entries where link_id = %L$$,
  (:'st')::jsonb ->> 'link_id')), '2:true,2:true', 'kedua kaki batal, versi naik bersama');
select is(tests.balance(:'bca') || ' ' || tests.balance(:'kas'), '1000000 300000', 'saldo kedua ruang kembali');
select is(tests.owner_val(null, format($$select count(*) from app.entry_history h join app.entries e on e.id = h.entry_id
  where e.link_id = %L and h.op = 'void'$$, (:'st')::jsonb ->> 'link_id')), '2', 'riwayat void di kedua kaki');
select is(jsonb_array_length(pg_temp.restore(((:'st')::jsonb ->> 'linked_entry_id')::uuid, 2) -> 'affected'), 2,
  'pulihkan lewat kaki in memulihkan dua kaki');
select is(tests.balance(:'bca') || ' ' || tests.balance(:'kas'), '949000 350000', 'pasangan hidup lagi (fee ikut)');
select is(tests.owner_val(null, format($$select string_agg(distinct version::text, ',') from app.entries where link_id = %L$$,
  (:'st')::jsonb ->> 'link_id')), '3', 'versi kedua kaki tetap seragam');

-- ===== Dompet terarsip (saldo harus tetap 0) =====
select tests.account(tests.n(), :'np', 'Z', 'operasional', 0, '2026-01-01') as z \gset
select pg_temp.spend(:'z', 'income', 100) as zi \gset
select pg_temp.spend(:'z', 'expense', 100) as ze \gset
select pg_temp.call(tests.n(), format($$select api.archive_account(%L)$$, :'z'));
select throws_ok(format($$select pg_temp.void(%L, 1, true)$$, :'zi'), 'DK422', 'account_archived', 'void entri di dompet terarsip ditolak');
select pg_temp.spend(:'bca', 'expense', 7) as e7 \gset
select pg_temp.void(:'e7', 1);

-- ===== Talangan yang sudah diganti (dependents) =====
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 20000, null, null, 'talangan', true)$$,
  :'np', :'bca')) ->> 'entry_id' as tal \gset
select tests.owner_exec(null, format($f$do $d$
  declare v uuid;
  begin
    set constraints all deferred;  -- fungsi api.* sebelumnya menutup dengan "immediate"
    insert into app.entries (space_id, space_kind, kind, occurred_on, reimburses_entry_id, created_by, updated_by)
    values (%L, 'personal', 'reimbursement', '2026-03-20', %L, %L, %L) returning id into v;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount) values (v, %L, 'main', %L, 20000);
    insert into app.entry_history (entry_id, space_id, version, op, snapshot, changed_by)
    values (v, %L, 1, 'create', '{}', %L);
    set constraints all immediate;
  end $d$$f$, :'np', :'tal', tests.n(), tests.n(), :'np', :'bca', :'np', tests.n()));
select throws_ok(format($$select pg_temp.void(%L, 1)$$, :'tal'), 'DK422', 'has_dependents', 'talangan yang sudah diganti tidak bisa dibatalkan');

-- expected_version NULL selalu DK400 (review S5: dulu lolos karena version <> NULL = NULL).
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), q), 'DK400', 'invalid_argument',
  t || ' tanpa expected_version = DK400')
from (values
  ('update_entry', format($q$select api.update_entry(gen_random_uuid(), %L, null, %L, 1, null, null, null, false)$q$, :'e7', :'bca')),
  ('void_entry', format($q$select api.void_entry(gen_random_uuid(), %L, null)$q$, :'tal')),
  ('purge_entry', format($q$select api.purge_entry(%L, null)$q$, :'e7'))
) v (t, q);

-- ===== purge_entry (Sampah: hapus permanen) =====
select pg_temp.spend(:'bca', 'expense', 3000) as p \gset
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format($q$select api.purge_entry(%L, 1)$q$, :'p')),
  'DK422', 'not_voided', 'purge entri hidup ditolak');
select pg_temp.void(:'p', 1);
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format($q$select api.purge_entry(%L, 1)$q$, :'p')),
  'DK409', 'version_conflict', 'purge versi lama = DK409');
select is(pg_temp.call(tests.n(), format($$select api.purge_entry(%L, 2)$$, :'p')) ->> 'purged', '1', 'purge entri batal');
select is(tests.owner_val(null, format($$select (select count(*) from app.entries where id = %1$L) || ' '
  || (select count(*) from app.entry_lines where entry_id = %1$L) || ' '
  || (select count(*) from app.entry_history where entry_id = %1$L)$$, :'p')), '0 0 0', 'entri, lines, riwayat hilang');
select is(tests.web_val(tests.n(), format($$select kind || ' ' || occurred_on || ' ' || (voided_by = %L) from app.entry_tombstones where entry_id = %L$$,
  tests.n(), :'p')), 'expense 2026-03-20 true', 'tombstone terlihat pemilik ruang');
select is(tests.owner_val(null, $$select string_agg(attname, ',' order by attnum) from pg_attribute
  where attrelid = 'app.entry_tombstones'::regclass and attnum > 0 and not attisdropped$$),
  'entry_id,link_id,space_id,kind,occurred_on,voided_at,voided_by,purged_at',
  'tombstone tanpa nominal dan deskripsi');
select is(tests.owner_val(null, $$select user_id || ' ' || (meta ->> 'count') from audit.events where event = 'entry_purged'$$),
  tests.n() || ' 1', 'audit entry_purged dengan pelaku dan jumlah, tanpa nominal');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format($q$select api.purge_entry(%L, 2)$q$, :'p')),
  'DK404', 'entry_not_found', 'purge kedua kali = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format($q$select api.purge_entry(%L, 1)$q$, :'tal')),
  'DK422', 'not_voided', 'talangan hidup tidak bisa dipurge');

-- Pasangan dipurge berdua lewat kaki mana pun.
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 1000)$$,
  :'np', :'bca', :'kas')) as st2 \gset
select pg_temp.void(((:'st2')::jsonb ->> 'entry_id')::uuid, 1);
select is(pg_temp.call(tests.n(), format($$select api.purge_entry(%L, 2)$$, (:'st2')::jsonb ->> 'linked_entry_id')) ->> 'purged', '2',
  'purge kaki in memurge pasangan');
select is(tests.owner_val(null, format($$select count(*) || ' ' || count(distinct space_id) from app.entry_tombstones where link_id = %L$$,
  (:'st2')::jsonb ->> 'link_id')), '2 2', 'dua tombstone, link_id sama, dua ruang');

-- ===== Jendela 90 hari dan jobs.purge_voided =====
select pg_temp.spend(:'bca', 'expense', 11) as old1 \gset
select pg_temp.void(:'old1', 1);
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 500)$$,
  :'np', :'bca', :'kas')) as st3 \gset
select pg_temp.void(((:'st3')::jsonb ->> 'entry_id')::uuid, 1);
select tests.clock_at('2026-05-30 10:00+07');  -- +71 hari
select pg_temp.spend(:'bca', 'expense', 12) as new1 \gset
select pg_temp.void(:'new1', 1);
select is(tests.web_val(tests.n(), format($$select count(*) from api.trash_list(%L) where entry_id = %L$$, :'np', :'old1')), '1',
  'hari ke-71: masih di Sampah');
select tests.clock_at('2026-06-19 10:00+07');  -- +91 hari
select throws_ok(format($$select pg_temp.restore(%L, 2)$$, :'old1'), 'DK422', 'restore_window_closed', 'pulihkan setelah 90 hari ditolak');
select is(tests.web_val(tests.n(), format($$select count(*) from api.trash_list(%L) where entry_id = %L$$, :'np', :'old1')), '0',
  'Sampah menyembunyikan entri > 90 hari');
select throws_ok($$select tests.web_val(tests.n(), 'select jobs.purge_voided()')$$, '42501', null, 'web tidak bisa menjalankan job');
select is(tests.owner_val(null, $$select count(*) from app.entries where voided_at < app.now() - interval '90 days'$$), '6',
  'sebelum job: 6 entri batal > 90 hari (4 tunggal + 2 kaki)');
select is(tests.worker_val(null, 'select jobs.purge_voided()'), '6', 'purge_voided: 4 tunggal + 2 kaki pasangan');
select is(tests.owner_val(null, format($$select count(*) from app.entries where id = %L$$, :'tal')), '1',
  'talangan yang dirujuk reimbursement tidak dipurge');
select is(tests.owner_val(null, format($$select count(*) from app.entries where id in (%L, %L)$$, :'old1', :'new1')), '1',
  'entri batal > 90 hari dipurge, yang baru tetap');
select is(tests.owner_val(null, format($$select count(*) from app.entry_tombstones where link_id = %L$$, (:'st3')::jsonb ->> 'link_id')), '2',
  'pasangan dipurge berdua');
select is(tests.owner_val(null, $$select coalesce(user_id::text, 'null') || ' ' || (meta ->> 'count') from audit.events where event = 'purge_voided'$$),
  'null 6', 'audit purge_voided tanpa pelaku user');
select is(tests.worker_val(null, 'select jobs.purge_voided()'), '0', 'purge_voided idempoten');

-- ===== Entri yang dipindah ke ruang lain (S7, 0111) =====
-- Sampah hanya menyembunyikan entri yang dipindah; batal biasa tetap tampil. Hapus permanen
-- lewat api.purge_entry tetap boleh (tombstone biasa), entri baru di ruang tujuan tidak tersentuh.
select pg_temp.spend(:'bca', 'expense', 21) as mv_biasa \gset
select pg_temp.void(:'mv_biasa', 1);
select pg_temp.spend(:'bca', 'expense', 22) as mv \gset
select pg_temp.call(tests.n(), format($$select api.move_entry_to_space(gen_random_uuid(), %L, 1, %L, %L, null)$$,
  :'mv', :'sh', :'kas')) ->> 'entry_id' as mv_baru \gset
select is(tests.web_val(tests.n(), format($$select (select count(*) from api.trash_list(%1$L) where entry_id = %2$L) || ' '
  || (select count(*) from api.trash_list(%1$L) where entry_id = %3$L)$$, :'np', :'mv_biasa', :'mv')), '1 0',
  'Sampah: batal biasa tampil, entri yang dipindah tidak');
select is(pg_temp.call(tests.n(), format($$select api.purge_entry(%L, 2)$$, :'mv')) ->> 'purged', '1',
  'purge_entry entri yang dipindah = hapus permanen biasa');
select is(tests.owner_val(null, format($$select (select count(*) from app.entry_tombstones where entry_id = %L) || ' '
  || (select count(*) from app.entries where id = %L and voided_at is null)$$, :'mv', :'mv_baru')), '1 1',
  'tombstone asal ada, entri baru di Bersama tetap hidup');

-- ===== purge_idempotency (30 hari) =====
select ok(tests.owner_val(null, 'select count(*) from app.idempotency_keys')::int > 0, 'ada kunci idempotensi');
select tests.clock('31 days');
select ok(tests.worker_val(null, 'select jobs.purge_idempotency()')::int > 0, 'purge_idempotency menghapus kunci > 30 hari');
select is(tests.owner_val(null, 'select count(*) from app.idempotency_keys'), '0', 'kunci lama habis');
select tests.clock_at('2026-06-19 10:00+07');

-- ===== entry_history append-only, juga untuk owner (BSD §13 #32) =====
select throws_ok(format($$select tests.owner_exec(null, %L)$$, q), 'DK422', 'append_only', 'entry_history: ' || t || ' ditolak')
from (values ('UPDATE', 'update app.entry_history set via = ''cli'''),
             ('DELETE', 'delete from app.entry_history'),
             ('TRUNCATE', 'truncate app.entry_history')) v (t, q);
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format('delete from app.entries where id = %L', :'zi')),
  'DK422', 'append_only', 'hapus entri di luar fungsi purge ditolak (cascade riwayat)');

-- ===== Cek kualitas data: nol temuan sesudah semua operasi =====
-- DQ07 (warn) = 1: dompet "X" sengaja dibuat negatif dengan p_allow_negative di atas dan masih
-- negatif lebih dari 3 hari WIB. Cek error tetap nol.
select is(tests.worker_val(null, $$select string_agg(check_id || '=' || violations, ',' order by check_id) from jobs.dq_reconcile()$$),
  'DQ01=0,DQ03=0,DQ04=0,DQ04b=0,DQ05=0,DQ06=0,DQ07=1,DQ09=0,DQ10=0,DQ11=0,DQ12=0,DQ13=0,DQ14=0,DQ15=0,DQ16=0', 'dq_reconcile: nol temuan error, DQ07 warn untuk dompet negatif');
select throws_ok($$select tests.web_val(tests.n(), 'select count(*) from jobs.dq_reconcile()')$$, '42501', null,
  'web tidak bisa menjalankan dq_reconcile');
select throws_ok($$select tests.worker_val(null, 'select count(*) from private.dq_run()')$$, '42501', null,
  'worker tidak bisa memanggil dq_run langsung');

select * from finish();
rollback;
