import { describe, expect, it } from 'vitest';
import {
  bulkCreateUsersRequestSchema,
  createUserRequestSchema,
  credentialsSchema,
  roleSchema,
  safeUserSchema,
  updateUserRequestSchema,
  userRoleVoicePartSchema,
  voicePartSchema,
} from './index.js';

const voiceParts = ['S', 'A', 'T', 'B', 'none'] as const;
const roles = ['admin', 'director', 'member'] as const;
const validMemberParts = new Set(['S', 'A', 'T', 'B']);

const memberUser = {
  id: 'user-1',
  username: 'jane.doe',
  displayName: 'Jane Doe',
  role: 'member' as const,
  voicePart: 'A' as const,
  isActive: true,
  mustChangePassword: false,
  aiEnabled: true,
  aiDailyLimit: null,
  lastLoginAt: null,
  createdAt: '2026-10-08T00:00:00.000Z',
};

describe('role and voice-part contract', () => {
  it('exports exactly the agreed role and voice-part enum values', () => {
    expect(roles.every((role) => roleSchema.safeParse(role).success)).toBe(
      true
    );
    expect(roleSchema.safeParse('owner').success).toBe(false);
    expect(
      voiceParts.every((part) => voicePartSchema.safeParse(part).success)
    ).toBe(true);
    expect(voicePartSchema.safeParse('alto').success).toBe(false);
  });

  it.each(
    roles.flatMap((role) => voiceParts.map((voicePart) => [role, voicePart]))
  )('%s with voicePart %s is %s', (role, voicePart) => {
    const result = userRoleVoicePartSchema.safeParse({ role, voicePart });
    const expected =
      role === 'member'
        ? validMemberParts.has(voicePart)
        : voicePart === 'none';
    expect(result.success).toBe(expected);
  });
});

describe('create user validation', () => {
  it('requires a voice part for members', () => {
    expect(
      createUserRequestSchema.safeParse({
        displayName: 'Jane Doe',
        role: 'member',
      }).success
    ).toBe(false);
    expect(
      createUserRequestSchema.safeParse({
        displayName: 'Jane Doe',
        role: 'member',
        voicePart: 'A',
      }).success
    ).toBe(true);
  });

  it.each(['admin', 'director'] as const)(
    '%s defaults voicePart to none',
    (role) => {
      expect(
        createUserRequestSchema.parse({ displayName: 'Alex Doe', role })
      ).toMatchObject({ role, voicePart: 'none' });
    }
  );

  it('rejects a staffed voice part for an admin or director', () => {
    expect(
      createUserRequestSchema.safeParse({
        displayName: 'Alex Doe',
        role: 'admin',
        voicePart: 'S',
      }).success
    ).toBe(false);
    expect(
      createUserRequestSchema.safeParse({
        displayName: 'Alex Doe',
        role: 'director',
        voicePart: 'B',
      }).success
    ).toBe(false);
  });

  it('caps supplied passwords at 72 UTF-8 bytes for bcrypt', () => {
    const withPassword = (password: string) =>
      createUserRequestSchema.safeParse({
        displayName: 'Jane Doe',
        role: 'member',
        voicePart: 'A',
        password,
      }).success;

    expect(withPassword('x'.repeat(72))).toBe(true);
    expect(withPassword('x'.repeat(73))).toBe(false);
    const multibyte72 = 'é'.repeat(36);
    expect(withPassword(multibyte72)).toBe(true);
    expect(withPassword(`${multibyte72}x`)).toBe(false);
    expect(
      bulkCreateUsersRequestSchema.safeParse({
        users: [
          { displayName: 'Jane Doe', voicePart: 'A', password: multibyte72 },
        ],
      }).success
    ).toBe(true);
    expect(
      bulkCreateUsersRequestSchema.safeParse({
        users: [
          {
            displayName: 'Jane Doe',
            voicePart: 'A',
            password: `${multibyte72}x`,
          },
        ],
      }).success
    ).toBe(false);
    expect(
      credentialsSchema.safeParse({
        username: 'jane.doe',
        password: `${multibyte72}x`,
      }).success
    ).toBe(false);
  });
});

describe('safe user shape', () => {
  it('accepts the exact public fields and strips password/hash fields', () => {
    const parsed = safeUserSchema.parse({
      ...memberUser,
      password: 'never-return-this',
      passwordHash: 'never-return-this-either',
    });
    expect(parsed).toEqual(memberUser);
    expect(parsed).not.toHaveProperty('password');
    expect(parsed).not.toHaveProperty('passwordHash');
  });

  it('rejects a SafeUser with an invalid role/voice-part pairing', () => {
    expect(
      safeUserSchema.safeParse({ ...memberUser, voicePart: 'none' }).success
    ).toBe(false);
  });

  it('requires createdAt and lastLoginAt to be ISO-UTC timestamps', () => {
    expect(
      safeUserSchema.safeParse({
        ...memberUser,
        createdAt: '2026-10-08T08:47:51+01:00',
      }).success
    ).toBe(false);
    expect(
      safeUserSchema.safeParse({
        ...memberUser,
        lastLoginAt: '2026-10-08T07:47:51',
      }).success
    ).toBe(false);
    expect(
      safeUserSchema.safeParse({
        ...memberUser,
        lastLoginAt: '2026-10-08T07:47:51.000Z',
      }).success
    ).toBe(true);
  });
});

describe('user update validation', () => {
  it('rejects an empty update', () => {
    expect(updateUserRequestSchema.safeParse({}).success).toBe(false);
  });

  it('requires a staffed voice part when changing a role to member', () => {
    expect(updateUserRequestSchema.safeParse({ role: 'member' }).success).toBe(
      false
    );
    expect(
      updateUserRequestSchema.safeParse({ role: 'member', voicePart: 'none' })
        .success
    ).toBe(false);
    expect(
      updateUserRequestSchema.parse({ role: 'member', voicePart: 'T' })
    ).toMatchObject({ role: 'member', voicePart: 'T' });
  });

  it.each(
    roles.flatMap((role) => voiceParts.map((voicePart) => [role, voicePart]))
  )('validates %s role updates with voicePart %s', (role, voicePart) => {
    const result = updateUserRequestSchema.safeParse({ role, voicePart });
    const expected =
      role === 'member'
        ? validMemberParts.has(voicePart)
        : voicePart === 'none';
    expect(result.success).toBe(expected);
  });

  it.each(['admin', 'director'] as const)(
    '%s role change defaults voicePart to none',
    (role) => {
      expect(updateUserRequestSchema.parse({ role })).toMatchObject({
        role,
        voicePart: 'none',
      });
    }
  );

  it('rejects mismatched voice parts in an explicit privileged-role change', () => {
    expect(
      updateUserRequestSchema.safeParse({ role: 'admin', voicePart: 'S' })
        .success
    ).toBe(false);
    expect(
      updateUserRequestSchema.safeParse({ role: 'director', voicePart: 'B' })
        .success
    ).toBe(false);
  });

  it('allows a voice-only patch to be checked against the stored role by the API', () => {
    expect(updateUserRequestSchema.parse({ voicePart: 'S' })).toEqual({
      voicePart: 'S',
    });
    expect(
      userRoleVoicePartSchema.safeParse({ role: 'member', voicePart: 'none' })
        .success
    ).toBe(false);
  });
});

describe('bulk user validation', () => {
  it('defaults a missing bulk-row role to member', () => {
    expect(
      bulkCreateUsersRequestSchema.parse({
        users: [{ displayName: 'Jane Doe', voicePart: 'A' }],
      })
    ).toMatchObject({ users: [{ role: 'member', voicePart: 'A' }] });
  });

  it('rejects a member row without a voice part', () => {
    expect(
      bulkCreateUsersRequestSchema.safeParse({
        users: [{ displayName: 'Jane Doe' }],
      }).success
    ).toBe(false);
  });

  it('defaults admin/director rows to voicePart none', () => {
    expect(
      bulkCreateUsersRequestSchema.parse({
        users: [
          { displayName: 'Alex Admin', role: 'admin' },
          { displayName: 'Drew Director', role: 'director' },
        ],
      })
    ).toMatchObject({
      users: [
        { role: 'admin', voicePart: 'none' },
        { role: 'director', voicePart: 'none' },
      ],
    });
  });

  it('rejects the entire batch when any row is invalid', () => {
    const result = bulkCreateUsersRequestSchema.safeParse({
      users: [
        { displayName: 'Valid Member', voicePart: 'S' },
        { displayName: 'Missing Part' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty batch', () => {
    expect(bulkCreateUsersRequestSchema.safeParse({ users: [] }).success).toBe(
      false
    );
  });
});
