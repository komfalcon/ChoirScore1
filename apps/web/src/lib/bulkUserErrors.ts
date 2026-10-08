import { isUsernameTakenError } from './apiClient';

export const BULK_USERNAME_TAKEN_MESSAGE =
  'One or more usernames in this batch are already in use. Review and change the usernames, then try again.';

export function getBulkUsernameTakenFeedback(error: unknown) {
  if (!isUsernameTakenError(error)) return null;

  // The generic batch response does not identify which row conflicted.
  return {
    fieldErrors: {} as Record<string, string>,
    formError: BULK_USERNAME_TAKEN_MESSAGE,
  };
}
