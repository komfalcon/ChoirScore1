import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminSettingsPage } from './pages/AdminSettingsPage';
import { AdminUsagePage } from './pages/AdminUsagePage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { HealthPage } from './pages/HealthPage';
import { LibraryPage } from './pages/LibraryPage';
import { LoginPage } from './pages/LoginPage';
import { ScoreEditPage } from './pages/ScoreEditPage';
import { ScoreViewPage } from './pages/ScoreViewPage';
import { AuthGate, AuthProvider } from './lib/auth';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<HealthPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/change-password"
          element={
            <AuthGate>
              <ChangePasswordPage />
            </AuthGate>
          }
        />
        <Route
          path="/library"
          element={
            <AuthGate>
              <LibraryPage />
            </AuthGate>
          }
        />
        <Route
          path="/score/:id"
          element={
            <AuthGate>
              <ScoreViewPage />
            </AuthGate>
          }
        />
        <Route
          path="/score/:id/edit"
          element={
            <AuthGate>
              <ScoreEditPage />
            </AuthGate>
          }
        />
        <Route
          path="/admin/users"
          element={
            <AuthGate adminOnly>
              <AdminUsersPage />
            </AuthGate>
          }
        />
        <Route
          path="/admin/usage"
          element={
            <AuthGate adminOnly>
              <AdminUsagePage />
            </AuthGate>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <AuthGate adminOnly>
              <AdminSettingsPage />
            </AuthGate>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
