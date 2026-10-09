// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateScoreAutosaveResponse } from '@choirscore/shared';
import { scoreDetailResponse } from '../../test/scoreFixtures';
import { useScoreAutosave } from './useScoreAutosave';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const model = structuredClone(scoreDetailResponse.score.model);
const draft = { ...structuredClone(model), tempo: 101 };
const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  vi.useRealTimers();
});

describe('useScoreAutosave', () => {
  it('does not make a timer-driven request after the editor session unmounts', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (): Promise<CreateScoreAutosaveResponse> => ({
      score: scoreDetailResponse.score,
      versionId: 'version-2',
      currentVersionId: 'version-2',
      outcome: 'saved',
    }));
    let root: Root;
    await act(async () => {
      root = createRoot(document.createElement('div'));
      roots.push(root);
      function HookProbe() {
        useScoreAutosave({
          scoreId: 'score-1',
          canEditContent: true,
          currentVersionId: 'version-1',
          model: draft,
          persistedModel: model,
          save,
          debounceMs: 30_000,
        });
        return null;
      }
      root.render(<HookProbe />);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      root!.unmount();
      roots.splice(roots.indexOf(root!), 1);
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).not.toHaveBeenCalled();
  });
});
