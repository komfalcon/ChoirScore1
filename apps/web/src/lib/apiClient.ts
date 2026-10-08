const DEFAULT_API_BASE = '/api';

export function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE ?? DEFAULT_API_BASE;
}

export async function apiFetch(path: string, init?: RequestInit) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const response = await fetch(`${getApiBaseUrl()}${normalizedPath}`, init);

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response;
}
