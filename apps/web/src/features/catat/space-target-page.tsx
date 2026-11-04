'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { CheckIcon } from '@/components/ui/icons/check';
import { WalletIcon } from '@/components/ui/icons/wallet';
import { tile } from '@/components/ui/styles';
import type { Ruang } from '@/features/ledger/types';
import type { CrossTargets } from './use-catat';

/**
 * Isi halaman dalam sheet `Ke dompet di {Ruang tujuan}` (S7-C1). Modul ini dimuat malas, hanya saat
 * "Ruang lain…" diketuk (R28: tambahan UI S7 tidak masuk JS muat awal). Baris tanpa saldo, supaya
 * Bersama tidak tampil di layar Pribadi lewat angka dan sebaliknya.
 */

const POCKET: Record<'operasional' | 'tabungan' | 'kantor', string> = {
  operasional: 'Operasional',
  tabungan: 'Tabungan',
  kantor: 'Kantor',
};

export default function SpaceTargetPage({
  targets,
  targetLabel,
  value,
  onPick,
  onRetry,
  onAddAccount,
}: {
  targets: CrossTargets;
  targetLabel: string;
  value: string | undefined;
  onPick: (accountId: string) => void;
  onRetry: () => void;
  /** Ruang tujuan tanpa dompet: tutup Catat dan buka Tambah dompet di ruang itu (S6-C6). */
  onAddAccount: (ruang: Ruang) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const ready = targets.status === 'ready' && targets.accounts.length > 0;

  // Fokus ke dompet yang terpilih, atau yang pertama, begitu daftar tampil.
  useEffect(() => {
    if (!ready) return;
    const radios = listRef.current?.querySelectorAll<HTMLElement>('[role="radio"]');
    const chosen = listRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (chosen ?? radios?.[0])?.focus();
  }, [ready]);

  // Panah hanya memindah fokus (memilih = menutup halaman, jadi tidak otomatis).
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const down = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    const up = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
    if (!down && !up) return;
    const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
    const at = radios.findIndex((r) => r === document.activeElement);
    if (at === -1) return;
    e.preventDefault();
    radios[(at + (down ? 1 : -1) + radios.length) % radios.length]?.focus();
  };

  if (targets.status === 'loading' || targets.status === 'idle') {
    return (
      <p role="status" className="px-1 py-3 text-label font-semibold text-text-muted">
        Memuat dompet…
      </p>
    );
  }
  if (targets.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-3 py-1">
        <p role="alert" className="text-label font-semibold text-danger">
          Dompet belum bisa dimuat. Periksa koneksi lalu coba lagi.
        </p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Coba lagi
        </Button>
      </div>
    );
  }
  if (targets.accounts.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 pb-1">
        <p role="status" className="text-body font-semibold text-text text-pretty">
          Belum ada dompet di {targetLabel}.
        </p>
        <Button
          className="w-full"
          onClick={() => {
            onAddAccount(targets.target);
          }}
        >
          Tambah dompet
        </Button>
      </div>
    );
  }
  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- fokus ada di baris (roving tabindex)
    <div
      ref={listRef}
      role="radiogroup"
      aria-label={`Dompet di ${targetLabel}`}
      onKeyDown={onKeyDown}
      className="flex flex-col"
    >
      {targets.accounts.map((a, i) => {
        const selected = a.id === value;
        return (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (value === undefined && i === 0) ? 0 : -1}
            onClick={() => {
              onPick(a.id);
            }}
            className="-mx-4 flex min-h-13 items-center gap-3 border-t border-hairline px-4 text-left first:border-t-0 hover-pointer:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus active:bg-hover tablet:-mx-6 tablet:px-6"
          >
            <span aria-hidden="true" className={`size-9 ${tile}`}>
              <WalletIcon size={18} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="block text-body/tight font-semibold break-words text-text">
                {a.name}
              </span>
              <span className="text-meta font-medium text-text-muted">{POCKET[a.pocket]}</span>
            </span>
            <span
              aria-hidden="true"
              className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                selected ? 'border-ruang bg-ruang-tint text-ruang' : 'border-border'
              }`}
            >
              {selected ? <CheckIcon size={12} weight="bold" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
