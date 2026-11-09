import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSpaceNotFoundError, toLedgerError } from './errors';
import { SpaceNotFoundError } from './space';

/** Bentuk galat `pg` (DatabaseError): code = SQLSTATE, message, detail opsional. */
function pgError(code: string, message: string, detail?: string): Error {
  return Object.assign(new Error(message), { code, detail });
}

describe('toLedgerError: galat domain api.* (BSD §9.2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['saldo_negatif'],
    ['before_opening'],
    ['account_archived'],
    ['category_archived'],
    ['restore_window_closed'],
  ] as const)('DK422 %s = kode sama', (rule) => {
    expect(toLedgerError({ code: 'DK422', message: rule })).toEqual({ code: rule });
  });

  it('DK409 = conflict, DK410 = idem_mismatch, DK404 = not_found', () => {
    expect(toLedgerError(pgError('DK409', 'version_conflict'))).toEqual({ code: 'conflict' });
    expect(toLedgerError(pgError('DK410', 'idempotency_mismatch'))).toEqual({
      code: 'idem_mismatch',
    });
    expect(toLedgerError(pgError('DK404', 'entry_not_found'))).toEqual({ code: 'not_found' });
  });

  it('DK400 membawa field dari detail', () => {
    expect(
      toLedgerError({ code: 'DK400', message: 'invalid_argument', detail: 'occurred_on' }),
    ).toEqual({ code: 'invalid', field: 'occurred_on' });
    expect(toLedgerError(pgError('DK400', 'invalid_argument'))).toEqual({ code: 'invalid' });
  });

  it('DK400 dengan detail bukan nama field: field dibuang', () => {
    expect(toLedgerError(pgError('DK400', 'invalid_argument', 'Rp 50.000 makan siang'))).toEqual({
      code: 'invalid',
    });
  });

  it('DK500, DK422 lain, dan 23505 = unknown, dilog tanpa detail', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'Rp 12.345.678 deskripsi rahasia';
    expect(toLedgerError(pgError('DK500', 'invariant_broken', secret))).toEqual({
      code: 'unknown',
    });
    expect(toLedgerError(pgError('DK422', 'space_mismatch', secret))).toEqual({ code: 'unknown' });
    expect(toLedgerError(pgError('23505', 'duplicate key value', `Key (x)=(${secret})`))).toEqual({
      code: 'unknown',
    });
    expect(log).toHaveBeenCalledTimes(3);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('DK500');
    expect(logged).toContain('space_mismatch');
    expect(logged).not.toContain('Rp');
    expect(logged).not.toContain('rahasia');
  });

  it('category_depth (DK422) = category_depth; nama kategori ganda (indeks unik) = name_taken', () => {
    expect(toLedgerError(pgError('DK422', 'category_depth'))).toEqual({ code: 'category_depth' });
    const dup = Object.assign(pgError('23505', 'duplicate key value'), {
      constraint: 'categories_name_unique',
    });
    expect(toLedgerError(dup)).toEqual({ code: 'name_taken' });
  });

  it.each([
    ['balance_not_zero'],
    ['cross_space_not_allowed'],
    ['cross_space_kantor'],
    ['not_reimbursable'],
    ['reimbursement_exceeds'],
    ['reimbursement_exists'],
    ['entry_moved'],
    ['kind_not_movable'],
    ['not_creator'],
  ] as const)('DK422 S7 %s = kode sama, tanpa log', (rule) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(toLedgerError(pgError('DK422', rule, 'Rp 500.000 rahasia'))).toEqual({ code: rule });
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    ['obligation_double'],
    ['category_in_obligation'],
    ['category_not_root'],
    ['already_posted'],
    ['bill_archived'],
    ['bill_account_kantor'],
    ['category_archived'],
  ] as const)('DK422 S9 %s = kode sama, tanpa log', (rule) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(toLedgerError(pgError('DK422', rule, 'Rp 485.000 rahasia'))).toEqual({ code: rule });
    expect(log).not.toHaveBeenCalled();
  });

  it('S9: bill_not_found = not_found; copy_budgets DK400 membawa from_month/to_month', () => {
    expect(toLedgerError(pgError('DK404', 'bill_not_found'))).toEqual({ code: 'not_found' });
    expect(toLedgerError(pgError('DK404', 'category_not_found', 'category_id'))).toEqual({
      code: 'not_found',
    });
    for (const field of ['from_month', 'to_month', 'month', 'day_of_month', 'ends_on']) {
      expect(toLedgerError(pgError('DK400', 'invalid_argument', field))).toEqual({
        code: 'invalid',
        field,
      });
    }
  });

  it('DK401 = not_found dengan log SQLSTATE saja; isSpaceNotFoundError membedakan space_not_found dari DK404 item', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(toLedgerError(pgError('DK401', 'unauthenticated'))).toEqual({ code: 'not_found' });
    expect(log).toHaveBeenCalledWith('[ledger] sesi DB kosong di tengah aksi: DK401');
    log.mockClear();
    expect(toLedgerError(pgError('DK404', 'space_not_found'))).toEqual({ code: 'not_found' });
    expect(log).not.toHaveBeenCalled();
    expect(isSpaceNotFoundError(pgError('DK401', 'unauthenticated'))).toBe(true);
    expect(isSpaceNotFoundError(pgError('DK404', 'space_not_found'))).toBe(true);
    expect(isSpaceNotFoundError(pgError('DK404', 'entry_not_found'))).toBe(false);
    expect(isSpaceNotFoundError(pgError('DK404', 'bill_not_found'))).toBe(false);
    expect(isSpaceNotFoundError(new Error('lain'))).toBe(false);
  });

  it('nama dompet ganda (accounts_name_unique) = name_taken', () => {
    const dup = Object.assign(pgError('23505', 'duplicate key value', 'Key (x)=(BCA rahasia)'), {
      constraint: 'accounts_name_unique',
    });
    expect(toLedgerError(dup)).toEqual({ code: 'name_taken' });
  });

  it('23505 dari indeks lain tetap unknown', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const other = Object.assign(pgError('23505', 'duplicate key value'), {
      constraint: 'entries_pkey',
    });
    expect(toLedgerError(other)).toEqual({ code: 'unknown' });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('pesan domain yang bukan kode mesin tidak ikut dilog', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(toLedgerError(pgError('DK500', 'saldo 50000 untuk makan siang'))).toEqual({
      code: 'unknown',
    });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('DK500');
    expect(logged).not.toContain('50000');
    expect(logged).not.toContain('makan');
  });

  it('SpaceNotFoundError (resolveSpace) = not_found', () => {
    expect(toLedgerError(new SpaceNotFoundError())).toEqual({ code: 'not_found' });
  });
});

describe('toLedgerError: jaringan', () => {
  it.each(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'])('%s = network', (code) => {
    expect(toLedgerError(Object.assign(new Error(`connect ${code}`), { code }))).toEqual({
      code: 'network',
    });
  });

  it('pool habis / koneksi putus (pesan pg-pool) = network', () => {
    expect(toLedgerError(new Error('timeout exceeded when trying to connect'))).toEqual({
      code: 'network',
    });
    expect(toLedgerError(new Error('Connection terminated unexpectedly'))).toEqual({
      code: 'network',
    });
    expect(toLedgerError(new Error('Connection terminated due to connection timeout'))).toEqual({
      code: 'network',
    });
  });

  it('SQLSTATE kelas 08 dan server dimatikan (57P01..57P03) = network', () => {
    expect(toLedgerError(pgError('08006', 'connection failure'))).toEqual({ code: 'network' });
    expect(toLedgerError(pgError('57P01', 'terminating connection'))).toEqual({ code: 'network' });
  });
});

describe('toLedgerError: bukan galat domain = null (pemanggil melempar ulang)', () => {
  it.each([
    ['TypeError', new TypeError('x is undefined')],
    ['izin ditolak 42501', pgError('42501', 'permission denied for table entries')],
    ['serialisasi habis 40001', pgError('40001', 'could not serialize access')],
    ['string', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['objek tanpa code', { message: 'x' }],
  ])('%s', (_name, e) => {
    expect(toLedgerError(e)).toBeNull();
  });

  it('DK422 reimbursable_personal_expense_only = invalid kolom reimbursable, tanpa log', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(
      toLedgerError(pgError('DK422', 'reimbursable_personal_expense_only', 'Rp 1 rahasia')),
    ).toEqual({
      code: 'invalid',
      field: 'reimbursable',
    });
    expect(err).not.toHaveBeenCalled();
  });
});
