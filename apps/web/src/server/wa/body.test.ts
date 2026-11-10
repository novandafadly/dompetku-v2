import { describe, expect, it, vi } from 'vitest';
import { createLogThrottle, readBodyCapped } from './body';

const req = (body: BodyInit | null) =>
  new Request('http://localhost/x', { method: 'POST', body, duplex: 'half' } as RequestInit);

function chunked(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
}

describe('readBodyCapped', () => {
  it('tanpa body = array kosong', async () => {
    expect(await readBodyCapped(new Request('http://localhost/x', { method: 'POST' }), 10)).toEqual(
      new Uint8Array(0),
    );
  });

  it('menggabungkan chunk apa adanya', async () => {
    const r = await readBodyCapped(
      req(chunked([Uint8Array.of(1, 2), Uint8Array.of(3), Uint8Array.of(4, 5)])),
      5,
    );
    expect(r).toEqual(Uint8Array.of(1, 2, 3, 4, 5));
  });

  it('melewati batas satu byte = too_large dan stream dibatalkan', async () => {
    const cancel = vi.fn();
    let n = 0;
    const s = new ReadableStream<Uint8Array>({
      pull(c) {
        n += 1;
        c.enqueue(Uint8Array.of(n));
      },
      cancel,
    });
    expect(await readBodyCapped(req(s), 3)).toBe('too_large');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(n).toBeLessThanOrEqual(5);
  });
});

describe('createLogThrottle', () => {
  it('sekali per interval dengan jam suntikan', () => {
    let t = 1_000;
    const th = createLogThrottle(60_000, () => t);
    expect(th.allow()).toBe(true);
    expect(th.allow()).toBe(false);
    t += 59_999;
    expect(th.allow()).toBe(false);
    t += 1;
    expect(th.allow()).toBe(true);
    expect(th.allow()).toBe(false);
  });
});
