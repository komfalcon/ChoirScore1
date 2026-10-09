import { useEffect, useRef, useState } from 'react';
import type { ScoreDetail, ScoreModel } from '@choirscore/shared';
import { createScoreAutosave, getScoreDetail } from '../../lib/scoreApi';
import {
  ScoreAutosaveScheduler,
  type ScoreAutosaveSchedulerDependencies,
  type ScoreAutosaveSchedulerInput,
  type ScoreAutosaveSchedulerState,
} from './scoreAutosaveScheduler';

export type UseScoreAutosaveOptions = ScoreAutosaveSchedulerInput & {
  onDraftChange?: (model: ScoreModel) => void;
  /** Overrides the production API call for isolated tests or specialized clients. */
  save?: ScoreAutosaveSchedulerDependencies['save'];
  /** Overrides latest-detail reload used only after VERSION_CONFLICT. */
  loadLatest?: ScoreAutosaveSchedulerDependencies['loadLatest'];
  createRequestId?: () => string;
  debounceMs?: number;
  retryDelayMs?: number;
  now?: () => number;
};

export type UseScoreAutosaveResult = ScoreAutosaveSchedulerState & {
  /** Call only after presenting/reconciling the latest model in a conflict. */
  resolveConflict: (rebasedDraft?: unknown) => boolean;
  /** Explicitly replace the draft and invalidate any pending autosave request. */
  resetDraft: (model: unknown) => boolean;
  /** Retry a transient failure or reload a conflict whose detail fetch failed. */
  retryNow: () => void;
};

/**
 * Reusable client autosave hook mounted by the edit route after a score model
 * is loaded; the scheduler remains owned by that editor session.
 */
export function useScoreAutosave(
  options: UseScoreAutosaveOptions
): UseScoreAutosaveResult {
  const latestOptions = useRef(options);
  latestOptions.current = options;
  const schedulerRef = useRef<ScoreAutosaveScheduler | null>(null);
  if (!schedulerRef.current) {
    schedulerRef.current = new ScoreAutosaveScheduler({
      save: (scoreId, request, signal) => {
        const save = latestOptions.current.save ?? createScoreAutosave;
        return save(scoreId, request, signal);
      },
      loadLatest: async (scoreId, signal): Promise<ScoreDetail> => {
        const loader = latestOptions.current.loadLatest;
        if (loader) return loader(scoreId, signal);
        const result = await getScoreDetail(scoreId, signal);
        return result.score;
      },
      onDraftChange: (model) => latestOptions.current.onDraftChange?.(model),
      createRequestId: () =>
        latestOptions.current.createRequestId?.() ??
        globalThis.crypto?.randomUUID?.().replaceAll('-', '') ??
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      debounceMs: options.debounceMs,
      retryDelayMs: options.retryDelayMs,
      now: options.now,
    });
  }

  const scheduler = schedulerRef.current;
  const [state, setState] = useState<ScoreAutosaveSchedulerState>(
    scheduler.getState()
  );

  useEffect(() => {
    const unsubscribe = scheduler.subscribe(setState);
    scheduler.activate();
    return () => {
      unsubscribe();
      scheduler.dispose();
    };
  }, [scheduler]);

  useEffect(() => {
    scheduler.update({
      scoreId: options.scoreId,
      canEditContent: options.canEditContent,
      currentVersionId: options.currentVersionId,
      model: options.model,
      persistedModel: options.persistedModel,
    });
  }, [
    scheduler,
    options.scoreId,
    options.canEditContent,
    options.currentVersionId,
    options.model,
    options.persistedModel,
  ]);

  return {
    ...state,
    resolveConflict: (rebasedDraft?: unknown) =>
      scheduler.resolveConflict(rebasedDraft),
    resetDraft: (model: unknown) => scheduler.resetDraft(model),
    retryNow: () => scheduler.retryNow(),
  };
}
