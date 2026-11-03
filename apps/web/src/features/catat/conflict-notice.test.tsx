import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ENTRY, LATEST, LATEST_HISTORY, ME, NOW, renderEdit, UUID_V4 } from '@/test/edit-kit';
import { conflictText, relativeTime } from './conflict-notice';

afterEach(cleanup);

async function setAmount(user: ReturnType<typeof userEvent.setup>, digits: string) {
  const input = screen.getByRole('textbox', { name: 'Nominal' });
  await user.clear(input);
  await user.type(input, digits);
}

/** Simpan pertama = konflik versi; berikutnya berhasil. */
function conflictOnce() {
  let calls = 0;
  return () =>
    Promise.resolve(
      ++calls === 1
        ? ({ ok: false, error: { code: 'conflict' } } as const)
        : ({ ok: true, value: { entryId: ENTRY.id, version: 4 } } as const),
    );
}

/** Rupiah memakai spasi tak putus; dibandingkan sesudah spasi diseragamkan. */
const flat = (s: string) => s.replace(/\s+/g, ' ');

const TEXT =
  'Farida mengubah transaksi ini 2 menit lalu (Rp 50.000 → Rp 45.000). Muat versi terbaru untuk melanjutkan.';

describe('ConflictNotice (S6-D2)', () => {
  it('konflik versi menampilkan nilai terbaru', async () => {
    const user = userEvent.setup();
    const { update, reload } = renderEdit({ update: conflictOnce() });
    await setAmount(user, '60000');
    await user.click(screen.getByRole('button', { name: /Simpan perubahan/ }));

    const alert = await screen.findByRole('alert');
    expect(flat(alert.textContent)).toBe(TEXT);
    expect(reload).toHaveBeenCalledWith(ENTRY.id);
    // Daftar ringkas nilai terbaru.
    const latest = screen.getByRole('group', { name: 'Nilai terbaru' });
    expect(latest.textContent.replace(/\s+/g, ' ')).toMatch(/Nominal ?Rp 45\.000/);
    expect(latest.textContent).toContain('Tunai');
    expect(latest.textContent).toContain('Kesehatan');
    // Fokus ke Muat ulang; tidak pernah menimpa diam-diam.
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe('Muat ulang');
    });
    expect(update).toHaveBeenCalledTimes(1);

    // Timpa: isian pengguna dengan versi terbaru dan clientId baru (isi berbeda dari kiriman pertama).
    await user.click(screen.getByRole('button', { name: 'Timpa dengan perubahan saya' }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(2);
    });
    const [first, second] = update.mock.calls.map((c) => c[0]);
    expect(first?.expectedVersion).toBe(2);
    expect(second).toEqual({
      ...first,
      expectedVersion: LATEST.version,
      clientId: expect.stringMatching(UUID_V4) as unknown,
    });
    expect(second?.clientId).not.toBe(first?.clientId);
    expect(second?.amount).toBe(60_000);
    expect(second?.accountId).toBe('a-bca');
  });

  it('Muat ulang mengganti draf dengan nilai terbaru, simpan berikutnya memakai versi terbaru', async () => {
    const user = userEvent.setup();
    const { update } = renderEdit({ update: conflictOnce() });
    await setAmount(user, '60000');
    await user.click(screen.getByRole('button', { name: /Simpan perubahan/ }));
    await user.click(await screen.findByRole('button', { name: 'Muat ulang' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Nominal' })).toHaveProperty('value', '45.000');
    expect(screen.getByLabelText(/Keterangan/)).toHaveProperty('value', 'Vitamin C');
    await setAmount(user, '47000');
    await user.click(screen.getByRole('button', { name: /Simpan perubahan/ }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(2);
    });
    const [first, second] = update.mock.calls.map((c) => c[0]);
    expect(second).toMatchObject({
      expectedVersion: 3,
      amount: 47_000,
      accountId: 'a-tunai',
      description: 'Vitamin C',
    });
    expect(second?.clientId).not.toBe(first?.clientId);
  });

  it('Timpa saat draf tidak valid (nominal kosong): tidak mengirim, layar konflik tetap bisa dipakai', async () => {
    const user = userEvent.setup();
    const { update } = renderEdit({ update: conflictOnce() });
    await setAmount(user, '60000');
    await user.click(screen.getByRole('button', { name: /Simpan perubahan/ }));
    await screen.findByRole('alert');
    await user.clear(screen.getByRole('textbox', { name: 'Nominal' }));
    const timpa = screen.getByRole('button', { name: 'Timpa dengan perubahan saya' });
    expect(timpa).toHaveAttribute('aria-disabled', 'true');
    await user.click(timpa);
    expect(update).toHaveBeenCalledTimes(1);
    // Layar konflik tetap: pesan dan kedua tombol masih ada, sheet tidak macet.
    expect(screen.getByRole('alert').textContent).toContain('mengubah transaksi ini');
    await setAmount(user, '61000');
    expect(timpa).not.toHaveAttribute('aria-disabled');
    await user.click(screen.getByRole('button', { name: 'Timpa dengan perubahan saya' }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(2);
    });
    expect(update.mock.calls[1]?.[0]).toMatchObject({ expectedVersion: 3, amount: 61_000 });
  });

  it('salinan: nominal sama tanpa kurung; pengguna sendiri = Kamu; waktu relatif', () => {
    expect(
      flat(
        conflictText({
          by: 'Farida',
          at: '2026-10-31T12:00:00+07:00',
          before: 50_000,
          after: 45_000,
          now: NOW,
        }),
      ),
    ).toBe(TEXT);
    expect(
      conflictText({
        by: 'Kamu',
        at: '2026-10-31T12:02:10+07:00',
        before: 45_000,
        after: 45_000,
        now: NOW,
      }),
    ).toBe('Kamu mengubah transaksi ini baru saja. Muat versi terbaru untuk melanjutkan.');
    expect(relativeTime('2026-10-31T10:00:00+07:00', NOW)).toBe('2 jam lalu');
    expect(relativeTime('2026-10-28T12:00:00+07:00', NOW)).toBe('3 hari lalu');
    // Jam klien di belakang server: tidak pernah "-1 menit lalu".
    expect(relativeTime('2026-10-31T12:05:00+07:00', NOW)).toBe('baru saja');
    expect(LATEST_HISTORY.at(-1)?.changedBy).not.toBe(ME);
  });
});
