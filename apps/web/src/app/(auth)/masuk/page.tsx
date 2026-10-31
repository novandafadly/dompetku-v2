'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FingerprintIcon } from '@/components/ui/icons/fingerprint';
import { TextField } from '@/components/ui/text-field';
import { AuthTitle } from '@/features/auth/auth-frame';
import { LinkButton } from '@/features/auth/link-button';
import { PasswordField } from '@/features/auth/password-field';
import { useDemo } from '@/features/shell/demo-provider';
import { Wordmark } from '@/features/shell/sidebar';

export default function MasukPage() {
  const { href, authHref } = useDemo();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <>
      <p className="pb-4">
        <Wordmark className="text-title" />
      </p>
      <AuthTitle>Masuk ke DompetKu</AuthTitle>
      <LinkButton href={href('pribadi', 'beranda')} size="lg">
        <FingerprintIcon size={20} weight="bold" />
        Masuk dengan passkey
      </LinkButton>
      <p className="flex items-center gap-3 text-label font-medium text-text-muted before:h-px before:flex-1 before:bg-hairline after:h-px after:flex-1 after:bg-hairline">
        atau dengan email
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
          inputMode="email"
          autoComplete="email"
          placeholder="nama@email.com"
          value={email}
          onChange={setEmail}
        />
        <PasswordField value={password} onChange={setPassword} />
        <Button type="submit" variant="secondary">
          Masuk
        </Button>
      </form>
    </>
  );
}
