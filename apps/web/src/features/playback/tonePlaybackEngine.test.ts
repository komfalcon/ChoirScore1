import { beforeEach, describe, expect, it, vi } from 'vitest';

const toneMock = vi.hoisted(() => ({
  start: vi.fn(() => Promise.resolve()),
  loaded: vi.fn(() => Promise.resolve()),
  sampler: vi.fn(),
  synth: vi.fn(),
}));

vi.mock('tone', () => ({
  start: toneMock.start,
  loaded: toneMock.loaded,
  Sampler: toneMock.sampler,
  Synth: toneMock.synth,
  Transport: {},
}));

import { TonePlaybackEngine } from './tonePlaybackEngine';

describe('TonePlaybackEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not start audio or fetch samples during construction', () => {
    new TonePlaybackEngine();

    expect(toneMock.start).not.toHaveBeenCalled();
    expect(toneMock.loaded).not.toHaveBeenCalled();
    expect(toneMock.sampler).not.toHaveBeenCalled();
    expect(toneMock.synth).not.toHaveBeenCalled();
  });
});
