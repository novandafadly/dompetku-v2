import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { LEDGER_MAIL_FILE, LEDGER_OWNER_STATE } from '../../playwright.ledger.config';
import { resetData } from '../e2e-auth/helpers';

export const OWNER = 'novanda@example.test';

/** Data kosong (seperti e2e:auth) + owner_email; sesi pemilik run sebelumnya dibuang. */
export default async function globalSetup(): Promise<void> {
  const url = process.env.AUTH_E2E_ADMIN_URL;
  if (!url) throw new Error('AUTH_E2E_ADMIN_URL wajib diisi untuk e2e ledger');
  await mkdir(path.dirname(LEDGER_MAIL_FILE), { recursive: true });
  await rm(LEDGER_MAIL_FILE, { force: true });
  await rm(LEDGER_OWNER_STATE, { force: true });
  await resetData(url, OWNER);
}
