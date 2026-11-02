import { notFound } from 'next/navigation';
import { isPrototype } from '@/server/env';
import { ruangContext } from '../_real/context';
import { RencanaPage } from './view';

/**
 * Rencana (anggaran, tagihan) milik milestone berikutnya: hanya prototipe. Mode nyata tetap
 * lewat gerbang sesi dulu (`ruangContext`), lalu 404.
 */
export default async function Page({ params }: { params: Promise<{ ruang: string }> }) {
  if (isPrototype()) return <RencanaPage />;
  await ruangContext(params);
  notFound();
}
