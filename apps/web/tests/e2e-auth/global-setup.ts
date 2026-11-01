import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { MAIL_FILE } from '../../playwright.auth.config';

export const OWNER = 'novanda@example.test';

/** Kosongkan data (superuser) dan pasang owner_email seperti runbook. */
export default async function globalSetup(): Promise<void> {
  const url = process.env.AUTH_E2E_ADMIN_URL;
  if (!url) throw new Error('AUTH_E2E_ADMIN_URL wajib diisi untuk e2e auth');
  await mkdir(path.dirname(MAIL_FILE), { recursive: true });
  await rm(MAIL_FILE, { force: true });
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`
    begin;
    select set_config('dompetku.purge', 'on', true);
    delete from app.product_events;
    delete from app.idempotency_keys;
    delete from app.invitations;
    delete from app.entry_lines;
    delete from app.entry_history;
    delete from app.entries;
    delete from app.entry_tombstones;
    delete from app.accounts;
    delete from app.categories;
    delete from app.no_spend_days;
    delete from app.space_members;
    delete from app.profiles;
    delete from app.spaces;
    delete from app.households;
    delete from audit.events;
    delete from auth."user";
    delete from auth.login_throttle;
    delete from auth.verification;
    insert into app.settings (key, value) values ('owner_email', '${OWNER}')
      on conflict (key) do update set value = excluded.value;
    commit;`);
  await admin.end();
}
