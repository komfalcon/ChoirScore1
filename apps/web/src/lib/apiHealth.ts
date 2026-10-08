import { apiFetch } from './apiClient';

const DEFAULT_HEALTH_TIMEOUT_MS = 8_000;

type HealthFetcher = (path: string, init?: RequestInit) => Promise<Response>;
type HealthCheckOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function checkApiHealth(
  fetcher: HealthFetcher = apiFetch,
  { signal, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS }: HealthCheckOptions = {}
): Promise<void> {
  const requestController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let removeExternalAbort = () => {};

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      requestController.abort();
      reject(new Error('The ChoirScore API health check timed out.'));
    }, timeoutMs);
  });

  const abortPromise = signal
    ? new Promise<never>((_resolve, reject) => {
        const abortRequest = () => {
          requestController.abort();
          reject(
            new DOMException(
              'The API health check was cancelled.',
              'AbortError'
            )
          );
        };

        if (signal.aborted) {
          abortRequest();
          return;
        }

        signal.addEventListener('abort', abortRequest, { once: true });
        removeExternalAbort = () =>
          signal.removeEventListener('abort', abortRequest);
      })
    : undefined;

  const responsePromise = Promise.resolve().then(async () => {
    const response = await fetcher('/healthz', {
      signal: requestController.signal,
    });

    if (!response.ok) {
      throw new Error(
        `The ChoirScore API health check returned HTTP ${response.status}.`
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('The ChoirScore API health check returned invalid JSON.');
    }

    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('ok' in payload) ||
      payload.ok !== true
    ) {
      throw new Error(
        'The ChoirScore API health check did not return a healthy response.'
      );
    }
  });

  try {
    if (abortPromise) {
      await Promise.race([responsePromise, timeoutPromise, abortPromise]);
    } else {
      await Promise.race([responsePromise, timeoutPromise]);
    }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    removeExternalAbort();
  }
}
