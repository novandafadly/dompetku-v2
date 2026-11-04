-- audit.events dan product_events (BSD §6, §10, §13 #17, #32): user_id dari konteks, daftar
-- tertutup event dan kunci meta, tanpa INSERT langsung, append-only, retensi lewat job.
begin;
select plan(45);
select tests.fixture();

-- user_id selalu dari konteks request.
select tests.web_exec(tests.n(), $$select audit.log('login_success', '1.2.3.4'::inet, repeat('a', 300))$$);
select is(tests.owner_val(null, $$select user_id::text || ' ' || host(ip) || ' ' || length(user_agent)
  from audit.events where event = 'login_success'$$), tests.n()::text || ' 1.2.3.4 200',
  'audit: user dari konteks, user_agent dipotong 200');
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    format('select audit.log(%L, %L::uuid, %L::inet)', 'login_success', tests.f(), '1.2.3.4')),
  '42883', null, 'tidak ada parameter user_id untuk dipalsukan');
select tests.web_exec(null, $$select audit.log('login_failed', '5.6.7.8'::inet)$$);
select is(tests.owner_val(null, $$select coalesce(user_id::text, 'null') from audit.events where event = 'login_failed'$$),
  'null', 'event pra-login tanpa user_id');
select tests.worker_exec(null, $$select audit.log('export', null, null, null, '{"status": "ok", "via": "job"}')$$);
select is(tests.owner_val(null, $$select meta ->> 'status' from audit.events where event = 'export'$$), 'ok',
  'worker bisa menulis audit lewat audit.log');

-- Event sistem (review S4) tidak bisa ditulis lewat audit.log oleh web maupun worker.
select throws_ok(format($$select tests.%s_exec(%L, %L)$$, r, tests.n(), format('select audit.log(%L)', e)),
  'DK422', 'audit_event_reserved', r || ': event sistem ditolak: ' || e)
from unnest(array['web', 'worker']) r,
     unnest(array['space_member_change', 'unfinished_user_purged', 'entry_purged', 'purge_voided',
                  'db_manual_access', 'deploy']) e;

-- space_id hanya ruang milik pemanggil.
select tests.web_exec(tests.n(), format($$select audit.log('step_up', null, null, %L, '{"count": 1}')$$,
  tests.space_id(tests.f(), 'personal')));
select is(tests.owner_val(null, $$select coalesce(space_id::text, 'null') from audit.events where event = 'step_up'$$),
  'null', 'space_id ruang pasangan dibuang');
select tests.web_exec(tests.n(), format($$select audit.log('space_move', null, null, %L)$$, tests.space_id(tests.n(), 'personal')));
select is(tests.owner_val(null, $$select space_id::text from audit.events where event = 'space_move'$$),
  tests.space_id(tests.n(), 'personal')::text, 'space_id ruang sendiri disimpan');

-- Daftar tertutup event dan kunci meta, nilai skalar, maksimal 1 kB.
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), q), '23514', null, 'meta/event ditolak: ' || t)
from (values
  ('event di luar daftar', $q$select audit.log('apa_saja')$q$),
  ('kunci nominal', $q$select audit.log('login_success', null, null, null, '{"nominal": 999999}')$q$),
  ('kunci description', $q$select audit.log('login_success', null, null, null, '{"description": "x"}')$q$),
  ('nilai objek', $q$select audit.log('login_success', null, null, null, '{"reason": {"nominal": 1}}')$q$),
  ('meta bukan objek', $q$select audit.log('login_success', null, null, null, '[1]')$q$),
  ('meta > 1 kB', $q$select audit.log('login_success', null, null, null, jsonb_build_object('reason', repeat('x', 1100)))$q$)
) v (t, q);
-- Mode strict: array dan objek ditolak juga bila isinya skalar (BSD §6, diubah S4).
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), q), '23514', null, 'meta ditolak: ' || t)
from (values
  ('array skalar', $q$select audit.log('login_success', null, null, null, '{"reason": [1]}')$q$),
  ('objek skalar', $q$select audit.log('login_success', null, null, null, '{"reason": {"x": 1}}')$q$)
) v (t, q);
select lives_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    $q$select audit.log('logout', null, null, null, '{"reason": null, "count": 2, "status": "ok", "via": true}')$q$),
  'meta skalar dan null diterima');
select lives_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    $q$select audit.log('factor_added', null, null, null, '{"method": "passkey", "amr": "passkey", "count": 1}')$q$),
  'kunci meta yang diizinkan');

-- Tanpa INSERT langsung untuk role mana pun selain owner.
select throws_ok(format($$select tests.%s_exec(%L, %L)$$, r, tests.n(),
    $q$insert into audit.events (event, user_id) values ('login_success', '22222222-2222-2222-2222-222222222222')$q$),
  '42501', null, r || ': INSERT langsung ke audit.events ditolak')
from unnest(array['web', 'api', 'worker']) r;

-- Bentuk insert infra/db-vm/bin/dompetku-psql (owner, kunci meta yang diizinkan) diterima.
select lives_ok($$select tests.owner_exec(null, $q$insert into audit.events (event, meta)
    values ('db_manual_access', jsonb_build_object('via', 'cli', 'target', 'dompetku_owner',
            'reason', repeat('a', 120), 'op', 'novanda', 'status', 'alert_off'))$q$)$$,
  'owner: db_manual_access dari dompetku-psql diterima');

-- Web hanya membaca event miliknya.
select is(tests.web_val(tests.f(), $$select count(*) from audit.events where event in ('login_success', 'step_up', 'space_move')$$),
  '0', 'F tidak melihat event N');

-- Append-only, juga untuk owner (BSD §13 #32).
select throws_ok($$select tests.owner_exec(null, $q$update audit.events set ip = null$q$)$$,
  'DK422', 'append_only', 'owner UPDATE audit ditolak');
select throws_ok($$select tests.owner_exec(null, $q$delete from audit.events$q$)$$,
  'DK422', 'append_only', 'owner DELETE audit ditolak');
select throws_ok($$select tests.owner_exec(null, $q$truncate audit.events$q$)$$,
  'DK422', 'append_only', 'owner TRUNCATE audit ditolak');

-- Retensi 1 tahun lewat jobs.purge_audit (worker saja).
select throws_ok($$select tests.web_val(null, $q$select jobs.purge_audit()$q$)$$, '42501', null,
  'web tidak bisa menjalankan job');
select is(tests.worker_val(null, $$select jobs.purge_audit()$$), '0', 'purge_audit: belum ada yang berumur 1 tahun');
select tests.clock(interval '1 year 1 day');
select ok(tests.worker_val(null, $$select jobs.purge_audit()$$)::int >= 8, 'purge_audit menghapus event > 1 tahun');
select is(tests.owner_val(null, $$select count(*) from audit.events$$), '0', 'audit kosong setelah retensi');

-- product_events: tanpa nominal/deskripsi, daftar event tertutup.
select throws_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(), q), '23514', null, 'product_events ditolak: ' || t)
from (values
  ('catat_disimpan tanpa flow/taps/durasi', $q$insert into app.product_events (user_id, event) values (app.current_user_id(), 'catat_disimpan')$q$),
  ('event di luar daftar', $q$insert into app.product_events (user_id, event) values (app.current_user_id(), 'nominal_35000')$q$),
  ('taps > 100', $q$insert into app.product_events (user_id, event, flow_id, taps, duration_ms) values (app.current_user_id(), 'catat_batal', gen_random_uuid(), 101, 1)$q$)
) v (t, q);
select lives_ok(format($$select tests.web_exec(%L, %L)$$, tests.n(),
    $q$insert into app.product_events (user_id, space_kind, event, flow_id, taps, duration_ms)
       values (app.current_user_id(), 'personal', 'catat_disimpan', gen_random_uuid(), 3, 6400)$q$),
  'product_events catat_disimpan lengkap');
select is((select count(*)::int from pg_attribute a join pg_class c on c.oid = a.attrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname = 'product_events' and a.attnum > 0 and not a.attisdropped
             and a.attname ~ 'amount|nominal|description|note'), 0, 'product_events tanpa kolom nominal/deskripsi');

select * from finish();
rollback;
