'use client';

import type { Route } from 'next';
import { useActionState, useState } from 'react';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { PaperPlaneTiltIcon } from '@/components/ui/icons/paper-plane-tilt';
import { card } from '@/components/ui/styles';
import { TextField } from '@/components/ui/text-field';
import { AuthText, AuthTitle } from '@/features/auth/auth-frame';
import {
  createInvitationAction,
  resendInvitationAction,
  revokeInvitationAction,
  signOutAction,
  type FormState,
} from '@/server/auth/actions';
import { Notice } from './notice';

const IDLE: FormState = { kind: 'idle' };

export interface InvitationView {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
  /** "Sen, 2 Nov, 10.32 WIB" (dihitung server). */
  expiresLabel: string;
}

const STATUS: Record<InvitationView['status'], string> = {
  pending: 'Menunggu',
  accepted: 'Diterima',
  declined: 'Ditolak',
  revoked: 'Dicabut',
  expired: 'Kedaluwarsa',
};

function Pending({ invitation }: { invitation: InvitationView }) {
  const [state, resend, pending] = useActionState(resendInvitationAction, IDLE);
  const [email, setEmail] = useState(invitation.email);
  return (
    <section aria-labelledby="undangan-tertunda" className={`flex flex-col gap-4 p-4 ${card}`}>
      <div className="flex flex-col gap-1">
        <h2 id="undangan-tertunda" className="text-body font-extrabold text-text">
          Undangan tertunda
        </h2>
        <p className="text-label font-medium break-all text-text-soft">
          {invitation.email}: {STATUS.pending}, berlaku sampai {invitation.expiresLabel}.
        </p>
      </div>
      {state.kind !== 'idle' ? (
        <Notice tone={state.kind === 'done' ? 'ok' : 'error'}>{state.message}</Notice>
      ) : null}
      <form action={resend} noValidate className="flex flex-col gap-3">
        <input type="hidden" name="id" value={invitation.id} />
        <TextField
          label="Email penerima"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={setEmail}
          hint="Salah ketik? Perbaiki lalu kirim ulang. Tautan lama langsung tidak berlaku."
          error={state.kind === 'error' && state.field === 'email' ? state.message : undefined}
        />
        <Button type="submit" variant="secondary" loading={pending}>
          Kirim ulang
        </Button>
      </form>
      <form action={revokeInvitationAction}>
        <input type="hidden" name="id" value={invitation.id} />
        <Button type="submit" variant="danger" className="w-full">
          Cabut undangan
        </Button>
      </form>
    </section>
  );
}

export function UndangReal({
  invitations,
  full,
  owner,
  notice,
}: {
  invitations: InvitationView[];
  /** Ruang Bersama sudah berdua. */
  full: boolean;
  owner: boolean;
  notice: string | null;
}) {
  const [state, action, pending] = useActionState(createInvitationAction, IDLE);
  const [email, setEmail] = useState('');
  const open = invitations.find((i) => i.status === 'pending');
  const history = invitations.filter((i) => i !== open).slice(0, 5);

  return (
    <>
      <BackLink href={'/pribadi/beranda' as Route}>Beranda</BackLink>
      <AuthTitle>Undang pasangan ke ruang Bersama</AuthTitle>
      <AuthText>
        Pasanganmu hanya akan melihat dompet, transaksi, dan rencana Bersama. Ruang Pribadi kalian
        tetap terpisah.
      </AuthText>
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      {!owner ? (
        <Notice tone="error">Hanya pemilik rumah tangga yang bisa mengundang.</Notice>
      ) : full ? (
        <Notice tone="ok">Ruang Bersama sudah berisi dua orang.</Notice>
      ) : open ? (
        <Pending key={open.id} invitation={open} />
      ) : state.kind === 'done' ? (
        <Notice tone="ok">{state.message}</Notice>
      ) : (
        <form action={action} noValidate className="flex flex-col gap-4">
          <TextField
            label="Email pasangan"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="nama@email.com"
            value={email}
            onChange={setEmail}
            error={state.kind === 'error' && state.field === 'email' ? state.message : undefined}
            hint="Tautan dikirim ke email ini. Berlaku 72 jam, sekali pakai."
          />
          {state.kind === 'error' && state.field === undefined ? (
            <Notice tone="error">{state.message}</Notice>
          ) : null}
          <Button type="submit" loading={pending}>
            <PaperPlaneTiltIcon size={18} weight="bold" />
            Kirim undangan
          </Button>
        </form>
      )}
      {history.length > 0 ? (
        <section aria-labelledby="riwayat-undangan" className="flex flex-col gap-2">
          <h2 id="riwayat-undangan" className="text-label font-bold text-text-soft">
            Undangan sebelumnya
          </h2>
          <ul className={`flex flex-col ${card}`}>
            {history.map((i) => (
              <li
                key={i.id}
                className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 border-t border-hairline px-4 py-2 first:border-t-0"
              >
                <span className="min-w-0 text-label font-medium break-all text-text">
                  {i.email}
                </span>
                <span className="text-label font-bold text-text-soft">{STATUS[i.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <form action={signOutAction}>
        <Button type="submit" variant="text" size="sm">
          Keluar
        </Button>
      </form>
    </>
  );
}
