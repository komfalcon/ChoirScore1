import { describe, expect, it, vi } from 'vitest';
import { checkApiHealth } from './apiHealth';

describe('API health check', () => {
  it('requests /healthz and accepts an ok response', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await expect(checkApiHealth(fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith('/healthz');
  });

  it('rejects an unhealthy JSON response', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ ok: false }), { status: 200 })
    );

    await expect(checkApiHealth(fetcher)).rejects.toThrow(
      'health check did not return a healthy response'
    );
  });
});
