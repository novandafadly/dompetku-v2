-- Anggaran subkategori (S10, 0125; plan S10 Task 2, K1 sampai K3; BSD §15 butir 1, §13 #26, #27).
-- Pohon anggaran: rincian (sub) hanya bila induk beranggaran di label yang sama, Σ rincian <= induk
-- (dua arah), rincian tidak wajib, kunci baris tak berubah, hapus induk menghapus rinciannya;
-- XOR kewajiban tetap di induk; budget_progress (safe_to_spend, Laporan) hanya induk; copy_budgets
-- menyalin induk dulu lalu rincian. Angka dihitung tangan.
-- Jam dipatok 2026-11-26 10:00 WIB; payday_rule = 25 (label Nov = 23 Okt..24 Nov).
-- ID: B2, B13, T13, T17
begin;
select plan(66);
select tests.fixture();
select tests.clock_at('2026-11-26 10:00+07');
select tests.owner_exec(null, 'update app.households set payday_rule = 25');
select tests.raw_exec(format($$insert into auth."user" (id, name, email, "emailVerified")
  values (%L, 'Luar', 'luar@example.test', true)$$, tests.x()));

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset

create function pg_temp.cat(p_space uuid, p_name text) returns uuid
language sql as $$
  select tests.owner_val(null, format(
    $q$select id from app.categories where space_id = %L and name = %L and archived_at is null$q$,
    p_space, p_name))::uuid
$$;
create function pg_temp.call(p_uid uuid, p_sql text) returns jsonb
language sql as $$ select tests.web_val(p_uid, p_sql)::jsonb $$;
-- Galat pernyataan sebagai 'SQLSTATE:pesan:detail', atau 'ok'.
create function pg_temp.raw_err(p_stmt text) returns text
language plpgsql as $$
declare
  v_state  text;
  v_msg    text;
  v_detail text;
begin
  execute p_stmt;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_detail = pg_exception_detail;
  return v_state || ':' || v_msg || ':' || coalesce(v_detail, '');
end $$;
create function pg_temp.err(p_uid uuid, p_sql text) returns text
language sql as $$ select pg_temp.raw_err(format('select tests.web_val(%L, %L)', p_uid, p_sql)) $$;
create function pg_temp.set_sql(p_space uuid, p_cat uuid, p_month text, p_amount bigint, p_wajib boolean)
returns text
language sql as $$
  select format($q$select api.set_budget(%L, %L, %L::date, %s, %L::boolean)$q$,
    p_space, p_cat, p_month, coalesce(p_amount::text, 'null'), p_wajib)
$$;
create function pg_temp.set(p_uid uuid, p_space uuid, p_cat uuid, p_month text, p_amount bigint,
  p_wajib boolean default false) returns text
language sql as $$ select pg_temp.err(p_uid, pg_temp.set_sql(p_space, p_cat, p_month, p_amount, p_wajib)) $$;
create function pg_temp.ent(p_uid uuid, p_acc uuid, p_amount bigint, p_cat uuid, p_on date,
  p_reimb boolean default false) returns uuid
language sql as $$
  select tests.web_val(p_uid, format(
    $q$select api.create_entry(gen_random_uuid(), (select space_id from app.accounts where id = %L),
         %L, 'expense', %s, %L, %L::date, null, %L) ->> 'entry_id'$q$,
    p_acc, p_acc, p_amount, p_cat, p_on, p_reimb))::uuid
$$;
create function pg_temp.bill(p_uid uuid, p_space uuid, p_name text, p_cat uuid, p_day int, p_starts date)
returns uuid
language sql as $$
  select (pg_temp.call(p_uid, format(
    $q$select api.create_bill(gen_random_uuid(), %L, %L, 100000, %L, %s::smallint, %L::date)$q$,
    p_space, p_name, p_cat, p_day, p_starts)) ->> 'bill_id')::uuid
$$;
-- Realisasi: nama:amount:wajib:spent:pct:remaining, urut nama.
create function pg_temp.prog(p_uid uuid, p_space uuid, p_month text) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select coalesce(string_agg(c.name || ':' || p.amount || ':' || p.wajib
      || ':' || p.spent || ':' || p.pct || ':' || p.remaining, ',' order by c.name), '-')
    from api.budget_progress(%L, %L::date) p join app.categories c on c.id = p.category_id$q$, p_space, p_month))
$$;
-- Ringkasan Rencana: nama:budget:wajib:spent:pct:remaining:archived ('-' = NULL), urut keluaran.
create function pg_temp.over(p_uid uuid, p_space uuid, p_month text) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select string_agg(o.name || ':' || coalesce(o.budget::text, '-') || ':'
      || o.wajib || ':' || o.spent || ':' || coalesce(o.pct::text, '-') || ':' || coalesce(o.remaining::text, '-')
      || ':' || o.archived, ',' order by o.n)
    from api.budget_overview(%L, %L::date) with ordinality
      as o (category_id, name, icon, budget, wajib, spent, pct, remaining, archived, n)$q$, p_space, p_month))
$$;
-- Anggaran tersimpan: nama:amount:wajib, urut nama (dibaca owner).
create function pg_temp.rows(p_space uuid, p_month text) returns text
language sql as $$
  select tests.owner_val(null, format($q$select coalesce(string_agg(c.name || ':' || b.amount || ':' || b.wajib,
      ',' order by c.name), '-')
    from app.budgets b join app.categories c on c.id = b.category_id
    where b.space_id = %L and b.month = %L::date$q$, p_space, p_month))
$$;
create function pg_temp.copy(p_uid uuid, p_space uuid, p_from text, p_to text) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select copied || ':' || skipped_existing || ':' || skipped_conflict
      || ':' || skipped_archived from api.copy_budgets(%L, %L::date, %L::date)$q$, p_space, p_from, p_to))
$$;


select pg_temp.cat(:'sh', 'Belanja Dapur') as dapur, pg_temp.cat(:'sh', 'Sayur & Buah') as sayur,
       pg_temp.cat(:'sh', 'Makan di Luar') as makan, pg_temp.cat(:'fp', 'Transportasi') as ftrans \gset
create function pg_temp.mk(p_name text, p_parent uuid) returns uuid
language sql as $$
  select (pg_temp.call(tests.n(), format(
    $q$select api.create_category(gen_random_uuid(), %L, 'expense', %L, 'Receipt', %L)$q$,
    (select tests.space_id(tests.n(), 'shared')), p_name, p_parent)) ->> 'category_id')::uuid
$$;
select pg_temp.mk('Daging', :'dapur') as daging, pg_temp.mk('Warteg', :'makan') as warteg,
       pg_temp.mk('Kopi', :'makan') as kopi, pg_temp.mk('Sub Arsip', :'makan') as subarsip \gset
select pg_temp.call(tests.n(), format($$select api.archive_category(%L)$$, :'subarsip'));
select tests.account(tests.n(), :'sh', 'Kas Rumah', 'operasional', 5000000, '2026-01-01') as kas \gset

-- ===== Bentuk skema dan hak =====
select hasnt_column('app', 'budgets', 'category_is_root', 'kolom category_is_root dibuang (anggaran boleh sub)');
select is(tests.owner_val(null, $$select string_agg(g.tgname || ':' || g.tgtype || ':' || g.tgfoid::regproc::text, ',' order by g.tgname)
  from pg_trigger g where g.tgrelid = 'app.budgets'::regclass and not g.tgisinternal$$),
  'budgets_obligation_xor:23:private.tg_obligation_xor,budgets_tree:31:private.tg_budget_tree,'
  'budgets_tree_cascade:9:private.tg_budget_cascade',
  'trigger pohon: BEFORE INSERT/UPDATE/DELETE per baris (31) dan AFTER DELETE per baris (9) di samping XOR (23)');
select is(tests.owner_val(null, $$select string_agg(p.proname || ':' || p.prosecdef || ':' || p.proowner::regrole
    || ':' || array_to_string(p.proconfig, ','), ',' order by p.proname)
  from pg_proc p where p.pronamespace = 'private'::regnamespace
    and p.proname in ('tg_budget_tree', 'tg_budget_cascade')$$),
  'tg_budget_cascade:true:dompetku_owner:search_path="",tg_budget_tree:true:dompetku_owner:search_path=""',
  'fungsi trigger pohon DEFINER milik owner, search_path kosong');

-- ===== Rincian butuh anggaran induk (K1) =====
select is(pg_temp.set(tests.n(), :'sh', :'sayur', '2026-11-01', 1000), 'DK422:parent_budget_required:',
  'rincian tanpa anggaran induk di label itu = parent_budget_required');
select is(pg_temp.rows(:'sh', '2026-11-01'), '-', 'penolakan tanpa efek');
select is(pg_temp.set(tests.n(), :'sh', :'dapur', '2026-11-01', 900000), 'ok', 'anggaran induk Belanja Dapur Nov 900.000');
select is(pg_temp.set(tests.n(), :'sh', :'sayur', '2026-12-01', 1000), 'DK422:parent_budget_required:',
  'anggaran induk label lain tidak dihitung (Des tanpa induk)');
select is(pg_temp.set(tests.n(), :'sh', :'sayur', '2026-11-01', 400000), 'ok', 'rincian Sayur & Buah 400.000');
select is(pg_temp.set(tests.n(), :'sh', :'daging', '2026-11-01', 500000), 'ok',
  'rincian Daging 500.000: jumlah rincian = induk (batas sah)');
select is(pg_temp.rows(:'sh', '2026-11-01'), 'Belanja Dapur:900000:false,Daging:500000:false,Sayur & Buah:400000:false',
  'tiga baris anggaran tersimpan');

-- ===== Jumlah rincian <= induk, dari dua arah (K1) =====
select is(pg_temp.set(tests.n(), :'sh', :'daging', '2026-11-01', 500001), 'DK422:sub_exceeds_parent:',
  'ubah rincian melewati induk (400.000 + 500.001 > 900.000) = sub_exceeds_parent');
select is(pg_temp.set(tests.n(), :'sh', :'sayur', '2026-11-01', 400001), 'DK422:sub_exceeds_parent:',
  'naikkan rincian lain 1 rupiah melewati induk = sub_exceeds_parent');
select is(pg_temp.set(tests.n(), :'sh', :'dapur', '2026-11-01', 899999), 'DK422:sub_exceeds_parent:',
  'turunkan induk di bawah jumlah rincian (899.999 < 900.000) = sub_exceeds_parent');
select is(pg_temp.rows(:'sh', '2026-11-01'), 'Belanja Dapur:900000:false,Daging:500000:false,Sayur & Buah:400000:false',
  'penolakan tidak mengubah baris');
select is(pg_temp.set(tests.n(), :'sh', :'dapur', '2026-11-01', 900000), 'ok', 'induk tepat = jumlah rincian boleh');
select is(pg_temp.set(tests.f(), :'sh', :'dapur', '2026-11-01', 1000000), 'ok', 'F menaikkan induk ke 1.000.000');
select is(pg_temp.set(tests.f(), :'sh', :'sayur', '2026-11-01', 450000), 'ok', 'F mengubah rincian (450.000 + 500.000 <= 1.000.000)');
select is(pg_temp.set(tests.n(), :'sh', :'sayur', '2026-11-01', 400000), 'ok', 'N mengembalikan rincian ke 400.000');

-- ===== Rincian tidak wajib (K3); XOR tetap di induk =====
select is(pg_temp.set(tests.n(), :'sh', :'sayur', '2026-11-01', 400000, true), 'DK422:sub_not_wajib:',
  'rincian wajib = sub_not_wajib');
select is(pg_temp.set(tests.n(), :'sh', :'sayur', '2026-11-01', 400000, null), 'ok', 'wajib NULL pada rincian = false');
select is(pg_temp.set(tests.n(), :'sh', :'dapur', '2026-11-01', 1000000, true), 'ok',
  'induk beranggaran rincian boleh wajib (tanpa tagihan)');
select is(pg_temp.err(tests.n(), format($$select api.create_bill(gen_random_uuid(), %L, 'Tagihan Sayur', 100000, %L,
    20::smallint, '2026-11-01'::date)$$, :'sh', :'sayur')), 'DK422:obligation_double:',
  'tagihan pada RINCIAN bentrok dengan anggaran wajib induknya (XOR tetap di induk)');
select is(pg_temp.set(tests.n(), :'sh', :'dapur', '2026-11-01', 1000000, false), 'ok', 'induk kembali tidak wajib');

-- ===== Validasi kategori rincian, otorisasi =====
select is(pg_temp.set(tests.n(), :'sh', :'subarsip', '2026-11-01', 1000), 'DK422:category_archived:',
  'rincian terarsip = category_archived');
select is(pg_temp.set(tests.n(), :'sh', :'warteg', '2026-11-01', 1000), 'DK422:parent_budget_required:',
  'rincian Warteg: induk Makan di Luar belum beranggaran');
select is(pg_temp.set(tests.x(), :'sh', :'sayur', '2026-11-01', 1000), 'DK404:space_not_found:',
  'bukan anggota: DK404 (bukan galat aturan pohon, tanpa oracle)');
select is(pg_temp.set(tests.n(), :'fp', :'ftrans', '2026-11-01', 1000), 'DK404:space_not_found:',
  'Pribadi F oleh N = DK404');
select is(pg_temp.raw_err(format($$select tests.owner_exec(null, $q$update app.budgets set month = '2026-12-01'
  where space_id = %L and category_id = %L and month = '2026-11-01'$q$)$$, :'sh', :'sayur')),
  'DK422:budget_key_immutable:', 'kunci baris (ruang, kategori, bulan) tidak bisa diubah');
select is(pg_temp.raw_err(format($$select tests.api_exec(%L, %L)$$, tests.n(), format(
    $q$insert into app.budgets (space_id, category_id, month, amount, updated_by)
       values (%L, %L, '2026-12-01', 1, app.current_user_id())$q$, :'sh', :'sayur'))),
  'DK422:parent_budget_required:', 'INSERT langsung lewat api (tanpa set_budget) tetap dijaga trigger');

-- ===== Pindah induk kategori beranggaran tetap ditolak =====
select is(pg_temp.err(tests.n(), format($$select api.update_category(%L, 'Sayur & Buah', 'Carrot', %L)$$, :'sayur', :'makan')),
  'DK422:category_in_obligation:', 'pindah induk rincian beranggaran = category_in_obligation');
select is(pg_temp.err(tests.n(), format($$select api.update_category(%L, 'Belanja Dapur', 'ShoppingCart', %L)$$, :'dapur', :'makan')),
  'DK422:category_in_obligation:', 'pindah induk yang beranggaran = category_in_obligation');

-- ===== Realisasi dan aman dipakai tidak berubah oleh rincian (tidak dobel) =====
select pg_temp.ent(tests.f(), :'kas', 25000, :'sayur', '2026-11-02') is not null as x \gset
select pg_temp.ent(tests.n(), :'kas', 60000, :'dapur', '2026-11-24') is not null as x \gset
select pg_temp.ent(tests.n(), :'kas', 15000, :'daging', '2026-11-10') is not null as x \gset
select is(pg_temp.prog(tests.n(), :'sh', '2026-11-01'), 'Belanja Dapur:1000000:false:100000:10:900000',
  'budget_progress hanya induk; realisasi induk = induk + Sayur 25.000 + Daging 15.000 = 100.000');
select pg_temp.err(tests.n(), format($$select api.delete_budget(%L, %L, '2026-11-01')$$, :'sh', :'sayur')) as x \gset
select pg_temp.err(tests.n(), format($$select api.delete_budget(%L, %L, '2026-11-01')$$, :'sh', :'daging')) as x \gset
select is(pg_temp.rows(:'sh', '2026-11-01'), 'Belanja Dapur:1000000:false', 'hapus rincian: induk tetap');

-- ===== Hapus induk menghapus rincian label itu (K2) =====
select is(pg_temp.set(tests.n(), :'sh', :'sayur', '2026-11-01', 400000), 'ok', 'rincian Sayur kembali');
select is(pg_temp.set(tests.n(), :'sh', :'daging', '2026-11-01', 500000), 'ok', 'rincian Daging kembali');
select is(pg_temp.set(tests.n(), :'sh', :'dapur', '2026-12-01', 550000), 'ok', 'induk Des 550.000');
select is(pg_temp.set(tests.n(), :'sh', :'sayur', '2026-12-01', 100000), 'ok', 'rincian Sayur Des 100.000');
select is(pg_temp.err(tests.n(), format($$select api.delete_budget(%L, %L, '2026-11-01')$$, :'sh', :'dapur')), 'ok',
  'hapus induk Nov');
select is(pg_temp.rows(:'sh', '2026-11-01'), '-', 'rincian Nov ikut terhapus');
select is(pg_temp.rows(:'sh', '2026-12-01'), 'Belanja Dapur:550000:false,Sayur & Buah:100000:false',
  'anggaran label lain tidak tersentuh');
select is(pg_temp.err(tests.n(), format($$select api.delete_budget(%L, %L, '2026-11-01')$$, :'sh', :'dapur')), 'ok',
  'hapus induk lagi tanpa baris = no-op');
select is(pg_temp.set(tests.n(), :'sh', :'sayur', '2026-11-01', 1000), 'DK422:parent_budget_required:',
  'sesudah induk dihapus, rincian baru ditolak lagi');

-- ===== copy_budgets: induk dulu, lalu rincian =====
select pg_temp.set(tests.n(), :'sh', :'dapur', '2026-11-01', 1000000) as x \gset
select pg_temp.set(tests.n(), :'sh', :'sayur', '2026-11-01', 400000) as x \gset
select pg_temp.set(tests.n(), :'sh', :'daging', '2026-11-01', 500000) as x \gset
select pg_temp.set(tests.n(), :'sh', :'makan', '2026-11-01', 300000) as x \gset
select pg_temp.set(tests.n(), :'sh', :'warteg', '2026-11-01', 200000) as x \gset
select pg_temp.set(tests.n(), :'sh', :'kopi', '2026-11-01', 100000) as x \gset
select is(pg_temp.rows(:'sh', '2026-11-01'),
  'Belanja Dapur:1000000:false,Daging:500000:false,Kopi:100000:false,Makan di Luar:300000:false,'
  'Sayur & Buah:400000:false,Warteg:200000:false', 'sumber Nov: 2 induk + 4 rincian');
select is(pg_temp.copy(tests.n(), :'sh', '2026-11-01', '2027-01-01'), '6:0:0:0',
  'salin ke label kosong: semua 6 tersalin (urutan induk dulu, tidak tergantung urutan id)');
select is(pg_temp.rows(:'sh', '2027-01-01'), pg_temp.rows(:'sh', '2026-11-01'), 'tujuan sama dengan sumber');
select is(pg_temp.copy(tests.n(), :'sh', '2026-11-01', '2026-12-01'), '3:2:1:0',
  'tujuan Des (induk 550.000 + Sayur 100.000): induk dan Sayur sudah ada, Daging melewati induk = dilewati, Makan + Warteg + Kopi tersalin');
select is(pg_temp.rows(:'sh', '2026-12-01'),
  'Belanja Dapur:550000:false,Kopi:100000:false,Makan di Luar:300000:false,Sayur & Buah:100000:false,Warteg:200000:false',
  'Daging tidak tersalin; tidak ada yang ditimpa');
select is(pg_temp.copy(tests.n(), :'sh', '2026-11-01', '2026-12-01'), '0:5:1:0', 'dijalankan ulang: copied 0 (idempoten)');

-- ===== DELETE massal oleh owner atas induk + rincian (tanpa galat, tanpa yatim) =====
select pg_temp.set(tests.n(), :'sh', :'dapur', '2027-02-01', 100000) as x \gset
select pg_temp.set(tests.n(), :'sh', :'sayur', '2027-02-01', 50000) as x \gset
select pg_temp.set(tests.n(), :'sh', :'daging', '2027-02-01', 50000) as x \gset
select tests.owner_exec(null, format($$delete from app.budgets where space_id = %L and month = '2027-02-01'$$, :'sh'));
select is(pg_temp.rows(:'sh', '2027-02-01'), '-', 'DELETE massal induk + rincian oleh owner: semua terhapus tanpa galat');

-- ===== copy_budgets: induk terarsip =====
select pg_temp.mk('Hobi Arsip', null) as hobi \gset
select pg_temp.mk('Hobi Sub', :'hobi') as hobisub \gset
select pg_temp.set(tests.n(), :'sh', :'hobi', '2026-11-01', 100000) as x \gset
select pg_temp.set(tests.n(), :'sh', :'hobisub', '2026-11-01', 50000) as x \gset
select pg_temp.call(tests.n(), format($$select api.archive_category(%L)$$, :'hobi'));
select is(pg_temp.copy(tests.n(), :'sh', '2026-11-01', '2027-04-01'), '6:0:0:2',
  'induk terarsip dan rinciannya (arsip induk mengarsipkan anak) dilewati = skipped_archived 2; 6 lainnya tersalin');
select is(pg_temp.rows(:'sh', '2027-04-01'),
  'Belanja Dapur:1000000:false,Daging:500000:false,Kopi:100000:false,Makan di Luar:300000:false,'
  'Sayur & Buah:400000:false,Warteg:200000:false', 'hanya keluarga yang aktif tersalin; tidak ada rincian yatim');

-- ===== budget_overview dengan rincian (0126) =====
select pg_temp.mk('Roti', :'dapur') as roti \gset
-- nama:anggaran:realisasi:sub_allocated:max_amount ('-' = NULL); hanya baris beranggaran atau rincian.
create function pg_temp.ov(p_uid uuid, p_space uuid, p_month text) returns text
language sql as $$
  select tests.web_val(p_uid, format($q$select string_agg(o.name || ':' || coalesce(o.budget::text, '-') || ':' || o.spent
      || ':' || coalesce(o.sub_allocated::text, '-') || ':' || coalesce(o.max_amount::text, '-'), ',' order by o.n)
    from api.budget_overview(%L, %L::date) with ordinality
      as o (category_id, name, icon, budget, wajib, spent, pct, remaining, archived, parent_id, sub_allocated, max_amount, n)
    where o.budget is not null or o.parent_id is not null$q$, p_space, p_month))
$$;
select is(pg_temp.ov(tests.n(), :'sh', '2026-11-01'),
  'Belanja Dapur:1000000:100000:900000:-,Daging:500000:15000:-:600000,Roti:-:0:-:100000,Sayur & Buah:400000:25000:-:500000,'
  'Makan di Luar:300000:0:300000:-,Kopi:100000:0:-:100000,Warteg:200000:0:-:200000,'
  'Hobi Arsip:100000:0:50000:-,Hobi Sub:50000:0:-:100000',
  'overview: induk lalu rinciannya; realisasi induk = induk + rincian, rincian = kategori itu; sub_allocated dan max_amount dari SQL; rincian aktif tanpa anggaran (Roti) = kandidat; rincian terarsip tanpa anggaran tidak tampil');
select is(pg_temp.ov(tests.n(), :'sh', '2026-12-01'),
  'Belanja Dapur:550000:0:100000:-,Daging:-:0:-:450000,Roti:-:0:-:450000,Sayur & Buah:100000:0:-:550000,'
  'Makan di Luar:300000:0:300000:-,Kopi:100000:0:-:100000,Warteg:200000:0:-:200000',
  'overview Des: max_amount = induk 550.000 - rincian saudara (Daging, Roti: belum beranggaran) untuk Sayur; Daging/Roti 550.000 - Sayur 100.000');

-- ===== copy_budgets dengan penyesuaian persen (K4; induk ke atas, rincian ke bawah) =====
select is(pg_temp.copy(tests.n(), :'sh', '2026-11-01', '2027-05-01'), '6:0:0:2',
  'penyesuaian 0 (bawaan): tersalin persis, keluarga Hobi terarsip dilewati');
select pg_temp.err(tests.n(), format($$select api.delete_budget(%L, %L, '2027-05-01')$$, :'sh', :'dapur')) as x \gset
select pg_temp.err(tests.n(), format($$select api.delete_budget(%L, %L, '2027-05-01')$$, :'sh', :'makan')) as x \gset
select is(tests.web_val(tests.n(), format($q$select copied || ':' || skipped_existing || ':' || skipped_conflict
    || ':' || skipped_archived || ':' || skipped_parent from api.copy_budgets(%L, '2026-11-01', '2027-05-01', 10)$q$, :'sh')),
  '6:0:0:2:0', 'penyesuaian +10%: enam tersalin lagi (label tujuan dikosongkan dulu)');
select is(pg_temp.rows(:'sh', '2027-05-01'),
  'Belanja Dapur:1100000:false,Daging:550000:false,Kopi:110000:false,Makan di Luar:330000:false,'
  'Sayur & Buah:440000:false,Warteg:220000:false',
  '+10%: induk 1.100.000 (ke atas), rincian 550.000 + 440.000 = 990.000 <= induk; Makan 330.000 = Warteg 220.000 + Kopi 110.000');
select pg_temp.set(tests.n(), :'sh', :'dapur', '2027-06-01', 100100) as x \gset
select pg_temp.set(tests.n(), :'sh', :'sayur', '2027-06-01', 50050) as x \gset
select pg_temp.set(tests.n(), :'sh', :'daging', '2027-06-01', 50050) as x \gset
select is(tests.web_val(tests.n(), format($q$select copied || ':' || skipped_conflict from api.copy_budgets(%L, '2027-06-01', '2027-07-01', 33)$q$, :'sh')),
  '3:0', 'penyesuaian +33% atas nominal bukan kelipatan 1.000: semua tersalin');
select is(pg_temp.rows(:'sh', '2027-07-01'), 'Belanja Dapur:134000:false,Daging:66000:false,Sayur & Buah:66000:false',
  'induk 133.133 -> 134.000 (ke atas); rincian 66.566,5 -> 66.000 (ke bawah); 132.000 <= 134.000');
select is(pg_temp.err(tests.n(), format($$select api.copy_budgets(%L, '2026-11-01', '2027-08-01', 101)$$, :'sh')),
  'DK400:invalid_argument:adjust_pct', 'persen > 100 ditolak');
select is(pg_temp.err(tests.n(), format($$select api.copy_budgets(%L, '2026-11-01', '2027-08-01', -91)$$, :'sh')),
  'DK400:invalid_argument:adjust_pct', 'persen < -90 ditolak');
select is(pg_temp.err(tests.n(), format($$select api.copy_budgets(%L, '2026-11-01', '2027-08-01', null)$$, :'sh')),
  'DK400:invalid_argument:adjust_pct', 'persen NULL ditolak');
-- Induk tidak bisa disalin (wajib bentrok tagihan di tujuan): rinciannya dihitung skipped_parent.
select pg_temp.set(tests.n(), :'sh', :'dapur', '2027-08-01', 100000, true) as x \gset
select pg_temp.set(tests.n(), :'sh', :'sayur', '2027-08-01', 50000) as x \gset
select pg_temp.err(tests.n(), format($$select api.create_bill(gen_random_uuid(), %L, 'Tagihan Dapur', 100000, %L,
    20::smallint, '2027-09-01'::date)$$, :'sh', :'dapur')) as x \gset
select is(tests.web_val(tests.n(), format($q$select copied || ':' || skipped_existing || ':' || skipped_conflict
    || ':' || skipped_archived || ':' || skipped_parent from api.copy_budgets(%L, '2027-08-01', '2027-09-01')$q$, :'sh')),
  '0:0:1:0:1', 'induk wajib bentrok tagihan tujuan = skipped_conflict; rinciannya = skipped_parent (tanpa anggaran induk)');

-- Rincian yang jatuh di bawah Rp1.000 tidak dinaikkan paksa (bisa melewati induk): dilewati.
select pg_temp.mk('Uji Bulat', null) as bulat \gset
select pg_temp.mk('Bulat A', :'bulat') as bulata, pg_temp.mk('Bulat B', :'bulat') as bulatb \gset
select pg_temp.set(tests.n(), :'sh', :'bulat', '2027-10-01', 1000) as x \gset
select pg_temp.set(tests.n(), :'sh', :'bulata', '2027-10-01', 500) as x \gset
select pg_temp.set(tests.n(), :'sh', :'bulatb', '2027-10-01', 500) as x \gset
select is(tests.web_val(tests.n(), format($q$select copied || ':' || skipped_existing || ':' || skipped_conflict
    || ':' || skipped_archived || ':' || skipped_parent from api.copy_budgets(%L, '2027-10-01', '2027-11-01', -50)$q$, :'sh')),
  '1:0:2:0:0', '-50%: induk 500 -> 1.000 (ke atas); rincian 250 -> 0 (ke bawah) dilewati sebagai skipped_conflict, bukan dipaksa 1.000');
select is(pg_temp.rows(:'sh', '2027-11-01'), 'Uji Bulat:1000:false', 'hanya induk tersalin');
select pg_temp.set(tests.n(), :'sh', :'bulat', '2027-12-01', 100000) as x \gset
select is(tests.web_val(tests.n(), format($q$select copied from api.copy_budgets(%L, '2027-12-01', '2028-01-01', -90)$q$, :'sh')), '1',
  'batas -90% diterima');
select is(pg_temp.rows(:'sh', '2028-01-01'), 'Uji Bulat:10000:false', '-90% atas 100.000 = 10.000');

select * from finish();
rollback;
