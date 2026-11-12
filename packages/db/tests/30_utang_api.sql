-- API utang/piutang S11 (0131; plan S11 Task 4, K1 sampai K7, K10): kontak (create/rename/archive),
-- create_debt (mode baru dan berjalan, kontak baru sekaligus), pay_debt (payment_exceeds,
-- payment_before_opened, saldo_negatif, idempoten), update_debt_info (T6/S4), batal cicilan lewat
-- void_entry (T8), void_debt/restore_debt (T9, K5), penutupan jalur generik (pokok hanya lewat
-- void_debt, update_entry/move_entry_to_space menolak kind utang, purge, Sampah), purge 90 hari, baca
-- (list_contacts, list_debts, debt_detail). Konkurensi (C3, C6, INT-12) di 99_konkurensi.sql.
-- Semua panggilan lewat role web (api.* DEFINER/INVOKER). Jam dipatok 2026-03-20 WIB.
-- ID: T6, T7, T8, T9, B10
begin;
select plan(120);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

select tests.account(tests.n(), :'np', 'BCA', 'operasional', 2000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Tabungan', 'tabungan', 500000, '2026-01-01') as tab,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 1000000, '2026-01-01') as kan,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 300000, '2026-01-01') as kas,
       tests.account(tests.f(), :'fp', 'BCA Farida', 'operasional', 400000, '2026-01-01') as fbca \gset

-- Literal di dalam literal: uuid untuk SQL yang dikutip dua kali (pg_temp.call di dalam throws_ok).
create function pg_temp.ql(p text) returns text
language sql as $$ select replace(quote_literal(p), '''', '''''') $$;
create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
create function pg_temp.contact(p_name text, p_space uuid default null, p_uid uuid default null,
  p_client uuid default null) returns jsonb
language sql as $$
  select pg_temp.call(coalesce(p_uid, tests.n()), format($q$select api.create_contact(%L, %L, %L)$q$,
    coalesce(p_client, gen_random_uuid()), coalesce(p_space, tests.space_id(tests.n(), 'personal')), p_name))
$$;
create function pg_temp.debt(p_dir text, p_principal bigint, p_mode text, p_contact uuid, p_acc uuid,
  p_on date default '2026-03-02', p_title text default null, p_client uuid default null,
  p_space uuid default null, p_name text default null, p_uid uuid default null,
  p_allow boolean default false) returns jsonb
language sql as $$
  select pg_temp.call(coalesce(p_uid, tests.n()), format(
    $q$select api.create_debt(%L, %L, %L, %s, %L, %L, %L, %L, %L::date, %L, null, %L)$q$,
    coalesce(p_client, gen_random_uuid()), coalesce(p_space, tests.space_id(tests.n(), 'personal')),
    p_dir, p_principal, p_mode, p_contact, p_name, p_acc, p_on, p_title, p_allow))
$$;
create function pg_temp.pay(p_debt uuid, p_acc uuid, p_amount bigint, p_on date default '2026-03-15',
  p_allow boolean default false, p_client uuid default null, p_uid uuid default null) returns jsonb
language sql as $$
  select pg_temp.call(coalesce(p_uid, tests.n()), format($q$select api.pay_debt(%L, %L, %L, %s, %L::date, %L)$q$,
    coalesce(p_client, gen_random_uuid()), p_debt, p_acc, p_amount, p_on, p_allow))
$$;
create function pg_temp.ver(p_entry uuid) returns int
language sql as $$ select tests.owner_val(null, format('select version from app.entries where id = %L', p_entry))::int $$;
create function pg_temp.void(p_entry uuid, p_restore boolean default false, p_allow boolean default false)
returns jsonb
language sql as $$
  select pg_temp.call(tests.n(), format($q$select api.%s(gen_random_uuid(), %L, %s, %L)$q$,
    case when p_restore then 'restore_entry' else 'void_entry' end, p_entry, pg_temp.ver(p_entry), p_allow))
$$;
create function pg_temp.void_debt(p_debt uuid, p_restore boolean default false, p_allow boolean default false,
  p_client uuid default null) returns jsonb
language sql as $$
  select pg_temp.call(tests.n(), format($q$select api.%s(%L, %L, %L)$q$,
    case when p_restore then 'restore_debt' else 'void_debt' end, coalesce(p_client, gen_random_uuid()),
    p_debt, p_allow))
$$;
create function pg_temp.bal(p_debt uuid) returns text
language sql as $$
  select tests.web_val(tests.n(), format(
    $q$select paid || '/' || remaining from app.debt_balances where debt_id = %L$q$, p_debt))
$$;
create function pg_temp.principal_entry(p_debt uuid) returns uuid
language sql as $$
  select tests.owner_val(null, format(
    $q$select id from app.entries where debt_id = %L and kind = 'debt_principal'$q$, p_debt))::uuid
$$;

-- ===== Kontak (K1) =====
select pg_temp.contact(' Budi ', null, null, 'aaaaaaaa-0000-0000-0000-000000000001') ->> 'contact_id' as budi \gset
select is(tests.web_val(tests.n(), format('select name from app.contacts where id = %L', :'budi')), 'Budi',
  'create_contact: nama dirapikan');
select is((select r ->> 'contact_id' || ' ' || (r ->> 'replayed') from pg_temp.contact(' Budi ', null, null,
  'aaaaaaaa-0000-0000-0000-000000000001') r), :'budi' || ' true', 'create_contact idempoten (client_id sama = replay)');
select throws_ok($$select pg_temp.contact('bUDI')$$, 'DK422', 'contact_name_taken',
  'nama kontak aktif unik tanpa beda huruf');
select throws_ok($$select pg_temp.contact('   ')$$, 'DK400', 'invalid_argument', 'nama kosong ditolak');
select throws_ok($$select pg_temp.contact(repeat('a', 61))$$, 'DK400', 'invalid_argument', 'nama 61 huruf ditolak');
select throws_ok(format($$select pg_temp.contact('Toko', %L)$$, :'sh'), 'DK422', 'debt_personal_only',
  'kontak di Bersama ditolak [B10]');
select throws_ok(format($$select pg_temp.contact('Toko', %L)$$, :'fp'), 'DK404', 'space_not_found',
  'kontak di Pribadi pasangan ditolak');
select is(pg_temp.call(tests.n(), format($$select api.rename_contact(%L, 'Budi Santoso')$$, :'budi')) ->> 'name',
  'Budi Santoso', 'rename_contact');
select pg_temp.contact('Tono') ->> 'contact_id' as tono \gset
select throws_ok(format($$select pg_temp.call(tests.n(), 'select api.rename_contact(%s, ''budi santoso'')')$$,
  pg_temp.ql(:'tono')), 'DK422', 'contact_name_taken', 'ganti nama ke nama kontak aktif lain ditolak');
select throws_ok(format($$select pg_temp.call(tests.f(), 'select api.rename_contact(%s, ''X'')')$$,
  pg_temp.ql(:'budi')), 'DK404', 'contact_not_found', 'kontak Pribadi orang lain = DK404');
select throws_ok(format($$select pg_temp.call(tests.n(), 'select api.rename_contact(%s, '' '')')$$,
  pg_temp.ql(:'budi')), 'DK400', 'invalid_argument', 'ganti nama kosong ditolak');
select pg_temp.contact('Sari') ->> 'contact_id' as sari_lama \gset
select is(pg_temp.call(tests.n(), format('select api.archive_contact(%L)', :'sari_lama')) ->> 'archived', 'true',
  'archive_contact');
select is(pg_temp.call(tests.n(), format('select api.archive_contact(%L)', :'sari_lama')) ->> 'archived', 'true',
  'archive_contact idempoten');
select throws_ok(format($$select pg_temp.call(tests.n(), 'select api.rename_contact(%s, ''Sarah'')')$$,
  pg_temp.ql(:'sari_lama')), 'DK422', 'contact_archived', 'ganti nama kontak terarsip ditolak');
select throws_ok(format($$select pg_temp.call(tests.f(), 'select api.archive_contact(%s)')$$,
  pg_temp.ql(:'tono')), 'DK404', 'contact_not_found', 'arsip kontak orang lain = DK404');
select pg_temp.contact('Sari') ->> 'contact_id' as sari \gset
select isnt(:'sari'::uuid, :'sari_lama'::uuid, 'arsip melepas nama: kontak baru bernama sama');
select pg_temp.call(tests.f(), format($$select api.create_contact(gen_random_uuid(), %L, 'Budi')$$, :'fp'))
  ->> 'contact_id' as fbudi \gset

-- ===== create_debt mode baru (K2, K6) =====
select pg_temp.debt('borrowed', 5000000, 'baru', :'budi', :'bca', '2026-03-02', 'Modal usaha',
  'bbbbbbbb-0000-0000-0000-000000000001') as r_d1 \gset
select (:'r_d1'::jsonb) ->> 'debt_id' as d1 \gset
select is(tests.balance(:'bca'), 7000000::bigint, 'pinjam 5 jt masuk ke BCA');
select is(tests.web_val(tests.n(), format($$select direction || ' ' || principal || ' ' || mode || ' ' || title
  || ' ' || opened_on || ' ' || contact_id from app.debts where id = %L$$, :'d1')),
  'borrowed 5000000 baru Modal usaha 2026-03-02 ' || :'budi', 'baris utang: arah, pokok, mode, judul, tanggal, kontak');
select is(tests.web_val(tests.n(), format($$select count(*) || ' ' || min(e.occurred_on) || ' ' || sum(l.amount)
  from app.entries e join app.entry_lines l on l.entry_id = e.id
  where e.debt_id = %L and e.kind = 'debt_principal' and l.account_id = %L$$, :'d1', :'bca')),
  '1 2026-03-02 5000000', 'satu entri pokok bertanggal opened_on di dompet pilihan');
select is((:'r_d1'::jsonb) ->> 'remaining', '5000000', 'hasil: sisa = pokok');
select is((select r ->> 'debt_id' || ' ' || (r ->> 'replayed') from pg_temp.debt('borrowed', 5000000, 'baru',
  :'budi', :'bca', '2026-03-02', 'Modal usaha', 'bbbbbbbb-0000-0000-0000-000000000001') r),
  :'d1' || ' true', 'create_debt idempoten (client_id sama = replay, tanpa entri kedua)');
select throws_ok(format($$select pg_temp.debt('borrowed', 4000000, 'baru', %L, %L, '2026-03-02', 'Modal usaha',
  'bbbbbbbb-0000-0000-0000-000000000001')$$, :'budi', :'bca'), 'DK410', 'idempotency_key_reused',
  'client_id sama isi beda = DK410');
select is(tests.balance(:'bca'), 7000000::bigint, 'replay tidak menambah saldo');
select throws_ok(format($$select pg_temp.debt('lent', 600000, 'baru', %L, %L)$$, :'sari', :'tab'),
  'DK422', 'saldo_negatif', 'piutang melebihi saldo tanpa flag ditolak');
select pg_temp.debt('lent', 300000, 'baru', :'sari', :'tab', '2026-03-03') ->> 'debt_id' as d2 \gset
select is(tests.balance(:'tab'), 200000::bigint, 'piutang 300 rb keluar dari Tabungan');
select throws_ok(format($$select pg_temp.debt('borrowed', 1000, 'baru', %L, %L)$$, :'budi', :'kan'),
  'DK422', 'debt_account_kantor', 'dompet Kantor ditolak (K6)');
select throws_ok(format($$select pg_temp.debt('borrowed', 1000, 'berjalan', %L, %L)$$, :'budi', :'bca'),
  'DK400', 'invalid_argument', 'mode berjalan tanpa dompet');
select throws_ok(format($$select pg_temp.debt('borrowed', 1000, 'baru', %L, null)$$, :'budi'),
  'DK400', 'invalid_argument', 'mode baru wajib dompet');
select throws_ok(format($$select pg_temp.debt('borrowed', 1000, 'baru', null, %L, '2026-03-02', null, null, %L,
  'Toko')$$, :'kas', :'sh'), 'DK422', 'debt_personal_only', 'utang di Bersama ditolak [B10]');
select throws_ok(format($$select pg_temp.debt('borrowed', 1000, 'berjalan', %L, null, '2026-03-02', null, null, %L)$$,
  :'fbudi', :'fp'), 'DK404', 'space_not_found', 'utang di Pribadi pasangan ditolak');
select throws_ok(format($$select pg_temp.debt('borrowed', 1000, 'baru', %L, %L)$$, :'budi', :'fbca'),
  'DK404', 'account_not_found', 'dompet Pribadi pasangan = DK404');
select throws_ok(format($$select pg_temp.debt('borrowed', 1000, 'berjalan', %L, null)$$, :'sari_lama'),
  'DK422', 'contact_archived', 'kontak terarsip ditolak');
select throws_ok(format($$select pg_temp.debt('borrowed', 1000, 'berjalan', %L, null)$$, :'fbudi'),
  'DK404', 'contact_not_found', 'kontak ruang lain = DK404');
select throws_ok(format($$select pg_temp.debt('borrowed', 1000, 'berjalan', %L, null, '2026-03-02', null, null,
  null, 'Rina')$$, :'budi'), 'DK400', 'invalid_argument', 'kontak dan nama kontak baru sekaligus ditolak');
select throws_ok($$select pg_temp.debt('borrowed', 1000, 'berjalan', null, null)$$,
  'DK400', 'invalid_argument', 'tanpa kontak ditolak');
select pg_temp.debt('borrowed', 100000, 'berjalan', null, null, '2026-02-01', null, null, null, ' Rina ') as r_rina \gset
select is(tests.web_val(tests.n(), format($$select name || ' ' || (archived_at is null) from app.contacts where id = %L$$,
  (:'r_rina'::jsonb) ->> 'contact_id')), 'Rina true', 'kontak baru dibuat bersama utangnya');
select (:'r_rina'::jsonb) ->> 'debt_id' as drina, (:'r_rina'::jsonb) ->> 'contact_id' as rina \gset
select throws_ok($$select pg_temp.debt('borrowed', 1000, 'berjalan', null, null, '2026-03-02', null, null, null,
  'budi santoso')$$, 'DK422', 'contact_name_taken', 'nama kontak baru yang sudah ada ditolak');
select throws_ok(format($$select pg_temp.debt('given', 1000, 'berjalan', %L, null)$$, :'budi'),
  'DK400', 'invalid_argument', 'arah tidak dikenal');
select throws_ok(format($$select pg_temp.debt('borrowed', 1000, 'lama', %L, null)$$, :'budi'),
  'DK400', 'invalid_argument', 'mode tidak dikenal');
select throws_ok(format($$select pg_temp.debt('borrowed', 0, 'berjalan', %L, null)$$, :'budi'),
  'DK400', 'invalid_argument', 'pokok 0 ditolak');
select throws_ok(format($$select pg_temp.debt('borrowed', 1000, 'berjalan', %L, null, '2026-03-21')$$, :'budi'),
  'DK400', 'invalid_argument', 'tanggal masa depan ditolak');
select throws_ok(format($$select pg_temp.debt('borrowed', 1000, 'baru', %L, %L, '2025-12-31')$$, :'budi', :'bca'),
  'DK422', 'before_opening', 'tanggal sebelum dompet dibuka ditolak');
select throws_ok(format($$select pg_temp.debt('borrowed', 1000, 'berjalan', %L, null, '2026-03-02', repeat('j', 81))$$,
  :'budi'), 'DK400', 'invalid_argument', 'judul 81 huruf ditolak');

-- ===== Utang berjalan (K2): nol efek saldo dan Laporan =====
select pg_temp.debt('borrowed', 400000, 'berjalan', :'tono', null, '2025-06-01') as r_d3 \gset
select (:'r_d3'::jsonb) ->> 'debt_id' as d3 \gset
select is(coalesce((:'r_d3'::jsonb) ->> 'entry_id', 'null') || ' ' || tests.balance(:'bca') || ' '
  || tests.owner_val(null, format('select count(*) from app.entries where debt_id = %L', :'d3')),
  'null 7000000 0', 'utang berjalan: tanpa entri, saldo tidak berubah');
select is(pg_temp.bal(:'d3'), '0/400000', 'utang berjalan: sisa = pokok');

-- ===== pay_debt (T7) =====
select pg_temp.pay(:'d1', :'bca', 1250000, '2026-03-05', false, 'cccccccc-0000-0000-0000-000000000001') as r_p1 \gset
select (:'r_p1'::jsonb) ->> 'entry_id' as p1 \gset
select is((select concat_ws(' ', r ->> 'principal', r ->> 'paid', r ->> 'remaining', r ->> 'paid_pct', r ->> 'settled',
    r -> 'quick' ->> 'p25', r -> 'quick' ->> 'p50', r -> 'quick' ->> 'full') from (select :'r_p1'::jsonb r) x),
  '5000000 1250000 3750000 25 false 937500 1875000 3750000', 'bayar: sisa, persen, pintasan dari SQL');
select is(tests.balance(:'bca'), 5750000::bigint, 'bayar 1,25 jt keluar dari BCA');
select is((select r ->> 'entry_id' || ' ' || (r ->> 'replayed') from pg_temp.pay(:'d1', :'bca', 1250000,
  '2026-03-05', false, 'cccccccc-0000-0000-0000-000000000001') r), :'p1' || ' true', 'pay_debt idempoten');
select is(tests.owner_val(null, format($$select count(*) from app.entries where debt_id = %L and kind = 'debt_payment'$$,
  :'d1')), '1', 'replay tidak membuat cicilan kedua');
select throws_ok(format($$select pg_temp.pay(%L, %L, 3750001)$$, :'d1', :'bca'), 'DK422', 'payment_exceeds',
  'bayar melebihi sisa ditolak (K7)');
select is(pg_temp.bal(:'d1') || ' ' || tests.balance(:'bca'), '1250000/3750000 5750000',
  'bayar lebih: nol efek pada sisa dan saldo');
select throws_ok(format($$select pg_temp.pay(%L, %L, 1000, '2026-03-01')$$, :'d1', :'bca'), 'DK422',
  'payment_before_opened', 'tanggal bayar sebelum utang dimulai ditolak');
select throws_ok(format($$select pg_temp.pay(%L, %L, 1000, '2026-03-21')$$, :'d1', :'bca'), 'DK400',
  'invalid_argument', 'tanggal bayar masa depan ditolak');
select throws_ok(format($$select pg_temp.pay(%L, %L, 1000)$$, :'d1', :'kan'), 'DK422', 'debt_account_kantor',
  'bayar dari Kantor ditolak');
select throws_ok(format($$select pg_temp.pay(%L, %L, 300000, '2026-03-06')$$, :'d1', :'tab'), 'DK422', 'saldo_negatif',
  'bayar melebihi saldo tanpa flag ditolak');
select throws_ok(format($$select pg_temp.pay(%L, %L, 1000, '2026-03-15', false, null, %L)$$, :'d1', :'fbca', tests.f()),
  'DK404', 'debt_not_found', 'utang orang lain = DK404');
select throws_ok(format($$select pg_temp.pay(%L, %L, 0)$$, :'d1', :'bca'), 'DK400', 'invalid_argument',
  'nominal 0 ditolak');
select throws_ok(format($$select pg_temp.pay(%L, null, 1000)$$, :'d1'), 'DK400', 'invalid_argument',
  'tanpa dompet ditolak');
select pg_temp.pay(:'d1', :'tab', 300000, '2026-03-06', true) ->> 'entry_id' as p2 \gset
select is(tests.balance(:'tab') || ' ' || pg_temp.bal(:'d1'), '-100000 1550000/3450000',
  'bayar dengan konfirmasi saldo negatif');
select pg_temp.pay(:'d2', :'bca', 100000, '2026-03-10') ->> 'remaining' as rem_d2 \gset
select is(:'rem_d2' || ' ' || tests.balance(:'bca'), '200000 5850000', 'terima piutang: saldo bertambah, sisa piutang turun');
select pg_temp.pay(:'d3', :'bca', 50000, '2026-03-11') ->> 'remaining' as rem_d3 \gset
select is(:'rem_d3' || ' ' || tests.balance(:'bca'), '350000 5800000', 'cicilan utang berjalan memotong saldo dan sisa');

-- ===== T6/S4: ubah judul, catatan, kontak tanpa efek =====
create function pg_temp.snap(p_debt uuid) returns text
language sql as $$
  select concat_ws(' ', tests.balance(tests.owner_val(null, $q$select id from app.accounts where name = 'BCA'$q$)::uuid),
    tests.balance(tests.owner_val(null, $q$select id from app.accounts where name = 'Tabungan'$q$)::uuid),
    pg_temp.bal(p_debt),
    tests.owner_val(null, format($q$select count(*) || ':' || string_agg(occurred_on::text || version, ',' order by id)
      from app.entries where debt_id = %L$q$, p_debt)))
$$;
select pg_temp.snap(:'d1') as snap_d1 \gset
select is(pg_temp.call(tests.n(), format($$select api.update_debt_info(%L, %L, 'Modal warung', 'tanpa bunga')$$,
  :'d1', :'tono')) ->> 'debt_id', :'d1', 'update_debt_info');
select is(tests.web_val(tests.n(), format($$select contact_id || ' ' || title || ' ' || note from app.debts where id = %L$$,
  :'d1')), :'tono' || ' Modal warung tanpa bunga', 'judul, catatan, kontak berubah (K4)');
select is(pg_temp.snap(:'d1'), :'snap_d1', 'saldo, jumlah cicilan, sisa, tanggal dan versi entri tetap [T6]');
select throws_ok(format($$select pg_temp.call(tests.n(), 'select api.update_debt_info(%s, %s, null, null)')$$,
  pg_temp.ql(:'d1'), pg_temp.ql(:'sari_lama')), 'DK422', 'contact_archived', 'ganti ke kontak terarsip ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), 'select api.update_debt_info(%s, null, null, null)')$$,
  pg_temp.ql(:'d1')), 'DK400', 'invalid_argument', 'kontak wajib');
select throws_ok(format($$select pg_temp.call(tests.n(), 'select api.update_debt_info(%s, %s, repeat(''j'', 81), null)')$$,
  pg_temp.ql(:'d1'), pg_temp.ql(:'tono')), 'DK400', 'invalid_argument', 'judul 81 huruf ditolak');
select throws_ok(format($$select pg_temp.call(tests.f(), 'select api.update_debt_info(%s, %s, null, null)')$$,
  pg_temp.ql(:'d1'), pg_temp.ql(:'fbudi')), 'DK404', 'debt_not_found', 'utang orang lain = DK404');
select throws_ok(format($$select pg_temp.call(tests.n(), 'select api.update_debt_info(%s, %s, null, null)')$$,
  pg_temp.ql(:'d1'), pg_temp.ql(:'fbudi')), 'DK404', 'contact_not_found', 'kontak ruang lain = DK404');

-- ===== Baca =====
select is(tests.web_val(tests.n(), format($$select string_agg(name || ':' || borrowed_remaining || '/' || lent_remaining
  || ':' || borrowed_count || '/' || lent_count, ',' order by n) from api.list_contacts(%L) with ordinality t(
  contact_id, name, borrowed_remaining, lent_remaining, borrowed_count, lent_count, n)$$, :'np')),
  'Budi Santoso:0/0:0/0,Rina:100000/0:1/0,Sari:0/200000:0/1,Tono:3800000/0:2/0',
  'list_contacts: kontak aktif urut nama + ringkasan sisa per arah (nama baru berlaku)');
select is(tests.web_val(tests.n(), format($$select string_agg(contact_name || ':' || remaining || ':' || paid_pct || ':'
  || direction_remaining || ':' || direction_contacts, ',' order by n) from api.list_debts(%L) with ordinality t(
  debt_id, contact_id, contact_name, direction, mode, title, principal, paid, remaining, paid_pct, quick_25, quick_50,
  opened_on, account_id, voided_at, direction_remaining, direction_contacts, n)$$, :'np')),
  'Tono:3450000:31:3900000:2,Tono:350000:12:3900000:2,Rina:100000:0:3900000:2,Sari:200000:33:200000:1',
  'list_debts: urut arah lalu sisa terbesar, persen dibulatkan ke bawah, total per arah');
select is(tests.web_val(tests.n(), format($$select quick_25 || '/' || quick_50 || ' ' || (account_id = %L) || ' ' || mode
  from api.list_debts(%L) where debt_id = %L$$, :'bca', :'np', :'d1')), '862500/1725000 true baru',
  'list_debts: pintasan 25/50 dari sisa, dompet pokok');
select is(tests.web_val(tests.n(), format($$select coalesce(account_id::text, 'null') || ' ' || mode
  from api.list_debts(%L) where debt_id = %L$$, :'np', :'d3')), 'null berjalan', 'utang berjalan tanpa dompet pokok');
select is(tests.web_val(tests.n(), format('select count(*) from api.list_debts(%L)', :'sh')), '0', 'Bersama tanpa utang');
select throws_ok(format($$select tests.web_val(tests.f(), 'select count(*) from api.list_debts(%s)')$$,
  pg_temp.ql(:'np')), 'DK404', 'space_not_found', 'list_debts ruang orang lain ditolak');
select throws_ok(format($$select tests.web_val(tests.f(), 'select count(*) from api.list_contacts(%s)')$$,
  pg_temp.ql(:'np')), 'DK404', 'space_not_found', 'list_contacts ruang orang lain ditolak');
select pg_temp.void(:'p2') ->> 'entry_id' as v_p2 \gset
select is(tests.balance(:'tab') || ' ' || pg_temp.bal(:'d1'), '200000 1250000/3750000',
  'batal cicilan: saldo kembali, sisa bertambah [T8]');
select pg_temp.call(tests.n(), format('select api.debt_detail(%L)', :'d1')) as det \gset
select is((select concat_ws(' ', r ->> 'contact_name', r ->> 'title', r ->> 'note', r ->> 'direction', r ->> 'mode',
    r ->> 'principal', r ->> 'paid', r ->> 'remaining', r ->> 'paid_pct', r -> 'quick' ->> 'p25', r ->> 'account_name',
    r ->> 'opened_on', coalesce(r ->> 'voided_at', 'hidup')) from (select :'det'::jsonb r) x),
  'Tono Modal warung tanpa bunga borrowed baru 5000000 1250000 3750000 25 937500 BCA 2026-03-02 hidup',
  'debt_detail: rincian utang dari SQL');
select is((select string_agg(p ->> 'occurred_on' || ':' || (p ->> 'amount') || ':' || (p ->> 'voided') || ':'
    || (p ->> 'account_name'), ',' order by o) from jsonb_array_elements((:'det'::jsonb) -> 'payments') with ordinality t(p, o)),
  '2026-03-06:300000:true:Tabungan,2026-03-05:1250000:false:BCA', 'riwayat pembayaran: yang dibatalkan tetap tampil, ditandai [T8]');
select is((:'det'::jsonb) -> 'void_effects', ('[{"amount": -3750000, "account_id": "' || :'bca' || '", "account_name": "BCA"}]')::jsonb,
  'void_effects: efek bersih per dompet bila utang dihapus');
select throws_ok(format($$select pg_temp.call(tests.f(), 'select api.debt_detail(%s)')$$, pg_temp.ql(:'d1')),
  'DK404', 'debt_not_found', 'debt_detail utang orang lain = DK404');
select throws_ok(format($$select pg_temp.void(%L, true)$$, :'p2'), 'DK422', 'saldo_negatif',
  'pulihkan cicilan memeriksa saldo');

-- ===== Lunas, pulihkan melebihi, jalur generik =====
select pg_temp.pay(:'d1', :'bca', 3750000, '2026-03-12') as r_p5 \gset
select is((select concat_ws(' ', r ->> 'remaining', r ->> 'paid_pct', r ->> 'settled') from (select :'r_p5'::jsonb r) x),
  '0 100 true', 'bayar sisa = lunas');
select throws_ok(format($$select pg_temp.pay(%L, %L, 1)$$, :'d1', :'bca'), 'DK422', 'payment_exceeds',
  'bayar utang lunas ditolak');
select throws_ok(format($$select pg_temp.void(%L, true, true)$$, :'p2'), 'DK422', 'payment_exceeds',
  'pulihkan cicilan yang membuat Σ melebihi pokok ditolak');
select is(pg_temp.call(tests.n(), format('select api.debt_detail(%L)', :'d1')) -> 'void_effects', '[]'::jsonb,
  'void_effects kosong bila efek bersih nol');
select pg_temp.principal_entry(:'d1') as pk1 \gset
select throws_ok(format($$select pg_temp.void(%L)$$, :'pk1'), 'DK422', 'debt_principal_locked',
  'pokok tidak bisa dibatalkan lewat void_entry (hanya Hapus utang)');
select throws_ok(format($$select pg_temp.void(%L, true)$$, :'pk1'), 'DK422', 'debt_principal_locked',
  'pokok tidak bisa dipulihkan lewat restore_entry');
select throws_ok(format($$select pg_temp.call(tests.n(), 'select api.update_entry(gen_random_uuid(), %s, %s, %s, 1000, null, null, null, false)')$$,
  pg_temp.ql(:'p1'), pg_temp.ver(:'p1'), pg_temp.ql(:'bca')), 'DK422', 'kind_not_editable',
  'update_entry menolak cicilan (K4)');
select throws_ok(format($$select pg_temp.call(tests.n(), 'select api.update_entry(gen_random_uuid(), %s, %s, %s, 5000000, null, null, null, false)')$$,
  pg_temp.ql(:'pk1'), pg_temp.ver(:'pk1'), pg_temp.ql(:'bca')), 'DK422', 'kind_not_editable',
  'update_entry menolak pokok (K4)');
select throws_ok(format($$select pg_temp.call(tests.n(), 'select api.move_entry_to_space(gen_random_uuid(), %s, %s, %s, %s, null)')$$,
  pg_temp.ql(:'p1'), pg_temp.ver(:'p1'), pg_temp.ql(:'sh'), pg_temp.ql(:'kas')), 'DK422', 'kind_not_movable',
  'move_entry_to_space menolak cicilan');
select throws_ok(format($$select pg_temp.call(tests.n(), 'select api.move_entry_to_space(gen_random_uuid(), %s, %s, %s, %s, null)')$$,
  pg_temp.ql(:'pk1'), pg_temp.ver(:'pk1'), pg_temp.ql(:'sh'), pg_temp.ql(:'kas')), 'DK422', 'kind_not_movable',
  'move_entry_to_space menolak pokok');

-- ===== T9: Hapus utang (void atomik) dan pulihkan (K5) =====
select pg_temp.pay(:'d2', :'bca', 50000, '2026-03-12') ->> 'entry_id' as p6 \gset
select pg_temp.void(:'p6') ->> 'entry_id' as v_p6 \gset
select pg_temp.principal_entry(:'d2') as pk2 \gset
select tests.owner_val(null, format($$select id from app.entries where debt_id = %L and kind = 'debt_payment'
  and voided_at is null$$, :'d2')) as p3 \gset
select is((select string_agg(e ->> 'account_name' || ':' || (e ->> 'amount'), ',' order by e ->> 'account_name')
    from jsonb_array_elements(pg_temp.call(tests.n(), format('select api.debt_detail(%L)', :'d2')) -> 'void_effects') e),
  'BCA:-100000,Tabungan:300000', 'void_effects piutang: pokok kembali ke Tabungan, penerimaan keluar dari BCA');
select pg_temp.void_debt(:'d2', false, false, 'dddddddd-0000-0000-0000-000000000001') as r_v2 \gset
select is((select string_agg(e ->> 'account_name' || ':' || (e ->> 'amount'), ',' order by e ->> 'account_name')
    from jsonb_array_elements((:'r_v2'::jsonb) -> 'effects') e), 'BCA:-100000,Tabungan:300000',
  'void_debt mengembalikan efek per dompet');
select is(tests.balance(:'tab') || ' ' || tests.balance(:'bca'), '500000 1950000',
  'void_debt: semua efek kas dibalik sekaligus [T9]');
select is(tests.owner_val(null, format($$select string_agg(kind || ':' || (voided_at is not null) || ':' || voided_with_debt,
  ',' order by kind, voided_with_debt) from app.entries where debt_id = %L$$, :'d2')),
  'debt_principal:true:true,debt_payment:true:false,debt_payment:true:true',
  'pokok dan cicilan hidup ditandai ikut terhapus; cicilan yang sudah batal tidak');
select is(tests.web_val(tests.n(), format('select voided_at is not null from app.debts where id = %L', :'d2')), 'true',
  'utang ditandai terhapus');
select is((select r ->> 'replayed' from pg_temp.void_debt(:'d2', false, false, 'dddddddd-0000-0000-0000-000000000001') r),
  'true', 'void_debt idempoten');
select throws_ok(format($$select pg_temp.void_debt(%L)$$, :'d2'), 'DK422', 'already_voided', 'hapus dua kali ditolak');
select throws_ok(format($$select pg_temp.pay(%L, %L, 1000)$$, :'d2', :'bca'), 'DK422', 'debt_deleted',
  'bayar utang terhapus ditolak');
select throws_ok(format($$select pg_temp.void(%L, true)$$, :'p6'), 'DK422', 'debt_deleted',
  'pulihkan cicilan pada utang terhapus ditolak');
select throws_ok(format($$select pg_temp.void(%L, true)$$, :'p3'), 'DK422', 'debt_deleted',
  'pulihkan cicilan yang ikut terhapus lewat Sampah ditolak');
select throws_ok(format($$select pg_temp.call(tests.n(), 'select api.update_debt_info(%s, %s, null, null)')$$,
  pg_temp.ql(:'d2'), pg_temp.ql(:'sari')), 'DK422', 'debt_deleted', 'ubah utang terhapus ditolak');
select is(tests.web_val(tests.n(), format($$select string_agg(t.entry_id::text, ',') from api.trash_list(%L) t
  join app.entries e on e.id = t.entry_id where e.debt_id = %L$$, :'np', :'d2')), :'p6',
  'Sampah: hanya cicilan yang dibatalkan sendiri, bukan entri yang ikut Hapus utang');
select is(tests.web_val(tests.n(), format($$select count(*) from api.trash_list(%L) t where t.entry_id = %L$$, :'np', :'p2')),
  '1', 'Sampah memuat cicilan batal utang hidup');
select throws_ok(format($$select pg_temp.call(tests.n(), 'select api.purge_entry(%s, %s)')$$, pg_temp.ql(:'p3'),
  pg_temp.ver(:'p3')), 'DK422', 'debt_deleted', 'hapus permanen entri yang ikut Hapus utang ditolak');
select is(tests.web_val(tests.n(), format($$select (voided_at is not null) || ' ' || remaining from api.list_debts(%L)
  where debt_id = %L$$, :'np', :'d2')), 'true 200000', 'list_debts memuat utang terhapus (grup Utang dihapus)');
select tests.web_val(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 400000,
  null, '2026-03-20')$$, :'np', :'tab')) ::jsonb ->> 'entry_id' as belanja_tab \gset
select throws_ok(format($$select pg_temp.void_debt(%L, true)$$, :'d2'), 'DK422', 'saldo_negatif',
  'pulihkan utang memeriksa saldo dompet');
select pg_temp.void(:'belanja_tab') ->> 'entry_id' as v_belanja \gset
select pg_temp.void_debt(:'d2', true) as r_rd2 \gset
select is((select string_agg(e ->> 'account_name' || ':' || (e ->> 'amount'), ',' order by e ->> 'account_name')
    from jsonb_array_elements((:'r_rd2'::jsonb) -> 'effects') e), 'BCA:100000,Tabungan:-300000',
  'restore_debt mengembalikan efek per dompet');
select is(concat_ws(' ', tests.balance(:'tab'), tests.balance(:'bca'), pg_temp.bal(:'d2'),
    tests.web_val(tests.n(), format('select voided_at is null from app.debts where id = %L', :'d2')),
    tests.owner_val(null, format('select voided_at is not null from app.entries where id = %L', :'p6'))),
  '200000 2050000 100000/200000 true true', 'restore_debt memulihkan semua efek, cicilan yang dibatalkan sendiri tetap batal [T9]');
select throws_ok(format($$select pg_temp.void_debt(%L, true)$$, :'d2'), 'DK422', 'not_voided', 'pulihkan utang hidup ditolak');
select throws_ok(format($$select pg_temp.call(tests.f(), 'select api.void_debt(gen_random_uuid(), %s)')$$,
  pg_temp.ql(:'d2')), 'DK404', 'debt_not_found', 'hapus utang orang lain = DK404');
-- Utang berjalan tanpa pembayaran: hapus tanpa efek kas.
select is(pg_temp.void_debt(:'drina') -> 'effects', '[]'::jsonb, 'hapus utang berjalan tanpa cicilan: tanpa efek kas');
select is(pg_temp.call(tests.n(), format('select api.debt_detail(%L)', :'drina')) ->> 'voided_at' is not null, true,
  'debt_detail utang terhapus tetap terbaca (UI memutuskan 404)');

-- ===== Jendela 90 hari dan purge =====
-- d4: cicilan dibatalkan sendiri pada hari 0, utang dihapus pada hari 85, purge pada hari 95: cicilan lama
-- dipurge, entri yang ikut Hapus utang (umur 10 hari) tetap, restore_debt tetap bisa.
select pg_temp.debt('borrowed', 1000000, 'baru', :'rina', :'bca', '2026-03-20') ->> 'debt_id' as d4 \gset
select pg_temp.pay(:'d4', :'bca', 100000, '2026-03-20') ->> 'entry_id' as q4 \gset
select pg_temp.void(:'q4') ->> 'entry_id' as v_q4 \gset
select pg_temp.void_debt(:'d2') ->> 'debt_id' as v_d2b \gset
select tests.clock_at('2026-06-13 10:00+07');
select pg_temp.void_debt(:'d4') ->> 'debt_id' as v_d4 \gset
select tests.clock_at('2026-06-23 10:00+07');
select throws_ok(format($$select pg_temp.void_debt(%L, true)$$, :'d2'), 'DK422', 'restore_window_closed',
  'pulihkan utang sesudah 90 hari ditolak');
select is(tests.web_val(tests.n(), format('select count(*) from api.list_debts(%L) where debt_id = %L', :'np', :'d2')),
  '0', 'utang terhapus > 90 hari tidak lagi di daftar');
select cmp_ok(tests.worker_val(null, 'select jobs.purge_voided()')::int, '>=', 4, 'purge_voided berjalan');
select is(concat_ws(' ',
    tests.owner_val(null, format('select count(*) from app.debts where id = %L', :'d2')),
    tests.owner_val(null, format('select count(*) from app.entries where debt_id = %L', :'d2')),
    tests.owner_val(null, format('select count(*) from app.entries where id = %L', :'q4')),
    tests.owner_val(null, format('select count(*) from app.entries where debt_id = %L', :'d4'))),
  '0 0 0 1', 'purge: utang > 90 hari dihapus bersama entrinya; cicilan lama dipurge; entri utang terhapus <= 90 hari tetap');
select is(pg_temp.void_debt(:'d4', true) ->> 'remaining', '1000000', 'restore_debt sesudah purge cicilan lama');
select is(tests.owner_val(null, format('select count(*) from app.entry_tombstones where entry_id = %L', :'pk2')), '1',
  'entri utang yang dipurge meninggalkan tombstone');

select * from finish();
rollback;
