-- Talangan dan reimburse (S7, 0110; BSD §2.2 butir 1, §7 bentuk reimbursement, §8.1 kelas
-- x_talangan/x_reimburse/x_kantor, §9): api.create_reimbursement (sebagian, batas nominal,
-- idempotensi), api.open_reimbursables (sisa > 0, urut tanggal lalu id), cek reimbursement_exists
-- dan batas nominal di api.update_entry, void/pulihkan reimburse dan talangan, angka ringkasan
-- Pribadi tidak berubah oleh talangan maupun reimburse, isolasi ruang.
-- Semua lewat api.* sebagai role web; jam dipatok 2026-03-20 WIB.
begin;
select plan(67);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

select tests.account(tests.n(), :'np', 'BCA', 'operasional', 2000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Dana', 'operasional', 0, '2026-03-10') as dana,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 1000000, '2026-01-01') as kan,
       tests.account(tests.n(), :'np', 'Lama', 'operasional', 0, '2026-01-01') as lama,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 300000, '2026-01-01') as kas,
       tests.account(tests.f(), :'fp', 'BCA Farida', 'operasional', 400000, '2026-01-01') as fbca \gset
select tests.web_val(tests.n(), format($$select api.archive_account(%L)$$, :'lama'));

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
create function pg_temp.talangan(p_uid uuid, p_acc uuid, p_amount bigint, p_on date default null,
  p_desc text default null) returns uuid
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.create_entry(gen_random_uuid(), (select space_id from app.accounts where id = %L),
         %L, 'expense', %s, null, %L::date, %L, true) ->> 'entry_id'$q$,
    p_acc, p_acc, p_amount, p_on, p_desc))::uuid
$$;
-- create_reimbursement dengan client_id baru; kembalikan hasil jsonb.
create function pg_temp.reimb(p_uid uuid, p_entry uuid, p_acc uuid, p_amount bigint,
  p_on date default null, p_desc text default null) returns jsonb
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.create_reimbursement(gen_random_uuid(), %L, %L, %s, %L::date, %L)$q$,
    p_entry, p_acc, p_amount, p_on, p_desc))::jsonb
$$;
create function pg_temp.open_list(p_uid uuid, p_space uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select coalesce(string_agg(entry_id || ':' || amount || ':' || reimbursed || ':' || remaining, ','
                                  order by occurred_on, entry_id), '-')
       from api.open_reimbursables(%L)$q$, p_space))
$$;
create function pg_temp.version(p_entry uuid) returns int
language sql as $$
  select tests.owner_val(null, format($q$select version from app.entries where id = %L$q$, p_entry))::int
$$;
create function pg_temp.pengeluaran(p_space uuid) returns text
language sql as $$
  select tests.web_val(tests.n(), format(
    $q$select pengeluaran || '/' || pemasukan from api.month_summary(%L, '2026-03-01')$q$, p_space))
$$;

-- ===== Talangan dan daftar talangan terbuka =====
select is(pg_temp.pengeluaran(:'np'), '0/0', 'Maret Pribadi awal: tanpa pengeluaran/pemasukan');
select pg_temp.talangan(tests.n(), :'bca', 500000, '2026-03-12', 'hotel dinas') as t1 \gset
select is(pg_temp.open_list(tests.n(), :'np'), :'t1' || ':500000:0:500000', 'talangan 500000 = sisa 500000');
select is(tests.web_val(tests.n(), format($$select row(occurred_on, description, account_id)::text
  from api.open_reimbursables(%L)$$, :'np')), format('(2026-03-12,"hotel dinas",%s)', :'bca'),
  'daftar memuat tanggal, deskripsi, dan dompet talangan');
select is(pg_temp.pengeluaran(:'np'), '0/0', 'talangan tidak mengubah pengeluaran/pemasukan Pribadi');

-- Talangan kedua (lebih awal) dan pengeluaran biasa: daftar urut tanggal, pengeluaran biasa tidak ikut.
select pg_temp.talangan(tests.n(), :'bca', 70000, '2026-03-05') as t2 \gset
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 15000)$$,
  :'np', :'bca')) ->> 'entry_id' as biasa \gset
select is(pg_temp.open_list(tests.n(), :'np'),
  :'t2' || ':70000:0:70000,' || :'t1' || ':500000:0:500000', 'daftar urut occurred_on, tanpa pengeluaran biasa');

-- ===== Reimburse sebagian =====
select pg_temp.reimb(tests.n(), :'t1', :'bca', 300000, '2026-03-15', 'transfer kantor') as r1 \gset
select is((:'r1'::jsonb) ->> 'remaining', '200000', 'reimburse 300000: remaining = 200000');
select is((:'r1'::jsonb) - 'entry_id', '{"version": 1, "replayed": false, "warnings": [], "remaining": 200000}'::jsonb,
  'hasil create_reimbursement: version 1, replayed false, warnings kosong');
select is(tests.owner_val(null, format($$select e.kind || ' ' || e.space_kind || ' ' || e.reimburses_entry_id || ' '
    || e.occurred_on || ' ' || e.description || ' ' || coalesce(e.category_id::text, '-') || ' ' || e.reimbursable
  from app.entries e where e.id = %L$$, (:'r1'::jsonb) ->> 'entry_id')),
  'reimbursement personal ' || :'t1' || ' 2026-03-15 transfer kantor - false',
  'entri reimbursement menunjuk talangan, tanpa kategori');
select is(tests.owner_val(null, format($$select string_agg(role || '=' || amount || '@' || account_id, ',')
  from app.entry_lines where entry_id = %L$$, (:'r1'::jsonb) ->> 'entry_id')), 'main=300000@' || :'bca',
  'satu line main +nominal di dompet tujuan');
select is(tests.owner_val(null, format($$select string_agg(op || ':' || version, ',') from app.entry_history where entry_id = %L$$,
  (:'r1'::jsonb) ->> 'entry_id')), 'create:1', 'reimburse menulis riwayat create');
select is(tests.balance(:'bca'), 2000000 - 500000 - 70000 - 15000 + 300000::bigint, 'saldo BCA naik sebesar reimburse');
select is(pg_temp.open_list(tests.n(), :'np'),
  :'t2' || ':70000:0:70000,' || :'t1' || ':500000:300000:200000', 'sisa talangan 200000 sesudah reimburse pertama');
select is(pg_temp.pengeluaran(:'np'), '15000/0', 'reimburse tidak mengubah pengeluaran/pemasukan Pribadi (hanya pengeluaran biasa)');
select is(tests.web_val(tests.n(), format($$select inflow || ' ' || entry_count
  from api.period_summary(%L, '2026-03-01', '2026-03-31') where report_class = 'x_reimburse'$$, :'np')),
  '300000 1', 'period_summary: reimburse di kelas x_reimburse');
select is(tests.web_val(tests.n(), format($$select outflow from api.period_summary(%L, '2026-03-01', '2026-03-31')
  where report_class = 'expense'$$, :'np')), '15000', 'period_summary: pengeluaran = hanya pengeluaran biasa');

-- Reimburse kedua ke dompet lain di ruang talangan: sisa 0, talangan hilang dari daftar.
select pg_temp.reimb(tests.n(), :'t1', :'dana', 200000) as r2 \gset
select is((:'r2'::jsonb) ->> 'remaining', '0', 'reimburse 200000: remaining = 0');
select is(tests.owner_val(null, format($$select occurred_on::text || ' ' || coalesce(description, '-')
  from app.entries where id = %L$$, (:'r2'::jsonb) ->> 'entry_id')), '2026-03-20 -',
  'tanggal bawaan = app.today(), deskripsi boleh kosong');
select is(pg_temp.open_list(tests.n(), :'np'), :'t2' || ':70000:0:70000', 'talangan lunas hilang dari daftar');
select throws_ok(format($$select pg_temp.reimb(tests.n(), %L, %L, 1)$$, :'t1', :'bca'),
  'DK422', 'reimbursement_exceeds', 'reimburse 1 sesudah lunas ditolak');
select throws_ok(format($$select pg_temp.reimb(tests.n(), %L, %L, 70001)$$, :'t2', :'bca'),
  'DK422', 'reimbursement_exceeds', 'reimburse melebihi nominal talangan ditolak');
select is(pg_temp.reimb(tests.n(), :'t2', :'bca', 70000) ->> 'remaining', '0', 'reimburse sekali penuh boleh');
select is(pg_temp.open_list(tests.n(), :'np'), '-', 'daftar kosong bila semua talangan lunas');

-- ===== Void dan pulihkan =====
select lives_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.void_entry(gen_random_uuid(), %L, 1)$q$, (:'r2'::jsonb) ->> 'entry_id')),
  'reimburse kedua bisa dibatalkan');
select is(pg_temp.open_list(tests.n(), :'np'), :'t1' || ':500000:300000:200000',
  'batal reimburse kedua: sisa 200000 kembali');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.void_entry(gen_random_uuid(), %L, %s)$q$, :'t1', pg_temp.version(:'t1'))),
  'DK422', 'has_dependents', 'void talangan dengan reimburse hidup ditolak');

-- Pulihkan reimburse: hanya bila talangan masih hidup, reimbursable, dan Σ tidak melebihi nominal.
select pg_temp.reimb(tests.n(), :'t1', :'bca', 150000) as r3 \gset
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.restore_entry(gen_random_uuid(), %L, 2)$q$, (:'r2'::jsonb) ->> 'entry_id')),
  'DK422', 'reimbursement_exceeds', 'pulihkan reimburse yang membuat Σ > nominal ditolak');
select lives_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.void_entry(gen_random_uuid(), %L, 1)$q$, (:'r3'::jsonb) ->> 'entry_id')),
  'reimburse ketiga dibatalkan');
select lives_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.restore_entry(gen_random_uuid(), %L, 2)$q$, (:'r2'::jsonb) ->> 'entry_id')),
  'pulihkan reimburse kedua dalam batas nominal boleh');
select is(pg_temp.open_list(tests.n(), :'np'), '-', 'sesudah pulih: talangan lunas lagi');

-- ===== "Tidak diganti" (update_entry p_reimbursable => false) =====
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.update_entry(gen_random_uuid(), %L, %s, %L, 500000, null, null, 'hotel dinas', false)$q$,
    :'t1', pg_temp.version(:'t1'), :'bca')),
  'DK422', 'reimbursement_exists', 'Tidak diganti pada talangan dengan reimburse hidup ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.update_entry(gen_random_uuid(), %L, %s, %L, 499999, null, null, 'hotel dinas', true)$q$,
    :'t1', pg_temp.version(:'t1'), :'bca')),
  'DK422', 'reimbursement_exceeds', 'nominal talangan di bawah Σ reimburse hidup ditolak');
select is(pg_temp.call(tests.n(), format(
    $q$select api.update_entry(gen_random_uuid(), %L, %s, %L, 500000, null, '2026-03-11', 'hotel dinas', true)$q$,
    :'t1', pg_temp.version(:'t1'), :'bca')) ->> 'version', '2', 'ubah talangan tetap reimbursable dengan nominal >= Σ boleh');

select pg_temp.talangan(tests.n(), :'bca', 80000, '2026-03-18') as t3 \gset
select pg_temp.reimb(tests.n(), :'t3', :'bca', 30000) as r4 \gset
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, (:'r4'::jsonb) ->> 'entry_id'));
select is(pg_temp.call(tests.n(), format(
    $q$select api.update_entry(gen_random_uuid(), %L, 1, %L, 80000, null, null, null, false)$q$, :'t3', :'bca'))
  ->> 'version', '2', 'Tidak diganti tanpa reimburse hidup (yang batal tidak dihitung) boleh');
select is(pg_temp.pengeluaran(:'np'), '95000/0', 'Tidak diganti: talangan jadi pengeluaran biasa');
select is(pg_temp.open_list(tests.n(), :'np'), '-', 'talangan Tidak diganti hilang dari daftar');
select throws_ok(format($$select pg_temp.reimb(tests.n(), %L, %L, 1)$$, :'t3', :'bca'),
  'DK422', 'not_reimbursable', 'reimburse pada pengeluaran biasa (bekas talangan) ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.restore_entry(gen_random_uuid(), %L, 2)$q$, (:'r4'::jsonb) ->> 'entry_id')),
  'DK422', 'not_reimbursable', 'pulihkan reimburse pada talangan yang Tidak diganti ditolak');

-- Talangan batal: reimburse ditolak, reimburse lama tidak bisa dipulihkan.
select pg_temp.talangan(tests.n(), :'bca', 60000, '2026-03-18') as t4 \gset
select pg_temp.reimb(tests.n(), :'t4', :'bca', 10000) as r5 \gset
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, (:'r5'::jsonb) ->> 'entry_id'));
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'t4'));
select throws_ok(format($$select pg_temp.reimb(tests.n(), %L, %L, 1)$$, :'t4', :'bca'),
  'DK422', 'not_reimbursable', 'reimburse pada talangan batal ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.restore_entry(gen_random_uuid(), %L, 2)$q$, (:'r5'::jsonb) ->> 'entry_id')),
  'DK422', 'not_reimbursable', 'pulihkan reimburse pada talangan batal ditolak');
select is(pg_temp.open_list(tests.n(), :'np'), '-', 'talangan batal tidak ada di daftar');

-- ===== Validasi create_reimbursement =====
select pg_temp.talangan(tests.n(), :'bca', 90000, '2026-03-12') as t5 \gset
select throws_ok(format($$select pg_temp.reimb(tests.n(), %L, %L, 1)$$, :'biasa', :'bca'),
  'DK422', 'not_reimbursable', 'reimburse pada pengeluaran biasa ditolak');
select throws_ok(format($$select pg_temp.reimb(tests.n(), %L, %L, 1)$$, (:'r1'::jsonb) ->> 'entry_id', :'bca'),
  'DK422', 'not_reimbursable', 'reimburse atas entri reimbursement ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.update_entry(gen_random_uuid(), %L, 1, %L, 1, null, null, null, false)$q$,
    (:'r1'::jsonb) ->> 'entry_id', :'bca')),
  'DK422', 'kind_not_editable', 'entri reimbursement tidak bisa diubah (batalkan lalu catat ulang)');
select throws_ok(format($$select pg_temp.reimb(tests.n(), %L, %L, 1)$$, :'t5', :'kas'),
  'DK422', 'space_mismatch', 'dompet tujuan di ruang lain (Bersama) ditolak');
select throws_ok(format($$select pg_temp.reimb(tests.n(), %L, %L, 1)$$, :'t5', :'lama'),
  'DK422', 'account_archived', 'dompet tujuan terarsip ditolak');
select throws_ok(format($$select pg_temp.reimb(tests.n(), %L, %L, 1, '2026-03-09')$$, :'t5', :'dana'),
  'DK422', 'before_opening', 'tanggal sebelum dompet tujuan dibuka ditolak');
select throws_ok(format($$select pg_temp.reimb(tests.n(), %L, %L, 1, '2026-03-21')$$, :'t5', :'bca'),
  'DK400', 'invalid_argument', 'tanggal masa depan ditolak');
select throws_ok(format($$select pg_temp.reimb(tests.n(), %L, %L, 0)$$, :'t5', :'bca'),
  'DK400', 'invalid_argument', 'nominal 0 ditolak');
select throws_ok(format($$select pg_temp.reimb(tests.n(), %L, %L, 1)$$, gen_random_uuid(), :'bca'),
  'DK404', 'entry_not_found', 'talangan tidak ada = DK404');
select throws_ok(format($$select pg_temp.reimb(tests.n(), %L, %L, 1)$$, :'t5', gen_random_uuid()),
  'DK404', 'account_not_found', 'dompet tujuan tidak ada = DK404');
-- Reimburse ke dompet kantor boleh (dompet mana pun yang aktif di ruang talangan).
select is(pg_temp.reimb(tests.n(), :'t5', :'kan', 40000) ->> 'remaining', '50000', 'reimburse ke dompet kantor boleh');
select is(tests.web_val(tests.n(), format($$select kantor_masuk from api.month_summary(%L, '2026-03-01')$$, :'np')),
  '0', 'reimburse ke dompet kantor bukan kantor_masuk');

-- ===== Talangan di Bersama =====
select throws_ok(format($$select pg_temp.talangan(tests.n(), %L, 1000)$$, :'kas'),
  'DK422', 'reimbursable_personal_expense_only', 'talangan di Bersama ditolak');
select is(pg_temp.open_list(tests.n(), :'sh'), '-', 'Bersama tidak punya talangan terbuka');

-- ===== Fee transfer dari dompet kantor bukan pengeluaran pribadi (keputusan pemilik #7) =====
select pg_temp.pengeluaran(:'np') as before_fee \gset
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 100000, 6500)$$,
  :'np', :'kan', :'bca'));
select is(pg_temp.pengeluaran(:'np'), :'before_fee', 'fee transfer dari dompet kantor tidak masuk pengeluaran pribadi');
select is(tests.web_val(tests.n(), format($$select outflow from api.period_summary(%L, '2026-03-01', '2026-03-31')
  where report_class = 'expense_fee'$$, :'np')), null, 'tidak ada expense_fee dari dompet kantor');

-- ===== Idempotensi =====
select pg_temp.call(tests.n(), format($$select api.create_reimbursement('bbbbbbbb-0000-0000-0000-000000000001', %L, %L, 1000)$$,
  :'t5', :'bca')) as idem \gset
select is(pg_temp.call(tests.n(), format($$select api.create_reimbursement('bbbbbbbb-0000-0000-0000-000000000001', %L, %L, 1000)$$,
  :'t5', :'bca')), (:'idem'::jsonb) - 'replayed' || '{"replayed": true}', 'klik ganda: hasil sama, replayed true');
select is(tests.owner_val(null, format($$select count(*) from app.entries where reimburses_entry_id = %L and voided_at is null$$,
  :'t5')), '2', 'klik ganda = 1 reimburse');
select throws_ok(format($$select pg_temp.call(tests.n(), %L)$$, format(
    $q$select api.create_reimbursement('bbbbbbbb-0000-0000-0000-000000000001', %L, %L, 2000)$q$, :'t5', :'bca')),
  'DK410', 'idempotency_key_reused', 'client_id sama isi beda = DK410');

-- ===== Isolasi: F tidak bisa menyentuh talangan N =====
select throws_ok(format($$select pg_temp.reimb(tests.f(), %L, %L, 1)$$, :'t5', :'fbca'),
  'DK404', 'entry_not_found', 'F -> create_reimbursement atas talangan N = DK404');
select throws_ok(format($$select pg_temp.open_list(tests.f(), %L)$$, :'np'),
  'DK404', 'space_not_found', 'F -> open_reimbursables Pribadi N = DK404');
select is(pg_temp.open_list(tests.f(), :'fp'), '-', 'F: daftar talangan Pribadi F kosong (0 baris milik N)');
select is(tests.web_val(tests.n(), format($$select count(*) from app.entries where reimburses_entry_id = %L$$, :'t5')),
  '2', 'percobaan F tidak menulis apa pun');

-- ===== Purge: talangan batal dengan reimburse batal terhapus dalam satu siklus (0113) =====
-- Reimburse salah dicatat lalu dibatalkan, kemudian talangannya juga dibatalkan. Sebelum 0113 talangan
-- baru terhapus satu Senin kemudian (umur > 97 hari = DQ10 warn palsu).
select pg_temp.talangan(tests.n(), :'bca', 45000, '2026-03-19', 'ojek klien') as t9 \gset
select pg_temp.reimb(tests.n(), :'t9', :'bca', 15000) ->> 'entry_id' as r9 \gset
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'r9'));
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, %s)$$, :'t9',
  tests.owner_val(null, format($q$select version from app.entries where id = %L$q$, :'t9'))));
select tests.clock_at('2026-06-19 10:00+07');  -- +91 hari
select ok(tests.worker_val(null, 'select jobs.purge_voided()')::int >= 2, 'purge_voided berjalan');
select is(tests.owner_val(null, format($$select (select count(*) from app.entries where id in (%1$L, %2$L)) || ' '
  || (select count(*) from app.entry_tombstones where entry_id in (%1$L, %2$L))$$, :'t9', :'r9')),
  '0 2', 'reimburse batal dan talangannya dipurge dalam satu putaran (dua tombstone)');
-- Tanpa purge lain sebelum Senin berikutnya: umur sisa mana pun sudah > 97 hari.
select tests.clock_at('2026-06-26 10:00+07');  -- +98 hari: lewat ambang DQ10 (97 hari)
select is(tests.worker_val(null, $$select violations from jobs.dq_reconcile() where check_id = 'DQ10'$$), '0',
  'DQ10 tidak alarm untuk talangan + reimburse batal');
select is(tests.worker_val(null, 'select jobs.purge_voided()'), '0', 'putaran berikutnya tidak ada sisa');

select * from finish();
rollback;
