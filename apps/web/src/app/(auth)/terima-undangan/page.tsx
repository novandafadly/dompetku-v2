'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { PasswordField } from '@/features/auth/password-field';
import { useDemo } from '@/features/shell/demo-provider';

export default function TerimaUndanganPage() {
  const { authHref } = useDemo();
  const router = useRouter();
  const [password, setPassword] = useState('');
  return (
    <>
      <h1 className="text-xl font-semibold text-text">Novanda mengundang kamu ke ruang Bersama</h1>
      <p className="text-base text-text-muted">
        Buat akunmu. Setelah itu kamu mengamankannya dengan passkey dan kode autentikator.
      </p>
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
          autoComplete="email"
          value="farida@example.com"
          onChange={() => undefined}
          readOnly
          hint="Sudah terisi dari undangan."
        />
        <PasswordField value={password} onChange={setPassword} />
        <Button type="submit">Buat akun</Button>
      </form>
    </>
  );
}
