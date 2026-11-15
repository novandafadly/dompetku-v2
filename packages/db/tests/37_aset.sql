-- Aset non-kas S14 (0139, 0140; plan S14 Task 2, K2, K3, K4, K13 (a)(b)(c)(h)): dompet ber-pocket `aset`
-- di ledger + app.asset_details (jenis K4, catatan opsional, FK komposit ke dompet ruang yang sama,
-- penjaga INVOKER private.tg_asset_guard: hanya pocket aset, `saham` hanya Pribadi, jenis/dompet/ruang
-- tetap), entri `valuation` (satu line main di dompet aset, kelas x_valuasi), penjaga ledger
-- private.tg_asset_ledger (dompet aset tidak pernah negatif di semua jalur, p_allow_negative diabaikan;
-- tidak dipakai pemasukan/pengeluaran/talangan/reimburse/utang/patungan), tagihan rutin tidak boleh
-- menunjuk dompet aset, wa_default_account tidak pernah aset, RLS (Pribadi pasangan dan Luar tidak
-- terbaca/tertulis; Bersama semua anggota, K2), tulis hanya dompetku_api, I6 (valuasi tidak mengubah
-- pemasukan/pengeluaran, Laporan, anggaran, aman dipakai, Ekspor), purge tidak terhalang FK.
-- Fungsi api.* aset (create_account dengan jenis, revalue_asset) = 0141 (Task 3); di sini rincian dan
-- entri valuasi ditulis langsung sebagai dompetku_api (jalur yang sama dengan fungsi DEFINER).
-- S5 (repro qa.md R3): transfer tidak bisa diubah (api.update_entry = kind_not_editable), jadi "ubah
-- setoran" = batalkan lalu catat ulang. Kekayaan bersih dihitung di tes sebagai Σ saldo dompet bukan
-- Kantor (api.net_worth baru memuat aset di 0144, Task 6). Jam dipatok 2026-03-20 WIB.
-- ID: T11, S5, I6, B23
begin;
select plan(118);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 10000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Celengan', 'tabungan', 1000000, '2026-01-01') as tab,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 0, '2026-01-01') as kan,
       tests.account(tests.n(), :'np', 'Emas Antam', 'aset', 0, '2026-01-01') as emas,
       tests.account(tests.n(), :'np', 'Motor', 'aset', 5000000, '2026-03-15') as motor,
       tests.account(tests.n(), :'np', 'RDN', 'aset', 0, '2026-01-01') as rdn,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 1000000, '2026-01-01') as kas,
       tests.account(tests.n(), :'sh', 'Rumah', 'aset', 0, '2026-01-01') as rumah,
       tests.account(tests.f(), :'fp', 'Deposito Farida', 'aset', 0, '2026-01-01') as fdep \gset
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja'$q$, :'np'))
  as belanja \gset

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
-- Rincian aset ditulis sebagai dompetku_api (jalur fungsi DEFINER 0141), kembalikan account_id.
create function pg_temp.det(p_uid uuid, p_acc uuid, p_space uuid, p_kind text, p_asset text,
  p_note text default null) returns uuid
language sql as $$
  select tests.api_val(p_uid, format($q$insert into app.asset_details (account_id, space_id, space_kind, asset_kind,
      note, created_by) values (%L, %L, %L, %L, %L, %L) returning account_id$q$,
    p_acc, p_space, p_kind, p_asset, p_note, p_uid))::uuid
$$;
-- Entri valuasi (jalur fungsi DEFINER 0141): satu line main di dompet, bentuk dan penjaga dicek segera.
create function pg_temp.val(p_uid uuid, p_acc uuid, p_amount bigint, p_on date default '2026-03-10',
  p_id uuid default gen_random_uuid()) returns uuid
language plpgsql as $$
begin
  perform tests.api_exec(p_uid, format($q$do $d$ begin
      set constraints all deferred;
      insert into app.entries (id, space_id, space_kind, kind, occurred_on, created_by, updated_by)
        select %1$L, a.space_id, a.space_kind, 'valuation', %4$L, %5$L, %5$L from app.accounts a where a.id = %2$L;
      insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
        select %1$L, a.space_id, 'main', a.id, %3$s from app.accounts a where a.id = %2$L;
      perform private.write_history(%1$L, 'create', %5$L);
      set constraints all immediate;
    end $d$ $q$, p_id, p_acc, p_amount, p_on, p_uid));
  return p_id;
end $$;
create function pg_temp.xfer(p_uid uuid, p_from uuid, p_to uuid, p_amount bigint, p_allow boolean default false,
  p_on date default '2026-03-16') returns uuid
language sql as $$
  select (pg_temp.call(p_uid, format($q$select api.create_transfer(gen_random_uuid(),
      (select space_id from app.accounts where id = %1$L), %1$L, %2$L, %3$s, 0, %4$L::date, null, null, %5$L)$q$,
    p_from, p_to, p_amount, p_on, p_allow)) ->> 'entry_id')::uuid
$$;
create function pg_temp.void(p_entry uuid, p_allow boolean default false, p_uid uuid default null) returns jsonb
language sql as $$
  select pg_temp.call(coalesce(p_uid, tests.n()), format($q$select api.void_entry(gen_random_uuid(), %L,
    (select version from app.entries where id = %L), %L)$q$, p_entry, p_entry, p_allow))
$$;
create function pg_temp.restore(p_entry uuid, p_allow boolean default false) returns jsonb
language sql as $$
  select pg_temp.call(tests.n(), format($q$select api.restore_entry(gen_random_uuid(), %L,
    (select version from app.entries where id = %L), %L)$q$, p_entry, p_entry, p_allow))
$$;
create function pg_temp.entry(p_acc uuid, p_kind text, p_amount bigint, p_reimb boolean default false,
  p_uid uuid default null) returns uuid
language sql as $$
  select (pg_temp.call(coalesce(p_uid, tests.n()), format($q$select api.create_entry(gen_random_uuid(),
      (select space_id from app.accounts where id = %1$L), %1$L, %2$L, %3$s, null, '2026-03-16', null, %4$L)$q$,
    p_acc, p_kind, p_amount, p_reimb)) ->> 'entry_id')::uuid
$$;
-- Saldo dompet aset Emas / BCA / kekayaan bersih Pribadi Novanda (Σ saldo dompet bukan Kantor).
create function pg_temp.s5() returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select
      (select ab.balance from app.account_balances ab join app.accounts a on a.id = ab.account_id
        where a.space_id = %1$L and a.name = 'Emas Antam') || '/'
      || (select ab.balance from app.account_balances ab join app.accounts a on a.id = ab.account_id
           where a.space_id = %1$L and a.name = 'BCA') || '/'
      || (select sum(balance) from app.account_balances where space_id = %1$L and pocket <> 'kantor')$q$,
    tests.space_id(tests.n(), 'personal')))
$$;
-- Σ jumlah Ekspor Maret per kelas (daftar kelas dipisah koma, '*' = semua kelas).
create function pg_temp.exp_sum(p_classes text) returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select coalesce(string_agg(c || '=' || s, ',' order by c collate "C"), '')
      from (select report_class as c, sum(amount) as s from api.export_entries(%L, '2026-03-01', '2026-03-31')
             where %L = '*' or report_class = any (string_to_array(%L, ',')) group by report_class) x$q$,
    tests.space_id(tests.n(), 'personal'), p_classes, p_classes))
$$;
-- I6 Pribadi Novanda Maret: kategori, anggaran, Σ pemasukan/pengeluaran (report_lines dan period_summary),
-- aman dipakai, dan Σ pemasukan/pengeluaran di Ekspor.
create function pg_temp.i6() returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select
      (select coalesce(string_agg(kind || ':' || coalesce(name, '-') || ':' || amount, ',' order by kind, name collate "C"), '')
         from api.category_summary(%1$L, '2026-03-01', '2026-03-31'))
      || '|' || (select coalesce(string_agg(category_id || ':' || spent || ':' || remaining, ',' order by category_id), '')
         from api.budget_progress(%1$L, '2026-03-01'))
      || '|' || (select coalesce(sum(amount), 0) from app.report_lines
                  where space_id = %1$L and report_class in ('income', 'expense', 'expense_fee'))
      || '|' || (select coalesce(string_agg(report_class || '=' || inflow || '/' || outflow, ',' order by report_class collate "C"), '')
         from api.period_summary(%1$L, '2026-03-01', '2026-03-31') where report_class in ('income', 'expense', 'expense_fee'))
      || '|' || (select s::text from api.safe_to_spend(%1$L, '2026-03-20') s)$q$,
    tests.space_id(tests.n(), 'personal')))
  || '|' || pg_temp.exp_sum('income,expense,expense_fee')
$$;

-- ===== Skema (K3, K4) =====
select has_table('app', 'asset_details', 'tabel app.asset_details ada');
select is((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
           from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname = 'asset_details' and a.attnum > 0 and not a.attisdropped),
  'account_id:uuid:true,space_id:uuid:true,space_kind:app.space_kind:true,asset_kind:text:true,note:text:false,'
  || 'created_by:uuid:true,created_at:timestamp with time zone:true',
  'kolom asset_details');
select col_is_pk('app', 'asset_details', 'account_id', 'satu baris rincian per dompet (PK account_id)');
select is((select string_agg(pg_get_constraintdef(c.oid), ' | ' order by pg_get_constraintdef(c.oid) collate "C")
           from pg_constraint c where c.conrelid = (select cl.oid from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
             where n.nspname = 'app' and cl.relname = 'asset_details') and c.contype = 'f'),
  'FOREIGN KEY (created_by) REFERENCES auth."user"(id) ON DELETE RESTRICT | '
  || 'FOREIGN KEY (space_id, account_id) REFERENCES app.accounts(space_id, id) ON DELETE CASCADE | '
  || 'FOREIGN KEY (space_id, space_kind) REFERENCES app.spaces(id, kind) ON DELETE RESTRICT',
  'FK komposit ke dompet ruang yang sama (rincian ikut terhapus bersama dompet), ke ruang, ke pembuat');
select is(tests.owner_val(null, $$select app.report_class('valuation', 'main', 'aset', 'personal', null, false)
          || ',' || app.report_class('valuation', 'main', 'aset', 'shared', null, false)$$),
  'x_valuasi,x_valuasi', 'report_class valuasi = x_valuasi di kedua ruang (bukan pemasukan/pengeluaran)');
select is(tests.owner_val(null, $$select app.report_class('transfer', 'counter', 'aset', 'personal', null, false)
          || ',' || app.report_class('opening_balance', 'main', 'aset', 'personal', null, false)
          || ',' || app.report_class('space_transfer', 'main', 'aset', 'shared', 'in', false)$$),
  'x_transfer,x_koreksi,x_setoran_anggota', 'isi/tarik aset = transfer, nilai awal = koreksi (kelas yang ada)');

-- Rincian: semua jenis K4 di Pribadi; di Bersama semua kecuali saham (K2).
select is(pg_temp.det(tests.n(), :'emas', :'np', 'personal', 'emas', '10 gram'), :'emas'::uuid, 'rincian emas Pribadi');
select is(pg_temp.det(tests.n(), :'motor', :'np', 'personal', 'kendaraan'), :'motor'::uuid, 'rincian kendaraan tanpa catatan');
select is(pg_temp.det(tests.n(), :'rdn', :'np', 'personal', 'saham'), :'rdn'::uuid, 'saham boleh di Pribadi (K2)');
select is(pg_temp.det(tests.n(), :'rumah', :'sh', 'shared', 'properti'), :'rumah'::uuid,
  'aset non-saham boleh di Bersama (K2)');
select is(pg_temp.det(tests.f(), :'fdep', :'fp', 'personal', 'deposito'), :'fdep'::uuid, 'rincian deposito Farida');
savepoint s;
select lives_ok(format($$select pg_temp.det(tests.n(), tests.account(tests.n(), %L, 'A' || k, 'aset'), %L, 'personal', k)
    from unnest(array['properti', 'reksa_dana', 'lainnya']) k$$, :'np', :'np'),
  'jenis K4 lain diterima: properti, reksa_dana, lainnya');
rollback to savepoint s;
select throws_ok(format($$select pg_temp.det(tests.n(), tests.account(tests.n(), %L, 'Saham Bersama', 'aset'), %L,
    'shared', 'saham')$$, :'sh', :'sh'),
  'DK422', 'pocket_personal_only', 'saham di Bersama ditolak penjaga (K2)');
select throws_ok(format($$select tests.raw_exec($q$insert into app.asset_details (account_id, space_id, space_kind,
    asset_kind, created_by) values (%L, %L, 'shared', 'saham', %L)$q$)$$, :'rumah', :'sh', tests.n()),
  '23514', null, 'CHECK saham hanya Pribadi menolak di luar penjaga');
select throws_ok(format($$select pg_temp.det(tests.n(), tests.account(tests.n(), %L, 'Kripto', 'aset'), %L,
    'personal', 'kripto')$$, :'np', :'np'),
  '23514', null, 'jenis di luar K4 ditolak CHECK');
select throws_ok(format($$select pg_temp.det(tests.n(), tests.account(tests.n(), %L, 'Catatan Kosong', 'aset'), %L,
    'personal', 'emas', '  ')$$, :'np', :'np'),
  '23514', null, 'catatan kosong ditolak (opsional = NULL, isi 1..200)');
select throws_ok(format($$select pg_temp.det(tests.n(), tests.account(tests.n(), %L, 'Catatan Panjang', 'aset'), %L,
    'personal', 'emas', repeat('x', 201))$$, :'np', :'np'),
  '23514', null, 'catatan > 200 ditolak');
select throws_ok(format($$select pg_temp.det(tests.n(), %L, %L, 'personal', 'emas')$$, :'bca', :'np'),
  'DK422', 'asset_account_invalid', 'rincian aset pada dompet operasional ditolak');
select throws_ok(format($$select pg_temp.det(tests.n(), %L, %L, 'personal', 'emas')$$, :'tab', :'np'),
  'DK422', 'asset_account_invalid', 'rincian aset pada dompet tabungan ditolak');
select throws_ok(format($$select pg_temp.det(tests.n(), %L, %L, 'personal', 'lainnya')$$, :'emas', :'np'),
  '23505', null, 'satu rincian per dompet');
select throws_ok(format($$select pg_temp.det(tests.n(), %L, %L, 'shared', 'emas')$$, :'emas', :'sh'),
  'DK404', 'account_not_found', 'rincian dengan ruang lain dari dompetnya = DK404');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$update app.asset_details set asset_kind = 'lainnya'
    where account_id = %L$q$)$$, :'emas'),
  'DK422', 'asset_immutable', 'jenis aset tidak bisa diubah (K4)');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$update app.asset_details set account_id = %L
    where account_id = %L$q$)$$, :'motor', :'emas'),
  'DK422', 'asset_immutable', 'dompet rincian tidak bisa diganti');
select is(tests.api_exec(tests.n(), format($$update app.asset_details set note = '12 gram' where account_id = %L$$, :'emas')),
  1::bigint, 'catatan boleh diubah');

-- ===== Isolasi dan hak (B23, K2, K13 h) =====
select is(tests.web_val(tests.f(), format($$select count(*) from app.asset_details where account_id in (%L, %L, %L)$$,
    :'emas', :'motor', :'rdn')), '0', 'Farida tidak membaca rincian aset Pribadi Novanda [B23]');
select is(tests.web_val(tests.x(), 'select count(*) from app.asset_details'), '0',
  'Luar tidak membaca rincian aset apa pun [B23]');
select is(tests.web_val(tests.f(), format($$select asset_kind from app.asset_details where account_id = %L$$, :'rumah')),
  'properti', 'Farida membaca rincian aset Bersama (K2)');
select is(tests.api_exec(tests.f(), format($$update app.asset_details set note = 'Diretas' where account_id = %L$$, :'emas')),
  0::bigint, 'dompetku_api atas nama Farida tidak bisa mengubah rincian Pribadi Novanda [B23]');
select is(tests.api_exec(tests.f(), format($$update app.asset_details set note = 'Atas nama Farida' where account_id = %L$$,
    :'rumah')), 1::bigint, 'anggota Bersama kedua boleh mengubah rincian aset Bersama (K2)');
savepoint s;
select tests.account(tests.n(), :'np', 'Emas Kedua', 'aset') as emas2 \gset
select throws_ok(format($$select pg_temp.det(tests.f(), %L, %L, 'personal', 'emas')$$, :'emas2', :'np'),
  'DK404', 'account_not_found', 'Farida tidak bisa menulis rincian di Pribadi Novanda (DK404 seragam) [B23]');
select throws_ok(format($$select pg_temp.det(tests.f(), %L, %L, 'personal', 'emas')$$, :'emas2', :'fp'),
  'DK404', 'account_not_found', 'dompet orang lain dengan ruang sendiri juga DK404 (bukan bocoran) [B23]');
rollback to savepoint s;
select throws_ok(format($$select tests.web_exec(tests.n(), $q$insert into app.asset_details (account_id, space_id,
    space_kind, asset_kind, created_by) values (%L, %L, 'personal', 'emas', %L)$q$)$$, :'tab', :'np', tests.n()),
  '42501', null, 'dompetku_web tidak bisa INSERT langsung');
select throws_ok(format($$select tests.web_exec(tests.n(), $q$update app.asset_details set note = 'X'
    where account_id = %L$q$)$$, :'emas'),
  '42501', null, 'dompetku_web tidak bisa UPDATE langsung');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$delete from app.asset_details where account_id = %L$q$)$$,
    :'emas'),
  '42501', null, 'tanpa DELETE (rincian hanya hilang bersama dompetnya)');
select throws_ok($$select tests.worker_val(null, 'select count(*) from app.asset_details')$$, '42501', null,
  'worker tidak membaca rincian aset');
select is(tests.web_val(tests.f(), format($$select count(*) from app.account_balances where account_id = %L$$, :'emas')),
  '0', 'Farida tidak melihat saldo dompet aset Pribadi Novanda [B23]');

-- ===== wa_default_account tidak pernah dompet aset =====
select is(tests.web_val(tests.f(), format($$select coalesce(api.wa_default_account(%L)::text, 'null')$$, :'fp')),
  'null', 'ruang yang hanya punya dompet aset tidak punya dompet bawaan WA');
select tests.account(tests.f(), :'fp', 'Mandiri', 'operasional', 1000000, '2026-01-01') as mdr \gset
select is(tests.web_val(tests.f(), format($$select api.wa_default_account(%L)$$, :'fp')), :'mdr',
  'dompet bawaan WA = dompet operasional, bukan aset');

-- ===== S5: setor 500 rb lalu ubah ke 600 rb (K13 a) =====
select is(pg_temp.s5(), '0/10000000/16000000', 'awal: Emas 0, BCA 10 jt, kekayaan bersih 16 jt (BCA + Celengan + Motor)');
select pg_temp.xfer(tests.n(), :'bca', :'emas', 500000, false, '2026-03-05') as t1 \gset
select is(pg_temp.s5(), '500000/9500000/16000000', 'setor 500 rb: Emas 500 rb, BCA −500 rb, kekayaan bersih tetap [S5]');
select throws_ok(format($$select pg_temp.call(tests.n(), $q$select api.update_entry(gen_random_uuid(), %L, 1, %L, 600000,
    null, null, null, false)$q$)$$, :'t1', :'bca'),
  'DK422', 'kind_not_editable', 'transfer tidak bisa diubah langsung: ubah setoran = batalkan lalu catat ulang');
select pg_temp.void(:'t1');
select pg_temp.xfer(tests.n(), :'bca', :'emas', 600000, false, '2026-03-05') as t2 \gset
select is(pg_temp.s5(), '600000/9400000/16000000',
  'ubah ke 600 rb: nilai aset 600 rb, BCA −600 rb dari awal, kekayaan bersih tetap [S5]');
select is(tests.web_val(tests.n(), format($$select count(*) from app.entry_lines l join app.entries e on e.id = l.entry_id
    where l.account_id = %L and e.voided_at is null$$, :'emas')), '1', 'tepat satu setoran hidup di dompet aset [S5]');
select pg_temp.void(:'t2');
select is(pg_temp.s5(), '0/10000000/16000000', 'batal setoran: kembali ke awal tepat sekali [S5]');
select pg_temp.restore(:'t2');
select is(pg_temp.s5(), '600000/9400000/16000000', 'pulihkan setoran: 600 rb lagi tepat sekali [S5]');
select throws_ok(format($$select pg_temp.restore(%L)$$, :'t2'), 'DK422', 'not_voided',
  'pulihkan kedua kali ditolak (tidak menggandakan nilai aset) [S5]');
select throws_ok(format($$select pg_temp.void(%L)$$, :'t1'), 'DK422', 'already_voided',
  'setoran lama yang sudah batal tidak bisa dibatalkan lagi [S5]');
select is(pg_temp.s5(), '600000/9400000/16000000', 'sesudah percobaan ganda: angka tetap [S5]');

-- ===== Valuasi naik/turun (K13 b, I6) =====
select pg_temp.entry(:'bca', 'expense', 50000) as belanja_e \gset
select tests.web_exec(tests.n(), format($$select api.set_budget(%L, %L, '2026-03-01', 300000)$$, :'np', :'belanja'));
select tests.web_exec(tests.n(), format($$select api.update_entry(gen_random_uuid(), %L, 1, %L, 50000, %L, null, null, false)$$,
  :'belanja_e', :'bca', :'belanja'));
select pg_temp.i6() as i6_before \gset
select pg_temp.exp_sum('*') as exp_before \gset
select pg_temp.val(tests.n(), :'emas', 100000, '2026-03-10') as v1 \gset
select is(pg_temp.s5(), '700000/9350000/16050000', 'valuasi naik 100 rb: nilai aset dan kekayaan bersih naik, BCA tetap');
select pg_temp.val(tests.n(), :'emas', -50000, '2026-03-12') as v2 \gset
select is(pg_temp.s5(), '650000/9350000/16000000', 'valuasi turun 50 rb');
select is(pg_temp.i6(), :'i6_before',
  'valuasi tidak mengubah kategori, anggaran, Σ pemasukan/pengeluaran, period_summary, aman dipakai, Ekspor [I6]');
select is(tests.web_val(tests.n(), format($$select string_agg(report_class || ':' || direction || ':' || amount || ':' || entry_count,
    ',' order by direction) from api.excluded_summary(%L, '2026-03-01', '2026-03-31') where report_class = 'x_valuasi'$$, :'np')),
  'x_valuasi:in:100000:1,x_valuasi:out:50000:1', 'Laporan: valuasi hanya di "Tidak termasuk" (x_valuasi)');
select is(tests.web_val(tests.n(), format($$select inflow || '/' || outflow from api.period_summary(%L, '2026-03-01', '2026-03-31')
    where report_class = 'x_valuasi'$$, :'np')), '100000/50000', 'period_summary: kelas x_valuasi sendiri');
select is(tests.web_val(tests.n(), format($$select string_agg(kind || ':' || role || ':' || report_class || ':' || account || ':' || amount,
    ',' order by amount) from api.export_entries(%L, '2026-03-01', '2026-03-31') where kind = 'valuation'$$, :'np')),
  'valuation:main:x_valuasi:Emas Antam:-50000,valuation:main:x_valuasi:Emas Antam:100000',
  'Ekspor: baris valuasi berkelas x_valuasi');
select is(pg_temp.exp_sum('*'),
  (select string_agg(c || '=' || s, ',' order by c collate "C") from (
     select split_part(x, '=', 1) as c, split_part(x, '=', 2)::bigint as s
       from unnest(string_to_array(:'exp_before', ',')) x where split_part(x, '=', 1) <> 'x_valuasi'
     union all select 'x_valuasi', 50000) y),
  'Ekspor: hanya kelas x_valuasi yang bertambah (Σ = +100 rb − 50 rb)');
select is(tests.web_val(tests.n(), format($q$select string_agg(report_class || '=' || (inflow - outflow), ',' order by report_class collate "C")
    from api.period_summary(%L, '2026-03-01', '2026-03-31')$q$, :'np')), pg_temp.exp_sum('*'),
  'Σ Ekspor per kelas = Laporan (period_summary) per kelas');
select pg_temp.void(:'v2');
select is(pg_temp.s5(), '700000/9350000/16050000', 'batal valuasi turun: nilai aset kembali tepat sekali');
select pg_temp.restore(:'v2');
select is(pg_temp.s5(), '650000/9350000/16000000', 'pulihkan valuasi turun tepat sekali');
select is(pg_temp.i6(), :'i6_before', 'batal/pulihkan valuasi tidak mengubah I6');

-- Bentuk entri valuasi (assert_entry_shape cabang valuation).
select throws_ok(format($$select pg_temp.val(tests.n(), %L, 100000)$$, :'bca'),
  'DK500', 'entry_shape_invalid', 'valuasi di dompet operasional ditolak cek bentuk');
select throws_ok(format($$select pg_temp.val(tests.n(), %L, 100000)$$, :'tab'),
  'DK500', 'entry_shape_invalid', 'valuasi di dompet tabungan ditolak cek bentuk');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$do $d$ declare v uuid := gen_random_uuid(); begin
      set constraints all deferred;
      insert into app.entries (id, space_id, space_kind, kind, occurred_on, created_by, updated_by)
        values (v, %1$L, 'personal', 'valuation', '2026-03-10', %3$L, %3$L);
      insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
        values (v, %1$L, 'main', %2$L, 1000), (v, %1$L, 'fee', %2$L, -10);
      set constraints all immediate;
    end $d$ $q$)$$, :'np', :'emas', tests.n()),
  'DK500', 'entry_shape_invalid', 'valuasi dengan line fee ditolak');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$do $d$ declare v uuid := gen_random_uuid(); begin
      set constraints all deferred;
      insert into app.entries (id, space_id, space_kind, kind, occurred_on, created_by, updated_by)
        values (v, %1$L, 'personal', 'valuation', '2026-03-10', %4$L, %4$L);
      insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
        values (v, %1$L, 'main', %2$L, -1000), (v, %1$L, 'counter', %3$L, 1000);
      set constraints all immediate;
    end $d$ $q$)$$, :'np', :'emas', :'bca', tests.n()),
  'DK500', 'entry_shape_invalid', 'valuasi dengan line counter ditolak');
select throws_ok(format($$select tests.api_exec(tests.n(), $q$do $d$ declare v uuid := gen_random_uuid(); begin
      set constraints all deferred;
      insert into app.entries (id, space_id, space_kind, kind, occurred_on, created_by, updated_by)
        values (v, %1$L, 'personal', 'valuation', '2026-03-10', %2$L, %2$L);
      set constraints all immediate;
    end $d$ $q$)$$, :'np', tests.n()),
  'DK500', 'entry_shape_invalid', 'valuasi tanpa line ditolak');

-- ===== Dompet aset tidak pernah negatif (K13 c; p_allow_negative diabaikan) =====
select throws_ok(format($$select pg_temp.xfer(tests.n(), %L, %L, 650001)$$, :'emas', :'bca'),
  'DK422', 'asset_negative', 'tarik melebihi nilai aset ditolak');
select throws_ok(format($$select pg_temp.xfer(tests.n(), %L, %L, 650001, true)$$, :'emas', :'bca'),
  'DK422', 'asset_negative', 'tarik melebihi nilai aset ditolak walau p_allow_negative');
select throws_ok(format($$select pg_temp.val(tests.n(), %L, -650001)$$, :'emas'),
  'DK422', 'asset_negative', 'valuasi turun melebihi nilai aset ditolak');
select is(pg_temp.s5(), '650000/9350000/16000000', 'penolakan = nol efek');
savepoint s;
select pg_temp.val(tests.n(), :'emas', -650000);
select is(pg_temp.s5(), '0/9350000/15350000', 'valuasi turun sampai nol boleh (aset tidak bernilai)');
rollback to savepoint s;
savepoint s;
select pg_temp.xfer(tests.n(), :'emas', :'bca', 600000) as t_out \gset
select throws_ok(format($$select pg_temp.void(%L, true)$$, :'t2'), 'DK422', 'asset_negative',
  'batal setoran yang sudah ditarik sebagian ditolak (aset akan negatif), walau p_allow_negative');
select pg_temp.void(:'t_out');
select pg_temp.val(tests.n(), :'emas', -650000);
select throws_ok(format($$select pg_temp.restore(%L, true)$$, :'t_out'), 'DK422', 'asset_negative',
  'pulihkan penarikan saat nilai aset sudah turun ditolak, walau p_allow_negative');
rollback to savepoint s;
savepoint s;
select pg_temp.call(tests.n(), format($$select api.reconcile_balance(gen_random_uuid(), %L, 0)$$, :'emas'));
select is(pg_temp.s5(), '0/9350000/15350000', 'Cocokkan saldo dompet aset ke 0 boleh (x_koreksi, tidak negatif)');
rollback to savepoint s;
-- Nilai awal lewat saldo awal (opening_balance) bisa diubah 7 hari, tetapi tidak sampai aset negatif.
select pg_temp.xfer(tests.n(), :'motor', :'bca', 4000000) as t_motor \gset
select tests.owner_val(null, format($q$select e.id from app.entries e join app.entry_lines l on l.entry_id = e.id
  where l.account_id = %L and e.kind = 'opening_balance'$q$, :'motor')) as motor_ob \gset
select throws_ok(format($$select pg_temp.call(tests.n(), $q$select api.update_entry(gen_random_uuid(), %L,
    (select version from app.entries where id = %L), %L, 3000000, null, null, null, false, true)$q$)$$,
    :'motor_ob', :'motor_ob', :'motor'),
  'DK422', 'asset_negative', 'ubah nilai awal di bawah yang sudah ditarik ditolak, walau p_allow_negative');
-- Bersama (K2): setor dari Pribadi, Farida menarik, tidak bisa negatif.
select (pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 300000, 0, '2026-03-16')$$,
  :'np', :'bca', :'rumah')) ->> 'linked_entry_id') as st_in \gset
select is(tests.web_val(tests.f(), format($$select balance from app.account_balances where account_id = %L$$, :'rumah')),
  '300000', 'setor Pribadi → aset Bersama terlihat Farida (K2)');
select pg_temp.call(tests.f(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 100000, 0, '2026-03-16')$$,
  :'sh', :'rumah', :'mdr'));
select is(tests.web_val(tests.f(), format($$select balance from app.account_balances where account_id = %L$$, :'rumah')),
  '200000', 'Farida menarik dari aset Bersama ke Pribadinya (K2)');
select throws_ok(format($$select pg_temp.call(tests.f(), $q$select api.create_transfer(gen_random_uuid(), %L, %L, %L,
    200001, 0, '2026-03-16', null, null, true)$q$)$$, :'sh', :'rumah', :'mdr'),
  'DK422', 'asset_negative', 'tarik antar ruang melebihi nilai aset Bersama ditolak walau p_allow_negative');
select throws_ok(format($$select pg_temp.call(tests.f(), $q$select api.create_transfer(gen_random_uuid(), %L, %L, %L,
    200001, 0, '2026-03-16', null, null, true)$q$)$$, :'sh', :'rumah', :'kas'),
  'DK422', 'asset_negative', 'tarik satu ruang melebihi nilai aset Bersama ditolak');
select throws_ok(format($$select pg_temp.void(%L, true)$$, :'st_in'), 'DK422', 'asset_negative',
  'batal setoran lintas ruang yang sudah ditarik sebagian ditolak (dari sisi Bersama)');
select pg_temp.val(tests.f(), :'rumah', 50000, '2026-03-17');
select is(tests.web_val(tests.n(), format($$select balance from app.account_balances where account_id = %L$$, :'rumah')),
  '250000', 'valuasi aset Bersama oleh Farida terlihat Novanda (K2)');

-- ===== Jalur yang tidak boleh memakai dompet aset =====
select throws_ok(format($$select pg_temp.entry(%L, 'income', 10000)$$, :'emas'),
  'DK422', 'asset_account_invalid', 'pemasukan ke dompet aset ditolak');
select throws_ok(format($$select pg_temp.entry(%L, 'expense', 10000)$$, :'emas'),
  'DK422', 'asset_account_invalid', 'pengeluaran dari dompet aset ditolak');
select throws_ok(format($$select pg_temp.entry(%L, 'expense', 10000, true)$$, :'emas'),
  'DK422', 'asset_account_invalid', 'talangan dari dompet aset ditolak');
select throws_ok(format($$select pg_temp.entry(%L, 'expense', 10000, false, tests.f())$$, :'rumah'),
  'DK422', 'asset_account_invalid', 'pengeluaran dari dompet aset Bersama ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), $q$select api.update_entry(gen_random_uuid(), %L,
    (select version from app.entries where id = %L), %L, 50000, null, null, null, false)$q$)$$,
    :'belanja_e', :'belanja_e', :'emas'),
  'DK422', 'asset_account_invalid', 'memindah pengeluaran ke dompet aset lewat ubah ditolak');
select pg_temp.entry(:'bca', 'expense', 80000, true) as talangan \gset
select throws_ok(format($$select pg_temp.call(tests.n(), $q$select api.create_reimbursement(gen_random_uuid(), %L, %L,
    30000, '2026-03-17')$q$)$$, :'talangan', :'emas'),
  'DK422', 'asset_account_invalid', 'reimburse talangan ke dompet aset ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), $q$select api.create_debt(gen_random_uuid(), %L, 'borrowed',
    100000, 'baru', null, 'Budi', %L, '2026-03-17')$q$)$$, :'np', :'emas'),
  'DK422', 'asset_account_invalid', 'pokok utang ke dompet aset ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), $q$select api.create_debt(gen_random_uuid(), %L, 'lent',
    100000, 'baru', null, 'Budi', %L, '2026-03-17')$q$)$$, :'np', :'emas'),
  'DK422', 'asset_account_invalid', 'piutang dari dompet aset ditolak');
select pg_temp.call(tests.n(), format($$select api.create_debt(gen_random_uuid(), %L, 'borrowed', 100000, 'baru', null,
  'Budi', %L, '2026-03-17')$$, :'np', :'bca')) ->> 'debt_id' as debt \gset
select throws_ok(format($$select pg_temp.call(tests.n(), $q$select api.pay_debt(gen_random_uuid(), %L, %L, 10000,
    '2026-03-18')$q$)$$, :'debt', :'emas'),
  'DK422', 'asset_account_invalid', 'cicilan utang dari dompet aset ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), $q$select api.create_split(gen_random_uuid(), %L, %L, 100000,
    null, '2026-03-17')$q$)$$, :'sh', :'emas'),
  'DK422', 'split_account_invalid', 'patungan dibayar dari dompet aset ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), $q$select api.move_entry_to_space(gen_random_uuid(), %L,
    (select version from app.entries where id = %L), %L, %L, null)$q$)$$, :'belanja_e', :'belanja_e', :'sh', :'rumah'),
  'DK422', 'asset_account_invalid', 'pindah pengeluaran ke dompet aset ruang lain ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), $q$select api.create_bill(gen_random_uuid(), %L, 'Listrik',
    200000, (select id from app.categories where space_id = %L and name = 'Listrik & Air'), 5::smallint,
    '2026-03-01', null, %L)$q$)$$, :'np', :'np', :'emas'),
  'DK422', 'asset_account_invalid', 'tagihan rutin dengan dompet aset ditolak');
select pg_temp.call(tests.n(), format($$select api.create_bill(gen_random_uuid(), %L, 'Air', 100000,
  (select id from app.categories where space_id = %L and name = 'Listrik & Air'), 5::smallint, '2026-03-01', null, %L)$$,
  :'np', :'np', :'bca')) ->> 'bill_id' as bill \gset
select throws_ok(format($$select tests.api_exec(tests.n(), $q$update app.bills set account_id = %L where id = %L$q$)$$,
    :'emas', :'bill'),
  'DK422', 'asset_account_invalid', 'ganti dompet tagihan rutin ke dompet aset ditolak');
select tests.worker_val(null, $$select jobs.materialize_bills('2026-03-31')$$);
select throws_ok(format($$select pg_temp.call(tests.n(), $q$select api.post_bill_occurrence(p_client_id => gen_random_uuid(),
    p_occurrence_id => (select id from app.bill_occurrences where bill_id = %L order by due_on limit 1),
    p_account_id => %L)$q$)$$, :'bill', :'emas'),
  'DK422', 'asset_account_invalid', 'bayar tagihan dari dompet aset ditolak');
-- Pertahanan berlapis di bawah API: baris yang ditulis langsung tetap ditolak penjaga ledger.
select throws_ok(format($$select tests.api_exec(tests.n(), $q$do $d$ declare v uuid := gen_random_uuid(); begin
      set constraints all deferred;
      insert into app.entries (id, space_id, space_kind, kind, occurred_on, created_by, updated_by)
        values (v, %1$L, 'personal', 'income', '2026-03-10', %3$L, %3$L);
      insert into app.entry_lines (entry_id, space_id, role, account_id, amount) values (v, %1$L, 'main', %2$L, 1000);
      set constraints all immediate;
    end $d$ $q$)$$, :'np', :'emas', tests.n()),
  'DK422', 'asset_account_invalid', 'pemasukan ke dompet aset di luar api ditolak penjaga ledger');
savepoint s;
select pg_temp.val(tests.n(), :'emas', -100000);
select throws_ok(format($$select tests.api_exec(tests.n(), $q$do $d$ begin
      set constraints all deferred;
      update app.entry_lines set account_id = %L where entry_id = %L and role = 'counter';
      set constraints all immediate;
    end $d$ $q$)$$, :'tab', :'t2'),
  'DK422', 'asset_negative', 'mengganti tujuan setoran keluar dari dompet aset (baris lama) tetap dijaga');
rollback to savepoint s;
select throws_ok(format($$select tests.api_exec(tests.n(), $q$do $d$ begin
      set constraints all deferred;
      update app.entry_lines set account_id = %L where entry_id = %L and role = 'main';
      set constraints all immediate;
    end $d$ $q$)$$, :'emas', :'belanja_e'),
  'DK422', 'asset_account_invalid', 'mengganti dompet pengeluaran ke dompet aset di luar api ditolak');
select is(pg_temp.s5(), '650000/13070000/15720000', 'semua penolakan nol efek (BCA hanya bergeser oleh tarik Motor, setor Rumah, talangan, pokok utang)');

-- ===== Purge dan reset tidak terhalang =====
select tests.clock_at('2026-07-01 10:00+07');
select is(tests.worker_val(null, 'select jobs.purge_voided()')::int > 0, true,
  'purge_voided menghapus setoran/valuasi aset yang batal > 90 hari');
select is(tests.owner_val(null, format($q$select count(*) from app.entries e join app.entry_lines l on l.entry_id = e.id
    where l.account_id = %L and e.voided_at is not null$q$, :'emas')), '0', 'entri aset batal sudah terpurge');
select is(pg_temp.s5(), '650000/13070000/15720000', 'purge tidak mengubah nilai aset');
select tests.raw_exec(format($q$insert into auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
  values (%L, 'U', 'x@example.test', true, '2026-06-01 10:00+07', '2026-06-01 10:00+07')$q$, tests.x()));
select is(tests.worker_val(null, 'select jobs.purge_unfinished_users()'), '1',
  'akun setengah jadi dihapus walau tabel rincian aset berisi baris');
savepoint s;
select is(tests.owner_exec(null, format($q$delete from app.accounts where id = %L$q$, :'fdep')), 1::bigint,
  'dompet aset tanpa entri bisa dihapus (rincian ikut terhapus, reset tes tidak terhalang FK)');
select is(tests.owner_val(null, format($q$select count(*) from app.asset_details where account_id = %L$q$, :'fdep')), '0',
  'rincian ikut terhapus bersama dompetnya');
rollback to savepoint s;

-- ===== DQ19 nol =====
select is(tests.worker_val(null, $$select violations from jobs.dq_reconcile() where check_id = 'DQ19'$$), '0',
  'DQ19 nol: dompet aset tidak negatif, tidak dipakai jalur terlarang, rincian lengkap');
select is(tests.worker_val(null, $$select violations from jobs.dq_reconcile() where check_id = 'DQ03'$$), '0',
  'DQ03 nol: entri valuasi lolos cek bentuk ulang');
select is(tests.worker_val(null, $$select violations from jobs.dq_reconcile() where check_id = 'DQ01'$$), '0',
  'DQ01 nol: saldo dompet aset = Σ line');

select * from finish();
rollback;
