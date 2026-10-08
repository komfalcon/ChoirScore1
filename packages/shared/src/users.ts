import { z } from 'zod';

export const roleSchema = z.enum(['admin', 'director', 'member']);
export type Role = z.infer<typeof roleSchema>;

export const voicePartSchema = z.enum(['S', 'A', 'T', 'B', 'none']);
export type VoicePart = z.infer<typeof voicePartSchema>;

export const staffedVoicePartSchema = z.enum(['S', 'A', 'T', 'B']);
export type StaffedVoicePart = z.infer<typeof staffedVoicePartSchema>;

/** A role and voice-part combination that may be persisted for a user. */
export const userRoleVoicePartSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('member'), voicePart: staffedVoicePartSchema }),
  z.object({
    role: z.enum(['admin', 'director']),
    voicePart: z.literal('none'),
  }),
]);
export type UserRoleVoicePart = z.infer<typeof userRoleVoicePartSchema>;

const safeUserFields = {
  id: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().min(1),
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  aiEnabled: z.boolean(),
  aiDailyLimit: z.number().int().nonnegative().nullable(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
};

/** Public user data. Unknown fields (including credential/hash fields) are stripped. */
export const safeUserSchema = z.discriminatedUnion('role', [
  z.object({
    ...safeUserFields,
    role: z.literal('member'),
    voicePart: staffedVoicePartSchema,
  }),
  z.object({
    ...safeUserFields,
    role: z.enum(['admin', 'director']),
    voicePart: z.literal('none'),
  }),
]);
export type SafeUser = z.infer<typeof safeUserSchema>;

export const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
});
export type Credentials = z.infer<typeof credentialsSchema>;

const displayNameSchema = z.string().trim().min(1);
const usernameSchema = z.string().trim().min(1);
const suppliedPasswordSchema = z.string().min(8);

const memberCreateUserRequestSchema = z.object({
  displayName: displayNameSchema,
  username: usernameSchema.optional(),
  password: suppliedPasswordSchema.optional(),
  role: z.literal('member'),
  voicePart: staffedVoicePartSchema,
});

const privilegedCreateUserRequestSchema = z.object({
  displayName: displayNameSchema,
  username: usernameSchema.optional(),
  password: suppliedPasswordSchema.optional(),
  role: z.enum(['admin', 'director']),
  voicePart: z.literal('none').default('none'),
});

/** Create requests require a role; admin/director voicePart defaults to "none". */
export const createUserRequestSchema = z.discriminatedUnion('role', [
  memberCreateUserRequestSchema,
  privilegedCreateUserRequestSchema,
]);
export type CreateUserRequest = z.input<typeof createUserRequestSchema>;
export type ParsedCreateUserRequest = z.output<typeof createUserRequestSchema>;

const bulkMemberRowSchema = z.object({
  displayName: displayNameSchema,
  username: usernameSchema.optional(),
  password: suppliedPasswordSchema.optional(),
  role: z.literal('member').default('member'),
  voicePart: staffedVoicePartSchema,
});

const bulkPrivilegedRowSchema = z.object({
  displayName: displayNameSchema,
  username: usernameSchema.optional(),
  password: suppliedPasswordSchema.optional(),
  role: z.enum(['admin', 'director']),
  voicePart: z.literal('none').default('none'),
});

/** A missing role in a bulk row defaults to member, so voicePart is then required. */
export const bulkCreateUserRowSchema = z.union([
  bulkMemberRowSchema,
  bulkPrivilegedRowSchema,
]);
export type BulkCreateUserRow = z.input<typeof bulkCreateUserRowSchema>;
export type ParsedBulkCreateUserRow = z.output<typeof bulkCreateUserRowSchema>;

export const bulkCreateUsersRequestSchema = z.object({
  users: z.array(bulkCreateUserRowSchema).min(1),
});
export type BulkCreateUsersRequest = z.input<
  typeof bulkCreateUsersRequestSchema
>;
export type ParsedBulkCreateUsersRequest = z.output<
  typeof bulkCreateUsersRequestSchema
>;

const updateUserRequestBaseSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    username: usernameSchema.optional(),
    role: roleSchema.optional(),
    voicePart: voicePartSchema.optional(),
    aiEnabled: z.boolean().optional(),
    aiDailyLimit: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();

/**
 * A role change to member must include a staffed voice part. Admin/director role
 * changes default to "none". If only voicePart changes, the API must validate it
 * against the user's stored role after merging the patch.
 */
export const updateUserRequestSchema = updateUserRequestBaseSchema
  .superRefine((patch, context) => {
    if (Object.keys(patch).length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'At least one field must be provided.',
      });
    }

    if (patch.role === 'member' && !patch.voicePart) {
      context.addIssue({
        code: 'custom',
        path: ['voicePart'],
        message: 'A member must have voicePart S, A, T, or B.',
      });
    }

    if (
      (patch.role === 'admin' || patch.role === 'director') &&
      patch.voicePart !== undefined &&
      patch.voicePart !== 'none'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['voicePart'],
        message: 'An admin or director must have voicePart none.',
      });
    }

    if (patch.role === 'member' && patch.voicePart === 'none') {
      context.addIssue({
        code: 'custom',
        path: ['voicePart'],
        message: 'A member must have voicePart S, A, T, or B.',
      });
    }
  })
  .transform((patch) => {
    if (
      (patch.role === 'admin' || patch.role === 'director') &&
      patch.voicePart === undefined
    ) {
      return { ...patch, voicePart: 'none' as const };
    }
    return patch;
  });
export type UpdateUserRequest = z.input<typeof updateUserRequestSchema>;
export type ParsedUpdateUserRequest = z.output<typeof updateUserRequestSchema>;

export const createUserResponseSchema = z.object({
  user: safeUserSchema,
  credentials: credentialsSchema,
});
export type CreateUserResponse = z.infer<typeof createUserResponseSchema>;

export const bulkCreateUserResultSchema = z.object({
  user: safeUserSchema,
  credentials: credentialsSchema,
});
export type BulkCreateUserResult = z.infer<typeof bulkCreateUserResultSchema>;

export const bulkCreateUsersResponseSchema = z.object({
  users: z.array(bulkCreateUserResultSchema),
});
export type BulkCreateUsersResponse = z.infer<
  typeof bulkCreateUsersResponseSchema
>;

export const userListResponseSchema = z.object({
  users: z.array(safeUserSchema),
});
export type UserListResponse = z.infer<typeof userListResponseSchema>;

export const userResponseSchema = z.object({ user: safeUserSchema });
export type UserResponse = z.infer<typeof userResponseSchema>;
export const updateUserResponseSchema = userResponseSchema;
export type UpdateUserResponse = UserResponse;

/** Reset-password is a body-less POST; the new credentials are returned once. */
export const resetPasswordRequestSchema = z.undefined();
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const resetPasswordResponseSchema = z.object({
  credentials: credentialsSchema,
});
export type ResetPasswordResponse = z.infer<typeof resetPasswordResponseSchema>;
