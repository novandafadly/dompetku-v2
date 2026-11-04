-- Isolasi wajib READ COMMITTED (BSD §3, §13 #23): penjaga batas user dan undangan hanya benar
-- di tingkat ini. Transaksi tes sengaja REPEATABLE READ; semua jalan tulis S4 sampai S7 harus menolak.
begin isolation level repeatable read;
select plan(22);

select throws_ok(q, 'DK500', 'isolation_not_read_committed', 'REPEATABLE READ ditolak: ' || t)
from (values
  ('trigger pendaftaran', $$select tests.web_exec(null, $q$insert into auth."user" (id, name, email) values (gen_random_uuid(), 'N', 'novanda@example.test')$q$)$$),
  ('bootstrap_owner', $$select tests.web_exec(tests.n(), $q$select api.bootstrap_owner('N')$q$)$$),
  ('create_invitation', $$select tests.web_exec(tests.n(), $q$select api.create_invitation('a@b.test', pg_catalog.sha256('x'))$q$)$$),
  ('revoke_invitation', $$select tests.web_exec(tests.n(), $q$select api.revoke_invitation(gen_random_uuid())$q$)$$),
  ('decline_invitation', $$select tests.web_exec(null, $q$select api.decline_invitation(pg_catalog.sha256('x'))$q$)$$),
  ('accept_invitation', $$select tests.web_exec(tests.n(), $q$select api.accept_invitation(pg_catalog.sha256('x'), 'N')$q$)$$),
  ('purge_unfinished_users', $$select tests.worker_val(null, $q$select jobs.purge_unfinished_users()$q$)$$),
  ('provision_user', $$select tests.api_exec(tests.n(), $q$select private.provision_user(app.current_user_id(), 'N', null, null)$q$)$$),
  ('create_account', $$select tests.web_exec(tests.n(), $q$select api.create_account(gen_random_uuid(), gen_random_uuid(), 'X', 'operasional', 'bank')$q$)$$),
  ('create_entry', $$select tests.web_exec(tests.n(), $q$select api.create_entry(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'expense', 1)$q$)$$),
  ('create_transfer', $$select tests.web_exec(tests.n(), $q$select api.create_transfer(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1)$q$)$$),
  ('update_entry', $$select tests.web_exec(tests.n(), $q$select api.update_entry(gen_random_uuid(), gen_random_uuid(), 1, gen_random_uuid(), 1, null, null, null, false)$q$)$$),
  ('void_entry', $$select tests.web_exec(tests.n(), $q$select api.void_entry(gen_random_uuid(), gen_random_uuid(), 1)$q$)$$),
  ('restore_entry', $$select tests.web_exec(tests.n(), $q$select api.restore_entry(gen_random_uuid(), gen_random_uuid(), 1)$q$)$$),
  ('purge_entry', $$select tests.web_exec(tests.n(), $q$select api.purge_entry(gen_random_uuid(), 1)$q$)$$),
  ('reconcile_balance', $$select tests.web_exec(tests.n(), $q$select api.reconcile_balance(gen_random_uuid(), gen_random_uuid(), 0)$q$)$$),
  ('archive_account', $$select tests.web_exec(tests.n(), $q$select api.archive_account(gen_random_uuid())$q$)$$),
  ('create_category', $$select tests.web_exec(tests.n(), $q$select api.create_category(gen_random_uuid(), gen_random_uuid(), 'expense', 'X', 'X')$q$)$$),
  ('update_category', $$select tests.web_exec(tests.n(), $q$select api.update_category(gen_random_uuid(), 'X', 'X', null)$q$)$$),
  ('archive_category', $$select tests.web_exec(tests.n(), $q$select api.archive_category(gen_random_uuid())$q$)$$),
  ('mark_no_spend_day', $$select tests.web_exec(tests.n(), $q$select api.mark_no_spend_day(gen_random_uuid())$q$)$$),
  ('move_entry_to_space', $$select tests.web_exec(tests.n(), $q$select api.move_entry_to_space(gen_random_uuid(), gen_random_uuid(), 1, gen_random_uuid(), gen_random_uuid(), null)$q$)$$)
) v (t, q);

select * from finish();
rollback;
