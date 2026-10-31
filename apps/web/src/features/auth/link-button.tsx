import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClass, type ButtonSize, type ButtonVariant } from '@/components/ui/button';

/** Tautan bergaya tombol: layar tiruan hanya berpindah langkah. */
export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  children,
}: {
  href: Route;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, `text-center ${className}`)}>
      {children}
    </Link>
  );
}
