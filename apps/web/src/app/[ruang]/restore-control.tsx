'use client';

import { formatRupiah, type Rupiah } from '@dompetku/domain';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { WarningIcon } from '@/components/ui/icons/warning';
import { WarningCircleIcon } from '@/components/ui/icons/warning-circle';
import { toast } from '@/components/ui/toast';
import { SaldoKurangRow } from '@/features/catat/catat-status';
import { newClientId } from '@/features/catat/client-id';
import type { ActionResult, EntryVM, LedgerErrorCode, Ruang } from '@/features/ledger/types';
import { RUANG_LABEL } from '@/features/shell/hrefs';
import { VOIDED_COPY } from '@/features/transaksi/voided-banner';

/**
 * `Pulihkan` untuk satu entri batal, dipakai banner Detail (S6-D3) dan baris Sampah (S6-S1): satu
 * alur, satu salinan. Satu clientId per sesi pulihkan ("Coba lagi" dan "Tetap pulihkan" memakainya
 * lagi); klik ganda = satu permintaan; `saldo_negatif` → peringatan S6-C3 + `Tetap pulihkan`;
 * `restore_window_closed` → teks lewat 90 hari di tempat tombol; konflik versi → `onConflict`
 * (pemanggil memuat ulang) dan sesi baru. Jaringan putus dan galat lain → pesan `role="alert"`
 * sesuai penyebab (hanya `network` yang menyebut koneksi).
 */

export interface RestoreRequest {
  clientId: string;
  entryId: string;
  expectedVersion: number;
  allowNegative: boolean;
}

export type RestoreFn = (req: RestoreRequest) => Promise<ActionResult<{ version: number }>>;

/** Dompet utama entri: untuk kalimat saldo (`Saldo {dompet} tinggal …`). */
export interface RestoreAccount {
  name: string;
  balance: Rupiah;
}

const NETWORK = { ok: false, error: { code: 'network' } } as const;

/** Saldo dompet utama sesudah entri batal dipulihkan (baris utama dipasang lagi). */
function restoredBalance(entry: EntryVM, account: RestoreAccount): number {
  const out =
    entry.kind === 'expense' ||
    entry.kind === 'transfer' ||
    ((entry.kind === 'space_transfer' || entry.kind === 'adjustment') && entry.direction === 'out');
  return account.balance + (out ? -entry.amount : entry.amount);
}

type RestoreState = 'idle' | 'busy' | 'saldo' | 'closed' | 'galat';

/** Galat pulihkan selain saldo, lewat 90 hari, dan konflik (salinan S6, gaya galat Batalkan). */
export function restoreFailedText(code: LedgerErrorCode): string {
  if (code === 'network') return 'Belum bisa dipulihkan. Periksa koneksi lalu coba lagi.';
  if (code === 'account_archived') return 'Belum bisa dipulihkan. Dompetnya sudah diarsipkan.';
  return 'Belum bisa dipulihkan. Ada kendala di server.';
}

export function RestoreControl({
  ruang,
  entry,
  account,
  restore,
  onRestored,
  onConflict,
  labelSuffix,
}: {
  ruang: Ruang;
  entry: EntryVM;
  /** Dompet utama entri bila diketahui (tanpa ini peringatan saldo tidak dirender). */
  account?: RestoreAccount | undefined;
  restore: RestoreFn;
  /** Sesudah berhasil (toast sudah tampil): pemanggil mengatur fokus. */
  onRestored?: (() => void) | undefined;
  /** Konflik versi: pemanggil memuat ulang datanya. */
  onConflict?: (() => void) | undefined;
  /** Ditambahkan ke nama tombol pembaca layar (`Pulihkan {suffix}`); teks terlihat tetap. */
  labelSuffix?: string | undefined;
}) {
  const [clientId, setClientId] = useState(newClientId);
  const [state, setState] = useState<RestoreState>('idle');
  const [negative, setNegative] = useState(false);
  const [galat, setGalat] = useState<LedgerErrorCode>('network');
  const busy = useRef(false);
  const closedRef = useRef<HTMLParagraphElement>(null);
  const noteId = useId();

  // Tombol diganti teks lewat 90 hari: fokus pindah ke teks itu, tidak jatuh ke <body>.
  useEffect(() => {
    if (state === 'closed') closedRef.current?.focus();
  }, [state]);

  async function run(allowNegative: boolean) {
    if (busy.current) return;
    busy.current = true;
    setState('busy');
    setNegative(allowNegative);
    let res: Awaited<ReturnType<RestoreFn>>;
    try {
      res = await restore({
        clientId,
        entryId: entry.id,
        expectedVersion: entry.version,
        allowNegative,
      });
    } catch {
      res = NETWORK;
    } finally {
      busy.current = false;
    }
    if (res.ok) {
      // Antar ruang dipulihkan berpasangan (S7-D1): kedua ruang disebut.
      const where = entry.kind === 'space_transfer' ? 'Pribadi dan Bersama' : RUANG_LABEL[ruang];
      toast({ message: `Dipulihkan di ${where} · ${formatRupiah(entry.amount)}` });
      // Sibuk selalu dilepas: bila muat ulang daftar/Detail gagal, tombol tidak tertahan. Klik lagi
      // memakai clientId yang sama (server mengembalikan hasil yang sama, tanpa entri ganda).
      setState('idle');
      onRestored?.();
      return;
    }
    const code = res.error.code;
    if (code === 'saldo_negatif') setState('saldo');
    else if (code === 'restore_window_closed') setState('closed');
    else if (code === 'conflict') {
      // Entri berubah di tab/perangkat lain: muat ulang; percobaan berikutnya sesi baru.
      setClientId(newClientId());
      setState('idle');
      onConflict?.();
    } else {
      setGalat(code);
      setState('galat');
    }
  }

  if (state === 'closed') {
    return (
      <p
        ref={closedRef}
        tabIndex={-1}
        className="flex items-center gap-1.5 text-meta font-semibold text-warning outline-none"
      >
        <WarningIcon size={16} weight="fill" className="shrink-0" />
        {VOIDED_COPY.closed}
      </p>
    );
  }

  const saldoShown = state === 'saldo' || (state === 'busy' && negative);
  const note =
    saldoShown && account !== undefined ? (
      <SaldoKurangRow id={noteId}>
        {`Saldo ${account.name} tinggal ${formatRupiah(account.balance)}. Kalau dipulihkan, saldonya jadi ${formatRupiah(restoredBalance(entry, account))}.`}
      </SaldoKurangRow>
    ) : state === 'galat' ? (
      <p
        id={noteId}
        role="alert"
        className="flex items-start gap-1.5 text-meta font-semibold text-danger"
      >
        <WarningCircleIcon size={16} weight="fill" className="mt-px shrink-0" />
        <span className="min-w-0 text-pretty">{restoreFailedText(galat)}</span>
      </p>
    ) : null;

  const saving = state === 'busy';
  const text = state === 'saldo' ? 'Tetap pulihkan' : VOIDED_COPY.restore;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-busy={saving || undefined}
        aria-disabled={saving || undefined}
        aria-describedby={note === null ? undefined : noteId}
        {...(labelSuffix === undefined ? {} : { 'aria-label': `${text} ${labelSuffix}` })}
        onClick={() => {
          if (!saving) void run(state === 'saldo');
        }}
      >
        {text}
      </Button>
      {note === null ? null : <div className="basis-full">{note}</div>}
    </>
  );
}
