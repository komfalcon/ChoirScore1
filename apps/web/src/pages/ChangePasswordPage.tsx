import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { useAuth } from '../lib/auth';
import { truncateUtf8Bytes, utf8ByteLength } from '../lib/userValidation';

export function ChangePasswordPage() {
  const { user, status, changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const forced =
    status === 'forced-change' || Boolean(user?.mustChangePassword);

  useEffect(() => {
    if (success) continueButtonRef.current?.focus({ preventScroll: true });
  }, [success]);

  useEffect(() => {
    if (forced) headingRef.current?.focus({ preventScroll: true });
  }, [forced]);

  function reportValidation(nextErrors: Record<string, string>) {
    setFieldErrors(nextErrors);
    setError('Review the highlighted password fields.');
    const firstInvalidId = Object.keys(nextErrors)[0];
    if (firstInvalidId) {
      window.requestAnimationFrame(() => {
        document.getElementById(firstInvalidId)?.focus();
      });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess(false);
    const validationErrors: Record<string, string> = {};
    if (!currentPassword)
      validationErrors['current-password'] = 'Enter your current password.';
    if (!newPassword)
      validationErrors['new-password'] = 'Enter a new password.';
    if (!confirmPassword)
      validationErrors['confirm-password'] = 'Confirm your new password.';
    if (Object.keys(validationErrors).length) {
      reportValidation(validationErrors);
      return;
    }
    if (newPassword.length < 8) {
      reportValidation({
        'new-password': 'Your new password must be at least 8 characters.',
      });
      return;
    }
    if (utf8ByteLength(newPassword) > 72) {
      reportValidation({
        'new-password':
          'Your new password must be no more than 72 UTF-8 bytes.',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      reportValidation({
        'confirm-password': 'The new password and confirmation do not match.',
      });
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Your password could not be changed. Try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-page">
      <AppHeader />
      <main className="change-password-main" id="main-content" tabIndex={-1}>
        <section
          className="change-password-card"
          aria-labelledby="change-password-title"
        >
          <div className="change-password-card__icon" aria-hidden="true">
            ⌑
          </div>
          <p className="eyebrow">ACCOUNT SECURITY</p>
          <h1 id="change-password-title" ref={headingRef} tabIndex={-1}>
            {forced ? 'Set a new password' : 'Change your password'}
          </h1>
          <p className="change-password-copy">
            {forced
              ? 'For your security, choose a personal password before continuing to your choir workspace.'
              : 'Choose a password you have not used for this account before.'}
          </p>

          {success ? (
            <div
              className="change-password-success"
              role="status"
              aria-live="polite"
            >
              <span
                className="status-symbol status-symbol--success"
                aria-hidden="true"
              >
                ✓
              </span>
              <div>
                <strong>Password updated</strong>
                <p>Your new password is ready to use.</p>
              </div>
              <button
                className="button button--primary button--wide"
                type="button"
                ref={continueButtonRef}
                onClick={() => navigate('/library', { replace: true })}
              >
                Continue to your library
              </button>
            </div>
          ) : (
            <form className="form-stack" onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label htmlFor="current-password">Current password</label>
                <input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => {
                    setCurrentPassword(
                      truncateUtf8Bytes(event.target.value, 72)
                    );
                    setError('');
                    setFieldErrors((current) => {
                      const next = { ...current };
                      delete next['current-password'];
                      return next;
                    });
                  }}
                  disabled={submitting}
                  required
                  aria-invalid={
                    fieldErrors['current-password'] ? true : undefined
                  }
                  aria-describedby={
                    fieldErrors['current-password']
                      ? 'current-password-error'
                      : undefined
                  }
                />
                {fieldErrors['current-password'] ? (
                  <span className="field-error" id="current-password-error">
                    {fieldErrors['current-password']}
                  </span>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="new-password">New password</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => {
                    setNewPassword(event.target.value);
                    setError('');
                    setFieldErrors((current) => {
                      const next = { ...current };
                      delete next['new-password'];
                      return next;
                    });
                  }}
                  disabled={submitting}
                  minLength={8}
                  required
                  aria-invalid={fieldErrors['new-password'] ? true : undefined}
                  aria-describedby={
                    fieldErrors['new-password']
                      ? 'new-password-help new-password-error'
                      : 'new-password-help'
                  }
                />
                <span className="field-help" id="new-password-help">
                  Use at least 8 characters and no more than 72 UTF-8 bytes.
                </span>
                {fieldErrors['new-password'] ? (
                  <span className="field-error" id="new-password-error">
                    {fieldErrors['new-password']}
                  </span>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="confirm-password">Confirm new password</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    setError('');
                    setFieldErrors((current) => {
                      const next = { ...current };
                      delete next['confirm-password'];
                      return next;
                    });
                  }}
                  disabled={submitting}
                  minLength={8}
                  required
                  aria-invalid={
                    fieldErrors['confirm-password'] ? true : undefined
                  }
                  aria-describedby={
                    fieldErrors['confirm-password']
                      ? 'confirm-password-error'
                      : undefined
                  }
                />
                {fieldErrors['confirm-password'] ? (
                  <span className="field-error" id="confirm-password-error">
                    {fieldErrors['confirm-password']}
                  </span>
                ) : null}
              </div>
              {error ? (
                <div className="form-alert form-alert--error" role="alert">
                  {error}
                </div>
              ) : null}
              <button
                className="button button--primary button--wide"
                type="submit"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <span className="button-spinner" aria-hidden="true" />{' '}
                    Saving password…
                  </>
                ) : (
                  'Save new password'
                )}
              </button>
            </form>
          )}
          <div className="change-password-footnote">
            {user ? (
              <>
                Signed in as <strong>{user.displayName}</strong>
              </>
            ) : (
              'Account identity is protected during password setup.'
            )}
          </div>
        </section>
      </main>
      <footer className="app-footer">
        <span>ChoirScore · Private choir workspace</span>
        <span>Account security</span>
      </footer>
    </div>
  );
}
