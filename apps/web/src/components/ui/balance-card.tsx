import type { HTMLAttributes } from 'react';

/**
 * Motif identitas (DESIGN.md): satu kartu saldo per layar, berlatar tint ruang dengan garis
 * atas aksen ruang. Hanya untuk angka utama layar (aman dipakai, kekayaan bersih).
 */
export function BalanceCard({ className = '', children, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...rest}
      className={`relative rounded-card bg-accent-tint p-5 text-text before:absolute before:inset-x-5 before:top-0 before:h-0.5 before:rounded-pill before:bg-accent sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}
