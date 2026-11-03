'use client';

import type { Rupiah } from '@dompetku/domain';
import { Suspense, useState, type ComponentType } from 'react';
import { useOpenedOnce } from '@/components/ui/use-opened-once';
import { CatatPlaceholder } from '@/features/catat/catat-placeholder';
import type { CatatSheetSlotProps } from '@/features/shell/catat';
import { RUANG_LABEL } from '@/features/shell/hrefs';

/** Props sheet Catat yang dimuat malas: props slot shell + nominal yang diketik lebih awal. */
export type LazySheetProps = CatatSheetSlotProps & { initialAmount: Rupiah | null };

/**
 * Slot sheet Catat untuk shell prototipe dan nyata: sheet (`Sheet`, React.lazy) dipasang hanya
 * sesudah dibuka sekali; selama kodenya dimuat tampil placeholder ringan yang langsung menerima
 * nominal. Mode ditentukan shell yang memasang: slot ini tidak mengenal data demo maupun server.
 */
export function CatatSlot<E extends object>({
  Sheet,
  extra,
  ...props
}: CatatSheetSlotProps & {
  Sheet: ComponentType<LazySheetProps & E>;
  /** Props tambahan sheet dari shell (mis. opsi ruang dari server di mode nyata). */
  extra: E;
}) {
  // Nominal yang diketik di placeholder sebelum sheet termuat; dikosongkan tiap kali dibuka.
  const [early, setEarly] = useState<Rupiah | null>(null);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setEarly(null);
  }
  if (!useOpenedOnce(props.open)) return null;
  const placeholder = props.open ? (
    <CatatPlaceholder
      title={`Pengeluaran · ${RUANG_LABEL[props.ruang]}`}
      tint={props.ruang}
      amount={early}
      onAmountChange={setEarly}
      onClose={() => {
        props.onOpenChange(false);
        props.returnFocus?.focus();
      }}
    />
  ) : null;
  return (
    <Suspense fallback={placeholder}>
      <Sheet {...props} {...extra} initialAmount={early} />
    </Suspense>
  );
}
