import { describe, expect, it } from 'vitest';
import {
  getAdminSettingsResponseSchema,
  patchAdminSettingsRequestSchema,
  patchAdminSettingsResponseSchema,
} from './index.js';

const settings = { requirePasswordChangeAtFirstLogin: true };

describe('Admin Settings contract schemas', () => {
  it('validates the GET response shape', () => {
    expect(getAdminSettingsResponseSchema.parse(settings)).toEqual(settings);
    expect(
      getAdminSettingsResponseSchema.safeParse({ ...settings, extra: true })
        .success
    ).toBe(false);
  });

  it('requires a boolean setting in the PATCH request and rejects extra fields', () => {
    expect(patchAdminSettingsRequestSchema.parse(settings)).toEqual(settings);
    expect(
      patchAdminSettingsRequestSchema.safeParse({
        requirePasswordChangeAtFirstLogin: 'true',
      }).success
    ).toBe(false);
    expect(
      patchAdminSettingsRequestSchema.safeParse({
        ...settings,
        extra: true,
      }).success
    ).toBe(false);
  });

  it('validates the PATCH response shape', () => {
    expect(patchAdminSettingsResponseSchema.parse(settings)).toEqual(settings);
    expect(
      patchAdminSettingsResponseSchema.safeParse({
        requirePasswordChangeAtFirstLogin: false,
      }).success
    ).toBe(true);
  });
});
