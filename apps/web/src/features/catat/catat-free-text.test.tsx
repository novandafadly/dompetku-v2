import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AccountVM, CategoryVM } from '@/features/ledger/types';
import { CatatSheet } from './catat-sheet';
import type { CatatSource, FreeTextOutcome, SaveOutcome } from './source';

const ACCOUNTS: AccountVM[] = [
  {
    id: 'acc-bca',
    name: 'BCA',
    walletType: 'bank',
    pocket: 'operasional',
    balance: 2_000_000,
    openedOn: '2026-01-01',
    archived: false,
  },
  {
    id: 'acc-gopay',
    name: 'GoPay',
    walletType: 'ewallet',
    pocket: 'operasional',
    balance: 500_000,
    openedOn: '2026-01-01',
    archived: false,
  },
];

const CATEGORIES: CategoryVM[] = [
  {
    id: 'cat-makan',
    name: 'Makan & Minum',
    type: 'expense',
    icon: 'ForkKnife',
    parentId: null,
    archived: false,
  },
  {
    id: 'cat-gaji',
    name: 'Gaji',
    type: 'income',
    icon: 'Wallet',
    parentId: null,
    archived: false,
  },
];

function makeSource(opts?: {
  withFreeText?: boolean;
  parseFreeText?: (ruang: 'pribadi' | 'bersama', text: string) => Promise<FreeTextOutcome>;
  save?: CatatSource['save'];
}): CatatSource {
  const saveFn =
    opts?.save ??
    vi.fn<CatatSource['save']>().mockResolvedValue({
      ok: true,
      entryId: 'e-1',
      version: 1,
      replayed: false,
      toast: 'Tercatat',
    } satisfies SaveOutcome);
  const base: CatatSource = {
    ruangLabel: { pribadi: 'Pribadi', bersama: 'Bersama' },
    options: () => ({ accounts: ACCOUNTS, categories: CATEGORIES, defaultAccountId: 'acc-bca' }),
    chips: (_r, type) => CATEGORIES.filter((c) => c.type === type),
    spaceTransferTargets: () => [],
    save: saveFn,
    undo: () => Promise.resolve(true),
  };
  if (opts?.withFreeText !== false) {
    base.parseFreeText =
      opts?.parseFreeText ??
      vi.fn().mockResolvedValue({
        ok: true,
        preview: {
          type: 'expense',
          amount: 35_000,
          description: 'makan siang',
          accountId: 'acc-gopay',
          categoryId: 'cat-makan',
          occurredOn: '2026-11-23',
          source: 'rules',
        },
      } satisfies FreeTextOutcome);
  }
  return base;
}

describe('CatatSheet — Ketik cepat (S17)', () => {
  it('tidak menampilkan Ketik cepat saat source tidak memiliki parseFreeText (prototipe)', () => {
    render(
      <CatatSheet
        open
        onOpenChange={() => undefined}
        ruang="pribadi"
        source={makeSource({ withFreeText: false })}
        today="2026-11-24"
        keypad="os"
      />,
    );
    expect(screen.queryByLabelText('Ketik cepat')).toBeNull();
  });

  it('mengisi draf dan menampilkan banner konfirmasi tanpa pernah auto-simpan', async () => {
    const user = userEvent.setup();
    const save = vi.fn<CatatSource['save']>().mockResolvedValue({
      ok: true,
      entryId: 'e-1',
      version: 1,
      replayed: false,
      toast: 'Tercatat',
    });
    const parseFreeText = vi.fn().mockResolvedValue({
      ok: true,
      preview: {
        type: 'expense',
        amount: 35_000,
        description: 'makan siang',
        accountId: 'acc-gopay',
        categoryId: 'cat-makan',
        occurredOn: '2026-11-23',
        source: 'anthropic',
        quota: { used: 2, limit: 15, remaining: 13, exhausted: false },
      },
    } satisfies FreeTextOutcome);

    render(
      <CatatSheet
        open
        onOpenChange={() => undefined}
        ruang="pribadi"
        source={makeSource({ parseFreeText, save })}
        today="2026-11-24"
        keypad="os"
      />,
    );

    const input = screen.getByLabelText('Ketik cepat');
    await user.type(input, 'makan siang 35rb gopay kemarin{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('free-text-preview')).toBeInTheDocument();
    });
    // Anti auto-simpan: Enter di Ketik cepat tidak pernah memanggil save!
    expect(save).not.toHaveBeenCalled();
    expect(parseFreeText).toHaveBeenCalledWith('pribadi', 'makan siang 35rb gopay kemarin');
    expect(screen.getByTestId('free-text-preview')).toHaveTextContent(
      'Terbaca dengan Claude. Periksa isian di bawah sebelum simpan.',
    );
    expect(screen.getByTestId('free-text-preview')).toHaveTextContent(
      'Sisa bantuan AI hari ini: 13 dari 15.',
    );
    expect(screen.getByLabelText(/^Keterangan/)).toHaveValue('makan siang');

    // Baru sesudah pengguna klik Simpan, save dipanggil dengan nilai hasil pratinjau.
    await user.click(screen.getByRole('button', { name: /Simpan/i }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      type: 'expense',
      amount: 35_000,
      accountId: 'acc-gopay',
      categoryId: 'cat-makan',
      date: '2026-11-23',
      dateChosen: true,
      description: 'makan siang',
    });
  });

  it('menampilkan pesan galat berbahasa Indonesia saat nominal tidak terbaca atau kuota habis', async () => {
    const user = userEvent.setup();
    const parseFreeText = vi.fn().mockResolvedValue({
      ok: false,
      code: 'quota_exceeded',
    } satisfies FreeTextOutcome);

    render(
      <CatatSheet
        open
        onOpenChange={() => undefined}
        ruang="pribadi"
        source={makeSource({ parseFreeText })}
        today="2026-11-24"
        keypad="os"
      />,
    );

    await user.type(screen.getByLabelText('Ketik cepat'), 'beli kopi dua puluh ribu');
    await user.click(screen.getByRole('button', { name: 'Isi' }));

    await waitFor(() => {
      expect(screen.getByTestId('free-text-error')).toHaveTextContent('Kuota AI hari ini habis.');
    });
  });
});
