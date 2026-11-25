import type { IsoDate } from '@dompetku/domain';

export type AnalysisPeriodChoice = 'current' | 'previous';

export interface AnalysisCategoryVM {
  name: string;
  amount: number;
  pct: number;
  entryCount: number;
}

export interface AnalysisQuotaVM {
  used: number;
  limit: number;
  remaining: number;
  day: IsoDate;
}

export interface AnalysisOverviewVM {
  periodChoice: AnalysisPeriodChoice;
  periodLabel: string;
  from: IsoDate;
  to: IsoDate;
  labelMonth: IsoDate;
  income: number;
  expense: number;
  net: number;
  previousExpense: number | null;
  safeToSpend: number | null;
  daysLeft: number | null;
  topCategories: AnalysisCategoryVM[];
  hasData: boolean;
  aiConfigured: boolean;
  quota: AnalysisQuotaVM;
}

export interface AiAnalysisOutputVM {
  ringkasan: string;
  sorotan: string[];
  saran: string[];
  provider: 'gemini' | 'anthropic';
}

export type RunAnalysisErrorCode = 'no_data' | 'not_configured' | 'quota_exceeded' | 'network';

export type RunAnalysisResult =
  | {
      ok: true;
      analysis: AiAnalysisOutputVM;
      quota: { used: number; limit: number; remaining: number; exhausted: boolean };
    }
  | {
      ok: false;
      code: RunAnalysisErrorCode;
      quota?: { used: number; limit: number; remaining: number; exhausted: boolean };
    };
