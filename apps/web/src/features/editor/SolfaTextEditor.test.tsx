// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  modelToSolfaText,
  parseSolfaText,
  type ScoreModel,
} from '@choirscore/shared';
import { SolfaTextEditor } from './SolfaTextEditor';

const BASE_TEXT = `Doh is C
Time 4/4
Tempo 96
S: | d : r : m : f |
A: | d : r : m : f |
T: | d : r : m : f |
B: | d : r : m : f |`;
const css = readFileSync(
  resolve(process.cwd(), 'src/features/editor/SolfaTextEditor.css'),
  'utf8'
);
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function model(withLyrics = false): ScoreModel {
  const text = withLyrics ? `${BASE_TEXT}\nL1: one-two three four` : BASE_TEXT;
  return parseSolfaText(text, { title: 'Morning Light' });
}

function mount(initialModel = model(), canEditContent = true) {
  const host = document.createElement('div');
  document.body.append(host);
  const root: Root = createRoot(host);
  let currentModel = initialModel;
  const onChange = vi.fn((next: ScoreModel) => {
    currentModel = next;
    act(() =>
      root.render(
        <SolfaTextEditor
          model={currentModel}
          canEditContent={canEditContent}
          onChange={onChange}
        />
      )
    );
  });
  act(() =>
    root.render(
      <SolfaTextEditor
        model={currentModel}
        canEditContent={canEditContent}
        onChange={onChange}
      />
    )
  );
  return {
    host,
    root,
    onChange,
    current: () => currentModel,
    unmount: () => act(() => root.unmount()),
  };
}

function changeText(host: HTMLElement, value: string) {
  const textarea = host.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Sol-fa text"]'
  );
  if (!textarea) throw new Error('Missing Sol-fa text editor.');
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )?.set;
  act(() => {
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return textarea;
}

describe('SolfaTextEditor', () => {
  it('starts with canonical codec text and publishes valid changes through the shared model seam', () => {
    const original = {
      ...model(),
      composer: 'A. Composer',
      parts: model().parts.map((part) =>
        part.id === 'S' ? { ...part, name: 'Lead Soprano' } : part
      ),
    } as ScoreModel;
    const view = mount(original);
    try {
      const textarea = view.host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Sol-fa text"]'
      );
      expect(textarea?.value).toBe(modelToSolfaText(original));
      expect(view.onChange).not.toHaveBeenCalled();

      const editedText = BASE_TEXT.replace(
        'S: | d : r : m : f |',
        'S: | d : m : m : f |'
      );
      changeText(view.host, editedText);

      expect(view.onChange).toHaveBeenCalledTimes(1);
      expect(view.current().composer).toBe('A. Composer');
      expect(view.current().parts.find((part) => part.id === 'S')?.name).toBe(
        'Lead Soprano'
      );
      const expected = parseSolfaText(editedText, { title: original.title });
      expect(modelToSolfaText(view.current())).toBe(modelToSolfaText(expected));
      expect(
        modelToSolfaText(parseSolfaText(modelToSolfaText(view.current())))
      ).toBe(modelToSolfaText(view.current()));
    } finally {
      view.unmount();
      view.host.remove();
    }
  });

  it('preserves a non-SATB incoming part order when publishing a valid Text edit', () => {
    const canonicalModel = model();
    const original = {
      ...canonicalModel,
      parts: [...canonicalModel.parts].reverse(),
    };
    const originalOrder = original.parts.map((part) => part.id);
    expect(originalOrder).toEqual(['B', 'T', 'A', 'S']);
    expect(modelToSolfaText(original)).toBe(modelToSolfaText(canonicalModel));

    const view = mount(original);
    try {
      const editedText = modelToSolfaText(original).replace(
        'S: | d : r : m : f |',
        'S: | d : m : m : f |'
      );
      changeText(view.host, editedText);

      expect(view.onChange).toHaveBeenCalledTimes(1);
      expect(view.current().parts.map((part) => part.id)).toEqual(
        originalOrder
      );
      expect(
        view.current().parts.find((part) => part.id === 'S')?.measures[0]
          ?.notes[1]?.pitch
      ).toBe(
        parseSolfaText(editedText).parts.find((part) => part.id === 'S')
          ?.measures[0]?.notes[1]?.pitch
      );
    } finally {
      view.unmount();
      view.host.remove();
    }
  });

  it('parses lyric edits and keeps invalid lyric drafts without changing the last valid model', () => {
    const view = mount(model(true));
    try {
      const editedText = `${BASE_TEXT}\nL1: joy-peace fills hearts`;
      changeText(view.host, editedText);
      expect(view.onChange).toHaveBeenCalledTimes(1);
      expect(modelToSolfaText(view.current())).toContain(
        'L1: joy-peace fills hearts'
      );
      for (const part of view.current().parts) {
        expect(
          part.measures[0]?.notes
            .flatMap((note) => note.lyrics ?? [])
            .map((lyric) => lyric.text)
        ).toEqual(['joy', 'peace', 'fills', 'hearts']);
      }

      const lastValid = view.current();
      changeText(view.host, `${BASE_TEXT}\nL1: only one`);
      expect(view.onChange).toHaveBeenCalledTimes(1);
      expect(view.current()).toBe(lastValid);
      expect(view.host.querySelector('[role="alert"]')?.textContent).toContain(
        'Part S, Bar 1, Beat 3'
      );
      expect(
        view.host
          .querySelector<HTMLTextAreaElement>('textarea')
          ?.getAttribute('aria-invalid')
      ).toBe('true');
    } finally {
      view.unmount();
      view.host.remove();
    }
  });

  it('retains the last valid model and reports the codec location for invalid beat drafts', () => {
    const original = model();
    const view = mount(original);
    try {
      const invalid = BASE_TEXT.replace(
        'S: | d : r : m : f |',
        'S: | d : nope : m : f |'
      );
      changeText(view.host, invalid);

      expect(view.onChange).not.toHaveBeenCalled();
      expect(view.current()).toBe(original);
      expect(view.host.querySelector('[role="alert"]')?.textContent).toContain(
        'Part S, Bar 1, Beat 2'
      );
      expect(
        view.host.querySelector<HTMLTextAreaElement>('textarea')?.value
      ).toBe(invalid);

      changeText(view.host, BASE_TEXT);
      expect(view.host.querySelector('[role="alert"]')).toBeNull();
      expect(view.current()).toBe(original);
    } finally {
      view.unmount();
      view.host.remove();
    }
  });

  it('keeps native keyboard focus available while parsing edits and styles a narrow editor layout', () => {
    const view = mount();
    try {
      const textarea = view.host.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Sol-fa text"]'
      );
      expect(textarea).not.toBeNull();
      act(() => textarea?.focus());
      expect(document.activeElement).toBe(textarea);
      act(() =>
        textarea?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
        )
      );
      expect(document.activeElement).toBe(textarea);

      changeText(
        view.host,
        BASE_TEXT.replace('S: | d : r : m : f |', 'S: | d : d : m : f |')
      );
      expect(document.activeElement).toBe(textarea);
      expect(view.onChange).toHaveBeenCalledTimes(1);

      expect(css).toMatch(
        /\.solfa-text-editor__input\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/
      );
      expect(css).toMatch(/@media\s*\(max-width:\s*560px\)/);
      expect(css).toContain('.solfa-text-editor__input:focus-visible');
      expect(css).toContain('min-height: 15rem;');
    } finally {
      view.unmount();
      view.host.remove();
    }
  });

  it('keeps permission-restricted scores read-only without creating another edit history', () => {
    const original = model();
    const view = mount(original, false);
    try {
      const textarea = view.host.querySelector<HTMLTextAreaElement>('textarea');
      expect(textarea?.disabled).toBe(true);
      expect(view.host.querySelector('[role="status"]')?.textContent).toMatch(
        /This score is read-only/
      );
      expect(view.onChange).not.toHaveBeenCalled();
      expect(view.current()).toBe(original);
    } finally {
      view.unmount();
      view.host.remove();
    }
  });
});
