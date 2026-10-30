import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/features/shell/app-shell';
import { isRuang } from '@/features/shell/hrefs';

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
  return <AppShell ruang={ruang}>{children}</AppShell>;
}
