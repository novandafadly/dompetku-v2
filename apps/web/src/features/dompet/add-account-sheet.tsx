'use client';

import { WarningIcon } from '@phosphor-icons/react';
import type { Account, Pocket } from '@dompetku/demo-data';
import type { Rupiah } from '@dompetku/domain';
import { useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { MoneyInput } from '@/components/ui/money-input';
import { Sheet } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import { POCKET_LABEL, RUANG_NAME, WALLET_TYPE_LABEL, type DompetContext } from './context';

type WalletType = Account['walletType'];
const WALLET_TYPES: WalletType[] = ['bank', 'ewallet', 'cash'];
const FORM_ID = 'tambah-dompet';

interface Errors {
  name?: string;
  pocket?: string;
}

function Form({
  store,
  state,
  ruang,
  today,
  nameRef,
  onDone,
}: DompetContext & { nameRef: RefObject<HTMLInputElement | null>; onDone: () => void }) {
  const [name, setName] = useState('');
  const [pocket, setPocket] = useState<Pocket | null>(null);
  const [walletType, setWalletType] = useState<WalletType>('bank');
  const [opening, setOpening] = useState<Rupiah | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const pockets: Pocket[] =
    ruang === 'pribadi' ? ['operasional', 'tabungan', 'kantor'] : ['operasional', 'tabungan'];

  function submit() {
    const trimmed = name.trim();
    const next: Errors = {};
    if (trimmed === '') next.name = 'Isi nama dompet.';
    else {
      const same = state.accounts.find(
        (a) => a.ruang === ruang && a.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (same) next.name = `Dompet bernama ${same.name} sudah ada di ${RUANG_NAME[ruang]}.`;
    }
    if (pocket === null) next.pocket = 'Pilih jenis dompet.';
    setErrors(next);
    if (next.name !== undefined || pocket === null) return;
    const ownerId = ruang === 'pribadi' ? (state.members[0]?.id ?? null) : null;
    store.addAccount(
      { ruang, ownerId, name: trimmed, pocket, walletType, openedOn: today },
      opening ?? 0,
    );
    toast({ message: `Dompet ${trimmed} ditambahkan di ${RUANG_NAME[ruang]}` });
    onDone();
  }

  return (
    <form
      id={FORM_ID}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <TextField
        label="Nama"
        value={name}
        onChange={setName}
        error={errors.name}
        autoComplete="off"
        inputRef={nameRef}
      />
      <div className="flex flex-col gap-1">
        <span className="text-sm text-text-muted">Jenis</span>
        <ChipGroup label="Jenis">
          {pockets.map((p, i) => (
            <Chip
              key={p}
              selected={pocket === p}
              focusable={pocket === null && i === 0}
              onSelect={() => {
                setPocket(p);
              }}
            >
              {POCKET_LABEL[p]}
            </Chip>
          ))}
        </ChipGroup>
        {errors.pocket ? (
          <p className="flex items-start gap-1 text-sm text-danger">
            <WarningIcon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            {errors.pocket}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm text-text-muted">Tipe</span>
        <ChipGroup label="Tipe">
          {WALLET_TYPES.map((t) => (
            <Chip
              key={t}
              selected={walletType === t}
              onSelect={() => {
                setWalletType(t);
              }}
            >
              {WALLET_TYPE_LABEL[t]}
            </Chip>
          ))}
        </ChipGroup>
      </div>
      <div className="flex flex-col gap-1">
        <MoneyInput label="Saldo hari ini" value={opening} onChange={setOpening} />
        <p className="text-sm text-text-muted">
          Dicatat sebagai &quot;Saldo awal&quot; di riwayat dompet ini. Kosongkan bila belum ada.
        </p>
      </div>
    </form>
  );
}

export function AddAccountSheet({
  open,
  onOpenChange,
  ...ctx
}: DompetContext & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Dompet baru · ${RUANG_NAME[ctx.ruang]}`}
      tint={ctx.ruang}
      initialFocus={nameRef}
      footer={
        <Button type="submit" form={FORM_ID} className="w-full">
          Simpan dompet
        </Button>
      }
    >
      <Form
        {...ctx}
        nameRef={nameRef}
        onDone={() => {
          onOpenChange(false);
        }}
      />
    </Sheet>
  );
}
