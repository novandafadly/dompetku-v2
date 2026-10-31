import type { ComponentType, SVGProps } from 'react';

export type IconWeight = 'regular' | 'bold' | 'fill';

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'dangerouslySetInnerHTML'> & {
  size?: number;
  weight?: IconWeight;
};

export type Icon = ComponentType<IconProps>;

/** Ikon SVG 256×256 dari data path Phosphor statis (icons/*.ts); dekoratif kecuali diberi nama. */
export function makeIcon(paths: Partial<Record<IconWeight, string>>): Icon {
  function PhosphorIcon({ size = 20, weight = 'regular', ...rest }: IconProps) {
    const d = paths[weight] ?? paths.regular ?? paths.bold ?? paths.fill ?? '';
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
      >
        <path d={d} />
      </svg>
    );
  }
  return PhosphorIcon;
}
