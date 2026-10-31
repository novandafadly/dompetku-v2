import { notFound } from 'next/navigation';
import { Gallery } from './gallery';

export const dynamic = 'force-dynamic';

export default function DevUiPage() {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_PROTOTYPE !== '1')
    notFound();

  return <Gallery />;
}
