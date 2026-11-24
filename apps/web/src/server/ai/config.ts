import 'server-only';
import { createClaudeProvider, DEFAULT_CLAUDE_MODEL } from './claude';
import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from './gemini';
import type { LlmProvider, LlmProviderName } from './provider';

/**
 * Konfigurasi multi-penyedia LLM (Claude & Gemini).
 *
 * Variabel lingkungan:
 * - `LLM_PROVIDER`: `auto` (bawaan) | `gemini` | `anthropic` | `none`
 * - `LLM_FALLBACK_PROVIDER`: `auto` (bawaan) | `gemini` | `anthropic` | `none`
 * - `GEMINI_API_KEY`, `GEMINI_MODEL` (bawaan `gemini-2.5-flash`)
 * - `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (bawaan `claude-haiku-4-5-20251001`)
 *
 * Dengan bawaan `auto`/`auto`:
 * - hanya `GEMINI_API_KEY` diisi → Gemini saja;
 * - hanya `ANTHROPIC_API_KEY` diisi → Claude saja;
 * - keduanya diisi → Gemini primer, Claude cadangan (failover otomatis);
 * - `LLM_PROVIDER=anthropic` + keduanya diisi → Claude primer, Gemini cadangan;
 * - tidak ada kunci atau `LLM_PROVIDER=none` → `[]` (parser aturan saja, nol panggilan luar).
 */

export type LlmProviderSetting = 'auto' | LlmProviderName | 'none';

export interface LlmEnv {
  [key: string]: string | undefined;
  LLM_PROVIDER?: string | undefined;
  LLM_FALLBACK_PROVIDER?: string | undefined;
  GEMINI_API_KEY?: string | undefined;
  GEMINI_MODEL?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  ANTHROPIC_MODEL?: string | undefined;
}

export interface ProviderFactoryOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function parseSetting(raw: string | undefined): LlmProviderSetting {
  const norm = raw?.trim().toLowerCase();
  if (norm === 'gemini' || norm === 'google') return 'gemini';
  if (norm === 'anthropic' || norm === 'claude') return 'anthropic';
  if (norm === 'none' || norm === 'off' || norm === 'disabled') return 'none';
  return 'auto';
}

function buildOne(
  name: LlmProviderName,
  env: LlmEnv,
  opts?: ProviderFactoryOptions,
): LlmProvider | null {
  if (name === 'gemini') {
    const apiKey = env.GEMINI_API_KEY?.trim();
    if (!apiKey) return null;
    const rawModel = env.GEMINI_MODEL?.trim();
    return createGeminiProvider({
      apiKey,
      model: rawModel !== undefined && rawModel !== '' ? rawModel : DEFAULT_GEMINI_MODEL,
      ...(opts?.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
  }
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const rawModel = env.ANTHROPIC_MODEL?.trim();
  return createClaudeProvider({
    apiKey,
    model: rawModel !== undefined && rawModel !== '' ? rawModel : DEFAULT_CLAUDE_MODEL,
    ...(opts?.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
}

function otherProvider(name: LlmProviderName): LlmProviderName {
  return name === 'gemini' ? 'anthropic' : 'gemini';
}

/** Mengembalikan rantai penyedia LLM terurut `[primer, cadangan?]` sesuai env. */
export function getConfiguredProviders(
  env: LlmEnv = process.env,
  opts?: ProviderFactoryOptions,
): LlmProvider[] {
  const primarySetting = parseSetting(env.LLM_PROVIDER);
  if (primarySetting === 'none') return [];
  const fallbackSetting = parseSetting(env.LLM_FALLBACK_PROVIDER);

  const order: LlmProviderName[] = [];
  if (primarySetting === 'auto') {
    order.push('gemini', 'anthropic');
  } else {
    order.push(primarySetting);
    if (fallbackSetting === 'auto') {
      order.push(otherProvider(primarySetting));
    } else if (fallbackSetting !== 'none' && fallbackSetting !== primarySetting) {
      order.push(fallbackSetting);
    }
  }

  const providers: LlmProvider[] = [];
  for (const name of order) {
    const built = buildOne(name, env, opts);
    if (built) providers.push(built);
    if (fallbackSetting === 'none' && providers.length >= 1) break;
  }
  return providers;
}
