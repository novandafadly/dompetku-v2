'use client';

import { ArrowRightIcon } from '@/components/ui/icons/arrow-right';
import { EyeIcon } from '@/components/ui/icons/eye';
import { EyeSlashIcon } from '@/components/ui/icons/eye-slash';
import { UsersThreeFillIcon } from '@/components/ui/icons/users-three-fill';
import { AuthTitle } from '@/features/auth/auth-frame';
import { LinkButton } from '@/features/auth/link-button';
import { useDemo } from '@/features/shell/demo-provider';

export function TerimaUndanganPrototype() {
  const { authHref } = useDemo();
  return (
    <>
      <div aria-hidden="true" className="flex items-center gap-3">
        <span className="flex size-14 items-center justify-center rounded-full border border-border bg-surface-3 text-headline font-extrabold text-text">
          N
        </span>
        <ArrowRightIcon size={20} className="text-text-muted" />
        <span className="flex size-14 items-center justify-center rounded-full border border-border bg-bersama-tint text-bersama">
          <UsersThreeFillIcon size={26} weight="fill" />
        </span>
      </div>
      <AuthTitle>Novanda mengundang kamu ke ruang Bersama</AuthTitle>
      <ul className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface p-4 text-body font-medium text-text-soft">
        <li className="flex items-start gap-2.5">
          <EyeIcon size={20} className="mt-0.5 shrink-0 text-bersama" />
          <span>Terlihat berdua: dompet, transaksi, dan rencana Bersama.</span>
        </li>
        <li className="flex items-start gap-2.5">
          <EyeSlashIcon size={20} className="mt-0.5 shrink-0 text-accent-text" />
          <span>Tidak pernah terlihat: isi ruang Pribadi masing-masing.</span>
        </li>
      </ul>
      {/* Menerima undangan berlanjut ke Buat akun (kata sandi), lalu Amankan (passkey + kode). */}
      <LinkButton href={authHref('buat-akun')} size="lg">
        Terima undangan
      </LinkButton>
      <LinkButton href={authHref('masuk')} variant="text">
        Tolak
      </LinkButton>
    </>
  );
}
