import { access } from 'node:fs/promises';
import { test as base, expect } from '@playwright/test';
import { LEDGER_MAIL_FILE, LEDGER_OWNER_STATE } from '../../playwright.ledger.config';
import { adminQuery, registerOwner } from '../e2e-auth/helpers';
import { OWNER } from './global-setup';

export const test = base.extend<object, { ownerState: string }>({
  ownerState: [
    async ({ browser }, provide, workerInfo) => {
      const exists = await access(LEDGER_OWNER_STATE).then(
        () => true,
        () => false,
      );
      const baseURL = workerInfo.project.use.baseURL ?? '';
      if (!exists)
        await registerOwner(browser, baseURL, OWNER, LEDGER_MAIL_FILE, LEDGER_OWNER_STATE);
      await provide(LEDGER_OWNER_STATE);
    },
    { scope: 'worker' },
  ],
  // Semua konteks bawaan tes memakai sesi pemilik.
  storageState: ({ ownerState }, provide) => provide(ownerState),
});

export { adminQuery, expect, OWNER };
