-- Catat lewat WhatsApp (spec 2026-11-09 §4.3, §4.4, §5.3, §5.5, §6; migrasi 0123).
-- Tautan nomor (kode sekali pakai 10 menit, hanya hash disimpan), pemetaan pengirim tanpa konteks
-- user (DEFINER sempit, EXECUTE hanya web), dedupe pesan, batal dalam 10 menit, dompet bawaan,
-- RLS antar user, event audit sistem wa_linked/wa_unlinked. Jam dipatok 2026-03-20 10:00 WIB.
begin;
select plan(119);
select tests.fixture();
select tests.clock_at('2026-03-20 10:00+07');

select tests.space_id(tests.n(), 'personal') as np, tests.space_id(tests.f(), 'personal') as fp,
       tests.space_id(tests.n(), 'shared') as sh \gset
\set p1 '+6281234567801'
\set p2 '+6281234567802'
\set p3 '+6281234567803'

-- ===== Bentuk skema dan hak =====
select set_eq($$
  select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app' and c.relname like 'wa\_%' and c.relkind = 'r'
    and c.relrowsecurity and c.relforcerowsecurity $$,
  array['wa_links', 'wa_link_codes', 'wa_messages'], 'tiga tabel WA ber-RLS ENABLE + FORCE');
select columns_are('app', 'wa_messages',
  array['message_id', 'user_id', 'entry_id', 'entry_version', 'status', 'created_at'],
  'wa_messages tanpa kolom teks mentah pesan');
select columns_are('app', 'wa_link_codes', array['user_id', 'code_hash', 'expires_at'],
  'wa_link_codes hanya hash kode, tanpa kolom percobaan');
select set_eq($$
  select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname like 'wa\_%' and p.prosecdef
    and 'search_path=""' = any (p.proconfig) and p.proowner = 'dompetku_api'::regrole $$,
  array['wa_create_link_code', 'wa_confirm_link', 'wa_resolve_sender', 'wa_unlink'],
  'fungsi WA DEFINER = create_link_code, confirm_link, resolve_sender, unlink (milik dompetku_api)');
-- Pemilik (dompetku_api, dan owner lewat keanggotaan) punya hak otomatis; selain itu hanya web.
select set_eq(format($$
  select r.rolname::text from pg_roles r cross join pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname = %L
    and r.rolname like 'dompetku\_%%' and r.rolname not in ('dompetku_owner', 'dompetku_api')
    and has_function_privilege(r.oid, p.oid, 'EXECUTE') $$, f),
  array['dompetku_web'], 'EXECUTE api.' || f || ' hanya dompetku_web')
from unnest(array['wa_confirm_link', 'wa_resolve_sender']) f;
select is_empty($$
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
       aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname in ('api', 'private') and p.proname like 'wa\_%' and a.grantee = 0 $$,
  'PUBLIC tanpa EXECUTE fungsi WA');
select set_eq($$
  select r.rolname::text from pg_roles r cross join pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'wa_audit'
    and r.rolname like 'dompetku\_%' and r.rolname <> 'dompetku_owner'
    and has_function_privilege(r.oid, p.oid, 'EXECUTE') $$,
  array['dompetku_api'], 'private.wa_audit hanya untuk dompetku_api');

-- ===== Kode hubung =====
select throws_ok($$select tests.web_val(null, $q$select api.wa_create_link_code()$q$)$$,
  'DK401', 'unauthenticated', 'kode hubung butuh user');
select tests.web_val(tests.n(), $$select api.wa_create_link_code()::text$$) as c_n1 \gset
select :'c_n1'::jsonb ->> 'code' as code_n1 \gset
select matches(:'code_n1'::text, '^[2-9A-HJ-NP-Z]{6}$', 'kode 6 karakter tanpa 0/O/1/I');
select is((:'c_n1'::jsonb ->> 'expires_at')::timestamptz, '2026-03-20 10:10+07'::timestamptz,
  'kode berlaku 10 menit');
select is(tests.owner_val(null, format($$select count(*) || '/' || count(*) filter (where code_hash = %L)
    || '/' || min(length(code_hash)) from app.wa_link_codes where user_id = %L$$, :'code_n1', tests.n())),
  '1/0/64', 'satu kode per user, hanya hash SHA-256 hex yang disimpan');
-- Kode baru menimpa kode lama.
select tests.web_val(tests.n(), $$select api.wa_create_link_code() ->> 'code'$$) as code_n2 \gset
select is(tests.owner_val(null, format($$select count(*) from app.wa_link_codes where user_id = %L$$, tests.n())),
  '1', 'kode baru menimpa kode lama (tetap satu baris)');
select is(tests.web_val(null, format($$select coalesce(api.wa_confirm_link(%L, %L)::text, 'null')$$, :'code_n1', :'p1')),
  'null', 'kode lama tidak berlaku lagi');

-- ===== Hubungkan: gagal tanpa membedakan sebab, tanpa efek samping =====
select tests.owner_val(null, $$select count(*) from audit.events$$) as audit0 \gset
select is(tests.web_val(null, format($$select coalesce(api.wa_confirm_link(%L, %L)::text, 'null')$$, v, :'p1')),
  'null', 'kode salah -> null: ' || coalesce(nullif(v, ''), 'kosong/NULL'))
from unnest(array['ZZZZZZ', '', 'AB', null]) v
where v is distinct from :'code_n2';
select is(tests.web_val(null, format($$select coalesce(api.wa_confirm_link(%L, %L)::text, 'null')$$, :'code_n2', p)),
  'null', 'nomor bukan E.164 -> null: ' || coalesce(p, 'NULL'))
from unnest(array['081234567801', '+0812345678', '+62812', '+62 81234567801', null]) p;
select is(tests.owner_val(null, $$select count(*) || '/' || (select count(*) from app.wa_link_codes) from app.wa_links$$),
  '0/1', 'gagal: tidak ada nomor tersimpan, kode tetap ada');
select is(tests.owner_val(null, $$select count(*) from audit.events$$), :'audit0', 'gagal: tanpa event audit');

-- ===== Hubungkan: sukses =====
select is(tests.web_val(null, format($$select api.wa_confirm_link(%L, %L)::text$$, lower(:'code_n2'), :'p1')),
  tests.n()::text, 'kode benar (tanpa beda huruf besar) -> user pemilik kode');
select is(tests.web_val(null, $$select coalesce(nullif(current_setting('app.wa_phone', true), ''), 'kosong')
    || '/' || coalesce(nullif(current_setting('app.wa_code_hash', true), ''), 'kosong')
    || '/' || coalesce(nullif(current_setting('app.wa_user_id', true), ''), 'kosong')$$),
  'kosong/kosong/kosong', 'GUC pencarian dibersihkan sesudah confirm_link');
select is(tests.owner_val(null, format($$select phone_e164 || ' ' || (verified_at = app.now())
    || ' ' || (select count(*) from app.wa_link_codes where user_id = %1$L) from app.wa_links where user_id = %1$L$$,
    tests.n())),
  :'p1' || ' true 0', 'nomor tersimpan terverifikasi, kode dihapus');
select is(tests.owner_val(null, format($$select count(*) || ' ' || min(meta::text)
    from audit.events where event = 'wa_linked' and user_id = %L$$, tests.n())),
  '1 {"via": "whatsapp"}', 'event audit wa_linked tanpa nomor');
select is(tests.web_val(null, format($$select coalesce(api.wa_confirm_link(%L, %L)::text, 'null')$$, :'code_n2', :'p1')),
  'null', 'kode dipakai ulang -> null');

-- ===== Resolve pengirim =====
select is(tests.web_val(null, format($$select api.wa_resolve_sender(%L)::text$$, :'p1')), tests.n()::text,
  'resolve nomor terhubung -> user');
select tests.owner_val(null, $$select count(*) from audit.events$$) as audit1 \gset
select is(tests.web_val(null, format($$select coalesce(api.wa_resolve_sender(%L)::text, 'null')$$, p)), 'null',
  'resolve nomor tak terhubung/tidak sah -> null: ' || coalesce(p, 'NULL'))
from unnest(array[:'p2', '6281234567801', '', null]) p;
select is(tests.owner_val(null, $$select (select count(*) from app.wa_links) || '/' || count(*) from audit.events$$),
  '1/' || :'audit1', 'resolve tanpa efek samping');
select is(tests.web_val(null, $$select coalesce(nullif(current_setting('app.wa_phone', true), ''), 'kosong')$$),
  'kosong', 'GUC nomor dibersihkan sesudah resolve_sender');

-- ===== Kedaluwarsa =====
select tests.web_val(tests.f(), $$select api.wa_create_link_code() ->> 'code'$$) as code_f1 \gset
select tests.clock_at('2026-03-20 10:10:01+07');
select is(tests.web_val(null, format($$select coalesce(api.wa_confirm_link(%L, %L)::text, 'null')$$, :'code_f1', :'p2')),
  'null', 'kode kedaluwarsa (> 10 menit) -> null');
select tests.clock_at('2026-03-20 10:00+07');

-- ===== Satu nomor satu user =====
select tests.web_val(tests.f(), $$select api.wa_create_link_code() ->> 'code'$$) as code_f2 \gset
select is(tests.web_val(null, format($$select coalesce(api.wa_confirm_link(%L, %L)::text, 'null')$$, :'code_f2', :'p1')),
  'null', 'nomor milik user lain tidak bisa diambil -> null');
select is(tests.web_val(null, format($$select api.wa_resolve_sender(%L)::text$$, :'p1')), tests.n()::text,
  'nomor tetap milik user pertama');
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format(
    'insert into app.wa_links (user_id, phone_e164, verified_at) values (%L, %L, now())', tests.f(), :'p1')),
  '23505', null, 'indeks unik phone_e164');
select throws_ok(format($$select tests.owner_exec(null, %L)$$, format(
    'insert into app.wa_links (user_id, phone_e164, verified_at) values (%L, %L, now())', tests.f(), '0812345678')),
  '23514', null, 'CHECK pola E.164');
select is(tests.web_val(null, format($$select api.wa_confirm_link(%L, %L)::text$$, :'code_f2', :'p2')), tests.f()::text,
  'kode yang sama tetap bisa dipakai untuk nomor sendiri');

-- ===== Hubungkan ulang mengganti nomor lama =====
select tests.web_val(tests.n(), $$select api.wa_create_link_code() ->> 'code'$$) as code_n3 \gset
select is(tests.web_val(null, format($$select api.wa_confirm_link(%L, %L)::text$$, :'code_n3', :'p3')), tests.n()::text,
  'hubungkan ulang ke nomor baru');
select is(tests.web_val(null, format($$select coalesce(api.wa_resolve_sender(%L)::text, 'null') || ' '
    || api.wa_resolve_sender(%L)$$, :'p1', :'p3')), 'null ' || tests.n(), 'nomor lama lepas, nomor baru aktif');
select is(tests.owner_val(null, format($$select count(*) from app.wa_links where user_id = %L$$, tests.n())), '1',
  'satu user satu nomor aktif');

-- ===== RLS antar user =====
select is(tests.web_val(tests.f(), $$select count(*) || ' ' || min(phone_e164) from app.wa_links$$), '1 ' || :'p2',
  'F hanya melihat nomornya sendiri');
select is(tests.web_val(null, $$select count(*) from app.wa_links$$), '0', 'tanpa konteks user: tidak ada baris');
-- GUC pencarian hanya dipakai policy dompetku_api; web yang mengisinya sendiri tetap tidak melihat apa pun.
select tests.web_exec(tests.f(), format($$select set_config('app.wa_phone', %L, true), set_config('app.wa_user_id', %L, true)$$,
  :'p3', tests.n()));
select is(tests.web_val(tests.f(), $$select current_setting('app.wa_phone') || ' '
    || (select count(*) from app.wa_links where user_id <> app.current_user_id())$$),
  :'p3' || ' 0', 'web mengisi GUC pencarian sendiri: baris user lain tetap tersembunyi');
select tests.web_exec(tests.f(), $$select set_config('app.wa_phone', '', true) || set_config('app.wa_user_id', '', true)$$);
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), q), '42501', null, 'web tanpa DML/akses: ' || t)
from (values
  ('baca kode', $q$select count(*) from app.wa_link_codes$q$),
  ('insert nomor', $q$insert into app.wa_links (user_id, phone_e164, verified_at) values (app.current_user_id(), '+6281299999999', now())$q$),
  ('update nomor', $q$update app.wa_links set phone_e164 = '+6281299999999'$q$),
  ('hapus nomor', $q$delete from app.wa_links$q$),
  ('hapus pesan', $q$delete from app.wa_messages$q$)
) v (t, q);

-- ===== Dedupe pesan =====
select throws_ok($$select tests.web_val(null, $q$select api.wa_claim_message('m0')$q$)$$,
  'DK401', 'unauthenticated', 'claim butuh user');
select is(tests.web_val(tests.n(), $$select api.wa_claim_message('m1')::text$$), 'true', 'claim pertama -> true');
select is(tests.web_val(tests.n(), $$select api.wa_claim_message('m1')::text$$), 'false', 'claim kedua id sama -> false');
select is(tests.web_val(tests.f(), $$select api.wa_claim_message('m1')::text$$), 'false',
  'id milik user lain -> false, tanpa baris baru');
select is(tests.owner_val(null, $$select count(*) || ' ' || min(status) || ' ' || min(user_id::text) || ' '
    || (min(created_at) = app.now()) from app.wa_messages where message_id = 'm1'$$),
  '1 pending ' || tests.n() || ' true', 'satu baris, status awal pending, jam app.now()');
-- Klaim pending: dalam 30 detik tetap false; lebih tua dari 30 detik = diambil alih (sekali).
select tests.clock_at('2026-03-20 10:00:29+07');
select is(tests.web_val(tests.n(), $$select api.wa_claim_message('m1')::text$$), 'false',
  'pending segar (29 detik) -> false');
select tests.clock_at('2026-03-20 10:00+07');
select tests.owner_exec(null, $$update app.wa_messages set created_at = app.now() - interval '31 seconds'
  where message_id = 'm1'$$);
select is(tests.web_val(tests.f(), $$select api.wa_claim_message('m1')::text$$), 'false',
  'pending basi milik user lain -> false');
select is(tests.web_val(tests.n(), $$select api.wa_claim_message('m1')::text$$), 'true',
  'pending basi (> 30 detik) milik sendiri -> true');
select is(tests.owner_val(null, $$select status || ' ' || (created_at = app.now()) from app.wa_messages
    where message_id = 'm1'$$), 'pending true', 'ambil alih menyegarkan created_at');
select is(tests.web_val(tests.n(), $$select api.wa_claim_message('m1')::text$$), 'false',
  'sesudah diambil alih, klaim berikutnya -> false');
select is(tests.web_val(tests.f(), $$select count(*) from app.wa_messages$$), '0', 'F tidak melihat pesan N');
select is(tests.web_exec(tests.f(), $$update app.wa_messages set status = 'cancelled' where message_id = 'm1'$$), 0::bigint,
  'F tidak bisa mengubah pesan N');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), format(
    $q$insert into app.wa_messages (message_id, user_id, status) values ('m9', %L, 'ignored')$q$, tests.n())),
  '42501', null, 'F tidak bisa menulis pesan atas nama N');
select throws_ok($$select tests.web_exec(tests.f(), $q$select api.wa_finish_message('m1', 'rejected')$q$)$$,
  'DK404', 'wa_message_not_found', 'F tidak bisa menyelesaikan pesan N');
select throws_ok($$select tests.web_exec(tests.n(), $q$select api.wa_finish_message('m1', 'recorded')$q$)$$,
  '23514', null, 'recorded tanpa entri ditolak');
select throws_ok($$select tests.web_exec(tests.n(), $q$select api.wa_finish_message('m1', 'unknown')$q$)$$,
  '23514', null, 'status di luar daftar ditolak');
select throws_ok(format($$select tests.web_exec(tests.n(), %L)$$, format(
    $q$select api.wa_claim_message(%L)$q$, repeat('x', 257))),
  '23514', null, 'message_id > 256 karakter ditolak');

-- ===== Batal: catatan WhatsApp terakhir dalam 10 menit =====
-- p_current = id (hash) pesan `batal` yang sedang diproses; 'cur' = pesan yang tidak ada.
select has_function('api', 'wa_last_cancellable', array['text'], 'wa_last_cancellable(p_current text)');
select hasnt_function('api', 'wa_last_cancellable', array[]::text[], 'tanpa versi tanpa argumen');
-- Klaim m1 di atas masih pending; diselesaikan agar kasus di bawah tidak bergantung padanya.
select tests.web_exec(tests.n(), $$select api.wa_finish_message('m1', 'ignored')$$);
select tests.account(tests.n(), :'np', 'BCA', 'operasional', 100000) as bca \gset
select is(tests.web_val(tests.n(), $$select coalesce(api.wa_last_cancellable('cur')::text, 'null')$$), 'null',
  'belum ada pesan recorded -> null');
select tests.web_val(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 20000) ->> 'entry_id'$$,
  :'np', :'bca')) as e1 \gset
select tests.web_exec(tests.n(), $$select api.wa_claim_message('m2')$$);
select tests.web_exec(tests.n(), format($$select api.wa_finish_message('m2', 'recorded', %L)$$, :'e1'));
select is(tests.web_val(tests.n(), $$select api.wa_last_cancellable('cur')::text$$)::jsonb,
  jsonb_build_object('entry_id', :'e1', 'space_id', :'np', 'version', 1), 'pesan recorded terakhir -> entri, ruang, versi');
select is(tests.web_val(tests.f(), $$select coalesce(api.wa_last_cancellable('cur')::text, 'null')$$), 'null',
  'F tidak mendapat catatan N');
-- Pesan pending yang lebih baru (catatan masih berjalan, atau finish gagal sesudah createEntry)
-- menghalangi batal: tidak mundur ke catatan recorded yang lebih lama.
select tests.clock_at('2026-03-20 10:00:05+07');
select tests.web_exec(tests.n(), $$select api.wa_claim_message('m2p')$$);
select is(tests.web_val(tests.n(), $$select coalesce(api.wa_last_cancellable('cur')::text, 'null')$$), 'null',
  'pesan terbaru pending -> null walau ada recorded lebih lama');
select is(tests.web_val(tests.n(), $$select api.wa_last_cancellable('m2p') ->> 'entry_id'$$), :'e1',
  'pesan batal yang sedang diproses (p_current, pending) tidak dihitung');
select is(tests.web_val(tests.n(), $$select coalesce(api.wa_last_cancellable(null)::text, 'null')$$), 'null',
  'p_current NULL -> null (gagal tertutup)');
select tests.web_exec(tests.n(), $$select api.wa_finish_message('m2p', 'rejected')$$);
select is(tests.web_val(tests.n(), $$select api.wa_last_cancellable('cur') ->> 'entry_id'$$), :'e1',
  'pending yang selesai rejected tidak menghalangi lagi');
select tests.clock_at('2026-03-20 10:00+07');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), format(
    $q$select api.wa_finish_message('m1', 'recorded', %L)$q$, :'e1')),
  'DK404', null, 'F tidak bisa merujuk pesan/entri N');
select tests.web_exec(tests.f(), $$select api.wa_claim_message('f1')$$);
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.f(), format(
    $q$select api.wa_finish_message('f1', 'recorded', %L)$q$, :'e1')),
  'DK404', 'entry_not_found', 'entri ruang lain tidak bisa dicatat sebagai milik pesan F');
-- Pesan ditolak sesudahnya tidak menggeser catatan terakhir.
select tests.web_exec(tests.n(), $$select api.wa_claim_message('m3')$$);
select tests.web_exec(tests.n(), $$select api.wa_finish_message('m3', 'rejected')$$);
select is(tests.web_val(tests.n(), $$select api.wa_last_cancellable('cur') ->> 'entry_id'$$), :'e1',
  'pesan rejected tidak menggeser catatan terakhir');
select tests.clock_at('2026-03-20 10:09:59+07');
select is(tests.web_val(tests.n(), $$select api.wa_last_cancellable('cur') ->> 'entry_id'$$), :'e1', '9 menit 59 detik: masih bisa');
select tests.clock_at('2026-03-20 10:10:01+07');
select is(tests.web_val(tests.n(), $$select coalesce(api.wa_last_cancellable('cur')::text, 'null')$$), 'null',
  'lewat 10 menit -> null');
select tests.clock_at('2026-03-20 10:00+07');
select tests.web_exec(tests.n(), format(
  $$select api.update_entry(gen_random_uuid(), %L, 1, %L, 25000, null, null, null, false)$$, :'e1', :'bca'));
select is(tests.web_val(tests.n(), $$select coalesce(api.wa_last_cancellable('cur')::text, 'null')$$), 'null',
  'entri diubah di app (versi berubah) -> null');
select tests.web_val(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 15000) ->> 'entry_id'$$,
  :'np', :'bca')) as e2 \gset
select tests.web_exec(tests.n(), $$select api.wa_claim_message('m4')$$);
select tests.web_exec(tests.n(), format($$select api.wa_finish_message('m4', 'recorded', %L)$$, :'e2'));
select is(tests.web_val(tests.n(), $$select api.wa_last_cancellable('cur') ->> 'entry_id'$$), :'e2', 'pesan baru -> entri baru');
select tests.web_exec(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'e2'));
select is(tests.web_val(tests.n(), $$select coalesce(api.wa_last_cancellable('cur')::text, 'null')$$), 'null',
  'entri sudah dihapus (void) -> null');
select tests.web_exec(tests.n(), $$select api.wa_finish_message('m4', 'cancelled', null)$$);
select is(tests.owner_val(null, $$select status || ' ' || coalesce(entry_id::text, 'null') from app.wa_messages where message_id = 'm4'$$),
  'cancelled null', 'finish mengubah status pesan sendiri');
-- Batal kedua tidak mundur ke catatan lebih lama yang masih dalam 10 menit.
select tests.clock_at('2026-03-20 10:01+07');
select tests.web_val(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1000) ->> 'entry_id'$$,
  :'np', :'bca')) as e5 \gset
select tests.web_exec(tests.n(), $$select api.wa_claim_message('m10')$$);
select tests.web_exec(tests.n(), format($$select api.wa_finish_message('m10', 'recorded', %L)$$, :'e5'));
select tests.clock_at('2026-03-20 10:02+07');
select tests.web_val(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1000) ->> 'entry_id'$$,
  :'np', :'bca')) as e6 \gset
select tests.web_exec(tests.n(), $$select api.wa_claim_message('m11')$$);
select tests.web_exec(tests.n(), format($$select api.wa_finish_message('m11', 'recorded', %L)$$, :'e6'));
select is(tests.web_val(tests.n(), $$select api.wa_last_cancellable('cur') ->> 'entry_id'$$), :'e6',
  'dua catatan segar: yang terbaru bisa dibatalkan');
select tests.web_exec(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'e6'));
select tests.web_exec(tests.n(), $$select api.wa_finish_message('m11', 'cancelled')$$);
select is(tests.web_val(tests.n(), $$select coalesce(api.wa_last_cancellable('cur')::text, 'null')$$), 'null',
  'pesan terbaru cancelled -> null: catatan lebih lama (masih 10 menit, versi sama) tidak ikut terbatalkan');
select tests.clock_at('2026-03-20 10:00+07');

-- ===== Dompet bawaan (spec 4.4) =====
select tests.account(tests.n(), :'sh', 'Rumah A', 'operasional', 500000) as sa \gset
select tests.account(tests.n(), :'sh', 'Rumah B', 'operasional') as sb \gset
select tests.account(tests.n(), :'sh', 'Rumah C', 'operasional') as sc \gset
select tests.owner_exec(null, format($$update app.accounts set sort_order = case id when %L then 2 when %L then 1 else 0 end
  where space_id = %L$$, :'sa', :'sb', :'sh'));
select is(tests.web_val(tests.n(), format($$select coalesce(api.wa_default_account(%L)::text, 'null')$$, :'np')), :'bca',
  'Pribadi: dompet yang terakhir dipakai');
select is(tests.web_val(tests.n(), format($$select api.wa_default_account(%L)::text$$, :'sh')), :'sc',
  'tanpa riwayat: dompet aktif pertama menurut sort_order');
select tests.web_exec(tests.n(), format($$select api.archive_account(%L)$$, :'sc'));
select is(tests.web_val(tests.n(), format($$select api.wa_default_account(%L)::text$$, :'sh')), :'sb',
  'dompet terarsip dilewati');
select tests.web_exec(tests.f(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 10000)$$, :'sh', :'sa'));
select is(tests.web_val(tests.n(), format($$select api.wa_default_account(%L)::text$$, :'sh')), :'sb',
  'riwayat pasangan tidak dihitung');
select is(tests.web_val(tests.f(), format($$select api.wa_default_account(%L)::text$$, :'sh')), :'sa',
  'riwayat F sendiri dihitung');
select tests.web_val(tests.n(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 10000) ->> 'entry_id'$$,
  :'sh', :'sa')) as e3 \gset
select is(tests.web_val(tests.n(), format($$select api.wa_default_account(%L)::text$$, :'sh')), :'sa',
  'riwayat N di Bersama -> dompet itu');
select tests.web_exec(tests.n(), format($$select api.void_entry(gen_random_uuid(), %L, 1)$$, :'e3'));
select is(tests.web_val(tests.n(), format($$select api.wa_default_account(%L)::text$$, :'sh')), :'sb',
  'entri void tidak dihitung sebagai riwayat');
select is(tests.web_val(tests.f(), format($$select coalesce(api.wa_default_account(%L)::text, 'null')$$, :'np')), 'null',
  'ruang orang lain -> null (RLS)');
-- Kantong kantor tidak pernah jadi bawaan; cadangan memilih operasional lebih dulu (Catat).
select tests.account(tests.f(), :'fp', 'Kantor', 'kantor', 50000) as fk \gset
select is(tests.web_val(tests.f(), format($$select coalesce(api.wa_default_account(%L)::text, 'null')$$, :'fp')), 'null',
  'ruang hanya berisi dompet kantor -> null');
select tests.account(tests.f(), :'fp', 'Tabungan', 'tabungan', 50000) as ft \gset
select tests.account(tests.f(), :'fp', 'Harian', 'operasional') as fo \gset
select tests.owner_exec(null, format($$update app.accounts set sort_order = case id when %L then 0 when %L then 1 else 2 end
  where space_id = %L$$, :'fk', :'ft', :'fp'));
select is(tests.web_val(tests.f(), format($$select api.wa_default_account(%L)::text$$, :'fp')), :'fo',
  'tanpa riwayat: operasional didahulukan walau sort_order lebih besar');
select tests.web_exec(tests.f(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1000)$$, :'fp', :'fk'));
select is(tests.web_val(tests.f(), format($$select api.wa_default_account(%L)::text$$, :'fp')), :'fo',
  'dompet kantor yang terakhir dipakai tidak jadi bawaan');
select tests.web_exec(tests.f(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1000)$$, :'fp', :'ft'));
select tests.web_exec(tests.f(), format($$select api.create_entry(gen_random_uuid(), %L, %L, 'expense', 1000)$$, :'fp', :'fk'));
select is(tests.web_val(tests.f(), format($$select api.wa_default_account(%L)::text$$, :'fp')), :'ft',
  'riwayat terbaru selain kantor (tabungan) dipakai');

-- ===== Putuskan =====
select throws_ok($$select tests.web_exec(null, $q$select api.wa_unlink()$q$)$$, 'DK401', 'unauthenticated',
  'putuskan butuh user');
select tests.web_val(tests.n(), $$select api.wa_create_link_code() ->> 'code'$$) as code_n4 \gset
select lives_ok($$select tests.web_exec(tests.n(), $q$select api.wa_unlink()$q$)$$, 'putuskan');
select is(tests.web_val(null, format($$select coalesce(api.wa_resolve_sender(%L)::text, 'null')$$, :'p3')), 'null',
  'sesudah putus nomor tidak terpetakan');
select is(tests.owner_val(null, format($$select (select count(*) from app.wa_links where user_id = %1$L) || '/'
    || (select count(*) from app.wa_link_codes where user_id = %1$L)$$, tests.n())), '0/0',
  'putuskan menghapus nomor dan kode tertunda');
select is(tests.web_val(null, format($$select coalesce(api.wa_confirm_link(%L, %L)::text, 'null')$$, :'code_n4', :'p3')),
  'null', 'kode tertunda sebelum putus tidak bisa dipakai');
select tests.web_exec(tests.n(), $$select api.wa_unlink()$$);
select is(tests.owner_val(null, format($$select count(*) || ' ' || min(meta::text)
    from audit.events where event = 'wa_unlinked' and user_id = %L$$, tests.n())),
  '1 {"via": "app"}', 'event wa_unlinked sekali (putus kedua tanpa nomor = tanpa event)');
select is(tests.web_val(tests.f(), $$select count(*) from app.wa_links$$), '1', 'nomor F tidak terpengaruh');

-- ===== Klaim pesan yang sudah selesai tidak pernah diambil alih =====
select tests.web_exec(tests.n(), format($$select api.wa_claim_message('done-' || %L)$$, st))
from unnest(array['recorded', 'rejected', 'cancelled', 'ignored']) st;
select tests.web_exec(tests.n(), format($$select api.wa_finish_message('done-' || %L, %L, %L::uuid)$$,
  st, st, case when st = 'recorded' then :'e1' end))
from unnest(array['recorded', 'rejected', 'cancelled', 'ignored']) st;
select tests.owner_exec(null, $$update app.wa_messages set created_at = app.now() - interval '1 hour'
  where message_id like 'done-%'$$);
select is(tests.web_val(tests.n(), format($$select api.wa_claim_message('done-' || %L)::text$$, st)), 'false',
  'pesan selesai (' || st || ') yang lama -> false')
from unnest(array['recorded', 'rejected', 'cancelled', 'ignored']) st;

-- ===== Audit: event sistem tidak bisa dipalsukan; tanpa nomor di payload =====
select throws_ok(format($$select tests.%s_exec(%L, %L)$$, r, tests.n(), format('select audit.log(%L)', e)),
  'DK422', 'audit_event_reserved', r || ': event WA reserved: ' || e)
from unnest(array['web', 'worker']) r, unnest(array['wa_linked', 'wa_unlinked']) e;
select is(tests.owner_val(null, $$select count(*) from audit.events
    where event like 'wa\_%' and (meta::text ~ '[0-9]{4}' or meta::text like '%+62%')$$), '0',
  'payload audit WA tanpa nomor telepon');

select * from finish();
rollback;
