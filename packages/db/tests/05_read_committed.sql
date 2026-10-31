-- Isolasi wajib READ COMMITTED (BSD §3, §13 #23): penjaga batas user dan undangan hanya benar
-- di tingkat ini. Transaksi tes sengaja REPEATABLE READ; semua jalan tulis S4 harus menolak.
begin isolation level repeatable read;
select plan(7);

select throws_ok(q, 'DK500', 'isolation_not_read_committed', 'REPEATABLE READ ditolak: ' || t)
from (values
  ('trigger pendaftaran', $$select tests.web_exec(null, $q$insert into auth."user" (id, name, email) values (gen_random_uuid(), 'N', 'novanda@example.test')$q$)$$),
  ('bootstrap_owner', $$select tests.web_exec(tests.n(), $q$select api.bootstrap_owner('N')$q$)$$),
  ('create_invitation', $$select tests.web_exec(tests.n(), $q$select api.create_invitation('a@b.test', pg_catalog.sha256('x'))$q$)$$),
  ('revoke_invitation', $$select tests.web_exec(tests.n(), $q$select api.revoke_invitation(gen_random_uuid())$q$)$$),
  ('decline_invitation', $$select tests.web_exec(null, $q$select api.decline_invitation(pg_catalog.sha256('x'))$q$)$$),
  ('accept_invitation', $$select tests.web_exec(tests.n(), $q$select api.accept_invitation(pg_catalog.sha256('x'), 'N')$q$)$$),
  ('provision_user', $$select tests.api_exec(tests.n(), $q$select private.provision_user(app.current_user_id(), 'N', null, null)$q$)$$)
) v (t, q);

select * from finish();
rollback;
