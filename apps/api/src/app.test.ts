import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('createApp', () => {
  it.each(['/healthz', '/api/healthz'])(
    'returns a healthy response on %s',
    async (path) => {
      const app = createApp();
      const response = await request(app).get(path);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    }
  );
});
