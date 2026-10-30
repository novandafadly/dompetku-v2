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

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function todayWIB(now: Date = new Date()): IsoDate {
  return dateFmt.format(now);
}

export function nowTimeWIB(now: Date = new Date()): string {
  const parts = timeFmt.formatToParts(now);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hh}.${mm}`;
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
