import { notFound } from 'next/navigation';
import { isPrototype } from '@/server/env';
import { LupaSandiReal } from '../_components/lupa-sandi-real';

export default function LupaSandiPage() {
  if (isPrototype()) notFound();
  return <LupaSandiReal />;
}
