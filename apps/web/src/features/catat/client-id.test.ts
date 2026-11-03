import { describe, expect, it } from 'vitest';
import { newClientId } from './client-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newClientId', () => {
  it('UUID v4 berformat 8-4-4-4-12 (versi 4, varian 8–b)', () => {
    for (let i = 0; i < 200; i++) expect(newClientId()).toMatch(UUID_V4);
  });

  it('tidak berulang', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newClientId()));
    expect(ids.size).toBe(500);
  });
});
