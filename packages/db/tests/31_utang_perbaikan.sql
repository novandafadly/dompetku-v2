-- Perbaikan utang S12 (0132; plan S12 Task 2, K1, K6, K7): Catatan ekspor untuk baris pokok/cicilan
-- = coalesce(description, kontak · judul) dengan Σ per kelas tetap = Laporan, dan api.debt_totals
-- (kartu "Utang yang harus dibayar": Σ sisa borrowed, Σ sisa lent, jumlah utang aktif; hanya Pribadi,
-- utang terhapus tidak dihitung, sisa tidak pernah negatif). private.lock_debt (K7) diuji di
-- 99_konkurensi.sql (purge menghapus utang di antara baca dan kunci). Jam dipatok 2026-03-20 WIB.
-- ID: B10
begin;
select plan(15);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 5000000, '2026-01-01') as bca \gset

create function pg_temp.call(p_sql text) returns jsonb
language sql as $$ select tests.web_val(tests.n(), p_sql)::jsonb $$;
create function pg_temp.contact(p_name text) returns uuid
language sql as $$
  select (pg_temp.call(format($q$select api.create_contact(gen_random_uuid(), %L, %L)$q$,
    tests.space_id(tests.n(), 'personal'), p_name)) ->> 'contact_id')::uuid
$$;
create function pg_temp.debt(p_dir text, p_principal bigint, p_mode text, p_contact uuid, p_acc uuid,
  p_title text default null) returns uuid
language sql as $$
  select (pg_temp.call(format(
    $q$select api.create_debt(gen_random_uuid(), %L, %L, %s, %L, %L, null, %L, '2026-03-02', %L)$q$,
    tests.space_id(tests.n(), 'personal'), p_dir, p_principal, p_mode, p_contact, p_acc, p_title)) ->> 'debt_id')::uuid
$$;
create function pg_temp.pay(p_debt uuid, p_acc uuid, p_amount bigint) returns uuid
language sql as $$
  select (pg_temp.call(format($q$select api.pay_debt(gen_random_uuid(), %L, %L, %s, '2026-03-15')$q$,
    p_debt, p_acc, p_amount)) ->> 'entry_id')::uuid
$$;
create function pg_temp.exp(p_expr text) returns text
language sql as $$
  select tests.web_val(tests.n(), format($q$select %s from api.export_entries(%L, '2026-03-01', '2026-03-31') x$q$,
    p_expr, tests.space_id(tests.n(), 'personal')))
$$;
create function pg_temp.totals(p_uid uuid, p_space uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select borrowed_remaining || '/' || lent_remaining || '/' || active_count
    from api.debt_totals(%L)$q$, p_space))
$$;

select pg_temp.contact('Budi') as budi, pg_temp.contact('Sari') as sari, pg_temp.contact('Tono') as tono \gset

-- ===== debt_totals kosong =====
select is(pg_temp.totals(tests.n(), :'np'), '0/0/0', 'debt_totals tanpa utang = 0/0/0 (satu baris)');

-- Utang: d1 borrowed 1 jt (judul Motor, dibayar 100 rb), d2 borrowed berjalan 500 rb, d3 lent 300 rb
-- tanpa judul, d4 borrowed 200 rb lunas, d5 borrowed 400 rb lalu dihapus.
select pg_temp.debt('borrowed', 1000000, 'baru', :'budi', :'bca', 'Motor') as d1,
       pg_temp.debt('borrowed', 500000, 'berjalan', :'tono', null) as d2,
       pg_temp.debt('lent', 300000, 'baru', :'sari', :'bca') as d3,
       pg_temp.debt('borrowed', 200000, 'baru', :'tono', :'bca', 'Pulsa') as d4,
       pg_temp.debt('borrowed', 400000, 'baru', :'sari', :'bca', 'Hapus') as d5 \gset
select pg_temp.pay(:'d1', :'bca', 100000) as p1, pg_temp.pay(:'d4', :'bca', 200000) as p4 \gset
select pg_temp.call(format($$select api.void_debt(gen_random_uuid(), %L)$$, :'d5'));
select tests.web_val(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 25000,
  null, '2026-03-10', 'Makan siang')$$, :'np', :'bca'));

-- ===== Ekspor: Catatan baris utang (K6) =====
select is(pg_temp.exp($$string_agg(x.kind || ':' || x.amount || ':' || coalesce(x.note, '-'), ',' order by x.kind, x.amount)$$),
  'debt_payment:-200000:Tono · Pulsa,debt_payment:-100000:Budi · Motor,'
  || 'debt_principal:-300000:Sari,debt_principal:200000:Tono · Pulsa,debt_principal:1000000:Budi · Motor,'
  || 'expense:-25000:Makan siang',
  'Catatan pokok/cicilan = kontak · judul (tanpa judul = kontak), Jenis tetap kunci mesin, entri terhapus tidak ikut');
select is(pg_temp.exp($$count(*)$$), '6', 'jumlah baris ekspor tidak berubah (satu per kaki)');
select is(tests.web_val(tests.n(), format($$select string_agg(c || ':' || d || ':' || s, ',' order by c, d) from (
    select x.report_class c, case when x.amount > 0 then 'in' else 'out' end d, sum(abs(x.amount)) s
      from api.export_entries(%L, '2026-03-01', '2026-03-31') x
     where x.report_class like 'x\_%%' group by 1, 2) q$$, :'np')),
  tests.web_val(tests.n(), format($$select string_agg(report_class || ':' || direction || ':' || amount, ','
    order by report_class, direction) from api.excluded_summary(%L, '2026-03-01', '2026-03-31')
    where report_class like '%%utang'$$, :'np')),
  'Σ per kelas utang di ekspor = Laporan "Tidak termasuk"');
-- Deskripsi entri (bila ada) tetap menang.
select tests.owner_exec(null, format($$update app.entries set description = 'Cicilan Maret' where id = %L$$, :'p1'));
select is(pg_temp.exp(format($$string_agg(x.note, ',') filter (where x.amount = -100000 and x.kind = 'debt_payment')$$)),
  'Cicilan Maret', 'Catatan = deskripsi entri bila terisi');
-- Kontak diganti nama: Catatan mengikuti nama terbaru.
select pg_temp.call(format($$select api.rename_contact(%L, 'Budi Santoso')$$, :'budi'));
select is(pg_temp.exp($$string_agg(x.note, ',') filter (where x.kind = 'debt_principal' and x.amount = 1000000)$$),
  'Budi Santoso · Motor', 'Catatan memakai nama kontak terbaru');

-- ===== debt_totals (K1) =====
select is(pg_temp.totals(tests.n(), :'np'), '1400000/300000/3',
  'Σ sisa borrowed (900 rb + 500 rb berjalan), Σ sisa lent, 3 utang aktif (lunas dan terhapus tidak)');
select pg_temp.call(format($$select api.void_debt(gen_random_uuid(), %L)$$, :'d3'));
select is(pg_temp.totals(tests.n(), :'np'), '1400000/0/2', 'piutang dihapus: tidak dihitung');
select pg_temp.call(format($$select api.restore_debt(gen_random_uuid(), %L)$$, :'d3'));
select is(pg_temp.totals(tests.n(), :'np'), '1400000/300000/3', 'piutang dipulihkan: dihitung lagi');
select pg_temp.pay(:'d2', :'bca', 500000);
select is(pg_temp.totals(tests.n(), :'np'), '900000/300000/2', 'utang berjalan lunas: keluar dari Σ dan jumlah aktif');
-- Data rusak (DQ05, sisa negatif) tidak membuat Σ negatif atau mengurangi utang lain.
select tests.raw_exec(format($$update app.debts set principal = 50000 where id = %L$$, :'d1'));
select is(pg_temp.totals(tests.n(), :'np'), '0/300000/1', 'sisa negatif dihitung 0, tidak pernah negatif');
select is(pg_temp.totals(tests.f(), :'fp'), '0/0/0', 'Pribadi pasangan tanpa utang = 0/0/0');
select throws_ok(format($$select pg_temp.totals(tests.n(), %L)$$, :'sh'), 'DK422', 'debt_personal_only',
  'debt_totals ruang Bersama ditolak [B10]');
select throws_ok(format($$select pg_temp.totals(tests.f(), %L)$$, :'np'), 'DK404', 'space_not_found',
  'debt_totals Pribadi orang lain = DK404');
select throws_ok(format($$select pg_temp.totals(null, %L)$$, :'np'), 'DK401', 'unauthenticated',
  'debt_totals tanpa konteks = DK401');

select * from finish();
rollback;
