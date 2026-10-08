import { describe, expect, it } from 'vitest';
import { getApiBaseUrl } from './lib/apiClient';

describe('api client config', () => {
  it('defaults API base to /api', () => {
    expect(getApiBaseUrl()).toBe('/api');
  });
});
