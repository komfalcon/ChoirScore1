import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function AppHeader() {
  const { user, status, signOut } = useAuth();
  const [logoutError, setLogoutError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const forcedChange =
    status === 'forced-change' || Boolean(user?.mustChangePassword);
  const isAdmin = !forcedChange && user?.role === 'admin';
  const homePath = forcedChange ? '/change-password' : '/library';

  async function handleSignOut() {
    setSigningOut(true);
    setLogoutError('');
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (caught) {
      setLogoutError(
        caught instanceof Error ? caught.message : 'Sign out failed. Try again.'
      );
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="app-header">
      <Link
        className="brand"
        to={homePath}
        aria-label={
          forcedChange ? 'ChoirScore password update' : 'ChoirScore library'
        }
      >
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" focusable="false">
            <path d="M19 5v17.2a4.8 4.8 0 1 1-2-3.9V9.2l10-2.1v12.1a4.8 4.8 0 1 1-2-3.9V4.8L19 5Z" />
          </svg>
        </span>
        <span className="brand-name">ChoirScore</span>
      </Link>

      {!forcedChange ? (
        <nav className="app-nav" aria-label="Main navigation">
          <Link
            className={
              location.pathname.startsWith('/library')
                ? 'app-nav__link is-active'
                : 'app-nav__link'
            }
            to="/library"
            aria-current={
              location.pathname.startsWith('/library') ? 'page' : undefined
            }
          >
            Library
          </Link>
          {isAdmin ? (
            <>
              <Link
                className={
                  location.pathname === '/admin/users'
                    ? 'app-nav__link is-active'
                    : 'app-nav__link'
                }
                to="/admin/users"
                aria-current={
                  location.pathname === '/admin/users' ? 'page' : undefined
                }
              >
                Users
              </Link>
              <Link
                className={
                  location.pathname === '/admin/usage'
                    ? 'app-nav__link is-active'
                    : 'app-nav__link'
                }
                to="/admin/usage"
                aria-current={
                  location.pathname === '/admin/usage' ? 'page' : undefined
                }
              >
                Usage
              </Link>
              <Link
                className={
                  location.pathname === '/admin/settings'
                    ? 'app-nav__link is-active'
                    : 'app-nav__link'
                }
                to="/admin/settings"
                aria-current={
                  location.pathname === '/admin/settings' ? 'page' : undefined
                }
              >
                Settings
              </Link>
            </>
          ) : null}
        </nav>
      ) : null}

      <div className="app-header__account">
        {!forcedChange ? (
          <span className="account-avatar" aria-hidden="true">
            {user?.displayName.trim().charAt(0).toUpperCase() || 'C'}
          </span>
        ) : null}
        <span className="account-name">
          {forcedChange
            ? 'Password update required'
            : (user?.displayName ?? 'Choir member')}
        </span>
        <button
          className="button button--quiet button--small"
          type="button"
          onClick={() => void handleSignOut()}
          disabled={signingOut}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
      {logoutError ? (
        <span className="app-header__error" role="alert">
          {logoutError}
        </span>
      ) : null}
    </header>
  );
}
