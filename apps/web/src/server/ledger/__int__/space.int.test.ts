import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Ruang } from '@/features/ledger/types';
import { withAnon, withUser } from '../../db';
import { toLedgerError } from '../errors';
import { withLedger } from '../retry';
import { resolveSpace, SpaceNotFoundError } from '../space';
import {
  createLedgerHarness,
  resetLedger,
  seedPersonas,
  spaceIdOf,
  type Persona,
  type Personas,
} from './harness';

const h = createLedgerHarness();

afterAll(async () => {
  await h.close();
});

function must(p: Persona | null): Persona {
  if (!p) throw new Error('persona tidak ada');
  return p;
}

describe('resolveSpace: N, F bergabung, Luar', () => {
  let ps: Personas;

  beforeEach(async () => {
    await resetLedger(h);
    ps = await seedPersonas(h, { farida: 'bergabung', luar: true });
  });

  it('N pribadi = ruang Pribadi N; N bersama = ruang Bersama', async () => {
    await expect(resolveSpace(h.pools, ps.n.id, 'pribadi')).resolves.toEqual({
      spaceId: await spaceIdOf(h, ps.n.id, 'personal'),
      kind: 'personal',
    });
    await expect(resolveSpace(h.pools, ps.n.id, 'bersama')).resolves.toEqual({
      spaceId: await spaceIdOf(h, ps.n.id, 'shared'),
      kind: 'shared',
    });
  });

  it('F pribadi = Pribadi F (bukan milik N); F bersama = Bersama yang sama dengan N', async () => {
    const f = must(ps.f);
    const fPribadi = await resolveSpace(h.pools, f.id, 'pribadi');
    expect(fPribadi).toEqual({ spaceId: await spaceIdOf(h, f.id, 'personal'), kind: 'personal' });
    expect(fPribadi.spaceId).not.toBe(await spaceIdOf(h, ps.n.id, 'personal'));
    const nBersama = await resolveSpace(h.pools, ps.n.id, 'bersama');
    await expect(resolveSpace(h.pools, f.id, 'bersama')).resolves.toEqual(nBersama);
  });

  it.each<Ruang>(['pribadi', 'bersama'])(
    'Luar %s = SpaceNotFoundError (not_found)',
    async (ruang) => {
      const luar = must(ps.luar);
      const err = await resolveSpace(h.pools, luar.id, ruang).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SpaceNotFoundError);
      expect(toLedgerError(err)).toEqual({ code: 'not_found' });
    },
  );

  it('user yang tidak ada = not_found', async () => {
    await expect(resolveSpace(h.pools, randomUUID(), 'pribadi')).rejects.toBeInstanceOf(
      SpaceNotFoundError,
    );
  });

  it('ruang di luar daftar (nilai URL mentah) = not_found tanpa kueri', async () => {
    await expect(
      resolveSpace(h.pools, ps.n.id, 'admin' as unknown as Ruang),
    ).rejects.toBeInstanceOf(SpaceNotFoundError);
  });

  it('withLedger: konteks user terpasang di ruang sendiri', async () => {
    const { spaceId } = await resolveSpace(h.pools, ps.n.id, 'pribadi');
    const uid = await withLedger(h.pools, ps.n.id, spaceId, async (c) => {
      const { rows } = await c.query<{ uid: string }>('select app.current_user_id() as uid');
      return rows[0]?.uid;
    });
    expect(uid).toBe(ps.n.id);
  });

  it('withLedger: ruang Pribadi pasangan dan Bersama untuk Luar = DK404 → not_found', async () => {
    const fPribadi = await spaceIdOf(h, must(ps.f).id, 'personal');
    const shared = await spaceIdOf(h, ps.n.id, 'shared');
    for (const [uid, space] of [
      [ps.n.id, fPribadi],
      [must(ps.luar).id, shared],
    ] as const) {
      const err = await withLedger(h.pools, uid, space, () => Promise.resolve('bocor')).catch(
        (e: unknown) => e,
      );
      expect(toLedgerError(err)).toEqual({ code: 'not_found' });
    }
  });

  it('withLedger mengulang transaksi yang kalah deadlock (40P01) sampai berhasil', async () => {
    const { spaceId } = await resolveSpace(h.pools, ps.n.id, 'bersama');
    const f = must(ps.f);
    let releaseA!: () => void;
    let releaseB!: () => void;
    const aLocked = new Promise<void>((r) => (releaseA = r));
    const bLocked = new Promise<void>((r) => (releaseB = r));
    const attempts = { a: 0, b: 0 };

    // A mengunci 1 lalu 2, B mengunci 2 lalu 1: Postgres memutus satu dengan 40P01.
    const run = (
      who: 'a' | 'b',
      uid: string,
      first: number,
      second: number,
      mine: () => void,
      theirs: Promise<void>,
    ) =>
      withLedger(h.pools, uid, spaceId, async (c) => {
        attempts[who]++;
        await c.query('select pg_advisory_xact_lock(424242, $1)', [first]);
        mine();
        await theirs;
        await c.query('select pg_advisory_xact_lock(424242, $1)', [second]);
        return who;
      });

    const results = await Promise.all([
      run('a', ps.n.id, 1, 2, releaseA, bLocked),
      run('b', f.id, 2, 1, releaseB, aLocked),
    ]);

    expect(results).toEqual(['a', 'b']);
    expect(attempts.a + attempts.b).toBe(3);
  });
});

describe('resolveSpace: F belum bergabung', () => {
  let ps: Personas;

  beforeEach(async () => {
    await resetLedger(h);
    ps = await seedPersonas(h, { farida: 'diundang' });
  });

  it.each<Ruang>(['bersama', 'pribadi'])('F %s = not_found', async (ruang) => {
    const err = await resolveSpace(h.pools, must(ps.f).id, ruang).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpaceNotFoundError);
    expect(toLedgerError(err)).toEqual({ code: 'not_found' });
  });
});

describe('B11: tanpa app.user_id tidak ada baris', () => {
  beforeEach(async () => {
    await resetLedger(h);
    await seedPersonas(h, { farida: 'bergabung' });
  });

  it('ruang dan keanggotaan tidak terbaca tanpa konteks user, padahal ada', async () => {
    const { rows: all } = await h.admin.query<{ n: number }>(
      'select count(*)::int as n from app.spaces',
    );
    expect(all[0]?.n).toBe(3);
    const counts = await withAnon(h.pools.app, async (c) => {
      const s = await c.query('select id from app.spaces');
      const m = await c.query('select space_id from app.space_members');
      return [s.rowCount, m.rowCount];
    });
    expect(counts).toEqual([0, 0]);
  });

  it('withUser user lain hanya melihat ruangnya sendiri (2 ruang)', async () => {
    const { rows } = await h.admin.query<{ id: string }>(
      `select id from auth."user" where email = 'farida@example.test'`,
    );
    const fid = rows[0]?.id ?? '';
    const n = await withUser(h.pools.app, fid, async (c) => {
      const r = await c.query('select id from app.spaces');
      return r.rowCount;
    });
    expect(n).toBe(2);
  });
});
