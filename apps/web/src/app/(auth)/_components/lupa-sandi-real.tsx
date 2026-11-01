'use client';

import { useActionState, useState } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { AuthText, AuthTitle } from '@/features/auth/auth-frame';
import { PasswordField } from '@/features/auth/password-field';
import { requestResetAction, resetPasswordAction, type FormState } from '@/server/auth/actions';
import { Notice } from './notice';

const IDLE: FormState = { kind: 'idle' };

export function LupaSandiReal() {
  const [state, action, pending] = useActionState(requestResetAction, IDLE);
  const [email, setEmail] = useState('');
  return (
    <>
      <BackLink href={'/masuk'}>Masuk</BackLink>
      <AuthTitle>Lupa kata sandi</AuthTitle>
      <AuthText>
        Kami mengirim tautan untuk membuat kata sandi baru. Passkey dan aplikasi autentikator tetap
        aktif; semua perangkat akan dikeluarkan.
      </AuthText>
      {state.kind === 'done' ? (
        <Notice tone="ok">{state.message}</Notice>
      ) : (
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
            error={state.kind === 'error' && state.field === 'email' ? state.message : undefined}
          />
          {state.kind === 'error' && state.field === undefined ? (
            <Notice tone="error">{state.message}</Notice>
          ) : null}
          <Button type="submit" size="lg" loading={pending}>
            Kirim tautan
          </Button>
        </form>
      )}
    </>
  );
}

export function AturSandiReal({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, IDLE);
  const [password, setPassword] = useState('');
  return (
    <>
      <AuthTitle>Buat kata sandi baru</AuthTitle>
      <form action={action} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        <PasswordField
          label="Kata sandi baru"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={state.kind === 'error' && state.field === 'password' ? state.message : undefined}
          hint="Minimal 12 karakter."
        />
        {state.kind === 'error' && state.field === undefined ? (
          <Notice tone="error">{state.message}</Notice>
        ) : null}
        <Button type="submit" size="lg" loading={pending}>
          Simpan kata sandi
        </Button>
      </form>
    </>
  );
}
