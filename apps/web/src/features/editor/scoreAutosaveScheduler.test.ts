import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateScoreAutosaveResponse,
  ScoreDetail,
  ScoreModel,
} from '@choirscore/shared';
import { ApiError } from '../../lib/apiClient';
import { scoreDetailResponse } from '../../test/scoreFixtures';
import {
  ScoreAutosaveScheduler,
  type ScoreAutosaveSchedulerDependencies,
  type ScoreAutosaveSchedulerInput,
} from './scoreAutosaveScheduler';

const originalModel = structuredClone(scoreDetailResponse.score.model);
const scoreId = 'score-1';

function changedModel(tempo: number): ScoreModel {
  return { ...structuredClone(originalModel), tempo };
}

function response(
  currentVersionId: string,
  outcome: CreateScoreAutosaveResponse['outcome'] = 'saved'
): CreateScoreAutosaveResponse {
  return {
    score: scoreDetailResponse.score,
    versionId: `request-version-${currentVersionId}`,
    currentVersionId,
    outcome,
  };
}

function detail(currentVersionId: string, model: ScoreModel): ScoreDetail {
  return {
    ...scoreDetailResponse.score,
    currentVersionId,
    version: {
      ...scoreDetailResponse.score.version,
      id: currentVersionId,
    },
    model,
  };
}

function input(overrides: Partial<ScoreAutosaveSchedulerInput> = {}) {
  return {
    scoreId,
    canEditContent: true,
    currentVersionId: 'version-1',
    model: changedModel(100),
    persistedModel: originalModel,
    ...overrides,
  } satisfies ScoreAutosaveSchedulerInput;
}

function makeScheduler(
  overrides: Partial<ScoreAutosaveSchedulerDependencies> = {},
  initialInput: ScoreAutosaveSchedulerInput = input()
) {
  let nextId = 0;
  const dependencies: ScoreAutosaveSchedulerDependencies = {
    save: vi.fn(async () => response('version-2')),
    loadLatest: vi.fn(async () => detail('version-latest', changedModel(98))),
    createRequestId: () => `request-${++nextId}`,
    debounceMs: 30_000,
    retryDelayMs: 5_000,
    ...overrides,
  };
  const scheduler = new ScoreAutosaveScheduler(dependencies);
  scheduler.activate();
  scheduler.update(initialInput);
  return { scheduler, dependencies };
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ScoreAutosaveScheduler', () => {
  it('waits 29 seconds and saves at 30 seconds with the shared request contract', async () => {
    const { scheduler, dependencies } = makeScheduler();

    await advance(29_000);
    expect(dependencies.save).not.toHaveBeenCalled();
    await advance(1_000);

    expect(dependencies.save).toHaveBeenCalledTimes(1);
    const [requestedScoreId, request] = vi.mocked(dependencies.save).mock
      .calls[0]!;
    expect(requestedScoreId).toBe(scoreId);
    expect(request).toMatchObject({
      model: changedModel(100),
      baseVersionId: 'version-1',
      requestId: 'request-1',
    });
    expect(scheduler.getState().currentVersionId).toBe('version-2');
    scheduler.dispose();
  });

  it('saves an edit at 29 seconds on the first cadence tick after a clean start', async () => {
    const cleanInput = input({ model: originalModel });
    const { scheduler, dependencies } = makeScheduler({}, cleanInput);

    await advance(29_000);
    expect(dependencies.save).not.toHaveBeenCalled();
    scheduler.update(input({ model: changedModel(101) }));
    await advance(999);
    expect(dependencies.save).not.toHaveBeenCalled();
    await advance(1);

    expect(dependencies.save).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dependencies.save).mock.calls[0]?.[1].model).toEqual(
      changedModel(101)
    );
    scheduler.dispose();
  });

  it('captures an edit at 29 seconds on the existing 30-second tick', async () => {
    const { scheduler, dependencies } = makeScheduler();

    await advance(29_000);
    scheduler.update(input({ model: changedModel(101) }));
    await advance(999);
    expect(dependencies.save).not.toHaveBeenCalled();
    await advance(1);

    expect(dependencies.save).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dependencies.save).mock.calls[0]?.[1].model).toEqual(
      changedModel(101)
    );
    scheduler.dispose();
  });

  it('uses currentVersionId as the next base and saves the next dirty snapshot on the following 30-second tick', async () => {
    const { scheduler, dependencies } = makeScheduler();

    await advance(30_000);
    expect(dependencies.save).toHaveBeenCalledTimes(1);
    scheduler.update(input({ model: changedModel(102) }));
    await advance(29_000);
    expect(dependencies.save).toHaveBeenCalledTimes(1);
    await advance(1_000);

    expect(dependencies.save).toHaveBeenCalledTimes(2);
    expect(vi.mocked(dependencies.save).mock.calls[1]?.[1]).toMatchObject({
      model: changedModel(102),
      baseVersionId: 'version-2',
      requestId: 'request-2',
    });
    scheduler.dispose();
  });

  it('suppresses unchanged/no-op models and cancels a debounce when edits revert', async () => {
    const { scheduler, dependencies } = makeScheduler({
      save: vi.fn(async () => response('version-1', 'unchanged')),
    });
    scheduler.update(input({ model: originalModel }));
    await advance(60_000);
    expect(dependencies.save).not.toHaveBeenCalled();

    scheduler.update(input({ model: changedModel(100) }));
    await advance(29_000);
    scheduler.update(input({ model: originalModel }));
    await advance(31_000);
    expect(dependencies.save).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  it('keeps requestId and the exact request body stable across transient retries', async () => {
    const save = vi
      .fn<ScoreAutosaveSchedulerDependencies['save']>()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValue(response('version-2'));
    const { scheduler, dependencies } = makeScheduler({ save });

    await advance(30_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(scheduler.getState().status).toBe('retrying');
    await advance(4_999);
    expect(save).toHaveBeenCalledTimes(1);
    await advance(1);

    expect(save).toHaveBeenCalledTimes(2);
    const firstBody = JSON.stringify(save.mock.calls[0]?.[1]);
    const secondBody = JSON.stringify(save.mock.calls[1]?.[1]);
    expect(secondBody).toBe(firstBody);
    expect(save.mock.calls[1]?.[1].requestId).toBe('request-1');
    scheduler.dispose();
    expect(dependencies.loadLatest).not.toHaveBeenCalled();
  });

  it('settles an uncertain retry before autosaving a later revert', async () => {
    const save = vi
      .fn<ScoreAutosaveSchedulerDependencies['save']>()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(response('version-2'))
      .mockResolvedValue(response('version-3'));
    const { scheduler } = makeScheduler({ save });

    await advance(30_000);
    scheduler.update(input({ model: originalModel }));
    await advance(5_000);

    expect(save).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(save.mock.calls[1]?.[1])).toBe(
      JSON.stringify(save.mock.calls[0]?.[1])
    );
    await advance(24_999);
    expect(save).toHaveBeenCalledTimes(2);
    await advance(1);

    expect(save).toHaveBeenCalledTimes(3);
    expect(save.mock.calls[2]?.[1]).toMatchObject({
      model: originalModel,
      baseVersionId: 'version-2',
      requestId: 'request-2',
    });
    scheduler.dispose();
  });

  it('preserves stale local work on 409 and only saves after an explicit rebase decision', async () => {
    const save = vi
      .fn<ScoreAutosaveSchedulerDependencies['save']>()
      .mockRejectedValueOnce(
        new ApiError(409, {
          code: 'VERSION_CONFLICT',
          message: 'The score version changed.',
        })
      )
      .mockResolvedValue(response('version-after-rebase'));
    const latest = detail('version-remote', changedModel(98));
    const loadLatest = vi.fn(async () => latest);
    const onDraftChange = vi.fn();
    const { scheduler } = makeScheduler({ save, loadLatest, onDraftChange });

    await advance(30_000);
    expect(scheduler.getState().status).toBe('conflict');
    expect(scheduler.getState().currentVersionId).toBe('version-remote');
    expect(scheduler.getState().conflict).toEqual({
      latestModel: changedModel(98),
      latestVersionId: 'version-remote',
      localDraft: changedModel(100),
    });
    await advance(60_000);
    expect(save).toHaveBeenCalledTimes(1);

    expect(scheduler.resolveConflict(changedModel(101))).toBe(true);
    expect(onDraftChange).toHaveBeenCalledWith(changedModel(101));
    await advance(30_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[1]).toMatchObject({
      model: changedModel(101),
      baseVersionId: 'version-remote',
      requestId: 'request-2',
    });
    scheduler.dispose();
  });

  it('does not send while read-only or when the model fails shared validation', async () => {
    const readOnly = makeScheduler();
    readOnly.scheduler.update(input({ canEditContent: false }));
    await advance(60_000);
    expect(readOnly.dependencies.save).not.toHaveBeenCalled();
    expect(readOnly.scheduler.getState().status).toBe('read-only');
    readOnly.scheduler.dispose();

    const invalid = makeScheduler();
    invalid.scheduler.update(
      input({ model: { ...changedModel(100), title: '' } })
    );
    await advance(60_000);
    expect(invalid.dependencies.save).not.toHaveBeenCalled();
    expect(invalid.scheduler.getState().status).toBe('invalid');
    invalid.scheduler.dispose();
  });

  it('cancels its debounce on unmount and drops completion from an abandoned request', async () => {
    const neverSettled: {
      resolve?: (value: CreateScoreAutosaveResponse) => void;
    } = {};
    const save = vi.fn(
      () =>
        new Promise<CreateScoreAutosaveResponse>((resolve) => {
          neverSettled.resolve = resolve;
        })
    );
    const { scheduler } = makeScheduler({ save });
    await advance(30_000);
    expect(save).toHaveBeenCalledTimes(1);
    const beforeUnmount = scheduler.getState();
    scheduler.dispose();
    neverSettled.resolve?.(response('version-after-unmount'));
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduler.getState()).toBe(beforeUnmount);
    await advance(60_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('serializes overlapping edits and starts the latest snapshot after the first save settles', async () => {
    let finishFirst: ((value: CreateScoreAutosaveResponse) => void) | undefined;
    const save = vi
      .fn<ScoreAutosaveSchedulerDependencies['save']>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          })
      )
      .mockResolvedValue(response('version-3'));
    const { scheduler } = makeScheduler({ save });

    await advance(30_000);
    expect(save).toHaveBeenCalledTimes(1);
    scheduler.update(input({ model: changedModel(103) }));
    await advance(30_000);
    expect(save).toHaveBeenCalledTimes(1);

    finishFirst?.(response('version-2'));
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[1]).toMatchObject({
      model: changedModel(103),
      baseVersionId: 'version-2',
    });
    scheduler.dispose();
  });

  it('does not start a duplicate POST when retryNow is called during an in-flight save', async () => {
    let finishFirst: ((value: CreateScoreAutosaveResponse) => void) | undefined;
    const save = vi.fn<ScoreAutosaveSchedulerDependencies['save']>(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        })
    );
    const { scheduler } = makeScheduler({ save });

    await advance(30_000);
    expect(save).toHaveBeenCalledTimes(1);
    const firstSignal = save.mock.calls[0]?.[2];
    scheduler.retryNow();

    expect(save).toHaveBeenCalledTimes(1);
    expect(firstSignal?.aborted).toBe(false);
    finishFirst?.(response('version-2'));
    await Promise.resolve();
    await Promise.resolve();

    expect(save).toHaveBeenCalledTimes(1);
    expect(firstSignal?.aborted).toBe(false);
    scheduler.dispose();
  });

  it('keeps SCORE_CONTENT_READ_ONLY blocked after edits and manual retry', async () => {
    const save = vi
      .fn<ScoreAutosaveSchedulerDependencies['save']>()
      .mockRejectedValueOnce(
        new ApiError(403, {
          code: 'SCORE_CONTENT_READ_ONLY',
          message: 'Score content is read-only.',
        })
      )
      .mockResolvedValue(response('version-2'));
    const { scheduler } = makeScheduler({ save });

    await advance(30_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(scheduler.getState().status).toBe('read-only');

    scheduler.update(input({ model: changedModel(101), canEditContent: true }));
    scheduler.retryNow();
    await advance(60_000);

    expect(save).toHaveBeenCalledTimes(1);
    expect(scheduler.getState().status).toBe('read-only');
    scheduler.dispose();
  });
});
