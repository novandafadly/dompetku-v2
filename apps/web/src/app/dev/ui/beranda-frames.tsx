'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { PlusIcon } from '@/components/ui/icons/plus';
import { NoSpendButton } from '@/features/beranda/no-spend-button';
import { SafeToSpendCard, SafeToSpendEmptyView } from '@/features/beranda/safe-to-spend-view';

/**
 * Bingkai S6-B1 dan kartu utama mode nyata (tanpa baris tagihan/anggaran) di atas VM statis:
 * tanpa store demo, tanpa server. Untuk tinjauan desain 320/390/1280, terang dan gelap.
 */

const TODAY = '2026-10-22';
const never = () => new Promise<{ ok: boolean }>(() => undefined);
const ok = () => Promise.resolve({ ok: true });
const fail = () => Promise.resolve({ ok: false });

function Frame({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div data-frame={id} className="flex flex-col gap-3">
      <h3 className="text-label font-bold text-text-soft">{title}</h3>
      {children}
    </div>
  );
}

export function BerandaFrames() {
  return (
    <div className="flex flex-col gap-6">
      <Frame id="b1-idle" title="S6-B1 · belum ditandai (tekan: sukses)">
        <SafeToSpendCard
          ruang="pribadi"
          today={TODAY}
          vm={{
            operasional: 3_250_000,
            billsUntilEom: 0,
            budgetWajibRemaining: 0,
            aman: 3_250_000,
          }}
          showObligations={false}
        />
        <NoSpendButton hasEntry={false} noSpendMarked={false} onMark={ok} />
      </Frame>
      <Frame id="b1-busy" title="S6-B1 · menunggu server (tekan: tetap aria-busy)">
        <NoSpendButton hasEntry={false} noSpendMarked={false} onMark={never} />
      </Frame>
      <Frame id="b1-fail" title="S6-B1 · gagal (tekan: galat role=alert)">
        <NoSpendButton hasEntry={false} noSpendMarked={false} onMark={fail} />
      </Frame>
      <Frame id="b1-done" title="S6-B1 · sudah ditandai">
        <NoSpendButton hasEntry={false} noSpendMarked onMark={ok} />
      </Frame>
      <Frame id="kartu-negatif" title="Kartu nyata · negatif, nominal panjang (Bersama)">
        <SafeToSpendCard
          ruang="bersama"
          today={TODAY}
          vm={{
            operasional: -12_345_678_900,
            billsUntilEom: 0,
            budgetWajibRemaining: 0,
            aman: -12_345_678_900,
          }}
          showObligations={false}
        />
      </Frame>
      <Frame id="kartu-kosong" title="Kartu nyata · belum ada dompet operasional">
        <SafeToSpendEmptyView
          ruang="pribadi"
          today={TODAY}
          action={
            <Button className="self-start">
              <PlusIcon size={18} weight="bold" />
              Tambah dompet
            </Button>
          }
        />
      </Frame>
    </div>
  );
}
