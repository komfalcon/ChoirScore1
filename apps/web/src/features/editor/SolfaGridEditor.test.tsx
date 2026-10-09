// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseSolfaText, type ScoreModel } from '@choirscore/shared';
import { SolfaGridEditor } from './SolfaGridEditor';

const BASE_TEXT = `Doh is C
Time 4/4
Tempo 96
S: | d : r : m : f |
A: | d : r : m : f |
T: | d : r : m : f |
B: | d : r : m : f |`;
const css = readFileSync(
  resolve(process.cwd(), 'src/features/editor/SolfaGridEditor.css'),
  'utf8'
);
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function model(withLyrics = false): ScoreModel {
  const text = withLyrics ? `${BASE_TEXT}\nL1: one two three four` : BASE_TEXT;
  return parseSolfaText(text, { title: 'Morning Light' });
}

function mount(initialModel = model(), canEditContent = true) {
  const host = document.createElement('div');
  document.body.append(host);
  const root: Root = createRoot(host);
  let currentModel = initialModel;
  let renderCurrent = () => undefined;
  const onChange = vi.fn((next: ScoreModel) => {
    currentModel = next;
    act(() => renderCurrent());
  });
  renderCurrent = () => {
    root.render(
      <SolfaGridEditor
        model={currentModel}
        canEditContent={canEditContent}
        onChange={onChange}
      />
    );
  };
  act(() => renderCurrent());
  return {
    host,
    root,
    onChange,
    current: () => currentModel,
    unmount: () => act(() => root.unmount()),
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

function changeInput(host: HTMLElement, label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`
  );
  if (!input) throw new Error(`Missing input ${label}.`);
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('SolfaGridEditor', () => {
  it('renders labelled cells and supports pitch/duration edits with undo and redo', () => {
    const view = mount();
    try {
      expect(
        view.host.querySelector('[aria-label="Scrollable score grid"]')
      ).not.toBeNull();
      expect(
        view.host.querySelector('[data-grid-cell="S:0:1:1:0:0"]')
      ).not.toBeNull();
      expect(
        view.host
          .querySelector('[data-grid-cell="S:0:1:1:0:0"]')
          ?.getAttribute('aria-label')
      ).toContain('Soprano, bar 1, beat 1, first half:');
      expect(
        view.host.querySelector('[aria-label="Sol-fa syllable"]')
      ).not.toBeNull();

      changeSelect(view.host, 'Sol-fa syllable', 'r');
      click(buttonWithText(view.host, 'Set pitch'));
      let soprano = view.current().parts.find((part) => part.id === 'S')!;
      expect(soprano.measures[0]!.notes[0]!.pitch).toBe('D4');

      changeSelect(view.host, 'Duration in quarter-note units', '1.5');
      click(buttonWithText(view.host, 'Set duration'));
      soprano = view.current().parts.find((part) => part.id === 'S')!;
      expect(soprano.measures[0]!.notes.map((note) => note.dur)).toEqual([
        1.5, 0.5, 1, 1,
      ]);

      click(view.host.querySelector('button[aria-label="Undo edit"]'));
      soprano = view.current().parts.find((part) => part.id === 'S')!;
      expect(soprano.measures[0]!.notes[0]!.pitch).toBe('D4');
      expect(soprano.measures[0]!.notes[0]!.dur).toBe(1);

      click(view.host.querySelector('button[aria-label="Redo edit"]'));
      soprano = view.current().parts.find((part) => part.id === 'S')!;
      expect(soprano.measures[0]!.notes[0]!.pitch).toBe('D4');
      expect(soprano.measures[0]!.notes[0]!.dur).toBe(1.5);
      expect(view.onChange).toHaveBeenCalledTimes(4);
    } finally {
      view.unmount();
      view.host.remove();
    }
  });

  it('rejects a codec-invalid accidental without calling the controlled change callback', () => {
    const view = mount();
    try {
      changeSelect(view.host, 'Accidental', 'double-sharp');
      click(buttonWithText(view.host, 'Apply accidental'));
      expect(view.onChange).not.toHaveBeenCalled();
      expect(view.host.querySelector('[role="alert"]')?.textContent).toMatch(
        /alteration not supported/
      );
      expect(view.current().parts[0]!.measures[0]!.notes[0]!.pitch).toBe('C4');
    } finally {
      view.unmount();
      view.host.remove();
    }
  });

  it('routes hold, rest, and delete actions through the score model', () => {
    const view = mount();
    try {
      click(buttonWithText(view.host, 'Add hold to next'));
      let soprano = view.current().parts.find((part) => part.id === 'S')!;
      expect(soprano.measures[0]!.notes[0]!.tie).toBe(true);
      expect(soprano.measures[0]!.notes[1]!.pitch).toBe('C4');

      click(buttonWithText(view.host, 'Set rest'));
      soprano = view.current().parts.find((part) => part.id === 'S')!;
      expect(soprano.measures[0]!.notes[0]!.pitch).toBeNull();
      expect(soprano.measures[0]!.notes[0]!.tie).toBe(false);

      click(
        view.host.querySelector('button[aria-label="Delete selected event"]')
      );
      soprano = view.current().parts.find((part) => part.id === 'S')!;
      expect(soprano.measures[0]!.notes).toHaveLength(4);
      expect(soprano.measures[0]!.notes.at(-1)!.pitch).toBeNull();
      expect(view.onChange).toHaveBeenCalledTimes(3);
    } finally {
      view.unmount();
      view.host.remove();
    }
  });

  it('updates an existing complete lyric track and removes the shared verse', () => {
    const view = mount(model(true));
    try {
      changeInput(view.host, 'Lyric syllable', 'Joy');
      click(buttonWithText(view.host, 'Set lyric'));
      for (const part of view.current().parts) {
        expect(part.measures[0]!.notes[0]!.lyrics?.[0]?.text).toBe('Joy');
      }

      click(buttonWithText(view.host, 'Remove verse'));
      expect(
        view
          .current()
          .parts.flatMap((part) => part.measures[0]!.notes)
          .every((note) => !note.lyrics?.length && !note.lyric)
      ).toBe(true);
      expect(view.onChange).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      view.host.remove();
    }
  });

  it('uses arrow navigation to move selection and focus between keyboard-operable cells', () => {
    const view = mount();
    try {
      const cells = [
        ...view.host.querySelectorAll<HTMLButtonElement>('[data-grid-cell]'),
      ];
      expect(cells.length).toBe(16);
      act(() =>
        cells[0]!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
        )
      );
      const next = view.host.querySelector<HTMLButtonElement>(
        '[data-grid-cell="S:0:1:2:0:0"]'
      );
      expect(next?.getAttribute('aria-pressed')).toBe('true');
      expect(document.activeElement).toBe(next);
      expect(view.onChange).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      view.host.remove();
    }
  });

  it('shows the current codec boundary as read-only instead of accepting unsupported score edits', () => {
    const unsupported = parseSolfaText(BASE_TEXT, { title: 'Morning Light' });
    const nonTextMode = {
      ...unsupported,
      key: { ...unsupported.key, mode: 'dorian' as const },
    } as ScoreModel;
    const view = mount(nonTextMode);
    try {
      expect(view.host.querySelector('[role="alert"]')?.textContent).toMatch(
        /read-only in Sol-fa Grid/
      );
      expect(
        view.host
          .querySelector<HTMLButtonElement>('button[data-grid-cell]')
          ?.getAttribute('aria-disabled')
      ).toBe('true');
      expect(
        view.host.querySelector<HTMLButtonElement>('button[data-grid-cell]')
          ?.disabled
      ).toBe(false);
      expect(view.onChange).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      view.host.remove();
    }
  });

  it('keeps canEditContent=false scores browsable but read-only and unchanged', () => {
    const original = model();
    const view = mount(original, false);
    try {
      expect(view.host.querySelector('[role="status"]')?.textContent).toMatch(
        /This score is read-only/
      );
      expect(
        view.host
          .querySelector<HTMLButtonElement>('button[data-grid-cell]')
          ?.getAttribute('aria-disabled')
      ).toBe('true');
      expect(
        view.host.querySelector<HTMLButtonElement>('button[data-grid-cell]')
          ?.disabled
      ).toBe(false);
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
      expect(
        view.host.querySelector<HTMLButtonElement>(
          'button[aria-label="Delete selected event"]'
        )?.disabled
      ).toBe(true);
      expect(
        view.host
          .querySelector('[data-grid-cell]')
          ?.getAttribute('aria-describedby')
      ).toBe('solfa-grid-keyboard-help');
      const firstCell = view.host.querySelector<HTMLButtonElement>(
        'button[data-grid-cell]'
      );
      act(() =>
        firstCell?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
        )
      );
      expect(document.activeElement).toBe(
        view.host.querySelector('[data-grid-cell="S:0:1:2:0:0"]')
      );
      expect(view.onChange).not.toHaveBeenCalled();
      expect(view.current()).toBe(original);
    } finally {
      view.unmount();
      view.host.remove();
    }
  });

  it('provides touch-sized controls, visible focus, and an inner horizontal scroller for narrow screens', () => {
    expect(css).toMatch(
      /\.solfa-grid-editor__button,\s*\.solfa-grid-editor__cell\s*\{[^}]*min-width:\s*2\.75rem;[^}]*min-height:\s*2\.75rem;/
    );
    expect(css).toMatch(
      /\.solfa-grid-editor__scroll\s*\{[^}]*overflow-x:\s*auto;/
    );
    expect(css).toMatch(/@media\s*\(max-width:\s*560px\)/);
    expect(css).toContain('.solfa-grid-editor__cell:focus-visible');
    expect(css).toContain('min-width: 0;');
  });
});
