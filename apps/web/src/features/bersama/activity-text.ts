import { formatRupiah, shortDateLabel } from '@dompetku/domain';
import type { SharedActivityRow } from './types';

/**
 * Teks peristiwa feed Aktivitas Bersama (matriks bingkai S8-A2). Murni: tanpa impor server atau
 * klien. SQL menghitung angka, fungsi ini hanya menyusun kalimat (BSD §1.1).
 *
 * Batas masukan (K1): kalimat hanya tersusun dari kata kerja tetap, `description` (bukan untuk
 * kaki antar ruang), `shared_note`, nama kategori lewat `ctx.categoryName`, dan nominal lewat
 * `formatRupiah`. Field lain baris (id, dompet, apa pun yang tidak dikenal) tidak pernah dibaca.
 * Nama pelaku tidak termasuk: dirender terpisah (`{Nama} · {kalimat}`).
 */

export interface ActivityTextCtx {
  categoryName(id: string): string | null;
}

export interface ActivityText {
  /** Kalimat tanpa nama pelaku. */
  text: string;
  /** Baris perubahan (hanya `update`): nominal dulu, lalu kategori. */
  change: string[];
  /** Pengganti baris perubahan untuk pembaca layar; ada hanya bila `change` tidak kosong. */
  srText?: string;
  /** `tanggal 26 Okt`: hanya create/restore yang dicatat untuk tanggal selain hari peristiwa. */
  backdate?: string;
}

const NO_CATEGORY = 'Tanpa kategori';

const FALLBACK: Record<SharedActivityRow['op'], string> = {
  create: 'mencatat transaksi',
  update: 'memperbarui transaksi',
  void: 'membatalkan transaksi',
  restore: 'memulihkan transaksi',
};

const VERB: Record<'create' | 'void' | 'restore', string> = {
  create: 'mencatat',
  void: 'membatalkan',
  restore: 'memulihkan',
};

function present(s: string | null): s is string {
  return s !== null && s.trim() !== '';
}

function categoryLabel(id: string | null, ctx: ActivityTextCtx): string {
  if (id === null) return NO_CATEGORY;
  const name = ctx.categoryName(id);
  return present(name) ? name : NO_CATEGORY;
}

/** Nominal berubah pada `update` (versi sebelumnya = `version − 1` entri yang sama, dari DB). */
export function amountChanged(row: SharedActivityRow): boolean {
  return row.op === 'update' && row.beforeAmount !== null && row.beforeAmount !== row.amount;
}

function categoryChanged(row: SharedActivityRow): boolean {
  return row.op === 'update' && row.beforeCategoryId !== row.categoryId;
}

function sentence(row: SharedActivityRow, ctx: ActivityTextCtx): string {
  const { op, kind, direction } = row;
  // R26: hanya void yang bertanda dipindah; kaki di ruang tujuan adalah create biasa.
  if (op === 'void' && row.moved) return 'memindahkan transaksi ke ruang lain';

  if (kind === 'expense' || kind === 'income') {
    const noun = kind === 'expense' ? 'pengeluaran' : 'pemasukan';
    if (op === 'update') {
      return present(row.description) ? `mengubah ${row.description}` : `mengubah ${noun}`;
    }
    const title = present(row.description) ? row.description : categoryLabel(row.categoryId, ctx);
    return `${VERB[op]} ${noun} ${title}`;
  }
  if (op === 'update') return FALLBACK.update;

  switch (kind) {
    case 'transfer':
      if (op === 'create') {
        return present(row.description)
          ? `mencatat transfer antar dompet (${row.description})`
          : 'mencatat transfer antar dompet';
      }
      return `${VERB[op]} transfer antar dompet`;
    case 'space_transfer': {
      // Tanpa description sama sekali: kaki Bersama memang tanpa deskripsi (privasi transfer).
      if (direction === null) return FALLBACK[op];
      const note = present(row.sharedNote) ? ` (${row.sharedNote})` : '';
      if (direction === 'in') {
        return op === 'create' ? `menyetor ke Bersama${note}` : `${VERB[op]} setoran ke Bersama`;
      }
      return op === 'create'
        ? `mengambil dari Bersama${note}`
        : `${VERB[op]} pengambilan dari Bersama`;
    }
    case 'adjustment':
      if (op === 'create') {
        if (direction === null) return FALLBACK.create;
        return direction === 'in' ? 'mencocokkan saldo, naik' : 'mencocokkan saldo, turun';
      }
      return `${VERB[op]} pencocokan saldo`;
    default:
      // reimbursement (tidak ada di Bersama), opening_balance (dikeluarkan fungsi), dan kombinasi
      // lain yang DB tidak hasilkan: kata kerja op tetap terbaca, tanpa string mentah.
      return FALLBACK[op];
  }
}

export function activityText(row: SharedActivityRow, ctx: ActivityTextCtx): ActivityText {
  const out: ActivityText = { text: sentence(row, ctx), change: [] };

  const sr: string[] = [];
  if (amountChanged(row) && row.beforeAmount !== null) {
    const before = formatRupiah(row.beforeAmount);
    const after = formatRupiah(row.amount);
    out.change.push(`${before} → ${after}`);
    sr.push(`dari ${before} menjadi ${after}`);
  }
  if (categoryChanged(row)) {
    const before = categoryLabel(row.beforeCategoryId, ctx);
    const after = categoryLabel(row.categoryId, ctx);
    out.change.push(`${before} → ${after}`);
    sr.push(`dari ${before} menjadi ${after}`);
  }
  if (sr.length > 0) out.srText = sr.join(', ');

  const eventDay = row.at.slice(0, 10);
  if ((row.op === 'create' || row.op === 'restore') && row.occurredOn !== eventDay) {
    out.backdate = `tanggal ${shortDateLabel(row.occurredOn)}`;
  }
  return out;
}
