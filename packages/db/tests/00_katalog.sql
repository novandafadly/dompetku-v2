-- Tes katalog (BSD §13 #1 sampai #8), otomatis mencakup objek baru di skema aplikasi.
begin;
select plan(21);

-- #1 RLS ENABLE + FORCE di semua tabel app/audit kecuali app.settings.
select is_empty($$
  select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('app', 'audit') and c.relkind in ('r', 'p') and c.relname <> 'settings'
    and not (c.relrowsecurity and c.relforcerowsecurity) $$,
  'RLS aktif dan dipaksa di semua tabel app/audit');
select ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname in ('app', 'audit') and c.relkind = 'r' and c.relforcerowsecurity) >= 8,
          'tabel S4 ikut terperiksa (>= 8 tabel ber-RLS)');

-- #2 Tidak ada fungsi yang bisa dieksekusi PUBLIC.
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
       aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname in ('app', 'api', 'private', 'jobs', 'audit') and a.grantee = 0 $$,
  'tanpa EXECUTE untuk PUBLIC');

-- #3 search_path dipatok kosong; DEFINER tanpa tabel sementara.
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app', 'api', 'private', 'jobs', 'audit')
    and (p.proconfig is null or not ('search_path=""' = any (p.proconfig))) $$,
  'search_path="" di semua fungsi');
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app', 'api', 'private', 'jobs', 'audit', 'auth')
    and p.prosecdef and p.prosrc ~* 'create\s+(temp|temporary)\s' $$,
  'DEFINER tanpa create temp table');

-- #4 Tanpa current_date/localtimestamp (jam selalu app.now()/app.today()).
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app', 'api', 'private', 'jobs', 'audit')
    and p.prosrc ~* 'current_date|localtimestamp' $$,
  'tanpa current_date/localtimestamp');

-- #5 Daftar tertutup DEFINER.
select set_eq($$
  select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and n.nspname = 'app' $$,
  array['app.my_space_ids', 'app.space_roster'],
  'DEFINER baca di app = my_space_ids, space_roster');
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and (not p.prosecdef or p.proowner <> 'dompetku_api'::regrole) $$,
  'semua fungsi api.* S4 DEFINER milik dompetku_api');
select set_eq($$
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' $$,
  array['bootstrap_owner', 'create_invitation', 'revoke_invitation', 'resend_invitation',
        'invitation_peek', 'decline_invitation', 'accept_invitation', 'list_invitations'],
  'daftar fungsi api S4');
select set_eq($$
  select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and p.proowner = 'dompetku_owner'::regrole
    and n.nspname in ('app', 'api', 'private', 'jobs', 'audit', 'auth') $$,
  array['app.my_space_ids', 'app.space_roster', 'audit.log',
        'jobs.purge_audit', 'jobs.purge_unfinished_users',
        'private.provision_user', 'private.tg_space_member_guard', 'private.tg_user_admission'],
  'DEFINER milik dompetku_owner = daftar tertutup S4');
select is((select p.proowner::regrole::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'private' and p.proname = 'require_user'),
          'dompetku_api', 'private.require_user milik dompetku_api (own_api_functions)');

-- #6 Matriks hak tabel (app, audit, auth, jobs) per role aplikasi. Tabel baru wajib masuk sini.
select set_eq($$
  select r.rolname, n.nspname || '.' || c.relname, p.priv
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('dompetku_web'), ('dompetku_api'), ('dompetku_worker'), ('dompetku_auditor')) r (rolname)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'),
                     ('TRIGGER')) p (priv)
  where n.nspname in ('app', 'audit', 'auth', 'jobs') and c.relkind in ('r', 'p', 'v', 'm')
    and has_table_privilege(r.rolname, c.oid, p.priv) $$,
  $$ values
    ('dompetku_web', 'app.settings', 'SELECT'),
    ('dompetku_web', 'app.households', 'SELECT'),
    ('dompetku_web', 'app.spaces', 'SELECT'),
    ('dompetku_web', 'app.space_members', 'SELECT'),
    ('dompetku_web', 'app.profiles', 'SELECT'),
    ('dompetku_web', 'app.product_events', 'SELECT'),
    ('dompetku_web', 'app.product_events', 'INSERT'),
    ('dompetku_web', 'audit.events', 'SELECT'),
    ('dompetku_web', 'auth.user', 'SELECT'),
    ('dompetku_web', 'auth.user', 'INSERT'),
    ('dompetku_web', 'auth.user', 'UPDATE'),
    ('dompetku_web', 'auth.user', 'DELETE'),
    ('dompetku_web', 'auth.recovery_codes', 'SELECT'),
    ('dompetku_web', 'auth.recovery_codes', 'INSERT'),
    ('dompetku_web', 'auth.recovery_codes', 'UPDATE'),
    ('dompetku_web', 'auth.recovery_codes', 'DELETE'),
    ('dompetku_web', 'auth.session', 'SELECT'),
    ('dompetku_web', 'auth.session', 'INSERT'),
    ('dompetku_web', 'auth.session', 'UPDATE'),
    ('dompetku_web', 'auth.session', 'DELETE'),
    ('dompetku_web', 'auth.account', 'SELECT'),
    ('dompetku_web', 'auth.account', 'INSERT'),
    ('dompetku_web', 'auth.account', 'UPDATE'),
    ('dompetku_web', 'auth.account', 'DELETE'),
    ('dompetku_web', 'auth.verification', 'SELECT'),
    ('dompetku_web', 'auth.verification', 'INSERT'),
    ('dompetku_web', 'auth.verification', 'UPDATE'),
    ('dompetku_web', 'auth.verification', 'DELETE'),
    ('dompetku_web', 'auth.twoFactor', 'SELECT'),
    ('dompetku_web', 'auth.twoFactor', 'INSERT'),
    ('dompetku_web', 'auth.twoFactor', 'UPDATE'),
    ('dompetku_web', 'auth.twoFactor', 'DELETE'),
    ('dompetku_web', 'auth.passkey', 'SELECT'),
    ('dompetku_web', 'auth.passkey', 'INSERT'),
    ('dompetku_web', 'auth.passkey', 'UPDATE'),
    ('dompetku_web', 'auth.passkey', 'DELETE'),
    ('dompetku_web', 'auth.login_throttle', 'SELECT'),
    ('dompetku_web', 'auth.login_throttle', 'INSERT'),
    ('dompetku_web', 'auth.login_throttle', 'UPDATE'),
    ('dompetku_web', 'auth.login_throttle', 'DELETE'),
    ('dompetku_api', 'app.settings', 'SELECT'),
    ('dompetku_api', 'app.households', 'SELECT'),
    ('dompetku_api', 'app.spaces', 'SELECT'),
    ('dompetku_api', 'app.space_members', 'SELECT'),
    ('dompetku_api', 'app.profiles', 'SELECT'),
    ('dompetku_api', 'app.profiles', 'UPDATE'),
    ('dompetku_api', 'app.invitations', 'SELECT'),
    ('dompetku_api', 'app.invitations', 'INSERT'),
    ('dompetku_api', 'app.invitations', 'UPDATE'),
    ('dompetku_api', 'app.idempotency_keys', 'SELECT'),
    ('dompetku_api', 'app.idempotency_keys', 'INSERT'),
    ('dompetku_api', 'app.idempotency_keys', 'UPDATE'),
    ('dompetku_worker', 'app.settings', 'SELECT'),
    ('dompetku_auditor', 'app.settings', 'SELECT'),
    ('dompetku_auditor', 'app.households', 'SELECT'),
    ('dompetku_auditor', 'app.spaces', 'SELECT'),
    ('dompetku_auditor', 'app.space_members', 'SELECT'),
    ('dompetku_auditor', 'app.profiles', 'SELECT'),
    ('dompetku_auditor', 'app.idempotency_keys', 'SELECT'),
    ('dompetku_auditor', 'app.invitations', 'SELECT'),
    ('dompetku_auditor', 'app.product_events', 'SELECT') $$,
  'matriks hak tabel web/api/worker/auditor');

-- Matriks EXECUTE fungsi (pemilik fungsi otomatis punya hak).
select set_eq($$
  select r.rolname, n.nspname || '.' || p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('dompetku_web'), ('dompetku_api'), ('dompetku_worker'), ('dompetku_auditor')) r (rolname)
  where n.nspname in ('app', 'api', 'private', 'jobs', 'audit')
    and has_function_privilege(r.rolname, p.oid, 'EXECUTE') $$,
  $$ select r, f from unnest(array['dompetku_web', 'dompetku_api', 'dompetku_worker', 'dompetku_auditor']) r,
                      unnest(array['app.current_user_id', 'app.now', 'app.today']) f
     union all
     select r, f from unnest(array['dompetku_web', 'dompetku_api', 'dompetku_auditor']) r,
                      unnest(array['app.my_space_ids', 'app.space_roster', 'app.assert_member']) f
     union all
     select r, 'api.' || f from unnest(array['dompetku_web', 'dompetku_api']) r,
                      unnest(array['bootstrap_owner', 'create_invitation', 'revoke_invitation',
                                   'resend_invitation', 'invitation_peek', 'decline_invitation',
                                   'accept_invitation', 'list_invitations']) f
     union all
     select 'dompetku_api', f from unnest(array['private.require_read_committed',
                      'private.require_user', 'private.provision_user']) f
     union all
     select 'dompetku_worker', f from unnest(array['jobs.purge_unfinished_users', 'jobs.purge_audit']) f
     union all
     select r, 'audit.log' from unnest(array['dompetku_web', 'dompetku_worker']) r $$,
  'matriks EXECUTE fungsi');

-- Role: hanya owner dan auditor yang BYPASSRLS; web/worker READ COMMITTED (BSD §3).
select set_eq($$ select rolname::text from pg_roles where rolname like 'dompetku\_%' and rolbypassrls $$,
              array['dompetku_owner', 'dompetku_auditor'], 'BYPASSRLS hanya owner dan auditor');
select ok((select bool_and('default_transaction_isolation=read committed' = any (s.setconfig))
           from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
           where r.rolname in ('dompetku_web', 'dompetku_worker'))
          and (select count(*) from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
               where r.rolname in ('dompetku_web', 'dompetku_worker')) = 2,
          'default READ COMMITTED di role web dan worker');

-- #7 Setiap FK punya indeks non-parsial dengan kolom terdepan = kolom FK (sebagai himpunan).
select is_empty($$
  select c.conrelid::regclass::text || ' ' || c.conname from pg_constraint c
  join pg_namespace n on n.oid = c.connamespace
  where c.contype = 'f' and n.nspname in ('app', 'audit', 'auth')
    and not exists (
      select 1 from pg_index i
      where i.indrelid = c.conrelid and i.indpred is null
        and (select array_agg(k order by k)
               from unnest((string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)]) k)
            = (select array_agg(k order by k) from unnest(c.conkey) k)) $$,
  'setiap FK berindeks');

-- FK domain ke auth."user" selalu on delete restrict (BSD §5); hanya tabel di skema auth cascade.
select set_eq($$
  select c.conrelid::regclass::text, c.confdeltype::text from pg_constraint c
  join pg_class t on t.oid = c.confrelid join pg_namespace n on n.oid = t.relnamespace
  where c.contype = 'f' and n.nspname = 'auth' and t.relname = 'user' and c.confdeltype <> 'r' $$,
  $$ values ('auth.recovery_codes', 'c'), ('auth.session', 'c'), ('auth.account', 'c'),
            ('auth."twoFactor"', 'c'), ('auth.passkey', 'c') $$,
  'FK ke auth.user restrict, kecuali tabel auth (kode pemulihan, Better Auth) cascade');

-- #8 Penanda lingkungan.
select is(tests.owner_val(null, $$select value from app.settings where key = 'env'$$), 'prod', 'app.settings env = prod');

-- Trigger penjaga terpasang.
select has_trigger('auth', 'user', 'user_admission', 'trigger pendaftaran di auth.user');
select has_trigger('app', 'space_members', 'space_member_guard', 'penjaga anggota ruang Pribadi');
select ok((select count(*) = 2 from pg_trigger g join pg_class c on c.oid = g.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'audit' and c.relname = 'events' and g.tgname in ('audit_events_append_only', 'audit_events_no_truncate')),
          'audit.events append-only (UPDATE/DELETE/TRUNCATE)');

select * from finish();
rollback;
