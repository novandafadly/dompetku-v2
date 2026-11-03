'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { CheckIcon } from '@/components/ui/icons/check';
import { focusRing } from '@/components/ui/styles';

/**
 * S6-B1 "Tidak ada pengeluaran hari ini" (docs/design/s6-bingkai.md). Tombol sekunder lebar
 * penuh 44 px, hanya bila hari ini belum ada pengeluaran hidup di ruang ini dan hari belum
 * ditandai. Ada pengeluaran hari ini = tidak merender apa pun (tombol maupun status tanda), walau
 * hari sudah ditandai; fase lokal direset agar "done" tidak bertahan melewati refresh.
 * Sesudah sukses tombol diganti baris status (`role="status"`, `tabindex="-1"`) yang menerima
 * fokus agar fokus tidak jatuh ke `<body>`. Selama memanggil server: `aria-busy` +
 * `aria-disabled` (bukan `disabled`, fokus tetap di tombol); klik ulang diabaikan.
 * Tanggal ditentukan server (`app.today()` WIB), bukan di sini.
 */

const DONE = 'Hari ini tercatat tanpa pengeluaran.';
const FAILED = 'Belum bisa ditandai. Periksa koneksi lalu coba lagi.';

export function NoSpendButton({
  hasExpense,
  noSpendMarked,
  onMark,
}: {
  /** Ada pengeluaran hidup hari ini di ruang ini (server, WIB). */
  hasExpense: boolean;
  noSpendMarked: boolean;
  /**
   * Tandai hari ini di server (Server Action terikat ruang, boleh dikirim dari page server).
   * `ok: false` atau lemparan = gagal.
   */
  onMark: () => Promise<{ ok: boolean }>;
}) {
  const [phase, setPhase] = useState<'idle' | 'busy' | 'failed' | 'done'>('idle');
  const statusRef = useRef<HTMLParagraphElement>(null);
  const alertId = useId();
  const focusStatus = useRef(false);

  useEffect(() => {
    if (phase !== 'done' || !focusStatus.current) return;
    focusStatus.current = false;
    statusRef.current?.focus();
  }, [phase]);

  // Pengeluaran tercatat sesudah ditandai (refresh mempertahankan state klien): reset fase.
  if (hasExpense && phase !== 'idle') setPhase('idle');

  if (hasExpense) return null;
  if (phase === 'done' || noSpendMarked) {
    return (
      <p
        ref={statusRef}
        role="status"
        tabIndex={-1}
        className={`flex min-h-11 items-center gap-2 rounded-lg text-label font-semibold text-text-soft ${focusRing}`}
      >
        <CheckCircleIcon size={18} weight="fill" className="shrink-0 text-accent-text" />
        <span>{DONE}</span>
      </p>
    );
  }
  const busy = phase === 'busy';
  const mark = async () => {
    if (busy) return;
    setPhase('busy');
    let ok = false;
    try {
      ok = (await onMark()).ok;
    } catch {
      ok = false;
    }
    if (ok) focusStatus.current = true;
    setPhase(ok ? 'done' : 'failed');
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        aria-describedby={phase === 'failed' ? alertId : undefined}
        onClick={() => {
          void mark();
        }}
      >
        {busy ? (
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        ) : (
          <CheckIcon size={18} weight="bold" />
        )}
        Tidak ada pengeluaran hari ini
      </Button>
      {phase === 'failed' ? (
        <p id={alertId} role="alert" className="text-label font-semibold text-danger">
          {FAILED}
        </p>
      ) : null}
    </div>
  );
}
