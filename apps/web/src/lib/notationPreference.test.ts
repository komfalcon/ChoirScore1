import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadNotationMode,
  notationModeStorageKey,
  saveNotationMode,
} from './notationPreference';

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('per-user notation preference', () => {
  it('defaults a member without a saved choice to Sol-fa', () => {
    expect(loadNotationMode('member-ada')).toBe('solfa');
  });

  it('restores a saved choice after a viewer remount or reload', () => {
    saveNotationMode('member-ada', 'staff');

    // A fresh read models the next page load; the choice lives in browser storage.
    expect(loadNotationMode('member-ada')).toBe('staff');
    expect(loadNotationMode('member-ada')).toBe('staff');
  });

  it('keeps preferences isolated by authenticated user ID', () => {
    saveNotationMode('member-ada', 'staff');
    saveNotationMode('member-ben', 'solfa');

    expect(loadNotationMode('member-ada')).toBe('staff');
    expect(loadNotationMode('member-ben')).toBe('solfa');
    expect(notationModeStorageKey('member-ada')).not.toBe(
      notationModeStorageKey('member-ben')
    );
  });

  it('ignores malformed stored values and defaults to Sol-fa', () => {
    globalThis.localStorage.setItem(
      notationModeStorageKey('member-ada'),
      'musicxml'
    );

    expect(loadNotationMode('member-ada')).toBe('solfa');
  });

  it('does not throw when browser storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('storage disabled');
      },
    });

    expect(loadNotationMode('member-ada')).toBe('solfa');
    expect(() => saveNotationMode('member-ada', 'staff')).not.toThrow();
  });
});
