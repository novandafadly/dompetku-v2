import type { ReactNode } from 'react';
import { AuthFrame } from '@/features/auth/auth-frame';
import { isPrototype } from '@/server/env';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthFrame prototype={isPrototype()}>{children}</AuthFrame>;
}
