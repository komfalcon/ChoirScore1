import {
  scoreDetailResponseSchema,
  scoreLibraryResponseSchema,
  scorePreservationSchema,
  scoreSummarySchema,
} from '@choirscore/shared';

const timestamp = '2026-10-08T10:00:00.000Z';
const model = {
  title: 'Morning Light',
  composer: 'Traditional',
  key: { fifths: 0, mode: 'major' as const },
  time: { beats: 4, beatType: 4 },
  tempo: 96,
  parts: [
    {
      id: 'voice-one',
      name: 'Soprano',
      clef: 'treble' as const,
      measures: [{ number: 1, notes: [{ pitch: 'C5', dur: 1 }] }],
    },
  ],
};

const summaryInput = {
  id: 'score-1',
  title: 'Morning Light',
  composer: 'Traditional',
  key: { fifths: 0, mode: 'major' as const },
  time: { beats: 4, beatType: 4 },
  partIds: ['voice-one'],
  parts: [{ id: 'voice-one', label: 'Soprano' }],
  partCount: 1,
  measureCount: 1,
  visibility: 'private' as const,
  canEditContent: true,
  preservation: {
    state: 'clean' as const,
    readOnlyReason: null,
    preservedConstructs: [],
  },
  creator: { id: 'user-1', displayName: 'Choir Director' },
  createdAt: timestamp,
  updatedAt: timestamp,
  isOwner: true,
  canView: true,
  canEdit: true,
  canManageAccess: true,
  canChangeVisibility: true,
  canSetChoirVisibility: false,
};

export const scoreSummary = scoreSummarySchema.parse(summaryInput);

export const scoreLibraryResponse = scoreLibraryResponseSchema.parse({
  scores: [scoreSummary],
  nextCursor: null,
});

export const emptyScoreLibraryResponse = scoreLibraryResponseSchema.parse({
  scores: [],
  nextCursor: null,
});

export const scoreDetailResponse = scoreDetailResponseSchema.parse({
  score: {
    ...summaryInput,
    currentVersionId: 'version-1',
    version: {
      id: 'version-1',
      note: 'Imported',
      createdAt: timestamp,
      createdBy: summaryInput.creator,
    },
    model,
    musicXml: '<score-partwise version="4.0"/>',
  },
});

const preservation = scorePreservationSchema.parse({
  state: 'opaque_constructs_preserved',
  readOnlyReason: 'UNSUPPORTED_MUSICXML_CONSTRUCTS_PRESERVED',
  preservedConstructs: [
    { code: 'UNSUPPORTED_CONSTRUCT_PRESERVED', path: '/score-partwise/print' },
  ],
});

export const opaqueReadOnlyScoreDetailResponse =
  scoreDetailResponseSchema.parse({
    score: {
      ...summaryInput,
      canEditContent: false,
      preservation,
      currentVersionId: 'version-2',
      version: {
        id: 'version-2',
        note: 'Imported with preserved content',
        createdAt: timestamp,
        createdBy: summaryInput.creator,
      },
      model,
      musicXml: '<score-partwise version="4.0"><print/></score-partwise>',
    },
  });
