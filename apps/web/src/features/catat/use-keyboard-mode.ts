import { useEffect, useState } from 'react';

/**
 * Mode keyboard HP (C1): area terlihat pendek karena keyboard layar muncul. Hanya di bawah 600 px;
 * mulai 600 px Catat adalah dialog tengah.
 */
export function useKeyboardMode(active: boolean): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    const update = () => {
      const height = vv?.height ?? window.innerHeight;
      setCompact(window.innerWidth < 600 && height < 560);
    };
    update();
    vv?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
    };
  }, [active]);
  return compact;
}
