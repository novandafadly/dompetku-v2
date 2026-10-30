import type { ButtonHTMLAttributes } from 'react';
import { focusRing } from './styles';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

// Hover dan tekan dibedakan lewat terang/latar, tidak hanya warna aksen.
const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110 active:brightness-90',
  secondary:
    'border border-border bg-surface-2 text-text hover:bg-surface active:bg-bg disabled:border-hairline',
  ghost: 'text-text hover:bg-surface-2 active:bg-surface',
  danger: 'bg-danger text-on-accent hover:brightness-110 active:brightness-90',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-field px-4 text-base font-semibold disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-muted ${focusRing} ${variants[variant]} ${className}`}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-pill border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}
