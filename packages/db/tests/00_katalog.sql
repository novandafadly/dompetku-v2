-- Tes katalog (BSD §13 #1 sampai #9), otomatis mencakup objek baru di skema aplikasi.
begin;
select plan(41);

-- #1 RLS ENABLE + FORCE di semua tabel app/audit kecuali app.settings.
select is_empty($$
  select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('app', 'audit') and c.relkind in ('r', 'p') and c.relname <> 'settings'
    and not (c.relrowsecurity and c.relforcerowsecurity) $$,
  'RLS aktif dan dipaksa di semua tabel app/audit');
select ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname in ('app', 'audit') and c.relkind = 'r' and c.relforcerowsecurity) >= 14,
          'tabel S4 dan S5 ikut terperiksa (>= 14 tabel ber-RLS)');

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
  where n.nspname = 'api' and p.prosecdef and p.proowner <> 'dompetku_api'::regrole $$,
  'semua fungsi api.* DEFINER milik dompetku_api');
select set_eq($$
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.prosecdef $$,
  array['bootstrap_owner', 'create_invitation', 'revoke_invitation', 'resend_invitation',
        'invitation_peek', 'decline_invitation', 'accept_invitation', 'list_invitations',
        'create_account', 'create_entry', 'create_transfer', 'update_entry', 'void_entry',
        'restore_entry', 'purge_entry', 'reconcile_balance', 'archive_account',
        'create_category', 'update_category', 'archive_category', 'mark_no_spend_day',
        'create_reimbursement', 'move_entry_to_space', 'create_bill', 'update_bill', 'archive_bill',
        'post_bill_occurrence', 'skip_bill_occurrence', 'unskip_bill_occurrence', 'set_budget',
        'delete_budget', 'copy_budgets', 'wa_create_link_code', 'wa_confirm_link',
        'wa_resolve_sender', 'wa_unlink'],
  'daftar fungsi api DEFINER (tulis S4 + S5 + S6 + S7 + S9 tagihan + anggaran, invitation_peek, list_invitations, WA)');
-- Fungsi baca api.* INVOKER (RLS tetap berlaku), milik owner, EXECUTE untuk web.
select set_eq($$
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and not p.prosecdef and p.provolatile = 's' $$,
  array['period_summary', 'month_summary', 'safe_to_spend', 'net_worth', 'activity_feed',
        'trash_list', 'suggest_categories', 'open_reimbursables', 'shared_activity',
        'member_contributions', 'pay_period', 'bill_list', 'bills_due', 'budget_progress',
        'budget_overview', 'spend_pace', 'category_summary', 'period_trend', 'excluded_summary',
        'wa_default_account', 'wa_last_cancellable'],
  'daftar fungsi baca api INVOKER (S5, S6, S7, S8, S9 termasuk Laporan, WA)');
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and not p.prosecdef and p.proowner <> 'dompetku_owner'::regrole $$,
  'fungsi baca api INVOKER milik dompetku_owner (own_api_functions hanya memindah DEFINER)');
-- Pengecualian tertutup (0123): dedupe pesan WA menulis app.wa_messages di bawah policy `own`
-- web (pola app.product_events), bukan lewat DEFINER.
select set_eq($$
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and not p.prosecdef and p.provolatile <> 's' $$,
  array['wa_claim_message', 'wa_finish_message', 'export_entries'],
  'fungsi api INVOKER hanya baca (STABLE), kecuali tulis pesan WA dan ekspor (audit event export)');
select set_eq($$
  select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and p.proowner = 'dompetku_owner'::regrole
    and n.nspname in ('app', 'api', 'private', 'jobs', 'audit', 'auth') $$,
  array['app.my_space_ids', 'app.space_roster', 'audit.log',
        'jobs.purge_audit', 'jobs.purge_unfinished_users', 'jobs.purge_voided',
        'jobs.purge_idempotency',
        'private.provision_user', 'private.tg_space_member_guard', 'private.tg_user_admission',
        'private.purge_entries', 'private.assert_entry_shape', 'private.assert_space_transfer_pair',
        'private.tg_entry_shape', 'private.tg_category_depth', 'private.tg_obligation_xor',
        'private.materialize_bill', 'jobs.materialize_bills', 'private.wa_audit',
        'private.tg_budget_tree', 'private.tg_budget_cascade'],
  'DEFINER milik dompetku_owner = daftar tertutup S4 + S5 + S9 (trigger kewajiban, materialisasi tagihan) + audit WA + trigger pohon anggaran S10');
-- S6: kategori awal ruang = DEFINER milik dompetku_api (NOBYPASSRLS, tunduk member_write).
select set_eq($$
  select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and p.proowner = 'dompetku_api'::regrole
    and n.nspname in ('app', 'private', 'jobs', 'audit', 'auth') $$,
  array['private.seed_categories', 'private.tg_seed_categories'],
  'DEFINER milik dompetku_api di luar api = daftar tertutup S6 (kategori awal)');
select set_eq($$
  select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proowner = 'dompetku_auditor'::regrole $$,
  array['private.dq_run', 'jobs.dq_reconcile'], 'fungsi milik dompetku_auditor = dq_run, dq_reconcile');
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
    ('dompetku_auditor', 'app.product_events', 'SELECT'),
    -- S5 ledger: web baca saja; api tulis lewat fungsi (DELETE hanya entry_lines).
    ('dompetku_web', 'app.accounts', 'SELECT'),
    ('dompetku_web', 'app.categories', 'SELECT'),
    ('dompetku_web', 'app.entries', 'SELECT'),
    ('dompetku_web', 'app.entry_lines', 'SELECT'),
    ('dompetku_web', 'app.entry_history', 'SELECT'),
    ('dompetku_web', 'app.entry_tombstones', 'SELECT'),
    ('dompetku_web', 'app.account_balances', 'SELECT'),
    ('dompetku_web', 'app.report_lines', 'SELECT'),
    ('dompetku_api', 'app.accounts', 'SELECT'),
    ('dompetku_api', 'app.accounts', 'INSERT'),
    ('dompetku_api', 'app.accounts', 'UPDATE'),
    ('dompetku_api', 'app.categories', 'SELECT'),
    ('dompetku_api', 'app.categories', 'INSERT'),
    ('dompetku_api', 'app.categories', 'UPDATE'),
    ('dompetku_api', 'app.entries', 'SELECT'),
    ('dompetku_api', 'app.entries', 'INSERT'),
    ('dompetku_api', 'app.entries', 'UPDATE'),
    ('dompetku_api', 'app.entry_lines', 'SELECT'),
    ('dompetku_api', 'app.entry_lines', 'INSERT'),
    ('dompetku_api', 'app.entry_lines', 'DELETE'),
    ('dompetku_api', 'app.entry_history', 'SELECT'),
    ('dompetku_api', 'app.entry_history', 'INSERT'),
    ('dompetku_api', 'app.entry_tombstones', 'SELECT'),
    ('dompetku_api', 'app.account_balances', 'SELECT'),
    ('dompetku_api', 'app.report_lines', 'SELECT'),
    ('dompetku_auditor', 'app.accounts', 'SELECT'),
    ('dompetku_auditor', 'app.categories', 'SELECT'),
    ('dompetku_auditor', 'app.entries', 'SELECT'),
    ('dompetku_auditor', 'app.entry_lines', 'SELECT'),
    ('dompetku_auditor', 'app.entry_history', 'SELECT'),
    ('dompetku_auditor', 'app.entry_tombstones', 'SELECT'),
    ('dompetku_auditor', 'app.account_balances', 'SELECT'),
    ('dompetku_auditor', 'app.report_lines', 'SELECT'),
    -- S6: hari tanpa pengeluaran (pola ruang; api tulis lewat mark_no_spend_day).
    ('dompetku_web', 'app.no_spend_days', 'SELECT'),
    ('dompetku_api', 'app.no_spend_days', 'SELECT'),
    ('dompetku_api', 'app.no_spend_days', 'INSERT'),
    ('dompetku_api', 'app.no_spend_days', 'DELETE'),
    ('dompetku_auditor', 'app.no_spend_days', 'SELECT'),
    -- S9: tabel libur global (tanpa space_id; data publik SKB, bukan data pengguna); hanya dibaca.
    ('dompetku_web', 'app.holidays', 'SELECT'),
    ('dompetku_api', 'app.holidays', 'SELECT'),
    ('dompetku_worker', 'app.holidays', 'SELECT'),
    ('dompetku_auditor', 'app.holidays', 'SELECT'),
    -- S9: tagihan, kemunculan, anggaran (BSD §11: web baca; api tulis lewat fungsi, DELETE budgets
    -- dan (0118, api.update_bill) bill_occurrences; worker hanya lewat jobs.*), view bill_schedule
    -- (security_invoker).
    ('dompetku_web', 'app.bills', 'SELECT'),
    ('dompetku_web', 'app.bill_occurrences', 'SELECT'),
    ('dompetku_web', 'app.budgets', 'SELECT'),
    ('dompetku_web', 'app.bill_schedule', 'SELECT'),
    ('dompetku_api', 'app.bills', 'SELECT'),
    ('dompetku_api', 'app.bills', 'INSERT'),
    ('dompetku_api', 'app.bills', 'UPDATE'),
    ('dompetku_api', 'app.bill_occurrences', 'SELECT'),
    ('dompetku_api', 'app.bill_occurrences', 'INSERT'),
    ('dompetku_api', 'app.bill_occurrences', 'UPDATE'),
    ('dompetku_api', 'app.bill_occurrences', 'DELETE'),
    ('dompetku_api', 'app.budgets', 'SELECT'),
    ('dompetku_api', 'app.budgets', 'INSERT'),
    ('dompetku_api', 'app.budgets', 'UPDATE'),
    ('dompetku_api', 'app.budgets', 'DELETE'),
    ('dompetku_api', 'app.bill_schedule', 'SELECT'),
    ('dompetku_auditor', 'app.bills', 'SELECT'),
    ('dompetku_auditor', 'app.bill_occurrences', 'SELECT'),
    ('dompetku_auditor', 'app.budgets', 'SELECT'),
    ('dompetku_auditor', 'app.bill_schedule', 'SELECT'),
    -- WA (0123): web baca nomor sendiri, tulis pesan sendiri (policy own); api tulis tautan/kode.
    ('dompetku_web', 'app.wa_links', 'SELECT'),
    ('dompetku_web', 'app.wa_messages', 'SELECT'),
    ('dompetku_web', 'app.wa_messages', 'INSERT'),
    ('dompetku_web', 'app.wa_messages', 'UPDATE'),
    ('dompetku_api', 'app.wa_links', 'SELECT'),
    ('dompetku_api', 'app.wa_links', 'INSERT'),
    ('dompetku_api', 'app.wa_links', 'UPDATE'),
    ('dompetku_api', 'app.wa_links', 'DELETE'),
    ('dompetku_api', 'app.wa_link_codes', 'SELECT'),
    ('dompetku_api', 'app.wa_link_codes', 'INSERT'),
    ('dompetku_api', 'app.wa_link_codes', 'UPDATE'),
    ('dompetku_api', 'app.wa_link_codes', 'DELETE'),
    ('dompetku_worker', 'jobs.job_runs', 'SELECT'),
    ('dompetku_worker', 'jobs.job_runs', 'INSERT'),
    ('dompetku_worker', 'jobs.job_runs', 'UPDATE') $$,
  'matriks hak tabel web/api/worker/auditor');

-- BSD §12: role audit objek pgaudit punya S/I/U/D di semua tabel app/audit/auth, juga tabel baru.
select is_empty($$
  select n.nspname || '.' || c.relname || ' ' || p.priv
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p (priv)
  where n.nspname in ('app', 'audit', 'auth') and c.relkind in ('r', 'p')
    and not has_table_privilege('dompetku_auditlog', c.oid, p.priv) $$,
  'dompetku_auditlog punya hak audit objek di semua tabel');
select set_eq($$
  select n.nspname::text from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace,
         aclexplode(d.defaclacl) a
  where d.defaclrole = 'dompetku_owner'::regrole and d.defaclobjtype = 'r'
    and a.grantee = 'dompetku_auditlog'::regrole and a.privilege_type = 'DELETE' $$,
  array['app', 'audit', 'auth'], 'default privileges auditlog untuk tabel baru di app, audit, auth');

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
                      unnest(array['app.my_space_ids', 'app.space_roster', 'app.assert_member',
                                   'app.report_class', 'app.category_keywords']) f
     union all
     select r, f from unnest(array['dompetku_web', 'dompetku_api']) r,
                      unnest(array['app.effective_payday', 'app.pay_period',
                                   'app.period_of_label']) f
     union all
     select r, 'api.' || f from unnest(array['dompetku_web', 'dompetku_api']) r,
                      unnest(array['bootstrap_owner', 'create_invitation', 'revoke_invitation',
                                   'resend_invitation', 'invitation_peek', 'decline_invitation',
                                   'accept_invitation', 'list_invitations', 'create_account',
                                   'create_entry',
                                   'create_transfer', 'update_entry', 'void_entry',
                                   'restore_entry', 'purge_entry', 'reconcile_balance',
                                   'archive_account', 'create_category', 'update_category',
                                   'archive_category', 'mark_no_spend_day',
                                   'create_reimbursement', 'move_entry_to_space', 'create_bill',
                                   'update_bill', 'archive_bill', 'post_bill_occurrence',
                                   'skip_bill_occurrence', 'unskip_bill_occurrence', 'set_budget',
                                   'delete_budget', 'copy_budgets', 'wa_create_link_code',
                                   'wa_confirm_link', 'wa_resolve_sender', 'wa_unlink']) f
     union all
     select 'dompetku_web', 'api.' || f from unnest(array['period_summary', 'month_summary',
                      'safe_to_spend', 'net_worth', 'activity_feed', 'trash_list',
                      'suggest_categories', 'open_reimbursables', 'shared_activity',
                      'member_contributions', 'pay_period', 'bill_list', 'bills_due',
                      'budget_progress', 'budget_overview', 'spend_pace', 'category_summary',
                      'period_trend', 'excluded_summary', 'wa_default_account',
                      'wa_last_cancellable', 'wa_claim_message', 'wa_finish_message',
                      'export_entries']) f
     union all
     select 'dompetku_api', 'private.' || f from unnest(array['require_read_committed',
                      'require_user', 'provision_user', 'req_hash', 'idem_begin', 'idem_finish',
                      'lock_accounts', 'get_account', 'balance', 'assert_balance',
                      'entry_snapshot', 'write_history', 'check_date', 'check_amount',
                      'clean_text', 'set_void_state', 'purge_entries', 'seed_categories',
                      'tg_seed_categories', 'materialize_bill', 'check_bill', 'lock_occurrence',
                      'occurrence_posted', 'wa_audit']) f
     union all
     select 'dompetku_auditor', f from unnest(array['private.dq_run', 'jobs.dq_reconcile']) f
     union all
     -- S9 (0119): DQ13 satu kewajiban di dq_run memakai fungsi periode (INVOKER).
     select 'dompetku_auditor', f from unnest(array['private.bill_due_in_label', 'private.bill_first_on',
                      'app.period_of_label', 'app.effective_payday', 'app.pay_period']) f
     union all
     select 'dompetku_worker', 'jobs.' || f from unnest(array['purge_unfinished_users',
                      'purge_audit', 'purge_voided', 'purge_idempotency', 'dq_reconcile',
                      'materialize_bills']) f
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

-- Skema pgboss (S7, 0112): milik owner, hanya worker yang punya USAGE + CREATE (tabel pg-boss
-- milik worker); tidak ada role aplikasi dengan CREATE/TEMPORARY di database.
select is((select nspowner::regrole::text from pg_namespace where nspname = 'pgboss'), 'dompetku_owner',
  'skema pgboss milik dompetku_owner');
select set_eq($$
  select r.rolname::text, p.priv from pg_roles r
  cross join (values ('USAGE'), ('CREATE')) p (priv)
  where r.rolname like 'dompetku\_%' and r.rolname not in ('dompetku_owner', 'dompetku_test')
    and has_schema_privilege(r.oid, 'pgboss', p.priv) $$,
  $$ values ('dompetku_worker', 'USAGE'), ('dompetku_worker', 'CREATE') $$,
  'hak skema pgboss hanya untuk worker');
select is_empty($$
  select r.rolname || ' ' || p.priv from pg_roles r
  cross join (values ('CREATE'), ('TEMPORARY')) p (priv)
  where r.rolname like 'dompetku\_%' and r.rolname not in ('dompetku_owner', 'dompetku_test')
    and has_database_privilege(r.oid, current_database(), p.priv) $$,
  'role aplikasi tanpa CREATE/TEMPORARY di database');

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

-- Indeks unik nama (S7, 0109): nama dompet aktif unik per ruang tanpa beda huruf besar/spasi;
-- server memetakan 23505 dari indeks ini ke name_taken, jadi nama dan bentuknya dikunci di sini.
select is((select indexdef from pg_indexes where schemaname = 'app' and indexname = 'accounts_name_unique'),
  'CREATE UNIQUE INDEX accounts_name_unique ON app.accounts USING btree (space_id, lower(btrim(name))) WHERE (archived_at IS NULL)',
  'indeks unik nama dompet aktif per ruang');

-- #8 Penanda lingkungan.
select is(tests.owner_val(null, $$select value from app.settings where key = 'env'$$), 'prod', 'app.settings env = prod');

-- Trigger penjaga terpasang.
select has_trigger('auth', 'user', 'user_admission', 'trigger pendaftaran di auth.user');
select has_trigger('app', 'space_members', 'space_member_guard', 'penjaga anggota ruang Pribadi');
select ok((select count(*) = 2 from pg_trigger g join pg_class c on c.oid = g.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'audit' and c.relname = 'events' and g.tgname in ('audit_events_append_only', 'audit_events_no_truncate')),
          'audit.events append-only (UPDATE/DELETE/TRUNCATE)');
select ok((select count(*) = 2 from pg_trigger g join pg_class c on c.oid = g.tgrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'app' and c.relname = 'entry_history'
             and g.tgname in ('entry_history_append_only', 'entry_history_no_truncate')),
          'entry_history append-only (UPDATE/DELETE/TRUNCATE)');
-- Cek bentuk lines dan pasangan berjalan sebagai constraint trigger DEFERRABLE INITIALLY DEFERRED.
select set_eq($$
  select c.relname || '.' || g.tgname from pg_trigger g join pg_class c on c.oid = g.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'app' and g.tgconstraint <> 0 and g.tgdeferrable and g.tginitdeferred $$,
  array['entries.entries_shape', 'entry_lines.entry_lines_shape'],
  'cek bentuk entri = constraint trigger deferred');
select has_trigger('app', 'categories', 'category_depth', 'penjaga kedalaman kategori');
-- S9: satu kewajiban (tagihan ATAU anggaran wajib) dijaga trigger di kedua tabel.
select set_eq($$
  select c.relname || '.' || g.tgname || '.' || fn.nspname || '.' || f.proname from pg_trigger g
  join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
  join pg_proc f on f.oid = g.tgfoid join pg_namespace fn on fn.oid = f.pronamespace
  where n.nspname = 'app' and fn.nspname = 'private' and f.proname = 'tg_obligation_xor' $$,
  array['bills.bills_obligation_xor.private.tg_obligation_xor',
        'budgets.budgets_obligation_xor.private.tg_obligation_xor'],
  'trigger satu kewajiban di bills dan budgets');
select has_trigger('app', 'space_members', 'seed_categories', 'kategori awal saat anggota masuk ruang');

-- #9 app.report_class tidak NULL untuk setiap kombinasi enum (termasuk yang ditolak cek bentuk).
select is(tests.owner_val(null, $$
  select count(*) filter (where app.report_class(k, r, p, s, d, x) is null) || '/' || count(*)
  from unnest(enum_range(null::app.entry_kind)) k, unnest(enum_range(null::app.line_role)) r,
       unnest(enum_range(null::app.pocket)) p, unnest(enum_range(null::app.space_kind)) s,
       (select unnest(enum_range(null::app.entry_direction)) union all select null) dd (d),
       unnest(array[true, false]) x $$),
  '0/756', 'report_class tidak NULL untuk semua kombinasi (7 x 3 x 3 x 2 x 3 x 2)');

-- Review S4 (butir parkir): event sistem = event yang ditulis langsung ke audit.events oleh fungsi
-- DEFINER/owner (atau lewat private.purge_entries), ditambah deploy dan db_manual_access dari skrip
-- host. Semuanya wajib ada di daftar reserved audit.log agar web/worker tidak bisa memalsukannya.
-- Event baru di fungsi sistem tanpa memperbarui audit.log gagal di sini.
create temp table audit_ev on commit drop as
with allowed as (
  select (regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g'))[1] as ev
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid join pg_namespace tn on tn.oid = t.relnamespace
  where tn.nspname = 'audit' and t.relname = 'events' and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ~ '\(event = ANY'
), reserved as (
  select (regexp_matches(substring(p.prosrc from 'p_event in \(([^)]*)\)'), '''([a-z_]+)''', 'g'))[1] as ev
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'audit' and p.proname = 'log'
), sys as (
  select (regexp_matches(p.prosrc, '''([a-z_]+)''', 'g'))[1] as ev
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('app', 'api', 'private', 'jobs', 'audit')
    and not (n.nspname = 'audit' and p.proname = 'log')
    and (p.prosrc ~* 'insert\s+into\s+audit\.events' or p.prosrc ~ 'private\.purge_entries\(')
  union select unnest(array['deploy', 'db_manual_access'])
)
select 'allowed' as k, ev from allowed
union all select 'reserved', ev from reserved
union all select 'system', ev from sys where ev in (select ev from allowed);
select set_eq($$ select ev from audit_ev where k = 'system' $$,
  array['space_member_change', 'unfinished_user_purged', 'entry_purged', 'purge_voided',
        'deploy', 'db_manual_access', 'wa_linked', 'wa_unlinked'],
  'event sistem terdeteksi dari fungsi DEFINER/owner + skrip host');
select is_empty($$
  select ev from audit_ev where k = 'system'
  except select ev from audit_ev where k = 'reserved' $$,
  'setiap event sistem ada di daftar reserved audit.log');
select is_empty($$
  select ev from audit_ev where k = 'reserved'
  except select ev from audit_ev where k = 'allowed' $$,
  'daftar reserved audit.log bagian dari CHECK audit.events');

select * from finish();
rollback;
