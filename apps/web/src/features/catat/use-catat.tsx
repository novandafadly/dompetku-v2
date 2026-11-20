'use client';

import { nowTimeWIB, type IsoDate, type Rupiah } from '@dompetku/domain';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AccountVM, CategoryVM, LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { newClientId } from './client-id';
import {
  isPromise,
  type CatatDraft,
  type CatatOptions,
  type CatatPreset,
  type CatatSource,
  type CatatStatus,
  type CatatType,
  type SaveOutcome,
} from './source';

export type { CatatDraft, CatatStatus, CatatType } from './source';

export interface UseCatatArgs {
  source: CatatSource;
  today: IsoDate;
  ruang: Ruang;
  /** Jam WIB untuk saran kategori; bawaan jam sekarang. */
  hourWIB?: number;
  /** Nominal yang sudah diketik sebelum sheet selesai dimuat. */
  initialAmount?: Rupiah | null | undefined;
  /** Setor/tarik modal trading: transfer dengan arah dan dompet trading terkunci (S12-TR4). */
  preset?: CatatPreset | undefined;
}

/** Galat yang terikat ke satu kolom (S6-C5): kode → nama kolom server. */
const FIELD_OF: Partial<Record<LedgerErrorCode, 'occurred_on' | 'account_id' | 'category_id'>> = {
  before_opening: 'occurred_on',
  account_archived: 'account_id',
  category_archived: 'category_id',
};

export type FieldCode = 'before_opening' | 'account_archived' | 'category_archived';

/**
 * Jenis galat simpan tanpa bingkai sendiri (keputusan controller, s6-bingkai.md "Tambahan
 * salinan"): `network` = S6-C2; `not_found` tanpa Coba lagi; lainnya = kendala server.
 */
export type GalatKind = 'network' | 'server' | 'not_found';
/** Galat Catat (S7): `GalatKind` ditambah dua galat transfer antar ruang (S7-C1) tanpa Coba lagi. */
export type CatatGalatKind =
  | GalatKind
  | 'cross_space_not_allowed'
  | 'cross_space_kantor'
  | 'split_needs_partner'
  // S14: aset tidak bisa minus (balapan dengan tab lain; sumber aset dijaga di klien juga).
  | 'asset_negative';

/** Dompet tujuan di ruang lain (S7-C1): dimuat saat halaman "Ruang lain…" dibuka. */
export interface CrossTargets {
  /** Ruang tujuan = kebalikan ruang sheet. */
  target: Ruang;
  status: 'idle' | 'loading' | 'ready' | 'error';
  accounts: AccountVM[];
}

/** Dompet Pribadi pembayar patungan (S12-CT1): dimuat malas saat toggle pertama kali menyala. */
export interface PersonalWallets {
  status: 'idle' | 'loading' | 'ready' | 'error';
  accounts: AccountVM[];
}

/** Dompet Pribadi yang boleh membayar patungan: aktif, operasional/tabungan (sama dengan DB). */
const payerOk = (a: AccountVM) =>
  !a.archived && (a.pocket === 'operasional' || a.pocket === 'tabungan');

const otherRuang = (r: Ruang): Ruang => (r === 'pribadi' ? 'bersama' : 'pribadi');

function usable(o: CatatOptions | null, hidden: ReadonlySet<string>): AccountVM[] {
  return (o?.accounts ?? []).filter((a) => !a.archived && !hidden.has(a.id));
}

/**
 * Dompet biasa: bukan Kantor, bukan Trading (pemilih setor/tarik modal, S12-TR4), dan bukan aset
 * (isi/cairkan aset memilih dompet biasa di sisi lawan, S14-AS5).
 */
const ordinary = (a: AccountVM) =>
  a.pocket !== 'kantor' && a.pocket !== 'trading' && a.pocket !== 'aset';

/** Dompet yang bisa jadi sumber/tujuan pencatatan biasa: bukan Trading dan bukan aset (S14). */
const spendable = (a: AccountVM) => a.pocket !== 'trading' && a.pocket !== 'aset';

/** Dompet saham hanya berubah lewat Beli/Jual saham (S14): tidak pernah di pemilih transfer. */
const isStock = (a: AccountVM) => a.pocket === 'aset' && a.assetKind === 'saham';

/** Preset yang mengunci dompet halaman sebagai TUJUAN (Setor modal, Isi aset). */
const intoPreset = (p: CatatPreset | undefined) => p?.kind === 'setor' || p?.kind === 'isi';

/**
 * `defaultAccountId` dari sumber; lalu operasional pertama; lalu dompet pertama. Dompet Trading
 * tidak pernah bawaan (bukan sumber pengeluaran/pemasukan); hanya Trading yang ada = kosong.
 */
function defaultAccountId(o: CatatOptions): string {
  const accounts = usable(o, new Set()).filter(spendable);
  if (o.defaultAccountId !== undefined && accounts.some((a) => a.id === o.defaultAccountId)) {
    return o.defaultAccountId;
  }
  return accounts.find((a) => a.pocket === 'operasional')?.id ?? accounts[0]?.id ?? '';
}

/** Dompet awal sheet setor/tarik: dompet biasa pertama (operasional lebih dulu) di sisi lawan. */
function presetDraft(
  o: CatatOptions,
  preset: CatatPreset,
): Pick<CatatDraft, 'accountId' | 'counterAccountId'> {
  const other = usable(o, new Set()).filter(ordinary);
  const pick = (other.find((a) => a.pocket === 'operasional') ?? other[0])?.id;
  if (intoPreset(preset)) {
    return { accountId: pick ?? '', counterAccountId: preset.account.id };
  }
  return {
    accountId: preset.account.id,
    ...(pick === undefined ? {} : { counterAccountId: pick }),
  };
}

function clear(
  d: CatatDraft,
  fields: {
    category?: boolean;
    /** Tujuan transfer, termasuk pilihan antar ruang dan catatan Bersama. */
    counter?: boolean;
    description?: boolean;
    reimbursable?: boolean;
    sharedNote?: boolean;
    /** Bagi tagihan (S12-CT1). */
    split?: boolean;
  },
): CatatDraft {
  const next = { ...d };
  if (fields.category === true) delete next.categoryId;
  if (fields.counter === true) {
    delete next.counterAccountId;
    delete next.toRuang;
    delete next.sharedNote;
  }
  if (fields.description === true) delete next.description;
  if (fields.reimbursable === true) delete next.reimbursable;
  if (fields.sharedNote === true) delete next.sharedNote;
  if (fields.split === true) delete next.split;
  return next;
}

/** Saldo cukup untuk draf ini (pemasukan tidak pernah mengurangi saldo). */
function enough(d: CatatDraft, account: AccountVM | undefined): boolean {
  if (d.type === 'income' || account === undefined || d.amount === null) return true;
  return d.amount <= account.balance;
}

/** Layout effect di klien; `useEffect` di server (tanpa peringatan SSR). */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useCatat({ source, today, ruang, hourWIB, initialAmount, preset }: UseCatatArgs) {
  const [hour] = useState(() => hourWIB ?? Number(nowTimeWIB().slice(0, 2)));
  // Opsi ruang awal dimuat di efek (bukan di initializer state): sumber nyata memicu Server Action,
  // dan initializer StrictMode berjalan dua kali. Sumber sinkron (prototipe) terisi di layout effect,
  // sebelum cat pertama, sehingga tidak ada kedipan keadaan memuat.
  const [opts, setOpts] = useState<CatatOptions | null>(null);
  const [draft, setDraft] = useState<CatatDraft>(() => ({
    type: preset === undefined ? 'expense' : 'transfer',
    amount: initialAmount ?? null,
    accountId: '',
    date: today,
    dateChosen: false,
    ruang,
    clientId: newClientId(),
  }));
  const [chips, setChips] = useState<CategoryVM[]>([]);
  const [status, setStatus] = useState<CatatStatus>('idle');
  const [fieldCode, setFieldCode] = useState<FieldCode | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [hiddenCategories, setHiddenCategories] = useState<ReadonlySet<string>>(() => new Set());
  const [archivedCategoryId, setArchivedCategoryId] = useState<string | null>(null);
  const [galatKind, setGalatKind] = useState<CatatGalatKind | null>(null);
  const [switchFailed, setSwitchFailed] = useState<Ruang | null>(null);
  // Dompet tujuan antar ruang: dimuat malas, dibuang saat ruang sumber berganti.
  const [cross, setCross] = useState<CrossTargets>(() => ({
    target: otherRuang(ruang),
    status: 'idle',
    accounts: [],
  }));
  const crossSeq = useRef(0);
  // Dompet Pribadi untuk toggle `Dibayar dari dompet pribadi` (S12-CT1), dimuat malas.
  const [personal, setPersonal] = useState<PersonalWallets>({ status: 'idle', accounts: [] });
  const personalSeq = useRef(0);

  // Ref, bukan state: klik ganda dalam satu tick (sebelum render ulang) tetap satu permintaan.
  const busy = useRef(false);
  const allowNegative = useRef(false);
  const optsSeq = useRef(0);
  const chipsSeq = useRef(0);
  // Jenis terbaru untuk jawaban opsi yang tiba terlambat (state di closure bisa basi).
  const typeRef = useRef<CatatType>(preset === undefined ? 'expense' : 'transfer');

  const requestChips = (r: Ruang, type: CatatType) => {
    const seq = ++chipsSeq.current;
    if (type === 'transfer') {
      setChips([]);
      return;
    }
    const got = source.chips(r, type, hour);
    if (!isPromise(got)) {
      setChips(got);
      return;
    }
    setChips([]);
    got.then(
      (c) => {
        if (seq === chipsSeq.current) setChips(c);
      },
      () => {
        if (seq === chipsSeq.current) setChips([]);
      },
    );
  };

  /** Opsi ruang tiba (Promise): dompet bawaan ruang itu, lalu chip. */
  const receive = (r: Ruang, o: CatatOptions) => {
    setOpts(o);
    setDraft((d) =>
      d.ruang === r
        ? {
            ...d,
            ...(preset === undefined ? { accountId: defaultAccountId(o) } : presetDraft(o, preset)),
          }
        : d,
    );
    requestChips(r, typeRef.current);
  };

  const started = useRef(false);
  useIsoLayoutEffect(() => {
    // Efek ganda StrictMode (pasang, lepas, pasang) tetap satu permintaan.
    if (started.current) return;
    started.current = true;
    const got = source.options(ruang);
    const seq = optsSeq.current;
    if (!isPromise(got)) {
      receive(ruang, got);
      return;
    }
    got.then(
      (o) => {
        if (seq === optsSeq.current) receive(ruang, o);
      },
      () => {
        if (seq === optsSeq.current) setOpts({ accounts: [], categories: [] });
      },
    );
    // Sekali per pemasangan hook (guard `started` menahan efek ganda StrictMode); sumber dan ruang
    // awal sengaja tidak jadi dependensi.
  }, []);

  const loading = opts === null;
  const saving = status === 'menyimpan';
  const accounts = usable(opts, hidden);
  const selectedAccount = opts?.accounts.find((a) => a.id === draft.accountId);
  // Bagi tagihan (S12-CT1): hanya pengeluaran Bersama dengan dua anggota (`options.split`).
  const splitAvailable =
    draft.ruang === 'bersama' &&
    draft.type === 'expense' &&
    opts?.split !== undefined &&
    preset === undefined;
  const personalAccounts = personal.accounts.filter((a) => !hidden.has(a.id));
  const splitAccount =
    draft.split === undefined
      ? undefined
      : personalAccounts.find((a) => a.id === draft.split?.accountId);
  // Dompet yang saldonya berkurang: dompet Pribadi pembayar bila dibagi, selain itu dompet terpilih.
  const payerAccount = draft.split === undefined ? selectedAccount : splitAccount;
  // Setor modal/Isi aset: tujuan hanya dompet halaman ini; Tarik modal/Cairkan: sumber hanya dompet itu.
  const lockedTo = intoPreset(preset) ? preset?.account.id : undefined;
  const destinations =
    preset === undefined
      ? accounts.filter((a) => a.id !== draft.accountId && !isStock(a))
      : accounts.filter((a) => (lockedTo === undefined ? ordinary(a) : a.id === lockedTo));
  // Dompet Kantor dan Trading tidak pernah ikut antar ruang (S7-C1; modal hanya satu ruang): bukan
  // sumber bila tujuan di ruang lain. Trading juga bukan sumber pengeluaran/pemasukan (S12-TR4).
  const isCross = draft.toRuang !== undefined;
  const sourceAccounts =
    preset !== undefined
      ? accounts.filter((a) => (intoPreset(preset) ? ordinary(a) : a.id === preset.account.id))
      : isCross
        ? accounts.filter(ordinary)
        : draft.type === 'transfer'
          ? accounts.filter((a) => !isStock(a))
          : accounts.filter(spendable);
  const crossBlocked = selectedAccount?.pocket === 'kantor';
  const crossAccount = isCross
    ? cross.accounts.find((a) => a.id === draft.counterAccountId)
    : undefined;
  const sharedNoteVisible = draft.type === 'transfer' && isCross;
  // Talangan (S7-C2): hanya pengeluaran Pribadi dari dompet bukan Kantor (Kantor sudah x_kantor).
  const canReimburse =
    draft.type === 'expense' && draft.ruang === 'pribadi' && selectedAccount?.pocket !== 'kantor';
  const allCategories = (opts?.categories ?? [])
    .filter(
      (c) =>
        !c.archived &&
        !hiddenCategories.has(c.id) &&
        draft.type !== 'transfer' &&
        c.type === draft.type,
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'id'));

  const hasAmount = draft.amount !== null && draft.amount > 0;
  const valid =
    !loading &&
    hasAmount &&
    (draft.split === undefined ? draft.accountId !== '' : draft.split.accountId !== '') &&
    (draft.type === 'transfer'
      ? draft.counterAccountId !== undefined
      : draft.categoryId !== undefined);
  // Aset tidak bisa minus (S14-AS5): sumber aset dengan nominal di atas nilainya = tidak bisa disimpan.
  const assetShort =
    draft.type === 'transfer' &&
    selectedAccount?.pocket === 'aset' &&
    draft.amount !== null &&
    draft.amount > selectedAccount.balance
      ? selectedAccount
      : undefined;
  const canSave = valid && !saving && galatKind !== 'not_found' && assetShort === undefined;

  const toIdle = () => {
    setStatus('idle');
    setFieldCode(null);
    setGalatKind(null);
  };

  /** Isian dikunci selama menyimpan (S6-C1). */
  const update = (patch: (d: CatatDraft) => CatatDraft) => {
    if (busy.current) return;
    setDraft(patch);
  };

  const setAmount = (amount: Rupiah | null) => {
    if (busy.current) return;
    // Bagian pasangan yang melebihi nominal baru dibuang (kembali sama rata), bukan dikirim tak sah.
    update((d) => ({
      ...d,
      amount,
      ...(d.split?.partnerShare !== undefined && (amount === null || d.split.partnerShare > amount)
        ? { split: { accountId: d.split.accountId } }
        : {}),
    }));
    if (status === 'saldo_kurang' && enough({ ...draft, amount }, payerAccount)) toIdle();
    if (galatKind === 'asset_negative') toIdle();
  };
  const setCategory = (categoryId: string) => {
    if (busy.current) return;
    update((d) => ({ ...d, categoryId }));
    if (status === 'field' && fieldCode === 'category_archived') toIdle();
  };
  const setAccount = (accountId: string) => {
    if (busy.current) return;
    const next = opts?.accounts.find((a) => a.id === accountId);
    update((d) =>
      clear(
        { ...d, accountId },
        {
          // Tujuan satu ruang yang sama dengan sumber baru gugur; Kantor memutus antar ruang.
          counter:
            (d.toRuang === undefined && d.counterAccountId === accountId) ||
            (d.toRuang !== undefined &&
              (next?.pocket === 'kantor' || next?.pocket === 'trading' || next?.pocket === 'aset')),
          reimbursable: next?.pocket === 'kantor',
        },
      ),
    );
    if (galatKind === 'cross_space_kantor') toIdle();
    if (status === 'field' && fieldCode === 'account_archived') toIdle();
    if (status === 'saldo_kurang' && draft.split === undefined && enough(draft, next)) toIdle();
  };
  const dropCrossError = () => {
    if (galatKind === 'cross_space_not_allowed' || galatKind === 'cross_space_kantor') toIdle();
  };
  /** Tujuan di ruang yang sama: melepas pilihan antar ruang (dan catatan Bersama). */
  const setCounterAccount = (counterAccountId: string) => {
    if (busy.current) return;
    update((d) => {
      const next = clear(d, { counter: true });
      return { ...next, counterAccountId };
    });
    dropCrossError();
  };
  /** Muat dompet tujuan di ruang lain (halaman "Ruang lain…"); aman dipanggil ulang setelah galat. */
  const loadCrossTargets = () => {
    const target = otherRuang(draft.ruang);
    if (cross.status === 'ready' && cross.target === target) return;
    const seq = ++crossSeq.current;
    let got: AccountVM[] | Promise<AccountVM[]>;
    try {
      got = source.spaceTransferTargets(target);
    } catch {
      setCross({ target, status: 'error', accounts: [] });
      return;
    }
    if (!isPromise(got)) {
      setCross({ target, status: 'ready', accounts: got });
      return;
    }
    setCross({ target, status: 'loading', accounts: [] });
    got.then(
      (accounts) => {
        if (seq === crossSeq.current) setCross({ target, status: 'ready', accounts });
      },
      () => {
        if (seq === crossSeq.current) setCross({ target, status: 'error', accounts: [] });
      },
    );
  };
  /** Pilih dompet tujuan di ruang lain: `toRuang` = ruang tujuan, catatan Bersama dipertahankan. */
  const setCrossTarget = (counterAccountId: string) => {
    if (busy.current) return;
    update((d) => ({ ...d, counterAccountId, toRuang: cross.target }));
    dropCrossError();
  };
  const setSharedNote = (sharedNote: string) => {
    update((d) => (sharedNote === '' ? clear(d, { sharedNote: true }) : { ...d, sharedNote }));
  };
  const setReimbursable = (on: boolean) => {
    if (busy.current) return;
    update((d) => {
      const allowed =
        d.type === 'expense' &&
        d.ruang === 'pribadi' &&
        opts?.accounts.find((a) => a.id === d.accountId)?.pocket !== 'kantor';
      return on && allowed ? { ...d, reimbursable: true } : clear(d, { reimbursable: true });
    });
  };
  /** Muat dompet Pribadi (sekali; ulang setelah galat) dan isi dompet bawaan toggle. */
  const loadPersonal = () => {
    if (personal.status === 'ready' || personal.status === 'loading') return;
    const seq = ++personalSeq.current;
    const arrived = (o: CatatOptions) => {
      const accounts = o.accounts.filter(payerOk);
      setPersonal({ status: 'ready', accounts });
      const pick = (accounts.find((a) => a.pocket === 'operasional') ?? accounts[0])?.id ?? '';
      setDraft((d) =>
        d.split?.accountId === '' ? { ...d, split: { ...d.split, accountId: pick } } : d,
      );
    };
    let got: CatatOptions | Promise<CatatOptions>;
    try {
      got = source.options('pribadi');
    } catch {
      setPersonal({ status: 'error', accounts: [] });
      return;
    }
    if (!isPromise(got)) {
      arrived(got);
      return;
    }
    setPersonal({ status: 'loading', accounts: [] });
    got.then(
      (o) => {
        if (seq === personalSeq.current) arrived(o);
      },
      () => {
        if (seq === personalSeq.current) setPersonal({ status: 'error', accounts: [] });
      },
    );
  };
  /** Sakelar `Dibayar dari dompet pribadi`: menyala = dompet Pribadi pembayar + bagian sama rata. */
  const setSplit = (on: boolean) => {
    if (busy.current || (on && !splitAvailable)) return;
    const pick =
      personal.status === 'ready'
        ? ((personalAccounts.find((a) => a.pocket === 'operasional') ?? personalAccounts[0])?.id ??
          '')
        : '';
    update((d) => (on ? { ...d, split: { accountId: pick } } : clear(d, { split: true })));
    if (status === 'saldo_kurang' || (status === 'galat' && galatKind === 'split_needs_partner')) {
      toIdle();
    }
    if (on) loadPersonal();
  };
  const setSplitAccount = (accountId: string) => {
    if (busy.current) return;
    update((d) => (d.split === undefined ? d : { ...d, split: { ...d.split, accountId } }));
    if (status === 'field' && fieldCode === 'account_archived') toIdle();
    if (
      status === 'saldo_kurang' &&
      enough(
        draft,
        personalAccounts.find((a) => a.id === accountId),
      )
    ) {
      toIdle();
    }
  };
  /** Bagian anggota lain (CT2); kosong = sama rata. */
  const setPartnerShare = (partnerShare: Rupiah | undefined) => {
    if (busy.current) return;
    update((d) =>
      d.split === undefined
        ? d
        : {
            ...d,
            split: {
              accountId: d.split.accountId,
              ...(partnerShare === undefined ? {} : { partnerShare }),
            },
          },
    );
  };
  const setDate = (date: IsoDate) => {
    if (busy.current) return;
    update((d) => ({ ...d, date, dateChosen: true }));
    if (status === 'field' && fieldCode === 'before_opening') toIdle();
  };
  const setDescription = (description: string) => {
    update((d) => (description === '' ? clear(d, { description: true }) : { ...d, description }));
  };
  const setType = (type: CatatType) => {
    if (busy.current) return;
    typeRef.current = type;
    update((d) => {
      const next = clear(
        { ...d, type },
        { category: true, counter: true, reimbursable: true, split: true },
      );
      // Trading dan aset hanya sumber/tujuan transfer: jenis lain memindahkan dompet ke bawaan.
      const current = opts?.accounts.find((a) => a.id === d.accountId);
      return type !== 'transfer' && opts !== null && current !== undefined && !spendable(current)
        ? { ...next, accountId: defaultAccountId(opts) }
        : next;
    });
    dropCrossError();
    if (status === 'saldo_kurang' || (status === 'field' && fieldCode === 'category_archived')) {
      toIdle();
    }
    requestChips(draft.ruang, type);
  };

  /**
   * Dompet dan kategori ruang lama tidak sah di ruang baru; nominal tetap. Ruang baru = niat baru,
   * jadi clientId baru. Opsi ruang tujuan diminta dari sumber (mode nyata: action, data ruang itu saja).
   */
  const switchRuang = (next: Ruang) => {
    if (busy.current) return;
    const prev = {
      ruang: draft.ruang,
      accountId: draft.accountId,
      clientId: draft.clientId,
      opts,
      hidden,
      hiddenCategories,
    };
    const seq = ++optsSeq.current;
    // `not_found` bertahan sampai sheet ditutup: pindah ruang tidak membuka Simpan diam-diam.
    if (galatKind !== 'not_found') toIdle();
    setSwitchFailed(null);
    setHidden(new Set());
    setHiddenCategories(new Set());
    const got = source.options(next);
    // Tujuan antar ruang dihitung dari ruang sumber: dibuang, dimuat ulang bila dibuka lagi.
    crossSeq.current++;
    setCross({ target: otherRuang(next), status: 'idle', accounts: [] });
    const reset = (accountId: string) => {
      setDraft((d) =>
        clear(
          { ...d, ruang: next, accountId, clientId: newClientId() },
          { category: true, counter: true, reimbursable: true, split: true },
        ),
      );
    };
    if (!isPromise(got)) {
      setOpts(got);
      reset(defaultAccountId(got));
      requestChips(next, typeRef.current);
      return;
    }
    setOpts(null);
    setChips([]);
    reset('');
    got.then(
      (o) => {
        if (seq === optsSeq.current) receive(next, o);
      },
      () => {
        if (seq !== optsSeq.current) return;
        // Gagal memuat ruang tujuan: kembali ke ruang lama; suntingan lain selama memuat tetap.
        setOpts(prev.opts);
        setCross({ target: otherRuang(prev.ruang), status: 'idle', accounts: [] });
        setHidden(prev.hidden);
        setHiddenCategories(prev.hiddenCategories);
        setDraft((d) => ({
          ...d,
          ruang: prev.ruang,
          accountId: prev.accountId,
          clientId: prev.clientId,
        }));
        requestChips(prev.ruang, typeRef.current);
        setSwitchFailed(next);
      },
    );
  };

  const send = async (clientId: string, negative: boolean): Promise<SaveOutcome | null> => {
    if (busy.current || !valid || galatKind === 'not_found') return null;
    busy.current = true;
    allowNegative.current = negative;
    setStatus('menyimpan');
    setFieldCode(null);
    setGalatKind(null);
    setSwitchFailed(null);
    let out: SaveOutcome;
    try {
      out = await source.save({ ...draft, clientId, allowNegative: negative });
    } catch {
      out = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
    }
    if (out.ok) {
      setStatus('idle');
      // Simpan berikutnya (sheet yang sama) adalah niat baru.
      setDraft((d) => ({ ...d, clientId: newClientId() }));
      return out;
    }
    const field = FIELD_OF[out.code];
    if (out.code === 'saldo_negatif') setStatus('saldo_kurang');
    else if (out.code === 'idem_mismatch') setStatus('idem_mismatch');
    else if (field !== undefined) {
      setStatus('field');
      setFieldCode(out.code as FieldCode);
      if (out.code === 'account_archived') {
        setHidden((h) => new Set([...h, draft.split?.accountId ?? draft.accountId]));
      }
      if (out.code === 'category_archived' && draft.categoryId !== undefined) {
        const archived = draft.categoryId;
        setArchivedCategoryId(archived);
        setHiddenCategories((h) => new Set([...h, archived]));
        setChips((c) => c.filter((x) => x.id !== archived));
        setDraft((d) => clear(d, { category: true }));
      }
    } else {
      setStatus('galat');
      setGalatKind(
        out.code === 'network' ||
          out.code === 'not_found' ||
          out.code === 'cross_space_not_allowed' ||
          out.code === 'cross_space_kantor'
          ? out.code
          : out.code === 'split_needs_partner' || out.code === 'split_shared_only'
            ? 'split_needs_partner'
            : 'server',
      );
    }
    return out;
  };

  /** Simpan biasa (tanpa saldo negatif). Tidak berbuat apa-apa selama menyimpan. */
  const save = () => send(draft.clientId, false);
  /** "Coba lagi" (S6-C2): clientId yang sama, jadi server mengembalikan entri yang sama bila sudah tercatat. */
  const retry = () =>
    galatKind === 'not_found' ? Promise.resolve(null) : send(draft.clientId, allowNegative.current);
  /** "Tetap simpan" (S6-C3): clientId sama, `allowNegative`. */
  const saveAnyway = () => send(draft.clientId, true);
  /** "Simpan sebagai catatan baru" (S6-C4): satu-satunya jalan (selain pindah ruang) ke clientId baru. */
  const saveAsNew = () => {
    if (busy.current || galatKind === 'not_found') return Promise.resolve(null);
    const id = newClientId();
    setDraft((d) => ({ ...d, clientId: id }));
    return send(id, allowNegative.current);
  };

  const archivedAccount =
    fieldCode === 'account_archived'
      ? opts?.accounts.find((a) => a.id === draft.accountId)
      : undefined;

  const archivedCategory =
    fieldCode === 'category_archived' && archivedCategoryId !== null
      ? opts?.categories.find((c) => c.id === archivedCategoryId)
      : undefined;

  return {
    draft,
    chips,
    archivedCategory,
    galatKind,
    allCategories,
    accounts,
    selectedAccount,
    archivedAccount,
    destinations,
    sourceAccounts,
    cross,
    crossAccount,
    crossBlocked,
    sharedNoteVisible,
    canReimburse,
    splitAvailable,
    splitPeople: opts?.split,
    personal: { ...personal, accounts: personalAccounts },
    payerAccount,
    loadPersonal,
    setSplit,
    setSplitAccount,
    setPartnerShare,
    loadCrossTargets,
    setCrossTarget,
    setSharedNote,
    setReimbursable,
    canSave,
    assetShort,
    loading,
    status,
    field: fieldCode === null ? null : (FIELD_OF[fieldCode] ?? null),
    fieldCode,
    switchFailed,
    setAmount,
    setCategory,
    setAccount,
    setCounterAccount,
    setDate,
    setDescription,
    setType,
    switchRuang,
    save,
    retry,
    saveAnyway,
    saveAsNew,
  };
}
