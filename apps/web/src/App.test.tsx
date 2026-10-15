import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getApiBaseUrl } from './lib/apiClient';

const vercelConfig = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
) as {
  routes: Array<{ src: string; dest: string; env?: string[] }>;
  rewrites: Array<{ source: string; destination: string }>;
  installCommand: string;
  buildCommand: string;
};
const appTsconfig = JSON.parse(
  readFileSync(new URL('../tsconfig.app.json', import.meta.url), 'utf8')
) as { exclude?: string[] };
const testTsconfig = JSON.parse(
  readFileSync(new URL('../tsconfig.test.json', import.meta.url), 'utf8')
) as { include?: string[]; exclude?: string[] };
const webPackage = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { scripts: Record<string, string> };

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

  it('installs from the npm workspace root and builds shared before the web app', () => {
    expect(vercelConfig.installCommand).toBe('cd ../.. && npm ci');
    expect(vercelConfig.buildCommand).toBe(
      'cd ../.. && npm run build --workspace @choirscore/shared && npm run build --workspace @choirscore/web'
    );
  });

  it('excludes test files from the production app typecheck', () => {
    expect(appTsconfig.exclude).toEqual(
      expect.arrayContaining([
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.spec.ts',
        'src/**/*.spec.tsx',
      ])
    );
  });

  it('keeps test files in the separate web typecheck', () => {
    expect(webPackage.scripts.typecheck).toContain('tsconfig.test.json');
    expect(testTsconfig.include).toContain('src');
    expect(testTsconfig.exclude).toEqual([]);
  });
});
