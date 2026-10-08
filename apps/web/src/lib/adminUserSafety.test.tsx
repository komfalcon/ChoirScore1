import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormAlert } from '../components/FormAlert';
import { ApiError } from './apiClient';
import {
  getLastActiveAdminFeedback,
  LAST_ACTIVE_ADMIN_ERROR_MESSAGE,
} from './adminUserSafety';

describe('accessible last-admin conflict alert', () => {
  it('renders the stable server conflict message as an alert', () => {
    const feedback = getLastActiveAdminFeedback(
      new ApiError(409, {
        code: 'LAST_ACTIVE_ADMIN_REQUIRED',
        message: 'At least one active administrator must remain.',
      })
    );
    expect(feedback).not.toBeNull();

    const markup = renderToStaticMarkup(
      createElement(FormAlert, { message: feedback?.message ?? '' })
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain(LAST_ACTIVE_ADMIN_ERROR_MESSAGE);
  });
});
