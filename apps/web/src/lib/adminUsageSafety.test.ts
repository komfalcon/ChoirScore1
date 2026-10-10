import { describe, expect, it } from 'vitest';
import { getAiGlobalToggleIntent } from './adminUsageSafety';

describe('global AI toggle intent', () => {
  it('requires confirmation before turning AI off', () => {
    expect(getAiGlobalToggleIntent(true)).toBe('confirm-disable');
  });

  it('allows turning AI back on directly', () => {
    expect(getAiGlobalToggleIntent(false)).toBe('enable');
  });
});
