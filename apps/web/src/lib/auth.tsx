import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type {
  ChangePasswordRequest,
  ChangePasswordResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MeResponse,
  SafeUser,
} from '@choirscore/shared';
import { ApiError, subscribeToPasswordChangeRequired } from './apiClient';
import { apiJson, jsonRequest } from './api';

export type AuthStatus =
  'loading' | 'authenticated' | 'anonymous' | 'forced-change' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  user: SafeUser | null;
  error: string | null;
  refreshUser: () => Promise<SafeUser | null>;
  signIn: (username: string, password: string) => Promise<SafeUser>;
  signOut: () => Promise<void>;
  changePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<SafeUser>;
  updateUser: (user: SafeUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function requiresForcedPasswordChange(error: unknown) {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.code === 'PASSWORD_CHANGE_REQUIRED'
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The service could not be reached. Please try again.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SafeUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const result = await apiJson<MeResponse>('/auth/me');
      setUser(result.user);
      setStatus('authenticated');
      return result.user;
    } catch (caught) {
      setUser(null);
      if (requiresForcedPasswordChange(caught)) {
        setStatus('forced-change');
        return null;
      }
      if (
        caught instanceof ApiError &&
        (caught.status === 401 || caught.status === 403)
      ) {
        setStatus('anonymous');
        return null;
      }
      setError(getErrorMessage(caught));
      setStatus('error');
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  useEffect(
    () =>
      subscribeToPasswordChangeRequired(() => {
        setError(null);
        setStatus('forced-change');
      }),
    []
  );

  const signIn = useCallback(async (username: string, password: string) => {
    const request: LoginRequest = { username, password };
    const result = await apiJson<LoginResponse>(
      '/auth/login',
      jsonRequest('POST', request)
    );
    setUser(result.user);
    setError(null);
    setStatus('authenticated');
    return result.user;
  }, []);

  const signOut = useCallback(async () => {
    await apiJson<LogoutResponse>('/auth/logout', jsonRequest('POST'));
    setUser(null);
    setError(null);
    setStatus('anonymous');
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const request: ChangePasswordRequest = { currentPassword, newPassword };
      const result = await apiJson<ChangePasswordResponse>(
        '/auth/change-password',
        jsonRequest('POST', request)
      );
      setUser(result.user);
      setError(null);
      setStatus('authenticated');
      return result.user;
    },
    []
  );

  const updateUser = useCallback((nextUser: SafeUser) => {
    setUser(nextUser);
    setStatus('authenticated');
    setError(null);
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      error,
      refreshUser,
      signIn,
      signOut,
      changePassword,
      updateUser,
    }),
    [
      status,
      user,
      error,
      refreshUser,
      signIn,
      signOut,
      changePassword,
      updateUser,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export function AuthLoading({
  message = 'Checking your secure session…',
}: {
  message?: string;
}) {
  return (
    <main className="auth-state-page" aria-busy="true">
      <span className="loading-spinner" aria-hidden="true" />
      <p>{message}</p>
    </main>
  );
}

export function AuthGate({
  children,
  adminOnly = false,
}: {
  children: ReactNode;
  adminOnly?: boolean;
}) {
  const { status, user, error, refreshUser } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <AuthLoading />;
  if (status === 'error') {
    return (
      <main className="auth-state-page">
        <div className="auth-state-card" role="alert">
          <span
            className="status-symbol status-symbol--error"
            aria-hidden="true"
          >
            !
          </span>
          <h1>We couldn’t check your session</h1>
          <p>
            {error ?? 'The service could not be reached. Please try again.'}
          </p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => void refreshUser()}
          >
            Retry
          </button>
        </div>
      </main>
    );
  }
  if (status === 'forced-change') {
    return location.pathname === '/change-password' ? (
      <>{children}</>
    ) : (
      <Navigate to="/change-password" replace />
    );
  }
  if (status === 'anonymous' || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  if (adminOnly && user.role !== 'admin') {
    return (
      <main className="auth-state-page">
        <div className="auth-state-card" role="alert">
          <span
            className="status-symbol status-symbol--error"
            aria-hidden="true"
          >
            !
          </span>
          <h1>Administrator access required</h1>
          <p>Your account does not have permission to manage choir users.</p>
          <a className="button button--primary" href="/library">
            Return to the library
          </a>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}
