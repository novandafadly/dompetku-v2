import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  BERSAMA_MAIL_FILE,
  BERSAMA_OWNER_STATE,
  BERSAMA_PARTNER_STATE,
} from '../../playwright.bersama.config';
import { resetData } from '../e2e-auth/helpers';

export const OWNER = 'novanda@example.test';
export const PARTNER = 'farida@example.test';

/** Data kosong + owner_email; sesi N dan F run sebelumnya dibuang (reset DB sendiri, suite ini). */
export default async function globalSetup(): Promise<void> {
  const url = process.env.AUTH_E2E_ADMIN_URL;
  if (!url) throw new Error('AUTH_E2E_ADMIN_URL wajib diisi untuk e2e bersama');
  await mkdir(path.dirname(BERSAMA_MAIL_FILE), { recursive: true });
  await rm(BERSAMA_MAIL_FILE, { force: true });
  await rm(BERSAMA_OWNER_STATE, { force: true });
  await rm(BERSAMA_PARTNER_STATE, { force: true });
  await resetData(url, OWNER);
}
