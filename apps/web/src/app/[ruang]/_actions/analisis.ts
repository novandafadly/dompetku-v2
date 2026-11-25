'use server';

import { z } from 'zod';
import type { AnalysisPeriodChoice, RunAnalysisResult } from '@/features/analisis/types';
import type { ActionResult } from '@/features/ledger/types';
import { runAiAnalysis } from '@/server/ai/analyze';
import { actionContext, ledger, parseInput, query } from './context';

const runAnalysisSchema = z.object({
  period: z.enum(['current', 'previous']),
});

/**
 * Baca-saja pada ledger (S18): menjalankan Analisis AI atas ringkasan agregat periode aktif/lalu.
 * Hanya memotong kuota harian `analysis` (5/hari/user WIB) dan tidak pernah mengubah entri.
 */
export async function runAnalysisAction(
  ruang: unknown,
  input: { period: AnalysisPeriodChoice },
): Promise<ActionResult<RunAnalysisResult>> {
  return query('runAnalysisAction', actionContext(ruang), async (ctx) => {
    const parsed = parseInput(runAnalysisSchema, input);
    return runAiAnalysis({ ...ledger(ctx), kind: ctx.kind }, parsed.period);
  });
}
