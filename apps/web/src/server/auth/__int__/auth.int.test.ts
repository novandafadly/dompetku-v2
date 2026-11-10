import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Browser,
  OWNER,
  PARTNER,
  PASSWORD,
  bootstrapOwner,
  createHarness,
  linkFromLastMail,
  reset,
  secureWithTotp,
  totp,
  userId,
} from './harness';
import { throttleKey } from '../throttle';

const h = createHarness();
afterAll(() => h.close());
beforeEach(() => reset(h));

async function invite(owner: Browser, email = PARTNER): Promise<string> {
  const state = (await h.service.session(owner.headers())).state;
  if (!state) throw new Error('pemilik tanpa sesi');
  const r = await h.service.createInvitation(owner.headers(), state.userId, 'Novanda', email);
  expect(r.kind).toBe('sent');
  return linkFromLastMail(h, 't');
}

async function acceptAsPartner(token: string): Promise<Browser> {
  const b = new Browser('198.51.100.9');
  const r = await h.service.signUpInvitee(b.headers(), token, 'Farida', PASSWORD);
  expect(r.result.kind).toBe('ok');
  b.absorb(r.setCookie);
  await secureWithTotp(h, b);
  return b;
}

describe('akun pertama lewat allowlist (app.settings.owner_email)', () => {
  it('email lain tidak membuat akun, respons tetap seragam', async () => {
    const r = await h.service.signUpOwner(
      new Browser().headers(),
      'X',
      'orang@example.test',
      PASSWORD,
    );
    expect(r.kind).toBe('check_email');
    const { rows } = await h.admin.query('select 1 from auth."user"');
    expect(rows).toHaveLength(0);
    expect(h.mailer.sent).toHaveLength(0);
  });

  it('cek kata sandi bocor dan batas panjang sama untuk owner_email dan email lain', async () => {
    const pwned = createHarness(undefined, { checkPwnedPasswords: true });
    // Rentang HIBP palsu yang memuat sufiks SHA-1 kata sandi uji: dianggap bocor.
    const sha1 = createHash('sha1').update(PASSWORD).digest('hex').toUpperCase();
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      const href = input instanceof Request ? input.url : input.toString();
      expect(href).toBe(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`);
      return Promise.resolve(new Response(`${sha1.slice(5)}:3\r\n`, { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const signUp = (email: string, password: string, ip: string) =>
        pwned.service.signUpOwner(new Browser(ip).headers(), 'X', email, password);
      expect(await signUp('orang@example.test', PASSWORD, '192.0.2.31')).toEqual({
        kind: 'weak',
        reason: 'compromised',
      });
      expect(await signUp(OWNER, PASSWORD, '192.0.2.32')).toEqual({
        kind: 'weak',
        reason: 'compromised',
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const long = 'a'.repeat(129);
      expect(await signUp('orang@example.test', long, '192.0.2.33')).toEqual(
        await signUp(OWNER, long, '192.0.2.34'),
      );
      const { rows } = await h.admin.query('select 1 from auth."user"');
      expect(rows).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
      await pwned.close();
    }
  });

  it('pemilik: konfirmasi email, amankan dengan TOTP, rumah tangga dibuat, sesi penuh', async () => {
    const b = new Browser();
    expect(
      (await h.service.signUpOwner(b.headers(), 'Novanda', ' Novanda@Example.TEST ', PASSWORD))
        .kind,
    ).toBe('check_email');
    // Tidak ada sesi dari pendaftaran.
    expect((await h.admin.query('select 1 from auth.session')).rows).toHaveLength(0);

    const before = await h.service.signInPassword(b.headers(), OWNER, PASSWORD);
    expect(before.result).toEqual({ kind: 'ok', next: 'amankan' });
    b.absorb(before.setCookie);
    let state = (await h.service.session(b.headers())).state;
    expect(state?.access.kind).toBe('securing');
    expect(state && (await h.service.securingStep(state))).toBe('verifikasi-email');
    expect((await h.service.finishSecuring(b.headers())).result.kind).toBe('email_unverified');

    expect(await h.service.verifyEmail(linkFromLastMail(h, 'token'))).toBe(true);
    state = (await h.service.session(b.headers())).state;
    expect(state && (await h.service.securingStep(state))).toBe('faktor');
    expect((await h.service.finishSecuring(b.headers())).result.kind).toBe('no_factor');

    const { codes } = await secureWithTotp(h, b);
    expect(codes).toHaveLength(10);
    state = (await h.service.session(b.headers())).state;
    expect(state?.amr).toBe('password+totp');
    expect(state?.access.kind).toBe('full');
    expect(await h.service.household(state?.userId ?? '')).toEqual({ role: 'owner', members: 1 });
    const hashes = await h.admin.query<{ code_hash: string }>(
      'select code_hash from auth.recovery_codes',
    );
    expect(hashes.rows).toHaveLength(10);
    expect(hashes.rows.every((r) => r.code_hash.startsWith('$argon2id$'))).toBe(true);
  });

  it('masuk berikutnya dengan kata sandi butuh TOTP; tanpa TOTP tidak ada sesi', async () => {
    const { secret } = await bootstrapOwner(h);
    const b = new Browser();
    const step1 = await h.service.signInPassword(b.headers(), OWNER, PASSWORD);
    expect(step1.result.kind).toBe('totp');
    b.absorb(step1.setCookie);
    expect((await h.service.session(b.headers())).state).toBeNull();

    const wrong = await h.service.verifyTotpSignIn(b.headers(), '000000');
    expect(wrong.result.kind).toBe('invalid');
    const ok = await h.service.verifyTotpSignIn(b.headers(), totp(secret));
    expect(ok.result).toEqual({ kind: 'ok', next: 'beranda' });
    b.absorb(ok.setCookie);
    const state = (await h.service.session(b.headers())).state;
    expect(state?.amr).toBe('password+totp');
    expect(state?.access.kind).toBe('full');
  });
});

describe('undangan', () => {
  it('dibuat, diintip, akun dibuat, diterima hanya setelah diamankan', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    const token = await invite(owner);
    expect(await h.service.peekInvitation(token)).toMatchObject({ email: PARTNER });

    const b = new Browser('198.51.100.9');
    const signUp = await h.service.signUpInvitee(b.headers(), token, 'Farida', PASSWORD);
    expect(signUp.result.kind).toBe('ok');
    b.absorb(signUp.setCookie);
    const { rows } = await h.admin.query<{ emailVerified: boolean }>(
      'select "emailVerified" from auth."user" where email = $1',
      [PARTNER],
    );
    expect(rows[0]?.emailVerified).toBe(true);

    // Sesi enrolling (kata sandi saja): bukan sesi penuh, undangan belum terpakai.
    const state = (await h.service.session(b.headers())).state;
    expect(state?.amr).toBe('password');
    expect(state?.access.kind).toBe('securing');
    expect((await h.service.finishSecuring(b.headers())).result.kind).toBe('no_factor');
    const ownerId = await userId(h, OWNER);
    expect((await h.service.listInvitations(ownerId))[0]?.status).toBe('pending');

    await secureWithTotp(h, b);
    const after = (await h.service.session(b.headers())).state;
    expect(after?.access.kind).toBe('full');
    expect((await h.service.listInvitations(ownerId))[0]?.status).toBe('accepted');
    expect(await h.service.household(ownerId)).toEqual({ role: 'owner', members: 2 });
    expect(await h.service.peekInvitation(token)).toBeNull();
  });

  it('akun setengah jadi bisa melanjutkan dengan masuk kata sandi', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    const token = await invite(owner);
    const first = new Browser('198.51.100.9');
    const r = await h.service.signUpInvitee(first.headers(), token, 'Farida', PASSWORD);
    expect(r.result.kind).toBe('ok');
    // Tautan dibuka lagi: akun sudah ada.
    expect(
      (await h.service.signUpInvitee(first.headers(), token, 'Farida', PASSWORD)).result.kind,
    ).toBe('account_exists');
    const later = new Browser('198.51.100.10');
    const signIn = await h.service.signInPassword(later.headers(), PARTNER, PASSWORD);
    expect(signIn.result).toEqual({ kind: 'ok', next: 'amankan' });
    later.absorb(signIn.setCookie);
    await secureWithTotp(h, later);
    expect((await h.service.session(later.headers())).state?.access.kind).toBe('full');
  });

  it('pengguna ketiga ditolak (batas 2 user)', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    await acceptAsPartner(await invite(owner));
    const state = (await h.service.session(owner.headers())).state;
    const third = await h.service.createInvitation(
      owner.headers(),
      state?.userId ?? '',
      'Novanda',
      'ketiga@example.test',
    );
    expect(third.kind).toBe('user_limit');
    expect(
      (await h.service.signUpOwner(new Browser().headers(), 'X', 'ketiga@example.test', PASSWORD))
        .kind,
    ).toBe('check_email');
    const { rows } = await h.admin.query('select 1 from auth."user"');
    expect(rows).toHaveLength(2);
  });

  it('ditolak penerima: hangus, pengundang melihat status Ditolak', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    const token = await invite(owner);
    expect(await h.service.declineInvitation(new Browser().headers(), token)).toBe(true);
    expect(await h.service.declineInvitation(new Browser().headers(), token)).toBe(false);
    expect(await h.service.peekInvitation(token)).toBeNull();
    expect(
      (await h.service.signUpInvitee(new Browser().headers(), token, 'F', PASSWORD)).result.kind,
    ).toBe('invite_invalid');
    expect((await h.service.listInvitations(await userId(h, OWNER)))[0]?.status).toBe('declined');
  });

  it('dicabut dan dikirim ulang: token lama hangus, token baru berlaku', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    const ownerId = await userId(h, OWNER);
    const oldToken = await invite(owner, 'salah@example.test');
    const [pending] = await h.service.listInvitations(ownerId);
    const resent = await h.service.resendInvitation(
      owner.headers(),
      ownerId,
      'Novanda',
      pending?.id ?? '',
      PARTNER,
    );
    expect(resent).toEqual({ kind: 'sent', email: PARTNER });
    const newToken = linkFromLastMail(h, 't');
    expect(await h.service.peekInvitation(oldToken)).toBeNull();
    expect(await h.service.peekInvitation(newToken)).toMatchObject({ email: PARTNER });

    const [current] = await h.service.listInvitations(ownerId);
    expect(await h.service.revokeInvitation(owner.headers(), ownerId, current?.id ?? '')).toBe(
      true,
    );
    expect(await h.service.peekInvitation(newToken)).toBeNull();
    expect((await h.service.listInvitations(ownerId))[0]?.status).toBe('revoked');
  });

  it('kedaluwarsa setelah 72 jam', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    const token = await invite(owner);
    await h.admin.query(
      "update app.invitations set created_at = created_at - interval '73 hours', expires_at = expires_at - interval '73 hours'",
    );
    expect(await h.service.peekInvitation(token)).toBeNull();
    expect(
      (await h.service.signUpInvitee(new Browser().headers(), token, 'F', PASSWORD)).result.kind,
    ).toBe('invite_invalid');
  });

  it('undangan dibatalkan setelah akun dibuat: tidak bisa diselesaikan', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    const token = await invite(owner);
    const b = new Browser('198.51.100.9');
    b.absorb((await h.service.signUpInvitee(b.headers(), token, 'Farida', PASSWORD)).setCookie);
    const ownerId = await userId(h, OWNER);
    const [pending] = await h.service.listInvitations(ownerId);
    await h.service.revokeInvitation(owner.headers(), ownerId, pending?.id ?? '');
    await expect(secureWithTotp(h, b)).rejects.toThrow('invite_invalid');
  });
});

const insertPasskey = (id: string, cred: string) =>
  h.admin.query(
    `insert into auth.passkey ("publicKey", "userId", "credentialID", counter, "deviceType", "backedUp", "createdAt")
     values ('pk', $1, $2, 0, 'singleDevice', false, now())`,
    [id, cred],
  );

describe('faktor terikat ke sesi pendaftarnya', () => {
  it('passkey: hanya sesi pendaftar yang naik; sesi kata sandi kedua dicabut; token diganti', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    const token = await invite(owner);
    const victim = new Browser('198.51.100.9');
    victim.absorb(
      (await h.service.signUpInvitee(victim.headers(), token, 'Farida', PASSWORD)).setCookie,
    );
    // Penyerang yang tahu kata sandi membuka sesi kata sandi kedua (enrolling, sah sebelum ada faktor).
    const attacker = new Browser('192.0.2.66');
    const signIn = await h.service.signInPassword(attacker.headers(), PARTNER, PASSWORD);
    expect(signIn.result.kind).toBe('ok');
    attacker.absorb(signIn.setCookie);
    expect((await h.service.session(attacker.headers())).state?.access.kind).toBe('securing');

    // Korban mendaftarkan passkey (baris dari Better Auth + pengikatan ke sesinya).
    const id = await userId(h, PARTNER);
    await insertPasskey(id, 'cred-korban');
    const victimState = (await h.service.session(victim.headers())).state;
    if (!victimState) throw new Error('sesi korban hilang');
    await h.service.recordPasskeyEnrollment(victimState, victim.headers());

    // Sesi penyerang dicabut; tanpa pencabutan pun ia tidak ikut naik (lihat tes berikut).
    expect((await h.service.session(attacker.headers())).state).toBeNull();
    const step = (await h.service.session(victim.headers())).state;
    expect(step && (await h.service.securingStep(step))).toBe('pemulihan');

    const oldCookie = victim.headers().get('cookie');
    await h.service.createRecoveryCodes(victim.headers());
    const done = await h.service.finishSecuring(victim.headers());
    expect(done.result.kind).toBe('ok');
    // Token lama tidak berlaku; cookie baru = sesi penuh ber-amr passkey.
    expect((await h.service.session(new Headers({ cookie: oldCookie ?? '' }))).state).toBeNull();
    victim.absorb(done.setCookie);
    const after = (await h.service.session(victim.headers())).state;
    expect(after?.amr).toBe('passkey');
    expect(after?.access.kind).toBe('full');
  });

  it('passkey milik sesi lain tidak membuka sesi kata sandi mana pun', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    const token = await invite(owner);
    const a = new Browser('198.51.100.9');
    a.absorb((await h.service.signUpInvitee(a.headers(), token, 'Farida', PASSWORD)).setCookie);
    const b = new Browser('192.0.2.66');
    b.absorb((await h.service.signInPassword(b.headers(), PARTNER, PASSWORD)).setCookie);
    // Passkey ada, tetapi tidak terikat ke sesi mana pun.
    await insertPasskey(await userId(h, PARTNER), 'cred-lepas');
    for (const x of [a, b]) {
      const state = (await h.service.session(x.headers())).state;
      expect(state?.access).toEqual({ kind: 'denied', reason: 'needs_strong_factor' });
      expect((await h.service.finishSecuring(x.headers())).result.kind).toBe('not_allowed');
      await expect(h.service.createRecoveryCodes(x.headers())).rejects.toThrow();
    }
  });

  it('TOTP: sesi pendaftar diganti sesi password+totp; sesi kata sandi lain dicabut', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    const token = await invite(owner);
    const a = new Browser('198.51.100.9');
    a.absorb((await h.service.signUpInvitee(a.headers(), token, 'Farida', PASSWORD)).setCookie);
    const b = new Browser('192.0.2.66');
    b.absorb((await h.service.signInPassword(b.headers(), PARTNER, PASSWORD)).setCookie);
    const oldCookie = a.headers().get('cookie') ?? '';
    const begin = await h.service.totpBegin(a.headers(), PASSWORD);
    if (begin.kind !== 'ok') throw new Error(begin.kind);
    const confirm = await h.service.totpConfirm(a.headers(), totp(begin.secret));
    expect(confirm.result.kind).toBe('ok');
    a.absorb(confirm.setCookie);
    expect((await h.service.session(new Headers({ cookie: oldCookie }))).state).toBeNull();
    expect((await h.service.session(b.headers())).state).toBeNull();
    const state = (await h.service.session(a.headers())).state;
    expect(state?.amr).toBe('password+totp');
    expect(state?.access.kind).toBe('securing');
  });

  it('TOTP: token sesi baru tidak terbaca = semua sesi dicabut, bukan sesi lain dibiarkan', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    const token = await invite(owner);
    const a = new Browser('198.51.100.9');
    a.absorb((await h.service.signUpInvitee(a.headers(), token, 'Farida', PASSWORD)).setCookie);
    const b = new Browser('192.0.2.66');
    b.absorb((await h.service.signInPassword(b.headers(), PARTNER, PASSWORD)).setCookie);
    const begin = await h.service.totpBegin(a.headers(), PASSWORD);
    if (begin.kind !== 'ok') throw new Error(begin.kind);
    // Set-Cookie verifyTOTP tanpa token sesi (mis. format cookie Better Auth berubah).
    const api = h.service.auth.api;
    const original = api.verifyTOTP as unknown as (...a: unknown[]) => Promise<object>;
    const stripped = async (...args: unknown[]) => ({
      ...(await original(...args)),
      headers: new Headers(),
    });
    const spy = vi
      .spyOn(api, 'verifyTOTP')
      .mockImplementationOnce(stripped as unknown as typeof api.verifyTOTP);
    await expect(h.service.totpConfirm(a.headers(), totp(begin.secret))).rejects.toThrow();
    spy.mockRestore();
    const partner = await userId(h, PARTNER);
    const { rows } = await h.admin.query('select 1 from auth.session where "userId" = $1', [
      partner,
    ]);
    expect(rows).toHaveLength(0);
    expect((await h.service.session(b.headers())).state).toBeNull();
  });

  it('kata sandi benar pada akun berpasskey: respons sama dengan kata sandi salah', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    const token = await invite(owner);
    const a = new Browser('198.51.100.9');
    a.absorb((await h.service.signUpInvitee(a.headers(), token, 'Farida', PASSWORD)).setCookie);
    await insertPasskey(await userId(h, PARTNER), 'cred-1');
    const right = await h.service.signInPassword(
      new Browser('192.0.2.7').headers(),
      PARTNER,
      PASSWORD,
    );
    const wrong = await h.service.signInPassword(
      new Browser('192.0.2.8').headers(),
      PARTNER,
      'salah-salah-salah',
    );
    expect(right).toEqual(wrong);
    expect(right.result).toEqual({ kind: 'invalid' });
  });
});

describe('sesi tanpa faktor kuat', () => {
  it('sesi kata sandi saja hanya boleh mengamankan, tidak penuh', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    const token = await invite(owner);
    const b = new Browser();
    b.absorb((await h.service.signUpInvitee(b.headers(), token, 'Farida', PASSWORD)).setCookie);
    const state = (await h.service.session(b.headers())).state;
    expect(state?.access).toEqual({ kind: 'securing' });
  });

  it('akun yang sudah punya faktor kuat tidak bisa memakai sesi kata sandi untuk mendaftar faktor', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    const ownerId = await userId(h, OWNER);
    // Sesi kata sandi saja dibuat paksa untuk akun ber-TOTP (mis. bug atau jalur lain).
    await h.admin.query(`update auth.session set amr = 'password' where "userId" = $1`, [ownerId]);
    const state = (await h.service.session(owner.headers())).state;
    expect(state?.access).toEqual({ kind: 'denied', reason: 'needs_strong_factor' });
    await expect(h.service.totpBegin(owner.headers(), PASSWORD)).rejects.toThrow();
    await expect(h.service.createRecoveryCodes(owner.headers())).rejects.toThrow();
  });

  it('sesi lebih dari 30 hari ditolak dan dihapus', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    await h.admin.query(`update auth.session set "createdAt" = now() - interval '31 days'`);
    expect((await h.service.session(owner.headers())).state).toBeNull();
    expect((await h.admin.query('select 1 from auth.session')).rows).toHaveLength(0);
  });
});

describe('kode pemulihan', () => {
  it('masuk dengan kode: sesi lain dicabut, kode hangus, sesi hanya untuk mengamankan [B19]', async () => {
    const { browser: first, codes, secret } = await bootstrapOwner(h);
    const second = new Browser('192.0.2.1');
    const s1 = await h.service.signInPassword(second.headers(), OWNER, PASSWORD);
    second.absorb(s1.setCookie);
    second.absorb((await h.service.verifyTotpSignIn(second.headers(), totp(secret))).setCookie);
    expect((await h.service.session(second.headers())).state?.access.kind).toBe('full');

    const lost = new Browser('192.0.2.2');
    const code = codes[3] ?? '';
    const r = await h.service.recoverySignIn(lost.headers(), OWNER, code.toLowerCase());
    expect(r.result.kind).toBe('ok');
    lost.absorb(r.setCookie);

    expect((await h.service.session(first.headers())).state).toBeNull();
    expect((await h.service.session(second.headers())).state).toBeNull();
    const state = (await h.service.session(lost.headers())).state;
    expect(state?.amr).toBe('recovery');
    expect(state?.access.kind).toBe('securing');
    expect(h.mailer.sent.at(-1)?.subject).toMatch(/pemulihan/);
    const used = await h.admin.query('select 1 from auth.recovery_codes where used_at is not null');
    expect(used.rows).toHaveLength(1);
    const events = await h.admin.query<{ event: string }>(
      "select event from audit.events where event in ('recovery_code_used', 'session_revoked')",
    );
    expect(events.rows.map((e) => e.event).sort()).toEqual([
      'recovery_code_used',
      'session_revoked',
    ]);

    // Kode yang sama tidak bisa dipakai lagi.
    expect((await h.service.recoverySignIn(new Browser().headers(), OWNER, code)).result.kind).toBe(
      'invalid',
    );
    // Selesai mengamankan butuh kode pemulihan baru dari sesi ini.
    expect((await h.service.finishSecuring(lost.headers())).result.kind).toBe('no_factor');
  });

  it('kode salah dan email tak dikenal: respons sama', async () => {
    await bootstrapOwner(h);
    const a = await h.service.recoverySignIn(new Browser().headers(), OWNER, 'AAAAA-AAAAA');
    const b = await h.service.recoverySignIn(
      new Browser().headers(),
      'siapa@example.test',
      'AAAAA-AAAAA',
    );
    expect(a.result).toEqual(b.result);
  });
});

describe('jeda gagal dan lupa kata sandi', () => {
  it('5 kata sandi salah = jeda 1 menit, juga untuk kata sandi benar', async () => {
    await bootstrapOwner(h);
    const b = new Browser('192.0.2.50');
    for (let i = 0; i < 4; i++)
      expect(
        (await h.service.signInPassword(b.headers(), OWNER, 'salah-salah-salah')).result.kind,
      ).toBe('invalid');
    expect(
      (await h.service.signInPassword(b.headers(), OWNER, 'salah-salah-salah')).result,
    ).toEqual({
      kind: 'throttled',
      seconds: 60,
    });
    const blocked = await h.service.signInPassword(b.headers(), OWNER, PASSWORD);
    expect(blocked.result.kind).toBe('throttled');
    // Email tak dikenal mendapat respons yang sama dengan kata sandi salah.
    const unknown = await h.service.signInPassword(
      new Browser('192.0.2.51').headers(),
      'x@example.test',
      'salah-salah-salah',
    );
    expect(unknown.result.kind).toBe('invalid');
  });

  it('kata sandi benar sebelum TOTP hanya menghapus hitungan akun, bukan hitungan IP', async () => {
    const { secret } = await bootstrapOwner(h);
    const b = new Browser('192.0.2.60');
    for (let i = 0; i < 3; i++)
      expect(
        (
          await h.service.signInPassword(
            b.headers(),
            `x${String(i)}@example.test`,
            'salah-salah-salah',
          )
        ).result.kind,
      ).toBe('invalid');
    const step1 = await h.service.signInPassword(b.headers(), OWNER, PASSWORD);
    expect(step1.result.kind).toBe('totp');
    b.absorb(step1.setCookie);
    // Hitungan IP (3 gagal + 1) tetap: percobaan berikutnya dari IP ini mencapai ambang 5.
    expect(
      (await h.service.signInPassword(b.headers(), 'y@example.test', 'salah-salah-salah')).result,
    ).toEqual({ kind: 'throttled', seconds: 60 });
    // Hitungan akun dihapus: dari IP lain, akun pemilik tidak membawa gagal sebelumnya.
    const other = new Browser('192.0.2.61');
    const again = await h.service.signInPassword(other.headers(), OWNER, PASSWORD);
    expect(again.result.kind).toBe('totp');
    other.absorb(again.setCookie);
    // Masuk penuh (TOTP benar) baru menghapus hitungan IP kata sandi.
    expect((await h.service.verifyTotpSignIn(other.headers(), totp(secret))).result.kind).toBe(
      'ok',
    );
    const { rows } = await h.admin.query('select 1 from auth.login_throttle where key = $1', [
      throttleKey('password', 'ip', '192.0.2.61'),
    ]);
    expect(rows).toHaveLength(0);
  });

  it('reset kata sandi: respons seragam, semua sesi dicabut, TOTP tetap aktif', async () => {
    const { browser: owner, secret } = await bootstrapOwner(h);
    h.mailer.sent.length = 0;
    expect(
      await h.service.requestPasswordReset(new Browser().headers(), 'siapa@example.test'),
    ).toEqual({ kind: 'sent' });
    expect(h.mailer.sent).toHaveLength(0);
    expect(await h.service.requestPasswordReset(new Browser().headers(), OWNER)).toEqual({
      kind: 'sent',
    });
    const token = linkFromLastMail(h, 'token');
    expect((await h.service.resetPassword(token, 'pendek')).kind).toBe('weak');
    expect(await h.service.resetPassword(token, 'kata-sandi-baru-yang-panjang')).toEqual({
      kind: 'ok',
    });
    expect((await h.service.session(owner.headers())).state).toBeNull();

    const b = new Browser();
    const r = await h.service.signInPassword(b.headers(), OWNER, 'kata-sandi-baru-yang-panjang');
    expect(r.result.kind).toBe('totp');
    b.absorb(r.setCookie);
    expect((await h.service.verifyTotpSignIn(b.headers(), totp(secret))).result.kind).toBe('ok');
  });
});

describe('WhatsApp diputus saat akun diamankan ulang', () => {
  // Sesi curian bisa menghubungkan nomor penyerang; reset kata sandi dan masuk dengan kode
  // pemulihan mencabut semua sesi, jadi tautan WhatsApp ikut diputus (spec WA §4.3).
  async function linkPhone(email: string, phone: string): Promise<string> {
    const id = await userId(h, email);
    await h.admin.query(
      'insert into app.wa_links (user_id, phone_e164, verified_at) values ($1, $2, now())',
      [id, phone],
    );
    await h.admin.query(
      `insert into app.wa_link_codes (user_id, code_hash, expires_at)
       values ($1, $2, now() + interval '10 minutes')`,
      [id, createHash('sha256').update(id).digest('hex')],
    );
    return id;
  }
  async function waState(id: string): Promise<string> {
    const { rows } = await h.admin.query<{ s: string }>(
      `select (select count(*) from app.wa_links where user_id = $1) || '/'
           || (select count(*) from app.wa_link_codes where user_id = $1) || ' '
           || coalesce((select string_agg(meta->>'via', ',' order by id) from audit.events
                         where event = 'wa_unlinked' and user_id = $1), '-') as s`,
      [id],
    );
    return rows[0]?.s ?? '';
  }

  it('reset kata sandi: nomor + kode tertunda dihapus, audit via password_reset; user lain utuh', async () => {
    const { browser: owner } = await bootstrapOwner(h);
    await acceptAsPartner(await invite(owner));
    const n = await linkPhone(OWNER, '+6281234567890');
    const f = await linkPhone(PARTNER, '+6285711112222');
    await h.service.requestPasswordReset(new Browser().headers(), OWNER);
    const token = linkFromLastMail(h, 'token');
    expect(await h.service.resetPassword(token, 'kata-sandi-baru-yang-panjang')).toEqual({
      kind: 'ok',
    });
    expect(await waState(n)).toBe('0/0 password_reset');
    expect(await waState(f)).toBe('1/1 -');
    const { rows } = await h.admin.query<{ event: string }>(
      `select event from audit.events where user_id = $1
         and event in ('password_reset_done', 'wa_unlinked') order by id`,
      [n],
    );
    expect(rows.map((r) => r.event)).toEqual(['password_reset_done', 'wa_unlinked']);
  });

  it('reset kata sandi tanpa nomor terhubung: tanpa event wa_unlinked', async () => {
    await bootstrapOwner(h);
    const n = await userId(h, OWNER);
    await h.service.requestPasswordReset(new Browser().headers(), OWNER);
    expect(
      await h.service.resetPassword(linkFromLastMail(h, 'token'), 'kata-sandi-baru-yang-panjang'),
    ).toEqual({ kind: 'ok' });
    expect(await waState(n)).toBe('0/0 -');
  });

  it('masuk dengan kode pemulihan: nomor diputus, audit via session_revoked; user lain utuh', async () => {
    const { browser: owner, codes } = await bootstrapOwner(h);
    await acceptAsPartner(await invite(owner));
    const n = await linkPhone(OWNER, '+6281234567890');
    const f = await linkPhone(PARTNER, '+6285711112222');
    const r = await h.service.recoverySignIn(
      new Browser('192.0.2.7').headers(),
      OWNER,
      codes[0] ?? '',
    );
    expect(r.result.kind).toBe('ok');
    expect(await waState(n)).toBe('0/0 session_revoked');
    expect(await waState(f)).toBe('1/1 -');
  });

  it('kode pemulihan salah: nomor tetap terhubung', async () => {
    await bootstrapOwner(h);
    const n = await linkPhone(OWNER, '+6281234567890');
    const r = await h.service.recoverySignIn(
      new Browser('192.0.2.8').headers(),
      OWNER,
      'AAAAA-AAAAA',
    );
    expect(r.result.kind).toBe('invalid');
    expect(await waState(n)).toBe('1/1 -');
  });
});

describe('jeda tanpa celah periksa-lalu-catat', () => {
  it('8 percobaan paralel: paling banyak 5 diperiksa, sisanya langsung dijeda', async () => {
    await bootstrapOwner(h);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        h.service.signInPassword(
          new Browser(`192.0.2.${String(100 + i)}`).headers(),
          OWNER,
          'salah-salah-salah',
        ),
      ),
    );
    const invalid = results.filter((r) => r.result.kind === 'invalid').length;
    expect(invalid).toBeLessThanOrEqual(4);
    expect(results.filter((r) => r.result.kind === 'throttled').length).toBeGreaterThanOrEqual(4);
    const after = await h.service.signInPassword(
      new Browser('192.0.2.200').headers(),
      OWNER,
      PASSWORD,
    );
    expect(after.result.kind).toBe('throttled');
  });
});
