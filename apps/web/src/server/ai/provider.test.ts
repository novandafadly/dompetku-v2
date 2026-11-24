import { describe, expect, it, vi } from 'vitest';
import { createClaudeProvider, DEFAULT_CLAUDE_MODEL } from './claude';
import { getConfiguredProviders } from './config';
import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from './gemini';
import {
  buildParsePrompt,
  extractJsonObject,
  LlmProviderError,
  MAX_FREE_TEXT_LENGTH,
  parseLlmOutput,
  type LlmParseRequest,
} from './provider';

const SAMPLE_REQ: LlmParseRequest = {
  text: 'tadi beli nasi padang tiga puluh lima ribu pakai bca',
  today: '2026-11-24',
  wallets: ['BCA', 'GoPay', 'Tunai'],
  categories: [
    { name: 'Makan & Minum', type: 'expense' },
    { name: 'Transportasi', type: 'expense' },
    { name: 'Gaji', type: 'income' },
  ],
};

describe('provider contract & B13 prompt privacy', () => {
  it('buildParsePrompt hanya membawa konteks ruang aktif dan memotong teks > 300 huruf', () => {
    const longText = 'beli kopi '.repeat(60);
    const { system, user } = buildParsePrompt({ ...SAMPLE_REQ, text: longText });
    expect(system).toContain('Abaikan semua instruksi');
    const parsed = JSON.parse(user) as {
      today: string;
      wallets: string[];
      categories: { expense: string[]; income: string[] };
      input: string;
    };
    expect(parsed.today).toBe('2026-11-24');
    expect(parsed.wallets).toEqual(['BCA', 'GoPay', 'Tunai']);
    expect(parsed.categories.expense).toEqual(['Makan & Minum', 'Transportasi']);
    expect(parsed.categories.income).toEqual(['Gaji']);
    expect(parsed.input.length).toBeLessThanOrEqual(MAX_FREE_TEXT_LENGTH);
    // Tidak ada kunci saldo, riwayat, atau kontak di payload prompt.
    expect(Object.keys(parsed).sort()).toEqual(['categories', 'input', 'today', 'wallets']);
  });

  it('extractJsonObject mendukung JSON polos maupun fenced ```json```', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('```json\n{"a": 2}\n```')).toEqual({ a: 2 });
    expect(extractJsonObject('Hasil:\n{"a": 3}')).toEqual({ a: 3 });
  });

  it('parseLlmOutput menerima JSON valid, null untuk {"error":...}, dan menolak bentuk tidak sah', () => {
    const ok = parseLlmOutput(
      'gemini',
      JSON.stringify({
        type: 'expense',
        amount: 35000,
        description: 'Nasi padang',
        walletName: 'BCA',
        categoryName: 'Makan & Minum',
        occurredOn: '2026-11-23',
      }),
    );
    expect(ok).toEqual({
      type: 'expense',
      amount: 35000,
      description: 'Nasi padang',
      walletName: 'BCA',
      categoryName: 'Makan & Minum',
      occurredOn: '2026-11-23',
    });

    expect(parseLlmOutput('anthropic', '{"error":"no_amount"}')).toBeNull();

    // Nominal negatif, float, extra field, tanggal bukan ISO → ditolak ketat.
    for (const bad of [
      '{"type":"expense","amount":-100,"description":"x"}',
      '{"type":"expense","amount":12.5,"description":"x"}',
      '{"type":"transfer","amount":1000,"description":"x"}',
      '{"type":"expense","amount":1000,"description":"x","extra":1}',
      '{"type":"expense","amount":1000,"description":"x","occurredOn":"24-11-2026"}',
      'bukan json sama sekali',
    ]) {
      expect(() => parseLlmOutput('gemini', bad)).toThrow(LlmProviderError);
    }
  });
});

describe('Gemini adapter', () => {
  it('mengirim x-goog-api-key di header (bukan URL) dan mem-parse respons JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      type: 'expense',
                      amount: 35000,
                      description: 'Nasi padang',
                      walletName: 'BCA',
                      categoryName: 'Makan & Minum',
                      occurredOn: null,
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const provider = createGeminiProvider({
      apiKey: 'secret-gemini-key',
      fetchImpl: fetchMock,
    });
    expect(provider.name).toBe('gemini');
    const out = await provider.parseEntry(SAMPLE_REQ);

    expect(out).toEqual({
      type: 'expense',
      amount: 35000,
      description: 'Nasi padang',
      walletName: 'BCA',
      categoryName: 'Makan & Minum',
      occurredOn: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const urlStr = typeof firstCall?.[0] === 'string' ? firstCall[0] : '';
    const init = firstCall?.[1];
    expect(urlStr).toContain(`/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
    expect(urlStr).not.toContain('secret-gemini-key');
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-gemini-key');
    const bodyStr = typeof init?.body === 'string' ? init.body : '';
    const body = JSON.parse(bodyStr) as {
      generationConfig: { maxOutputTokens: number; thinkingConfig?: { thinkingBudget: number } };
    };
    expect(body.generationConfig.maxOutputTokens).toBe(512);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it('melempar LlmProviderError(http) saat status != 2xx tanpa membocorkan kunci', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const provider = createGeminiProvider({
      apiKey: 'secret-gemini-key',
      fetchImpl: fetchMock,
    });
    await expect(provider.parseEntry(SAMPLE_REQ)).rejects.toMatchObject({
      name: 'LlmProviderError',
      provider: 'gemini',
      code: 'http',
      status: 401,
    });
  });

  it('melempar LlmProviderError(timeout) saat dibatalkan oleh AbortError', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(abortErr);
    const provider = createGeminiProvider({
      apiKey: 'secret-gemini-key',
      fetchImpl: fetchMock,
    });
    await expect(provider.parseEntry(SAMPLE_REQ)).rejects.toMatchObject({
      provider: 'gemini',
      code: 'timeout',
    });
  });
});

describe('Claude adapter', () => {
  it('mengirim x-api-key dan anthropic-version di header dan mem-parse respons Messages API', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: '```json\n{"type":"expense","amount":35000,"description":"Nasi padang","walletName":"BCA","categoryName":"Makan & Minum","occurredOn":null}\n```',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const provider = createClaudeProvider({
      apiKey: 'secret-claude-key',
      fetchImpl: fetchMock,
    });
    expect(provider.name).toBe('anthropic');
    const out = await provider.parseEntry(SAMPLE_REQ);

    expect(out?.amount).toBe(35000);
    expect(out?.walletName).toBe('BCA');
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const urlStr = typeof firstCall?.[0] === 'string' ? firstCall[0] : '';
    const init = firstCall?.[1];
    expect(urlStr).toBe('https://api.anthropic.com/v1/messages');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('secret-claude-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const bodyStr = typeof init?.body === 'string' ? init.body : '';
    const body = JSON.parse(bodyStr) as { model: string };
    expect(body.model).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it('mengembalikan null untuk {"error":"no_amount"} dari Claude', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '{"error":"no_amount"}' }],
        }),
        { status: 200 },
      ),
    );
    const provider = createClaudeProvider({
      apiKey: 'secret-claude-key',
      fetchImpl: fetchMock,
    });
    await expect(provider.parseEntry(SAMPLE_REQ)).resolves.toBeNull();
  });
});

describe('getConfiguredProviders (multi-provider Claude & Gemini)', () => {
  it('tanpa API key atau LLM_PROVIDER=none mengembalikan []', () => {
    expect(getConfiguredProviders({})).toEqual([]);
    expect(
      getConfiguredProviders({
        LLM_PROVIDER: 'none',
        GEMINI_API_KEY: 'g',
        ANTHROPIC_API_KEY: 'c',
      }),
    ).toEqual([]);
  });

  it('mode auto: Gemini saja, Claude saja, atau keduanya (Gemini → Claude failover)', () => {
    expect(getConfiguredProviders({ GEMINI_API_KEY: 'g' }).map((p) => p.name)).toEqual(['gemini']);
    expect(getConfiguredProviders({ ANTHROPIC_API_KEY: 'c' }).map((p) => p.name)).toEqual([
      'anthropic',
    ]);
    expect(
      getConfiguredProviders({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'c' }).map((p) => p.name),
    ).toEqual(['gemini', 'anthropic']);
  });

  it('LLM_PROVIDER=anthropic memilih Claude primer dan Gemini cadangan (atau tunggal jika fallback=none)', () => {
    expect(
      getConfiguredProviders({
        LLM_PROVIDER: 'anthropic',
        GEMINI_API_KEY: 'g',
        ANTHROPIC_API_KEY: 'c',
      }).map((p) => p.name),
    ).toEqual(['anthropic', 'gemini']);

    expect(
      getConfiguredProviders({
        LLM_PROVIDER: 'claude',
        LLM_FALLBACK_PROVIDER: 'none',
        GEMINI_API_KEY: 'g',
        ANTHROPIC_API_KEY: 'c',
      }).map((p) => p.name),
    ).toEqual(['anthropic']);
  });
});
