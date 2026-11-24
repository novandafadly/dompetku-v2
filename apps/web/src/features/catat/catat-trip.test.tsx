import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TripChoiceVM } from '@/features/ledger/trip-types';
import type { AccountVM, CategoryVM, EntryVM } from '@/features/ledger/types';
import { CatatSheet } from './catat-sheet';
import { EditSheet, type EditInput, type EditSource } from './edit-sheet';
import { MoveSheet } from './move-sheet';
import type { CatatOptions, CatatSource } from './source';

afterEach(cleanup);

const TODAY = '2026-12-14';
const ACCOUNTS: AccountVM[] = [
  {
    id: 'a-bca',
    name: 'BCA',
    pocket: 'operasional',
    walletType: 'bank',
    openedOn: '2026-01-01',
    archived: false,
    balance: 5_000_000,
  },
  {
    id: 'a-kantor',
    name: 'Kas Kantor',
    pocket: 'kantor',
    walletType: 'cash',
    openedOn: '2026-01-01',
    archived: false,
    balance: 1_000_000,
  },
];
const CATEGORIES: CategoryVM[] = [
  {
    id: 'c-makan',
    parentId: null,
    name: 'Makan',
    type: 'expense',
    icon: 'ForkKnife',
    archived: false,
  },
  { id: 'c-gaji', parentId: null, name: 'Gaji', type: 'income', icon: 'Money', archived: false },
];
const TRIP_BALI: TripChoiceVM = {
  id: 't-bali',
  name: 'Bali Des',
  startsOn: '2026-12-12',
  endsOn: '2026-12-19',
};
const TRIP_LOMBOK: TripChoiceVM = {
  id: 't-lombok',
  name: 'Lombok',
  startsOn: '2026-12-13',
  endsOn: '2026-12-16',
};
const TRIP_BERSAMA: TripChoiceVM = {
  id: 't-bersama',
  name: 'Jogja Berdua',
  startsOn: '2026-12-10',
  endsOn: '2026-12-20',
};

function makeSource(
  pribadiTrips: TripChoiceVM[],
  bersamaTrips: TripChoiceVM[] = [],
  saveImpl = vi.fn<CatatSource['save']>().mockResolvedValue({
    ok: true,
    entryId: 'e1',
    version: 1,
    replayed: false,
    toast: 'Tersimpan',
  }),
): { source: CatatSource; save: typeof saveImpl } {
  const pribadi: CatatOptions = {
    accounts: ACCOUNTS,
    categories: CATEGORIES,
    defaultAccountId: 'a-bca',
    ...(pribadiTrips.length === 0 ? {} : { trips: pribadiTrips }),
  };
  const bersama: CatatOptions = {
    accounts: ACCOUNTS.slice(0, 1),
    categories: CATEGORIES,
    defaultAccountId: 'a-bca',
    split: {
      me: { id: 'u1', name: 'Novanda', initial: 'N' },
      partner: { id: 'u2', name: 'Farida', initial: 'F' },
    },
    ...(bersamaTrips.length === 0 ? {} : { trips: bersamaTrips }),
  };
  const source: CatatSource = {
    ruangLabel: { pribadi: 'Pribadi', bersama: 'Bersama' },
    options: (r) => (r === 'pribadi' ? pribadi : bersama),
    chips: (_r, type) => CATEGORIES.filter((c) => c.type === type),
    spaceTransferTargets: () => [],
    save: saveImpl,
    undo: vi.fn().mockResolvedValue(true),
  };
  return { source, save: saveImpl };
}

describe('CatatSheet + Trip (S15-TR14, TR16, TR19)', () => {
  it('saran otomatis K9 saat tepat satu trip memuat tanggal; lepas lalu simpan tanpa trip', async () => {
    const user = userEvent.setup();
    const { source, save } = makeSource([TRIP_BALI]);
    render(
      <CatatSheet
        open
        onOpenChange={vi.fn()}
        ruang="pribadi"
        source={source}
        today={TODAY}
        keypad="os"
      />,
    );
    expect(screen.getByRole('button', { name: 'Trip Bali Des, ganti' })).toBeVisible();
    expect(screen.getByText('Dipilih otomatis karena tanggalnya di rentang trip.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Lepas dari trip Bali Des' }));
    expect(screen.getByRole('button', { name: 'Tambah ke trip' })).toBeVisible();
    // Setelah disentuh pengguna, mengganti tanggal tidak menyarankan ulang.
    await user.selectOptions(screen.getByLabelText('Tanggal'), '2026-12-13');
    expect(screen.queryByRole('button', { name: /Trip Bali Des/ })).toBeNull();

    await user.type(screen.getByLabelText('Nominal'), '50000');
    await user.click(screen.getByRole('radio', { name: 'Makan' }));
    await user.click(screen.getByRole('button', { name: /Simpan/ }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    expect(save.mock.calls[0]?.[0]?.tripId).toBeUndefined();
  });

  it('dua trip tumpang tindih = tanpa saran awal; pengguna bisa memilih di halaman Pilih trip', async () => {
    const user = userEvent.setup();
    const { source, save } = makeSource([TRIP_BALI, TRIP_LOMBOK]);
    render(
      <CatatSheet
        open
        onOpenChange={vi.fn()}
        ruang="pribadi"
        source={source}
        today={TODAY}
        keypad="os"
      />,
    );
    expect(screen.getByRole('button', { name: 'Tambah ke trip' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Tambah ke trip' }));
    await waitFor(() => {
      expect(screen.getByRole('radiogroup', { name: 'Pilih trip' })).toBeVisible();
    });
    await user.click(screen.getByRole('radio', { name: /Lombok/ }));
    expect(screen.getByRole('button', { name: 'Trip Lombok, ganti' })).toBeVisible();

    await user.type(screen.getByLabelText('Nominal'), '75000');
    await user.click(screen.getByRole('radio', { name: 'Makan' }));
    await user.click(screen.getByRole('button', { name: /Simpan/ }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ tripId: 't-lombok' }));
    });
  });

  it('disembunyikan untuk dompet Kantor, Talangan, dan Pemasukan; switchRuang membersihkan trip', async () => {
    const user = userEvent.setup();
    const { source } = makeSource([TRIP_BALI], [TRIP_BERSAMA]);
    render(
      <CatatSheet
        open
        onOpenChange={vi.fn()}
        ruang="pribadi"
        source={source}
        today={TODAY}
        keypad="os"
      />,
    );
    expect(screen.getByRole('button', { name: 'Trip Bali Des, ganti' })).toBeVisible();

    // Talangan menyala → baris Trip hilang.
    await user.click(screen.getByRole('switch', { name: 'Talangan kantor' }));
    expect(screen.queryByRole('button', { name: /Trip Bali Des|Tambah ke trip/ })).toBeNull();
    await user.click(screen.getByRole('switch', { name: 'Talangan kantor' }));
    expect(screen.getByRole('button', { name: 'Tambah ke trip' })).toBeVisible();

    // Dompet Kantor → baris Trip hilang.
    await user.selectOptions(screen.getByLabelText('Dari dompet'), 'a-kantor');
    expect(screen.queryByRole('button', { name: /Tambah ke trip/ })).toBeNull();
    await user.selectOptions(screen.getByLabelText('Dari dompet'), 'a-bca');

    // Pindah ruang ke Bersama → saran baru dari Bersama, tidak membawa Bali Des.
    await user.click(screen.getByRole('button', { name: /Pindah ke Bersama/ }));
    expect(screen.getByRole('button', { name: 'Trip Jogja Berdua, ganti' })).toBeVisible();
    expect(screen.queryByText(/Bali Des/)).toBeNull();

    // Sakelar patungan menyala → catatan K6 tampil.
    await user.click(screen.getByRole('switch', { name: /Dibayar dari dompet pribadi/ }));
    expect(
      screen.getByText(
        'Trip tidak bisa diubah sesudah tagihan dibagi. Batalkan tagihan di Patungan bila salah.',
      ),
    ).toBeVisible();
  });

  it('galat trip_archived tampil di kolom Trip tanpa menutup sheet', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue({ ok: false, code: 'trip_archived' });
    const { source } = makeSource([TRIP_BALI], [], save);
    const onOpenChange = vi.fn();
    render(
      <CatatSheet
        open
        onOpenChange={onOpenChange}
        ruang="pribadi"
        source={source}
        today={TODAY}
        keypad="os"
      />,
    );
    await user.type(screen.getByLabelText('Nominal'), '20000');
    await user.click(screen.getByRole('radio', { name: 'Makan' }));
    await user.click(screen.getByRole('button', { name: /Simpan/ }));
    await waitFor(() => {
      expect(
        screen.getByText('Trip Bali Des sudah diarsipkan. Pilih trip lain atau lepas.'),
      ).toBeVisible();
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe('EditSheet & MoveSheet + Trip (S15-TR15, TR18)', () => {
  const entry: EntryVM = {
    id: 'e1',
    version: 1,
    kind: 'expense',
    occurredOn: TODAY,
    createdAt: `${TODAY}T10:00:00+07:00`,
    createdBy: { id: 'u1', name: 'Novanda', initial: 'N' },
    accountId: 'a-bca',
    accountName: 'BCA',
    amount: 50_000,
    categoryId: 'c-makan',
    categoryName: 'Makan',
    tripId: 't-bali',
    tripName: 'Bali Des',
  };

  it('Ubah: mengganti ke dompet Kantor melepas trip otomatis dengan pesan status dan mengirim tripId null', async () => {
    const user = userEvent.setup();
    const calls: EditInput[] = [];
    const source: EditSource = {
      update: vi.fn().mockImplementation((input: EditInput) => {
        calls.push(input);
        return Promise.resolve({ ok: true, value: { entryId: 'e1', version: 2 } });
      }),
      reload: vi.fn(),
    };
    render(
      <EditSheet
        open
        onOpenChange={vi.fn()}
        ruang="pribadi"
        entry={entry}
        accounts={ACCOUNTS}
        categories={CATEGORIES}
        trips={[TRIP_BALI, TRIP_LOMBOK]}
        today={TODAY}
        me="u1"
        source={source}
      />,
    );
    expect(screen.getByRole('button', { name: 'Trip Bali Des, ganti' })).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Dari dompet'), 'a-kantor');
    expect(
      screen.getByText('Trip dilepas: pengeluaran Kantor atau talangan tidak bisa masuk trip.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.tripId).toBeNull();
  });

  it('Ubah: trip terarsip entri sendiri tampil sebagai {nama} · Diarsipkan dan bisa dilepas', async () => {
    const user = userEvent.setup();
    const update = vi.fn().mockResolvedValue({ ok: true, value: { entryId: 'e1', version: 2 } });
    render(
      <EditSheet
        open
        onOpenChange={vi.fn()}
        ruang="pribadi"
        entry={{ ...entry, tripArchived: true }}
        accounts={ACCOUNTS}
        categories={CATEGORIES}
        trips={[TRIP_LOMBOK]}
        today={TODAY}
        me="u1"
        source={{ update, reload: vi.fn() }}
      />,
    );
    expect(screen.getByText('Bali Des · Diarsipkan')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Lepas dari trip Bali Des' }));
    await user.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ tripId: null }));
    });
  });

  it('MoveSheet menampilkan akibat Trip tidak ikut bila entri bertrip', async () => {
    const user = userEvent.setup();
    render(
      <MoveSheet
        open
        onOpenChange={vi.fn()}
        ruang="pribadi"
        toRuang="bersama"
        entry={entry}
        source={{
          targets: () =>
            Promise.resolve({
              ok: true,
              value: { accounts: ACCOUNTS.slice(0, 1), categories: CATEGORIES },
            }),
          move: vi.fn(),
        }}
        onMoved={vi.fn()}
        onConflict={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Makan' })).toBeVisible();
    });
    await user.click(screen.getByRole('radio', { name: 'Makan' }));
    await user.click(screen.getByRole('button', { name: 'Lanjut' }));
    expect(
      screen.getByText('Trip tidak ikut. Pengeluaran ini keluar dari trip Bali Des.'),
    ).toBeVisible();
  });
});
