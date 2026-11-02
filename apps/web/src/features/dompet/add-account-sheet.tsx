'use client';

import type { DemoState, DemoStore } from '@dompetku/demo-data';
import type { IsoDate, Rupiah } from '@dompetku/domain';
import { useId, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { FieldLabel } from '@/components/ui/field';
import { FieldError, FieldHint } from '@/components/ui/field-messages';
import { CircleNotchIcon } from '@/components/ui/icons/circle-notch';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { MoneyInput } from '@/components/ui/money-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import { newClientId } from '@/features/ledger/client-id';
import type { LedgerErrorCode, Pocket, Ruang, WalletType } from '@/features/ledger/types';
import { POCKET_LABEL, RUANG_NAME, WALLET_TYPE_LABEL } from './context';

const WALLET_TYPES: WalletType[] = ['bank', 'ewallet', 'cash'];
const FORM_ID = 'tambah-dompet';
/** Sama dengan batas skema server (`createAccountSchema`). */
export const WALLET_NAME_MAX = 40;

/** `clientId` = kunci idempoten satu percobaan (dipakai ulang bila "Coba lagi" dengan isian sama). */
export interface AccountSubmit {
  clientId: string;
  name: string;
  pocket: Pocket;
  walletType: WalletType;
  /** Saldo hari ini; 0 = tanpa entri Saldo awal. */
  openingBalance: Rupiah;
}

export type AccountSubmitResult = { ok: true } | { ok: false; code: LedgerErrorCode };

interface Errors {
  name?: string;
  pocket?: string;
}

type Galat = 'network' | 'server';

const GALAT_TEXT: Record<Galat, string> = {
  network:
    'Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan menambah dua kali.',
  server: 'Belum tersimpan. Ada kendala di server. Coba lagi tidak akan menambah dua kali.',
};

function Form({
  ruang,
  existingNames,
  onSubmit,
  nameRef,
  onDone,
}: {
  ruang: Ruang;
  /** Nama dompet yang sudah ada di ruang ini (dua dompet bernama sama ditolak). */
  existingNames: readonly string[];
  onSubmit: (input: AccountSubmit) => Promise<AccountSubmitResult>;
  nameRef: RefObject<HTMLInputElement | null>;
  onDone: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [pocket, setPocket] = useState<Pocket | null>(null);
  const [walletType, setWalletType] = useState<WalletType>('bank');
  const [opening, setOpening] = useState<Rupiah | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [galat, setGalat] = useState<Galat | null>(null);
  const busy = useRef(false);
  const attempt = useRef<{ key: string; clientId: string } | null>(null);
  const pocketLabel = useId();
  const pocketError = useId();
  const typeLabel = useId();
  const openingHint = useId();
  const pocketRef = useRef<HTMLDivElement>(null);
  const pockets: Pocket[] =
    ruang === 'pribadi' ? ['operasional', 'tabungan', 'kantor'] : ['operasional', 'tabungan'];

  async function submit() {
    if (busy.current) return;
    const trimmed = name.trim();
    const next: Errors = {};
    if (trimmed === '') next.name = 'Nama dompet wajib diisi.';
    else if (trimmed.length > WALLET_NAME_MAX) {
      next.name = `Nama dompet maksimal ${String(WALLET_NAME_MAX)} karakter.`;
    } else {
      const same = existingNames.find((n) => n.toLowerCase() === trimmed.toLowerCase());
      if (same !== undefined)
        next.name = `Dompet bernama ${same} sudah ada di ${RUANG_NAME[ruang]}.`;
    }
    if (pocket === null) next.pocket = 'Pilih jenis dompet.';
    setErrors(next);
    setGalat(null);
    // Fokus pindah ke kolom pertama yang salah.
    if (next.name !== undefined) {
      nameRef.current?.focus();
      return;
    }
    if (pocket === null) {
      pocketRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus();
      return;
    }
    const openingBalance = opening ?? 0;
    const key = JSON.stringify([trimmed, pocket, walletType, openingBalance]);
    if (attempt.current?.key !== key) attempt.current = { key, clientId: newClientId() };
    busy.current = true;
    let res: AccountSubmitResult;
    try {
      res = await onSubmit({
        clientId: attempt.current.clientId,
        name: trimmed,
        pocket,
        walletType,
        openingBalance,
      });
    } catch {
      res = { ok: false, code: 'network' };
    } finally {
      busy.current = false;
    }
    if (res.ok) {
      onDone(trimmed);
      return;
    }
    setGalat(res.code === 'network' ? 'network' : 'server');
  }

  return (
    <>
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
      >
        <TextField
          label="Nama"
          value={name}
          onChange={setName}
          error={errors.name}
          placeholder="Contoh: BCA, Tunai"
          autoComplete="off"
          maxLength={WALLET_NAME_MAX}
          inputRef={nameRef}
        />
        <div ref={pocketRef} className="flex flex-col gap-1.5">
          <FieldLabel id={pocketLabel}>Jenis</FieldLabel>
          <SegmentedControl
            labelledBy={pocketLabel}
            items={pockets.map((p) => ({ value: p, label: POCKET_LABEL[p] }))}
            value={pocket}
            onChange={(v) => {
              const p = pockets.find((x) => x === v);
              if (p) setPocket(p);
            }}
          />
          {errors.pocket ? <FieldError id={pocketError}>{errors.pocket}</FieldError> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel id={typeLabel}>Tipe</FieldLabel>
          <SegmentedControl
            labelledBy={typeLabel}
            items={WALLET_TYPES.map((t) => ({ value: t, label: WALLET_TYPE_LABEL[t] }))}
            value={walletType}
            onChange={(v) => {
              const t = WALLET_TYPES.find((x) => x === v);
              if (t) setWalletType(t);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <MoneyInput
            label="Saldo hari ini"
            optional
            value={opening}
            onChange={setOpening}
            describedBy={openingHint}
          />
          <FieldHint id={openingHint}>
            Kosongkan bila belum tahu; bisa diisi nanti. Dicatat sebagai &quot;Saldo awal&quot; di
            riwayat dompet.
          </FieldHint>
        </div>
      </form>
      {galat === null ? null : (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-lg bg-danger-tint p-3 text-label font-semibold text-danger"
        >
          <p className="flex items-start gap-2">
            <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
            <span className="text-pretty">{GALAT_TEXT[galat]}</span>
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void submit();
            }}
          >
            Coba lagi
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Sheet Tambah dompet (W2), untuk kedua mode: `onSubmit` async memutuskan ke mana dompet disimpan
 * (store demo, atau Server Action `createAccountAction`). Berhasil: sheet menutup dan toast
 * menyebut ruang. Gagal jaringan/server: peringatan + Coba lagi dengan `clientId` yang sama.
 */
export function AddAccountSheet({
  open,
  onOpenChange,
  ruang,
  existingNames,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruang: Ruang;
  existingNames: readonly string[];
  onSubmit: (input: AccountSubmit) => Promise<AccountSubmitResult>;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  async function guarded(input: AccountSubmit) {
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
      title={`Tambah dompet · ${RUANG_NAME[ruang]}`}
      titleContent={
        <>
          Tambah dompet
          <SpaceTag space={ruang} />
        </>
      }
      tint={ruang}
      initialFocus={nameRef}
      footer={
        <Button
          type="submit"
          form={FORM_ID}
          // Tidak pernah `disabled`: fokus tidak jatuh ke <body> (R8); submit dijaga di formulir.
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
            'Simpan dompet'
          )}
        </Button>
      }
    >
      <Form
        ruang={ruang}
        existingNames={existingNames}
        onSubmit={guarded}
        nameRef={nameRef}
        onDone={(name) => {
          toast({ message: `Dompet ${name} ditambahkan di ${RUANG_NAME[ruang]}` });
          onOpenChange(false);
        }}
      />
    </Sheet>
  );
}

/** Pembungkus prototipe: simpan ke store demo (tanggal buka = hari ini demo). */
export function DemoAddAccountSheet({
  open,
  onOpenChange,
  state,
  store,
  ruang,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: DemoState;
  store: DemoStore;
  ruang: Ruang;
  today: IsoDate;
}) {
  return (
    <AddAccountSheet
      open={open}
      onOpenChange={onOpenChange}
      ruang={ruang}
      existingNames={state.accounts.filter((a) => a.ruang === ruang).map((a) => a.name)}
      onSubmit={(input) => {
        const ownerId = ruang === 'pribadi' ? (state.members[0]?.id ?? null) : null;
        store.addAccount(
          {
            ruang,
            ownerId,
            name: input.name,
            pocket: input.pocket,
            walletType: input.walletType,
            openedOn: today,
          },
          input.openingBalance,
        );
        return Promise.resolve({ ok: true });
      }}
    />
  );
}
