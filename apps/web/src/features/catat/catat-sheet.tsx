'use client';

import { addDays, dayLabel, type IsoDate, type Rupiah } from '@dompetku/domain';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Combobox } from '@/components/ui/combobox';
import { FieldLabel } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { ArrowLeftIcon } from '@/components/ui/icons/arrow-left';
import { ArrowsLeftRightIcon } from '@/components/ui/icons/arrows-left-right';
import { CalendarBlankIcon } from '@/components/ui/icons/calendar-blank';
import { InfoIcon } from '@/components/ui/icons/info';
import { NotePencilIcon } from '@/components/ui/icons/note-pencil';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { MoneyInput } from '@/components/ui/money-input';
import { Sheet } from '@/components/ui/sheet';
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
import { TYPE_TITLE, TypeMenu, TypeMenuButton } from './type-menu';
import { useCatat } from './use-catat';
import { useKeyboardMode } from './use-keyboard-mode';
import { DestinationChips, MetaSelect } from './wallet-picker';

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
  const [page, setPage] = useState<'form' | 'kategori'>('form');
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  // Setelah halaman kategori ditutup: fokus ke chip terpilih (pilih) atau "Kategori lain…" (kembali).
  const refocus = useRef<'chosen' | 'more' | 'note' | null>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const compact = useKeyboardMode(open) && keypad === 'os';
  const label = ruangLabel[draft.ruang];
  const target = other(draft.ruang);
  const title = `${TYPE_TITLE[draft.type]} · ${label}`;

  useEffect(() => {
    const where = refocus.current;
    if (where === null) return;
    refocus.current = null;
    if (where === 'more') moreRef.current?.focus();
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

  const primaryLabel =
    status === 'galat' && c.galatKind !== 'not_found'
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
    ...c.accounts,
    ...(c.selectedAccount !== undefined && !c.accounts.includes(c.selectedAccount)
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
            title={title}
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
          <div className="flex gap-2">
            <MetaSelect
              label={draft.type === 'income' ? 'Ke dompet' : 'Dari dompet'}
              icon={<WalletIcon size={18} />}
              value={draft.accountId}
              onChange={c.setAccount}
              options={accountOptions.map((a) => ({ value: a.id, label: a.name }))}
              selectRef={accountRef}
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
          </div>
          {fieldError === null ? null : (
            <FieldErrorText id={fieldErrorId}>{fieldError}</FieldErrorText>
          )}
          {saldoText === null ? null : <SaldoKurangRow id={saldoId}>{saldoText}</SaldoKurangRow>}
          <div className={`flex-col gap-1.5 ${noteOpen ? 'flex' : 'hidden tablet:flex'}`}>
            <FieldLabel htmlFor={noteId} optional>
              Keterangan
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
