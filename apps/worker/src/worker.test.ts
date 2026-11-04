import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STOP_TIMEOUT_MS } from './worker';

const compose = readFileSync(new URL('../../../infra/db-vm/compose.yml', import.meta.url), 'utf8');

describe('stop graceful worker', () => {
  it('stop_grace_period compose worker di atas batas stop pg-boss (+ jeda pool.end)', () => {
    const block = compose.slice(compose.indexOf('\n  worker:\n'));
    const m = /\n {4}stop_grace_period: (\d+)s\n/.exec(block);
    expect(m).not.toBeNull();
    expect(Number(m?.[1]) * 1000).toBeGreaterThanOrEqual(STOP_TIMEOUT_MS + 10_000);
  });
});
