'use client';

import { useState, type ReactNode } from 'react';
import type { Rupiah } from '@dompetku/domain';
import { Button } from '@/components/ui/button';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { IconButton } from '@/components/ui/icon-button';
import { FlaskIcon } from '@/components/ui/icons/flask';
import { PlusIcon } from '@/components/ui/icons/plus';
import { TrashIcon } from '@/components/ui/icons/trash';
import { MoneyInput } from '@/components/ui/money-input';
import { MoneyText } from '@/components/ui/money-text';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';
import { SpaceTag } from '@/components/ui/space-tag';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/state';
import { heroCard } from '@/components/ui/styles';
import { Toaster, toast } from '@/components/ui/toast';
import { BerandaFrames } from './beranda-frames';
import { CatatFrames } from './catat-frames';
import { DetailFrames } from './detail-frames';
import { TransaksiFrames } from './transaksi-frames';

const plainSamples = ['1111111', '0000000', '1.250.000', '8888888'];

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-3 border-t border-hairline pt-4">
      <h2 className="text-heading font-extrabold text-text">{title}</h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

/** Galeri primitif Panel Malam untuk tinjauan visual dan tes angka tabular (bukan layar produk). */
export function Gallery() {
  const [chip, setChip] = useState('semua');
  const [category, setCategory] = useState<string | null>(null);
  const [segment, setSegment] = useState('minggu');
  const [amount, setAmount] = useState<Rupiah | null>(35000);
  const [sheetOpen, setSheetOpen] = useState<'pribadi' | 'bersama' | null>(null);

  return (
    <>
      <p className="flex items-center justify-center gap-1.5 border-b border-hairline px-4 py-2 text-caption font-semibold text-text-muted">
        <FlaskIcon size={12} />
        Data demo
      </p>
      <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
        <h1 className="text-title font-extrabold text-text">Primitif UI</h1>

        <section id="angka" className="flex flex-col gap-3">
          <h2 className="text-heading font-extrabold text-text">Angka</h2>
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
            <Button variant="text">Pindah ke Bersama</Button>
            <Button variant="danger">Batalkan</Button>
            <Button variant="danger-fill">Hapus</Button>
          </Row>
          <Row>
            <Button disabled>Nonaktif</Button>
            <Button variant="secondary" disabled>
              Nonaktif
            </Button>
            <Button loading>Memuat</Button>
          </Row>
          <p className="text-meta text-text-muted">Tekan Tab untuk melihat cincin fokus.</p>
          <Row>
            <IconButton label="Tambah" icon={<PlusIcon size={20} weight="bold" />} />
            <IconButton label="Hapus" icon={<TrashIcon size={20} />} disabled />
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
          <ChipGroup label="Kategori contoh">
            {['Kopi & Camilan', 'Transportasi', 'Belanja'].map((name, i) => (
              <Chip
                key={name}
                variant="category"
                selected={category === name}
                focusable={category === null && i === 0}
                onSelect={() => {
                  setCategory(name);
                }}
              >
                {name}
              </Chip>
            ))}
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
          <Row>
            <SpaceTag space="pribadi" />
            <SpaceTag space="bersama" />
          </Row>
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
            <MoneyInput
              label="Nominal"
              value={amount}
              onChange={setAmount}
              size="hero"
              labelHidden
            />
          </Sheet>
        </Section>

        <Section title="Kartu utama">
          <section
            aria-label="Contoh kartu utama"
            className={`flex flex-col gap-3 p-4 ${heroCard}`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-label font-semibold text-text-soft">Aman dipakai sampai 31 Okt</p>
              <SpaceTag space="pribadi" />
            </div>
            <MoneyText value={4250000} size="hero" />
          </section>
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
            title="Data belum bisa dimuat"
            description="Sambungan ke server terputus."
            actions={
              <Button
                onClick={() => {
                  toast({ message: 'Mencoba lagi', tone: 'info' });
                }}
              >
                Coba lagi
              </Button>
            }
          />
        </Section>

        <Section id="catat-s6" title="Catat S6 (bingkai C1–C6)">
          <CatatFrames />
        </Section>

        <Section id="beranda-s6" title="Beranda S6 (bingkai B1, kartu nyata)">
          <BerandaFrames />
        </Section>

        <Section id="transaksi-s6" title="Transaksi nyata (daftar, kosong, gagal muat)">
          <TransaksiFrames />
        </Section>

        <Section id="detail-s6" title="Detail nyata (bingkai D1–D3, dialog Batalkan)">
          <DetailFrames />
        </Section>
      </main>
      <Toaster />
    </>
  );
}
