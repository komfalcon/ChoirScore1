import type { AiWorkItem } from '../jobs';

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

/** Safe default until a separately authorized real-provider slice is implemented. */
export class UnavailableAiProvider implements AiProvider {
  readonly name = 'unavailable';

  async generate(_work: AiWorkItem): Promise<AiProviderResult> {
    throw new Error('No AI provider is configured.');
  }
}
