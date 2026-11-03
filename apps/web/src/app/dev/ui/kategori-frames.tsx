'use client';

import type { Route } from 'next';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AccountHistoryView } from '@/features/dompet/account-history-view';
import { AccountListView } from '@/features/dompet/account-list-view';
import { AddAccountSheet } from '@/features/dompet/add-account-sheet';
import { AddWalletButton } from '@/features/dompet/add-wallet-button';
import { ArchiveDialog } from '@/features/kategori/archive-dialog';
import { CategoryForm, type CategoryFormMode } from '@/features/kategori/category-form';
import { CategoryList } from '@/features/kategori/category-list';
import type { AccountVM, CategoryVM, LedgerErrorCode } from '@/features/ledger/types';

/**
 * Bingkai S6-K1/K2 (Menu → Kategori) dan Dompet nyata (daftar, kosong, riwayat, Tambah dompet)
 * dengan komponen yang sama dengan layar nyata, di atas VM statis dan aksi palsu: tanpa server.
 * Untuk tinjauan desain 320/390/1280, terang dan gelap.
 */

const noop = () => undefined;
const href = (id: string) => `/pribadi/dompet/${id}` as Route;

const cat = (over: Partial<CategoryVM> & Pick<CategoryVM, 'id' | 'name'>): CategoryVM => ({
  parentId: null,
  type: 'expense',
  icon: 'Tag',
  archived: false,
  ...over,
});

const CATEGORIES: CategoryVM[] = [
  cat({ id: 'k-1', name: 'Belanja Dapur', icon: 'ShoppingCart' }),
  cat({ id: 'k-2', name: 'Sayur & Buah', icon: 'Carrot', parentId: 'k-1' }),
  cat({
    id: 'k-3',
    name: 'Daging, Ikan, dan Bahan Pokok Bulanan',
    icon: 'BowlFood',
    parentId: 'k-1',
  }),
  cat({ id: 'k-4', name: 'Makan di Luar', icon: 'ForkKnife' }),
  cat({ id: 'k-5', name: 'Transportasi', icon: 'Motorcycle' }),
  cat({
    id: 'k-6',
    name: 'Kopi dan Camilan dengan Nama yang Sangat Panjang Sekali',
    icon: 'Coffee',
  }),
  cat({ id: 'k-7', name: 'Gaji', type: 'income', icon: 'Briefcase' }),
  cat({ id: 'k-8', name: 'Kontribusi Farida', type: 'income', icon: 'HandCoins' }),
];

function pick<T extends { id: string }>(list: readonly T[], id: string): T {
  const found = list.find((x) => x.id === id);
  if (!found) throw new Error(`bingkai: ${id} tidak ada`);
  return found;
}

const ACCOUNTS: AccountVM[] = [
  {
    id: 'a-1',
    name: 'BCA Operasional Rumah Tangga',
    pocket: 'operasional',
    walletType: 'bank',
    openedOn: '2026-09-01',
    archived: false,
    balance: 12_345_678_900,
  },
  {
    id: 'a-2',
    name: 'Tunai',
    pocket: 'operasional',
    walletType: 'cash',
    openedOn: '2026-09-01',
    archived: false,
    balance: 75_000,
  },
  {
    id: 'a-3',
    name: 'Tabungan Nikah',
    pocket: 'tabungan',
    walletType: 'ewallet',
    openedOn: '2026-09-01',
    archived: false,
    balance: 4_000_000,
  },
  {
    id: 'a-4',
    name: 'Kas Kantor',
    pocket: 'kantor',
    walletType: 'bank',
    openedOn: '2026-09-01',
    archived: false,
    balance: 900_000,
  },
];

function Frame({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div data-frame={id} className="flex flex-col gap-3">
      <h3 className="text-label font-bold text-text-soft">{title}</h3>
      {children}
    </div>
  );
}

const fail = (code: LedgerErrorCode) => () => Promise.resolve({ ok: false as const, code });
const ok = () => Promise.resolve({ ok: true as const });

function FormFrame({
  label,
  mode,
  submit,
  ruang = 'pribadi',
}: {
  label: string;
  mode: CategoryFormMode;
  submit: () => Promise<{ ok: true } | { ok: false; code: LedgerErrorCode }>;
  ruang?: 'pribadi' | 'bersama';
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <CategoryForm
        open={open}
        onOpenChange={setOpen}
        ruang={ruang}
        mode={mode}
        categories={CATEGORIES}
        onSubmit={submit}
        onArchive={noop}
      />
    </>
  );
}

function ArchiveFrame({
  label,
  name,
  childCount,
}: {
  label: string;
  name: string;
  childCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="danger"
        onClick={() => {
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <ArchiveDialog
        open={open}
        onOpenChange={setOpen}
        name={name}
        ruang="pribadi"
        childCount={childCount}
        onConfirm={noop}
      />
    </>
  );
}

function AddWalletFrame() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <AddWalletButton
        onAdd={() => {
          setOpen(true);
        }}
      />
      <AddAccountSheet
        open={open}
        onOpenChange={setOpen}
        ruang="pribadi"
        existingNames={['BCA']}
        onSubmit={ok}
      />
    </>
  );
}

export function KategoriFrames() {
  return (
    <div className="flex flex-col gap-6">
      <Frame id="k-daftar" title="Kategori · Daftar (nama panjang, anak bersarang)">
        <div className="flex max-w-180 flex-col gap-3">
          <CategoryList
            ruang="pribadi"
            type="expense"
            categories={CATEGORIES}
            onOpen={noop}
            onAdd={noop}
          />
        </div>
      </Frame>
      <Frame id="k-pemasukan" title="Kategori · Pemasukan">
        <div className="flex max-w-180 flex-col gap-3">
          <CategoryList
            ruang="bersama"
            type="income"
            categories={CATEGORIES}
            onOpen={noop}
            onAdd={noop}
          />
        </div>
      </Frame>
      <Frame id="k-kosong" title="Kategori · Kosong (semua diarsipkan)">
        <div className="flex max-w-180 flex-col gap-3">
          <CategoryList ruang="pribadi" type="expense" categories={[]} onOpen={noop} onAdd={noop} />
        </div>
      </Frame>
      <Frame id="k-sheet" title="Kategori · Sheet tambah/ubah (tekan tombol)">
        <div className="flex flex-wrap gap-2">
          <FormFrame label="Tambah kategori" mode={{ kind: 'add', type: 'expense' }} submit={ok} />
          <FormFrame
            label="Ubah (punya anak, Induk nonaktif)"
            mode={{ kind: 'edit', category: pick(CATEGORIES, 'k-1') }}
            submit={ok}
          />
          <FormFrame
            label="Ubah → galat nama ganda"
            mode={{ kind: 'edit', category: pick(CATEGORIES, 'k-4') }}
            submit={fail('name_taken')}
            ruang="bersama"
          />
          <FormFrame
            label="Ubah → galat dua tingkat"
            mode={{ kind: 'edit', category: pick(CATEGORIES, 'k-5') }}
            submit={fail('category_depth')}
          />
          <FormFrame
            label="Tambah → galat jaringan"
            mode={{ kind: 'add', type: 'income' }}
            submit={fail('network')}
          />
        </div>
      </Frame>
      <Frame id="k-arsip" title="Kategori · Dialog arsip (tekan tombol)">
        <div className="flex flex-wrap gap-2">
          <ArchiveFrame label="Arsipkan tanpa anak" name="Transportasi" childCount={0} />
          <ArchiveFrame label="Arsipkan dengan 2 subkategori" name="Belanja Dapur" childCount={2} />
        </div>
      </Frame>
      <Frame id="d-daftar" title="Dompet nyata · Daftar (saldo panjang, Kantor)">
        <AccountListView
          ruang="pribadi"
          accounts={ACCOUNTS}
          accountHref={href}
          renderAdd={(className) => <AddWalletButton onAdd={noop} className={className} />}
        />
      </Frame>
      <Frame id="d-kosong" title="Dompet nyata · Kosong (Bersama)">
        <AccountListView
          ruang="bersama"
          accounts={[]}
          accountHref={href}
          renderAdd={(className) => <AddWalletButton onAdd={noop} className={className} />}
        />
      </Frame>
      <Frame id="d-riwayat" title="Dompet nyata · Riwayat">
        <AccountHistoryView
          account={pick(ACCOUNTS, 'a-1')}
          groups={[
            {
              key: '2026-10-30',
              label: 'Kemarin',
              total: -12_345_678_900,
              rows: [
                {
                  id: 'e-1',
                  href: href('e-1'),
                  iconName: 'Belanja Dapur',
                  entryKind: 'expense',
                  label: 'Belanja bulanan dengan deskripsi yang sangat panjang sekali',
                  meta: 'Belanja Dapur · BCA Operasional Rumah Tangga',
                  value: -12_345_678_900,
                  kind: 'expense',
                },
              ],
            },
          ]}
          opening={[{ id: 'e-0', href: href('e-0'), value: 1_000_000 }]}
          dompetHref={href('')}
        />
      </Frame>
      <Frame id="d-tambah" title="Dompet nyata · Sheet Tambah dompet (tekan tombol)">
        <div>
          <AddWalletFrame />
        </div>
      </Frame>
    </div>
  );
}
