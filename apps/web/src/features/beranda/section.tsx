import { useId, type ReactNode } from 'react';

/** Bagian Beranda: pemisah satu hairline dan jarak 32 px, tanpa kartu. */
export function BerandaSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-8 border-t border-hairline pt-6">
      <h2 id={id} className="mb-2 text-lg font-semibold text-text">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <li className="flex min-h-11 items-center justify-between gap-3 py-1.5">{children}</li>;
}
