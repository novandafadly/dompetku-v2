'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EnvelopeSimpleIcon } from '@/components/ui/icons/envelope-simple';
import { TextField } from '@/components/ui/text-field';
import { AuthText, AuthTitle } from '@/features/auth/auth-frame';
import { LinkButton } from '@/features/auth/link-button';
import { PasswordField } from '@/features/auth/password-field';
import { signUpAction, type FormState } from '@/server/auth/actions';
import { Notice } from './notice';

const IDLE: FormState = { kind: 'idle' };

/**
 * Buat akun. Dengan token undangan: email dari undangan (tidak bisa diganti), lanjut ke /amankan.
 * Tanpa token: akun pertama (pemilik); respons selalu "periksa email" agar tidak membocorkan
 * email mana yang boleh mendaftar.
 */
export function BuatAkunReal({
  token,
  invitedEmail,
}: {
  token: string;
  invitedEmail: string | null;
}) {
  const [state, action, pending] = useActionState(signUpAction, IDLE);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const fieldError = (f: string) =>
    state.kind === 'error' && state.field === f ? state.message : undefined;

  if (state.kind === 'done')
    return (
      <>
        <AuthTitle>Periksa email</AuthTitle>
        <Notice tone="ok">{state.message}</Notice>
        <LinkButton href={'/masuk'} variant="secondary">
          Ke halaman Masuk
        </LinkButton>
      </>
    );

  return (
    <>
      <AuthTitle>Buat akun</AuthTitle>
      {invitedEmail ? (
        <p className="flex items-start gap-2.5 rounded-xl border border-hairline bg-surface p-4 text-body font-medium text-text-soft">
          <EnvelopeSimpleIcon size={20} className="mt-0.5 shrink-0 text-bersama" />
          <span>
            Akun dibuat untuk <strong className="font-bold text-text">{invitedEmail}</strong>, email
            yang menerima undangan ini. Email tidak bisa diganti.
          </span>
        </p>
      ) : (
        <AuthText>Akun pertama rumah tangga. Kami mengirim tautan konfirmasi ke emailmu.</AuthText>
      )}
      <form action={action} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        {invitedEmail ? (
          // Untuk pengelola sandi: akun yang disimpan memakai email undangan.
          <input type="hidden" name="username" autoComplete="username" value={invitedEmail} />
        ) : (
          <TextField
            label="Email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            placeholder="nama@email.com"
            value={email}
            onChange={setEmail}
            error={fieldError('email')}
          />
        )}
        <TextField
          label="Nama panggilan"
          name="name"
          autoComplete="nickname"
          maxLength={40}
          value={name}
          onChange={setName}
          error={fieldError('name')}
          hint="Tampil di ruang Bersama, mis. di “dicatat oleh”."
        />
        <PasswordField
          label="Kata sandi baru"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={fieldError('password')}
          hint="Minimal 12 karakter. Kalimat pendek lebih mudah diingat."
        />
        {state.kind === 'error' && state.field === undefined ? (
          <Notice tone="error">{state.message}</Notice>
        ) : null}
        <Button type="submit" size="lg" loading={pending}>
          Buat akun
        </Button>
      </form>
      {invitedEmail ? (
        <AuthText>Berikutnya: amankan akun dengan passkey atau aplikasi autentikator.</AuthText>
      ) : null}
    </>
  );
}
