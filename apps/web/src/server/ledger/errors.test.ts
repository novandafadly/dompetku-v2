import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSpaceNotFoundError, toLedgerError } from './errors';
import { SpaceNotFoundError } from './space';
import { DebtPersonalOnlyError } from './utang';

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

  it('S13: DK409 goal_exists berbeda dari conflict; aturan DK422 tujuan = kode sama', () => {
    expect(toLedgerError(pgError('DK409', 'goal_exists'))).toEqual({ code: 'goal_exists' });
    for (const rule of [
      'goal_target_past',
      'goal_not_active',
      'goal_not_reached',
      'account_has_goal',
      'goal_pocket_invalid',
    ] as const) {
      expect(toLedgerError({ code: 'DK422', message: rule })).toEqual({ code: rule });
    }
    expect(toLedgerError(pgError('DK404', 'goal_not_found'))).toEqual({ code: 'not_found' });
  });

  it('S14: aturan DK422 aset/saham = kode sama; asset_kind_invalid (DK400) = invalid di kolom asset_kind', () => {
    for (const rule of [
      'asset_negative',
      'asset_account_invalid',
      'stock_account_trade_only',
      'before_latest_entry',
      'account_has_holdings',
      'insufficient_shares',
      'trade_not_latest',
      'price_spike_unconfirmed',
    ] as const) {
      expect(toLedgerError({ code: 'DK422', message: rule })).toEqual({ code: rule });
    }
    expect(
      toLedgerError({ code: 'DK400', message: 'asset_kind_invalid', detail: 'asset_kind' }),
    ).toEqual({ code: 'invalid', field: 'asset_kind' });
    // Saham (0143): kode DK400 jatuh ke kolom (`ticker`, `close`); DK404 seragam = not_found.
    expect(toLedgerError({ code: 'DK400', message: 'ticker_invalid', detail: 'ticker' })).toEqual({
      code: 'invalid',
      field: 'ticker',
    });
    expect(toLedgerError({ code: 'DK400', message: 'price_invalid', detail: 'close' })).toEqual({
      code: 'invalid',
      field: 'close',
    });
    for (const m of ['holding_not_found', 'trade_not_found']) {
      expect(toLedgerError({ code: 'DK404', message: m })).toEqual({ code: 'not_found' });
    }
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
    ['parent_budget_required'],
    ['sub_exceeds_parent'],
    ['sub_not_wajib'],
    ['export_too_large'],
  ] as const)('DK422 S10 %s = kode sama, tanpa log', (rule) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(toLedgerError(pgError('DK422', rule, 'Rp 485.000 rahasia'))).toEqual({ code: rule });
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

  it.each([
    ['debt_personal_only'],
    ['contact_name_taken'],
    ['contact_archived'],
    ['debt_deleted'],
    ['payment_exceeds'],
    ['payment_before_opened'],
    ['debt_account_kantor'],
    ['debt_principal_locked'],
  ] as const)('DK422 S11 %s = kode sama, tanpa log, tanpa nominal', (rule) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = toLedgerError(pgError('DK422', rule, 'Rp 1.500.000 Budi rahasia'));
    expect(r).toEqual({ code: rule });
    expect(JSON.stringify(r)).not.toMatch(/\d|Budi|Rp/);
    expect(log).not.toHaveBeenCalled();
  });

  it('S12: DK422 pocket_personal_only (Trading di Bersama) = kode sama, tanpa log', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(toLedgerError(pgError('DK422', 'pocket_personal_only', 'Rp 1.000.000'))).toEqual({
      code: 'pocket_personal_only',
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('S12: kode patungan DK422 = kode sama tanpa log, DK404 split/settlement_not_found = not_found', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const code of [
      'split_shared_only',
      'split_needs_partner',
      'split_account_invalid',
      'split_locked',
      'split_unsettled',
      'split_member_left',
      'settlement_received',
      'settlement_voided',
      'settlement_not_received',
    ]) {
      const r = toLedgerError(pgError('DK422', code, 'Rp 200.000 Farida'));
      expect(r).toEqual({ code });
      expect(JSON.stringify(r)).not.toMatch(/\d|Farida|Rp/);
    }
    expect(toLedgerError(pgError('DK404', 'split_not_found'))).toEqual({ code: 'not_found' });
    expect(toLedgerError(pgError('DK404', 'settlement_not_found'))).toEqual({ code: 'not_found' });
    expect(toLedgerError(pgError('DK400', 'invalid_argument', 'shares'))).toEqual({
      code: 'invalid',
      field: 'shares',
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('S11: debt_not_found/contact_not_found = not_found; already_voided/not_voided = conflict', () => {
    expect(toLedgerError(pgError('DK404', 'debt_not_found'))).toEqual({ code: 'not_found' });
    expect(toLedgerError(pgError('DK404', 'contact_not_found'))).toEqual({ code: 'not_found' });
    expect(toLedgerError(pgError('DK422', 'already_voided'))).toEqual({ code: 'conflict' });
    expect(toLedgerError(pgError('DK422', 'not_voided'))).toEqual({ code: 'conflict' });
    for (const field of ['direction', 'mode', 'contact', 'title', 'name', 'principal']) {
      expect(toLedgerError(pgError('DK400', 'invalid_argument', field))).toEqual({
        code: 'invalid',
        field,
      });
    }
  });

  it('S15: aturan trip DK422 = kode sama; trip_not_found = not_found; entry_voided = conflict; kolom tanggal/nama = invalid', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const rule of ['trip_archived', 'trip_entry_invalid', 'trip_limit', 'split_locked'] as const) {
      expect(toLedgerError({ code: 'DK422', message: rule })).toEqual({ code: rule });
    }
    expect(toLedgerError(pgError('DK404', 'trip_not_found'))).toEqual({ code: 'not_found' });
    expect(toLedgerError(pgError('DK422', 'entry_voided'))).toEqual({ code: 'conflict' });
    for (const field of ['name', 'starts_on', 'ends_on', 'budget_amount', 'entry_ids']) {
      expect(toLedgerError(pgError('DK400', 'invalid_argument', field))).toEqual({
        code: 'invalid',
        field,
      });
    }
    // Pesan galat dan log tidak pernah memuat nama trip (detail konstrain 23505 disembunyikan).
    expect(log).not.toHaveBeenCalled();
  });

  it('S15: nama trip aktif ganda (trips_name_unique) = name_taken, log tidak memuat nama', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dup = Object.assign(
      pgError('23505', 'duplicate key value violates unique constraint', 'Key (lower(btrim(name)))=(bali rahasia)'),
      { constraint: 'trips_name_unique' },
    );
    expect(toLedgerError(dup)).toEqual({ code: 'name_taken' });
    expect(log).not.toHaveBeenCalled();
  });

  it('S15: deadlock 40P01 bukan galat domain (null): withLedger yang mengulang, bukan pemetaan', () => {
    expect(toLedgerError(pgError('40P01', 'deadlock detected'))).toBeNull();
  });

  it('S11: DebtPersonalOnlyError (action, sebelum DB) = debt_personal_only', () => {
    expect(toLedgerError(new DebtPersonalOnlyError())).toEqual({ code: 'debt_personal_only' });
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
