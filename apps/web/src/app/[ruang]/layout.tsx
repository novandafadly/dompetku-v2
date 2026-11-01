import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { isRuang } from '@/features/shell/hrefs';
import { requireDataUser } from '@/server/auth/next';
import { isPrototype } from '@/server/env';
import { RuangShell } from './ruang-shell';

// Segmen lain dijawab 404 sejak awal; Suspense di root layout membuat status stream 200 bila baru dilempar di render.
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ ruang: 'pribadi' }, { ruang: 'bersama' }];
}

export default async function RuangLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ ruang: string }>;
}) {
  const { ruang } = await params;
  if (!isRuang(ruang)) notFound();
  // Mode nyata: halaman data hanya untuk sesi penuh (faktor kuat + akun diprovisikan).
  await requireDataUser();
  return (
    <RuangShell ruang={ruang} prototype={isPrototype()}>
      {children}
    </RuangShell>
  );
}
