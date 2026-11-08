'use client';

import { useId, useRef, useState, type SyntheticEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ICON_CHOICES, iconChoiceName } from '@/components/ui/category-icon-map';
import { FieldLabel } from '@/components/ui/field';
import { FieldError, FieldHint } from '@/components/ui/field-messages';
import { CaretDownIcon } from '@/components/ui/icons/caret-down';
import { CircleNotchIcon } from '@/components/ui/icons/circle-notch';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { handleRadioArrowKeys } from '@/components/ui/radio-keys';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { focusRing, tile } from '@/components/ui/styles';
import { TextField } from '@/components/ui/text-field';
import { newClientId } from '@/features/ledger/client-id';
import type { CategoryVM, LedgerErrorCode, Ruang } from '@/features/ledger/types';

const RUANG_NAME: Record<Ruang, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };
const NAME_MAX = 40;
const FORM_ID = 'form-kategori';

/** Salinan S6-K1 (docs/design/s6-bingkai.md) dan galat isian. */
export const KATEGORI_COPY = {
  nameRequired: 'Nama kategori wajib diisi.',
  nameTooLong: `Nama kategori maksimal ${String(NAME_MAX)} karakter.`,
  nameTaken: (ruang: Ruang) => `Nama ini sudah dipakai kategori lain di ${RUANG_NAME[ruang]}.`,
  depth: 'Kategori hanya bisa dua tingkat.',
  hasChildren: 'Punya subkategori, jadi tidak bisa dijadikan subkategori.',
  network:
    'Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan menyimpan dua kali.',
  server: 'Belum tersimpan. Ada kendala di server. Coba lagi tidak akan menyimpan dua kali.',
  idem: 'Kategori ini mungkin sudah tersimpan. Tutup lalu periksa daftar kategori.',
  obligation:
    'Kategori ini dipakai tagihan atau anggaran wajib. Arsipkan tagihannya atau hapus anggarannya dulu.',
  gone: 'Kategori ini sudah tidak ada atau sudah diarsipkan. Tutup lalu muat ulang halaman.',
} as const;

export type CategoryFormMode =
  { kind: 'add'; type: 'expense' | 'income' } | { kind: 'edit'; category: CategoryVM };

/** `clientId` hanya dipakai saat menambah (ubah idempoten secara alami). */
export interface CategorySubmit {
  clientId: string;
  name: string;
  icon: string;
  parentId: string | null;
}

export type CategorySubmitResult = { ok: true } | { ok: false; code: LedgerErrorCode };

export interface CategoryFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruang: Ruang;
  mode: CategoryFormMode;
  /** Kategori aktif ruang ini (semua jenis); pilihan Induk diambil dari yang sejenis. */
  categories: CategoryVM[];
  onSubmit: (input: CategorySubmit) => Promise<CategorySubmitResult>;
  /** Mode ubah: membuka dialog arsip (S6-K2). */
  onArchive?: (() => void) | undefined;
}

type Galat = 'network' | 'server' | 'gone' | 'idem' | 'obligation';

function Alert({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-lg bg-danger-tint p-3 text-label font-semibold text-danger"
    >
      <p className="flex items-start gap-2">
        <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
        <span className="text-pretty">{children}</span>
      </p>
      {action}
    </div>
  );
}

/** Pilihan ikon: `radiogroup` ubin 44, titik masuk Tab = ubin terpilih (atau pertama). */
function IconPicker({
  value,
  onChange,
  labelId,
}: {
  value: string | null;
  onChange: (name: string) => void;
  labelId: string;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- fokus ada di ubin (roving tabindex)
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      onKeyDown={handleRadioArrowKeys}
      className="flex flex-wrap gap-2"
    >
      {ICON_CHOICES.map(({ name, label, Glyph }, i) => {
        const selected = name === value;
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            tabIndex={selected || (value === null && i === 0) ? 0 : -1}
            onClick={() => {
              onChange(name);
            }}
            className={`size-11 rounded-lg border ${tile} ${focusRing} ${
              selected
                ? 'border-2 border-ruang bg-ruang-tint text-ruang'
                : 'border-transparent hover-pointer:text-text active:bg-surface'
            }`}
          >
            <Glyph size={22} />
          </button>
        );
      })}
    </div>
  );
}

function Body({
  ruang,
  mode,
  categories,
  onSubmit,
  onDone,
  nameRef,
}: Pick<CategoryFormProps, 'ruang' | 'mode' | 'categories' | 'onSubmit'> & {
  onDone: () => void;
  nameRef: React.RefObject<HTMLInputElement | null>;
}) {
  const editing = mode.kind === 'edit' ? mode.category : null;
  const type = editing?.type ?? (mode.kind === 'add' ? mode.type : 'expense');
  const hasChildren = editing !== null && categories.some((c) => c.parentId === editing.id);
  const parents = categories.filter(
    (c) => c.type === type && c.parentId === null && c.id !== editing?.id,
  );

  const [name, setName] = useState(editing?.name ?? '');
  // Nilai `icon` tersimpan dikirim apa adanya bila tidak diubah (ikon bawaan lama tidak diganti diam-diam).
  const [icon, setIcon] = useState(editing?.icon ?? 'Tag');
  const [parentId, setParentId] = useState(editing?.parentId ?? '');
  const [nameError, setNameError] = useState<string | undefined>();
  const [parentError, setParentError] = useState<string | undefined>();
  const [galat, setGalat] = useState<Galat | null>(null);
  const busy = useRef(false);
  // clientId satu percobaan: dipakai ulang hanya untuk isian yang sama persis ("Coba lagi").
  // Satu clientId per sesi sheet, tidak pernah diganti (server bisa sudah menyimpan sebelum koneksi putus).
  const [clientId] = useState(newClientId);
  const parentRef = useRef<HTMLSelectElement>(null);
  const iconLabel = useId();
  const parentLabel = useId();
  const parentErrorId = useId();
  const parentHint = useId();
  const selectedIcon = iconChoiceName(icon, editing?.name);

  async function submit() {
    if (busy.current) return;
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.length > NAME_MAX) {
      setNameError(trimmed === '' ? KATEGORI_COPY.nameRequired : KATEGORI_COPY.nameTooLong);
      nameRef.current?.focus();
      return;
    }
    setNameError(undefined);
    setParentError(undefined);
    setGalat(null);
    const pid = parentId === '' ? null : parentId;
    busy.current = true;
    let res: CategorySubmitResult;
    try {
      res = await onSubmit({
        clientId,
        name: trimmed,
        icon,
        parentId: pid,
      });
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
    }
    if (res.ok) {
      onDone();
      return;
    }
    switch (res.code) {
      case 'name_taken':
        setNameError(KATEGORI_COPY.nameTaken(ruang));
        nameRef.current?.focus();
        break;
      case 'category_depth':
        setParentError(KATEGORI_COPY.depth);
        parentRef.current?.focus();
        break;
      case 'network':
        setGalat('network');
        break;
      case 'idem_mismatch':
        setGalat('idem');
        break;
      case 'category_in_obligation':
        setGalat('obligation');
        break;
      case 'not_found':
      case 'category_archived':
        setGalat('gone');
        break;
      default:
        setGalat('server');
    }
  }

  function onFormSubmit(e: SyntheticEvent) {
    e.preventDefault();
    void submit();
  }

  return (
    <form id={FORM_ID} noValidate onSubmit={onFormSubmit} className="flex flex-col gap-3">
      <TextField
        label="Nama"
        value={name}
        onChange={(v) => {
          setName(v);
          setNameError(undefined);
        }}
        error={nameError}
        placeholder="Contoh: Parkir"
        autoComplete="off"
        maxLength={NAME_MAX}
        inputRef={nameRef}
      />
      <div className="flex flex-col gap-1.5">
        <FieldLabel id={iconLabel}>Ikon</FieldLabel>
        <IconPicker value={selectedIcon} onChange={setIcon} labelId={iconLabel} />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={parentLabel}>Induk</FieldLabel>
        <div className="relative">
          <select
            id={parentLabel}
            ref={parentRef}
            value={hasChildren ? '' : parentId}
            disabled={hasChildren}
            aria-invalid={parentError !== undefined || undefined}
            aria-describedby={
              [hasChildren ? parentHint : null, parentError === undefined ? null : parentErrorId]
                .filter((x) => x !== null)
                .join(' ') || undefined
            }
            onChange={(e) => {
              setParentId(e.target.value);
              setParentError(undefined);
            }}
            className="h-12 w-full min-w-0 appearance-none truncate rounded-lg border border-border bg-bg pr-9 pl-3.5 text-body font-medium text-text hover-pointer:bg-hover disabled:border-hairline disabled:text-text-muted aria-invalid:border-2 aria-invalid:border-danger"
          >
            <option value="">Tanpa induk</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id} className="bg-surface text-text">
                {p.name}
              </option>
            ))}
          </select>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-text-muted"
          >
            <CaretDownIcon size={14} weight="bold" />
          </span>
        </div>
        {parentError === undefined ? null : (
          <FieldError id={parentErrorId}>{parentError}</FieldError>
        )}
        {hasChildren ? <FieldHint id={parentHint}>{KATEGORI_COPY.hasChildren}</FieldHint> : null}
      </div>
      {galat === null ? null : (
        <Alert
          action={
            galat === 'gone' || galat === 'idem' || galat === 'obligation' ? undefined : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void submit();
                }}
              >
                Coba lagi
              </Button>
            )
          }
        >
          {galat === 'network'
            ? KATEGORI_COPY.network
            : galat === 'obligation'
              ? KATEGORI_COPY.obligation
              : galat === 'gone'
                ? KATEGORI_COPY.gone
                : galat === 'idem'
                  ? KATEGORI_COPY.idem
                  : KATEGORI_COPY.server}
        </Alert>
      )}
    </form>
  );
}

/**
 * Sheet tambah/ubah kategori (S6-K1). Kolom Nama (maks 40), pilihan ikon, Induk (opsional, akar
 * sejenis; tidak tersedia bila kategori punya anak). Mode ubah: aksi teks bahaya `Arsipkan
 * kategori` (membuka S6-K2). Galat nama ganda di kolom Nama, kedalaman di kolom Induk.
 */
export function CategoryForm({
  open,
  onOpenChange,
  ruang,
  mode,
  categories,
  onSubmit,
  onArchive,
}: CategoryFormProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const title = `${mode.kind === 'add' ? 'Tambah' : 'Ubah'} kategori · ${RUANG_NAME[ruang]}`;

  async function guarded(input: CategorySubmit) {
    setSaving(true);
    try {
      return await onSubmit(input);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // Esc/overlay/Tutup tidak menutup selama menyimpan.
        if (!saving) onOpenChange(next);
      }}
      title={title}
      titleContent={
        <>
          {mode.kind === 'add' ? 'Tambah kategori' : 'Ubah kategori'}
          <SpaceTag space={ruang} />
        </>
      }
      tint={ruang}
      initialFocus={nameRef}
      footer={
        <>
          <Button
            type="submit"
            form={FORM_ID}
            // Tidak pernah `disabled`: fokus tidak jatuh ke <body> (R8); submit dijaga `busy`.
            aria-disabled={saving || undefined}
            aria-busy={saving || undefined}
            className="w-full aria-disabled:border-hairline aria-disabled:bg-surface-2 aria-disabled:text-text-muted aria-disabled:hover-pointer:bg-surface-2"
          >
            {saving ? (
              <>
                <CircleNotchIcon
                  size={18}
                  weight="bold"
                  className="shrink-0 motion-safe:animate-spin"
                />
                Menyimpan…
              </>
            ) : (
              'Simpan kategori'
            )}
          </Button>
          {mode.kind === 'edit' && onArchive ? (
            <button
              type="button"
              onClick={onArchive}
              aria-disabled={saving || undefined}
              className={`inline-flex min-h-11 w-full items-center justify-center rounded-lg px-3 text-label font-bold text-danger hover-pointer:bg-danger-tint ${focusRing}`}
            >
              Arsipkan kategori
            </button>
          ) : null}
        </>
      }
    >
      <Body
        ruang={ruang}
        mode={mode}
        categories={categories}
        onSubmit={guarded}
        nameRef={nameRef}
        onDone={() => {
          onOpenChange(false);
        }}
      />
    </Sheet>
  );
}
