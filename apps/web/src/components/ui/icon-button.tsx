import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { focusRing } from './styles';

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> & {
  /** Nama aksesibel; wajib karena tombol tidak punya teks. */
  label: string;
  icon: ReactNode;
};

export function IconButton({
  label,
  icon,
  className = '',
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={`inline-flex size-11 items-center justify-center rounded-field text-text hover:bg-surface-2 active:bg-surface disabled:text-text-muted disabled:hover:bg-transparent ${focusRing} ${className}`}
      {...rest}
    >
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
    </button>
  );
}
