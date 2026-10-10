import { useSyncExternalStore } from 'react';
import type { ScoreModel } from '@choirscore/shared';
import type { SolfaGridSelection } from './solfaGridModel';

export type SolfaTextCursor = {
  start: number;
  end: number;
};

export type SolfaEditorSessionSnapshot = {
  undoCount: number;
  redoCount: number;
  positionRevision: number;
  gridSelection: SolfaGridSelection | null;
  textCursor: SolfaTextCursor | null;
};

type EditorPosition = {
  gridSelection?: SolfaGridSelection | null;
  textCursor?: SolfaTextCursor | null;
};

type HistorySnapshot = {
  model: ScoreModel;
  gridSelection: SolfaGridSelection | null;
  textCursor: SolfaTextCursor | null;
};

type HistoryTransition = {
  before: HistorySnapshot;
  after: HistorySnapshot;
};

const EMPTY_SNAPSHOT: SolfaEditorSessionSnapshot = {
  undoCount: 0,
  redoCount: 0,
  positionRevision: 0,
  gridSelection: null,
  textCursor: null,
};

const noSubscribe = () => () => undefined;
const getEmptySnapshot = () => EMPTY_SNAPSHOT;

/**
 * Parent-owned, in-memory history shared by Sol-fa Grid and Text.
 * The score model remains controlled by the parent; edits are recorded here
 * before the editor publishes the accepted model through its onChange callback.
 */
export class SolfaEditorSession {
  private readonly listeners = new Set<() => void>();
  private readonly undoStack: HistoryTransition[] = [];
  private readonly redoStack: HistoryTransition[] = [];
  private positionRevision = 0;
  private gridSelection: SolfaGridSelection | null = null;
  private textCursor: SolfaTextCursor | null = null;
  private snapshot: SolfaEditorSessionSnapshot = EMPTY_SNAPSHOT;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = () => this.snapshot;

  /** Record an accepted model transition. Invalid drafts must never call this. */
  recordEdit(
    previous: ScoreModel,
    next: ScoreModel,
    afterPosition: EditorPosition = {}
  ): boolean {
    if (JSON.stringify(previous) === JSON.stringify(next)) return false;
    const before = this.capture(previous);
    const after = this.capture(next, afterPosition);
    this.undoStack.push({ before, after });
    this.redoStack.length = 0;
    this.gridSelection = after.gridSelection
      ? { ...after.gridSelection }
      : null;
    this.textCursor = after.textCursor ? { ...after.textCursor } : null;
    this.publish();
    return true;
  }

  undo(_current: ScoreModel): ScoreModel | null {
    const transition = this.undoStack.pop();
    if (!transition) return null;
    this.redoStack.push(transition);
    this.restore(transition.before);
    this.publish();
    return transition.before.model;
  }

  redo(_current: ScoreModel): ScoreModel | null {
    const transition = this.redoStack.pop();
    if (!transition) return null;
    this.undoStack.push(transition);
    this.restore(transition.after);
    this.publish();
    return transition.after.model;
  }

  /** Save Grid's positional address so it can be restored after a mode switch. */
  rememberGridSelection(selection: SolfaGridSelection | null): void {
    if (JSON.stringify(this.gridSelection) === JSON.stringify(selection))
      return;
    this.gridSelection = selection ? { ...selection } : null;
    this.publish();
  }

  /** Save Text's native textarea selection for later undo/redo restoration. */
  rememberTextCursor(cursor: SolfaTextCursor | null): void {
    if (JSON.stringify(this.textCursor) === JSON.stringify(cursor)) return;
    this.textCursor = cursor ? { ...cursor } : null;
    this.publish();
  }

  /** Clear history and mode positions when the parent loads a different score. */
  reset(): void {
    if (
      this.undoStack.length === 0 &&
      this.redoStack.length === 0 &&
      this.gridSelection === null &&
      this.textCursor === null
    )
      return;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.gridSelection = null;
    this.textCursor = null;
    this.positionRevision += 1;
    this.publish();
  }

  private capture(
    model: ScoreModel,
    position: EditorPosition = {}
  ): HistorySnapshot {
    const gridSelection = Object.hasOwn(position, 'gridSelection')
      ? position.gridSelection
      : this.gridSelection;
    const textCursor = Object.hasOwn(position, 'textCursor')
      ? position.textCursor
      : this.textCursor;
    return {
      model,
      gridSelection: gridSelection ? { ...gridSelection } : null,
      textCursor: textCursor ? { ...textCursor } : null,
    };
  }

  private restore(snapshot: HistorySnapshot): void {
    this.gridSelection = snapshot.gridSelection
      ? { ...snapshot.gridSelection }
      : null;
    this.textCursor = snapshot.textCursor ? { ...snapshot.textCursor } : null;
    this.positionRevision += 1;
  }

  private publish(): void {
    this.snapshot = {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      positionRevision: this.positionRevision,
      gridSelection: this.gridSelection ? { ...this.gridSelection } : null,
      textCursor: this.textCursor ? { ...this.textCursor } : null,
    };
    for (const listener of this.listeners) listener();
  }
}

/** Subscribe an editor to shared history state when a parent supplies a session. */
export function useSolfaEditorSessionSnapshot(
  session?: SolfaEditorSession
): SolfaEditorSessionSnapshot {
  return useSyncExternalStore(
    session?.subscribe ?? noSubscribe,
    session?.getSnapshot ?? getEmptySnapshot,
    getEmptySnapshot
  );
}
