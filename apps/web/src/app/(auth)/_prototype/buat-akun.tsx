'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { EnvelopeSimpleIcon } from '@/components/ui/icons/envelope-simple';
import { AuthText, AuthTitle } from '@/features/auth/auth-frame';
import { PasswordField } from '@/features/auth/password-field';
import { useDemo } from '@/features/shell/demo-provider';

const MIN_LENGTH = 12;

/**
 * Langkah setelah "Terima undangan": akun dibuat untuk email yang diundang (dari token undangan,
 * tidak bisa diganti), lalu lanjut ke Amankan (passkey, kode 6 digit, kode pemulihan).
 */
export function BuatAkunPrototype() {
  const { authHref } = useDemo();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  return (
    <>
      <BackLink href={authHref('terima-undangan')}>Undangan</BackLink>
      <AuthTitle>Buat akun</AuthTitle>
      <p className="flex items-start gap-2.5 rounded-xl border border-hairline bg-surface p-4 text-body font-medium text-text-soft">
        <EnvelopeSimpleIcon size={20} className="mt-0.5 shrink-0 text-bersama" />
        <span>Akun dibuat untuk email yang menerima undangan ini. Email tidak bisa diganti.</span>
      </p>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (password.length < MIN_LENGTH) {
            setError(`Kata sandi minimal ${String(MIN_LENGTH)} karakter.`);
            return;
          }
          router.push(authHref('amankan'));
        }}
      >
        <PasswordField
          label="Kata sandi baru"
          value={password}
          onChange={(v) => {
            setPassword(v);
            if (error && v.length >= MIN_LENGTH) setError(undefined);
          }}
          error={error}
        />
        <Button type="submit" size="lg">
          Buat akun
        </Button>
      </form>
      <AuthText>Berikutnya: amankan akun dengan passkey dan kode 6 digit.</AuthText>
    </>
  );
}
