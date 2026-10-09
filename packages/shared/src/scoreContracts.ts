import { z } from 'zod';
import { isoUtcTimestampSchema } from './timestamps.js';
import {
  scoreKeySchema,
  scoreModelSchema,
  scoreTimeSchema,
  type ScoreModel,
} from './scoreModel.js';

export const scoreVisibilitySchema = z.enum(['private', 'choir', 'shared']);
export type ScoreVisibility = z.infer<typeof scoreVisibilitySchema>;

export const scoreImportWarningCodeSchema = z.enum([
  'UNSUPPORTED_CONSTRUCT_PRESERVED',
  'UNSUPPORTED_ATTRIBUTE_PRESERVED',
  'UNSUPPORTED_PITCH_PRESERVED',
  'UNSUPPORTED_GRACE_NOTE_PRESERVED',
  'UNSUPPORTED_CLEF_PRESERVED',
  'UNSUPPORTED_KEY_MODE_PRESERVED',
  'UNSUPPORTED_TIME_SIGNATURE_PRESERVED',
  'UNSUPPORTED_TEMPO_PRESERVED',
  'MID_SCORE_CLEF_CHANGE_PRESERVED',
  'ADDITIONAL_TEMPO_MARKING_PRESERVED',
  'ADDITIONAL_TITLE_PRESERVED',
  'UNMODELED_CREATOR_CREDIT_PRESERVED',
  'MID_SCORE_ATTRIBUTES_PRESERVED',
  'MULTIPLE_LYRICS_PRESERVED',
]);
export type ScoreImportWarningCode = z.infer<
  typeof scoreImportWarningCodeSchema
>;

export const scoreCreatorSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();
export type ScoreCreator = z.infer<typeof scoreCreatorSchema>;

export const scorePartSummarySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().trim().min(1).max(256),
  })
  .strict();
export type ScorePartSummary = z.infer<typeof scorePartSummarySchema>;

/** Uses the source part name; stable MusicXML IDs are never treated as labels. */
export function scorePartSummariesFromModel(
  model: Pick<ScoreModel, 'parts'>
): ScorePartSummary[] {
  return model.parts.map((part, index) =>
    scorePartSummarySchema.parse({
      id: part.id,
      label: part.name?.trim() || `Part ${index + 1}`,
    })
  );
}

export const scorePreservationStateSchema = z.enum([
  'clean',
  'opaque_constructs_preserved',
]);
export type ScorePreservationState = z.infer<
  typeof scorePreservationStateSchema
>;

export const scoreReadOnlyReasonSchema = z.literal(
  'UNSUPPORTED_MUSICXML_CONSTRUCTS_PRESERVED'
);
export type ScoreReadOnlyReason = z.infer<typeof scoreReadOnlyReasonSchema>;

export const scorePreservedConstructSchema = z
  .object({
    code: scoreImportWarningCodeSchema,
    path: z.string().min(1).optional(),
    partId: z.string().min(1).optional(),
  })
  .strict();
export type ScorePreservedConstruct = z.infer<
  typeof scorePreservedConstructSchema
>;

export const scorePreservationSchema = z
  .object({
    state: scorePreservationStateSchema,
    readOnlyReason: scoreReadOnlyReasonSchema.nullable(),
    preservedConstructs: z.array(scorePreservedConstructSchema).max(512),
  })
  .strict()
  .superRefine((preservation, context) => {
    const hasOpaqueConstructs =
      preservation.state === 'opaque_constructs_preserved';
    if (
      hasOpaqueConstructs !==
      (preservation.readOnlyReason ===
        'UNSUPPORTED_MUSICXML_CONSTRUCTS_PRESERVED')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['readOnlyReason'],
        message: 'Read-only reason must match the preservation state.',
      });
    }
    if (hasOpaqueConstructs !== preservation.preservedConstructs.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['preservedConstructs'],
        message: 'Preserved constructs must match the preservation state.',
      });
    }
  });
export type ScorePreservation = z.infer<typeof scorePreservationSchema>;

export const scoreAccessFlagsSchema = z
  .object({
    isOwner: z.boolean(),
    canView: z.boolean(),
    canEdit: z.boolean(),
    canManageAccess: z.boolean(),
    canChangeVisibility: z.boolean(),
    canSetChoirVisibility: z.boolean(),
  })
  .strict();
export type ScoreAccessFlags = z.infer<typeof scoreAccessFlagsSchema>;

/** Exact list-card/detail metadata; all returned rows are visible to the caller. */
export const scoreSummarySchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    composer: z.string().nullable(),
    key: scoreKeySchema,
    time: scoreTimeSchema,
    partIds: z.array(z.string().min(1)).min(1).max(64),
    parts: z.array(scorePartSummarySchema).min(1).max(64),
    partCount: z.number().int().min(1).max(64),
    measureCount: z.number().int().positive(),
    visibility: scoreVisibilitySchema,
    canEditContent: z.boolean(),
    preservation: scorePreservationSchema,
    creator: scoreCreatorSchema,
    createdAt: isoUtcTimestampSchema,
    updatedAt: isoUtcTimestampSchema,
    ...scoreAccessFlagsSchema.shape,
  })
  .strict()
  .superRefine((score, context) => {
    if (score.partIds.length !== score.partCount) {
      context.addIssue({
        code: 'custom',
        path: ['partCount'],
        message: 'partCount must equal the number of partIds.',
      });
    }
    if (score.parts.length !== score.partCount) {
      context.addIssue({
        code: 'custom',
        path: ['parts'],
        message: 'parts must contain one readable label for each part.',
      });
    }
    if (score.parts.some((part, index) => part.id !== score.partIds[index])) {
      context.addIssue({
        code: 'custom',
        path: ['parts'],
        message: 'parts must preserve partIds order and stable MusicXML IDs.',
      });
    }
    if (new Set(score.partIds).size !== score.partIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['partIds'],
        message: 'partIds must be unique.',
      });
    }
    if (!score.canView) {
      context.addIssue({
        code: 'custom',
        path: ['canView'],
        message:
          'A score returned in the library must be viewable by the caller.',
      });
    }
    if (!score.canEdit && score.canEditContent) {
      context.addIssue({
        code: 'custom',
        path: ['canEditContent'],
        message: 'Content editing cannot exceed role/access edit permission.',
      });
    }
    if (
      score.preservation.state === 'opaque_constructs_preserved' &&
      score.canEditContent
    ) {
      context.addIssue({
        code: 'custom',
        path: ['canEditContent'],
        message: 'Scores with preserved opaque constructs are read-only.',
      });
    }
  });
export type ScoreSummary = z.infer<typeof scoreSummarySchema>;

const scoreSearchTextSchema = z.string().trim().min(1).max(120);
const scoreCursorSchema = z.string().min(1).max(2048);

/** Client filter state. `mine: false` means no creator restriction. */
export const scoreListFiltersSchema = z
  .object({
    q: scoreSearchTextSchema.optional(),
    mine: z.boolean().optional(),
    visibility: scoreVisibilitySchema.optional(),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: scoreCursorSchema.optional(),
  })
  .strict();
export type ScoreListFilters = z.input<typeof scoreListFiltersSchema>;
export type ParsedScoreListFilters = z.output<typeof scoreListFiltersSchema>;

const queryLimitSchema = z
  .string()
  .regex(/^\d+$/, 'limit must be an integer from 1 to 100.')
  .transform(Number)
  .pipe(z.number().int().min(1).max(100));

/** URL query parser for GET /scores; `mine=true` narrows to caller-owned scores. */
export const scoreListQuerySchema = z
  .object({
    q: scoreSearchTextSchema.optional(),
    mine: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    visibility: scoreVisibilitySchema.optional(),
    limit: queryLimitSchema.optional(),
    cursor: scoreCursorSchema.optional(),
  })
  .strict()
  .transform((query) => ({ ...query, limit: query.limit ?? 20 }));
export type ScoreListQuery = z.input<typeof scoreListQuerySchema>;
export type ParsedScoreListQuery = z.output<typeof scoreListQuerySchema>;

export const scoreLibraryResponseSchema = z
  .object({
    scores: z.array(scoreSummarySchema),
    nextCursor: scoreCursorSchema.nullable(),
  })
  .strict();
export type ScoreLibraryResponse = z.infer<typeof scoreLibraryResponseSchema>;

export const scoreVisibilityUpdateRequestSchema = z
  .object({ visibility: scoreVisibilitySchema })
  .strict();
export type ScoreVisibilityUpdateRequest = z.infer<
  typeof scoreVisibilityUpdateRequestSchema
>;

/** PATCH /scores/:id; metadata and visibility may be changed together. */
export const patchScoreRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(512).optional(),
    composer: z.string().trim().max(512).nullable().optional(),
    visibility: scoreVisibilitySchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one score field must be provided.',
  });
export type PatchScoreRequest = z.input<typeof patchScoreRequestSchema>;
export type ParsedPatchScoreRequest = z.output<typeof patchScoreRequestSchema>;

export const patchScoreResponseSchema = z
  .object({ score: scoreSummarySchema })
  .strict();
export type PatchScoreResponse = z.infer<typeof patchScoreResponseSchema>;

export const scoreAccessUserRequestSchema = z
  .object({
    userId: z.string().min(1),
    canEdit: z.boolean().default(false),
  })
  .strict();
export type ScoreAccessUserRequest = z.input<
  typeof scoreAccessUserRequestSchema
>;
export type ParsedScoreAccessUserRequest = z.output<
  typeof scoreAccessUserRequestSchema
>;

/** PUT replaces the complete shared-access list; an empty list removes all grants. */
export const putScoreAccessRequestSchema = z
  .object({
    users: z.array(scoreAccessUserRequestSchema).max(100),
  })
  .strict()
  .superRefine(({ users }, context) => {
    const seen = new Set<string>();
    users.forEach((user, index) => {
      if (seen.has(user.userId)) {
        context.addIssue({
          code: 'custom',
          path: ['users', index, 'userId'],
          message: 'Each user may appear only once.',
        });
      }
      seen.add(user.userId);
    });
  });
export type PutScoreAccessRequest = z.input<typeof putScoreAccessRequestSchema>;
export type ParsedPutScoreAccessRequest = z.output<
  typeof putScoreAccessRequestSchema
>;

export const scoreAccessUserSchema = z
  .object({
    userId: z.string().min(1),
    displayName: z.string().min(1),
    canEdit: z.boolean(),
  })
  .strict();
export type ScoreAccessUser = z.infer<typeof scoreAccessUserSchema>;

export const scoreAccessResponseSchema = z
  .object({
    scoreId: z.string().min(1),
    visibility: z.literal('shared'),
    users: z.array(scoreAccessUserSchema),
  })
  .strict();
export type ScoreAccessResponse = z.infer<typeof scoreAccessResponseSchema>;

export const scoreVersionSummarySchema = z
  .object({
    id: z.string().min(1),
    note: z.string().nullable(),
    createdAt: isoUtcTimestampSchema,
    createdBy: scoreCreatorSchema,
  })
  .strict();
export type ScoreVersionSummary = z.infer<typeof scoreVersionSummarySchema>;

/** GET /scores/:id includes the raw current MusicXML for OSMD and shared model. */
export const scoreDetailSchema = scoreSummarySchema
  .extend({
    currentVersionId: z.string().min(1),
    version: scoreVersionSummarySchema,
    model: scoreModelSchema,
    musicXml: z.string().min(1),
  })
  .strict();
export type ScoreDetail = z.infer<typeof scoreDetailSchema>;

export const scoreDetailResponseSchema = z
  .object({ score: scoreDetailSchema })
  .strict();
export type ScoreDetailResponse = z.infer<typeof scoreDetailResponseSchema>;

export const scoreContentWriteErrorCodeSchema = z.literal(
  'SCORE_CONTENT_READ_ONLY'
);
export type ScoreContentWriteErrorCode = z.infer<
  typeof scoreContentWriteErrorCodeSchema
>;

/** HTTP 409 for model/version writes blocked by opaque source preservation. */
export const scoreContentWriteErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: scoreContentWriteErrorCodeSchema,
        message: z.string().min(1),
        preservation: scorePreservationSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.error.preservation.state !== 'opaque_constructs_preserved') {
      context.addIssue({
        code: 'custom',
        path: ['error', 'preservation'],
        message:
          'Content-read-only errors require opaque preserved constructs.',
      });
    }
  });
export type ScoreContentWriteErrorResponse = z.infer<
  typeof scoreContentWriteErrorResponseSchema
>;

export const scoreImportFormFieldsSchema = z
  .object({ visibility: scoreVisibilitySchema.default('private') })
  .strict();
export type ScoreImportFormFields = z.input<typeof scoreImportFormFieldsSchema>;
export type ParsedScoreImportFormFields = z.output<
  typeof scoreImportFormFieldsSchema
>;

export const scoreImportWarningSchema = z
  .object({
    code: scoreImportWarningCodeSchema,
    message: z.string().min(1),
    path: z.string().optional(),
    partId: z.string().optional(),
    measure: z.number().int().nonnegative().optional(),
    noteIndex: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ScoreImportWarning = z.infer<typeof scoreImportWarningSchema>;

/** Projects import warnings into stable, bounded summary/detail read-only metadata. */
export function scorePreservationFromWarnings(
  warnings: readonly ScoreImportWarning[]
): ScorePreservation {
  const unique = new Map<string, ScorePreservedConstruct>();
  for (const warning of warnings) {
    const construct = scorePreservedConstructSchema.parse({
      code: warning.code,
      ...(warning.path ? { path: warning.path } : {}),
      ...(warning.partId ? { partId: warning.partId } : {}),
    });
    const key = `${construct.code}\0${construct.path ?? ''}\0${construct.partId ?? ''}`;
    if (!unique.has(key)) unique.set(key, construct);
  }
  const preservedConstructs = [...unique.values()].slice(0, 512);
  const hasOpaqueConstructs = preservedConstructs.length > 0;
  return scorePreservationSchema.parse({
    state: hasOpaqueConstructs ? 'opaque_constructs_preserved' : 'clean',
    readOnlyReason: hasOpaqueConstructs
      ? 'UNSUPPORTED_MUSICXML_CONSTRUCTS_PRESERVED'
      : null,
    preservedConstructs,
  });
}

/** 201 response for multipart POST /scores (file field) or model-based create. */
export const scoreImportResultSchema = z
  .object({
    score: scoreSummarySchema,
    versionId: z.string().min(1),
    warnings: z.array(scoreImportWarningSchema),
  })
  .strict();
export type ScoreImportResult = z.infer<typeof scoreImportResultSchema>;

export const scoreImportErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNSUPPORTED_FILE_TYPE',
  'BODY_TOO_LARGE',
  'INVALID_MXL_ARCHIVE',
  'MISSING_CONTAINER_XML',
  'UNSAFE_CONTAINER_PATH',
  'MALFORMED_XML',
  'XML_DEPTH_LIMIT',
  'DOCTYPE_NOT_ALLOWED',
  'UNSUPPORTED_ROOT',
  'NO_PARTS',
  'INVALID_SCORE',
]);
export type ScoreImportErrorCode = z.infer<typeof scoreImportErrorCodeSchema>;

export const scoreImportValidationIssueCodeSchema = z.enum([
  'MALFORMED_XML',
  'XML_DEPTH_LIMIT',
  'DOCTYPE_NOT_ALLOWED',
  'UNSUPPORTED_ROOT',
  'NO_PARTS',
  'INVALID_MXL_ARCHIVE',
  'MISSING_CONTAINER_XML',
  'UNSAFE_CONTAINER_PATH',
  'INVALID_SCORE',
]);
export type ScoreImportValidationIssueCode = z.infer<
  typeof scoreImportValidationIssueCodeSchema
>;

export const scoreImportValidationIssueSchema = z
  .object({
    code: scoreImportValidationIssueCodeSchema,
    message: z.string().min(1),
    path: z.string().optional(),
  })
  .strict();
export type ScoreImportValidationIssue = z.infer<
  typeof scoreImportValidationIssueSchema
>;

export const scoreImportErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: scoreImportErrorCodeSchema,
        message: z.string().min(1),
        issues: z.array(scoreImportValidationIssueSchema).optional(),
      })
      .strict(),
  })
  .strict();
export type ScoreImportErrorResponse = z.infer<
  typeof scoreImportErrorResponseSchema
>;

export const scoreExportFormatSchema = z.literal('musicxml');
export type ScoreExportFormat = z.infer<typeof scoreExportFormatSchema>;

export const scoreExportQuerySchema = z
  .object({ format: scoreExportFormatSchema })
  .strict();
export type ScoreExportQuery = z.infer<typeof scoreExportQuerySchema>;

/** Raw response body and download headers for GET /scores/:id/export?format=musicxml. */
export const musicXmlExportBodySchema = z.string().min(1);
export type MusicXmlExportBody = z.infer<typeof musicXmlExportBodySchema>;

export const musicXmlExportHeadersSchema = z
  .object({
    contentType: z.literal(
      'application/vnd.recordare.musicxml+xml; charset=utf-8'
    ),
    filename: z
      .string()
      .min(10)
      .max(89)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*\.musicxml$/),
  })
  .strict();
export type MusicXmlExportHeaders = z.infer<typeof musicXmlExportHeadersSchema>;

/** JSON POST /scores alternative for creating a score from the shared model. */
export const createScoreFromModelRequestSchema = z
  .object({
    visibility: scoreVisibilitySchema.default('private'),
    model: scoreModelSchema,
  })
  .strict();
export type CreateScoreFromModelRequest = z.input<
  typeof createScoreFromModelRequestSchema
>;
export type ParsedCreateScoreFromModelRequest = z.output<
  typeof createScoreFromModelRequestSchema
>;

/** POST /scores/:id/versions saves a new immutable model version. */
export const createScoreVersionRequestSchema = z
  .object({
    model: scoreModelSchema,
    note: z.string().trim().max(256).optional(),
  })
  .strict();
export type CreateScoreVersionRequest = z.input<
  typeof createScoreVersionRequestSchema
>;
export type ParsedCreateScoreVersionRequest = z.output<
  typeof createScoreVersionRequestSchema
>;

export const createScoreVersionResponseSchema = z
  .object({
    score: scoreSummarySchema,
    versionId: z.string().min(1),
  })
  .strict();
export type CreateScoreVersionResponse = z.infer<
  typeof createScoreVersionResponseSchema
>;

/** POST /scores/:id/autosaves performs an idempotent optimistic draft save. */
export const createScoreAutosaveRequestSchema = z
  .object({
    model: scoreModelSchema,
    baseVersionId: z.string().min(1).max(128),
    requestId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
  })
  .strict();
export type CreateScoreAutosaveRequest = z.infer<
  typeof createScoreAutosaveRequestSchema
>;

export const createScoreAutosaveResponseSchema = z
  .object({
    score: scoreSummarySchema,
    versionId: z.string().min(1),
    currentVersionId: z.string().min(1),
    outcome: z.enum(['saved', 'unchanged', 'replayed']),
  })
  .strict();
export type CreateScoreAutosaveResponse = z.infer<
  typeof createScoreAutosaveResponseSchema
>;
