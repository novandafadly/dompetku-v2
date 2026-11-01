import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { currentSession } from '@/server/auth/next';
import { isPrototype } from '@/server/env';
import { MasukReal } from '../_components/masuk-real';
import { param, type SearchParams } from '../_components/params';
import { MasukPrototype } from '../_prototype/masuk';

const NOTICE: Record<string, string> = {
  terverifikasi: 'Email terkonfirmasi. Masuk untuk melanjutkan mengamankan akun.',
  'sandi-diganti': 'Kata sandi sudah diganti dan semua perangkat dikeluarkan. Masuk lagi.',
  keluar: 'Kamu sudah keluar.',
  faktor: 'Masuk dengan passkey, atau kata sandi dan kode 6 digit, untuk membuka DompetKu.',
};

export default async function MasukPage({ searchParams }: { searchParams: SearchParams }) {
  if (isPrototype()) return <MasukPrototype />;
  const state = await currentSession();
  if (state?.access.kind === 'full') redirect('/pribadi/beranda' as Route);
  if (state?.access.kind === 'securing') redirect('/amankan');
  return <MasukReal notice={NOTICE[await param(searchParams, 'status')] ?? null} />;
}
