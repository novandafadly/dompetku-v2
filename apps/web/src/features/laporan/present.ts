import {
  monthName,
  monthYearLabel,
  shortDateLabel,
  type IsoDate,
  type Rupiah,
} from '@dompetku/domain';
import type { Ruang } from '@/features/ledger/types';
import type { CategorySummaryVM, ExcludedVM, TrendRowVM } from './types';

/**
 * Fungsi murni presentasi Laporan (S9 Task 13, bingkai S9-LP*). Semua nominal dan persen datang
 * dari SQL (`category_summary`, `period_trend`, ...); di sini hanya memilih baris, memberi nama,
 * dan menghitung GEOMETRI grafik (tinggi batang, langkah sumbu). Tanpa `'use client'`.
 */

/** Permil SQL → teks persen satu desimal (`378` → `37,8%`, `450` → `45%`); `0` → `< 0,1%`. */
export function pctText(p10: number): string {
  if (p10 <= 0) return '< 0,1%';
  const whole = Math.floor(p10 / 10);
  const frac = p10 % 10;
  return frac === 0 ? `${String(whole)}%` : `${String(whole)},${String(frac)}%`;
}

/** Lebar bilah (persen CSS) dari permil; selalu terlihat (min 2 px lewat `min-w-0.5`). */
export function barPct(p10: number): number {
  return Math.min(Math.max(p10, 0), 1000) / 10;
}

/** Status anggaran satu kategori (sama tangga dengan Rencana; NEAR 80 = `features/rencana/copy`). */
export type BudgetStatus = 'ok' | 'near' | 'full' | 'over';

export const NEAR_PCT = 80;

export function budgetStatus(b: { pct: number; remaining: Rupiah }): BudgetStatus {
  if (b.remaining < 0) return 'over';
  if (b.remaining === 0) return 'full';
  return b.pct >= NEAR_PCT ? 'near' : 'ok';
}

// ---------------------------------------------------------------------------------------------
// Kategori

export interface CategoryGroup {
  /** Induk (atau baris `uncategorized`/`fee`, kelompoknya sendiri). */
  root: CategorySummaryVM;
  /** Anak, urutan SQL (terbesar dulu). */
  children: CategorySummaryVM[];
}

export interface CategoryBlock {
  /** Total jenis ini dari SQL (Pengeluaran penuh / Pemasukan); `0` bila tak ada baris. */
  total: Rupiah;
  groups: CategoryGroup[];
}

/** Baris `category_summary` satu jenis → kelompok induk + anak (urutan SQL dipertahankan). */
export function groupCategories(
  rows: readonly CategorySummaryVM[],
  type: 'income' | 'expense',
): CategoryBlock {
  const typed = rows.filter((r) => r.type === type);
  const groups: CategoryGroup[] = [];
  const byRoot = new Map<string, CategoryGroup>();
  for (const r of typed) {
    if (r.kind !== 'category' || r.categoryId === r.rootCategoryId) {
      const g: CategoryGroup = { root: r, children: [] };
      groups.push(g);
      if (r.rootCategoryId !== null) byRoot.set(r.rootCategoryId, g);
    }
  }
  for (const r of typed) {
    if (r.kind === 'category' && r.categoryId !== r.rootCategoryId && r.rootCategoryId !== null) {
      byRoot.get(r.rootCategoryId)?.children.push(r);
    }
  }
  return { total: typed[0]?.typeTotal ?? 0, groups };
}

export function categoryName(r: CategorySummaryVM): string {
  if (r.kind === 'fee') return 'Biaya transfer';
  if (r.kind === 'uncategorized') return 'Tanpa kategori';
  return r.name ?? 'Kategori';
}

// ---------------------------------------------------------------------------------------------
// Tidak termasuk

export interface ExcludedLine {
  key: string;
  name: string;
  note: string;
  amount: Rupiah;
}

interface ExcludedName {
  name: string;
  note: string;
}

const KANTOR = 'Uang kantor, bukan uang pribadi.';
const KOREKSI = 'Saldo awal dompet dan penyesuaian saldo.';

/** Nama dan keterangan per kelas dan arah (hanya arah yang tampil; arah cermin dilewati). */
function excludedName(
  cls: string,
  dir: 'in' | 'out',
  ruang: Ruang,
): ExcludedName | null | undefined {
  switch (cls) {
    case 'x_kantor':
      return { name: `Kas kantor · ${dir === 'in' ? 'masuk' : 'keluar'}`, note: KANTOR };
    case 'x_talangan':
      return dir === 'out'
        ? { name: 'Talangan kantor', note: 'Pengeluaran kantor yang bisa diganti.' }
        : null;
    case 'x_reimburse':
      return dir === 'in'
        ? { name: 'Reimburse diterima', note: 'Mengganti talangan kantor.' }
        : null;
    case 'x_transfer':
      return dir === 'out'
        ? {
            name: 'Transfer antar dompet',
            note:
              ruang === 'pribadi'
                ? 'Pindah antar dompetmu; nilai satu sisi.'
                : 'Pindah antar dompet Bersama.',
          }
        : null;
    case 'x_setor_bersama':
      return dir === 'out'
        ? { name: 'Setor ke Bersama', note: 'Uang pindah ke ruang Bersama.' }
        : null;
    case 'x_ambil_bersama':
      return dir === 'in'
        ? { name: 'Ambil dari Bersama', note: 'Uang masuk dari ruang Bersama.' }
        : null;
    case 'x_setoran_anggota':
      return dir === 'in'
        ? { name: 'Kontribusi anggota', note: 'Setoran dari ruang Pribadi.' }
        : null;
    case 'x_diambil_anggota':
      return dir === 'out'
        ? { name: 'Diambil anggota', note: 'Pengambilan ke ruang Pribadi.' }
        : null;
    // S11: pokok dan pelunasan utang/piutang; arah = arah uang di dompet (masuk/keluar).
    case 'x_pokok_utang':
      return dir === 'in'
        ? { name: 'Pinjaman diterima', note: 'Uang pinjaman masuk; bukan pemasukan.' }
        : { name: 'Pinjaman diberikan', note: 'Uang yang kamu pinjamkan; bukan pengeluaran.' };
    case 'x_pelunasan_utang':
      return dir === 'out'
        ? { name: 'Pelunasan utang', note: 'Cicilan utang; bukan pengeluaran.' }
        : { name: 'Penerimaan piutang', note: 'Cicilan piutang yang diterima; bukan pemasukan.' };
    case 'x_koreksi':
      return { name: `Saldo awal dan koreksi · ${dir === 'in' ? 'naik' : 'turun'}`, note: KOREKSI };
    default:
      return undefined;
  }
}

/** Baris `Tidak termasuk` (hanya > 0, urutan SQL). Kelas tak dikenal → `Lainnya`. */
export function excludedLines(classes: readonly ExcludedVM[], ruang: Ruang): ExcludedLine[] {
  const out: ExcludedLine[] = [];
  for (const c of classes) {
    if (c.amount <= 0) continue;
    const named = excludedName(c.reportClass, c.direction, ruang);
    if (named === null) continue;
    out.push({
      key: `${c.reportClass}:${c.direction}`,
      name: named?.name ?? 'Lainnya',
      note: named?.note ?? 'Uang yang bergerak di luar pemasukan dan pengeluaran.',
      amount: c.amount,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tren

const STEP_MANTISSAS = [1, 2, 2.5, 4, 5] as const;

/** Langkah sumbu: {1, 2, 2,5, 4, 5} × 10ⁿ pertama yang ≥ `max / 3` (puncak sumbu = 3 langkah). */
export function niceStep(max: number): number {
  const need = max / 3;
  for (let e = 0; e < 16; e += 1) {
    for (const m of STEP_MANTISSAS) {
      const s = m * 10 ** e;
      if (s >= need) return s;
    }
  }
  return 10 ** 16;
}

function trimNum(n: number): string {
  return String(Number(n.toFixed(1))).replace('.', ',');
}

/** Label sumbu nilai: `0`, `Rp 500 rb`, `Rp 2,5 jt`, `Rp 12 jt`, `Rp 1,2 M`. */
export function axisLabel(v: number): string {
  if (v <= 0) return '0';
  if (v >= 1e9) return `Rp ${trimNum(v / 1e9)} M`;
  if (v >= 1e6) return `Rp ${trimNum(v / 1e6)} jt`;
  if (v >= 1e3) return `Rp ${trimNum(v / 1e3)} rb`;
  return `Rp ${trimNum(v)}`;
}

export interface TrendScale {
  step: number;
  /** Nilai di garis bantu, dari 0 sampai puncak (4 garis). */
  ticks: number[];
  top: number;
}

export function trendScale(rows: readonly TrendRowVM[]): TrendScale {
  const max = rows.reduce((m, r) => Math.max(m, r.pemasukan, r.pengeluaran), 0);
  const step = niceStep(max);
  return { step, ticks: [0, step, 2 * step, 3 * step], top: 3 * step };
}

/** Tinggi batang (persen tinggi plot); bukan angka uang, hanya geometri. */
export function barHeightPct(value: Rupiah, scale: TrendScale): number {
  return Math.min(100, (Math.max(value, 0) / scale.top) * 100);
}

/** `Okt`, atau `Jan 2027` untuk Januari (tahun hanya di awal tahun). */
export function trendLabel(labelMonth: IsoDate): string {
  const mon = shortDateLabel(labelMonth).split(' ')[1] ?? '';
  return labelMonth.slice(5, 7) === '01' ? `${mon} ${labelMonth.slice(0, 4)}` : mon;
}

/** `2026-10` → `Oktober 2026` (nama aksesibel tombol periode). */
export function bulanTahunLabel(ym: string): string {
  return monthYearLabel(ym.slice(0, 7));
}

/** `aria-label` grafik tren (SPEC §4); menyebut tahun awal dan akhir bila jendela melintasi tahun. */
export function trendAriaLabel(rows: readonly TrendRowVM[]): string {
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return '';
  const crosses = first.labelMonth.slice(0, 4) !== last.labelMonth.slice(0, 4);
  const name = (r: TrendRowVM) =>
    crosses ? monthYearLabel(r.labelMonth.slice(0, 7)) : monthName(r.labelMonth.slice(0, 7));
  const running = rows.find((r) => r.isCurrent);
  return (
    `Grafik batang berpasangan: pemasukan dan pengeluaran per periode, ${name(first)} sampai ${name(last)}. ` +
    (running ? `${monthName(running.labelMonth.slice(0, 7))} masih berjalan. ` : '') +
    'Rincian angka ada di tabel data di bawah.'
  );
}

// ---------------------------------------------------------------------------------------------
// Angka besar

/**
 * Pembagi lebar angka besar: `digit × 0,62 + titik × 0,28` (SPEC §7). CSS: ukuran huruf =
 * `min(44px, (lebar kartu − 30px) / em)`; server menghitung `em` dari teks digit yang tampil.
 */
export function bigNumberEm(digits: string): number {
  let em = 0;
  for (const ch of digits) em += ch === '.' ? 0.28 : 0.62;
  return Math.max(em, 1);
}
