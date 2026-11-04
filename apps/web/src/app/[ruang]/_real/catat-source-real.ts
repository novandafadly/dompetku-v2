'use client';

import { newClientId } from '@/features/catat/client-id';
import { savedToast } from '@/features/catat/saved-toast';
import type { CatatOptions, CatatSource, SaveOutcome } from '@/features/catat/source';
import type { AccountVM, CategoryVM, Ruang } from '@/features/ledger/types';
import type { SaveCatatInput } from '../_actions/inputs';
import { catatOptions, logCatatEvent, saveCatat, suggestFor } from '../_actions/catat';
import { moveTargetsAction, voidEntryAction } from '../_actions/entri';

/**
 * Sumber Catat mode nyata (modul klien): hanya referensi Server Action dari `_actions/*`, tidak
 * pernah `server/**`. Opsi ruang awal datang dari props layout (data ruang ini saja); ruang lain
 * diminta lewat `catatOptions` saat pindah ruang di sheet (Review Focus 4). Dipasang di shell
 * nyata oleh Task 14.
 */

const SUGGESTIONS = 6;

export interface RealCatatSourceArgs {
  /** Ruang halaman; opsinya sudah dimuat server untuk layout. */
  ruang: Ruang;
  options: CatatOptions;
  ruangLabel: Record<Ruang, string>;
}

/**
 * Janji yang baru berjalan saat pertama kali ditunggu (`then`/`catch`/`finally`); sesudahnya
 * semua penunggu berbagi satu hasil.
 */
function deferred<T>(start: () => Promise<T>): Promise<T> {
  let started: Promise<T> | undefined;
  const run = () => (started ??= start());
  return {
    then: (onFulfilled, onRejected) => run().then(onFulfilled, onRejected),
    catch: (onRejected) => run().catch(onRejected),
    finally: (onFinally) => run().finally(onFinally),
    [Symbol.toStringTag]: 'Promise',
  };
}

export function realCatatSource({ ruang, options, ruangLabel }: RealCatatSourceArgs): CatatSource {
  const loaded = new Map<Ruang, CatatOptions>([[ruang, options]]);
  const frozen = new Map<string, Promise<CategoryVM[]>>();
  // Dompet tujuan antar ruang (S7-C1), per ruang tujuan, hanya selama sesi sheet ini. Dimuat saat
  // halaman "Ruang lain…" dibuka (R27): data Pribadi untuk pemanggil di rute Bersama tidak lewat
  // props RSC, URL, atau cache bersama.
  const targets = new Map<Ruang, Promise<AccountVM[]>>();

  const optionsOf = async (r: Ruang): Promise<CatatOptions> => {
    const have = loaded.get(r);
    if (have) return have;
    const res = await catatOptions(r);
    if (!res.ok) throw new Error(res.error.code);
    loaded.set(r, res.value);
    return res.value;
  };

  const fetchChips = async (
    r: Ruang,
    type: 'income' | 'expense',
    hour: number,
  ): Promise<CategoryVM[]> => {
    const { categories } = await optionsOf(r);
    const active = categories.filter((c) => c.type === type && !c.archived);
    try {
      const res = await suggestFor(r, { type, hour });
      if (res.ok) {
        const byId = new Map(active.map((c) => [c.id, c]));
        return res.value
          .map((id) => byId.get(id))
          .filter((c): c is CategoryVM => c !== undefined)
          .slice(0, SUGGESTIONS);
      }
    } catch {
      // Saran gagal: chip tetap ada (kategori pertama), Catat tidak terhalang.
    }
    return active.slice(0, SUGGESTIONS);
  };

  return {
    ruangLabel,
    options(r) {
      return loaded.get(r) ?? optionsOf(r);
    },
    chips(r, type, hour) {
      // Sekali per (ruang, jenis) lalu dibekukan: posisi chip tidak berubah selama sheet terbuka.
      const key = `${r}:${type}`;
      let got = frozen.get(key);
      if (got === undefined) {
        // Ditunda sampai ada yang menunggu hasilnya: `useCatat` memanggil `chips` saat render
        // pertama, dan render yang belum di-commit bisa diulang React. Permintaan jaringan di sana
        // membuat setiap jawaban memicu render ulang yang meminta lagi (banjir `suggestFor`).
        got = deferred(() =>
          fetchChips(r, type, hour).catch((e: unknown) => {
            // Opsi ruang gagal dimuat: jangan bekukan penolakan, permintaan berikutnya mencoba lagi.
            frozen.delete(key);
            throw e;
          }),
        );
        frozen.set(key, got);
      }
      return got;
    },
    spaceTransferTargets(toRuang) {
      let got = targets.get(toRuang);
      if (got === undefined) {
        // Ruang sumber = kebalikan tujuan (hanya dua ruang): action memuat dompet ruang tujuan.
        const from: Ruang = toRuang === 'pribadi' ? 'bersama' : 'pribadi';
        got = moveTargetsAction(from, toRuang).then((res) => {
          if (!res.ok) throw new Error(res.error.code);
          return res.value.accounts;
        });
        targets.set(toRuang, got);
        got.catch(() => {
          // Gagal tidak dibekukan: pembukaan halaman berikutnya mencoba lagi.
          targets.delete(toRuang);
        });
      }
      return got;
    },
    async save(d): Promise<SaveOutcome> {
      if (d.amount === null) return { ok: false, code: 'invalid', field: 'amount' };
      const common = {
        clientId: d.clientId,
        amount: d.amount,
        // Tanggal tidak dipilih = server memakai app.today() (tanggal klien bisa basi).
        ...(d.dateChosen ? { occurredOn: d.date } : {}),
        ...(d.description === undefined ? {} : { description: d.description }),
        allowNegative: d.allowNegative,
      };
      const crossTo = d.type === 'transfer' ? d.toRuang : undefined;
      const input: SaveCatatInput =
        crossTo !== undefined
          ? {
              kind: 'space_transfer',
              toRuang: crossTo,
              fromAccountId: d.accountId,
              toAccountId: d.counterAccountId ?? '',
              ...(d.sharedNote === undefined ? {} : { sharedNote: d.sharedNote }),
              ...common,
            }
          : d.type === 'transfer'
            ? {
                kind: 'transfer',
                fromAccountId: d.accountId,
                toAccountId: d.counterAccountId ?? '',
                ...common,
              }
            : {
                kind: d.type,
                accountId: d.accountId,
                categoryId: d.categoryId ?? '',
                ...(d.type === 'expense' && d.reimbursable === true ? { reimbursable: true } : {}),
                ...common,
              };
      try {
        const res = await saveCatat(d.ruang, input);
        if (!res.ok) {
          return res.error.field === undefined
            ? { ok: false, code: res.error.code }
            : { ok: false, code: res.error.code, field: res.error.field };
        }
        const accounts = loaded.get(d.ruang)?.accounts ?? [];
        const name = (id: string | undefined) => accounts.find((a) => a.id === id)?.name ?? '';
        return {
          ok: true,
          ...res.value,
          toast: savedToast(
            ruangLabel[d.ruang],
            d.amount,
            d.type,
            name(d.accountId),
            name(d.counterAccountId),
            {
              ...(crossTo === undefined ? {} : { toRuang: ruangLabel[crossTo] }),
              reimbursable: d.type === 'expense' && d.reimbursable === true,
            },
          ),
        };
      } catch {
        // Fetch Server Action putus (offline, server mati): "Coba lagi" dengan clientId yang sama.
        return { ok: false, code: 'network' };
      }
    },
    track({ ruang: r, ...e }) {
      // Kirim-dan-lupakan: tidak ditunggu, tidak pernah melempar ke UI (nilai kembali void).
      try {
        logCatatEvent(r, e).catch(() => undefined);
      } catch {
        // Referensi action gagal dipanggil (mis. fetch tidak tersedia): telemetri diam.
      }
    },
    async undo({ entryId, version, ruang: r }) {
      try {
        const res = await voidEntryAction(r, {
          clientId: newClientId(),
          entryId,
          expectedVersion: version,
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
