import type { Route } from 'next';
import { Button } from '@/components/ui/button';
import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { EyeIcon } from '@/components/ui/icons/eye';
import { EyeSlashIcon } from '@/components/ui/icons/eye-slash';
import { UsersThreeFillIcon } from '@/components/ui/icons/users-three-fill';
import { heroCard } from '@/components/ui/styles';
import { AuthText, AuthTitle } from '@/features/auth/auth-frame';
import { LinkButton } from '@/features/auth/link-button';
import { declineInvitationAction } from '@/server/auth/actions';
import { authService, requestHeaders } from '@/server/auth/next';
import { isPrototype } from '@/server/env';
import { INVALID_INVITE, InvalidLink, TOO_MANY_INVITE_TRIES } from '../_components/invalid-link';
import { param, type SearchParams } from '../_components/params';
import { TerimaUndanganPrototype } from '../_prototype/terima-undangan';

export default async function TerimaUndanganPage({ searchParams }: { searchParams: SearchParams }) {
  if (isPrototype()) return <TerimaUndanganPrototype />;
  const status = await param(searchParams, 'status');
  if (status === 'terlalu-sering') return <InvalidLink {...TOO_MANY_INVITE_TRIES} />;
  if (status === 'ditolak')
    return (
      <section role="status" className={`flex flex-col items-start gap-3 p-5 ${heroCard}`}>
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-toast bg-surface-2 text-text-soft"
        >
          <CheckCircleIcon size={26} />
        </span>
        <h1 className="text-headline font-extrabold text-text">Undangan ditolak</h1>
        <p className="text-label font-medium text-pretty text-text-soft">
          Tautannya tidak berlaku lagi dan tidak ada akun yang dibuat. Pengundang akan melihat
          status Ditolak.
        </p>
      </section>
    );
  const token = await param(searchParams, 't');
  // Intip undangan dibatasi per IP (20 per 10 menit): menebak token lewat halaman ini mahal.
  if (!(await authService().allowed('rl-undangan', await requestHeaders(), 20, 10 * 60)))
    return <InvalidLink {...TOO_MANY_INVITE_TRIES} />;
  const invite = await authService().peekInvitation(token);
  if (!invite) return <InvalidLink {...INVALID_INVITE} />;
  return (
    <>
      <div aria-hidden="true" className="flex items-center gap-3">
        <span className="flex size-14 items-center justify-center rounded-full border border-border bg-bersama-tint text-bersama">
          <UsersThreeFillIcon size={26} weight="fill" />
        </span>
      </div>
      <AuthTitle>Kamu diundang ke ruang Bersama</AuthTitle>
      <AuthText>Undangan untuk {invite.email}. Akun dibuat dengan email ini.</AuthText>
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
      <LinkButton href={`/buat-akun?t=${encodeURIComponent(token)}` as Route} size="lg">
        Terima undangan
      </LinkButton>
      <form action={declineInvitationAction}>
        <input type="hidden" name="token" value={token} />
        <Button type="submit" variant="text" className="w-full">
          Tolak undangan
        </Button>
      </form>
    </>
  );
}
