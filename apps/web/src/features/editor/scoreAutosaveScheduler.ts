import {
  createScoreAutosaveRequestSchema,
  scoreModelSchema,
  type CreateScoreAutosaveRequest,
  type CreateScoreAutosaveResponse,
  type ScoreDetail,
  type ScoreModel,
} from '@choirscore/shared';
import { ApiError } from '../../lib/apiClient';

export type ScoreAutosaveStatus =
  | 'idle'
  | 'scheduled'
  | 'saving'
  | 'retrying'
  | 'conflict'
  | 'invalid'
  | 'read-only'
  | 'error';

export type ScoreAutosaveConflict = {
  /** Latest server model/version; null when a conflict refresh could not load. */
  latestModel: ScoreModel | null;
  latestVersionId: string | null;
  /** The local draft is retained verbatim until the caller resolves the conflict. */
  localDraft: ScoreModel;
};

export type ScoreAutosaveSchedulerState = {
  status: ScoreAutosaveStatus;
  currentVersionId: string | null;
  lastSavedAt: number | null;
  error: unknown | null;
  conflict: ScoreAutosaveConflict | null;
};

export type ScoreAutosaveSchedulerInput = {
  scoreId: string | null;
  canEditContent: boolean;
  currentVersionId: string | null;
  /** Current editor draft, parsed locally against the shared ScoreModel schema. */
  model: unknown;
  /** Model corresponding to the currentVersionId prop (e.g. after explicit Save). */
  persistedModel: unknown;
};

export type ScoreAutosaveSchedulerDependencies = {
  save: (
    scoreId: string,
    request: CreateScoreAutosaveRequest,
    signal: AbortSignal
  ) => Promise<CreateScoreAutosaveResponse>;
  loadLatest: (scoreId: string, signal: AbortSignal) => Promise<ScoreDetail>;
  onDraftChange?: (model: ScoreModel) => void;
  createRequestId?: () => string;
  debounceMs?: number;
  retryDelayMs?: number;
  now?: () => number;
};

type ValidModel = { model: ScoreModel; signature: string };
type PendingOperation = {
  scoreId: string;
  request: CreateScoreAutosaveRequest;
  modelSignature: string;
  controller: AbortController | null;
  attempt: number;
};

const DEFAULT_DEBOUNCE_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 5_000;

function parseModel(value: unknown): ValidModel | null {
  const result = scoreModelSchema.safeParse(value);
  if (!result.success) return null;
  return { model: result.data, signature: JSON.stringify(result.data) };
}

function makeRequestId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid.replaceAll('-', '');
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

/**
 * Framework-agnostic M5 autosave state machine. One instance belongs to one
 * editor session; the React hook owns its lifetime and supplies editor inputs.
 */
export class ScoreAutosaveScheduler {
  private readonly debounceMs: number;
  private readonly retryDelayMs: number;
  private readonly now: () => number;
  private listener: ((state: ScoreAutosaveSchedulerState) => void) | null =
    null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private input: ScoreAutosaveSchedulerInput | null = null;
  private scoreId: string | null = null;
  private currentVersionId: string | null = null;
  private lastExternalVersionId: string | null = null;
  private baseline: ValidModel | null = null;
  private draft: ValidModel | null = null;
  private lastObservedDraftSignature: string | null = null;
  private nextSaveAt = 0;
  private pending: PendingOperation | null = null;
  private activeController: AbortController | null = null;
  private conflict: ScoreAutosaveConflict | null = null;
  private conflictLoading = false;
  private blockedAfterError = false;
  private contentReadOnlyBlocked = false;
  private contentReadOnlyError: unknown | null = null;
  private active = false;
  private disposed = false;
  private generation = 0;
  private state: ScoreAutosaveSchedulerState = {
    status: 'idle',
    currentVersionId: null,
    lastSavedAt: null,
    error: null,
    conflict: null,
  };

  constructor(
    private readonly dependencies: ScoreAutosaveSchedulerDependencies
  ) {
    this.debounceMs = dependencies.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.retryDelayMs = dependencies.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.now = dependencies.now ?? Date.now;
  }

  getState(): ScoreAutosaveSchedulerState {
    return this.state;
  }

  subscribe(
    listener: (state: ScoreAutosaveSchedulerState) => void
  ): () => void {
    this.listener = listener;
    listener(this.state);
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  activate(): void {
    this.disposed = false;
    this.active = true;
    this.reconcile();
  }

  update(input: ScoreAutosaveSchedulerInput): void {
    const previousDraft = this.draft;
    const wasDirty = !!(
      previousDraft &&
      this.baseline &&
      previousDraft.signature !== this.baseline.signature
    );
    const wasBlockedAfterError = this.blockedAfterError;
    const oldScoreId = this.scoreId;
    const scoreChanged = oldScoreId !== input.scoreId;
    const externalVersionChanged =
      !scoreChanged && input.currentVersionId !== this.lastExternalVersionId;

    this.input = input;
    if (scoreChanged) {
      this.resetSession(input);
    } else if (externalVersionChanged) {
      this.resetForExternalVersion(input);
    }

    this.draft = parseModel(input.model);
    if (this.draft?.signature !== this.lastObservedDraftSignature) {
      this.lastObservedDraftSignature = this.draft?.signature ?? null;
      const isDirty = !!(
        this.draft &&
        this.baseline &&
        this.draft.signature !== this.baseline.signature
      );
      if (wasBlockedAfterError || !isDirty) {
        this.nextSaveAt = this.now() + this.debounceMs;
      } else if (
        !wasDirty &&
        !this.pending &&
        !this.activeController &&
        this.now() >= this.nextSaveAt
      ) {
        this.nextSaveAt = this.now() + this.debounceMs;
      }
      this.blockedAfterError = false;
    }

    if (this.conflict && this.draft) {
      this.conflict = { ...this.conflict, localDraft: this.draft.model };
      this.setState({ conflict: this.conflict });
    }

    if ((!input.canEditContent || !input.scoreId) && this.activeController) {
      this.activeController.abort();
      this.activeController = null;
      if (this.pending) this.pending.controller = null;
    }

    this.reconcile();
  }

  /**
   * Explicitly accepts a rebase decision. Until this is called, stale drafts
   * remain visible in `conflict` and are never silently resubmitted.
   */
  resolveConflict(rebasedDraft?: unknown): boolean {
    const conflict = this.conflict;
    if (!conflict?.latestModel || !conflict.latestVersionId) return false;

    const chosen = parseModel(
      rebasedDraft ?? this.draft?.model ?? conflict.localDraft
    );
    if (!chosen) {
      this.setState({ status: 'invalid', error: null });
      return false;
    }

    this.currentVersionId = conflict.latestVersionId;
    this.baseline = parseModel(conflict.latestModel);
    this.draft = chosen;
    this.lastObservedDraftSignature = chosen.signature;
    this.nextSaveAt = this.now() + this.debounceMs;
    this.conflict = null;
    this.conflictLoading = false;
    this.blockedAfterError = false;
    this.dependencies.onDraftChange?.(chosen.model);
    this.setState({
      currentVersionId: this.currentVersionId,
      conflict: null,
      error: null,
    });
    this.reconcile();
    return true;
  }

  /**
   * Replace the editor draft after an explicit reset. Any pending write is
   * invalidated so an old draft cannot be retried; because an aborted request
   * may already have reached the server, refresh and require the caller's
   * normal explicit rebase decision before writing the reset draft.
   */
  resetDraft(model: unknown): boolean {
    if (
      !this.active ||
      this.disposed ||
      !this.input?.canEditContent ||
      !this.input.scoreId ||
      this.contentReadOnlyBlocked ||
      this.conflict ||
      this.conflictLoading
    ) {
      return false;
    }

    const chosen = parseModel(model);
    if (!chosen) {
      this.setState({ status: 'invalid', error: null });
      return false;
    }

    const hadPendingOperation = this.pending !== null;
    this.generation += 1;
    this.clearTimer();
    this.activeController?.abort();
    this.activeController = null;
    if (this.pending) this.pending.controller = null;
    this.pending = null;
    this.draft = chosen;
    this.input = { ...this.input, model: chosen.model };
    this.lastObservedDraftSignature = chosen.signature;
    this.nextSaveAt = this.now() + this.debounceMs;
    this.blockedAfterError = false;
    this.dependencies.onDraftChange?.(chosen.model);

    if (hadPendingOperation) {
      this.conflictLoading = true;
      this.conflict = {
        latestModel: null,
        latestVersionId: null,
        localDraft: chosen.model,
      };
      this.setState({
        status: 'conflict',
        currentVersionId: this.currentVersionId,
        conflict: this.conflict,
        error: null,
      });
      void this.refreshConflict(this.generation);
      return true;
    }

    this.reconcile();
    return true;
  }

  /** Retry a transient failure now, or refresh a conflict whose detail load failed. */
  retryNow(): void {
    if (!this.active || this.disposed) return;
    if (this.contentReadOnlyBlocked) return;
    this.blockedAfterError = false;
    if (this.conflict && !this.conflict.latestModel) {
      if (this.conflictLoading) return;
      void this.refreshConflict(this.generation);
      return;
    }
    if (this.pending) {
      if (
        this.pending.controller &&
        this.activeController === this.pending.controller &&
        !this.pending.controller.signal.aborted
      ) {
        return;
      }
      this.clearTimer();
      void this.send(this.pending, this.generation);
      return;
    }
    this.nextSaveAt = this.now();
    this.reconcile();
  }

  dispose(): void {
    this.active = false;
    this.disposed = true;
    this.generation += 1;
    this.clearTimer();
    this.activeController?.abort();
    this.activeController = null;
    if (this.pending) this.pending.controller = null;
    this.listener = null;
  }

  private resetSession(input: ScoreAutosaveSchedulerInput): void {
    this.generation += 1;
    this.clearTimer();
    this.activeController?.abort();
    this.activeController = null;
    this.pending = null;
    this.scoreId = input.scoreId;
    this.currentVersionId = input.currentVersionId;
    this.lastExternalVersionId = input.currentVersionId;
    this.baseline = parseModel(input.persistedModel);
    this.draft = parseModel(input.model);
    this.lastObservedDraftSignature = this.draft?.signature ?? null;
    this.nextSaveAt = this.now() + this.debounceMs;
    this.conflict = null;
    this.conflictLoading = false;
    this.blockedAfterError = false;
    this.contentReadOnlyBlocked = false;
    this.contentReadOnlyError = null;
    this.setState({
      status: 'idle',
      currentVersionId: this.currentVersionId,
      lastSavedAt: null,
      error: null,
      conflict: null,
    });
  }

  private resetForExternalVersion(input: ScoreAutosaveSchedulerInput): void {
    this.generation += 1;
    this.clearTimer();
    this.activeController?.abort();
    this.activeController = null;
    this.pending = null;
    this.currentVersionId = input.currentVersionId;
    this.lastExternalVersionId = input.currentVersionId;
    this.baseline = parseModel(input.persistedModel);
    this.nextSaveAt = this.now() + this.debounceMs;
    this.conflict = null;
    this.conflictLoading = false;
    this.blockedAfterError = false;
    this.setState({
      status: 'idle',
      currentVersionId: this.currentVersionId,
      error: null,
      conflict: null,
    });
  }

  private reconcile(): void {
    if (!this.active || this.disposed || !this.input) return;
    if (this.conflict || this.conflictLoading) {
      this.clearTimer();
      this.setState({ status: 'conflict', conflict: this.conflict });
      return;
    }
    if (this.contentReadOnlyBlocked) {
      this.clearTimer();
      this.setState({
        status: 'read-only',
        error: this.contentReadOnlyError,
      });
      return;
    }
    if (!this.input.canEditContent || !this.input.scoreId) {
      this.clearTimer();
      this.setState({ status: 'read-only' });
      return;
    }
    if (!this.draft || !this.baseline || !this.currentVersionId) {
      this.clearTimer();
      this.setState({ status: 'invalid' });
      return;
    }
    if (this.pending) {
      if (this.activeController) {
        this.clearTimer();
        this.setState({ status: 'saving' });
        return;
      }
      if (this.timer) return;
      this.setState({ status: 'retrying' });
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.pending) void this.send(this.pending, this.generation);
      }, this.retryDelayMs);
      return;
    }
    if (this.draft.signature === this.baseline.signature) {
      this.clearTimer();
      this.setState({ status: 'idle', error: null });
      return;
    }
    if (this.blockedAfterError) {
      this.clearTimer();
      return;
    }
    if (this.activeController) {
      this.clearTimer();
      this.setState({ status: 'saving' });
      return;
    }

    const remaining = Math.max(0, this.nextSaveAt - this.now());
    this.clearTimer();
    if (remaining === 0) {
      void this.startSave();
      return;
    }
    this.setState({ status: 'scheduled', error: null });
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.startSave();
    }, remaining);
  }

  private async startSave(): Promise<void> {
    if (!this.active || this.disposed) return;
    if (!this.input || !this.input.scoreId || !this.draft) return;
    if (
      !this.input.canEditContent ||
      !this.baseline ||
      !this.currentVersionId
    ) {
      this.reconcile();
      return;
    }
    if (this.draft.signature === this.baseline.signature) {
      this.reconcile();
      return;
    }

    const request = createScoreAutosaveRequestSchema.safeParse({
      model: this.draft.model,
      baseVersionId: this.currentVersionId,
      requestId: this.dependencies.createRequestId?.() ?? makeRequestId(),
    });
    if (!request.success) {
      this.setState({ status: 'invalid' });
      return;
    }
    this.nextSaveAt = this.now() + this.debounceMs;
    const operation: PendingOperation = {
      scoreId: this.input.scoreId,
      request: request.data,
      modelSignature: this.draft.signature,
      controller: null,
      attempt: 0,
    };
    this.pending = operation;
    await this.send(operation, this.generation);
  }

  private async send(
    operation: PendingOperation,
    generation: number
  ): Promise<void> {
    if (
      !this.active ||
      this.disposed ||
      generation !== this.generation ||
      this.pending !== operation ||
      !this.input?.canEditContent
    ) {
      return;
    }

    this.clearTimer();
    const controller = new AbortController();
    operation.controller = controller;
    this.activeController = controller;
    operation.attempt += 1;
    this.setState({ status: 'saving', error: null });
    try {
      const response = await this.dependencies.save(
        operation.scoreId,
        operation.request,
        controller.signal
      );
      if (!this.isCurrentOperation(operation, controller, generation)) return;

      this.pending = null;
      this.activeController = null;
      this.currentVersionId = response.currentVersionId;
      this.baseline = parseModel(operation.request.model);
      this.blockedAfterError = false;
      this.setState({
        status: 'idle',
        currentVersionId: this.currentVersionId,
        lastSavedAt: this.now(),
        error: null,
      });
      this.reconcile();
    } catch (error) {
      if (!this.isCurrentOperation(operation, controller, generation)) return;
      this.activeController = null;
      operation.controller = null;
      if (
        error instanceof ApiError &&
        error.code === 'SCORE_CONTENT_READ_ONLY'
      ) {
        this.pending = null;
        this.contentReadOnlyBlocked = true;
        this.contentReadOnlyError = error;
        this.blockedAfterError = true;
        this.clearTimer();
        this.setState({ status: 'read-only', error });
        return;
      }
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code === 'VERSION_CONFLICT'
      ) {
        this.pending = null;
        this.conflictLoading = true;
        const localDraft = this.draft?.model ?? operation.request.model;
        this.conflict = {
          latestModel: null,
          latestVersionId: null,
          localDraft,
        };
        this.setState({
          status: 'conflict',
          conflict: this.conflict,
          error: null,
        });
        await this.refreshConflict(generation);
        return;
      }
      if (isRetryable(error)) {
        this.setState({ status: 'retrying', error });
        this.timer = setTimeout(() => {
          this.timer = null;
          if (this.pending === operation) void this.send(operation, generation);
        }, this.retryDelayMs);
        return;
      }
      this.pending = null;
      this.blockedAfterError = true;
      this.setState({ status: 'error', error });
    }
  }

  private async refreshConflict(generation: number): Promise<void> {
    const scoreId = this.scoreId;
    if (!scoreId || !this.conflict || !this.active || this.disposed) return;
    this.activeController?.abort();
    const controller = new AbortController();
    this.activeController = controller;
    this.conflictLoading = true;
    this.setState({ status: 'conflict', error: null });
    try {
      const latest = await this.dependencies.loadLatest(
        scoreId,
        controller.signal
      );
      if (
        this.disposed ||
        generation !== this.generation ||
        this.activeController !== controller ||
        !this.conflict
      ) {
        return;
      }
      const latestModel = parseModel(latest.model);
      if (!latestModel) throw new Error('The latest score model is invalid.');
      this.activeController = null;
      this.conflictLoading = false;
      this.currentVersionId = latest.currentVersionId;
      this.baseline = latestModel;
      this.conflict = {
        latestModel: latestModel.model,
        latestVersionId: latest.currentVersionId,
        localDraft: this.draft?.model ?? this.conflict.localDraft,
      };
      this.setState({
        status: 'conflict',
        currentVersionId: this.currentVersionId,
        conflict: this.conflict,
        error: null,
      });
    } catch (error) {
      if (
        this.disposed ||
        generation !== this.generation ||
        this.activeController !== controller
      ) {
        return;
      }
      this.activeController = null;
      this.conflictLoading = false;
      this.setState({ status: 'conflict', error });
    }
  }

  private isCurrentOperation(
    operation: PendingOperation,
    controller: AbortController,
    generation: number
  ): boolean {
    return (
      !this.disposed &&
      this.active &&
      generation === this.generation &&
      this.pending === operation &&
      this.activeController === controller &&
      !controller.signal.aborted
    );
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private setState(patch: Partial<ScoreAutosaveSchedulerState>): void {
    const next = { ...this.state, ...patch };
    if (
      next.status === this.state.status &&
      next.currentVersionId === this.state.currentVersionId &&
      next.lastSavedAt === this.state.lastSavedAt &&
      next.error === this.state.error &&
      next.conflict === this.state.conflict
    ) {
      return;
    }
    this.state = next;
    this.listener?.(next);
  }
}
