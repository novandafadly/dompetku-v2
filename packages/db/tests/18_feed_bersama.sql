-- Feed aktivitas Bersama (S8, 0114; plan S8 Task 2, bingkai S8-A2/A3, Review Focus #1, #2, #4):
-- api.shared_activity = riwayat entri ruang Bersama dengan pelaku, sebelum/sesudah dari versi
-- sebelumnya entri yang sama, penanda entri dipindah (R26), kursor stabil, tanpa kolom dompet,
-- link_id, lines, atau teks kaki Pribadi (K1, R16, R24). Persona N (pemilik), F (anggota lewat
-- undangan), Luar (tests.x(), tanpa ruang mana pun). Kanari Pribadi N dan F.
-- Semua lewat api.* sebagai role web; jam dipatok 2026-03-20 WIB. Di dalam satu transaksi tes
-- changed_at semua riwayat sama (now()), jadi urutan antar entri ditentukan entry_id lalu version
-- (kasus seri kursor); urutan menurut waktu diuji dengan dua baris riwayat sintetis milik owner.
-- ID: B4, B8, B20
begin;
select plan(54);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

select tests.account(tests.n(), :'np', 'KANARI-DOMPET-N', 'operasional', 7777777, '2026-01-01') as bca,
       tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 300000, '2026-01-01') as kas,
       tests.account(tests.n(), :'sh', 'Tabungan Rumah', 'operasional', 0, '2026-01-01') as tab,
       tests.account(tests.f(), :'fp', 'KANARI-DOMPET-F', 'operasional', 6666666, '2026-01-01') as fbca \gset

create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
create function pg_temp.cat(p_space uuid, p_type text, p_n int) returns uuid
language sql as $$
  select tests.owner_val(null, format(
    $q$select id from app.categories where space_id = %L and type = %L and parent_id is null
         and archived_at is null order by sort_order, name offset %s limit 1$q$, p_space, p_type, p_n))::uuid
$$;
-- Pelaku sebagai huruf (N/F/?) agar asersi mudah dibaca.
create function pg_temp.who(p uuid) returns text language sql as $$
  select case p when tests.n() then 'N' when tests.f() then 'F' else '?' end
$$;
-- Baris feed satu entri, urut keluaran fungsi: op:version:pelaku:amount:before_amount.
create function pg_temp.hist(p_uid uuid, p_entry uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select string_agg(op || ':' || version || ':'
         || case actor_id when '11111111-1111-1111-1111-111111111111' then 'N'
                          when '22222222-2222-2222-2222-222222222222' then 'F' else '?' end
         || ':' || coalesce(amount::text, '-') || ':' || coalesce(before_amount::text, '-'), ',')
       from api.shared_activity(%L, 100) where entry_id = %L$q$,
    tests.space_id(tests.n(), 'shared'), p_entry))
$$;
-- Galat sebagai teks sqlstate:message:detail (detail tidak bisa diperiksa throws_ok).
create function pg_temp.err(p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare v_state text; v_msg text; v_detail text;
begin
  perform tests.web_exec(p_uid, p_sql);
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
  return v_state || ':' || v_msg || ':' || coalesce(v_detail, '-');
end $$;
-- Seluruh keluaran (100 baris) sebagai teks, untuk kanari.
create function pg_temp.dump(p_uid uuid, p_space uuid) returns text
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select coalesce(string_agg(a::text, E'\n'), '') from api.shared_activity(%L, 100) a$q$, p_space))
$$;

select pg_temp.cat(:'sh', 'expense', 0) as cat_a, pg_temp.cat(:'sh', 'expense', 1) as cat_b,
       pg_temp.cat(:'np', 'expense', 0) as cat_np \gset

-- ===== Bentuk fungsi (Interfaces Task 2): kolom tetap, tanpa dompet/link/lines =====
-- dompetku_test tanpa USAGE skema api: fungsi dicari lewat katalog, bukan cast regprocedure.
select (select coalesce(string_agg(p.oid::text, ','), '0') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'api' and p.proname = 'shared_activity') as fn \gset
select is((select pg_get_function_result(:'fn'::oid)),
  'TABLE(entry_id uuid, version integer, op app.history_op, kind app.entry_kind, direction app.entry_direction, '
  || 'actor_id uuid, at timestamp with time zone, occurred_on date, amount bigint, before_amount bigint, '
  || 'category_id uuid, before_category_id uuid, description text, shared_note text, moved boolean)',
  'kolom hasil persis Interfaces (tanpa account_id, link_id, lines, created_by)');
select is((select pg_get_function_arguments(:'fn'::oid)),
  'p_space_id uuid, p_limit integer DEFAULT 20, p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone, '
  || 'p_before_entry uuid DEFAULT NULL::uuid, p_before_version integer DEFAULT NULL::integer',
  'argumen dan bawaan persis Interfaces');
select is((select p.prosecdef::text || ' ' || p.provolatile::text || ' ' || p.proowner::regrole::text
             || ' ' || array_to_string(p.proconfig, ',')
           from pg_proc p where p.oid = :'fn'::oid),
  'false s dompetku_owner search_path=""', 'SECURITY INVOKER, STABLE, milik owner (pola baca api), search_path kosong');
select is((select string_agg(r, ',' order by r) from unnest(array['dompetku_web', 'dompetku_api',
             'dompetku_worker', 'dompetku_auditor', 'dompetku_test']) r
           where has_function_privilege(r, :'fn'::oid, 'EXECUTE')),
  'dompetku_web', 'EXECUTE hanya dompetku_web (bukan api, worker, auditor)');
select is(tests.web_val(tests.n(), format($$select count(*) from api.shared_activity(%L)$$, :'sh')),
  '0', 'Bersama baru: saldo awal dompet tidak masuk feed (opening_balance dikeluarkan)');

-- ===== Review Focus #2: create, update nominal (F), update kategori (N), void (F), restore (N) =====
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 50000, %L, '2026-03-20', 'Makan siang')$$,
  :'sh', :'kas', :'cat_a')) ->> 'entry_id' as e1 \gset
select is(pg_temp.hist(tests.n(), :'e1'), 'create:1:N:50000:-', 'N mencatat: satu baris create, pelaku N, tanpa sebelum');
select pg_temp.call(tests.f(), format($$select api.update_entry(gen_random_uuid(), %L, 1, %L, 75000, %L, '2026-03-20', 'Makan siang', false)$$,
  :'e1', :'kas', :'cat_a'));
select pg_temp.call(tests.n(), format($$select api.update_entry(gen_random_uuid(), %L, 2, %L, 75000, %L, '2026-03-20', 'Makan siang', false)$$,
  :'e1', :'kas', :'cat_b'));
select is(tests.web_val(tests.n(), format($$select before_amount || '>' || amount || ' ' || (before_category_id = %L) || ' ' || (category_id = %L)
  from api.shared_activity(%L, 100) where entry_id = %L and version = 2$$, :'cat_a', :'cat_a', :'sh', :'e1')),
  '50000>75000 true true', 'F ubah nominal: before_amount 50000, amount 75000, kategori tetap');
select is(tests.web_val(tests.n(), format($$select before_amount || '>' || amount || ' ' || (before_category_id = %L) || ' ' || (category_id = %L)
  from api.shared_activity(%L, 100) where entry_id = %L and version = 3$$, :'cat_a', :'cat_b', :'sh', :'e1')),
  '75000>75000 true true', 'N ubah kategori: before_* dari versi sebelumnya (75000, bukan versi pertama), kategori lama -> baru');
select pg_temp.call(tests.f(), format($$select api.void_entry(gen_random_uuid(), %L, 3)$$, :'e1'));
select pg_temp.call(tests.n(), format($$select api.restore_entry(gen_random_uuid(), %L, 4)$$, :'e1'));
select is(pg_temp.hist(tests.f(), :'e1'),
  'restore:5:N:75000:75000,void:4:F:75000:75000,update:3:N:75000:75000,update:2:F:75000:50000,create:1:N:50000:-',
  'lima baris turun menurut versi, pelaku per baris benar [B8, B20]');
select is(tests.web_val(tests.f(), format($$select string_agg(kind || '/' || coalesce(direction::text, '-') || '/' || occurred_on
    || '/' || coalesce(description, '-') || '/' || coalesce(shared_note, '-') || '/' || moved, ',' order by version)
  from api.shared_activity(%L, 100) where entry_id = %L$$, :'sh', :'e1')),
  'expense/-/2026-03-20/Makan siang/-/false,expense/-/2026-03-20/Makan siang/-/false,expense/-/2026-03-20/Makan siang/-/false,'
  || 'expense/-/2026-03-20/Makan siang/-/false,expense/-/2026-03-20/Makan siang/-/false',
  'kind, tanggal, deskripsi Bersama; void biasa moved = false');
select is(tests.web_val(tests.f(), format($$select version || ':' || before_amount || '>' || amount
  from api.shared_activity(%L, 1, now(), %L, 3)$$, :'sh', :'e1')),
  '2:50000>75000', 'before_* tidak bergantung halaman: baris tunggal sesudah kursor tetap punya versi sebelumnya');
select is(pg_temp.dump(tests.n(), :'sh'), pg_temp.dump(tests.f(), :'sh'), 'N dan F melihat feed yang sama');

-- Tanggal mundur: occurred_on dari snapshot (bingkai A1, hanya create/restore yang menampilkannya).
select pg_temp.call(tests.f(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 5000, null, '2026-03-15', 'Parkir')$$,
  :'sh', :'kas')) ->> 'entry_id' as e_mundur \gset
select is(tests.web_val(tests.n(), format($$select op || ' ' || occurred_on || ' ' || (at = now()) || ' ' || coalesce(category_id::text, '-')
  from api.shared_activity(%L, 100) where entry_id = %L$$, :'sh', :'e_mundur')),
  'create 2026-03-15 true -', 'tanggal transaksi (occurred_on) terpisah dari waktu peristiwa (at = changed_at)');

-- Transfer dalam Bersama: deskripsi Bersama ikut, tanpa arah.
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 20000, 0, null, 'pindah ke tabungan')$$,
  :'sh', :'kas', :'tab')) ->> 'entry_id' as e_trf \gset
select is(tests.web_val(tests.f(), format($$select op || ' ' || kind || ' ' || coalesce(direction::text, '-') || ' ' || amount || ' ' || description
  from api.shared_activity(%L, 100) where entry_id = %L$$, :'sh', :'e_trf')),
  'create transfer - 20000 pindah ke tabungan', 'transfer dalam Bersama: deskripsi Bersama, tanpa arah, nominal main');

-- Cocokkan saldo: arah diturunkan dari tanda line main (kolom direction entri adjustment NULL).
select pg_temp.call(tests.n(), format($$select api.reconcile_balance(gen_random_uuid(), %L, %s)$$, :'tab', 25000)) ->> 'entry_id' as adj_in \gset
select pg_temp.call(tests.n(), format($$select api.reconcile_balance(gen_random_uuid(), %L, %s)$$, :'tab', 21000)) ->> 'entry_id' as adj_out \gset
select is(tests.web_val(tests.f(), format($$select string_agg(kind || ':' || direction || ':' || amount, ',' order by entry_id = %L desc)
  from api.shared_activity(%L, 100) where entry_id in (%L, %L)$$, :'adj_in', :'sh', :'adj_in', :'adj_out')),
  'adjustment:in:5000,adjustment:out:4000', 'adjustment: arah in/out dari tanda nominal, nominal tanpa tanda');

-- ===== Review Focus #1: setor N dan ambil F dengan kanari Pribadi =====
select pg_temp.call(tests.n(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 150000, 0, null, 'KANARI-N-SETOR', 'catatan-bersama')$$,
  :'np', :'bca', :'kas')) as setor \gset
select pg_temp.call(tests.f(), format($$select api.create_transfer(gen_random_uuid(), %L, %L, %L, 40000, 2500, null, 'KANARI-F-AMBIL')$$,
  :'sh', :'kas', :'fbca')) as ambil \gset
select is(tests.web_val(tests.f(), format($$select op || ' ' || kind || ' ' || direction || ' ' || (actor_id = %L) || ' ' || amount || ' '
    || coalesce(description, '-') || ' ' || coalesce(shared_note, '-')
  from api.shared_activity(%L, 100) where entry_id = %L$$, tests.n(), :'sh', (:'setor'::jsonb) ->> 'linked_entry_id')),
  'create space_transfer in true 150000 - catatan-bersama', 'setor N: kaki Bersama in, tanpa deskripsi, dengan shared_note [B4]');
select is(tests.web_val(tests.n(), format($$select op || ' ' || kind || ' ' || direction || ' ' || (actor_id = %L) || ' ' || amount || ' '
    || coalesce(description, '-') || ' ' || coalesce(shared_note, '-')
  from api.shared_activity(%L, 100) where entry_id = %L$$, tests.f(), :'sh', (:'ambil'::jsonb) ->> 'entry_id')),
  'create space_transfer out true 40000 - -', 'ambil F: kaki Bersama out, nominal main tanpa biaya, tanpa deskripsi dan catatan');
select is(tests.web_val(tests.f(), format($$select count(*) from api.shared_activity(%L, 100) where entry_id in (%L, %L)$$,
  :'sh', (:'setor'::jsonb) ->> 'entry_id', (:'ambil'::jsonb) ->> 'linked_entry_id')), '0',
  'kaki Pribadi setor N dan ambil F tidak punya baris');

-- Pindah Bersama -> Pribadi oleh N: baris void bertanda moved; entri Pribadi baru tidak terlihat.
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 85000, %L, null, 'galon')$$,
  :'sh', :'kas', :'cat_a')) ->> 'entry_id' as e_mv \gset
select pg_temp.call(tests.n(), format($$select api.move_entry_to_space(gen_random_uuid(), %L, 1, %L, %L, %L)$$,
  :'e_mv', :'np', :'bca', :'cat_np')) ->> 'entry_id' as e_mv_new \gset
select is(tests.web_val(tests.f(), format($$select string_agg(op || ':' || moved || ':' || amount || ':' || coalesce(before_amount::text, '-'), ',' order by version)
  from api.shared_activity(%L, 100) where entry_id = %L$$, :'sh', :'e_mv')),
  'create:false:85000:-,void:true:85000:85000', 'dipindah ke Pribadi: baris void moved = true, nominal tetap (R26)');
select is(tests.web_val(tests.n(), format($$select count(*) from api.shared_activity(%L, 100) where moved$$, :'sh')),
  '1', 'hanya entri yang dipindah bertanda moved');

-- Pindah Pribadi -> Bersama oleh N: satu create di Bersama, tanpa id asal.
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 33000, %L, null, 'KANARI-N-PRIBADI')$$,
  :'np', :'bca', :'cat_np')) ->> 'entry_id' as e_np \gset
select pg_temp.call(tests.n(), format($$select api.move_entry_to_space(gen_random_uuid(), %L, 1, %L, %L, %L)$$,
  :'e_np', :'sh', :'kas', :'cat_a')) ->> 'entry_id' as e_np_new \gset
select is(tests.web_val(tests.f(), format($$select string_agg(op || ':' || version || ':' || coalesce(description, '-') || ':' || amount, ',')
  from api.shared_activity(%L, 100) where entry_id = %L$$, :'sh', :'e_np_new')),
  'create:1:-:33000', 'Pribadi -> Bersama: satu create tanpa deskripsi Pribadi (p_keep_description bawaan false)');

-- Kanari: seluruh keluaran (::text) untuk N dan F tanpa teks, nama dompet, id dompet, link_id,
-- atau id entri Pribadi; juga tanpa id/nama dompet Bersama (K1).
select pg_temp.call(tests.f(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 6000, null, null, 'KANARI-F-PRIBADI')$$,
  :'fp', :'fbca')) ->> 'entry_id' as e_fp \gset
create temp table forbidden (label text, needle text);
insert into forbidden values
  ('KANARI-N-SETOR', 'KANARI-N-SETOR'), ('KANARI-F-AMBIL', 'KANARI-F-AMBIL'),
  ('KANARI-N-PRIBADI', 'KANARI-N-PRIBADI'), ('KANARI-F-PRIBADI', 'KANARI-F-PRIBADI'),
  ('KANARI-DOMPET', 'KANARI-DOMPET'), ('Kas Rumah', 'Kas Rumah'), ('Tabungan Rumah', 'Tabungan Rumah'),
  ('7777777', '7777777'), ('6666666', '6666666'),
  ('id dompet N', :'bca'), ('id dompet F', :'fbca'), ('id dompet Bersama kas', :'kas'),
  ('id dompet Bersama tab', :'tab'),
  ('link_id setor', (:'setor'::jsonb) ->> 'link_id'), ('link_id ambil', (:'ambil'::jsonb) ->> 'link_id'),
  ('kaki Pribadi setor', (:'setor'::jsonb) ->> 'entry_id'), ('kaki Pribadi ambil', (:'ambil'::jsonb) ->> 'linked_entry_id'),
  ('entri Pribadi hasil pindah', :'e_mv_new'), ('entri Pribadi asal pindah', :'e_np'), ('entri Pribadi F', :'e_fp'),
  ('kategori Pribadi', :'cat_np');
select is((select string_agg(label, ',') from forbidden where pg_temp.dump(tests.n(), :'sh') like '%' || needle || '%'), null,
  'feed untuk N: tanpa kanari, nama/id dompet, link_id, id entri atau kategori Pribadi [B4]');
select is((select string_agg(label, ',') from forbidden where pg_temp.dump(tests.f(), :'sh') like '%' || needle || '%'), null,
  'feed untuk F: tanpa kanari, nama/id dompet, link_id, id entri atau kategori Pribadi [B4]');
select ok(pg_temp.dump(tests.n(), :'sh') like '%catatan-bersama%' and pg_temp.dump(tests.n(), :'sh') like '%Makan siang%',
  'kanari kontrol: teks Bersama sendiri (shared_note, deskripsi) memang ada di dump');
select is(tests.web_val(tests.n(), format($$select count(*) from api.shared_activity(%L, 100) where kind = 'space_transfer' and description is not null$$, :'sh')),
  '0', 'deskripsi selalu NULL untuk space_transfer');
-- Pertahanan berlapis: riwayat sintetis (owner) kaki Bersama setor dengan description di snapshot
-- (CHECK entries mencegahnya di tabel, snapshot tidak dijaga CHECK) tetap keluar NULL.
select tests.owner_exec(null, format($$insert into app.entry_history (entry_id, space_id, version, op, snapshot, changed_by, changed_at)
  select entry_id, space_id, 80, 'update', jsonb_set(snapshot, '{description}', '"KANARI-SNAPSHOT"'), %L, now()
  from app.entry_history where entry_id = %L and version = 1$$, tests.n(), (:'setor'::jsonb) ->> 'linked_entry_id'));
select is(tests.web_val(tests.f(), format($$select kind || ' ' || coalesce(description, 'NULL')
  from api.shared_activity(%L, 100) where entry_id = %L and version = 80$$, :'sh', (:'setor'::jsonb) ->> 'linked_entry_id')),
  'space_transfer NULL', 'snapshot space_transfer berdeskripsi tetap keluar description NULL');

-- Void setoran oleh N: kedua kaki batal; Bersama hanya menerima baris void kaki Bersama.
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, (:'setor'::jsonb) ->> 'entry_id'));
select is(tests.web_val(tests.f(), format($$select string_agg(op || ':' || direction || ':' || moved || ':' || coalesce(shared_note, '-'), ',' order by version)
  from api.shared_activity(%L, 100) where entry_id = %L and version < 80$$, :'sh', (:'setor'::jsonb) ->> 'linked_entry_id')),
  'create:in:false:catatan-bersama,void:in:false:catatan-bersama', 'void setoran: baris void kaki Bersama, bukan moved');

-- Purge: entri dan riwayatnya hilang dari feed.
select pg_temp.call(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1234, null, null, 'akan dipurge')$$,
  :'sh', :'kas')) ->> 'entry_id' as e_pg \gset
select pg_temp.call(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'e_pg'));
select pg_temp.call(tests.n(), format($$select api.purge_entry(%L, 2)$$, :'e_pg'));
select is(tests.web_val(tests.n(), format($$select count(*) from api.shared_activity(%L, 100) where entry_id = %L$$, :'sh', :'e_pg')),
  '0', 'entri yang dipurge tidak punya baris');

-- ===== Ruang Pribadi dan akses =====
select is(tests.web_val(tests.n(), format($$select count(*) from api.shared_activity(%L, 100)$$, :'np')), '0',
  'Pribadi N oleh N = 0 baris (walau berisi entri)');
select is(tests.web_val(tests.f(), format($$select count(*) from api.shared_activity(%L, 100)$$, :'fp')), '0',
  'Pribadi F oleh F = 0 baris');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), format($q$select api.shared_activity(%L)$q$, :'np')),
  'DK404', 'space_not_found', 'Pribadi N oleh F = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.x(), format($q$select api.shared_activity(%L)$q$, :'sh')),
  'DK404', 'space_not_found', 'Bersama oleh Luar = DK404');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.x(), format($q$select api.shared_activity(%L, 0)$q$, :'sh')),
  'DK404', 'space_not_found', 'assert_member lebih dulu: Luar dengan limit salah tetap DK404');
select throws_ok(format($$select tests.web_exec(null, %L)$$, format($q$select api.shared_activity(%L)$q$, :'sh')),
  'DK401', 'unauthenticated', 'tanpa konteks = DK401');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), format($q$select api.shared_activity(%L)$q$, gen_random_uuid())),
  'DK404', 'space_not_found', 'ruang tidak dikenal = DK404');
select is(tests.web_val(tests.n(), format($$select count(*) from api.shared_activity(%L, 100) where kind = 'opening_balance'$$, :'sh')),
  '0', 'opening_balance tidak pernah muncul');

-- ===== Validasi argumen =====
select is(pg_temp.err(tests.n(), format($q$select api.shared_activity(%L, %s)$q$, :'sh', l)),
  'DK400:invalid_argument:limit', 'limit ' || l || ' = DK400 limit')
from unnest(array['0', '101', 'null', '-1']) l;
select is(tests.web_val(tests.n(), format($$select count(*) from api.shared_activity(%L, 1)$$, :'sh')), '1',
  'limit 1 diterima');
select is(pg_temp.err(tests.n(), format($q$select api.shared_activity(%L, 10, %s)$q$, :'sh', a)),
  'DK400:invalid_argument:cursor', 'kursor sebagian = DK400 cursor: ' || a)
from unnest(array[
  $a$now(), null, null$a$,
  $a$null, gen_random_uuid(), 1$a$,
  $a$now(), gen_random_uuid(), null$a$,
  $a$null, null, 1$a$]) a;

-- ===== Kursor: halaman tanpa duplikat dan tanpa lompatan saat changed_at seri =====
-- Tambah entri sampai feed >= 25 baris (semua changed_at sama di transaksi ini).
select pg_temp.call(tests.f(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', %s)$$, :'sh', :'kas', 100 + g))
  from generate_series(1, 12) g;
-- Salinan keluaran penuh (urutan fungsi = ordinality), dibaca sebagai web lalu disimpan di sesi tes.
create temp table full_feed (rn bigint, entry_id uuid, version int, at timestamptz);
insert into full_feed
  select x.rn, x.entry_id, x.version, x.at from jsonb_populate_recordset(null::full_feed,
    tests.web_val(tests.n(), format($$select jsonb_agg(to_jsonb(a) || jsonb_build_object('rn', a.n) order by a.n)
      from api.shared_activity(%L, 100) with ordinality a (entry_id, version, op, kind, direction, actor_id, at, occurred_on,
        amount, before_amount, category_id, before_category_id, description, shared_note, moved, n)$$, :'sh'))::jsonb) x;
select ok((select count(*) from full_feed) between 25 and 99, 'feed sintetis 25 sampai 99 baris (muat di satu panggilan 100)');
select is((select count(distinct at) from full_feed)::int, 1, 'semua baris seri changed_at (kasus seri kursor)');
create function pg_temp.page(p_after int, p_limit int) returns text
language sql as $$
  select tests.web_val(tests.n(), format(
    $q$select string_agg(entry_id || '@' || version, ',') from api.shared_activity(%L, %s, %L, %L, %L)$q$,
    tests.space_id(tests.n(), 'shared'), p_limit, f.at, f.entry_id, f.version))
  from full_feed f where f.rn = p_after
$$;
select is(tests.web_val(tests.n(), format($$select string_agg(entry_id || '@' || version, ',') from api.shared_activity(%L, 10)$$, :'sh')),
  (select string_agg(entry_id || '@' || version, ',' order by rn) from full_feed where rn <= 10),
  'halaman 1 = baris 1-10');
select is(pg_temp.page(10, 10), (select string_agg(entry_id || '@' || version, ',' order by rn) from full_feed where rn between 11 and 20),
  'halaman 2 dari triple baris ke-10 = baris 11-20');
select is(pg_temp.page(20, 100), (select string_agg(entry_id || '@' || version, ',' order by rn) from full_feed where rn > 20),
  'halaman 3 = sisa, tanpa duplikat dan lompatan');
select is(pg_temp.page((select max(rn)::int from full_feed), 10), null, 'kursor di baris terakhir = halaman kosong');
select ok((select bool_and(a.entry_id > b.entry_id or (a.entry_id = b.entry_id and a.version > b.version))
           from full_feed a join full_feed b on b.rn = a.rn + 1),
  'urutan seri: entry_id lalu version turun');

-- Urutan menurut waktu: dua riwayat sintetis (owner) satu jam sesudah dan sebelum now().
select tests.owner_exec(null, format($$insert into app.entry_history (entry_id, space_id, version, op, snapshot, changed_by, changed_at)
  select entry_id, space_id, 90, 'update', snapshot, %L, now() + interval '1 hour' from app.entry_history where entry_id = %L and version = 1$$,
  tests.f(), :'e_mundur'));
select tests.owner_exec(null, format($$insert into app.entry_history (entry_id, space_id, version, op, snapshot, changed_by, changed_at)
  select entry_id, space_id, 91, 'update', snapshot, %L, now() - interval '1 hour' from app.entry_history where entry_id = %L and version = 1$$,
  tests.n(), :'e_trf'));
select is(tests.web_val(tests.n(), format($$select entry_id || '@' || version || ':' || coalesce(before_amount::text, '-')
  from api.shared_activity(%L, 1)$$, :'sh')),
  :'e_mundur' || '@90:-', 'changed_at terbaru di atas walau entry_id/version lebih kecil; versi sebelumnya tidak ada = NULL');
select is(tests.web_val(tests.n(), format($$select string_agg(entry_id || '@' || version, ',') from api.shared_activity(%L, 100, now() + interval '1 hour', %L, 90)$$,
  :'sh', :'e_mundur')),
  (select string_agg(entry_id || '@' || version, ',' order by rn) from full_feed) || ',' || :'e_trf' || '@91',
  'kursor melewati batas waktu: semua baris now() lalu baris sejam sebelumnya');

select * from finish();
rollback;
