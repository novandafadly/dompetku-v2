import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { focusRing } from './styles';

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> & {
  /** Nama aksesibel; wajib karena tombol tidak punya teks. */
  label: string;
  icon: ReactNode;
  /** Tanpa garis: untuk ikon di dalam field atau baris yang sudah berbatas. */
  bare?: boolean;
};

/** 44×44, radius 12, garis token border (Spesifikasi: IconButton). */
export function IconButton({
  label,
  icon,
  bare = false,
  className = '',
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={`inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text hover-pointer:bg-hover active:bg-surface-2 disabled:border-hairline disabled:text-text-muted disabled:hover-pointer:bg-transparent ${
        bare ? '' : 'border border-border bg-surface'
      } ${focusRing} ${className}`}
      {...rest}
    >
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
    </button>
  );
}
