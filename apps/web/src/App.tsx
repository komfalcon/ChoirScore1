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

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HealthPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route path="/library" element={<LibraryPage />} />
      <Route path="/score/:id" element={<ScoreViewPage />} />
      <Route path="/score/:id/edit" element={<ScoreEditPage />} />
      <Route path="/admin/users" element={<AdminUsersPage />} />
      <Route path="/admin/usage" element={<AdminUsagePage />} />
      <Route path="/admin/settings" element={<AdminSettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
