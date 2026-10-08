import { describe, expect, it } from 'vitest';
import { focusTrapBoundaryIndex } from './dialogFocus';

describe('modal focus trap boundaries', () => {
  it('wraps Tab from the last control and Shift+Tab from the first control', () => {
    expect(focusTrapBoundaryIndex(3, 4, false)).toBe(0);
    expect(focusTrapBoundaryIndex(0, 4, true)).toBe(3);
  });

  it('lets Tab move naturally between interior controls and wraps when focus is outside', () => {
    expect(focusTrapBoundaryIndex(1, 4, false)).toBeNull();
    expect(focusTrapBoundaryIndex(-1, 4, false)).toBe(0);
    expect(focusTrapBoundaryIndex(-1, 4, true)).toBe(3);
  });

  it('handles one or zero focusable controls', () => {
    expect(focusTrapBoundaryIndex(0, 1, false)).toBe(0);
    expect(focusTrapBoundaryIndex(0, 1, true)).toBe(0);
    expect(focusTrapBoundaryIndex(-1, 0, false)).toBeNull();
  });
});
