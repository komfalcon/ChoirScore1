import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SafeUser } from '@choirscore/shared';
import { describe, expect, it, vi } from 'vitest';
import { RoleAndVoiceFields, UserActions } from './AdminUsersPage';

const admin: SafeUser = {
  id: 'admin-1',
  username: 'admin1',
  displayName: 'Choir Admin',
  role: 'admin',
  voicePart: 'none',
  isActive: true,
  mustChangePassword: false,
  aiEnabled: false,
  aiDailyLimit: null,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('last-admin restriction controls', () => {
  it('disables demotion choices and explains the role restriction accessibly', () => {
    const markup = renderToStaticMarkup(
      createElement(RoleAndVoiceFields, {
        draft: {
          displayName: admin.displayName,
          username: admin.username,
          role: 'admin',
          voicePart: 'none',
        },
        prefix: 'edit',
        lockAdminRole: true,
        onChange: vi.fn(),
      })
    );

    expect(markup).toMatch(/<option value="member" disabled="">/);
    expect(markup).toMatch(/<option value="director" disabled="">/);
    expect(markup).toContain('aria-describedby="edit-role-lock-help"');
    expect(markup).toContain('id="edit-role-lock-help"');
  });

  it('disables deactivation and provides a visible, associated explanation', () => {
    const markup = renderToStaticMarkup(
      createElement(UserActions, {
        user: admin,
        isOnlyActiveAdmin: true,
        onEdit: vi.fn(),
        onAction: vi.fn(),
      })
    );

    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby=/);
    expect(markup).toContain('Deactivate');
    expect(markup).toContain('At least one active administrator must remain.');
  });
});
