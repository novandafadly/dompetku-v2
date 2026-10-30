'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { LinkButton } from '@/features/auth/link-button';
import { useDemo } from '@/features/shell/demo-provider';

export default function UndangPage() {
  const { authHref, href } = useDemo();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [sentTo, setSentTo] = useState<string | null>(null);
  return (
    <>
      <h1 className="text-xl font-semibold text-text">Undang Farida</h1>
      <p className="text-base text-text-muted">
        DompetKu dipakai berdua. Undangan ini membuka akun kedua, dan tidak ada akun ketiga.
      </p>
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
          label="Email Farida"
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={setEmail}
          error={error}
          hint="Tautan berlaku 72 jam, sekali pakai."
        />
        <Button type="submit">Buat tautan undangan</Button>
      </form>
      {sentTo === null ? null : (
        <section
          aria-label="Tautan undangan"
          role="status"
          className="flex flex-col gap-3 rounded-card bg-surface p-4"
        >
          <p className="text-base text-text">
            Tautan untuk {sentTo} siap dikirim. Berlaku 72 jam dan hanya bisa dipakai sekali.
          </p>
          <LinkButton href={authHref('terima-undangan')} variant="secondary">
            Buka sebagai Farida
          </LinkButton>
        </section>
      )}
      <LinkButton href={href('pribadi', 'beranda')} variant="secondary">
        Kembali ke Beranda
      </LinkButton>
    </>
  );
}
