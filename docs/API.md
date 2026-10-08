# ChoirScore API

## Base path and status

Express routes are rooted at `/`. The web client calls the same-origin `/api` base; Vercel strips `/api` and forwards to the Pxxl API origin. `apps/web/vercel.json` still contains the unresolved Pxxl-origin placeholder; do not replace it with a guessed host or commit credentials.

M1 implements migration-backed user/auth/admin-settings routes and their security gates. **The live Vercel-to-Pxxl health check remains owner-deferred, pending, and not passed.** No preview or deployed service origin has been verified. Once deployment is configured, verify that `<preview-origin>/api/healthz` returns `200 { "ok": true }` through the rewrite. Local route tests do not change this status.

## Health

- `GET /healthz` and `GET /api/healthz` return `200 { "ok": true }` without authentication.

## Shared types

`@choirscore/shared` exports these schemas and inferred types from `packages/shared/src/index.ts`; the same names are available from `./auth.js` and `./users.js` within the package.

- Enums and public user: `roleSchema` / `Role` (`admin | director | member`), `voicePartSchema` / `VoicePart` (`S | A | T | B | none`), `staffedVoicePartSchema` / `StaffedVoicePart`, `userRoleVoicePartSchema` / `UserRoleVoicePart`, and `safeUserSchema` / `SafeUser`.
- Auth: `loginRequestSchema` / `LoginRequest`, `loginResponseSchema` / `LoginResponse`, `meResponseSchema` / `MeResponse`, `logoutResponseSchema` / `LogoutResponse`, `changePasswordRequestSchema` / `ChangePasswordRequest`, `changePasswordResponseSchema` / `ChangePasswordResponse`, and `apiErrorResponseSchema` / `ApiErrorResponse`.
- Admin Settings: `adminSettingsSchema` / `AdminSettings`, `getAdminSettingsResponseSchema` / `GetAdminSettingsResponse`, `patchAdminSettingsRequestSchema` / `PatchAdminSettingsRequest`, and `patchAdminSettingsResponseSchema` / `PatchAdminSettingsResponse`.
- User create/bulk/update/reset: `createUserRequestSchema` / `CreateUserRequest`, `createUserResponseSchema` / `CreateUserResponse`, `bulkCreateUserRowSchema` / `BulkCreateUserRow`, `bulkCreateUsersRequestSchema` / `BulkCreateUsersRequest`, `bulkCreateUserResultSchema` / `BulkCreateUserResult`, `bulkCreateUsersResponseSchema` / `BulkCreateUsersResponse`, `updateUserRequestSchema` / `UpdateUserRequest`, `updateUserResponseSchema` / `UpdateUserResponse`, `resetPasswordRequestSchema` / `ResetPasswordRequest`, and `resetPasswordResponseSchema` / `ResetPasswordResponse`.
- Supporting responses: `userListResponseSchema` / `UserListResponse`, `userResponseSchema` / `UserResponse`, and `credentialsSchema` / `Credentials`.
- Timestamps: `isoUtcTimestampSchema` / `IsoUtcTimestamp`.

`SafeUser` is `{ id, username, displayName, role, voicePart, isActive, mustChangePassword, aiEnabled, aiDailyLimit, lastLoginAt, createdAt }`. `aiDailyLimit` is a non-negative integer or `null`; timestamps are ISO-8601 UTC strings with a `Z` suffix. Passwords and hashes are never in `SafeUser` or ordinary user responses. `Credentials` is `{ username, password }` and is returned only by account creation, bulk creation, or password reset.

### Role and voice-part validation

- Roles are exactly `admin`, `director`, and `member`; voice parts are `S`, `A`, `T`, `B`, and `none`.
- A `member` must use a staffed voice part (`S`, `A`, `T`, or `B`). An `admin` or `director` must use `none`. Create requests default an omitted privileged-user voice part to `none`.
- A bulk row with no role defaults to `member`, and must therefore include a staffed voice part. Any invalid row rejects the complete request before accounts are stored; a persistence failure rolls back the complete bulk operation.
- For `PATCH /users/:id`, changing a role to `member` requires a staffed voice part in the same request. Changing to `admin` or `director` defaults an omitted voice part to `none`; an explicitly supplied voice part must be `none`. A voice-part-only patch is validated against the user's stored role. No member is persisted with `voicePart: none`.

## Authentication

Every state-changing request (`POST`, `PUT`, `PATCH`, or `DELETE`), including login, logout, and password change, requires `X-Requested-With: choirscore`.

| Method and path              | Request                                                                                                                         | Success                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `POST /auth/login`           | `{ "username": string, "password": string }`; shared schema requires 8+ characters and at most 72 UTF-8 bytes                   | `200 { "user": SafeUser }`                                                                               |
| `GET /auth/me`               | —                                                                                                                               | `200 { "user": SafeUser }` when password change is not pending; otherwise `403 PASSWORD_CHANGE_REQUIRED` |
| `POST /auth/logout`          | —                                                                                                                               | `204` with no JSON body; clears the session cookie                                                       |
| `POST /auth/change-password` | `{ "currentPassword": string, "newPassword": string }`; both passwords require at least 8 characters and at most 72 UTF-8 bytes | `200 { "user": SafeUser }`                                                                               |

A successful login sets a 7-day signed HS256 JWT in an `HttpOnly; Secure; SameSite=Lax` cookie. The cookie is named `choirscore_session`; `COOKIE_DOMAIN` is optional. The token is never returned in JSON. Logout is idempotent for missing/expired cookies; if a valid session is presented, the API re-checks that the account is still active before clearing it.

Passwords are hashed with bcrypt cost 12. User-supplied account-creation passwords and new passwords must contain at least 8 characters and no more than 72 UTF-8 bytes; `currentPassword` on password change is subject to the same 8-character minimum and 72-byte maximum. The byte limit is measured after UTF-8 encoding, not by JavaScript string length. Password change verifies the current password, stores only the new hash, and clears `mustChangePassword`. The byte ceiling prevents bcrypt's 72-byte input truncation from making distinct passwords equivalent. Short and overlong login attempts still receive the same generic `401 INVALID_CREDENTIALS` response and count toward the login throttle.

Login errors for unknown usernames, incorrect passwords, inactive accounts, and out-of-contract password lengths are the same generic `401 INVALID_CREDENTIALS` response. Attempts are counted per IP-and-normalized-username pair: the first five attempts in a fixed 60-second window are evaluated; the next attempt starts a 15-minute lockout and returns `429 RATE_LIMITED`. Successful attempts also count toward the threshold. Throttle state is stored atomically in the migration-backed libSQL database with a hashed pair key, and expired rows are pruned during login attempts. There is no 10,000-pair cap, and an active lockout survives an API process restart. Replicas share the throttle only if they use the same shared libSQL database; independent local SQLite files are not shared. Deployment topology remains unverified, and the trusted-proxy hop count must still be verified for client-IP attribution.

The API reloads the user record for every authenticated request and rejects deleted or inactive accounts. While `mustChangePassword` is true, **only** `POST /auth/change-password` and `POST /auth/logout` are allowed; this includes blocking `GET /auth/me` with `403 PASSWORD_CHANGE_REQUIRED`. The client should use the login response's `mustChangePassword` field to show the forced-change flow rather than requesting `/auth/me` first. There is no signup or email route. Passwords, password hashes, tokens, and one-time credentials must never be logged.

## Bootstrap administrator

On API startup, the migration runner applies numbered files in `apps/api/migrations/` and records them in `schema_migrations`. If and only if the database has no admin, the server creates the initial `admin` from `ADMIN_BOOTSTRAP_USERNAME` and `ADMIN_BOOTSTRAP_PASSWORD`. Both are required in that case; the password must be at least 8 characters and no more than 72 UTF-8 bytes. The bootstrap account is marked to change its password at first login. The server logs a secret-free warning to change the bootstrap password. Bootstrap credentials are never accepted through an HTTP route.

## Users

All `/users` routes are authentication-required and admin-only. `q` is an optional search string; responses contain only `SafeUser` values.

| Method and path                  | Request                            | Success                                                               |
| -------------------------------- | ---------------------------------- | --------------------------------------------------------------------- |
| `GET /users?q=<query>`           | —                                  | `200 { "users": SafeUser[] }`                                         |
| `POST /users`                    | `CreateUserRequest`                | `201 { "user": SafeUser, "credentials": Credentials }`                |
| `POST /users/bulk`               | `{ "users": BulkCreateUserRow[] }` | `201 { "users": [{ "user": SafeUser, "credentials": Credentials }] }` |
| `PATCH /users/:id`               | `UpdateUserRequest`                | `200 { "user": SafeUser }`                                            |
| `POST /users/:id/reset-password` | No JSON body                       | `200 { "credentials": Credentials }`                                  |
| `POST /users/:id/activate`       | No JSON body                       | `200 { "user": SafeUser }`                                            |
| `POST /users/:id/deactivate`     | No JSON body                       | `200 { "user": SafeUser }`                                            |

The API preserves at least one active administrator. `PATCH /users/:id` may not change the role of the last active administrator away from `admin`, and `POST /users/:id/deactivate` may not deactivate that account. These checks are atomic across concurrent user mutations. A rejected change returns `409 { "error": { "code": "LAST_ACTIVE_ADMIN_REQUIRED", "message": "At least one active administrator must remain." } }`. The UI should keep the user's current role/active state and show the message; it may retry after another administrator is active.

Create requests require `displayName` and `role`; `username` and `password` are optional. Bulk rows use the same fields, and a missing row role defaults to `member`. Usernames are normalized to lowercase. When omitted, a username is generated from the normalized display name using a `firstname.lastname` pattern and numeric collision suffix. When a password is omitted, a random 10-character password is generated from an alphabet that omits ambiguous `0/O` and `1/l/I` characters. Supplied passwords must be at least 8 characters and no more than 72 UTF-8 bytes.

Creation, bulk creation, and reset return credentials once in that response. Only password hashes are stored. Reads and updates never return credentials. Successful admin actions, including user list and admin-settings reads, write exactly one audit record; successful mutations insert it in the same transaction as the action. Authenticated `POST`, `PUT`, `PATCH`, or `DELETE` attempts under `/users` or `/admin` retain an audit row when rejected or failed, including CSRF, origin, authorization, validation, and resource denials. These rows contain the resolved actor, target, action, outcome, and safe error code; failure detail is `{}`. Denials with no valid actor, including anonymous or unauthenticated attempts, do not create durable audit rows; they are represented only by bounded, rate-limited security-event summaries with a safe reason code and count. No request bodies, headers, cookies, IPs, usernames, credentials, password hashes, tokens, generated credentials, or exception messages are included in those summaries. Deactivation is enforced on the next authenticated request, even for a previously issued cookie.

## Admin settings

Both routes are authentication-required and admin-only. The setting belongs on Admin Settings, not in the Users form. State-changing requests require `X-Requested-With: choirscore`.

- `GET /admin/settings` → `200 { "requirePasswordChangeAtFirstLogin": boolean }` (`GetAdminSettingsResponse`). An unset value defaults to `true`.
- `PATCH /admin/settings` accepts exactly `{ "requirePasswordChangeAtFirstLogin": boolean }` (`PatchAdminSettingsRequest`) and returns the same object with status `200` (`PatchAdminSettingsResponse`). The value applies to newly created and admin-reset accounts; it does not clear flags on existing users.

## Database and M1 boundaries

The API accesses SQLite/libSQL via a Drizzle-backed repository layer. Schema changes are migration-backed. The initial migration defines the PRD data tables and constraints/indexes; this M1 adds working bootstrap, auth, users, settings, and audit behavior only. There are **no M2 score-library, MusicXML, AI-job, playback, or editor routes** in this change. All persisted timestamps are ISO-8601 UTC strings.

JSON request bodies are limited to 1 MB by default and 6 MB for `/scores/*` upload requests. Helmet security headers are enabled. CORS accepts only exact origins from the comma-delimited `ALLOWED_ORIGIN` environment setting; wildcard origins are not used. Requests with no browser `Origin` are not given CORS permission headers.

## Errors

Errors use `{ "error": { "code": string, "message": string } }`.

- `400 VALIDATION_ERROR` — invalid payload, including role/voice-part mismatch or any invalid bulk row.
- `400 CURRENT_PASSWORD_INVALID` — current password did not match.
- `401 INVALID_CREDENTIALS` — generic login failure.
- `401 UNAUTHENTICATED` — missing/invalid session, or deleted/deactivated account.
- `403 FORBIDDEN` — authenticated user is not permitted to perform the action.
- `403 PASSWORD_CHANGE_REQUIRED` — forced password change is still pending.
- `403 CSRF_HEADER_REQUIRED` — missing or incorrect `X-Requested-With` on a state-changing request.
- `403 ORIGIN_NOT_ALLOWED` — request supplied an origin outside the exact allowlist.
- `404 NOT_FOUND` — requested resource does not exist, including unknown routes.
- `409 USERNAME_TAKEN` — requested username is already in use.
- `409 LAST_ACTIVE_ADMIN_REQUIRED` — role change or deactivation would leave no active administrator.
- `413 BODY_TOO_LARGE` — request exceeded its JSON size limit.
- `429 RATE_LIMITED` — login lockout is active.
- `500 INTERNAL_ERROR` — unexpected failure; internal database details are not returned.

## M1 server acceptance/security checklist

- [x] No public signup or email login flow.
- [x] Bootstrap admin is sourced only from environment variables when no admin exists.
- [x] Cost-12 bcrypt, password byte limit preventing silent truncation, minimum 8-character chosen passwords and one-time readable generated credentials.
- [x] Secure 7-day HttpOnly/SameSite=Lax cookie, active-user lookup per authenticated request.
- [x] Forced-change gate allows only change-password and logout; `/auth/me` is explicitly blocked.
- [x] Login throttle threshold, lockout and recovery, concurrent attempts across repository instances, bounded `SQLITE_BUSY` retry/exhaustion behavior, restart persistence, and safe behavior with 10,000 existing pairs are tested.
- [x] Exact CORS allowlist, Helmet, CSRF header and request-size limits are route-tested.
- [x] Successful admin actions and authenticated admin mutation attempts create redacted audit rows; unauthenticated denials create none and use bounded, rate-limited, redacted aggregate telemetry.
- [x] Deactivation immediately blocks the next authenticated request.
- [ ] Owner-deferred live Vercel-to-Pxxl check: **pending, not passed**.

## M1 integrated lifecycle acceptance

On 2026-10-08, the API-backed lifecycle passed on integrated `main` at `f185f8f71b4aeb3abc34a10b0a27ca465969df57` using a fresh, disposable file-backed SQLite database. The bootstrap admin was seeded at startup; bootstrap-admin login and first-login password change each returned `200`. Admin member creation returned `201` with forced password change enabled; member login returned `200`; `/auth/me` before changing the password returned `403 PASSWORD_CHANGE_REQUIRED`; password change returned `200`; the member's existing session worked before deactivation (`200`); admin deactivation returned `200` with `isActive=false`; and the first request after deactivation, using that same member cookie, returned `401 UNAUTHENTICATED`. The API suite on this exact SHA passed **31/31 tests**.

This lifecycle run used the create response to obtain the member's initial credentials for login, but did not independently assert the credentials-only-once behavior. That behavior is covered by the exact-main `writes exactly one redacted audit record for every successful admin route action` integration test: create, bulk-create, and reset responses include credentials, while the later normal user-list response omits password hashes and the known credential values; audits and application logs are also checked for secret leakage. Actual credential values are not recorded in this documentation.

The acceptance run used local SQLite and in-process API requests; it did not exercise the browser UI or production deployment and, by itself, does not verify cross-process contention. Separately, the API suite includes a concurrent-throttle test using two repository instances in one Node process; the process-level write queue serializes those writers, so that test also does not prove cross-process contention or real Turso/Pxxl database locking. The owner-deferred Vercel-to-Pxxl live-host check remains **pending, not passed**.
