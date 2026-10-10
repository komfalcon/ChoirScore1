import { aiJobInputSchemas } from '@choirscore/shared';
import type { AiWorkItem } from '../jobs';
import type { AiProvider, AiProviderResult } from './index';

/** The fixed official Mistral API endpoint; deployment origins are not configurable. */
export const MISTRAL_CHAT_COMPLETIONS_URL =
  'https://api.mistral.ai/v1/chat/completions';

export const MISTRAL_DEFAULT_MODEL = 'mistral-large-latest';
export const MISTRAL_DEFAULT_MODEL_LIGHT = 'mistral-small-latest';
export const MISTRAL_REQUEST_TIMEOUT_MS = 60_000;
export const MISTRAL_MAX_TOKENS = 4096;
const RETRY_DELAY_MS = 250;
const MAX_ATTEMPTS = 2;

const REQUEST_FAILED = 'AI provider request failed.';
const REQUEST_TIMED_OUT = 'AI provider request timed out.';
const REQUEST_CANCELLED = 'AI provider request was cancelled.';
const INVALID_RESPONSE = 'AI provider returned an invalid response.';

export interface MistralAiProviderOptions {
  apiKey: string;
  model: string;
  modelLight: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

class ProviderFailure extends Error {
  constructor(
    message: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = 'ProviderFailure';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function parseCompletion(value: unknown): AiProviderResult {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    throw new ProviderFailure(INVALID_RESPONSE);
  }
  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new ProviderFailure(INVALID_RESPONSE);
  }
  const content = choice.message.content;
  if (typeof content !== 'string') {
    throw new ProviderFailure(INVALID_RESPONSE);
  }

  const unfenced = content
    .trim()
    .replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  let result: unknown;
  try {
    result = JSON.parse(unfenced) as unknown;
  } catch {
    throw new ProviderFailure(INVALID_RESPONSE);
  }
  if (!isRecord(result)) {
    throw new ProviderFailure(INVALID_RESPONSE);
  }

  const usage = isRecord(value.usage) ? value.usage : {};
  return {
    result,
    warnings: [],
    tokensIn: tokenCount(usage.prompt_tokens),
    tokensOut: tokenCount(usage.completion_tokens),
  };
}

function retryDelay(signal: AbortSignal): Promise<void> {
  if (signal.aborted)
    return Promise.reject(new ProviderFailure(REQUEST_CANCELLED));
  return new Promise((resolve, reject) => {
    let onAbort: () => void = () => {};
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, RETRY_DELAY_MS);
    onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new ProviderFailure(REQUEST_CANCELLED));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class MistralAiProvider implements AiProvider {
  readonly name = 'mistral';
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: MistralAiProviderOptions) {
    this.fetcher = options.fetcher ?? globalThis.fetch;
    const requestedTimeout = options.timeoutMs ?? MISTRAL_REQUEST_TIMEOUT_MS;
    this.timeoutMs =
      Number.isFinite(requestedTimeout) && requestedTimeout > 0
        ? Math.min(Math.floor(requestedTimeout), MISTRAL_REQUEST_TIMEOUT_MS)
        : MISTRAL_REQUEST_TIMEOUT_MS;
  }

  async generate(work: AiWorkItem): Promise<AiProviderResult> {
    if (work.signal.aborted) throw new Error(REQUEST_CANCELLED);

    const model =
      work.feature === 'simplify'
        ? this.options.modelLight
        : this.options.model;
    const parsedInput = aiJobInputSchemas[work.feature].safeParse(work.input);
    if (!parsedInput.success) throw new Error(REQUEST_FAILED);

    let userContent: string;
    try {
      userContent = JSON.stringify({
        feature: work.feature,
        input: parsedInput.data,
      });
    } catch {
      throw new Error(REQUEST_FAILED);
    }

    const body = JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'Return exactly one valid JSON object. Do not include Markdown, code fences, or commentary.',
        },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
      max_tokens: MISTRAL_MAX_TOKENS,
      response_format: { type: 'json_object' },
    });

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.callOnce(work, body);
      } catch (error) {
        if (work.signal.aborted) throw new Error(REQUEST_CANCELLED);
        if (
          error instanceof ProviderFailure &&
          error.retryable &&
          attempt + 1 < MAX_ATTEMPTS
        ) {
          try {
            await retryDelay(work.signal);
          } catch {
            throw new Error(REQUEST_CANCELLED);
          }
          continue;
        }
        throw new Error(
          error instanceof ProviderFailure ? error.message : REQUEST_FAILED
        );
      }
    }

    throw new Error(REQUEST_FAILED);
  }

  private async callOnce(
    work: AiWorkItem,
    body: string
  ): Promise<AiProviderResult> {
    if (work.signal.aborted) throw new ProviderFailure(REQUEST_CANCELLED);

    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let removeAbortListener: () => void = () => {};
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new ProviderFailure(REQUEST_TIMED_OUT, true));
      }, this.timeoutMs);
    });
    const abortPromise = new Promise<never>((_resolve, reject) => {
      const onAbort = () => {
        controller.abort();
        reject(new ProviderFailure(REQUEST_CANCELLED));
      };
      work.signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () =>
        work.signal.removeEventListener('abort', onAbort);
      if (work.signal.aborted) onAbort();
    });

    const request = (async () => {
      let response: Response;
      try {
        response = await this.fetcher(MISTRAL_CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: controller.signal,
        });
      } catch {
        if (work.signal.aborted) throw new ProviderFailure(REQUEST_CANCELLED);
        if (timedOut) throw new ProviderFailure(REQUEST_TIMED_OUT, true);
        throw new ProviderFailure(REQUEST_FAILED, true);
      }

      if (work.signal.aborted) throw new ProviderFailure(REQUEST_CANCELLED);
      if (timedOut) throw new ProviderFailure(REQUEST_TIMED_OUT, true);
      if (!response.ok) {
        throw new ProviderFailure(
          REQUEST_FAILED,
          response.status >= 500 && response.status <= 599
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        if (work.signal.aborted) throw new ProviderFailure(REQUEST_CANCELLED);
        if (timedOut) throw new ProviderFailure(REQUEST_TIMED_OUT, true);
        throw new ProviderFailure(INVALID_RESPONSE);
      }
      if (work.signal.aborted) throw new ProviderFailure(REQUEST_CANCELLED);
      if (timedOut) throw new ProviderFailure(REQUEST_TIMED_OUT, true);
      return parseCompletion(payload);
    })();

    try {
      return await Promise.race([request, timeoutPromise, abortPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
      removeAbortListener();
    }
  }
}
