import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getApiBaseUrl } from './lib/apiClient';

const vercelConfig = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
) as {
  routes: Array<{ src: string; dest: string; env?: string[] }>;
  rewrites: Array<{ source: string; destination: string }>;
};

describe('api client config', () => {
  it('defaults API base to /api', () => {
    expect(getApiBaseUrl()).toBe('/api');
  });

  it('forwards the same-origin API path through the deployment environment', () => {
    const route = vercelConfig.routes.find((item) => item.src === '/api/(.*)');

    expect(route).toBeDefined();
    expect(route?.dest).toBe('${PXXL_API_URL}/$1');
    expect(route?.env).toEqual(['PXXL_API_URL']);
    expect(vercelConfig.rewrites).toContainEqual({
      source: '/:path*',
      destination: '/index.html',
    });
  });
});
