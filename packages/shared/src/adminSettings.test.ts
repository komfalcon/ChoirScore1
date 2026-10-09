import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE_RANGES,
  getAdminSettingsResponseSchema,
  patchAdminSettingsRequestSchema,
  patchAdminSettingsResponseSchema,
  voiceRangesSchema,
} from './index.js';

const settings = {
  requirePasswordChangeAtFirstLogin: true,
  voiceRanges: DEFAULT_VOICE_RANGES,
};

describe('Admin Settings contract schemas', () => {
  it('validates the PRD §10.5 defaults and rejects a range profile that breaks containment', () => {
    expect(voiceRangesSchema.parse(DEFAULT_VOICE_RANGES)).toEqual({
      S: {
        comfortable: { low: 'C4', high: 'G5' },
        hard: { low: 'B3', high: 'A5' },
      },
      A: {
        comfortable: { low: 'G3', high: 'D5' },
        hard: { low: 'F3', high: 'E5' },
      },
      T: {
        comfortable: { low: 'C3', high: 'G4' },
        hard: { low: 'B2', high: 'A4' },
      },
      B: {
        comfortable: { low: 'E2', high: 'D4' },
        hard: { low: 'D2', high: 'F4' },
      },
    });
    expect(
      voiceRangesSchema.safeParse({
        ...DEFAULT_VOICE_RANGES,
        S: {
          comfortable: { low: 'C4', high: 'G5' },
          hard: { low: 'C4', high: 'F5' },
        },
      }).success
    ).toBe(false);
    expect(
      voiceRangesSchema.safeParse({
        ...DEFAULT_VOICE_RANGES,
        A: {
          comfortable: { low: 'D5', high: 'G3' },
          hard: { low: 'F3', high: 'E5' },
        },
      }).success
    ).toBe(false);
  });

  it('validates the GET response shape and rejects extra fields', () => {
    expect(getAdminSettingsResponseSchema.parse(settings)).toEqual(settings);
    expect(
      getAdminSettingsResponseSchema.safeParse({ ...settings, extra: true })
        .success
    ).toBe(false);
  });

  it('accepts exactly the supplied PATCH settings and rejects empty or extra payloads', () => {
    expect(
      patchAdminSettingsRequestSchema.parse({
        requirePasswordChangeAtFirstLogin: false,
      })
    ).toEqual({ requirePasswordChangeAtFirstLogin: false });
    expect(
      patchAdminSettingsRequestSchema.parse({
        voiceRanges: DEFAULT_VOICE_RANGES,
      })
    ).toEqual({ voiceRanges: DEFAULT_VOICE_RANGES });
    expect(patchAdminSettingsRequestSchema.safeParse({}).success).toBe(false);
    expect(
      patchAdminSettingsRequestSchema.safeParse({
        requirePasswordChangeAtFirstLogin: 'true',
      }).success
    ).toBe(false);
    expect(
      patchAdminSettingsRequestSchema.safeParse({
        voiceRanges: {
          ...DEFAULT_VOICE_RANGES,
          S: {
            comfortable: { low: 'C4', high: 'G5' },
            hard: { low: 'C4', high: 'F5' },
          },
        },
      }).success
    ).toBe(false);
    expect(
      patchAdminSettingsRequestSchema.safeParse({
        ...settings,
        extra: true,
      }).success
    ).toBe(false);
  });

  it('validates the full PATCH response shape', () => {
    expect(patchAdminSettingsResponseSchema.parse(settings)).toEqual(settings);
  });
});
