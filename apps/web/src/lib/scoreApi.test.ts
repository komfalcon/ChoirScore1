import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearScoreAccess,
  createScoreVersion,
  exportScoreMusicXml,
  getScoreDetail,
  importScoreFile,
  listScores,
  patchScoreMetadata,
  patchScoreVisibility,
  ScoreApiResponseError,
  toScoreUiError,
} from './scoreApi';
import { ApiError } from './apiClient';
import {
  scoreDetailResponse,
  scoreLibraryResponse,
} from '../test/scoreFixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('score API client', () => {
  it('requests the filtered library and validates the shared response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(scoreLibraryResponse), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      listScores({
        query: '  Morning light ',
        mine: true,
        visibility: 'private',
      })
    ).resolves.toEqual(scoreLibraryResponse);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      '/api/scores?q=Morning+light&mine=true&visibility=private&limit=20'
    );
    expect(init.method).toBeUndefined();
    expect(init.credentials).toBe('same-origin');
  });

  it('loads detail by safely encoded score id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(scoreDetailResponse), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getScoreDetail('score / 1')).resolves.toEqual(
      scoreDetailResponse
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/scores/score%20%2F%201');
  });

  it('sends title and composer metadata through a CSRF-protected API PATCH', async () => {
    const updatedScore = {
      ...scoreLibraryResponse.scores[0],
      title: 'Evening Song',
      composer: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ score: updatedScore }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      patchScoreMetadata('score / 1', {
        title: '  Evening Song  ',
        composer: null,
      })
    ).resolves.toEqual({ score: updatedScore });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/scores/score%20%2F%201');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      title: 'Evening Song',
      composer: null,
    });
    expect(new Headers(init.headers).get('X-Requested-With')).toBe(
      'choirscore'
    );
    expect(new Headers(init.headers).get('Content-Type')).toBe(
      'application/json'
    );
  });

  it('changes visibility through the CSRF-protected score PATCH contract', async () => {
    const updatedScore = {
      ...scoreLibraryResponse.scores[0],
      visibility: 'shared' as const,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ score: updatedScore }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(patchScoreVisibility('score-1', 'shared')).resolves.toEqual({
      score: updatedScore,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/scores/score-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ visibility: 'shared' });
    expect(new Headers(init.headers).get('X-Requested-With')).toBe(
      'choirscore'
    );
  });

  it('revokes all explicit grants with an empty replacement and rejects unexpected grants', async () => {
    const accessResponse = {
      scoreId: 'score-1',
      visibility: 'shared' as const,
      users: [],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(accessResponse), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(clearScoreAccess('score-1')).resolves.toEqual(accessResponse);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/scores/score-1/access');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ users: [] });
    expect(new Headers(init.headers).get('X-Requested-With')).toBe(
      'choirscore'
    );

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...accessResponse,
          users: [
            { userId: 'unexpected', displayName: 'Unexpected', canEdit: false },
          ],
        }),
        { status: 200 }
      )
    );
    await expect(clearScoreAccess('score-1')).rejects.toBeInstanceOf(
      ScoreApiResponseError
    );
  });

  it('creates one immutable version through the CSRF-protected version endpoint', async () => {
    const result = {
      score: scoreLibraryResponse.scores[0],
      versionId: 'version-2',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(result), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const model = structuredClone(scoreDetailResponse.score.model);

    await expect(
      createScoreVersion(
        'score / 1',
        model,
        'Range-fit transpose',
        'loaded-version-7'
      )
    ).resolves.toEqual(result);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/scores/score%20%2F%201/versions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      model,
      note: 'Range-fit transpose',
      baseVersionId: 'loaded-version-7',
    });
    expect(new Headers(init.headers).get('X-Requested-With')).toBe(
      'choirscore'
    );
    expect(new Headers(init.headers).get('Content-Type')).toBe(
      'application/json'
    );
  });

  it('uploads a multipart file with CSRF protection and leaves the boundary to fetch', async () => {
    const result = {
      score: scoreLibraryResponse.scores[0],
      versionId: 'version-1',
      warnings: [],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(result), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['<score-partwise/>'], 'song.musicxml', {
      type: 'application/vnd.recordare.musicxml+xml',
    });

    await expect(importScoreFile(file)).resolves.toEqual(result);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe('/api/scores');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(headers.get('X-Requested-With')).toBe('choirscore');
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('downloads raw MusicXML and validates the response headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<score-partwise version="4.0"/>', {
        status: 200,
        headers: {
          'Content-Type':
            'application/vnd.recordare.musicxml+xml; charset=utf-8',
          'Content-Disposition':
            'attachment; filename="morning-light.musicxml"',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(exportScoreMusicXml('score-1')).resolves.toEqual({
      body: '<score-partwise version="4.0"/>',
      filename: 'morning-light.musicxml',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/scores/score-1/export?format=musicxml'
    );
  });

  it('converts API and malformed-response failures to safe UI messages', () => {
    expect(
      toScoreUiError(
        new ApiError(403, { code: 'FORBIDDEN', message: 'Not allowed.' })
      )
    ).toEqual({ code: 'FORBIDDEN', message: 'Not allowed.' });
    expect(toScoreUiError(new Error('internal fetch detail'))).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'The score service could not be reached. Please try again.',
    });
  });
});
