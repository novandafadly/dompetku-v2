-- Aset non-kas S14 sisi API (0141; plan S14 Task 3, K2, K4, K13 (a)(b)(c)(h); ruling Task 1; bingkai S14-AS2
-- sampai AS6): api.create_account pengganti (p_asset_kind; pocket aset wajib jenis K4 dan menulis
-- app.asset_details di transaksi yang sama; pocket lain wajib NULL; saham hanya Pribadi dan tanpa saldo
-- awal; wallet_type dompet aset tetap 'cash'; perilaku lama utuh), api.revalue_asset (DB menghitung selisih
-- dari saldo buku; selisih 0 = tidak menulis; satu entri valuation x_valuasi; tanggal >= opened_on dan <=
-- hari ini; idempoten client_id), api.asset_overview (INVOKER; dompet aset aktif, valuasi terakhir hidup),
-- api.reconcile_balance pengganti (pocket aset ditolak: Cocokkan saldo diganti Perbarui nilai), Ubah nilai
-- awal (update_entry opening_balance dompet aset, tidak negatif), api.archive_account (aset bernilai =
-- balance_not_zero). Setiap fungsi: sukses, validasi gagal (nol efek), rollback utuh (kegagalan disuntik),
-- idempotensi, bukan anggota (DK404 seragam). K2: anggota Bersama kedua menulis aset non-saham; Luar dan
-- pasangan (Pribadi) DK404. Galat tanpa nominal dan nama (dibandingkan persis). S5 lewat API, I6. Paralel
-- di 99_konkurensi. Jam dipatok 2026-03-20 WIB.
-- ID: T11, S5, I6, B23
begin;
select plan(104);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 10000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Celengan', 'tabungan', 1000000, '2026-01-01') as tab,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 0, '2026-01-01') as kan,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 2000000, '2026-01-01') as kas,
       tests.account(tests.f(), :'fp', 'Mandiri', 'operasional', 1000000, '2026-01-01') as mdr \gset
-- Luar = akun terautentikasi tanpa profil dan tanpa ruang.
select tests.raw_exec(format($q$insert into auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
  values (%L, 'U', 'x@example.test', true, now(), now())$q$, tests.x()));
select tests.owner_val(null, format($q$select id from app.categories where space_id = %L and name = 'Belanja'$q$, :'np'))
  as belanja \gset

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
-- Galat persis: sqlstate:pesan:detail (membuktikan tanpa nominal dan nama); 'ok' bila berhasil.
create function pg_temp.err(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v_s text; v_m text; v_d text;
begin
  perform tests.web_val(p_uid, p_sql);
  return 'ok';
exception when others then
  get stacked diagnostics v_s = returned_sqlstate, v_m = message_text, v_d = pg_exception_detail;
  return v_s || ':' || v_m || ':' || coalesce(v_d, '');
end $$;
create function pg_temp.ca_sql(p_space uuid, p_name text, p_pocket text, p_asset text, p_opening bigint default 0,
  p_on date default null, p_client uuid default null, p_type text default 'bank') returns text
language sql as $$
  select format($q$select api.create_account(p_client_id => %L, p_space_id => %L, p_name => %L,
      p_pocket => %L::app.pocket, p_wallet_type => %L::app.wallet_type, p_opened_on => %L::date,
      p_opening_balance => %s::bigint, p_asset_kind => %L)$q$,
    coalesce(p_client, gen_random_uuid()), p_space, p_name, p_pocket, p_type, p_on, coalesce(p_opening::text, 'null'),
    p_asset)
$$;
create function pg_temp.ca(p_uid uuid, p_space uuid, p_name text, p_asset text, p_opening bigint default 0,
  p_on date default null) returns uuid
language sql as $$
  select (pg_temp.call(p_uid, pg_temp.ca_sql(p_space, p_name, 'aset', p_asset, p_opening, p_on)) ->> 'account_id')::uuid
$$;
create function pg_temp.rv_sql(p_acc uuid, p_value bigint, p_on date default null, p_client uuid default null)
returns text
language sql as $$
  select format($q$select api.revalue_asset(%L, %L, %s::bigint, %L::date)$q$,
    coalesce(p_client, gen_random_uuid()), p_acc, coalesce(p_value::text, 'null'), p_on)
$$;
create function pg_temp.rv(p_uid uuid, p_acc uuid, p_value bigint, p_on date default null) returns jsonb
language sql as $$ select pg_temp.call(p_uid, pg_temp.rv_sql(p_acc, p_value, p_on)) $$;
-- Keadaan dompet aset (owner): saldo/jumlah entri valuasi hidup.
create function pg_temp.st(p_acc uuid) returns text
language sql as $$
  select tests.balance(p_acc) || '/' || tests.owner_val(null, format($q$select count(*) from app.entries e
    join app.entry_lines l on l.entry_id = e.id where l.account_id = %L and e.kind = 'valuation' and e.voided_at is null$q$,
    p_acc))
$$;
-- Jumlah baris: dompet/rincian/entri/kunci idempotensi (nol efek).
create function pg_temp.cnt() returns text
language sql as $$
  select tests.owner_val(null, $q$select (select count(*) from app.accounts) || '/' || (select count(*) from app.asset_details)
    || '/' || (select count(*) from app.entries) || '/' || (select count(*) from app.idempotency_keys)$q$)
$$;
-- Ringkasan aset satu ruang (urutan hasil fungsi).
create function pg_temp.ov(p_uid uuid, p_space uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select coalesce(string_agg(t.name || ':' || t.asset_kind || ':' || t.balance || ':'
      || coalesce(t.last_valued_on::text, '-') || ':' || coalesce(t.last_change::text, '-'), ',' order by t.o), '')
      from api.asset_overview(%L) with ordinality t (account_id, name, asset_kind, balance, last_valued_on, last_change, o)$q$,
    p_space))
$$;
create function pg_temp.void(p_entry uuid, p_uid uuid default null) returns jsonb
language sql as $$
  select pg_temp.call(coalesce(p_uid, tests.n()), format($q$select api.void_entry(gen_random_uuid(), %L,
    (select version from app.entries where id = %L))$q$, p_entry, p_entry))
$$;
create function pg_temp.restore(p_entry uuid) returns jsonb
language sql as $$
  select pg_temp.call(tests.n(), format($q$select api.restore_entry(gen_random_uuid(), %L,
    (select version from app.entries where id = %L))$q$, p_entry, p_entry))
$$;
create function pg_temp.xfer(p_from uuid, p_to uuid, p_amount bigint, p_on date default '2026-03-16') returns uuid
language sql as $$
  select (pg_temp.call(tests.n(), format($q$select api.create_transfer(gen_random_uuid(),
      (select space_id from app.accounts where id = %1$L), %1$L, %2$L, %3$s, 0, %4$L::date)$q$,
    p_from, p_to, p_amount, p_on)) ->> 'entry_id')::uuid
$$;
-- Kekayaan bersih Pribadi Novanda di tes = Σ saldo dompet bukan Kantor (api.net_worth baru di 0144).
create function pg_temp.nw() returns bigint
language sql as $$
  select tests.web_val(tests.n(), format($q$select sum(balance) from app.account_balances where space_id = %L
    and pocket <> 'kantor'$q$, tests.space_id(tests.n(), 'personal')))::bigint
$$;
-- I6 Pribadi Novanda Maret: kategori, anggaran, Σ pemasukan/pengeluaran (report_lines, period_summary), aman
-- dipakai, Σ pemasukan/pengeluaran Ekspor.
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
      || '|' || (select s::text from api.safe_to_spend(%1$L, '2026-03-20') s)
      || '|' || (select coalesce(string_agg(report_class || '=' || s, ',' order by report_class collate "C"), '')
         from (select report_class, sum(amount) as s from api.export_entries(%1$L, '2026-03-01', '2026-03-31')
                where report_class in ('income', 'expense', 'expense_fee') group by report_class) x)$q$,
    tests.space_id(tests.n(), 'personal')))
$$;
-- Kegagalan disuntik (owner, hanya aktif bila GUC tests.fail_after diset di sesi ini): sesudah rincian aset
-- ditulis ('asset_details') atau sesudah line entri valuasi ditulis ('valuation').
select tests.owner_exec(null, $q$create function private.tes_fail_aset() returns trigger
  language plpgsql set search_path = '' as $f$
  begin
    if pg_catalog.current_setting('tests.fail_after', true) = tg_table_name
       or (pg_catalog.current_setting('tests.fail_after', true) = 'valuation' and tg_table_name = 'entry_lines'
           and exists (select 1 from app.entries e where e.id = new.entry_id and e.kind = 'valuation')) then
      raise exception using errcode = 'P0001', message = 'fail_after';
    end if;
    return null;
  end $f$$q$);
select tests.owner_exec(null, 'create trigger tes_fail_aset after insert on app.asset_details
  for each row execute function private.tes_fail_aset()');
select tests.owner_exec(null, 'create trigger tes_fail_aset after insert on app.entry_lines
  for each row execute function private.tes_fail_aset()');

-- ===== api.create_account: dompet aset (K3, K4, ruling Task 1) =====
select pg_temp.call(tests.n(), pg_temp.ca_sql(:'np', 'Emas Antam', 'aset', 'emas', 2000000, '2026-02-01',
  'aaaaaaaa-0000-0000-0000-000000000001')) as r_emas \gset
select (:'r_emas'::jsonb ->> 'account_id') as emas \gset
select is((:'r_emas'::jsonb - 'account_id' - 'entry_id') || jsonb_build_object('entry', :'r_emas'::jsonb ? 'entry_id'
    and :'r_emas'::jsonb ->> 'entry_id' is not null),
  '{"entry": true, "version": 1, "replayed": false, "warnings": []}'::jsonb,
  'aset emas dengan nilai awal: hasil = dompet + entri saldo awal, bukan replay');
select is(tests.owner_val(null, format($q$select a.pocket || '|' || a.wallet_type || '|' || a.opened_on || '|' || d.asset_kind
    || '|' || d.space_kind || '|' || (d.space_id = a.space_id) || '|' || (d.created_by = %L) || '|' || coalesce(d.note, '-')
    from app.accounts a join app.asset_details d on d.account_id = a.id where a.id = %L$q$, tests.n(), :'emas')),
  'aset|cash|2026-02-01|emas|personal|true|true|-',
  'rincian aset ditulis bersama dompetnya (jenis, ruang, pembuat); wallet_type dompet aset tetap cash');
select is(pg_temp.st(:'emas'), '2000000/0', 'nilai awal = saldo awal (opening_balance)');
select is(tests.owner_val(null, format($q$select e.kind || ':' || e.occurred_on || ':' || app.report_class(e.kind, l.role,
    'aset', e.space_kind, e.direction, e.reimbursable) from app.entries e join app.entry_lines l on l.entry_id = e.id
    where l.account_id = %L$q$, :'emas')), 'opening_balance:2026-02-01:x_koreksi', 'nilai awal berkelas x_koreksi');
select pg_temp.call(tests.n(), pg_temp.ca_sql(:'np', 'Ajaib', 'aset', 'saham', 0, null, null, null)) ->> 'account_id'
  as saham \gset
select is(tests.owner_val(null, format($q$select a.wallet_type || '|' || a.opened_on || '|' || d.asset_kind
    from app.accounts a join app.asset_details d on d.account_id = a.id where a.id = %L$q$, :'saham')),
  'cash|2026-03-20|saham', 'saham di Pribadi tanpa nilai awal; wallet_type NULL untuk aset diterima (tetap cash)');
select pg_temp.ca(tests.f(), :'sh', 'Motor Bersama', 'kendaraan', 15000000, '2026-01-15') as motor \gset
select pg_temp.ca(tests.n(), :'sh', 'Rumah', 'properti') as rumah \gset
select is(tests.owner_val(null, format($q$select string_agg(d.asset_kind || ':' || d.space_kind || ':'
    || case d.created_by when %L then 'N' else 'F' end, ',' order by d.asset_kind) from app.asset_details d
    where d.account_id in (%L, %L)$q$, tests.n(), :'motor', :'rumah')),
  'kendaraan:shared:F,properti:shared:N', 'anggota Bersama kedua dan pemilik membuat aset Bersama (K2)');
select is(pg_temp.err(tests.n(), format($$select api.create_account(gen_random_uuid(), %L, 'Dompet Lama', 'operasional',
    'ewallet') ->> 'account_id'$$, :'np')), 'ok', 'panggilan lama 5 argumen tanpa jenis aset tetap jalan');
select is(tests.owner_val(null, format($q$select wallet_type || '|' || (select count(*) from app.asset_details d
    where d.account_id = a.id) from app.accounts a where space_id = %L and name = 'Dompet Lama'$q$, :'np')),
  'ewallet|0', 'dompet bukan aset: wallet_type dari argumen, tanpa rincian aset');

-- Validasi (nol efek).
select pg_temp.cnt() as cnt_before \gset
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'np', 'Tanpa Jenis', 'aset', null)), 'DK400:asset_kind_invalid:asset_kind',
  'aset tanpa jenis ditolak (K4)');
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'np', 'Kripto', 'aset', 'kripto')), 'DK400:asset_kind_invalid:asset_kind',
  'jenis di luar K4 ditolak');
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'np', 'Bank Emas', 'operasional', 'emas')),
  'DK400:asset_kind_invalid:asset_kind', 'dompet bukan aset dengan jenis aset ditolak');
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'np', 'Celengan Emas', 'tabungan', 'emas')),
  'DK400:asset_kind_invalid:asset_kind', 'tabungan dengan jenis aset ditolak');
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'sh', 'Saham Bersama', 'aset', 'saham')), 'DK422:pocket_personal_only:',
  'saham di Bersama ditolak (K2)');
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'np', 'Stockbit', 'aset', 'saham', 1000)),
  'DK400:invalid_argument:opening_balance', 'saham dengan nilai awal ditolak (ruling: isi lewat beli/saham berjalan)');
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'np', 'Emas Minus', 'aset', 'emas', -1)),
  'DK400:invalid_argument:opening_balance', 'nilai awal negatif ditolak');
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'np', 'Emas Raksasa', 'aset', 'emas', 10000000000001)),
  'DK400:invalid_argument:opening_balance', 'nilai awal > 10^13 ditolak');
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'np', 'Emas Besok', 'aset', 'emas', 1000, '2026-03-21')),
  'DK400:invalid_argument:occurred_on', 'tanggal nilai awal di masa depan ditolak');
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'np', '  ', 'aset', 'emas')), 'DK400:invalid_argument:name',
  'nama kosong ditolak');
select is(left(pg_temp.err(tests.n(), pg_temp.ca_sql(:'np', 'BCA', 'aset', 'emas')), 6), '23505:',
  'nama bentrok dengan dompet lain = 23505 indeks (server: name_taken)');
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'np', 'Tunai', 'operasional', null, 0, null, null, null)),
  'DK400:invalid_argument:pocket', 'dompet bukan aset tetap wajib wallet_type');
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'sh', 'Kantor Bersama', 'kantor', null)), 'DK422:kantor_personal_only:',
  'perilaku lama: Kas Kantor hanya Pribadi');
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'sh', 'RDN Bersama', 'trading', null)), 'DK422:pocket_personal_only:',
  'perilaku lama: trading hanya Pribadi');
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'np', 'Sistem', 'patungan', null)), 'DK400:invalid_argument:pocket',
  'perilaku lama: patungan bukan pilihan pengguna');
select is(pg_temp.cnt(), :'cnt_before', 'semua penolakan nol efek (dompet, rincian, entri, kunci idempotensi)');

-- Rollback utuh: kegagalan sesudah rincian ditulis membatalkan dompet, saldo awal, dan kunci idempotensi.
savepoint gagal;
select set_config('tests.fail_after', 'asset_details', true);
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'np', 'Emas Gagal', 'aset', 'emas', 1000, null,
    'aaaaaaaa-0000-0000-0000-000000000002')), 'P0001:fail_after:', 'kegagalan disuntik sesudah rincian aset ditulis');
select is(pg_temp.cnt(), :'cnt_before', 'rollback utuh: dompet, rincian, saldo awal, kunci idempotensi tidak tersisa');
select set_config('tests.fail_after', '', true);
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'np', 'Emas Gagal', 'aset', 'emas', 1000, null,
    'aaaaaaaa-0000-0000-0000-000000000002')), 'ok', 'client_id yang sama bisa dipakai ulang sesudah rollback');
rollback to savepoint gagal;
select set_config('tests.fail_after', '', true);

-- Idempotensi.
select is(pg_temp.call(tests.n(), pg_temp.ca_sql(:'np', 'Emas Antam', 'aset', 'emas', 2000000, '2026-02-01',
    'aaaaaaaa-0000-0000-0000-000000000001')), :'r_emas'::jsonb - 'replayed' || '{"replayed": true}',
  'client_id sama dan isi sama = hasil pertama (replay)');
select is(pg_temp.cnt(), :'cnt_before', 'replay tidak menulis dompet atau rincian kedua');
select is(pg_temp.err(tests.n(), pg_temp.ca_sql(:'np', 'Emas Antam', 'aset', 'lainnya', 2000000, '2026-02-01',
    'aaaaaaaa-0000-0000-0000-000000000001')), 'DK410:idempotency_key_reused:',
  'client_id sama dengan jenis aset lain = idempotency_key_reused');

-- Bukan anggota (DK404 seragam, tanpa oracle).
select is(pg_temp.err(tests.f(), pg_temp.ca_sql(:'np', 'Emas Titipan', 'aset', 'emas')), 'DK404:space_not_found:',
  'Farida tidak bisa membuat aset di Pribadi Novanda [B23]');
select is(pg_temp.err(tests.f(), pg_temp.ca_sql(gen_random_uuid(), 'Emas Titipan', 'aset', 'emas')), 'DK404:space_not_found:',
  'ruang yang tidak ada = galat yang sama (tanpa oracle)');
select is(pg_temp.err(tests.x(), pg_temp.ca_sql(:'sh', 'Emas Luar', 'aset', 'emas')), 'DK404:space_not_found:',
  'Luar tidak bisa membuat aset di Bersama [B23]');
select is(pg_temp.cnt(), :'cnt_before', 'percobaan bukan anggota nol efek');

-- ===== api.revalue_asset =====
select pg_temp.call(tests.n(), pg_temp.rv_sql(:'emas', 2500000, null, 'aaaaaaaa-0000-0000-0000-000000000011')) as r_up \gset
select is(:'r_up'::jsonb - 'entry_id', '{"delta": 500000, "version": 1, "replayed": false, "unchanged": false, "warnings": []}'::jsonb,
  'nilai naik: selisih dihitung DB dari saldo buku');
select is(tests.owner_val(null, format($q$select e.kind || ':' || e.occurred_on || ':' || e.space_kind || ':' || e.version || ':'
    || (e.created_by = %L) || ':' || (select string_agg(l.role || '=' || l.amount || '@' || (l.account_id = %L), ',')
      from app.entry_lines l where l.entry_id = e.id) || ':' || (select count(*) from app.entry_history h where h.entry_id = e.id)
    || ':' || (select string_agg(r.report_class, ',') from app.report_lines r where r.entry_id = e.id)
    from app.entries e where e.id = %L$q$, tests.n(), :'emas', :'r_up'::jsonb ->> 'entry_id')),
  'valuation:2026-03-20:personal:1:true:main=500000@true:1:x_valuasi',
  'satu entri valuation hari ini (WIB): satu line main di dompet aset, riwayat, kelas x_valuasi');
select is(pg_temp.st(:'emas'), '2500000/1', 'nilai aset = nilai baru');
select pg_temp.rv(tests.n(), :'emas', 2200000, '2026-03-10') as r_down \gset
select is((:'r_down'::jsonb ->> 'delta') || ':' || tests.owner_val(null, format($q$select occurred_on from app.entries where id = %L$q$,
    :'r_down'::jsonb ->> 'entry_id')), '-300000:2026-03-10', 'nilai turun dengan tanggal lampau (p_on)');
select is(pg_temp.st(:'emas'), '2200000/2', 'nilai aset turun');
select is(pg_temp.rv(tests.n(), :'emas', 2200000), '{"delta": 0, "version": 1, "entry_id": null, "replayed": false, "unchanged": true, "warnings": []}'::jsonb,
  'nilai sama = tidak menulis (sukses, unchanged)');
select is(pg_temp.st(:'emas'), '2200000/2', 'nilai sama tidak menambah entri');
savepoint s;
select is(pg_temp.rv(tests.n(), :'emas', 0, '2026-02-01') ->> 'delta', '-2200000',
  'nilai 0 boleh (aset tidak bernilai), tanggal = tanggal mulai dompet boleh');
select is(pg_temp.st(:'emas'), '0/3', 'nilai aset 0');
select is(pg_temp.rv(tests.n(), :'emas', 10000000000000) ->> 'delta', '10000000000000', 'nilai 10^13 (batas atas) diterima');
rollback to savepoint s;
select is(pg_temp.rv(tests.f(), :'motor', 14000000) ->> 'delta', '-1000000', 'Farida memperbarui aset Bersama yang ia buat (K2)');
select pg_temp.rv(tests.f(), :'rumah', 900000000) ->> 'entry_id' as v_rumah \gset
select is(tests.owner_val(null, format($q$select (created_by = %L) || ':' || space_kind from app.entries where id = %L$q$,
    tests.f(), :'v_rumah')), 'true:shared', 'Farida memperbarui aset Bersama buatan Novanda (K2)');

-- Validasi (nol efek).
select tests.owner_exec(null, format($q$update app.accounts set opened_on = '2026-01-01' where id = %L$q$, :'saham'));
select pg_temp.ca(tests.n(), :'np', 'Arloji', 'lainnya', 0) as arloji \gset
select tests.web_val(tests.n(), format($$select api.archive_account(%L)$$, :'arloji'));
select pg_temp.cnt() as cnt_before \gset
select is(pg_temp.err(tests.n(), pg_temp.rv_sql(:'emas', -1)), 'DK400:invalid_argument:value', 'nilai negatif ditolak');
select is(pg_temp.err(tests.n(), pg_temp.rv_sql(:'emas', null)), 'DK400:invalid_argument:value', 'nilai kosong ditolak');
select is(pg_temp.err(tests.n(), pg_temp.rv_sql(:'emas', 10000000000001)), 'DK400:invalid_argument:value',
  'nilai > 10^13 ditolak');
select is(pg_temp.err(tests.n(), pg_temp.rv_sql(:'emas', 1, '2026-03-21')), 'DK400:invalid_argument:occurred_on',
  'tanggal masa depan ditolak');
select is(pg_temp.err(tests.n(), pg_temp.rv_sql(:'emas', 1, '2026-01-31')), 'DK422:before_opening:',
  'tanggal sebelum dompet aset dimulai ditolak');
select is(pg_temp.err(tests.n(), pg_temp.rv_sql(:'bca', 1)), 'DK422:asset_account_invalid:account_id',
  'dompet operasional bukan aset');
select is(pg_temp.err(tests.n(), pg_temp.rv_sql(:'tab', 1)), 'DK422:asset_account_invalid:account_id',
  'dompet tabungan bukan aset');
select is(pg_temp.err(tests.n(), pg_temp.rv_sql(:'kan', 1)), 'DK422:asset_account_invalid:account_id',
  'Kas Kantor bukan aset');
select is(pg_temp.err(tests.n(), pg_temp.rv_sql(:'saham', 1)), 'DK422:stock_account_trade_only:account_id',
  'dompet saham hanya berubah lewat trade (ruling Task 1)');
select is(pg_temp.err(tests.n(), pg_temp.rv_sql(:'arloji', 1)), 'DK422:account_archived:', 'aset terarsip ditolak');
select is(pg_temp.err(tests.n(), pg_temp.rv_sql(:'emas', 1, null, 'aaaaaaaa-0000-0000-0000-000000000011')),
  'DK410:idempotency_key_reused:', 'client_id sama dengan nilai lain = idempotency_key_reused');
select is(pg_temp.cnt(), :'cnt_before', 'semua penolakan nol efek');

-- Rollback utuh.
savepoint gagal;
select set_config('tests.fail_after', 'valuation', true);
select is(pg_temp.err(tests.n(), pg_temp.rv_sql(:'emas', 2400000, null, 'aaaaaaaa-0000-0000-0000-000000000012')),
  'P0001:fail_after:', 'kegagalan disuntik sesudah line valuasi ditulis');
select is(pg_temp.cnt() || ' ' || pg_temp.st(:'emas'), :'cnt_before' || ' 2200000/2',
  'rollback utuh: entri, line, riwayat, kunci idempotensi, nilai aset tidak berubah');
rollback to savepoint gagal;
select set_config('tests.fail_after', '', true);

-- Idempotensi.
select is(pg_temp.call(tests.n(), pg_temp.rv_sql(:'emas', 2500000, null, 'aaaaaaaa-0000-0000-0000-000000000011')),
  :'r_up'::jsonb - 'replayed' || '{"replayed": true}', 'client_id sama = hasil pertama walau nilai sudah berubah (replay)');
select is(pg_temp.st(:'emas'), '2200000/2', 'replay tidak menulis selisih kedua');
select is(pg_temp.call(tests.n(), pg_temp.rv_sql(:'emas', 2200000, null, 'aaaaaaaa-0000-0000-0000-000000000013'))
    || pg_temp.call(tests.n(), pg_temp.rv_sql(:'emas', 2200000, null, 'aaaaaaaa-0000-0000-0000-000000000013')),
  '{"delta": 0, "version": 1, "entry_id": null, "replayed": true, "unchanged": true, "warnings": []}'::jsonb,
  'replay nilai sama tetap unchanged');

-- Bukan anggota (DK404 seragam).
select is(pg_temp.err(tests.f(), pg_temp.rv_sql(:'emas', 1)), 'DK404:account_not_found:account_id',
  'Farida tidak bisa memperbarui aset Pribadi Novanda [B23]');
select is(pg_temp.err(tests.f(), pg_temp.rv_sql(gen_random_uuid(), 1)), 'DK404:account_not_found:account_id',
  'dompet yang tidak ada = galat yang sama (tanpa oracle)');
select is(pg_temp.err(tests.x(), pg_temp.rv_sql(:'rumah', 1)), 'DK404:account_not_found:account_id',
  'Luar tidak bisa memperbarui aset Bersama [B23]');
select is(pg_temp.cnt() || ' ' || pg_temp.st(:'emas'), :'cnt_before' || ' 2200000/2', 'percobaan bukan anggota nol efek');

-- ===== api.asset_overview =====
select tests.owner_exec(null, format($q$update app.accounts set sort_order = case id when %L then 2 else 1 end
  where id in (%L, %L)$q$, :'emas', :'emas', :'saham'));
select is(pg_temp.ov(tests.n(), :'np'), 'Ajaib:saham:0:-:-,Emas Antam:emas:2200000:2026-03-20:500000',
  'ringkasan Pribadi: hanya dompet aset aktif (tanpa terarsip), urut sort_order; valuasi terakhir hidup');
select is(pg_temp.ov(tests.n(), :'sh') = pg_temp.ov(tests.f(), :'sh'), true, 'kedua anggota melihat ringkasan Bersama yang sama (K2)');
select is(pg_temp.ov(tests.f(), :'sh') like '%Motor Bersama:kendaraan:14000000:2026-03-20:-1000000%'
    and pg_temp.ov(tests.f(), :'sh') like '%Rumah:properti:900000000:2026-03-20:900000000%', true,
  'ringkasan Bersama memuat aset kedua anggota');
select pg_temp.void(:'r_up'::jsonb ->> 'entry_id');
select is(pg_temp.ov(tests.n(), :'np'), 'Ajaib:saham:0:-:-,Emas Antam:emas:1700000:2026-03-10:-300000',
  'valuasi batal tidak dihitung: valuasi hidup terakhir = turun 10 Mar');
select pg_temp.restore(:'r_up'::jsonb ->> 'entry_id');
select is(tests.web_val(tests.f(), format($$select count(*) from api.asset_overview(%L)$$, :'fp')), '0',
  'ruang tanpa aset = tanpa baris');
select is(pg_temp.err(tests.f(), format($$select count(*) from api.asset_overview(%L)$$, :'np')), 'DK404:space_not_found:',
  'Farida tidak membaca ringkasan aset Pribadi Novanda [B23]');
select is(pg_temp.err(tests.x(), format($$select count(*) from api.asset_overview(%L)$$, :'sh')), 'DK404:space_not_found:',
  'Luar tidak membaca ringkasan aset Bersama [B23]');
select is(tests.owner_val(null, $q$select string_agg(p.parameter_name || ':' || p.data_type, ',' order by p.ordinal_position)
    from information_schema.parameters p join information_schema.routines r on r.specific_name = p.specific_name
    where r.routine_schema = 'api' and r.routine_name = 'asset_overview' and p.parameter_mode = 'OUT'$q$),
  'account_id:uuid,name:text,asset_kind:text,balance:bigint,last_valued_on:date,last_change:bigint',
  'kolom asset_overview (kontrak UI; market_value saham = Task 5)');

-- ===== api.reconcile_balance: dompet aset ditolak (Perbarui nilai) =====
select pg_temp.cnt() as cnt_before \gset
select is(pg_temp.err(tests.n(), format($$select api.reconcile_balance(gen_random_uuid(), %L, 0)$$, :'emas')),
  'DK422:asset_account_invalid:account_id', 'Cocokkan saldo dompet aset ditolak');
select is(pg_temp.err(tests.f(), format($$select api.reconcile_balance(gen_random_uuid(), %L, 0)$$, :'motor')),
  'DK422:asset_account_invalid:account_id', 'Cocokkan saldo aset Bersama ditolak');
select is(pg_temp.err(tests.f(), format($$select api.reconcile_balance(gen_random_uuid(), %L, 0)$$, :'emas')),
  'DK404:account_not_found:account_id', 'aset Pribadi pasangan tetap DK404 (bukan asset_account_invalid: tanpa oracle)');
select is(pg_temp.cnt(), :'cnt_before', 'penolakan nol efek');
select pg_temp.call(tests.n(), format($$select api.reconcile_balance('aaaaaaaa-0000-0000-0000-000000000021', %L, 9000000)$$, :'bca'))
  as r_rec \gset
select is(tests.balance(:'bca') || ':' || tests.owner_val(null, format($q$select kind from app.entries where id = %L$q$,
    :'r_rec'::jsonb ->> 'entry_id')), '9000000:adjustment', 'perilaku lama: Cocokkan saldo dompet operasional');
select is(pg_temp.call(tests.n(), format($$select api.reconcile_balance('aaaaaaaa-0000-0000-0000-000000000021', %L, 9000000)$$,
    :'bca')), :'r_rec'::jsonb - 'replayed' || '{"replayed": true}', 'perilaku lama: replay Cocokkan saldo');
select is(pg_temp.err(tests.n(), format($$select api.reconcile_balance(gen_random_uuid(), %L, 10000000000001)$$, :'bca')),
  'DK400:invalid_argument:target_balance', 'perilaku lama: saldo di luar batas ditolak');

-- ===== Ubah nilai awal (update_entry saldo awal dompet aset): boleh, tidak negatif =====
select tests.owner_val(null, format($q$select e.id from app.entries e join app.entry_lines l on l.entry_id = e.id
  where l.account_id = %L and e.kind = 'opening_balance'$q$, :'emas')) as emas_ob \gset
create function pg_temp.ob_sql(p_entry uuid, p_acc uuid, p_amount bigint) returns text
language sql as $$
  select format($q$select api.update_entry(gen_random_uuid(), %L, (select version from app.entries where id = %L), %L,
    %s, null, null, null, false, true)$q$, p_entry, p_entry, p_acc, p_amount)
$$;
select is(pg_temp.err(tests.n(), pg_temp.ob_sql(:'emas_ob', :'emas', 2300000)), 'ok', 'nilai awal dinaikkan');
select is(pg_temp.st(:'emas'), '2500000/2', 'nilai aset ikut naik (nilai awal 2,3 jt + valuasi +500 rb − 300 rb)');
select is(pg_temp.err(tests.n(), pg_temp.ob_sql(:'emas_ob', :'emas', 1)), 'ok',
  'nilai awal diturunkan selama aset tidak negatif');
select is(pg_temp.st(:'emas'), '200001/2', 'nilai aset turun');
select is(pg_temp.err(tests.n(), pg_temp.ob_sql(:'emas_ob', :'emas', 2300000)), 'ok', 'nilai awal dikembalikan');
select pg_temp.xfer(:'emas', :'bca', 2000000) as cair \gset
select is(pg_temp.err(tests.n(), pg_temp.ob_sql(:'emas_ob', :'emas', 1799999)), 'DK422:asset_negative:account_id',
  'nilai awal di bawah yang sudah dicairkan ditolak walau p_allow_negative (aset tidak bisa minus)');
select is(pg_temp.st(:'emas'), '500000/2', 'penolakan nol efek');

-- ===== api.archive_account: aset bernilai ditolak =====
select is(pg_temp.err(tests.n(), format($$select api.archive_account(%L)$$, :'emas')), 'DK422:balance_not_zero:',
  'arsip aset yang masih bernilai ditolak (balance_not_zero)');
select is(pg_temp.err(tests.f(), format($$select api.archive_account(%L)$$, :'motor')), 'DK422:balance_not_zero:',
  'arsip aset Bersama yang masih bernilai ditolak');
savepoint s;
select pg_temp.rv(tests.n(), :'emas', 0);
select is(pg_temp.call(tests.n(), format($$select api.archive_account(%L)$$, :'emas')) ->> 'archived', 'true',
  'nilai diperbarui ke 0 lalu arsip berhasil');
select is(pg_temp.ov(tests.n(), :'np'), 'Ajaib:saham:0:-:-', 'aset terarsip keluar dari ringkasan');
select is(pg_temp.err(tests.n(), pg_temp.rv_sql(:'emas', 1)), 'DK422:account_archived:', 'perbarui nilai aset terarsip ditolak');
rollback to savepoint s;
select is(pg_temp.call(tests.n(), format($$select api.archive_account(%L)$$, :'saham')) ->> 'archived', 'true',
  'dompet saham kosong bisa diarsip (lembar > 0 = account_has_holdings, Task 5)');

-- ===== S5 lewat API (K13 a): isi 500 rb, ubah ke 600 rb, lalu Perbarui nilai =====
select pg_temp.ca(tests.n(), :'np', 'Emas S5', 'emas', 0, '2026-01-01') as s5 \gset
select pg_temp.nw() as nw0 \gset
select pg_temp.xfer(:'bca', :'s5', 500000, '2026-03-05') as t1 \gset
select is(tests.balance(:'s5') || '/' || tests.balance(:'bca') || '/' || pg_temp.nw(),
  '500000/10500000/' || :'nw0', 'isi 500 rb: aset 500 rb, BCA −500 rb, kekayaan bersih tetap [S5]');
select pg_temp.void(:'t1');
select pg_temp.xfer(:'bca', :'s5', 600000, '2026-03-05') as t2 \gset
select is(tests.balance(:'s5') || '/' || tests.balance(:'bca') || '/' || pg_temp.nw(),
  '600000/10400000/' || :'nw0', 'ubah ke 600 rb (batal + catat ulang): aset 600 rb, BCA −600 rb, kekayaan bersih tetap [S5]');
select is(pg_temp.rv(tests.n(), :'s5', 600000) ->> 'unchanged', 'true',
  'Perbarui nilai ke 600 rb sesudah setoran = tanpa entri (tidak menggandakan) [S5]');
select pg_temp.rv(tests.n(), :'s5', 650000) ->> 'entry_id' as v_s5 \gset
select is(tests.balance(:'s5') || '/' || tests.balance(:'bca') || '/' || (pg_temp.nw() - :'nw0'::bigint),
  '650000/10400000/50000', 'Perbarui nilai 650 rb: hanya aset dan kekayaan bersih yang naik, BCA tetap [S5]');
select pg_temp.void(:'v_s5');
select is(tests.balance(:'s5') || '/' || (pg_temp.nw() - :'nw0'::bigint), '600000/0', 'batal valuasi tepat sekali [S5]');
select is(pg_temp.err(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, (select version from app.entries
    where id = %L))$$, :'v_s5', :'v_s5')), 'DK422:already_voided:', 'batal kedua ditolak [S5]');
select pg_temp.restore(:'v_s5');
select is(tests.balance(:'s5') || '/' || (pg_temp.nw() - :'nw0'::bigint), '650000/50000', 'pulihkan valuasi tepat sekali [S5]');
select is(pg_temp.err(tests.n(), format($$select api.restore_entry(gen_random_uuid(), %L, (select version from app.entries
    where id = %L))$$, :'v_s5', :'v_s5')), 'DK422:not_voided:', 'pulihkan kedua ditolak [S5]');

-- ===== I6: revalue_asset tidak mengubah pemasukan/pengeluaran, anggaran, aman dipakai, Laporan, Ekspor =====
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 75000, %L,
  '2026-03-16')$$, :'np', :'bca', :'belanja'));
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'income', 300000, null,
  '2026-03-16')$$, :'np', :'bca'));
select tests.web_exec(tests.n(), format($$select api.set_budget(%L, %L, '2026-03-01', 300000)$$, :'np', :'belanja'));
select pg_temp.i6() as i6_before \gset
select tests.web_val(tests.n(), format($$select string_agg(report_class || ':' || direction || ':' || amount, ',' order by direction)
  from api.excluded_summary(%L, '2026-03-01', '2026-03-31') where report_class = 'x_valuasi'$$, :'np')) as exc_before \gset
select pg_temp.rv(tests.n(), :'s5', 800000, '2026-03-18');
select pg_temp.rv(tests.n(), :'s5', 700000, '2026-03-19');
select is(pg_temp.i6(), :'i6_before',
  'revalue_asset naik/turun tidak mengubah kategori, anggaran, Σ pemasukan/pengeluaran, period_summary, aman dipakai, Ekspor [I6]');
select isnt(tests.web_val(tests.n(), format($$select string_agg(report_class || ':' || direction || ':' || amount, ',' order by direction)
    from api.excluded_summary(%L, '2026-03-01', '2026-03-31') where report_class = 'x_valuasi'$$, :'np')), :'exc_before',
  'Laporan: perubahan nilai hanya bergeser di "Tidak termasuk" (x_valuasi)');
select is(tests.web_val(tests.n(), format($$select count(*) from api.export_entries(%L, '2026-03-01', '2026-03-31')
    where kind = 'valuation' and report_class = 'x_valuasi'$$, :'np'))::int >= 2, true, 'Ekspor: baris valuasi berkelas x_valuasi');

-- ===== DQ nol =====
select is(tests.worker_val(null, $$select string_agg(check_id || '=' || violations, ',' order by check_id)
    from jobs.dq_reconcile() where check_id in ('DQ01', 'DQ03', 'DQ19')$$), 'DQ01=0,DQ03=0,DQ19=0',
  'DQ01/DQ03/DQ19 nol: setiap dompet aset punya rincian, valuasi lolos cek bentuk, saldo = Σ line');

select * from finish();
rollback;
