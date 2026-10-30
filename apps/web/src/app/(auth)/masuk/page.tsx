'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { LinkButton } from '@/features/auth/link-button';
import { PasswordField } from '@/features/auth/password-field';
import { useDemo } from '@/features/shell/demo-provider';

export default function MasukPage() {
  const { href, authHref } = useDemo();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <>
      <h1 className="text-xl font-semibold text-text">Masuk ke dompetmu</h1>
      <LinkButton href={href('pribadi', 'beranda')}>Masuk dengan passkey</LinkButton>
      <p className="text-center text-base text-text-muted">atau</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(authHref('amankan'));
        }}
      >
        <TextField
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
        />
        <PasswordField value={password} onChange={setPassword} />
        <Button type="submit" variant="secondary">
          Masuk
        </Button>
        <p className="text-sm text-text-muted">
          Masuk dengan kata sandi diikuti kode autentikator di langkah berikutnya.
        </p>
      </form>
    </>
  );
}
