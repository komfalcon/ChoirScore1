import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import { AppHeader } from '../components/AppHeader';
import type {
  BulkCreateUsersRequest,
  BulkCreateUsersResponse,
  CreateUserRequest,
  CreateUserResponse,
  Credentials,
  IsoUtcTimestamp,
  ResetPasswordRequest,
  ResetPasswordResponse,
  Role,
  SafeUser,
  StaffedVoicePart,
  UpdateUserRequest,
  UpdateUserResponse,
  UserListResponse,
  UserResponse,
  UserRoleVoicePart,
  VoicePart,
} from '@choirscore/shared';
import { apiJson, jsonRequest } from '../lib/api';
import { credentialsToCsv } from '../lib/credentialsExport';
import { focusTrapBoundaryIndex } from '../lib/dialogFocus';
import {
  parseBulkNameImport,
  suggestUsernameFromName,
  validateBulkUserDrafts,
  validatePasswordOverride,
  validateUserIdentity,
} from '../lib/userValidation';

type Feedback = { tone: 'success' | 'error'; message: string };
type DraftRoleFields = {
  displayName: string;
  username: string;
  role: Role;
  voicePart: VoicePart | '';
};
type EditDraft = DraftRoleFields & { aiEnabled: boolean; aiDailyLimit: string };
type CreateDraft = DraftRoleFields & { password: string };
type BulkDraft = DraftRoleFields & { rowId: number; password: string };
type Confirmation = {
  action: 'reset' | 'deactivate' | 'activate';
  user: SafeUser;
};
type RevealedCredential = {
  displayName: string;
} & Credentials;

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  director: 'Director',
  member: 'Choir member',
};
const VOICE_PARTS: StaffedVoicePart[] = ['S', 'A', 'T', 'B'];
const MODAL_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function newDraft(): DraftRoleFields {
  return { displayName: '', username: '', role: 'member', voicePart: '' };
}

function makeBulkRow(rowId: number): BulkDraft {
  return { ...newDraft(), rowId, password: '' };
}

function newCreateDraft(): CreateDraft {
  return { ...newDraft(), password: '' };
}

function roleLabel(role: Role) {
  return ROLE_LABELS[role];
}

function prettyDate(value: IsoUtcTimestamp | null) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

function identityFieldErrors(
  draft: DraftRoleFields & { password?: string },
  prefix: string,
  requireUsername = true
) {
  const errors: Record<string, string> = {};
  if (!draft.displayName.trim())
    errors[`${prefix}-display-name`] = 'Enter a display name.';
  if (requireUsername && !draft.username.trim())
    errors[`${prefix}-username`] = 'Enter a username.';
  if (
    draft.role === 'member' &&
    !VOICE_PARTS.includes(draft.voicePart as StaffedVoicePart)
  ) {
    errors[`${prefix}-voice`] = 'Choose a voice part for every choir member.';
  }
  const passwordError = validatePasswordOverride(draft.password ?? '');
  if (passwordError) errors[`${prefix}-password-override`] = passwordError;
  return errors;
}

function focusInvalidField(fieldId: string | undefined) {
  if (!fieldId) return;
  window.requestAnimationFrame(() => {
    const field = document.getElementById(fieldId);
    if (field instanceof HTMLElement) {
      field.focus();
      field.scrollIntoView({ block: 'nearest' });
    }
  });
}

function Modal({
  title,
  onClose,
  children,
  wide = false,
  className = '',
  restoreFocus,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  className?: string;
  restoreFocus: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR)
    ).filter((element) => element.getClientRects().length > 0);
    (controls[0] ?? dialog).focus({ preventScroll: true });
    return restoreFocus;
  }, [restoreFocus]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        MODAL_FOCUSABLE_SELECTOR
      )
    ).filter((element) => element.getClientRects().length > 0);
    if (!controls.length) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    const activeIndex = controls.indexOf(document.activeElement as HTMLElement);
    const boundaryIndex = focusTrapBoundaryIndex(
      activeIndex,
      controls.length,
      event.shiftKey
    );
    if (boundaryIndex !== null) {
      event.preventDefault();
      controls[boundaryIndex]?.focus();
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={`modal-card${wide ? ' modal-card--wide' : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="modal-card__heading">
          <div>
            <p className="eyebrow">CHOIRSCORE ADMIN</p>
            <h2 id="modal-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            data-print-hide
          >
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function RoleAndVoiceFields({
  draft,
  prefix,
  disabled,
  fieldErrors = {},
  onChange,
}: {
  draft: DraftRoleFields;
  prefix: string;
  disabled?: boolean;
  fieldErrors?: Record<string, string>;
  onChange: (next: DraftRoleFields) => void;
}) {
  const member = draft.role === 'member';
  const voiceError = fieldErrors[`${prefix}-voice`];
  return (
    <div className="form-grid form-grid--two">
      <div className="field">
        <label htmlFor={`${prefix}-role`}>Role</label>
        <select
          id={`${prefix}-role`}
          value={draft.role}
          disabled={disabled}
          onChange={(event) => {
            const role = event.target.value as Role;
            onChange({
              ...draft,
              role,
              voicePart: role === 'member' ? '' : 'none',
            });
          }}
        >
          <option value="member">Choir member</option>
          <option value="director">Director</option>
          <option value="admin">Administrator</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-voice`}>Voice part</label>
        <select
          id={`${prefix}-voice`}
          value={member ? draft.voicePart : 'none'}
          disabled={disabled || !member}
          required={member}
          aria-invalid={voiceError ? true : undefined}
          aria-describedby={
            voiceError
              ? `${prefix}-voice-help ${prefix}-voice-error`
              : `${prefix}-voice-help`
          }
          onChange={(event) =>
            onChange({
              ...draft,
              voicePart: event.target.value as VoicePart | '',
            })
          }
        >
          <option value="">Select a part</option>
          {VOICE_PARTS.map((part) => (
            <option key={part} value={part}>
              {part} ·{' '}
              {
                ({ S: 'Soprano', A: 'Alto', T: 'Tenor', B: 'Bass' } as const)[
                  part
                ]
              }
            </option>
          ))}
          {!member ? (
            <option value="none">Not applicable — staff</option>
          ) : null}
        </select>
        <span className="field-help" id={`${prefix}-voice-help`}>
          {member
            ? 'A voice part is required for choir members.'
            : 'Directors and administrators use “Not applicable — staff”.'}
        </span>
        {voiceError ? (
          <span className="field-error" id={`${prefix}-voice-error`}>
            {voiceError}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function FormIdentityFields({
  draft,
  prefix,
  disabled,
  suggestUsername = false,
  takenUsernames = [],
  fieldErrors = {},
  onChange,
}: {
  draft: DraftRoleFields;
  prefix: string;
  disabled?: boolean;
  suggestUsername?: boolean;
  takenUsernames?: string[];
  fieldErrors?: Record<string, string>;
  onChange: (next: DraftRoleFields) => void;
}) {
  const displayNameError = fieldErrors[`${prefix}-display-name`];
  const usernameError = fieldErrors[`${prefix}-username`];
  const suggestedUsername = suggestUsernameFromName(
    draft.displayName,
    takenUsernames
  );
  const usernameDescription = [
    suggestUsername ? `${prefix}-username-help` : '',
    usernameError ? `${prefix}-username-error` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <>
      <div className="field">
        <label htmlFor={`${prefix}-display-name`}>Display name</label>
        <input
          id={`${prefix}-display-name`}
          autoComplete="name"
          value={draft.displayName}
          disabled={disabled}
          onChange={(event) => {
            const displayName = event.target.value;
            const stillSuggested =
              draft.username === '' || draft.username === suggestedUsername;
            onChange({
              ...draft,
              displayName,
              username:
                suggestUsername && stillSuggested
                  ? displayName.trim()
                    ? suggestUsernameFromName(displayName, takenUsernames)
                    : ''
                  : draft.username,
            });
          }}
          required
          aria-invalid={displayNameError ? true : undefined}
          aria-describedby={
            displayNameError ? `${prefix}-display-name-error` : undefined
          }
        />
        {displayNameError ? (
          <span className="field-error" id={`${prefix}-display-name-error`}>
            {displayNameError}
          </span>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-username`}>
          {suggestUsername ? 'Suggested username' : 'Username'}
        </label>
        <input
          id={`${prefix}-username`}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={draft.username}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...draft, username: event.target.value })
          }
          required
          aria-invalid={usernameError ? true : undefined}
          aria-describedby={usernameDescription || undefined}
        />
        {suggestUsername ? (
          <span className="field-help" id={`${prefix}-username-help`}>
            {draft.username
              ? `Suggested username “${draft.username}” can be edited before saving.`
              : 'Enter a display name to generate an editable username suggestion.'}
          </span>
        ) : null}
        {usernameError ? (
          <span className="field-error" id={`${prefix}-username-error`}>
            {usernameError}
          </span>
        ) : null}
      </div>
      <RoleAndVoiceFields
        draft={draft}
        prefix={prefix}
        disabled={disabled}
        fieldErrors={fieldErrors}
        onChange={onChange}
      />
    </>
  );
}

function PasswordOverrideField({
  id,
  value,
  onChange,
  error = '',
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (password: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div className="field password-override-field">
      <label htmlFor={id}>
        Password override <span className="label-optional">· optional</span>
      </label>
      <input
        id={id}
        type="password"
        autoComplete="new-password"
        minLength={8}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-help ${id}-error` : `${id}-help`}
      />
      <span className="field-help" id={`${id}-help`}>
        Leave blank to generate a password. An override must be at least 8
        characters.
      </span>
      {error ? (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

function UserActions({
  user,
  onEdit,
  onAction,
}: {
  user: SafeUser;
  onEdit: () => void;
  onAction: (action: Confirmation['action'], user: SafeUser) => void;
}) {
  return (
    <div className="user-actions">
      <button
        className="button button--quiet button--small"
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${user.displayName}`}
      >
        Edit
      </button>
      <button
        className="button button--quiet button--small"
        type="button"
        onClick={() => onAction('reset', user)}
        aria-label={`Reset password for ${user.displayName}`}
      >
        Reset password
      </button>
      {user.isActive ? (
        <button
          className="button button--danger-quiet button--small"
          type="button"
          onClick={() => onAction('deactivate', user)}
          aria-label={`Deactivate ${user.displayName}`}
        >
          Deactivate
        </button>
      ) : (
        <button
          className="button button--quiet button--small"
          type="button"
          onClick={() => onAction('activate', user)}
          aria-label={`Reactivate ${user.displayName}`}
        >
          Reactivate
        </button>
      )}
    </div>
  );
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'inactive'
  >('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [dialog, setDialog] = useState<'create' | 'bulk' | 'edit' | null>(null);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(newCreateDraft);
  const [bulkRows, setBulkRows] = useState<BulkDraft[]>([makeBulkRow(1)]);
  const [bulkImportText, setBulkImportText] = useState('');
  const [bulkImportError, setBulkImportError] = useState('');
  const [bulkRowErrors, setBulkRowErrors] = useState<Record<number, string>>(
    {}
  );
  const [editUser, setEditUser] = useState<SafeUser | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [credentials, setCredentials] = useState<RevealedCredential[] | null>(
    null
  );
  const [copyMessage, setCopyMessage] = useState('');
  const nextRowId = useRef(2);
  const dialogOpenerRef = useRef<HTMLElement | null>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);

  const restoreDialogFocus = useCallback(() => {
    const opener = dialogOpenerRef.current;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }, []);

  function rememberDialogOpener() {
    const active = document.activeElement;
    dialogOpenerRef.current = active instanceof HTMLElement ? active : null;
  }

  const takenUsernames = users.map((user) => user.username);

  function clearFieldError(...fieldIds: string[]) {
    setFieldErrors((current) => {
      const next = { ...current };
      fieldIds.forEach((fieldId) => delete next[fieldId]);
      return next;
    });
  }

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        setLoadError('');
        const params = new URLSearchParams();
        params.set('q', query.trim());
        void apiJson<UserListResponse>(`/users?${params.toString()}`)
          .then(
            (result) => {
              if (current) setUsers(result.users);
            },
            (error) => {
              if (current) setLoadError(errorText(error));
            }
          )
          .finally(() => {
            if (current) setLoading(false);
          });
      },
      query ? 220 : 0
    );
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query, refreshToken]);

  useEffect(() => {
    if (!credentials) return undefined;
    document.body.classList.add('credentials-print-mode');
    return () => document.body.classList.remove('credentials-print-mode');
  }, [credentials]);

  const visibleUsers = users.filter((user) => {
    if (statusFilter === 'active') return user.isActive;
    if (statusFilter === 'inactive') return !user.isActive;
    return true;
  });
  const activeCount = users.filter((user) => user.isActive).length;
  const forcedCount = users.filter(
    (user) => user.isActive && user.mustChangePassword
  ).length;
  const leadershipCount = users.filter(
    (user) => user.isActive && user.role !== 'member'
  ).length;

  const closeDialog = useCallback(() => {
    setDialog(null);
    setEditUser(null);
    setEditDraft(null);
    setCreateDraft(newCreateDraft());
    setBulkRows([]);
    setBulkImportText('');
    setBulkImportError('');
    setFormError('');
    setFieldErrors({});
    setBulkRowErrors({});
  }, []);

  function openCreate() {
    rememberDialogOpener();
    setCreateDraft(newCreateDraft());
    setFormError('');
    setFieldErrors({});
    setFeedback(null);
    setDialog('create');
  }

  function openBulk() {
    rememberDialogOpener();
    setBulkRows([makeBulkRow(nextRowId.current++)]);
    setBulkImportText('');
    setBulkImportError('');
    setBulkRowErrors({});
    setFormError('');
    setFieldErrors({});
    setFeedback(null);
    setDialog('bulk');
  }

  function openEdit(user: SafeUser) {
    rememberDialogOpener();
    setEditUser(user);
    setEditDraft({
      displayName: user.displayName,
      username: user.username,
      role: user.role,
      voicePart: user.voicePart,
      aiEnabled: user.aiEnabled,
      aiDailyLimit: user.aiDailyLimit === null ? '' : String(user.aiDailyLimit),
    });
    setFormError('');
    setFieldErrors({});
    setFeedback(null);
    setDialog('edit');
  }

  function openConfirmation(action: Confirmation['action'], user: SafeUser) {
    rememberDialogOpener();
    setFormError('');
    setConfirmation({ action, user });
  }

  function createBody(
    draft: DraftRoleFields & { password?: string }
  ): CreateUserRequest {
    const roleAndVoice: UserRoleVoicePart =
      draft.role === 'member'
        ? {
            role: 'member',
            voicePart: draft.voicePart as StaffedVoicePart,
          }
        : { role: draft.role, voicePart: 'none' };
    return {
      displayName: draft.displayName.trim(),
      ...roleAndVoice,
      ...(draft.username.trim() ? { username: draft.username.trim() } : {}),
      ...(draft.password ? { password: draft.password } : {}),
    };
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateUserIdentity(createDraft, true);
    if (validation) {
      const errors = identityFieldErrors(createDraft, 'create');
      setFieldErrors(errors);
      setFormError(validation);
      focusInvalidField(Object.keys(errors)[0]);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setFormError('');
    try {
      const result = await apiJson<CreateUserResponse>(
        '/users',
        jsonRequest('POST', createBody(createDraft))
      );
      closeDialog();
      setCredentials([
        { displayName: result.user.displayName, ...result.credentials },
      ]);
      setCopyMessage('');
      setFeedback({
        tone: 'success',
        message: `${result.user.displayName} was created.`,
      });
      setRefreshToken((token) => token + 1);
    } catch (error) {
      setFormError(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  function updateBulkRow(rowId: number, next: DraftRoleFields) {
    setBulkRows((rows) =>
      rows.map((row) =>
        row.rowId === rowId ? { ...row, ...next, rowId } : row
      )
    );
    setBulkRowErrors((errors) => ({ ...errors, [rowId]: '' }));
    clearFieldError(
      `bulk-${rowId}-display-name`,
      `bulk-${rowId}-username`,
      `bulk-${rowId}-voice`
    );
    setFormError('');
  }

  function handleBulkImport() {
    const parsed = parseBulkNameImport(bulkImportText);
    if (parsed.errors.length) {
      setBulkImportError(parsed.errors.join('\n'));
      return;
    }
    const importedRows: BulkDraft[] = parsed.rows.map((row) => ({
      ...row,
      username: suggestUsernameFromName(row.displayName, takenUsernames),
      rowId: nextRowId.current++,
      password: '',
    }));
    setBulkRows((existing) => {
      const nonEmptyRows = existing.filter(
        (row) =>
          row.displayName.trim() ||
          row.username.trim() ||
          row.password ||
          row.voicePart ||
          row.role !== 'member'
      );
      return nonEmptyRows.length
        ? [...nonEmptyRows, ...importedRows]
        : importedRows;
    });
    setBulkImportError('');
    setBulkRowErrors({});
    setFieldErrors({});
    setFormError('');
  }

  async function handleBulkCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateBulkUserDrafts(bulkRows);
    setBulkRowErrors(validation.errors);
    const errors: Record<string, string> = {};
    const seenUsernames = new Set<string>();
    for (const row of bulkRows) {
      const prefix = `bulk-${row.rowId}`;
      Object.assign(errors, identityFieldErrors(row, prefix));
      const username = row.username.trim().toLocaleLowerCase();
      if (username && seenUsernames.has(username)) {
        errors[`${prefix}-username`] = 'This username is repeated in the list.';
      }
      if (username) seenUsernames.add(username);
    }
    if (validation.message || Object.keys(errors).length) {
      setFieldErrors(errors);
      setFormError(
        validation.message ||
          'Review the username suggestions and complete each required field.'
      );
      focusInvalidField(Object.keys(errors)[0] ?? 'bulk-add-row');
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setFormError('');
    try {
      const request: BulkCreateUsersRequest = {
        users: bulkRows.map(createBody),
      };
      const result = await apiJson<BulkCreateUsersResponse>(
        '/users/bulk',
        jsonRequest('POST', request)
      );
      closeDialog();
      setCredentials(
        result.users.map(({ user, credentials: issued }) => ({
          displayName: user.displayName,
          ...issued,
        }))
      );
      setCopyMessage('');
      setFeedback({
        tone: 'success',
        message: `${result.users.length} ${result.users.length === 1 ? 'account was' : 'accounts were'} created.`,
      });
      setRefreshToken((token) => token + 1);
    } catch (error) {
      setFormError(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editUser || !editDraft) return;
    const identityValidation = validateUserIdentity(editDraft, true);
    if (identityValidation) {
      const errors = identityFieldErrors(editDraft, 'edit');
      setFieldErrors(errors);
      setFormError(identityValidation);
      focusInvalidField(Object.keys(errors)[0]);
      return;
    }
    const rawLimit = editDraft.aiDailyLimit.trim();
    const parsedLimit = rawLimit ? Number(rawLimit) : null;
    if (
      parsedLimit !== null &&
      (!Number.isInteger(parsedLimit) || parsedLimit < 0)
    ) {
      setFieldErrors({
        'edit-ai-limit':
          'Enter a whole number of zero or more, or leave the field blank.',
      });
      setFormError(
        'AI daily limit must be a whole number of zero or more, or left blank for no limit.'
      );
      focusInvalidField('edit-ai-limit');
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setFormError('');
    try {
      const request: UpdateUserRequest = {
        displayName: editDraft.displayName.trim(),
        username: editDraft.username.trim(),
        role: editDraft.role,
        voicePart:
          editDraft.role === 'member'
            ? (editDraft.voicePart as StaffedVoicePart)
            : 'none',
        aiEnabled: editDraft.aiEnabled,
        aiDailyLimit: parsedLimit,
      };
      const result = await apiJson<UpdateUserResponse>(
        `/users/${encodeURIComponent(editUser.id)}`,
        jsonRequest('PATCH', request)
      );
      closeDialog();
      setFeedback({
        tone: 'success',
        message: `${result.user.displayName}’s account was updated.`,
      });
      setRefreshToken((token) => token + 1);
    } catch (error) {
      setFormError(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function confirmAction() {
    if (!confirmation) return;
    const { action, user } = confirmation;
    setActionBusy(true);
    setFormError('');
    try {
      if (action === 'reset') {
        const request: ResetPasswordRequest = undefined;
        const result = await apiJson<ResetPasswordResponse>(
          `/users/${encodeURIComponent(user.id)}/reset-password`,
          jsonRequest('POST', request)
        );
        setCredentials([
          { displayName: user.displayName, ...result.credentials },
        ]);
        setCopyMessage('');
        setFeedback({
          tone: 'success',
          message: `A new one-time password was generated for ${user.displayName}.`,
        });
      } else {
        const suffix = action === 'deactivate' ? 'deactivate' : 'activate';
        const result = await apiJson<UserResponse>(
          `/users/${encodeURIComponent(user.id)}/${suffix}`,
          jsonRequest('POST')
        );
        setFeedback({
          tone: 'success',
          message:
            action === 'deactivate'
              ? `${result.user.displayName} was deactivated.`
              : `${result.user.displayName} was reactivated.`,
        });
      }
      setConfirmation(null);
      setRefreshToken((token) => token + 1);
      if (action !== 'reset') {
        window.requestAnimationFrame(() =>
          listHeadingRef.current?.focus({ preventScroll: true })
        );
      }
    } catch (error) {
      setFormError(errorText(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    const lines = credentials.map(
      (entry) =>
        `${entry.displayName}\nUsername: ${entry.username}\nPassword: ${entry.password}`
    );
    try {
      await navigator.clipboard.writeText(lines.join('\n\n'));
      setCopyMessage(
        'Copied. Store these securely; passwords are shown only in this reveal.'
      );
    } catch {
      setCopyMessage(
        'Copy is unavailable in this browser. You can select the credentials above.'
      );
    }
  }

  function downloadCredentialsCsv() {
    if (!credentials?.length) return;
    const blob = new Blob([credentialsToCsv(credentials)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'choirscore-credentials.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setCopyMessage(
      'CSV downloaded. Store it securely; credentials are shown only once.'
    );
  }

  function closeCredentials() {
    setCredentials(null);
    setCopyMessage('');
    setCreateDraft(newCreateDraft());
    setBulkRows([]);
    setBulkImportText('');
    setBulkImportError('');
  }

  const filteredCount = visibleUsers.length;

  return (
    <div className="app-page">
      <AppHeader />
      <main className="admin-users-main">
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">ADMINISTRATION · ACCESS</p>
            <h1>Choir users</h1>
            <p>Manage accounts and rehearsal access for your choir.</p>
          </div>
          <div className="heading-actions">
            <button
              className="button button--quiet"
              type="button"
              onClick={openBulk}
            >
              Create multiple
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={openCreate}
            >
              <span aria-hidden="true">＋</span> Add user
            </button>
          </div>
        </div>

        {feedback ? (
          <div
            className={`feedback-banner feedback-banner--${feedback.tone}`}
            role={feedback.tone === 'error' ? 'alert' : 'status'}
          >
            <span className="feedback-banner__icon" aria-hidden="true">
              {feedback.tone === 'error' ? '!' : '✓'}
            </span>
            <span>{feedback.message}</span>
            <button
              className="icon-button icon-button--small"
              type="button"
              aria-label="Dismiss message"
              onClick={() => setFeedback(null)}
            >
              ×
            </button>
          </div>
        ) : null}

        <section className="user-stats" aria-label="Account summary">
          <div className="user-stat">
            <span
              className="user-stat__icon user-stat__icon--green"
              aria-hidden="true"
            >
              ♩
            </span>
            <div>
              <strong>{loading ? '—' : users.length}</strong>
              <span>All accounts</span>
            </div>
          </div>
          <div className="user-stat">
            <span
              className="user-stat__icon user-stat__icon--blue"
              aria-hidden="true"
            >
              ✓
            </span>
            <div>
              <strong>{loading ? '—' : activeCount}</strong>
              <span>Active accounts</span>
            </div>
          </div>
          <div className="user-stat">
            <span
              className="user-stat__icon user-stat__icon--gold"
              aria-hidden="true"
            >
              ♬
            </span>
            <div>
              <strong>{loading ? '—' : leadershipCount}</strong>
              <span>Leadership</span>
            </div>
          </div>
          <div className="user-stat">
            <span
              className="user-stat__icon user-stat__icon--lavender"
              aria-hidden="true"
            >
              ⌑
            </span>
            <div>
              <strong>{loading ? '—' : forcedCount}</strong>
              <span>Need password change</span>
            </div>
          </div>
        </section>

        <section className="users-panel" aria-labelledby="users-list-title">
          <div className="users-panel__top">
            <div>
              <h2 id="users-list-title" ref={listHeadingRef} tabIndex={-1}>
                All users
              </h2>
              <p>
                Search by name or username. Passwords are never shown in this
                list.
              </p>
            </div>
            <span className="result-count">
              {loading
                ? 'Loading…'
                : `${filteredCount} ${filteredCount === 1 ? 'person' : 'people'}`}
            </span>
          </div>
          <div className="user-toolbar">
            <label className="search-field" htmlFor="user-search">
              <span aria-hidden="true">⌕</span>
              <input
                id="user-search"
                type="search"
                placeholder="Search people…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <span className="visually-hidden">
                Search by display name or username
              </span>
            </label>
            <label className="filter-field" htmlFor="user-status-filter">
              <span className="visually-hidden">Filter account status</span>
              <select
                id="user-status-filter"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as typeof statusFilter)
                }
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>

          {loading ? (
            <div
              className="user-skeleton-list"
              aria-label="Loading users"
              aria-busy="true"
            >
              {[0, 1, 2, 3].map((row) => (
                <div className="user-skeleton" key={row}>
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className="list-state list-state--error" role="alert">
              <span
                className="status-symbol status-symbol--error"
                aria-hidden="true"
              >
                !
              </span>
              <h3>Users could not be loaded</h3>
              <p>{loadError}</p>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => setRefreshToken((token) => token + 1)}
              >
                Try again
              </button>
            </div>
          ) : visibleUsers.length === 0 ? (
            <div className="list-state">
              <span className="list-state__music" aria-hidden="true">
                ♬
              </span>
              <h3>
                {query || statusFilter !== 'all'
                  ? 'No matching users'
                  : 'No users yet'}
              </h3>
              <p>
                {query || statusFilter !== 'all'
                  ? 'Try another name or adjust the status filter.'
                  : 'Create the first account for your choir.'}
              </p>
              {!query && statusFilter === 'all' ? (
                <button
                  className="button button--primary"
                  type="button"
                  onClick={openCreate}
                >
                  Add the first user
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="users-table-wrap">
                <table className="users-table">
                  <thead>
                    <tr>
                      <th scope="col">Person</th>
                      <th scope="col">Role &amp; voice</th>
                      <th scope="col">Status</th>
                      <th scope="col">Last sign-in</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleUsers.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <div className="person-cell">
                            <span className="person-avatar" aria-hidden="true">
                              {user.displayName
                                .trim()
                                .charAt(0)
                                .toUpperCase() || 'C'}
                            </span>
                            <div className="person-details">
                              <strong>{user.displayName}</strong>
                              <span>@{user.username}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="role-cell">
                            <strong>{roleLabel(user.role)}</strong>
                            <span>
                              {user.voicePart === 'none'
                                ? 'Not applicable — staff'
                                : `${user.voicePart} · ${{ S: 'Soprano', A: 'Alto', T: 'Tenor', B: 'Bass' }[user.voicePart]}`}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="status-stack">
                            <span
                              className={`status-pill ${user.isActive ? 'status-pill--active' : 'status-pill--inactive'}`}
                            >
                              <span aria-hidden="true" />
                              {user.isActive ? 'Active' : 'Inactive'}
                            </span>
                            {user.mustChangePassword ? (
                              <span className="subtle-status">
                                Password change required
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="date-cell">
                          {prettyDate(user.lastLoginAt)}
                        </td>
                        <td>
                          <UserActions
                            user={user}
                            onEdit={() => openEdit(user)}
                            onAction={openConfirmation}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="user-cards">
                {visibleUsers.map((user) => (
                  <article className="user-card" key={user.id}>
                    <div className="user-card__top">
                      <div className="person-cell">
                        <span className="person-avatar" aria-hidden="true">
                          {user.displayName.trim().charAt(0).toUpperCase() ||
                            'C'}
                        </span>
                        <div className="person-details">
                          <strong>{user.displayName}</strong>
                          <span>@{user.username}</span>
                        </div>
                      </div>
                      <span
                        className={`status-pill ${user.isActive ? 'status-pill--active' : 'status-pill--inactive'}`}
                      >
                        <span aria-hidden="true" />
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="user-card__meta">
                      <span>{roleLabel(user.role)}</span>
                      <span>
                        {user.voicePart === 'none'
                          ? 'Not applicable — staff'
                          : `${user.voicePart} · ${{ S: 'Soprano', A: 'Alto', T: 'Tenor', B: 'Bass' }[user.voicePart]}`}
                      </span>
                      <span>Last sign-in: {prettyDate(user.lastLoginAt)}</span>
                      {user.mustChangePassword ? (
                        <span className="subtle-status">
                          Password change required
                        </span>
                      ) : null}
                    </div>
                    <UserActions
                      user={user}
                      onEdit={() => openEdit(user)}
                      onAction={openConfirmation}
                    />
                  </article>
                ))}
              </div>
            </>
          )}
        </section>

        <p className="users-page-footnote">
          <span aria-hidden="true">◈</span> Sign-in credentials are only shown
          once when an account is created or its password is reset.
        </p>
      </main>
      <footer className="app-footer">
        <span>ChoirScore · Kings &amp; Queens Choir</span>
        <span>Private by design</span>
      </footer>

      {dialog === 'create' ? (
        <Modal
          title="Add a choir user"
          onClose={() => {
            if (!saving) closeDialog();
          }}
          restoreFocus={restoreDialogFocus}
        >
          <p className="modal-intro">
            The suggested username is shown and editable before saving. Leave
            the password override blank to generate a password; sign-in details
            are revealed once after saving.
          </p>
          <form className="form-stack" onSubmit={handleCreate} noValidate>
            <FormIdentityFields
              draft={createDraft}
              prefix="create"
              suggestUsername
              takenUsernames={takenUsernames}
              fieldErrors={fieldErrors}
              onChange={(next) => {
                setCreateDraft((current) => ({ ...current, ...next }));
                clearFieldError(
                  'create-display-name',
                  'create-username',
                  'create-voice'
                );
                setFormError('');
              }}
              disabled={saving}
            />
            <PasswordOverrideField
              id="create-password-override"
              value={createDraft.password}
              error={fieldErrors['create-password-override']}
              disabled={saving}
              onChange={(password) => {
                setCreateDraft((current) => ({ ...current, password }));
                const passwordError = validatePasswordOverride(password);
                setFieldErrors((current) => ({
                  ...current,
                  'create-password-override': passwordError,
                }));
                setFormError(passwordError);
              }}
            />
            {formError ? (
              <div className="form-alert form-alert--error" role="alert">
                {formError}
              </div>
            ) : null}
            <div className="modal-actions">
              <button
                className="button button--quiet"
                type="button"
                onClick={closeDialog}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="button button--primary"
                type="submit"
                disabled={saving}
              >
                {saving ? 'Creating…' : 'Create account'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {dialog === 'bulk' ? (
        <Modal
          title="Create multiple users"
          onClose={() => {
            if (!saving) closeDialog();
          }}
          restoreFocus={restoreDialogFocus}
          wide
        >
          <p className="modal-intro">
            Add people manually or import one name per line. Use “Name, S” (or
            A, T, or B) to include a voice part; every member without one must
            be completed before the all-or-nothing request can be submitted.
          </p>
          <form
            className="form-stack bulk-form"
            onSubmit={handleBulkCreate}
            noValidate
          >
            <section
              className="bulk-import-panel"
              aria-labelledby="bulk-import-title"
            >
              <div className="bulk-import-panel__heading">
                <div>
                  <h3 id="bulk-import-title">Quick import</h3>
                  <p>
                    Paste one person per line, or upload a two-column CSV: name
                    and optional voice part.
                  </p>
                </div>
                <label className="button button--quiet button--small bulk-import-upload">
                  Upload CSV
                  <input
                    className="visually-hidden"
                    type="file"
                    accept=".csv,text/csv"
                    aria-label="Upload names CSV"
                    onChange={async (event) => {
                      const input = event.currentTarget;
                      const file = input.files?.[0];
                      if (!file) return;
                      try {
                        setBulkImportText(await file.text());
                        setBulkImportError('');
                      } catch {
                        setBulkImportError(
                          'The CSV file could not be read. Choose a text-based CSV file.'
                        );
                      } finally {
                        input.value = '';
                      }
                    }}
                  />
                </label>
              </div>
              <label className="visually-hidden" htmlFor="bulk-name-import">
                Names to import
              </label>
              <textarea
                id="bulk-name-import"
                rows={4}
                value={bulkImportText}
                onChange={(event) => {
                  setBulkImportText(event.target.value);
                  setBulkImportError('');
                }}
                placeholder={'Ada Lovelace, S\nKofi Mensah, T\nSam Example'}
                disabled={saving}
              />
              <div className="bulk-import-panel__footer">
                <span>
                  Imported rows are added to any names already entered. Voice
                  parts can be filled in afterward.
                </span>
                <button
                  className="button button--quiet button--small"
                  type="button"
                  onClick={handleBulkImport}
                  disabled={saving}
                >
                  Import names
                </button>
              </div>
              {bulkImportError ? (
                <p className="bulk-import-error" role="alert">
                  {bulkImportError}
                </p>
              ) : null}
            </section>
            <div className="bulk-rows">
              {bulkRows.map((row, index) => (
                <fieldset
                  className={`bulk-row${bulkRowErrors[row.rowId] ? ' bulk-row--error' : ''}`}
                  key={row.rowId}
                >
                  <legend>
                    <span className="bulk-row__number">
                      {String(index + 1).padStart(2, '0')}
                    </span>{' '}
                    New account{' '}
                    <button
                      className="bulk-row__remove"
                      type="button"
                      onClick={() => {
                        setBulkRows((rows) =>
                          rows.filter((item) => item.rowId !== row.rowId)
                        );
                        setBulkRowErrors((errors) => {
                          const next = { ...errors };
                          delete next[row.rowId];
                          return next;
                        });
                      }}
                      aria-label={`Remove account ${index + 1}`}
                    >
                      Remove
                    </button>
                  </legend>
                  <FormIdentityFields
                    draft={row}
                    prefix={`bulk-${row.rowId}`}
                    suggestUsername
                    takenUsernames={takenUsernames}
                    fieldErrors={fieldErrors}
                    onChange={(next) => updateBulkRow(row.rowId, next)}
                  />
                  <PasswordOverrideField
                    id={`bulk-${row.rowId}-password-override`}
                    value={row.password}
                    error={fieldErrors[`bulk-${row.rowId}-password-override`]}
                    onChange={(password) => {
                      setBulkRows((rows) =>
                        rows.map((item) =>
                          item.rowId === row.rowId
                            ? { ...item, password }
                            : item
                        )
                      );
                      setBulkRowErrors((errors) => ({
                        ...errors,
                        [row.rowId]: '',
                      }));
                      const passwordError = validatePasswordOverride(password);
                      setFieldErrors((errors) => ({
                        ...errors,
                        [`bulk-${row.rowId}-password-override`]: passwordError,
                      }));
                      setFormError('');
                    }}
                  />
                  {bulkRowErrors[row.rowId] ? (
                    <p className="bulk-row__error" role="alert">
                      {bulkRowErrors[row.rowId]}
                    </p>
                  ) : null}
                </fieldset>
              ))}
              {bulkRows.length === 0 ? (
                <p className="empty-bulk">
                  No rows yet. Add at least one account to continue.
                </p>
              ) : null}
            </div>
            <button
              id="bulk-add-row"
              className="button button--quiet bulk-add"
              type="button"
              onClick={() => {
                setBulkRows((rows) => [
                  ...rows,
                  makeBulkRow(nextRowId.current++),
                ]);
                setFormError('');
              }}
            >
              <span aria-hidden="true">＋</span> Add another person
            </button>
            {formError ? (
              <div className="form-alert form-alert--error" role="alert">
                {formError}
              </div>
            ) : null}
            <div className="modal-actions">
              <button
                className="button button--quiet"
                type="button"
                onClick={closeDialog}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="button button--primary"
                type="submit"
                disabled={saving}
              >
                {saving
                  ? 'Creating accounts…'
                  : `Create ${bulkRows.length || ''} ${bulkRows.length === 1 ? 'account' : 'accounts'}`}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {dialog === 'edit' && editUser && editDraft ? (
        <Modal
          title="Edit user"
          onClose={() => {
            if (!saving) closeDialog();
          }}
          restoreFocus={restoreDialogFocus}
        >
          <p className="modal-intro">
            Update account details and access. Passwords are managed separately
            and are never shown here.
          </p>
          <form className="form-stack" onSubmit={handleEdit} noValidate>
            <FormIdentityFields
              draft={editDraft}
              prefix="edit"
              fieldErrors={fieldErrors}
              onChange={(next) => {
                setEditDraft((current) =>
                  current ? { ...current, ...next } : current
                );
                clearFieldError(
                  'edit-display-name',
                  'edit-username',
                  'edit-voice'
                );
                setFormError('');
              }}
              disabled={saving}
            />
            <div className="settings-divider" />
            <div className="field field--toggle">
              <span>
                <strong>AI features</strong>
                <small>Allow this user to use AI rehearsal tools.</small>
              </span>
              <label className="toggle-control">
                <input
                  type="checkbox"
                  checked={editDraft.aiEnabled}
                  disabled={saving}
                  onChange={(event) =>
                    setEditDraft({
                      ...editDraft,
                      aiEnabled: event.target.checked,
                    })
                  }
                />
                <span aria-hidden="true" />
                <span className="visually-hidden">Enable AI features</span>
              </label>
            </div>
            <div className="field">
              <label htmlFor="edit-ai-limit">
                AI daily limit{' '}
                <span className="label-optional">· optional</span>
              </label>
              <input
                id="edit-ai-limit"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="No limit"
                value={editDraft.aiDailyLimit}
                disabled={saving}
                aria-invalid={fieldErrors['edit-ai-limit'] ? true : undefined}
                aria-describedby={
                  fieldErrors['edit-ai-limit']
                    ? 'edit-ai-limit-help edit-ai-limit-error'
                    : 'edit-ai-limit-help'
                }
                onChange={(event) => {
                  setEditDraft({
                    ...editDraft,
                    aiDailyLimit: event.target.value,
                  });
                  clearFieldError('edit-ai-limit');
                  setFormError('');
                }}
              />
              <span className="field-help" id="edit-ai-limit-help">
                Leave blank for no per-user limit.
              </span>
              {fieldErrors['edit-ai-limit'] ? (
                <span className="field-error" id="edit-ai-limit-error">
                  {fieldErrors['edit-ai-limit']}
                </span>
              ) : null}
            </div>
            {formError ? (
              <div className="form-alert form-alert--error" role="alert">
                {formError}
              </div>
            ) : null}
            <div className="modal-actions">
              <button
                className="button button--quiet"
                type="button"
                onClick={closeDialog}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="button button--primary"
                type="submit"
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {confirmation ? (
        <Modal
          title={
            confirmation.action === 'reset'
              ? 'Reset password?'
              : confirmation.action === 'deactivate'
                ? 'Deactivate account?'
                : 'Reactivate account?'
          }
          onClose={() => {
            if (!actionBusy) setConfirmation(null);
          }}
          restoreFocus={restoreDialogFocus}
        >
          <div className="confirm-content">
            <span
              className={`confirm-icon${confirmation.action === 'deactivate' ? ' confirm-icon--warning' : ''}`}
              aria-hidden="true"
            >
              {confirmation.action === 'reset'
                ? '⌑'
                : confirmation.action === 'deactivate'
                  ? '!'
                  : '✓'}
            </span>
            <p>
              {confirmation.action === 'reset' ? (
                <>
                  Generate a new temporary password for{' '}
                  <strong>{confirmation.user.displayName}</strong>? Their
                  current password will stop working. The new credential will be
                  shown once.
                </>
              ) : confirmation.action === 'deactivate' ? (
                <>
                  Deactivate <strong>{confirmation.user.displayName}</strong>?
                  They will lose access until an administrator reactivates the
                  account.
                </>
              ) : (
                <>
                  Restore access for{' '}
                  <strong>{confirmation.user.displayName}</strong>? They will be
                  able to sign in again.
                </>
              )}
            </p>
          </div>
          {formError ? (
            <div className="form-alert form-alert--error" role="alert">
              {formError}
            </div>
          ) : null}
          <div className="modal-actions">
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setConfirmation(null)}
              disabled={actionBusy}
            >
              Cancel
            </button>
            <button
              className={`button ${confirmation.action === 'deactivate' ? 'button--danger' : 'button--primary'}`}
              type="button"
              onClick={() => void confirmAction()}
              disabled={actionBusy}
            >
              {actionBusy
                ? 'Please wait…'
                : confirmation.action === 'reset'
                  ? 'Reset password'
                  : confirmation.action === 'deactivate'
                    ? 'Deactivate account'
                    : 'Reactivate account'}
            </button>
          </div>
        </Modal>
      ) : null}

      {credentials ? (
        <Modal
          title="Sign-in credentials"
          onClose={closeCredentials}
          restoreFocus={restoreDialogFocus}
          className="credential-modal"
          wide
        >
          <div className="credential-print-sheet">
            <div className="credential-warning" role="status" data-print-hide>
              <span className="credential-warning__icon" aria-hidden="true">
                !
              </span>
              <p>
                <strong>Shown once only.</strong> Copy, download, or privately
                share these details now. ChoirScore will not show the password
                again.
              </p>
            </div>
            <div className="credential-list">
              {credentials.map((entry, index) => (
                <section
                  className="credential-item"
                  key={`${entry.username}-${index}`}
                  aria-label={`Credentials for ${entry.displayName}`}
                >
                  <h3>{entry.displayName}</h3>
                  <div className="credential-field">
                    <span>Username</span>
                    <code>{entry.username}</code>
                  </div>
                  <div className="credential-field">
                    <span>Password</span>
                    <code className="credential-password">
                      {entry.password}
                    </code>
                  </div>
                </section>
              ))}
            </div>
          </div>
          {copyMessage ? (
            <p className="copy-message" role="status" data-print-hide>
              {copyMessage}
            </p>
          ) : null}
          <div className="modal-actions modal-actions--spread" data-print-hide>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => void copyCredentials()}
            >
              Copy credentials
            </button>
            <button
              className="button button--quiet"
              type="button"
              onClick={downloadCredentialsCsv}
            >
              Download CSV
            </button>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => window.print()}
            >
              Print slips
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={closeCredentials}
            >
              Done
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
