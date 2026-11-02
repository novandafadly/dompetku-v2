'use client';

import type { IsoDate, Rupiah } from '@dompetku/domain';
import { useRef, useState } from 'react';
import type {
  AccountVM,
  ActionResult,
  CategoryVM,
  EntryVM,
  HistoryVM,
  LedgerErrorCode,
} from '@/features/ledger/types';
import { newClientId } from './client-id';
import type { FieldCode, GalatKind } from './use-catat';

/**
 * Sheet Ubah (S6-D1/D2): ganti-penuh dengan `expectedVersion` = versi yang sedang diubah.
 * Mode nyata memakai `updateEntryAction`/`reloadEntry` lewat sumber ini (app/[ruang]/_real); tes dan
 * galeri memakai sumber palsu. Sheet hanya mengenal antarmuka ini.
 */
export interface EditInput {
  clientId: string;
  entryId: string;
  expectedVersion: number;
  accountId: string;
  amount: Rupiah;
  categoryId: string | null;
  occurredOn: IsoDate | null;
  description: string | null;
  reimbursable: boolean;
  allowNegative: boolean;
}

export interface EditSource {
  update(input: EditInput): Promise<ActionResult<{ entryId: string; version: number }>>;
  /** Nilai terbaru untuk layar konflik (`reloadEntry`). */
  reload(entryId: string): Promise<ActionResult<{ entry: EntryVM; history: HistoryVM[] }>>;
}

export interface EditDraft {
  amount: Rupiah | null;
  categoryId?: string;
  accountId: string;
  date: IsoDate;
  description: string;
}

export type EditStatus = 'idle' | 'menyimpan' | 'galat' | 'saldo_kurang' | 'field' | 'konflik';

/** `voided`: entri sudah dibatalkan di tab/perangkat lain sejak sheet dibuka. */
export type EditGalat = GalatKind | 'voided';

export interface Conflict {
  latest: EntryVM;
  /** Nama pengubah terakhir; `Kamu` bila pengguna sendiri (tab lain). */
  by: string;
  at: string;
  /** Nominal versi yang dibuka pengguna (`Rp lama`). */
  before: Rupiah;
}

const FIELD_CODES = new Set<LedgerErrorCode>([
  'before_opening',
  'account_archived',
  'category_archived',
]);

export function draftOf(e: EntryVM): EditDraft {
  const d: EditDraft = {
    amount: e.amount,
    accountId: e.accountId,
    date: e.occurredOn,
    description: e.description ?? '',
  };
  if (e.categoryId !== undefined) d.categoryId = e.categoryId;
  return d;
}

/** Saldo awal: hanya nominal yang bisa diubah (server mengabaikan kolom lain). */
export const amountOnly = (e: EntryVM) => e.kind === 'opening_balance';

/** Keterangan kosong (atau spasi saja) = `null`, sesuai ganti-penuh. */
const descriptionOf = (d: EditDraft): string | null =>
  d.description.trim() === '' ? null : d.description;

/** Isian ganti-penuh: setiap field dikirim, yang tidak diubah dengan nilai sekarang. */
export function editInput(
  base: EntryVM,
  d: EditDraft,
  clientId: string,
  allowNegative: boolean,
): EditInput {
  const only = amountOnly(base);
  return {
    clientId,
    entryId: base.id,
    expectedVersion: base.version,
    accountId: only ? base.accountId : d.accountId,
    amount: d.amount ?? 0,
    categoryId: only ? null : (d.categoryId ?? null),
    occurredOn: only ? base.occurredOn : d.date,
    description: only ? null : descriptionOf(d),
    reimbursable: base.reimbursable === true,
    allowNegative,
  };
}

function changed(base: EntryVM, d: EditDraft): boolean {
  if (d.amount !== base.amount) return true;
  if (amountOnly(base)) return false;
  return (
    d.accountId !== base.accountId ||
    d.categoryId !== base.categoryId ||
    d.date !== base.occurredOn ||
    descriptionOf(d) !== (base.description ?? null)
  );
}

/** Perubahan saldo sebuah dompet bila draf disimpan (baris lama dilepas, baris baru dipasang). */
function balanceAfter(base: EntryVM, d: EditDraft, account: AccountVM): Rupiah {
  const signed = (amount: Rupiah) => (base.kind === 'expense' ? -amount : amount);
  let after = account.balance;
  if (account.id === base.accountId) after -= signed(base.amount);
  if (account.id === (amountOnly(base) ? base.accountId : d.accountId))
    after += signed(d.amount ?? 0);
  return after;
}

export type SaveResult = { ok: true; version: number } | { ok: false } | null;

export function useEditEntry({
  entry,
  accounts,
  categories,
  me,
  source,
}: {
  entry: EntryVM;
  accounts: AccountVM[];
  categories: CategoryVM[];
  /** Id pengguna sekarang (konflik dari tab sendiri = `Kamu`). */
  me: string;
  source: EditSource;
}) {
  const [base, setBase] = useState(entry);
  const [draft, setDraft] = useState<EditDraft>(() => draftOf(entry));
  // Satu sesi ubah = satu clientId; "Coba lagi" dan "Tetap simpan" memakainya lagi.
  const [clientId, setClientId] = useState(newClientId);
  const [status, setStatus] = useState<EditStatus>('idle');
  const [galat, setGalat] = useState<EditGalat | null>(null);
  const [fieldCode, setFieldCode] = useState<FieldCode | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [hiddenAccounts, setHiddenAccounts] = useState<ReadonlySet<string>>(() => new Set());
  const [archivedCategory, setArchivedCategory] = useState<CategoryVM | null>(null);
  // Ref: klik ganda dalam satu tick tetap satu permintaan.
  const busy = useRef(false);
  const allowNegative = useRef(false);

  const type = base.kind === 'income' ? 'income' : 'expense';
  // Kategori entri selalu ada walau sudah diarsipkan (boleh dipertahankan, tidak boleh dipilih baru).
  const own: CategoryVM | undefined =
    base.categoryId === undefined
      ? undefined
      : (categories.find((c) => c.id === base.categoryId) ?? {
          id: base.categoryId,
          parentId: null,
          name: base.categoryName ?? 'Tanpa kategori',
          type,
          icon: base.categoryIcon ?? 'Tag',
          archived: true,
        });
  const allCategories = categories
    .filter((c) => c.type === type && !c.archived && c.id !== archivedCategory?.id)
    .sort((a, b) => a.name.localeCompare(b.name, 'id'));
  const pool = [...(own === undefined ? [] : [own]), ...allCategories];
  // Chip tetap selama sheet terbuka: kategori entri di chip pertama, lalu kategori aktif lainnya.
  const [chipIds] = useState(() =>
    [
      ...(own === undefined ? [] : [own.id]),
      ...categories
        .filter((c) => c.type === type && !c.archived && c.id !== own?.id)
        .map((c) => c.id),
    ].slice(0, 6),
  );
  const chips = chipIds
    .map((id) => pool.find((c) => c.id === id))
    .filter((c): c is CategoryVM => c !== undefined && c.id !== archivedCategory?.id);

  const ownAccount = accounts.find((a) => a.id === base.accountId);
  const accountOptions = accounts.filter(
    (a) => (!a.archived && !hiddenAccounts.has(a.id)) || a.id === draft.accountId,
  );
  const selectedAccount =
    accounts.find((a) => a.id === draft.accountId) ??
    (draft.accountId === base.accountId ? ownAccount : undefined);

  const saving = status === 'menyimpan';
  const hasAmount = draft.amount !== null && draft.amount > 0;
  const valid = hasAmount && (amountOnly(base) || draft.categoryId !== undefined);
  const canSave = valid && !saving && galat !== 'not_found' && galat !== 'voided';

  const toIdle = () => {
    setStatus('idle');
    setGalat(null);
    setFieldCode(null);
  };

  const update = (patch: Partial<EditDraft>, clears?: FieldCode | 'saldo') => {
    if (busy.current) return;
    setDraft((d) => ({ ...d, ...patch }));
    if (
      (clears === 'saldo' && status === 'saldo_kurang') ||
      (clears !== undefined && clears !== 'saldo' && status === 'field' && fieldCode === clears)
    ) {
      toIdle();
    }
  };

  /** Nilai terbaru sesudah `conflict`/`idem_mismatch`: tidak pernah menimpa diam-diam. */
  const loadConflict = async (from: EntryVM): Promise<void> => {
    let res: Awaited<ReturnType<EditSource['reload']>>;
    try {
      res = await source.reload(from.id);
    } catch {
      res = { ok: false, error: { code: 'network' } };
    }
    if (!res.ok) {
      setStatus('galat');
      setGalat(
        res.error.code === 'network'
          ? 'network'
          : res.error.code === 'not_found'
            ? 'not_found'
            : 'server',
      );
      return;
    }
    const { entry: latest, history } = res.value;
    if (latest.voidedAt !== undefined) {
      setStatus('galat');
      setGalat('voided');
      return;
    }
    const last = history.at(-1);
    setConflict({
      latest,
      by: last === undefined || last.changedBy === me ? 'Kamu' : last.by.name,
      at: last?.at ?? latest.createdAt,
      before: from.amount,
    });
    setStatus('konflik');
  };

  const send = async (args: {
    clientId: string;
    base: EntryVM;
    negative: boolean;
  }): Promise<SaveResult> => {
    if (busy.current || !valid || galat === 'not_found' || galat === 'voided') return null;
    busy.current = true;
    allowNegative.current = args.negative;
    setStatus('menyimpan');
    setGalat(null);
    setFieldCode(null);
    let res: Awaited<ReturnType<EditSource['update']>>;
    try {
      res = await source.update(editInput(args.base, draft, args.clientId, args.negative));
    } catch {
      res = { ok: false, error: { code: 'network' } };
    }
    try {
      if (res.ok) {
        setStatus('idle');
        return { ok: true, version: res.value.version };
      }
      const code = res.error.code;
      if (code === 'conflict' || code === 'idem_mismatch') {
        // idem_mismatch di Ubah = kiriman pertama clientId ini sudah tersimpan (versi sudah naik).
        await loadConflict(args.base);
      } else if (code === 'saldo_negatif') {
        setStatus('saldo_kurang');
      } else if (FIELD_CODES.has(code)) {
        setStatus('field');
        setFieldCode(code as FieldCode);
        if (code === 'account_archived') {
          setHiddenAccounts((h) => new Set([...h, draft.accountId]));
        }
        if (code === 'category_archived') {
          setArchivedCategory(pool.find((c) => c.id === draft.categoryId) ?? null);
          setDraft((d) => {
            const next = { ...d };
            delete next.categoryId;
            return next;
          });
        }
      } else {
        setStatus('galat');
        setGalat(code === 'network' ? 'network' : code === 'not_found' ? 'not_found' : 'server');
      }
      return { ok: false };
    } finally {
      busy.current = false;
    }
  };

  /** Simpan perubahan; tanpa perubahan = selesai tanpa ke server (versi tidak naik sia-sia). */
  const save = (): Promise<SaveResult> => {
    if (busy.current || !valid) return Promise.resolve(null);
    if (!changed(base, draft)) return Promise.resolve({ ok: true, version: base.version });
    return send({ clientId, base, negative: false });
  };
  /** "Coba lagi": clientId dan versi yang sama. */
  const retry = () => send({ clientId, base, negative: allowNegative.current });
  /** "Tetap simpan" (S6-C3): clientId sama, `allowNegative`. */
  const saveAnyway = () => send({ clientId, base, negative: true });

  /**
   * "Timpa dengan perubahan saya": isian pengguna dengan versi terbaru. Isinya berbeda dari kiriman
   * pertama, jadi clientId baru (sesi ubah baru di atas versi terbaru).
   */
  const overwrite = (): Promise<SaveResult> => {
    if (conflict === null || busy.current) return Promise.resolve(null);
    const id = newClientId();
    const latest = conflict.latest;
    setBase(latest);
    setClientId(id);
    setConflict(null);
    return send({ clientId: id, base: latest, negative: false });
  };

  /** "Muat ulang": isian diganti nilai terbaru (isian pengguna hilang), sesi ubah baru. */
  const reload = () => {
    if (conflict === null || busy.current) return;
    setBase(conflict.latest);
    setDraft(draftOf(conflict.latest));
    setClientId(newClientId());
    setConflict(null);
    setHiddenAccounts(new Set());
    setArchivedCategory(null);
    toIdle();
  };

  const saldo =
    status === 'saldo_kurang' && selectedAccount !== undefined
      ? { account: selectedAccount, after: balanceAfter(base, draft, selectedAccount) }
      : null;

  return {
    base,
    draft,
    status,
    galat,
    fieldCode,
    conflict,
    chips,
    allCategories,
    archivedCategory,
    accountOptions,
    selectedAccount,
    saldo,
    canSave,
    saving,
    setAmount: (amount: Rupiah | null) => {
      update({ amount }, 'saldo');
    },
    setCategory: (categoryId: string) => {
      update({ categoryId }, 'category_archived');
    },
    setAccount: (accountId: string) => {
      update({ accountId }, 'account_archived');
      if (status === 'saldo_kurang') toIdle();
    },
    setDate: (date: IsoDate) => {
      update({ date }, 'before_opening');
    },
    setDescription: (description: string) => {
      update({ description });
    },
    save,
    retry,
    saveAnyway,
    overwrite,
    reload,
  };
}
