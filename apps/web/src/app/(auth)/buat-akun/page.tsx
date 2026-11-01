import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { authService, currentSession } from '@/server/auth/next';
import { isPrototype } from '@/server/env';
import { BuatAkunReal } from '../_components/buat-akun-real';
import { INVALID_INVITE, InvalidLink } from '../_components/invalid-link';
import { param, type SearchParams } from '../_components/params';
import { BuatAkunPrototype } from '../_prototype/buat-akun';

export default async function BuatAkunPage({ searchParams }: { searchParams: SearchParams }) {
  if (isPrototype()) return <BuatAkunPrototype />;
  const state = await currentSession();
  if (state?.access.kind === 'securing') redirect('/amankan');
  if (state?.access.kind === 'full') redirect('/pribadi/beranda' as Route);
  const token = await param(searchParams, 't');
  if (token === '') return <BuatAkunReal token="" invitedEmail={null} />;
  const invite = await authService().peekInvitation(token);
  if (!invite) return <InvalidLink {...INVALID_INVITE} />;
  return <BuatAkunReal token={token} invitedEmail={invite.email} />;
}
