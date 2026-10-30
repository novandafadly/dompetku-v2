'use client';

import { suggestCategories } from '@dompetku/demo-data';
import type { Account, Category, DemoState, DemoStore, Entry, Ruang } from '@dompetku/demo-data';
import { nowTimeWIB, type IsoDate, type Rupiah } from '@dompetku/domain';
import { useState } from 'react';

export type CatatType = 'expense' | 'income' | 'transfer';

export interface CatatDraft {
  type: CatatType;
  amount: Rupiah | null;
  categoryId?: string;
  accountId: string;
  /** Hanya transfer: dompet tujuan di ruang yang sama. */
  counterAccountId?: string;
  date: IsoDate;
  description?: string;
  ruang: Ruang;
  /** Kunci idempoten: tetap sama saat simpan gagal lalu diulang. */
  clientId: string;
}

export interface UseCatatArgs {
  state: DemoState;
  store: DemoStore;
  today: IsoDate;
  ruang: Ruang;
  /** Jam WIB untuk saran kategori; bawaan jam sekarang. */
  hourWIB?: number;
}

const SAVE_ERROR =
  'Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan mencatat dua kali.';

/** getRandomValues tersedia juga di konteks non-HTTPS (mis. HP di jaringan lokal). */
function newClientId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function accountsOf(state: DemoState, ruang: Ruang): Account[] {
  return state.accounts.filter((a) => a.ruang === ruang);
}

/** Dompet operasional dengan entri hidup terbaru; lalu operasional pertama; lalu dompet pertama. */
function defaultAccountId(state: DemoState, ruang: Ruang): string {
  const accounts = accountsOf(state, ruang);
  const operasional = accounts.filter((a) => a.pocket === 'operasional');
  const ids = new Set(operasional.map((a) => a.id));
  let latest: Entry | undefined;
  for (const e of state.entries) {
    if (e.voidedAt !== undefined || !ids.has(e.accountId)) continue;
    if (latest === undefined || e.createdAt > latest.createdAt) latest = e;
  }
  return latest?.accountId ?? operasional[0]?.id ?? accounts[0]?.id ?? '';
}

function clear(
  d: CatatDraft,
  fields: { category?: boolean; counter?: boolean; description?: boolean },
): CatatDraft {
  const next = { ...d };
  if (fields.category === true) delete next.categoryId;
  if (fields.counter === true) delete next.counterAccountId;
  if (fields.description === true) delete next.description;
  return next;
}

function chipsFor(state: DemoState, ruang: Ruang, type: CatatType, hourWIB: number): Category[] {
  if (type === 'transfer') return [];
  return suggestCategories(state, ruang, { hourWIB, type });
}

export function useCatat({ state, store, today, ruang, hourWIB }: UseCatatArgs) {
  const [hour] = useState(() => hourWIB ?? Number(nowTimeWIB().slice(0, 2)));
  const [draft, setDraft] = useState<CatatDraft>(() => ({
    type: 'expense',
    amount: null,
    accountId: defaultAccountId(state, ruang),
    date: today,
    ruang,
    clientId: newClientId(),
  }));
  // Posisi chip tidak berubah selama sheet terbuka; dihitung ulang hanya saat ruang/jenis berganti.
  const [chips, setChips] = useState(() => chipsFor(state, ruang, 'expense', hour));
  const [error, setError] = useState<string | null>(null);

  const accounts = accountsOf(state, draft.ruang);
  const destinations = accounts.filter((a) => a.id !== draft.accountId);
  const allCategories = state.categories
    .filter((c) => c.ruang === draft.ruang && draft.type !== 'transfer' && c.type === draft.type)
    .sort((a, b) => a.name.localeCompare(b.name, 'id'));

  const hasAmount = draft.amount !== null && draft.amount > 0;
  const canSave =
    hasAmount &&
    draft.accountId !== '' &&
    (draft.type === 'transfer'
      ? draft.counterAccountId !== undefined
      : draft.categoryId !== undefined);

  const update = (patch: (d: CatatDraft) => CatatDraft) => {
    setDraft(patch);
  };

  const setAmount = (amount: Rupiah | null) => {
    update((d) => ({ ...d, amount }));
  };
  const setCategory = (categoryId: string) => {
    update((d) => ({ ...d, categoryId }));
  };
  const setAccount = (accountId: string) => {
    update((d) => clear({ ...d, accountId }, { counter: d.counterAccountId === accountId }));
  };
  const setCounterAccount = (counterAccountId: string) => {
    update((d) => ({ ...d, counterAccountId }));
  };
  const setDate = (date: IsoDate) => {
    update((d) => ({ ...d, date }));
  };
  const setDescription = (description: string) => {
    update((d) => (description === '' ? clear(d, { description: true }) : { ...d, description }));
  };
  const setType = (type: CatatType) => {
    update((d) => clear({ ...d, type }, { category: true, counter: true }));
    setChips(chipsFor(state, draft.ruang, type, hour));
  };
  /** Dompet dan kategori milik ruang lama tidak sah di ruang baru; nominal tetap. */
  const switchRuang = (next: Ruang) => {
    update((d) =>
      clear(
        { ...d, ruang: next, accountId: defaultAccountId(state, next) },
        { category: true, counter: true },
      ),
    );
    setChips(chipsFor(state, next, draft.type, hour));
  };
  const save = (): Entry | null => {
    if (!canSave || draft.amount === null) return null;
    const base = {
      ruang: draft.ruang,
      kind: draft.type,
      occurredOn: draft.date,
      createdBy: state.members[0]?.id ?? '',
      accountId: draft.accountId,
      amount: draft.amount,
      clientId: draft.clientId,
      ...(draft.description === undefined ? {} : { description: draft.description }),
    };
    const input =
      draft.type === 'transfer'
        ? { ...base, counterAccountId: draft.counterAccountId ?? '' }
        : { ...base, categoryId: draft.categoryId ?? '' };
    try {
      const entry = store.addEntry(input);
      setError(null);
      update((d) => ({ ...d, clientId: newClientId() }));
      return entry;
    } catch {
      // Demo store sinkron; kegagalan di sini mewakili koneksi putus. Isian tetap utuh.
      setError(SAVE_ERROR);
      return null;
    }
  };

  return {
    draft,
    chips,
    allCategories,
    accounts,
    destinations,
    canSave,
    error,
    setAmount,
    setCategory,
    setAccount,
    setCounterAccount,
    setDate,
    setDescription,
    setType,
    switchRuang,
    save,
  };
}
