import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { useAuth } from '../lib/auth';

export function ChangePasswordPage() {
  const { user, status, changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const forced =
    status === 'forced-change' || Boolean(user?.mustChangePassword);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess(false);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Complete each password field to continue.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Your new password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new password and confirmation do not match.');
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
      <main className="change-password-main">
        <section
          className="change-password-card"
          aria-labelledby="change-password-title"
        >
          <div className="change-password-card__icon" aria-hidden="true">
            ⌑
          </div>
          <p className="eyebrow">ACCOUNT SECURITY</p>
          <h1 id="change-password-title">
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
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  disabled={submitting}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="new-password">New password</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  disabled={submitting}
                  minLength={8}
                  required
                />
                <span className="field-help">Use at least 8 characters.</span>
              </div>
              <div className="field">
                <label htmlFor="confirm-password">Confirm new password</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  disabled={submitting}
                  minLength={8}
                  required
                />
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
