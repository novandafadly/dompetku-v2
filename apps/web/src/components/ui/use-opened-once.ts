import { useState } from 'react';

/**
 * `true` sejak `open` pertama kali bernilai `true`, lalu tetap `true`.
 * Dipakai untuk memasang sheet yang dimuat malas hanya setelah dibuka sekali,
 * sehingga kodenya tidak ikut muat awal tetapi animasi tutupnya tetap berjalan.
 */
export function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened || open;
}
