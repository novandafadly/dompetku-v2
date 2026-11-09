import 'server-only';
import type { LedgerErrorCode } from '@/features/ledger/types';
import { domainError } from '../db';

/**
 * Pemetaan galat `api.*` (BSD §9.2) ke kode UI (`LedgerErrorCode`).
 * `null` = bukan galat domain/jaringan: pemanggil melempar ulang (error boundary).
 * Log tidak pernah memuat argumen SQL, `detail`, nominal, atau deskripsi: hanya SQLSTATE dan
 * pesan bila pesannya kode mesin (`[a-z_]`).
 */
export interface LedgerError {
  code: LedgerErrorCode;
  field?: string;
}

/** DK422 yang punya layar/teks sendiri di UI; DK422 lain = `unknown`. */
const RULES = new Set<LedgerErrorCode>([
  'saldo_negatif',
  'before_opening',
  'account_archived',
  'category_archived',
  'category_depth',
  'restore_window_closed',
  // S7: dompet, transfer antar ruang, talangan, pindah ruang (salinan bingkai S7 Task 1).
  'balance_not_zero',
  'cross_space_not_allowed',
  'cross_space_kantor',
  'not_reimbursable',
  'reimbursement_exceeds',
  'reimbursement_exists',
  'entry_moved',
  'kind_not_movable',
  'not_creator',
  // S9: anggaran dan tagihan (bingkai S9 "Salinan galat S9"; pesan DB tanpa nominal).
  'obligation_double',
  'category_in_obligation',
  'category_not_root',
  'already_posted',
  'bill_archived',
  'bill_account_kantor',
]);

/**
 * Indeks unik nama aktif: kategori (0100) dan dompet (0109). Nama indeks = kontrak; 23505 dari
 * indeks lain tetap `unknown`.
 */
const NAME_INDEXES = new Set(['categories_name_unique', 'accounts_name_unique']);

const MACHINE_CODE = /^[a-z_]{1,64}$/;

/** Kode errno Node untuk koneksi yang gagal/putus. */
const NETWORK_ERRNO = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/**
 * Pesan pg/pg-pool tanpa `code`: pool habis (`connectionTimeoutMillis`) dan koneksi terputus.
 * Dicocokkan di awal pesan saja agar teks bebas lain tidak ikut.
 */
const NETWORK_MESSAGE =
  /^(timeout exceeded when trying to connect|Connection terminated(?: unexpectedly| due to connection timeout)?$|Client has encountered a connection error)/;

function isNetwork(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const { code, message } = e as { code?: unknown; message?: unknown };
  if (typeof code === 'string') {
    if (NETWORK_ERRNO.has(code)) return true;
    // SQLSTATE kelas 08 (connection exception) dan 57P01..57P03 (server dimatikan/belum siap).
    if (/^08[0-9A-Z]{3}$/.test(code) || /^57P0[1-3]$/.test(code)) return true;
  }
  return typeof message === 'string' && NETWORK_MESSAGE.test(message);
}

function logUnmapped(code: string, message: string): void {
  const safe = MACHINE_CODE.test(message) ? message : '(pesan disembunyikan)';
  console.error(`[ledger] galat domain tak terpetakan: ${code} ${safe}`);
}

export function toLedgerError(e: unknown): LedgerError | null {
  const d = domainError(e);
  if (d) {
    switch (d.code) {
      case 'DK409':
        return { code: 'conflict' };
      case 'DK410':
        return { code: 'idem_mismatch' };
      case 'DK401':
        // Sesi DB kosong di tengah aksi: ke UI tetap `not_found` (disamarkan), tetapi dicatat
        // karena `withUser` selalu mengisi pengguna, jadi DK401 berarti anomali, bukan kebiasaan.
        console.error('[ledger] sesi DB kosong di tengah aksi: DK401');
        return { code: 'not_found' };
      case 'DK404':
        return { code: 'not_found' };
      case 'DK400': {
        const detail = (e as { detail?: unknown }).detail;
        return typeof detail === 'string' && MACHINE_CODE.test(detail)
          ? { code: 'invalid', field: detail }
          : { code: 'invalid' };
      }
      case '23505': {
        const constraint = (e as { constraint?: unknown }).constraint;
        if (typeof constraint === 'string' && NAME_INDEXES.has(constraint)) {
          return { code: 'name_taken' };
        }
        break;
      }
      case 'DK422':
        // Talangan di luar pengeluaran Pribadi: galat input kolom `reimbursable`, sama dengan
        // penolakan saveCatat sebelum DB (UI tidak menawarkan toggle itu di sana).
        if (d.message === 'reimbursable_personal_expense_only') {
          return { code: 'invalid', field: 'reimbursable' };
        }
        if (RULES.has(d.message as LedgerErrorCode)) return { code: d.message as LedgerErrorCode };
        break;
    }
    // DK500, DK422 lain, 23505, DKnnn baru: bug atau invarian, bukan keadaan UI.
    logUnmapped(d.code, d.message);
    return { code: 'unknown' };
  }
  if (isNetwork(e)) return { code: 'network' };
  return null;
}

/**
 * Keanggotaan ruang hilang atau sesi DB kosong di tengah request (`DK401` dari `require_user`,
 * `DK404 space_not_found` dari `app.assert_member`). Loader page mengubahnya menjadi 404
 * (`notFound()`), bukan layar gagal muat (`*Failed`).
 */
export function isSpaceNotFoundError(e: unknown): boolean {
  const d = domainError(e);
  if (d === null) return false;
  return d.code === 'DK401' || (d.code === 'DK404' && d.message === 'space_not_found');
}
