-- Daftar undangan pembuatnya (0010, layar Undangan tertunda AFD §6): status, tanpa undangan
-- yang diganti kirim ulang, tidak terlihat oleh user lain atau tanpa konteks.
begin;
select plan(7);
select tests.fixture(false);

select throws_ok($$select tests.web_exec(null, $q$select * from api.list_invitations()$q$)$$,
  'DK401', 'unauthenticated', 'daftar undangan tanpa konteks user');
select is(tests.web_val(tests.n(), $$select count(*) from api.list_invitations()$$), '0', 'belum ada undangan');

select tests.web_exec(tests.n(), $$select api.create_invitation('farida@example.test', pg_catalog.sha256('d1'))$$);
select is(tests.web_val(tests.n(), $$select status from api.list_invitations()$$), 'pending', 'undangan baru menunggu');

select tests.web_exec(tests.n(), format($$select api.resend_invitation(%L, null, pg_catalog.sha256('d2'))$$,
  tests.owner_val(null, $$select id from app.invitations where token_hash = pg_catalog.sha256('d1')$$)));
select is(tests.web_val(tests.n(), $$select count(*) || ':' || min(status) from api.list_invitations()$$), '1:pending',
  'yang diganti kirim ulang tidak tampil');

select tests.web_exec(null, $$select api.decline_invitation(pg_catalog.sha256('d2'))$$);
select is(tests.web_val(tests.n(), $$select status from api.list_invitations()$$), 'declined', 'status ditolak terlihat pengundang');

select tests.web_exec(tests.n(), $$select api.create_invitation('x@example.test', pg_catalog.sha256('d3'))$$);
select tests.signup('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x@example.test', false, false);
select is(tests.web_val('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', $$select count(*) from api.list_invitations()$$), '0',
  'user lain (penerima) tidak melihat daftar pengundang');

select tests.clock(interval '73 hours');
select is(tests.web_val(tests.n(), $$select status from api.list_invitations() where email = 'x@example.test'$$), 'expired',
  'lewat 72 jam = kedaluwarsa');

select * from finish();
rollback;
