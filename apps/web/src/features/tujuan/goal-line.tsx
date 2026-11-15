import { CheckCircleIcon } from '@/components/ui/icons/check-circle';
import { TUJUAN_COPY as C } from './copy';
import type { GoalLineVM } from './types';

/**
 * Teks tujuan di baris daftar Dompet (S13-TJ10): `{nama tujuan} · {pct}%` menggantikan baris tipe
 * dompet, jadi tinggi baris tidak bertambah. Nama dipotong satu baris (`truncate`; teks penuh tetap
 * ada di DOM untuk pembaca layar dan di `title`), persen/`Tercapai` tidak pernah terpotong.
 * Server Component, tanpa JS.
 */
export function GoalLine({ goal }: { goal: GoalLineVM }) {
  return (
    <span
      title={goal.name}
      className="flex min-w-0 items-center text-meta font-medium text-text-soft"
    >
      <span className="min-w-0 truncate">{goal.name}</span>
      <span className="flex shrink-0 items-center gap-1 whitespace-pre">
        {' · '}
        {goal.reached ? (
          <>
            <CheckCircleIcon size={12} weight="fill" />
            {C.reached}
          </>
        ) : (
          C.pct(goal.pct)
        )}
      </span>
    </span>
  );
}
