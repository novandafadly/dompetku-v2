import type { ComponentType, SVGProps } from 'react';

export type IconWeight = 'regular' | 'bold' | 'fill';

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'dangerouslySetInnerHTML'> & {
  size?: number;
  weight?: IconWeight;
};

export type Icon = ComponentType<IconProps>;

/** Ikon SVG 256×256 dari markup Phosphor statis (icons.ts); dekoratif kecuali diberi nama. */
export function makeIcon(paths: Partial<Record<IconWeight, string>>): Icon {
  function PhosphorIcon({ size = 20, weight = 'regular', ...rest }: IconProps) {
    const inner = paths[weight] ?? paths.regular ?? paths.bold ?? paths.fill ?? '';
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width={size}
        height={size}
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
        {...rest}
        // Data path statis dari paket ikon (bukan masukan pengguna).
        dangerouslySetInnerHTML={{ __html: inner }}
      />
    );
  }
  return PhosphorIcon;
}
