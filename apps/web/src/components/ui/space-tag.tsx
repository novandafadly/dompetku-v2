import { UserIcon } from './icons/user';
import { UsersThreeIcon } from './icons/users-three';

export type Space = 'pribadi' | 'bersama';

const LABEL: Record<Space, string> = { pribadi: 'Pribadi', bersama: 'Bersama' };

const TONE: Record<Space, string> = {
  pribadi: 'bg-pribadi-tint text-pribadi',
  bersama: 'bg-bersama-tint text-bersama',
};

export function SpaceIcon({
  space,
  size = 12,
  weight = 'bold',
}: {
  space: Space;
  size?: number;
  weight?: 'bold' | 'regular' | 'fill';
}) {
  return space === 'pribadi' ? (
    <UserIcon size={size} weight={weight} className="shrink-0" />
  ) : (
    <UsersThreeIcon size={size} weight={weight} className="shrink-0" />
  );
}

/** Label ruang (ikon + nama kapital 11 px di atas tint ruang): kartu utama, Catat, detail, dompet. */
export function SpaceTag({ space, className = '' }: { space: Space; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.25 text-tag font-extrabold tracking-wider uppercase ${TONE[space]} ${className}`}
    >
      <SpaceIcon space={space} />
      {LABEL[space]}
    </span>
  );
}
