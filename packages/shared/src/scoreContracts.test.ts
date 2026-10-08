import { describe, expect, it } from 'vitest';
import {
  createScoreFromModelRequestSchema,
  musicXmlExportBodySchema,
  musicXmlExportHeadersSchema,
  patchScoreRequestSchema,
  putScoreAccessRequestSchema,
  scoreAccessResponseSchema,
  scoreDetailResponseSchema,
  scoreImportErrorResponseSchema,
  scoreImportFormFieldsSchema,
  scoreImportResultSchema,
  scoreLibraryResponseSchema,
  scoreListFiltersSchema,
  scoreListQuerySchema,
  scoreVisibilityUpdateRequestSchema,
} from './scoreContracts.js';

const timestamp = '2026-10-08T10:00:00.000Z';

const summary = {
  id: 'score_1',
  title: 'Morning Light',
  composer: 'Traditional',
  key: { fifths: 0, mode: 'major' as const },
  time: { beats: 4, beatType: 4 },
  partIds: ['S', 'A', 'T', 'B'],
  partCount: 4,
  measureCount: 3,
  visibility: 'shared' as const,
  creator: { id: 'user_1', displayName: 'Choir Director' },
  createdAt: timestamp,
  updatedAt: timestamp,
  isOwner: false,
  canView: true,
  canEdit: false,
  canManageAccess: false,
  canChangeVisibility: false,
  canSetChoirVisibility: false,
};

const model = {
  title: 'Morning Light',
  composer: 'Traditional',
  key: { fifths: 0, mode: 'major' as const },
  time: { beats: 4, beatType: 4 },
  tempo: 96,
  parts: [
    {
      id: 'S',
      name: 'Soprano',
      clef: 'treble' as const,
      measures: [
        {
          number: 1,
          notes: [
            {
              pitch: 'C5',
              dur: 1,
              tie: false,
              voice: '1',
              staff: 1,
              chord: false,
              lyric: { text: 'Morn-', syllabic: 'begin' as const },
            },
          ],
        },
      ],
    },
  ],
};

describe('shared score API contracts', () => {
  it('parses list filters independently and normalizes URL query defaults', () => {
    expect(
      scoreListFiltersSchema.parse({
        q: ' morning ',
        mine: true,
        visibility: 'shared',
      })
    ).toEqual({ q: 'morning', mine: true, visibility: 'shared', limit: 20 });
    expect(
      scoreListQuerySchema.parse({
        q: 'composer',
        mine: 'true',
        visibility: 'choir',
      })
    ).toEqual({ q: 'composer', mine: true, visibility: 'choir', limit: 20 });
    expect(
      scoreListQuerySchema.parse({
        mine: 'false',
        visibility: 'private',
        limit: '100',
      })
    ).toEqual({ mine: false, visibility: 'private', limit: 100 });
    expect(scoreListQuerySchema.safeParse({ mine: 'yes' }).success).toBe(false);
    expect(scoreListQuerySchema.safeParse({ limit: '101' }).success).toBe(
      false
    );
    expect(scoreListQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
  });

  it('freezes the cursor-paginated score-card summary fields and access flags', () => {
    const response = { scores: [summary], nextCursor: 'opaque_cursor' };
    expect(scoreLibraryResponseSchema.parse(response)).toEqual(response);
    expect(
      scoreLibraryResponseSchema.parse({ scores: [summary], nextCursor: null })
    ).toEqual({
      scores: [summary],
      nextCursor: null,
    });
    expect(
      scoreLibraryResponseSchema.safeParse({
        scores: [{ ...summary, partCount: 3 }],
        nextCursor: null,
      }).success
    ).toBe(false);
  });

  it('defines metadata/visibility updates and owner-managed shared-access replacement', () => {
    expect(
      scoreVisibilityUpdateRequestSchema.parse({ visibility: 'shared' })
    ).toEqual({
      visibility: 'shared',
    });
    expect(
      patchScoreRequestSchema.parse({ composer: null, visibility: 'private' })
    ).toEqual({
      composer: null,
      visibility: 'private',
    });
    expect(patchScoreRequestSchema.safeParse({}).success).toBe(false);
    expect(
      putScoreAccessRequestSchema.parse({ users: [{ userId: 'member_1' }] })
    ).toEqual({ users: [{ userId: 'member_1', canEdit: false }] });
    expect(
      putScoreAccessRequestSchema.safeParse({
        users: [{ userId: 'member_1' }, { userId: 'member_1', canEdit: true }],
      }).success
    ).toBe(false);
    expect(
      scoreAccessResponseSchema.parse({
        scoreId: 'score_1',
        visibility: 'shared',
        users: [
          { userId: 'member_1', displayName: 'Member One', canEdit: false },
        ],
      }).visibility
    ).toBe('shared');
  });

  it('defines score detail with version metadata, the shared model, raw XML and the card flags', () => {
    const detail = {
      ...summary,
      currentVersionId: 'version_1',
      version: {
        id: 'version_1',
        note: 'Imported',
        createdAt: timestamp,
        createdBy: { id: 'user_1', displayName: 'Choir Director' },
      },
      model,
      musicXml: '<score-partwise version="4.0"/>',
    };
    expect(scoreDetailResponseSchema.parse({ score: detail })).toEqual({
      score: detail,
    });
    expect(
      scoreDetailResponseSchema.safeParse({
        score: {
          ...detail,
          model: { ...model, preservation: { sourceXml: 'x' } },
        },
      }).success
    ).toBe(false);
  });

  it('defines multipart upload fields, model-create input and structured validation errors', () => {
    expect(scoreImportFormFieldsSchema.parse({})).toEqual({
      visibility: 'private',
    });
    expect(scoreImportFormFieldsSchema.parse({ visibility: 'shared' })).toEqual(
      {
        visibility: 'shared',
      }
    );
    expect(
      createScoreFromModelRequestSchema.parse({ model, visibility: 'private' })
        .visibility
    ).toBe('private');

    const result = {
      score: summary,
      versionId: 'version_1',
      warnings: [
        {
          code: 'UNSUPPORTED_CONSTRUCT_PRESERVED' as const,
          message: 'A layout element is retained in the original MusicXML.',
          path: '/score-partwise/part/measure/print',
        },
      ],
    };
    expect(scoreImportResultSchema.parse(result)).toEqual(result);
    expect(
      scoreImportErrorResponseSchema.parse({
        error: {
          code: 'DOCTYPE_NOT_ALLOWED',
          message: 'DOCTYPE and entity declarations are not allowed.',
          issues: [
            { code: 'DOCTYPE_NOT_ALLOWED', message: 'DOCTYPE is prohibited.' },
          ],
        },
      }).error.code
    ).toBe('DOCTYPE_NOT_ALLOWED');
    expect(
      scoreImportErrorResponseSchema.parse({
        error: { code: 'XML_DEPTH_LIMIT', message: 'XML nesting is too deep.' },
      }).error.code
    ).toBe('XML_DEPTH_LIMIT');
  });

  it('specifies a raw MusicXML export body and sanitized download headers', () => {
    const xml = '<score-partwise version="4.0"/>';
    expect(musicXmlExportBodySchema.parse(xml)).toBe(xml);
    expect(
      musicXmlExportHeadersSchema.parse({
        contentType: 'application/vnd.recordare.musicxml+xml; charset=utf-8',
        filename: 'morning-light.musicxml',
      })
    ).toEqual({
      contentType: 'application/vnd.recordare.musicxml+xml; charset=utf-8',
      filename: 'morning-light.musicxml',
    });
    expect(
      musicXmlExportHeadersSchema.safeParse({
        contentType: 'application/json',
        filename: '../private.musicxml',
      }).success
    ).toBe(false);
    expect(
      musicXmlExportHeadersSchema.parse({
        contentType: 'application/vnd.recordare.musicxml+xml; charset=utf-8',
        filename: 'a.musicxml',
      }).filename
    ).toBe('a.musicxml');
  });
});
