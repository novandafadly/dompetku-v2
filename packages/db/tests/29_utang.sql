-- Utang/piutang S11 (0130; plan S11 Task 3, K1, K2, K6): tabel app.contacts dan app.debts, kolom
-- entries.debt_id, bentuk entri debt_principal/debt_payment (private.assert_entry_shape), kelas
-- laporan x_pokok_utang/x_pelunasan_utang, view app.debt_balances, DQ03 untuk kind baru.
-- API utang (create_debt, pay_debt, ...) menyusul di 0131 (Task 4): di sini baris ditulis langsung
-- sebagai dompetku_api (RLS member_write) atau owner (entri, lalu set constraints all immediate).
-- Jam dipatok 2026-03-20 WIB.
-- ID: B10, I6
begin;
select plan(88);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

select tests.account(tests.n(), :'np', 'BCA', 'operasional', 2000000, '2026-01-01') as bca,
       tests.account(tests.n(), :'np', 'Tabungan', 'tabungan', 500000, '2026-01-01') as tab,
       tests.account(tests.n(), :'np', 'Kas Kantor', 'kantor', 1000000, '2026-01-01') as kan,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 300000, '2026-01-01') as kas,
       tests.account(tests.f(), :'fp', 'BCA Farida', 'operasional', 400000, '2026-01-01') as fbca \gset

-- Kontak dan utang ditulis sebagai dompetku_api (pola fungsi api DEFINER: RLS member_write).
create function pg_temp.contact(p_uid uuid, p_space uuid, p_name text) returns uuid
language sql as $$
  select tests.api_val(p_uid, format(
    $q$insert into app.contacts (space_id, name, created_by, updated_by)
       values (%L, %L, %L, %L) returning id$q$, p_space, p_name, p_uid, p_uid))::uuid
$$;
create function pg_temp.debt(p_uid uuid, p_space uuid, p_contact uuid, p_dir text, p_principal bigint,
  p_mode text default 'baru') returns uuid
language sql as $$
  select tests.api_val(p_uid, format(
    $q$insert into app.debts (space_id, contact_id, direction, principal, mode, opened_on,
                              created_by, updated_by)
       values (%L, %L, %L, %s, %L, '2026-03-01', %L, %L) returning id$q$,
    p_space, p_contact, p_dir, p_principal, p_mode, p_uid, p_uid))::uuid
$$;
-- Entri utang lewat owner: satu line main (+ p_extra, ':id' = id entri), lalu bentuk diperiksa
-- segera (set constraints all immediate) dan kembali deferred untuk api.* berikutnya.
create function pg_temp.dentry(p_debt uuid, p_kind text, p_acc uuid, p_amount bigint,
  p_on date default '2026-03-10', p_extra text default '') returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform tests.owner_exec(null, format($q$do $d$ begin
    set constraints all deferred;  -- api.* sebelumnya menutup dengan immediate
    insert into app.entries (id, space_id, space_kind, kind, occurred_on, debt_id, created_by, updated_by)
    select %L, d.space_id, d.space_kind, %L, %L, d.id, d.created_by, d.created_by
      from app.debts d where d.id = %L;
    insert into app.entry_lines (entry_id, space_id, role, account_id, amount)
    select %L, a.space_id, 'main', a.id, %s from app.accounts a where a.id = %L;
    %s
    set constraints all immediate;
    set constraints all deferred;
  end $d$$q$, v, p_kind, p_on, p_debt, v, p_amount, p_acc, replace(p_extra, ':id', quote_literal(v))));
  return v;
end $f$;
create function pg_temp.void(p_entry uuid) returns void
language sql as $$
  select tests.owner_exec(null, format($q$update app.entries set voided_at = now(), voided_by = created_by,
    version = version + 1 where id = %L$q$, p_entry))::text::void
$$;
create function pg_temp.bal(p_debt uuid) returns text
language sql as $$
  select tests.web_val(tests.n(), format(
    $q$select principal || '/' || paid || '/' || remaining from app.debt_balances where debt_id = %L$q$, p_debt))
$$;

-- ===== Kontak (K1) =====
select pg_temp.contact(tests.n(), :'np', 'Budi') as budi \gset
select is(tests.web_val(tests.n(), format($$select name || ' ' || space_kind || ' ' || (archived_at is null)
  from app.contacts where id = %L$$, :'budi')), 'Budi personal true', 'kontak dibuat di Pribadi, aktif');
select throws_ok(format($$select pg_temp.contact(tests.n(), %L, '  ')$$, :'np'), '23514', null,
  'nama kontak kosong ditolak');
select throws_ok(format($$select pg_temp.contact(tests.n(), %L, repeat('a', 61))$$, :'np'), '23514', null,
  'nama kontak 61 huruf ditolak');
select lives_ok(format($$select pg_temp.contact(tests.n(), %L, repeat('a', 60))$$, :'np'),
  'nama kontak 60 huruf diterima');
select throws_ok(format($$select pg_temp.contact(tests.n(), %L, ' bUDI ')$$, :'np'), '23505', null,
  'nama kontak aktif unik tanpa beda huruf besar dan spasi tepi');
select is(tests.api_exec(tests.n(), format($$update app.contacts set archived_at = now(), updated_at = now()
  where id = %L$$, :'budi')), 1::bigint, 'kontak diarsip lewat dompetku_api');
select pg_temp.contact(tests.n(), :'np', 'BUDI') as budi2 \gset
select isnt(:'budi2'::uuid, :'budi'::uuid, 'arsip melepas nama: kontak baru bernama sama boleh');
select pg_temp.contact(tests.f(), :'fp', 'Budi') as fbudi \gset
select isnt(:'fbudi'::uuid, null::uuid, 'nama sama di ruang Pribadi lain boleh');

-- Hanya Pribadi: FK (space_id, space_kind) dan CHECK space_kind.
select throws_ok(format($$select pg_temp.contact(tests.n(), %L, 'Toko')$$, :'sh'), '23503', null,
  'kontak di Bersama ditolak (FK ruang Pribadi)');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
  $q$insert into app.contacts (space_id, space_kind, name, created_by, updated_by)
     values (%L, 'shared', 'Toko', %L, %L)$q$, :'sh', tests.n(), tests.n())), '23514', null,
  'kontak berjenis shared ditolak (CHECK)');

-- Isolasi: Pribadi pasangan tidak terlihat dan tidak bisa ditulis; web tanpa hak tulis.
select is(tests.web_val(tests.f(), format($$select count(*) from app.contacts where space_id = %L$$, :'np')),
  '0', 'Farida tidak melihat kontak Pribadi Novanda');
select is(tests.web_val(tests.n(), 'select count(*) from app.contacts'), '3',
  'Novanda hanya melihat kontak Pribadinya (termasuk terarsip)');
select throws_ok(format($$select pg_temp.contact(tests.f(), %L, 'Susup')$$, :'np'), '42501', null,
  'Farida tidak bisa menulis kontak di Pribadi Novanda (RLS)');
select is(tests.api_exec(tests.f(), format($$update app.contacts set name = 'X' where id = %L$$, :'budi2')),
  0::bigint, 'Farida tidak bisa mengubah kontak Novanda (0 baris)');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format(
  $q$insert into app.contacts (space_id, name, created_by, updated_by) values (%L, 'W', %L, %L)$q$,
  :'np', tests.n(), tests.n())), '42501', null, 'web tidak punya hak tulis kontak');

-- ===== Utang =====
select pg_temp.debt(tests.n(), :'np', :'budi2', 'borrowed', 1000000) as d1 \gset
select is(tests.web_val(tests.n(), format($$select direction || ' ' || principal || ' ' || mode || ' '
  || space_kind || ' ' || (voided_at is null) from app.debts where id = %L$$, :'d1')),
  'borrowed 1000000 baru personal true', 'utang dibuat: arah, pokok, mode, Pribadi, hidup');
select throws_ok(format($$select pg_temp.debt(tests.n(), %L, %L, 'borrowed', 1000)$$, :'np', :'budi'),
  'DK422', 'contact_archived', 'utang baru dengan kontak terarsip ditolak');
select throws_ok(format($$select pg_temp.debt(tests.n(), %L, %L, 'borrowed', 1000)$$, :'np', :'fbudi'),
  'DK404', 'contact_not_found', 'kontak ruang lain = DK404 (tanpa membocorkan keberadaannya)');
select throws_ok(format($$select pg_temp.debt(tests.n(), %L, %L, 'borrowed', 1000)$$, :'np', gen_random_uuid()),
  'DK404', 'contact_not_found', 'kontak tidak ada = DK404');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
  $q$update app.debts set contact_id = %L where id = %L$q$, :'budi', :'d1')),
  'DK422', 'contact_archived', 'ganti kontak utang ke kontak terarsip ditolak');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.f(), format(
  $q$insert into app.debts (space_id, contact_id, direction, principal, mode, opened_on, created_by, updated_by)
     values (%L, %L, 'borrowed', 1000, 'baru', '2026-03-01', %L, %L)$q$, :'np', :'budi', tests.f(), tests.f())),
  'DK404', 'contact_not_found', 'kontak terarsip ruang lain juga DK404 (tanpa oracle arsip/keberadaan)');
-- Pokok, arah, mode, dan ruang tidak bisa diubah (K4: batal lalu catat ulang); kontak boleh.
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
  $q$update app.debts set principal = 900000 where id = %L$q$, :'d1')), 'DK422', 'debt_immutable', 'pokok tidak bisa diubah');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
  $q$update app.debts set direction = 'lent' where id = %L$q$, :'d1')), 'DK422', 'debt_immutable', 'arah tidak bisa diubah');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
  $q$update app.debts set mode = 'berjalan' where id = %L$q$, :'d1')), 'DK422', 'debt_immutable', 'mode tidak bisa diubah');
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format(
  $q$update app.debts set space_id = %L where id = %L$q$, :'fp', :'d1')), 'DK422', 'debt_immutable', 'ruang tidak bisa diubah');
select pg_temp.contact(tests.n(), :'np', 'Tono') as tono \gset
select is(tests.api_exec(tests.n(), format($$update app.debts set contact_id = %L where id = %L$$, :'tono', :'d1')),
  1::bigint, 'ganti kontak ke kontak aktif boleh (K4)');
select throws_ok(format($$select pg_temp.debt(tests.n(), %L, %L, 'borrowed', 0)$$, :'np', :'budi2'),
  '23514', null, 'pokok 0 ditolak');
select throws_ok(format($$select pg_temp.debt(tests.n(), %L, %L, 'borrowed', 10000000000001)$$, :'np', :'budi2'),
  '23514', null, 'pokok > 1e13 ditolak');
select throws_ok(format($$select pg_temp.debt(tests.n(), %L, %L, 'given', 1000)$$, :'np', :'budi2'),
  '23514', null, 'arah selain borrowed/lent ditolak');
select throws_ok(format($$select pg_temp.debt(tests.n(), %L, %L, 'borrowed', 1000, 'lama')$$, :'np', :'budi2'),
  '23514', null, 'mode selain baru/berjalan ditolak');
-- B10: utang di Bersama ditolak (tidak ada kontak Bersama; baris berjenis shared ditolak CHECK).
select throws_ok(format($$select pg_temp.debt(tests.n(), %L, %L, 'borrowed', 1000)$$, :'sh', :'budi2'),
  'DK404', 'contact_not_found', 'utang di Bersama ditolak [B10]');
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format(
  $q$insert into app.debts (space_id, space_kind, contact_id, direction, principal, mode, opened_on,
                            created_by, updated_by)
     select %L, 'shared', id, 'borrowed', 1000, 'baru', '2026-03-01', %L, %L from app.contacts where id = %L$q$,
  :'np', tests.n(), tests.n(), :'budi2')), '23514', null, 'baris utang berjenis shared ditolak CHECK [B10]');
select is(tests.web_val(tests.f(), format($$select count(*) from app.debts where space_id = %L$$, :'np')),
  '0', 'Farida tidak melihat utang Novanda');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format(
  $q$update app.debts set note = 'x' where id = %L$q$, :'d1')), '42501', null, 'web tidak punya hak tulis utang');
-- Arsip kontak tidak mengubah utang lama; ubah judul utang ber-kontak terarsip tetap boleh.
select pg_temp.contact(tests.n(), :'np', 'Sari') as sari \gset
select pg_temp.debt(tests.n(), :'np', :'sari', 'lent', 300000) as d2 \gset
select tests.api_exec(tests.n(), format($$update app.contacts set archived_at = now() where id = %L$$, :'sari'));
select is(tests.api_exec(tests.n(), format($$update app.debts set title = 'Pinjaman Sari', contact_id = contact_id,
  updated_at = now() where id = %L$$, :'d2')), 1::bigint, 'utang dengan kontak terarsip tetap bisa diubah judulnya (kontak ditulis ulang sama)');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
  $q$update app.debts set title = ' ' where id = %L$q$, :'d2')), '23514', null, 'judul kosong ditolak');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
  $q$update app.debts set title = repeat('j', 81) where id = %L$q$, :'d2')), '23514', null,
  'judul 81 huruf ditolak (opsional, 1..80)');

-- ===== Bentuk entri (private.assert_entry_shape) =====
select pg_temp.debt(tests.n(), :'np', :'budi2', 'borrowed', 400000, 'berjalan') as d3 \gset
select pg_temp.debt(tests.f(), :'fp', :'fbudi', 'lent', 50000) as fd \gset
select throws_ok(format($$select pg_temp.dentry(%L, 'debt_principal', %L, -1000000)$$, :'d1', :'bca'),
  'DK500', 'entry_shape_invalid', 'pokok utang negatif ditolak');
select throws_ok(format($$select pg_temp.dentry(%L, 'debt_principal', %L, 300000)$$, :'d2', :'bca'),
  'DK500', 'entry_shape_invalid', 'pokok piutang positif ditolak');
select throws_ok(format($$select pg_temp.dentry(%L, 'debt_payment', %L, 100000)$$, :'d1', :'bca'),
  'DK500', 'entry_shape_invalid', 'cicilan utang positif ditolak');
select throws_ok(format($$select pg_temp.dentry(%L, 'debt_payment', %L, -100000)$$, :'d2', :'bca'),
  'DK500', 'entry_shape_invalid', 'penerimaan piutang negatif ditolak');
select throws_ok(format($$select pg_temp.dentry(%L, 'debt_principal', %L, 400000)$$, :'d3', :'bca'),
  'DK500', 'entry_shape_invalid', 'utang berjalan tanpa entri pokok (K2)');
select throws_ok(format($$select pg_temp.dentry(%L, 'debt_principal', %L, 999999)$$, :'d1', :'bca'),
  'DK500', 'entry_shape_invalid', 'nominal pokok harus sama dengan principal');
select throws_ok(format($$select pg_temp.dentry(%L, 'debt_payment', %L, -100000)$$, :'d1', :'kan'),
  'DK500', 'entry_shape_invalid', 'dompet Kantor ditolak (K6)');
select pg_temp.debt(tests.n(), :'np', :'budi2', 'lent', 70000) as d4 \gset
select throws_ok(format($$select pg_temp.dentry(%L, 'debt_principal', %L, -70000)$$, :'d4', :'kan'),
  'DK500', 'entry_shape_invalid', 'piutang dari dompet Kantor ditolak (K6)');
select pg_temp.dentry(:'d1', 'debt_principal', :'bca', 1000000, '2026-03-01') as pk1 \gset
select isnt(:'pk1'::uuid, null::uuid, 'pokok utang (borrowed) = line main positif');
select lives_ok(format($$select pg_temp.dentry(%L, 'debt_principal', %L, -300000, '2026-03-01')$$, :'d2', :'tab'),
  'pokok piutang (lent) = line main negatif, dompet tabungan boleh');
select throws_ok(format($$select pg_temp.dentry(%L, 'debt_principal', %L, 1000000)$$, :'d1', :'bca'),
  '23505', null, 'satu pokok hidup per utang');
select throws_ok(format($$select pg_temp.dentry(%L, 'debt_payment', %L, -100000, '2026-03-10', %L)$$, :'d1', :'bca',
  format($q$insert into app.entry_lines (entry_id, space_id, role, account_id, amount) values (:id, %L, 'fee', %L, -1000);$q$,
         :'np', :'bca')),
  'DK500', 'entry_shape_invalid', 'cicilan dengan line fee ditolak');
select throws_ok(format($$select pg_temp.dentry(%L, 'debt_payment', %L, -100000, '2026-03-10', %L)$$, :'d1', :'bca',
  format($q$insert into app.entry_lines (entry_id, space_id, role, account_id, amount) values (:id, %L, 'counter', %L, 100000);$q$,
         :'np', :'tab')),
  'DK500', 'entry_shape_invalid', 'cicilan dengan line counter ditolak');
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format(
  $q$insert into app.entries (space_id, space_kind, kind, occurred_on, created_by, updated_by)
     values (%L, 'personal', 'debt_payment', '2026-03-10', %L, %L)$q$, :'np', tests.n(), tests.n())),
  '23514', null, 'entri utang tanpa debt_id ditolak');
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format(
  $q$insert into app.entries (space_id, space_kind, kind, occurred_on, debt_id, created_by, updated_by)
     values (%L, 'personal', 'expense', '2026-03-10', %L, %L, %L)$q$, :'np', :'d1', tests.n(), tests.n())),
  '23514', null, 'debt_id hanya untuk kind utang');
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format(
  $q$insert into app.entries (space_id, space_kind, kind, occurred_on, debt_id, created_by, updated_by)
     values (%L, 'shared', 'debt_payment', '2026-03-10', %L, %L, %L)$q$, :'sh', :'d1', tests.n(), tests.n())),
  '23514', null, 'entri utang di Bersama ditolak CHECK [B10]');
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format(
  $q$insert into app.entries (space_id, space_kind, kind, occurred_on, debt_id, created_by, updated_by)
     values (%L, 'personal', 'debt_payment', '2026-03-10', %L, %L, %L)$q$, :'np', :'fd', tests.n(), tests.n())),
  '23503', null, 'entri tidak bisa menunjuk utang ruang lain (FK komposit)');

-- ===== Sisa (app.debt_balances): principal − Σ pembayaran hidup =====
select is(pg_temp.bal(:'d1'), '1000000/0/1000000', 'utang tanpa cicilan: sisa = pokok');
select is(pg_temp.bal(:'d3'), '400000/0/400000', 'utang berjalan: sisa = pokok tanpa entri');
select pg_temp.dentry(:'d1', 'debt_payment', :'bca', -200000, '2026-03-05') as p1 \gset
select pg_temp.dentry(:'d1', 'debt_payment', :'tab', -300000, '2026-03-12') as p2 \gset
select pg_temp.dentry(:'d2', 'debt_payment', :'bca', 100000, '2026-03-15') as p3 \gset
select pg_temp.dentry(:'d3', 'debt_payment', :'bca', -50000, '2026-03-16') as p4 \gset
select is(pg_temp.bal(:'d1'), '1000000/500000/500000', 'dua cicilan hidup mengurangi sisa');
select is(pg_temp.bal(:'d2'), '300000/100000/200000', 'penerimaan piutang mengurangi sisa piutang');
select is(pg_temp.bal(:'d3'), '400000/50000/350000', 'cicilan utang berjalan mengurangi sisa');
select pg_temp.void(:'p2');
select is(pg_temp.bal(:'d1'), '1000000/200000/800000', 'cicilan batal tidak dihitung');
select is(tests.balance(:'tab'), '200000', 'saldo tabungan: pokok piutang keluar, cicilan batal kembali');
select is(tests.balance(:'bca'), '2850000', 'saldo BCA = awal + pokok − cicilan + penerimaan − cicilan berjalan');
select is(tests.web_val(tests.f(), format($$select count(*) from app.debt_balances where space_id = %L$$, :'np')),
  '0', 'Farida tidak melihat sisa utang Novanda (view security_invoker)');
select is(tests.api_val(tests.n(), format($$select count(*) from app.debt_balances where space_id = %L$$, :'np')),
  '4', 'dompetku_api membaca sisa utang ruang sendiri');
-- Utang terhapus: entri hidup baru ditolak; entri batal boleh tetap ada.
select tests.api_exec(tests.n(), format($$update app.debts set voided_at = now(), voided_by = %L where id = %L$$,
  tests.n(), :'d3'));
select throws_ok(format($$select pg_temp.dentry(%L, 'debt_payment', %L, -10000)$$, :'d3', :'bca'),
  'DK500', 'entry_shape_invalid', 'entri hidup untuk utang terhapus ditolak');
select lives_ok(format($$select tests.owner_exec(null, %L)$$, format($q$do $d$ begin
    set constraints all deferred;
    update app.entries set voided_at = now(), voided_by = created_by, version = version + 1 where id = %L;
    set constraints all immediate;
    set constraints all deferred;
  end $d$$q$, :'p4')), 'entri batal boleh tetap ada pada utang terhapus');
select throws_ok(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
  $q$update app.debts set voided_at = now() where id = %L$q$, :'d1')), '23514', null,
  'voided_at dan voided_by berpasangan');

-- ===== Kelas laporan dan DQ03 =====
select is(tests.web_val(null, $$select app.report_class('debt_principal', 'main', 'operasional', 'personal', null, false)$$), 'x_pokok_utang',
  'pokok = x_pokok_utang');
select is(tests.web_val(null, $$select app.report_class('debt_payment', 'main', 'tabungan', 'personal', null, false)$$), 'x_pelunasan_utang',
  'cicilan = x_pelunasan_utang');
select is(tests.worker_val(null, $$select violations from jobs.dq_reconcile() where check_id = 'DQ03'$$), '0',
  'DQ03: entri utang yang sah tidak dihitung');
-- Paritas DQ03 dengan assert_entry_shape: tiap kerusakan lewat raw_exec, dibatalkan blok exception.
create function pg_temp.dq03(p_sql text) returns text
language plpgsql as $f$
declare v text;
begin
  perform tests.raw_exec(p_sql);
  v := tests.worker_val(null, $q$select violations from jobs.dq_reconcile() where check_id = 'DQ03'$q$);
  raise exception using errcode = 'P0001', message = 'dq03=' || v;
exception when sqlstate 'P0001' then
  return split_part(sqlerrm, '=', 2);  -- blok exception membatalkan kerusakan
end $f$;
select is(pg_temp.dq03(format($$update app.entry_lines set amount = 200000 where entry_id = %L$$, :'p1')), '1',
  'DQ03: cicilan utang bertanda salah terdeteksi');
select is(pg_temp.dq03(format($$update app.entry_lines set amount = 999999 where entry_id = %L$$, :'pk1')), '1',
  'DQ03: nominal pokok berbeda dengan principal terdeteksi');
select is(pg_temp.dq03(format($$update app.entry_lines set account_id = %L where entry_id = %L$$, :'kan', :'p1')), '1',
  'DQ03: entri utang di dompet Kantor terdeteksi');
select is(pg_temp.dq03(format($$update app.debts set mode = 'berjalan' where id = %L$$, :'d1')), '1',
  'DQ03: entri pokok pada utang berjalan terdeteksi');
select is(pg_temp.dq03(format($$update app.debts set voided_at = now(), voided_by = created_by where id = %L$$, :'d1')), '2',
  'DQ03: pokok dan cicilan hidup pada utang terhapus terdeteksi');

-- ===== I6: pokok dan cicilan bukan pemasukan/pengeluaran =====
-- Pembanding: ruang kedua tanpa entri utang tidak praktis, jadi nilai dihitung ulang sesudah semua entri
-- utang dibatalkan dan dibandingkan dengan nilai saat entri utang hidup.
select tests.web_val(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 75000,
  null, '2026-03-11')$$, :'np', :'bca'));
select tests.web_val(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'income', 900000,
  null, '2026-03-02')$$, :'np', :'bca'));
create function pg_temp.angka() returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select concat_ws(' | ',
    (select string_agg(report_class || '=' || inflow || '/' || outflow, ',' order by report_class)
       from api.period_summary(%1$L, '2026-03-01', '2026-03-31') where report_class not like 'x\_%%'),
    (select row(m.pemasukan, m.pengeluaran)::text from api.month_summary(%1$L, '2026-03-01') m),
    (select string_agg(kind || ':' || type || ':' || amount, ',' order by kind, type)
       from api.category_summary(%1$L, '2026-03-01', '2026-03-31')),
    (select string_agg(pemasukan || '/' || pengeluaran, ',' order by starts_on)
       from api.period_trend(%1$L, '2026-03-01', 3)),
    (select row(s.budget_wajib_remaining)::text from api.safe_to_spend(%1$L) s),
    (select row(p.*)::text from api.spend_pace(%1$L, '2026-04-15') p))$q$, tests.space_id(tests.n(), 'personal')))
$$;
select pg_temp.angka() as hidup \gset
select is(tests.web_val(tests.n(), format($$select string_agg(report_class || ':' || direction || '=' || amount
  || '#' || entry_count, ',' order by report_class, direction)
  from api.excluded_summary(%L, '2026-03-01', '2026-03-31') where report_class like '%%utang'$$, :'np')),
  'x_pelunasan_utang:in=100000#1,x_pelunasan_utang:out=200000#1,x_pokok_utang:in=1000000#1,x_pokok_utang:out=300000#1',
  'Laporan "Tidak termasuk": pokok dan cicilan per arah (cicilan batal tidak dihitung)');
select is(tests.web_val(tests.n(), format($$select string_agg(kind || ':' || report_class || ':' || amount, ','
  order by occurred_on, amount) from api.export_entries(%L, '2026-03-01', '2026-03-31') where kind like 'debt%%'$$, :'np')),
  'debt_principal:x_pokok_utang:-300000,debt_principal:x_pokok_utang:1000000,'
  || 'debt_payment:x_pelunasan_utang:-200000,debt_payment:x_pelunasan_utang:100000',
  'ekspor memuat kaki utang dengan kelas baru');
select is(tests.web_val(tests.n(), format($$select count(*) from api.period_summary(%L, '2026-03-01', '2026-03-31')
  where report_class is null$$, :'np')), '0', 'period_summary tanpa kelas NULL');
select tests.owner_exec(null, $$update app.entries set voided_at = now(), voided_by = created_by,
  version = version + 1 where kind in ('debt_principal', 'debt_payment') and voided_at is null$$);
select is(pg_temp.angka(), :'hidup',
  'Σ pemasukan/pengeluaran, kategori, tren, aman dipakai (anggaran wajib), laju belanja sama dengan atau tanpa entri utang [I6]');
select isnt(:'hidup'::text, null::text, 'pembanding I6 terisi');

-- ===== I6 lewat API (0131) =====
-- Dijamin: pokok dan cicilan tidak mengubah Σ pemasukan/pengeluaran, kategori, tren, anggaran wajib, laju
-- belanja, dan Laporan (pg_temp.angka). "Aman dipakai" (operasional/total/per_day) mengikuti saldo kas:
-- pinjaman yang masuk ke dompet operasional MENAIKKAN angka sebesar kas nyata. Keterbatasan terbuka,
-- keputusan pemilik; lihat handoff s11.
create function pg_temp.aman() returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select operasional || '/' || total || '/' || per_day || '/' || days_left
    from api.safe_to_spend(%L)$q$, tests.space_id(tests.n(), 'personal')))
$$;
create function pg_temp.geser(p_base text, p_delta bigint) returns text
language sql as $$
  select (a[1]::bigint + p_delta) || '/' || (a[2]::bigint + p_delta) || '/'
         || floor((a[2]::bigint + p_delta)::numeric / a[4]::int)::bigint || '/' || a[4]
  from (select string_to_array(p_base, '/') a) x
$$;
create function pg_temp.api(p_sql text) returns jsonb
language sql as $$ select tests.web_val(tests.n(), p_sql)::jsonb $$;
select pg_temp.angka() as angka0, pg_temp.aman() as aman0 \gset
select pg_temp.api(format($$select api.create_debt(gen_random_uuid(), %L, 'borrowed', 5000000, 'baru', %L, null, %L)$$,
  :'np', :'tono', :'bca')) ->> 'debt_id' as i6 \gset
select is(pg_temp.angka() || ' # ' || pg_temp.aman(), :'angka0' || ' # ' || pg_temp.geser(:'aman0', 5000000),
  'pinjam 5 jt ke operasional: angka Laporan/anggaran tetap [I6]; aman dipakai naik sebesar kas (keterbatasan terbuka)');
select pg_temp.api(format($$select api.pay_debt(gen_random_uuid(), %L, %L, 1000000)$$, :'i6', :'bca'));
select is(pg_temp.angka() || ' # ' || pg_temp.aman(), :'angka0' || ' # ' || pg_temp.geser(:'aman0', 4000000),
  'bayar cicilan dari operasional: Laporan tetap, aman dipakai turun sebesar kas');
select pg_temp.api(format($$select api.pay_debt(gen_random_uuid(), %L, %L, 500000)$$, :'i6', :'tab'));
select is(pg_temp.angka() || ' # ' || pg_temp.aman(), :'angka0' || ' # ' || pg_temp.geser(:'aman0', 4000000),
  'bayar cicilan dari Tabungan: Laporan dan aman dipakai tetap');
select pg_temp.api(format($$select api.pay_debt(gen_random_uuid(), %L, %L, 3500000)$$, :'i6', :'bca'));
select is(pg_temp.angka() || ' # ' || pg_temp.aman(), :'angka0' || ' # ' || pg_temp.geser(:'aman0', 500000),
  'bayar lunas: Laporan tetap, aman dipakai mengikuti kas');
select pg_temp.api(format($$select api.void_debt(gen_random_uuid(), %L)$$, :'i6'));
select is(pg_temp.angka() || ' # ' || pg_temp.aman(), :'angka0' || ' # ' || :'aman0',
  'hapus utang: semua efek kas dibalik, Laporan tetap');
select pg_temp.api(format($$select api.restore_debt(gen_random_uuid(), %L)$$, :'i6'));
select is(pg_temp.angka() || ' # ' || pg_temp.aman(), :'angka0' || ' # ' || pg_temp.geser(:'aman0', 500000),
  'pulihkan utang: efek kas kembali, Laporan tetap');
select pg_temp.api(format($$select api.create_debt(gen_random_uuid(), %L, 'borrowed', 1000000, 'berjalan', %L)$$,
  :'np', :'tono'));
select is(pg_temp.angka() || ' # ' || pg_temp.aman(), :'angka0' || ' # ' || pg_temp.geser(:'aman0', 500000),
  'utang berjalan: nol efek kas dan Laporan (K2)');
select pg_temp.api(format($$select api.create_debt(gen_random_uuid(), %L, 'lent', 300000, 'baru', %L, null, %L)$$,
  :'np', :'tono', :'bca'));
select is(pg_temp.angka() || ' # ' || pg_temp.aman(), :'angka0' || ' # ' || pg_temp.geser(:'aman0', 200000),
  'piutang dari operasional: Laporan tetap, kas keluar');

select * from finish();
rollback;
