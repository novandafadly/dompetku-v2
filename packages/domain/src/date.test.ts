import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dayLabel,
  daysInclusive,
  endOfMonth,
  isoAtWIB,
  monthName,
  monthYearLabel,
  nowIsoWIB,
  nowTimeWIB,
  shortDateLabel,
  timeLabelWIB,
  todayWIB,
} from './date';

describe('todayWIB', () => {
  it('uses Asia/Jakarta day boundary', () => {
    expect(todayWIB(new Date('2026-10-30T16:59:00Z'))).toBe('2026-10-30');
    expect(todayWIB(new Date('2026-10-30T17:01:00Z'))).toBe('2026-10-31');
  });
});

describe('nowTimeWIB', () => {
  it('formats HH.mm in WIB', () => {
    expect(nowTimeWIB(new Date('2026-10-30T03:32:00Z'))).toBe('10.32');
    expect(nowTimeWIB(new Date('2026-10-30T17:05:00Z'))).toBe('00.05');
  });
});

describe('dayLabel', () => {
  it.each([
    ['2026-10-31', '2026-10-31', 'Hari ini'],
    ['2026-10-30', '2026-10-31', 'Kemarin'],
    ['2026-10-26', '2026-10-31', 'Sen, 26 Okt'],
    ['2025-12-31', '2026-01-02', 'Rab, 31 Des 2025'],
  ])('%s vs %s -> %s', (d, today, expected) => {
    expect(dayLabel(d, today)).toBe(expected);
  });
});

describe('shortDateLabel', () => {
  it('hari dan bulan tanpa hari-pekan atau tahun', () => {
    expect(shortDateLabel('2026-10-31')).toBe('31 Okt');
    expect(shortDateLabel('2026-01-05')).toBe('5 Jan');
  });
});

describe('endOfMonth', () => {
  it.each([
    ['2026-02-10', '2026-02-28'],
    ['2028-02-10', '2028-02-29'],
    ['2026-10-31', '2026-10-31'],
  ])('%s -> %s', (d, expected) => {
    expect(endOfMonth(d)).toBe(expected);
  });
});

describe('daysInclusive', () => {
  it('counts both ends', () => {
    expect(daysInclusive('2026-10-17', '2026-10-31')).toBe(15);
    expect(daysInclusive('2026-10-31', '2026-10-31')).toBe(1);
  });
});

describe('addDays', () => {
  it('crosses month and year', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('invalid IsoDate', () => {
  it('throws RangeError', () => {
    expect(() => addDays('2026-13-01', 1)).toThrow(RangeError);
    expect(() => endOfMonth('2026-02-30')).toThrow(RangeError);
    expect(() => dayLabel('nope', '2026-10-31')).toThrow(RangeError);
  });
});

describe('nowIsoWIB', () => {
  it('formats with +07:00 offset', () => {
    expect(nowIsoWIB(new Date('2026-10-30T03:32:09Z'))).toBe('2026-10-30T10:32:09+07:00');
  });
  it('rolls the date across UTC midnight', () => {
    expect(nowIsoWIB(new Date('2026-10-30T17:05:00Z'))).toBe('2026-10-31T00:05:00+07:00');
    expect(nowIsoWIB(new Date('2026-12-31T16:59:59Z'))).toBe('2026-12-31T23:59:59+07:00');
    expect(nowIsoWIB(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01T00:00:00+07:00');
  });
});

describe('addMonths / monthName', () => {
  it('shifts across year boundaries', () => {
    expect(addMonths('2026-10', -1)).toBe('2026-09');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-10', -5)).toBe('2026-05');
  });
  it('names months in Indonesian', () => {
    expect(monthName('2026-10')).toBe('Oktober');
    expect(monthName('2026-08')).toBe('Agustus');
  });
  it('rejects invalid months', () => {
    expect(() => monthName('2026-13')).toThrow(RangeError);
    expect(() => addMonths('2026-1', 1)).toThrow(RangeError);
  });
});

describe('isoAtWIB', () => {
  it('keeps the given date with the WIB time of day', () => {
    expect(isoAtWIB('2026-10-17', new Date('2026-10-30T03:32:09Z'))).toBe(
      '2026-10-17T10:32:09+07:00',
    );
  });
  it('uses the WIB clock even when UTC is still the previous day', () => {
    expect(isoAtWIB('2026-10-31', new Date('2026-10-30T17:05:00Z'))).toBe(
      '2026-10-31T00:05:00+07:00',
    );
  });
  it('rejects an invalid date', () => {
    expect(() => isoAtWIB('2026-02-30')).toThrow(RangeError);
  });
});

describe('timeLabelWIB', () => {
  it('formats HH.mm from an ISO timestamp', () => {
    expect(timeLabelWIB('2026-10-30T10:32:09+07:00')).toBe('10.32');
    expect(timeLabelWIB('2026-10-30T00:05:00+07:00')).toBe('00.05');
  });
  it('rejects a malformed timestamp', () => {
    expect(() => timeLabelWIB('nope')).toThrow(RangeError);
  });
});

describe('monthYearLabel', () => {
  it('formats full month name and year', () => {
    expect(monthYearLabel('2026-10')).toBe('Oktober 2026');
    expect(monthYearLabel('2027-01')).toBe('Januari 2027');
  });
  it('rejects an invalid month', () => {
    expect(() => monthYearLabel('2026-13')).toThrow(RangeError);
  });
});
