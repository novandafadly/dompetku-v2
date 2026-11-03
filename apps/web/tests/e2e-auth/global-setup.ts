import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { MAIL_FILE } from '../../playwright.auth.config';
import { resetData } from './helpers';

export const OWNER = 'novanda@example.test';

/** Kosongkan data (superuser) dan pasang owner_email seperti runbook. */
export default async function globalSetup(): Promise<void> {
  const url = process.env.AUTH_E2E_ADMIN_URL;
  if (!url) throw new Error('AUTH_E2E_ADMIN_URL wajib diisi untuk e2e auth');
  await mkdir(path.dirname(MAIL_FILE), { recursive: true });
  await rm(MAIL_FILE, { force: true });
  await resetData(url, OWNER);
}
