import { useEffect, useRef, useState } from 'react';
import {
  modelToSolfaText,
  parseSolfaText,
  SolfaTextError,
  type ScoreModel,
} from '@choirscore/shared';
import type { SolfaEditorProps } from './solfaEditorContract';
import { useSolfaEditorSessionSnapshot } from './solfaEditorSession';
import './SolfaTextEditor.css';

type LocatedIssue = {
  part: string;
  bar: number;
  beat: number;
  message: string;
};

type EditorState = {
  draft: string;
  draftIssue: LocatedIssue | null;
  codecIssue: LocatedIssue | null;
};

function issueFor(error: unknown): LocatedIssue {
  if (error instanceof SolfaTextError) {
    const prefix = `Part ${error.part}, Bar ${error.bar}, Beat ${error.beat}: `;
    return {
      part: error.part,
      bar: error.bar,
      beat: error.beat,
      message: error.message.startsWith(prefix)
        ? error.message.slice(prefix.length)
        : error.message,
    };
  }
  return {
    part: 'Header',
    bar: 1,
    beat: 1,
    message:
      error instanceof Error
        ? error.message
        : 'The Sol-fa text could not be parsed.',
  };
}

function stateForModel(model: ScoreModel): EditorState {
  try {
    return {
      draft: modelToSolfaText(model),
      draftIssue: null,
      codecIssue: null,
    };
  } catch (error) {
    return { draft: '', draftIssue: null, codecIssue: issueFor(error) };
  }
}

function preserveModelMetadata(
  parsed: ScoreModel,
  current: ScoreModel
): ScoreModel {
  const namesByPart = new Map(
    current.parts.map((part) => [part.id, part.name] as const)
  );
  const orderByPart = new Map(
    current.parts.map((part, index) => [part.id, index] as const)
  );
  return {
    ...parsed,
    title: current.title,
    ...(current.composer !== undefined ? { composer: current.composer } : {}),
    parts: parsed.parts
      .map((part) => {
        const name = namesByPart.get(part.id);
        return name === undefined ? part : { ...part, name };
      })
      .sort(
        (left, right) =>
          (orderByPart.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (orderByPart.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      ),
  };
}

function sameModel(left: ScoreModel, right: ScoreModel): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function issueLocation(issue: LocatedIssue): string {
  return `Part ${issue.part}, Bar ${issue.bar}, Beat ${issue.beat}`;
}

export function SolfaTextEditor({
  model,
  canEditContent,
  onChange,
  session,
  className = '',
}: SolfaEditorProps) {
  const [editorState, setEditorState] = useState(() => stateForModel(model));
  const lastEmittedModel = useRef<ScoreModel | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionSnapshot = useSolfaEditorSessionSnapshot(session);
  const canEdit = canEditContent && !editorState.codecIssue;

  useEffect(() => {
    if (lastEmittedModel.current === model) {
      lastEmittedModel.current = null;
      return;
    }
    lastEmittedModel.current = null;
    setEditorState(stateForModel(model));
  }, [model]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !session) return;
    const cursor = sessionSnapshot.textCursor ?? { start: 0, end: 0 };
    const start = Math.min(cursor.start, editorState.draft.length);
    const end = Math.min(Math.max(cursor.end, start), editorState.draft.length);
    textarea.setSelectionRange(start, end);
    if (!sessionSnapshot.textCursor) session.rememberTextCursor({ start, end });
  }, [editorState.draft, session, sessionSnapshot.textCursor]);

  function rememberCursor(textarea: HTMLTextAreaElement) {
    session?.rememberTextCursor({
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    });
  }

  function updateDraft(value: string, cursor: { start: number; end: number }) {
    if (!canEdit) return;

    let next: ScoreModel;
    try {
      const parsed = parseSolfaText(value, { title: model.title });
      next = preserveModelMetadata(parsed, model);
    } catch (error) {
      session?.rememberTextCursor(cursor);
      setEditorState((current) => ({
        ...current,
        draft: value,
        draftIssue: issueFor(error),
      }));
      return;
    }

    setEditorState({ draft: value, draftIssue: null, codecIssue: null });
    if (sameModel(next, model)) {
      session?.rememberTextCursor(cursor);
      return;
    }

    session?.recordEdit(model, next, { textCursor: cursor });
    lastEmittedModel.current = next;
    onChange(next);
  }

  function undo() {
    if (!session || !canEdit) return;
    const previous = session.undo(model);
    if (previous) onChange(previous);
  }

  function redo() {
    if (!session || !canEdit) return;
    const next = session.redo(model);
    if (next) onChange(next);
  }

  const activeIssue = editorState.codecIssue ?? editorState.draftIssue;
  const describedBy = [
    'solfa-text-editor-help',
    editorState.codecIssue ? 'solfa-text-editor-codec-error' : '',
    editorState.draftIssue ? 'solfa-text-editor-draft-error' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      className={`solfa-text-editor ${className}`.trim()}
      aria-labelledby="solfa-text-editor-title"
    >
      <header className="solfa-text-editor__header">
        <div>
          <p className="solfa-text-editor__eyebrow">EDIT SCORE</p>
          <h2 id="solfa-text-editor-title">Sol-fa Text</h2>
          <p className="solfa-text-editor__meta">
            Plain-text notation updates the shared score as you type when the
            complete draft is valid.
          </p>
        </div>
        {session ? (
          <div className="solfa-text-editor__history" aria-label="Edit history">
            <button
              type="button"
              className="solfa-text-editor__button"
              onClick={undo}
              disabled={!canEdit || sessionSnapshot.undoCount === 0}
              aria-label="Undo edit"
            >
              Undo
            </button>
            <button
              type="button"
              className="solfa-text-editor__button"
              onClick={redo}
              disabled={!canEdit || sessionSnapshot.redoCount === 0}
              aria-label="Redo edit"
            >
              Redo
            </button>
          </div>
        ) : null}
      </header>

      <label
        className="solfa-text-editor__label"
        htmlFor="solfa-text-editor-source"
      >
        Sol-fa text
      </label>
      <textarea
        ref={textareaRef}
        id="solfa-text-editor-source"
        className="solfa-text-editor__input"
        aria-label="Sol-fa text"
        aria-describedby={describedBy}
        aria-invalid={Boolean(activeIssue)}
        value={editorState.draft}
        onChange={(event) =>
          updateDraft(event.currentTarget.value, {
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd,
          })
        }
        onSelect={(event) => rememberCursor(event.currentTarget)}
        disabled={!canEdit}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        wrap="soft"
      />
      <p className="solfa-text-editor__help" id="solfa-text-editor-help">
        Use standard keyboard text-editing keys. Each change is parsed
        immediately; an invalid draft stays visible while the shared score keeps
        its last valid model.
      </p>

      {editorState.codecIssue ? (
        <aside
          className="solfa-text-editor__error"
          id="solfa-text-editor-codec-error"
          role="alert"
        >
          <strong>This score is not representable in Sol-fa Text.</strong>{' '}
          {issueLocation(editorState.codecIssue)}:{' '}
          {editorState.codecIssue.message}
        </aside>
      ) : null}
      {editorState.draftIssue ? (
        <aside
          className="solfa-text-editor__error"
          id="solfa-text-editor-draft-error"
          role="alert"
          aria-live="polite"
        >
          <strong>{issueLocation(editorState.draftIssue)}:</strong>{' '}
          {editorState.draftIssue.message}
        </aside>
      ) : null}
      {!canEditContent && !editorState.codecIssue ? (
        <aside className="solfa-text-editor__notice" role="status">
          <strong>This score is read-only.</strong> Content editing is not
          permitted for this score.
        </aside>
      ) : null}
    </section>
  );
}
