# ChoirScore API

## Base path and current status

The Express API routes are rooted at `/`. The web client calls the same-origin `/api` base; Vercel is configured to strip `/api` and forward requests to the Pxxl API origin. The Pxxl origin in `apps/web/vercel.json` is still an unresolved placeholder. Do not replace it with a guessed host or commit credentials.

## Health

- `GET /healthz` returns `200 { "ok": true }` from the direct API health handler.
- The browser-visible `GET <preview-origin>/api/healthz` rewrite check is still pending, as noted below.

The authentication, user, and admin-settings routes below define the M1 contract and are not implemented by this contract-only change. The M0 Vercel-preview-to-Pxxl health check remains **pending, owner-deferred, and not passed**. No preview has been verified. Once the preview and service origin are configured, verify that `<preview-origin>/api/healthz` returns `200 { "ok": true }` through the rewrite.

## Shared types

`@choirscore/shared` exports the following schemas and inferred TypeScript types from `packages/shared/src/index.ts`; the same names are available from `./auth.js` and `./users.js` inside the package.

- Enums and public user: `roleSchema` / `Role` (`admin | director | member`), `voicePartSchema` / `VoicePart` (`S | A | T | B | none`), `staffedVoicePartSchema` / `StaffedVoicePart`, `userRoleVoicePartSchema` / `UserRoleVoicePart`, and `safeUserSchema` / `SafeUser`.
- Auth: `loginRequestSchema` / `LoginRequest`, `loginResponseSchema` / `LoginResponse`, `meResponseSchema` / `MeResponse`, `logoutResponseSchema` / `LogoutResponse`, `changePasswordRequestSchema` / `ChangePasswordRequest`, `changePasswordResponseSchema` / `ChangePasswordResponse`, and `apiErrorResponseSchema` / `ApiErrorResponse`.
- Admin Settings: `adminSettingsSchema` / `AdminSettings`, `getAdminSettingsResponseSchema` / `GetAdminSettingsResponse`, `patchAdminSettingsRequestSchema` / `PatchAdminSettingsRequest`, and `patchAdminSettingsResponseSchema` / `PatchAdminSettingsResponse`.
- User create/bulk/update/reset: `createUserRequestSchema` / `CreateUserRequest`, `createUserResponseSchema` / `CreateUserResponse`, `bulkCreateUserRowSchema` / `BulkCreateUserRow`, `bulkCreateUsersRequestSchema` / `BulkCreateUsersRequest`, `bulkCreateUserResultSchema` / `BulkCreateUserResult`, `bulkCreateUsersResponseSchema` / `BulkCreateUsersResponse`, `updateUserRequestSchema` / `UpdateUserRequest`, `updateUserResponseSchema` / `UpdateUserResponse`, `resetPasswordRequestSchema` / `ResetPasswordRequest`, and `resetPasswordResponseSchema` / `ResetPasswordResponse`.
- Parsed defaulted outputs are also exported as `ParsedCreateUserRequest`, `ParsedBulkCreateUserRow`, `ParsedBulkCreateUsersRequest`, and `ParsedUpdateUserRequest`.
- Supporting user responses: `userListResponseSchema` / `UserListResponse`, `userResponseSchema` / `UserResponse`, and `credentialsSchema` / `Credentials`.
- Timestamp: `isoUtcTimestampSchema` / `IsoUtcTimestamp`.

`SafeUser` is `{ id, username, displayName, role, voicePart, isActive, mustChangePassword, aiEnabled, aiDailyLimit, lastLoginAt, createdAt }`. `aiDailyLimit` is a number or `null`; `lastLoginAt` is an ISO-8601 UTC date-time string or `null`, and `createdAt` is an ISO-8601 UTC date-time string. Non-null timestamps must use a `Z` suffix, with no numeric offset or local time. Passwords and password hashes are never part of this type or an ordinary user response. `Credentials` is `{ username, password }` and is returned only by create, bulk create, and password reset.

### Role and voice-part validation

Roles are exactly `admin`, `director`, and `member`; voice parts are exactly `S`, `A`, `T`, `B`, and `none`. A member must have one of `S`, `A`, `T`, or `B`; only an admin or director may have `none`. Admin/director create requests default a missing voice part to `none`. A member create request must include a staffed voice part.

A create or bulk-create request is validated against the complete role/voice-part pair before persistence. In bulk rows, an omitted role defaults to `member`, so a row with no role must include `voicePart: S | A | T | B`. Any invalid row rejects the whole request before any account is created; after validation, bulk persistence must also be all-or-nothing.

For `PATCH /users/:id`, a role change to `member` requires an accompanying staffed voice part. A role change to `admin` or `director` defaults an omitted voice part to `none`; an explicitly supplied value must be `none`. If a patch changes only `voicePart`, the API must merge it with the stored role and validate the resulting pair before saving. No persisted member may have `voicePart: none`.

## Authentication

All state-changing requests—including login, logout, and password change—must include `X-Requested-With: choirscore`.

| Method and path              | Request                                                                                       | Success                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `POST /auth/login`           | `{ "username": string, "password": string }`                                                  | `200 { "user": SafeUser }`                                                                               |
| `GET /auth/me`               | —                                                                                             | `200 { "user": SafeUser }` when password change is not pending; otherwise `403 PASSWORD_CHANGE_REQUIRED` |
| `POST /auth/logout`          | —                                                                                             | `204` with no JSON body                                                                                  |
| `POST /auth/change-password` | `{ "currentPassword": string, "newPassword": string }`; new password is at least 8 characters | `200 { "user": SafeUser }`                                                                               |

Successful login sets a 7-day JWT in an `HttpOnly; Secure; SameSite=Lax` cookie. The token is never returned as JSON. Logout clears the cookie. Login failures use a generic `401` response with code `INVALID_CREDENTIALS`; do not reveal whether a username exists. The login response includes `mustChangePassword` in its user.

The API checks that the authenticated account is active on every request. While `mustChangePassword` is true, every route except `POST /auth/change-password` and `POST /auth/logout` returns `403` with code `PASSWORD_CHANGE_REQUIRED`; this includes `GET /auth/me`. The client must use the login response to present the forced-change flow rather than calling `/auth/me` first. There is no signup or email flow. Never log passwords, password hashes, JWTs, or one-time credentials.

### M1 server-test acceptance (not implemented by this shared-contract change)

The following are backend requirements for M1 and must be enforced and covered by server tests when the routes are implemented; the shared schemas in this change do not implement server behavior:

- With `mustChangePassword: true`, tests verify that only `POST /auth/change-password` and `POST /auth/logout` are available; `GET /auth/me` and all other routes are rejected with `403 PASSWORD_CHANGE_REQUIRED`. After a successful password change, normal authenticated routes become available.
- Passwords are stored only as hashes using Argon2id or bcrypt with cost at least 12. Tests verify that raw passwords are not persisted or exposed in responses.
- `POST /auth/login` is limited to 5 attempts per minute for each IP-and-username pair, followed by a 15-minute temporary lockout. Server tests cover the threshold, lockout, and recovery after it expires.

## Users

User-management routes are admin-only. `q` is an optional search query; responses contain `SafeUser` values only.

| Method and path                  | Request                            | Success                                                                                              |
| -------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /users?q=<query>`           | —                                  | `200 { "users": SafeUser[] }`                                                                        |
| `POST /users`                    | `CreateUserRequest`                | `201 { "user": SafeUser, "credentials": { "username": string, "password": string } }`                |
| `POST /users/bulk`               | `{ "users": BulkCreateUserRow[] }` | `201 { "users": [{ "user": SafeUser, "credentials": { "username": string, "password": string } }] }` |
| `PATCH /users/:id`               | `UpdateUserRequest`                | `200 { "user": SafeUser }`                                                                           |
| `POST /users/:id/reset-password` | No JSON body                       | `200 { "credentials": { "username": string, "password": string } }`                                  |
| `POST /users/:id/activate`       | No JSON body                       | `200 { "user": SafeUser }`                                                                           |
| `POST /users/:id/deactivate`     | No JSON body                       | `200 { "user": SafeUser }`                                                                           |

Create requests require `displayName` and `role`; `username` and `password` are optional. Bulk rows use the same fields, except a missing row role defaults to `member`. If no username is supplied, the API generates lowercase `firstname.lastname`, adding a numeric collision suffix when needed. If no password is supplied, the API generates a random 10-character password from an unambiguous alphabet. Supplied passwords must be at least 8 characters. Newly created and reset credentials are shown once in the corresponding response; normal reads and updates never return credentials.

`PATCH /users/:id` accepts `displayName`, `username`, `role`, `voicePart`, `aiEnabled`, and `aiDailyLimit` (a non-negative integer or `null`). An empty patch is invalid. Deactivation invalidates the user's sessions immediately. State-changing user requests require the `X-Requested-With` header.

## Admin settings

Both routes are admin-only. The setting belongs on Admin Settings, not in the Users form. State-changing requests require `X-Requested-With: choirscore`. The GET response and PATCH request/response are validated by the shared `getAdminSettingsResponseSchema`, `patchAdminSettingsRequestSchema`, and `patchAdminSettingsResponseSchema`.

- `GET /admin/settings` → `200 { "requirePasswordChangeAtFirstLogin": boolean }` (`GetAdminSettingsResponse`)
- `PATCH /admin/settings` accepts exactly `{ "requirePasswordChangeAtFirstLogin": boolean }` (`PatchAdminSettingsRequest`) and returns the same object with status `200` (`PatchAdminSettingsResponse`).

## Errors

Errors use the envelope `{ "error": { "code": string, "message": string } }`.

- `400 VALIDATION_ERROR` — invalid payload, including an invalid role/voice-part combination or any invalid bulk row.
- `401 INVALID_CREDENTIALS` — generic login failure.
- `403 FORBIDDEN` — authenticated user is not permitted to perform the action.
- `403 PASSWORD_CHANGE_REQUIRED` — forced password change is still pending.
- `404 NOT_FOUND` — requested resource does not exist.
- `409 USERNAME_TAKEN` — requested username is already in use.
