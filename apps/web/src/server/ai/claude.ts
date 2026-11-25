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
 * Adapter Anthropic Claude (REST `/v1/messages` via `fetch`, tanpa SDK eksternal).
 * API key dikirim lewat header `x-api-key` dan versi protokol `anthropic-version`.
 */

export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_CLAUDE_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_TIMEOUT_MS = 8_000;

export interface ClaudeProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface ClaudeResponse {
  content?: { type?: unknown; text?: unknown }[];
}

export function createClaudeProvider(opts: ClaudeProviderOptions): LlmProvider {
  const rawModel = opts.model?.trim();
  const model = rawModel !== undefined && rawModel !== '' ? rawModel : DEFAULT_CLAUDE_MODEL;
  const baseUrl = (opts.baseUrl ?? DEFAULT_CLAUDE_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${baseUrl}/v1/messages`;

  async function generateText(system: string, user: string, maxTokens: number): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    let payload: ClaudeResponse;
    try {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': opts.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            temperature: 0,
            system,
            messages: [{ role: 'user', content: user }],
          }),
          signal: controller.signal,
        });
      } catch (e) {
        if ((e as { name?: unknown } | null)?.name === 'AbortError') {
          throw new LlmProviderError('anthropic', 'timeout');
        }
        throw new LlmProviderError('anthropic', 'network');
      }

      if (!res.ok) {
        void res.body?.cancel().catch(() => undefined);
        throw new LlmProviderError('anthropic', 'http', res.status);
      }

      try {
        payload = (await res.json()) as ClaudeResponse;
      } catch (e) {
        if ((e as { name?: unknown } | null)?.name === 'AbortError') {
          throw new LlmProviderError('anthropic', 'timeout');
        }
        throw new LlmProviderError('anthropic', 'invalid_response');
      }
    } finally {
      clearTimeout(timer);
    }

    const text = payload.content
      ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('')
      .trim();
    if (!text) {
      throw new LlmProviderError('anthropic', 'invalid_response');
    }
    return text;
  }

  return {
    name: 'anthropic',
    async parseEntry(req: LlmParseRequest): Promise<LlmParseRaw | null> {
      const { system, user } = buildParsePrompt(req);
      const text = await generateText(system, user, 512);
      return parseLlmOutput('anthropic', text);
    },
    async analyzeSpending(req: LlmAnalysisRequest): Promise<LlmAnalysisRaw> {
      const { system, user } = buildAnalysisPrompt(req);
      const text = await generateText(system, user, 768);
      return parseAnalysisOutput('anthropic', text);
    },
  };
}
