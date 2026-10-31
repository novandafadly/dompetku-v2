'use client';

import type { Account, Pocket } from '@dompetku/demo-data';
import type { Rupiah } from '@dompetku/domain';
import { useId, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError, FieldHint, FieldLabel } from '@/components/ui/field';
import { MoneyInput } from '@/components/ui/money-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
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
  const pocketLabel = useId();
  const pocketError = useId();
  const typeLabel = useId();
  const openingHint = useId();
  const pocketRef = useRef<HTMLDivElement>(null);
  const pockets: Pocket[] =
    ruang === 'pribadi' ? ['operasional', 'tabungan', 'kantor'] : ['operasional', 'tabungan'];

  function submit() {
    const trimmed = name.trim();
    const next: Errors = {};
    if (trimmed === '') next.name = 'Nama dompet wajib diisi.';
    else {
      const same = state.accounts.find(
        (a) => a.ruang === ruang && a.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (same) next.name = `Dompet bernama ${same.name} sudah ada di ${RUANG_NAME[ruang]}.`;
    }
    if (pocket === null) next.pocket = 'Pilih jenis dompet.';
    setErrors(next);
    // Fokus pindah ke kolom pertama yang salah.
    if (next.name !== undefined) {
      nameRef.current?.focus();
      return;
    }
    if (pocket === null) {
      pocketRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus();
      return;
    }
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
      className="flex flex-col gap-3"
    >
      <TextField
        label="Nama"
        value={name}
        onChange={setName}
        error={errors.name}
        placeholder="Contoh: BCA, Tunai"
        autoComplete="off"
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
      title={`Tambah dompet · ${RUANG_NAME[ctx.ruang]}`}
      titleContent={
        <>
          Tambah dompet
          <SpaceTag space={ctx.ruang} />
        </>
      }
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
