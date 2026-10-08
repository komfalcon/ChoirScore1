import { describe, expect, it } from 'vitest';
import { ApiError } from './apiClient';
import { requiresForcedPasswordChange } from './auth';

describe('forced password-change auth response', () => {
  it('recognizes only the 403 PASSWORD_CHANGE_REQUIRED envelope', () => {
    expect(
      requiresForcedPasswordChange(
        new ApiError(403, {
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'A password change is required.',
        })
      )
    ).toBe(true);
    expect(
      requiresForcedPasswordChange(
        new ApiError(403, {
          code: 'FORBIDDEN',
          message: 'Forbidden.',
        })
      )
    ).toBe(false);
    expect(
      requiresForcedPasswordChange(
        new ApiError(401, {
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'Unauthenticated.',
        })
      )
    ).toBe(false);
  });
});
