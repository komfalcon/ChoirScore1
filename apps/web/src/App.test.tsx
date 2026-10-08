import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getApiBaseUrl } from './lib/apiClient';

const vercelConfig = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
) as { rewrites: Array<{ source: string; destination: string }> };

describe('api client config', () => {
  it('defaults API base to /api', () => {
    expect(getApiBaseUrl()).toBe('/api');
  });

  it('strips /api before forwarding requests to Pxxl', () => {
    const rewrite = vercelConfig.rewrites.find(
      (item) => item.source === '/api/:path*'
    );

    expect(rewrite).toBeDefined();
    expect(rewrite?.destination).toMatch(/^https:\/\/[^/]+\/:path\*$/);
    expect(rewrite?.destination.replace(/^https:\/\/[^/]+/, '')).toBe(
      '/:path*'
    );
  });
});
