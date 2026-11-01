import { nowIsoWIB, timeLabelWIB, todayWIB, weekdayDateLabel } from '@dompetku/domain';
import { authService, requireUser } from '@/server/auth/next';
import { isPrototype } from '@/server/env';
import { param, type SearchParams } from '../_components/params';
import { UndangReal, type InvitationView } from '../_components/undang-real';
import { UndangPrototype } from '../_prototype/undang';

const STATUSES = ['pending', 'accepted', 'declined', 'revoked', 'expired'] as const;

function expiresLabel(d: Date): string {
  return `${weekdayDateLabel(todayWIB(d))}, ${timeLabelWIB(nowIsoWIB(d))} WIB`;
}

export default async function UndangPage({ searchParams }: { searchParams: SearchParams }) {
  if (isPrototype()) return <UndangPrototype />;
  const state = await requireUser('full');
  const service = authService();
  const [household, list] = await Promise.all([
    service.household(state.userId),
    service.listInvitations(state.userId),
  ]);
  const invitations: InvitationView[] = list.flatMap((i) => {
    const status = STATUSES.find((s) => s === i.status);
    return status
      ? [{ id: i.id, email: i.email, status, expiresLabel: expiresLabel(i.expiresAt) }]
      : [];
  });
  const status = await param(searchParams, 'status');
  return (
    <UndangReal
      invitations={invitations}
      owner={household?.role === 'owner'}
      full={(household?.members ?? 0) >= 2}
      notice={status === 'dicabut' ? 'Undangan dicabut. Tautannya tidak berlaku lagi.' : null}
    />
  );
}
