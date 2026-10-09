// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  modelToSolfaText,
  parseSolfaText,
  type ScoreModel,
} from '@choirscore/shared';
import { SolfaGridEditor } from './SolfaGridEditor';
import { SolfaEditorSession } from './solfaEditorSession';
import { SolfaTextEditor } from './SolfaTextEditor';

const BASE_TEXT = `Doh is C
Time 4/4
Tempo 96
S: | d : r : m : f |
A: | d : r : m : f |
T: | d : r : m : f |
B: | d : r : m : f |
L1: one two three four`;

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function model(): ScoreModel {
  return parseSolfaText(BASE_TEXT, { title: 'Morning Light' });
}

function lyricsOf(score: ScoreModel): string[] {
  return score.parts.flatMap((part) =>
    part.measures.flatMap((measure) =>
      measure.notes.flatMap((note) =>
        (note.lyrics ?? []).map((lyric) => lyric.text)
      )
    )
  );
}

function mount(
  initialModel = model(),
  initialMode: 'grid' | 'text' = 'grid',
  initialCanEditContent = true
) {
  const host = document.createElement('div');
  document.body.append(host);
  const root: Root = createRoot(host);
  const session = new SolfaEditorSession();
  let currentModel = initialModel;
  let mode = initialMode;
  let canEditContent = initialCanEditContent;
  let renderCurrent = () => undefined;
  const onChange = vi.fn((next: ScoreModel) => {
    currentModel = next;
    act(() => renderCurrent());
  });

  renderCurrent = () => {
    root.render(
      mode === 'grid' ? (
        <SolfaGridEditor
          model={currentModel}
          canEditContent={canEditContent}
          onChange={onChange}
          session={session}
        />
      ) : (
        <SolfaTextEditor
          model={currentModel}
          canEditContent={canEditContent}
          onChange={onChange}
          session={session}
        />
      )
    );
  };
  act(() => renderCurrent());

  return {
    host,
    session,
    onChange,
    current: () => currentModel,
    switchTo(nextMode: 'grid' | 'text') {
      act(() => {
        mode = nextMode;
        renderCurrent();
      });
    },
    setCanEditContent(next: boolean) {
      act(() => {
        canEditContent = next;
        renderCurrent();
      });
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

function click(element: HTMLElement | null) {
  if (!element) throw new Error('Expected a clickable control.');
  act(() => element.click());
}

function buttonWithText(
  host: HTMLElement,
  text: string
): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === text
    ) ?? null
  );
}

function changeSelect(host: HTMLElement, label: string, value: string) {
  const select = host.querySelector<HTMLSelectElement>(
    `select[aria-label="${label}"]`
  );
  if (!select) throw new Error(`Missing select ${label}.`);
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function changeText(host: HTMLElement, value: string, cursor = value.length) {
  const textarea = host.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Sol-fa text"]'
  );
  if (!textarea) throw new Error('Missing Sol-fa Text textarea.');
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )?.set;
  act(() => {
    setter?.call(textarea, value);
    textarea.setSelectionRange(cursor, cursor);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return textarea;
}

describe('shared Sol-fa editor session', () => {
  it('undoes and redoes a Grid edit from Text while restoring notation, lyrics, and Grid selection', () => {
    const original = model();
    const originalText = modelToSolfaText(original);
    const originalLyrics = lyricsOf(original);
    const view = mount(original, 'grid');
    try {
      click(
        view.host.querySelector<HTMLButtonElement>(
          '[data-grid-cell="S:0:1:2:0:0"]'
        )
      );
      expect(
        view.host
          .querySelector<HTMLButtonElement>('[data-grid-cell="S:0:1:2:0:0"]')
          ?.getAttribute('aria-pressed')
      ).toBe('true');
      changeSelect(view.host, 'Sol-fa syllable', 'f');
      click(buttonWithText(view.host, 'Set pitch'));
      const edited = view.current();
      const editedText = modelToSolfaText(edited);
      expect(editedText).not.toBe(originalText);
      expect(lyricsOf(edited)).toEqual(originalLyrics);

      view.switchTo('text');
      expect(
        view.host.querySelector<HTMLTextAreaElement>('textarea')?.value
      ).toBe(editedText);
      expect(
        view.host.querySelector<HTMLButtonElement>(
          'button[aria-label="Undo edit"]'
        )?.disabled
      ).toBe(false);

      click(view.host.querySelector('button[aria-label="Undo edit"]'));
      expect(view.current()).toEqual(original);
      expect(modelToSolfaText(view.current())).toBe(originalText);
      expect(lyricsOf(view.current())).toEqual(originalLyrics);
      expect(
        view.host.querySelector<HTMLTextAreaElement>('textarea')?.value
      ).toBe(originalText);

      click(view.host.querySelector('button[aria-label="Redo edit"]'));
      expect(modelToSolfaText(view.current())).toBe(editedText);
      expect(lyricsOf(view.current())).toEqual(originalLyrics);

      view.switchTo('grid');
      expect(
        view.host
          .querySelector<HTMLButtonElement>('[data-grid-cell="S:0:1:2:0:0"]')
          ?.getAttribute('aria-pressed')
      ).toBe('true');
    } finally {
      view.unmount();
    }
  });

  it('keeps each Grid history selection fixed when navigation happens after an edit', () => {
    const original = model();
    const view = mount(original, 'grid');
    try {
      click(
        view.host.querySelector<HTMLButtonElement>(
          '[data-grid-cell="S:0:1:4:0:0"]'
        )
      );
      expect(view.session.getSnapshot().gridSelection).toMatchObject({
        partId: 'S',
        beat: 4,
        subdivision: 0,
      });

      changeSelect(view.host, 'Duration in quarter-note units', '1.5');
      click(buttonWithText(view.host, 'Set duration'));
      const edited = view.current();
      expect(edited).not.toEqual(original);
      expect(view.session.getSnapshot()).toMatchObject({
        undoCount: 1,
        redoCount: 0,
        gridSelection: { partId: 'S', beat: 3, subdivision: 1 },
      });

      const editedCell = view.host.querySelector<HTMLButtonElement>(
        '[data-grid-cell="S:0:1:3:1:0"]'
      );
      if (!editedCell) throw new Error('Expected the edited Grid cell.');
      act(() =>
        editedCell.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
        )
      );
      expect(
        view.host
          .querySelector<HTMLButtonElement>('[data-grid-cell="A:0:1:1:0:0"]')
          ?.getAttribute('aria-pressed')
      ).toBe('true');
      expect(view.session.getSnapshot()).toMatchObject({
        undoCount: 1,
        redoCount: 0,
        gridSelection: { partId: 'A', beat: 1, subdivision: 0 },
      });

      view.switchTo('text');
      click(view.host.querySelector('button[aria-label="Undo edit"]'));
      expect(view.current()).toEqual(original);
      expect(view.session.getSnapshot().gridSelection).toMatchObject({
        partId: 'S',
        beat: 4,
        subdivision: 0,
      });

      view.switchTo('grid');
      expect(
        view.host
          .querySelector<HTMLButtonElement>('[data-grid-cell="S:0:1:4:0:0"]')
          ?.getAttribute('aria-pressed')
      ).toBe('true');
      click(view.host.querySelector('button[aria-label="Redo edit"]'));
      expect(view.current()).toEqual(edited);
      expect(
        view.host
          .querySelector<HTMLButtonElement>('[data-grid-cell="S:0:1:3:1:0"]')
          ?.getAttribute('aria-pressed')
      ).toBe('true');
      expect(view.session.getSnapshot()).toMatchObject({
        undoCount: 1,
        redoCount: 0,
        gridSelection: { partId: 'S', beat: 3, subdivision: 1 },
      });
    } finally {
      view.unmount();
    }
  });

  it('keeps each Text history cursor fixed when caret navigation happens after an edit', () => {
    const original = model();
    const originalText = modelToSolfaText(original);
    const view = mount(original, 'text');
    try {
      const beforeCursor = 5;
      const initialTextarea = view.host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Sol-fa text"]'
      );
      if (!initialTextarea) throw new Error('Missing Sol-fa Text textarea.');
      act(() => {
        initialTextarea.setSelectionRange(beforeCursor, beforeCursor);
        view.session.rememberTextCursor({
          start: beforeCursor,
          end: beforeCursor,
        });
      });

      const editedText = originalText.replace(
        'S: | d : r : m : f |',
        'S: | d : f : m : f |'
      );
      const afterCursor = editedText.indexOf('S: |') + 11;
      changeText(view.host, editedText, afterCursor);
      expect(modelToSolfaText(view.current())).toBe(editedText);
      expect(view.session.getSnapshot()).toMatchObject({
        undoCount: 1,
        redoCount: 0,
        textCursor: { start: afterCursor, end: afterCursor },
      });

      const editedTextarea = view.host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Sol-fa text"]'
      );
      if (!editedTextarea) throw new Error('Missing Sol-fa Text textarea.');
      const laterCursor = editedText.length - 2;
      act(() => {
        editedTextarea.setSelectionRange(laterCursor, laterCursor);
        view.session.rememberTextCursor({
          start: laterCursor,
          end: laterCursor,
        });
      });
      expect(view.session.getSnapshot()).toMatchObject({
        undoCount: 1,
        redoCount: 0,
        textCursor: { start: laterCursor, end: laterCursor },
      });

      view.switchTo('grid');
      click(view.host.querySelector('button[aria-label="Undo edit"]'));
      expect(view.current()).toEqual(original);
      expect(view.session.getSnapshot()).toMatchObject({
        textCursor: { start: beforeCursor, end: beforeCursor },
      });

      view.switchTo('text');
      const restoredTextarea = view.host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Sol-fa text"]'
      );
      expect(restoredTextarea?.selectionStart).toBe(beforeCursor);
      expect(restoredTextarea?.selectionEnd).toBe(beforeCursor);
      click(view.host.querySelector('button[aria-label="Redo edit"]'));
      expect(modelToSolfaText(view.current())).toBe(editedText);
      const redoneTextarea = view.host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Sol-fa text"]'
      );
      expect(redoneTextarea?.selectionStart).toBe(afterCursor);
      expect(redoneTextarea?.selectionEnd).toBe(afterCursor);
      expect(view.session.getSnapshot()).toMatchObject({
        undoCount: 1,
        redoCount: 0,
        textCursor: { start: afterCursor, end: afterCursor },
      });
    } finally {
      view.unmount();
    }
  });

  it('undoes and redoes a Text edit from Grid, restoring the model, lyrics, and a usable Text cursor', () => {
    const original = model();
    const originalText = modelToSolfaText(original);
    const originalLyrics = lyricsOf(original);
    const view = mount(original, 'text');
    try {
      const editedText = originalText.replace(
        'S: | d : r : m : f |',
        'S: | d : f : m : f |'
      );
      const cursor = editedText.indexOf('S: |') + 11;
      changeText(view.host, editedText, cursor);
      expect(modelToSolfaText(view.current())).toBe(editedText);
      expect(lyricsOf(view.current())).toEqual(originalLyrics);

      view.switchTo('grid');
      expect(
        view.host.querySelector<HTMLButtonElement>(
          'button[aria-label="Undo edit"]'
        )?.disabled
      ).toBe(false);
      click(view.host.querySelector('button[aria-label="Undo edit"]'));
      expect(view.current()).toEqual(original);
      expect(modelToSolfaText(view.current())).toBe(originalText);
      expect(lyricsOf(view.current())).toEqual(originalLyrics);
      expect(
        view.host
          .querySelector<HTMLButtonElement>('[data-grid-cell="S:0:1:1:0:0"]')
          ?.getAttribute('aria-pressed')
      ).toBe('true');

      click(view.host.querySelector('button[aria-label="Redo edit"]'));
      expect(modelToSolfaText(view.current())).toBe(editedText);
      expect(lyricsOf(view.current())).toEqual(originalLyrics);

      view.switchTo('text');
      const textarea = view.host.querySelector<HTMLTextAreaElement>('textarea');
      expect(textarea?.value).toBe(editedText);
      expect(textarea?.selectionStart).toBe(cursor);
      expect(textarea?.selectionEnd).toBe(cursor);
    } finally {
      view.unmount();
    }
  });

  it('does not create undo or redo history for invalid Text drafts', () => {
    const original = model();
    const view = mount(original, 'text');
    try {
      const invalidText = originalTextFor(original).replace(
        'S: | d : r : m : f |',
        'S: | d : nope : m : f |'
      );
      changeText(view.host, invalidText);
      expect(view.current()).toBe(original);
      expect(view.session.getSnapshot().undoCount).toBe(0);
      expect(view.session.getSnapshot().redoCount).toBe(0);
      expect(view.host.querySelector('[role="alert"]')).not.toBeNull();
      expect(
        view.host.querySelector<HTMLButtonElement>(
          'button[aria-label="Undo edit"]'
        )?.disabled
      ).toBe(true);
      expect(
        view.host.querySelector<HTMLButtonElement>(
          'button[aria-label="Redo edit"]'
        )?.disabled
      ).toBe(true);

      view.switchTo('grid');
      expect(
        view.host.querySelector<HTMLButtonElement>(
          'button[aria-label="Undo edit"]'
        )?.disabled
      ).toBe(true);
      expect(
        view.host.querySelector<HTMLButtonElement>(
          'button[aria-label="Redo edit"]'
        )?.disabled
      ).toBe(true);
    } finally {
      view.unmount();
    }
  });

  it('keeps shared undo and redo unavailable after the parent makes a score read-only', () => {
    const view = mount(model(), 'grid');
    try {
      changeSelect(view.host, 'Sol-fa syllable', 'r');
      click(buttonWithText(view.host, 'Set pitch'));
      const editedText = modelToSolfaText(view.current());
      expect(view.session.getSnapshot().undoCount).toBe(1);

      view.setCanEditContent(false);
      view.switchTo('text');
      expect(view.host.querySelector('[role="status"]')?.textContent).toMatch(
        /This score is read-only/
      );
      expect(
        view.host.querySelector<HTMLButtonElement>(
          'button[aria-label="Undo edit"]'
        )?.disabled
      ).toBe(true);
      click(view.host.querySelector('button[aria-label="Undo edit"]'));
      expect(modelToSolfaText(view.current())).toBe(editedText);
    } finally {
      view.unmount();
    }
  });

  it('keeps codec-unsupported scores read-only in both session-backed modes', () => {
    const canonical = model();
    const unsupported = {
      ...canonical,
      key: { ...canonical.key, mode: 'dorian' as const },
    } as ScoreModel;
    const view = mount(unsupported, 'grid');
    try {
      expect(view.host.querySelector('[role="alert"]')?.textContent).toMatch(
        /read-only in Sol-fa Grid/
      );
      expect(
        view.host.querySelector<HTMLButtonElement>(
          'button[aria-label="Undo edit"]'
        )?.disabled
      ).toBe(true);

      view.switchTo('text');
      expect(view.host.querySelector('[role="alert"]')?.textContent).toMatch(
        /not representable in Sol-fa Text/
      );
      expect(
        view.host.querySelector<HTMLTextAreaElement>('textarea')?.disabled
      ).toBe(true);
      expect(
        view.host.querySelector<HTMLButtonElement>(
          'button[aria-label="Undo edit"]'
        )?.disabled
      ).toBe(true);
    } finally {
      view.unmount();
    }
  });
});

function originalTextFor(score: ScoreModel): string {
  return modelToSolfaText(score);
}
