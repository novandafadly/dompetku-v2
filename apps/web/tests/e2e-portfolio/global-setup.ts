import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  PORTFOLIO_MAIL_FILE,
  PORTFOLIO_OWNER_STATE,
  PORTFOLIO_PARTNER_STATE,
} from '../../playwright.portfolio.config';
import { resetData } from '../e2e-auth/helpers';

export const PORTFOLIO_OWNER = 'raka@demo.dompetku.invalid';
export const PORTFOLIO_PARTNER = 'nadia@demo.dompetku.invalid';

/** Siapkan DB uji bersih dengan akun demo fiktif Raka & Nadia. */
export default async function globalSetup(): Promise<void> {
  const url = process.env.AUTH_E2E_ADMIN_URL;
  if (!url) throw new Error('AUTH_E2E_ADMIN_URL wajib diisi untuk e2e:portfolio');
  await mkdir(path.dirname(PORTFOLIO_MAIL_FILE), { recursive: true });
  await rm(PORTFOLIO_MAIL_FILE, { force: true });
  await rm(PORTFOLIO_OWNER_STATE, { force: true });
  await rm(PORTFOLIO_PARTNER_STATE, { force: true });
  await resetData(url, PORTFOLIO_OWNER);
}
