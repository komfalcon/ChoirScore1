import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthLoading, useAuth } from '../lib/auth';

export function LoginPage() {
  const { status, user, signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  if (status === 'loading')
    return <AuthLoading message="Opening your choir workspace…" />;
  if (status === 'forced-change')
    return <Navigate to="/change-password" replace />;
  if (status === 'authenticated' && user) {
    return (
      <Navigate
        to={user.mustChangePassword ? '/change-password' : '/library'}
        replace
      />
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanUsername = username.trim();
    if (!cleanUsername || !password) {
      setError('Enter your username and password to continue.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const signedInUser = await signIn(cleanUsername, password);
      const state = location.state as { from?: { pathname?: string } } | null;
      const requestedPath = state?.from?.pathname;
      const destination =
        requestedPath?.startsWith('/') && requestedPath !== '/login'
          ? requestedPath
          : '/library';
      navigate(
        signedInUser.mustChangePassword ? '/change-password' : destination,
        { replace: true }
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'We couldn’t sign you in. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="skip-link-slot">
        <a className="skip-link" href="#login-main">
          Skip to sign in
        </a>
      </div>
      <header className="login-header">
        <Link className="brand" to="/" aria-label="ChoirScore home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" focusable="false">
              <path d="M19 5v17.2a4.8 4.8 0 1 1-2-3.9V9.2l10-2.1v12.1a4.8 4.8 0 1 1-2-3.9V4.8L19 5Z" />
            </svg>
          </span>
          <span className="brand-name">ChoirScore</span>
        </Link>
        <span className="private-label">
          <span className="private-label__dot" aria-hidden="true" />
          <span className="private-label__full">Private choir workspace</span>
          <span className="private-label__compact">Private choir</span>
        </span>
      </header>

      <main className="login-main" id="login-main">
        <section className="login-intro" aria-labelledby="login-title">
          <p className="eyebrow">KINGS &amp; QUEENS CHOIR</p>
          <h1 id="login-title">Your music, ready for rehearsal.</h1>
          <p>
            Sign in to open your choir’s private scores and rehearsal tools.
          </p>
          <div className="login-note">
            <span className="login-note__icon" aria-hidden="true">
              ♬
            </span>
            <span>
              Accounts are created by your choir administrator. There is no
              public sign-up.
            </span>
          </div>
        </section>

        <section className="login-card" aria-label="Sign in">
          <div className="login-card__heading">
            <span className="eyebrow">WELCOME BACK</span>
            <h2>Sign in</h2>
            <p>Use the username and password provided to you.</p>
          </div>
          <form className="form-stack" onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label htmlFor="login-username">Username</label>
              <input
                id="login-username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={submitting}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="login-password">Password</label>
              <div className="password-field">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                  required
                />
                <button
                  className="password-field__toggle"
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
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
                  <span className="button-spinner" aria-hidden="true" /> Signing
                  in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
          <div className="login-card__footer">
            <span className="secure-mark" aria-hidden="true">
              ◈
            </span>
            <span>
              Your sign-in is protected by your choir’s private workspace.
            </span>
          </div>
        </section>
      </main>
      <footer className="login-footer">
        <span>ChoirScore · Kings &amp; Queens Choir</span>
        <Link to="/">Service status</Link>
      </footer>
    </div>
  );
}
