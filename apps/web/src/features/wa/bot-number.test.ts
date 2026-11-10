import { describe, expect, it } from 'vitest';
import { botChatHref, formatBotNumber, normalizeBotNumber } from './bot-number';

describe('normalizeBotNumber', () => {
  it('mengambil angka saja dari berbagai tulisan', () => {
    expect(normalizeBotNumber('+62 811 0000 111')).toBe('628110000111');
    expect(normalizeBotNumber('+62-811-0000-111')).toBe('628110000111');
    expect(normalizeBotNumber('0811 0000 111')).toBe('628110000111');
    expect(normalizeBotNumber('+14155550123')).toBe('14155550123');
  });
  it('kosong atau tak masuk akal = null', () => {
    expect(normalizeBotNumber(null)).toBeNull();
    expect(normalizeBotNumber('')).toBeNull();
    expect(normalizeBotNumber('abc')).toBeNull();
    expect(normalizeBotNumber('+62 1')).toBeNull();
    expect(normalizeBotNumber('1'.repeat(16))).toBeNull();
  });
});

describe('formatBotNumber', () => {
  it('Indonesia: +62 812-3456-7890', () => {
    expect(formatBotNumber('6281234567890')).toBe('+62 812-3456-7890');
    expect(formatBotNumber('628110000111')).toBe('+62 811-0000-111');
  });
  it('negara lain: +angka', () => {
    expect(formatBotNumber('14155550123')).toBe('+14155550123');
  });
});

describe('botChatHref', () => {
  it('dengan kode: pesan hubung KODE ter-encode', () => {
    expect(botChatHref('628110000111', 'K7M2QX')).toBe(
      'https://wa.me/628110000111?text=hubung%20K7M2QX',
    );
  });
  it('tanpa kode: hubung saja', () => {
    expect(botChatHref('628110000111')).toBe('https://wa.me/628110000111?text=hubung');
  });
});
