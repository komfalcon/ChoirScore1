import { describe, expect, it, vi } from 'vitest';
import { checkApiHealth } from './apiHealth';

describe('API health check', () => {
  it('requests /healthz and accepts an ok response', async () => {
    const fetcher = vi.fn(
      async (_path: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await expect(checkApiHealth(fetcher)).resolves.toBeUndefined();
    expect(fetcher.mock.calls[0]?.[0]).toBe('/healthz');
  });

  it('rejects an unhealthy JSON response', async () => {
    const fetcher = vi.fn(
      async (_path: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: false }), { status: 200 })
    );

    await expect(checkApiHealth(fetcher)).rejects.toThrow(
      'health check did not return a healthy response'
    );
  });

  it('rejects when the network request fails', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('Network unavailable');
    });

    await expect(checkApiHealth(fetcher)).rejects.toThrow(
      'Network unavailable'
    );
  });

  it('rejects non-2xx responses without treating them as healthy', async () => {
    const fetcher = vi.fn(
      async (_path: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 503 })
    );

    await expect(checkApiHealth(fetcher)).rejects.toThrow('HTTP 503');
  });

  it('rejects a malformed JSON response', async () => {
    const fetcher = vi.fn(
      async (_path: string, _init?: RequestInit) =>
        new Response('not json', { status: 200 })
    );

    await expect(checkApiHealth(fetcher)).rejects.toThrow(
      'returned invalid JSON'
    );
  });

  it('settles after a bounded timeout even when the fetcher stalls', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_path: string, _init?: RequestInit) => new Promise<Response>(() => {})
    );
    const check = checkApiHealth(fetcher, { timeoutMs: 100 });

    try {
      const timedOut = expect(check).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(100);
      await timedOut;
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
