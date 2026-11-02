import { todayWIB } from '@dompetku/domain';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { isRuang } from '@/features/shell/hrefs';
import { isPrototype } from '@/server/env';
import { listCategories } from '@/server/ledger/read';
import { ruangAccounts, ruangContext } from './_real/context';
import { RuangShellReal } from './_real/ruang-shell-real';
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
  if (isPrototype()) {
    const { ruang } = await params;
    if (!isRuang(ruang)) notFound();
    return <RuangShell ruang={ruang}>{children}</RuangShell>;
  }
  // Mode nyata: sesi penuh dulu (`requireDataUser` di ruangContext), lalu opsi Catat ruang ini
  // saja (dompet + kategori); ruang lain diminta lewat action saat pindah ruang di sheet.
  const ctx = await ruangContext(params);
  const [accounts, categories] = await Promise.all([ruangAccounts(ctx), listCategories(ctx)]);
  return (
    <RuangShellReal
      ruang={ctx.ruang}
      accounts={accounts}
      categories={categories}
      today={todayWIB()}
    >
      {children}
    </RuangShellReal>
  );
}
