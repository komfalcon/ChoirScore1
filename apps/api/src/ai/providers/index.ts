import type { AiWorkItem } from '../jobs';
import {
  MISTRAL_DEFAULT_MODEL,
  MISTRAL_DEFAULT_MODEL_LIGHT,
  MistralAiProvider,
} from './mistral';

export interface AiProviderResult {
  result: unknown;
  warnings?: unknown[];
  tokensIn: number;
  tokensOut: number;
}

export interface AiProvider {
  readonly name: string;
  /** Implementations must honor work.signal and stop stale work when aborted. */
  generate(work: AiWorkItem): Promise<AiProviderResult>;
}

/** Deterministic provider for lifecycle tests; it performs no network requests. */
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  async generate(work: AiWorkItem): Promise<AiProviderResult> {
    return {
      result: { feature: work.feature, input: work.input },
      warnings: [],
      tokensIn: 0,
      tokensOut: 0,
    };
  }
}

/** Safe default when no supported provider and complete credentials are configured. */
export class UnavailableAiProvider implements AiProvider {
  readonly name = 'unavailable';

  async generate(_work: AiWorkItem): Promise<AiProviderResult> {
    throw new Error('No AI provider is configured.');
  }
}

/**
 * Selects the server-side provider from environment values. Missing or unknown
 * configuration deliberately keeps the API available with the unavailable provider.
 */
export function createAiProvider(
  env: NodeJS.ProcessEnv = process.env,
  fetcher?: typeof fetch
): AiProvider {
  const provider = (env.AI_PROVIDER ?? '').trim().toLowerCase();
  const apiKey = env.AI_API_KEY?.trim();
  if (provider !== 'mistral' || !apiKey) return new UnavailableAiProvider();

  return new MistralAiProvider({
    apiKey,
    model: env.AI_MODEL?.trim() || MISTRAL_DEFAULT_MODEL,
    modelLight: env.AI_MODEL_LIGHT?.trim() || MISTRAL_DEFAULT_MODEL_LIGHT,
    fetcher,
  });
}

export { MistralAiProvider } from './mistral';
