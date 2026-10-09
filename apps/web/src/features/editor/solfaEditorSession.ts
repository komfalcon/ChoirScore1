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

type HistoryEntry = {
  model: ScoreModel;
  gridSelection: SolfaGridSelection | null;
  textCursor: SolfaTextCursor | null;
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
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
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
  recordEdit(previous: ScoreModel, next: ScoreModel): boolean {
    if (JSON.stringify(previous) === JSON.stringify(next)) return false;
    this.undoStack.push(this.capture(previous));
    this.redoStack.length = 0;
    this.publish();
    return true;
  }

  undo(current: ScoreModel): ScoreModel | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(this.capture(current));
    this.restore(entry);
    this.publish();
    return entry.model;
  }

  redo(current: ScoreModel): ScoreModel | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(this.capture(current));
    this.restore(entry);
    this.publish();
    return entry.model;
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

  private capture(model: ScoreModel): HistoryEntry {
    return {
      model,
      gridSelection: this.gridSelection ? { ...this.gridSelection } : null,
      textCursor: this.textCursor ? { ...this.textCursor } : null,
    };
  }

  private restore(entry: HistoryEntry): void {
    this.gridSelection = entry.gridSelection
      ? { ...entry.gridSelection }
      : null;
    this.textCursor = entry.textCursor ? { ...entry.textCursor } : null;
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
