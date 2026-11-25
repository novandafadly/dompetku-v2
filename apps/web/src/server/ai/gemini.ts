import 'server-only';
import {
  buildAnalysisPrompt,
  buildParsePrompt,
  LlmProviderError,
  parseAnalysisOutput,
  parseLlmOutput,
  type LlmAnalysisRaw,
  type LlmAnalysisRequest,
  type LlmParseRaw,
  type LlmParseRequest,
  type LlmProvider,
} from './provider';

/**
 * Adapter Google Gemini (REST `generateContent` via `fetch`, tanpa SDK eksternal).
 * API key dikirim lewat header `x-goog-api-key` (tidak pernah di URL agar tidak tercatat di log).
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_TIMEOUT_MS = 8_000;

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: unknown }[];
    };
  }[];
}

export function createGeminiProvider(opts: GeminiProviderOptions): LlmProvider {
  const rawModel = opts.model?.trim();
  const model = rawModel !== undefined && rawModel !== '' ? rawModel : DEFAULT_GEMINI_MODEL;
  const baseUrl = (opts.baseUrl ?? DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  async function generateText(
    system: string,
    user: string,
    maxOutputTokens: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    let payload: GeminiResponse;
    try {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': opts.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens,
              responseMimeType: 'application/json',
              // Matikan budget thinking pada keluarga Gemini 2.5 agar output JSON tidak terpotong.
              ...(/^gemini-2\.5-/i.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
            },
          }),
          signal: controller.signal,
        });
      } catch (e) {
        if ((e as { name?: unknown } | null)?.name === 'AbortError') {
          throw new LlmProviderError('gemini', 'timeout');
        }
        throw new LlmProviderError('gemini', 'network');
      }

      if (!res.ok) {
        void res.body?.cancel().catch(() => undefined);
        throw new LlmProviderError('gemini', 'http', res.status);
      }

      try {
        payload = (await res.json()) as GeminiResponse;
      } catch (e) {
        if ((e as { name?: unknown } | null)?.name === 'AbortError') {
          throw new LlmProviderError('gemini', 'timeout');
        }
        throw new LlmProviderError('gemini', 'invalid_response');
      }
    } finally {
      clearTimeout(timer);
    }

    const parts = payload.candidates?.[0]?.content?.parts;
    const text = parts
      ?.map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    if (!text) {
      throw new LlmProviderError('gemini', 'invalid_response');
    }
    return text;
  }

  return {
    name: 'gemini',
    async parseEntry(req: LlmParseRequest): Promise<LlmParseRaw | null> {
      const { system, user } = buildParsePrompt(req);
      const text = await generateText(system, user, 512);
      return parseLlmOutput('gemini', text);
    },
    async analyzeSpending(req: LlmAnalysisRequest): Promise<LlmAnalysisRaw> {
      const { system, user } = buildAnalysisPrompt(req);
      const text = await generateText(system, user, 768);
      return parseAnalysisOutput('gemini', text);
    },
  };
}
