import { createHmac, timingSafeEqual } from 'node:crypto';
import { extname } from 'node:path';
import { Router, type Response } from 'express';
import {
  MusicXmlConversionError,
  createScoreFromModelRequestSchema,
  createScoreVersionRequestSchema,
  createScoreVersionResponseSchema,
  musicXmlToModel,
  modelToMusicXml,
  musicXmlExportHeadersSchema,
  patchScoreRequestSchema,
  patchScoreResponseSchema,
  preservedScoreModelSchema,
  scoreAccessResponseSchema,
  scoreContentWriteErrorResponseSchema,
  scoreDetailResponseSchema,
  scoreExportQuerySchema,
  scoreImportFormFieldsSchema,
  scoreImportResultSchema,
  scoreLibraryResponseSchema,
  scoreListQuerySchema,
  scoreModelSchema,
  scorePartSummariesFromModel,
  scorePreservationFromWarnings,
  scoreSummarySchema,
  putScoreAccessRequestSchema,
  type ParsedScoreListQuery,
  type ScoreImportErrorCode,
  type ScoreImportValidationIssueCode,
  type ScoreSummary,
} from '@choirscore/shared';
import { newId } from '../../audit';
import type { ApiRepository, ScoreRowWithVersion } from '../../db/repository';
import { sendApiError } from '../../errors';
import type { RequestWithContext } from '../../types';
import {
  ScoreImportFailure,
  decodeMusicXml,
  extractMxlMusicXml,
  readMultipartScoreUpload,
} from './upload';

const MUSICXML_CONTENT_TYPE =
  'application/vnd.recordare.musicxml+xml; charset=utf-8';

interface ScorePermissions {
  isOwner: boolean;
  canView: boolean;
  canEdit: boolean;
  canManageAccess: boolean;
  canChangeVisibility: boolean;
  canSetChoirVisibility: boolean;
}

interface CursorPayload {
  v: 1;
  userId: string;
  q: string | null;
  mine: boolean | null;
  visibility: string | null;
  limit: number;
  updatedAt: string;
  id: string;
}

export function createScoresRouter(
  repository: ApiRepository,
  cursorSecret: string
) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    const user = (req as RequestWithContext).authUser;
    if (!user)
      return await sendApiError(
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication is required.'
      );
    const parsedQuery = scoreListQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return await sendApiError(
        res,
        400,
        'VALIDATION_ERROR',
        'The score-list query is invalid.'
      );
    }
    const query = parsedQuery.data;
    let cursor: { updatedAt: string; id: string } | undefined;
    if (query.cursor) {
      cursor = decodeCursor(query.cursor, cursorSecret, user.id, query);
      if (!cursor) {
        return await sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'The score-list cursor is invalid or does not match this query.'
        );
      }
    }

    try {
      const rows = await repository.listScoreRows({
        userId: user.id,
        role: user.role,
        ...(query.q ? { q: query.q } : {}),
        ...(query.mine === undefined ? {} : { mine: query.mine }),
        ...(query.visibility ? { visibility: query.visibility } : {}),
        ...(cursor ? { cursor } : {}),
        limit: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const summaries = page.map((row) => summarize(row, user));
      const last = page.at(-1)?.score;
      const response = scoreLibraryResponseSchema.parse({
        scores: summaries,
        nextCursor:
          hasMore && last
            ? encodeCursor(
                cursorPayload(user.id, query, last.updatedAt, last.id),
                cursorSecret
              )
            : null,
      });
      return res.status(200).json(response);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    const user = (req as RequestWithContext).authUser;
    if (!user)
      return await sendApiError(
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication is required.'
      );

    if (req.is('application/json')) {
      const parsed = createScoreFromModelRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return await sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'The score model is invalid.'
        );
      }
      if (user.role === 'member' && parsed.data.visibility !== 'private') {
        return await sendApiError(
          res,
          403,
          'FORBIDDEN',
          'Members may create only private scores.'
        );
      }
      try {
        const musicXml = modelToMusicXml(parsed.data.model, {
          mode: 'new-score',
        });
        const converted = musicXmlToModel(musicXml);
        return await persistNewScore({
          repository,
          res,
          user,
          musicXml,
          title: converted.model.title,
          composer: converted.model.composer ?? null,
          visibility: parsed.data.visibility,
          note: 'Created',
          warnings: converted.warnings,
        });
      } catch (error) {
        if (sendConversionFailure(res, error)) return;
        return next(error);
      }
    }

    if (!req.is('multipart/form-data')) {
      return sendScoreImportFailure(
        res,
        400,
        'VALIDATION_ERROR',
        'Use JSON model data or a multipart MusicXML file.'
      );
    }

    try {
      const upload = await readMultipartScoreUpload(req);
      const fields = scoreImportFormFieldsSchema.safeParse(upload.fields);
      if (!fields.success) {
        return sendScoreImportFailure(
          res,
          400,
          'VALIDATION_ERROR',
          'The score import fields are invalid.'
        );
      }
      if (user.role === 'member' && fields.data.visibility !== 'private') {
        return await sendApiError(
          res,
          403,
          'FORBIDDEN',
          'Members may create only private scores.'
        );
      }
      const extension = extname(upload.fileName).toLowerCase();
      if (!['.musicxml', '.xml', '.mxl'].includes(extension)) {
        return sendScoreImportFailure(
          res,
          400,
          'UNSUPPORTED_FILE_TYPE',
          'Upload a .musicxml, .xml, or .mxl score file.'
        );
      }
      const musicXml =
        extension === '.mxl'
          ? await extractMxlMusicXml(upload.fileBytes)
          : decodeMusicXml(upload.fileBytes);
      const converted = musicXmlToModel(musicXml);
      return await persistNewScore({
        repository,
        res,
        user,
        musicXml,
        title: converted.model.title,
        composer: converted.model.composer ?? null,
        visibility: fields.data.visibility,
        note: 'Imported',
        warnings: converted.warnings,
      });
    } catch (error) {
      if (error instanceof ScoreImportFailure) {
        return sendScoreImportFailure(
          res,
          error.status,
          error.code,
          error.message
        );
      }
      if (sendConversionFailure(res, error)) return;
      return next(error);
    }
  });

  router.get('/:id/export', async (req, res, _next) => {
    const user = (req as RequestWithContext).authUser;
    if (!user)
      return await sendApiError(
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication is required.'
      );
    const row = await accessibleScore(repository, user, req.params.id, res);
    if (!row) return;
    const parsedFormat = scoreExportQuerySchema.safeParse(req.query);
    if (!parsedFormat.success) {
      return await sendApiError(
        res,
        400,
        'VALIDATION_ERROR',
        'The export format is invalid.'
      );
    }
    const slug = filenameSlug(row.score.title);
    const headers = musicXmlExportHeadersSchema.parse({
      contentType: MUSICXML_CONTENT_TYPE,
      filename: `${slug}.musicxml`,
    });
    res.setHeader('Content-Type', headers.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${headers.filename}"`
    );
    return res.status(200).send(row.version.musicxml);
  });

  router.post('/:id/versions', async (req, res, next) => {
    const user = (req as RequestWithContext).authUser;
    if (!user)
      return await sendApiError(
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication is required.'
      );
    const row = await accessibleScore(repository, user, req.params.id, res);
    if (!row) return;
    const permissions = permissionsFor(row, user);
    if (!permissions.canEdit) {
      return await sendApiError(
        res,
        403,
        'FORBIDDEN',
        'You may not edit this score.'
      );
    }
    const parsed = createScoreVersionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return await sendApiError(
        res,
        400,
        'VALIDATION_ERROR',
        'The score version is invalid.'
      );
    }

    try {
      const current = musicXmlToModel(row.version.musicxml);
      const hasOpaqueConstructs =
        current.preservation.state === 'opaque_constructs_preserved';
      const candidate = preservedScoreModelSchema.parse({
        ...parsed.data.model,
        title: hasOpaqueConstructs ? current.model.title : row.score.title,
        composer: hasOpaqueConstructs
          ? (current.model.composer ?? null)
          : row.score.composer,
        ...(current.model.preservation
          ? { preservation: current.model.preservation }
          : {}),
      });
      const musicXml = modelToMusicXml(candidate);
      const converted = musicXmlToModel(musicXml);
      const versionId = newId();
      const now = new Date().toISOString();
      const saved = await repository.createScoreVersion(
        {
          id: versionId,
          scoreId: row.score.id,
          musicxml: musicXml,
          note: parsed.data.note || 'Edited',
          createdBy: user.id,
          createdAt: now,
        },
        now,
        user.id
      );
      if (saved.status === 'not_found') {
        return await sendApiError(
          res,
          404,
          'NOT_FOUND',
          'The score was not found.'
        );
      }
      if (saved.status === 'forbidden') {
        return await sendApiError(
          res,
          403,
          'FORBIDDEN',
          'You may no longer edit this score.'
        );
      }
      const updatedRow = await repository.findScoreRow(row.score.id, user.id);
      if (!updatedRow) {
        return await sendApiError(
          res,
          404,
          'NOT_FOUND',
          'The score was not found.'
        );
      }
      const response = createScoreVersionResponseSchema.parse({
        score: summarize(updatedRow, user, converted),
        versionId,
      });
      return res.status(201).json(response);
    } catch (error) {
      if (error instanceof MusicXmlConversionError) {
        if (error.code === 'PRESERVATION_CONTEXT_CHANGED') {
          const conversion = musicXmlToModel(row.version.musicxml);
          const body = scoreContentWriteErrorResponseSchema.parse({
            error: {
              code: 'SCORE_CONTENT_READ_ONLY',
              message:
                'This imported score contains preserved MusicXML and cannot be edited.',
              preservation: conversion.preservation,
            },
          });
          return res.status(409).json(body);
        }
        if (sendConversionFailure(res, error)) return;
      }
      return next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    const user = (req as RequestWithContext).authUser;
    if (!user)
      return await sendApiError(
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication is required.'
      );
    const row = await accessibleScore(repository, user, req.params.id, res);
    if (!row) return;
    try {
      const conversion = musicXmlToModel(row.version.musicxml);
      const versionCreator = await repository.findUserById(
        row.version.createdBy
      );
      const response = scoreDetailResponseSchema.parse({
        score: {
          ...summarize(row, user, conversion),
          currentVersionId: row.version.id,
          version: {
            id: row.version.id,
            note: row.version.note,
            createdAt: row.version.createdAt,
            createdBy: {
              id: row.version.createdBy,
              displayName:
                versionCreator?.displayName ?? row.creatorDisplayName,
            },
          },
          model: publicModel(conversion, row),
          musicXml: row.version.musicxml,
        },
      });
      return res.status(200).json(response);
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    const user = (req as RequestWithContext).authUser;
    if (!user)
      return await sendApiError(
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication is required.'
      );
    const row = await accessibleScore(repository, user, req.params.id, res);
    if (!row) return;
    const parsed = patchScoreRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return await sendApiError(
        res,
        400,
        'VALIDATION_ERROR',
        'The score update is invalid.'
      );
    }
    const permissions = permissionsFor(row, user);
    const changesContentMetadata =
      parsed.data.title !== undefined || parsed.data.composer !== undefined;
    if (changesContentMetadata && !permissions.canEdit) {
      return await sendApiError(
        res,
        403,
        'FORBIDDEN',
        'You may not edit this score metadata.'
      );
    }
    if (
      parsed.data.visibility !== undefined &&
      !permissions.canChangeVisibility
    ) {
      return await sendApiError(
        res,
        403,
        'FORBIDDEN',
        'You may not change this score visibility.'
      );
    }
    if (
      parsed.data.visibility === 'choir' &&
      !permissions.canSetChoirVisibility
    ) {
      return await sendApiError(
        res,
        403,
        'FORBIDDEN',
        'Only an admin or director may set choir visibility.'
      );
    }

    try {
      const updated = await repository.patchScore(
        req.params.id,
        {
          ...parsed.data,
          updatedAt: new Date().toISOString(),
        },
        user.id
      );
      if (updated.status === 'not_found') {
        return await sendApiError(
          res,
          404,
          'NOT_FOUND',
          'The score was not found.'
        );
      }
      if (updated.status === 'forbidden') {
        return await sendApiError(
          res,
          403,
          'FORBIDDEN',
          'You may no longer modify this score.'
        );
      }
      const updatedRow = await repository.findScoreRow(
        updated.score.id,
        user.id
      );
      if (!updatedRow) {
        return await sendApiError(
          res,
          404,
          'NOT_FOUND',
          'The score was not found.'
        );
      }
      return res
        .status(200)
        .json(
          patchScoreResponseSchema.parse({ score: summarize(updatedRow, user) })
        );
    } catch (error) {
      return next(error);
    }
  });

  router.put('/:id/access', async (req, res, next) => {
    const user = (req as RequestWithContext).authUser;
    if (!user)
      return await sendApiError(
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication is required.'
      );
    const row = await accessibleScore(repository, user, req.params.id, res);
    if (!row) return;
    if (!permissionsFor(row, user).canManageAccess) {
      return await sendApiError(
        res,
        403,
        'FORBIDDEN',
        'You may not manage access for this score.'
      );
    }
    if (row.score.visibility !== 'shared') {
      return await sendApiError(
        res,
        409,
        'SCORE_NOT_SHARED',
        'Shared access can be managed only while the score is shared.'
      );
    }
    const parsed = putScoreAccessRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return await sendApiError(
        res,
        400,
        'VALIDATION_ERROR',
        'The shared-access list is invalid.'
      );
    }
    try {
      const result = await repository.replaceScoreAccess(
        row.score.id,
        parsed.data.users,
        user.id
      );
      if (result.status === 'not_found') {
        return await sendApiError(
          res,
          404,
          'NOT_FOUND',
          'The score was not found.'
        );
      }
      if (result.status === 'not_shared') {
        return await sendApiError(
          res,
          409,
          'SCORE_NOT_SHARED',
          'Shared access can be managed only while the score is shared.'
        );
      }
      if (result.status === 'inactive_recipients') {
        return await sendApiError(
          res,
          400,
          'VALIDATION_ERROR',
          'Shared-access recipients must be active users.'
        );
      }
      if (result.status === 'forbidden') {
        return await sendApiError(
          res,
          403,
          'FORBIDDEN',
          'You may no longer manage access for this score.'
        );
      }
      return res.status(200).json(
        scoreAccessResponseSchema.parse({
          scoreId: row.score.id,
          visibility: 'shared',
          users: result.users,
        })
      );
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

async function persistNewScore(args: {
  repository: ApiRepository;
  res: Response;
  user: NonNullable<RequestWithContext['authUser']>;
  musicXml: string;
  title: string;
  composer: string | null;
  visibility: 'private' | 'choir' | 'shared';
  note: string;
  warnings: ReturnType<typeof musicXmlToModel>['warnings'];
}) {
  const scoreId = newId();
  const versionId = newId();
  const now = new Date().toISOString();
  await args.repository.createScoreWithVersion(
    {
      id: scoreId,
      title: args.title,
      composer: args.composer,
      createdBy: args.user.id,
      visibility: args.visibility,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: versionId,
      scoreId,
      musicxml: args.musicXml,
      note: args.note,
      createdBy: args.user.id,
      createdAt: now,
    }
  );
  const row = await args.repository.findScoreRow(scoreId, args.user.id);
  if (!row) throw new Error('New score could not be read after creation');
  const converted = musicXmlToModel(args.musicXml);
  const result = scoreImportResultSchema.parse({
    score: summarize(row, args.user, converted),
    versionId,
    warnings: args.warnings,
  });
  return args.res.status(201).json(result);
}

async function accessibleScore(
  repository: ApiRepository,
  user: NonNullable<RequestWithContext['authUser']>,
  id: string,
  res: Response
): Promise<ScoreRowWithVersion | null> {
  const row = await repository.findScoreRow(id, user.id);
  if (!row || !permissionsFor(row, user).canView) {
    await sendApiError(res, 404, 'NOT_FOUND', 'The score was not found.');
    return null;
  }
  return row;
}

function permissionsFor(
  row: ScoreRowWithVersion,
  user: NonNullable<RequestWithContext['authUser']>
): ScorePermissions {
  const isOwner = row.score.createdBy === user.id;
  const isPrivileged = user.role === 'admin' || user.role === 'director';
  const canView =
    isOwner ||
    isPrivileged ||
    row.score.visibility === 'choir' ||
    (row.score.visibility === 'shared' && row.hasAccess);
  const canEdit =
    isOwner ||
    isPrivileged ||
    (row.score.visibility === 'shared' && row.hasAccess && row.accessCanEdit);
  return {
    isOwner,
    canView,
    canEdit,
    canManageAccess: isOwner || isPrivileged,
    canChangeVisibility: isOwner || isPrivileged,
    canSetChoirVisibility: isPrivileged,
  };
}

function summarize(
  row: ScoreRowWithVersion,
  user: NonNullable<RequestWithContext['authUser']>,
  converted = musicXmlToModel(row.version.musicxml)
): ScoreSummary {
  const permissions = permissionsFor(row, user);
  const model = converted.model;
  const parts = scorePartSummariesFromModel(model);
  const preservation = scorePreservationFromWarnings(converted.warnings);
  const measureCount = Math.max(
    ...model.parts.map((part) => part.measures.length)
  );
  return scoreSummarySchema.parse({
    id: row.score.id,
    title: row.score.title,
    composer: row.score.composer,
    key: model.key,
    time: model.time,
    partIds: parts.map((part) => part.id),
    parts,
    partCount: parts.length,
    measureCount,
    visibility: row.score.visibility,
    creator: { id: row.score.createdBy, displayName: row.creatorDisplayName },
    createdAt: row.score.createdAt,
    updatedAt: row.score.updatedAt,
    ...permissions,
    canEditContent: permissions.canEdit && preservation.state === 'clean',
    preservation,
  });
}

function publicModel(
  converted: ReturnType<typeof musicXmlToModel>,
  row: ScoreRowWithVersion
) {
  const { preservation: _privatePreservation, ...model } = converted.model;
  return scoreModelSchema.parse({
    ...model,
    title: row.score.title,
    composer: row.score.composer,
  });
}

function sendScoreImportFailure(
  res: Response,
  status: number,
  code: string,
  message: string,
  issues?: Array<{
    code: ScoreImportValidationIssueCode;
    message: string;
    path?: string;
  }>
) {
  return res.status(status).json({
    error: {
      code: code as ScoreImportErrorCode,
      message,
      ...(issues?.length ? { issues } : {}),
    },
  });
}

function sendConversionFailure(res: Response, error: unknown): boolean {
  if (!(error instanceof MusicXmlConversionError)) return false;
  if (error.code === 'PRESERVATION_CONTEXT_CHANGED') {
    return false;
  }
  const codeMap: Record<
    Exclude<MusicXmlConversionError['code'], 'PRESERVATION_CONTEXT_CHANGED'>,
    {
      code: ScoreImportErrorCode;
      issue: ScoreImportValidationIssueCode;
      status: number;
    }
  > = {
    FILE_TOO_LARGE: {
      code: 'BODY_TOO_LARGE',
      issue: 'INVALID_SCORE',
      status: 413,
    },
    DOCTYPE_NOT_ALLOWED: {
      code: 'DOCTYPE_NOT_ALLOWED',
      issue: 'DOCTYPE_NOT_ALLOWED',
      status: 400,
    },
    MALFORMED_XML: {
      code: 'MALFORMED_XML',
      issue: 'MALFORMED_XML',
      status: 400,
    },
    XML_DEPTH_LIMIT: {
      code: 'XML_DEPTH_LIMIT',
      issue: 'XML_DEPTH_LIMIT',
      status: 400,
    },
    UNSUPPORTED_ROOT: {
      code: 'UNSUPPORTED_ROOT',
      issue: 'UNSUPPORTED_ROOT',
      status: 400,
    },
    NO_PARTS: { code: 'NO_PARTS', issue: 'NO_PARTS', status: 400 },
    INVALID_SCORE: {
      code: 'INVALID_SCORE',
      issue: 'INVALID_SCORE',
      status: 400,
    },
    SOURCE_PROVENANCE_REQUIRED: {
      code: 'INVALID_SCORE',
      issue: 'INVALID_SCORE',
      status: 400,
    },
    UNREPRESENTABLE_DURATION: {
      code: 'INVALID_SCORE',
      issue: 'INVALID_SCORE',
      status: 400,
    },
  };
  const mapped = codeMap[error.code];
  sendScoreImportFailure(res, mapped.status, mapped.code, error.message, [
    { code: mapped.issue, message: error.message },
  ]);
  return true;
}

function filenameSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'score';
}

function cursorPayload(
  userId: string,
  query: ParsedScoreListQuery,
  updatedAt: string,
  id: string
): CursorPayload {
  return {
    v: 1,
    userId,
    q: query.q ?? null,
    mine: query.mine ?? null,
    visibility: query.visibility ?? null,
    limit: query.limit,
    updatedAt,
    id,
  };
}

function encodeCursor(payload: CursorPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

function decodeCursor(
  cursor: string,
  secret: string,
  userId: string,
  query: ParsedScoreListQuery
): { updatedAt: string; id: string } | undefined {
  const [encoded, signature, extra] = cursor.split('.');
  if (!encoded || !signature || extra !== undefined) return undefined;
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]+$/.test(signature))
    return undefined;
  const expected = createHmac('sha256', secret).update(encoded).digest();
  const received = Buffer.from(signature, 'base64url');
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  )
    return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as CursorPayload;
    if (
      payload.v !== 1 ||
      payload.userId !== userId ||
      payload.q !== (query.q ?? null) ||
      payload.mine !== (query.mine ?? null) ||
      payload.visibility !== (query.visibility ?? null) ||
      payload.limit !== query.limit ||
      typeof payload.updatedAt !== 'string' ||
      typeof payload.id !== 'string'
    ) {
      return undefined;
    }
    if (Buffer.from(JSON.stringify(payload)).toString('base64url') !== encoded)
      return undefined;
    return { updatedAt: payload.updatedAt, id: payload.id };
  } catch {
    return undefined;
  }
}
