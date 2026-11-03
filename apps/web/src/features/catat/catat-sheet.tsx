'use client';

import { addDays, dayLabel, type IsoDate, type Rupiah } from '@dompetku/domain';
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type SyntheticEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Combobox } from '@/components/ui/combobox';
import { FieldLabel } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { ArrowLeftIcon } from '@/components/ui/icons/arrow-left';
import { BriefcaseIcon } from '@/components/ui/icons/briefcase';
import { ArrowsLeftRightIcon } from '@/components/ui/icons/arrows-left-right';
import { CalendarBlankIcon } from '@/components/ui/icons/calendar-blank';
import { InfoIcon } from '@/components/ui/icons/info';
import { NotePencilIcon } from '@/components/ui/icons/note-pencil';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { MoneyInput } from '@/components/ui/money-input';
import { Sheet } from '@/components/ui/sheet';
import { focusRing } from '@/components/ui/styles';
import { toast } from '@/components/ui/toast';
import type { Ruang } from '@/features/ledger/types';
import { AppKeypad } from './app-keypad';
import {
  accountArchivedText,
  beforeOpeningText,
  categoryArchivedText,
  CATAT_COPY,
  galatText,
  CatatAlert,
  FieldErrorText,
  NoAccountState,
  SaldoKurangRow,
  SavingLabel,
  saldoKurangText,
} from './catat-status';
import { CategoryChips } from './category-chips';
import { undoOrNotify } from './saved-toast';
import type { CatatSource, CatatType, SaveOutcome } from './source';
import { createCatatFlow } from './telemetry';
import { TYPE_TITLE, TypeMenu, TypeMenuButton } from './type-menu';
import { useCatat } from './use-catat';
import { useKeyboardMode } from './use-keyboard-mode';
import { CROSS_COPY, DestinationChips, MetaSelect } from './wallet-picker';

// Halaman "Ruang lain…" (S7-C1) dimuat malas saat diketuk pertama kali: tidak ikut JS muat awal.
const SpaceTargetPage = lazy(() => import('./space-target-page'));

/** Salinan tetap S7-C2. */
const TALANGAN_COPY = {
  label: 'Talangan kantor',
  hint: 'Tidak masuk hitungan pribadi. Tercatat di Menunggu reimburse.',
} as const;

const NOTE_MAX = 200;
/** Penghitung catatan muncul dari sini (S7-C1). */
const NOTE_COUNT_FROM = 160;

export interface CatatSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ruang tujuan saat sheet dibuka. */
  ruang: Ruang;
  /** Prototipe: `demoCatatSource`; mode nyata: `realCatatSource` (app/[ruang]/_real). */
  source: CatatSource;
  today: IsoDate;
  keypad: 'os' | 'app';
  /** Ke mana fokus kembali saat sheet ditutup. */
  returnFocus?: HTMLElement | null;
  /** Nominal yang diketik di placeholder sebelum kode sheet termuat. */
  initialAmount?: Rupiah | null;
  /** S6-C6: menutup Catat lalu membuka Tambah dompet di ruang itu. */
  onAddAccount?: (ruang: Ruang) => void;
  /** Jam WIB untuk saran kategori (galeri/tes); bawaan jam sekarang. */
  hourWIB?: number;
  /** Cara sheet dibuka (telemetri ketukan): tombol Catat (bawaan) atau pintasan `c`. */
  via?: 'pointer' | 'shortcut';
}

/** Hari ini dan 13 hari ke belakang; mencatat ke masa depan tidak ditawarkan. */
const DATE_CHOICES = 14;

const other = (r: Ruang): Ruang => (r === 'pribadi' ? 'bersama' : 'pribadi');

/** Satu sesi = satu kali sheet dibuka: draf dan clientId lahir baru setiap kali dibuka. */
export function CatatSheet(props: CatatSheetProps) {
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setSession((s) => s + 1);
  }
  return <CatatSession key={session} {...props} />;
}

function CatatSession({
  open,
  onOpenChange,
  ruang,
  source,
  today,
  keypad,
  returnFocus,
  initialAmount,
  onAddAccount,
  hourWIB,
  via = 'pointer',
}: CatatSheetProps) {
  const c = useCatat({
    source,
    today,
    ruang,
    initialAmount,
    ...(hourWIB === undefined ? {} : { hourWIB }),
  });
  const { draft, status } = c;
  const { ruangLabel } = source;

  // Telemetri: satu alur per sheet dibuka. Sesi yang lahir tertutup (sebelum dibuka pertama kali)
  // tidak pernah menjadi alur. Event lewat `source.track` (kirim-dan-lupakan).
  const [live] = useState(open);
  const [flow] = useState(() =>
    createCatatFlow({
      via,
      ruang,
      // `track` dari sumber saat dibuka: sumber nyata tidak menyimpan keadaan di dalamnya.
      track: (e) => {
        source.track?.(e);
      },
    }),
  );
  useEffect(() => {
    if (live) flow.open();
  }, [live, flow]);
  useEffect(() => {
    flow.setRuang(draft.ruang);
  }, [flow, draft.ruang]);
  // Ditutup tanpa simpan (Esc, Tutup, overlay, Tambah dompet): batal; sesudah simpan tidak.
  useEffect(() => {
    if (live && !open) flow.cancel();
  }, [live, open, flow]);
  // Dilepas dari pohon (pindah rute): batal. Ditunda satu tick agar pasang ulang mode ketat
  // React (dev) tidak dihitung sebagai batal.
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(unmountTimer.current);
    if (!live) return;
    return () => {
      unmountTimer.current = setTimeout(() => {
        flow.cancel();
      }, 0);
    };
  }, [live, flow]);
  const countTap = (e: MouseEvent) => {
    if (e.target instanceof Element) flow.tap({ detail: e.detail, target: e.target });
  };
  const saving = status === 'menyimpan';
  const primaryRef = useRef<HTMLButtonElement>(null);
  const accountRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLSelectElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const alertId = useId();
  const switchId = useId();
  const saldoId = useId();
  const fieldErrorId = useId();
  const emptyId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  const formId = useId();
  const noteId = useId();
  const hintId = useId();
  const typeHintId = useId();
  const [page, setPage] = useState<'form' | 'kategori' | 'ruang'>('form');
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  // Setelah halaman kategori ditutup: fokus ke chip terpilih (pilih) atau "Kategori lain…" (kembali).
  const refocus = useRef<'chosen' | 'more' | 'note' | 'cross' | null>(null);
  const crossMoreRef = useRef<HTMLButtonElement>(null);
  const crossSelectedRef = useRef<HTMLButtonElement>(null);
  const sharedNoteId = useId();
  const sharedCountId = useId();
  const reimbId = useId();
  const chipsRef = useRef<HTMLDivElement>(null);
  const compact = useKeyboardMode(open) && keypad === 'os';
  const label = ruangLabel[draft.ruang];
  const audience = source.sharedAudience?.();
  const target = other(draft.ruang);
  const toLabel = draft.toRuang === undefined ? undefined : ruangLabel[draft.toRuang];
  const baseTitle = `${TYPE_TITLE[draft.type]} · ${label}`;
  // Antar ruang: kedua ruang tertulis di judul (S7-C1), bukan hanya lewat warna.
  const title = toLabel === undefined ? baseTitle : `${baseTitle} → ${toLabel}`;

  useEffect(() => {
    const where = refocus.current;
    if (where === null) return;
    refocus.current = null;
    if (where === 'more') moreRef.current?.focus();
    else if (where === 'cross') (crossSelectedRef.current ?? crossMoreRef.current)?.focus();
    else if (where === 'note') noteRef.current?.focus();
    else chipsRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  });

  // Jawaban simpan tiba: galat/kunci bentrok/saldo kurang → tombol kaki; galat kolom → kolomnya.
  const lastStatus = useRef(status);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = status;
    if (was !== 'menyimpan' || status === 'menyimpan') return;
    if (status === 'field' && c.field === 'category_id') {
      // Kategori dilepas: fokus ke chip pertama (titik masuk roving tabindex).
      chipsRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus();
    } else if (status === 'galat' && c.galatKind === 'cross_space_not_allowed') {
      (crossSelectedRef.current ?? crossMoreRef.current)?.focus();
    } else if (status === 'galat' && c.galatKind === 'cross_space_kantor') {
      accountRef.current?.focus();
    } else if (status === 'field') {
      (c.field === 'occurred_on' ? dateRef : accountRef).current?.focus();
    } else if (status === 'galat' && c.galatKind === 'not_found') {
      // Tidak ada yang bisa dicoba lagi: fokus ke Tutup (tombol utama nonaktif).
      primaryRef.current
        ?.closest('[role="dialog"]')
        ?.querySelector<HTMLElement>('button[aria-label="Tutup"]')
        ?.focus();
    } else if (status !== 'idle') primaryRef.current?.focus();
  }, [status, c.field, c.galatKind]);

  /** Menutup di tengah simpan menghasilkan toast tanpa sheet: Esc dan Tutup ditahan (S6-C1). */
  const onSheetOpenChange = (next: boolean) => {
    if (!next && saving) return;
    onOpenChange(next);
  };

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    // Tombol utama hanya aria-disabled; Enter/klik saat nonaktif tidak mengirim apa pun.
    if (saving || !c.canSave) return;
    const run =
      status === 'galat'
        ? c.retry
        : status === 'saldo_kurang'
          ? c.saveAnyway
          : status === 'idem_mismatch'
            ? c.saveAsNew
            : c.save;
    const out: SaveOutcome | null = await run();
    if (out?.ok !== true) return;
    flow.saved();
    const saved = { entryId: out.entryId, version: out.version, ruang: draft.ruang };
    toast({
      message: out.toast,
      action: {
        label: 'Urungkan',
        onAction: () => {
          void undoOrNotify((x: typeof saved) => source.undo(x), saved, toast);
        },
      },
    });
    onOpenChange(false);
  }

  const hasAccounts = c.loading || c.accounts.length > 0 || c.selectedAccount !== undefined;
  const crossTarget = c.cross.target;
  const crossLabel = ruangLabel[crossTarget];
  const isTransfer = draft.type === 'transfer';
  const hasAmount = draft.amount !== null && draft.amount > 0;
  const missing = isTransfer
    ? draft.counterAccountId === undefined
    : draft.categoryId === undefined;
  // Galat kategori diarsipkan sudah menyebut langkahnya; petunjuk tidak diulang.
  const showHint = hasAmount && missing && c.fieldCode !== 'category_archived';

  if (page === 'kategori') {
    return (
      <Sheet
        open={open}
        onOpenChange={onSheetOpenChange}
        title={title}
        titleHidden
        tint={draft.ruang}
        headerStart={
          <>
            <IconButton
              label="Kembali ke Catat"
              icon={<ArrowLeftIcon size={20} />}
              onClick={() => {
                setPage('form');
                refocus.current = 'more';
              }}
            />
            <h3 className="min-w-0 truncate text-subheading font-extrabold">{`Kategori · ${label}`}</h3>
          </>
        }
        returnFocus={returnFocus}
        onClickCapture={countTap}
        fill
      >
        <Combobox
          label="Cari kategori"
          placeholder="Ketik nama kategori"
          emptyText="Tidak ada kategori dengan nama itu."
          items={c.allCategories.map((cat) => ({
            value: cat.id,
            label: cat.name,
            icon: <CategoryIcon name={cat.name} size={20} />,
          }))}
          onSelect={(id) => {
            c.setCategory(id);
            setPage('form');
            refocus.current = 'chosen';
          }}
          onCancel={() => {
            setPage('form');
            refocus.current = 'more';
          }}
        />
      </Sheet>
    );
  }

  if (page === 'ruang') {
    return (
      <Sheet
        open={open}
        onOpenChange={onSheetOpenChange}
        title={title}
        titleHidden
        tint={draft.ruang}
        headerStart={
          <>
            <IconButton
              label={`Kembali ke ${TYPE_TITLE[draft.type]}`}
              icon={<ArrowLeftIcon size={20} />}
              onClick={() => {
                setPage('form');
                refocus.current = 'cross';
              }}
            />
            <h3 className="min-w-0 truncate text-subheading font-extrabold">{`Ke dompet di ${crossLabel}`}</h3>
          </>
        }
        returnFocus={returnFocus}
        onClickCapture={countTap}
        fill
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape dari fokus di dalam halaman */}
        <div
          data-own-escape=""
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            setPage('form');
            refocus.current = 'cross';
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <Suspense
            fallback={
              <p role="status" className="px-1 py-3 text-label font-semibold text-text-muted">
                Memuat dompet…
              </p>
            }
          >
            <SpaceTargetPage
              targets={c.cross}
              targetLabel={crossLabel}
              value={draft.toRuang === undefined ? undefined : draft.counterAccountId}
              onPick={(id) => {
                c.setCrossTarget(id);
                setPage('form');
                refocus.current = 'cross';
              }}
              onRetry={c.loadCrossTargets}
              onAddAccount={(r) => {
                onOpenChange(false);
                onAddAccount?.(r);
              }}
            />
          </Suspense>
        </div>
      </Sheet>
    );
  }

  const primaryLabel =
    status === 'galat' && (c.galatKind === 'network' || c.galatKind === 'server')
      ? CATAT_COPY.cobaLagi
      : status === 'saldo_kurang'
        ? CATAT_COPY.tetapSimpan
        : status === 'idem_mismatch'
          ? CATAT_COPY.simpanBaru
          : 'Simpan';
  const alertShown = status === 'galat' || status === 'idem_mismatch';
  // Label kaki yang panjang tetap satu baris (S6-C3/C4): "Pindah ke …" jadi ikon berlabel di HP.
  const moveLabelClass =
    status === 'idem_mismatch'
      ? 'sr-only tablet:not-sr-only'
      : status === 'saldo_kurang'
        ? 'sr-only narrow:not-sr-only'
        : undefined;
  const saldoShown = status === 'saldo_kurang' && c.selectedAccount !== undefined;
  const describedBy =
    [
      alertShown ? alertId : null,
      c.switchFailed === null ? null : switchId,
      saldoShown ? saldoId : null,
      showHint ? hintId : null,
    ]
      .filter((x) => x !== null)
      .join(' ') || undefined;

  const footer = hasAccounts ? (
    <>
      {keypad === 'app' ? <AppKeypad value={draft.amount} onChange={c.setAmount} /> : null}
      {status === 'galat' ? (
        <CatatAlert id={alertId} tone="danger" compact={compact}>
          {galatText(c.galatKind ?? 'network')}
        </CatatAlert>
      ) : null}
      {status === 'idem_mismatch' ? (
        <CatatAlert id={alertId} tone="warning" compact={compact}>
          {CATAT_COPY.idem}
        </CatatAlert>
      ) : null}
      {c.switchFailed === null ? null : (
        <CatatAlert id={switchId} tone="danger" compact={compact}>
          {`Belum bisa pindah ke ${ruangLabel[c.switchFailed]}. Periksa koneksi lalu coba lagi.`}
        </CatatAlert>
      )}
      <p role="status" className="sr-only">
        {saving ? CATAT_COPY.menyimpan : ''}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="text"
          size="sm"
          className="px-2.5"
          aria-disabled={saving || undefined}
          onClick={() => {
            c.switchRuang(target);
          }}
        >
          <ArrowsLeftRightIcon size={18} weight="bold" />
          <span className={moveLabelClass}>Pindah ke {ruangLabel[target]}</span>
        </Button>
        <Button
          ref={primaryRef}
          type="submit"
          form={formId}
          size={compact ? 'sm' : 'md'}
          // Tidak pernah `disabled`: tombol yang sedang difokus tidak boleh menjatuhkan fokus ke
          // <body> (R8). Nonaktif = aria-disabled; submit dijaga `canSave` di hook.
          aria-disabled={saving || !c.canSave || undefined}
          aria-busy={saving || undefined}
          aria-describedby={describedBy}
          className="flex-1 aria-disabled:border-hairline aria-disabled:bg-surface-2 aria-disabled:text-text-muted aria-disabled:hover-pointer:bg-surface-2"
        >
          {saving ? (
            <SavingLabel />
          ) : (
            <>
              {primaryLabel}
              <kbd
                aria-hidden="true"
                className="ml-auto hidden rounded-sm border border-current px-1.5 py-0.5 font-mono text-tag font-bold laptop:inline"
              >
                ↵
              </kbd>
            </>
          )}
        </Button>
      </div>
      <p className="hidden text-caption font-medium text-text-muted laptop:block">
        Enter untuk simpan · Esc untuk menutup
      </p>
    </>
  ) : undefined;

  const opened = c.selectedAccount?.openedOn;
  // Tanggal sebelum dompet dibuka tidak ditawarkan (S6-C5); nilai sekarang tetap ada agar Select jujur.
  const dates = Array.from({ length: DATE_CHOICES }, (_, i) => addDays(today, -i)).filter(
    (d) => opened === undefined || d >= opened || d === draft.date,
  );
  const accountOptions = [
    ...c.sourceAccounts,
    ...(c.selectedAccount !== undefined && !c.sourceAccounts.includes(c.selectedAccount)
      ? [c.selectedAccount]
      : []),
  ];
  const categoryError =
    status === 'field' && c.archivedCategory !== undefined
      ? categoryArchivedText(c.archivedCategory.name)
      : null;
  const fieldError =
    status !== 'field' || c.selectedAccount === undefined || c.fieldCode === 'category_archived'
      ? null
      : c.fieldCode === 'before_opening'
        ? beforeOpeningText(c.selectedAccount.name, c.selectedAccount.openedOn)
        : accountArchivedText(c.selectedAccount.name);
  const account = c.selectedAccount;
  const saldoText =
    saldoShown && account !== undefined && draft.amount !== null
      ? saldoKurangText(account.name, account.balance, account.balance - draft.amount)
      : null;

  return (
    <Sheet
      open={open}
      onOpenChange={onSheetOpenChange}
      title={title}
      titleContent={
        hasAccounts ? (
          <TypeMenuButton
            ref={titleRef}
            space={draft.ruang}
            title={baseTitle}
            toSpace={
              draft.toRuang === undefined || toLabel === undefined
                ? undefined
                : {
                    space: draft.toRuang,
                    label: toLabel,
                    head: `${TYPE_TITLE[draft.type]} ·`,
                    from: label,
                  }
            }
            open={menuOpen}
            describedBy={typeHintId}
            busy={saving}
            onToggle={() => {
              setMenuOpen((o) => !o);
            }}
          />
        ) : undefined
      }
      headerAction={
        <>
          <span id={typeHintId} className="sr-only">
            Ganti jenis transaksi
          </span>
          {menuOpen ? (
            <TypeMenu
              value={draft.type}
              onChange={(t: CatatType) => {
                c.setType(t);
              }}
              onClose={() => {
                setMenuOpen(false);
                titleRef.current?.focus();
              }}
              ignore={titleRef}
            />
          ) : null}
        </>
      }
      tint={draft.ruang}
      footer={footer}
      initialFocus={hasAccounts ? amountRef : addRef}
      returnFocus={returnFocus}
      onClickCapture={countTap}
      fill
      compact={compact}
      describedBy={hasAccounts ? undefined : emptyId}
    >
      {hasAccounts ? (
        <form
          id={formId}
          onSubmit={(e) => {
            void submit(e);
          }}
          className={`flex flex-col ${compact ? 'gap-2' : 'gap-3'}`}
        >
          <MoneyInput
            label="Nominal"
            labelHidden
            size={compact ? 'compact' : 'hero'}
            inputMode={keypad === 'app' ? 'none' : 'numeric'}
            inputRef={amountRef}
            value={draft.amount}
            onChange={c.setAmount}
            readOnly={saving}
          />
          {isTransfer ? (
            <DestinationChips
              accounts={c.destinations}
              value={draft.counterAccountId}
              onChange={c.setCounterAccount}
              busy={saving}
              crossEnabled
              crossLabel={
                draft.toRuang === undefined || toLabel === undefined
                  ? undefined
                  : `${c.crossAccount?.name ?? ''}${c.crossAccount === undefined ? '' : ' · '}${toLabel}`
              }
              crossBlocked={c.crossBlocked}
              crossMoreRef={crossMoreRef}
              crossSelectedRef={crossSelectedRef}
              onOpenCross={() => {
                c.loadCrossTargets();
                setPage('ruang');
              }}
            />
          ) : (
            <div ref={chipsRef}>
              <CategoryChips
                chips={c.chips}
                all={c.allCategories}
                value={draft.categoryId}
                onChange={c.setCategory}
                moreRef={moreRef}
                busy={saving}
                invalid={categoryError !== null}
                describedBy={categoryError === null ? undefined : fieldErrorId}
                onMore={() => {
                  setPage('kategori');
                }}
              />
            </div>
          )}
          {categoryError === null ? null : (
            <FieldErrorText id={fieldErrorId}>{categoryError}</FieldErrorText>
          )}
          {showHint ? (
            <p
              id={hintId}
              className="flex items-center gap-1.5 text-caption font-medium text-text-muted"
            >
              <InfoIcon size={14} className="shrink-0" />
              {isTransfer
                ? 'Pilih dompet tujuan untuk menyimpan'
                : 'Pilih kategori untuk menyimpan'}
            </p>
          ) : null}
          {draft.reimbursable === true ? (
            <p
              id={reimbId}
              // Slot petunjuk yang sama dengan petunjuk simpan: tidak ada baris tambahan (S7-C2).
              className={
                showHint
                  ? 'sr-only'
                  : `flex gap-1.5 text-meta font-semibold text-text-soft ${compact ? 'items-center' : 'items-start'}`
              }
            >
              <InfoIcon size={14} className={`shrink-0 ${compact ? '' : 'mt-0.5'}`} />
              {/* Mode keyboard: satu baris (tinggi sheet); selain itu teks utuh boleh membungkus. */}
              <span className={compact ? 'min-w-0 truncate' : 'min-w-0 text-pretty'}>
                {TALANGAN_COPY.hint}
              </span>
            </p>
          ) : null}
          <div className="flex gap-2">
            <MetaSelect
              label={draft.type === 'income' ? 'Ke dompet' : 'Dari dompet'}
              icon={<WalletIcon size={18} />}
              value={draft.accountId}
              onChange={c.setAccount}
              options={accountOptions.map((a) => ({ value: a.id, label: a.name }))}
              selectRef={accountRef}
              tight={c.canReimburse}
              busy={saving}
              invalid={c.field === 'account_id'}
              describedBy={c.field === 'account_id' ? fieldErrorId : undefined}
            />
            <MetaSelect
              label="Tanggal"
              icon={<CalendarBlankIcon size={18} />}
              value={draft.date}
              dataDate={draft.date}
              onChange={c.setDate}
              options={dates.map((d) => ({ value: d, label: dayLabel(d, today) }))}
              selectRef={dateRef}
              tight={c.canReimburse}
              busy={saving}
              invalid={c.field === 'occurred_on'}
              describedBy={c.field === 'occurred_on' ? fieldErrorId : undefined}
            />
            <IconButton
              label="Tambah keterangan"
              icon={<NotePencilIcon size={20} />}
              aria-expanded={noteOpen}
              aria-controls={noteId}
              className="tablet:hidden"
              onClick={() => {
                setNoteOpen((o) => !o);
                refocus.current = noteOpen ? null : 'note';
              }}
            />
            {c.canReimburse ? (
              <button
                type="button"
                role="switch"
                aria-checked={draft.reimbursable === true}
                aria-label={TALANGAN_COPY.label}
                aria-describedby={draft.reimbursable === true ? reimbId : undefined}
                aria-disabled={saving || undefined}
                onClick={() => {
                  if (!saving) c.setReimbursable(draft.reimbursable !== true);
                }}
                // Mati: ubin surface-2; aktif: tint aksen + garis 1 px (aktif juga lewat aria-checked
                // dan petunjuk, bukan warna saja).
                className={`inline-flex size-11 shrink-0 items-center justify-center rounded-lg border ${focusRing} ${
                  draft.reimbursable === true
                    ? 'border-accent-text bg-accent-tint text-accent-text'
                    : 'border-hairline bg-surface-2 text-text-soft hover-pointer:bg-hover'
                } aria-disabled:text-text-muted`}
              >
                <BriefcaseIcon size={20} />
              </button>
            ) : null}
          </div>
          {fieldError === null ? null : (
            <FieldErrorText id={fieldErrorId}>{fieldError}</FieldErrorText>
          )}
          {saldoText === null ? null : <SaldoKurangRow id={saldoId}>{saldoText}</SaldoKurangRow>}
          <div className={`flex-col gap-1.5 ${noteOpen ? 'flex' : 'hidden tablet:flex'}`}>
            <FieldLabel htmlFor={noteId} optional>
              {c.sharedNoteVisible ? CROSS_COPY.keterangan : 'Keterangan'}
            </FieldLabel>
            <input
              id={noteId}
              ref={noteRef}
              type="text"
              autoComplete="off"
              placeholder="Contoh: kopi sore"
              value={draft.description ?? ''}
              readOnly={saving || undefined}
              aria-disabled={saving || undefined}
              onChange={(e) => {
                c.setDescription(e.target.value);
              }}
              className="min-h-12 w-full min-w-0 rounded-lg border border-border bg-bg px-3.5 text-body font-medium text-text outline-none placeholder:text-text-muted focus:border-2 focus:border-focus aria-disabled:border-hairline aria-disabled:text-text-muted"
            />
          </div>
          {c.sharedNoteVisible ? (
            <div className={`flex-col gap-1.5 ${noteOpen ? 'flex' : 'hidden tablet:flex'}`}>
              <FieldLabel htmlFor={sharedNoteId} optional>
                {CROSS_COPY.catatan}
              </FieldLabel>
              <input
                id={sharedNoteId}
                type="text"
                autoComplete="off"
                maxLength={NOTE_MAX}
                placeholder={
                  audience === undefined ? CROSS_COPY.audienceUmum : CROSS_COPY.audience(audience)
                }
                value={draft.sharedNote ?? ''}
                readOnly={saving || undefined}
                aria-disabled={saving || undefined}
                aria-describedby={
                  (draft.sharedNote?.length ?? 0) >= NOTE_COUNT_FROM ? sharedCountId : undefined
                }
                onChange={(e) => {
                  c.setSharedNote(e.target.value);
                }}
                className="min-h-12 w-full min-w-0 rounded-lg border border-border bg-bg px-3.5 text-body font-medium text-text outline-none placeholder:text-text-muted focus:border-2 focus:border-focus aria-disabled:border-hairline aria-disabled:text-text-muted"
              />
              {(draft.sharedNote?.length ?? 0) >= NOTE_COUNT_FROM ? (
                <p id={sharedCountId} className="text-caption font-medium text-text-muted">
                  {`${String(draft.sharedNote?.length ?? 0)} / ${String(NOTE_MAX)}`}
                </p>
              ) : null}
            </div>
          ) : null}
        </form>
      ) : (
        <NoAccountState
          id={emptyId}
          ruang={label}
          buttonRef={addRef}
          onAdd={() => {
            onOpenChange(false);
            onAddAccount?.(draft.ruang);
          }}
        />
      )}
    </Sheet>
  );
}
