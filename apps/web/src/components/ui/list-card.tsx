import type { Route } from 'next';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { CaretRightIcon } from './icons/caret-right';
import { card, focusRing } from './styles';

/**
 * Kartu daftar (surface, hairline, radius 16, padding 14 16 4): judul 14/700 text-soft dengan ikon 18,
 * tautan opsional "Semua ›" atau subtotal di kanan.
 */
export function ListCard({
  title,
  icon,
  link,
  aside,
  note,
  headingLevel = 2,
  className = '',
  children,
}: {
  title: string;
  icon?: ReactNode;
  link?: { href: Route; label: string; srLabel?: string };
  aside?: ReactNode;
  /** Baris keterangan di bawah judul (mis. label Kantor). */
  note?: ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section
      aria-labelledby={id}
      className={`flex flex-col gap-0.5 px-4 pt-3.5 pb-1 ${card} ${className}`}
    >
      <div className="flex min-h-7 items-center justify-between gap-2">
        <Heading
          id={id}
          className="flex min-w-0 items-center gap-2 text-label font-bold text-text-soft"
        >
          {icon ? (
            <span aria-hidden="true" className="inline-flex shrink-0">
              {icon}
            </span>
          ) : null}
          {title}
        </Heading>
        {link ? (
          <Link
            href={link.href}
            className={`-my-2 -mr-2 inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-md px-2 text-meta font-bold text-accent-text hover-pointer:underline ${focusRing}`}
          >
            {link.label}
            {link.srLabel ? <span className="sr-only"> {link.srLabel}</span> : null}
            <CaretRightIcon size={14} weight="bold" />
          </Link>
        ) : null}
        {aside}
      </div>
      {note}
      {children}
    </section>
  );
}

/** Kalimat keadaan kosong di dalam kartu daftar. */
export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="pt-1 pb-3 text-label font-medium text-text-muted">{children}</p>;
}
