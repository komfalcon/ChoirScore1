import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScoreAutosave } from './scoreApi';
import { scoreDetailResponse, scoreSummary } from '../test/scoreFixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('score autosave API client', () => {
  it('posts a shared-schema request and validates the autosave response', async () => {
    const score = scoreSummary;
    const result = {
      score,
      versionId: 'autosave-version-2',
      currentVersionId: 'autosave-version-2',
      outcome: 'saved',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(result), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const request = {
      model: structuredClone(scoreDetailResponse.score.model),
      baseVersionId: 'version-1',
      requestId: 'editor-session:request-1',
    };

    await expect(createScoreAutosave('score / 1', request)).resolves.toEqual(
      result
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/scores/score%20%2F%201/autosaves');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(request);
    expect(new Headers(init.headers).get('X-Requested-With')).toBe(
      'choirscore'
    );
    expect(new Headers(init.headers).get('Content-Type')).toBe(
      'application/json'
    );
  });

  it('rejects a malformed request before making a network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createScoreAutosave('score-1', {
        model: { title: '' } as never,
        baseVersionId: 'version-1',
        requestId: 'request-1',
      })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
