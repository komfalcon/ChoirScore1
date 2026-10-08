import { apiFetch } from './apiClient';

type HealthFetcher = (path: string, init?: RequestInit) => Promise<Response>;

export async function checkApiHealth(
  fetcher: HealthFetcher = apiFetch
): Promise<void> {
  const response = await fetcher('/healthz');
  const payload: unknown = await response.json();

  if (
    !response.ok ||
    typeof payload !== 'object' ||
    payload === null ||
    !('ok' in payload) ||
    payload.ok !== true
  ) {
    throw new Error(
      'The ChoirScore API health check did not return a healthy response.'
    );
  }
}
