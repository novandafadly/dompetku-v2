'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Combobox } from '@/components/ui/combobox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { ArrowLeftIcon } from '@/components/ui/icons/arrow-left';
import { ArrowsLeftRightIcon } from '@/components/ui/icons/arrows-left-right';
import { InfoIcon } from '@/components/ui/icons/info';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { MoneyText } from '@/components/ui/money-text';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { card } from '@/components/ui/styles';
import { toast } from '@/components/ui/toast';
import { CatatAlert } from './catat-status';
import { CategoryChips } from './category-chips';
import { newClientId } from './client-id';
import { MetaSelect } from './wallet-picker';
import type {
  AccountVM,
  ActionResult,
  CategoryVM,
  EntryVM,
  LedgerErrorCode,
  Ruang,
} from '@/features/ledger/types';
import { formatRupiah } from '@dompetku/domain';

/**
 * "Pindahkan ke ruang lain" (S7-D2): sheet pilih dompet dan kategori di ruang tujuan, lalu dialog
 * akibat, lalu `source.move`. Data ruang tujuan dimuat malas lewat `source.targets` saat sheet
 * dibuka (R27: tidak lewat URL, searchParams, atau props RSC). Dimuat malas oleh Detail.
 */

export interface MoveTargetsData {
  accounts: AccountVM[];
  categories: CategoryVM[];
}

export interface MoveRequest {
  clientId: string;
  entryId: string;
  expectedVersion: number;
  toRuang: Ruang;
  accountId: string;
  categoryId: string;
  /** Hanya berarti Pribadi → Bersama (R11, R13). */
  keepDescription: boolean;
}

export interface MoveSource {
  targets(toRuang: Ruang): Promise<ActionResult<MoveTargetsData>>;
  move(req: MoveRequest): Promise<ActionResult<unknown>>;
}

export const MOVE_COPY = {
  hint: 'Pilih dompet dan kategori untuk melanjutkan',
  next: 'Lanjut',
  cancel: 'Batal',
  confirm: 'Pindahkan',
  back: 'Kembali',
  keep: 'Bawa keterangan',
  keepHelp:
    'Bila dicentang, keterangan ikut dipindah dan terlihat oleh anggota Bersama. Bila tidak, transaksi dibuat tanpa keterangan.',
  loading: 'Memuat dompet dan kategori…',
  loadFailed: 'Belum bisa memuat pilihan di ruang tujuan. Periksa koneksi lalu coba lagi.',
  retry: 'Coba lagi',
} as const;

/** Galat Pindahkan: salinan tabel galat S7 + galat umum gaya S6 (tanpa nominal). */
export function moveFailedText(code: LedgerErrorCode, tujuan: string): string {
  switch (code) {
    case 'entry_moved':
      return `Transaksi ini sudah dipindahkan ke ${tujuan}.`;
    case 'kind_not_movable':
      return 'Jenis transaksi ini tidak bisa dipindahkan ke ruang lain.';
    case 'not_creator':
      return 'Hanya pencatat yang bisa membatalkan, memulihkan, atau memindahkan transaksi ini.';
    case 'cross_space_kantor':
      return 'Dompet Kantor tidak bisa ikut transfer antar ruang. Pilih dompet lain.';
    case 'conflict':
      return 'Transaksi ini baru saja diubah. Periksa lalu pindahkan lagi.';
    case 'account_archived':
    case 'category_archived':
      return `Dompet atau kategori di ${tujuan} sudah diarsipkan. Pilih yang lain.`;
    case 'saldo_negatif':
      return 'Saldo dompet asal atau tujuan jadi kurang dari nol. Periksa saldonya dulu.';
    case 'before_opening':
      return `Tanggal transaksi ini lebih awal dari saat dompet di ${tujuan} dibuka. Pilih dompet lain.`;
    case 'not_found':
      return 'Transaksi ini sudah tidak ada. Muat ulang halaman.';
    case 'network':
      return 'Belum bisa dipindahkan. Periksa koneksi lalu coba lagi. Coba lagi tidak akan memindahkan dua kali.';
    default:
      return 'Belum bisa dipindahkan. Ada kendala di server.';
  }
}

const RUANG_LABEL: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };

const norm = (name: string) => name.trim().toLowerCase();
const CHIPS = 6;

export interface MoveSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ruang entri asal. */
  ruang: Ruang;
  toRuang: Ruang;
  entry: EntryVM;
  source: MoveSource;
  /** Sesudah berhasil (toast sudah tampil, sheet menutup): pemanggil menavigasi. */
  onMoved: () => void;
  /** Konflik versi: pemanggil memuat ulang Detail. */
  onConflict?: () => void;
  returnFocus?: HTMLElement | null;
}

/** Satu sesi = satu kali sheet dibuka: pilihan dan clientId lahir baru setiap kali dibuka. */
export function MoveSheet(props: MoveSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <MoveSession key={session} {...props} />;
}

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; data: MoveTargetsData };

function MoveSession({
  open,
  onOpenChange,
  ruang,
  toRuang,
  entry,
  source,
  onMoved,
  onConflict,
  returnFocus,
}: MoveSheetProps) {
  const asal = RUANG_LABEL[ruang];
  const tujuan = RUANG_LABEL[toRuang];
  const type = entry.kind === 'income' ? 'income' : 'expense';
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [keep, setKeep] = useState(false);
  const [page, setPage] = useState<'form' | 'kategori'>('form');
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [failure, setFailure] = useState<LedgerErrorCode | null>(null);
  const clientId = useRef(newClientId());
  const busy = useRef(false);
  const accountRef = useRef<HTMLSelectElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const keepId = useId();
  const keepHelpId = useId();

  useEffect(() => {
    let alive = true;
    void source
      .targets(toRuang)
      .catch((): ActionResult<MoveTargetsData> => ({ ok: false, error: { code: 'network' } }))
      .then((res) => {
        if (!alive) return;
        if (!res.ok) {
          setLoad({ state: 'failed' });
          return;
        }
        const { accounts, categories } = res.value;
        setLoad({ state: 'ready', data: { accounts, categories } });
        // Padanan nama otomatis (sumber kosong bila tidak ada padanan).
        const sameWallet = accounts.find((a) => norm(a.name) === norm(entry.accountName));
        if (sameWallet) setAccountId(sameWallet.id);
        const sameCategory = categories.find(
          (c) =>
            c.type === type &&
            !c.archived &&
            entry.categoryName !== undefined &&
            norm(c.name) === norm(entry.categoryName),
        );
        if (sameCategory) setCategoryId(sameCategory.id);
      });
    return () => {
      alive = false;
    };
    // `entry` tidak berubah selama sesi (key per pembukaan); `attempt` = Coba lagi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, toRuang, attempt]);

  const data = load.state === 'ready' ? load.data : null;
  // Sheet terbuka sebelum data tiba: fokus awal ke Dompet begitu Select-nya ada.
  const ready = load.state === 'ready';
  useEffect(() => {
    if (ready && page === 'form') accountRef.current?.focus();
  }, [ready, page]);
  const accounts = data?.accounts.filter((a) => !a.archived) ?? [];
  const all = (data?.categories ?? []).filter((c) => c.type === type && !c.archived);
  const chips = [
    ...all.filter((c) => c.id === categoryId),
    ...all.filter((c) => c.id !== categoryId),
  ].slice(0, CHIPS);
  const target = accounts.find((a) => a.id === accountId);
  const canContinue = load.state === 'ready' && target !== undefined && categoryId !== undefined;
  const canKeep = ruang === 'pribadi' && toRuang === 'bersama' && entry.description !== undefined;

  async function submit() {
    if (busy.current || !canContinue) return;
    busy.current = true;
    setMoving(true);
    setFailure(null);
    let res: Awaited<ReturnType<MoveSource['move']>>;
    try {
      res = await source.move({
        clientId: clientId.current,
        entryId: entry.id,
        expectedVersion: entry.version,
        toRuang,
        accountId: target.id,
        categoryId,
        keepDescription: canKeep && keep,
      });
    } catch {
      res = { ok: false, error: { code: 'network' } };
    } finally {
      busy.current = false;
      setMoving(false);
    }
    if (res.ok) {
      toast({ message: `Dipindahkan ke ${tujuan} · ${formatRupiah(entry.amount)}` });
      setConfirming(false);
      onOpenChange(false);
      onMoved();
      return;
    }
    if (res.error.code === 'conflict') {
      // Versi baru: clientId baru untuk percobaan berikutnya, Detail dimuat ulang.
      clientId.current = newClientId();
      onConflict?.();
    }
    setFailure(res.error.code);
  }

  const onSheetOpenChange = (next: boolean) => {
    if (!next && moving) return;
    onOpenChange(next);
  };

  if (page === 'kategori') {
    return (
      <Sheet
        open={open}
        onOpenChange={onSheetOpenChange}
        title={`Pindahkan ke ${tujuan}`}
        titleHidden
        tint={toRuang}
        headerStart={
          <>
            <IconButton
              label={`Kembali ke Pindahkan ke ${tujuan}`}
              icon={<ArrowLeftIcon size={20} />}
              onClick={() => {
                setPage('form');
              }}
            />
            <h3 className="min-w-0 truncate text-subheading font-extrabold">{`Kategori · ${tujuan}`}</h3>
          </>
        }
        returnFocus={returnFocus}
        fill
      >
        <Combobox
          label="Cari kategori"
          placeholder="Ketik nama kategori"
          emptyText="Tidak ada kategori dengan nama itu."
          items={all.map((c) => ({
            value: c.id,
            label: c.name,
            icon: <CategoryIcon name={c.name} size={20} />,
          }))}
          onSelect={(id) => {
            setCategoryId(id);
            setPage('form');
          }}
          onCancel={() => {
            setPage('form');
          }}
        />
      </Sheet>
    );
  }

  const footer = (
    <>
      {load.state === 'failed' ? (
        <CatatAlert id={hintId} tone="danger">
          {MOVE_COPY.loadFailed}
        </CatatAlert>
      ) : null}
      {load.state === 'failed' ? (
        <Button
          variant="secondary"
          onClick={() => {
            setLoad({ state: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          {MOVE_COPY.retry}
        </Button>
      ) : (
        <>
          {canContinue ? null : (
            <p
              id={hintId}
              className="flex items-center gap-1.5 text-meta font-medium text-text-muted"
            >
              <InfoIcon size={14} className="shrink-0" />
              {MOVE_COPY.hint}
            </p>
          )}
          <div className="flex flex-col gap-2 tablet:flex-row-reverse">
            <Button
              className="flex-1 aria-disabled:border-hairline aria-disabled:bg-surface-2 aria-disabled:text-text-muted aria-disabled:hover-pointer:bg-surface-2"
              aria-disabled={!canContinue || undefined}
              aria-describedby={canContinue ? undefined : hintId}
              onClick={() => {
                if (canContinue) setConfirming(true);
              }}
            >
              {MOVE_COPY.next}
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {MOVE_COPY.cancel}
            </Button>
          </div>
        </>
      )}
    </>
  );

  const consequences = [
    `Transaksi ini dibatalkan di ${asal} dan dibuat ulang di ${tujuan}.`,
    `Saldo ${entry.accountName} dan ${target?.name ?? 'dompet tujuan'} ikut berubah.`,
    `Yang sudah dipindah tidak bisa dipulihkan dari Sampah ${asal}.`,
    ...(canKeep ? [keep ? 'Keterangan ikut dipindah.' : 'Keterangan tidak ikut dipindah.'] : []),
  ];

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onSheetOpenChange}
        title={`Pindahkan ke ${tujuan}`}
        tint={toRuang}
        footer={footer}
        initialFocus={accountRef}
        returnFocus={returnFocus}
        fill
      >
        <div className={`flex flex-col gap-1.5 p-3.5 ${card}`}>
          <p className="min-w-0 text-body font-bold break-words text-text">
            {entry.description ?? entry.categoryName ?? 'Tanpa kategori'}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <MoneyText
              value={entry.kind === 'income' ? entry.amount : -entry.amount}
              kind={entry.kind === 'income' ? 'income' : 'expense'}
              size="inherit"
              className="text-subheading font-extrabold"
            />
            <span className="inline-flex items-center gap-1.5 text-meta font-semibold text-text-muted">
              Dari <SpaceTag space={ruang} />
            </span>
          </p>
        </div>
        {load.state === 'loading' ? (
          <p role="status" className="text-label font-medium text-text-muted">
            {MOVE_COPY.loading}
          </p>
        ) : null}
        {data !== null ? (
          <>
            <MetaSelect
              label={`Dompet di ${tujuan}`}
              icon={<WalletIcon size={18} />}
              value={accountId}
              onChange={setAccountId}
              options={[
                ...(target === undefined ? [{ value: '', label: `Dompet di ${tujuan}` }] : []),
                ...accounts.map((a) => ({ value: a.id, label: a.name })),
              ]}
              selectRef={accountRef}
            />
            <CategoryChips
              chips={chips}
              all={all}
              value={categoryId}
              onChange={setCategoryId}
              moreRef={moreRef}
              onMore={() => {
                setPage('kategori');
              }}
            />
            {canKeep ? (
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={keepId}
                  className="flex min-h-11 items-center gap-3 text-body font-semibold text-text"
                >
                  <input
                    id={keepId}
                    type="checkbox"
                    checked={keep}
                    aria-describedby={keepHelpId}
                    onChange={(e) => {
                      setKeep(e.target.checked);
                    }}
                    className="size-6 shrink-0 accent-accent"
                  />
                  {MOVE_COPY.keep}
                </label>
                <p id={keepHelpId} className="text-meta font-medium text-text-muted">
                  {MOVE_COPY.keepHelp}
                </p>
              </div>
            ) : null}
          </>
        ) : null}
      </Sheet>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => {
          if (!next && moving) return;
          setConfirming(next);
          if (!next) setFailure(null);
        }}
        icon={<ArrowsLeftRightIcon size={22} weight="bold" />}
        tone="primary"
        holdOpen
        busy={moving}
        title={`Pindahkan ke ${tujuan}?`}
        description={
          <ul className="flex flex-col gap-2">
            {consequences.map((c) => (
              <li key={c} className="flex items-start gap-2">
                <InfoIcon size={16} className="mt-0.5 shrink-0 text-text-muted" />
                <span className="min-w-0">{c}</span>
              </li>
            ))}
          </ul>
        }
        confirmLabel={failure === 'network' ? MOVE_COPY.retry : MOVE_COPY.confirm}
        cancelLabel={MOVE_COPY.back}
        alert={failure === null ? undefined : moveFailedText(failure, tujuan)}
        onConfirm={() => {
          void submit();
        }}
      />
    </>
  );
}
