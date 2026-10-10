import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiWorkItem } from '../jobs';
import type { AiJobFeature } from '../../db/repository';
import {
  createAiProvider,
  MistralAiProvider,
  UnavailableAiProvider,
} from './index';
import {
  MISTRAL_CHAT_COMPLETIONS_URL,
  MISTRAL_DEFAULT_MODEL,
  MISTRAL_DEFAULT_MODEL_LIGHT,
  MISTRAL_MAX_TOKENS,
} from './mistral';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeWork(
  feature: AiJobFeature = 'harmonize',
  signal: AbortSignal = new AbortController().signal
): AiWorkItem {
  return {
    id: 'job-test',
    feature,
    input: { prompt: 'test prompt only; never log this' },
    signal,
  };
}

function successResponse(
  content = '{"proposal":{"ok":true}}',
  usage: Record<string, unknown> = {
    prompt_tokens: 17,
    completion_tokens: 8,
  }
): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

describe('Mistral provider selection', () => {
  it('keeps the unavailable provider when config is absent, incomplete, or unsupported', () => {
    expect(createAiProvider({}, vi.fn())).toBeInstanceOf(UnavailableAiProvider);
    expect(
      createAiProvider({ AI_PROVIDER: 'mistral' }, vi.fn())
    ).toBeInstanceOf(UnavailableAiProvider);
    expect(
      createAiProvider(
        { AI_PROVIDER: 'other', AI_API_KEY: 'test-only-key' },
        vi.fn()
      )
    ).toBeInstanceOf(UnavailableAiProvider);
  });

  it('selects Mistral from explicit environment config and uses environment model overrides', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(successResponse());
    const provider = createAiProvider(
      {
        AI_PROVIDER: 'Mistral',
        AI_API_KEY: 'test-only-key',
        AI_MODEL: 'heavy-test-model',
        AI_MODEL_LIGHT: 'light-test-model',
      },
      fetcher
    );
    expect(provider).toBeInstanceOf(MistralAiProvider);

    await provider.generate(makeWork('simplify'));

    const [, init] = fetcher.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'light-test-model',
    });
  });

  it('uses the documented model aliases only as non-deployment defaults', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => successResponse());
    const provider = createAiProvider(
      { AI_PROVIDER: 'mistral', AI_API_KEY: 'test-only-key' },
      fetcher
    );
    await provider.generate(makeWork('draft'));
    await provider.generate(makeWork('simplify'));

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).model).toBe(
      MISTRAL_DEFAULT_MODEL
    );
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).model).toBe(
      MISTRAL_DEFAULT_MODEL_LIGHT
    );
  });
});

describe('Mistral chat completions contract', () => {
  it('sends the official authenticated JSON-mode request, parses content, and extracts usage', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        successResponse('```json\n{"proposal":{"ok":true}}\n```')
      );
    const provider = new MistralAiProvider({
      apiKey: 'test-only-key',
      model: 'heavy-test-model',
      modelLight: 'light-test-model',
      fetcher,
    });

    const result = await provider.generate(makeWork());

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(MISTRAL_CHAT_COMPLETIONS_URL);
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer test-only-key');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'heavy-test-model',
      messages: [
        {
          role: 'system',
          content:
            'Return exactly one valid JSON object. Do not include Markdown, code fences, or commentary.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            feature: 'harmonize',
            input: { prompt: 'test prompt only; never log this' },
          }),
        },
      ],
      temperature: 0.3,
      max_tokens: MISTRAL_MAX_TOKENS,
      response_format: { type: 'json_object' },
    });
    expect(result).toEqual({
      result: { proposal: { ok: true } },
      warnings: [],
      tokensIn: 17,
      tokensOut: 8,
    });
  });

  it('maps malformed usage to zero and rejects invalid or missing JSON content generically', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        successResponse('{"ok":true}', {
          prompt_tokens: -1,
          completion_tokens: 'not-a-count',
        })
      )
      .mockResolvedValueOnce(
        successResponse('response secret, not valid JSON')
      );
    const provider = new MistralAiProvider({
      apiKey: 'test-only-key',
      model: 'heavy-test-model',
      modelLight: 'light-test-model',
      fetcher,
    });

    await expect(provider.generate(makeWork())).resolves.toMatchObject({
      result: { ok: true },
      tokensIn: 0,
      tokensOut: 0,
    });
    await expect(provider.generate(makeWork())).rejects.toThrow(
      'AI provider returned an invalid response.'
    );
  });

  it.each(['null', '"scalar"', '42', 'true', '[]'])(
    'rejects parsed non-object JSON content (%s) with a generic error',
    async (content) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(successResponse(content));
      const provider = new MistralAiProvider({
        apiKey: 'test-only-key',
        model: 'heavy-test-model',
        modelLight: 'light-test-model',
        fetcher,
      });

      await expect(provider.generate(makeWork())).rejects.toThrow(
        'AI provider returned an invalid response.'
      );
      expect(fetcher).toHaveBeenCalledOnce();
    }
  );

  it('rejects arbitrary and secret-like input keys before sending any request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(successResponse());
    const provider = new MistralAiProvider({
      apiKey: 'test-only-key',
      model: 'heavy-test-model',
      modelLight: 'light-test-model',
      fetcher,
    });
    const work = {
      ...makeWork(),
      input: { prompt: 'musical request', authorization: 'private-token' },
    };

    await expect(provider.generate(work)).rejects.toThrow(
      'AI provider request failed.'
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('forwards cancellation to fetch and settles promptly with a safe error', async () => {
    const started = vi.fn();
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      started();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new Error('prompt and response secret from fake fetch')),
          { once: true }
        );
      });
    });
    const provider = new MistralAiProvider({
      apiKey: 'test-only-key',
      model: 'heavy-test-model',
      modelLight: 'light-test-model',
      fetcher,
    });
    const caller = new AbortController();
    const pending = provider.generate(makeWork('harmonize', caller.signal));
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    const passedSignal = fetcher.mock.calls[0]?.[1]?.signal;

    caller.abort(new Error('private prompt secret'));

    await expect(pending).rejects.toThrow('AI provider request was cancelled.');
    expect(passedSignal?.aborted).toBe(true);
  });

  it('enforces a bounded timeout and aborts the fetch signal', async () => {
    const fetcher = vi.fn<typeof fetch>(
      () => new Promise<Response>(() => undefined)
    );
    const provider = new MistralAiProvider({
      apiKey: 'test-only-key',
      model: 'heavy-test-model',
      modelLight: 'light-test-model',
      fetcher,
      timeoutMs: 10,
    });

    await expect(provider.generate(makeWork())).rejects.toThrow(
      'AI provider request timed out.'
    );
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('sanitizes provider errors and retries one 5xx without logging secrets', async () => {
    const responseSecret = 'private-provider-response-secret';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: responseSecret }), { status: 503 })
      );
    const logSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const provider = new MistralAiProvider({
      apiKey: 'test-only-key',
      model: 'heavy-test-model',
      modelLight: 'light-test-model',
      fetcher,
    });

    let failure: unknown;
    try {
      await provider.generate(makeWork());
    } catch (error) {
      failure = error;
    }

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('AI provider request failed.');
    expect((failure as Error).message).not.toContain(responseSecret);
    expect((failure as Error).message).not.toContain('test-only-key');
    expect((failure as Error).message).not.toContain('test prompt only');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('sanitizes transport failures rather than forwarding fetch exception details', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('api key prompt response private details'));
    const provider = new MistralAiProvider({
      apiKey: 'test-only-key',
      model: 'heavy-test-model',
      modelLight: 'light-test-model',
      fetcher,
      timeoutMs: 100,
    });

    await expect(provider.generate(makeWork())).rejects.toThrow(
      'AI provider request failed.'
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
