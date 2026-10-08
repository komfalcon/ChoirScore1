import {
  apiErrorResponseSchema,
  musicXmlExportBodySchema,
  musicXmlExportHeadersSchema,
  scoreContentWriteErrorResponseSchema,
  scoreDetailResponseSchema,
  scoreImportErrorResponseSchema,
  scoreImportResultSchema,
  scoreLibraryResponseSchema,
  type ApiErrorResponse,
  type MusicXmlExportBody,
  type MusicXmlExportHeaders,
  type ScoreContentWriteErrorResponse,
  type ScoreDetailResponse,
  type ScoreImportErrorResponse,
  type ScoreImportResult,
  type ScoreLibraryResponse,
} from '@choirscore/shared';

/** Runtime-checks the exact list envelope before a future UI consumer renders it. */
export function parseScoreLibraryResponse(
  payload: unknown
): ScoreLibraryResponse {
  return scoreLibraryResponseSchema.parse(payload);
}

/** Runtime-checks the exact detail envelope before a future viewer consumes it. */
export function parseScoreDetailResponse(
  payload: unknown
): ScoreDetailResponse {
  return scoreDetailResponseSchema.parse(payload);
}

/** Runtime-checks the multipart/model-import success envelope. */
export function parseScoreImportResult(payload: unknown): ScoreImportResult {
  return scoreImportResultSchema.parse(payload);
}

/** Runtime-checks the shared API error envelope. */
export function parseApiErrorResponse(payload: unknown): ApiErrorResponse {
  return apiErrorResponseSchema.parse(payload);
}

/** Runtime-checks structured import-validation issues without discarding them. */
export function parseScoreImportErrorResponse(
  payload: unknown
): ScoreImportErrorResponse {
  return scoreImportErrorResponseSchema.parse(payload);
}

/** Runtime-checks the preservation-specific content-read-only error envelope. */
export function parseScoreContentWriteErrorResponse(
  payload: unknown
): ScoreContentWriteErrorResponse {
  return scoreContentWriteErrorResponseSchema.parse(payload);
}

/** The MusicXML download is a raw body, not a JSON response envelope. */
export function parseMusicXmlExportBody(payload: unknown): MusicXmlExportBody {
  return musicXmlExportBodySchema.parse(payload);
}

/** Validates the exact response metadata contract for a MusicXML download. */
export function parseMusicXmlExportHeaders(
  headers: Pick<Headers, 'get'>
): MusicXmlExportHeaders {
  const contentDisposition = headers.get('Content-Disposition');
  const filename = contentDisposition?.match(
    /(?:^|;)\s*filename="([^"]+)"(?:;|$)/i
  )?.[1];

  return musicXmlExportHeadersSchema.parse({
    contentType: headers.get('Content-Type'),
    filename,
  });
}
