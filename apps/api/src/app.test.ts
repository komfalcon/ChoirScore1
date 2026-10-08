import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('createApp', () => {
  it('returns 200 on /healthz', async () => {
    const app = createApp();
    const response = await request(app).get('/healthz');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
