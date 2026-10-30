export type IsoDate = string;

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
] as const;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(d: IsoDate): { y: number; m: number; day: number } {
  const match = ISO_RE.exec(d);
  if (!match) throw new RangeError(`Invalid IsoDate: ${d}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const day = Number(match[3]);
  const t = new Date(Date.UTC(y, m - 1, day));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== day) {
    throw new RangeError(`Invalid IsoDate: ${d}`);
  }
  return { y, m, day };
}

function utcMs(d: IsoDate): number {
  const { y, m, day } = parse(d);
  return Date.UTC(y, m - 1, day);
}

function fromMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

const MS_DAY = 86_400_000;

const jakartaFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function jakartaParts(now: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of jakartaFmt.formatToParts(now)) out[p.type] = p.value;
  return out;
}

function part(parts: Record<string, string>, type: string): string {
  const v = parts[type];
  if (v === undefined) throw new Error(`Missing date part: ${type}`);
  return v;
}

export function todayWIB(now: Date = new Date()): IsoDate {
  const p = jakartaParts(now);
  return part(p, 'year') + '-' + part(p, 'month') + '-' + part(p, 'day');
}

export function nowTimeWIB(now: Date = new Date()): string {
  const p = jakartaParts(now);
  return part(p, 'hour') + '.' + part(p, 'minute');
}

export function nowIsoWIB(now: Date = new Date()): string {
  const p = jakartaParts(now);
  const date = part(p, 'year') + '-' + part(p, 'month') + '-' + part(p, 'day');
  const time = part(p, 'hour') + ':' + part(p, 'minute') + ':' + part(p, 'second');
  return date + 'T' + time + '+07:00';
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return fromMs(utcMs(d) + n * MS_DAY);
}

export function daysInclusive(from: IsoDate, to: IsoDate): number {
  return Math.round((utcMs(to) - utcMs(from)) / MS_DAY) + 1;
}

export function endOfMonth(d: IsoDate): IsoDate {
  const { y, m } = parse(d);
  return fromMs(Date.UTC(y, m, 0));
}

export function dayLabel(d: IsoDate, today: IsoDate): string {
  if (d === today) return 'Hari ini';
  if (d === addDays(today, -1)) return 'Kemarin';
  const { y, m, day } = parse(d);
  const dow = DAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()] ?? '';
  const month = MONTHS[m - 1] ?? '';
  const base = dow + ', ' + String(day) + ' ' + month;
  return y === parse(today).y ? base : base + ' ' + String(y);
}

/** "31 Okt": hari dan bulan saja, untuk judul dan label yang sudah jelas tahunnya. */
export function shortDateLabel(d: IsoDate): string {
  const { m, day } = parse(d);
  return String(day) + ' ' + (MONTHS[m - 1] ?? '');
}

const MONTH_NAMES = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
] as const;

const MONTH_RE = /^(\d{4})-(\d{2})$/;

function parseMonth(ym: string): { y: number; m: number } {
  const match = MONTH_RE.exec(ym);
  const m = Number(match?.[2]);
  if (!match || m < 1 || m > 12) throw new RangeError(`Invalid month: ${ym}`);
  return { y: Number(match[1]), m };
}

/** Bulan 'YYYY-MM' bergeser n bulan. */
export function addMonths(ym: string, n: number): string {
  const { y, m } = parseMonth(ym);
  const idx = y * 12 + (m - 1) + n;
  return (
    String(Math.floor(idx / 12)).padStart(4, '0') + '-' + String((idx % 12) + 1).padStart(2, '0')
  );
}

/** "Oktober": nama bulan lengkap tanpa tahun. */
export function monthName(ym: string): string {
  return MONTH_NAMES[parseMonth(ym).m - 1] ?? '';
}
