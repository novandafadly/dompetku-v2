'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useActionState, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { CaretLeftIcon } from '@/components/ui/icons/caret-left';
import { FingerprintIcon } from '@/components/ui/icons/fingerprint';
import { focusRing } from '@/components/ui/styles';
import { TextField } from '@/components/ui/text-field';
import { AuthText, AuthTitle } from '@/features/auth/auth-frame';
import { PasswordField } from '@/features/auth/password-field';
import { Wordmark } from '@/features/shell/sidebar';
import {
  passkeySignInAction,
  passkeySignInOptionsAction,
  recoverySignInAction,
  signInPasswordAction,
  verifyTotpAction,
  type FormState,
  type SignInState,
} from '@/server/auth/actions';
import { CodeField } from './code-field';
import { Notice } from './notice';
import { getAssertion } from './passkey';

const IDLE: FormState = { kind: 'idle' };

const PASSKEY_ERROR = {
  unsupported:
    'Peramban ini belum mendukung passkey. Masuk dengan email dan kata sandi, atau pakai kode pemulihan.',
  cancelled:
    'Passkey dibatalkan atau tidak ditemukan di perangkat ini. Coba lagi, atau masuk dengan email dan kata sandi.',
  failed: 'Passkey ini tidak dikenali. Coba passkey lain, atau masuk dengan email dan kata sandi.',
} as const;

const linkText = `inline-flex min-h-11 items-center self-start rounded-md px-1 -ml-1 text-body font-bold text-accent-text hover-pointer:underline ${focusRing}`;

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`${linkText} gap-1.5`}>
      <CaretLeftIcon size={16} weight="bold" />
      Kembali
    </button>
  );
}

function TotpStep({ onBack }: { onBack: () => void }) {
  const [state, action, pending] = useActionState(verifyTotpAction, IDLE);
  const [code, setCode] = useState('');
  return (
    <>
      <BackButton onClick={onBack} />
      <AuthTitle>Masukkan kode 6 digit</AuthTitle>
      <AuthText>Buka aplikasi autentikator, lalu ketik kode untuk DompetKu.</AuthText>
      <form action={action} noValidate className="flex flex-col gap-4">
        <CodeField
          value={code}
          onChange={setCode}
          invalid={state.kind === 'error'}
          {...(state.kind === 'error' ? { describedBy: 'totp-galat' } : {})}
        />
        {state.kind === 'error' ? (
          <p id="totp-galat" className="sr-only">
            {state.message}
          </p>
        ) : null}
        {state.kind === 'error' ? <Notice tone="error">{state.message}</Notice> : null}
        <Button type="submit" size="lg" disabled={code.length !== 6} loading={pending}>
          Verifikasi
        </Button>
      </form>
      <AuthText>HP hilang? Kembali, lalu pilih “Pakai kode pemulihan”.</AuthText>
    </>
  );
}

function RecoveryStep({ onBack, initialEmail }: { onBack: () => void; initialEmail: string }) {
  const [state, action, pending] = useActionState(recoverySignInAction, IDLE);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  return (
    <>
      <BackButton onClick={onBack} />
      <AuthTitle>Masuk dengan kode pemulihan</AuthTitle>
      <AuthText>
        Pakai satu kode dari daftar yang kamu simpan saat mengamankan akun. Kode itu hangus setelah
        dipakai, dan semua perangkat lain akan dikeluarkan.
      </AuthText>
      <form action={action} noValidate className="flex flex-col gap-4">
        <TextField
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
        />
        <TextField
          label="Kode pemulihan"
          name="code"
          autoComplete="off"
          placeholder="XXXXX-XXXXX"
          value={code}
          onChange={setCode}
          maxLength={20}
        />
        {state.kind === 'error' ? <Notice tone="error">{state.message}</Notice> : null}
        <Button type="submit" size="lg" loading={pending}>
          Masuk
        </Button>
      </form>
    </>
  );
}

type Step = 'awal' | 'totp' | 'pemulihan';

export function MasukReal({ notice }: { notice: string | null }) {
  const [step, setStep] = useState<Step>('awal');
  const [state, action, pending] = useActionState(async (prev: SignInState, form: FormData) => {
    const next = await signInPasswordAction(prev, form);
    if (next.kind === 'totp') setStep('totp');
    return next;
  }, IDLE as SignInState);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passkeyError, setPasskeyError] = useState<keyof typeof PASSKEY_ERROR | null>(null);
  const [passkeyPending, startPasskey] = useTransition();

  if (step === 'totp')
    return (
      <TotpStep
        onBack={() => {
          setStep('awal');
        }}
      />
    );
  if (step === 'pemulihan')
    return (
      <RecoveryStep
        initialEmail={email}
        onBack={() => {
          setStep('awal');
        }}
      />
    );

  return (
    <>
      <p className="pb-4">
        <Wordmark className="text-title" />
      </p>
      <AuthTitle>Masuk ke DompetKu</AuthTitle>
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      <Button
        size="lg"
        loading={passkeyPending}
        onClick={() => {
          setPasskeyError(null);
          startPasskey(async () => {
            const options = await passkeySignInOptionsAction();
            const r = await getAssertion(options);
            if ('error' in r) {
              setPasskeyError(r.error);
              return;
            }
            const res = await passkeySignInAction(r.response);
            if (!res.ok) setPasskeyError('failed');
          });
        }}
      >
        <FingerprintIcon size={20} weight="bold" />
        Masuk dengan passkey
      </Button>
      {passkeyError ? <Notice tone="error">{PASSKEY_ERROR[passkeyError]}</Notice> : null}
      <p className="flex items-center gap-3 text-label font-medium text-text-muted before:h-px before:flex-1 before:bg-hairline after:h-px after:flex-1 after:bg-hairline">
        atau dengan email
      </p>
      <form action={action} noValidate className="flex flex-col gap-4">
        <TextField
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          placeholder="nama@email.com"
          value={email}
          onChange={setEmail}
        />
        <PasswordField
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        {state.kind === 'error' ? <Notice tone="error">{state.message}</Notice> : null}
        <Button type="submit" variant="secondary" loading={pending}>
          Masuk
        </Button>
      </form>
      <div className="flex flex-col items-start">
        <Link href={'/lupa-sandi' as Route} className={linkText}>
          Lupa kata sandi?
        </Link>
        <button
          type="button"
          className={linkText}
          onClick={() => {
            setStep('pemulihan');
          }}
        >
          Pakai kode pemulihan
        </button>
      </div>
    </>
  );
}
