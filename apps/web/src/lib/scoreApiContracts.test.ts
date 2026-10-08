import { describe, expect, it } from 'vitest';
import {
  parseApiErrorResponse,
  parseMusicXmlExportBody,
  parseMusicXmlExportHeaders,
  parseScoreContentWriteErrorResponse,
  parseScoreDetailResponse,
  parseScoreImportErrorResponse,
  parseScoreImportResult,
  parseScoreLibraryResponse,
} from './scoreApiContracts';
import {
  emptyScoreLibraryResponse,
  opaqueReadOnlyScoreDetailResponse,
  scoreDetailResponse,
  scoreLibraryResponse,
  scoreSummary,
} from '../test/scoreFixtures';

describe('web score contract adapters', () => {
  it('accepts the shared list and detail envelopes without reshaping their data', () => {
    expect(parseScoreLibraryResponse(scoreLibraryResponse)).toEqual(
      scoreLibraryResponse
    );
    expect(parseScoreLibraryResponse(emptyScoreLibraryResponse)).toEqual(
      emptyScoreLibraryResponse
    );
    expect(parseScoreDetailResponse(scoreDetailResponse)).toEqual(
      scoreDetailResponse
    );
    expect(() => parseScoreLibraryResponse({ scores: [] })).toThrow();
    expect(() =>
      parseScoreDetailResponse({ score: { id: 'missing' } })
    ).toThrow();
  });

  it('preserves import warning details and structured validation issues', () => {
    const result = {
      score: scoreSummary,
      versionId: 'version-1',
      warnings: [
        {
          code: 'UNSUPPORTED_CONSTRUCT_PRESERVED' as const,
          message: 'A MusicXML construct remains in the original file.',
          path: '/score-partwise/print',
        },
      ],
    };
    expect(parseScoreImportResult(result)).toEqual(result);

    const failure = {
      error: {
        code: 'MALFORMED_XML' as const,
        message: 'The MusicXML document is malformed.',
        issues: [
          {
            code: 'MALFORMED_XML' as const,
            message: 'The XML document could not be parsed.',
            path: '/score-partwise',
          },
        ],
      },
    };
    expect(parseScoreImportErrorResponse(failure)).toEqual(failure);
    expect(() =>
      parseScoreImportErrorResponse({ error: { code: 'BAD' } })
    ).toThrow();
  });

  it('keeps generic and preservation-specific API errors typed', () => {
    const generic = {
      error: { code: 'FORBIDDEN', message: 'Access is not permitted.' },
    };
    expect(parseApiErrorResponse(generic)).toEqual(generic);

    const preservationError = {
      error: {
        code: 'SCORE_CONTENT_READ_ONLY' as const,
        message: 'Opaque source constructs must be preserved.',
        preservation: opaqueReadOnlyScoreDetailResponse.score.preservation,
      },
    };
    expect(parseScoreContentWriteErrorResponse(preservationError)).toEqual(
      preservationError
    );
  });

  it('validates raw MusicXML export content and its exact response headers', () => {
    const body = '<score-partwise version="4.0"/>';
    const headers = new Headers({
      'Content-Type': 'application/vnd.recordare.musicxml+xml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="morning-light.musicxml"',
    });
    expect(parseMusicXmlExportBody(body)).toBe(body);
    expect(parseMusicXmlExportHeaders(headers)).toEqual({
      contentType: 'application/vnd.recordare.musicxml+xml; charset=utf-8',
      filename: 'morning-light.musicxml',
    });
    expect(() => parseMusicXmlExportBody('')).toThrow();
    expect(() =>
      parseMusicXmlExportHeaders(
        new Headers({
          'Content-Type': 'application/xml',
          'Content-Disposition': 'attachment; filename="wrong.xml"',
        })
      )
    ).toThrow();
  });
});
