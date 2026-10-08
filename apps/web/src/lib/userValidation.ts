import type { Role, VoicePart } from '@choirscore/shared';

export interface UserIdentityDraft {
  displayName: string;
  username: string;
  role: Role;
  voicePart: VoicePart | '';
  password?: string;
}

export interface BulkIdentityDraft extends UserIdentityDraft {
  rowId: number;
}

export type ParsedBulkName = UserIdentityDraft;

const REQUIRED_MEMBER_VOICE_PARTS: Exclude<VoicePart, 'none'>[] = [
  'S',
  'A',
  'T',
  'B',
];
const VOICE_PART_ALIASES: Record<string, Exclude<VoicePart, 'none'>> = {
  s: 'S',
  soprano: 'S',
  a: 'A',
  alto: 'A',
  t: 'T',
  tenor: 'T',
  b: 'B',
  bass: 'B',
};

export function normalizeUsername(username: string) {
  return username.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

export interface BulkUsernameSuggestionDraft {
  rowId: number;
  displayName: string;
  username: string;
  usernameAuto: boolean;
}

export function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

export function truncateUtf8Bytes(value: string, maxBytes: number) {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

export function suggestUsernameFromName(
  displayName: string,
  takenUsernames: string[] = []
) {
  const base =
    displayName
      .trim()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('en-US')
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '') || 'user';
  const taken = new Set(takenUsernames.map(normalizeUsername));
  let suggestion = base;
  let suffix = 2;
  while (taken.has(normalizeUsername(suggestion))) {
    suggestion = `${base}.${suffix}`;
    suffix += 1;
  }
  return suggestion;
}

export function suggestBulkUsernames(
  rows: BulkUsernameSuggestionDraft[],
  takenUsernames: string[] = []
) {
  const reserved = new Set(
    takenUsernames.map(normalizeUsername).filter(Boolean)
  );

  rows.forEach((row) => {
    if (!row.usernameAuto && row.username.trim())
      reserved.add(normalizeUsername(row.username));
  });

  const suggestions: Record<number, string> = {};
  rows.forEach((row) => {
    if (!row.usernameAuto) {
      suggestions[row.rowId] = row.username;
      return;
    }
    if (!row.displayName.trim()) {
      suggestions[row.rowId] = '';
      return;
    }
    const suggestion = suggestUsernameFromName(row.displayName, [...reserved]);
    suggestions[row.rowId] = suggestion;
    reserved.add(normalizeUsername(suggestion));
  });

  return suggestions;
}

export function validatePasswordOverride(password: string) {
  if (!password) return '';
  if (password.length < 8)
    return 'A password override must be at least 8 characters, or left blank to generate one.';
  if (utf8ByteLength(password) > 72)
    return 'A password override must be no more than 72 UTF-8 bytes.';
  return '';
}

export function validateUserIdentity(
  draft: UserIdentityDraft,
  requireUsername: boolean
) {
  if (!draft.displayName.trim()) return 'Enter a display name.';
  if (requireUsername && !draft.username.trim()) return 'Enter a username.';
  const issues: string[] = [];
  if (
    draft.role === 'member' &&
    !REQUIRED_MEMBER_VOICE_PARTS.includes(
      draft.voicePart as Exclude<VoicePart, 'none'>
    )
  ) {
    issues.push('Choose a voice part for every choir member.');
  }
  const passwordError = validatePasswordOverride(draft.password ?? '');
  if (passwordError) issues.push(passwordError);
  return issues.join(' ');
}

export function validateBulkUserDrafts(
  rows: BulkIdentityDraft[],
  takenUsernames: string[] = []
) {
  const errors: Record<number, string> = {};
  if (!rows.length)
    return { errors, message: 'Add at least one person to create.' };

  const taken = new Set(takenUsernames.map(normalizeUsername));
  const seenUsernames = new Set<string>();
  for (const row of rows) {
    const issues: string[] = [];
    const identityError = validateUserIdentity(row, false);
    if (identityError) issues.push(identityError);
    if (row.username.trim()) {
      const normalized = normalizeUsername(row.username);
      if (taken.has(normalized))
        issues.push('This username is already in use.');
      if (seenUsernames.has(normalized))
        issues.push('This username is repeated in the list.');
      seenUsernames.add(normalized);
    }
    if (issues.length) errors[row.rowId] = issues.join(' ');
  }
  const invalid = Object.values(errors).some(Boolean);
  return {
    errors,
    message: invalid
      ? 'Review the highlighted rows. Every member needs a voice part and every password override must be valid before submitting.'
      : '',
  };
}

function parseCsvLine(line: string) {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      fields.push(field.trim());
      field = '';
    } else {
      field += character;
    }
  }
  fields.push(field.trim());
  return { fields, unclosedQuote: quoted };
}

function isNameVoiceHeader(fields: string[]) {
  const name = fields[0]
    ?.trim()
    .toLocaleLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  const voice = fields[1]?.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  return (
    (name === 'name' || name === 'display name') &&
    (voice === 'voice' || voice === 'voice part' || voice === 'voicepart')
  );
}

export function parseBulkNameImport(text: string) {
  const rows: ParsedBulkName[] = [];
  const errors: string[] = [];
  let firstNonBlankSeen = false;

  text.split(/\r?\n/).forEach((sourceLine, index) => {
    const line = sourceLine.replace(/^\uFEFF/, '').trim();
    if (!line) return;
    const { fields, unclosedQuote } = parseCsvLine(line);
    if (!firstNonBlankSeen) {
      firstNonBlankSeen = true;
      if (isNameVoiceHeader(fields)) return;
    }
    if (unclosedQuote) {
      errors.push(`Line ${index + 1}: close the quoted name before importing.`);
      return;
    }
    if (fields.length > 2) {
      errors.push(
        `Line ${index + 1}: use a name followed by at most one voice part.`
      );
      return;
    }
    const displayName = fields[0]?.trim() ?? '';
    if (!displayName) {
      errors.push(`Line ${index + 1}: enter a name.`);
      return;
    }
    const voiceText = fields[1]?.trim().toLocaleLowerCase() ?? '';
    const voicePart = voiceText ? VOICE_PART_ALIASES[voiceText] : '';
    if (voiceText && !voicePart) {
      errors.push(
        `Line ${index + 1}: voice part must be S, A, T, or B (or its full name).`
      );
      return;
    }
    rows.push({
      displayName,
      username: '',
      role: 'member',
      voicePart,
      password: '',
    });
  });

  if (!rows.length && !errors.length)
    errors.push('Enter at least one name to import.');
  return { rows, errors };
}
