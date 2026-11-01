import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { AuthText, AuthTitle } from '@/features/auth/auth-frame';
import { verifyEmailAction } from '@/server/auth/actions';
import { isPrototype } from '@/server/env';
import { InvalidLink } from '../_components/invalid-link';
import { param, type SearchParams } from '../_components/params';

/**
 * Konfirmasi email akun pertama. Butuh satu ketukan (POST), bukan GET: pemindai tautan di kotak
 * masuk tidak ikut mengonfirmasi.
 */
export default async function VerifikasiEmailPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  if (isPrototype()) notFound();
  const token = await param(searchParams, 'token');
  if ((await param(searchParams, 'status')) === 'gagal' || token === '')
    return (
      <InvalidLink
        title="Tautan konfirmasi tidak berlaku"
        description="Tautan sudah dipakai atau lewat 24 jam. Masuk dengan email dan kata sandi untuk meminta tautan baru."
        action={{ href: '/masuk', label: 'Ke halaman Masuk' }}
      />
    );
  return (
    <>
      <AuthTitle>Konfirmasi email</AuthTitle>
      <AuthText>Satu langkah lagi sebelum mengamankan akun.</AuthText>
      <form action={verifyEmailAction}>
        <input type="hidden" name="token" value={token} />
        <Button type="submit" size="lg" className="w-full">
          Konfirmasi email
        </Button>
      </form>
    </>
  );
}
