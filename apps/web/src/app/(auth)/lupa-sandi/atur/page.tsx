import { notFound } from 'next/navigation';
import { isPrototype } from '@/server/env';
import { InvalidLink } from '../../_components/invalid-link';
import { AturSandiReal } from '../../_components/lupa-sandi-real';
import { param, type SearchParams } from '../../_components/params';

export default async function AturSandiPage({ searchParams }: { searchParams: SearchParams }) {
  if (isPrototype()) notFound();
  const token = await param(searchParams, 'token');
  if (token === '')
    return (
      <InvalidLink
        title="Tautan tidak lengkap"
        description="Buka tautan dari email atur ulang kata sandi, atau minta tautan baru."
        action={{ href: '/lupa-sandi', label: 'Minta tautan baru' }}
      />
    );
  return <AturSandiReal token={token} />;
}
