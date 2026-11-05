import type { MemberVM } from './types';

/** Avatar inisial 36 px menurut peran: pemilik/tidak dikenal netral, anggota violet (S8-A1). */
export function MemberAvatar({
  role,
  initial,
  className = '',
}: {
  role: MemberVM['role'] | null;
  initial: string;
  /** Tambahan kelas (mis. `row-span-2` pada grid sempit). */
  className?: string;
}) {
  return (
    <span
      data-initial=""
      aria-hidden="true"
      className={`flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-label font-extrabold ${className} ${
        role === 'member' ? 'bg-bersama-tint text-bersama' : 'bg-surface-3 text-text'
      }`}
    >
      {initial}
    </span>
  );
}
