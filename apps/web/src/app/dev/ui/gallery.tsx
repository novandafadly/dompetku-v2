'use client';

import { PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import type { Rupiah } from '@dompetku/domain';
import { Button } from '@/components/ui/button';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { DemoBanner } from '@/components/ui/demo-banner';
import { IconButton } from '@/components/ui/icon-button';
import { LedgerColumn } from '@/components/ui/ledger-column';
import { MoneyInput } from '@/components/ui/money-input';
import { MoneyText } from '@/components/ui/money-text';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/state';
import { Toaster, toast } from '@/components/ui/toast';

const plainSamples = ['1111111', '0000000', '1.250.000', '8888888'];

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-3 border-t border-hairline pt-4">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

export function Gallery() {
  const [chip, setChip] = useState('semua');
  const [segment, setSegment] = useState('minggu');
  const [amount, setAmount] = useState<Rupiah | null>(35000);
  const [sheetOpen, setSheetOpen] = useState<'pribadi' | 'bersama' | null>(null);

  return (
    <>
      <DemoBanner />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
        <h1 className="text-xl font-semibold text-text">Primitif UI</h1>

        <section id="angka" className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text">Angka</h2>
          <ul>
            {plainSamples.map((s) => (
              <li key={s}>
                <span className="num text-text">{s}</span>
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-2">
            <li>
              <MoneyText value={0} />
            </li>
            <li>
              <MoneyText value={-35000} kind="expense" />
            </li>
            <li>
              <MoneyText value={2500000} kind="income" />
            </li>
            <li>
              <MoneyText value={1250000} compact />
            </li>
            <li data-testid="angka-besar">
              <MoneyText value={12345678900} size="hero" />
            </li>
          </ul>
        </section>

        <Section title="Tombol">
          <Row>
            <Button>Simpan</Button>
            <Button variant="secondary">Batal</Button>
            <Button variant="ghost">Lewati</Button>
            <Button variant="danger">Hapus</Button>
          </Row>
          <Row>
            <Button disabled>Nonaktif</Button>
            <Button variant="secondary" disabled>
              Nonaktif
            </Button>
            <Button loading>Memuat</Button>
          </Row>
          <p className="text-sm text-text-muted">Tekan Tab untuk melihat cincin fokus.</p>
          <Row>
            <IconButton label="Tambah" icon={<PlusIcon size={24} />} />
            <IconButton label="Hapus" icon={<TrashIcon size={24} />} disabled />
          </Row>
        </Section>

        <Section title="Pilihan">
          <ChipGroup label="Filter transaksi">
            {[
              ['semua', 'Semua'],
              ['operasional', 'Operasional'],
              ['kantor', 'Kantor'],
            ].map(([value, label]) => (
              <Chip
                key={value}
                selected={chip === value}
                onSelect={() => {
                  setChip(value ?? 'semua');
                }}
              >
                {label}
              </Chip>
            ))}
            <Chip selected={false} onSelect={() => undefined} disabled>
              Nonaktif
            </Chip>
          </ChipGroup>
          <SegmentedControl
            label="Rentang"
            value={segment}
            onChange={setSegment}
            items={[
              { value: 'minggu', label: 'Minggu' },
              { value: 'bulan', label: 'Bulan' },
              { value: 'tahun', label: 'Tahun' },
            ]}
          />
        </Section>

        <Section title="Input nominal">
          <MoneyInput label="Nominal" value={amount} onChange={setAmount} />
          <MoneyInput
            label="Nominal (nonaktif)"
            value={12000}
            onChange={() => undefined}
            disabled
          />
        </Section>

        <Section title="Sheet dan toast">
          <Row>
            <Button
              variant="secondary"
              onClick={() => {
                setSheetOpen('pribadi');
              }}
            >
              Sheet pribadi
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setSheetOpen('bersama');
              }}
            >
              Sheet bersama
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                toast({
                  message: 'Transaksi dihapus',
                  action: { label: 'Urungkan', onAction: () => undefined },
                });
              }}
            >
              Tampilkan toast
            </Button>
          </Row>
          <Sheet
            open={sheetOpen !== null}
            onOpenChange={(o) => {
              if (!o) setSheetOpen(null);
            }}
            title="Catat transaksi"
            tint={sheetOpen ?? undefined}
          >
            <MoneyInput label="Nominal" value={amount} onChange={setAmount} />
          </Sheet>
        </Section>

        <Section title="Kolom buku kas">
          <LedgerColumn
            rows={[
              { label: 'Pemasukan', value: 8500000 },
              { label: 'Belanja', value: 1250000, op: 'minus' },
              { label: 'Tagihan', value: 450000, op: 'minus' },
            ]}
            total={6800000}
          />
        </Section>

        <Section title="Memuat, kosong, gagal">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-6 w-full" />
          </div>
          <EmptyState
            title="Belum ada transaksi"
            description="Catat pengeluaran pertamamu."
            action={<Button>Catat</Button>}
          />
          <ErrorState
            description="Data tidak bisa dimuat."
            onRetry={() => {
              toast({ message: 'Mencoba lagi' });
            }}
          />
        </Section>
      </main>
      <Toaster />
    </>
  );
}
