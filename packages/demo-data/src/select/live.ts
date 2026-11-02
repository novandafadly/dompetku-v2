import type { Entry } from '../types';

/** Entri belum dibatalkan. */
export function isLive(e: Entry): boolean {
  return e.voidedAt === undefined;
}
