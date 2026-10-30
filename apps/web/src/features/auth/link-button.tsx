import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { focusRing } from '@/components/ui/styles';

const variants = {
  primary: 'bg-accent text-on-accent hover:brightness-95',
  secondary: 'border border-border bg-surface text-text hover:bg-surface-2',
} as const;

/** Tautan bergaya tombol: layar tiruan hanya berpindah langkah. */
export function LinkButton({
  href,
  variant = 'primary',
  children,
}: {
  href: Route;
  variant?: keyof typeof variants;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-field px-4 text-center text-base font-semibold ${focusRing} ${variants[variant]}`}
    >
      {children}
    </Link>
  );
}
