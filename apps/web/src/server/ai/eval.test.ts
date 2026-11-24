import { describe, expect, it } from 'vitest';
import { EVAL_CASES, EVAL_CATEGORIES, EVAL_TODAY, EVAL_WALLETS, type EvalCase } from './eval-cases';
import { parseByRules } from './rules';

/**
 * Gerbang Eval Set S17 (M6, K4):
 * - minimal 60 kasus nyata Bahasa Indonesia;
 * - akurasi kecocokan penuh >= 90%.
 */

function evaluateCase(c: EvalCase): { pass: boolean; detail: string } {
  const res = parseByRules({
    text: c.input,
    today: EVAL_TODAY,
    wallets: EVAL_WALLETS,
    categories: EVAL_CATEGORIES,
  });

  if (c.expect === 'reject') {
    if (res.ok) return { pass: false, detail: `${c.id}: harusnya ditolak, malah ok` };
    if (c.reason !== undefined && res.reason !== c.reason) {
      return { pass: false, detail: `${c.id}: alasan ${res.reason} != ${c.reason}` };
    }
    return { pass: true, detail: '' };
  }

  if (!res.ok) {
    return { pass: false, detail: `${c.id}: gagal parse (${res.reason})` };
  }
  const e = res.entry;
  if (e.type !== c.type) return { pass: false, detail: `${c.id}: type ${e.type} != ${c.type}` };
  if (e.amount !== c.amount) {
    return { pass: false, detail: `${c.id}: amount ${String(e.amount)} != ${String(c.amount)}` };
  }
  if (c.accountId !== undefined && e.accountId !== c.accountId) {
    return {
      pass: false,
      detail: `${c.id}: accountId ${String(e.accountId)} != ${String(c.accountId)}`,
    };
  }
  if (c.categoryId !== undefined && e.categoryId !== c.categoryId) {
    return {
      pass: false,
      detail: `${c.id}: categoryId ${String(e.categoryId)} != ${String(c.categoryId)}`,
    };
  }
  if (c.occurredOn !== undefined && e.occurredOn !== c.occurredOn) {
    return {
      pass: false,
      detail: `${c.id}: occurredOn ${String(e.occurredOn)} != ${String(c.occurredOn)}`,
    };
  }
  if (
    c.descriptionIncludes !== undefined &&
    !e.description.toLowerCase().includes(c.descriptionIncludes.toLowerCase())
  ) {
    return {
      pass: false,
      detail: `${c.id}: description "${e.description}" tidak memuat "${c.descriptionIncludes}"`,
    };
  }
  return { pass: true, detail: '' };
}

describe('Eval Set Catat teks bebas (M6, >= 90%)', () => {
  it('memiliki minimal 60 kasus uji dan mencapai akurasi >= 90%', () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(60);

    const failures: string[] = [];
    let passed = 0;
    for (const c of EVAL_CASES) {
      const r = evaluateCase(c);
      if (r.pass) passed += 1;
      else failures.push(r.detail);
    }

    const accuracy = passed / EVAL_CASES.length;
    expect(
      accuracy,
      `Gagal (${String(failures.length)}): ${failures.join('; ')}`,
    ).toBeGreaterThanOrEqual(0.9);
  });
});
