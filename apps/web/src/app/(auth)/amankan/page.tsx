import { authService, requireUser } from '@/server/auth/next';
import { isPrototype } from '@/server/env';
import { AmankanReal } from '../_components/amankan-real';
import { AmankanPrototype } from '../_prototype/amankan';

export default async function AmankanPage() {
  if (isPrototype()) return <AmankanPrototype />;
  const state = await requireUser('securing');
  const step = await authService().securingStep(state);
  return <AmankanReal step={step} email={state.email} recovery={state.amr === 'recovery'} />;
}
