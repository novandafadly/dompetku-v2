import { useId, type ReactNode } from 'react';
import { listBlock, listRow } from '@/components/ui/styles';

/** Bagian Beranda: judul lalu baris datar di surface. Jarak antarbagian diatur grid halaman. */
export function BerandaSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-3 text-lg font-semibold text-text">
        {title}
      </h2>
      <div className={listBlock}>{children}</div>
    </section>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return (
    <li className={`flex min-h-12 items-center justify-between gap-3 py-2 ${listRow}`}>
      {children}
    </li>
  );
}

/** Kalimat keadaan kosong di dalam blok bagian. */
export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="py-3 text-base text-text-muted">{children}</p>;
}
