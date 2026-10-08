import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormAlert } from '../components/FormAlert';
import { ApiError } from './apiClient';
import { getBulkUsernameTakenFeedback } from './bulkUserErrors';

const usernameTakenError = () =>
  new ApiError(409, {
    code: 'USERNAME_TAKEN',
    message: 'The requested username is already in use.',
  });

describe('bulk username conflict feedback', () => {
  it('does not mark every username row invalid for a generic 409 response', () => {
    const feedback = getBulkUsernameTakenFeedback(usernameTakenError());

    expect(feedback).not.toBeNull();
    expect(feedback?.fieldErrors).toEqual({});
    expect(
      [1, 2, 3].filter((rowId) =>
        Object.hasOwn(feedback?.fieldErrors ?? {}, `bulk-${rowId}-username`)
      )
    ).toEqual([]);
    expect(feedback?.formError).toMatch(/one or more usernames in this batch/i);
  });

  it('renders the batch error as an accessible form-level alert', () => {
    const feedback = getBulkUsernameTakenFeedback(usernameTakenError());
    expect(feedback).not.toBeNull();

    const markup = renderToStaticMarkup(
      createElement(FormAlert, { message: feedback?.formError ?? '' })
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain(feedback?.formError ?? '');
  });

  it('does not treat non-409 errors as username conflicts', () => {
    expect(
      getBulkUsernameTakenFeedback(
        new ApiError(400, {
          code: 'USERNAME_TAKEN',
          message: 'Invalid request.',
        })
      )
    ).toBeNull();
  });
});
