import { isPrototype } from '@/server/env';
import { PatunganLoading } from '../_real/patungan';

/** Kerangka selama server memuat Patungan; prototipe tidak punya halaman ini (page = 404). */
export default function Loading() {
  if (isPrototype()) return null;
  return <PatunganLoading />;
}
