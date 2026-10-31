import type { ReactNode } from 'react';
import { FlaskFillIcon } from '@/components/ui/icons/flask-fill';

/** Rangka layar auth tiruan: di luar shell aplikasi, tanpa tab bar; pita prototipe di atas. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <p
        role="status"
        className="flex min-h-9 items-center justify-center gap-1.5 bg-warning-tint px-4 text-caption font-bold text-warning"
      >
        <FlaskFillIcon size={14} weight="fill" className="shrink-0" />
        Prototipe: belum aktif
      </p>
      <main className="mx-auto flex w-full max-w-120 flex-1 flex-col gap-4 px-6 pt-7 pb-10 laptop:justify-center">
        <div className="flex flex-col gap-4 laptop:rounded-2xl laptop:border laptop:border-hairline laptop:bg-surface laptop:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

/** H1 layar auth: 26/800. */
export function AuthTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-title font-extrabold text-pretty text-text">{children}</h1>;
}

export function AuthText({ children }: { children: ReactNode }) {
  return <p className="text-body font-medium text-pretty text-text-soft">{children}</p>;
}
