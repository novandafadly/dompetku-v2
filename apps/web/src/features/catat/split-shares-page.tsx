'use client';

import { formatRupiah, type Rupiah } from '@dompetku/domain';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field-messages';
import { MoneyInput } from '@/components/ui/money-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { PATUNGAN_COPY as C, sharesRemark } from '@/features/patungan/copy';

/**
 * Isi halaman dalam sheet `Pembagian · Bersama` (S12-CT2). Dimuat malas, hanya saat `Ubah
 * pembagian` diketuk (tidak masuk JS Catat awal). Pratinjau satu pembagian/pengurangan; bagian
 * final dihitung SQL saat disimpan. `partnerShare` kosong = sama rata.
 */
export default function SplitSharesPage({
  amount,
  partnerName,
  partnerShare,
  onApply,
}: {
  /** Nominal tagihan; `null` = belum diisi. */
  amount: Rupiah | null;
  partnerName: string;
  /** Bagian anggota lain yang dipilih sekarang; tidak ada = sama rata. */
  partnerShare: Rupiah | undefined;
  onApply: (partnerShare: Rupiah | undefined) => void;
}) {
  const [mode, setMode] = useState<'sama' | 'atur'>(partnerShare === undefined ? 'sama' : 'atur');
  const [share, setShare] = useState<Rupiah | null>(
    partnerShare ?? (amount === null ? null : Math.floor(amount / 2)),
  );
  const [attempted, setAttempted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const total = amount ?? 0;
  const tooMuch = share !== null && share > total;
  const error = tooMuch ? `Bagian ${partnerName} tidak boleh lebih dari total.` : undefined;

  function apply() {
    if (mode === 'sama') {
      onApply(undefined);
      return;
    }
    setAttempted(true);
    if (share === null || tooMuch) {
      inputRef.current?.focus();
      return;
    }
    onApply(share);
  }

  return (
    <div className="flex flex-col gap-4">
      {amount === null || amount <= 0 ? (
        <p className="text-label font-medium text-text-soft">
          Isi nominal tagihan dulu, lalu atur pembagiannya.
        </p>
      ) : (
        <>
          <SegmentedControl
            label={C.howToSplit}
            value={mode}
            onChange={(v) => {
              setMode(v === 'atur' ? 'atur' : 'sama');
            }}
            items={[
              { value: 'sama', label: C.equal },
              { value: 'atur', label: C.custom },
            ]}
          />
          {mode === 'sama' ? (
            <p className="text-label font-semibold text-text">
              {sharesRemark(Math.floor(amount / 2), amount % 2 === 1)}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <MoneyInput
                label={`Bagian ${partnerName}`}
                value={share}
                onChange={setShare}
                inputRef={inputRef}
              />
              {(error ?? (attempted && share === null ? 'Isi bagiannya.' : undefined)) ===
              undefined ? null : (
                <div role="alert">
                  <FieldError id="bagian-error">{error ?? 'Isi bagiannya.'}</FieldError>
                </div>
              )}
              <p className="text-label font-semibold text-text">
                {share === null || tooMuch ? '' : C.myShare(total - share)}
              </p>
            </div>
          )}
          <p className="text-meta font-medium text-text-muted">{`Total ${formatRupiah(amount)}`}</p>
        </>
      )}
      <Button
        onClick={apply}
        aria-disabled={amount === null || amount <= 0 || undefined}
        className="w-full"
      >
        {C.useShares}
      </Button>
    </div>
  );
}
