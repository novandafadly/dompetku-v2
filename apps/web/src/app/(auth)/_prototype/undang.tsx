'use client';

import { useState } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { PaperPlaneTiltIcon } from '@/components/ui/icons/paper-plane-tilt';
import { TextField } from '@/components/ui/text-field';
import { AuthText, AuthTitle } from '@/features/auth/auth-frame';
import { LinkButton } from '@/features/auth/link-button';
import { useDemo } from '@/features/shell/demo-context';

export function UndangPrototype() {
  const { authHref, href } = useDemo();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [sentTo, setSentTo] = useState<string | null>(null);
  return (
    <>
      <BackLink href={href('pribadi', 'beranda')}>Beranda</BackLink>
      <AuthTitle>Undang Farida ke ruang Bersama</AuthTitle>
      <AuthText>
        Farida hanya akan melihat dompet, transaksi, dan rencana Bersama. Ruang Pribadi kalian tetap
        terpisah.
      </AuthText>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = email.trim();
          if (trimmed === '') {
            setError('Isi email Farida.');
            return;
          }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
            setError('Email belum lengkap, contoh: nama@email.com.');
            return;
          }
          setError(undefined);
          setSentTo(trimmed);
        }}
      >
        <TextField
          label="Email pasangan"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="nama@email.com"
          value={email}
          onChange={setEmail}
          error={error}
          hint="Tautan berlaku 72 jam, sekali pakai."
        />
        <Button type="submit">
          <PaperPlaneTiltIcon size={18} weight="bold" />
          Kirim undangan
        </Button>
      </form>
      {sentTo === null ? null : (
        <section
          aria-label="Tautan undangan"
          role="status"
          className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface-2 p-4"
        >
          <p className="flex items-start gap-2 text-body font-medium text-text">
            <CheckCircleIcon size={20} weight="fill" className="mt-0.5 shrink-0 text-accent-text" />
            <span>
              Tautan untuk {sentTo} siap dikirim. Berlaku 72 jam dan hanya bisa dipakai sekali.
            </span>
          </p>
          <LinkButton href={authHref('terima-undangan')} variant="secondary">
            Buka sebagai Farida
          </LinkButton>
        </section>
      )}
    </>
  );
}
