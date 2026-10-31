import type { ReactNode } from 'react';
import { CloudSlashIcon } from './icons/cloud-slash';
import { heroCard } from './styles';

/** Ikon dalam ubin + satu kalimat + satu tindakan (Spesifikasi: EmptyState). */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
  headingLevel,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: 'neutral' | 'accent';
  /** Bila diisi, judul menjadi heading level ini (mis. 1 untuk layar yang hanya berisi keadaan ini). */
  headingLevel?: 1 | 2;
}) {
  const Title = headingLevel === 1 ? 'h1' : headingLevel === 2 ? 'h2' : 'p';
  return (
    <div className={`flex flex-col items-start gap-3 p-5 ${heroCard}`}>
      {icon ? (
        <span
          aria-hidden="true"
          className={`flex size-12 items-center justify-center rounded-toast ${
            tone === 'accent' ? 'bg-accent-tint text-accent-text' : 'bg-surface-2 text-text-soft'
          }`}
        >
          {icon}
        </span>
      ) : null}
      <Title
        className={
          headingLevel === undefined
            ? 'text-body font-bold text-text'
            : 'text-headline font-extrabold text-text'
        }
      >
        {title}
      </Title>
      {description ? (
        <p className="text-label font-medium text-text-soft text-pretty">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

/** Galat pemuatan: sebab + tindakan (B5). Isi tindakan diberikan pemanggil. */
export function ErrorState({
  title,
  description,
  actions,
  headingLevel = 2,
}: {
  title: string;
  description: string;
  actions: ReactNode;
  headingLevel?: 1 | 2;
}) {
  const Title = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <section role="alert" className={`flex flex-col items-start gap-3 p-5 ${heroCard}`}>
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-toast bg-danger-tint text-danger"
      >
        <CloudSlashIcon size={26} />
      </span>
      <Title className="text-headline font-extrabold text-text">{title}</Title>
      <p className="text-label font-medium text-text-soft text-pretty">{description}</p>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </section>
  );
}

/** Bentuk isi akhir tanpa denyut; teks "Memuat…" ada di pembungkus `LoadingRegion`. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" data-skeleton="" className={`rounded-md bg-surface-2 ${className}`} />
  );
}

/** Wilayah memuat: teks terlihat + role=status, lalu kerangka berbentuk isi akhir. */
export function LoadingRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <p role="status" className="text-label font-semibold text-text-muted">
        {label}
      </p>
      {children}
    </div>
  );
}
