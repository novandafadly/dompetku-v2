import type { ComponentPropsWithRef } from 'react';
import { focusRing } from './styles';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger' | 'danger-fill';

/**
 * Keadaan: hover (pointer saja) dan tekan memakai token tersendiri, nonaktif = surface-2 + text-muted.
 * Primer di tema terang diberi garis accent-edge karena lime tidak cukup kontras dengan latar terang.
 */
export const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'border border-accent-edge bg-accent text-on-accent hover-pointer:bg-accent-hover active:bg-accent-press',
  secondary: 'border border-border bg-surface text-text hover-pointer:bg-hover active:bg-surface-2',
  text: 'border border-transparent text-accent-text hover-pointer:bg-hover active:bg-surface-2',
  danger:
    'border border-danger bg-transparent text-danger hover-pointer:bg-danger-tint active:bg-danger-tint',
  'danger-fill':
    'border border-danger bg-danger text-on-danger hover-pointer:brightness-110 active:brightness-95',
};

const disabledStyle =
  'disabled:border-hairline disabled:bg-surface-2 disabled:text-text-muted disabled:hover-pointer:bg-surface-2';

export type ButtonSize = 'md' | 'sm' | 'lg';

const sizes: Record<ButtonSize, string> = {
  /** 48 px: tombol umum. */
  md: 'min-h-12 px-4.5 text-body',
  /** 44 px: toolbar, kaki sheet. */
  sm: 'min-h-11 px-3 text-label',
  /** 52 px: tombol utama layar auth. */
  lg: 'min-h-13 px-4.5 text-body',
};

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra = '',
): string {
  return `inline-flex min-w-11 items-center justify-center gap-2 rounded-lg font-bold whitespace-nowrap ${sizes[size]} ${focusRing} ${buttonVariants[variant]} ${extra}`;
}

export type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
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
      className={buttonClass(variant, size, `${disabledStyle} ${className}`)}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}
