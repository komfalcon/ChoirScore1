import {
  scoreListFiltersSchema,
  type ApiErrorResponse,
  type ScoreImportResult,
  type ScoreLibraryResponse,
  type ScoreVisibility,
} from '@choirscore/shared';
import { ApiError, apiFetch } from './apiClient';
import {
  parseMusicXmlExportBody,
  parseMusicXmlExportHeaders,
  parseScoreDetailResponse,
  parseScoreImportResult,
  parseScoreLibraryResponse,
} from './scoreApiContracts';

export type ScoreUiError = ApiErrorResponse['error'];

export class ScoreApiResponseError extends Error {
  constructor(message = 'The score service returned an unexpected response.') {
    super(message);
    this.name = 'ScoreApiResponseError';
  }
}

function responseError(error: unknown): ScoreUiError {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ScoreApiResponseError) {
    return { code: 'INVALID_API_RESPONSE', message: error.message };
  }
  return {
    code: 'SERVICE_UNAVAILABLE',
    message: 'The score service could not be reached. Please try again.',
  };
}

export function toScoreUiError(error: unknown): ScoreUiError {
  return responseError(error);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ScoreApiResponseError();
  }
}

function parseResponse<T>(parse: (payload: unknown) => T, payload: unknown): T {
  try {
    return parse(payload);
  } catch {
    throw new ScoreApiResponseError();
  }
}

export async function listScores(
  options: {
    query?: string;
    visibility?: ScoreVisibility;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  } = {}
): Promise<ScoreLibraryResponse> {
  const filters = scoreListFiltersSchema.parse({
    ...(options.query?.trim() ? { q: options.query } : {}),
    ...(options.visibility ? { visibility: options.visibility } : {}),
    ...(options.cursor ? { cursor: options.cursor } : {}),
    limit: options.limit ?? 20,
  });
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.visibility) params.set('visibility', filters.visibility);
  if (filters.cursor) params.set('cursor', filters.cursor);
  params.set('limit', String(filters.limit));
  const response = await apiFetch(`/scores?${params.toString()}`, {
    signal: options.signal,
  });
  return parseResponse(parseScoreLibraryResponse, await readJson(response));
}

export async function getScoreDetail(id: string, signal?: AbortSignal) {
  const response = await apiFetch(`/scores/${encodeURIComponent(id)}`, {
    signal,
  });
  return parseResponse(parseScoreDetailResponse, await readJson(response));
}

export async function importScoreFile(
  file: File,
  signal?: AbortSignal
): Promise<ScoreImportResult> {
  const form = new FormData();
  form.append('file', file, file.name);
  const response = await apiFetch('/scores', {
    method: 'POST',
    body: form,
    signal,
  });
  return parseResponse(parseScoreImportResult, await readJson(response));
}

export async function exportScoreMusicXml(
  id: string,
  signal?: AbortSignal
): Promise<{ body: string; filename: string }> {
  const response = await apiFetch(
    `/scores/${encodeURIComponent(id)}/export?format=musicxml`,
    { signal }
  );
  let headers: ReturnType<typeof parseMusicXmlExportHeaders>;
  try {
    headers = parseMusicXmlExportHeaders(response.headers);
  } catch {
    throw new ScoreApiResponseError(
      'The score service returned invalid MusicXML export metadata.'
    );
  }
  let body: string;
  try {
    body = parseMusicXmlExportBody(await response.text());
  } catch {
    throw new ScoreApiResponseError(
      'The score service returned an invalid MusicXML export.'
    );
  }
  return { body, filename: headers.filename };
}

export function isScoreRequestAborted(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
