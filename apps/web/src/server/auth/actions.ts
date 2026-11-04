'use server';

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/browser';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { encode } from 'uqr';
import { applySetCookie, authService, requestHeaders, requireUser } from './next';
import { waitText } from './wait-text';

/**
 * Server Action auth (TRD §3.4: Server Action = endpoint publik). Setiap aksi memakai sesi dari
 * DB lewat AuthService; aksi yang butuh sesi memanggil requireUser lebih dulu. Hasil berupa objek
 * kecil yang ditampilkan form; galat tidak pernah membocorkan apakah email terdaftar.
 */

export type FormState =
  | { kind: 'idle' }
  | { kind: 'error'; message: string; field?: string }
  | { kind: 'done'; message: string };

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}

function throttled(seconds: number): FormState {
  return {
    kind: 'error',
    message: `Terlalu banyak percobaan. Coba lagi dalam ${waitText(seconds)}.`,
  };
}

const WEAK: Record<'too_short' | 'too_long' | 'compromised', string> = {
  too_short: 'Kata sandi minimal 12 karakter.',
  too_long: 'Kata sandi maksimal 128 karakter.',
  compromised: 'Kata sandi ini pernah bocor di situs lain. Pilih kata sandi lain.',
};

// ===== Masuk =====

export type SignInState = FormState | { kind: 'totp' };

export async function signInPasswordAction(_: SignInState, form: FormData): Promise<SignInState> {
  const email = text(form, 'email');
  const password = text(form, 'password');
  if (email.trim() === '' || password === '')
    return { kind: 'error', message: 'Isi email dan kata sandi.' };
  const { result, setCookie } = await authService().signInPassword(
    await requestHeaders(),
    email,
    password,
  );
  await applySetCookie(setCookie);
  if (result.kind === 'ok')
    redirect(result.next === 'amankan' ? '/amankan' : ('/pribadi/beranda' as Route));
  switch (result.kind) {
    case 'totp':
      return { kind: 'totp' };
    case 'throttled':
      return throttled(result.seconds);
    case 'invalid':
      return { kind: 'error', message: 'Email atau kata sandi salah.' };
  }
}

export async function verifyTotpAction(_: FormState, form: FormData): Promise<FormState> {
  const code = text(form, 'code').replace(/\D/g, '');
  if (code.length !== 6) return { kind: 'error', message: 'Kode terdiri dari 6 angka.' };
  const { result, setCookie } = await authService().verifyTotpSignIn(await requestHeaders(), code);
  await applySetCookie(setCookie);
  if (result.kind === 'ok')
    redirect(result.next === 'amankan' ? '/amankan' : ('/pribadi/beranda' as Route));
  switch (result.kind) {
    case 'throttled':
      return throttled(result.seconds);
    case 'restart':
      return {
        kind: 'error',
        message: 'Waktu verifikasi habis. Masuk lagi dengan email dan kata sandi.',
      };
    case 'invalid':
      return {
        kind: 'error',
        message: 'Kode salah. Pakai kode terbaru di aplikasi autentikator.',
      };
  }
}

export async function recoverySignInAction(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, 'email');
  const code = text(form, 'code');
  if (email.trim() === '' || code.trim() === '')
    return { kind: 'error', message: 'Isi email dan satu kode pemulihan.' };
  const { result, setCookie } = await authService().recoverySignIn(
    await requestHeaders(),
    email,
    code,
  );
  await applySetCookie(setCookie);
  if (result.kind === 'ok') redirect('/amankan');
  if (result.kind === 'throttled') return throttled(result.seconds);
  return { kind: 'error', message: 'Email atau kode pemulihan salah.' };
}

export async function passkeySignInOptionsAction(): Promise<
  { ok: true; options: unknown } | { ok: false }
> {
  const r = await authService().passkeyAuthenticationOptions(await requestHeaders());
  if (!r) return { ok: false };
  await applySetCookie(r.setCookie);
  return { ok: true, options: r.options };
}

export async function passkeySignInAction(
  response: AuthenticationResponseJSON,
): Promise<{ ok: boolean }> {
  const { result, setCookie } = await authService().passkeySignIn(await requestHeaders(), response);
  await applySetCookie(setCookie);
  if (result.kind === 'ok')
    redirect(result.next === 'amankan' ? '/amankan' : ('/pribadi/beranda' as Route));
  return { ok: false };
}

export async function signOutAction(): Promise<void> {
  await applySetCookie(await authService().signOut(await requestHeaders()));
  redirect('/masuk?status=keluar');
}

// ===== Daftar dan undangan pra-login =====

export async function signUpAction(_: FormState, form: FormData): Promise<FormState> {
  const token = text(form, 'token');
  const name = text(form, 'name').trim();
  const password = text(form, 'password');
  if (name === '' || name.length > 40)
    return { kind: 'error', field: 'name', message: 'Isi nama panggilan, maksimal 40 karakter.' };
  if (password.length < 12) return { kind: 'error', field: 'password', message: WEAK.too_short };
  const service = authService();
  const headers = await requestHeaders();
  if (token === '') {
    const email = text(form, 'email');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return {
        kind: 'error',
        field: 'email',
        message: 'Email belum lengkap, contoh: nama@email.com.',
      };
    const r = await service.signUpOwner(headers, name, email, password);
    if (r.kind === 'weak') return { kind: 'error', field: 'password', message: WEAK[r.reason] };
    if (r.kind === 'throttled') return throttled(r.seconds);
    return {
      kind: 'done',
      message: `Kalau ${email.trim()} boleh membuat akun di sini, tautan konfirmasi sudah dikirim ke email itu. Buka tautannya, lalu masuk.`,
    };
  }
  const { result, setCookie } = await service.signUpInvitee(headers, token, name, password);
  await applySetCookie(setCookie);
  if (result.kind === 'ok') redirect('/amankan');
  switch (result.kind) {
    case 'weak':
      return { kind: 'error', field: 'password', message: WEAK[result.reason] };
    case 'account_exists':
      return {
        kind: 'error',
        message: 'Akun untuk email ini sudah dibuat. Masuk untuk melanjutkan mengamankan akun.',
      };
    case 'invite_invalid':
      return {
        kind: 'error',
        message: 'Undangan ini tidak berlaku lagi. Minta pengundang mengirim undangan baru.',
      };
  }
}

export async function declineInvitationAction(form: FormData): Promise<void> {
  const headers = await requestHeaders();
  const service = authService();
  if (!(await service.allowed('rl-undangan', headers, 20, 10 * 60)))
    redirect('/terima-undangan?status=terlalu-sering');
  const ok = await service.declineInvitation(headers, text(form, 'token'));
  redirect((ok ? '/terima-undangan?status=ditolak' : '/terima-undangan') as Route);
}

export async function verifyEmailAction(form: FormData): Promise<void> {
  const ok = await authService().verifyEmail(text(form, 'token'));
  redirect((ok ? '/masuk?status=terverifikasi' : '/verifikasi-email?status=gagal') as Route);
}

// ===== Lupa kata sandi =====

export async function requestResetAction(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, 'email').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return {
      kind: 'error',
      field: 'email',
      message: 'Email belum lengkap, contoh: nama@email.com.',
    };
  const r = await authService().requestPasswordReset(await requestHeaders(), email);
  if (r.kind === 'throttled') return throttled(r.seconds);
  return {
    kind: 'done',
    message: `Kalau ${email} terdaftar, tautan untuk mengganti kata sandi sudah dikirim. Tautan berlaku 30 menit.`,
  };
}

export async function resetPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const password = text(form, 'password');
  if (password.length < 12) return { kind: 'error', field: 'password', message: WEAK.too_short };
  const r = await authService().resetPassword(text(form, 'token'), password);
  if (r.kind === 'ok') redirect('/masuk?status=sandi-diganti');
  if (r.kind === 'weak') return { kind: 'error', field: 'password', message: WEAK[r.reason] };
  return {
    kind: 'error',
    message: 'Tautan ini tidak berlaku lagi. Minta tautan baru dari halaman Lupa kata sandi.',
  };
}

// ===== Amankan =====

export type TotpSetupState =
  FormState | { kind: 'scan'; secret: string; qrPath: string; qrSize: number };

/** Jalur SVG modul gelap QR (dirender sebagai satu <path>, tanpa HTML mentah). */
function qrPath(uri: string): { path: string; size: number } {
  const qr = encode(uri, { ecc: 'M', border: 2 });
  let path = '';
  qr.data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path += `M${String(x)} ${String(y)}h1v1h-1z`;
    });
  });
  return { path, size: qr.size };
}

export async function totpBeginAction(_: TotpSetupState, form: FormData): Promise<TotpSetupState> {
  await requireUser('securing');
  const r = await authService().totpBegin(await requestHeaders(), text(form, 'password'));
  if (r.kind === 'wrong_password')
    return { kind: 'error', field: 'password', message: 'Kata sandi salah.' };
  if (r.kind === 'throttled') return throttled(r.seconds);
  if (r.kind !== 'ok') redirect('/amankan');
  const qr = qrPath(r.uri);
  return { kind: 'scan', secret: r.secret, qrPath: qr.path, qrSize: qr.size };
}

export async function totpConfirmAction(_: FormState, form: FormData): Promise<FormState> {
  await requireUser('securing');
  const code = text(form, 'code').replace(/\D/g, '');
  if (code.length !== 6) return { kind: 'error', message: 'Kode terdiri dari 6 angka.' };
  const { result, setCookie } = await authService().totpConfirm(await requestHeaders(), code);
  await applySetCookie(setCookie);
  if (result.kind === 'ok') redirect('/amankan');
  if (result.kind === 'throttled') return throttled(result.seconds);
  return {
    kind: 'error',
    message: 'Kode salah. Pastikan jam HP tepat, lalu ketik kode terbaru.',
  };
}

export async function passkeyRegisterOptionsAction(): Promise<
  { kind: 'ok'; options: unknown } | { kind: 'stale' }
> {
  await requireUser('securing');
  const r = await authService().passkeyRegistrationOptions(await requestHeaders());
  if ('stale' in r) return { kind: 'stale' };
  await applySetCookie(r.setCookie);
  return { kind: 'ok', options: r.options };
}

export async function passkeyRegisterAction(response: RegistrationResponseJSON): Promise<boolean> {
  await requireUser('securing');
  return authService().passkeyRegister(await requestHeaders(), response);
}

export async function recoveryCodesAction(): Promise<string[]> {
  await requireUser('securing');
  return authService().createRecoveryCodes(await requestHeaders());
}

const FINISH_ERROR: Record<string, string> = {
  no_factor: 'Daftarkan passkey atau aplikasi autentikator dulu.',
  no_recovery_codes: 'Buat kode pemulihan dulu.',
  email_unverified: 'Konfirmasi email dulu lewat tautan yang kami kirim.',
  invite_invalid:
    'Undangan ini sudah dicabut atau lewat 72 jam. Minta pengundang mengirim undangan baru.',
  user_limit: 'Ruang Bersama sudah berisi dua orang.',
  not_allowed: 'Akun ini belum bisa diselesaikan. Masuk lagi lalu coba sekali lagi.',
};

export async function finishSecuringAction(_: FormState, form: FormData): Promise<FormState> {
  await requireUser('securing');
  if (text(form, 'saved') !== 'ya')
    return { kind: 'error', field: 'saved', message: 'Centang dulu setelah kode tersimpan.' };
  const { result, setCookie } = await authService().finishSecuring(await requestHeaders());
  await applySetCookie(setCookie);
  if (result.kind === 'ok') redirect('/pribadi/beranda' as Route);
  return {
    kind: 'error',
    message: FINISH_ERROR[result.kind] ?? FINISH_ERROR.not_allowed ?? '',
  };
}

export async function resendVerificationAction(): Promise<FormState> {
  const state = await requireUser('securing');
  const service = authService();
  if (!(await service.allowed('rl-verifikasi', await requestHeaders(), 5, 60 * 60, state.userId)))
    return { kind: 'error', message: 'Tautan sudah dikirim beberapa kali. Coba lagi nanti.' };
  await service.auth.api
    .sendVerificationEmail({ body: { email: state.email } })
    .catch(() => undefined);
  return { kind: 'done', message: `Tautan baru dikirim ke ${state.email}.` };
}

// ===== Undangan (pemilik) =====

export async function createInvitationAction(_: FormState, form: FormData): Promise<FormState> {
  const state = await requireUser('full');
  const r = await authService().createInvitation(
    await requestHeaders(),
    state.userId,
    state.name,
    text(form, 'email'),
  );
  switch (r.kind) {
    case 'sent':
      return {
        kind: 'done',
        message: `Undangan terkirim ke ${r.email}. Berlaku 72 jam, sekali pakai.`,
      };
    case 'invalid_email':
      return {
        kind: 'error',
        field: 'email',
        message: 'Email belum lengkap, contoh: nama@email.com.',
      };
    case 'open_exists':
      return {
        kind: 'error',
        message: 'Masih ada undangan yang menunggu. Cabut atau kirim ulang.',
      };
    case 'user_limit':
      return { kind: 'error', message: 'Ruang Bersama sudah berisi dua orang.' };
    case 'not_owner':
      return { kind: 'error', message: 'Hanya pemilik ruang Bersama yang bisa mengundang.' };
  }
}

export async function revokeInvitationAction(form: FormData): Promise<void> {
  const state = await requireUser('full');
  await authService().revokeInvitation(await requestHeaders(), state.userId, text(form, 'id'));
  redirect('/undang?status=dicabut');
}

export async function resendInvitationAction(_: FormState, form: FormData): Promise<FormState> {
  const state = await requireUser('full');
  const r = await authService().resendInvitation(
    await requestHeaders(),
    state.userId,
    state.name,
    text(form, 'id'),
    text(form, 'email'),
  );
  if (r.kind === 'sent')
    return {
      kind: 'done',
      message: `Undangan baru terkirim ke ${r.email}. Tautan lama tidak berlaku lagi.`,
    };
  if (r.kind === 'invalid_email')
    return {
      kind: 'error',
      field: 'email',
      message: 'Email belum lengkap, contoh: nama@email.com.',
    };
  return { kind: 'error', message: 'Undangan ini sudah tidak menunggu. Muat ulang halaman.' };
}
