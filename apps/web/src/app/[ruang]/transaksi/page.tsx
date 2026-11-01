import { requireDataUser } from '@/server/auth/next';
import { TransaksiPage } from './view';

/**
 * Gerbang di page, bukan hanya di layout: request RSC bisa merender segmen page tanpa layout.
 * M1: data ruang hanya diambil sesudah gerbang ini, lewat withUser(state.userId, spaceId).
 */
export default async function Page() {
  await requireDataUser();
  return <TransaksiPage />;
}
